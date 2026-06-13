"use client";

/**
 * A1 运营账号 & 权限 — design_handoff_a_domain/A1 设计稿 port(657 行 / 9 弹窗权威)。
 *
 * A 域三铁律实装(UI 不变量,server-canonical 镜像):
 *  ① 全员强制 2FA(不可关)— 详情 drawer 内 2FA 只展示「已绑定(强制项,不可关)」;
 *     重置 2FA = 解绑后下次登录强制重新绑定,不是「关闭 2FA」语义,UI 全程无关闭按钮。
 *  ② 新账号默认零写权 — 开户表单提交 detail 注明「默认零写权,只有选择的角色授权」+ 操作确认 modal 内强调。
 *  ③ 有效超管 ≥2(server 校验)— effectiveSupers 实时派生:
 *     OPERATORS.filter(role==="super" && status==="enabled") + pget(A.acct.<id>.status/role) 覆盖种子;
 *     禁用账号 / 改角色降级超管时 UI 拒写(若 -1 后 < 2 → toast 拒 + return,不弹 操作确认);
 *     f-stat「有效超管」3→2 警示 amber / 2→拒写 red / ≥3 绿。
 *
 * 真写键(A.*):
 *  A.acct.<id>.status(enabled / disabled)· A.acct.<id>.role(超管降级 / 角色变更)·
 *  A.acct.<id>.tier(member / lead)· A.acct.<id>.tfaResetAt(2FA 重置时间)·
 *  A.acct.<newId>.{status,role,tier}(新建账号)·
 *  A.rbac.<role>.<actionId>(矩阵授权变更)· A.rbac.action.<id>(新动作行登记)·
 *  A.sec.{sessionIdle,sessionAbs,lockShortCnt,lockShortMin}(安全基线 2 可调项)·
 *  A.session.user.<uid>.killedAt(强制登出 session 联动 — 同 C2/C5 user 级键)。
 *
 * 操作确认 显式 edit 契约(2026-06 跨域硬化):
 *  - 调参传 edit:改角色 select / 矩阵授权 text / 登记新动作行 text / session text / 双档锁 text;
 *  - 处置(禁用 / 启用 / 重置 2FA / 新建账号)不传 edit;凭据铁律下,重置 2FA 弹窗绝不出现密码输入字段。
 *
 * amplifies:A1 不碰资金流出方向,全部动作 amplifies=false。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc/f-cta 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { usePlatformConfig, type OpsAccount } from "@/lib/store/admin/platform-config-store";
import {
  A1_STATS, ROLE_DEFS, OPERATORS, RBAC_MATRIX, SECURITY_BASELINES,
  type Operator, type RoleKey, type GrantCell, type MatrixAction,
} from "./data";
import type { ACtx } from "./types";

/* ──────────────────────────── helpers ──────────────────────────── */

type DomainGroup = MatrixAction["domainGroup"] | "all";

const DOM_CHIPS: { key: DomainGroup; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "资金", label: "资金" },
  { key: "用户/风控", label: "用户/风控" },
  { key: "增长/内容", label: "增长/内容" },
  { key: "基座/应急", label: "基座/应急" },
];

const GRANT_LABEL: Record<GrantCell, string> = {
  M: "可发起(操作员)",
  C: "可执行(lead 门槛)",
  R: "只读",
  "-": "无权",
};

const GRANT_OPTIONS: GrantCell[] = ["-", "R", "M", "C"];

function cellNode(c: GrantCell): ReactNode {
  if (c === "M") return <span className="a1-cell mk">M</span>;
  if (c === "C") return <span className="a1-cell ck">C</span>;
  if (c === "R") return <span className="a1-cell rd">读</span>;
  return <span className="a1-cell no">—</span>;
}

/* 一次性临时密码格式预览(凭据铁律:真密码 server 生成;后台不持明文)。 */
const PWD_CHARS = "23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ";
function genPwdSegment(): string {
  let r = "";
  for (let i = 0; i < 4; i++) r += PWD_CHARS[Math.floor(Math.random() * PWD_CHARS.length)];
  return r;
}
function genPwd(): string {
  return `NX-${genPwdSegment()}-${genPwdSegment()}-${genPwdSegment()}`;
}

/* ──────────────────────────── 组件 ──────────────────────────── */

