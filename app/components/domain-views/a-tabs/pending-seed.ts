/**
 * A2 高敏操作动态 pending 队列的初始种子 —— 把设计稿 OPERATION_QUEUE(14 条)转成 PendingProposal,
 * 让队列开局有内容(此前是写死数组,现入 pending store,实时提案叠在其前)。
 * 种子的执行 mutation = 写 A.appr.<id>.status=approved(沿用原 approveWo 行为);真实焦点动作(P5)带各自 mutations。
 */
import { OPERATION_QUEUE, type RoleKey } from "./data";
import type { ExecGate } from "@/lib/admin/ops-authority";
import type { OpsRole } from "@/lib/store/admin/acting-operator-store";
import type { PendingProposal } from "@/lib/store/admin/pending-ops-store";

const RK_LABEL: Record<RoleKey, string> = {
  super: "超管",
  finance: "财务",
  risk: "风控",
  growth: "增长",
  content: "内容",
  support: "客服",
  audit: "只读审计",
};

/** 从 roleGate 自由文本解析结构化执行门槛(超管恒可,隐含,不入 roles)。 */
function parseGate(roleGate: string): ExecGate {
  const roles: OpsRole[] = [];
  if (/财务/.test(roleGate)) roles.push("finance");
  if (/风控/.test(roleGate)) roles.push("risk");
  if (/内容/.test(roleGate)) roles.push("content");
  if (/增长/.test(roleGate)) roles.push("growth");
  if (/客服/.test(roleGate)) roles.push("support");
  return { roles, requireLead: /lead/.test(roleGate) };
}

export const PENDING_SEED: PendingProposal[] = OPERATION_QUEUE.map((w, i) => ({
  id: w.id,
  ts: 1_000_000 - i, // 固定降序;实时提案(Date.now ≈ 1.7e12)恒排其前
  tsLabel: w.ts,
  action: w.action,
  obj: w.obj,
  before: w.before,
  after: w.after,
  type: w.type,
  amplifies: w.amplifies,
  sos: w.sos,
  proposer: w.operator,
  proposerRole: RK_LABEL[w.operatorRole] + (/lead/.test(w.operator) ? " lead" : ""),
  gate: parseGate(w.roleGate),
  gateLabel: w.roleGate,
  reason: w.reason,
  // 种子是 demo 提案,对象是演示数据无真实目标域 → 执行仅 resolveProposal(approved)+ 落 proposal_executed 审计,
  // 不回放伪 setParam(原 A.appr.<id>.status 键无任何读取方,是死写,已移除)。真实焦点动作(P5)带各自真 mutations。
  mutations: [],
  sourceDomain: "A2-seed",
  status: "pending",
}));
