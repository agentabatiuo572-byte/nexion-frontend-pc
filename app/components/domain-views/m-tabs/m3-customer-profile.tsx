"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportEnhancements, type SupportProfile, type SupportGroup } from "@/lib/admin/m-support-enhancements";
import { supportClient, SupportClientError, type SupportMaintenanceHistory } from "@/lib/admin/m-support-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Modal } from "../design-kit";
import type { MCtx } from "./types";
import type { SessionConvo, SupportTicket } from "./data";
import { SupportAvatar, customerAvatarPath, advisorAvatarPath } from "./support-avatar";

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
function Row({ label, value }: { label: string; value: unknown }) { return <div className="cvp-row"><span className="k">{label}</span><span className="v">{show(value)}</span></div>; }
function Group({ title, group, retry, children }: { title: string; group?: SupportGroup; retry: () => void; children: ReactNode }) {
  return <details open className="m3-profile-group"><summary>{title}</summary>{!group ? <div className="itint" role="status">正在读取…</div> : group.status !== "READY" ? <div className="itint" role={group.status === "ERROR" ? "alert" : "status"}>{statusText[group.status]} {group.status === "ERROR" && <button className="l-btn sm" onClick={retry}>重新读取{title}</button>}</div> : children}</details>;
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
  const stamp = useRef(""); stamp.current = `${epoch}:${customerId}`;
  const denied = (cause: unknown) => { if (cause instanceof SupportClientError && [403,404].includes(cause.status)) { ctx.invalidateScope(conversation?.id, customerId); return true; } return false; };
  useEffect(() => {
    const controller = new AbortController(); setProfile(null); setError("");
    supportEnhancements.profile(customerId, controller.signal).then(p => { if (!controller.signal.aborted) setProfile(p); }).catch(e => { if (!controller.signal.aborted && !denied(e)) setError(displayAdminError(e)); });
    return () => controller.abort();
  }, [customerId, epoch, scopeVersion, reload]);
  useEffect(() => {
    const controller = new AbortController(); setDeviceGroup(null); setPageError(e => ({ ...e, devices: "" }));
    supportEnhancements.devices(customerId, devicePage, controller.signal).then(g => { if (!controller.signal.aborted) setDeviceGroup(g); }).catch(e => { if (!controller.signal.aborted && !denied(e)) setPageError(v => ({ ...v, devices: displayAdminError(e) })); });
    return () => controller.abort();
  }, [customerId, epoch, devicePage, pageRetry, reload]);
  useEffect(() => {
    const controller = new AbortController(); setFlowGroup(null); setPageError(e => ({ ...e, flows: "" }));
    supportEnhancements.flows(customerId, { pageNum: flowPage, currency: currency || undefined, status: flowStatus || undefined, from: from ? new Date(from+"T00:00:00Z").toISOString() : undefined, to: to ? new Date(to+"T00:00:00Z").toISOString() : undefined }, controller.signal).then(g => { if (!controller.signal.aborted) setFlowGroup(g); }).catch(e => { if (!controller.signal.aborted && !denied(e)) setPageError(v => ({ ...v, flows: displayAdminError(e) })); });
    return () => controller.abort();
  }, [customerId, epoch, flowPage, currency, flowStatus, from, to, pageRetry, reload]);
  useEffect(() => {
    const controller = new AbortController(); setMaintenance(null); setMaintenanceError("");
    supportClient.maintenanceHistory(customerId, { pageNum: maintenancePage, pageSize: 10, signal: controller.signal }).then(v => { if (!controller.signal.aborted) setMaintenance(v); }).catch(e => { if (!controller.signal.aborted && !denied(e)) setMaintenanceError(displayAdminError(e)); });
    return () => controller.abort();
  }, [customerId, epoch, maintenancePage, reload]);
  useEffect(() => { setDevicePage(1); setFlowPage(1); setHistoryPage(1); setTicketPage(1); setMaintenancePage(1); setView360(false); setTag(""); setNote(""); setWriting(false); }, [customerId, epoch]);
  async function retryGroup(key: keyof Omit<SupportProfile,"actions">) {
    const saved = stamp.current;
    try { const next = await supportEnhancements.profile(customerId); if (saved === stamp.current) setProfile(old => old ? { ...old, [key]: next[key] } : next); } catch(e) { if (saved === stamp.current && !denied(e)) setError(displayAdminError(e)); }
  }
  const conversationId = conversation?.id;
  const writable = Boolean(conversationId && conversation?.ownerAdminId === session?.adminId && (session?.role === "super" || session?.role === "superadmin" || session?.authorities.includes("service_m3_write")));
  const canReadAccount = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities.includes("user_c1hub_read"));
  async function annotate(action: (id: string) => Promise<boolean>, clear: () => void) {
    if (!conversationId || !writable || writing) return false; const saved = stamp.current; setWriting(true); setWriteError("");
    try { const ok = await action(conversationId); if (saved !== stamp.current) return false; if (!ok) setWriteError("未确认保存，原输入已保留，请核对归属后重试。"); else { clear(); const next = await supportEnhancements.profile(customerId); if (saved === stamp.current) setProfile(next); } return ok; }
    catch(e) { if (saved === stamp.current && !denied(e)) setWriteError(displayAdminError(e)); return false; } finally { if (saved === stamp.current) setWriting(false); }
  }
  const identity = profile?.identity.data, finance = profile?.finance.data, service = profile?.service.data, annotations = profile?.annotations.data;
  const advisorName = service?.agentName ?? conversation?.owner;
  const advisorId = typeof service?.agentAdminId === "number" ? service.agentAdminId : conversation?.ownerAdminId;
  const currencies = asRows(finance?.byCurrency), devices = asRows(deviceGroup?.data?.records), flows = asRows(flowGroup?.data?.records);
  const history = (() => { try { return (JSON.parse(ctx.pget("I.session.convos") ?? "[]") as SessionConvo[]).filter(c => c.customerId === customerId).sort((a,b)=>b.lastTs-a.lastTs); } catch { return []; } })();
  const tickets = (() => { try { return (JSON.parse(ctx.pget("I.support.tickets") ?? "[]") as SupportTicket[]).filter(t => String(t.userId) === customerId); } catch { return []; } })();
  const financeLabels: Record<string,string> = { creditedDepositTotal: "累计成功充值实际入账", depositRefundTotal: "充值退款", successfulWithdrawalPrincipalTotal: "累计成功提现本金", successfulWithdrawalFeeTotal: "累计提现手续费", successfulWithdrawalNetTotal: "累计提现实际到账", processingWithdrawalPrincipalTotal: "处理中提现本金", balance: "余额", availableBalance: "可用余额" };
  const pager = (page: number, total: unknown, set: (n:number)=>void) => <div className="m-admin-toolbar"><button className="l-btn sm" disabled={page<=1} onClick={()=>set(page-1)}>上一页</button><span>第 {page} 页 · {show(total)} 条</span><button className="l-btn sm" disabled={typeof total !== "number" || page*10>=total} onClick={()=>set(page+1)}>下一页</button></div>;
  const body = <div className="m3-service-profile">
    {error && <div className="itint danger" role="alert">{error}<button className="l-btn sm" onClick={()=>setReload(n=>n+1)}>重新读取资料</button></div>}
    <Group title="基本信息" group={profile?.identity} retry={()=>void retryGroup("identity")}>
      <SupportAvatar name={String(identity?.nickname??"客户")} path={identity?.avatar?customerAvatarPath(customerId):undefined} size={48}/>
      <Row label="客户姓名" value={identity?.nickname}/><Row label="客户编码" value={identity?.userNo}/><Row label="客户 ID" value={customerId}/><Row label="客户等级" value={identity?.level}/><Row label="手机" value={identity?.phoneMasked}/><Row label="地区" value={identity?.region}/><Row label="注册时间" value={dates(identity?.registeredAt)}/><Row label="最近登录" value={dates(identity?.lastLoginAt)}/>
    </Group>
    <Group title="账户资金（全历史）" group={profile?.finance} retry={()=>void retryGroup("finance")}>
      {!currencies.length && <div className="itint">尚无可信币种资金资料，累计未知。</div>}
      {currencies.map((row,i)=><div key={String(row.currency??i)}><h4>{show(row.currency)}</h4>{Object.entries(financeLabels).map(([key,label])=>{const state=(row.fieldStatuses as Record<string,string>|undefined)?.[key];return <Row key={key} label={label} value={state&&state!=="READY"?statusText[state as keyof typeof statusText]??"待核对":row[key] == null ? "未知" : `${show(row[key])} ${show(row.currency)}`}/>;})}</div>)}
      <p className="m-admin-muted">累计来自全历史实际入账，退款独立；以下流水分页不改变累计。</p>
    </Group>
    <details open className="m3-profile-group"><summary>资金流水</summary>
      <div className="m-admin-toolbar"><label>币种<select className="fld" value={currency} onChange={e=>{setCurrency(e.target.value);setFlowPage(1);}}><option value="">全部币种</option>{currencies.map(r=><option key={String(r.currency)}>{show(r.currency)}</option>)}</select></label><label>状态<select className="fld" value={flowStatus} onChange={e=>{setFlowStatus(e.target.value);setFlowPage(1);}}><option value="">全部状态</option>{Object.entries(flowStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><label>起始日期（UTC）<input type="date" value={from} onChange={e=>{setFrom(e.target.value);setFlowPage(1);}}/></label><label>结束日期（UTC，不含）<input type="date" value={to} onChange={e=>{setTo(e.target.value);setFlowPage(1);}}/></label></div>
      {pageError.flows ? <div role="alert">{pageError.flows}<button onClick={()=>setPageRetry(n=>n+1)}>重试流水</button></div> : !flowGroup ? <p role="status">正在读取流水…</p> : flowGroup.status !== "READY" ? <p>{statusText[flowGroup.status]}<button onClick={()=>setPageRetry(n=>n+1)}>重试流水</button></p> : <>{!flows.length && <p>没有匹配的流水。</p>}{flows.map((r,i)=><details key={String(r.sourceId??r.id??`${r.bizNo??"flow"}:${i}`)}><summary>{r.kind==="DEPOSIT"?"充值":r.kind==="WITHDRAWAL"?"提现":"资金流水"} · {show(r.bizNo??r.orderNo)} · {show(r.currency)} · {flowStatusLabel(r.status)}</summary><Row label="本金" value={r.principal}/><Row label="费用" value={r.fee}/><Row label="实际到账" value={r.net}/><Row label="创建时间" value={dates(r.createdAt)}/><Row label="完成时间" value={dates(r.completedAt)}/></details>)}{pager(flowPage,flowGroup.data?.total,setFlowPage)}</>}
    </details>
    <Group title="风险信息" group={profile?.risk} retry={()=>void retryGroup("risk")}><Row label="风险等级" value={profile?.risk.data?.level}/><Row label="服务说明" value={profile?.risk.data?.serviceExplanation}/><Row label="评估时间" value={dates(profile?.risk.data?.evaluatedAt)}/><p className="m-admin-muted">专项案件与账户安全资料需原模块权限。</p></Group>
    <details open className="m3-profile-group"><summary>设备信息</summary>{pageError.devices ? <div role="alert">{pageError.devices}<button onClick={()=>setPageRetry(n=>n+1)}>重试设备</button></div> : !deviceGroup ? <p role="status">正在读取设备…</p> : deviceGroup.status !== "READY" ? <p>{statusText[deviceGroup.status]}<button onClick={()=>setPageRetry(n=>n+1)}>重试设备</button></p> : <><Row label="持有设备" value={deviceGroup.data?.total}/><Row label="在网设备" value={deviceGroup.data?.onlineCount}/><Row label="实际总算力" value={deviceGroup.data?.hashrateTotal}/>{!devices.length&&<p>当前没有持有设备。</p>}{devices.map((r,i)=><details key={String(r.id??i)}><summary>{show(r.name)} · {show(r.instanceNo)}</summary><Row label="在网情况" value={labelState(r.runtimeStatus)}/><Row label="实际算力" value={r.hashrate}/><Row label="实际收益" value={r.dailyUsdt}/><Row label="最近心跳" value={dates(r.heartbeatAt)}/><Row label="激活时间" value={dates(r.activatedAt)}/></details>)}{pager(devicePage,deviceGroup.data?.total,setDevicePage)}</>}</details>
    <Group title="标签与内部备注" group={profile?.annotations} retry={()=>void retryGroup("annotations")}>
      <p>系统标签（只读）</p><div>{Array.isArray(annotations?.systemTags)&&annotations.systemTags.map(t=><span className="cv-tag" key={String(t)}>{show(t)} </span>)}</div>
      <p>自定义标签</p><div>{Array.isArray(annotations?.customTags)&&annotations.customTags.map(t=><span key={String(t)}>{show(t)} <button aria-label={`删除标签 ${show(t)}`} disabled={!writable||writing} onClick={()=>void annotate(id=>ctx.removeCustomerTag(id,String(t)),()=>{})}>删除</button> </span>)}</div>
      <label>新标签<input className="fld" value={tag} maxLength={30} disabled={!writable||writing} onChange={e=>setTag(e.target.value)}/></label><button className="l-btn sm" disabled={!writable||writing||!tag.trim()} onClick={()=>void annotate(id=>ctx.addCustomerTag(id,tag.trim()),()=>setTag(""))}>添加标签</button>
      {asRows(annotations?.notes).map((r,i)=><div key={String(r.id??i)}><p>{show(r.text)}</p><small>{show(r.authorName??r.author)} · {dates(r.createdAt)}</small><button className="l-btn sm" disabled={!writable||writing} onClick={()=>ctx.openActionConfirm({action:"删除内部备注",detail:String(r.text??""),reasonMin:8,reasonMax:200,run:(reason)=>annotate(id=>ctx.removeCustomerNote(id,String(r.id),reason),()=>{})})}>删除备注</button></div>)}
      <label>新内部备注<textarea className="fld" value={note} maxLength={1000} disabled={!writable||writing} onChange={e=>setNote(e.target.value)}/></label><button className="l-btn sm" disabled={!writable||writing||!note.trim()} onClick={()=>void annotate(id=>ctx.addCustomerNote(id,note.trim()),()=>setNote(""))}>保存备注</button>
      {!writable&&<p>{conversation ? "仅当前顾问持原编辑权限可修改，主管审阅只读。" : "尚未建立服务会话，标签与备注只读；首次联系保存后可按原权限操作。"}</p>}{writeError&&<p role="alert">{writeError}</p>}
    </Group>
    <Group title="服务与维护" group={profile?.service} retry={()=>void retryGroup("service")}>
      <SupportAvatar name={String(advisorName??"顾问")} path={advisorId&&service?.advisorAvatar?advisorAvatarPath(advisorId,customerId):undefined} version={typeof (service?.advisorAvatar as Record<string,unknown>|undefined)?.version==="number"?(service?.advisorAvatar as {version:number}).version:undefined}/>
      <Row label="当前顾问" value={advisorName}/><Row label="归属状态" value={labelState(service?.assignmentState)}/><Row label="会话状态" value={service?.conversationCount===0?"暂无会话":labelState(service?.conversationStatus)}/><Row label="账户活动" value={labelState(service?.activityStatus)}/><Row label="主动维护" value={service?.maintenanceEnabled==null?"未知":service.maintenanceEnabled?"正常维护":"不再维护"}/><Row label="有效活动" value={dates(service?.lastEffectiveAt)}/><Row label="下次维护" value={dates(service?.nextMaintenanceAt)}/><Row label="最近服务" value={dates(service?.lastServiceAt)}/><Row label="首次待联系" value={service?.firstContact}/><Row label="待顾问回复" value={service?.waitingReply}/>
      <a className="l-btn sm" href={`/service/overview?customerId=${customerId}`}>维护状态与正式转绑</a>
    </Group>
    <details open className="m3-profile-group"><summary>最近服务记录</summary>{!conversation?<p>{profile?.service.status==="READY"&&service?.conversationCount===0?"暂无服务记录。":"尚未打开服务会话，可从历史会话查看记录。"}</p>:!conversation.detailReady?<p role={messageError?"alert":"status"}>{messageError?`服务记录读取失败：${messageError}`:"正在读取服务记录…"}{messageError&&<button className="l-btn sm" onClick={onRetryMessages}>重试服务记录</button>}</p>:conversation.messages.length?conversation.messages.slice(-4).reverse().map((message,index)=><div key={message.id??index}><small>{message.sourceSenderType==="SYSTEM"||message.sourceSenderType==="INTERNAL"?"系统":message.sender==="agent"?message.agentName||"历史顾问":conversation.customer||"客户"}{message.authorConfidence!=="VERIFIED"&&message.sourceSenderType!=="SYSTEM"&&message.sourceSenderType!=="INTERNAL"?" · 作者身份未确认":""} · {Number.isFinite(message.ts)&&message.ts>0?new Intl.DateTimeFormat("zh-CN",{dateStyle:"short",timeStyle:"short"}).format(message.ts):"时间未知"}</small><p style={{whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{message.kind==="IMAGE"?"[图片]":message.text||"服务记录无正文"}</p></div>):<p>暂无服务记录。</p>}</details>
    <details className="m3-profile-group"><summary>维护记录</summary>{maintenanceError?<p role="alert">{maintenanceError}<button onClick={()=>setReload(n=>n+1)}>重试维护记录</button></p>:!maintenance?<p>正在读取…</p>:<><Row label="维护执行次数" value={maintenance.totalExecutions}/><Row label="维护周期总数" value={maintenance.totalCycles}/>{maintenance.executions.map(r=><p key={r.id}>人工联系 · {dates(r.occurredAt)}</p>)}{maintenance.cycles.map(r=><p key={r.id}>{r.state==="SUCCEEDED"?"成功周期":r.state==="OPEN"?"等待新的有效活动":r.state==="STOPPED"?"已停止":r.state==="TRANSFERRED"?"已正式转绑":"待核对"} · {dates(r.occurredAt)}</p>)}{pager(maintenancePage,Math.max(maintenance.totalCycles,maintenance.totalExecutions),setMaintenancePage)}</>}</details>
    <details className="m3-profile-group"><summary>历史会话（{show(service?.conversationCount)}）</summary>{history.slice((historyPage-1)*10,historyPage*10).map(c=><button className="l-btn sm" key={c.id} onClick={()=>{setView360(false);onHistory(c.id);}}>{c.id} · {c.status==="open"?"进行中":"已结束"} · {c.owner}</button>)}{!history.length&&<p>暂无可读取的历史会话。</p>}{pager(historyPage,history.length,setHistoryPage)}</details>
    <details className="m3-profile-group"><summary>关联工单（{show(service?.ticketCount)}）</summary>{ctx.pget("I.support.ticketsAvailable")!=="1"?<p>当前工单读取不可用或无原工单权限。<a href="/service/tickets">前往工单台核对</a></p>:<>{tickets.slice((ticketPage-1)*10,ticketPage*10).map(t=><a className="l-btn sm" key={t.id} href={`/service/tickets?query=${encodeURIComponent(t.id)}`}>{t.id} · {t.contentRestricted?"私聊内容受限":t.subject}</a>)}{!tickets.length&&<p>暂无可读取关联工单。</p>}{pager(ticketPage,tickets.length,setTicketPage)}</>}</details>
    <details className="m3-profile-group"><summary>账户操作</summary>{[["resetPassword","重置密码","/users/security"],["freeze","冻结账户","/users/actions"],["unfreeze","恢复账户","/users/actions"],["adjustBalance","资金调整","/users/assets"]].map(([key,label,path])=><div key={key}>{profile?.actions[key]?.allowed&&identity?.userNo?<a className="l-btn sm" href={`${path}?userCode=${encodeURIComponent(String(identity.userNo))}&userId=${encodeURIComponent(customerId)}&returnTo=${encodeURIComponent("/service/sessions?customerId="+customerId)}`}>{label}</a>:<button className="l-btn sm" disabled>{label} · 需要原模块操作权限</button>}</div>)}{[["提现记录","hub-withdrawal"],["设备明细","hub-devices"]].map(([label,anchor])=><div key={anchor}>{canReadAccount?<a className="l-btn sm" href={`/users/search/${encodeURIComponent(customerId)}#${anchor}`}>{label}</a>:<button className="l-btn sm" disabled>{label} · 需要原账户资料权限</button>}</div>)}</details>
    <small>资料读取时间：{dates(profile?.identity.evaluatedAt)}</small>
  </div>;
  return view360 ? <Modal title="客户服务 360" icon="users" wide onClose={()=>setView360(false)} footer={<button className="btn btn-sec btn-sm" onClick={()=>setView360(false)}>返回会话</button>}>{body}</Modal> : <><button className="l-btn sm" onClick={()=>setView360(true)}>打开服务 360</button>{body}</>;
}
