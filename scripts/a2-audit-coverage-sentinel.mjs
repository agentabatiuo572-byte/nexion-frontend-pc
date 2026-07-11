#!/usr/bin/env node
/**
 * A2 审计覆盖哨兵 —— 防「高敏操作不落 A2 审计」复发 + 防「A2 审计页脱离实时 store」回退。
 *
 * 缘起(2026-06-24):全 13 域审计发现两类坑:
 *   ① A2 审计页 a2-audit.tsx 只渲染静态种子 AUDIT_LOGS,从不订阅实时 usePlatformConfig().audit[],
 *      → 全后台高敏操作虽已 setParam/logAudit 落审计,却在 A2 页永远看不见(展示侧脱节)。
 *   ② 部分高敏写动作走后端 REST / 专用 CRUD(A 域账号治理、E 域订单/设备/E3 参数/上架门),
 *      onConfirm 漏补相邻 logAudit/setParam → 平台 A2 审计零写入(写入侧漏)。
 * 典型「修一处≠修全部」+「声明≠实现」(manifest storeAction 标 setParam,实现却是 REST)。
 *
 * 本哨兵不重做敏感度分类(那由域审计产出),只把已修的审计写入路径钉成机器门,防回退:
 *   A. a2-audit.tsx 必订阅实时 audit[](usePlatformConfig((s) => s.audit)),否则重连被回改回种子。
 *   B. a1-accounts.tsx:① 唯一写动作 chokepoint runMutation 内有集中 logAudit;
 *      ② 每个 runMutation 调用都传 audit 对象({ target: … })——防新增账号治理动作漏审计。
 *   C. e-view.tsx onConfirm 每个高敏 gap 分支(上架门 / 阶段 / 订单 / 设备 / E3 参数 / 派单 / 数据中心)必含 logAudit。
 * 注:360 HUB 用户详情页冻结/解冻是轻量快捷动作(confirm + per-user 审计),不进平台 A2;权威
 *     reason-required 冻结/解冻在 C2 账户操作页(操作确认 + logAudit admin.user_frozen),已覆盖平台 A2。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8");
};
const count = (s, sub) => s.split(sub).length - 1;

const failures = [];
const A2 = "app/components/domain-views/a-tabs/a2-audit.tsx";
const A1 = "app/components/domain-views/a-tabs/a1-accounts.tsx";
const EVIEW = "app/components/domain-views/e-view.tsx";

// ── A. A2 审计页订阅实时 store ──
const a2 = read(A2);
if (a2 == null) failures.push(`${A2} 未找到`);
else if (!/usePlatformConfig\(\s*\(s\)\s*=>\s*s\.audit\s*\)/.test(a2)) {
  failures.push(`${A2}: 未订阅实时审计 usePlatformConfig((s) => s.audit) —— A2 页疑似回退为只读种子,实时操作将不可见`);
}

// ── B. A1 账号治理集中审计 chokepoint + 每个 runMutation 传 audit ──
const a1 = read(A1);
if (a1 == null) failures.push(`${A1} 未找到`);
else {
  if (!a1.includes("logAudit({ actor: operator, action, target: audit.target")) {
    failures.push(`${A1}: runMutation 集中 logAudit chokepoint 缺失 —— A 域账号治理(建/停/启/改角色/2FA/强制登出/RBAC/安全基线)将不落 A2 审计`);
  }
  const rm = count(a1, "void runMutation(");
  // 减去 runMutation 签名里的类型注解 `audit?: { target: …}`,只数真正传入的 audit 对象。
  const auditArgs = count(a1, "{ target:") - count(a1, "audit?: { target:");
  if (rm !== auditArgs) {
    failures.push(`${A1}: runMutation 调用数 ${rm} ≠ 传 audit 对象({ target: … })数 ${auditArgs} —— 有账号治理动作漏传审计(高敏动作必落 A2)`);
  }
}

// ── C. e-view onConfirm 每个高敏 gap 分支必含 logAudit ──
// 这些分支走后端 API / 专用 CRUD,不经 setParam 自动审计,必须显式 logAudit。op key 是稳定契约(非展示文案)。
const GAP_OPS = [
  "param", "param-multi", "param-fixed",
  "phase-save", "phase-archive", "phase-current",
  "generation-gate-save", "generation-gate-force", "generation-gate-archive",
  "order-state", "order-refund", "order-cancel", "order-terminal",
  "device-activate", "device-deactivate", "ops-pause",
  "dc-save", "dc-delete",
];
const ev = read(EVIEW);
if (ev == null) failures.push(`${EVIEW} 未找到`);
else {
  // 只取分支起点 `if (mc.op === "X"` / `} else if (mc.op === "X"`,排除 IS_PREVIEW 预览短路里的 (mc.op === …)。
  const branchRe = /(?:if|else if) \(mc\.op === "([^"]+)"/g;
  const marks = [];
  for (const m of ev.matchAll(branchRe)) marks.push({ op: m[1], idx: m.index });
  const branchOf = (op) => {
    const i = marks.findIndex((x) => x.op === op);
    if (i < 0) return null;
    const start = marks[i].idx;
    const end = i + 1 < marks.length ? marks[i + 1].idx : Math.min(ev.length, start + 900);
    return ev.slice(start, end);
  };
  for (const op of GAP_OPS) {
    const body = branchOf(op);
    if (body == null) {
      failures.push(`${EVIEW}: onConfirm 未找到 mc.op === "${op}" 分支(分支被删/改名?同步更新本哨兵 GAP_OPS)`);
    } else if (!/logAudit\(/.test(body)) {
      failures.push(`${EVIEW}: onConfirm 分支 "${op}" 缺 logAudit —— 该高敏动作走后端不落 A2 审计`);
    }
  }
}

// ── D. 高敏操作动态实时化:A2 订阅 pending store + 焦点动作接 proposeOrExecute(防回退种子/断链)──
const PENDING_FOCAL = [
  "app/components/domain-views/j-tabs/j1-killswitch.tsx",
  "app/components/domain-views/g-tabs/g1-staking.tsx",
  "app/components/domain-views/h-tabs/h1-phase.tsx",
  "app/components/domain-views/i-tabs/i6-i18n.tsx",
  "app/components/domain-views/d-tabs/d2-withdrawals.tsx",
];
if (a2 != null) {
  if (!a2.includes("usePendingOps")) failures.push(`${A2}: 高敏操作动态未订阅实时 usePendingOps —— pending 队列疑似回退为静态种子`);
  if (!a2.includes("resolveProposal")) failures.push(`${A2}: 缺 resolveProposal —— A2 执行/驳回未回写 pending 状态`);
}
for (const f of PENDING_FOCAL) {
  const src = read(f);
  if (src == null) {
    failures.push(`${f} 未找到(焦点动作文件移动?同步本哨兵 PENDING_FOCAL)`);
  } else if (!src.includes("usePropose")) {
    failures.push(`${f}: 焦点高敏动作未接 usePropose —— 该域动作不再按执行门槛分流入 pending`);
  }
}
// 焦点域内**同形** amplifying 动作必一并接 propose(防「修一处漏同类」回退,审计 Round1 P1):
//   G1 = 4 个配置杠杆(APY / 罚款 / 停售恢复 / 单档熔断);D2 = 3 个资金流出动作(大额放行 / 解冻 / 退款覆盖)。
//   每个 propose 提案带一行 sourceDomain:"<域>",据此计数。仅收紧动作(G1 最小额 / D2 拒绝·延迟·冻结)留直接执行。
// 注:其余 ~11 域(D5/C2/C3/C4/G4/H3/H5/K1/K2/K3/K5)的 amplifying 动作仍「确认即执行 + 审计」,
//     未接执行门槛分流 —— 这是主人「焦点动作集」范围选择(非全量),非缺陷;欲全量覆盖另开批次。
const g1src = read("app/components/domain-views/g-tabs/g1-staking.tsx");
if (g1src != null && count(g1src, 'sourceDomain: "G1"') < 4) {
  failures.push(`g1-staking: propose 提案 < 4 —— G1 同形 amplifying 动作(APY/罚款/停售恢复/熔断)疑有回退为直接执行`);
}
const d2src = read("app/components/domain-views/d-tabs/d2-withdrawals.tsx");
if (d2src != null && count(d2src, 'sourceDomain: "D2"') < 3) {
  failures.push(`d2-withdrawals: propose 提案 < 3 —— D2 同形资金动作(大额放行/解冻/退款覆盖)疑有回退为直接执行`);
}

const result = {
  status: failures.length === 0 ? "passed" : "failed",
  checked: {
    a2Subscribe: A2,
    a1Chokepoint: A1,
    eviewGapBranches: `${EVIEW} (${GAP_OPS.length} ops)`,
    pendingRealtime: `${A2} usePendingOps + ${PENDING_FOCAL.length} 焦点域 usePropose`,
  },
  failureCount: failures.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
