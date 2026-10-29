"use client";

import { businessZone } from "@/lib/admin/business-time";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { fetchLeaderboardAvatar, locateLeaderboardSelf, supportLeaderboardClient, type LeaderboardDetail, type LeaderboardPage, type LeaderboardQuery } from "@/lib/admin/support-leaderboard-client";
import { Btn, Modal } from "../design-kit";
import { NumberValue, SupportLeaderboard, type SupportBoardQuery, type SupportBoardRow } from "./support-leaderboard";
import "./m6-leaderboard.css";

function status(error: unknown): number | undefined { return error && typeof error === "object" && "status" in error ? Number(error.status) : undefined; }
function message(error: unknown): string {
  return status(error) === 403 || status(error) === 401 ? "当前账号不能查看此榜单，请重新确认登录和客服权限。"
    : status(error) === 409 ? "榜单版本或可见范围已变化，请从第一页重新加载。"
    : "榜单加载失败，请重试。";
}
function scopeValue(scope: string, groupId?: string) { return groupId ? `${scope}:${groupId}` : scope; }
function asOf(data: LeaderboardPage | LeaderboardDetail) { return new Intl.DateTimeFormat("zh-CN", { timeZone: businessZone().zoneId, dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(data.asOf)) + `（${businessZone().label}）`; }
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
  const [refresh, setRefresh] = useState(0), [error, setError] = useState<string>(), [notice, setNotice] = useState<string>();
  const [deniedIdentity, setDeniedIdentity] = useState<string>();
  const enabled = allowed && deniedIdentity !== identity;
  const requestKey = identity + "|" + JSON.stringify(query) + "|" + refresh;
  const liveKey = useRef(requestKey); liveKey.current = enabled ? requestKey : "";
  const [result, setResult] = useState<{ key: string; data: LeaderboardPage }>();
  const data = enabled && result?.key === requestKey ? result.data : undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const pendingLocate = useRef<{ identity: string; query: string } | undefined>(undefined);
  const [photos, setPhotos] = useState<{ key: string; urls: Record<string, string> }>();
  const [detail, setDetail] = useState<{ key: string; agentId: string; data?: LeaderboardDetail; error?: string }>();
  const detailAbort = useRef<AbortController | null>(null), detailSequence = useRef(0);
  const closeDetail = () => { detailSequence.current++; detailAbort.current?.abort(); detailAbort.current = null; setDetail(undefined); };
  const resetFirstPage = (text: string) => { setResult(undefined); setPhotos(undefined); closeDetail(); setNotice(text); setQuery(current => ({ ...current, pageNum: 1, expectedVersion: undefined })); setRefresh(value => value + 1); };
  const deny = () => { setDeniedIdentity(identity); setResult(undefined); setPhotos(undefined); closeDetail(); setError("当前账号不能查看此榜单，请重新确认登录和客服权限。"); };

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
    setResult(undefined); setError(undefined); setNotice(undefined); setPhotos(undefined); closeDetail(); setKeyword("");
    selectedMonth.current = undefined;
    setQuery({ board: "netContribution", currency: "USDT", scope: "all", pageNum: 1, pageSize: 5 });
    return () => { detailSequence.current++; detailAbort.current?.abort(); };
    // The key includes account, permissions, explicit menus and logout state.
  }, [identity]);

  useEffect(() => {
    const controller = new AbortController(); let active = true;
    setResult(undefined); setError(undefined); closeDetail();
    if (enabled) void supportLeaderboardClient.page(query, controller.signal).then(next => {
      if (next.self.row && next.self.row.id !== String(session?.adminId)) throw new Error("本人成绩身份不一致");
      if (active && !controller.signal.aborted && liveKey.current === requestKey) setResult({ key: requestKey, data: next });
    }).catch(cause => {
      if (!active || controller.signal.aborted || liveKey.current !== requestKey) return;
      if (status(cause) === 403 || status(cause) === 401) deny();
      else { setResult(undefined); setError(message(cause)); if (status(cause) === 409) setNotice("榜单已更新，请刷新后重试。"); }
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
        else if (status(cause) === 409) { controller.abort(); setResult(undefined); setPhotos(undefined); closeDetail(); setError(message(cause)); setNotice("榜单已更新，请刷新后重试。"); }
      });
    }
    return () => { active = false; controller.abort(); for (const url of Object.values(urls)) URL.revokeObjectURL(url); };
  }, [data, requestKey]);

  const changeQuery = (next: SupportBoardQuery) => {
    if (!data) return;
    const [scope, groupId] = next.scope.split(":");
    if (!data.scopeOptions.some(option => option.scope === scope && (!groupId || option.groups.some(group => group.id === groupId)))
      || !data.currencies.includes(next.currency as "USDT" | "UVT") || next.board !== "customers" && next.month && !data.selectableMonths.includes(next.month)) return;
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
      else if (status(cause) === 409) { closeDetail(); setResult(undefined); setPhotos(undefined); setError(message(cause)); setNotice("榜单已更新，请刷新后重试。"); }
      else setDetail({ key: requestKey, agentId, error: "成绩加载失败，请重试。" });
    });
  };
  const customers = (row: SupportBoardRow) => { if (enabled && privateRead && row.canViewCustomers) router.push(`/service/overview?agentId=${encodeURIComponent(row.id)}`); };
  const withPhoto = (row: SupportBoardRow): SupportBoardRow => ({ ...row, avatarUrl: photos?.key === requestKey ? photos.urls[row.id] : undefined, canViewCustomers: row.canViewCustomers && privateRead });
  const visibleDetail = enabled && detail?.key === requestKey ? detail : undefined;
  const period = data?.rankMonth ?? data?.referenceMonth ?? query.month ?? "统计期未确定";
  const currentQuery: SupportBoardQuery = { board: query.board, currency: data?.currency ?? query.currency, month: data?.rankMonth ?? query.month ?? selectedMonth.current ?? "", scope: scopeValue(query.scope, query.groupId) };
  const scopeLabels = { all: "全员榜", ownGroup: "本组榜", managedGroups: "负责组榜" };
  const detailRow = visibleDetail?.data?.row;
  return <div className="m6-public-leaderboard" ref={containerRef}>
    <SupportLeaderboard query={currentQuery} onQueryChange={changeQuery}
      search={<form className="m6-leaderboard-search" onSubmit={event => { event.preventDefault(); if (!enabled || keyword.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(keyword)) return; closeDetail(); setNotice(undefined); setQuery(current => ({ ...current, keyword: keyword.trim() || undefined, pageNum: 1, expectedVersion: undefined })); }}>
      <label htmlFor="m6-leaderboard-keyword">查找客服</label><input id="m6-leaderboard-keyword" className="fld" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={200} placeholder="客服姓名" disabled={!enabled} /><Btn disabled={!enabled} type="submit">搜索</Btn>
      {!!query.keyword && <Btn type="button" onClick={() => { setKeyword(""); setQuery(current => ({ ...current, keyword: undefined, pageNum: 1, expectedVersion: undefined })); }}>清除搜索</Btn>}
    </form>}
      notice={<>{notice && <p className="m6-leaderboard-notice" role="status">{notice}</p>}
    {data?.stale && <p className="m6-leaderboard-notice" role="status">当前显示上次发布的榜单。{data.refreshFailed ? "榜单更新暂未成功，请稍后读取最新结果。" : "榜单更新延迟，请稍后读取最新结果。"}<Btn onClick={() => resetFirstPage("正在重新加载…")}>重新加载</Btn></p>}
    {data && data.rows.length === 0 && <p className="m6-leaderboard-notice" role="status">{data.state === "PROVISIONAL"
      ? query.keyword ? "参榜资料还在汇总，暂未找到匹配的客服。请稍后重试。" : "参榜资料还在汇总，暂无法显示完整榜单。请稍后重试。"
      : query.keyword ? "没有匹配的客服；本人定位会清除搜索条件。" : "当前范围暂无参榜客服。"}</p>}</>}
      monthOptions={(data?.selectableMonths ?? []).map(value => ({ value, label: nexGridBrandText(value).replace("-", ".") }))}
      currencyOptions={(data?.currencies ?? []).map(value => ({ value, label: nexGridBrandText(value) }))}
      scopeOptions={(data?.scopeOptions ?? []).flatMap(option => [{ value: option.scope, label: scopeLabels[option.scope] }, ...(option.scope === "managedGroups" ? option.groups.map(group => ({ value: scopeValue(option.scope, group.id), label: group.name })) : [])])}
      rows={data?.rows.map(withPhoto) ?? []} self={data?.self.row ? { row: withPhoto(data.self.row), gap: data.self.gap, reason: data.self.reason } : undefined}
      selfUnavailableReason={data?.self.reason}
      podium={data?.podium ? { total: data.podium.total, rows: data.podium.rows.map(withPhoto) } : undefined}
      currentMonth={data?.referenceMonth ?? ""} periodLabel={period} updatedAt={data ? asOf(data) : "加载中"}
      disclosure="榜单每10分钟更新；重新加载只读取最新已完成结果。业绩额按净贡献统计：充值与余额消费不重复计算；成功提现及后台退款仅冲减已计贡献部分，收益提现不冲减原业绩。客户明细按权限查看。"
      candidateReason={data?.state === "PROVISIONAL" ? data.candidateCoverage !== "COMPLETE" ? "参榜资料还在汇总，暂不显示名次" : "成绩还在汇总，暂不显示名次" : undefined}
      status={data ? "ready" : !enabled || error ? "error" : "loading"} statusMessage={!enabled ? "当前账号不能查看此榜单，请确认登录和客服权限。" : error}
      onRetry={() => { if (allowed) { setDeniedIdentity(undefined); resetFirstPage("正在重新加载…"); } }}
      onLocateSelf={() => { if (data) { const target = locateLeaderboardSelf(data, acceptedQuery(data, query)); if (target) { pendingLocate.current = { identity, query: JSON.stringify(target) }; setKeyword(""); closeDetail(); setNotice("已清除搜索，按完整榜单定位本人。"); setQuery(target); setRefresh(value => value + 1); } } }}
      onViewPerformance={openDetail} onViewCustomers={agentId => { const row = [...(data?.rows ?? []), ...(data?.podium?.rows ?? [])].find(row => row.id === agentId); if (row) customers(row); }}
      onViewAllRankings={() => { if (data) { setKeyword(""); closeDetail(); setQuery({ ...acceptedQuery(data, query), keyword: undefined, pageNum: 1 }); setRefresh(value => value + 1); } }}
      page={data ? { current: data.pageNum, total: Math.max(1, Math.ceil(data.matched / data.pageSize)), totalEntries: data.candidateCoverage === "COMPLETE" ? data.matched : undefined, pageSize: data.pageSize,
        onPageSizeChange: pageSize => { if ([5, 10, 20].includes(pageSize)) { closeDetail(); setQuery({ ...acceptedQuery(data, query), pageNum: 1, pageSize }); } },
        onChange: pageNum => { if (pageNum >= 1 && pageNum <= Math.ceil(data.matched / data.pageSize)) { closeDetail(); setQuery({ ...acceptedQuery(data, query), pageNum }); } } } : undefined} />
    {visibleDetail && <Modal title={detailRow ? `${detailRow.name}的公开成绩` : "公开成绩"} onClose={closeDetail} footer={<><Btn onClick={closeDetail}>关闭</Btn>{visibleDetail.error && <Btn onClick={() => openDetail(visibleDetail.agentId)}>重试</Btn>}{detailRow && privateRead && detailRow.canViewCustomers && <Btn onClick={() => customers(detailRow)}>查看授权客户明细</Btn>}</>}>
      {!visibleDetail.data ? <p role={visibleDetail.error ? "alert" : "status"}>{visibleDetail.error ?? "正在加载…"}</p> : detailRow && <div className="m6-leaderboard-summary">
        <p>{detailRow.groupName || "待分组"} · {detailRow.rankStatus === "confirmed" ? `${detailRow.isTied ? "并列第" : "第"}${detailRow.rank}名` : "名次未确定"}</p>
        <dl><dt>业绩额 · {detailRow.amount.periodLabel} · {nexGridBrandText(detailRow.amount.currency)}</dt><dd><NumberValue value={detailRow.amount.coverage === "unavailable" ? null : detailRow.amount.value} kind="amount" label={`${detailRow.name}业绩额`} unit={nexGridBrandText(detailRow.amount.currency)} /></dd><dt>首充人数 · {period} · 人</dt><dd><NumberValue value={detailRow.firstPayment.coverage === "unavailable" ? null : detailRow.firstPayment.value} kind="count" label={`${detailRow.name}首充人数`} unit="人" /></dd><dt>绑定客户数 · 截至现在 · 人</dt><dd><NumberValue value={detailRow.customers.coverage === "unavailable" ? null : detailRow.customers.value} kind="count" label={`${detailRow.name}绑定客户数`} unit="人" /></dd></dl>
        {[...new Set([detailRow.amount.reason, detailRow.firstPayment.reason, detailRow.customers.reason].filter(Boolean))].map(reason => <p key={reason} role="status">{reason}</p>)}
        <p>数据截至 {asOf(visibleDetail.data)}{visibleDetail.data.stale ? "；显示上次发布结果" : ""}{visibleDetail.data.refreshFailed ? "；榜单更新暂未成功，请稍后读取最新结果" : ""}</p>
        {(!privateRead || !detailRow.canViewCustomers) && <p>暂无这位客服的客户明细查看权限。</p>}
      </div>}
    </Modal>}
  </div>;
}
