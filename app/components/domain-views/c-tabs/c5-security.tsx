"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Copy, KeyRound, LockKeyhole, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck, Smartphone, TriangleAlert, UserRound } from "lucide-react";
import { BlockState, Button, Cell, Conclusion, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Fold, IconButton, Input, JudgmentPoints, Modal, Notice, PageHeader, PageTabs, Pager, Panel, ReleaseBody, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds } from "@/app/components/rd";
import { userNicknameText, platformSessionDeviceText } from "@/lib/admin/brand-copy";
import { businessZoneText, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { formatAccountStatus } from "@/lib/admin/c1-detail-display";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { pendingC5Commands, prepareC5Command, submitC5Command, forgetC5Command, isCompleteC5Command, type C5CommandKind, type C5Pending } from "@/lib/admin/c5-security-commands";
import { listSessionRevocationApprovals, pendingSessionRevocationApproval, proposeSessionRevocation } from "@/lib/admin/session-revocation-approval";
import { fetchUserProfilesPage, fetchUserSecurityOverview, type User360Profile, type UserCredentialParam, type UserSecurityOverview, type UserSecurityUserRow, type UserSession } from "@/lib/admin/user360-client";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { sessionTimeAnomaly } from "@/lib/admin/session-time";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { pendingPaymentPolicy, pendingPaymentRelease } from "@/lib/admin/payment-password-client";
import { pendingPhoneCommands, pendingModelLockCommands } from "@/lib/admin/phone-replacement-client";
import { PaymentPasswordPanel } from "./payment-password-panel";
import { PhoneReplacementPanel } from "./phone-replacement-panel";
import type { CCtx } from "./types";

const TABS = ["security", "credentials", "payment", "phone"] as const;
type Tab = typeof TABS[number];
const text = (value: unknown, fallback = "—") => value == null || value === "" ? fallback : String(value);
const count = (value: unknown) => value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const time = (value: unknown) => formatBusinessTimeCompact(value == null ? null : String(value));
const userIdOf = (row?: UserSecurityUserRow | null) => row?.userId == null ? "" : String(row.userId);
const userLabel = (row?: UserSecurityUserRow | null) => { if (!row) return "未选择用户"; const name = userNicknameText(text(row.nickname, ""), row.phoneMasked); return name ? `${name} · ${text(row.userNo)}` : text(row.userNo); };
const maskSessionId = (id: string) => id.length <= 10 ? `${id.slice(0, 3)}•••${id.slice(-2)}` : `${id.slice(0, 6)}••••${id.slice(-4)}`;
const sessionLabel = (state: unknown) => ({ ACTIVE: "活跃", REVOKED: "已撤销", EXPIRED: "已过期" }[String(state)] ?? "状态未知");
const lockLabel = (row?: UserSecurityUserRow | null) => !row ? "未确认" : row.lockKind === "SHORT" ? "短时锁定" : row.lockKind === "LONG" ? "长时锁定" : row.lockKind === "NONE" || row.locked === false ? "未锁定" : "未确认";
const PARAM_HELP: Record<string, { what: string; when: string; effect: string; where: string }> = {
  accessTtl: { what: "单个访问令牌的有效时长", when: "后续签发令牌时采用", effect: "不改写已签发的令牌", where: "本页登录与改号规则" },
  refreshTtl: { what: "长期登录刷新的期限", when: "后续创建刷新会话时采用", effect: "不改写已有会话的期限", where: "本页登录与改号规则" },
  sessionIdle: { what: "无活跃会话的有效天数", when: "下次请求或会话检查时采用", effect: "按新的空闲期判断，不承诺即时推送下线", where: "App 安全设置的设备列表与登录门禁" },
  phoneChangeWindowDays: { what: "统计个人改号次数的窗口", when: "下一次改号资格检查时采用", effect: "不清除已使用次数，与手机换机分开统计", where: "App 安全设置的更改手机号摘要" },
  phoneChangeMaxCount: { what: "统计期内个人改号次数的上限", when: "下一次改号资格检查时采用", effect: "不清除已使用次数，只改变后续资格", where: "App 安全设置的更改手机号摘要" },
  stepUpDays: { what: "敏感操作二次验证的兼容窗口", when: "只读兼容值，本页不能调整", effect: "不代表已核实用户身份", where: "后台会话相关能力" },
};

async function privacySafeUserLookup(keyword: string) {
  const digits = keyword.replace(/[^0-9]/g, "");
  if (digits.length >= 8 && digits.length <= 15 && /^[+0-9()\s-]+$/.test(keyword)) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(digits));
    return { phoneHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("") };
  }
  return { keyword };
}

