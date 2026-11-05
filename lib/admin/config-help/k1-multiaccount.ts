/**
 * 多账户风险排查的配置项说明（CP-87、CP-88，TX-36）。按参数键取，内容来自 PRD、后端和现有页面文字，
 * 写不准的不写，列在重构说明的「待确认」里（DP-33）。
 */

export interface K1ParamHelp {
  /** 这是什么，不超过 25 字。 */
  what: string;
  /** 什么时候生效，写到时点和对象（OP-140）。 */
  when: string;
  /** 怎么填，放修改框。 */
  how?: string;
  /** 改了会怎样，用填的新值代入（OP-146）。 */
  whatIf?: (value: string) => string;
}

const NEXT_CHECK = "保存后，下次检查生效";
const LATER_EARNINGS = "保存后，之后的收益按新值处理，历史记录不改";
const RELATION = "要大于同组正常放行的手机号数，不大于建议冻结起点，保存时后台检查。";

export const K1_PARAM_HELP: Record<string, K1ParamHelp> = {
  maxSignupPerIp24h: {
    what: "同一 IP 24 小时内的注册上限",
    when: "保存后，下一次注册检查生效",
    how: "1–10 的整数。",
    whatIf: (value) => `改成 ${value}：正式环境同一 IP 一天注册到 ${value} 个后，会拒绝新注册。不会自动冻结已有账户。`,
  },
  maxAccountsPerDevice: {
    what: "同一设备的账户上限",
    when: NEXT_CHECK,
    how: "1–5 的整数。",
    whatIf: (value) => `改成 ${value}：同一设备超过 ${value} 个账户时提示多账户风险。不会自动冻结已有账户。`,
  },
  maxAccountsPerPaymentInstrument: {
    what: "同一支付工具的账户上限",
    when: NEXT_CHECK,
    how: "1–5 的整数。",
    whatIf: (value) => `改成 ${value}：同一支付工具超过 ${value} 个账户时提示多账户风险。不会自动冻结已有账户。`,
  },
  linkWeight: {
    what: "三种依据在关联程度里的占比",
    when: "保存后，下次检查按新权重算，已判定的账户组不追溯",
    how: "三项各 0–1，合计 1.00。",
    whatIf: (value) => `改成 ${value}：权重越高，这项对关联程度的影响越大。`,
  },
  clusterFreezeSuggestThreshold: {
    what: "达到这个关联程度时提示建议冻结",
    when: "保存后，列表和高风险账户组数按新值算",
    how: "0–1，步长 0.05。",
    whatIf: (value) => `改成 ${value}：关联程度达到 ${value} 的待判定、可疑账户组显示「建议冻结」，并算进高风险账户组。不会自动冻结账户。`,
  },
  freePhoneSlotsPerCluster: {
    what: "同组可按正常处理的手机号数",
    when: LATER_EARNINGS,
    how: "1–10 的整数。",
    whatIf: (value) => `改成 ${value}：同一组里 ${value} 个手机号可按正常账户处理。`,
  },
  duplicateAccountPendingFrom: {
    what: "从第几个账号起新增收益要审核",
    when: LATER_EARNINGS,
    how: `1–50 的整数。${RELATION}`,
    whatIf: (value) => `改成 ${value}：同组账号数达到 ${value} 时，新增收益须先审核。`,
  },
  duplicateAccountFreezeFrom: {
    what: "从第几个账号起提出冻结建议",
    when: LATER_EARNINGS,
    how: "1–50 的整数。不小于审核起点，保存时后台检查。",
    whatIf: (value) => `改成 ${value}：同组账号数达到 ${value} 时，新增收益直接锁定，并提出冻结建议。不会自动冻结账户。`,
  },
  pendingReleaseHours: {
    what: "批量放行只统计这段时间的记录",
    when: LATER_EARNINGS,
    how: "1–720 小时，整数。",
    whatIf: (value) => `改成 ${value} 小时：只统计 ${value} 小时内的放行记录，不会自动放款。`,
  },
  releaseMode: {
    what: "目前只能人工审核后放行",
    when: "不能调整",
  },
  freeSlotRequiresBinding: {
    what: "正常名额要不要绑定手机号",
    when: LATER_EARNINGS,
    whatIf: (value) => value === "true" ? "改成开启：正常放行的名额须绑定手机号。" : "改成关闭：正常放行的名额不再要求绑定手机号。",
  },
};
