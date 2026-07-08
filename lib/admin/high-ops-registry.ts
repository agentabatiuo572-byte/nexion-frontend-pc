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
  // —— A 域账号治理(批 1) ——
  {
    op: "a1_account_create",
    domain: "A",
    action: "新建运营账号",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_create",
      params: {
        username: ctx.username,
        displayName: ctx.displayName,
        email: ctx.email ?? null,
        role: ctx.role,
        initialPassword: ctx.initialPassword,
      },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.username) }),
  },
  {
    op: "a1_account_status_update",
    domain: "A",
    action: "启用/禁用账号",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_status_update",
      params: { accountId: String(ctx.accountId), status: ctx.status },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.accountId) }),
  },
  {
    op: "a1_account_change_role",
    domain: "A",
    action: "变更角色",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_change_role",
      params: { accountId: String(ctx.accountId), role: ctx.role },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.accountId) }),
  },
  {
    op: "a1_account_reset_2fa",
    domain: "A",
    action: "重置双因子",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_reset_2fa",
      params: { accountId: String(ctx.accountId) },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.accountId) }),
  },
  {
    op: "a1_account_delete",
    domain: "A",
    action: "删除账号",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_delete",
      params: { accountId: String(ctx.accountId) },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.accountId) }),
  },
  {
    op: "a1_account_update_profile",
    domain: "A",
    action: "编辑账号资料",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_update_profile",
      params: {
        accountId: String(ctx.accountId),
        username: ctx.username,
        displayName: ctx.displayName,
        email: ctx.email ?? null,
      },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.accountId) }),
  },
  {
    op: "a1_account_force_logout",
    domain: "A",
    action: "强制登出",
    amplifies: false,
    type: "acct",
    gateLabel: "超管",
    targetType: "account",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_account_force_logout",
      params: { accountId: String(ctx.accountId) },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "account", id: String(ctx.accountId) }),
  },
  {
    op: "a1_security_baseline_update",
    domain: "A",
    action: "调整安全基线",
    amplifies: false,
    type: "param",
    gateLabel: "超管",
    targetType: "baseline",
    buildCommand: (ctx) => ({
      domain: "A",
      op: "a1_security_baseline_update",
      params: { baselineKey: String(ctx.baselineKey), value: String(ctx.value) },
    }),
    buildTarget: (ctx) => ({ domain: "A", type: "baseline", id: String(ctx.baselineKey) }),
  },
];

export function findHighOp(op: string): HighOpDef | undefined {
  return HIGH_OPS.find((o) => o.op === op);
}
