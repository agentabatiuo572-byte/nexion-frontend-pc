/**
 * 按执行门槛分流的统一入口 —— 各域高敏动作的 run/onConfirm 调它替代直接 setParam。
 *  - 当前身份够该动作门槛 → 直接执行(回放 mutations + 审计),沿用「确认即执行」;
 *  - 不够门槛 → 写入 A2 后端 pending ticket + 审计留痕,等有权角色或超管在 A2 裁决。
 * 仍是单人确认(执行者一人,不引入第二人会签)。
 */
import type { ActingOperator } from "@/lib/store/admin/acting-operator-store";
import { ROLE_LABEL } from "@/lib/store/admin/acting-operator-store";
import { canExecute, type ExecGate } from "@/lib/admin/ops-authority";
import type { A2OperationType } from "@/lib/admin/a2-client";

export type ProposalType = "fund" | "param" | "acct" | "sos";

export interface PendingMutation {
  key: string;
  value: string;
  action: string;
}

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
  createProposal: (input: {
    action: string;
    obj: string;
    beforeValue: string;
    afterValue: string;
    operator: string;
    operatorRole: string;
    type: A2OperationType;
    amplifies: boolean;
    sos: boolean;
    roleGate: string;
    reason: string;
    sourceDomain: string;
  }) => Promise<unknown>;
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

export async function proposeOrExecute(deps: ProposeDeps, spec: ProposeSpec): Promise<"executed" | "proposed" | "failed"> {
  const { acting, setParam, logAudit, createProposal, toast } = deps;
  const proposerRole = ROLE_LABEL[acting.role];

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

  try {
    await createProposal({
      action: spec.action,
      obj: spec.obj,
      beforeValue: spec.before,
      afterValue: spec.after,
      operator: acting.name,
      operatorRole: proposerRole,
      type: spec.type,
      amplifies: !!spec.amplifies,
      sos: !!spec.sos,
      roleGate: spec.gateLabel,
      reason: spec.reason,
      sourceDomain: spec.sourceDomain,
    });
    logAudit({
      actor: acting.name,
      action: `${spec.action}(${spec.before}→${spec.after}) · 提交后端提案(${proposerRole} 权限不足,待 ${spec.gateLabel} 执行)`,
      target: spec.obj,
      reason: spec.reason,
    });
    toast(`权限不足:已写入 A2 后端待确认队列,待 ${spec.gateLabel} 执行`);
    return "proposed";
  } catch (error) {
    toast(`A2 提案提交失败:${error instanceof Error ? error.message : "A2_PROPOSAL_FAILED"}`);
    return "failed";
  }
}
