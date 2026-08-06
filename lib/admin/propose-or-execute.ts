/**
 * A2 高敏操作提案入口。
 * 前端不再直接回放本地 mutations 或写本地审计;所有高敏动作统一提交后端 A2 队列,
 * 由 A2 审批接口在服务端执行目标域动作与审计落库。
 */
import { roleLabel } from "@/lib/nav/console-nav";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { AuthPrincipal, ExecGate } from "@/lib/admin/ops-authority";
import { isA2OutcomeUncertainError, type A2OperationType } from "@/lib/admin/a2-client";
import type { ReplayCommand, LockTarget } from "@/lib/admin/high-ops-registry";

export type ProposalType = "fund" | "param" | "acct" | "sos";

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
  sourceDomain: string;
  command: ReplayCommand;
  commandKey?: string;
  target?: LockTarget; // 多锁 op 仅传 targets,不传 target(避免后端 uk_target 重复插锁)
  targets?: LockTarget[]; // 多锁(J 域 batch 用)
}

export interface ProposeDeps {
  principal: AuthPrincipal;
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
    command: ReplayCommand;
    target?: LockTarget;
    targets?: LockTarget[];
  }, commandKey?: string) => Promise<unknown>;
  toast: (s: string) => void;
}

export async function proposeOrExecute(deps: ProposeDeps, spec: ProposeSpec): Promise<"proposed"> {
  const { principal, createProposal, toast } = deps;
  const proposerRole = roleLabel(principal.role);

  try {
    await createProposal({
      action: spec.action,
      obj: spec.obj,
      beforeValue: spec.before,
      afterValue: spec.after,
      operator: principal.name,
      operatorRole: proposerRole,
      type: spec.type,
      amplifies: !!spec.amplifies,
      sos: !!spec.sos,
      roleGate: spec.gateLabel,
      reason: spec.reason,
      sourceDomain: spec.sourceDomain,
      command: spec.command,
      target: spec.target,
      targets: spec.targets,
    }, spec.commandKey);
    toast(`已写入 A2 后端待确认队列,待 ${spec.gateLabel} 执行`);
    return "proposed";
  } catch (error) {
    if (isA2OutcomeUncertainError(error)) {
      toast(`A2 提案结果暂不确定；当前弹窗与输入已保留，请使用同一命令号重试并核对 A2 审计 · ${error.commandKey}`);
    } else {
      toast(`A2 提案提交失败:${displayAdminError(error)}`);
    }
    throw error;
  }
}
