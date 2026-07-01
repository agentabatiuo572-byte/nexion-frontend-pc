/**
 * 按执行门槛分流的统一入口 —— 各域高敏动作的 run/onConfirm 调它替代直接 setParam。
 *  - 当前身份够该动作门槛 → 直接执行(回放 mutations + 审计),沿用「确认即执行」;
 *  - 不够门槛 → 入 pending 提案队列 + 审计留痕,等有权者(lead/超管)在 A2 执行回写。
 * 仍是单人确认(执行者一人,不引入第二人会签)。
 */
import type { ActingOperator } from "@/lib/store/admin/acting-operator-store";
import { ROLE_LABEL } from "@/lib/store/admin/acting-operator-store";
import { canExecute, type ExecGate } from "@/lib/admin/ops-authority";
import type { PendingMutation, PendingProposal, ProposalType } from "@/lib/store/admin/pending-ops-store";

export interface ProposeSpec {
  action: string;
  obj: string;
  before: string;
  after: string;
  type: ProposalType;
  amplifies?: boolean;
  sos?: boolean;
  gate: ExecGate;
  gateLabel: string;
  reason: string;
  mutations: PendingMutation[];
  sourceDomain: string;
}

export interface ProposeDeps {
  acting: ActingOperator;
  // 与各域 ctx.setParam / ctx.logAudit(窄签名)对齐;平台 store 的宽签名也可赋值(逆变)。
  setParam: (key: string, value: string, meta: { action: string; reason: string; actor?: string }) => void;
  logAudit: (e: { actor: string; action: string; target: string; reason?: string }) => void;
  addProposal: (p: Omit<PendingProposal, "id" | "ts" | "tsLabel" | "status">) => void;
  toast: (s: string) => void;
}

/** 回放一组 mutation 描述符到目标域(setParam 自带 A2 审计;actor=真执行者,运行时落库)。执行端(A2)与直接执行端共用。 */
export function applyMutations(
  setParam: ProposeDeps["setParam"],
  mutations: PendingMutation[],
  reason: string,
  actor?: string,
): void {
  for (const m of mutations) {
    setParam(m.key, m.value, { action: m.action, reason, actor });
  }
}

export function proposeOrExecute(deps: ProposeDeps, spec: ProposeSpec): "executed" | "proposed" {
  const { acting, setParam, logAudit, addProposal, toast } = deps;
  const proposerRole = ROLE_LABEL[acting.role] + (acting.tier === "lead" ? " lead" : "");

  if (canExecute(acting, spec.gate)) {
    applyMutations(setParam, spec.mutations, spec.reason, acting.name);
    logAudit({
      actor: acting.name,
      action: `${spec.action}(${spec.before}→${spec.after}) · 直接执行(${proposerRole})`,
      target: spec.obj,
      reason: spec.reason,
    });
    toast(`已执行 · ${spec.action}`);
    return "executed";
  }

  addProposal({
    action: spec.action,
    obj: spec.obj,
    before: spec.before,
    after: spec.after,
    type: spec.type,
    amplifies: !!spec.amplifies,
    sos: !!spec.sos,
    proposer: acting.name,
    proposerRole,
    gate: spec.gate,
    gateLabel: spec.gateLabel,
    reason: spec.reason,
    mutations: spec.mutations,
    sourceDomain: spec.sourceDomain,
  });
  logAudit({
    actor: acting.name,
    action: `${spec.action}(${spec.before}→${spec.after}) · 提交提案(${proposerRole} 权限不足,待 ${spec.gateLabel} 执行)`,
    target: spec.obj,
    reason: spec.reason,
  });
  toast(`权限不足:已提交提案,待 ${spec.gateLabel} 在 A2 执行`);
  return "proposed";
}
