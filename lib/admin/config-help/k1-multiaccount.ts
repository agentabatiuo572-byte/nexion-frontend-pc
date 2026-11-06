/**
 * 多账户风险排查的配置项说明（CP-87、CP-88，TX-36）。按参数键取，内容来自后端代码和 PRD，
 * 写不准的不写，列在重构说明的「需要协调人决定」里（DP-33）。
 * 系统约每分钟重算一次账户组（`MultiAccountClusterScheduler`，默认 60 秒）。
 */

export interface K1ParamHelp {
  /** 这是什么，不超过 25 字。 */
  what: string;
  /** 什么时候生效，写到时点和对象（OP-140）。 */
  when: string;
  /** 怎么填，放修改框。 */
  how?: string;
  /** 改大算放宽还是收紧。 */
  direction?: string;
  /** 改了会怎样，用填的新值代入（OP-146）。 */
  whatIf?: (value: string) => string;
}

const NEXT_CHECK = "保存后立即生效，系统约每分钟检查一次，下次检查按新值算";
const LATER_EARNINGS = "保存后立即生效，之后的新增收益按新值处理，历史记录不改";
const WITHDRAW_NOW = "保存后立即生效：之后的新增收益，和这组账户现在能不能提现，都按新值判断。已入账的记录不改";
/** 上限只影响后续检测；既有组及成员限制由人工处置（MultiAccountClusterBatchService）。 */
const GROUP_EFFECT = "下次检查起，新成组的账户不能提现、新增收益锁定；既有组和成员限制保留，须在「账户组排查」人工判定或解除。不会自动冻结账户。";
const NOT_IN_USE = "保存后立即生效";
const NO_EARNING_EFFECT = "现在不影响收益。";

export const K1_PARAM_HELP: Record<string, K1ParamHelp> = {
  maxSignupPerIp24h: {
    what: "同一 IP 24 小时内最多注册几个账号",
    when: "保存后立即生效，下一次用户注册就按新值算",
    how: "1–10 的整数。",
    direction: "改大算放宽，保存时检查覆盖率，低于红线或无法读取时不能保存；改小收紧不受这项门槛阻断",
    whatIf: (value) => `改成 ${value}：同一 IP 24 小时内注册到 ${value} 个后，新用户注册被拒绝；超过 ${value} 个的账户归成一组。${GROUP_EFFECT}`,
  },
  maxAccountsPerDevice: {
    what: "同一设备超过这个数就归成一组",
    when: NEXT_CHECK,
    how: "1–5 的整数。",
    direction: "改大算放宽，保存时检查覆盖率，低于红线或无法读取时不能保存；改小收紧不受这项门槛阻断",
    whatIf: (value) => `改成 ${value}：同一设备超过 ${value} 个账户时，这些账户归成一组。${GROUP_EFFECT}`,
  },
  maxAccountsPerPaymentInstrument: {
    what: "同一支付工具超过这个数就归成一组",
    when: NEXT_CHECK,
    how: "1–5 的整数。",
    direction: "改大算放宽，保存时检查覆盖率，低于红线或无法读取时不能保存；改小收紧不受这项门槛阻断",
    whatIf: (value) => `改成 ${value}：同一支付工具超过 ${value} 个账户时，这些账户归成一组。${GROUP_EFFECT}`,
  },
  linkWeight: {
    what: "三种依据在关联程度里的占比",
    when: "保存后立即生效，系统下次检查时按新权重重算关联程度",
    how: "三项各 0–1，合计 1.00。",
    whatIf: (value) => `改成 ${value}：权重越高，这项对关联程度的影响越大。只影响建议冻结的提示，不改账户组状态。`,
  },
  clusterFreezeSuggestThreshold: {
    what: "达到这个关联程度时提示建议冻结",
    when: "保存后立即生效，列表和高风险账户组数按新值算",
    how: "0–1 的数字。",
    direction: "改大算放宽，改小算收紧",
    whatIf: (value) => `改成 ${value}：关联程度达到 ${value} 的待判定、可疑账户组显示「建议冻结」，并算进高风险账户组。不会自动冻结账户。`,
  },
  freePhoneSlotsPerCluster: {
    what: "现在不影响收益，只用来校验审核起点",
    when: NOT_IN_USE,
    how: "1–10 的整数，要小于审核起点。",
    direction: "改大算放宽，改小算收紧",
    whatIf: (value) => `改成 ${value}：${NO_EARNING_EFFECT}`,
  },
  duplicateAccountPendingFrom: {
    what: "同组账号总数达到这个数，全组收益要审核",
    when: LATER_EARNINGS,
    how: "1–50 的整数，要大于同组正常放行的手机号数，不大于锁定起点。按这组账号总数算，不分谁先注册。",
    direction: "改大算放宽，改小算收紧",
    whatIf: (value) => `改成 ${value}：同组账号总数达到 ${value} 时，这组每个账户的新增收益都要先审核。`,
  },
  duplicateAccountFreezeFrom: {
    what: "达到这个数：新增收益锁定，全组不能提现",
    when: WITHDRAW_NOW,
    how: "1–50 的整数，不小于审核起点。按这组账号总数算，不分谁先注册。",
    direction: "改大算放宽，改小算收紧",
    whatIf: (value) => `改成 ${value}：同组账号总数达到 ${value} 时，这组每个账户的新增收益直接锁定，已有余额也不能提现。已解除或判定正常的组马上按新值判断。不会自动冻结账户。`,
  },
  pendingReleaseHours: {
    what: "现在不影响收益，只在自动放行时用",
    when: NOT_IN_USE,
    how: "1–720 小时，整数。",
    direction: "改小算放宽，改大算收紧",
    whatIf: (value) => `改成 ${value} 小时：${NO_EARNING_EFFECT}`,
  },
  releaseMode: {
    what: "目前只能人工审核后放行",
    when: "不能调整",
  },
  freeSlotRequiresBinding: {
    what: "现在不影响收益，只在自动放行时用",
    when: NOT_IN_USE,
    direction: "开启改关闭算放宽，关闭改开启算收紧",
    whatIf: (value) => `改成${value === "true" ? "开启" : "关闭"}：${NO_EARNING_EFFECT}`,
  },
};
