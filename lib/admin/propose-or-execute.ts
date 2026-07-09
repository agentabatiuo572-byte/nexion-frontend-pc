/**
 * A2 高敏操作提案入口。
 * 前端不再直接回放本地 mutations 或写本地审计;所有高敏动作统一提交后端 A2 队列,
 * 由 A2 审批接口在服务端执行目标域动作与审计落库。
 */
import { ROLE_LABEL } from "@/lib/nav/console-nav";
import type { AuthPrincipal, ExecGate } from "@/lib/admin/ops-authority";
import type { A2OperationType } from "@/lib/admin/a2-client";
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
  target: LockTarget;
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
    target: LockTarget;
    targets?: LockTarget[];
  }) => Promise<unknown>;
  toast: (s: string) => void;
}

export async function proposeOrExecute(deps: ProposeDeps, spec: ProposeSpec): Promise<"proposed" | "failed"> {
  const { principal, createProposal, toast } = deps;
  const proposerRole = ROLE_LABEL[principal.role];

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
    });
    toast(`已写入 A2 后端待确认队列,待 ${spec.gateLabel} 执行`);
    return "proposed";
  } catch (error) {
    toast(`A2 提案提交失败:${error instanceof Error ? error.message : "A2_PROPOSAL_FAILED"}`);
    return "failed";
  }
}
