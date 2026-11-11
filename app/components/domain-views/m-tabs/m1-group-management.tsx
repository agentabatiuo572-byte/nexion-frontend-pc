"use client";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { accountVersion, canReplayGroupCommand, commandRejected, groupPendingCommands, inviteRevokeReason, isInvitePending, observedVersion, supportGroupClient, type GroupPendingRecord, type InviteCodeView, type InviteRevokeRecord, type QualificationKind, type QualificationStatus, type SupportGroup, type SupportGroupDirectory, type SupportGroupDetail, type SupportGroupMember, type SupportQualifications } from "@/lib/admin/support-group-client";
import { Btn, Modal } from "../design-kit";
import { BlockState, Button, Change, Explain, Fact, Facts, Field, Fold, Input, MoreMenu, Notice, PageTabs, Panel, ReleaseModal, Select, StatusTag, Table, Th, Tr, Td, Textarea } from "@/app/components/rd";
import { ChevronLeft, Network, UsersRound } from "lucide-react";
import { HDSelect } from "./hd-ui";
import { SupportClientError } from "@/lib/admin/m-support-client";
import "./m-support-admin.css";
import "./m1-group-management.css";

const PAGE_SIZE = 20;
const STATUS_TEXT = { ENABLED: "已启用", DISABLED: "已停用", ARCHIVED: "已归档", REMOVED: "已移除" };
const KIND_TEXT = { SERVICE: "专属客服", SUPERVISOR: "主管" };
const QUAL_OPTIONS = [{ value: "ENABLED", label: "启用" }, { value: "DISABLED", label: "停用" }, { value: "REMOVED", label: "移除" }];
function errorStatus(error: unknown): number { return error && typeof error === "object" && "status" in error ? Number(error.status) : 0; }
function errorText(error: unknown): string { if (error instanceof SupportClientError && error.backendMessage && ADMIN_ERROR_MESSAGES[error.backendMessage]) return displayAdminError(error); const code = errorStatus(error); return [401,403,404].includes(code) ? "你已无权查看这些资料，请返回后刷新。" : code === 409 ? "资料刚被修改过，已填写的内容还在，请刷新预览后再确认。" : code === 422 ? "当前账号、资格或组状态不允许此操作，请核对账号启用状态、成员和交接任务。" : "暂时无法确认结果，原命令与资料已保留；请先查询原操作。"; }
function reasonValid(value: string) { const length = Array.from(value.trim()).length; return length >= 8 && length <= 200; }
function authStamp() { const a = useAdminAuth.getState(); return adminShellSessionKey(a.session, a.authEpoch) + JSON.stringify(a.session?.menuNodes ?? null) + `|${a.isAuthenticated}|${a.logoutPending}|${a.logoutUnknown}`; }
export function canManageSupportQualifications(session: { role: string; authorities: string[] } | null) { return !!session && ["SUPERADMIN", "SUPER_ADMIN", "SUPER"].includes(session.role.toUpperCase()) && session.authorities.includes("platform_a1_read") && session.authorities.includes("platform_a1_write"); }
function expiredText() { return "原操作超过回查保护期，请先核对是否已创建或执行，不能直接重发。原命令和理由仍保留。"; }
const QUERY_PENDING_TEXT = "原操作尚未确认，不能重复提交；请先查询原操作。原命令、资料和理由保持不变。";
type Intent = GroupPendingRecord["intent"];
type InviteRow = { adminId: string; name: string; accountStatus: number | null; inviteCode?: { code: string | null; version: number | null } | null };
type Draft = { actorStamp: string; kind: "CREATE" | "RENAME" | "STATUS" | "OWNER" | "MEMBER"; name: string; ownerId: string; targetGroupId: string; status: "ENABLED" | "DISABLED" | "ARCHIVED"; reason: string; member?: SupportGroupMember; source?: SupportGroup; target?: SupportGroup; group?: SupportGroup; stale?: boolean };

