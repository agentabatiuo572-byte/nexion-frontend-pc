#!/usr/bin/env node
/**
 * A2 审计覆盖哨兵 —— 防「高敏操作不落 A2 审计」复发 + 防「A2 审计页脱离后端 A2 overview」回退。
 *
 * 缘起(2026-06-24):全 13 域审计发现两类坑:
 *   ① A2 审计页 a2-audit.tsx 只渲染静态种子 AUDIT_LOGS,或回退为本地 usePlatformConfig().audit[],
 *      → 全后台高敏操作虽已落后端审计,却在 A2 页永远看不见(展示侧脱节)。
 *   ② 部分高敏写动作走后端 REST / 专用 CRUD(A 域账号治理、E 域订单/设备/E3 参数/代际门),
 *      onConfirm 漏补相邻 logAudit/setParam → 平台 A2 审计零写入(写入侧漏)。
 * 典型「修一处≠修全部」+「声明≠实现」(manifest storeAction 标 setParam,实现却是 REST)。
 *
 * 本哨兵不重做敏感度分类(那由域审计产出),只把已修的后端审计/工单路径钉成机器门,防回退:
 *   A. a2-audit.tsx 必读取后端 fetchA2Overview().recentLogs,否则重连被回改回种子或本地 store。
 *   B. A1 账号治理必须走后端 /api/admin/platform/accounts|rbac client,不允许回退本地 logAudit/usePlatformConfig。
 *   C. e-view.tsx onConfirm 每个高敏 gap 分支(代际门 / 阶段 / 订单 / 设备 / E3 参数 / 派单 / 数据中心)
 *      必须调用真实后端 client,且禁止用本地 logAudit 伪装 A2 证据。
 *   D. A2 审批、驳回、提案、导出必须走后端 audit client + platform proxy,焦点域禁止回退本地 store。
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
const A1_CLIENT = "lib/admin/a1-client.ts";
const A2_CLIENT = "lib/admin/a2-client.ts";
const PLATFORM_ROUTE = "app/api/admin/platform/[...path]/route.ts";

// ── A. A2 审计页读取后端 A2 overview/recentLogs ──
const a2 = read(A2);
if (a2 == null) failures.push(`${A2} 未找到`);
else if (!a2.includes("fetchA2Overview") || !/overview\?\.recentLogs\s*\?\?\s*\[\]/.test(a2)) {
  failures.push(`${A2}: 未读取后端 A2 overview/recentLogs —— A2 页疑似回退为只读种子或本地 store,真实审计将不可见`);
}

// ── B. A1 账号治理走后端 client,禁止回退本地平台 store 审计 ──
const a1 = read(A1);
const a1Client = read(A1_CLIENT);
if (a1 == null) failures.push(`${A1} 未找到`);
else {
  if (/usePlatformConfig|logAudit|setParam/.test(a1)) {
    failures.push(`${A1}: 账号治理回退本地 usePlatformConfig/logAudit/setParam —— A1 必须走后端账号/RBAC接口并由服务端审计`);
  }
  for (const token of ["fetchA1Overview", "createA1Account", "changeA1AccountRole", "updateA1AccountStatus", "resetA1Account2fa", "revokeA1AccountSessions", "updateA1RbacGrants"]) {
    if (!a1.includes(token)) failures.push(`${A1}: 缺 ${token} —— A1 账号/RBAC治理疑似未走后端 client`);
  }
  if (!/await\s+refreshOverview\(true\)/.test(a1)) {
    failures.push(`${A1}: runMutation 成功后未刷新后端 overview —— A1 下游状态可能只停留在本地`);
  }
}
if (a1Client == null) failures.push(`${A1_CLIENT} 未找到`);
else {
  if (!a1Client.includes('fetch(`/api/admin/platform${path}`')) {
    failures.push(`${A1_CLIENT}: 未通过 /api/admin/platform 代理访问后端账号治理接口`);
  }
  if (!a1Client.includes('"Idempotency-Key"')) {
    failures.push(`${A1_CLIENT}: 写操作缺 Idempotency-Key 透传 —— A1 高敏账号治理缺幂等门`);
  }
  for (const pathNeedle of ["/accounts/overview", "/accounts", "/rbac/actions"]) {
    if (!a1Client.includes(pathNeedle)) failures.push(`${A1_CLIENT}: 缺 ${pathNeedle} client 路径`);
  }
}

// ── C. e-view onConfirm 每个高敏 gap 分支必须真实调用后端,且不能回退本地审计镜像 ──
// op key 是稳定契约(非展示文案)。一组 token 任一命中即可表示该分支覆盖对应后端动作族。
const GAP_OPS = {
  "param": ["updateE1GenerationGate", "updateE3Param"],
  "param-multi": ["updateE3Params"],
  "param-fixed": ["updateE1GenerationGate", "updateE3Param"],
  "phase-save": ["patchE1Phase", "createE1Phase"],
  "phase-archive": ["archiveE1Phase"],
  "phase-current": ["setE1CurrentPhase"],
  "generation-gate-save": ["patchE1GenerationGate", "createE1GenerationGate"],
  "generation-gate-force": ["patchE1GenerationGate"],
  "generation-gate-archive": ["archiveE1GenerationGate"],
  "order-state": ["updateE4OrderState"],
  "order-refund": ["refundE4Order"],
  "order-cancel": ["cancelE4Order"],
  "order-terminal": ["terminalE4Order"],
  "device-activate": ["activateE5Device"],
  "device-deactivate": ["deactivateE5Device"],
  "ops-pause": ["setE5DatacenterPaused"],
  "dc-save": ["createE5Datacenter", "updateE5Datacenter"],
  "dc-delete": ["deleteE5Datacenter"],
};
const ev = read(EVIEW);
if (ev == null) failures.push(`${EVIEW} 未找到`);
else {
  if (/logAudit\(/.test(ev)) {
    failures.push(`${EVIEW}: 仍存在本地 logAudit() —— E 域高敏链路不得用 platform-config 内存审计伪装 A2 后端审计`);
  }
  if (/\bsetParam\(/.test(ev)) {
    failures.push(`${EVIEW}: 仍存在 setParam() —— E 域参数/高敏配置不得回退 platform-config 内存态`);
  }
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
  for (const [op, backendTokens] of Object.entries(GAP_OPS)) {
    const body = branchOf(op);
    if (body == null) {
      failures.push(`${EVIEW}: onConfirm 未找到 mc.op === "${op}" 分支(分支被删/改名?同步更新本哨兵 GAP_OPS)`);
    } else if (!backendTokens.some((token) => body.includes(token))) {
      failures.push(`${EVIEW}: onConfirm 分支 "${op}" 未命中后端 client(${backendTokens.join(" | ")}) —— 该动作疑似只改本地状态`);
    }
  }
}

// ── D. 高敏操作动态后端化:A2 读后端工单队列 + 审批/驳回/提案走 audit client/proxy ──
const PENDING_FOCAL = [
  "app/components/domain-views/j-tabs/j1-killswitch.tsx",
  "app/components/domain-views/g-tabs/g1-staking.tsx",
  "app/components/domain-views/h-tabs/h1-phase.tsx",
  "app/components/domain-views/i-tabs/i6-i18n.tsx",
  "app/components/domain-views/d-tabs/d2-withdrawals.tsx",
];
if (a2 != null) {
  if (!a2.includes("overview?.operationQueue ?? []")) failures.push(`${A2}: 高敏操作动态未读取后端 operationQueue`);
  if (!a2.includes("approveA2Operation") || !a2.includes("rejectA2Operation")) failures.push(`${A2}: A2 执行/驳回未走后端 audit operation client`);
  if (count(a2, "await refreshOverview();") < 2) failures.push(`${A2}: A2 审批/驳回后未刷新后端 overview`);
}
for (const f of PENDING_FOCAL) {
  const src = read(f);
  if (src == null) {
    failures.push(`${f} 未找到(焦点动作文件移动?同步本哨兵 PENDING_FOCAL)`);
  } else if (/usePlatformConfig|setParam|logAudit/.test(src)) {
    failures.push(`${f}: 焦点域回退本地 usePlatformConfig/setParam/logAudit —— 应走各域真实 client 或 A2 后端提案`);
  }
}
const a2Client = read(A2_CLIENT);
if (a2Client == null) failures.push(`${A2_CLIENT} 未找到`);
else {
  for (const token of ["fetchA2Overview", "approveA2Operation", "rejectA2Operation", "createA2OperationProposal", "exportA2Audit", "updateA2MechanismParam"]) {
    if (!a2Client.includes(token)) failures.push(`${A2_CLIENT}: 缺 ${token} 后端 audit client`);
  }
  for (const pathNeedle of ['"/overview"', '"/operations"', "/api/admin/platform/audit/exports", "mechanism-params"]) {
    if (!a2Client.includes(pathNeedle)) failures.push(`${A2_CLIENT}: 缺 ${pathNeedle} audit 路径`);
  }
  if (!a2Client.includes('"Idempotency-Key"')) failures.push(`${A2_CLIENT}: A2 写操作缺 Idempotency-Key`);
}
const platformRoute = read(PLATFORM_ROUTE);
if (platformRoute == null) failures.push(`${PLATFORM_ROUTE} 未找到`);
else {
  if (!platformRoute.includes('parts[0] === "audit"')) failures.push(`${PLATFORM_ROUTE}: 缺 audit proxy 总入口`);
  if (!platformRoute.includes('parts[1] === "overview"') || !platformRoute.includes('parts[1] === "exports"')) failures.push(`${PLATFORM_ROUTE}: 缺 audit overview/exports proxy 映射`);
  if (!platformRoute.includes('parts[1] === "operations"')) failures.push(`${PLATFORM_ROUTE}: 缺 audit operations proxy 映射`);
  if (!platformRoute.includes('parts[1] === "mechanism-params"')) failures.push(`${PLATFORM_ROUTE}: 缺 audit mechanism-params proxy 映射`);
  if (!platformRoute.includes("ADMIN_AUTH_REQUIRED")) failures.push(`${PLATFORM_ROUTE}: proxy 缺 admin token 强校验`);
}

const result = {
  status: failures.length === 0 ? "passed" : "failed",
  checked: {
    a2BackendAudit: A2,
    a1BackendAudit: `${A1} + ${A1_CLIENT}`,
    eviewGapBranches: `${EVIEW} (${Object.keys(GAP_OPS).length} ops)`,
    a2BackendOperations: `${A2} + ${A2_CLIENT} + ${PLATFORM_ROUTE} + ${PENDING_FOCAL.length} 焦点域本地 store 禁回退`,
  },
  failureCount: failures.length,
  failures,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
