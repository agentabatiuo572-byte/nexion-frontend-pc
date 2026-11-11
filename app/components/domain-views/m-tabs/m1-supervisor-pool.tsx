"use client";
import { m1CustomerCode } from "./m1-customer-code";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

import { useEffect, useRef, useState } from "react";
import { Users } from "lucide-react";
import { supportClient, isIndeterminateSupportError, type SupportAgentCandidate, type SupportBindingPoolItem, type SupportPoolReason } from "../../../../lib/admin/m-support-client";
import { Modal, Button, BatchBar, BlockState, Checkbox, Drawer, Explain, Facts, Fact, Field, FilterBar, FilterField, Fold, Input, MoreMenu, Notice, Panel, Select, StatusTag, Table, Th, Tr, Td, Textarea } from "@/app/components/rd";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { createPendingMutationStore } from "../../../../lib/admin/pending-mutation-store";
import { businessZone, parseBusinessTime } from "../../../../lib/admin/business-time";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import type { MSupportPermission } from "./m5-service-rules";
import "./m-support-admin.css";
import { SupportRandomAssignment, hasPendingRandomAssignment } from "./support-random-assignment";
import { compactSupportBoardValue } from "./support-leaderboard";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { supportGroupClient, type SupportGroup } from "../../../../lib/admin/support-group-client";
import { setSupportPoolRoute, parseSupportPoolRouteResult, readSupportPoolCustomer, verifySupportTransfer, type SupportRouteInput, type SupportReadMode } from "../../../../lib/admin/m-support-client";

const PAGE_SIZE = 8;
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };
const POOL_REASONS: Record<SupportPoolReason, string> = {
  NO_INVITER: "无邀请人", INVITER_UNBOUND: "邀请人未绑定", DEPTH_LIMIT: "已达自动继承的邀请次数上限", RULE_UNCONFIGURED: "继承规则未配置", AGENT_UNAVAILABLE: "专属客服暂不可接新继承", MIGRATION_REVIEW: "历史归属需人工确认",
};

type PoolPage = Awaited<ReturnType<typeof supportClient.bindingPool>>;
type AgentPage = Awaited<ReturnType<typeof supportClient.agents>>;
type TransferPayload = Parameters<typeof supportClient.transfer>[0];
type PoolPendingRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; groupId?: number; payload: TransferPayload; selected: SupportBindingPoolItem[]; target: SupportAgentCandidate };
export const poolCommands = createPendingMutationStore<PoolPendingRecord>({ storageKey: "nexion-admin-m-pool-transfer-v1", ttlMs: Math.floor(Number.MAX_SAFE_INTEGER / 2), retainExpiredRecords: true, isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Array.isArray(row.payload.customers) && Array.isArray(row.selected) && row.target) });
type RoutePending = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; item: SupportBindingPoolItem; payload: SupportRouteInput };
export const routeCommands = createPendingMutationStore<RoutePending>({ storageKey: "nexion-admin-support-pool-route-v1", ttlMs: Math.floor(Number.MAX_SAFE_INTEGER / 2), retainExpiredRecords: true, isValidRecord: row => Boolean(Number.isSafeInteger(row.actorId) && row.item?.customerId && row.payload && typeof row.payload.reason === "string") });

export function isAssignable(agent: SupportAgentCandidate): boolean {
  return agent.assignmentEligible === true;
}