/** Root supplies server-resolved mode; role names never manufacture group scope. */
export function M1GroupManagement({ mode, initialGroupId, actions, onChanged, onViewCustomers }: { mode: "PERSONAL" | "MANAGED" | "ALL"; initialGroupId?: string; actions?: ReactNode; onChanged: () => void; onViewCustomers: (groupId: string, category: "BOUND" | "PENDING") => void }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch), authenticated = useAdminAuth(s => s.isAuthenticated), logoutPending = useAdminAuth(s => s.logoutPending), logoutUnknown = useAdminAuth(s => s.logoutUnknown);
  const identity = adminShellSessionKey(session, epoch) + JSON.stringify(session?.menuNodes ?? null) + `|${authenticated}|${logoutPending}|${logoutUnknown}`;
  const allowed = authenticated && !logoutPending && !logoutUnknown && !!session && !session.passwordChangeRequired && mode !== "PERSONAL" && session.authorities.includes("service_m1_read") && canAccessResolvedPath(resolveVisibleDomains(session), "/service/overview");
  const hasWritePermission = allowed && !!session?.authorities.includes("service_m1_write"), ownerAllowed = mode === "ALL" && !!session?.authorities.includes("platform_a1_read");
  const [directoryView, setDirectoryView] = useState("groups");
  const [reasonLeft, setReasonLeft] = useState(false), [nameLeft, setNameLeft] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialGroupId), [page, setPage] = useState(1), [refresh, setRefresh] = useState(0);
  const [groups, setGroups] = useState<{ key: string; rows: SupportGroupDirectory[] }>(), [detail, setDetail] = useState<{ key: string; value: SupportGroupDetail }>(), [names, setNames] = useState<{ key: string; rows: Record<string, SupportGroupMember> }>();
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [loading, setLoading] = useState(false), [saving, setSaving] = useState(false), [previewBusy, setPreviewBusy] = useState(false);
  const [draftRecord, setDraft] = useState<Draft>(), [pendingRecord, setPending] = useState<GroupPendingRecord>(), [supervisors, setSupervisors] = useState<Awaited<ReturnType<typeof supportGroupClient.supervisors>>["items"]>([]);
  const draft = draftRecord?.actorStamp === identity ? draftRecord : undefined;
  const pending = pendingRecord?.actorId === session?.adminId ? pendingRecord : undefined;
  const [candidatePage, setCandidatePage] = useState(1), [candidateScope, setCandidateScope] = useState<string>(mode === "ALL" ? "global" : initialGroupId ?? ""), [candidateId, setCandidateId] = useState("");
  const [candidates, setCandidates] = useState<Awaited<ReturnType<typeof supportGroupClient.candidates>>>();
  const [inviteReasonTouched, setInviteReasonTouched] = useState(false);
  const [inviteRevoke, setInviteRevoke] = useState<{ adminId: string; reason: string }>(), [inviteBusy, setInviteBusy] = useState(false), [inviteError, setInviteError] = useState(""), [inviteStoreTick, setInviteStoreTick] = useState(0), [inviteUnresolved, setInviteUnresolved] = useState<string[]>([]), inviteGen = useRef(0);
  const [inviteRejected, setInviteRejected] = useState<string[]>([]), [inviteRelease, setInviteRelease] = useState<InviteRevokeRecord>();
  const [unassigned, setUnassigned] = useState<{ key: string; total: number; rows: Array<InviteRow & { inviteCode: InviteCodeView | null; membership: "UNASSIGNED" | "UNKNOWN" | "FAILED" }> }>(), [unassignedPage, setUnassignedPage] = useState(1), [unassignedReload, setUnassignedReload] = useState(0), [unassignedError, setUnassignedError] = useState("");
  const readKey = `${identity}|${mode}|${selectedId ?? "directory"}|${refresh}`, liveKey = useRef(readKey); liveKey.current = allowed ? readKey : "";
  const previewAbort = useRef<AbortController | null>(null), previewGeneration = useRef(0), writeAbort = useRef<AbortController | null>(null);
  const directoryReady = allowed && groups?.key === `${identity}|${mode}|${refresh}`;
  const rows = directoryReady ? groups.rows : [], currentDetail = allowed && detail?.key === readKey ? detail.value : undefined, memberNames = names?.key === `${readKey}|${page}` ? names.rows : {};
  const writeAllowed = hasWritePermission && directoryReady && (!selectedId || !!currentDetail);
  const closeDraft = () => { previewGeneration.current++; previewAbort.current?.abort(); setDraft(undefined); setCandidates(undefined); setCandidateId(""); };
  const revoke = () => { setGroups(undefined); setDetail(undefined); setNames(undefined); setSupervisors([]); setCandidates(undefined); closeDraft(); setSelectedId(undefined); };
  useEffect(() => { revoke(); setInviteRejected([]); setInviteRelease(undefined); setSaving(false); setPreviewBusy(false); setSelectedId(initialGroupId); setPage(1); setError(""); setNotice(""); setPending(groupPendingCommands.list().find((r): r is GroupPendingRecord => !isInvitePending(r) && r.actorId === session?.adminId && r.intent.kind !== "QUALIFICATION")); return () => { previewGeneration.current++; previewAbort.current?.abort(); writeAbort.current?.abort(); }; }, [identity, mode, initialGroupId]);
  useEffect(() => {
    const controller = new AbortController(); setLoading(allowed); setError(""); setGroups(undefined); setDetail(undefined); setNames(undefined);
    if (allowed) void Promise.all([supportGroupClient.groups(controller.signal), selectedId ? supportGroupClient.detail(selectedId, controller.signal) : Promise.resolve(undefined)]).then(([groupRows, nextDetail]) => {
      if (controller.signal.aborted || authStamp() !== identity || liveKey.current !== readKey) return;
      if (mode === "MANAGED" && groupRows.some(g => g.supervisorAdminId !== String(session?.adminId))) throw new Error("组范围不一致");
      if (nextDetail && (!groupRows.some(g => g.id === nextDetail.group.id) || mode === "MANAGED" && nextDetail.group.supervisorAdminId !== String(session?.adminId))) throw new Error("组详情超出获准范围");
      setGroups({ key: `${identity}|${mode}|${refresh}`, rows: groupRows }); if (nextDetail) setDetail({ key: readKey, value: nextDetail });
    }).catch(cause => { if (!controller.signal.aborted && authStamp() === identity && liveKey.current === readKey) { if ([401,403,404].includes(errorStatus(cause))) revoke(); setError([401,403,404].includes(errorStatus(cause)) ? "当前组资料不可访问，请返回获准范围并重新加载。" : "组资料暂不可读，尚未确认当前负责组；请重新加载后再管理。"); } }).finally(() => { if (!controller.signal.aborted && authStamp() === identity) setLoading(false); });
    return () => controller.abort();
  }, [allowed, readKey]);
  useEffect(() => {
    const controller = new AbortController(); setNames(undefined); if (!currentDetail) return () => controller.abort();
    void Promise.all(currentDetail.members.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(m => supportGroupClient.member(m.adminId, controller.signal))).then(projections => {
      if (controller.signal.aborted || liveKey.current !== readKey) return;
      if (projections.some(m => m.currentMember.state !== "AVAILABLE" || m.currentMember.groupId !== selectedId)) throw new Error("成员所属组已变化");
      setNames({ key: `${readKey}|${page}`, rows: Object.fromEntries(projections.map(m => [m.adminId, m])) });
    }).catch(cause => { if (!controller.signal.aborted && liveKey.current === readKey) { setNames(undefined); if ([401,403,404].includes(errorStatus(cause))) revoke(); setError("成员名单已变化或暂不可读，请刷新当前组。" ); } }); return () => controller.abort();
  }, [currentDetail, page, readKey]);
  useEffect(() => { const controller = new AbortController(); setSupervisors([]); if (allowed && ownerAllowed && draft && (draft.kind === "CREATE" || draft.kind === "OWNER")) void supportGroupClient.supervisors(controller.signal).then(next => { if (!controller.signal.aborted && authStamp() === identity) setSupervisors(next.items.filter(s => s.state === "ENABLED" && s.accountStatus === 1)); }).catch(cause => { if (!controller.signal.aborted && authStamp() === identity) { setSupervisors([]); setError("主管目录暂不可读，不能选择新的组负责人。" + errorText(cause)); } }); return () => controller.abort(); }, [allowed, ownerAllowed, draft?.kind, identity]);
  useEffect(() => {
    const controller = new AbortController(); setCandidates(undefined);
    if (allowed && draft?.kind === "MEMBER" && !draft.member && (mode === "ALL" && candidateScope === "global" || rows.some(g => g.id === candidateScope))) void supportGroupClient.candidates({ pageNum: candidatePage, pageSize: PAGE_SIZE, groupId: candidateScope === "global" ? undefined : candidateScope }, controller.signal).then(next => { if (!controller.signal.aborted && authStamp() === identity) setCandidates(next); }).catch(cause => { if (!controller.signal.aborted && authStamp() === identity) { setCandidates(undefined); setError(errorText(cause)); } });
    return () => controller.abort();
  }, [allowed, draft?.kind, draft?.member, candidateScope, candidatePage, readKey]);
  const open = (kind: Draft["kind"], member?: SupportGroupMember, targetStatus?: Draft["status"]) => { if (!writeAllowed || pending || saving) return; setError(""); setCandidateId(""); setCandidatePage(1); setCandidateScope(mode === "ALL" ? "global" : selectedId ?? rows[0]?.id ?? ""); setReasonLeft(false); setNameLeft(false); setDraft({ actorStamp: identity, kind, group: currentDetail?.group, name: currentDetail?.group.name ?? "", ownerId: mode === "MANAGED" ? String(session?.adminId) : "", targetGroupId: kind === "MEMBER" && member ? "" : selectedId ?? "", status: targetStatus ?? "DISABLED", reason: "", member, stale: kind === "MEMBER" && !!member }); };
  const previewMove = async (adminId: string, targetGroupId: string, saved = draft) => {
    if (!saved || saved.kind !== "MEMBER" || pending || !writeAllowed) return;
    previewAbort.current?.abort(); const controller = new AbortController(); previewAbort.current = controller; const generation = ++previewGeneration.current; setPreviewBusy(true); setError("");
    try { const member = await supportGroupClient.member(adminId, controller.signal); if (controller.signal.aborted || authStamp() !== identity || generation !== previewGeneration.current) return; observedVersion(member.currentMember);
      if (mode === "MANAGED" && (!member.currentMember.groupId || !rows.some(g => g.id === member.currentMember.groupId) || !targetGroupId || !rows.some(g => g.id === targetGroupId))) throw new Error("仅可在本人负责组之间调组");
      const [source, target] = await Promise.all([member.currentMember.groupId ? supportGroupClient.detail(member.currentMember.groupId, controller.signal).then(d => d.group) : Promise.resolve(undefined), targetGroupId ? supportGroupClient.detail(targetGroupId, controller.signal).then(d => d.group) : Promise.resolve(undefined)]);
      if (mode === "MANAGED" && [source, target].some(g => !g || g.supervisorAdminId !== String(session?.adminId))) throw new Error("组负责人已变化");
      if (target && target.status !== "ENABLED") throw new Error("目标组未启用"); if (controller.signal.aborted || authStamp() !== identity || generation !== previewGeneration.current) return; setDraft({ ...saved, member, source, target, targetGroupId, stale: false });
    } catch (cause) { if (!controller.signal.aborted && authStamp() === identity && generation === previewGeneration.current) { setDraft({ ...saved, stale: true }); if ([401,403,404].includes(errorStatus(cause))) revoke(); setError("调组预览不可用，请重读后再确认。" + errorText(cause)); } } finally { if (!controller.signal.aborted && authStamp() === identity && generation === previewGeneration.current) setPreviewBusy(false); }
  };
  const refreshDraft = async () => { if (!draft || pending || !writeAllowed) return; if (draft.kind === "MEMBER" && draft.member) { await previewMove(draft.member.adminId, draft.targetGroupId, draft); return; } const controller = new AbortController(); previewAbort.current?.abort(); previewAbort.current = controller; const generation = ++previewGeneration.current; setPreviewBusy(true);
    try { if (draft.group) { const next = await supportGroupClient.detail(draft.group.id, controller.signal); if (!controller.signal.aborted && authStamp() === identity && generation === previewGeneration.current) { setDraft({ ...draft, group: next.group, stale: false }); setDetail({ key: readKey, value: next }); setError(""); } } } catch (cause) { if (!controller.signal.aborted && authStamp() === identity) { if ([401,403,404].includes(errorStatus(cause))) revoke(); setError(errorText(cause)); } } finally { if (!controller.signal.aborted && authStamp() === identity) setPreviewBusy(false); } };
  const readFacts = async (intent: Intent, signal: AbortSignal) => { const member = intent.kind === "MEMBER" ? await supportGroupClient.member(intent.targetId, signal) : undefined; if (signal.aborted || authStamp() !== identity) throw new Error("READ_IDENTITY_CHANGED"); const group = intent.kind !== "CREATE" && intent.kind !== "MEMBER" && intent.kind !== "QUALIFICATION" ? (await supportGroupClient.detail(intent.targetId, signal)).group : undefined; if (signal.aborted || authStamp() !== identity) throw new Error("READ_IDENTITY_CHANGED"); const rows = await supportGroupClient.groups(signal); if (mode === "MANAGED" && rows.some(g => g.supervisorAdminId !== String(session?.adminId)) || group && !rows.some(g => g.id === group.id) || mode === "MANAGED" && member && (member.currentMember.state !== "AVAILABLE" || !rows.some(g => g.id === member.currentMember.groupId)) || intent.kind === "MEMBER" && intent.payload.targetGroupId !== null && !rows.some(g => g.id === intent.payload.targetGroupId)) throw new Error("组范围不一致"); return { member, group, rows }; };
  const failedDraft = (saved: GroupPendingRecord, facts: Awaited<ReturnType<typeof readFacts>>): Draft | undefined => { const i = saved.intent; if (i.kind === "QUALIFICATION") return undefined; const targetGroupId = i.kind === "MEMBER" && facts.rows.some(g => g.id === i.payload.targetGroupId) ? i.payload.targetGroupId ?? "" : ""; return { actorStamp: identity, kind: i.kind, name: i.kind === "CREATE" || i.kind === "RENAME" ? i.payload.name : facts.group?.name ?? "", ownerId: i.kind === "CREATE" || i.kind === "OWNER" ? i.payload.supervisorAdminId : "", reason: i.payload.reason, targetGroupId, status: i.kind === "STATUS" ? i.payload.status : "DISABLED", member: facts.member, group: facts.group && i.kind !== "CREATE" && i.kind !== "MEMBER" ? { ...facts.group, version: i.payload.expectedVersion } : undefined, stale: i.kind !== "CREATE" }; };
  const checkPending = async () => { if (!pending || saving || !allowed) return; const saved = pending, controller = new AbortController(); writeAbort.current = controller; setSaving(true); setError("");
    try { const receipt = await supportGroupClient.command(saved.commandKey, controller.signal); if (controller.signal.aborted || authStamp() !== identity) return; if (receipt.status === "SUCCEEDED" || receipt.status === "FAILED") { const facts = await readFacts(saved.intent, controller.signal); if (authStamp() !== identity || controller.signal.aborted) return; groupPendingCommands.forget(saved.fingerprint, saved.commandKey); setPending(undefined); if (receipt.status === "SUCCEEDED") closeDraft(); else setDraft(failedDraft(saved, facts)); setRefresh(n => n + 1); onChanged(); setNotice(receipt.status === "SUCCEEDED" ? "原操作已成功，已按当前权限重读组资料。" : "原操作已明确失败；理由已保留，请重新预览并确认。"); } else if (authStamp() === identity) setError(canReplayGroupCommand(saved) ? "原操作仍未确认，请稍后回查；原资料与命令号保持不变。" : expiredText()); }
    catch (cause) { if (authStamp() === identity && !controller.signal.aborted) { if ([401,403].includes(errorStatus(cause))) revoke(); setError("无法确认原操作，命令和理由仍保留。" + (canReplayGroupCommand(saved) ? errorText(cause) : expiredText())); } } finally { if (authStamp() === identity) setSaving(false); } };
  const submit = async () => {
    if (saving || !writeAllowed || previewBusy) return; let record = pending, createdThisAttempt = false;
    const previous = record ?? groupPendingCommands.list().find((r): r is GroupPendingRecord => !isInvitePending(r) && r.actorId === session?.adminId && r.intent.kind !== "QUALIFICATION");
    if (previous) { setPending(previous); setError(QUERY_PENDING_TEXT); return; }
    if (!record) {
      if (!draft || draft.stale || !reasonValid(draft.reason)) return; let intent: Intent; const why = draft.reason.trim();
      if (draft.kind === "CREATE") { if (!draft.name.trim() || draft.name.trim().length > 120 || !draft.ownerId || mode === "ALL" && !supervisors.some(s => s.adminId === draft.ownerId)) return; intent = { kind: "CREATE", payload: { name: draft.name.trim(), supervisorAdminId: mode === "MANAGED" ? String(session?.adminId) : draft.ownerId, reason: why } }; }
      else if (draft.kind === "MEMBER") { if (!draft.member || draft.member.currentMember.state === "UNKNOWN" || draft.member.currentMember.groupId === (draft.targetGroupId || null) || draft.member.currentMember.groupId && !draft.source || draft.targetGroupId && !draft.target || mode === "MANAGED" && (!draft.source || !draft.target)) return; intent = { kind: "MEMBER", targetId: draft.member.adminId, payload: { targetGroupId: draft.targetGroupId || null, expectedMemberVersion: observedVersion(draft.member.currentMember), sourceGroupVersion: draft.source?.version ?? null, targetGroupVersion: draft.target?.version ?? null, reason: why } }; }
      else { if (!draft.group) return; if (draft.kind === "RENAME") intent = { kind: "RENAME", targetId: draft.group.id, payload: { name: draft.name.trim(), expectedVersion: draft.group.version, reason: why } }; else if (draft.kind === "OWNER") { if (mode !== "ALL" || !supervisors.some(s => s.adminId === draft.ownerId) || draft.ownerId === draft.group.supervisorAdminId) return; intent = { kind: "OWNER", targetId: draft.group.id, payload: { supervisorAdminId: draft.ownerId, expectedVersion: draft.group.version, reason: why } }; } else intent = { kind: "STATUS", targetId: draft.group.id, payload: { status: draft.status, expectedVersion: draft.group.version, reason: why } }; }
      const commandKey = crypto.randomUUID(), fingerprint = `group-management:${session!.adminId}`; groupPendingCommands.remember(fingerprint, commandKey, { actorId: session!.adminId, intent, label: draft.kind === "MEMBER" ? `调组 · ${draft.member?.name}` : `${draft.kind === "CREATE" ? "创建" : draft.kind === "RENAME" ? "重命名" : draft.kind === "OWNER" ? "移交负责人" : "调整状态"} · ${draft.name}` });
      record = groupPendingCommands.list().find((r): r is GroupPendingRecord => !isInvitePending(r) && r.commandKey === commandKey); if (!record) { setError("原命令无法保存，已停止提交。请恢复浏览器存储后重试。" ); return; } createdThisAttempt = true; setPending(record);
    }
    if (!createdThisAttempt || !record) { setError(QUERY_PENDING_TEXT); return; }
    if (!groupPendingCommands.isDurablyStored(record.fingerprint, record.commandKey)) { setError("浏览器无法保存这次操作的记录，已停止提交。请检查浏览器设置后重试。" ); return; }
    const saved = record, controller = new AbortController(); writeAbort.current = controller; setSaving(true); setError(""); let written = false;
    try { const i = saved.intent; if (i.kind === "CREATE") await supportGroupClient.createSupportGroup(i.payload, saved.commandKey, controller.signal); else if (i.kind === "RENAME") await supportGroupClient.renameSupportGroup(i.targetId, i.payload, saved.commandKey, controller.signal); else if (i.kind === "STATUS") await supportGroupClient.setSupportGroupStatus(i.targetId, i.payload, saved.commandKey, controller.signal); else if (i.kind === "OWNER") await supportGroupClient.transferSupportGroupOwner(i.targetId, i.payload, saved.commandKey, controller.signal); else if (i.kind === "MEMBER") await supportGroupClient.moveSupportGroupMember(i.targetId, i.payload, saved.commandKey, controller.signal); else return;
      written = true; if (controller.signal.aborted || authStamp() !== identity) return; await readFacts(i, controller.signal); if (authStamp() !== identity || controller.signal.aborted) return; groupPendingCommands.forget(saved.fingerprint, saved.commandKey); setPending(undefined); closeDraft(); setRefresh(n => n + 1); onChanged(); setNotice("操作已成功，已重读当前可见组资料。");
    } catch (cause) { if (authStamp() !== identity || controller.signal.aborted) return; if (!written && commandRejected(cause)) { groupPendingCommands.forget(saved.fingerprint, saved.commandKey); setPending(undefined); } if (!written && errorStatus(cause) === 409) setDraft(old => old ? { ...old, stale: true } : old); if ([401,403,404].includes(errorStatus(cause))) revoke(); setError(errorText(cause)); } finally { if (authStamp() === identity) setSaving(false); }
  };
  // Leaving the group, page or account invalidates any in-flight invite result for this view (late answers must not touch the new one).
  useEffect(() => { inviteGen.current++; setInviteRevoke(undefined); setInviteError(""); setInviteBusy(false); }, [identity, selectedId, page, unassignedPage]);
  // 待分组 agents sit in no group, so the super admin pages the global agent list and reads each code by agent.
  const unassignedKey = `${identity}|${refresh}|${unassignedPage}|${unassignedReload}`, unassignedRows = unassigned?.key === unassignedKey ? unassigned.rows : [];
  useEffect(() => {
    const controller = new AbortController(); setUnassignedError("");
    if (!directoryReady || selectedId || mode !== "ALL" || directoryView !== "unassigned") return () => controller.abort();
    void supportGroupClient.candidates({ pageNum: unassignedPage, pageSize: PAGE_SIZE }, controller.signal).then(async result => {
      // Each agent is read on its own: unreadable or unconfirmed membership stays listed; only agents confirmed in a group are left out.
      const members = await Promise.all(result.records.map(c => supportGroupClient.member(c.adminId, controller.signal).catch(() => null)));
      const listed = result.records.flatMap((c, i) => { const m = members[i]; return m?.currentMember.state === "AVAILABLE" && m.currentMember.groupId !== null ? [] : [{ adminId: c.adminId, name: m?.name ?? c.name, accountStatus: m?.accountStatus ?? null, membership: !m ? "FAILED" as const : m.currentMember.state === "UNKNOWN" ? "UNKNOWN" as const : "UNASSIGNED" as const }]; });
      // One unreadable code shows on its own row instead of failing the list.
      const codes = await Promise.all(listed.map(row => supportGroupClient.inviteCode(row.adminId, controller.signal).catch(() => null)));
      if (controller.signal.aborted || authStamp() !== identity) return;
      setUnassigned({ key: unassignedKey, total: result.total, rows: listed.map((row, i) => ({ ...row, inviteCode: codes[i] })) });
    }).catch(() => { if (!controller.signal.aborted && authStamp() === identity) setUnassignedError("待分组客服暂不可读，请刷新资料后重试。"); });
    return () => controller.abort();
  }, [directoryReady, selectedId, mode, directoryView, unassignedKey]);
  const inviteRows: Record<string, InviteRow> = selectedId ? memberNames : Object.fromEntries(unassignedRows.map(row => [row.adminId, row]));
  // Unsettled revokes stay frozen (trimmed reason, target, version, key) until the original command is queried.
  // Store changes re-render even when a late answer may not touch the current view's state.
  const settleInviteCommand = (fingerprint: string, commandKey: string) => { groupPendingCommands.forget(fingerprint, commandKey); setInviteStoreTick(n => n + 1); setInviteUnresolved(keys => keys.filter(k => k !== commandKey)); setInviteRejected(keys => keys.filter(k => k !== commandKey)); };
  const revokePendings = allowed ? groupPendingCommands.list().filter((r): r is InviteRevokeRecord => isInvitePending(r) && r.intent.kind === "INVITE_REVOKE" && r.actorId === session?.adminId) : [];
  const inviteMember = inviteRevoke ? inviteRows[inviteRevoke.adminId] : undefined, inviteTarget = inviteMember?.inviteCode?.code ? inviteMember.inviteCode : undefined;
  const invitePending = inviteRevoke ? revokePendings.find(r => r.intent.targetId === inviteRevoke.adminId) : undefined;
  const inviteReasonInput = invitePending?.intent.payload.reason ?? inviteRevoke?.reason ?? "";
  const inviteReason = inviteRevokeReason(inviteReasonInput);
  const afterInviteChange = () => { setRefresh(n => n + 1); setUnassignedReload(n => n + 1); };
  const finishInviteRevoke = async (record: Pick<InviteRevokeRecord, "fingerprint" | "commandKey" | "intent">, message: string, live: () => boolean) => {
    settleInviteCommand(record.fingerprint, record.commandKey);
    if (!live()) return;
    setInviteRevoke(undefined);
    try {
      await supportGroupClient.inviteCode(record.intent.targetId);
      if (live()) { setNotice(message); afterInviteChange(); }
    } catch (cause) {
      if (!live()) return;
      if ([401,403,404].includes(errorStatus(cause))) revoke();
      setNotice("已取得操作回执，读回失败，请刷新核对。");
    }
  };
  const revokeInviteCode = async () => {
    if (!session || !inviteRevoke || !inviteMember || !inviteTarget?.code || invitePending || inviteBusy || !writeAllowed || !!inviteReason.error) return;
    if (inviteTarget.version === null) { setInviteError("这个邀请码没有版本号，暂时不能作废；请刷新资料后再试。"); return; }
    const gen = inviteGen.current, live = () => inviteGen.current === gen && authStamp() === identity;
    const payload = { expectedVersion: inviteTarget.version, reason: inviteReason.normalized, code: inviteTarget.code, name: inviteMember.name };
    const fingerprint = `invite-code:revoke:${session.adminId}:${inviteMember.adminId}`, commandKey = crypto.randomUUID();
    groupPendingCommands.remember(fingerprint, commandKey, { actorId: session.adminId, intent: { kind: "INVITE_REVOKE", targetId: inviteMember.adminId, payload }, label: `作废邀请码 · ${payload.name}` });
    if (!groupPendingCommands.isDurablyStored(fingerprint, commandKey)) { groupPendingCommands.forget(fingerprint, commandKey); setInviteError("浏览器无法保存这次操作的记录，已停止提交。请检查浏览器设置后重试。"); return; }
    setInviteBusy(true); setInviteError("");
    try {
      await supportGroupClient.revokeInviteCode(inviteMember.adminId, { expectedVersion: payload.expectedVersion, reason: payload.reason }, commandKey);
      await finishInviteRevoke({ fingerprint, commandKey, intent: { kind: "INVITE_REVOKE", targetId: inviteMember.adminId, payload } }, `已作废 ${payload.name} 的邀请码，已重读当前成员。`, live);
    } catch (cause) {
      const rejected = commandRejected(cause), code = errorStatus(cause);
      if (rejected) settleInviteCommand(fingerprint, commandKey);
      if (!live()) return;
      if ([401,403].includes(code) || rejected && code === 404) { revoke(); setError(errorText(cause)); return; }
      if (rejected && code === 409) afterInviteChange();
      setInviteError(!rejected ? "作废结果还没确认，原因和原操作已冻结；请查询原操作。" : code === 409 ? "邀请码刚被修改过，已重新读取；原因已保留，请核对后再确认。" : errorText(cause));
    } finally { if (live()) setInviteBusy(false); }
  };
  const checkInviteRevoke = async (record: InviteRevokeRecord) => {
    if (inviteBusy) return;
    const gen = inviteGen.current, live = () => inviteGen.current === gen && authStamp() === identity;
    setInviteBusy(true); setInviteError("");
    try {
      const receipt = await supportGroupClient.command(record.commandKey);
      if (receipt.status === "SUCCEEDED" || receipt.status === "FAILED") {
        await finishInviteRevoke(record, receipt.status === "SUCCEEDED" ? `已确认作废 ${record.intent.payload.name} 的邀请码，已重读当前成员。` : `原作废操作没有生效，已重读当前成员。`, live);
      } else if (live()) { setInviteUnresolved(keys => keys.filter(k => k !== record.commandKey)); setInviteError("原作废操作仍在处理，原因和原操作保持冻结，请稍后再查询。"); }
    } catch (cause) {
      if (!live()) return;
      if ([401,403].includes(errorStatus(cause))) { revoke(); setError(errorText(cause)); return; }
      // No record on the server (or no answer): the request may never have arrived, so a same-key retry is offered inside the replay window.
      const absent = cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND";
      setInviteUnresolved(keys => absent ? keys.includes(record.commandKey) ? keys : [...keys, record.commandKey] : keys.filter(k => k !== record.commandKey));
      setInviteError((errorStatus(cause) === 404 ? "尚未找到原命令回执；这不能证明原请求没有执行。" : "暂时无法查询原操作。") + (canReplayGroupCommand(record) ? "可以用原命令重试原操作；原因和原操作保持冻结。" : expiredText()));
    } finally { if (live()) setInviteBusy(false); }
  };
  const replayInviteRevoke = async (record: InviteRevokeRecord) => {
    if (inviteBusy || !canReplayGroupCommand(record)) return;
    const gen = inviteGen.current, live = () => inviteGen.current === gen && authStamp() === identity, { expectedVersion, reason, name } = record.intent.payload;
    setInviteBusy(true); setInviteError(""); setInviteRejected(keys => keys.filter(key => key !== record.commandKey));
    try {
      await supportGroupClient.revokeInviteCode(record.intent.targetId, { expectedVersion, reason }, record.commandKey);
      await finishInviteRevoke(record, `已作废 ${name} 的邀请码，已重读当前成员。`, live);
    } catch (cause) {
      const rejected = commandRejected(cause), code = errorStatus(cause);
      if (!live()) return;
      if ([401,403].includes(code)) { revoke(); setError(errorText(cause)); return; }
      if (!rejected) { setInviteError("重试结果仍未确认，原因和原操作保持冻结，请稍后再查询或重试。"); return; }
      setInviteRejected(keys => [...keys, record.commandKey]);
      if (code === 404) revoke();
      setInviteError("本次重试被拒绝，原操作仍需查询确认。" + errorText(cause));
    } finally { if (live()) setInviteBusy(false); }
  };
  const replayButton = (record: InviteRevokeRecord) => inviteUnresolved.includes(record.commandKey) && !inviteRejected.includes(record.commandKey) && canReplayGroupCommand(record);
  const openInviteRevoke = (adminId: string) => { setInviteReasonTouched(false); setInviteRevoke({ adminId, reason: "" }); setInviteError(""); };
  const inviteCell = (invite: InviteRow["inviteCode"], enabled: boolean) => invite === undefined ? "-" : invite === null ? <span className="m-invite-muted">读取失败</span> : invite.code === null ? <span className="m-invite-muted">未生成</span> : <span className={enabled ? "m-invite-code" : "m-invite-code m-invite-muted"}>{invite.code}{enabled ? "" : " · 不可使用"}</span>;
  const revokeButton = (adminId: string, invite: InviteRow["inviteCode"]) => (invite?.code || revokePendings.some(r => r.intent.targetId === adminId)) && <Btn sm disabled={!writeAllowed || saving || inviteBusy} onClick={() => openInviteRevoke(adminId)}>作废邀请码</Btn>;
  const invitePanel = inviteRevoke && (invitePending || inviteMember && inviteTarget) && <Modal title="作废成员邀请码" busy={inviteBusy} onClose={() => { if (!inviteBusy) setInviteRevoke(undefined); }} footer={<div className="m1-drawer-actions"><Button type="button" disabled={inviteBusy} onClick={() => { setInviteRevoke(undefined); setInviteError(""); }}>取消</Button>{invitePending ? <><Button type="button" disabled={inviteBusy} onClick={() => void checkInviteRevoke(invitePending)}>{inviteBusy ? "正在处理…" : "查询原操作"}</Button>{replayButton(invitePending) && <Button type="button" disabled={inviteBusy} onClick={() => void replayInviteRevoke(invitePending)}>重试原操作</Button>}{inviteRejected.includes(invitePending.commandKey) && <Button type="button" disabled={inviteBusy} onClick={() => { setInviteRevoke(undefined); setInviteRelease(invitePending); }}>解除待确认</Button>}</> : <Button type="button" variant="danger" disabled={inviteBusy} disabledReason={!writeAllowed ? "当前账号没有写权限" : inviteReason.error || undefined} onBlockedClick={() => setInviteReasonTouched(true)} onClick={() => void revokeInviteCode()}>{inviteBusy ? "正在作废…" : "确认作废"}</Button>}</div>}>
    <div className="m1-command-form">
    <Facts><Fact k="专属客服">{invitePending?.intent.payload.name ?? inviteMember?.name}</Fact><Fact k="原邀请码">{invitePending?.intent.payload.code ?? inviteTarget?.code}</Fact></Facts>
    <Notice tone="danger">{invitePending?.intent.payload.code ?? inviteTarget?.code} 会立即失效，之后填这个码注册会提示邀请码无效；已经绑定的客户不受影响。</Notice>
    <Field label="作废原因" required help={inviteReasonTouched && inviteReason.error ? undefined : "请填写 8–200 字，将记入操作记录。"} error={inviteReasonTouched && inviteReason.error ? `${inviteReason.error}。` : undefined}>{control => <Textarea {...control} rows={3} value={inviteReasonInput} count={`${inviteReason.length} / 200`} disabled={inviteBusy || !!invitePending} placeholder="至少 8 个字，会记入操作记录" onChange={e => { const reason = e.target.value; setInviteReasonTouched(true); setInviteRevoke(old => old && { ...old, reason }); }} />}</Field>
    {inviteError && <Notice tone="danger">{inviteError}</Notice>}

    </div>
  </Modal>;
  useEffect(() => { window.dispatchEvent(new Event("m1-pending-changed")); }, [pending, inviteStoreTick]);
  const targetGroups = rows.filter(g => g.status === "ENABLED" && g.id !== draft?.member?.currentMember.groupId);
  const groupNameValid = Boolean(draft?.name.trim() && draft.name.trim().length <= 120);
  const groupNameRequired = draft?.kind === "CREATE" || draft?.kind === "RENAME";
  const draftReady = !!draft && !draft.stale && reasonValid(draft.reason) && (draft.kind === "CREATE" || draft.kind === "RENAME" ? !!draft.name.trim() && draft.name.trim().length <= 120 : true) && (draft.kind === "CREATE" || draft.kind === "OWNER" ? mode === "MANAGED" || supervisors.some(s => s.adminId === draft.ownerId) : true) && (draft.kind !== "MEMBER" || !!draft.member && draft.member.currentMember.state !== "UNKNOWN" && draft.member.currentMember.groupId !== (draft.targetGroupId || null) && (!draft.member.currentMember.groupId || !!draft.source) && (!draft.targetGroupId || !!draft.target) && (mode === "ALL" || !!draft.source && !!draft.target));
  const pageCount = Math.max(1, Math.ceil((selectedId ? currentDetail?.memberCount ?? 0 : rows.length) / PAGE_SIZE));
  return <Panel className="m1-group-management" aria-label="客服组管理" icon={selectedId ? UsersRound : Network} tone="role-1"
    title={<>{selectedId && <Button variant="ghost" size="sm" className="m1-back" icon={<ChevronLeft size={16} aria-hidden />} disabled={saving} onClick={() => { closeDraft(); setSelectedId(undefined); setPage(1); }}>返回组目录</Button>}{selectedId ? currentDetail?.group.name ?? "组成员" : "组管理"}</>} explainLabel="组管理"
    sub={selectedId ? currentDetail ? `负责人 ${rows.find(g => g.id === currentDetail.group.id)?.supervisorName || "尚未读取"}` : undefined : directoryReady && !loading ? `${rows.length} 个组` : undefined}
    actions={<>{actions}<Btn disabled={!allowed || saving} onClick={() => { setPage(1); setRefresh(n => n + 1); }}>刷新资料</Btn>{hasWritePermission && !selectedId && <Btn disabled={!writeAllowed || saving || !!pending} title={!directoryReady ? "先成功读取当前获准组目录" : undefined} onClick={() => open("CREATE")}>创建组</Btn>}{allowed && !loading && selectedId && currentDetail && writeAllowed && <><Button disabled={saving || !!pending || currentDetail.group.status === "ARCHIVED"} onClick={() => open("RENAME")}>重命名</Button><Button disabled={saving || !!pending || currentDetail.group.status !== "ENABLED"} onClick={() => open("MEMBER")}>成员调组</Button><MoreMenu disabled={saving || !!pending} items={[
        ...(mode === "ALL" ? [{ key: "owner", label: "移交负责人", disabledReason: ownerAllowed ? undefined : "读取主管目录需要账号读取权限", onSelect: () => open("OWNER") }] : []),
        ...(currentDetail.group.status === "ENABLED" ? [{ key: "disable", label: "停用组", disabledReason: currentDetail.blockers.canExit ? undefined : "先处理全部成员、待分配客户和未结束管理任务", onSelect: () => open("STATUS", undefined, "DISABLED") }] : currentDetail.group.status === "DISABLED" ? [{ key: "enable", label: "启用组", onSelect: () => open("STATUS", undefined, "ENABLED") }, { key: "archive", label: "归档组", danger: true, disabledReason: currentDetail.blockers.canExit ? undefined : "先处理全部成员、待分配客户和未结束管理任务", onSelect: () => open("STATUS", undefined, "ARCHIVED") }] : []),
      ]} /></>}</>}>
    {mode === "ALL" && !selectedId && <PageTabs level={2} label="分组目录" value={directoryView} onChange={value => { setDirectoryView(value); setPage(1); }} items={[{ value: "groups", label: "客服组" }, { value: "unassigned", label: "待分组客服" }]} />}
    {!allowed && <Notice tone="danger">当前账号不能管理客服组。主管只能管理本人负责的组。</Notice>}{notice && <Notice tone="ok">{notice}</Notice>}{error && <Notice tone="danger">{error}</Notice>}
    {allowed && pending && <Notice tone="warn" action={<Btn sm disabled={saving} onClick={() => void checkPending()}>查询原操作</Btn>}>{QUERY_PENDING_TEXT}{!canReplayGroupCommand(pending) && expiredText()}</Notice>}{allowed && loading && <p className="m1-group-state" role="status">正在加载获准组资料…</p>}
    {revokePendings.map(r => <Notice key={r.commandKey} tone="warn" actionBelow action={<>{<Btn sm disabled={inviteBusy} onClick={() => void checkInviteRevoke(r)}>查询原操作</Btn>}{replayButton(r) && <Btn sm disabled={inviteBusy} onClick={() => void replayInviteRevoke(r)}>重试原操作</Btn>}{inviteRejected.includes(r.commandKey) && <Btn sm disabled={inviteBusy} onClick={() => { setInviteRevoke(undefined); setInviteRelease(r); }}>解除待确认</Btn>}</>}>作废 {r.intent.payload.name} 的邀请码 {r.intent.payload.code} 结果待确认；原因已冻结：「{r.intent.payload.reason}」。确认前不能修改或重新提交。{!canReplayGroupCommand(r) && expiredText()}</Notice>)}{!invitePanel && inviteError && <Notice tone="danger">{inviteError}</Notice>}
    {directoryReady && !loading && !selectedId && directoryView === "groups" && <div className="m-admin-table-wrap"><Table label="客服与分组" className="m1-group-directory"><thead><Tr><Th>组 / 负责人</Th><Th align="right">客服（人）</Th><Th align="right">绑定客户（人）</Th><Th align="right">待分配（人）</Th><Th>状态</Th><Th sticky="end">操作</Th></Tr></thead><tbody>{rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(g => <Tr key={g.id}>
      <Td data-label="组 / 负责人"><span className="m-group-name" title={g.name}>{g.name}</span><span className="rd-note" title={g.supervisorName ?? undefined}>{g.supervisorName ?? "负责人未同步"}</span></Td>
      <Td align="right" data-label="客服（人）"><Button variant="ghost" size="sm" className={`m-group-count${g.memberCount ? "" : " m-group-quiet"}`} type="button" disabled={saving} title={g.memberCount == null ? "客服数量暂不可用，查看名单" : `${g.memberCount} 人`} aria-label={`查看${g.name}的客服名单，${g.memberCount == null ? "数量暂不可用" : `${g.memberCount} 人`}`} onClick={() => { closeDraft(); setSelectedId(g.id); setPage(1); }}>{g.memberCount == null ? "—" : g.memberCount.toLocaleString("en-US")}</Button></Td>
      <Td align="right" data-label="绑定客户（人）"><Button variant="ghost" size="sm" className={`m-group-count${g.boundCustomers ? "" : " m-group-quiet"}`} type="button" disabled={saving} title={g.boundCustomers == null ? "绑定客户数量暂不可用，查看名单" : `${g.boundCustomers} 人`} aria-label={`查看${g.name}的绑定客户，${g.boundCustomers == null ? "数量暂不可用" : `${g.boundCustomers} 人`}`} onClick={() => onViewCustomers(g.id, "BOUND")}>{g.boundCustomers == null ? "—" : g.boundCustomers.toLocaleString("en-US")}</Button></Td>
      <Td align="right" data-label="待分配（人）"><Button variant="ghost" size="sm" className={`m-group-count${g.pendingCustomers ? "" : " m-group-quiet"}`} type="button" disabled={saving} title={g.pendingCustomers == null ? "待分配数量暂不可用，查看名单" : `${g.pendingCustomers} 人`} aria-label={`查看${g.name}的待分配客户，${g.pendingCustomers == null ? "数量暂不可用" : `${g.pendingCustomers} 人`}`} onClick={() => onViewCustomers(g.id, "PENDING")}>{g.pendingCustomers == null ? "—" : g.pendingCustomers.toLocaleString("en-US")}</Button></Td>
      <Td data-label="状态"><StatusTag tone={g.status === "ENABLED" ? "ok" : "done"}>{STATUS_TEXT[g.status]}</StatusTag></Td><Td sticky="end" data-label="操作"><Btn sm disabled={saving} onClick={() => { closeDraft(); setSelectedId(g.id); setPage(1); }}>管理</Btn></Td>
    </Tr>)}</tbody></Table>{rows.length === 0 && <BlockState state="empty" title={`当前没有负责组。${writeAllowed ? "可创建组并由当前有效主管负责。" : "请由有写权限的主管或总管理员创建。"}`} />}</div>}
    {allowed && !loading && selectedId && currentDetail && <>
      <dl className="m1-group-facts" aria-label="组概况"><div><dt>状态</dt><dd><StatusTag tone={currentDetail.group.status === "ENABLED" ? "ok" : "done"}>{STATUS_TEXT[currentDetail.group.status]}</StatusTag></dd></div><div><dt>成员</dt><dd>{currentDetail.memberCount}<small>人</small></dd></div><div><dt>绑定客户</dt><dd>{rows.find(g => g.id === selectedId)?.boundCustomers ?? "—"}<small>人</small></dd></div><div><dt>待分配</dt><dd>{currentDetail.routedCustomers}<small>人</small></dd></div><div><dt>未结束管理任务</dt><dd>{currentDetail.pendingOperations}<small>项</small></dd></div></dl>
      {!currentDetail.blockers.canExit && <Notice tone="neutral">停用或归档前，先将成员调出、处理本组待分配客户，并结束或核对未完成的管理任务。</Notice>}
      <div className="m1-group-subhead"><h3>成员</h3><Explain label="成员邀请码的说明" content="邀请码由客服本人生成，主管可作废" /></div>
      <div className="m-admin-table-wrap"><Table label="客服与分组" className="m1-group-members"><thead><Tr><Th>专属客服</Th><Th>账号 / 交接</Th><Th align="right">当前绑定客户</Th><Th>邀请码</Th><Th sticky="end">操作</Th></Tr></thead><tbody>{currentDetail.members.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(m => { const invite = memberNames[m.adminId]?.inviteCode; return <Tr key={m.adminId} className={inviteRevoke?.adminId === m.adminId && invitePanel ? "m-invite-selected" : undefined}><Td>{memberNames[m.adminId]?.name ?? "正在核对成员…"}</Td><Td>{m.accountStatus === 1 ? "账号启用" : "账号停用"}{m.handoverRequired ? " · 待交接" : ""}</Td><Td align="right">{m.boundCustomers} 人</Td><Td>{inviteCell(invite, m.accountStatus === 1)}</Td><Td sticky="end"><div className="m-invite-ops"><Btn sm disabled={!writeAllowed || saving || !!pending || !memberNames[m.adminId]} onClick={() => { const member = memberNames[m.adminId]; if (member) open("MEMBER", member); }}>成员调组</Btn>{revokeButton(m.adminId, invite)}</div></Td></Tr>; })}</tbody></Table>{!currentDetail.members.length && <BlockState state="empty" title="本组当前没有成员。" />}</div>
      {invitePanel}
    </>}
    {directoryReady && !loading && (selectedId || directoryView === "groups") && (page > 1 || pageCount > 1) && <nav className="m1-group-pager" aria-label={selectedId ? "成员分页" : "组分页"}><span>第 {page} / {selectedId && !currentDetail ? "-" : Math.max(1, Math.ceil((selectedId ? currentDetail!.memberCount : rows.length) / PAGE_SIZE))} 页</span><Btn sm disabled={saving || page <= 1} onClick={() => setPage(n => n - 1)}>上一页</Btn><Btn sm disabled={saving || page >= Math.ceil((selectedId ? currentDetail?.memberCount ?? 0 : rows.length) / PAGE_SIZE)} onClick={() => setPage(n => n + 1)}>下一页</Btn></nav>}
    {directoryReady && !loading && !selectedId && mode === "ALL" && directoryView === "unassigned" && <>
      <div className="m1-group-subhead"><h3>待分组客服</h3><Explain label="待分组客服的说明" content="本页候选中尚未确认在组的客服；按全部候选分页。" /></div>
      {unassignedError ? <Notice tone="danger">{unassignedError}</Notice> : !unassigned || unassigned.key !== unassignedKey ? <p className="m1-group-state" role="status">正在读取待分组客服…</p> : <div className="m-admin-table-wrap"><Table label="客服与分组" className="m1-group-members"><thead><Tr><Th>专属客服</Th><Th>账号 / 归属</Th><Th>邀请码</Th><Th sticky="end">操作</Th></Tr></thead><tbody>{unassignedRows.map(row => <Tr key={row.adminId} className={inviteRevoke?.adminId === row.adminId && invitePanel ? "m-invite-selected" : undefined}><Td>{row.name}</Td><Td>{row.membership === "FAILED" ? <span className="m-invite-muted">读取失败</span> : <>{row.accountStatus === 1 ? "账号启用" : "账号停用"}{row.membership === "UNKNOWN" && <span className="m-invite-muted"> · 归属待确认</span>}</>}</Td><Td>{inviteCell(row.inviteCode, row.accountStatus !== 0)}</Td><Td sticky="end"><div className="m-invite-ops">{revokeButton(row.adminId, row.inviteCode)}</div></Td></Tr>)}</tbody></Table>{!unassignedRows.length && <BlockState state="empty" title="本页没有待分组客服。" />}</div>}
      {invitePanel}
      {unassigned && <nav className="m1-group-pager" aria-label="待分组客服分页"><span>第 {unassignedPage} / {Math.max(1, Math.ceil(unassigned.total / PAGE_SIZE))} 页 · 候选共 {unassigned.total} 位</span><Btn sm disabled={unassignedPage <= 1} onClick={() => setUnassignedPage(n => n - 1)}>上一页</Btn><Btn sm disabled={unassignedPage >= Math.ceil(unassigned.total / PAGE_SIZE)} onClick={() => setUnassignedPage(n => n + 1)}>下一页</Btn></nav>}
    </>}
    {inviteRelease && <ReleaseModal label={inviteRelease.label} onCancel={() => setInviteRelease(undefined)} onConfirm={() => { settleInviteCommand(inviteRelease.fingerprint, inviteRelease.commandKey); setInviteRelease(undefined); setInviteError(""); }} />}
    {draft && directoryReady && !pending && <Modal title={draft.kind === "CREATE" ? "创建客服组" : draft.kind === "MEMBER" ? "成员调组" : draft.kind === "OWNER" ? "移交组负责人" : draft.kind === "STATUS" ? `${draft.status === "ENABLED" ? "启用" : draft.status === "DISABLED" ? "停用" : "归档"}客服组` : "重命名客服组"} busy={saving || previewBusy} onClose={() => { if (!saving && !previewBusy) closeDraft(); }} footer={<><Btn disabled={saving || previewBusy} onClick={closeDraft}>返回</Btn>{draft.stale && <Btn disabled={saving || previewBusy} onClick={() => void refreshDraft()}>重读预览</Btn>}<Btn variant={draft.kind === "STATUS" && draft.status === "ARCHIVED" ? "danger" : "primary"} disabled={saving || previewBusy} disabledReason={!writeAllowed ? "先成功读取获准组资料" : groupNameRequired && !groupNameValid ? "请填写 1–120 字的组名" : !draftReady ? "请完成目标及 8–200 字理由，并核实预览" : undefined} onClick={() => void submit()}>{saving ? "正在提交…" : draft.kind === "CREATE" ? "确认创建组" : draft.kind === "RENAME" ? "确认重命名" : draft.kind === "OWNER" ? "确认移交负责人" : draft.kind === "MEMBER" ? "确认成员调组" : draft.status === "ENABLED" ? "确认启用组" : draft.status === "DISABLED" ? "确认停用组" : "确认归档组"}</Btn></>}>
      <div className="m1-group-form">
      {(draft.group || draft.name.trim() || draft.kind === "MEMBER" && draft.member) && <Facts>{(draft.group?.name || draft.name.trim()) && <Fact k="客服组">{draft.group?.name || draft.name.trim()}</Fact>}{draft.group && <Fact k="当前负责人">{rows.find(g => g.id === draft.group?.id)?.supervisorName || "负责人未同步"}</Fact>}{draft.kind === "STATUS" && <Fact k="状态变更"><Change from={draft.group ? STATUS_TEXT[draft.group.status] : "—"} to={STATUS_TEXT[draft.status]} /></Fact>}{draft.kind === "OWNER" && <Fact k="负责人变更"><Change from={rows.find(g => g.id === draft.group?.id)?.supervisorName || "—"} to={supervisors.find(x => x.adminId === draft.ownerId)?.name || "请选择"} /></Fact>}{draft.kind === "MEMBER" && draft.member && <><Fact k="成员">{draft.member.name}</Fact>{!draft.stale && <Fact k="组变更"><Change from={draft.source?.name || "待分组"} to={draft.target?.name || "待分组"} /></Fact>}</>}</Facts>}
      {draft.kind === "STATUS" && <Notice tone={draft.status === "ARCHIVED" ? "danger" : draft.status === "DISABLED" ? "warn" : "neutral"}>{draft.status === "ARCHIVED" ? "归档后没有恢复入口。" : draft.status === "DISABLED" ? "停用前必须处理成员、路由和未结操作，不能通过停用自动退出成员。" : "启用后本组可继续接收成员与客户，仍须有效负责人。"}</Notice>}
      {(draft.kind === "CREATE" || draft.kind === "RENAME") && <Field label="组名" required help={nameLeft && !groupNameValid ? undefined : "请填写 1–120 字的组名。"} error={nameLeft && !groupNameValid ? "请填写 1–120 字的组名。" : undefined}>{control => <Input {...control} aria-label="组名" value={draft.name} maxLength={120} disabled={saving || !!pending} onBlur={() => setNameLeft(true)} onChange={e => setDraft({ ...draft, name: e.target.value })} />}</Field>}
      {(draft.kind === "CREATE" || draft.kind === "OWNER") && <Field label="组负责人">{mode === "MANAGED" ? <p className="m1-field-value">当前主管本人 · {session?.operator || "当前账号"}</p> : saving || pending ? <p className="m1-field-value">{supervisors.find(s => s.adminId === draft.ownerId)?.name ?? "原选择已锁定"}</p> : <Select aria-label="组负责人" value={draft.ownerId} options={supervisors.map(s => ({ value: s.adminId, label: s.name }))} placeholder="选择启用的主管" onChange={ownerId => setDraft({ ...draft, ownerId })} />}</Field>}
      {draft.kind === "MEMBER" && <>
        {!draft.member && <><Field label="选择成员来源">{saving || pending ? <p className="m1-field-value">原来源已锁定</p> : <Select aria-label="选择成员来源" value={candidateScope} options={[...(mode === "ALL" ? [{ value: "global", label: "全部获准专属客服（含待分组）" }] : []), ...rows.map(g => ({ value: g.id, label: g.name }))]} onChange={value => { setCandidateScope(value); setCandidatePage(1); setCandidateId(""); }} />}</Field><Field label="选择专属客服"><Select aria-label="选择专属客服" value={candidateId} options={(candidates?.records ?? []).map(c => ({ value: c.adminId, label: c.name }))} placeholder="逐页选择成员" onChange={value => { if (!saving && !pending && !previewBusy) { setCandidateId(value); void previewMove(value, draft.targetGroupId); } }} /><nav className="m1-group-pager m1-inline-pager" aria-label="成员候选分页"><span>第 {candidatePage} / {!candidates ? "-" : Math.max(1, Math.ceil(candidates.total / PAGE_SIZE))} 页</span><Btn sm disabled={candidatePage <= 1 || previewBusy || !!pending} onClick={() => setCandidatePage(n => n - 1)}>上一页成员</Btn><Btn sm disabled={!candidates || candidatePage >= Math.ceil(candidates.total / PAGE_SIZE) || previewBusy || !!pending} onClick={() => setCandidatePage(n => n + 1)}>下一页成员</Btn></nav></Field></>}
        {draft.member && <p className="m1-field-value">{draft.member.name} · 当前绑定 {draft.member.boundCustomers} 位客户 · 原组 {draft.source?.name ?? rows.find(g => g.id === draft.member?.currentMember.groupId)?.name ?? (draft.member.currentMember.state === "ABSENT" ? "确证未入组" : draft.member.currentMember.groupId ? "正在核对" : "待分组")}<Explain label="成员调组的说明" content="调组不更改已有个人绑定，不搬历史事件；当前所属资产范围随客服所在组变化。" /></p>}
        <Field label="目标组">{saving || pending ? <p className="m1-field-value">{draft.target?.name ?? "待分组"}</p> : <Select aria-label="目标组" value={draft.targetGroupId} options={[...(mode === "ALL" ? [{ value: "", label: "待分组" }] : []), ...targetGroups.map(g => ({ value: g.id, label: g.name }))]} placeholder="选择启用的目标组" onChange={targetGroupId => { setDraft({ ...draft, targetGroupId, target: undefined, stale: true }); if (draft.member) void previewMove(draft.member.adminId, targetGroupId, draft); }} />}</Field>
      </>}
      {draft.kind === "OWNER" && <p className="m1-field-value">移交负责人会更新本组管理范围，影响成员与待分配队列；个人绑定和历史事件保留。成员 {currentDetail?.memberCount ?? "-"} 人，待分配 {currentDetail?.routedCustomers ?? "-"} 人。</p>}
      <Field label="操作理由" required help={reasonLeft && !reasonValid(draft.reason) ? undefined : "请填写 8–200 字，将记入操作记录。"} error={reasonLeft && !reasonValid(draft.reason) ? "请填写 8–200 字的理由。" : undefined}>{control => <Textarea {...control} value={draft.reason} maxLength={200} count={`${Array.from(draft.reason.trim()).length}/200`} disabled={saving || !!pending || previewBusy} onBlur={() => setReasonLeft(true)} onChange={e => setDraft({ ...draft, reason: e.target.value })} />}</Field>{previewBusy && <p className="m1-group-state" role="status">正在加载最新成员与来源、目标组版本…</p>}{draft.stale && <Notice tone="warn">预览尚未核实或版本已变化，请重读后再次确认。</Notice>}{error && <Notice tone="danger">{error}</Notice>}
      </div>
    </Modal>}
  </Panel>;
}

