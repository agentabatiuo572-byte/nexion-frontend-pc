/**
 * 越南盾提现参数的配置项说明（DP-31，CP-87、CP-88）。按参数键取。
 * 内容来自后端 origin/test 的 PayoutVndConfigService、BankWithdrawalPricing、BankWithdrawalService，
 * App 和 H5 Lite 的 wallet-withdraw-bank.vue；写不准的不写（DP-33）。默认值由页面按接口的 defaults 补上。
 */
import type { PayoutVndWritableField } from "../payout-vnd-contract";

export interface PayoutVndFieldHelp {
  /** 这是什么，不超过 25 字。 */
  what: string;
  /** 什么时候生效，含哪个方向要批准。 */
  when: string;
  /** 怎么填：范围和格式，默认值由页面补。 */
  how: string;
  /** 跨字段的填写规则：抽屉里进名称旁的提示，违反时错误写在这一项下面。 */
  rule?: string;
  /** 改了会怎样，举一个例子。 */
  effect: string;
  /** 显示位置，只写核对过的。 */
  where?: string;
}

// App 按自己的金额格式填当前值，这里只写位置，不写占位符（DP-30）。
const FEE_WHERE = "App 银行卡提现 › 金额页的手续费说明（费率、最低、封顶）";
const LIMIT_WHERE = "App 银行卡提现 › 金额页的「单笔限额」";

export const PAYOUT_VND_HELP: Record<PayoutVndWritableField, PayoutVndFieldHelp> = {
  sellSpreadPct: {
    what: "卖出价比基准价低多少",
    when: "之后的新报价；调小要批准",
    how: "0–3%，最多两位小数",
    effect: "改成 2：卖出价按基准价低 2% 算，同样的 USDT 到账更少",
    where: "App 银行卡提现 › 报价「每 USDT 兑换 VND」",
  },
  quoteTtlMinWithdraw: {
    what: "一次报价能保留几分钟",
    when: "之后的新报价；调长要批准",
    how: "1–60 分钟，整数",
    effect: "改成 15：之后的报价 15 分钟内有效",
    where: "App 银行卡提现 › 报价「报价剩余时间」",
  },
  requoteTolerancePct: {
    what: "当前不起作用；只保存，不触发重新报价",
    when: "只改配置；调大要批准",
    how: "0–10%，最多一位小数",
    effect: "现在改了不影响报价和到账金额；保存后整组版本更新，用户还没提交的旧报价需要重新报价",
  },
  feeRatePct: {
    what: "手续费按提现金额算的比例",
    when: "之后的新报价；调低要批准",
    how: "0–5%，最多一位小数",
    effect: "改成 2：手续费先按提现金额的 2% 算，再套最低手续费和封顶",
    where: FEE_WHERE,
  },
  feeMinUsd: {
    what: "一笔手续费最少多少",
    when: "之后的新报价；调低要批准",
    how: "0–1,000 USDT，每档 0.5",
    rule: "大于 0 时要低于单笔最低金额",
    effect: "改成 2：算出来不到 2 USDT 的按 2 USDT 收",
    where: FEE_WHERE,
  },
  feeMaxUsd: {
    what: "一笔手续费最多多少",
    when: "之后的新报价；调低要批准",
    how: "0–1,000 USDT，每档 0.5",
    rule: "不能低于最低手续费",
    effect: "改成 30：算出来超过 30 USDT 的按 30 USDT 收",
    where: FEE_WHERE,
  },
  minAmountUsd: {
    what: "一笔最少扣多少 USDT，含手续费",
    when: "之后的新报价；调低要批准",
    how: "0–10,000 USDT，整数",
    effect: "改成 50：扣款总额低于 50 USDT 的不能提到银行卡",
    where: LIMIT_WHERE,
  },
  maxAmountUsd: {
    what: "一笔最多扣多少 USDT，含手续费",
    when: "之后的新报价；调高要批准",
    how: "1–100,000 USDT，整数",
    rule: "不能低于单笔最低金额",
    effect: "改成 3,000：扣款总额超过 3,000 USDT 的不能提到银行卡",
    where: LIMIT_WHERE,
  },
};

/** 别处管的两项，只读，在「汇率设置」修改。 */
export const PAYOUT_VND_SOURCE_HELP = {
  baseRateVndPerUsdt: { what: "越南盾基准汇率", when: "跟随「汇率设置」" },
  buySpreadPct: { what: "买入价比基准价高多少", when: "跟随「汇率设置」" },
} as const;