export function C5Security({ ctx }: { ctx: CCtx }) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  const rights = session?.authorities ?? [], owner = session?.adminId ?? 0;
  const canRead = rights.includes("user_c5_read"), canFind = rights.includes("user_c1_read");
  const canRevokeOne = rights.includes("user_c5_session_revoke_one");
  const canRevokeAll = rights.some(code => ["user_c2_session_revoke_all", "user_c5_session_revoke_all"].includes(code)) && rights.some(code => ["platform_a2_write", "platform_a2_proposal_create"].includes(code));
  const canReset = rights.includes("user_c5_password_reset"), canDisable = rights.includes("user_c5_2fa_disable"), canConfig = rights.includes("user_c5_write");
  const canUnlock = (row: UserSecurityUserRow) => rights.includes(row.lockKind === "LONG" ? "user_c5_unlock_long" : "user_c5_unlock_short")
    && (row.lockKind === "LONG" ? ["superadmin", "risk"].includes(session?.role ?? "") : ["superadmin", "risk", "support", "supportlead"].includes(session?.role ?? ""));
  const reach = useReach(), pathname = usePathname(), router = useRouter(), params = useSearchParams();
  const focus = (params?.get("userCode") ?? "").trim().toUpperCase();
  const tab = TABS.includes(params?.get("tab") as Tab) ? params!.get("tab") as Tab : "security";
  const [overview, setOverview] = useState<UserSecurityOverview | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [profile, setProfile] = useState<User360Profile | null>(null), [lookup, setLookup] = useState("");
  const [users, setUsers] = useState<User360Profile[]>([]), [usersLoading, setUsersLoading] = useState(true), [usersError, setUsersError] = useState("");
  const [userPage, setUserPage] = useState(1), [userSize, setUserSize] = useState(20), [userTotal, setUserTotal] = useState(0), [userRetry, setUserRetry] = useState(0);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(10), [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false), [locksOpen, setLocksOpen] = useState(false), [shownLock, setShownLock] = useState<UserSecurityUserRow | null>(null), [shownSession, setShownSession] = useState<string | null>(null);
  const [pendingTick, setPendingTick] = useState(0), [recovery, setRecovery] = useState<C5Pending | null>(null), [release, setRelease] = useState(false), [recoveryMessage, setRecoveryMessage] = useState("");
  const generation = useRef(0), selectedRef = useRef(focus), mutation = useRef(false);
  selectedRef.current = focus;
  const ids = useTabIds();
  const setUrl = useCallback((changes: Record<string, string | null>, hash?: string) => {
    const next = new URLSearchParams(params?.toString() ?? "");
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    router.replace(`${pathname ?? "/users/security"}${next.size ? `?${next}` : ""}${hash ?? ""}`, { scroll: false });
  }, [params, pathname, router]);
  const refreshPending = useCallback(() => setPendingTick(value => value + 1), []);
  useEffect(() => { window.addEventListener("nexion-c5-pending-updated", refreshPending); window.addEventListener("nexion-payment-security-updated", refreshPending); return () => { window.removeEventListener("nexion-c5-pending-updated", refreshPending); window.removeEventListener("nexion-payment-security-updated", refreshPending); }; }, [refreshPending]);
  useEffect(() => {
    if (window.location.hash === "#payment-password-panels") { setUrl({ tab: "payment" }, "#payment-password-panels"); }
  }, []);
  useEffect(() => { if (tab === "payment" && !loading && window.location.hash === "#payment-password-panels") document.getElementById("payment-password-panels")?.scrollIntoView({ block: "start" }); }, [tab, loading]);
  useEffect(() => { setShownSession(null); setShownLock(null); setProfile(null); setOverview(null); setPage(1); }, [focus, epoch]);
  const load = useCallback(async () => {
    if (!canRead) { setOverview(null); setLoading(false); return false; }
    const id = ++generation.current;
    setLoading(true); setOverview(null); setError("");
    try {
      const result = await fetchUserSecurityOverview({ userKey: focus || undefined, pageNum: page, pageSize });
      if (id !== generation.current) return false;
      if (focus && ![String(result.selectedUser?.userId), String(result.selectedUser?.userNo)].includes(focus)) throw new Error("返回用户与当前选择不符，请重新选择。");
      setOverview(result); return true;
    } catch (failure) { if (id === generation.current) { setError(displayAdminError(failure)); if (failure instanceof Error && "status" in failure && [401, 403].includes(Number(failure.status))) { setProfile(null); announcePermissionDenied(); } } return false; }
    finally { if (id === generation.current) setLoading(false); }
  }, [focus, page, pageSize, epoch, canRead]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);
  useEffect(() => {
    if (!canRead || !canFind) { setUsers([]); setUsersLoading(false); return; }
    let cancelled = false;
    setUsersLoading(true); setUsers([]); setUsersError("");
    const timer = window.setTimeout(async () => {
      try { const result = await fetchUserProfilesPage({ ...(lookup.trim() ? await privacySafeUserLookup(lookup.trim()) : {}), pageNum: userPage, pageSize: userSize }); if (!cancelled) { setUsers(result.records); setUserTotal(result.total); } }
      catch (failure) { if (!cancelled) { setUsersError(displayAdminError(failure)); setUserTotal(0); } }
      finally { if (!cancelled) setUsersLoading(false); }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [lookup, userPage, userSize, userRetry, epoch, canRead, canFind]);
  const selectedUser = overview?.selectedUser ?? null, userId = userIdOf(selectedUser);
  const selectedName = userNicknameText(text(selectedUser?.nickname ?? profile?.nickname, ""), profile?.phoneMasked);
  useEffect(() => {
    if (!userId || !canFind || profile && profile.userNo === selectedUser?.userNo) return;
    let live = true;
    void fetchUserProfilesPage({ keyword: text(selectedUser?.userNo, userId), pageNum: 1, pageSize: 20 }).then(result => {
      if (live) setProfile(result.records.find(row => row.userNo === selectedUser?.userNo) ?? null);
    }).catch(() => { if (live) setProfile(null); });
    return () => { live = false; };
  }, [userId, selectedUser?.userNo, canFind, epoch]);
  const pending = useMemo(() => owner && canRead ? pendingC5Commands(owner) : [], [owner, canRead, pendingTick]);
  const logoutPending = useMemo(() => owner && canRead ? listSessionRevocationApprovals(owner) : [], [owner, canRead, pendingTick]);
  const policyPending = owner ? pendingPaymentPolicy(owner) : null, paymentPending = owner && userId ? pendingPaymentRelease(owner, userId) : null;
  const phonePending = owner && userId ? pendingPhoneCommands(owner, userId) : [], modelPending = owner && userId ? pendingModelLockCommands(owner, userId) : [];
  const userBlocked = (id: string) => busy ? "正在提交，请稍候" : pending.some(row => !isCompleteC5Command(row) || row.userId === id) || logoutPending.some(row => row.userId === id) ? "此用户有待确认原操作，请先核对" : undefined;
  const sessions = overview?.sessions?.records ?? [], selectedSession = sessions.find(row => row.refreshTokenId === shownSession);
  const lockedUsers = overview?.lockedUsers ?? [], credentials = overview?.credentialParams ?? [];
  const activeCount = count(overview?.selectedActiveSessionCount), shortCount = count(overview?.stats?.lockedShort), longCount = count(overview?.stats?.lockedLong);
  const lockCount = shortCount !== null && longCount !== null ? shortCount + longCount : null;
  const rawReturn = params?.get("returnTo") ?? "";
  const back = /^\/(?!\/)/.test(rawReturn) && !/[\\\u0000-\u001f]/.test(rawReturn) && reach(rawReturn) ? { href: rawReturn, label: rawReturn.startsWith("/users/search/") ? "返回用户详情" : rawReturn.startsWith("/service/sessions") ? "返回原会话" : rawReturn.startsWith("/users/search") ? "返回用户列表" : "返回来源页面" } : null;

  function clearSelection(next: string) {
    generation.current++; setLookup(next); setUserPage(1); setPage(1); setOverview(null); setProfile(null); setShownSession(null); setShownLock(null); setUrl({ userCode: null });
  }
  function choose(row: User360Profile) {
    const code = text(row.userNo, "").toUpperCase();
    if (!code) return;
    generation.current++; setOverview(null); setProfile(row); setPage(1); setPicker(false); setShownSession(null); setShownLock(null); setUrl({ userCode: code });
  }
  async function perform(original: Parameters<typeof prepareC5Command>[0]) {
    if (mutation.current) return false;
    mutation.current = true; setBusy(true);
    let row: C5Pending | undefined;
    try {
      row = prepareC5Command(original); refreshPending();
      await submitC5Command(row);
      if (await load()) { forgetC5Command(row); ctx.toast(original.kind === "revoke-one" ? "该设备已下线" : original.kind === "password-reset" ? "已要求用户下次登录完成密码重设" : original.kind === "disable-2fa" ? "两步验证已关闭" : original.kind === "unlock" ? "登录锁定已解除，请核对账户及密码重置要求" : "登录与改号规则已更新"); }
      else ctx.toast("操作已返回，页面尚未刷新。请读回核对。", "warn");
      return true;
    } catch (failure) {
      if (!row) throw failure;
      if (failure instanceof Error && "status" in failure && [401, 403].includes(Number(failure.status))) { setOverview(null); setProfile(null); setShownSession(null); setShownLock(null); announcePermissionDenied(); }
      ctx.toast("原操作已保留，请到页面上方核对结果。", "warn"); return true;
    } finally { mutation.current = false; setBusy(false); refreshPending(); }
  }
  function begin(kind: C5CommandKind, row: UserSecurityUserRow, device?: UserSession) {
    const id = userIdOf(row), target = kind === "revoke-one" ? text(device?.refreshTokenId, "") : id;
    if (!id || !target || userBlocked(id)) return;
    const unlockKind = row.lockKind === "LONG" ? "LONG" : "SHORT";
    const label = kind === "revoke-one" ? "退出该设备" : kind === "password-reset" ? "要求重置登录密码" : kind === "disable-2fa" ? "关闭两步验证" : `解除${unlockKind === "LONG" ? "长" : "短"}锁`;
    const effect = kind === "revoke-one" ? "该设备立即下线。" : kind === "password-reset" ? "全部设备下线，下次登录须由用户设置新密码。" : kind === "disable-2fa" ? "关闭后，登录不再受两步验证保护。" : "清除登录失败次数；账户冻结、封禁或待重置密码要求仍可能阻止登录。";
    ctx.openActionConfirm({ briefKind: "security", action: `${label} · ${userLabel(row)}`, title: label, detail: effect, reasonMin: 8, reasonMax: 200, confirmLabel: `确认${kind === "password-reset" ? "要求重置密码" : label}`, confirmTone: kind === "revoke-one" || kind === "disable-2fa" ? "danger" : "primary", effect: <StatusTag tone="progress">立即生效</StatusTag>,
      facts: <Facts><Fact k="用户">{userLabel(row)}</Fact>{device ? <><Fact k="设备">{platformSessionDeviceText(text(device.deviceName))}</Fact><Fact k="设备编号">{maskSessionId(target)}</Fact><Fact k="IP">{text(device.clientIpMasked)}</Fact><Fact k="最近活跃">{time(device.lastActiveAt ?? device.issuedAt)}</Fact></> : <>{kind === "disable-2fa" && <Fact k="两步验证">已开启 → 已关闭</Fact>}<Fact k="登录锁定">{lockLabel(row)}</Fact><Fact k="密码重置">{row.passwordResetRequired ? "待用户重置密码" : "未要求重置"}</Fact>{kind === "unlock" && <><Fact k="登录失败">{text(row.loginFailCount)} 次</Fact><Fact k="锁定原因">{text(row.lockReason)}</Fact></>}</>}</Facts>,
      statedBrief: { impact: effect, check: kind === "revoke-one" ? "提交时检查该设备状态与单台退出权限" : "提交时检查当前用户状态、精确权限与本人核验声明" },
      reasonPlaceholder: "例如：已核实用户与设备，并根据工单说明处置依据",
      ...(kind === "revoke-one" ? {} : { businessForm: { kind: "identity-verify" as const, subject: `${userLabel(row)} · ${label}`, presentation: "authorization-and-declaration" as const, serverVerification: { channel: "管理员权限", ticket: kind === "password-reset" ? "要求重置登录密码权限" : kind === "disable-2fa" ? "关闭两步验证权限" : `解除${unlockKind === "LONG" ? "长" : "短"}锁权限`, verifiedAt: "提交时检查", verifiedBy: currentAdminOperator(), expiresAt: "仅本次" } } }),
      run: (reason, _value, evidence) => {
        const operator = currentAdminOperator(), body = kind === "revoke-one" ? { reason, operator } : { reason, operator, operatorConfirmed: evidence?.ack === "true", lockKind: kind === "unlock" ? unlockKind : null };
        return perform({ owner, kind, userId: id, userNo: text(row.userNo), label: `${label} · ${userLabel(row)}`, target, method: "POST", path: kind === "revoke-one" ? `/api/admin/users/sessions/${encodeURIComponent(target)}/revoke` : `/api/admin/users/profiles/${id}/security/${kind === "unlock" ? "unlock" : kind}`, body: JSON.stringify(body), reason, operator, operatorConfirmed: evidence?.ack === "true", ...(kind === "unlock" ? { lockKind: unlockKind } : {}) });
      },
    });
  }
  function revokeAll() {
    if (!session || !selectedUser || !canRevokeAll) return;
    ctx.openActionConfirm({ briefKind: "security", action: `退出全部设备 · ${userLabel(selectedUser)}`, title: "退出全部设备", detail: "提交后由另一位超级管理员批准，以批准时在线设备为准。", completionCopy: "批准后生效；提交审批不会立即退出设备。", reasonMin: 8, reasonMax: 200, effect: <StatusTag tone="progress">批准后生效</StatusTag>, confirmLabel: "提交全部设备登出审批", getPendingReason: () => pendingSessionRevocationApproval(owner, userId)?.reason,
      facts: <Facts><Fact k="用户">{userLabel(selectedUser)}</Fact><Fact k="当前在线设备">{activeCount ?? "—"}</Fact></Facts>, statedBrief: { impact: "另一位超级管理员批准后，退出该用户批准时的全部在线设备", check: "提交时检查全部设备退出专权和 A2 提案权" },
      run: async reason => { setBusy(true); try { await proposeSessionRevocation(session, userId, userLabel(selectedUser), reason); ctx.toast("已提交全部设备登出审批，批准后生效"); } finally { setBusy(false); refreshPending(); } },
    });
  }
  function adjust(param: UserCredentialParam) {
    if (!param.key || param.readOnly || !canConfig || pending.some(row => row.kind === "credential")) return;
    const help = PARAM_HELP[param.key];
    ctx.openActionConfirm({ briefKind: "config", action: `调整账户安全规则 · ${text(param.name)}`, title: `调整${text(param.name)}`, detail: help?.effect ?? text(param.note), reasonMin: 8, reasonMax: 200, confirmLabel: `确认调整${text(param.name)}`, statedBrief: { impact: help?.when ?? "按服务端当前配置生效", check: "提交时检查整数范围、配置版本和规则修改权限" },
      edit: { kind: "number", current: text(param.value).match(/\d+/)?.[0] ?? "", unit: text(param.unit, ""), min: Number(param.min), max: Number(param.max), step: 1, disallowCurrent: true },
      run: (reason, value) => { if (!value || !Number.isSafeInteger(Number(param.version))) return false; const operator = currentAdminOperator(), version = Number(param.version); return perform({ owner, kind: "credential", userId: "", userNo: "", label: `调整${text(param.name)}`, target: param.key!, path: `/api/admin/users/security/credential-params/${param.key}`, method: "PATCH", body: JSON.stringify({ value, reason, operator, expectedVersion: version }), reason, operator, value, version }); },
    });
  }
  async function recover(retry: boolean) {
    if (!recovery || mutation.current) return;
    mutation.current = true; setBusy(true); setRecoveryMessage("");
    try {
      if (retry) await submitC5Command(recovery);
      const refreshed = recovery.userId && selectedRef.current !== recovery.userNo ? await fetchUserSecurityOverview({ userKey: recovery.userNo || recovery.userId, pageNum: 1, pageSize: 10 }) : await load();
      const latest = pendingC5Commands(owner).find(row => row.commandKey === recovery.commandKey);
      if (refreshed && latest?.returned) { forgetC5Command(latest); setRecovery(null); ctx.toast("原操作已返回，页面已重新读取"); }
      else { setRecovery(latest ?? recovery); setRecoveryMessage("已读回当前状态。当前状态不能证明原命令的结果，原记录继续保留。"); }
    } catch (failure) { setRecovery(pendingC5Commands(owner).find(row => row.commandKey === recovery.commandKey) ?? recovery); setRecoveryMessage(displayAdminError(failure)); }
    finally { mutation.current = false; setBusy(false); refreshPending(); }
  }
  const userTable = <><Table aria-label="用户列表" label="用户列表" className="c5-users"><thead><tr><Th>用户</Th><Th className="c5-phone-col">手机号</Th><Th sticky="end">操作</Th></tr></thead><tbody>
    {usersLoading ? <TableLoading columns={3} /> : usersError ? <TableMessage columns={3}><BlockState compact state="error" title="用户列表未能读取" detail={usersError} onRetry={() => setUserRetry(value => value + 1)} retryLabel="重新加载" /></TableMessage> : !users.length ? <TableMessage columns={3}>{lookup.trim() ? "没有找到用户，换个关键词试试" : "暂无用户"}</TableMessage> : users.map(row => <Tr key={text(row.id ?? row.userNo)} onOpen={() => choose(row)}><Td><Cell main={userNicknameText(text(row.nickname, ""), row.phoneMasked) || text(row.userNo)} sub={row.nickname ? text(row.userNo) : undefined} title={userNicknameText(text(row.nickname, ""), row.phoneMasked)} /><span className="c5-mobile-phone">{text(row.phoneMasked)}</span></Td><Td className="c5-phone-col"><Cell mono main={text(row.phoneMasked)} /></Td><Td sticky="end"><Button size="sm" disabled={busy} onClick={() => choose(row)}>查看安全信息</Button></Td></Tr>)}
  </tbody></Table>{userTotal > 0 && <Pager label="用户" total={userTotal} page={userPage} pageSize={userSize} sizes={[20, 50, 100, 200]} loading={usersLoading} onPage={setUserPage} onPageSize={size => { setUserSize(size); setUserPage(1); }} />}</>;
  if (!canRead) return <><PageHeader pageId="C5" title="安全与登录设备" /><BlockState state="denied" title="当前没有查看权限" detail="恢复读取权限后，可继续查询原待确认操作。" /></>;
  return <div className="c5-workbench">
    <PageHeader pageId="C5" title="安全与登录设备" summary="先选用户，再处理登录、支付密码或手机换机。" back={back && <Link href={back.href}>{back.label}</Link>} actions={<Button icon={<RefreshCw size={14} />} loading={loading} disabledReason={busy ? "正在提交，请稍候" : undefined} onClick={() => void load()}>刷新</Button>} readOnly={!rights.some(code => code.startsWith("user_c5_") && code !== "user_c5_read") && !canRevokeAll ? "当前账号只能查看这页" : undefined} />
    {!canFind && <Notice tone="warn">C5 需要配套用户读取权限，请联系权限管理员核对授权。</Notice>}
    {!focus && !picker && <Panel title="选择用户" icon={UserRound} explain="原始手机号只用于本地转换，不会发送。输入后 300 毫秒查询；用户编码、昵称、推荐码按关键词查询。"><div className="c5-search"><Input aria-label="搜索用户" data-search value={lookup} disabled={busy || !canFind} onChange={event => clearSelection(event.target.value)} placeholder="用户编码 / 昵称 / 推荐码 / 手机号" /><Explain label="搜索用户的说明" rows={[{ k: "手机号", v: "原始手机号只用于本地转换，不会发送" }]} /></div></Panel>}
    {focus && <Panel title={<span className="c5-identity"><UserRound size={22} aria-hidden /><span><strong>{selectedName || text(selectedUser?.userNo, focus)}</strong><span className="c5-identity-meta">{selectedName && <span data-mono>{text(selectedUser?.userNo, focus)}</span>}<span>{text(profile?.phoneMasked, "手机号未读取")}</span>{profile?.status ? <StatusTag tone={profile.status === "ACTIVE" ? "ok" : "warn"}>{formatAccountStatus(profile.status).label}</StatusTag> : <span>账户状态未读取</span>}</span></span></span>} actions={<Button disabled={busy} onClick={() => setPicker(true)}>更换用户</Button>}>
      <div className="c5-login-band" aria-label="用户登录安全状态"><div><LockKeyhole size={16} /><span>登录锁定</span><strong data-tone={selectedUser?.locked ? "warn" : undefined}>{loading ? "读取中" : lockLabel(selectedUser)}</strong>{selectedUser && <small className="c5-login-fails">登录失败 {text(selectedUser.loginFailCount)} 次</small>}</div><div><ShieldCheck size={16} /><span>两步验证</span><strong>{loading ? "读取中" : selectedUser ? selectedUser.twoFactorEnabled ? "已开启" : "已关闭" : "未确认"}</strong></div><div><KeyRound size={16} /><span>密码重置</span><strong data-tone={selectedUser?.passwordResetRequired ? "warn" : undefined}>{loading ? "读取中" : selectedUser ? selectedUser.passwordResetRequired ? "待用户重置密码" : "未要求重置" : "未确认"}</strong></div></div>
    </Panel>}
    {pending.map(row => <Notice key={row.commandKey} tone="warn" title={row.label ?? "旧登录处置结果待确认"} action={<Button size="sm" disabled={busy} onClick={() => { setRecovery(row); setRelease(false); setRecoveryMessage(""); }}>查看原操作</Button>}><span>{row.userNo || "原对象见恢复记录"} · {time(new Date(row.createdAt).toISOString())} · {row.returned ? "操作已返回，页面尚未刷新" : row.expiresAt <= Date.now() ? "已过 24 小时，只能读回核对" : "结果待确认"}</span></Notice>)}
    {logoutPending.map(row => <Notice key={row.commandKey} tone="warn" title={`全部设备登出审批待确认 · ${row.label}`} action={<Button size="sm" disabledReason={busy ? "正在提交" : undefined} onClick={async () => { if (!session) return; setBusy(true); try { await proposeSessionRevocation(session, row.userId, row.label, row.reason); ctx.toast("已查到原审批单，批准后生效"); } catch (failure) { ctx.toast(displayAdminError(failure), "warn"); } finally { setBusy(false); refreshPending(); } }}>查询原操作</Button>}><span>{time(new Date(row.createdAt).toISOString())} · <span data-mono>{row.commandKey}</span></span></Notice>)}
    {policyPending && tab !== "payment" && <Notice tone="warn" title="支付密码规则调整结果待确认" action={<Button size="sm" onClick={() => setUrl({ tab: "payment", paymentTab: "policy" })}>查询原调整结果</Button>}>原调整记录已保留，请先核对结果。</Notice>}
    {paymentPending && tab !== "payment" && <Notice tone="warn" title={`支付密码解除结果待确认 · ${userLabel(selectedUser)}`} action={<Button size="sm" onClick={() => setUrl({ tab: "payment", paymentTab: "policy" })}>查询原操作</Button>}>原记录 {paymentPending.recordId} · 只能查询原命令。</Notice>}
    {(phonePending.length > 0 || modelPending.length > 0) && tab !== "phone" && <Notice tone="warn" title={`手机处置结果待确认 · ${userLabel(selectedUser)}`} action={<Button size="sm" onClick={() => setUrl({ tab: "phone" })}>查看原操作</Button>}>{phonePending.length + modelPending.length} 笔原操作已保留，只能读回核对。</Notice>}
    <PageTabs ids={ids} label="安全管理内容" value={tab} onChange={value => setUrl({ tab: value })} items={[{ value: "security", label: "用户安全处置", disabled: busy }, { value: "credentials", label: "登录与改号规则", disabled: busy }, { value: "payment", label: "支付密码", disabled: busy }, { value: "phone", label: "手机换机", disabled: busy }]} />
    <div {...ids.panel(tab)} className="rd-tab-pane">
      {error && <BlockState state="error" title="登录安全信息未能读取" detail={error} onRetry={() => void load()} retryLabel="重新加载" />}
      {tab === "security" && <>
        <Conclusion state={error ? "warn" : selectedUser?.locked || selectedUser?.passwordResetRequired ? "warn" : "neutral"} icon={ShieldCheck}>{loading ? "正在读取登录安全信息" : !focus ? "先选择用户，查看登录设备与安全状态" : selectedUser?.locked ? `${lockLabel(selectedUser)}，请核对本人身份后处置` : selectedUser?.passwordResetRequired ? "待用户重置密码，解除登录锁也不会取消此要求" : selectedUser ? "登录未锁定，其他限制以账户与支付状态为准" : "该用户安全状态未确认"}</Conclusion>
        <StatBand><Stat label="在线设备（全平台）" value={count(overview?.stats?.activeSessions)?.toLocaleString("en-US") ?? "—"} unit="台" icon={MonitorSmartphone} tone="role-2" explain="全平台当前活跃的登录设备，不是当前用户的设备数" /><Stat label="两步验证开启率" value={count(overview?.stats?.twoFactorRatePct) ?? "—"} unit={overview ? "%" : undefined} icon={ShieldCheck} tone="role-2" explain="服务端返回的全平台比例；没有样本分母，不作风险判断" /><Stat label="锁定中账户" value={lockCount ?? "—"} unit="个" lead={!!lockCount} icon={LockKeyhole} tone={lockCount ? "warn" : "role-2"} sub={overview ? `短时 ${shortCount} · 长时 ${longCount}` : loading ? "读取中" : "未读取"} onOpen={lockCount ? () => setLocksOpen(true) : undefined} openLabel="查看锁定账户 · 最多 5 条" /><Stat label="今日异常登录" value={count(overview?.stats?.tokenReuseToday) ?? "—"} unit="次" icon={TriangleAlert} tone="role-2" explain="今日登录凭证复用次数，不是所有安全异常的用户数" /></StatBand>
        {overview && <div className="c5-context-line">{lockCount ? <Button variant="ghost" size="sm" onClick={() => setLocksOpen(true)}>查看锁定账户 · 最多 5 条</Button> : "当前统计未见登录锁定"}<Button variant="ghost" size="sm" onClick={() => setUrl({ tab: "payment", paymentTab: "exceptions" })}>查看支付密码异常</Button></div>}
        {!focus ? !picker && <Panel title="候选用户" sub={usersLoading ? "读取中" : `${userTotal} 位用户`} flush>{userTable}</Panel> : <Panel title="登录设备" icon={MonitorSmartphone} sub={`${activeCount ?? "—"} 台在线 · ${businessZoneText()}`} flush actions={selectedUser && <div className="c5-actions">{canRevokeAll && <Button size="sm" disabledReason={userBlocked(userId) ?? (activeCount === null ? "在线设备尚未确认" : activeCount === 0 ? "当前没有在线设备" : undefined)} onClick={revokeAll}>退出全部设备</Button>}{canRevokeAll && <StatusTag tone="progress">批准后生效</StatusTag>}</div>}>
          <Table aria-label="用户登录设备" label="用户登录设备" className="c5-sessions"><thead><tr><Th>设备</Th><Th className="c5-ip-col">IP</Th><Th>状态</Th><Th>最近活跃</Th><Th sticky="end">操作</Th></tr></thead><tbody>{loading ? <TableLoading columns={5} /> : !sessions.length ? <TableMessage columns={5}>{error ? "设备记录尚未确认，请重新加载" : "该用户暂无登录记录"}</TableMessage> : sessions.map(device => <Tr key={text(device.refreshTokenId)} selected={device.refreshTokenId === shownSession} onOpen={() => setShownSession(text(device.refreshTokenId))}><Td><Cell main={platformSessionDeviceText(text(device.deviceName))} sub={maskSessionId(text(device.refreshTokenId))} title={platformSessionDeviceText(text(device.deviceName))} /></Td><Td className="c5-ip-col"><Cell mono main={text(device.clientIpMasked)} /></Td><Td><StatusTag tone={device.status === "ACTIVE" ? "ok" : "done"} icon={device.status === "ACTIVE" ? CheckCircle2 : undefined}>{sessionLabel(device.status)}</StatusTag></Td><Td>{sessionTimeAnomaly(device) ? <span className="c5-time-anomaly">时间异常 · 查看详情</span> : <Cell num main={time(device.lastActiveAt ?? device.issuedAt)} />}</Td><Td sticky="end">{canRevokeOne && device.status === "ACTIVE" ? <Button size="sm" disabledReason={userBlocked(userId)} onClick={() => selectedUser && begin("revoke-one", selectedUser, device)}>退出该设备</Button> : <Button size="sm" variant="ghost" onClick={() => setShownSession(text(device.refreshTokenId))}>查看详情</Button>}</Td></Tr>)}</tbody></Table>
          {overview?.sessions && Number(overview.sessions.total) > 0 && <Pager label="用户登录设备" total={Number(overview.sessions.total)} page={page} pageSize={pageSize} sizes={[5, 10, 20, 50]} loading={loading} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} />}
          {selectedUser && <div className="c5-account-actions"><span>账户安全处置<Explain label="账户安全处置的说明" rows={[{ k: "范围", v: "登录密码、两步验证、登录锁和支付密码分别管理" }]} /></span><div className="c5-actions">{canDisable && <Button disabledReason={userBlocked(userId) ?? (!selectedUser.twoFactorEnabled ? "两步验证尚未开启" : undefined)} onClick={() => begin("disable-2fa", selectedUser)}>关闭两步验证</Button>}{canReset && <Button disabledReason={userBlocked(userId) ?? (selectedUser.passwordResetRequired ? "已要求用户下次登录重置密码" : undefined)} onClick={() => begin("password-reset", selectedUser)}>密码重置</Button>}{["SHORT", "LONG"].includes(String(selectedUser.lockKind)) && canUnlock(selectedUser) && <Button disabledReason={userBlocked(userId)} onClick={() => begin("unlock", selectedUser)}>解除{selectedUser.lockKind === "LONG" ? "长" : "短"}锁</Button>}</div></div>}
        </Panel>}
      </>}
      {tab === "credentials" && <Panel title="登录安全与更换手机号限制" icon={KeyRound} explain="更换登录手机号与更换手机设备分开统计。发现登录凭证复用时，系统会撤销相关登录会话。">{loading ? <BlockState state="loading" title="正在读取规则" /> : !credentials.length ? <BlockState state="error" title="当前规则尚未确认" onRetry={() => void load()} /> : <ConfigList label="登录与改号规则">{credentials.map(param => <ConfigRow key={text(param.key)} name={text(param.name)} {...PARAM_HELP[text(param.key)]} note={text(param.note)} value={text(param.value)} sub={param.readOnly ? "只能查看" : undefined} action={canConfig && !param.readOnly ? <Button size="sm" disabledReason={busy ? "正在提交" : pending.some(row => row.kind === "credential" || !isCompleteC5Command(row)) ? "先核对原规则调整结果" : count(param.version) === null ? "规则版本未读取" : undefined} onClick={() => adjust(param)}>调整</Button> : undefined} />)}</ConfigList>}</Panel>}
      <div hidden={tab !== "payment"}><PaymentPasswordPanel key={`payment:${owner}:${epoch}`} userId={userId || null} userLabel={userLabel(selectedUser)} active={tab === "payment"} onPendingChange={refreshPending} onBusyChange={setBusy} /></div>
      <div hidden={tab !== "phone"}><PhoneReplacementPanel active={tab === "phone"} userCode={text(selectedUser?.userNo, "")} key={`phone:${owner}:${epoch}:${userId}`} userId={userId || null} userLabel={userLabel(selectedUser)} onPendingChange={refreshPending} onBusyChange={setBusy} /></div>
    </div>
    {picker && <Drawer open onClose={() => setPicker(false)} title="更换用户" icon={UserRound} wide><div className="c5-search"><Input data-search aria-label="搜索用户" value={lookup} onChange={event => clearSelection(event.target.value)} placeholder="用户编码 / 昵称 / 推荐码 / 手机号" /><Explain label="搜索用户的说明" rows={[{ k: "手机号", v: "原始手机号只用于本地转换，不会发送" }]} /></div>{userTable}</Drawer>}
    {tab === "security" && selectedSession && <Drawer open onClose={() => setShownSession(null)} title="登录设备详情" sub={maskSessionId(text(selectedSession.refreshTokenId))} icon={MonitorSmartphone} nav={{ hasPrev: sessions.indexOf(selectedSession) > 0, hasNext: sessions.indexOf(selectedSession) < sessions.length - 1, onPrev: () => setShownSession(text(sessions[sessions.indexOf(selectedSession) - 1]?.refreshTokenId)), onNext: () => setShownSession(text(sessions[sessions.indexOf(selectedSession) + 1]?.refreshTokenId)) }} footer={<Decision primary={canRevokeOne && <Button variant="danger-outline" disabledReason={userBlocked(userId) ?? (selectedSession.status !== "ACTIVE" ? "只有活跃设备可以退出" : undefined)} onClick={() => selectedUser && begin("revoke-one", selectedUser, selectedSession)}>退出该设备</Button>} />}>
      <JudgmentPoints rows={[{ label: "用户", value: userLabel(selectedUser), icon: UserRound }, { label: "设备", value: platformSessionDeviceText(text(selectedSession.deviceName)) }, { label: "状态", value: sessionLabel(selectedSession.status) }, { label: "最近活跃", value: time(selectedSession.lastActiveAt ?? selectedSession.issuedAt), state: sessionTimeAnomaly(selectedSession) ? "warn" : undefined, reason: sessionTimeAnomaly(selectedSession) ? "时间记录有误" : undefined }]} /><Facts><Fact k="IP">{text(selectedSession.clientIpMasked)}</Fact><Fact k="登录时间">{time(selectedSession.issuedAt)}</Fact><Fact k="过期时间">{time(selectedSession.expiresAt)}</Fact><Fact k="下线时间">{time(selectedSession.revokedAt)}</Fact><Fact k="时区">{businessZoneText()}</Fact></Facts><Fold title="技术详情" summary="原始时间与遮罩编号"><Facts><Fact k="设备编号">{maskSessionId(text(selectedSession.refreshTokenId))}</Fact>{(["issuedAt", "lastActiveAt", "expiresAt", "revokedAt"] as const).map(key => <Fact key={key} k={key}>{text(selectedSession[key])}</Fact>)}</Facts></Fold>
    </Drawer>}
    {tab === "security" && locksOpen && !shownLock && <Drawer open onClose={() => setLocksOpen(false)} title="锁定账户" sub="最多 5 条 · 按输错次数排序" icon={LockKeyhole} wide><Table aria-label="被锁定的账户" label="被锁定的账户" className="c5-locks"><thead><tr><Th>用户</Th><Th>锁定类型</Th><Th>原因</Th><Th sticky="end">操作</Th></tr></thead><tbody>{lockedUsers.map(row => <Tr key={userIdOf(row)} onOpen={() => setShownLock(row)}><Td><Cell main={userNicknameText(text(row.nickname, ""), row.phoneMasked) || text(row.userNo)} sub={row.nickname ? text(row.userNo) : undefined} /></Td><Td><StatusTag tone="warn">{lockLabel(row)}</StatusTag></Td><Td><Cell main={text(row.lockReason)} title={text(row.lockReason)} /></Td><Td sticky="end">{canUnlock(row) ? <Button size="sm" disabledReason={userBlocked(userIdOf(row))} onClick={() => begin("unlock", row)}>解锁</Button> : <Button variant="ghost" size="sm" onClick={() => setShownLock(row)}>查看详情</Button>}</Td></Tr>)}{!lockedUsers.length && <TableMessage columns={4}>当前可见范围没有锁定账户</TableMessage>}</tbody></Table></Drawer>}
    {tab === "security" && shownLock && <Drawer open onClose={() => setShownLock(null)} title="登录锁定详情" sub={text(shownLock.userNo)} icon={LockKeyhole} footer={<Decision others={<Button onClick={() => setShownLock(null)}>返回列表</Button>} primary={canUnlock(shownLock) && <Button disabledReason={userBlocked(userIdOf(shownLock))} onClick={() => begin("unlock", shownLock)}>解除{shownLock.lockKind === "LONG" ? "长" : "短"}锁</Button>} />}><JudgmentPoints rows={[{ label: "用户", value: userLabel(shownLock) }, { label: "登录锁定", value: lockLabel(shownLock), state: "warn" }, { label: "输错次数", value: `${text(shownLock.loginFailCount)} 次` }, { label: "密码重置", value: shownLock.passwordResetRequired ? "待用户重置密码" : "未要求重置" }]} /><Facts><Fact k="原因">{text(shownLock.lockReason)}</Fact><Fact k="剩余说明">{text(shownLock.lockLeft)}</Fact></Facts></Drawer>}
    {recovery && <Modal title={release ? "解除待确认" : "核对原登录操作"} icon={ShieldCheck} onClose={() => { setRecovery(null); setRelease(false); }} busy={busy} footer={<Decision others={<Button onClick={() => { if (release) setRelease(false); else setRecovery(null); }}>返回</Button>} danger={release ? <Button variant="danger" onClick={() => { forgetC5Command(recovery); setRecovery(null); setRelease(false); refreshPending(); }}>确认解除</Button> : recovery.rejection && <Button variant="danger-outline" onClick={() => setRelease(true)}>解除待确认</Button>} primary={!release && <><Button disabled={busy} onClick={() => void recover(false)}>读回核对</Button>{isCompleteC5Command(recovery) && !recovery.returned && !recovery.rejection && recovery.expiresAt > Date.now() && <Button variant="primary" disabledReason={!rights.includes(recovery.kind === "credential" ? "user_c5_write" : recovery.kind === "revoke-one" ? "user_c5_session_revoke_one" : recovery.kind === "password-reset" ? "user_c5_password_reset" : recovery.kind === "disable-2fa" ? "user_c5_2fa_disable" : recovery.lockKind === "LONG" ? "user_c5_unlock_long" : "user_c5_unlock_short") ? "当前缺少原操作权限" : undefined} onClick={() => void recover(true)}>原样重试</Button>}</>} />}>
      {release ? <ReleaseBody label={recovery.label ?? "旧登录操作"} explain={recovery.rejection} /> : <><Facts><Fact k="原对象">{recovery.label ?? "旧登录处置（缺少原对象快照）"}</Fact><Fact k="发起时间">{time(new Date(recovery.createdAt).toISOString())}</Fact><Fact k="命令号"><span data-mono>{recovery.commandKey}</span><IconButton aria-label="复制原命令号" onClick={() => void navigator.clipboard.writeText(recovery.commandKey).then(() => ctx.toast("已复制命令号"), () => ctx.toast("复制失败，请手动复制", "warn"))}><Copy size={14} /></IconButton></Fact>{recovery.reason && <Fact k="原理由">{recovery.reason}</Fact>}{recovery.version !== undefined && <Fact k="原版本">{recovery.version}</Fact>}{recovery.value && <Fact k="原新值">{recovery.value}</Fact>}</Facts><Notice tone="warn">{!isCompleteC5Command(recovery) ? "旧记录缺少完整原请求，只能读回核对；原记录继续保留。" : recovery.expiresAt <= Date.now() ? "原命令已过 24 小时，保留记录，不再重发。" : recovery.returned ? "操作已返回，页面尚未刷新。请读回核对。" : "重试只使用原对象、原内容、原理由和原命令号。读回当前状态不能代替原命令回执。"}</Notice>{recovery.rejection && <Notice tone="danger" title="原操作已明确拒绝">{recovery.rejection}</Notice>}{recoveryMessage && <Notice tone="warn">{recoveryMessage}</Notice>}</>}
    </Modal>}
  </div>;
}
