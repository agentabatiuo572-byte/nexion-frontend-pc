"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { fetchLeaderboardAvatar, locateLeaderboardSelf, supportLeaderboardClient, type LeaderboardDetail, type LeaderboardPage, type LeaderboardQuery } from "@/lib/admin/support-leaderboard-client";
import { Btn, Modal } from "../design-kit";
import { SupportLeaderboard, type SupportBoardQuery, type SupportBoardRow } from "./support-leaderboard";
import "./m6-leaderboard.css";

function status(error: unknown): number | undefined { return error && typeof error === "object" && "status" in error ? Number(error.status) : undefined; }
function message(error: unknown): string {
  return status(error) === 403 || status(error) === 401 ? "当前账号不能查看此榜单，请重新确认登录和客服权限。"
    : status(error) === 409 ? "榜单版本或可见范围已变化，请重新读取第一页。"
    : "榜单暂时无法读取，请重试。";
}
function scopeValue(scope: string, groupId?: string) { return groupId ? `${scope}:${groupId}` : scope; }
function asOf(data: LeaderboardPage | LeaderboardDetail) { return new Intl.DateTimeFormat("zh-CN", { timeZone: data.businessZone, dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(data.asOf)) + "（北京时间）"; }
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
  const [query, setQuery] = useState<LeaderboardQuery>({ board: "firstPayment", currency: "USDT", scope: "all", pageNum: 1, pageSize: 20 });
  const [keyword, setKeyword] = useState("");
  const [refresh, setRefresh] = useState(0), [error, setError] = useState<string>(), [notice, setNotice] = useState<string>();
  const [deniedIdentity, setDeniedIdentity] = useState<string>();
  const enabled = allowed && deniedIdentity !== identity;
  const requestKey = identity + "|" + JSON.stringify(query) + "|" + refresh;
  const liveKey = useRef(requestKey); liveKey.current = enabled ? requestKey : "";
  const [result, setResult] = useState<{ key: string; data: LeaderboardPage }>();
  const data = enabled && result?.key === requestKey ? result.data : undefined;
  const [photos, setPhotos] = useState<{ key: string; urls: Record<string, string> }>();
  const [detail, setDetail] = useState<{ key: string; agentId: string; data?: LeaderboardDetail; error?: string }>();
  const detailAbort = useRef<AbortController | null>(null), detailSequence = useRef(0);
  const closeDetail = () => { detailSequence.current++; detailAbort.current?.abort(); detailAbort.current = null; setDetail(undefined); };
  const resetFirstPage = (text: string) => { setResult(undefined); setPhotos(undefined); closeDetail(); setNotice(text); setQuery(current => ({ ...current, pageNum: 1, expectedVersion: undefined })); setRefresh(value => value + 1); };
  const deny = () => { setDeniedIdentity(identity); setResult(undefined); setPhotos(undefined); closeDetail(); setError("当前账号不能查看此榜单，请重新确认登录和客服权限。"); };

  useEffect(() => {
    setResult(undefined); setError(undefined); setNotice(undefined); setPhotos(undefined); closeDetail(); setKeyword("");
    setQuery({ board: "firstPayment", currency: "USDT", scope: "all", pageNum: 1, pageSize: 20 });
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
      else { setResult(undefined); setError(message(cause)); if (status(cause) === 409) setNotice("榜单已变化，点击重读第一页以接收新版本。"); }
    });
    return () => { active = false; controller.abort(); };
  }, [enabled, requestKey]);

  useEffect(() => {
    const controller = new AbortController(), urls: Record<string, string> = {}; let active = true;
    setPhotos(undefined);
    if (data) {
      const rows = new Map([...data.rows, ...(data.self.row ? [data.self.row] : [])].map(row => [row.id, row]));
      const q = acceptedQuery(data, query);
      for (const row of rows.values()) if (row.avatarUrl) void fetchLeaderboardAvatar(row.avatarUrl, row.id, q, data.viewVersion, controller.signal).then(blob => {
        if (!active || controller.signal.aborted || liveKey.current !== requestKey) return;
        urls[row.id] = URL.createObjectURL(blob); setPhotos({ key: requestKey, urls: { ...urls } });
      }).catch(cause => {
        if (!active || controller.signal.aborted || liveKey.current !== requestKey) return;
        if (status(cause) === 403 || status(cause) === 401) { controller.abort(); deny(); }
        else if (status(cause) === 409) { controller.abort(); setResult(undefined); setPhotos(undefined); closeDetail(); setError(message(cause)); setNotice("头像对应的榜单版本已变化，请重读第一页。"); }
      });
    }
    return () => { active = false; controller.abort(); for (const url of Object.values(urls)) URL.revokeObjectURL(url); };
  }, [data, requestKey]);

  const changeQuery = (next: SupportBoardQuery) => {
    if (!data) return;
    const [scope, groupId] = next.scope.split(":");
    if (!data.scopeOptions.some(option => option.scope === scope && (!groupId || option.groups.some(group => group.id === groupId)))
      || !data.currencies.includes(next.currency as "USDT" | "NEX") || next.board !== "customers" && next.month && !data.selectableMonths.includes(next.month)) return;
    closeDetail(); setNotice(undefined);
    setQuery({ board: next.board, currency: next.currency as "USDT" | "NEX", scope: scope as LeaderboardQuery["scope"], groupId, month: next.board === "customers" ? undefined : next.month || undefined, keyword: query.keyword, pageNum: 1, pageSize: query.pageSize });
  };
  const openDetail = (agentId: string) => {
    if (!data || !enabled || ![...data.rows, ...(data.self.row ? [data.self.row] : [])].some(row => row.id === agentId)) return;
    detailAbort.current?.abort(); const controller = new AbortController(); detailAbort.current = controller;
    const sequence = ++detailSequence.current; setDetail({ key: requestKey, agentId });
    void supportLeaderboardClient.detail(agentId, acceptedQuery(data, query), controller.signal).then(next => {
      if (next.sourceVersion !== data.sourceVersion || next.definitionVersion !== data.definitionVersion || next.asOf !== data.asOf || next.referenceMonth !== data.referenceMonth || next.state !== data.state || next.candidateCoverage !== data.candidateCoverage) throw new Error("公开成绩版本信息不一致");
      if (!controller.signal.aborted && sequence === detailSequence.current && liveKey.current === requestKey) setDetail({ key: requestKey, agentId, data: next });
    }).catch(cause => {
      if (controller.signal.aborted || sequence !== detailSequence.current || liveKey.current !== requestKey) return;
      if (status(cause) === 403 || status(cause) === 401) deny();
      else if (status(cause) === 409) { closeDetail(); setResult(undefined); setPhotos(undefined); setError(message(cause)); setNotice("榜单已变化，请重读第一页。"); }
      else setDetail({ key: requestKey, agentId, error: "公开成绩暂时无法读取，请重试。" });
    });
  };
  const customers = (row: SupportBoardRow) => { if (enabled && privateRead && row.canViewCustomers) router.push(`/service/overview?agentId=${encodeURIComponent(row.id)}`); };
  const withPhoto = (row: SupportBoardRow): SupportBoardRow => ({ ...row, avatarUrl: photos?.key === requestKey ? photos.urls[row.id] : undefined, canViewCustomers: row.canViewCustomers && privateRead });
  const visibleDetail = enabled && detail?.key === requestKey ? detail : undefined;
  const period = data?.rankMonth ?? data?.referenceMonth ?? query.month ?? "统计期待核实";
  const currentQuery: SupportBoardQuery = { board: query.board, currency: data?.currency ?? query.currency, month: data?.rankMonth ?? query.month ?? "", scope: scopeValue(query.scope, query.groupId) };
  const scopeLabels = { all: "全员榜", ownGroup: "本组榜", managedGroups: "负责组榜" };
  const detailRow = visibleDetail?.data?.row;
  return <div className="m6-public-leaderboard">
    <form className="m6-leaderboard-search" onSubmit={event => { event.preventDefault(); if (!enabled || keyword.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(keyword)) return; closeDetail(); setNotice(undefined); setQuery(current => ({ ...current, keyword: keyword.trim() || undefined, pageNum: 1, expectedVersion: undefined })); }}>
      <label htmlFor="m6-leaderboard-keyword">查找客服</label><input id="m6-leaderboard-keyword" className="fld" value={keyword} onChange={event => setKeyword(event.target.value)} maxLength={200} placeholder="客服姓名" disabled={!enabled} /><Btn disabled={!enabled} type="submit">搜索</Btn>
      {!!query.keyword && <Btn type="button" onClick={() => { setKeyword(""); setQuery(current => ({ ...current, keyword: undefined, pageNum: 1, expectedVersion: undefined })); }}>清除搜索</Btn>}
    </form>
    {notice && <p className="m6-leaderboard-notice" role="status">{notice}</p>}
    {data?.stale && <p className="m6-leaderboard-notice" role="status">当前显示上次发布的榜单。{data.refreshFailed ? "本次来源刷新失败，数据截至时间保留原值。" : "数据已超过刷新间隔。"}<Btn onClick={() => resetFirstPage("正在重新读取第一页…")}>重新读取</Btn></p>}
    {data && data.rows.length === 0 && <p className="m6-leaderboard-notice" role="status">{data.state === "PROVISIONAL"
      ? query.keyword ? "已核实范围暂无匹配；参榜资料尚未完整，不能认定没有客服或业绩。" : "参榜资料尚未完整，暂不能显示榜单；这不代表客服或业绩为零。"
      : query.keyword ? "没有匹配的客服；本人定位会清除搜索条件。" : "当前范围暂无参榜客服。"}</p>}
    <SupportLeaderboard query={currentQuery} onQueryChange={changeQuery}
      monthOptions={(data?.selectableMonths ?? []).map(value => ({ value, label: value.replace("-", ".") }))}
      currencyOptions={(data?.currencies ?? []).map(value => ({ value, label: value }))}
      scopeOptions={(data?.scopeOptions ?? []).flatMap(option => [{ value: option.scope, label: scopeLabels[option.scope] }, ...(option.scope === "managedGroups" ? option.groups.map(group => ({ value: scopeValue(option.scope, group.id), label: group.name })) : [])])}
      rows={data?.rows.map(withPhoto) ?? []} self={data?.self.row ? { row: withPhoto(data.self.row), gap: data.self.gap, reason: data.self.reason } : undefined}
      currentMonth={data?.referenceMonth ?? ""} periodLabel={period} updatedAt={data ? asOf(data) : "尚未读取"}
      disclosure="名次以服务器完整发布结果为准；并列保留同一名次。客户明细需另有可见权限。"
      candidateReason={data?.state === "PROVISIONAL" ? data.candidateCoverage !== "COMPLETE" ? "参榜人员尚未完整核实，当前不授予名次" : "主指标尚未完整核实，当前不授予名次" : undefined}
      status={data ? "ready" : !enabled || error ? "error" : "loading"} statusMessage={!enabled ? "当前账号不能查看此榜单，请确认登录和客服权限。" : error}
      onRetry={() => { if (allowed) { setDeniedIdentity(undefined); resetFirstPage("正在重新读取第一页…"); } }}
      onLocateSelf={() => { if (data) { const target = locateLeaderboardSelf(data, acceptedQuery(data, query)); if (target) { setKeyword(""); closeDetail(); setNotice("已清除搜索，按完整榜单定位本人。"); setQuery(target); setRefresh(value => value + 1); } } }}
      onViewPerformance={openDetail} onViewCustomers={agentId => { const row = data?.rows.find(row => row.id === agentId); if (row) customers(row); }}
      page={data ? { current: data.pageNum, total: Math.max(1, Math.ceil(data.matched / data.pageSize)), onChange: pageNum => { if (pageNum >= 1 && pageNum <= Math.ceil(data.matched / data.pageSize)) { closeDetail(); setQuery({ ...acceptedQuery(data, query), pageNum }); } } } : undefined} />
    {visibleDetail && <Modal title={detailRow ? `${detailRow.name}的公开成绩` : "公开成绩"} onClose={closeDetail} footer={<><Btn onClick={closeDetail}>关闭</Btn>{visibleDetail.error && <Btn onClick={() => openDetail(visibleDetail.agentId)}>重试</Btn>}{detailRow && privateRead && detailRow.canViewCustomers && <Btn onClick={() => customers(detailRow)}>查看授权客户明细</Btn>}</>}>
      {!visibleDetail.data ? <p role={visibleDetail.error ? "alert" : "status"}>{visibleDetail.error ?? "正在读取公开成绩…"}</p> : detailRow && <div className="m6-leaderboard-summary">
        <p>{detailRow.groupName || "待分组"} · {detailRow.rankStatus === "confirmed" ? `${detailRow.isTied ? "并列第" : "第"}${detailRow.rank}名` : "名次待核实"}</p>
        <dl><dt>业绩额 · {detailRow.amount.periodLabel} · {detailRow.amount.currency}</dt><dd>{detailRow.amount.value ?? "待核实"} · {detailRow.amount.reason}</dd><dt>首充人数 · {period}</dt><dd>{detailRow.firstPayment.value ?? "待核实"} 人 · {detailRow.firstPayment.reason}</dd><dt>绑定客户数 · 截至现在</dt><dd>{detailRow.customers.value ?? "待核实"} 人 · {detailRow.customers.reason}</dd></dl>
        <p>数据截至 {asOf(visibleDetail.data)}{visibleDetail.data.stale ? "；显示上次发布结果" : ""}{visibleDetail.data.refreshFailed ? "；本次来源刷新失败" : ""}</p>
        {(!privateRead || !detailRow.canViewCustomers) && <p>当前账号不能查看这位客服的客户明细；公开成绩不授予客户资料权限。</p>}
      </div>}
    </Modal>}
  </div>;
}
