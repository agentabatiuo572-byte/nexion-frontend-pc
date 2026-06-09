"use client";

/**
 * C 用户与账户 — 设计稿内容视图(从 page-users-risk.jsx 移植)。
 * 标签:C1 检索&画像 / C2 账户操作 / C4 KYC 合规台账 / C5 安全&会话 / C6 注册登录风控。
 * 路由 l2.id 折叠:C3(资产调整)→C2(账户操作内,经用户抽屉发起)。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, Card, CardH, CodeTag, Chip, Badge, Btn, Drawer, KV, MakerCheckerModal, Modal, useToast } from "./design-kit";
import { useIsSuperadmin } from "@/lib/store/use-admin-role";
import { AutoGloss, Gloss } from "@/app/components/kit/gloss";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { USERS, fmtUsd } from "@/lib/mock/admin/design-data";
import { ImpersonateMirror } from "@/app/components/impersonate/impersonate-mirror";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";

const riskBadge = (s: number) => (s >= 70 ? "err" : s >= 40 ? "warn" : "ok");

const KYC_LEDGER = [
  { id: "usr_55B1", name: "Diego Torres", state: "pending", expressId: "CC-7741a", method: "$1 钱包配对", tier: "L1", flag: "地址未配对", ts: "12m" },
  { id: "usr_31E8", name: "Lena Brandt", state: "review", expressId: "CC-3188x", method: "增强 KYC(K5)", tier: "L3", flag: "大额提现触发", ts: "1h" },
  { id: "usr_84F2", name: "Marcus Lee", state: "verified", expressId: "CC-84F2k", method: "$1 钱包配对", tier: "L2", flag: "—", ts: "2d" },
  { id: "usr_19C7", name: "Aisha Khan", state: "verified", expressId: "CC-1190p", method: "增强 KYC", tier: "L3", flag: "—", ts: "5d" },
];
const SESSIONS = [
  { id: "usr_84F2", device: "iPhone 15 · iOS 18", ip: "104.28.x", loc: "Singapore", last: "刚刚", twofa: true },
  { id: "usr_31E8", device: "Chrome · macOS", ip: "88.12.x", loc: "Berlin", last: "8m", twofa: true },
  { id: "usr_55B1", device: "Android · Pixel", ip: "41.90.x", loc: "Lagos", last: "33m", twofa: false },
];
const REGRISK = [
  { key: "otpTtlSec", name: "OTP 有效期", val: "300s", range: "60–600s" },
  { key: "otpQuotaPerHour", name: "OTP 每小时配额", val: "5", range: "3–10" },
  { key: "loginLockThreshold", name: "登录锁定阈值", val: "5 次失败", range: "3–10" },
  { key: "lockDurationMin", name: "锁定时长", val: "30 min", range: "5–120 min" },
  { key: "loginLockLong", name: "登录长锁层", val: "15 次 / 24h", range: "10–30 次 / 12–48h" },
  { key: "captchaTrigger", name: "CAPTCHA 触发", val: "3 次失败后", range: "1–5" },
  { key: "sponsorBindDedup", name: "sponsor-bind 去重", val: "启用(K1)", range: "on/off" },
];

// C3 资产调整审批队列(折叠进 C2)— 客服/财务发起的余额/资产调整请求,待第二人复核 通过/驳回。
// 审批结果真写平台参数 C.adjust.<id>.status(approved/rejected)+ A2 审计 + persist,派生覆盖种子待审态。
const ADJUST_QUEUE = [
  { id: "ADJ-7741", userId: "usr_84F2", name: "Marcus Lee", kind: "差错冲正", delta: 1200, maker: "support·张", reason: "充值重复入账,红冲多记部分", ts: "18m" },
  { id: "ADJ-3188", userId: "usr_31E8", name: "Lena Brandt", kind: "活动补发", delta: 480, maker: "growth·王", reason: "里程碑奖励漏发补记", ts: "1h" },
  { id: "ADJ-0029", userId: "usr_02A9", name: "Yuki Tanaka", kind: "差错冲正", delta: -260, maker: "finance·李", reason: "佣金误算红冲", ts: "3h" },
];

const FOLD: Record<string, string> = { C1: "C1", C2: "C2", C3: "C2", C4: "C4", C5: "C5", C6: "C6" };

type User = (typeof USERS)[number];
type KycResult = "passed" | "rejected" | "supplement";
type AdjustResult = "approved" | "rejected";
type McKind = "freeze" | "restrict" | "kyc" | "2fa" | "regrisk" | "pwReset" | "impersonate" | "impEnd" | "adjust" | "forceout";
type AdjustRow = (typeof ADJUST_QUEUE)[number];
type Mc = {
  type: McKind;
  id?: string;
  name?: string;
  kycResult?: KycResult;
  adjust?: AdjustRow;        // C-09 资产调整审批行(通过/驳回)
  adjustResult?: AdjustResult;
  impId?: string;            // C-06 进行中 impersonate 会话 id(终止用)
} | null;

export function CDomainView({ meta }: { meta: DomainViewMeta }) {
  const router = useRouter();
  const [toastNode, setToast] = useToast();
  const [tab] = useState(FOLD[meta.l2Id] ?? "C1");
  const [q, setQ] = useState("");
  const [seg, setSeg] = useState("all");
  const [sel, setSel] = useState<User | null>(null);
  const [mc, setMc] = useState<Mc>(null);
  const [impUser, setImpUser] = useState<User | null>(null); // 只读代入:打开该用户的只读假镜像
  // C3 资产调整(双币)弹窗:币种 / 方向 / 金额 / 原因码 → submitBalAdjust 真写(取代旧单币 balance MC)。
  const [balForm, setBalForm] = useState<{ ccy: "USDT" | "NEX"; dir: "增加" | "扣减" | "红冲"; amt: string; memo: string } | null>(null);
  const [balReason, setBalReason] = useState("");
  const [users, setUsers] = useState<User[]>(USERS as unknown as User[]);
  // 真状态:抽屉快捷动作写入共享 useUserOps store(详情页 360 + 审计流 + persist 同步,刷新不丢)。
  const hydrated = useOpsHydrated();
  const opsUsers = useUserOps((s) => s.users);
  const setOpsFrozen = useUserOps((s) => s.setFrozen);
  const opsEarningAppend = useUserOps((s) => s.earningAppend);
  // 平台级运营参数(限制提现 / KYC 裁决 / 密码重置 / 资产调整审批):同 store 真写 + 审计 + persist,与 360 HUB 同源,刷新不丢。
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const pget = (k: string): string | undefined => (hydrated ? (params?.[k] as string | undefined) : undefined);
  const isFrozen = (u: User) => (hydrated && opsUsers[u.id] ? !!opsUsers[u.id].frozen : u.frozen);
  const selFrozen = sel ? isFrozen(sel) : false;
  // 限制提现:派生自平台参数 C.user.<id>.restricted(真写后即时反映)。
  const isRestricted = (id?: string) => (id ? pget(`C.user.${id}.restricted`) === "true" : false);
  const selRestricted = isRestricted(sel?.id);
  const isSuper = useIsSuperadmin();
  // 双币余额派生:种子余额 + 运营调整累计(balanceAdjustUsd/Nex),真写后即时反映、刷新不丢。
  const opsOf = (id?: string) => (id && hydrated ? opsUsers[id] : undefined);
  const selBalUsd = sel ? sel.balance + (opsOf(sel.id)?.balanceAdjustUsd ?? 0) : 0;
  const selBalNex = sel ? sel.nex + (opsOf(sel.id)?.balanceAdjustNex ?? 0) : 0;
  // KYC 裁决结果:派生自 C.kyc.<id>.result(运营复审写入后覆盖种子台账状态)。
  const kycResultOf = (id: string): KycResult | undefined => pget(`C.kyc.${id}.result`) as KycResult | undefined;
  const KYC_RESULT_LABEL: Record<KycResult, string> = { passed: "已通过", rejected: "已驳回", supplement: "待补件" };
  const KYC_RESULT_TONE: Record<KycResult, string> = { passed: "ok", rejected: "err", supplement: "warn" };
  // C-06 密码重置:派生自 C.user.<id>.pwReset(= "link-sent" 表示已发送重置链接;后台永不持有/下发明文密码)。
  const pwResetSent = (id?: string) => (id ? pget(`C.user.${id}.pwReset`) === "link-sent" : false);
  // C-09 资产调整审批:派生自 C.adjust.<id>.status(approved/rejected),未写时为种子待审态。
  const adjustStatusOf = (id: string): AdjustResult | undefined => pget(`C.adjust.${id}.status`) as AdjustResult | undefined;
  const ADJ_LABEL: Record<AdjustResult, string> = { approved: "已通过", rejected: "已驳回" };
  const ADJ_TONE: Record<AdjustResult, string> = { approved: "ok", rejected: "err" };

  const filtered = users.filter((u) =>
    (seg === "all" || (seg === "frozen" && isFrozen(u)) || (seg === "highrisk" && u.risk >= 70) || (seg === "kyc" && u.kyc === "pending")) &&
    (q === "" || u.name.toLowerCase().includes(q.toLowerCase()) || u.id.includes(q) || u.ref.includes(q)));

  const freeze = () => {
    if (!sel) return;
    const target = sel;
    const next = !isFrozen(target);
    setOpsFrozen(target.id, next); // 真状态写 + 审计 + persist
    setUsers((us) => us.map((u) => (u.id === target.id ? { ...u, frozen: next } : u))); // 列表 badge 同步
    setToast((next ? "已冻结 " : "已解冻 ") + target.id + " · 已写审计,详情页同步");
    setMc(null);
  };
  // C3 资产调整(双币 USDT/NEX)真写:方向→符号(增加=正,扣减/红冲=负),kind 映射(红冲→红冲,余→调整);
  // opsEarningAppend 带 ccy → USDT 入台账+balanceAdjustUsd / NEX 入 balanceAdjustNex,均 + per-user 审计;再 logAudit 写平台 A2。
  const submitBalAdjust = (reason: string) => {
    if (!sel || !balForm) return;
    const raw = Math.round(Number(balForm.amt.replace(/[^0-9.]/g, "")) || 0);
    if (!raw) { setToast("请填写调整金额"); return; }
    const signed = balForm.dir === "增加" ? raw : -raw;
    const kind: "补发" | "调整" | "红冲" = balForm.dir === "红冲" ? "红冲" : "调整";
    const unit = balForm.ccy === "NEX" ? "NEX" : "USDT";
    opsEarningAppend(sel.id, kind, signed, `${balForm.dir} · ${balForm.memo}`, balForm.ccy); // 真写台账/NEX 累计 + per-user 审计 + persist
    logAudit({ actor: "总管理员", action: `资产调整 ${balForm.ccy} ${signed >= 0 ? "+" : ""}${signed} · ${balForm.dir}`, target: sel.id, reason: balForm.memo + (reason ? " · " + reason : "") }); // 平台 A2 留痕
    setToast(`已调整 ${sel.id} · ${signed >= 0 ? "+" : ""}${signed.toLocaleString()} ${unit} · ${balForm.dir} · 已写台账 + 审计`);
    setBalForm(null);
  };
  // C-06 impersonate:只读代入会话 — 经 Maker-Checker → logAudit 真写平台审计流(A2 全程留痕)+ persist。
  const doImpersonate = (reason: string) => {
    if (!sel) return;
    const id = sel.id;
    logAudit({ actor: "总管理员", action: "impersonate(只读)" + id, target: id, reason });
    setToast("已发起只读代入 · 载入用户视角(只读 ≤30min · A2 留痕)");
    setImpUser(sel); // 复核通过 → 打开该用户的只读假镜像(看用户屏幕上看到的画面)
    setMc(null);
  };
  // C-06 终止 impersonate:进行中只读代入会话提前终止 — 经 Maker-Checker → 真写 C.impersonate.<id>.ended=true + logAudit(A2)+ persist;派生即时反映「已终止」。
  const impEnded = (id?: string) => (id ? pget(`C.impersonate.${id}.ended`) === "true" : false);
  const endImpersonate = (id: string, reason: string) => {
    setParam(`C.impersonate.${id}.ended`, "true", { action: "终止 impersonate 会话 " + id, reason });
    logAudit({ actor: "总管理员", action: "终止 impersonate 会话 " + id, target: id, reason });
    setToast("已终止 impersonate 会话 " + id + " · 令牌即时吊销 · 已写审计");
    setMc(null);
  };
  // C-06 重置密码:凭据铁律 — 后台**绝不设/收明文密码**,只向用户发送密码重置链接(server 侧仅存 hash)。
  // 真写平台参数 C.user.<id>.pwReset = "link-sent" + A2 审计 + persist;无任何明文密码字段。
  const sendPwResetLink = (reason: string) => {
    if (!sel) return;
    const id = sel.id;
    setParam(`C.user.${id}.pwReset`, "link-sent", { action: "发送密码重置链接 " + id, reason });
    setToast("重置链接已发送至用户 " + id + " · 已写审计(后台不持有明文密码)");
    setMc(null);
  };
  // C-09 资产调整审批:第二人复核 通过/驳回 → 真写平台参数 C.adjust.<id>.status + A2 审计 + persist;列表派生覆盖待审态。
  const adjustVerdict = (row: AdjustRow, result: AdjustResult, reason: string) => {
    setParam(`C.adjust.${row.id}.status`, result, {
      action: `资产调整审批${ADJ_LABEL[result]} ${row.id}`,
      reason,
    });
    setToast(`资产调整 ${row.id} ${ADJ_LABEL[result]} · ${row.userId} · 已写审计`);
    setMc(null);
  };
  // C-05 限制提现:平台参数真写(C.user.<id>.restricted)+ 审计 + persist;与冻结(setFrozen)互补、独立可切换。
  const restrictWithdraw = (reason: string) => {
    if (!sel) return;
    const next = !isRestricted(sel.id);
    setParam(`C.user.${sel.id}.restricted`, next ? "true" : "false", {
      action: next ? "限制提现" : "解除提现限制",
      reason,
    });
    setToast((next ? "已限制提现 " : "已解除提现限制 ") + sel.id + " · 已写审计,即时生效");
    setMc(null);
  };
  // C-07/C-08 KYC 复审裁决:平台参数真写(C.kyc.<id>.result = passed/rejected/supplement)+ 审计 + persist;台账状态派生覆盖。
  const kycVerdict = (id: string, result: KycResult, reason: string) => {
    setParam(`C.kyc.${id}.result`, result, { action: `KYC 复审${KYC_RESULT_LABEL[result]}`, reason });
    setToast(`KYC ${id} ${KYC_RESULT_LABEL[result]} · 回写 C4 权威 + 审计`);
    setMc(null);
  };

  const segs: [string, string][] = [["all", "全部"], ["frozen", "冻结"], ["highrisk", "高风险"], ["kyc", "KYC待审"]];

  const kycVerdictLabel = mc?.kycResult ? KYC_RESULT_LABEL[mc.kycResult] : "裁决";
  // 注:action 文案被 MakerCheckerModal 的 isAdjust 正则用于决定是否出「目标新值」输入框。
  // pwReset / impersonate / adjust(审批裁决)均为纯动作,文案须**避开** 调整/调价/参数/阈值… 触发词,确保不出输入框
  // (pwReset 尤须如此 — 凭据铁律:绝不出现任何可输入密码的字段)。
  const mcAction: Record<McKind, string> = {
    freeze: selFrozen ? "账户解冻" : "账户冻结",
    restrict: selRestricted ? "解除提现限制" : "限制提现",
    kyc: `KYC 复审${kycVerdictLabel}`,
    "2fa": "禁用 2FA",
    regrisk: "注册风控参数调整:" + (mc?.name ?? ""),
    pwReset: "发送密码重置链接",
    impersonate: "impersonate · 只读代入会话",
    impEnd: "终止 impersonate 会话",
    adjust: `资产调账审批 · ${mc?.adjustResult ? ADJ_LABEL[mc.adjustResult] : "裁决"}`,
    forceout: "强制登出会话",
  };
  const mcDetail: Record<McKind, string> = {
    freeze: `${sel?.id ?? ""} · 写入 admin.user_${selFrozen ? "un" : ""}frozen · server-canonical + 审计`,
    restrict: `${sel?.id ?? ""} · 写入 C.user.<id>.restricted=${selRestricted ? "false" : "true"} · 提现门拦截 · server-canonical + 审计`,
    kyc: `${mc?.id ?? ""} · 回写 C.kyc.<id>.result=${mc?.kycResult ?? ""} · C4 权威,供 D2/G2 门消费`,
    "2fa": `${mc?.id ?? ""} · admin.2fa_disabled · 须 KYC 二验`,
    regrisk: "server-canonical · 改后对新会话生效",
    pwReset: `${sel?.id ?? ""} · 写入 C.user.<id>.pwReset=link-sent · 仅向用户发送重置链接,后台不持有/不下发明文密码(server 侧仅存 hash)`,
    impersonate: `${sel?.id ?? ""} · logAudit 留痕(A2)· 只读 ≤30min · 不改写用户数据`,
    impEnd: `${mc?.impId ?? ""} · 写入 C.impersonate.<id>.ended=true · 即时吊销该代入会话令牌 · logAudit 留痕(A2)`,
    adjust: `${mc?.adjust?.id ?? ""} · ${mc?.adjust?.userId ?? ""} · 写入 C.adjust.<id>.status=${mc?.adjustResult ?? ""} · server-canonical + 审计,回写 C3 队列`,
    forceout: `${mc?.id ?? ""} · 写入 C.session.<id>.forcedOut=true · 吊销该会话令牌 · server-canonical + 审计`,
  };

  return (
    <div className="dkpage">
      <DomainHeader {...meta} right={<Btn onClick={() => setToast("脱敏用户数据导出已生成(演示 · 写入 A2 审计)")}><Icon name="download" size={15} /> <Gloss>脱敏导出</Gloss></Btn>} />

      <div className="grid g-4" style={{ marginBottom: 16 }}>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny">总注册用户</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)" }} className="tnum">128,400</div></Card>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny">设备持有者(L4+)</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--ink)" }} className="tnum">33,180</div></Card>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny">冻结账户</div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--danger)" }} className="tnum">{users.filter((u) => isFrozen(u)).length}</div></Card>
        <Card style={{ padding: "15px 16px" }}><div className="muted tiny"><AutoGloss>KYC pending</AutoGloss></div><div style={{ fontSize: 24, fontWeight: 600, color: "var(--warning)" }} className="tnum">{users.filter((u) => u.kyc === "pending").length}</div></Card>
      </div>

      {tab === "C1" && (
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px", flexWrap: "wrap", gap: 10 }}>
            <span className="ttl">检索 & 画像</span><CodeTag title="生命周期 L0-L5 / V-Rank V0-V12"><AutoGloss>用户分层口径</AutoGloss></CodeTag>
            <div className="spacer" />
            <div className="tb-search" style={{ margin: 0, width: 220 }}><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="userId / 姓名 / 推荐码" /></div>
            {segs.map(([k, l]) => <Chip key={k} tab sel={seg === k} onClick={() => setSeg(k)}>{l}</Chip>)}
          </div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>userId</th><th>姓名</th><th>生命周期</th><th>V-Rank</th><th>设备</th><th>KYC</th><th>风险分</th><th className="num">余额</th><th>状态</th><th /></tr></thead>
            <tbody>{filtered.map((u) => (
              <tr key={u.id} style={{ cursor: "pointer" }} onClick={() => setSel(u)}>
                <td className="mono t-strong">{u.id}</td><td>{u.name}</td>
                <td><CodeTag tone="electric">{u.lc}</CodeTag></td><td><CodeTag>{u.vrank}</CodeTag></td>
                <td className="tnum">{u.devices}</td><td><Badge tone={u.kyc === "verified" ? "ok" : "warn"}>{u.kyc}</Badge></td>
                <td><Badge tone={riskBadge(u.risk)}>{u.risk}</Badge></td>
                <td className="num t-strong tnum">{fmtUsd(u.balance)}</td>
                <td>{isFrozen(u) ? <Badge tone="err">冻结</Badge> : <Badge tone="ok">正常</Badge>}</td>
                <td><Icon name="chevron" size={15} /></td>
              </tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      {tab === "C2" && (
        <div className="grid g-3">
          <Card className="span-2"><CardH title={<AutoGloss>账户处置 & impersonate 控制台</AutoGloss>} sub="冻结/解冻 · 强制登出 · 模拟登录" right={<CodeTag>账户处置</CodeTag>} />
            <div className="tint brand" style={{ marginBottom: 12 }}><div className="tiny"><b><AutoGloss>impersonate 控制台</AutoGloss></b> · 默认只读 ≤ 30min · 发起须原因码 + A2 全程留痕(admin.user_impersonation_started/ended)</div></div>
            <table className="tbl"><thead><tr><th><AutoGloss>进行中 impersonate</AutoGloss></th><th>操作人</th><th>目标对象</th><th>剩余</th><th /></tr></thead>
              <tbody>
                {(() => { const ended = impEnded("IMP-204"); return (
                <tr style={ended ? { opacity: 0.62 } : undefined}><td className="mono tiny">IMP-204</td><td className="mono tiny">support·张</td><td className="mono tiny">usr_55B1</td><td>{ended ? <Badge tone="neutral">已终止</Badge> : <Badge tone="warn">12 min</Badge>}</td><td>{ended ? <span className="muted tiny">已终止</span> : <Btn sm onClick={() => setMc({ type: "impEnd", impId: "IMP-204" })}>终止</Btn>}</td></tr>
                ); })()}
              </tbody>
            </table>
            <div className="dashed tiny" style={{ marginTop: 10 }}><AutoGloss>从 C1 用户抽屉发起新的 impersonate / 冻结 / 资产调整</AutoGloss></div>
          </Card>
          <Card><CardH title="名单管理(账户级)" sub="userId 维度" right={<CodeTag>名单管理</CodeTag>} />
            <div className="tint success" style={{ marginBottom: 8 }}><div className="row"><b>信任名单</b><div className="spacer" /><span className="tnum">142</span></div><div className="muted tiny">降风控摩擦</div></div>
            <div className="tint danger"><div className="row"><b>禁入名单</b><div className="spacer" /><span className="tnum">38</span></div><div className="muted tiny">禁止登录/交易</div></div>
            <div className="tint cyan tiny" style={{ marginTop: 10 }}><AutoGloss>账户级名单(userId)与 K1 IP 维度白名单不重叠 · 权威归 C2</AutoGloss></div>
          </Card>
          <Card className="pad-0" style={{ gridColumn: "1 / -1" }}>
            <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">资产调整审批队列</span><CodeTag title="余额 / 资产调账请求待第二人复核">资产调账审批</CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>客服/财务发起 → 第二人复核 通过/驳回 · 通过后 D4 记账</AutoGloss></span></div>
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>调账单</th><th>userId</th><th>类型</th><th className="num">金额</th><th>发起人</th><th>事由</th><th>状态</th><th /></tr></thead>
              <tbody>{ADJUST_QUEUE.map((a) => {
                const verdict = adjustStatusOf(a.id); // 复核裁决(优先于种子待审态)
                return (
                <tr key={a.id}><td className="mono t-strong">{a.id}</td><td className="mono tiny">{a.userId}</td>
                  <td className="tiny"><AutoGloss>{a.kind}</AutoGloss></td>
                  <td className={"num t-strong tnum"} style={{ color: a.delta >= 0 ? "var(--success)" : "var(--danger)" }}>{a.delta >= 0 ? "+" : "-"}{fmtUsd(Math.abs(a.delta))}</td>
                  <td className="mono tiny">{a.maker}</td>
                  <td className="tiny t-mut"><AutoGloss>{a.reason}</AutoGloss></td>
                  <td>{verdict
                    ? <Badge tone={ADJ_TONE[verdict]}>{ADJ_LABEL[verdict]}</Badge>
                    : <Badge tone="warn">待复核 · {a.ts}</Badge>}</td>
                  <td>{!verdict && (
                    <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      <Btn sm variant="primary" onClick={() => setMc({ type: "adjust", adjust: a, adjustResult: "approved" })}>通过</Btn>
                      <Btn sm variant="danger" onClick={() => setMc({ type: "adjust", adjust: a, adjustResult: "rejected" })}>驳回</Btn>
                    </span>
                  )}</td></tr>
                );
              })}</tbody>
            </table></div>
            <div style={{ padding: "0 18px 16px" }}><div className="tint cyan tiny"><AutoGloss>发起人不可自审(A2)· 裁决回写 C.adjust.&lt;id&gt;.status,通过项由 D4 双账本记账</AutoGloss></div></div>
          </Card>
        </div>
      )}

      {tab === "C4" && (
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">KYC 合规台账</span><CodeTag title="KYC 状态以此为准"><AutoGloss>KYC 合规台账</AutoGloss></CodeTag><div className="spacer" /><span className="muted tiny"><AutoGloss>供 D2 提现门 / G2 兑换门 / K5 复审消费</AutoGloss></span></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>userId</th><th>姓名</th><th>合规核验号</th><th>验证方式</th><th>分层</th><th>异常标记</th><th>KYC 状态</th><th /></tr></thead>
            <tbody>{KYC_LEDGER.map((k) => {
              const verdict = kycResultOf(k.id); // 运营复审结果(优先于种子台账状态)
              const decided = verdict === "passed"; // 通过 = 终态,关闭裁决入口(驳回/补件仍可改判)
              return (
              <tr key={k.id}><td className="mono t-strong">{k.id}</td><td>{k.name}</td><td className="mono tiny">{k.expressId}</td>
                <td className="tiny"><AutoGloss>{k.method}</AutoGloss></td><td><CodeTag tone="electric">{k.tier}</CodeTag></td>
                <td className="tiny t-mut">{k.flag}</td>
                <td>{verdict
                  ? <Badge tone={KYC_RESULT_TONE[verdict]}>{KYC_RESULT_LABEL[verdict]}</Badge>
                  : <Badge tone={k.state === "verified" ? "ok" : k.state === "review" ? "info" : "warn"}>{k.state}</Badge>}</td>
                <td>{k.state !== "verified" && !decided && (
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    <Btn sm variant="primary" onClick={() => setMc({ type: "kyc", id: k.id, kycResult: "passed" })}>通过</Btn>
                    <Btn sm onClick={() => setMc({ type: "kyc", id: k.id, kycResult: "supplement" })}>补件</Btn>
                    <Btn sm variant="danger" onClick={() => setMc({ type: "kyc", id: k.id, kycResult: "rejected" })}>驳回</Btn>
                  </span>
                )}</td></tr>
              );
            })}</tbody>
          </table></div>
        </Card>
      )}

      {tab === "C5" && (
        <Card className="pad-0">
          <div className="card-h" style={{ padding: "16px 18px 12px" }}><span className="ttl">安全 & 会话</span><CodeTag>安全会话</CodeTag></div>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>userId</th><th>设备 / 客户端</th><th>IP</th><th>地区</th><th>2FA</th><th>最近活跃</th><th /></tr></thead>
            <tbody>{SESSIONS.map((s) => (
              <tr key={s.id}><td className="mono t-strong">{s.id}</td><td className="tiny">{s.device}</td><td className="mono tiny">{s.ip}</td><td className="tiny">{s.loc}</td>
                <td><Badge tone={s.twofa ? "ok" : "warn"}>{s.twofa ? "已启用" : "未启用"}</Badge></td><td className="tiny t-mut">{s.last}</td>
                <td><span className="row" style={{ gap: 6 }}><Btn sm onClick={() => setMc({ type: "forceout", id: s.id })}>强制登出</Btn><Btn sm onClick={() => setMc({ type: "2fa", id: s.id })}>禁用 2FA</Btn></span></td></tr>
            ))}</tbody>
          </table></div>
          <div style={{ padding: "0 18px 16px" }}><div className="tint warn tiny"><AutoGloss>禁用 2FA / 密码重置须 KYC 二验 + Maker-Checker(admin.2fa_disabled / session_revoked)</AutoGloss></div></div>
        </Card>
      )}

      {tab === "C6" && (
        <Card><CardH title="注册/登录风控配置" sub="OTP / 锁定阈值 / CAPTCHA" right={<CodeTag>注册/登录风控</CodeTag>} />
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>参数</th><th>当前值</th><th>范围</th><th /></tr></thead>
            <tbody>{REGRISK.map((p) => (
              <tr key={p.key}><td className="tiny">{p.name}</td>
                <td className="t-strong">{p.val}</td><td className="t-mut tiny mono">{p.range}</td>
                <td><Btn sm onClick={() => setMc({ type: "regrisk", name: p.name })}>调整</Btn></td></tr>
            ))}</tbody>
          </table></div>
        </Card>
      )}

      {sel && (
        <Drawer title={sel.name} sub={`${sel.id} · 加入 ${sel.joined}`} onClose={() => setSel(null)}
          footer={<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, width: "100%" }}>
            <Btn variant={selFrozen ? "" : "danger"} onClick={() => setMc({ type: "freeze" })}><Icon name="lock" size={15} />{selFrozen ? "解冻账户" : "冻结账户"}</Btn>
            <Btn variant={selRestricted ? "" : "danger"} onClick={() => setMc({ type: "restrict" })}><Icon name="alert" size={15} />{selRestricted ? "解除限提" : "限制提现"}</Btn>
            <Btn onClick={() => { setBalReason(""); setBalForm({ ccy: "USDT", dir: "增加", amt: "", memo: "差错冲正" }); }}><Icon name="wallet" size={15} />资产调整</Btn>
            <Btn onClick={() => setMc({ type: "pwReset" })}><Icon name="shield" size={15} />{pwResetSent(sel.id) ? "重发链接" : "重置密码"}</Btn>
            <Btn variant="primary" style={{ gridColumn: "1 / -1", justifyContent: "center" }} onClick={() => setMc({ type: "impersonate" })}><Icon name="eye" size={15} /><AutoGloss>impersonate · 只读代入</AutoGloss></Btn>
          </div>}>
          <Btn variant="primary" style={{ width: "100%", justifyContent: "center", marginBottom: 14 }} onClick={() => router.push(`/users/search/${sel.id}`)}>
            <Icon name="chevron" size={15} />查看完整 360 画像 · 设备 / 收益 / 邀请 / 账户(可增删改查)
          </Btn>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div className="tint"><div className="muted tiny">钱包余额 · USDT</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }} className="tnum">{fmtUsd(selBalUsd)}</div></div>
            <div className="tint"><div className="muted tiny">NEX 余额</div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--ink)" }} className="tnum">{selBalNex.toLocaleString()}<span className="muted" style={{ fontSize: 11, fontWeight: 400 }}> NEX</span></div></div>
            <div className="tint"><div className="muted tiny">风险分(K4)</div><div style={{ fontSize: 18, fontWeight: 600 }} className="tnum"><Badge tone={riskBadge(sel.risk)}>{sel.risk}/100</Badge></div></div>
          </div>
          <KV k="生命周期分层" v={<CodeTag tone="electric">{sel.lc}</CodeTag>} />
          <KV k="V-Rank 头衔" v={sel.vrank} />
          <KV k="持有设备" v={sel.devices + " 台"} />
          <KV k="KYC 状态(C4)" v={<Badge tone={sel.kyc === "verified" ? "ok" : "warn"}>{sel.kyc}</Badge>} />
          <KV k="推荐码 / 树位" v={<span className="mono">{sel.ref}</span>} />
          <KV k="账户状态" v={selFrozen ? <Badge tone="err">冻结</Badge> : <Badge tone="ok">正常</Badge>} />
          <KV k="提现权限(C2)" v={selRestricted ? <Badge tone="err">已限制</Badge> : <Badge tone="ok">正常</Badge>} />
          <KV k="密码重置(C6)" v={pwResetSent(sel.id) ? <Badge tone="info">重置链接已发送</Badge> : <Badge tone="ok">未发起</Badge>} />
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "16px 0 8px", color: "var(--ink)" }}>处置历史</div>
          <div className="dashed tiny"><AutoGloss>该账户暂无处置记录 · 所有处置经 A2 Maker-Checker 留痕</AutoGloss></div>
        </Drawer>
      )}

      {mc && <MakerCheckerModal
        action={mcAction[mc.type]}
        detail={mcDetail[mc.type]}
        amplifies={mc.type === "impEnd"}
        onClose={() => setMc(null)}
        onConfirm={(reason) => {
          if (mc.type === "freeze") return freeze();
          if (mc.type === "restrict") return restrictWithdraw(reason);
          if (mc.type === "kyc" && mc.id && mc.kycResult) return kycVerdict(mc.id, mc.kycResult, reason);
          if (mc.type === "pwReset") return sendPwResetLink(reason); // C-06 发送重置链接(无明文密码)
          if (mc.type === "impersonate") return doImpersonate(reason); // C-06 只读代入 → logAudit
          if (mc.type === "impEnd" && mc.impId) return endImpersonate(mc.impId, reason); // C-06 终止 impersonate 会话 → setParam + logAudit
          if (mc.type === "adjust" && mc.adjust && mc.adjustResult) return adjustVerdict(mc.adjust, mc.adjustResult, reason); // C-09 审批
          if (mc.type === "forceout" && mc.id) { setParam(`C.session.${mc.id}.forcedOut`, "true", { action: "强制登出会话 " + mc.id, reason }); setToast("已强制登出 " + mc.id); return setMc(null); } // C-10 高敏走双签
          setToast("已提交复核"); // 2FA / regrisk(P1,本次未接真写)
          setMc(null);
        }} />}
      {impUser && <ImpersonateMirror user={impUser} onExit={() => setImpUser(null)} />}
      {balForm && sel && (
        <Modal title={<AutoGloss>资产调整 · 双币 · Maker-Checker</AutoGloss>} icon="wallet" onClose={() => setBalForm(null)}
          footer={<>
            <Btn onClick={() => setBalForm(null)}>取消</Btn>
            <Btn variant="primary" disabled={!balForm.amt.trim() || !(isSuper || balReason.trim())} onClick={() => submitBalAdjust(balReason)}>
              <Icon name="check" size={15} /> {isSuper ? <AutoGloss>应用(免双签)</AutoGloss> : "复核放行"}
            </Btn>
          </>}>
          <div className="tint brand" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}>{sel.name} · {sel.id}</div>
            <div className="muted tiny"><AutoGloss>双币资产调整(C3)· 当前 USDT </AutoGloss>{fmtUsd(selBalUsd)} · NEX {selBalNex.toLocaleString()} · 调整即时入台账 / 累计 + A2 审计,刷新不丢</div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>币种</label>
            <div className="row wrap" style={{ gap: 8 }}>{(["USDT", "NEX"] as const).map((c) => <Chip key={c} tab sel={balForm.ccy === c} onClick={() => setBalForm({ ...balForm, ccy: c })}><AutoGloss>{c}</AutoGloss></Chip>)}</div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>方向</label>
            <div className="row wrap" style={{ gap: 8 }}>{(["增加", "扣减", "红冲"] as const).map((d) => <Chip key={d} tab sel={balForm.dir === d} onClick={() => setBalForm({ ...balForm, dir: d })}><AutoGloss>{d}</AutoGloss></Chip>)}</div>
          </div>
          <div className="field" style={{ marginBottom: 12 }}>
            <label>金额（{balForm.ccy}）</label>
            <input className="fld" type="number" min={0} value={balForm.amt} onChange={(e) => setBalForm({ ...balForm, amt: e.target.value })} placeholder={`输入 ${balForm.ccy} 数量`} style={{ maxWidth: 240 }} />
          </div>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>原因码</label>
            <div className="row wrap" style={{ gap: 8 }}>{["差错冲正", "活动补发", "客诉补偿", "佣金红冲"].map((m) => <Chip key={m} tab sel={balForm.memo === m} onClick={() => setBalForm({ ...balForm, memo: m })}><AutoGloss>{m}</AutoGloss></Chip>)}</div>
          </div>
          <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
            <span className="mc"><Icon name="check" size={12} /> <AutoGloss>Maker 已提交</AutoGloss></span>
            <Icon name="arrow" size={14} />
            <span className="mc" style={{ background: isSuper ? "var(--brand-soft)" : "var(--surface-3)", color: isSuper ? "var(--brand)" : "var(--ink-3)" }}>{isSuper ? <AutoGloss>总管理员 · 全权限 · 免双签</AutoGloss> : <AutoGloss>Checker:需第二人复核</AutoGloss>}</span>
          </div>
          <div className="field">
            <label><AutoGloss>复核原因 / 备注（写入 A2 append-only 审计）</AutoGloss></label>
            <input className="fld" value={balReason} onChange={(e) => setBalReason(e.target.value)} placeholder={isSuper ? "可选(总管理员免双签,留痕用)" : "必填:复核理由"} />
          </div>
        </Modal>
      )}
      {toastNode}
    </div>
  );
}
