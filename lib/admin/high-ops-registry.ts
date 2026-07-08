export type DomainCode = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M";

export interface ReplayCommand {
  domain: string;
  op: string;
  params: Record<string, unknown>;
}
export interface LockTarget {
  domain: string;
  type: string;
  id: string;
}
export interface HighOpDef {
  op: string;
  domain: DomainCode;
  action: string;
  amplifies: boolean;
  type: "fund" | "param" | "acct" | "sos";
  gateLabel: string;
  targetType: string; // 锁目标 type
  buildCommand: (ctx: Record<string, unknown>) => ReplayCommand;
  buildTarget: (ctx: Record<string, unknown>) => LockTarget;
}

/** 批 0:D2 提现放行/解冻。其余域 HIGH 动作分批补登记。 */
export const HIGH_OPS: HighOpDef[] = [
  {
    op: "d2_withdraw_approve",
    domain: "D",
    action: "放行提现",
    amplifies: true,
    type: "fund",
    gateLabel: "财务 / 超管",
    targetType: "withdrawal",
    buildCommand: (ctx) => ({
      domain: "D",
      op: "d2_withdraw_approve",
      params: { withdrawalNo: ctx.withdrawalNo, action: "APPROVE" },
    }),
    buildTarget: (ctx) => ({ domain: "D", type: "withdrawal", id: String(ctx.withdrawalNo) }),
  },
  {
    op: "d2_withdraw_unfreeze",
    domain: "D",
    action: "解冻提现",
    amplifies: true,
    type: "fund",
    gateLabel: "财务 / 超管",
    targetType: "withdrawal",
    buildCommand: (ctx) => ({
      domain: "D",
      op: "d2_withdraw_unfreeze",
      params: { withdrawalNo: ctx.withdrawalNo, action: "UNFREEZE" },
    }),
    buildTarget: (ctx) => ({ domain: "D", type: "withdrawal", id: String(ctx.withdrawalNo) }),
  },
];

export function findHighOp(op: string): HighOpDef | undefined {
  return HIGH_OPS.find((o) => o.op === op);
}
