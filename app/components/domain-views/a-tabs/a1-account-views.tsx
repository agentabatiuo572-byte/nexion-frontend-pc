"use client";

/**
 * A1 运营账号与权限的界面件：详情抽屉、新建和编辑抽屉、临时密码结果、改角色的权限对照、原操作提醒。
 * 只负责排版：数据、权限判断和提交都由 a1-accounts.tsx 传进来，这里不发请求、不改请求内容。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, CircleHelp, Clock3, Copy, KeyRound, MonitorSmartphone, PencilLine, UserCog, UserPlus, UserRound } from "lucide-react";
import { Button, Decision, Drawer, Explain, Fact, Facts, Field, Fold, Input, JudgmentPoints, Modal, Notice, Segments, Select, StatusTag, Timeline, type TimelineEntry } from "@/app/components/rd";
import { domainOfPermission, pageLabelFromCode } from "@/lib/admin/perm-domain";
import { F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { businessStamp, businessZone, businessZoneText, formatBusinessTimeCompact, parseBusinessTime } from "@/lib/admin/business-time";
import { AVATAR_GENDER_OPTIONS, type AvatarGender } from "@/lib/admin/account-avatar-contract";
import { avatarDrafts, avatarDraftFingerprint, newAccountAvatarTarget } from "@/lib/admin/account-avatar-pending";
import { APP_VISIBLE_TEXT_HINT, appVisibleTextError } from "@/lib/admin/content-language-rules";
import { aApprovalPermissionText } from "@/lib/admin/a-approval-names";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { A1CreateAccountInput, A1Operator, A1PasswordResetResult, A1RoleDefinition, A1UpdateAccountInput } from "@/lib/admin/a1-client";
import { AccountAvatarPicker } from "./account-avatar-picker";
import { SupportAvatar } from "../m-tabs/support-avatar";

/* ---------- 文字 ---------- */

export function roleName(roles: A1RoleDefinition[], role: string | null | undefined) {
  if (!role || role === "unassigned") return "暂未分配";
  return roles.find((r) => r.key === role)?.name ?? role;
}

export function operatorDisplayName(op: Pick<A1Operator, "name" | "username" | "email">) {
  return op.name?.trim() || op.username?.trim() || op.email?.trim() || "运营账号";
}

export function operatorDisplayLabel(op: Pick<A1Operator, "name" | "username" | "email">) {
  const name = operatorDisplayName(op);
  const username = op.username?.trim();
  if (username && username !== name) return `${name}(${username})`;
  const email = op.email?.trim();
  return email && email !== name ? `${name}(${email})` : name;
}

export const credentialStatusText = (value?: string | null) => value === "PASSWORD_CHANGE_REQUIRED" ? "下次登录需修改密码" : value === "ACTIVE" ? "正常" : "—";

/** 写到分钟；空值、读不出、1970 这类 0 值都写「—」。时区由区块标一次。 */
export function minuteText(value?: string | null) {
  if (!value || !value.trim()) return "—";
  const at = parseBusinessTime(value.trim());
  if (!Number.isFinite(at) || new Date(at).getUTCFullYear() < 2000) return "—";
  return formatBusinessTimeCompact(value, "—");
}

export const zoneNote = () => businessZoneText();

/* ---------- 权限按模块分组 ---------- */

export type PermPage = { id: string; name: string; codes: string[] };
export type PermDomain = { code: string; name: string; count: number; pages: PermPage[] };

const permLabel = (code: string) => F4_MATERIAL_PERMISSIONS.find((item) => item.code === code)?.label ?? code;

export function groupPermissionCodes(codes: readonly string[]): PermDomain[] {
  const byDomain = new Map<string, PermDomain>();
  for (const code of [...new Set(codes)].sort()) {
    const domain = domainOfPermission(code);
    let group = byDomain.get(domain.code);
    if (!group) { group = { code: domain.code, name: domain.name, count: 0, pages: [] }; byDomain.set(domain.code, group); }
    const label = pageLabelFromCode(code);
    // 菜单里找不到的页面编号，不写「(扩展)」这种内部说法。
    const page = label.name.endsWith(" (扩展)") ? { id: label.id, name: `${label.id} 页面` } : label;
    let row = group.pages.find((item) => item.id === page.id);
    if (!row) { row = { id: page.id, name: page.name, codes: [] }; group.pages.push(row); }
    row.codes.push(code);
    group.count += 1;
  }
  return [...byDomain.values()]
    .map((group) => ({ ...group, pages: group.pages.sort((a, b) => a.id.localeCompare(b.id)) }))
    .sort((a, b) => a.code === "?" ? 1 : b.code === "?" ? -1 : a.code.localeCompare(b.code));
}

export function permSummary(codes: readonly string[] | null | undefined) {
  if (!codes) return "权限尚未读到";
  if (!codes.length) return "没有任何权限";
  return `${groupPermissionCodes(codes).length} 个模块 · ${new Set(codes).size} 项权限`;
}