/** Qualifications share the existing A1 account; no second customer-service identity. */
export function SupportQualificationEditor({ adminId, kind, onClose, onChanged }: { adminId: string; kind: QualificationKind; onClose: () => void; onChanged: () => void }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch), authenticated = useAdminAuth(s => s.isAuthenticated), logoutPending = useAdminAuth(s => s.logoutPending), logoutUnknown = useAdminAuth(s => s.logoutUnknown);
  const identity = adminShellSessionKey(session, epoch) + JSON.stringify(session?.menuNodes ?? null) + `|${authenticated}|${logoutPending}|${logoutUnknown}`;
  const allowed = authenticated && !logoutPending && !logoutUnknown && !!session && !session.passwordChangeRequired && canManageSupportQualifications(session) && canAccessResolvedPath(resolveVisibleDomains(session), "/platform/rbac");
  const key = `${identity}|${adminId}|${kind}`, liveKey = useRef(key); liveKey.current = allowed ? key : "";
  const [projection, setProjection] = useState<{ key: string; value: SupportQualifications }>(), [state, setState] = useState<QualificationStatus>("ENABLED"), [reason, setReason] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false), [stale, setStale] = useState(false), [refresh, setRefresh] = useState(0), [pendingRecord, setPending] = useState<GroupPendingRecord>();
  const pending = pendingRecord && pendingRecord.actorId === session?.adminId && pendingRecord.intent.kind === "QUALIFICATION" && pendingRecord.intent.targetId === adminId && pendingRecord.intent.payload.qualificationKind === kind ? pendingRecord : undefined;
  const controllerRef = useRef<AbortController | null>(null), data = allowed && projection?.key === key ? projection.value : undefined, fact = data?.qualifications.find(q => q.kind === kind);
  useEffect(() => { setProjection(undefined); setReason(""); setError(""); setBusy(false); setStale(false); setPending(groupPendingCommands.list().find((r): r is GroupPendingRecord => !isInvitePending(r) && r.actorId === session?.adminId && r.intent.kind === "QUALIFICATION" && r.intent.targetId === adminId && r.intent.payload.qualificationKind === kind)); return () => controllerRef.current?.abort(); }, [key]);
  useEffect(() => { const controller = new AbortController(); setProjection(undefined); if (allowed) void supportGroupClient.qualifications(adminId, controller.signal).then(next => { if (!controller.signal.aborted && liveKey.current === key && authStamp() === identity) { setProjection({ key, value: next }); setStale(false); } }).catch(cause => { if (!controller.signal.aborted && liveKey.current === key) { setProjection(undefined); setError(errorText(cause)); } }); return () => controller.abort(); }, [allowed, key, refresh]);
  const check = async () => { if (!pending || busy || !allowed) return; const saved = pending, controller = new AbortController(); controllerRef.current = controller; setBusy(true);
    try { const receipt = await supportGroupClient.command(saved.commandKey, controller.signal); if (controller.signal.aborted || authStamp() !== identity || liveKey.current !== key) return; if (receipt.status === "SUCCEEDED" || receipt.status === "FAILED") { const next = await supportGroupClient.qualifications(adminId, controller.signal); if (controller.signal.aborted || authStamp() !== identity || liveKey.current !== key) return; groupPendingCommands.forget(saved.fingerprint, saved.commandKey); setPending(undefined); setProjection({ key, value: next }); if (saved.intent.kind === "QUALIFICATION") { setReason(saved.intent.payload.reason); setState(saved.intent.payload.state); } setStale(receipt.status === "FAILED"); onChanged(); setError(receipt.status === "SUCCEEDED" ? "原操作已成功，已读取当前账号资格。" : "原操作已明确失败，理由已保留；请重读预览后重新确认。"); } else if (authStamp() === identity) setError(canReplayGroupCommand(saved) ? "原操作仍未确认，请稍后查询。" : expiredText()); } catch (cause) { if (authStamp() === identity && liveKey.current === key) { if ([401,403,404].includes(errorStatus(cause))) setProjection(undefined); setError("原命令和理由仍保留。" + errorText(cause)); } } finally { if (authStamp() === identity) setBusy(false); } };
  const submit = async () => {
    if (!allowed || busy) return; let saved = pending, createdThisAttempt = false;
    const previous = saved ?? groupPendingCommands.list().find((r): r is GroupPendingRecord => !isInvitePending(r) && r.actorId === session?.adminId && r.intent.kind === "QUALIFICATION" && r.intent.targetId === adminId && r.intent.payload.qualificationKind === kind);
    if (previous) { setPending(previous); setError(QUERY_PENDING_TEXT); return; }
    if (!saved) { if (!data || !fact || fact.observationState === "UNKNOWN" || stale || !reasonValid(reason) || fact.state === state || state === "ENABLED" && data.accountStatus !== 1) return;
      const commandKey = crypto.randomUUID(), fingerprint = `support-qualification:${session!.adminId}:${adminId}:${kind}`, intent: Intent = { kind: "QUALIFICATION", targetId: adminId, payload: { qualificationKind: kind, state, expectedQualificationVersion: observedVersion(fact), expectedAccountVersion: accountVersion(data.accountVersion), reason: reason.trim() } };
      groupPendingCommands.remember(fingerprint, commandKey, { actorId: session!.adminId, intent, label: `${KIND_TEXT[kind]}资格 · ${data.name}` }); saved = groupPendingCommands.list().find((r): r is GroupPendingRecord => !isInvitePending(r) && r.commandKey === commandKey); if (!saved) { setError("命令保存失败，已停止提交。" ); return; } createdThisAttempt = true; setPending(saved);
    }
    if (!createdThisAttempt || !saved) { setError(QUERY_PENDING_TEXT); return; }
    if (!groupPendingCommands.isDurablyStored(saved.fingerprint, saved.commandKey) || saved.intent.kind !== "QUALIFICATION") { setError("浏览器无法保存这次操作的记录，已停止提交。请检查浏览器设置后重试。" ); return; }
    const controller = new AbortController(); controllerRef.current = controller; setBusy(true); setError(""); let written = false;
    try { await supportGroupClient.setSupportQualification(adminId, saved.intent.payload, saved.commandKey, controller.signal); written = true; if (controller.signal.aborted || authStamp() !== identity || liveKey.current !== key) return; const next = await supportGroupClient.qualifications(adminId, controller.signal); if (controller.signal.aborted || authStamp() !== identity || liveKey.current !== key) return; groupPendingCommands.forget(saved.fingerprint, saved.commandKey); setPending(undefined); setProjection({ key, value: next }); onChanged(); setError("资格已更新，已重新加载账号资格。" ); }
    catch (cause) { if (controller.signal.aborted || authStamp() !== identity || liveKey.current !== key) return; if (!written && errorStatus(cause) === 409) setStale(true); if ([401,403,404].includes(errorStatus(cause))) setProjection(undefined); setError(errorText(cause)); } finally { if (authStamp() === identity) setBusy(false); }
  };
  const canSubmit = !!data && !!fact && fact.observationState !== "UNKNOWN" && !stale && reasonValid(reason) && state !== fact.state && (state !== "ENABLED" || data.accountStatus === 1);
  return <Modal title={pending ? "查询原操作" : `${KIND_TEXT[kind]}资格`} busy={busy} onClose={() => { if (!busy) onClose(); }} footer={<><Btn disabled={busy} onClick={onClose}>关闭</Btn>{allowed && pending ? <Btn disabled={busy} onClick={() => void check()}>查询原操作</Btn> : <><Btn disabled={!allowed || busy} onClick={() => setRefresh(n => n + 1)}>重读当前资格</Btn><Btn variant="primary" disabled={!allowed || busy || !canSubmit} onClick={() => void submit()}>{busy ? "正在提交…" : "确认并提交"}</Btn></>}</>}>
    {!allowed ? <p role="alert">只有总管理员（并有账号查看和修改权限）能管理资格。</p> : pending ? <p role="status">上次操作结果还没确认，请先查询结果。</p> : !data ? <p role="status">{error || "正在加载…"}</p> : <><p>{data.name} · {data.accountStatus === 1 ? "账号启用" : "账号停用"}</p><p>当前{KIND_TEXT[kind]}资格：{fact?.observationState === "UNKNOWN" ? "信息不完整，不能保存" : fact?.observationState === "ABSENT" ? "确证未授予" : fact?.state ? STATUS_TEXT[fact.state] : "未知"}</p>
      <p className="m-admin-muted">专属客服是唯一人工客服身份；主管是独立管理资格，同一账号可兼任。授予资格不自动绑定客户，也不改普通账号角色。</p>{kind === "SUPERVISOR" && state !== "ENABLED" && <p>停用或移除前，须先将全部负责组（含归档组）移交给有效主管。</p>}{kind === "SERVICE" && state !== "ENABLED" && <p>停用或移除前，须先处理已有绑定客户并退出组；不会自动改派客户。</p>}
      <label className="field"><span>资格状态</span>{busy ? <p>{STATUS_TEXT[state]}</p> : <HDSelect value={state} onChange={value => setState(value as QualificationStatus)} options={QUAL_OPTIONS} />}</label><label className="field"><span>操作理由（8–200 字）</span><textarea value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label></>}
    {allowed && pending && <p role="alert">{QUERY_PENDING_TEXT}{!canReplayGroupCommand(pending) && expiredText()}</p>}{allowed && !pending && stale && <p role="alert">版本已变化，请重读当前资格并再次确认。理由已保留。</p>}{error && data && <p role="alert">{error}</p>}
  </Modal>;
}
