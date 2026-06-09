"use client";

/**
 * A 平台基础 — 设计稿 Platform 内容视图(从 page-breadth.jsx 移植)。
 * 标签:A2 审计 & Maker-Checker(默认)/ A1 RBAC / A3 系统配置 / A4 埋点事件。
 * 路由 l2.id 与设计稿 tab 一一对应(A1/A2/A3/A4)。
 */
import { useEffect, useMemo, useState } from "react";
import { Icon, Card, CodeTag, Chip, Badge, Btn, Drawer, MakerCheckerModal, useToast, useDomainNav } from "./design-kit";
import { AutoGloss, Gloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { APPROVALS, AUDIT, ROLES } from "@/lib/mock/admin/design-data";
import { usePlatformConfig, type OpsAccount, type CredMethod } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";

// 凭据下发方式(无邮箱依赖;管理员后台不自定义/不收明文密码)
const CRED_OPT: { key: CredMethod; label: string; note: string; status: string }[] = [
  { key: "temp", label: "临时密码", note: "系统自动生成一次性临时密码(超管不自定义,仅展示一次供线下转交);操作员首次登录强制改密 + 绑 2FA", status: "待改密" },
  { key: "sso", label: "企业 SSO 单点", note: "经企业 IdP(SAML/OIDC)认证,无独立密码;角色随登录下发", status: "active" },
];
// 系统生成一次性临时密码(超管不自定义);随机源 crypto,首登强制改。
function genTempPwd(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789abcdefghijkmnpqrstuvwxyz";
  let out = "";
  try {
    const a = new Uint32Array(10);
    crypto.getRandomValues(a);
    for (const x of a) out += chars[x % chars.length];
  } catch {
    out = "TmpPwd0000";
  }
  return "Nx-" + out;
}

const FOLD: Record<string, string> = { A1: "A1", A2: "A2", A3: "A3", A4: "A4" };

/* A1 运营账号(mock,结构对齐真后台 account/role/2FA) */
type Account = { id: string; acct: string; name: string; role: keyof typeof ROLES; status: "active" | "disabled"; tfa: boolean };
const ACCOUNTS: Account[] = [
  { id: "u_super_zhao", acct: "zhao@nexion.ops", name: "赵 · 超管", role: "super", status: "active", tfa: true },
  { id: "u_fin_li", acct: "li@nexion.ops", name: "李 · 财务", role: "finance", status: "active", tfa: true },
  { id: "u_risk_chen", acct: "chen@nexion.ops", name: "陈 · 风控", role: "risk", status: "active", tfa: true },
  { id: "u_content_zhou", acct: "zhou@nexion.ops", name: "周 · 内容", role: "content", status: "active", tfa: false },
  { id: "u_growth_wang", acct: "wang@nexion.ops", name: "王 · 增长", role: "growth", status: "disabled", tfa: false },
  { id: "u_audit_sun", acct: "sun@nexion.ops", name: "孙 · 只读审计", role: "audit", status: "active", tfa: true },
];

/* A3 运行参数(mock,结构对齐 config store key/value) */
type SysParam = { key: string; label: string; value: string; note: string; amplifies?: boolean };
const SYS_PARAMS: SysParam[] = [
  { key: "maintenance_mode", label: "维护模式", value: "off", note: "全站只读开关 · 开启即拦截所有写操作", amplifies: true },
  { key: "global_rate_limit", label: "全局限流(req/s/IP)", value: "40", note: "网关层统一阈值 · 反作弊兜底" },
  { key: "session_timeout_min", label: "会话超时(分钟)", value: "30", note: "运营后台空闲登出 · 安全基线" },
  { key: "withdraw_review_floor_usd", label: "提现强审阈值(USD)", value: "2,000", note: "超额单笔强制人工复核 · 合规", amplifies: true },
  { key: "audit_retention_months", label: "审计日志保留(月)", value: "13", note: "运营痕迹保留月数 · 越南宜就低(≤13)利退出最小化留痕" },
];

/* A4 埋点事件(mock,结构对齐 event registry name/stage/owner) */
type EventStage = "rollout" | "full" | "off";
type EventDef = { name: string; domain: string; owner: string; stage: EventStage };
const EVENTS: EventDef[] = [
  { name: "checkout.order_paid", domain: "checkout", owner: "增长", stage: "full" },
  { name: "withdraw.requested", domain: "withdraw", owner: "财务", stage: "full" },
  { name: "device.heartbeat_lost", domain: "device", owner: "风控", stage: "rollout" },
  { name: "trial.offset_applied", domain: "trial", owner: "增长", stage: "rollout" },
  { name: "disclosure.viewed", domain: "disclosure", owner: "合规", stage: "off" },
];
// A4 真写发布态(store 值 gray/full/off)→ 展示。seed stage rollout 对应 store 的 gray。
type RolloutVal = "gray" | "full" | "off";
const ROLLOUT_TONE: Record<RolloutVal, string> = { full: "ok", gray: "warn", off: "neutral" };
const ROLLOUT_LABEL: Record<RolloutVal, string> = { full: "全量", gray: "灰度", off: "停用" };
const STAGE_TO_ROLLOUT: Record<EventStage, RolloutVal> = { full: "full", rollout: "gray", off: "off" };

/* Maker-Checker 入口载荷 — 覆盖 A1/A3/A4 高敏动作 */
// op 区分账号台账类真写动作:create=新增 / role=改角色(收 newValue=角色名)/ toggle=停用↔启用 /
// tfa=重置 2FA(置 tfa=false,绝不涉明文密码)/ sysparam=A3 系统参数调整(收 newValue → setParam)/ rbac=A1 角色权限映射编辑(收 newValue → setParam)。
// A4 埋点事件真写:eventNew=登记新事件(写 A.event.new.<name>="pending")/ eventRollout=灰度/全量/停用(写 A.event.<id>.rollout="gray"/"full"/"off")。
// A2 审计复核:auditApprove / auditReject = 待复核队列项放行 / 驳回(写 A.audit.<id>.verdict="approved"/"rejected")。
type Mc = { action: string; detail: string; amplifies?: boolean; pendingAccount?: OpsAccount; tempPwd?: string; op?: "create" | "role" | "toggle" | "tfa" | "sysparam" | "rbac" | "eventNew" | "eventRollout" | "auditApprove" | "auditReject"; acctId?: string; acctName?: string; acctNo?: string; nextStatus?: string; paramKey?: string; rbacRole?: string; eventName?: string; eventRollout?: "gray" | "full" | "off"; auditId?: string; edit?: { kind?: "number" | "text" | "select" | "toggle"; current?: string; unit?: string; options?: string[] } };
// 角色显示名 → 角色 key(改角色 MC 用名展示,回写存 key)。
const ROLE_NAMES = Object.values(ROLES).map((r) => r.name);
function roleKeyFromName(name: string): keyof typeof ROLES | undefined {
  const hit = Object.values(ROLES).find((r) => r.name === name);
  return hit?.id as keyof typeof ROLES | undefined;
}

const ROLE_DESC: Record<string, string> = {
  super: "全域读写 + 全部 Checker",
  finance: "资金/财务 Maker+Checker",
  risk: "风控/反作弊 + kill Maker",
  content: "内容/CMS 发布",
  growth: "增长/活动 A/B Maker",
  support: "用户处置 Maker",
  audit: "全量只读 + 导出追溯",
};

const EVENT_DOMAINS = ["app", "auth", "referral", "kyc", "onboarding", "store", "checkout", "device", "earnings", "wallet", "withdraw", "commission", "staking", "exchange", "genesis", "trial", "quest", "daily", "nova", "phase", "risk", "admin"];
const EVENT_PENDING = ["content", "notification", "disclosure", "learn"];

export function ADomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const go = useDomainNav();
  const [tab] = useState(FOLD[meta.l2Id] ?? "A2");
  const [mc, setMc] = useState<Mc | null>(null);
  const [addAcct, setAddAcct] = useState(false);
  const [acctForm, setAcctForm] = useState<{ acct: string; name: string; role: keyof typeof ROLES; cred: CredMethod }>({ acct: "", name: "", role: "support", cred: "temp" });
  // A1 运营账号:真持久化(平台 store)+ 凭据下发方式(管理员永不设明文密码)。
  const hydrated = useOpsHydrated();
  const seedAccounts = useMemo<OpsAccount[]>(() => ACCOUNTS.map((a) => ({ ...a, cred: "sso" as CredMethod })), []);
  const ensureAccounts = usePlatformConfig((s) => s.ensureAccounts);
  const storeAccounts = usePlatformConfig((s) => s.accounts);
  const addAccount = usePlatformConfig((s) => s.addAccount);
  const updateAccount = usePlatformConfig((s) => s.updateAccount); // (id, Partial<OpsAccount>) => void · persist · 即时反映于 accounts 列表
  // A3 系统参数 / A1 RBAC 权限映射:真写 keyed 状态 + 审计(setParam),pget 派生展示。
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  // A4 事件发布态:以 store J 值为准("gray"/"full"/"off"),缺省回落 seed stage(刷新后仍反映 + 即时变)。
  const effRollout = (e: EventDef): RolloutVal => { const v = pget(`A.event.${e.name}.rollout`) as RolloutVal | undefined; return v && (v === "gray" || v === "full" || v === "off") ? v : STAGE_TO_ROLLOUT[e.stage]; };
  useEffect(() => { if (hydrated) ensureAccounts(seedAccounts); }, [hydrated, seedAccounts, ensureAccounts]);
  const accounts = hydrated && storeAccounts ? storeAccounts : seedAccounts;
  const [addEvent, setAddEvent] = useState(false);
  const [eventForm, setEventForm] = useState<{ name: string; domain: string; owner: string }>({ name: "", domain: EVENT_DOMAINS[0], owner: "" });

  return (
    <div className="dkpage">
      <DomainHeader {...meta} />

      {tab === "A2" && <>
        <Card style={{ marginBottom: 16 }}>
          <div className="card-h"><div><span className="ttl">Maker-Checker 待复核队列</span><span className="sub"> · {APPROVALS.length} 项 · <Gloss>双人复核</Gloss></span></div><div className="spacer" /><CodeTag>A2</CodeTag></div>
          {APPROVALS.map((a) => { const verdict = pget(`A.audit.${a.id}.verdict`); const decided = verdict === "approved" || verdict === "rejected"; return (
            <div key={a.id} className="tint" style={{ marginBottom: 8, opacity: decided ? 0.62 : undefined }}>
              <div className="row"><b style={{ fontSize: 13.5 }}>{a.action}</b><CodeTag tone="electric">{a.domain}</CodeTag>{a.covCheck && <CodeTag tone="orange">需覆盖率核验</CodeTag>}<div className="spacer" />
                {decided ? <Badge tone={verdict === "approved" ? "ok" : "err"}>{verdict === "approved" ? "已放行" : "已驳回"}</Badge> : <Badge tone={a.risk.includes("高") ? "err" : "warn"}>{a.risk}</Badge>}</div>
              <div className="muted tiny" style={{ margin: "4px 0" }}>{a.obj} · {a.reason}</div>
              <div className="row tiny muted"><span>maker {a.maker}</span><span>· {a.ts} 前</span><div className="spacer" />
                {!decided && <>
                  <Btn sm onClick={() => setMc({ action: `驳回复核项:${a.action}`, detail: `${a.id} · ${a.domain} · ${a.obj} · 驳回后该 Maker-Checker 复核项不予放行,maker 须按事由重新发起 · 写入 A2 审计`, op: "auditReject", auditId: a.id })}>驳回</Btn>
                  <Btn sm variant="primary" onClick={() => setMc({ action: `放行复核项:${a.action}`, detail: `${a.id} · ${a.domain} · ${a.obj} · 第二人复核放行,该项即时进入执行 · 写入 A2 审计`, amplifies: a.risk.includes("高"), op: "auditApprove", auditId: a.id })}>放行</Btn>
                </>}</div>
            </div>
          ); })}
        </Card>
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">审计日志 · append-only</span><CodeTag title="统一审计 schema">统一审计格式</CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>时间</th><th>操作者</th><th>角色</th><th>动作</th><th>对象</th><th>Maker-Checker</th><th>IP</th></tr></thead>
            <tbody>{AUDIT.map((a, i) => (
              <tr key={i}><td className="mono tiny">{a.ts}</td><td className="mono tiny">{a.op}</td><td><CodeTag>{a.role}</CodeTag></td>
                <td className="mono tiny">{a.action}</td><td className="t-mut tiny">{a.obj}</td><td className="mono tiny">{a.mc}</td><td className="mono tiny t-mut">{a.ip}</td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      </>}

      {tab === "A1" && <>
        <Card style={{ marginBottom: 16 }}>
          <div className="card-h"><div><span className="ttl">运营账号 & RBAC</span><span className="sub"> · 7 角色 × 域权限</span></div><div className="spacer" /><Btn variant="primary" onClick={() => { setAcctForm({ acct: "", name: "", role: "support", cred: "temp" }); setAddAcct(true); }}><Icon name="plus" size={15} /> 新增账号</Btn></div>
          <div className="grid g-3" style={{ gap: 12 }}>
            {Object.values(ROLES).map((r) => { const perm = pget(`A.rbac.${r.id}`) ?? ROLE_DESC[r.id]; return (
              <div key={r.id} className="tint"><div className="row"><span className="tb-role" style={{ border: 0, padding: 0, background: "transparent" }}><span className="av" style={{ background: r.color + "1a", color: r.color }}>{r.av}</span></span><b>{r.name}</b><div className="spacer" /><Btn sm onClick={() => setMc({ action: `调整角色权限:${r.name}`, detail: `${r.id} · 当前权限映射「${perm}」· 编辑该角色的域权限串,复核生效即时作用于所有持该角色的会话 · 写入 A2 审计`, op: "rbac", rbacRole: r.id, edit: { kind: "text", current: String(perm) } })}>编辑权限</Btn></div>
                <div className="muted tiny" style={{ marginTop: 6 }}><AutoGloss>{perm}</AutoGloss></div>
              </div>
            ); })}
          </div>
          <div className="tint warn tiny" style={{ marginTop: 12 }}><AutoGloss>角色权限映射为系统级高敏配置 · 变更一律经 Maker-Checker 复核并写入 A2 审计 · 越权配置即时吊销于全部相关会话</AutoGloss></div>
        </Card>
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">运营账号列表</span><CodeTag title="account/role/2FA · 凭据下发(邀请/SSO/临时)">账号台账</CodeTag><div className="spacer" /><span className="muted tiny">{accounts.length} 个账号</span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>账号</th><th>姓名</th><th>角色</th><th>2FA</th><th>状态</th><th /></tr></thead>
            <tbody>{accounts.map((u) => { const r = ROLES[u.role as keyof typeof ROLES]; return (
              <tr key={u.id}><td className="mono tiny t-strong">{u.acct}</td><td>{u.name}</td>
                <td><CodeTag>{r?.name ?? u.role}</CodeTag></td>
                <td>{u.tfa ? <Badge tone="ok">已启用</Badge> : <Badge tone="warn">待绑定</Badge>}</td>
                <td><Badge tone={u.status === "active" ? "ok" : u.status === "disabled" ? "neutral" : "warn"}>{u.status === "active" ? "在用" : u.status === "disabled" ? "已停用" : u.status}</Badge></td>
                <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                  <Btn sm onClick={() => setMc({ action: `改角色:${u.name}`, detail: `当前角色「${r?.name ?? u.role}」· 选择目标角色 · 变更即时生效于其全部会话 · 写入 A2 审计`, op: "role", acctId: u.id, edit: { kind: "select", current: r?.name ?? String(u.role), options: ROLE_NAMES } })}>改角色</Btn>
                  <Btn sm onClick={() => setMc({ action: `重置 2FA:${u.name}`, detail: `${u.acct} · 解绑现有认证器,操作员下次登录强制重新绑定 2FA · 不涉及密码 · 写入 A2 审计`, op: "tfa", acctId: u.id, acctName: u.name, acctNo: u.acct })}>重置 <Gloss>2FA</Gloss></Btn>
                  <Btn sm onClick={() => setMc({ action: `${u.status === "active" ? "停用" : "启用"}账号:${u.name}`, detail: `${u.acct} · ${u.status === "active" ? "停用后立即吊销全部会话与权限" : "恢复登录与既有角色权限"} · 写入 A2 审计`, op: "toggle", acctId: u.id, nextStatus: u.status === "active" ? "disabled" : "active" })}>{u.status === "active" ? "停用" : "启用"}</Btn>
                </div></td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>停用 / 改角色 / 重置 2FA 为高敏账号动作 · 一律经 Maker-Checker 复核后生效</AutoGloss></div></div>
        </Card>
      </>}

      {tab === "A3" && <>
        <Card className="pad-0" style={{ marginBottom: 16 }}>
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">运行参数</span><CodeTag title="config store key/value">运行参数</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>server-canonical · 改后即时下发</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>参数</th><th>当前值</th><th>说明</th><th /></tr></thead>
            <tbody>{SYS_PARAMS.map((p) => { const cur = pget(`A.sys.${p.key}`) ?? p.value; const isSwitch = p.key === "maintenance_mode"; return (
              <tr key={p.key}><td className="t-strong">{p.label}</td>
                <td className="mono tiny t-strong">{cur}</td><td className="t-mut tiny">{p.note}</td>
                <td><Btn sm onClick={() => setMc({ action: `调整运行参数:${p.label}`, detail: `${p.label} · 当前值 ${cur} · server-canonical,改后即时下发至全节点`, amplifies: p.amplifies, op: "sysparam", paramKey: `A.sys.${p.key}`, edit: isSwitch ? { kind: "select", current: String(cur), options: ["on", "off"] } : { kind: "text", current: String(cur) } })}>调整</Btn></td></tr>
            ); })}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>运行参数为系统级高敏配置 · 变更一律经 Maker-Checker 复核并写入 A2 审计</AutoGloss></div></div>
        </Card>
        <Card>
          <div className="card-h"><div><span className="ttl">权威基线(只读)</span><span className="sub"> · server time / <AutoGloss>幂等键</AutoGloss> / feature flag</span></div><div className="spacer" /><CodeTag>A3</CodeTag></div>
          <div className="kv"><span className="k">server time 权威</span><span className="v"><span className="mono">2026-06-02 14:32:08 UTC</span></span></div>
          <div className="kv"><span className="k">Idempotency-Key</span><span className="v">全资金写操作强制</span></div>
          <div className="kv"><span className="k">feature flag(A3 config store)</span><span className="v">kill-switch 7 闸托管</span></div>
          <div className="kv"><span className="k">A/B 实验值</span><span className="v">必须 server-driven</span></div>
        </Card>
      </>}

      {tab === "A4" && <>
      <Card className="pad-0" style={{ marginBottom: 16 }}>
        <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">事件注册表</span><CodeTag title="event registry name/stage/owner">事件注册表</CodeTag><div className="spacer" /><Btn variant="primary" onClick={() => { setEventForm({ name: "", domain: EVENT_DOMAINS[0], owner: "" }); setAddEvent(true); }}><Icon name="plus" size={15} /> 新增事件</Btn></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>事件名</th><th>domain</th><th>负责人</th><th>发布状态</th><th /></tr></thead>
          <tbody>{EVENTS.map((e) => { const stage = effRollout(e); return (
            <tr key={e.name}><td className="mono tiny t-strong">{e.name}</td><td><CodeTag>{e.domain}</CodeTag></td>
              <td className="t-mut tiny">{e.owner}</td><td><Badge tone={ROLLOUT_TONE[stage]}>{ROLLOUT_LABEL[stage]}</Badge></td>
              <td><div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                <Btn sm onClick={() => setMc({ action: `灰度发布:${e.name}`, detail: `domain ${e.domain} · 按比例放量采集 · 不改既有看板派生口径 · 写入 A2 审计`, op: "eventRollout", eventName: e.name, eventRollout: "gray" })}><Gloss>灰度</Gloss></Btn>
                <Btn sm onClick={() => setMc({ action: `全量发布:${e.name}`, detail: `domain ${e.domain} · 全量上线后该事件成为看板/漏斗权威数据源 · 写入 A2 审计`, amplifies: true, op: "eventRollout", eventName: e.name, eventRollout: "full" })}><Gloss>全量</Gloss></Btn>
                <Btn sm onClick={() => setMc({ action: `停用事件:${e.name}`, detail: `domain ${e.domain} · 停采后依赖该事件的看板数字将断流 · 须先确认无下游引用 · 写入 A2 审计`, op: "eventRollout", eventName: e.name, eventRollout: "off" })}>停用</Btn>
              </div></td></tr>
          ); })}</tbody>
        </table></div>
        <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>全量发布使事件成为看板权威数据源 · 经 Maker-Checker 复核后生效</AutoGloss></div></div>
      </Card>
      <Card>
        <div className="card-h"><div><span className="ttl">埋点事件体系</span><span className="sub"> · 全链路事件流 · <AutoGloss>漏斗</AutoGloss>/KPI/资金/风控地基</span></div><div className="spacer" /><CodeTag>埋点事件</CodeTag></div>
        <div className="grid g-2" style={{ gap: 16 }}>
          <div><div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, color: "var(--ink)" }}>domain 枚举(已登记)</div>
            <div className="row wrap" style={{ gap: 6 }}>{EVENT_DOMAINS.map((d) => <CodeTag key={d}>{d}</CodeTag>)}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 8px", color: "var(--ink)" }}>待扩展(V4 blocking 工单)</div>
            <div className="row wrap" style={{ gap: 6 }}>{EVENT_PENDING.map((d) => <CodeTag tone="orange" key={d}>{d}</CodeTag>)}</div>
          </div>
          <div className="tint cyan"><div style={{ fontWeight: 600, marginBottom: 6, color: "var(--ink)" }}>埋点优先原则(原则三)</div>
            <div className="tiny"><AutoGloss>所有看板数字无一例外派生自 A4 事件流 · 不存在无埋点支撑的看板数字 · is_server_authoritative 按事件性质判定(资金/状态 = true)</AutoGloss></div></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}><Btn onClick={() => go("L")}><Icon name="chart" size={15} /> 前往 L 数据与分析 →</Btn></div>
      </Card>
      </>}

      {addAcct && <Drawer title="新增运营账号" sub={<AutoGloss>账号信息 + 凭据下发方式 · 提交后走双人复核</AutoGloss>} onClose={() => setAddAcct(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddAcct(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!acctForm.acct || !acctForm.name} onClick={() => {
          const opt = CRED_OPT.find((o) => o.key === acctForm.cred) ?? CRED_OPT[0];
          const tempPwd = acctForm.cred === "temp" ? genTempPwd() : undefined;
          const acct: OpsAccount = { id: "u_" + acctForm.cred + "_" + acctForm.acct.replace(/[^a-z0-9]/gi, "").slice(0, 12) + "_" + (accounts.length + 1), acct: acctForm.acct, name: acctForm.name, role: acctForm.role, status: opt.status, tfa: false, cred: acctForm.cred };
          setMc({ action: `新增账号:${acctForm.name}`, detail: `${acctForm.acct} · 角色「${ROLES[acctForm.role].name}」· 凭据:${opt.label} — ${opt.note} · 强制首登绑 2FA · 写入 A2 审计`, pendingAccount: acct, tempPwd });
          setAddAcct(false);
        }}>提交复核</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">登录账号(用户名 / 工号)</span><input className="fld" value={acctForm.acct} onChange={(e) => setAcctForm({ ...acctForm, acct: e.target.value })} placeholder="如 ops.wang 或 工号 N0142" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">姓名 / 显示名</span><input className="fld" value={acctForm.name} onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })} placeholder="如 王 · 增长" /></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">角色</span><select className="fld" value={acctForm.role} onChange={(e) => setAcctForm({ ...acctForm, role: e.target.value as keyof typeof ROLES })}>{Object.values(ROLES).map((r) => <option key={r.id} value={r.id}>{r.name} · {ROLE_DESC[r.id]}</option>)}</select></label>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">凭据下发方式(后台不设明文密码)</span><div className="row wrap" style={{ gap: 6 }}>{CRED_OPT.map((o) => <Chip key={o.key} tab sel={acctForm.cred === o.key} onClick={() => setAcctForm({ ...acctForm, cred: o.key })}>{o.label}</Chip>)}</div></label>
          <div className="tint cyan tiny"><AutoGloss>{(CRED_OPT.find((o) => o.key === acctForm.cred) ?? CRED_OPT[0]).note}</AutoGloss></div>
          <div className="tint warn tiny"><AutoGloss>最小知悉 + 抗抵赖:管理员永不知晓 / 设置操作员明文密码;密码仅 server 侧 hash 存储。复核放行后账号方可登录 + 强制首登绑 2FA。</AutoGloss></div>
        </div>
      </Drawer>}

      {addEvent && <Drawer title="新增埋点事件" sub={<AutoGloss>登记事件定义 · 提交后走双人复核</AutoGloss>} onClose={() => setAddEvent(false)}
        footer={<><Btn style={{ flex: 1, justifyContent: "center" }} onClick={() => setAddEvent(false)}>取消</Btn><Btn variant="primary" style={{ flex: 1, justifyContent: "center" }} disabled={!eventForm.name || !eventForm.owner} onClick={() => { setMc({ action: `新增事件:${eventForm.name || "未命名"}`, detail: `domain ${eventForm.domain} · 负责人 ${eventForm.owner || "—"} · 登记后默认进入待发布,全量发布另行复核 · 写入 A2 审计`, op: "eventNew", eventName: eventForm.name }); setAddEvent(false); }}>提交复核</Btn></>}>
        <div className="col" style={{ gap: 12 }}>
          <label className="col" style={{ gap: 5 }}><span className="muted tiny">事件名(domain.action)</span><input className="fld" value={eventForm.name} onChange={(e) => setEventForm({ ...eventForm, name: e.target.value })} placeholder="如 checkout.order_paid" /></label>
          <div className="grid g-2" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">domain</span><select className="fld" value={eventForm.domain} onChange={(e) => setEventForm({ ...eventForm, domain: e.target.value })}>{EVENT_DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <label className="col" style={{ gap: 5 }}><span className="muted tiny">负责人</span><input className="fld" value={eventForm.owner} onChange={(e) => setEventForm({ ...eventForm, owner: e.target.value })} placeholder="如 增长" /></label>
          </div>
          <div className="tint cyan tiny"><AutoGloss>登记后默认进入待发布态 · is_server_authoritative 按事件性质判定(资金/状态 = true) · 灰度 / 全量发布另行复核,全量发布使其成为看板权威数据源</AutoGloss></div>
        </div>
      </Drawer>}

      {mc && <MakerCheckerModal action={mc.action} detail={mc.detail} amplifies={mc.amplifies} edit={mc.edit} onClose={() => setMc(null)} onConfirm={(reason, newVal) => {
        if (mc.pendingAccount) { addAccount(mc.pendingAccount); setToast(mc.tempPwd ? `账号已创建 · 临时密码 ${mc.tempPwd} · 仅显示一次,请线下转交 · 操作员首登强制改密 + 绑 2FA` : `账号已创建 · SSO 登录 · 待操作员首登绑 2FA`); }
        else if (mc.op === "toggle" && mc.acctId && mc.nextStatus) { updateAccount(mc.acctId, { status: mc.nextStatus }); setToast(mc.nextStatus === "active" ? "账号已启用 · 恢复登录与既有角色权限" : "账号已停用 · 全部会话与权限即时吊销"); }
        else if (mc.op === "role" && mc.acctId && newVal) { const key = roleKeyFromName(newVal); if (key) { updateAccount(mc.acctId, { role: key }); setToast(`角色已变更为「${newVal}」· 即时生效于其全部会话`); } else setToast("角色未识别 · 未变更"); }
        else if (mc.op === "tfa" && mc.acctId) { updateAccount(mc.acctId, { tfa: false }); logAudit({ actor: "总管理员", action: `重置 2FA ${mc.acctNo ?? mc.acctName ?? mc.acctId}`, target: mc.acctId, after: "待重新绑定", reason }); setToast(`已重置 2FA · ${mc.acctName ?? "账号"}下次登录强制重新绑定认证器`); }
        else if (mc.op === "sysparam" && mc.paramKey && newVal) { setParam(mc.paramKey, newVal, { action: mc.action, reason }); setToast(`系统参数已更新 · ${mc.paramKey} = ${newVal} · 即时下发`); }
        else if (mc.op === "rbac" && mc.rbacRole && newVal) { setParam(`A.rbac.${mc.rbacRole}`, newVal, { action: mc.action, reason }); setToast(`角色权限已更新 · ${mc.rbacRole} · 即时生效于全部相关会话`); }
        else if (mc.op === "auditApprove" && mc.auditId) { setParam(`A.audit.${mc.auditId}.verdict`, "approved", { action: mc.action, reason }); setToast(`复核项已放行 · ${mc.auditId} · 即时进入执行 · 写入 A2 审计`); }
        else if (mc.op === "auditReject" && mc.auditId) { setParam(`A.audit.${mc.auditId}.verdict`, "rejected", { action: mc.action, reason }); setToast(`复核项已驳回 · ${mc.auditId} · maker 须重新发起 · 写入 A2 审计`); }
        else if (mc.op === "eventNew" && mc.eventName) { setParam(`A.event.new.${mc.eventName}`, "pending", { action: mc.action, reason }); setToast(`事件已登记 · ${mc.eventName} · 待发布 · 写入 A2 审计`); }
        else if (mc.op === "eventRollout" && mc.eventName && mc.eventRollout) { setParam(`A.event.${mc.eventName}.rollout`, mc.eventRollout, { action: mc.action, reason }); setToast(`${ROLLOUT_LABEL[mc.eventRollout]}已生效 · ${mc.eventName} · 写入 A2 审计`); }
        else setToast("已提交复核");
        setMc(null);
      }} />}
      {toastNode}
    </div>
  );
}
