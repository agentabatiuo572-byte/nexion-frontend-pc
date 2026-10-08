"use client";

import { useEffect, useRef, useState } from "react";
import { supportClient, isIndeterminateSupportError, type SupportAgentCandidate, type SupportBindingPoolItem, type SupportPoolReason } from "../../../../lib/admin/m-support-client";
import { Modal } from "../design-kit";
import { createPendingMutationStore } from "../../../../lib/admin/pending-mutation-store";
import { parseBusinessTime } from "../../../../lib/admin/business-time";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import type { MSupportPermission } from "./m5-service-rules";
import "./m-support-admin.css";
import { SupportRandomAssignment, hasPendingRandomAssignment } from "./support-random-assignment";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";

const PAGE_SIZE = 8;
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };
const POOL_REASONS: Record<SupportPoolReason, string> = {
  NO_INVITER: "无邀请人", INVITER_UNBOUND: "邀请人未绑定", DEPTH_LIMIT: "继承层数已达上限", RULE_UNCONFIGURED: "继承规则未配置", AGENT_UNAVAILABLE: "顾问暂不可接新继承", MIGRATION_REVIEW: "存量关系待核对",
};

type PoolPage = Awaited<ReturnType<typeof supportClient.bindingPool>>;
type AgentPage = Awaited<ReturnType<typeof supportClient.agents>>;
type TransferPayload = Parameters<typeof supportClient.transfer>[0];
type PoolPendingRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; payload: TransferPayload; selected: SupportBindingPoolItem[]; target: SupportAgentCandidate };
const poolCommands = createPendingMutationStore<PoolPendingRecord>({ storageKey: "nexion-admin-m-pool-transfer-v1", isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Array.isArray(row.payload.customers) && Array.isArray(row.selected) && row.target) });

export function isAssignable(agent: SupportAgentCandidate): boolean {
  return agent.enabled && agent.seatType === "DEDICATED" && agent.serviceTypes.includes("advisor");
}

function errorText(error: unknown): string {
  if (isIndeterminateSupportError(error)) return "分配结果待确认，请查询原命令或用原命令重试。";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号无权查看或分配待绑定客户。";
  if (status === 409) return "客户或顾问状态已变化，已保留选择。请刷新预览后重新确认。";
  return "待绑定服务暂不可用，请重试；没有提交任何分配。";
}