/**
 * 高风险：能改账号、审批、角色、菜单或权限清单的权限（平台基础 A1、A2、A6、A7、A8 里不是只读的码）。
 * 只按页面已读到的权限码判断；其他页面的敏感操作类型在「权限清单」，这里不另读。
 */
const RISKY_PAGES = new Set(["a1", "a2", "a6", "a7", "a8"]);
export function isHighRiskCode(code: string) {
  const parts = code.split("_");
  return parts[0] === "platform" && RISKY_PAGES.has(parts[1] ?? "") && parts[parts.length - 1] !== "read";
}
export const HIGH_RISK_EXPLAIN = "「高风险」指能改账号、角色、菜单、权限清单或批准审批单的权限，拿到就能改变谁能进后台、能做什么。其他页面的敏感操作到「权限清单」看。";

/** 按模块分组的权限：模块名和项数在第一层，每页的权限码收进问号（第三层）。markRisk 时高风险的格标出来。 */
export function PermGroups({ codes, label, tone, empty = "没有权限", markRisk = false }: { codes: readonly string[]; label: string; tone?: "gain" | "loss"; empty?: string; markRisk?: boolean }) {
  const groups = groupPermissionCodes(codes);
  if (!groups.length) return <p className="a1-muted">{empty}</p>;
  return (
    <ul className="a1-perm-groups" aria-label={label} data-tone={tone}>
      {groups.map((group) => (
        <li key={group.code}>
          <div className="a1-perm-domain"><span className="a1-perm-code">{group.code}</span><span>{group.name}</span><span className="a1-perm-count">{group.count} 项</span></div>
          <ul className="a1-perm-pages">
            {group.pages.map((page) => {
              const risky = markRisk ? page.codes.filter(isHighRiskCode).length : 0;
              return (
                <li key={page.id} data-risk={risky ? "" : undefined}>
                  <span>{page.name}</span>
                  <span className="a1-perm-count">{page.codes.length} 项</span>
                  {risky > 0 && <span className="a1-perm-risk">高风险 {risky}</span>}
                  <Explain label={`${page.name}的权限码`} rows={page.codes.map((code) => ({ k: markRisk && isHighRiskCode(code) ? "高风险" : permLabel(code) === code ? "权限码" : permLabel(code), v: code }))} />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

/* ---------- 原操作提醒（结果未知、待审批） ---------- */

export type A1RecoveryRow = { key: string; name: ReactNode; change: ReactNode; submittedAt?: number; tag: ReactNode; note?: string; actions: ReactNode };

/** 结果未知的说明按操作写：note 写「可能已经怎样、能不能按原操作重试」。 */
export function unknownTag(kind: "direct" | "approval", note?: string) {
  return <StatusTag tone="warn" icon={CircleHelp} explain={note ?? (kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。24 小时内可以按原操作重试，不会重复执行。"
    : "提交时没收到确定结果，可能已经建了审批单。点「查询原结果」核对。")}>结果未知</StatusTag>;
}

export function expiredTag(note = "原请求超过 24 小时，不能再重试，只能查询核对。") {
  return <StatusTag tone="neutral" icon={Clock3} explain={note}>已过期</StatusTag>;
}

export function A1RecoveryNotice({ title, rows }: { title: ReactNode; rows: A1RecoveryRow[] }) {
  if (!rows.length) return null;
  return (
    <Notice tone="warn" title={title}>
      <ul className="a1-recovery" aria-label="原操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="a1-recovery-name">{row.name}</span>
            <span className="a1-recovery-change">{row.change}{row.note && <span> · {row.note}</span>}</span>
            <span className="a1-recovery-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="a1-recovery-state">{row.tag}</span>
            <span className="a1-recovery-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="a1-recovery-zone">提交时间为{zoneNote()}</p>
    </Notice>
  );
}

/**
 * 原头像的独立处理位置：账号列表读不到、编辑框打不开时也能按原操作重试准备头像。
 * 用的是同一个头像选择件和同一条原记录（按账号编号对上），这里不另发请求。
 */
export function AvatarRecoveryModal({ target, onClose }: { target: string; onClose: () => void }) {
  return (
    <Modal title="处理原头像" icon={UserRound} onClose={onClose}
      sub={target === "new" ? "新建账号的头像" : <>账号编号 <span data-mono>{target}</span></>}
      footer={<Button onClick={onClose}>关闭</Button>}>
      <AccountAvatarPicker targetId={target} name="运营账号" currentPath={target === "new" ? undefined : `/api/admin/platform/accounts/${target}/avatar`} onChange={() => undefined} onBlocking={() => undefined} />
    </Modal>
  );
}

/* ---------- 生效方式 ---------- */

export const approvalTag = (note = "批准前账号不变。") => (
  <StatusTag tone="progress" filled explain={`另一位超级管理员在「操作记录与审批」批准后执行。${note}`}>批准后生效</StatusTag>
);
export const directTag = () => <StatusTag tone="progress" filled>立即生效</StatusTag>;
/** 「谁来批」写后端实际检查的人（另一位超级管理员），「需有权限」写要同时有的权限，名字照「权限清单」。 */
export const approverFacts = (...permissions: string[]) => <>
  <Fact k="谁来批">另一位超级管理员</Fact>
  <Fact k="需有权限">{aApprovalPermissionText(...permissions)}</Fact>
</>;

/* ---------- 账号操作清单（详情抽屉） ---------- */

export type A1AccountAction = {
  key: string;
  label: string;
  /** 按钮上的短动词，读屏名字仍是 label。 */
  verb: string;
  icon: typeof UserCog;
  mode: "approval" | "direct";
  /** 对这个人立刻有什么影响，一句话。 */
  impact: string;
  explain?: ReactNode;
  disabledReason?: string | null;
  danger?: boolean;
  onSelect: () => void;
};

function ActionList({ actions }: { actions: A1AccountAction[] }) {
  return (
    <ul className="a1-act-list" aria-label="账号操作">
      {actions.map((action) => {
        const Icon = action.icon;
        return (
          <li key={action.key}>
            <span className="a1-act-icon" aria-hidden><Icon size={16} /></span>
            <span className="a1-act-main">
              <span className="a1-act-name">{action.label}{action.explain && <Explain label={`${action.label}的说明`} content={action.explain} />}</span>
              <span className="a1-act-impact">{action.impact}</span>
            </span>
            <span className="a1-act-mode" data-mode={action.mode}>{action.mode === "approval" ? "提交审批" : "直接生效"}</span>
            <Button size="sm" variant={action.danger ? "danger-outline" : "secondary"} disabledReason={action.disabledReason ?? undefined} onClick={action.onSelect} aria-label={action.label}>{action.verb}</Button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- 账号详情抽屉 ---------- */

export function AccountDetailDrawer({ account, roles, roleCodes, materialPermissionCodes, isSelf, sessionRevokeBlockReason, editBlockReason, actions, busy, nav, onClose, onEdit, onRevokeSession }: {
  account: A1Operator;
  roles: A1RoleDefinition[];
  /** 这个角色的实际权限码；null 是没读到。 */
  roleCodes: string[] | null;
  materialPermissionCodes: string[] | null;
  isSelf: boolean;
  sessionRevokeBlockReason: string | null;
  editBlockReason: string | null;
  actions: A1AccountAction[];
  busy: boolean;
  nav?: { onPrev: () => void; onNext: () => void; hasPrev: boolean; hasNext: boolean };
  onClose: () => void;
  onEdit: () => void;
  onRevokeSession: (sessionId: string) => void;
}) {
  const sessions = account.sessionDetails ?? [];
  const [allSessions, setAllSessions] = useState(false);
  useEffect(() => setAllSessions(false), [account.id]);
  const shownSessions = allSessions ? sessions : sessions.slice(0, 3);
  const history = account.roleHistory ?? [];
  const onlyCurrent = history.length > 0 && history.every((row) => row.source === "CURRENT_ASSIGNMENT");
  const entries: TimelineEntry[] = history.filter((row) => row.source !== "CURRENT_ASSIGNMENT").map((row, index) => ({
    id: `${row.changedAt || "none"}-${index}`,
    action: <>{roleName(roles, row.fromRole)} <ArrowRight size={12} aria-label="改成" /> {roleName(roles, row.toRole)}</>,
    actor: row.operator || "系统",
    at: row.changedAt || "",
  }));
  const current = history.find((row) => row.source === "CURRENT_ASSIGNMENT");
  const enabled = account.status === "enabled";
  return (
    <Drawer open wide onClose={onClose} title={operatorDisplayName(account)} icon={UserRound} tone="role-3" busy={busy} nav={nav}
      sub={<span className="a1-drawer-sub"><span data-mono>{account.username || "登录名读不到"}</span><span>账号编号 <span data-mono>{account.id}</span></span>{isSelf && <StatusTag tone="neutral">你自己</StatusTag>}</span>}
      footer={<Decision others={<Button onClick={onClose}>关闭</Button>} primary={<Button variant="primary" icon={<PencilLine size={14} />} disabledReason={editBlockReason ?? undefined} onClick={onEdit}>编辑账号</Button>} />}>
      <div className="a1-page a1-sheet">
      <div className="a1-detail-head">
        <SupportAvatar name={operatorDisplayName(account)} path={account.avatarAssetId ? `/api/admin/platform/accounts/${account.id}/avatar` : undefined} version={account.avatarVersion ?? undefined} size={56} />
        <JudgmentPoints title="账号要点" rows={[
          { label: "角色", value: roleName(roles, account.role) },
          { label: "两步验证", value: account.tfa ? "已绑定" : "未绑定", state: account.tfa ? undefined : "warn", reason: account.tfa ? undefined : "下次登录先绑定，绑定前不能正常使用后台" },
          { label: "状态", value: enabled ? "启用" : "已停用", state: enabled ? undefined : "neutral" },
          { label: "密码", value: credentialStatusText(account.credentialDeliveryStatus) },
          { label: "最近登录", value: `${minuteText(account.lastLogin)}${minuteText(account.lastLogin) === "—" ? "" : `（${businessZone().label}）`}` },
          { label: "工作邮箱", value: account.email || "未填写" },
        ]} />
      </div>

      <section className="a1-detail-block" aria-labelledby="a1-detail-perms">
        <h3 id="a1-detail-perms" className="a1-detail-title">这个角色能做什么<Explain label="角色权限的说明" content="按「角色管理」里这个角色现在实际授权的权限显示，按模块分组；问号里是权限码。客服资格、主管资格不在角色里，另外管理。" /><span className="a1-detail-sub">{roleName(roles, account.role)} · {permSummary(account.role === "unassigned" || !account.role ? [] : roleCodes)}</span></h3>
        {roleCodes === null && account.role && account.role !== "unassigned"
          ? <Notice tone="warn">角色权限没有读到，这部分没有显示。刷新后再看；改角色也要等权限读到。</Notice>
          : <PermGroups codes={account.role === "unassigned" ? [] : roleCodes ?? []} label="角色权限" empty="暂未分配角色，没有任何权限和菜单。" />}
        <dl className="a1-amb" aria-label="区域大使独立核验权限">
          <dt>区域大使独立核验权限<Explain label="区域大使独立核验权限的说明" content="按当前角色的实际授权显示；核验权限与最终批准权限分别管理。" /></dt>
          {F4_MATERIAL_PERMISSIONS.map((permission) => {
            const state = materialPermissionCodes == null ? "尚未核实" : materialPermissionCodes.includes(permission.code) ? "已授权" : "未授权";
            return <div key={permission.code}><dd className="a1-amb-name">{permission.label}</dd><dd className="a1-amb-state">{state === "已授权" ? <StatusTag tone="ok">已授权</StatusTag> : state}</dd></div>;
          })}
        </dl>
      </section>

      <section className="a1-detail-block" aria-labelledby="a1-detail-sessions">
        <h3 id="a1-detail-sessions" className="a1-detail-title">登录设备<span className="a1-detail-sub">{sessions.length} 台在线 · {zoneNote()}</span></h3>
        {sessions.length ? (
          <ul className="a1-sessions" aria-label="在线设备">
            {shownSessions.map((session) => (
              <li key={session.sessionId}>
                <MonitorSmartphone size={16} aria-hidden className="a1-session-icon" />
                <span className="a1-session-main">
                  <span className="a1-session-device">{session.device || "未知设备"}<span data-mono>{session.ipAddress || "IP 读不到"}</span></span>
                  <span className="a1-session-time">登录 {minuteText(session.issuedAt)} · 最近活动 {minuteText(session.lastSeenAt)}</span>
                </span>
                <Button size="sm" variant="danger-outline" disabledReason={sessionRevokeBlockReason ?? undefined} onClick={() => onRevokeSession(session.sessionId)} aria-label={`让 ${session.device || "未知设备"} 下线`}>让此设备下线</Button>
              </li>
            ))}
          </ul>
        ) : <p className="a1-muted">{enabled ? "当前没有在线设备。" : "账号已停用，没有在线设备。"}</p>}
        {sessions.length > 3 && <div><Button size="sm" variant="ghost" onClick={() => setAllSessions((open) => !open)}>{allSessions ? "只看最近 3 台" : `显示全部 ${sessions.length} 台`}</Button></div>}
      </section>

      <section className="a1-detail-block" aria-labelledby="a1-detail-actions">
        <h3 id="a1-detail-actions" className="a1-detail-title">账号操作<Explain label="账号操作的说明" rows={[
          { k: "提交审批", v: "由另一位超级管理员在「操作记录与审批」批准后执行，批准前账号不变" },
          { k: "直接生效", v: "确认后马上执行" },
        ]} /></h3>
        <ActionList actions={actions} />
      </section>

      <Fold inset title="角色变更记录" summary={entries.length ? `${entries.length} 次变更` : onlyCurrent ? `当前：${roleName(roles, current?.toRole ?? account.role)}` : "没有记录"}
        explain="最多列 20 条能读到的角色变更。只有当前角色时，可能从没变过，也可能更早的记录没读到。">
        {entries.length ? <Timeline entries={entries} label="角色变更记录" />
          : <p className="a1-muted">{onlyCurrent ? `当前角色是${roleName(roles, current?.toRole ?? account.role)}，更早的变更记录没有读到。` : "暂无角色变更记录。"}</p>}
      </Fold>
      </div>
    </Drawer>
  );
}

/* ---------- 改角色：选新角色并对照权限 ---------- */

export function RoleChangeModal({ account, roles, options, codesByRole, effectiveSupers, recovery, initialRole, onClose, onNext }: {
  account: A1Operator;
  roles: A1RoleDefinition[];
  options: { key: string; name: string; scope?: string }[];
  codesByRole: Record<string, string[]>;
  effectiveSupers: number;
  recovery: boolean;
  initialRole?: string;
  onClose: () => void;
  onNext: (role: string) => void;
}) {
  const [picked, setPicked] = useState(initialRole && options.some(role => role.key === initialRole) ? initialRole : account.role);
  const codesOf = (role: string) => role === "unassigned" || !role ? [] : codesByRole[role] ?? [];
  const before = useMemo(() => new Set(codesOf(account.role)), [account.role, codesByRole]);
  const after = useMemo(() => new Set(codesOf(picked)), [picked, codesByRole]);
  const gained = [...after].filter((code) => !before.has(code));
  const lost = [...before].filter((code) => !after.has(code));
  const changed = picked !== account.role;
  const blocked = !changed ? "先选一个和现在不同的角色" : null;
  return (
    <Modal wide title="改角色" icon={UserCog} sub={approvalTag("批准前角色和权限不变。")} onClose={onClose} dirty={changed}
      footer={<Decision others={<Button onClick={onClose}>取消</Button>} primary={<Button variant="primary" disabledReason={blocked ?? undefined} onClick={() => onNext(picked)}>下一步：填写理由</Button>} />}>
      <div className="a1-page a1-sheet">
      <Facts>
        <Fact k="账号">{operatorDisplayLabel(account)}</Fact>
        <Fact k="现在的角色">{roleName(roles, account.role)} · {permSummary(account.role === "unassigned" ? [] : codesByRole[account.role] ?? null)}</Fact>
        <Fact k="有效的超级管理员">{effectiveSupers} 人，至少保留 2 人</Fact>
      </Facts>
      <Field label="新角色" required explain={recovery ? "恢复期间只能把账号提升为超级管理员。" : "选好后下面对照改前改后的权限；角色能做什么在「角色管理」设置。"}>
        {(control) => <Select {...control} aria-label="新角色" value={picked} onChange={setPicked}
          options={options.map((role) => ({ value: role.key, label: `${role.name}${role.key === account.role ? "（现在）" : ""}` }))} />}
      </Field>
      {changed && (
        <div className="a1-role-diff" data-proof="role-perm-diff">
          <div className="a1-role-compare" aria-label="改前改后的权限数">
            <div><span className="a1-role-compare-k">改之前 · {roleName(roles, account.role)}</span><strong>{before.size}</strong><span className="a1-role-compare-u">项权限</span></div>
            <ArrowRight size={18} aria-hidden className="a1-role-compare-arrow" />
            <div><span className="a1-role-compare-k">改之后 · {roleName(roles, picked)}</span><strong>{after.size}</strong><span className="a1-role-compare-u">项权限</span></div>
          </div>
          {gained.length > 0 && <Notice tone="warn" title={`权限变多：批准后多出 ${gained.length} 项${gained.filter(isHighRiskCode).length ? `，其中 ${gained.filter(isHighRiskCode).length} 项高风险` : ""}`}>多出的权限批准后马上能用，请确认这个人确实需要。<Explain label="高风险的说明" content={HIGH_RISK_EXPLAIN} /></Notice>}
          <div className="a1-role-lists">
            <section aria-label="多出的权限"><h4 className="a1-role-list-title" data-tone="gain">多出的权限<span>{gained.length} 项</span></h4><PermGroups codes={gained} label="多出的权限" tone="gain" markRisk empty="没有多出的权限" /></section>
            <section aria-label="少掉的权限"><h4 className="a1-role-list-title" data-tone="loss">少掉的权限<span>{lost.length} 项</span></h4><PermGroups codes={lost} label="少掉的权限" tone="loss" markRisk empty="没有少掉的权限" /></section>
          </div>
        </div>
      )}
      </div>
    </Modal>
  );
}

/* ---------- 新建、编辑抽屉 ---------- */

type NaForm = A1CreateAccountInput;
type EditAccountForm = A1UpdateAccountInput;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9._-]{3,32}$/;
function isValidEmail(email: string) {
  const normalized = email.trim();
  return !normalized || EMAIL_PATTERN.test(normalized);
}
function isValidUsername(username: string) {
  return USERNAME_PATTERN.test(username.trim());
}

function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return <h3 className="a1-step-title"><span className="a1-step-n" aria-hidden>{n}</span>{children}</h3>;
}

export function NewAccountDrawer({ roles, codesByRole, recoveryMode, disabled, initialForm, originalCommandKey, onClose, onSubmit }: {
  roles: A1RoleDefinition[];
  codesByRole: Record<string, string[]> | null;
  recoveryMode: boolean;
  disabled?: boolean;
  initialForm?: NaForm;
  originalCommandKey?: string;
  onClose: () => void;
  onSubmit: (form: NaForm) => void;
}) {
  const defaultRole = "support";
  const actorId = useAdminAuth(state => state.session?.adminId);
  const [username, setUsername] = useState(initialForm?.username ?? "");
  const [displayName, setDisplayName] = useState(initialForm?.displayName ?? "");
  const [email, setEmail] = useState(initialForm?.email ?? "");
  const [role, setRole] = useState(initialForm?.role ?? defaultRole);
  const [avatarGenderValue, setAvatarGenderValue] = useState<AvatarGender>(initialForm?.avatarGender ?? "UNSPECIFIED");
  // 恢复原草稿时照原来的头像来源：原来选的是随机默认头像就还是默认（OP-93 第 5 条）。
  const [avatarMode, setAvatarMode] = useState<"default" | "manual">(originalCommandKey ? (initialForm?.useDefaultAvatar ? "default" : "manual")
    : actorId && avatarDrafts.list().some(row => row.fingerprint === avatarDraftFingerprint(actorId, "admin", "new")) ? "manual" : "default");
  const [avatarAssetId, setAvatarAssetId] = useState<string | undefined>(), [avatarBlocking, setAvatarBlocking] = useState(Boolean(originalCommandKey && initialForm?.avatarAssetId));
  const [touched, setTouched] = useState(false);
  const useDefaultAvatar = role === "support" && avatarMode === "default";
  useEffect(() => { if (avatarBlocking || avatarAssetId) setAvatarMode("manual"); }, [avatarBlocking, avatarAssetId]);

  useEffect(() => {
    if (recoveryMode && roles.some((item) => item.key === "super")) {
      setRole("super");
    } else if (role && !roles.some((item) => item.key === role)) {
      setRole("");
    }
  }, [recoveryMode, role, roles]);

  const emailOk = isValidEmail(email);
  const usernameOk = isValidUsername(username);
  const displayNameError = appVisibleTextError(displayName, "显示名");
  const missingItems = [
    !username.trim() ? "登录名未填写" : !usernameOk ? "登录名格式不正确" : "",
    !displayName.trim() ? "显示名未填写" : displayNameError ? "显示名含中文" : "",
    email.trim() && !emailOk ? "工作邮箱格式不正确" : "",
    recoveryMode && role !== "super" ? "恢复期只能新建超级管理员" : "",
  ].filter(Boolean);
  const disabledReason = disabled ? "正在加载，稍后再创建" : "";
  const submitBlockers = [disabledReason, ...missingItems, avatarBlocking ? "新头像还没上传成功" : ""].filter(Boolean);
  const canSubmit = !disabled && !avatarBlocking && missingItems.length === 0;
  const roleChoices = [{ key: "", name: "暂不分配", scope: "无业务权限" }, ...roles];

  return (
    <Drawer open wide title={recoveryMode ? "提交新建超级管理员审批" : "新建运营账号"} icon={UserPlus} tone="role-3" onClose={onClose} busy={disabled}
      sub={recoveryMode ? "恢复期 · 另一位超级管理员批准后才创建" : "确认后马上创建，临时密码只显示一次"}
      footer={<Decision others={<Button onClick={onClose}>取消</Button>}
        primary={<Button variant="primary" disabledReason={canSubmit ? undefined : `不能创建：${submitBlockers.join("、")}`} onBlockedClick={() => setTouched(true)}
          onClick={() => canSubmit && onSubmit({
            username: username.trim().toLowerCase(),
            displayName: displayName.trim(),
            email: email.trim() || undefined,
            role,
            ...(useDefaultAvatar ? { useDefaultAvatar: true, avatarGender: avatarGenderValue } : { avatarAssetId, ...(role === "support" ? { useDefaultAvatar: false, avatarGender: avatarGenderValue } : {}) }),
          })}>{recoveryMode ? "提交创建审批" : "确认创建账号"}</Button>} />}>
      <fieldset className="a1-page a1-sheet a1-form" disabled={disabled}>
        {recoveryMode && <Notice tone="warn" title="恢复期只能新建超级管理员">这里只提交审批；批准后账号才建好。本页拿不到临时密码，批准后到账号列表点「重置密码」，把临时密码交给本人。</Notice>}
        <StepTitle n={1}>登录资料</StepTitle>
        <div className="rd-form-grid" data-cols="2" data-dense="">
          <Field label="登录名" required hint="3–32 位" error={(touched || username.trim()) && !usernameOk ? (username.trim() ? "只能用小写字母、数字、点、下划线或短横线。" : "请填写登录名。") : undefined}>
            <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} placeholder="例如 risk.shift" autoComplete="username" />
          </Field>
          <Field label="显示名" required help={APP_VISIBLE_TEXT_HINT} error={!displayName.trim() ? (touched ? "请填写显示名。" : undefined) : displayNameError}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Alex Chen" />
          </Field>
          <Field label="工作邮箱" hint="选填" error={email.trim() && !emailOk ? "请输入有效邮箱格式。" : undefined}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" />
          </Field>
        </div>

        <StepTitle n={2}>初始角色（可暂不分配）</StepTitle>
        <div className="a1-role-pick" role="radiogroup" aria-label="初始角色">
          {roleChoices.map((item) => {
            const off = recoveryMode && item.key !== "super";
            const codes = item.key === "" ? [] : codesByRole?.[item.key] ?? null;
            return (
              <div key={item.key || "none"} className="a1-role-option" data-checked={role === item.key ? "" : undefined} data-disabled={off ? "" : undefined} onClick={(event) => { if (!off && !(event.target as HTMLElement).closest("button")) setRole(item.key); }}>
                <input type="radio" id={`a1-role-${item.key || "none"}`} name="operator-role" value={item.key} checked={role === item.key} disabled={off} onChange={() => setRole(item.key)} />
                <p className="a1-role-option-main">
                  <span className="a1-role-option-name"><label htmlFor={`a1-role-${item.key || "none"}`}>{item.name}</label>{item.key && item.scope && <Explain label={`${item.name}的角色说明`} content={`角色说明：${item.scope}。实际能做什么以权限数为准，在「角色管理」核对。`} />}</span>
                  <span className="a1-role-option-sub">{item.key === "" ? "没有任何权限和菜单" : permSummary(codes)}</span>
                </p>
              </div>
            );
          })}
        </div>
        {role === "support" && <p className="a1-help">客服账号建好后自动有专属客服资格（未分组），只服务本人绑定的客户；主管资格要另外授予。</p>}

        {role === "support" && (
          <>
            <StepTitle n={3}>客服头像</StepTitle>
            <div className="rd-form-grid" data-cols="2" data-dense="">
              <Field label="头像来源">
                <Segments label="头像来源" value={avatarMode} onChange={(value) => setAvatarMode(value)} items={[
                  { value: "default", label: "随机默认头像", disabled: disabled || avatarBlocking || Boolean(avatarAssetId) },
                  { value: "manual", label: "自行上传", disabled: disabled || avatarBlocking || Boolean(avatarAssetId) },
                ]} />
              </Field>
              <Field label="头像分类" explain="创建时按分类随机挑一张默认头像；改分类不会自动换图。">
                {(control) => <Select {...control} aria-label="头像分类" value={avatarGenderValue} disabled={disabled || avatarBlocking || Boolean(avatarAssetId)} onChange={(value) => setAvatarGenderValue(value as AvatarGender)} options={AVATAR_GENDER_OPTIONS} />}
              </Field>
            </div>
            <p className="a1-help">创建后可更换头像。</p>
          </>
        )}
        {!useDefaultAvatar && <div className="a1-avatar-slot"><AccountAvatarPicker name={displayName} disabled={disabled} onChange={setAvatarAssetId} onBlocking={setAvatarBlocking}
          targetId={originalCommandKey ? newAccountAvatarTarget(originalCommandKey) : undefined} originalAssetId={initialForm?.avatarAssetId} /></div>}
        {avatarBlocking && <Notice tone="warn">新头像尚未上传成功；上传或取消新头像后可继续创建。</Notice>}

        <StepTitle n={role === "support" ? 4 : 3}>首次登录</StepTitle>
        <ol className="a1-first-login" aria-label="首次登录要做的事">
          {recoveryMode
            ? <><li>另一位超级管理员批准后，账号才建好</li><li>到账号列表点「重置密码」拿临时密码，交给本人</li><li>本人登录后先绑定两步验证，再改密码</li></>
            : <><li>确认后显示一次 20 位临时密码，通过可靠渠道交给本人</li><li>本人用临时密码登录，先绑定两步验证</li><li>再改成自己的密码，才能正常使用后台</li></>}
        </ol>

      </fieldset>
    </Drawer>
  );
}

export function EditAccountDrawer({ account, disabled, initialForm, onClose, onSubmit }: {
  account: A1Operator;
  disabled?: boolean;
  initialForm?: EditAccountForm;
  onClose: () => void;
  onSubmit: (form: EditAccountForm) => void;
}) {
  const [username, setUsername] = useState(initialForm?.username ?? account.username ?? "");
  const [displayName, setDisplayName] = useState(initialForm?.displayName ?? operatorDisplayName(account));
  const [email, setEmail] = useState(initialForm ? initialForm.email ?? "" : account.email ?? "");
  const [avatarAssetId, setAvatarAssetId] = useState<string | undefined>(), [avatarBlocking, setAvatarBlocking] = useState(false);
  const [avatarGenderValue, setAvatarGenderValue] = useState<AvatarGender>(initialForm?.avatarGender ?? account.avatarGender ?? "UNSPECIFIED");
  const [touched, setTouched] = useState(false);
  const usernameOk = isValidUsername(username);
  const emailOk = isValidEmail(email);
  const usernameChanged = username.trim().toLowerCase() !== (account.username || "").trim().toLowerCase();
  const displayNameChanged = displayName.trim() !== operatorDisplayName(account);
  const displayNameError = displayNameChanged ? appVisibleTextError(displayName, "显示名") : undefined;
  const changed =
    usernameChanged
    || displayNameChanged
    || email.trim().toLowerCase() !== (account.email || "").trim().toLowerCase()
    || Boolean(avatarAssetId && avatarAssetId !== account.avatarAssetId)
    || avatarGenderValue !== (account.avatarGender ?? "UNSPECIFIED");
  const missingItems = [
    !username.trim() ? "登录名未填写" : !usernameOk ? "登录名格式不正确" : "",
    !displayName.trim() ? "显示名未填写" : displayNameError ? "显示名含中文" : "",
    email.trim() && !emailOk ? "工作邮箱格式不正确" : "",
    !changed ? "资料没有变化" : "",
  ].filter(Boolean);
  const disabledReason = disabled ? "正在提交，稍后再编辑" : "";
  const submitBlockers = [disabledReason, ...missingItems, avatarBlocking ? "新头像还没上传成功" : ""].filter(Boolean);
  const canSubmit = !disabled && !avatarBlocking && missingItems.length === 0;

  return (
    <Drawer open wide title="编辑账号资料" icon={PencilLine} tone="role-3" onClose={onClose} busy={disabled}
      sub={<span className="a1-drawer-sub"><span>{operatorDisplayName(account)}</span><span data-mono>{account.username || account.id}</span></span>}
      footer={<Decision note={usernameChanged ? "改了登录名：批准后这个账号所有设备下线" : undefined}
        others={<Button onClick={onClose}>取消</Button>}
        primary={<Button variant="primary" disabledReason={canSubmit ? undefined : `不能提交：${submitBlockers.join("、")}`} onBlockedClick={() => setTouched(true)}
          onClick={() => canSubmit && onSubmit({
            username: username.trim().toLowerCase(),
            displayName: displayName.trim(),
            email: email.trim() || undefined,
            avatarAssetId,
            ...(avatarGenderValue !== (account.avatarGender ?? "UNSPECIFIED") ? { avatarGender: avatarGenderValue } : {}),
          })}>提交修改审批</Button>} />}>
      <fieldset className="a1-page a1-sheet a1-form" disabled={disabled}>
        <Notice tone="progress" title="资料修改要审批">另一位超级管理员在「操作记录与审批」批准后才生效，批准前资料和头像都不变。</Notice>
        <StepTitle n={1}>登录资料</StepTitle>
        <div className="rd-form-grid" data-cols="2" data-dense="">
          <Field label="登录名" required hint="3–32 位" help={usernameChanged ? "改登录名：批准后这个账号所有设备下线，要用新登录名重新登录。" : undefined}
            error={(touched || username.trim()) && !usernameOk ? (username.trim() ? "只能用小写字母、数字、点、下划线或短横线。" : "请填写登录名。") : undefined}>
            <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" />
          </Field>
          <Field label="显示名" required help={APP_VISIBLE_TEXT_HINT} error={!displayName.trim() ? (touched ? "请填写显示名。" : undefined) : displayNameError}>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="工作邮箱" hint="选填" error={email.trim() && !emailOk ? "请输入有效邮箱格式。" : undefined}>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
        </div>
        <StepTitle n={2}>头像</StepTitle>
        <Field label="头像分类" explain="修改分类不换图；提交新头像后才会更换。">
          {(control) => <Select {...control} aria-label="头像分类" value={avatarGenderValue} disabled={disabled || avatarBlocking} onChange={(value) => setAvatarGenderValue(value as AvatarGender)} options={AVATAR_GENDER_OPTIONS} />}
        </Field>
        <div className="a1-avatar-slot"><AccountAvatarPicker account={account} name={displayName} gender={avatarGenderValue} allowDefault={account.role === "support"} disabled={disabled} onChange={setAvatarAssetId} onBlocking={setAvatarBlocking} /></div>
        {avatarBlocking && <Notice tone="warn">新头像尚未上传成功；上传或取消新头像后可提交。</Notice>}
      </fieldset>
    </Drawer>
  );
}

/* ---------- 临时密码 ---------- */

export function PasswordResetDrawer({ result, created, onClose }: { result: A1PasswordResetResult; created: boolean; onClose: () => void }) {
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const account = result.account;
  const copyPassword = () => {
    void navigator.clipboard.writeText(result.temporaryPassword).then(() => {
      setCopied("ok");
      window.setTimeout(() => setCopied(""), 1600);
    }, () => setCopied("fail"));
  };
  return (
    <Drawer open title={created ? "账号已创建" : "密码已重置"} icon={KeyRound} tone="role-3" onClose={onClose} sub="临时密码只在本次结果中展示"
      footer={<Decision others={<Button onClick={onClose}>关闭</Button>} primary={<Button variant="primary" icon={<Copy size={14} />} onClick={copyPassword}>{copied === "ok" ? "已复制" : "复制临时密码"}</Button>} />}>
      <div className="a1-page a1-sheet">
      <Notice tone="warn" title="关闭后不会再显示临时密码">请通过可靠渠道告诉账号本人，不要发在群里。</Notice>
      <Facts>
        <Fact k="账号">{operatorDisplayName(account)}</Fact>
        <Fact k="登录名"><span data-mono>{account.username || "读不到"}</span></Fact>
      </Facts>
      <div className="a1-temp-password">
        <span className="a1-temp-password-k">临时密码</span>
        <span className="a1-temp-password-v" data-mono>{result.temporaryPassword}</span>
        {copied === "fail" && <span className="a1-temp-password-err" role="alert">没能复制，请手动选中复制。</span>}
      </div>
      <ol className="a1-first-login" aria-label="本人下次登录要做的事">
        {created
          ? <><li>用登录名和临时密码登录</li><li>先绑定两步验证</li><li>再改成自己的密码，才能正常使用后台</li></>
          : <><li>用临时密码登录，两步验证照旧</li><li>先改成自己的密码，才能正常使用后台</li></>}
      </ol>
      </div>
    </Drawer>
  );
}
