"use client";

import { displayAdminReadError } from "@/lib/admin/error-messages";
import { SupportClientError } from "@/lib/admin/m-support-client";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useEffect, useRef, useState } from "react";
import { ListOrdered, MapPin, RefreshCw, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { fetchLeaderboardAvatar, locateLeaderboardSelf, supportLeaderboardClient, type LeaderboardDetail, type LeaderboardPage, type LeaderboardQuery } from "@/lib/admin/support-leaderboard-client";
import { BlockState, Button, Conclusion, Explain, FilterBar, FilterField, Input, Modal, Notice, PageHeader, PageTabs, RdPage, Select, StatusTag, useTabIds } from "@/app/components/rd";
import type { SupportBoardKey, SupportBoardQuery, SupportBoardRow } from "./support-leaderboard";
import { BOARD_DEFINITION, BOARD_LABEL, BoardPager, PerformanceBody, Podium, RankingPanel, RankingTable, amountPlaces, amountText, countText } from "./m6-leaderboard-views";
import "./m6-leaderboard.css";

function status(error: unknown): number | undefined {
  return error instanceof SupportClientError ? (error.status === 200 ? error.apiCode : error.status) : undefined;
}
function versionChanged(error: unknown): boolean {
  return error instanceof SupportClientError && status(error) === 409 && ["SUPPORT_LEADERBOARD_VERSION_CHANGED", "SUPPORT_LEADERBOARD_SCOPE_CHANGED", "AVATAR_STATE_CONFLICT"].includes(error.backendMessage ?? "");
}
function scopeChanged(error: unknown): boolean {
  return error instanceof SupportClientError && status(error) === 409 && error.backendMessage === "SUPPORT_LEADERBOARD_SCOPE_CHANGED";
}
function message(error: unknown): string {
  return status(error) === 403 || status(error) === 401 ? "当前账号不能查看此榜单，请重新确认登录和客服权限。"
    : versionChanged(error) ? "榜单已更新，或你能看的范围变了，请从第一页重新加载。"
      : error instanceof SupportClientError ? displayAdminReadError(error) : "榜单加载失败，请重试。";
}
function scopeValue(scope: string, groupId?: string) { return groupId ? `${scope}:${groupId}` : scope; }
function asOf(data: LeaderboardPage | LeaderboardDetail) { return `${businessStamp(Date.parse(data.asOf))}（${businessZone().label}）`; }
function acceptedQuery(data: LeaderboardPage, query: LeaderboardQuery): LeaderboardQuery { return { ...query, month: data.rankMonth ?? undefined, currency: data.currency, expectedVersion: data.viewVersion }; }

/** Public aggregates have their own lifecycle; entering M6 never mounts the private M1/M3 hooks. */
export function M6Leaderboard() {
  const router = useRouter();
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const authenticated = useAdminAuth(state => state.isAuthenticated), logoutPending = useAdminAuth(state => state.logoutPending), logoutUnknown = useAdminAuth(state => state.logoutUnknown);
  const identity = adminShellSessionKey(session, epoch) + "|" + JSON.stringify(session?.menuNodes ?? null) + `|${authenticated}|${logoutPending}|${logoutUnknown}`;
  const domains = session ? resolveVisibleDomains(session) : [];
  const allowed = authenticated && !logoutPending && !logoutUnknown && !!session && !session.passwordChangeRequired
    && session.authorities.some(code => code === "service_m1_read" || code === "service_m3_read") && canAccessResolvedPath(domains, "/service/leaderboard");
  const privateRead = !!session?.authorities.includes("service_m1_read") && canAccessResolvedPath(domains, "/service/overview");
  const [query, setQuery] = useState<LeaderboardQuery>({ board: "netContribution", currency: "USDT", scope: "all", pageNum: 1, pageSize: 5 });
  const selectedMonth = useRef<string | undefined>(undefined);
  const [keyword, setKeyword] = useState("");
  // 失败记在出错的那次读取上：换了查询、翻页或重读后，旧的失败和「榜单已更新」都不再算（BUG-650 复审 F03）。
  const [refresh, setRefresh] = useState(0), [failure, setFailure] = useState<{ key: string; text: string; conflict?: boolean }>(), [notice, setNotice] = useState<string>();
  const [deniedIdentity, setDeniedIdentity] = useState<string>();
  const enabled = allowed && deniedIdentity !== identity;
  const requestKey = identity + "|" + JSON.stringify(query) + "|" + refresh;
  const liveKey = useRef(requestKey); liveKey.current = enabled ? requestKey : "";
  const [result, setResult] = useState<{ key: string; data: LeaderboardPage }>();
  const data = enabled && result?.key === requestKey ? result.data : undefined;
  const error = failure?.key === requestKey ? failure.text : undefined, conflict = !!error && !!failure?.conflict;
  /** 这个账号和权限下最近一次读成的榜单：这次读取失败或还在读时，月份、币种、范围和榜单页签照它的选项继续可用（ST-15，复审 F02）；换账号、权限或被拒时清掉。 */
  const [lastGood, setLastGood] = useState<{ identity: string; data: LeaderboardPage }>();
  const options = data ?? (enabled && lastGood?.identity === identity ? lastGood.data : undefined);
  /** 后端说能看的范围变了，按新授权重读还没读成：旧的组目录不再给。 */
  const [scopeStale, setScopeStale] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingLocate = useRef<{ identity: string; query: string } | undefined>(undefined);
  const [photos, setPhotos] = useState<{ key: string; urls: Record<string, string> }>();
  const [detail, setDetail] = useState<{ key: string; agentId: string; data?: LeaderboardDetail; error?: string }>();
  const detailAbort = useRef<AbortController | null>(null), detailSequence = useRef(0);
  const closeDetail = () => { detailSequence.current++; detailAbort.current?.abort(); detailAbort.current = null; setDetail(undefined); };
  const resetFirstPage = (text: string) => { setResult(undefined); setPhotos(undefined); closeDetail(); setNotice(text); setQuery(current => ({ ...current, pageNum: 1, expectedVersion: undefined })); setRefresh(value => value + 1); };
  /** 后端明确说范围变了（409 SCOPE_CHANGED，复审 F02）：旧组目录立刻收起，范围回到全员榜，月份、币种、榜单、搜索和每页条数照旧，按新授权重读；版本更新照旧走「榜单已更新」。 */
  const scopeLost = (cause: unknown) => {
    setScopeStale(true); setResult(undefined); setPhotos(undefined); closeDetail();
    const fallback: LeaderboardQuery = { ...query, scope: "all", groupId: undefined, pageNum: 1, expectedVersion: undefined };
    if (JSON.stringify(fallback) === JSON.stringify(query)) { setFailure({ key: requestKey, text: message(cause) }); return; }
    setNotice("能看的范围变了，范围已回到全员榜，按新权限重读。");
    setQuery(fallback);
  };
  const deny = () => { setDeniedIdentity(identity); setResult(undefined); setLastGood(undefined); setPhotos(undefined); closeDetail(); setFailure({ key: requestKey, text: "当前账号不能查看此榜单，请重新确认登录和客服权限。" }); };

  useEffect(() => {
    const pending = pendingLocate.current;
    if (!pending) return;
    if (!enabled || error || pending.identity !== identity || pending.query !== JSON.stringify(query)) { pendingLocate.current = undefined; return; }
    if (!data) return;
    const row = containerRef.current?.querySelector<HTMLTableRowElement>('tr[data-self="true"]');
    row?.scrollIntoView({ block: "center", behavior: "auto" });
    row?.querySelector<HTMLButtonElement>(".sl-person-name button")?.focus({ preventScroll: true });
    pendingLocate.current = undefined;
  }, [data, enabled, error, identity, query]);

  useEffect(() => {
    setResult(undefined); setLastGood(undefined); setScopeStale(false); setFailure(undefined); setNotice(undefined); setPhotos(undefined); closeDetail(); setKeyword("");
    selectedMonth.current = undefined;
    setQuery({ board: "netContribution", currency: "USDT", scope: "all", pageNum: 1, pageSize: 5 });
    return () => { detailSequence.current++; detailAbort.current?.abort(); };
    // The key includes account, permissions, explicit menus and logout state.
  }, [identity]);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setResult(undefined); setFailure(undefined); closeDetail();
    if (enabled) void supportLeaderboardClient.page(query, controller.signal).then(next => {
      if (next.self.row && next.self.row.id !== String(session?.adminId)) throw new Error("本人成绩身份不一致");
      if (active && !controller.signal.aborted && liveKey.current === requestKey) { setResult({ key: requestKey, data: next }); setLastGood({ identity, data: next }); setScopeStale(false); }
    }).catch(cause => {
      if (!active || controller.signal.aborted || liveKey.current !== requestKey) return;
      if (status(cause) === 403 || status(cause) === 401) deny();
      else if (scopeChanged(cause)) scopeLost(cause);
      else { setResult(undefined); setFailure({ key: requestKey, text: message(cause), conflict: versionChanged(cause) }); }
    });
    return () => { active = false; controller.abort(); };
  }, [enabled, requestKey]);

  useEffect(() => {
    const controller = new AbortController(), urls: Record<string, string> = {}; let active = true;
    setPhotos(undefined);
    if (data) {
      const rows = new Map([...data.rows, ...(data.podium?.rows ?? []), ...(data.self.row ? [data.self.row] : [])].map(row => [row.id, row]));
      const q = acceptedQuery(data, query);
      for (const row of rows.values()) if (row.avatarUrl) void fetchLeaderboardAvatar(row.avatarUrl, row.id, q, data.viewVersion, controller.signal).then(blob => {
        if (!active || controller.signal.aborted || liveKey.current !== requestKey) return;
        urls[row.id] = URL.createObjectURL(blob); setPhotos({ key: requestKey, urls: { ...urls } });
      }).catch(cause => {
        if (!active || controller.signal.aborted || liveKey.current !== requestKey) return;
        if (status(cause) === 403 || status(cause) === 401) { controller.abort(); deny(); }
        else if (scopeChanged(cause)) { controller.abort(); scopeLost(cause); }
        else if (versionChanged(cause)) { controller.abort(); setResult(undefined); setPhotos(undefined); closeDetail(); setFailure({ key: requestKey, text: message(cause), conflict: true }); }
      });
    }
    return () => { active = false; controller.abort(); for (const url of Object.values(urls)) URL.revokeObjectURL(url); };
  }, [data, requestKey]);

  const changeQuery = (next: SupportBoardQuery) => {
    // 第一次就没读成、没有选项可核对时，只剩页签能换（ST-15）；读取中不换。
    if (!options && !readFailed) return;
    const [scope, groupId] = next.scope.split(":");
    if (options && (!scopeStale && !options.scopeOptions.some(option => option.scope === scope && (!groupId || option.groups.some(group => group.id === groupId)))
      || !options.currencies.includes(next.currency as "USDT" | "UVT") || query.board !== "customers" && next.board !== "customers" && next.month && !options.selectableMonths.includes(next.month))) return;
    closeDetail(); setNotice(undefined);
    if (next.month) selectedMonth.current = next.month;
    setQuery({ board: next.board, currency: next.currency as "USDT" | "UVT", scope: scope as LeaderboardQuery["scope"], groupId, month: next.board === "customers" ? undefined : next.month || undefined, keyword: query.keyword, pageNum: 1, pageSize: query.pageSize });
  };
  const openDetail = (agentId: string) => {
    if (!data || !enabled || ![...data.rows, ...(data.podium?.rows ?? []), ...(data.self.row ? [data.self.row] : [])].some(row => row.id === agentId)) return;
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller;
    const sequence = ++detailSequence.current; setDetail({ key: requestKey, agentId });
    void supportLeaderboardClient.detail(agentId, acceptedQuery(data, query), controller.signal).then(next => {
      if (next.sourceVersion !== data.sourceVersion || next.definitionVersion !== data.definitionVersion || next.asOf !== data.asOf || next.referenceMonth !== data.referenceMonth || next.state !== data.state || next.candidateCoverage !== data.candidateCoverage) throw new Error("公开成绩版本信息不一致");
      if (!controller.signal.aborted && sequence === detailSequence.current && liveKey.current === requestKey) setDetail({ key: requestKey, agentId, data: next });
    }).catch(cause => {
      if (controller.signal.aborted || sequence !== detailSequence.current || liveKey.current !== requestKey) return;
      if (status(cause) === 403 || status(cause) === 401) deny();
      else if (scopeChanged(cause)) scopeLost(cause);
      else if (versionChanged(cause)) { closeDetail(); setResult(undefined); setPhotos(undefined); setFailure({ key: requestKey, text: message(cause), conflict: true }); }
      else setDetail({ key: requestKey, agentId, error: message(cause) });
    });
  };
  const customers = (row: SupportBoardRow) => { if (enabled && privateRead && row.canViewCustomers) router.push(`/service/overview?agentId=${encodeURIComponent(row.id)}`); };
  const withPhoto = (row: SupportBoardRow): SupportBoardRow => ({ ...row, avatarUrl: photos?.key === requestKey ? photos.urls[row.id] : undefined, canViewCustomers: row.canViewCustomers && privateRead });
  const visibleDetail = enabled && detail?.key === requestKey ? detail : undefined;
  const currentQuery: SupportBoardQuery = { board: query.board, currency: data?.currency ?? query.currency, month: data?.rankMonth ?? query.month ?? selectedMonth.current ?? options?.rankMonth ?? "", scope: scopeValue(query.scope, query.groupId) };
  const scopeLabels = { all: "全员榜", ownGroup: "本组榜", managedGroups: "负责组榜" };
  const detailRow = visibleDetail?.data?.row;
  const board = query.board, ready = !!data;
  const denied = !allowed || deniedIdentity === identity;
  const reload = () => { if (allowed) { setDeniedIdentity(undefined); resetFirstPage("正在重新加载…"); } };
  /** 读取失败后的重试：按现在已应用的查询和页码再读一次；只有榜单版本已更新（409）才回第一页重读（ST-35、BUG-650）。 */
  const retry = () => { if (!allowed) return; if (conflict) reload(); else { setNotice(undefined); setRefresh(value => value + 1); } };
  const readFailed = !data && !denied && !!error;
  const rows = data?.rows.map(withPhoto) ?? [];
  const selfRow = data?.self.row ? withPhoto(data.self.row) : undefined;
  const podiumRows = data?.podium?.rows.map(withPhoto) ?? [];
  const provisional = data?.state === "PROVISIONAL";
  const candidateReason = provisional ? data?.candidateCoverage !== "COMPLETE" ? "参榜资料还在汇总，暂不显示名次" : "成绩还在汇总，暂不显示名次" : undefined;
  const currency = nexGridBrandText(data?.currency ?? query.currency ?? "USDT");
  const unit = board === "netContribution" ? currency : "人";
  const places = amountPlaces([...rows, ...podiumRows, ...(selfRow ? [selfRow] : [])].map(row => row.amount.coverage === "unavailable" ? null : row.amount.value));
  const month = data?.referenceMonth ?? "—";
  const groupName = (id?: string) => options?.scopeOptions.flatMap(option => option.groups).find(group => group.id === id)?.name;
  const scopeText = query.groupId ? groupName(query.groupId) ?? "所选组" : query.scope === "ownGroup" ? `${scopeLabels.ownGroup}（${options?.scopeOptions.find(option => option.scope === "ownGroup")?.groups[0]?.name ?? "本组"}）` : scopeLabels[query.scope];
  const groupScope = query.scope !== "all";
  const managedOption = scopeStale ? undefined : options?.scopeOptions.find(option => option.scope === "managedGroups");
  const tabs = useTabIds();
  const rankingRef = useRef<HTMLDivElement>(null);
  const locate = () => { if (data) { const target = locateLeaderboardSelf(data, acceptedQuery(data, query)); if (target) { pendingLocate.current = { identity, query: JSON.stringify(target) }; setKeyword(""); closeDetail(); setNotice(query.keyword ? "已清除搜索，跳到你在完整榜单里的那一页。" : "已跳到你所在的那一页。"); setQuery(target); setRefresh(value => value + 1); } } };
  const viewAll = () => { if (data) { setKeyword(""); closeDetail(); setQuery({ ...acceptedQuery(data, query), keyword: undefined, pageNum: 1 }); setRefresh(value => value + 1); } rankingRef.current?.scrollIntoView({ block: "start", behavior: "auto" }); rankingRef.current?.focus({ preventScroll: true }); };
  const search = (event: React.FormEvent) => { event.preventDefault(); if (!enabled || keyword.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(keyword)) return; closeDetail(); setNotice(undefined); setQuery(current => ({ ...current, keyword: keyword.trim() || undefined, pageNum: 1, expectedVersion: undefined })); };
  const clearSearch = () => { setKeyword(""); setQuery(current => ({ ...current, keyword: undefined, pageNum: 1, expectedVersion: undefined })); };
  const gap = data?.self.gap ?? null;
  const gapText = gap === null ? "" : board === "netContribution" ? amountText(gap, places) : countText(gap) === "—" ? amountText(gap, 0) : countText(gap);
  const selfConfirmed = !!selfRow && selfRow.rankStatus === "confirmed" && selfRow.rank !== null;
  const rankRule = "名次按发布时的精确成绩从高到低排；成绩相同名次并列，下一名跳过（1、2、2、4）。差距是和紧挨着你、成绩更好的那一位相差多少。";
  const conclusion = !data
    ? denied ? <Conclusion state="unknown">业绩榜：这个账号看不到榜单</Conclusion>
      : error ? <Conclusion state="unknown">业绩榜：读取失败，这部分没有判断</Conclusion>
      : <Conclusion state="unknown">正在读取业绩榜…</Conclusion>
    : provisional ? <Conclusion state="unknown" hint="系统每 10 分钟发布一次，稍后点「刷新」读取新的一版。" explain={`${candidateReason}：参榜名单或${BOARD_LABEL[board]}还有数据没汇总完时，整榜都不给名次，也不评前三名。`}>{BOARD_LABEL[board]}：这一版还在汇总，暂不排名次</Conclusion>
    : selfConfirmed ? <Conclusion state="neutral" lead explain={rankRule} action={data.self.pageNum !== null ? <Button icon={<MapPin size={14} aria-hidden />} onClick={locate}>定位到我</Button> : undefined}>
        我排{selfRow.isTied ? "并列" : ""}第 <b>{selfRow.rank}</b> 名{data.self.reason === "LEADER" || selfRow.rank === 1 ? "，是这一榜的第 1 名" : gapText ? `，离前一名差 ${gapText} ${unit}` : ""}
      </Conclusion>
    : <Conclusion state="neutral" explain={`你不在这一版榜单里：${data.self.reason || "当前账号未参榜"}。参榜要有客服资格，兼任客服的主管也算；看的是别的组、或这个月没有客服资格时不在榜上。`}
        hint={managedOption && query.scope === "all" ? "要看你负责的组，在「范围」里选负责组榜。" : undefined}
        action={managedOption && query.scope === "all" ? <Button onClick={() => changeQuery({ ...currentQuery, scope: "managedGroups" })}>看我负责的组</Button> : undefined}>
        {data.total === 0 ? `${scopeText}：暂无参榜客服` : `${scopeText}：${data.total} 人参榜`}；你不在这一版里（{data.self.reason || "当前账号未参榜"}）
      </Conclusion>;
  const scopeSelect = scopeStale ? [] : options?.scopeOptions ?? [];
  const missingAmounts = board === "netContribution" ? rows.filter(row => row.amount.coverage === "unavailable").length : 0;
  const pages = data ? Math.max(1, Math.ceil(data.matched / data.pageSize)) : 1;
  const emptyText = !data ? undefined : query.keyword
    ? <span className="m6-empty">{provisional ? "参榜资料还在汇总，" : ""}没有匹配「{query.keyword}」的客服。按姓名或完整的客服账号编号查找。<button type="button" className="rd-link" onClick={clearSearch}>清除搜索</button></span>
    : provisional ? "参榜资料还在汇总，暂无法显示完整榜单。请稍后重试。" : "当前范围暂无参榜客服。";
  const detailName = visibleDetail ? detailRow?.name ?? [...rows, ...podiumRows, ...(selfRow ? [selfRow] : [])].find(row => row.id === visibleDetail.agentId)?.name : undefined;
  return <RdPage className="m6-page">
    <div ref={containerRef} className="m6-body">
      <PageHeader pageId="M6" title="业绩榜" summary="看客服团队这个月谁做得好、我排第几。"
        actions={<Button icon={<RefreshCw size={14} aria-hidden />} disabled={!allowed} onClick={reload}>刷新</Button>}
        meta={data ? `数据截至 ${asOf(data)} · 每 10 分钟发布一次` : undefined} />
      <PageTabs label="榜单" ids={tabs} value={board} onChange={(next: SupportBoardKey) => changeQuery({ ...currentQuery, board: next })}
        items={(["netContribution", "firstPayment", "customers"] as const).map(key => ({ value: key, label: BOARD_LABEL[key], disabled: !options && !readFailed && key !== board }))} />
      <div {...tabs.panel(board)} className="m6-board">
        <FilterBar sort={<span className="m6-board-line">{BOARD_DEFINITION[board].line}<Explain label={`${BOARD_LABEL[board]}怎么算`} rows={[...BOARD_DEFINITION[board].rows, { k: "范围", v: "只列出这个账号现在能看的范围：全员榜、本组榜、负责组榜和负责的单个组。" }, { k: "发布", v: "系统每 10 分钟发布一次新的一版；刷新只读取最新发布的那一版，不会马上重算。" }]} /></span>}>
          <FilterField label="月份">{board === "customers"
            ? <Select aria-label="月份" disabled value="now" onChange={() => undefined} options={[{ value: "now", label: "不分月份" }]} />
            : <Select aria-label="月份" disabled={!options?.selectableMonths.length} value={options ? currentQuery.month : ""} onChange={value => changeQuery({ ...currentQuery, month: value })} options={(options?.selectableMonths ?? []).map(value => ({ value, label: value }))} placeholder="读取后可选" />}</FilterField>
          <FilterField label="币种"><Select aria-label="币种" disabled={!options?.currencies.length} value={options ? currentQuery.currency ?? "" : ""} onChange={value => changeQuery({ ...currentQuery, currency: value })} options={(options?.currencies ?? []).map(value => ({ value, label: nexGridBrandText(value) }))} placeholder="读取后可选" /></FilterField>
          <FilterField label="范围"><Select aria-label="范围" disabled={!scopeSelect.length} value={options && !scopeStale ? currentQuery.scope : ""} onChange={value => changeQuery({ ...currentQuery, scope: value })} placeholder={scopeStale ? readFailed ? "范围没读到，先重试" : "正在重读范围" : "读取后可选"}
            groups={[{ label: "榜单范围", options: scopeSelect.map(option => ({ value: option.scope, label: option.scope === "ownGroup" ? `${scopeLabels.ownGroup}（${option.groups[0]?.name ?? "本组"}）` : option.scope === "managedGroups" ? `${scopeLabels.managedGroups}（全部负责组）` : scopeLabels[option.scope] })) },
              ...(managedOption ? [{ label: "负责的单个组", options: managedOption.groups.map(group => ({ value: scopeValue("managedGroups", group.id), label: group.name })) }] : [])]} /></FilterField>
        </FilterBar>
        {board === "netContribution" && groupScope && <Notice tone="done">组榜按贡献发生时所在的组统计：调组后历史贡献仍算在原来的组，所以榜上可能有现在已经不在这个组的客服。</Notice>}
        {conflict ? <Notice tone="warn">榜单已更新，请刷新后重试。</Notice>
          : notice && !(ready && notice === "正在重新加载…") && <Notice tone={notice.startsWith("已") ? "ok" : "progress"}>{notice}</Notice>}
        {data?.stale && <Notice tone="warn" title="当前显示上次发布的榜单" action={<Button size="sm" onClick={() => resetFirstPage("正在重新加载…")}>重新加载</Button>}>{data.refreshFailed ? "榜单更新暂未成功，请稍后读取最新结果。" : "榜单更新延迟，请稍后读取最新结果。"}</Notice>}
        {conclusion}
        {!data && denied ? <BlockState state="denied" title="这个账号不能查看业绩榜"
            detail="请重新确认登录和客服权限；看榜要有客服工作台或专属会话的查看权限，并且是专属客服、客服主管或超级管理员。"
            onRetry={allowed ? reload : undefined} retryLabel="重新核验" />
          : <>
            {!readFailed && <Podium board={board} rows={podiumRows} total={data?.podium?.total ?? 0} unit={unit} places={places} onOpen={openDetail} onViewAll={viewAll}
              status={!data ? { kind: "loading" } : provisional ? { kind: "provisional", reason: candidateReason ?? "" } : { kind: "ready" }} />}
            {missingAmounts > 0 && <Notice tone="done">{missingAmounts} 位客服的净贡献额缺少资金数据，表里写「—」和原因，不是 0。</Notice>}
            <div ref={rankingRef} tabIndex={-1} className="m6-ranking-anchor">
              <RankingPanel sub={data && data.candidateCoverage === "COMPLETE" ? query.keyword ? `匹配 ${data.matched} 人` : `共 ${data.total} 人` : undefined}
                search={<form className="m6-search" role="search" onSubmit={search}>
                  <Input aria-label="查找客服" data-search="" placeholder="姓名或完整客服账号编号" value={keyword} maxLength={200} disabled={!enabled} onChange={event => setKeyword(event.target.value)} />
                  <Button type="submit" disabled={!enabled}>搜索</Button>
                  {!!query.keyword && <Button variant="ghost" onClick={clearSearch}>清除搜索</Button>}
                </form>}>
                {/* 读取失败时查询控件（月份、币种、范围、搜索）照常留着，失败只在榜单这一块写（ST-15、ST-34）。 */}
                {readFailed ? <BlockState state="error" title="榜单加载失败" detail={error} onRetry={allowed ? retry : undefined} retryLabel="重试" />
                  : <RankingTable board={board} currency={currency} month={month} places={places} privateRead={privateRead} onOpen={openDetail}
                  onCustomers={agentId => { const row = [...(data?.rows ?? []), ...(data?.podium?.rows ?? [])].find(row => row.id === agentId); if (row) customers(row); }}
                  state={data ? { kind: "ready", rows, selfId: selfRow?.id, empty: emptyText } : { kind: "loading" }} />}
                {data && data.matched > 0 && <BoardPager page={data.pageNum} pages={pages} total={data.candidateCoverage === "COMPLETE" ? data.matched : undefined} pageSize={data.pageSize}
                  onPageSize={pageSize => { if ([5, 10, 20].includes(pageSize)) { closeDetail(); setQuery({ ...acceptedQuery(data, query), pageNum: 1, pageSize }); } }}
                  onPage={pageNum => { if (pageNum >= 1 && pageNum <= Math.ceil(data.matched / data.pageSize)) { closeDetail(); setQuery({ ...acceptedQuery(data, query), pageNum }); } }} />}
              </RankingPanel>
            </div>
          </>}
      </div>
      {visibleDetail && <Modal title={`${detailName ?? "客服"}的公开成绩`} sub={<StatusTag tone="neutral" icon={ListOrdered}>{BOARD_LABEL[board]}榜</StatusTag>} icon={UserRound} onClose={closeDetail}
        footer={<>
          <Button onClick={closeDetail}>关闭</Button>
          {visibleDetail.error && <Button onClick={() => openDetail(visibleDetail.agentId)}>重试</Button>}
          {detailRow && privateRead && detailRow.canViewCustomers && <Button variant="primary" onClick={() => customers(detailRow)}>查看当前绑定客户</Button>}
        </>}>
        {!visibleDetail.data ? <Notice tone={visibleDetail.error ? "danger" : "progress"}>{visibleDetail.error ?? "正在读取成绩…"}</Notice>
          : detailRow && <PerformanceBody row={withPhoto(detailRow)} board={board} month={visibleDetail.data.referenceMonth} places={amountPlaces([detailRow.amount.value])} asOf={asOf(visibleDetail.data)}
            stale={visibleDetail.data.stale} refreshFailed={visibleDetail.data.refreshFailed} privateRead={privateRead} />}
      </Modal>}
    </div>
  </RdPage>;
}