export function M1SupervisorPool({ permission }: { permission: MSupportPermission }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const [page, setPage] = useState(1);
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [reasonFilter, setReasonFilter] = useState<SupportPoolReason | "">("");
  const [pool, setPool] = useState<PoolPage | null>(null);
  const [agents, setAgents] = useState<AgentPage | null>(null);
  const [agentPage, setAgentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [agentsError, setAgentsError] = useState("");
  const [reload, setReload] = useState(0);
  const [agentsReload, setAgentsReload] = useState(0);
  const [selected, setSelected] = useState<Map<string, SupportBindingPoolItem>>(() => new Map());
  const [staleIds, setStaleIds] = useState<Set<string>>(() => new Set());
  const [confirm, setConfirm] = useState(false);
  const [randomCustomers,setRandomCustomers]=useState<SupportBindingPoolItem[]|null>(null);
  const [target, setTarget] = useState<SupportAgentCandidate | null>(null);
  const [assignmentReason, setAssignmentReason] = useState("");
  const [pending, setPending] = useState<{ key: string; payload: Parameters<typeof supportClient.transfer>[0] } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const record = poolCommands.list().find((row) => row.actorId === adminId);
    if (!record) return;
    setPending({ key: record.commandKey, payload: record.payload });
    setSelected(new Map(record.selected.map((item) => [item.customerId, item])));
    setTarget(record.target); setAssignmentReason(record.payload.reason);
  }, [adminId]);

  useEffect(() => {
    if (permission === "agent") return;
    const controller = new AbortController();
    setLoading(true);
    supportClient.bindingPool({ pageNum: page, pageSize: PAGE_SIZE, keyword: keyword || undefined, reason: reasonFilter || undefined, signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setPool(result); setError("");
        setSelected((prior) => {
          const next = new Map(prior);
          for (const item of result.records) if (next.has(item.customerId)) next.set(item.customerId, item);
          return next;
        });
        setStaleIds((prior) => {
          const next = new Set(prior);
          for (const item of result.records) next.delete(item.customerId);
          return next;
        });
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, keyword, reasonFilter, reload, permission]);

  useEffect(() => {
    if (permission === "agent") return;
    const controller = new AbortController();
    setAgentsLoading(true);
    supportClient.agents({ pageNum: agentPage, pageSize: 100, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setAgents(result); setAgentsError(""); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setAgentsError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setAgentsLoading(false); });
    return () => controller.abort();
  }, [agentPage, agentsReload, permission]);

  const records = pool?.records ?? [];
  const visibleSelected = records.filter((item) => selected.has(item.customerId)).length;
  const wholePageSelected = records.length > 0 && visibleSelected === records.length;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = visibleSelected > 0 && !wholePageSelected; }, [visibleSelected, wholePageSelected]);
  const candidates = (agents?.records ?? []).filter(isAssignable);
  const targetFresh = Boolean(target && candidates.some((agent) => agent.adminId === target.adminId && agent.version === target.version));
  const reasonOk = assignmentReason.trim().length >= 8 && assignmentReason.trim().length <= 200;
  const canSubmit = permission !== "agent" && !loading && !agentsLoading && !error && !agentsError && Boolean(pool) && Boolean(agents) && targetFresh && selected.size > 0 && selected.size <= 100 && staleIds.size === 0 && reasonOk && !saving;

  function toggle(item: SupportBindingPoolItem) {
    if (pending || saving) return;
    setSelected((prior) => {
      const next = new Map(prior);
      if (next.has(item.customerId)) next.delete(item.customerId);
      else if (next.size < 100) next.set(item.customerId, item);
      return next;
    });
    setStaleIds((prior) => { const next = new Set(prior); next.delete(item.customerId); return next; });
  }

  function toggleVisible() {
    if (pending || saving) return;
    setSelected((prior) => {
      const next = new Map(prior);
      if (wholePageSelected) for (const item of records) next.delete(item.customerId);
      else for (const item of records) if (next.size < 100) next.set(item.customerId, item);
      return next;
    });
    if (wholePageSelected) setStaleIds((prior) => { const next = new Set(prior); for (const item of records) next.delete(item.customerId); return next; });
  }

  function openFor(item?: SupportBindingPoolItem) {
    if (pending && item) return;
    if (item) { setSelected(new Map([[item.customerId, item]])); setStaleIds(new Set()); setTarget(null); setAssignmentReason(""); }
    if (!item && selected.size === 0) return;
    setConfirm(true); setError("");
  }

  async function assign() {
    if ((!canSubmit && !pending) || saving || !target || !adminId) return;
    const actor = actorStamp();
    const command = pending ?? {
      key: crypto.randomUUID(),
      payload: { targetAgentAdminId: target.adminId, customers: [...selected.values()].map((item) => ({ id: item.customerId, expectedAssignmentId: null, expectedVersion: item.version })), reason: assignmentReason.trim() },
    };
    const fingerprint = `pool-transfer:${command.payload.customers.map((item) => item.id).sort().join(",")}`;
    if (!pending) poolCommands.remember(fingerprint, command.key, { actorId: adminId, payload: command.payload, selected: [...selected.values()], target });
    setSaving(true); setError("");
    try {
      await supportClient.transfer(command.payload, command.key);
      if (actor !== actorStamp()) return;
      poolCommands.forget(fingerprint);
      window.dispatchEvent(new Event("support-todo-changed"));
      setSelected(new Map()); setStaleIds(new Set()); setPending(null); setTarget(null); setAssignmentReason(""); setConfirm(false); setReload((n) => n + 1);
    } catch (cause) {
      if (actor !== actorStamp()) return;
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      setError(errorText(cause));
      if (status === 409 && !isIndeterminateSupportError(cause)) {
        poolCommands.forget(fingerprint);
        setPending(null); setStaleIds(new Set(selected.keys()));
      } else if (![400, 401, 403, 422].includes(status)) {
        setPending(command);
      } else { poolCommands.forget(fingerprint); setPending(null); }
    } finally { setSaving(false); }
  }

  async function checkPending() {
    if (!pending || saving) return;
    const actor = actorStamp();
    setSaving(true);
    try {
      const result = await supportClient.command(pending.key);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED") {
        const refreshed = await supportClient.bindingPool({ pageNum: page, pageSize: PAGE_SIZE, keyword: keyword || undefined, reason: reasonFilter || undefined });
        if (actor !== actorStamp()) return;
        poolCommands.forget(`pool-transfer:${pending.payload.customers.map((item) => item.id).sort().join(",")}`);
        setPool(refreshed); setSelected(new Map()); setStaleIds(new Set()); setPending(null); setTarget(null); setAssignmentReason(""); setConfirm(false); setError("");
      } else if (result.status === "FAILED") {
        poolCommands.forget(`pool-transfer:${pending.payload.customers.map((item) => item.id).sort().join(",")}`);
        setPending(null); setConfirm(false); setError("原分配命令已失败，所选客户与理由已保留；请刷新预览后重新提交。");
      } else setError("原分配命令仍在处理中，请稍后查询或使用同一命令重试。");
    } catch { if (actor === actorStamp()) setError("暂时无法确认原分配结果；所选客户与命令已保留。"); }
    finally { setSaving(false); }
  }

  if (permission === "agent") return <div className="m-admin-error">仅客服主管或超管可查看待绑定客户池。</div>;
  return <section className="m-admin-grid" aria-label="待绑定客户池">
    <div className="m-admin-panel">
      <h2>待绑定客户池</h2>
      {adminId&&hasPendingRandomAssignment(adminId)&&<button className="btn btn-sec btn-sm" onClick={()=>setRandomCustomers([])}>查询上次随机分配结果</button>}
      <div className="m-admin-muted">选择明确的客户后分配给一位专属顾问。未选客户保持原状。</div>
      <div className="m-admin-toolbar">
        <form onSubmit={(event) => { event.preventDefault(); setPage(1); setKeyword(keywordInput.trim()); }}><input aria-label="搜索客户 ID 或留言关键词" value={keywordInput} disabled={Boolean(pending)} onChange={(event) => setKeywordInput(event.target.value)} placeholder="搜索客户 ID 或留言关键词" /><button type="submit" className="btn btn-sec btn-sm" disabled={Boolean(pending)}>搜索</button></form>
        <select aria-label="筛选入池原因" value={reasonFilter} disabled={Boolean(pending)} onChange={(event) => { setPage(1); setReasonFilter(event.target.value as SupportPoolReason | ""); }}><option value="">全部入池原因</option>{Object.entries(POOL_REASONS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        {(keyword || reasonFilter) && <button type="button" className="btn btn-sec btn-sm" disabled={Boolean(pending)} onClick={() => { setKeywordInput(""); setKeyword(""); setReasonFilter(""); setPage(1); }}>清除筛选</button>}
      </div>
      {error && <div role="alert" className="m-admin-error">{error} <button type="button" className="btn btn-sec btn-sm" disabled={Boolean(pending)} onClick={() => setReload((n) => n + 1)}>重试读取</button></div>}
      {pending && <div role="alert" className="m-admin-error">上次分配结果未确认，已锁定原客户范围与命令。<button type="button" className="btn btn-sec btn-sm" onClick={() => setConfirm(true)}>继续确认上次分配</button></div>}
      {loading && <div role="status" className="m-admin-muted">正在读取待绑定客户…</div>}
      {!loading && pool && !error && <>
        {records.length === 0 ? <div className="m-admin-muted">当前没有匹配的待分配客户。可清除筛选查看全部。</div> : <div className="m-admin-table-wrap"><table className="m-admin-table"><thead><tr><th><input ref={selectAllRef} type="checkbox" checked={wholePageSelected} disabled={Boolean(pending)} onChange={toggleVisible} aria-label="选择或取消当前页客户" /></th><th>客户</th><th>入池原因</th><th>等待起点</th><th>客户留言</th><th>操作</th></tr></thead><tbody>{records.map((item) => <tr key={item.customerId}>
          <td><input type="checkbox" checked={selected.has(item.customerId)} disabled={Boolean(pending)} onChange={() => toggle(item)} aria-label={`选择客户 ${item.customerNo || item.customerId}`} /></td>
          <td data-label="客户"><strong>{item.displayName || item.customerNo || item.customerId}</strong><div className="m-admin-muted">ID {item.customerId}</div></td>
          <td data-label="入池原因">{POOL_REASONS[item.reason]}<div className="m-admin-muted">{item.autoEligible==null?"自动处理资格未知":item.autoEligible?"当前可自动重试":"需主管处理"} · 尝试 {item.attempts??"未知"} 次</div><div className="m-admin-muted">最近尝试：{item.lastAttemptAt?new Date(parseBusinessTime(item.lastAttemptAt)).toLocaleString("zh-CN"):"尚无记录"} · {item.autoAttemptState==="ASSIGNED"?"已分配":item.autoAttemptState==="WAITING_CANDIDATE"?"等待合格候选，将按规则重试":item.autoAttemptState==="PAUSED"?"已暂停，需核对分配模式":item.autoAttemptState==="NONE"?"历史记录需明确处理":"状态待核对"}</div><div className="m-admin-muted">最近结果：{item.lastOutcome==="NO_CANDIDATE"?"暂无合格候选":item.lastOutcome==="ASSIGNED"?"已成功分配":item.lastOutcome==="SUPERVISOR_MODE"?"当前由主管处理":item.lastOutcome?"需刷新资料后核对":"尚无结果"}</div></td><td data-label="等待起点">{item.enteredAt ? new Date(parseBusinessTime(item.enteredAt)).toLocaleString("zh-CN") : "待核对"}</td><td data-label="客户留言">{item.pendingMessageCount == null ? "信息不可用" : `${item.pendingMessageCount} 条`}</td>
          <td data-label="操作"><button type="button" className="btn btn-sec btn-sm" disabled={Boolean(pending)} onClick={() => openFor(item)}>分配此客户</button></td>
        </tr>)}</tbody></table></div>}
        <div className="m-admin-toolbar"><span className="m-admin-muted">已明确选择 {selected.size} 位客户；本页 {visibleSelected}/{records.length} 位 · 共 {pool.total} 位待分配</span><button type="button" className="btn btn-pri btn-sm" disabled={selected.size === 0 || selected.size > 100 || (staleIds.size > 0 && !pending)} onClick={() => openFor()}>{pending ? "继续确认上次分配" : `批量分配已选 ${selected.size} 位`}</button></div>
        <div className="m-admin-toolbar"><button type="button" className="btn btn-sec btn-sm" disabled={page <= 1 || Boolean(pending)} onClick={() => setPage((n) => n - 1)}>上一页</button><span className="m-admin-muted">第 {page} / {Math.max(1, Math.ceil(pool.total / PAGE_SIZE))} 页</span><button type="button" className="btn btn-sec btn-sm" disabled={page >= Math.ceil(pool.total / PAGE_SIZE) || Boolean(pending)} onClick={() => setPage((n) => n + 1)}>下一页</button></div>
      </>}
    </div>
    <aside className="m-admin-panel"><h2>分配范围</h2><div className="m-admin-muted">只操作逐项勾选的客户；每位成功分配的客户成为新继承段 0 层起点。</div><div className="m-admin-stats"><div className="m-admin-stat">已选客户<strong>{selected.size}</strong></div><div className="m-admin-stat">本页选择<strong>{visibleSelected}</strong></div><div className="m-admin-stat">单次上限<strong>100</strong></div></div><div className="m-admin-muted">每次最多分配 100 位客户；顾问绑定总人数不受此限制。顾问忙碌或离线时不会自动改派。</div><button className="btn btn-pri btn-sm" disabled={!selected.size||selected.size>100||Boolean(pending)||staleIds.size>0} onClick={()=>setRandomCustomers([...selected.values()])}>预览已选客户随机分配</button><p className="m-admin-muted">明确确认后才处理历史池，不影响未选客户或已有下级。</p></aside>
    {randomCustomers&&<SupportRandomAssignment customers={randomCustomers} onClose={()=>setRandomCustomers(null)} onDone={()=>{setSelected(new Map());setReload(n=>n+1);window.dispatchEvent(new Event("support-todo-changed"));}}/>}
    {confirm && <Modal title="确认分配客户" icon="users" wide busy={saving} onClose={() => { if (!saving) setConfirm(false); }} footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => setConfirm(false)}>返回</button><button type="button" className="btn btn-pri btn-sm" disabled={(!canSubmit && !pending) || saving} onClick={() => void assign()}>{saving ? "分配中…" : pending ? "使用同一命令重试" : `确认分配 ${selected.size} 位`}</button></>}>
      <div className="m-admin-muted">本次只分配下列实际选中客户；每位客户开启新的 0 层继承段，其他客户不变。</div>
      <div className="m-admin-list">{[...selected.values()].map((item) => <div key={item.customerId}>客户 ID {item.customerId}{item.customerNo ? ` · ${item.customerNo}` : ""} · {POOL_REASONS[item.reason]}</div>)}</div>
      {staleIds.size > 0 && <div className="m-admin-error" role="alert">{staleIds.size} 位已选客户版本需要刷新。选择已保留，请逐页重新读取或取消失效选择后再次确认。<button type="button" className="btn btn-sec btn-sm" onClick={() => setReload((n) => n + 1)}>刷新本页预览</button></div>}
      <label className="field"><span>选择接待顾问</span><select value={target?.adminId ?? ""} disabled={agentsLoading || Boolean(pending) || saving} onChange={(event) => setTarget(candidates.find((agent) => agent.adminId === Number(event.target.value)) ?? null)}><option value="">请选择专属顾问</option>{target && !candidates.some((agent) => agent.adminId === target.adminId) && <option value={target.adminId}>{target.name} · 已选顾问</option>}{candidates.map((agent) => <option key={agent.adminId} value={agent.adminId}>{agent.name}{agent.busy ? " · 忙碌" : ""}</option>)}</select></label>
      {agentsLoading && <div role="status" className="m-admin-muted">正在读取顾问…</div>}
      {agentsError && <div className="m-admin-error" role="alert">顾问列表不可用。<button type="button" className="btn btn-sec btn-sm" onClick={() => setAgentsReload((n) => n + 1)}>重试</button></div>}
      {!agentsLoading && !agentsError && candidates.length === 0 && <div className="m-admin-error">本页没有可分配的专属顾问，请翻页或先配置顾问资格。</div>}
      {agents && agents.total > 100 && <div className="m-admin-toolbar"><button type="button" className="btn btn-sec btn-sm" disabled={agentPage <= 1 || Boolean(pending)} onClick={() => setAgentPage((n) => n - 1)}>上一页顾问</button><span className="m-admin-muted">顾问第 {agentPage} / {Math.ceil(agents.total / 100)} 页</span><button type="button" className="btn btn-sec btn-sm" disabled={agentPage >= Math.ceil(agents.total / 100) || Boolean(pending)} onClick={() => setAgentPage((n) => n + 1)}>下一页顾问</button></div>}
      {target && <><SupportAvatar name={target.name} path={target.avatarAssetId?advisorAvatarPath(target.adminId):undefined} version={target.avatarVersion}/><div className="m-admin-stats"><div className="m-admin-stat">已绑定客户<strong>{target.assignedUserCount}</strong></div><div className="m-admin-stat">当前会话负载<strong>{target.currentActiveSessions ?? "不可用"}</strong></div><div className="m-admin-stat">会话并发上限<strong>{target.maxConcurrent}</strong></div></div></>}
      {target && !targetFresh && <div className="m-admin-error" role="alert">已选顾问不在当前有效名单或资料已变化，请返回相应页重新选择。</div>}
      {target && <div className="m-admin-muted">顾问当前{target.busy ? "忙碌" : "可接待"}；忙碌或离线不会自动改派。绑定人数没有额外上限。</div>}
      <label className="field"><span>分配原因（8–200 字）</span><textarea value={assignmentReason} maxLength={200} disabled={saving || Boolean(pending)} onChange={(event) => setAssignmentReason(event.target.value)} placeholder="说明本次分配的原因" /></label><div className="m-admin-muted">已输入 {assignmentReason.trim().length}/200 字</div>
      {!reasonOk && <div className="m-admin-muted">填写 8–200 字原因后才能确认。</div>}
      {pending && <div className="m-admin-error" role="alert">上次提交结果尚未确认；客户范围和目标顾问已锁定。<button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => void checkPending()}>查询上次结果</button></div>}
      {error && <div className="m-admin-error" role="alert">{error}</div>}
    </Modal>}
  </section>;
}