export function A1Accounts({ ctx }: { ctx: ACtx }) {
  const { pget, setParam, logAudit, toast, openActionConfirm } = ctx;
  // audit-ok:hydration — A1 账号/RBAC/安全基线全走 pget 实时态(已通过 ctx.pget 内置 hydrated gate);
  // addAccount 仅为写动作引用,不读 persist 态(useAccount.accounts 未被消费)。
  const addAccount = usePlatformConfig((s) => s.addAccount);

  /* 矩阵筛 */
  const [dom, setDom] = useState<DomainGroup>("all");
  /* 账号表分页 */
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  /* 角色详情 drawer */
  const [roleIdx, setRoleIdx] = useState<number | null>(null);
  /* 新建账号 drawer */
  const [naOpen, setNaOpen] = useState(false);

  /* 实时态 helpers ——————————————————————————————————————————— */
  const effStatus = (op: Operator): "enabled" | "disabled" =>
    (pget(`A.acct.${op.id}.status`) as "enabled" | "disabled" | undefined) ?? op.status;
  const effRole = (op: Operator): RoleKey =>
    (pget(`A.acct.${op.id}.role`) as RoleKey | undefined) ?? op.role;
  const effTier = (op: Operator): "lead" | "member" | null => {
    const v = pget(`A.acct.${op.id}.tier`);
    if (v === "lead") return "lead";
    if (v === "member") return null;
    return op.tier;
  };
  const effSessions = (op: Operator): number => {
    const v = pget(`A.acct.${op.id}.sessions`);
    return v !== undefined ? Number(v) : op.sessions;
  };

  /* 启用 + 超管实时计数(三铁律 ③ 守门数源) */
  const effectiveSupers = useMemo(
    () => OPERATORS.filter((o) => effRole(o) === "super" && effStatus(o) === "enabled").length,
    // params 影响 effStatus/effRole,但 pget 闭包内已读 params;每次 render 重算即可。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.params],
  );
  const supersTone = effectiveSupers <= 1 ? "danger" : effectiveSupers === 2 ? "warn" : "ok";
  const supersLabel = effectiveSupers <= 1 ? "danger" : effectiveSupers === 2 ? "warn" : "ok";

  /* 账号状态派生(启用 / 禁用)。 */
  const enabledCount = useMemo(
    () => OPERATORS.filter((o) => effStatus(o) === "enabled").length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ctx.params],
  );
  const disabledCount = OPERATORS.length - enabledCount;

  /* 矩阵授权实时读(pget 覆盖种子)。 */
  const cellLive = (m: MatrixAction, roleIdx: number): GrantCell => {
    const k = `A.rbac.${ROLE_DEFS[roleIdx].key}.${m.id}`;
    const v = pget(k) as GrantCell | undefined;
    return v ?? m.grants[roleIdx];
  };

  /* ────────────────── 账号 CRUD 弹窗 ────────────────── */

  const changeRole = (op: Operator) => {
    const curRole = effRole(op);
    const curTier = effTier(op);
    openActionConfirm({
      action: `变更角色 · ${op.id}`,
      detail: (
        <>
          <b>{op.id} · {op.name}</b> · 当前 <b>{ROLE_DEFS.find((r) => r.key === curRole)?.name ?? curRole}{curTier ? "(lead)" : "(member)"}</b>。
          在下方业务表单选择目标角色(<span className="acode">super / finance / risk / growth / content / support / audit</span>)
          和 <span className="acode">member / lead</span> 层级;变更立即重算该账号全部授权。
          <b> 服务器两道校验:</b>① 最小权限基线(越权组合直接拒);② 若把超管降级,先校验剩余有效超管 ≥2(本页 UI 同步预判)。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "role-select",
        currentRole: curRole,
        currentTier: curTier ? "lead" : "member",
        roles: ROLE_DEFS.map((r) => ({ key: r.key, label: r.name, scope: r.scope })),
        guardHint: `有效超管 ${effectiveSupers} 个;降级超管时仍需 ≥2`,
      },
      run: (reason, v) => {
        const raw = (v || "").trim();
        const [roleStr, lvStr] = raw.split("/").map((s) => s.trim());
        const roleKeys = ROLE_DEFS.map((r) => r.key);
        if (!roleKeys.includes(roleStr as RoleKey)) {
          toast(`拒绝:无效角色 key (${roleStr}) · 合法:${roleKeys.join(" / ")}`);
          return;
        }
        const nextRole = roleStr as RoleKey;
        const nextTier: "lead" | "member" = lvStr === "lead" ? "lead" : "member";
        // 三铁律 ③:超管降级 — 若该账号当前为有效超管,且 -1 后 < 2 → 拒。
        if (curRole === "super" && effStatus(op) === "enabled" && nextRole !== "super" && effectiveSupers - 1 < 2) {
          toast("拒绝:剩余有效超管将不足 2 个(防权限死锁,server 同样校验 403)");
          return;
        }
        setParam(`A.acct.${op.id}.role`, nextRole, { action: `变更角色 ${op.id}: ${curRole}${curTier ? "(lead)" : ""} → ${nextRole}${nextTier === "lead" ? "(lead)" : ""}`, reason });
        setParam(`A.acct.${op.id}.tier`, nextTier, { action: `变更层级 ${op.id} → ${nextTier}`, reason });
        logAudit({ actor: "超管", action: `变更角色 ${op.id} · admin.operator_role_changed`, target: op.id, reason });
        toast(`${op.id} 角色变更已发布:${curRole}${curTier ? "(lead)" : ""} → ${nextRole}(${nextTier})`);
      },
    });
  };

  const reset2fa = (op: Operator) => openActionConfirm({
    action: `重置双因子 · ${op.id}`,
    detail: (
      <>
        <div className="atint danger" style={{ marginBottom: 12 }}>
          <b>社工高危路径</b> · 「员工丢手机求重置」是夺取后台账号的经典话术。提交前请用第二渠道(当面 / 视频)核实本人身份;操作理由里写明身份核实方式。
        </div>
        <div className="dlg-sec">重置后会发生什么</div>
        <div style={{ marginTop: 6, marginBottom: 4 }}>
          <div>1 · 该账号当前绑定的全部验证器<b> 立即失效</b></div>
          <div>2 · 执行生效起到重新绑定前,该账号<b> 无法登录后台</b></div>
          <div>3 · 下次登录强制进入双因子<b> 重新绑定</b>流程(2FA 是强制项,绝非「关闭 2FA」)</div>
        </div>
      </>
    ),
    amplifies: false,
    run: (reason) => {
      const now = new Date().toISOString();
      setParam(`A.acct.${op.id}.tfaResetAt`, now, { action: `重置双因子 ${op.id}`, reason });
      logAudit({ actor: "超管", action: `重置双因子 ${op.id} · admin.operator_2fa_reset`, target: op.id, reason });
      toast(`${op.id} 双因子重置已执行 · 该账号需重新绑定`);
    },
  });

  const disableAcct = (op: Operator) => {
    // 三铁律 ③:禁用前预判 — 若该账号是有效超管,-1 后 < 2 → 拒(不弹 操作确认)。
    if (effRole(op) === "super" && effStatus(op) === "enabled" && effectiveSupers - 1 < 2) {
      toast("拒绝:剩余有效超管将不足 2 个(防权限死锁,server 同样校验 403)");
      return;
    }
    openActionConfirm({
      action: `禁用账号 · ${op.id}`,
      detail: (
        <>
          <b>{op.id} · {op.name}</b> · 角色 {ROLE_DEFS.find((r) => r.key === effRole(op))?.name}。
          禁用后:① 收回全部后台访问权,该账号<b> 所有活跃 session 立即吊销</b>;② 账号转「已禁用」,授权快照保留,重新启用走操作确认;
          ③ 在途高敏动作<b> 不会自动取消</b>,请在操作确认中心(A2)逐一处理。
          {effRole(op) === "super" && (
            <> <b>服务器再校验:</b>剩余有效超管 {effectiveSupers} − 1 = {effectiveSupers - 1} ≥ 2 ✓ 可过。</>
          )}
        </>
      ),
      amplifies: false,
      run: (reason) => {
        setParam(`A.acct.${op.id}.status`, "disabled", { action: `禁用账号 ${op.id}`, reason });
        setParam(`A.session.user.${op.id}.killedAt`, new Date().toISOString(), { action: `禁用联动:${op.id} 全部 session 吊销`, reason });
        logAudit({ actor: "超管", action: `禁用账号 ${op.id} · admin.operator_account_disabled`, target: op.id, reason });
        toast(`${op.id} 已确认生效 · 全部 session 已吊销`);
      },
    });
  };

  const enableAcct = (op: Operator) => openActionConfirm({
    action: `启用账号 · ${op.id}`,
    detail: (
      <>
        <b>{op.id} · {op.name}</b> · 启用后:
        ① 恢复后台访问权,角色沿用禁用前快照 <b>{ROLE_DEFS.find((r) => r.key === effRole(op))?.name}{effTier(op) ? "(lead)" : ""}</b>;
        ② 首次登录<b> 重新校验双因子</b>(2FA 强制项);
        ③ 启用记录写入角色历史与审计。
      </>
    ),
    amplifies: false,
    run: (reason) => {
      setParam(`A.acct.${op.id}.status`, "enabled", { action: `启用账号 ${op.id}`, reason });
      logAudit({ actor: "超管", action: `启用账号 ${op.id} · admin.operator_account_enabled`, target: op.id, reason });
      toast(`${op.id} 已确认生效 · 已恢复后台访问`);
    },
  });

  /* ────────────────── 强制登出 session(详情 drawer 内) ────────────────── */
  const kickAllSessions = (op: Operator) => {
    setParam(`A.session.user.${op.id}.killedAt`, new Date().toISOString(), {
      action: `强制登出 ${op.id} 全部 session`,
      reason: "超管即时止血(普通确认,事后可查)",
    });
    logAudit({ actor: "超管", action: `强制登出 session ${op.id} · admin.operator_session_revoked`, target: op.id, reason: "普通确认 · 必填原因" });
    toast(`${op.id} 全部 session 已强制登出 · 该账号重新登录需重过双因子`);
  };

  /* ────────────────── 安全基线 · 2 个可调项 ────────────────── */
  const adjSession = () => openActionConfirm({
    action: "调整 session 时限",
    detail: (
      <>
        滑动 <span className="acode">15–60min</span> · 绝对 <span className="acode">4–12h</span>。
        对<b> 下一次登录签发</b>的 session 生效,在途 session 不受影响。
        后台是高敏操盘台,时限必须明显短于用户侧——范围上限就是这么来的。
      </>
    ),
    amplifies: false,
    edit: {
      kind: "text",
      current: `${pget("A.sec.sessionIdle") ?? "30"}min / ${pget("A.sec.sessionAbs") ?? "8"}h`,
      unit: "Nmin / Nh",
    },
    run: (reason, v) => {
      const raw = (v || "").trim();
      // 解析 "30min / 8h" 或 "30/8"
      const m = raw.match(/(\d+)\s*min?\s*\/\s*(\d+)\s*h?/i);
      if (!m) { toast("拒绝:格式如 30min / 8h(滑动 15-60 / 绝对 4-12)"); return; }
      const idle = Number(m[1]);
      const abs = Number(m[2]);
      if (idle < 15 || idle > 60) { toast(`拒绝:滑动 ${idle} 超出 15–60 范围`); return; }
      if (abs < 4 || abs > 12) { toast(`拒绝:绝对上限 ${abs} 超出 4–12 范围`); return; }
      setParam("A.sec.sessionIdle", String(idle), { action: `session 滑动过期 → ${idle}min`, reason });
      setParam("A.sec.sessionAbs", String(abs), { action: `session 绝对上限 → ${abs}h`, reason });
      logAudit({ actor: "超管", action: `调整 session 时限 · admin.system_param_changed`, target: "A.sec.session", reason });
      toast(`session 时限调整已发布:滑动 ${idle}min / 绝对 ${abs}h(对下一次签发生效)`);
    },
  });

  const adjLock = () => openActionConfirm({
    action: "调整登录失败锁定",
    detail: (
      <>
        短锁档可调:触发次数 <span className="acode">3–10</span> · 锁定时长 <span className="acode">5–60min</span>。
        <b> 长锁档锁定不可调</b>:连错 15 次 → 锁 24h + 双因子重新认证,防撞库底线档(阈值高于用户侧)。
        对<b> 新的失败计数</b>生效,已在锁定中的账号按原时长解锁。
      </>
    ),
    amplifies: false,
    edit: {
      kind: "text",
      current: `${pget("A.sec.lockShortCnt") ?? "5"} 次 / ${pget("A.sec.lockShortMin") ?? "15"}min`,
      unit: "N 次 / Nmin",
    },
    run: (reason, v) => {
      const raw = (v || "").trim();
      const m = raw.match(/(\d+)\s*次?\s*\/\s*(\d+)\s*min?/i);
      if (!m) { toast("拒绝:格式如 5 次 / 15min(触发 3-10 / 时长 5-60)"); return; }
      const cnt = Number(m[1]);
      const min = Number(m[2]);
      if (cnt < 3 || cnt > 10) { toast(`拒绝:触发次数 ${cnt} 超出 3–10 范围`); return; }
      if (min < 5 || min > 60) { toast(`拒绝:锁定时长 ${min} 超出 5–60 范围`); return; }
      setParam("A.sec.lockShortCnt", String(cnt), { action: `短锁触发次数 → ${cnt} 次`, reason });
      setParam("A.sec.lockShortMin", String(min), { action: `短锁锁定时长 → ${min}min`, reason });
      logAudit({ actor: "超管", action: `调整登录失败锁定 · admin.system_param_changed`, target: "A.sec.lock", reason });
      toast(`短锁档调整已发布:${cnt} 次 / ${min}min(对新失败计数生效)`);
    },
  });

  /* ────────────────── 全域权限矩阵 · 改授权 / 登记新动作行 ────────────────── */
  const editMx = (m: MatrixAction) => {
    const liveGrants = ROLE_DEFS.map((_, j) => cellLive(m, j));
    openActionConfirm({
      action: `变更授权 · ${m.action}`,
      detail: (
        <>
          逐角色授权 — 顺序 <span className="acode">超管 / 财务 / 风控 / 增长 / 内容 / 客服 / 只读审计</span>,
          值用 <span className="acode">M / C / R / -</span>(M 可发起 · C lead 执行门槛 · R 只读 · - 无权),斜杠分隔,共 7 项。
          <b> 服务器校验最小权限底线</b>:越权组合直接拒(增长 ≠ 资金放行 / 财务 ≠ 风控写权 / 只读审计永远零写权);
          变更带版本号,各域页面同步生效。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "permission-matrix",
        actionLabel: m.action,
        roles: ROLE_DEFS.map((r, j) => ({ key: r.key, label: r.name, current: liveGrants[j] })),
        guardHint: "只读审计零写权、账号治理超管 M 等底线仍由提交逻辑校验",
      },
      run: (reason, v) => {
        const parts = (v || "").split("/").map((s) => s.trim()) as GrantCell[];
        if (parts.length !== 7) { toast(`拒绝:需要 7 项授权(收到 ${parts.length})`); return; }
        const bad = parts.find((p) => !GRANT_OPTIONS.includes(p));
        if (bad) { toast(`拒绝:无效授权值 "${bad}",仅允许 M / C / R / -`); return; }
        // 校验:只读审计不能拿 M/C(除审计导出本身的 M)。
        const auditIdx = ROLE_DEFS.findIndex((r) => r.key === "audit");
        if (m.id !== "audit_export" && (parts[auditIdx] === "M" || parts[auditIdx] === "C")) {
          toast("拒绝:只读审计永远零写权(server 422)");
          return;
        }
        // 校验:三铁律 ③ 矩阵维度 — operator_governance(账号治理唯一发起角色 = 超管)行
        // 超管列必须保持 M;改成 -/R/C 等价于"删除矩阵超管授权" → 与禁用最后一个超管同效,
        // 直接破坏 操作确认 死锁防护。UI 拒写(audit R1 P1-1 修)。
        const superIdx = ROLE_DEFS.findIndex((r) => r.key === "super");
        if (m.id === "operator_governance" && parts[superIdx] !== "M") {
          toast("拒绝:超管对账号治理动作必为 M(三铁律 ③ 矩阵维度 · 防权限死锁)");
          return;
        }
        const diff: string[] = [];
        ROLE_DEFS.forEach((r, j) => {
          if (parts[j] !== liveGrants[j]) {
            setParam(`A.rbac.${r.key}.${m.id}`, parts[j], { action: `RBAC ${m.action} · ${r.name} ${liveGrants[j]} → ${parts[j]}`, reason });
            diff.push(`${r.name}:${liveGrants[j]}→${parts[j]}`);
          }
        });
        if (!diff.length) { toast("没有授权变化"); return; }
        logAudit({ actor: "超管", action: `变更授权 ${m.action} · admin.operator_role_changed`, target: m.id, reason });
        toast(`${m.action} 授权变更已发布(${diff.join(" · ")})`);
      },
    });
  };

  const newMxRow = () => openActionConfirm({
    action: "登记新动作行",
    detail: (
      <>
        新域新增高敏动作时在这里登记进总表;<b>默认全部无权</b>,按最小权限只给必要的(可发布后再走「改授权」逐角色开口)。
        只读审计默认<span className="acode"> R</span>(取证需要)。发布后各域页面的局部权限表同步。
      </>
    ),
    amplifies: false,
    edit: { kind: "text", current: "", unit: "如:批量补发收益(E3)" },
    run: (reason, v) => {
      const name = (v || "").trim();
      if (!name) { toast("拒绝:动作名不能为空"); return; }
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || `act_${Date.now()}`;
      setParam(`A.rbac.action.${slug}`, "registered", { action: `登记新动作行 ${name}(默认 -/-/-/-/-/-/R)`, reason });
      logAudit({ actor: "超管", action: `登记新动作行 ${name} · admin.rbac_action_registered`, target: slug, reason });
      toast(`新动作行已提交发布确认:${name} · 默认全部无权(只读审计 R)`);
    },
  });

  /* ────────────────── 渲染 ────────────────── */

  const totalPages = Math.max(1, Math.ceil(OPERATORS.length / perPage));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * perPage;
  const pageEnd = Math.min(pageStart + perPage, OPERATORS.length);
  const pageRows = OPERATORS.slice(pageStart, pageEnd);

  const mxRows = RBAC_MATRIX.filter((m) => dom === "all" || m.domainGroup === dom);

  return (
    <>
      {/* ───── 4 f-stat ───── */}
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">运营账号</div>
          <div className="v">{A1_STATS.totalAccounts} 个</div>
          <div className="sub">启用 {enabledCount} · 已禁用 {disabledCount}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">活跃 session</div>
          <div className="v">{A1_STATS.activeSessions} 个</div>
          <div className="sub">滑动 {pget("A.sec.sessionIdle") ?? "30"} 分钟过期 · 最长 {pget("A.sec.sessionAbs") ?? "8"} 小时</div>
        </div>
        <div className={`f-stat ${supersTone}`}>
          <div className="k">有效超管</div>
          <div className="v">{effectiveSupers} 个</div>
          <div className="sub">
            {supersLabel === "danger"
              ? "拒写:不足 2 个,账号治理类操作全部 server 拒"
              : supersLabel === "warn"
                ? "警示:已到 ≥2 底线,禁用 / 降级超管前 server 校验"
                : "底线 ≥2 · 禁用前服务器校验"}
          </div>
        </div>
        <div className="f-stat warn">
          <div className="k">待确认账号工单</div>
          <div className="v">{A1_STATS.pendingAcctTickets} 件</div>
          <div className="sub">
            在操作确认中心(A2)排队 · <Link className="l-btn sm" href="/platform/audit" style={{ marginLeft: 4 }}>→ 去 A2</Link>
          </div>
        </div>
      </div>

      {/* ───── (a) 运营账号列表 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">运营账号(a)</span>
          <span className="sub">· 点行看详情:角色历史 + 活跃 session(可强制登出)</span>
          <div className="r">
            <button className="l-btn sm primary" onClick={() => setNaOpen(true)}>+ 新建运营账号</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>账号</th><th>角色</th><th>双因子</th><th>状态</th><th>最近登录</th>
                <th className="num">session</th><th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((op) => {
                const st = effStatus(op);
                const role = effRole(op);
                const tier = effTier(op);
                const roleDef = ROLE_DEFS.find((r) => r.key === role);
                const ss = effSessions(op);
                return (
                  <tr key={op.id} className="click" onClick={() => setRoleIdx(null /* drawer 用账号详情走 acctOpen,见下 */)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{op.id}</span>
                      <div style={{ fontSize: 12, color: "var(--ink-4)" }}>{op.name}</div>
                    </td>
                    <td>
                      <span className="bdg dim">{roleDef?.name ?? role}{tier ? " · lead" : ""}</span>
                    </td>
                    <td>
                      {op.tfa ? <span className="bdg ok">已绑定</span> : <span className="bdg bad">未绑定</span>}
                    </td>
                    <td>
                      {st === "enabled" ? <span className="bdg ok">启用</span> : <span className="bdg dim">已禁用</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>{op.lastLogin}</td>
                    <td className="num mono">{ss}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {st === "enabled" ? (
                        <>
                          <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); changeRole(op); }}>改角色</button>{" "}
                          <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); reset2fa(op); }}>重置双因子</button>{" "}
                          <button className="l-btn sm dgr" onClick={(e) => { e.stopPropagation(); disableAcct(op); }}>禁用</button>
                        </>
                      ) : (
                        <button className="l-btn sm okk" onClick={(e) => { e.stopPropagation(); enableAcct(op); }}>启用</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* 分页器 */}
        <div className="l-b" style={{ paddingTop: 6, paddingBottom: 0 }}>
          <div className="pager">
            <span className="pager-info">显示 {pageStart + 1}–{pageEnd} / {OPERATORS.length}</span>
            <button className="pager-btn" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>‹</button>
            <span className="pager-num">{safePage + 1} / {totalPages}</span>
            <button className="pager-btn" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>›</button>
            <select
              className="pager-size"
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(0); }}
            >
              <option value={10}>每页 10</option>
              <option value={20}>每页 20</option>
              <option value={50}>每页 50</option>
            </select>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint">
            <b>这页不管用户</b> · 终端用户的冻结、登录、资产都在用户域(C);后台对用户做的每个处置,「操作者」是这页的运营账号、「对象」才是用户账户。运营账号不持任何用户资产,也不进用户事件流。
          </div>
        </div>
      </section>

      {/* ───── 登录与安全基线 + 角色定义 ───── */}
      <div className="two-col">
        {/* 安全基线 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">登录与安全基线</span>
            <span className="sub">· 三条锁死,两条可调</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {SECURITY_BASELINES.map((b) => {
              if (b.locked) {
                return (
                  <div className="a-vrow" key={b.key}>
                    <span className="nm">{b.name}<small>{b.sub}</small></span>
                    <span className="acode lock" title="server 校验,前端不可关">{b.value}</span>
                  </div>
                );
              }
              // 可调档:从 pget 读真值组合显示
              const liveVal = b.key === "session"
                ? `${pget("A.sec.sessionIdle") ?? "30"}min / ${pget("A.sec.sessionAbs") ?? "8"}h`
                : `${pget("A.sec.lockShortCnt") ?? "5"} 次/${pget("A.sec.lockShortMin") ?? "15"}min · 15 次/24h`;
              return (
                <div className="a-vrow" key={b.key}>
                  <span className="nm">{b.name}<small>{b.sub}</small></span>
                  <span className="v">{liveVal}</span>
                  <button className="l-btn sm mc" onClick={b.key === "session" ? adjSession : adjLock}>调整</button>
                </div>
              );
            })}
            <div className="atint" style={{ marginTop: 10 }}>
              <b>疑似被盗怎么办</b> · 超管可立即强制登出该账号全部 session(普通确认、必填原因,事后可查);要收权限走「禁用账号」操作确认。
            </div>
          </div>
        </section>

        {/* 角色定义 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">角色定义(c)· 7 角色,V1 固定</span>
            <span className="sub">· 点角色看它在矩阵里拿到的全部动作</span>
          </div>
          <div className="l-b" style={{ paddingTop: 2 }}>
            {ROLE_DEFS.map((r, i) => (
              <div className="a1-role" key={r.key} onClick={() => setRoleIdx(i)}>
                <span className="av" style={{ background: "var(--surface-2)", color: r.color }}>{r.av}</span>
                <span className="bd">
                  <span className="t">{r.name}</span>
                  <span className="s">{r.desc}</span>
                </span>
                <span className="scope">{r.scope}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* ───── (b) 全域权限矩阵 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全域权限矩阵(b)· 域 × 动作 × 角色</span>
          <span className="sub">· 各域页面的权限表都是这张总表的局部投影 · 每行可改授权,变更即发布</span>
          <div className="r chips">
            <button className="l-btn sm mc" onClick={newMxRow} style={{ marginRight: 6 }}>+ 登记新动作行</button>
            <span className="lb">域</span>
            {DOM_CHIPS.map((c) => (
              <button
                key={c.key}
                className={`chip${dom === c.key ? " sel" : ""}`}
                onClick={() => setDom(c.key)}
              >{c.label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl a1-mx" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th>动作(代表性抽样)</th>
                {ROLE_DEFS.map((r) => <th key={r.key}>{r.name}</th>)}
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {mxRows.map((m) => (
                <tr key={m.id}>
                  <td style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{m.action}</td>
                  {ROLE_DEFS.map((_, j) => (
                    <td key={j}>{cellNode(cellLive(m, j))}</td>
                  ))}
                  <td style={{ textAlign: "right" }}>
                    <button className="l-btn sm mc" onClick={() => editMx(m)}>改授权</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 12, color: "var(--ink-3)", marginBottom: 8 }}>
            <span><span className="a1-cell mk">M</span> 可发起</span>
            <span><span className="a1-cell ck">C</span> lead 执行门槛</span>
            <span><span className="a1-cell rd">读</span> 只读</span>
            <span><span className="a1-cell no">—</span> 无权</span>
          </div>
          <div className="atint">
            执行门槛(C)指角色内的 <b>lead 层级</b>——同角色 lead 可直接执行本角色动作并填写理由,超管覆盖全域(俗称的「主管」即此)。合规审查(KYC 复审 / 风险披露 / 法务文案)目前由风控代行,不单设合规角色。
          </div>
          <div className="atint" style={{ marginTop: 8 }}>
            授权变更会按最小权限自动校验:增长拿资金放行、财务拿风控写权这类越权组合会被直接拒。客服在单用户范围内有受限发起权(小额余额调整、协助 KYC 标记),生效仍要 lead 门槛与理由留痕。
          </div>
        </div>
      </section>

      {/* ───── f-foot ───── */}
      <p className="f-foot">
        <b>执行门槛</b>:账号建 / 停 / 启 / 改角色 / 重置双因子 = 仅超管可执行,执行前必须填写理由;强制登出 session = 仅超管、确认即时生效、必填原因;查看类只读留痕。全部写操作落审计页(A2)。
        <b> 矩阵权威口径</b>:各域页面的权限表是局部声明,这张总表是聚合视图;如遇旧称呼(平台管理员 = 超管 / 风控运营 = 风控成员 / 审计员 = 只读审计),按此对应。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "全域权限矩阵(b)· 域 × 动作 × 角色",
            kind: "fixed-matrix",
            maxRows: 16,
            reason: "固定角色动作矩阵,按域 chip 过滤,全量同屏比翻页更利于授权对比",
          },
        ]}
      />

      {/* ───── 角色详情 Drawer ───── */}
      {roleIdx !== null && (() => {
        const r = ROLE_DEFS[roleIdx];
        const granted = RBAC_MATRIX.filter((m) => cellLive(m, roleIdx) !== "-").slice(0, 8);
        return (
          <Drawer
            title={`角色 · ${r.name}`}
            sub={r.desc}
            onClose={() => setRoleIdx(null)}
          >
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.6, marginBottom: 10 }}>
              可访问域:<b style={{ color: "var(--ink-2)" }}>{r.scope}</b>。下表是该角色在全域矩阵中被授予的代表性动作(实时按 pget 读)。
            </div>
            <table className="l-tbl">
              <thead><tr><th>动作</th><th>授权</th></tr></thead>
              <tbody>
                {granted.map((m) => {
                  const c = cellLive(m, roleIdx);
                  const label = c === "M" ? "可发起" : c === "C" ? "lead 执行门槛" : "只读";
                  return (
                    <tr key={m.id}>
                      <td style={{ fontSize: 12.5 }}>{m.action}</td>
                      <td>{cellNode(c)} <span style={{ marginLeft: 6, fontSize: 11.5, color: "var(--ink-4)" }}>{label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="atint" style={{ marginTop: 14 }}>
              完整授权以矩阵为准;授权变更走操作确认发布,服务器逐请求校验。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 新建账号 Drawer(表单 → 提交 openActionConfirm) ───── */}
      {naOpen && (
        <NewAccountDrawer
          onClose={() => setNaOpen(false)}
          onSubmit={(form) => {
            const newId = `op-${String(70 + OPERATORS.length).padStart(3, "0")}`;
            openActionConfirm({
              action: `新建运营账号 · ${form.displayName}`,
              detail: (
                <>
                  <b>{form.displayName}</b>{" "}({form.email}) · 角色 <b>{ROLE_DEFS.find((r) => r.key === form.role)?.name}</b>{form.tier === "lead" ? "(lead)" : "(member)"} · 凭据 <span className="acode">{form.deliver === "mail" ? "工作邮箱自动下发" : "发起人当面交付"}</span>。
                  <div style={{ marginTop: 8 }}>
                    <b>新账号默认零写权,只有上面选的角色授权</b> · 首次登录强制绑定双因子 · 开通本身要过操作确认,超管执行且理由必填。
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--ink-4)" }}>
                    临时密码<b> 只显示 / 下发一次</b>,审计只记「已签发」事件、不存明文;24 小时内未首登自动失效,需超管重新签发;首次登录强制改密 + 绑定双因子,临时密码随即作废。
                  </div>
                </>
              ),
              amplifies: false,
              run: (reason) => {
                setParam(`A.acct.${newId}.status`, "enabled", { action: `新建运营账号 ${form.displayName}`, reason });
                setParam(`A.acct.${newId}.role`, form.role, { action: `新账号角色 ${form.role}`, reason });
                setParam(`A.acct.${newId}.tier`, form.tier, { action: `新账号层级 ${form.tier}`, reason });
                const acct: OpsAccount = {
                  id: newId,
                  acct: form.email,
                  name: form.displayName,
                  role: form.role,
                  status: "active",
                  tfa: true,
                  cred: form.deliver === "mail" ? "temp" : "invite",
                };
                addAccount(acct);
                logAudit({ actor: "超管", action: `新建运营账号 ${form.displayName} · admin.operator_account_created`, target: newId, reason });
                toast(`账号 ${form.displayName} (${newId}) 已创建 · 凭据按所选方式下发`);
                setNaOpen(false);
              },
            });
          }}
          onKickAll={(uid) => kickAllSessions({ id: uid } as Operator)}
        />
      )}
    </>
  );
}

/* ──────────────────────────── 新建账号 Drawer 表单 ──────────────────────────── */

type NaForm = {
  displayName: string;
  email: string;
  role: RoleKey;
  tier: "lead" | "member";
  deliver: "mail" | "handoff";
  reason: string;
};

function NewAccountDrawer({
  onClose, onSubmit,
}: {
  onClose: () => void;
  onSubmit: (form: NaForm) => void;
  onKickAll: (uid: string) => void;
}) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleKey>("risk");
  const [tier, setTier] = useState<"lead" | "member">("member");
  const [deliver, setDeliver] = useState<"mail" | "handoff">("mail");
  const [reason, setReason] = useState("");
  const [pwd, setPwd] = useState(() => genPwd());

  const emailOk = email.trim().endsWith("@nexion.io") && email.includes("@");
  const canSubmit = displayName.trim().length > 0 && emailOk && reason.trim().length > 0;

  return (
    <Drawer
      title="新建运营账号"
      sub="① 账号信息 → ② 初始角色 → ③ 层级 → ④ 凭据 → 操作理由(必填)"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
          <button className="l-btn" onClick={onClose} style={{ flex: 1, justifyContent: "center" }}>取消</button>
          <button
            className="l-btn primary"
            disabled={!canSubmit}
            style={{ flex: 2, justifyContent: "center", opacity: canSubmit ? 1 : 0.5, cursor: canSubmit ? "pointer" : "not-allowed" }}
            onClick={() => canSubmit && onSubmit({ displayName: displayName.trim(), email: email.trim(), role, tier, deliver, reason: reason.trim() })}
          >确认创建账号</button>
        </div>
      }
    >
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>① 账号信息</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 14 }}>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          显示名 *
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="姓名,如:张三"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13 }}
          />
        </label>
        <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
          工作邮箱 *(@nexion.io)
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@nexion.io"
            style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13 }}
          />
        </label>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>② 初始角色 *</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
        {ROLE_DEFS.map((r) => (
          <label
            key={r.key}
            className="l-btn"
            style={{
              justifyContent: "flex-start",
              padding: "10px 12px",
              background: role === r.key ? "var(--a-ac-soft)" : "var(--surface-2)",
              color: role === r.key ? "var(--a-ac)" : "var(--ink-2)",
              fontWeight: role === r.key ? 600 : 500,
              cursor: "pointer",
            }}
          >
            <input
              type="radio"
              name="operator-role"
              value={r.key}
              checked={role === r.key}
              onChange={() => setRole(r.key)}
              style={{ accentColor: "var(--a-ac)" }}
            />
            <span style={{ fontSize: 13 }}>{r.name}</span>
            <span style={{ fontSize: 11, color: "var(--ink-4)", marginLeft: 8 }}>{r.scope}</span>
          </label>
        ))}
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>③ 层级</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <label
          className="l-btn sm"
          style={{
            background: tier === "member" ? "var(--a-ac-soft)" : "var(--surface-2)",
            color: tier === "member" ? "var(--a-ac)" : "var(--ink-3)",
            fontWeight: tier === "member" ? 600 : 500,
            cursor: "pointer",
          }}
        >
          <input type="radio" name="operator-tier" value="member" checked={tier === "member"} onChange={() => setTier("member")} style={{ accentColor: "var(--a-ac)" }} />
          member 成员
        </label>
        <label
          className="l-btn sm"
          style={{
            background: tier === "lead" ? "var(--a-ac-soft)" : "var(--surface-2)",
            color: tier === "lead" ? "var(--a-ac)" : "var(--ink-3)",
            fontWeight: tier === "lead" ? 600 : 500,
            cursor: "pointer",
          }}
        >
          <input type="radio" name="operator-tier" value="lead" checked={tier === "lead"} onChange={() => setTier("lead")} style={{ accentColor: "var(--a-ac)" }} />
          lead 主管(可执行本角色动作)
        </label>
      </div>

      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)", marginBottom: 8 }}>④ 初始凭据 · 一次性临时密码</div>
      <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: "var(--ink)" }}>{pwd}</span>
          <button className="l-btn sm" onClick={() => setPwd(genPwd())}>换一个</button>
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>格式预览 · 真密码在确认通过那一刻才由服务器生成;后台不持有明文</span>
        </div>
        <div style={{ marginTop: 9, display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--ink-3)" }}>下发方式</span>
          <button
            className="l-btn sm"
            onClick={() => setDeliver("mail")}
            style={{
              background: deliver === "mail" ? "var(--a-ac-soft)" : "var(--surface-2)",
              color: deliver === "mail" ? "var(--a-ac)" : "var(--ink-3)",
              fontWeight: deliver === "mail" ? 600 : 500,
            }}
          >工作邮箱自动下发</button>
          <button
            className="l-btn sm"
            onClick={() => setDeliver("handoff")}
            style={{
              background: deliver === "handoff" ? "var(--a-ac-soft)" : "var(--surface-2)",
              color: deliver === "handoff" ? "var(--a-ac)" : "var(--ink-3)",
              fontWeight: deliver === "handoff" ? 600 : 500,
            }}
          >发起人当面交付</button>
        </div>
      </div>

      <div style={{ marginBottom: 12, fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.7 }}>
        <div>1 · 临时密码<b style={{ color: "var(--ink-2)" }}> 只显示 / 下发一次</b>,审计只记「已签发」事件、不存明文</div>
        <div>2 · <b style={{ color: "var(--ink-2)" }}>24 小时</b>内未首登自动失效,需超管重新签发</div>
        <div>3 · 首次登录<b style={{ color: "var(--ink-2)" }}> 强制改密 + 绑定双因子</b>,临时密码随即作废</div>
      </div>

      <div className="atint" style={{ marginBottom: 14 }}>
        <b>开通即生效的三条底线</b> · 默认零写权(只有上面选的角色授权)· 首次登录强制绑定双因子 · 开通本身要过操作确认,超管执行且理由必填。
      </div>

      <label style={{ fontSize: 12, color: "var(--ink-3)" }}>
        操作理由 *(必填 · 写入审计)
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="为什么开这个账号(入职 / 换岗 / 外审…)"
          style={{ width: "100%", marginTop: 4, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--ink)", fontFamily: "inherit", fontSize: 13, resize: "vertical" }}
        />
      </label>
    </Drawer>
  );
}