export function PoolRouteModal({ item, groups, onClose, onDone }: { item: SupportBindingPoolItem; groups: SupportGroup[]; onClose: () => void; onDone: () => void }) {
  const adminId = useAdminAuth(state => state.session?.adminId);
  const [pending, setPending] = useState(() => routeCommands.list().find(row => row.actorId === adminId && row.item.customerId === item.customerId) ?? null);
  const [targetId, setTargetId] = useState(pending?.payload.targetGroupId ?? "");
  const [reason, setReason] = useState(pending?.payload.reason ?? "");
  const [versions, setVersions] = useState<{ source: number | null; target: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [requiresFreshPool, setRequiresFreshPool] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (pending || requiresFreshPool) return;
    const controller = new AbortController(); setVersions(null); setError("");
    Promise.all([item.routeGroupId ? supportGroupClient.detail(item.routeGroupId, controller.signal) : null, targetId ? supportGroupClient.detail(targetId, controller.signal) : null])
      .then(([source, target]) => { if (!controller.signal.aborted) { if (target && target.group.status !== "ENABLED") throw new Error("TARGET_UNAVAILABLE"); setVersions({ source: source?.group.version ?? null, target: target?.group.version ?? null }); } })
      .catch(cause => { if (!controller.signal.aborted) setError(errorText(cause)); });
    return () => controller.abort();
  }, [item.routeGroupId, targetId, pending, reload, requiresFreshPool]);
  const reasonLength = Array.from(reason.trim()).length;
  const canSave = !pending && !requiresFreshPool && !busy && !error && Boolean(versions) && item.routeState !== "UNKNOWN" && (targetId || null) !== item.routeGroupId && reasonLength >= 8 && reasonLength <= 200;
  async function verifyRouteFacts(record: RoutePending, receipt: ReturnType<typeof parseSupportPoolRouteResult>) {
    const current = await readSupportPoolCustomer(record.item.customerId);
    if (current.routeGroupId) await supportGroupClient.detail(current.routeGroupId);
    const matches = current.routeState === "AVAILABLE" && current.customerId === receipt.customerId && current.routeId === receipt.id && current.routeGroupId === receipt.groupId && current.routeVersion === receipt.version && current.routeVersion > record.payload.expectedRouteVersion;
    if (!matches) throw new Error("SUPPORT_ROUTE_RECOVERY_FACTS_CHANGED");
  }
  async function save() {
    if (!canSave || !versions || !adminId || inFlight.current || routeCommands.list().some(row => row.actorId === adminId && row.item.customerId === item.customerId)) return;
    const stamp = actorStamp();
    const payload: SupportRouteInput = { targetGroupId: targetId || null, expectedRouteVersion: item.routeState === "ABSENT" ? 0 : item.routeVersion!, sourceGroupVersion: versions.source, targetGroupVersion: versions.target, reason: reason.trim() };
    const fingerprint = `pool-route:${item.customerId}`, commandKey = crypto.randomUUID();
    routeCommands.remember(fingerprint, commandKey, { actorId: adminId, item, payload });
    const record = routeCommands.list().find(row => row.commandKey === commandKey)!;
    if (!routeCommands.isDurablyStored(fingerprint, commandKey)) { routeCommands.forget(fingerprint, commandKey); setError("暂时无法保存命令，未提交调整。请恢复浏览器存储后重试。"); return; }
    inFlight.current = true; setBusy(true);
    try {
      const receipt = await setSupportPoolRoute(item.customerId, payload, commandKey);
      if (stamp !== actorStamp() || !mounted.current) return;
      await verifyRouteFacts(record, receipt);
      if (stamp !== actorStamp() || !mounted.current || record.actorId !== useAdminAuth.getState().session?.adminId) return;
      routeCommands.forget(fingerprint, commandKey); onDone();
    } catch (cause) {
      if (stamp !== actorStamp() || !mounted.current) return;
      setPending(record); setVersions(null); setError("调整结果尚未确认，原命令与理由已保留，请查询结果。");
    } finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  async function check() {
    if (!pending || inFlight.current) return;
    const stamp = actorStamp(); inFlight.current = true; setBusy(true);
    try {
      const result = await supportClient.command(pending.commandKey);
      if (stamp !== actorStamp() || !mounted.current) return;
      if (result.status === "SUCCEEDED" || result.status === "FAILED") {
        if (result.status === "SUCCEEDED") await verifyRouteFacts(pending, parseSupportPoolRouteResult(result.result, pending.item.customerId, pending.payload));
        if (stamp !== actorStamp() || !mounted.current || pending.actorId !== useAdminAuth.getState().session?.adminId) return;
        routeCommands.forget(pending.fingerprint, pending.commandKey);
        if (result.status === "SUCCEEDED") onDone();
        else { setPending(null); setVersions(null); setRequiresFreshPool(true); setError("原调整已确认失败；请返回客户池读取最新资料后重新确认。"); }
      }
      else setError("原调整仍待确认，请稍后继续查询。");
    } catch (cause) { if (stamp === actorStamp() && mounted.current) setError("暂时无法确认原调整结果，原命令与理由已保留。"); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }
  if (pending) return <Modal title="查询未确认的组范围调整" icon={Users} busy={busy} onClose={onClose} footer={<><Button size="sm" disabled={busy} onClick={onClose}>返回</Button><Button variant="primary" disabled={busy} onClick={() => void check()}>查询原调整结果</Button></>}><Notice tone="warn">存在尚未核对的调整，原对象与内容已锁定。</Notice><Facts><Fact k="客户">{m1CustomerCode(pending.item.customerId)}</Fact><Fact k="原组">{groups.find(g => g.id === pending.item.routeGroupId)?.name || "未分组"}</Fact><Fact k="目标组">{groups.find(g => g.id === pending.payload.targetGroupId)?.name || "未分组"}</Fact><Fact k="原理由">{pending.payload.reason}</Fact></Facts><Fold title="技术信息" summary="原命令和版本"><Facts><Fact k="原命令号">{pending.commandKey}</Fact><Fact k="路由版本">{pending.payload.expectedRouteVersion}</Fact><Fact k="源组版本">{pending.payload.sourceGroupVersion ?? "—"}</Fact><Fact k="目标组版本">{pending.payload.targetGroupVersion ?? "—"}</Fact></Facts></Fold>{error && <p role="alert">{error}</p>}</Modal>;
  if (requiresFreshPool) return <Modal title="返回客户池重新确认" icon={Users} onClose={onDone} footer={<><Button size="sm" onClick={onDone}>返回</Button></>}><p role="alert">{error}</p></Modal>;
  return <Modal title="调整待绑定客户组范围" icon={Users} busy={busy} onClose={onClose} footer={<><Button size="sm" disabled={busy} onClick={onClose}>返回</Button><Button variant="primary" disabled={busy} disabledReason={!canSave ? "请选择不同目标组并填写 8–200 字理由，等待读回版本" : undefined} onClick={() => void save()}>确认调整</Button></>}>
    <div className="m1-command-form">
    <p>客户 {operatorNicknameText(item.displayName || "") || item.customerNo || item.customerId}；当前范围：{item.routeState === "UNKNOWN" ? "资料未同步" : groups.find(group => group.id === item.routeGroupId)?.name || "未分组"}。调整范围后仍须明确分配给专属客服。</p>
    <Facts><Fact k="客户">{operatorNicknameText(item.displayName || "") || item.customerNo || item.customerId}</Fact><Fact k="当前范围">{groups.find(g => g.id === item.routeGroupId)?.name || "未分组"}</Fact><Fact k="调整到">{groups.find(g => g.id === targetId)?.name || "未分组"}</Fact></Facts>
    <Field label="目标组"><Select aria-label="目标客服组" value={targetId} disabled={busy || Boolean(pending)} onChange={setTargetId} options={[{ value: "", label: "未分组" }, ...groups.filter(g => g.status === "ENABLED").map(g => ({ value: g.id, label: g.name }))]} /></Field>
    <Field label="调整理由" required help="请填写 8–200 字，将记入操作记录。"><Textarea value={reason} maxLength={200} count={`${reasonLength}/200`} disabled={busy || Boolean(pending)} onChange={event => setReason(event.target.value)} /></Field>
    {pending ? <Button size="sm" disabled={busy} onClick={() => void check()}>查询原调整结果</Button> : !versions && !error ? <p role="status">正在加载分组资料…</p> : null}
    {error && <p role="alert" className="m-admin-error">{error}{!pending && !requiresFreshPool && <Button size="sm" disabled={busy} onClick={() => setReload(n => n + 1)}>重读组资料</Button>}</p>}
    </div>
  </Modal>;
}

function errorText(error: unknown, reading = false): string {
  if (reading) {
    const status = error instanceof Error && "status" in error ? Number(error.status) : 0;
    return status === 401 ? "登录已失效，请重新登录后读取待分配资料。" : status === 403 ? "当前账号无权读取待分配资料，请核对获准范围。" : "待分配资料读取失败，请重新读取。";
  }
  if (error instanceof Error && "backendMessage" in error && typeof error.backendMessage === "string" && ADMIN_ERROR_MESSAGES[error.backendMessage]) return displayAdminError(error);
  if (isIndeterminateSupportError(error)) return "分配结果待确认，请查询原命令。";
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号无权查看或分配待绑定客户。";
  if (status === 409) return "客户或专属客服状态已变化，已保留选择。请刷新预览后重新确认。";
  return "待绑定服务暂不可用，请重试；没有提交任何分配。";
}

export function M1SupervisorPool({ permission, initialGroupId }: { permission: MSupportPermission; initialGroupId?: number }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const hasWrite = useAdminAuth(state => Boolean(state.session?.authorities.includes("service_m1_write")));
  const isSuper = useAdminAuth(state => state.session?.role === "super" || state.session?.role === "superadmin");
  const [poolDetail, setPoolDetail] = useState<SupportBindingPoolItem | null>(null);
  const [assignmentCustomers, setAssignmentCustomers] = useState<SupportBindingPoolItem[]>([]);
  const [reasonLeft, setReasonLeft] = useState(false);
  const [scope, setScope] = useState<{ mode: SupportReadMode; groups: SupportGroup[] } | null>(null);
  const [scopeError, setScopeError] = useState("");
  const [scopeReload, setScopeReload] = useState(0);
  const [groupId, setGroupId] = useState<number | undefined>(initialGroupId);
  const [routeItem, setRouteItem] = useState<SupportBindingPoolItem | null>(null);
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
  const [failedReason, setFailedReason] = useState<string | null>(null);
  const [pending, setPending] = useState<{ key: string; payload: Parameters<typeof supportClient.transfer>[0] } | null>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const assignmentInFlight = useRef(false);
  useEffect(() => {
    setFailedReason(null);
    const record = poolCommands.list().find((row) => row.actorId === adminId);
    if (!record) { setPending(null); setSelected(new Map()); setTarget(null); return; }
    setGroupId(record.groupId);
    setPending({ key: record.commandKey, payload: record.payload });
    setSelected(new Map(record.selected.map((item) => [item.customerId, item])));
    setAssignmentCustomers(record.selected); setTarget(record.target); setAssignmentReason(record.payload.reason);
  }, [adminId, authEpoch]);

  useEffect(() => {
    if (permission === "agent") return;
    const controller = new AbortController();
    setScope(null); setScopeError(""); setPool(null); setAgents(null); setRouteItem(null);
    Promise.all([supportClient.overview({ signal: controller.signal }), supportGroupClient.groups(controller.signal)])
      .then(([overview, groups]) => {
        if (controller.signal.aborted) return;
        if (overview.scope.mode === "PERSONAL") throw new Error("MANAGEMENT_SCOPE_REQUIRED");
        setScope({ mode: overview.scope.mode, groups });
      }).catch(cause => { if (!controller.signal.aborted) setScopeError(errorText(cause)); });
    return () => controller.abort();
  }, [permission, adminId, authEpoch, scopeReload]);

  const readableScope = Boolean(scope && (scope.mode === "ALL" || scope.groups.length > 0) && (groupId === undefined || scope.groups.some(group => Number(group.id) === groupId)));

  useEffect(() => {
    if (permission === "agent" || !readableScope) return;
    const controller = new AbortController();
    setLoading(true);
    setPool(null);
    supportClient.bindingPool({ pageNum: page, pageSize: PAGE_SIZE, groupId, keyword: keyword || undefined, reason: reasonFilter || undefined, signal: controller.signal })
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
      }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(errorText(cause, true)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, keyword, reasonFilter, reload, permission, groupId, readableScope, scope, authEpoch]);

  useEffect(() => {
    if (permission === "agent" || !readableScope) return;
    const controller = new AbortController();
    setAgentsLoading(true);
    setAgents(null);
    supportClient.agents({ pageNum: agentPage, pageSize: 100, groupId, signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setAgents(result); setAgentsError(""); } })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setAgentsError(errorText(cause)); })
      .finally(() => { if (!controller.signal.aborted) setAgentsLoading(false); });
    return () => controller.abort();
  }, [agentPage, agentsReload, permission, groupId, readableScope, scope, authEpoch]);

  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending, confirm, routeItem, randomCustomers]);
  const records = pool?.records ?? [];
  const visibleSelected = records.filter((item) => selected.has(item.customerId)).length;
  const wholePageSelected = records.length > 0 && visibleSelected === records.length;
  useEffect(() => { if (selectAllRef.current) selectAllRef.current.indeterminate = visibleSelected > 0 && !wholePageSelected; }, [visibleSelected, wholePageSelected]);
  const candidates = (agents?.records ?? []).filter(isAssignable);
  const targetFresh = Boolean(target && candidates.some((agent) => agent.adminId === target.adminId && agent.version === target.version));
  const reasonOk = assignmentReason.trim().length >= 8 && assignmentReason.trim().length <= 200;
  const canSubmit = !hasPendingRandomAssignment(adminId ?? 0) && hasWrite && permission !== "agent" && !loading && !agentsLoading && !error && !agentsError && Boolean(pool) && Boolean(agents) && targetFresh && assignmentCustomers.length > 0 && assignmentCustomers.length <= 100 && !assignmentCustomers.some(c => staleIds.has(c.customerId)) && reasonOk && !saving;

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
    if (!hasWrite || hasPendingRandomAssignment(adminId ?? 0) || pending && item) return;
    if (!item && selected.size === 0) return;
    setAssignmentCustomers(item ? [item] : [...selected.values()]); setTarget(null); setAssignmentReason(failedReason ?? "新客户首次咨询分配"); setReasonLeft(false);
    setFailedReason(null);
    setConfirm(true); setError("");
  }

  async function assign() {
    if (!canSubmit || pending || saving || assignmentInFlight.current || !target || !adminId || !readableScope) return;
    const actor = actorStamp();
    const command = pending ?? {
      key: crypto.randomUUID(),
      payload: { targetAgentAdminId: target.adminId, customers: assignmentCustomers.map((item) => ({ id: item.customerId, expectedAssignmentId: null, expectedVersion: item.version })), reason: assignmentReason.trim() },
    };
    const fingerprint = `pool-transfer:${command.payload.customers.map((item) => item.id).sort().join(",")}`;
    if (poolCommands.list().some(row => row.actorId === adminId)) return;
    if (!pending) poolCommands.remember(fingerprint, command.key, { actorId: adminId, groupId, payload: command.payload, selected: assignmentCustomers, target });
    if (!poolCommands.isDurablyStored(fingerprint, command.key)) { poolCommands.forget(fingerprint, command.key); setError("暂时无法保存命令，未提交分配。请恢复浏览器存储后重试。"); return; }
    assignmentInFlight.current = true; setSaving(true); setError("");
    let acknowledged = false;
    try {
      await supportClient.transfer(command.payload, command.key);
      if (actor !== actorStamp()) return;
      acknowledged = true;
      await verifySupportTransfer(command.payload, "SUCCEEDED", groupId);
      if (actor !== actorStamp()) return;
      poolCommands.forget(fingerprint, command.key);
      window.dispatchEvent(new Event("support-todo-changed"));
      setSelected(new Map()); setStaleIds(new Set()); setPending(null); setTarget(null); setAssignmentReason(""); setConfirm(false); setReload((n) => n + 1);
    } catch (cause) {
      if (actor !== actorStamp()) return;
      if (!acknowledged && isExplicitRejection(cause)) { poolCommands.forget(fingerprint, command.key); setError(errorText(cause)); setReload(n => n + 1); return; }
      setPending(command); setSelected(new Map()); setTarget(null); setConfirm(false); setPool(null); setAgents(null);
      setError("分配结果尚未核对，原命令已保留。请查询原命令并核对当前授权资料。");
    } finally { assignmentInFlight.current = false; setSaving(false); }
  }

  async function checkPending() {
    if (!pending || saving) return;
    const actor = actorStamp();
    setSaving(true);
    try {
      const result = await supportClient.command(pending.key);
      if (actor !== actorStamp()) return;
      if (result.status === "FAILED") {
        poolCommands.forget(`pool-transfer:${pending.payload.customers.map((item) => item.id).sort().join(",")}`, pending.key);
        setAssignmentReason(pending.payload.reason); setFailedReason(pending.payload.reason);
        setPool(null); setAgents(null); setSelected(new Map()); setStaleIds(new Set()); setPending(null); setTarget(null); setConfirm(false);
        setScopeReload(n => n + 1);
      } else if (result.status === "SUCCEEDED") {
        await verifySupportTransfer(pending.payload, "SUCCEEDED", groupId);
        const refreshed = await supportClient.bindingPool({ pageNum: page, pageSize: PAGE_SIZE, groupId, keyword: keyword || undefined, reason: reasonFilter || undefined });
        if (actor !== actorStamp()) return;
        poolCommands.forget(`pool-transfer:${pending.payload.customers.map((item) => item.id).sort().join(",")}`, pending.key);
        setPool(refreshed); setSelected(new Map()); setStaleIds(new Set()); setPending(null); setTarget(null); setConfirm(false); setReload(n => n + 1); setError("");
      } else setError("原分配命令仍在处理中，请稍后继续查询。");
    } catch { if (actor === actorStamp()) setError("暂时无法确认原分配结果；所选客户与命令已保留。"); }
    finally { setSaving(false); }
  }

  if (permission === "agent") return <div className="m-admin-error">仅客服主管或超级管理员可查看待绑定客户池。</div>;
  if (scopeError) return <div className="m-admin-error" role="alert">{scopeError}<Button size="sm" onClick={() => setScopeReload(n => n + 1)}>重新加载分配范围</Button></div>;
  if (!scope) return <div role="status" className="m-admin-muted">正在加载分配范围…</div>;
  if (pending) return <section className="m-admin-panel"><h2>查询未确认的分配</h2><p>有一次分配还没确认结果，请先查询，确认后才能继续。</p><Facts><Fact k="原目标专属客服">{poolCommands.list().find(r => r.commandKey === pending.key)?.target.name || pending.payload.targetAgentAdminId}</Fact><Fact k="原分配原因">{pending.payload.reason}</Fact><Fact k="原名单">{pending.payload.customers.length} 位</Fact></Facts><Fold title="原名单与命令" summary="保留原对象与版本"><p data-mono>{pending.key}</p><Table label="原分配名单"><thead><Tr><Th>客户</Th><Th>原版本</Th></Tr></thead><tbody>{pending.payload.customers.map(c => <Tr key={c.id}><Td>{m1CustomerCode(c.id)}</Td><Td>{c.expectedVersion}</Td></Tr>)}</tbody></Table></Fold><Button size="sm" disabled={saving} onClick={() => void checkPending()}>查询上次结果</Button>{error && <p role="alert">{error}</p>}</section>;
  if (!readableScope) return <div className="m-admin-muted">{groupId === undefined ? "当前没有可管理的客服组，请先在组管理中建立或接管组。" : "所选组不在当前授权范围，请重新选择。"}<Button size="sm" disabled={Boolean(pending)} onClick={() => setGroupId(undefined)}>返回授权范围</Button></div>;
  return <section className="m1-pool" aria-label="待绑定客户池">
    <Panel title="待分配" sub={pool ? `共 ${pool.total} 位 · 北京时间` : "尚未读取"} explain="明确选择客户后分配，最多 100 位。忙碌或离线不会自动改派。未选客户及已有团队成员保持原归属。">
      {failedReason !== null && <Notice tone="warn">原命令已确认失败，理由已保留；请按最新资料重新选择并预览。</Notice>}
      {scope.mode === "ALL" && isSuper && adminId && routeCommands.list().some(row => row.actorId === adminId) && <Button onClick={() => setRouteItem(routeCommands.list().find(row => row.actorId === adminId)!.item)}>查询上次组范围调整结果</Button>}
      {adminId && hasPendingRandomAssignment(adminId) && <Notice tone="warn" action={<Button onClick={() => setRandomCustomers([])}>查询上次随机分配结果</Button>}>原随机分配结果待确认，不能另发分配。</Notice>}
      <FilterBar onSubmit={() => { setPage(1); setKeyword(keywordInput.trim()); }} onClear={() => { setKeywordInput(""); setKeyword(""); setReasonFilter(""); setPage(1); }} canClear={Boolean(keyword || reasonFilter)} action={<Button type="submit">搜索</Button>}>
        <FilterField label="分配范围"><Select aria-label="选择客服组" value={String(groupId ?? "")} disabled={saving || Boolean(randomCustomers)} onChange={value => { setGroupId(value ? Number(value) : undefined); setPage(1); setAgentPage(1); setPool(null); setAgents(null); setSelected(new Map()); setStaleIds(new Set()); setTarget(null); setAssignmentReason(""); setFailedReason(null); setConfirm(false); }} options={[{ value: "", label: scope.mode === "ALL" ? "全部授权组及未分组客户" : "全部主管管理组" }, ...scope.groups.map(group => ({ value: group.id, label: group.name }))]} /></FilterField>
        <FilterField label="客户" grow><Input aria-label="搜索客户名称或编码" value={keywordInput} onChange={event => setKeywordInput(event.target.value)} placeholder="客户名称或编码" /></FilterField>
        <FilterField label="入池原因"><Select aria-label="筛选入池原因" value={reasonFilter} onChange={value => { setPage(1); setReasonFilter(value as SupportPoolReason | ""); }} options={[{ value: "", label: "全部入池原因" }, ...Object.entries(POOL_REASONS).map(([value, label]) => ({ value, label }))]} /></FilterField>
      </FilterBar>
      {error && <div role="alert" className="m-admin-error">{error} <Button type="button" size="sm" disabled={Boolean(pending)} onClick={() => setReload((n) => n + 1)}>重新加载</Button></div>}
      {pending && <div role="alert" className="m-admin-error">上次分配结果未确认，已锁定原客户范围与命令。<Button type="button" size="sm" onClick={() => setConfirm(true)}>继续确认上次分配</Button></div>}
      {loading && <div role="status" className="m-admin-muted">正在加载待分配客户…</div>}
      {!loading && pool && !error && <>
        {records.length === 0 ? <BlockState state="empty" title={keyword || reasonFilter || groupId !== undefined ? "当前筛选下没有待分配客户，可调整或清除筛选。" : "当前没有待分配客户。"} /> : <Table label="待分配客户" className="m1-pool-table"><colgroup><col /><col /><col /><col /><col /><col /></colgroup><thead><Tr><Th control><Checkbox checked={wholePageSelected} indeterminate={visibleSelected > 0 && !wholePageSelected} disabled={!hasWrite || hasPendingRandomAssignment(adminId ?? 0)} onChange={toggleVisible} aria-label="选择或取消当前页客户" /></Th><Th>客户</Th><Th>入池原因</Th><Th>等待起点</Th><Th>客户留言</Th><Th sticky="end">操作</Th></Tr></thead><tbody>{records.map(item => <Tr key={item.customerId} selected={selected.has(item.customerId)}>
          <Td><Checkbox checked={selected.has(item.customerId)} disabled={!hasWrite || hasPendingRandomAssignment(adminId ?? 0)} onChange={() => toggle(item)} aria-label={`选择客户 ${item.customerNo || item.customerId}`} /></Td>
          <Td><Button variant="ghost" size="sm" title={operatorNicknameText(item.displayName || "") || item.customerNo || item.customerId} onClick={() => setPoolDetail(item)}>{operatorNicknameText(item.displayName || "") || item.customerNo || item.customerId}</Button><span className="rd-note">{m1CustomerCode(item.customerId)} · {item.phoneMasked ?? "—"}</span></Td>
          <Td><span title={POOL_REASONS[item.reason]}>{POOL_REASONS[item.reason]}</span><span className="rd-note">{item.autoEligible == null ? "自动资格未知" : item.autoEligible ? "可自动重试" : "需主管处理"}</span></Td>
          <Td><span title={item.waitingSince || item.enteredAt || "等待时间未知"}>{item.waitingSince || item.enteredAt ? new Date(parseBusinessTime(item.waitingSince || item.enteredAt!)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}</span><span className="rd-note">{item.waitingSince ? "客户留言后等待" : "进入待分配池"}</span></Td>
          <Td>{item.pendingMessageCount == null ? "—" : item.pendingMessageCount ? `${item.pendingMessageCount} 条未回复` : "暂无留言"}<span className="rd-note" title={item.lastMessagePreview || undefined} data-user-content>{item.lastMessagePreview || ""}</span></Td>
          <Td sticky="end"><div className="m1-row-actions">{hasWrite && <Button size="sm" onClick={() => openFor(item)}>分配此客户</Button>}<MoreMenu label="客户池更多操作" items={[{ key: "detail", label: "入池详情", onSelect: () => setPoolDetail(item) }, ...(scope.mode === "ALL" && isSuper && hasWrite ? [{ key: "route", label: "调整组范围", disabledReason: item.routeState === "UNKNOWN" ? "该客户分组资料尚未确认" : undefined, onSelect: () => setRouteItem(item) }] : [])]} /></div></Td>
        </Tr>)}</tbody></Table>}
        {selected.size > 0 && hasWrite && <BatchBar summary={`已选择 ${selected.size} 位`} hint="跨页与搜索保留选择，换组清除；一次最多 100 位。"><Button disabled={selected.size > 100 || staleIds.size > 0} onClick={() => openFor()}>批量分配已选 {selected.size} 位</Button><Button variant="ghost" onClick={() => { setSelected(new Map()); setStaleIds(new Set()); }}>清空选择</Button><Button disabled={selected.size > 100 || staleIds.size > 0 || hasPendingRandomAssignment(adminId ?? 0)} onClick={() => setRandomCustomers([...selected.values()])}>预览已选客户随机分配</Button></BatchBar>}
        <div className="m-admin-toolbar"><Button type="button" size="sm" disabled={page <= 1 || Boolean(pending)} onClick={() => setPage((n) => n - 1)}>上一页</Button><span className="m-admin-muted">第 {page} / {Math.max(1, Math.ceil(pool.total / PAGE_SIZE))} 页</span><Button type="button" size="sm" disabled={page >= Math.ceil(pool.total / PAGE_SIZE) || Boolean(pending)} onClick={() => setPage((n) => n + 1)}>下一页</Button></div>
      </>}
    </Panel>
    {poolDetail && <Drawer open title="入池详情" sub={operatorNicknameText(poolDetail.displayName || "") || poolDetail.customerNo || poolDetail.customerId} onClose={() => setPoolDetail(null)} footer={<>{poolDetail.pendingMessageCount ? <Button onClick={() => { window.location.href = `/service/sessions?customerId=${encodeURIComponent(poolDetail.customerId)}`; }}>查看会话记录</Button> : null}{hasWrite && <Button variant="primary" onClick={() => { const item = poolDetail; setPoolDetail(null); openFor(item); }}>分配此客户</Button>}</>}>
      <Facts><Fact k="客户编码">{m1CustomerCode(poolDetail.customerId)}</Fact><Fact k="脱敏电话">{poolDetail.phoneMasked || "—"}</Fact><Fact k="入池原因">{POOL_REASONS[poolDetail.reason]}</Fact><Fact k="自动分配资格">{poolDetail.autoEligible == null ? "未知" : poolDetail.autoEligible ? "当前可自动重试" : "需主管处理"}</Fact><Fact k="已尝试">{poolDetail.attempts ?? "—"} 次</Fact><Fact k="最近尝试">{poolDetail.lastAttemptAt ? new Date(parseBusinessTime(poolDetail.lastAttemptAt)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "尚无记录"}</Fact><Fact k="最近尝试状态">{{ ASSIGNED: "已分配", WAITING_CANDIDATE: "等待合格候选，将按规则重试", PAUSED: "已暂停，需核对分配模式", NONE: "历史记录需明确处理" }[poolDetail.autoAttemptState || ""] || "状态未知"}</Fact><Fact k="最近结果">{{ NO_CANDIDATE: "暂无合格候选", ASSIGNED: "已成功分配", SUPERVISOR_MODE: "当前由主管处理" }[poolDetail.lastOutcome || ""] || (poolDetail.lastOutcome ? "需刷新资料后核对" : "尚无结果")}</Fact><Fact k="客户留言"><span data-user-content>{poolDetail.lastMessagePreview || "暂无留言"}</span></Fact></Facts><Fold title="技术信息" summary="客户、路由与池版本"><Facts><Fact k="客户编号">{poolDetail.customerId}</Fact><Fact k="池版本">{poolDetail.version}</Fact><Fact k="路由版本">{poolDetail.routeVersion ?? "—"}</Fact></Facts></Fold>
    </Drawer>}
    {randomCustomers&&<SupportRandomAssignment customers={randomCustomers} onClose={()=>setRandomCustomers(null)} onDone={()=>{setSelected(new Map());setReload(n=>n+1);window.dispatchEvent(new Event("support-todo-changed"));}}/>}
    {routeItem && scope.mode === "ALL" && isSuper && <PoolRouteModal item={routeItem} groups={scope.groups} onClose={() => setRouteItem(null)} onDone={() => { setRouteItem(null); setPool(null); setSelected(new Map()); setTarget(null); setReload(n => n + 1); }} />}
    {confirm && <Modal title="确认分配客户" icon={Users} wide busy={saving} onClose={() => { if (!saving) setConfirm(false); }} footer={<><Button type="button" size="sm" disabled={saving} onClick={() => setConfirm(false)}>返回</Button><Button type="button" variant="primary" disabled={saving} disabledReason={pending ? "先查询原操作结果" : !canSubmit ? "请选择有效专属客服并填写 8–200 字原因" : undefined} onClick={() => void assign()}>{saving ? "分配中…" : pending ? "等待原命令结果" : `确认分配 ${assignmentCustomers.length} 位`}</Button></>}>
      <div className="m1-command-form">
      <div className="m-admin-muted">只分配下列选中的客户，其他客户不变。之后这些客户邀请的新用户会跟随同一位专属客服。</div>
      <div className="m-admin-list">{assignmentCustomers.map((item) => <div key={item.customerId}>客户编号 {m1CustomerCode(item.customerId)} · {POOL_REASONS[item.reason]}</div>)}</div>
      {staleIds.size > 0 && <div className="m-admin-error" role="alert">{staleIds.size} 位已选客户版本需要刷新。已选的还在，请刷新页面或取消这些客户后再确认。<Button type="button" size="sm" onClick={() => setReload((n) => n + 1)}>刷新本页预览</Button></div>}
      <Field label="接待专属客服" required><Select aria-label="选择接待专属客服" value={String(target?.adminId ?? "")} disabled={agentsLoading || Boolean(pending) || saving} onChange={value => setTarget(candidates.find(agent => agent.adminId === Number(value)) ?? null)} options={[{ value: "", label: "请选择专属客服" }, ...candidates.map(agent => ({ value: String(agent.adminId), label: `${agent.name}${agent.busy ? " · 忙碌" : ""}` }))]} /></Field>
      {agentsLoading && <div role="status" className="m-admin-muted">正在加载专属客服…</div>}
      {agentsError && <div className="m-admin-error" role="alert">专属客服列表不可用。<Button type="button" size="sm" onClick={() => setAgentsReload((n) => n + 1)}>重试</Button></div>}
      {!agentsLoading && !agentsError && candidates.length === 0 && <div className="m-admin-error">本页没有可分配的专属客服，请翻页或先配置专属客服资格。</div>}
      {agents && agents.total > 100 && <div className="m-admin-toolbar"><Button type="button" size="sm" disabled={agentPage <= 1 || Boolean(pending)} onClick={() => setAgentPage((n) => n - 1)}>上一页专属客服</Button><span className="m-admin-muted">专属客服第 {agentPage} / {Math.ceil(agents.total / 100)} 页</span><Button type="button" size="sm" disabled={agentPage >= Math.ceil(agents.total / 100) || Boolean(pending)} onClick={() => setAgentPage((n) => n + 1)}>下一页专属客服</Button></div>}
      {target && <Facts><Fact k="目标专属客服">{target.name}</Fact><Fact k="已绑定客户">{target.assignedUserCount} 人</Fact><Fact k="当前会话负载">{target.currentActiveSessions ?? "—"}</Fact><Fact k="会话并发上限">{target.maxConcurrent}</Fact></Facts>}
      {target && !targetFresh && <div className="m-admin-error" role="alert">已选专属客服不在当前有效名单或资料已变化，请返回相应页重新选择。</div>}
      {target && <div className="m-admin-muted">专属客服当前{target.busy ? "忙碌" : "可接待"}；忙碌或离线不会自动改派。绑定人数没有额外上限。</div>}
      <Field label="分配原因" required help="请填写 8–200 字，将记入操作记录。" error={reasonLeft && !reasonOk ? "请填写 8–200 字的分配原因。" : undefined}>{control => <Textarea {...control} value={assignmentReason} maxLength={200} disabled={saving || Boolean(pending)} count={`${assignmentReason.trim().length}/200`} onBlur={() => setReasonLeft(true)} onChange={event => setAssignmentReason(event.target.value)} placeholder="说明本次分配的原因" />}</Field>
      {!reasonOk && <div className="m-admin-muted">填写 8–200 字原因后才能确认。</div>}
      {pending && <div className="m-admin-error" role="alert">上次提交结果尚未确认；客户范围和目标专属客服已锁定。<Button type="button" size="sm" disabled={saving} onClick={() => void checkPending()}>查询上次结果</Button></div>}
      {error && <div className="m-admin-error" role="alert">{error}</div>}
      </div>
    </Modal>}
  </section>;
}
