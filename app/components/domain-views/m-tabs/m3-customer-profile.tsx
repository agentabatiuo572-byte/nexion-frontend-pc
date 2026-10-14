"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportEnhancements, type SupportProfile, type SupportGroup, type SupportFinanceFieldStatus } from "@/lib/admin/m-support-enhancements";
import { supportClient, SupportClientError, type SupportMaintenanceHistory } from "@/lib/admin/m-support-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Icon, Modal } from "../design-kit";
import { HDSelect } from "./hd-ui";
import type { SupportCustomerStatistics } from "@/lib/admin/support-analytics-client";
import type { MCtx } from "./types";
import type { SessionConvo, SupportTicket } from "./data";
import { SupportAvatar, customerAvatarPath, advisorAvatarPath } from "./support-avatar";
import { compactSupportBoardValue } from "./support-leaderboard";
import "./m3-customer-profile.css";

const statusText = { READY: "已读取", UNKNOWN: "未知", FORBIDDEN: "无权限", ERROR: "读取失败" };
const asRows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(v => v && typeof v === "object") : [];
const show = (value: unknown): string => value == null || value === "" ? "未知" : typeof value === "boolean" ? value ? "是" : "否" : typeof value === "string" || typeof value === "number" ? String(value) : "待核对";
const dates = (value: unknown) => typeof value === "string" && !Number.isNaN(Date.parse(value)) ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未知";
const labelState = (value: unknown) => ({ ACTIVE: "活跃", DORMANT: "沉睡", UNKNOWN: "未知", OPEN: "进行中", CLOSED: "已结束", RESOLVED: "已解决", TRANSFERRED: "已转交", BOUND: "已绑定", UNBOUND: "未绑定", ONLINE: "在网", OFFLINE: "离线", online: "在网", offline: "离线", unknown: "未知" }[String(value)] ?? "待核对");
const flowStatusLabels: Record<string, string> = {
  CREATED: "已创建", PENDING: "待处理", CONFIRMING: "确认中", WAITING_CONFIRMATION: "等待确认", OPEN: "待对账",
  SUBMITTED: "已提交", REVIEW_PENDING: "待审核", REVIEWING: "审核中", EXTENDED_HOLD: "延长等待", DELAYED: "已延迟", REVIEW_PASSED: "审核通过", PENDING_CHAIN: "等待链上处理", FROZEN: "已冻结", PROCESSING: "处理中", SENT: "已发送", CHAIN_SUBMITTED: "已广播",
  CONFIRMED: "已确认", CREDITED: "已入账", PAID: "已支付", SUCCESS: "成功", POSTED: "已记账", COMPLETED: "已完成", UNSETTLED: "未结算", MANUAL_REVIEW: "人工复核",
  FAILED: "失败", TX_FAILED: "发送失败", TX_ORPHANED: "链上交易异常", DEAD: "交易状态异常", ADDRESS_INVALID: "地址无效", REVIEW_REJECTED: "审核拒绝", REJECTED: "已拒绝", DECLINED: "支付被拒绝", EXPIRED: "已过期", ABNORMAL: "账务异常",
  CHARGEBACK: "拒付待处理", DISPUTED: "拒付争议中", CHARGEBACK_REVIEW: "拒付复核中", CHARGEBACK_REFUNDED: "拒付已退款", CHARGEBACK_RECOVERED: "拒付已追回", CHARGEBACK_PARTIAL: "拒付部分追回", REFUNDED: "已退款", RETURNED: "已退回", CANCELLED: "已取消",
};
const flowStatusLabel = (value: unknown) => Object.hasOwn(flowStatusLabels, String(value)) ? flowStatusLabels[String(value)] : "待核对";
const statisticCount = (value?: SupportCustomerStatistics["invitations"]["direct"]) => compactSupportBoardValue(value?.status === "AVAILABLE" ? value.confirmed : null, "count");
const statisticMoney = (value?: SupportCustomerStatistics["lifetime"][number]["deposits"], exact = false) => {
  const amount = value?.status === "AVAILABLE" || value?.status === "PARTIAL" ? value.confirmed : null;
  const display = exact ? amount ?? "-" : compactSupportBoardValue(amount);
  return display !== "-" && value?.status === "PARTIAL" ? `${display}（部分统计）` : display;
};
function Row({ label, value, numeric = false, title }: { label: string; value: unknown; numeric?: boolean | "count"; title?: string }) { return <div className="cvp-row"><span className="k">{label}</span><span className="v" data-exact={title} aria-label={title} tabIndex={title ? 0 : undefined}>{numeric && compactSupportBoardValue(value, numeric === "count" ? "count" : "amount") === "-" ? "-" : show(value)}</span></div>; }
function Group({ title, group, failed, retry, children }: { title: string; group?: SupportGroup; failed?: boolean; retry: () => void; children: ReactNode }) {
  return <details open className="m3-profile-group"><summary>{title}</summary>{!group ? <div className="itint" role={failed ? "alert" : "status"}>{failed ? "读取失败" : "正在读取…"}</div> : group.status !== "READY" ? <div className="itint" role={group.status === "ERROR" ? "alert" : "status"}>{statusText[group.status]} {group.status === "ERROR" && <button className="l-btn sm" onClick={retry}>重新读取{title}</button>}</div> : children}</details>;
}
export function M3CustomerProfile({ ctx, customerId, conversation, scopeVersion, onHistory, messageError, onRetryMessages }: { ctx: MCtx; customerId: string; conversation?: SessionConvo; scopeVersion?: number; onHistory: (no: string) => void; messageError?: string; onRetryMessages: () => void }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  const [profile, setProfile] = useState<SupportProfile | null>(null), [error, setError] = useState("");
  const [reload, setReload] = useState(0), [view360, setView360] = useState(false);
  const [devicePage, setDevicePage] = useState(1), [flowPage, setFlowPage] = useState(1);
  const [deviceGroup, setDeviceGroup] = useState<SupportGroup | null>(null), [flowGroup, setFlowGroup] = useState<SupportGroup | null>(null);
  const [pageError, setPageError] = useState({ devices: "", flows: "" }), [pageRetry, setPageRetry] = useState(0);
  const [currency, setCurrency] = useState(""), [flowStatus, setFlowStatus] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [tag, setTag] = useState(""), [note, setNote] = useState(""), [writing, setWriting] = useState(false), [writeError, setWriteError] = useState("");
  const [historyPage, setHistoryPage] = useState(1), [ticketPage, setTicketPage] = useState(1);
  const [maintenance, setMaintenance] = useState<SupportMaintenanceHistory | null>(null), [maintenanceError, setMaintenanceError] = useState(""), [maintenancePage, setMaintenancePage] = useState(1);
  const [summaryCurrency, setSummaryCurrency] = useState("USDT");
  const [detailSection, setDetailSection] = useState("");
  const open360 = (section = "") => { setDetailSection(section); setView360(true); };
  useEffect(() => {
    if (!view360 || !detailSection) return;
    const target = [...document.querySelectorAll<HTMLElement>(".m3-service-profile details")].find(element => element.querySelector("summary")?.textContent?.startsWith(detailSection));
    target?.setAttribute("open", ""); target?.scrollIntoView({ block: "nearest" }); target?.querySelector<HTMLElement>("summary")?.focus();
  }, [view360, detailSection]);
  const scopeKey = `${epoch}:${customerId}`, revokedScope = useRef("");
  const scopeDenied = revokedScope.current === scopeKey;
  const annotationWrite = useRef<object | null>(null);
  const requestStamp = `${scopeKey}:${scopeVersion ?? ""}:${reload}:${scopeDenied}`;
  const stamp = useRef(""), mounted = useRef(true); stamp.current = requestStamp;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const revokeScope = () => {
    if (revokedScope.current === scopeKey) return;
    revokedScope.current = scopeKey; stamp.current += ":revoked";
    setProfile(null); setDeviceGroup(null); setFlowGroup(null); setMaintenance(null); setView360(false);
    setTag(""); setNote(""); annotationWrite.current = null; setWriting(false); setWriteError("");
    setError("客户资料暂时无法读取，归属或访问范围可能已变化。请重新读取资料或返回列表核对。");
  };
  const denied = (cause: unknown) => {
    if (!(cause instanceof SupportClientError) || ![403,404].includes(cause.status)) return false;
    if (revokedScope.current !== scopeKey) { revokeScope(); ctx.invalidateScope(conversation?.id, customerId); }
    return true;
  };
  const retryProfile = () => { if (stamp.current === requestStamp) { revokedScope.current = ""; setReload(n => n + 1); } };
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    const controller = new AbortController(), saved = stamp.current; setProfile(null); setError("");
    supportEnhancements.profile(customerId, controller.signal).then(p => { if (!controller.signal.aborted && saved === stamp.current) setProfile(p); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setError(displayAdminError(e)); });
    return () => controller.abort();
  }, [customerId, epoch, scopeVersion, reload]);
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    const controller = new AbortController(), saved = stamp.current; setDeviceGroup(null); setPageError(e => ({ ...e, devices: "" }));
    supportEnhancements.devices(customerId, devicePage, controller.signal).then(g => { if (!controller.signal.aborted && saved === stamp.current) setDeviceGroup(g); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setPageError(v => ({ ...v, devices: displayAdminError(e) })); });
    return () => controller.abort();
  }, [customerId, epoch, scopeVersion, devicePage, pageRetry, reload]);
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    const controller = new AbortController(), saved = stamp.current; setFlowGroup(null); setPageError(e => ({ ...e, flows: "" }));
    supportEnhancements.flows(customerId, { pageNum: flowPage, currency: currency || undefined, status: flowStatus || undefined, from: from ? new Date(from+"T00:00:00Z").toISOString() : undefined, to: to ? new Date(to+"T00:00:00Z").toISOString() : undefined }, controller.signal).then(g => { if (!controller.signal.aborted && saved === stamp.current) setFlowGroup(g); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setPageError(v => ({ ...v, flows: displayAdminError(e) })); });
    return () => controller.abort();
  }, [customerId, epoch, scopeVersion, flowPage, currency, flowStatus, from, to, pageRetry, reload]);
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    const controller = new AbortController(), saved = stamp.current; setMaintenance(null); setMaintenanceError("");
    supportClient.maintenanceHistory(customerId, { pageNum: maintenancePage, pageSize: 10, signal: controller.signal }).then(v => { if (!controller.signal.aborted && saved === stamp.current) setMaintenance(v); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setMaintenanceError(displayAdminError(e)); });
    return () => controller.abort();
  }, [customerId, epoch, scopeVersion, maintenancePage, reload]);
  useEffect(() => { setDevicePage(1); setFlowPage(1); setHistoryPage(1); setTicketPage(1); setMaintenancePage(1); setView360(false); setTag(""); setNote(""); annotationWrite.current = null; setWriting(false); setWriteError(""); }, [customerId, epoch]);
  useEffect(() => {
    const onInvalidated = (event: Event) => {
      const { conversationNo, customerId: affectedCustomer } = (event as CustomEvent<{ conversationNo?: string; customerId?: string }>).detail ?? {};
      if (!conversationNo && !affectedCustomer || affectedCustomer === customerId || Boolean(conversationNo && conversationNo === conversation?.id)) revokeScope();
    };
    window.addEventListener("support-scope-invalidated", onInvalidated);
    return () => window.removeEventListener("support-scope-invalidated", onInvalidated);
  }, [customerId, epoch, conversation?.id]);
  async function retryGroup(key: keyof Omit<SupportProfile,"actions">) {
    if (revokedScope.current === scopeKey || stamp.current !== requestStamp) return;
    const saved = stamp.current;
    setError(""); setProfile(old => old ? { ...old, [key]: { ...old[key], status: "UNKNOWN", data: null } } : old);
    try { const next = await supportEnhancements.profile(customerId); if (mounted.current && saved === stamp.current) setProfile(old => old ? { ...old, [key]: next[key] } : next); } catch(e) { if (mounted.current && saved === stamp.current && !denied(e)) { setProfile(old => old ? { ...old, [key]: { ...old[key], status: "ERROR", data: null } } : old); setError(displayAdminError(e)); } }
  }
  const conversationId = conversation?.id;
  const writable = Boolean(!scopeDenied && conversationId && conversation?.ownerAdminId === session?.adminId && (session?.role === "super" || session?.role === "superadmin" || session?.authorities.includes("service_m3_write")));
  const canReadAccount = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities.includes("user_c1hub_read"));
  async function annotate(action: (id: string) => Promise<boolean>, clear: () => void) {
    if (revokedScope.current === scopeKey || stamp.current !== requestStamp || !conversationId || !writable || annotationWrite.current) return false; const saved = stamp.current, writeToken = {}; annotationWrite.current = writeToken; setWriting(true); setWriteError("");
    try { const ok = await action(conversationId); if (!mounted.current || saved !== stamp.current) return false; if (!ok) setWriteError("未确认保存，原输入已保留，请核对归属后重试。"); else { clear(); const next = await supportEnhancements.profile(customerId); if (mounted.current && saved === stamp.current) setProfile(next); } return ok; }
    catch(e) { if (mounted.current && saved === stamp.current && !denied(e)) setWriteError(displayAdminError(e)); return false; } finally { if (annotationWrite.current === writeToken) { annotationWrite.current = null; if (mounted.current) setWriting(false); } }
  }
  const identity = profile?.identity.data, finance = profile?.finance.data, service = profile?.service.data, annotations = profile?.annotations.data;
  const statistics = profile?.statistics?.status === "READY" ? profile.statistics.data : null;
  const firstKnown = statistics?.first.status === "AVAILABLE";
  const firstConfirmed = firstKnown && statistics?.first.state === "CONFIRMED";
  const firstState = firstConfirmed ? "已首充" : firstKnown && statistics?.first.state === "NONE" ? "未首充" : "待核实";
  const firstSource = firstConfirmed ? statistics?.first.kind === "DEPOSIT" ? "充值" : statistics?.first.kind === "DEVICE_PURCHASE" ? "购机" : "-" : "-";
  const advisorName = service?.agentName ?? conversation?.owner;
  const advisorId = typeof service?.agentAdminId === "number" ? service.agentAdminId : conversation?.ownerAdminId;
  const currencies = asRows(finance?.byCurrency), devices = asRows(deviceGroup?.data?.records), flows = asRows(flowGroup?.data?.records);
  const deviceStatuses = deviceGroup?.data?.fieldStatuses as Record<string,string>|undefined;
  const history = (() => { try { return (JSON.parse(ctx.pget("I.session.convos") ?? "[]") as SessionConvo[]).filter(c => c.customerId === customerId).sort((a,b)=>b.lastTs-a.lastTs); } catch { return []; } })();
  const tickets = (() => { try { return (JSON.parse(ctx.pget("I.support.tickets") ?? "[]") as SupportTicket[]).filter(t => String(t.userId) === customerId); } catch { return []; } })();
  const financeLabels: Record<string,string> = { netContributionTotal: "累计净贡献", creditedDepositTotal: "累计成功充值实际入账", successfulWithdrawalPrincipalTotal: "累计成功提现本金", successfulWithdrawalFeeTotal: "累计提现手续费", successfulWithdrawalNetTotal: "累计提现实际到账", processingWithdrawalPrincipalTotal: "处理中提现本金", balance: "余额", availableBalance: "可用余额" };
  const pager = (page: number, total: unknown, set: (n:number)=>void) => <div className="m-admin-toolbar"><button className="l-btn sm" disabled={page<=1} onClick={()=>set(page-1)}>上一页</button><span>第 {page} 页 · {compactSupportBoardValue(total,"count") === "-" ? "-" : show(total)} 条</span><button className="l-btn sm" disabled={typeof total !== "number" || page*10>=total} onClick={()=>set(page+1)}>下一页</button></div>;
  const body = <div className="m3-service-profile">
    {error && <div className="itint danger" role="alert">{error}<button className="l-btn sm" onClick={retryProfile}>重新读取资料</button></div>}
    {!scopeDenied && <>
    <Group title="基本信息" group={profile?.identity} failed={Boolean(error)} retry={()=>void retryGroup("identity")}>
      <Row label="客户姓名" value={identity?.nickname}/><Row label="客户编码" value={identity?.userNo}/><Row label="客户 ID" value={customerId}/><Row label="客户等级" value={identity?.level}/><Row label="手机" value={identity?.phoneMasked}/><Row label="地区" value={identity?.region}/><Row label="注册时间" value={dates(identity?.registeredAt)}/><Row label="最近登录" value={dates(identity?.lastLoginAt)}/>
    </Group>
    <Group title="首充与邀请统计" group={profile?.statistics} failed={Boolean(error)} retry={()=>void retryGroup("statistics")}>
      <Row label="首充状态" value={firstState}/><Row label="首充来源" value={firstSource}/><Row label="首充时间" value={firstConfirmed && statistics?.first.succeededAt ? dates(statistics.first.succeededAt) : "-"}/><Row label="首充金额" value={firstConfirmed && statistics?.first.amount != null && statistics.first.currency ? `${statistics.first.amount} ${statistics.first.currency}` : "-"}/>
      <Row label="直属邀请（人）" value={statisticCount(statistics?.invitations.direct)}/><Row label="全部邀请后代（人）" value={statisticCount(statistics?.invitations.descendants)}/>
      {statistics?.lifetime.map(row=>{const invited=statistics.invitations.deposits.find(item=>item.currency===row.currency)?.deposits;return <div key={row.currency}><h4>{row.currency} · 累计</h4><Row label="本人充值" value={statisticMoney(row.deposits)} title={`${statisticMoney(row.deposits,true)} ${row.currency}`}/><Row label="本人净贡献" value={statisticMoney(row.net)} title={`${statisticMoney(row.net,true)} ${row.currency}`}/><Row label="邀请后代充值" value={statisticMoney(invited)} title={`${statisticMoney(invited,true)} ${row.currency}`}/></div>;})}
      <p className="m-admin-muted">首充包括成功充值或购机，赠送与试用不计入。邀请后代包含直属邀请。</p>
    </Group>
    <Group title="账户资金（全历史）" group={profile?.finance} failed={Boolean(error)} retry={()=>void retryGroup("finance")}>
      {!currencies.length && <div className="itint">尚无可信币种资金资料，累计未知。</div>}
      {currencies.map((row,i)=>{const statuses=row.fieldStatuses as Record<string,SupportFinanceFieldStatus>|undefined;const unavailable=Object.entries(financeLabels).filter(([key])=>!(statuses?.[key]==="READY"||statuses?.[key]==="PARTIAL")||compactSupportBoardValue(row[key])==="-");return <div key={String(row.currency??i)}><h4>{show(row.currency)}</h4>{Object.entries(financeLabels).map(([key,label])=>{const state=statuses?.[key];return <Row key={key} label={label} value={!(state==="READY"||state==="PARTIAL")||compactSupportBoardValue(row[key])==="-"?"-":`${show(row[key])} ${show(row.currency)}${state==="PARTIAL"?"（部分统计）":""}`}/>;})}{(["FORBIDDEN","ERROR","UNKNOWN"] as const).map(state=>{const labels=unavailable.filter(([key])=>(statuses?.[key]==="FORBIDDEN"||statuses?.[key]==="ERROR"?statuses[key]:"UNKNOWN")===state).map(([,label])=>label);return labels.length>0&&<p key={state} className="m-admin-muted" role={state==="ERROR"?"alert":undefined}>{labels.join("、")}{state==="FORBIDDEN"?"无查看权限，请联系管理员核对权限。":state==="ERROR"?"读取失败。":"暂时无法确认。"}{state!=="FORBIDDEN"&&<button className="l-btn sm" onClick={()=>void retryGroup("finance")}>重新读取资金</button>}</p>;})}</div>;})}
      <p className="m-admin-muted">净贡献已扣除对应的成功提现及后台退款。成功充值不支持退款。</p>
    </Group>
    <details open className="m3-profile-group"><summary>资金流水</summary>
      <div className="m-admin-toolbar m3-profile-flow-filters"><div role="group" aria-label="流水币种"><span>币种</span><HDSelect width={144} value={currency} onChange={value=>{setCurrency(value);setFlowPage(1);}} options={[{value:"",label:"全部币种"},...currencies.map(row=>({value:String(row.currency),label:show(row.currency)}))]}/></div><div role="group" aria-label="流水状态"><span>状态</span><HDSelect width={164} value={flowStatus} onChange={value=>{setFlowStatus(value);setFlowPage(1);}} options={[{value:"",label:"全部状态"},...Object.entries(flowStatusLabels).map(([value,label])=>({value,label}))]}/></div><label>起始日期（UTC）<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setFlowPage(1);}}/></label><label>结束日期（UTC，不含）<input type="date" value={to} onChange={e=>{setTo(e.target.value);setFlowPage(1);}}/></label></div>
      {pageError.flows ? <div role="alert">{pageError.flows}<button onClick={()=>setPageRetry(n=>n+1)}>重试流水</button></div> : !flowGroup ? <p role="status">正在读取流水…</p> : flowGroup.status !== "READY" ? <p>{statusText[flowGroup.status]}<button onClick={()=>setPageRetry(n=>n+1)}>重试流水</button></p> : <>{!flows.length && <p>没有匹配的流水。</p>}{flows.map((r,i)=><details key={String(r.sourceId??r.id??`${r.bizNo??"flow"}:${i}`)}><summary>{r.kind==="DEPOSIT"?"充值":r.kind==="WITHDRAWAL"?"提现":"资金流水"} · {show(r.bizNo??r.orderNo)} · {show(r.currency)} · {flowStatusLabel(r.status)}</summary><Row numeric label="本金" value={r.principal}/><Row numeric label="费用" value={r.fee}/><Row numeric label="实际到账" value={r.net}/><Row label="创建时间" value={dates(r.createdAt)}/><Row label="完成时间" value={dates(r.completedAt)}/></details>)}{pager(flowPage,flowGroup.data?.total,setFlowPage)}</>}
    </details>
    <Group title="风险信息" group={profile?.risk} failed={Boolean(error)} retry={()=>void retryGroup("risk")}><Row label="风险等级" value={profile?.risk.data?.level}/><Row label="服务说明" value={profile?.risk.data?.serviceExplanation}/><Row label="评估时间" value={dates(profile?.risk.data?.evaluatedAt)}/><p className="m-admin-muted">专项案件与账户安全资料需原模块权限。</p></Group>
    <details open className="m3-profile-group"><summary>设备信息</summary>{pageError.devices ? <div role="alert">{pageError.devices}<button onClick={()=>setPageRetry(n=>n+1)}>重试设备</button></div> : !deviceGroup ? <p role="status">正在读取设备…</p> : deviceGroup.status !== "READY" ? <p>{statusText[deviceGroup.status]}<button onClick={()=>setPageRetry(n=>n+1)}>重试设备</button></p> : <><Row numeric="count" label="持有设备" value={deviceStatuses?.heldCount==="READY"?deviceGroup.data?.heldCount:null}/><Row numeric="count" label="在网设备" value={deviceGroup.data?.onlineCount}/><Row numeric label="实际总算力" value={deviceGroup.data?.hashrateTotal}/><p className="m-admin-muted">设备记录（含历史）</p>{!devices.length&&<p>没有设备记录。</p>}{devices.map((r,i)=><details key={String(r.id??i)}><summary>{show(r.name)} · {show(r.instanceNo)}</summary><Row label="在网情况" value={labelState(r.runtimeStatus)}/><Row numeric label="实际算力" value={r.hashrate}/><Row numeric label="实际收益" value={r.dailyUsdt}/><Row label="最近心跳" value={dates(r.heartbeatAt)}/><Row label="激活时间" value={dates(r.activatedAt)}/></details>)}{pager(devicePage,deviceGroup.data?.total,setDevicePage)}</>}</details>
    <Group title="标签与内部备注" group={profile?.annotations} failed={Boolean(error)} retry={()=>void retryGroup("annotations")}>
      <p>系统标签（只读）</p><div>{Array.isArray(annotations?.systemTags)&&annotations.systemTags.map(t=><span className="cv-tag" key={String(t)}>{show(t)} </span>)}</div>
      <p>自定义标签</p><div>{Array.isArray(annotations?.customTags)&&annotations.customTags.map(t=><span key={String(t)}>{show(t)} <button aria-label={`删除标签 ${show(t)}`} disabled={!writable||writing} onClick={()=>void annotate(id=>ctx.removeCustomerTag(id,String(t)),()=>{})}>删除</button> </span>)}</div>
      <label>新标签<input className="fld" value={tag} maxLength={30} disabled={!writable||writing} onChange={e=>setTag(e.target.value)}/></label><button className="l-btn sm" disabled={!writable||writing||!tag.trim()} onClick={()=>void annotate(id=>ctx.addCustomerTag(id,tag.trim()),()=>setTag(""))}>添加标签</button>
      {asRows(annotations?.notes).map((r,i)=><div key={String(r.id??i)}><p>{show(r.text)}</p><small>{show(r.authorName??r.author)} · {dates(r.createdAt)}</small><button className="l-btn sm" disabled={!writable||writing} onClick={()=>ctx.openActionConfirm({action:"删除内部备注",detail:String(r.text??""),reasonMin:8,reasonMax:200,run:(reason)=>annotate(id=>ctx.removeCustomerNote(id,String(r.id),reason),()=>{})})}>删除备注</button></div>)}
      <label>新内部备注<textarea className="fld" value={note} maxLength={1000} disabled={!writable||writing} onChange={e=>setNote(e.target.value)}/></label><button className="l-btn sm" disabled={!writable||writing||!note.trim()} onClick={()=>void annotate(id=>ctx.addCustomerNote(id,note.trim()),()=>setNote(""))}>保存备注</button>
      {!writable&&<p>{conversation ? "仅当前专属客服持原编辑权限可修改，客服主管审阅只读。" : "尚未建立服务会话，标签与备注只读；首次联系保存后可按原权限操作。"}</p>}{writeError&&<p role="alert">{writeError}</p>}
    </Group>
    <Group title="服务与维护" group={profile?.service} failed={Boolean(error)} retry={()=>void retryGroup("service")}>
      <SupportAvatar name={String(advisorName??"专属客服")} path={advisorId&&service?.advisorAvatar?advisorAvatarPath(advisorId,customerId):undefined} version={typeof (service?.advisorAvatar as Record<string,unknown>|undefined)?.version==="number"?(service?.advisorAvatar as {version:number}).version:undefined}/>
      <Row label="当前专属客服" value={advisorName}/><Row label="归属状态" value={labelState(service?.assignmentState)}/><Row label="会话状态" value={service?.conversationCount===0?"暂无会话":labelState(service?.conversationStatus)}/><Row label="账户活动" value={labelState(service?.activityStatus)}/><Row label="主动维护" value={service?.maintenanceEnabled==null?"未知":service.maintenanceEnabled?"正常维护":"不再维护"}/><Row label="有效活动" value={dates(service?.lastEffectiveAt)}/><Row label="下次维护" value={dates(service?.nextMaintenanceAt)}/><Row label="最近服务" value={dates(service?.lastServiceAt)}/><Row label="首次待联系" value={service?.firstContact}/><Row label="待专属客服回复" value={service?.waitingReply}/>
      <a className="l-btn sm" href={`/service/overview?customerId=${customerId}`}>维护状态与正式转绑</a>
    </Group>
    <details open className="m3-profile-group"><summary>最近服务记录</summary>{!conversation?<p>{profile?.service.status==="READY"&&service?.conversationCount===0?"暂无服务记录。":"尚未打开服务会话，可从历史会话查看记录。"}</p>:!conversation.detailReady?<p role={messageError?"alert":"status"}>{messageError?`服务记录读取失败：${messageError}`:"正在读取服务记录…"}{messageError&&<button className="l-btn sm" onClick={onRetryMessages}>重试服务记录</button>}</p>:conversation.messages.length?conversation.messages.slice(-4).reverse().map((message,index)=><div key={message.id??index}><small>{message.sourceSenderType==="SYSTEM"||message.sourceSenderType==="INTERNAL"?"系统":message.sender==="agent"?message.agentName||"历史专属客服":conversation.customer||"客户"}{message.authorConfidence!=="VERIFIED"&&message.sourceSenderType!=="SYSTEM"&&message.sourceSenderType!=="INTERNAL"?" · 作者身份未确认":""} · {Number.isFinite(message.ts)&&message.ts>0?new Intl.DateTimeFormat("zh-CN",{dateStyle:"short",timeStyle:"short"}).format(message.ts):"时间未知"}</small><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{message.kind==="IMAGE"?"[图片]":message.text||"服务记录无正文"}</p></div>):<p>暂无服务记录。</p>}</details>
    <details className="m3-profile-group"><summary>维护记录</summary>{maintenanceError?<p role="alert">{maintenanceError}<button onClick={()=>setReload(n=>n+1)}>重试维护记录</button></p>:!maintenance?<p>正在读取…</p>:<><Row numeric="count" label="维护执行次数" value={maintenance.totalExecutions}/><Row numeric="count" label="维护周期总数" value={maintenance.totalCycles}/>{maintenance.executions.map(r=><p key={r.id}>人工联系 · {dates(r.occurredAt)}</p>)}{maintenance.cycles.map(r=><p key={r.id}>{r.state==="SUCCEEDED"?"成功周期":r.state==="OPEN"?"等待新的有效活动":r.state==="STOPPED"?"已停止":r.state==="TRANSFERRED"?"已正式转绑":"待核对"} · {dates(r.occurredAt)}</p>)}{pager(maintenancePage,Math.max(maintenance.totalCycles,maintenance.totalExecutions),setMaintenancePage)}</>}</details>
    <details className="m3-profile-group"><summary>历史会话（{compactSupportBoardValue(service?.conversationCount,"count")}）</summary>{history.slice((historyPage-1)*10,historyPage*10).map(c=><button className="l-btn sm" key={c.id} onClick={()=>{setView360(false);onHistory(c.id);}}>{c.id} · {c.status==="open"?"进行中":"已结束"} · {c.owner}</button>)}{!history.length&&<p>暂无可读取的历史会话。</p>}{pager(historyPage,history.length,setHistoryPage)}</details>
    <details className="m3-profile-group"><summary>关联工单（{compactSupportBoardValue(service?.ticketCount,"count")}）</summary>{ctx.pget("I.support.ticketsAvailable")!=="1"?<p>当前工单读取不可用或无原工单权限。<a href="/service/tickets">前往工单台核对</a></p>:<>{tickets.slice((ticketPage-1)*10,ticketPage*10).map(t=><a className="l-btn sm" key={t.id} href={`/service/tickets?query=${encodeURIComponent(t.id)}`}>{t.id} · {t.contentRestricted?"私聊内容受限":t.subject}</a>)}{!tickets.length&&<p>暂无可读取关联工单。</p>}{pager(ticketPage,tickets.length,setTicketPage)}</>}</details>
    <details className="m3-profile-group"><summary>账户操作</summary>{[["resetPassword","重置密码","/users/security"],["freeze","冻结账户","/users/actions"],["unfreeze","恢复账户","/users/actions"],["adjustBalance","资金调整","/users/assets"]].map(([key,label,path])=><div key={key}>{profile?.actions[key]?.allowed&&identity?.userNo?<a className="l-btn sm" href={`${path}?userCode=${encodeURIComponent(String(identity.userNo))}&userId=${encodeURIComponent(customerId)}&returnTo=${encodeURIComponent("/service/sessions?customerId="+customerId)}`}>{label}</a>:<button className="l-btn sm" disabled>{label} · 需要原模块操作权限</button>}</div>)}{[["提现记录","hub-withdrawal"],["设备明细","hub-devices"]].map(([label,anchor])=><div key={anchor}>{canReadAccount?<a className="l-btn sm" href={`/users/search/${encodeURIComponent(customerId)}#${anchor}`}>{label}</a>:<button className="l-btn sm" disabled>{label} · 需要原账户资料权限</button>}</div>)}</details>
    <small>资料读取时间：{dates(profile?.identity.evaluatedAt)}</small>
    </>}
  </div>;
  const summaryFinance = currencies.find(row => row.currency === summaryCurrency) ?? currencies[0];
  const summaryStatuses = summaryFinance?.fieldStatuses as Record<string, SupportFinanceFieldStatus> | undefined;
  const summaryMoney = (key: string) => profile?.finance.status === "READY" && ["READY", "PARTIAL"].includes(summaryStatuses?.[key] ?? "") ? compactSupportBoardValue(summaryFinance?.[key]) : "-";
  const risk = profile?.risk.data;
  const riskLevel = ({ LOW: "低风险", MEDIUM: "中风险", HIGH: "高风险", CRITICAL: "高风险", 低风险: "低风险", 中风险: "中风险", 高风险: "高风险" } as Record<string, string>)[String(risk?.level)] ?? "待核实";
  const tags = [...(Array.isArray(annotations?.systemTags) ? annotations.systemTags : []), ...(Array.isArray(annotations?.customTags) ? annotations.customTags : [])].filter((value): value is string => typeof value === "string");
  const latestNote = asRows(annotations?.notes).toSorted((a, b) => (Date.parse(String(b.createdAt)) || 0) - (Date.parse(String(a.createdAt)) || 0))[0];
  const summaryState = (key: keyof Omit<SupportProfile, "actions">) => {
    const group = profile?.[key];
    return group?.status === "READY" ? null : <p className="m3-profile-state" role={group?.status === "ERROR" || error ? "alert" : "status"}>{group ? statusText[group.status] : error ? "读取失败" : "正在读取…"}{group?.status === "ERROR" && <button type="button" className="m3-profile-link" onClick={()=>void retryGroup(key)}>重新读取</button>}</p>;
  };
  return <div className="m3-customer-sidebar">
    <header className="m3-profile-identity"><SupportAvatar name={String(identity?.nickname ?? "客户")} path={identity?.avatar ? customerAvatarPath(customerId) : undefined} size={48}/><div><div className="m3-profile-name"><h3 title={show(identity?.nickname)}>{identity?.nickname == null ? "客户资料待核实" : show(identity.nickname)}</h3>{identity?.level != null && <span className="m3-profile-level">{show(identity.level)}</span>}</div><p className="m3-profile-uid">UID {identity?.userNo == null ? "-" : show(identity.userNo)}</p>{advisorName && <p className="m3-profile-owner">当前专属客服 {String(advisorName)}</p>}</div></header>
    {!scopeDenied && <a className="m3-profile-open" href={`/service/customers/${encodeURIComponent(customerId)}${conversation?.id ? `?conversationNo=${encodeURIComponent(conversation.id)}` : ""}`}>查看完整客户档案 / 360 <span aria-hidden="true">→</span></a>}
    {view360 && <Modal title="客户服务 360" icon="users" wide onClose={()=>setView360(false)} footer={<button className="btn btn-sec btn-sm" onClick={()=>setView360(false)}>返回会话</button>}>{body}</Modal>}
    <div hidden={view360}>
      {error && <div className="m3-profile-state" role="alert">{error}<button type="button" className="m3-profile-link" onClick={retryProfile}>重新读取资料</button></div>}
      {!scopeDenied && <>
        {summaryState("identity")}
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>风险研判</h4><button type="button" className="m3-profile-link" onClick={()=>open360("风险信息")}>说明</button></div>{summaryState("risk") ?? <div className="m3-profile-risk" data-tone={riskLevel === "低风险" ? "low" : riskLevel === "中风险" ? "medium" : riskLevel === "高风险" ? "high" : "unknown"}><span>{riskLevel}</span><p>{typeof risk?.serviceExplanation === "string" && risk.serviceExplanation ? risk.serviceExplanation : "风险说明暂未核实。"}</p></div>}</section>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>资金概览</h4><div>{currencies.length > 1 ? <div className="m3-profile-currency" role="group" aria-label="资金摘要币种"><HDSelect width={92} value={String(summaryFinance?.currency)} onChange={setSummaryCurrency} options={currencies.map(row=>({value:String(row.currency),label:String(row.currency)}))}/></div> : <span>{summaryFinance?.currency == null ? "币种待核实" : String(summaryFinance.currency)}</span>}<button type="button" className="m3-profile-link" onClick={()=>open360("账户资金")}>明细 →</button></div></div>{summaryState("finance")}<div className="m3-profile-funds">{[["creditedDepositTotal", "累计成功充值"], ["successfulWithdrawalPrincipalTotal", "累计成功提现本金"], ["balance", "当前余额"]].map(([key,label])=><button type="button" key={key} onClick={()=>open360("账户资金")} title={summaryMoney(key) === "-" ? `${label}暂无法确认` : `${label} ${String(summaryFinance?.[key])} ${String(summaryFinance?.currency)}`}><span>{label}</span><strong>{summaryMoney(key)}{summaryMoney(key) !== "-" && <small>{String(summaryFinance?.currency)}</small>}</strong>{summaryStatuses?.[key] === "PARTIAL" && summaryMoney(key) !== "-" && <small>部分统计</small>}</button>)}<button type="button" onClick={()=>open360("关联工单")}><span>关联工单</span><strong>{profile?.service.status === "READY" ? compactSupportBoardValue(service?.ticketCount, "count") : "-"}<small>张</small></strong></button></div>{summaryStatuses && Object.values(summaryStatuses).some(status=>status === "ERROR" || status === "UNKNOWN" || status === "FORBIDDEN") && <p className="m3-profile-state">部分资金资料暂时无法确认。<button type="button" className="m3-profile-link" onClick={()=>void retryGroup("finance")}>重新读取资金</button></p>}</section>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>账户与设备</h4><button type="button" className="m3-profile-link" onClick={()=>open360("设备信息")}>设备明细 →</button></div>{pageError.devices ? <p className="m3-profile-state" role="alert">{pageError.devices}<button type="button" className="m3-profile-link" onClick={()=>setPageRetry(n=>n+1)}>重试设备</button></p> : !deviceGroup || deviceGroup.status !== "READY" ? <p className="m3-profile-state">{deviceGroup ? statusText[deviceGroup.status] : "正在读取设备…"}<button type="button" className="m3-profile-link" onClick={()=>setPageRetry(n=>n+1)}>重新读取</button></p> : <><Row label="持有设备" value={compactSupportBoardValue(deviceStatuses?.heldCount === "READY" ? deviceGroup.data?.heldCount : null, "count")}/><Row label="在网设备" value={compactSupportBoardValue(deviceGroup.data?.onlineCount, "count")}/><Row label="实际总算力" value={compactSupportBoardValue(deviceGroup.data?.hashrateTotal)}/></>}<Row label="地区" value={identity?.region}/><Row label="脱敏手机号" value={identity?.phoneMasked}/><Row label="注册时间" value={dates(identity?.registeredAt)}/><Row label="最近登录" value={dates(identity?.lastLoginAt)}/><Row label="最近有效活动" value={dates(service?.lastEffectiveAt)}/></section>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>客户标签</h4><button type="button" className="m3-profile-link" onClick={()=>open360("标签与内部备注")}>管理</button></div>{summaryState("annotations") ?? <><div className="m3-profile-tags">{tags.length ? tags.map((tag,index)=><span key={`${tag}:${index}`}>{tag}</span>) : <p className="m3-profile-state">暂无标签。</p>}</div><div className="m3-profile-heading"><h4>最新内部备注</h4><button type="button" className="m3-profile-link" onClick={()=>open360("标签与内部备注")}>查看与编辑</button></div>{latestNote ? <p className="m3-profile-note" title={show(latestNote.text)}>{show(latestNote.text)}</p> : <p className="m3-profile-state">暂无内部备注。</p>}</>}</section>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>快捷操作</h4></div><nav className="m3-profile-shortcuts" aria-label="客户快捷入口">{([["历史会话","历史会话","clock"],["关联工单","关联工单","doc"],["重置密码","账户操作","lock"],["账户操作","账户操作","wallet"],["添加备注","标签与内部备注","doc"]] as const).map(([label,section,icon])=><button type="button" key={label} aria-label={`打开完整档案查看${label}`} onClick={()=>open360(section)}><span aria-hidden="true"><Icon name={icon} size={15}/></span>{label}</button>)}</nav></section>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>首充与邀请</h4><button type="button" className="m3-profile-link" onClick={()=>open360("首充与邀请统计")}>统计明细 →</button></div>{summaryState("statistics")}<Row label="首充状态" value={firstState}/><Row label="直属邀请（人）" value={statisticCount(statistics?.invitations.direct)}/><Row label="全部邀请后代（人）" value={statisticCount(statistics?.invitations.descendants)}/><Row label={`邀请累充（${summaryCurrency}）`} value={statisticMoney(statistics?.invitations.deposits.find(row=>row.currency===summaryCurrency)?.deposits)}/><Row label="账户活跃" value={statistics?.activity.status === "AVAILABLE" ? statistics.activity.state === "ACTIVE" ? "活跃" : statistics.activity.state === "INACTIVE" ? "近期未活跃" : "-" : "-"}/></section>
      </>}
    </div>
  </div>;
}
