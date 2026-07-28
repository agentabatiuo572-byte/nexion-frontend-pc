#!/usr/bin/env node
/**
 * A2 审计覆盖哨兵 —— 防「高敏操作不落真实后端 A2」及「即时执行动作误入待审批队列」回退。
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
const count = (source, token) => source.split(token).length - 1;
const failures = [];
const A2 = "app/components/domain-views/a-tabs/a2-audit.tsx";
const A1 = "app/components/domain-views/a-tabs/a1-accounts.tsx";
const EVIEW = "app/components/domain-views/e-view.tsx";

// ── A. A2 审计页必须读取并处置真实后端工单 ──
const a2 = read(A2);
if (a2 == null) failures.push(`${A2} 未找到`);
else {
  for (const api of ["fetchA2Overview", "approveA2Operation", "rejectA2Operation", "exportA2Audit"]) {
    if (!a2.includes(api)) failures.push(`${A2}: 缺真实后端动作 ${api}`);
  }
}

// ── B. A1 账号治理读取真实后端，并由统一执行入口承接高敏动作 ──
const a1 = read(A1);
if (a1 == null) failures.push(`${A1} 未找到`);
else {
  if (!a1.includes("fetchA1Overview")) failures.push(`${A1}: 未读取真实后端账号总览`);
  if (!a1.includes("usePropose")) failures.push(`${A1}: 高敏账号动作未接统一执行入口`);
  const proposalCalls = count(a1, "void propose(toast, {");
  const proposalSources = count(a1, 'sourceDomain: "A1"');
  if (proposalCalls < 7 || proposalCalls !== proposalSources) {
    failures.push(`${A1}: A1 高敏动作数 ${proposalCalls} 与来源标记数 ${proposalSources} 不一致或少于 7,账号动作可能绕过 A2`);
  }
}

// ── C. E 域高敏分支仍存在，并统一经过后端 A2 提案入口 ──
const GAP_OPS = [
  "param", "param-multi", "param-fixed",
  "phase-save", "phase-archive",
  "generation-gate-save", "generation-gate-force", "generation-gate-archive",
  "order-state", "order-refund", "order-cancel", "order-terminal",
  "device-activate", "device-deactivate", "ops-pause",
  "dc-save", "dc-delete",
];
const ev = read(EVIEW);
if (ev == null) failures.push(`${EVIEW} 未找到`);
else {
  if (!ev.includes("usePropose")) failures.push(`${EVIEW}: E 域高敏动作未接统一提案入口`);
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
    } else if (!body.includes("propose(") && !body.includes("proposeParam(")) {
      failures.push(`${EVIEW}: onConfirm 分支 "${op}" 未进入后端 A2 提案入口`);
    }
  }
}

// ── D. 焦点动作接真实 A2；J1 止血动作直接执行并由后端审计 ──
// J1 是止血开关:理由确认后由业务接口立即执行并写 A2 审计，不能排队等待审批。
const J1_IMMEDIATE = "app/components/domain-views/j-tabs/j1-killswitch.tsx";
const PENDING_FOCAL = [
  "app/components/domain-views/h-tabs/h1-phase.tsx",
  "app/components/domain-views/i-tabs/i6-i18n.tsx",
];
const j1 = read(J1_IMMEDIATE);
if (j1 == null) {
  failures.push(`${J1_IMMEDIATE} 未找到`);
} else {
  if (j1.includes("usePropose")) failures.push(`${J1_IMMEDIATE}: J1 止血动作错误回退到待审批队列`);
  if (!j1.includes("actions.toggleJ1KillSwitch") || !j1.includes("actions.emergencyDisableJ1")) {
    failures.push(`${J1_IMMEDIATE}: J1 熔断/批量熔断未直连业务接口`);
  }
}
for (const f of PENDING_FOCAL) {
  const src = read(f);
  if (src == null) {
    failures.push(`${f} 未找到(焦点动作文件移动?同步本哨兵 PENDING_FOCAL)`);
  } else if (!src.includes("usePropose")) {
    failures.push(`${f}: 焦点高敏动作未接 usePropose —— 该域动作不再按执行门槛分流入 pending`);
  }
}

const g1 = read("app/components/domain-views/g-tabs/g1-staking.tsx");
if (g1 != null) {
  if (g1.includes("usePropose")) {
    failures.push("g1-staking: 当前 G1 PRD 要求理由确认后立即执行并由后端原子写 A2,不得进入待审批队列");
  }
  for (const command of ["updateG1StakingPoolParam", "updateG1StakingPoolSaleStatus", "updateG1StakingPoolKillStatus"]) {
    if (!g1.includes(command)) failures.push(`g1-staking: 缺少直接业务命令 ${command}`);
  }
}
const d2 = read("app/components/domain-views/d-tabs/d2-withdrawals.tsx");
if (d2 != null) {
  if (d2.includes("usePropose")) {
    failures.push("d2-withdrawals: 当前 D2 PRD 要求理由确认后即时执行,不得回退到待审批队列");
  }
  for (const command of ["openActionConfirm", "reviewD2Withdrawal", "reviewD2WithdrawalsBatch"]) {
    if (!d2.includes(command)) failures.push(`d2-withdrawals: 缺少确认或直接业务命令 ${command}`);
  }
  for (const gate of ['amplifies: action === "APPROVE"', 'amplifies: batchAction === "APPROVE"']) {
    if (!d2.includes(gate)) failures.push(`d2-withdrawals: 放行资金流出未经过 B1 覆盖率确认门 ${gate}`);
  }
  for (const idempotency of ["pendingKeys", "operationKey"]) {
    if (!d2.includes(idempotency)) failures.push(`d2-withdrawals: 缺少稳定幂等保护 ${idempotency}`);
  }
}
const result = {
  status: failures.length === 0 ? "passed" : "failed",
  checked: {
    a2BackendWorkflow: A2,
    a1BackendWorkflow: A1,
    eviewGapBranches: `${EVIEW} (${GAP_OPS.length} ops)`,
    focalProposalCardinality: "A1 >= 7, G1/D2 immediate-with-required-audit, D2 approve coverage gate",
    pendingRealtime: `${A2} backend tickets + J1 immediate + ${PENDING_FOCAL.length} 焦点域 usePropose`,
  },
  failureCount: failures.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
