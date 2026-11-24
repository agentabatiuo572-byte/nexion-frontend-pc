import type { parseF1SalaryClaims, parseF1V8Review, F1SalaryFilters } from "@/lib/admin/f-overview-contract";

export type { F1SalaryFilters };
export type { F1BenefitField } from "@/lib/admin/f1-rank-benefit";
export { compareDecimal, ratePct } from "@/lib/admin/f1-rank-benefit";

export type F1V8Candidate = ReturnType<typeof parseF1V8Review>["items"][number];
export type F1V8ReviewState = Omit<ReturnType<typeof parseF1V8Review>, "pendingReviewCount"> & {
  pendingReviewCount: number | null;
  loading: boolean;
  error: string | null;
};

export type F1SalaryClaim = ReturnType<typeof parseF1SalaryClaims>["items"][number];
export type F1SalaryClaimsState = ReturnType<typeof parseF1SalaryClaims> & {
  filters: F1SalaryFilters;
  loaded: boolean;
  loading: boolean;
  error: string | null;
};

/** V8 另加的两项条件、五项权益：App 展示的固定文案，后台只读（rank-rules「V8 特别规则」）。 */
export const V8_TERMS = ["另一位 V8 的推荐信", "官方审核"];
export const V8_PERKS = ["渠道宣传", "年度旅游", "VIP 专属客服", "资金转移", "新市场优先权"];
