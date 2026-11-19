export const F1_VOUCHER_REISSUE = "每次获批的重发都会给用户发一张新券。同一次批准重试不会重复发券。";
export const F1_VOUCHER_REISSUE_UNAVAILABLE = "券停发、过期、发完或用户已停用时，重发会失败。";
export const F1_VOUCHER_REVERSE_CLAWBACK = "最近一轮的券没用过会作废。用过的按用券时实际抵扣的金额（含比例券）从 USDT 可用余额扣回并记账。余额不够会失败；没有抵扣记录、券已作废或找不到券时，只改发放记录。";
export const F1_VOUCHER_REVERSE_KEEP = "最近一轮的券没用过会作废。用过的只改发放记录，余额和账单不变。";
