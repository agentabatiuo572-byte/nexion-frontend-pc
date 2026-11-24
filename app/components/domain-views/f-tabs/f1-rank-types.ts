/**
 * F1「我的等级」改版用到的新数据：每级两列好友购买比例、月薪（B83、B87），V8 审核名单（B88），月薪领取记录（B87-BE-04）。
 *
 * 界面先按这里的形状搭好，读取和写入由接逻辑的代码项接上（F1-RANK-WIRE 标记的地方）：
 * - 每级三个字段从 F1 管理读取的总览行带过来，接上后并进 F1VRankRow；没带（旧后端）时界面显示「—」，没有调整入口。
 * - V8 名单、月薪记录、等级权益写入挂在 FViewCtx 的可选项上；不传就按「没有这项数据」显示。
 * 这里只放类型和显示换算，不发请求。
 */
import type { F1VRankRow } from "@/lib/admin/f1-client";

/** F1-RANK-WIRE：总览行接上 purchaseL1Rate、purchaseL2Rate（小数字符串，如 "0.044"）、monthlySalaryUsdt（十进制字符串）后，这三项就有值。 */
export type F1RankRowView = F1VRankRow & {
  purchaseL1Rate?: string;
  purchaseL2Rate?: string;
  monthlySalaryUsdt?: string;
};

export type F1BenefitField = "purchaseL1Rate" | "purchaseL2Rate" | "monthlySalaryUsdt";

/** F1-RANK-WIRE：GET /api/admin/teams/v8-review-candidates 的一行（B88-BE-02 交付的字段名）。 */
export type F1V8Candidate = {
  userId: string;
  userCode: string;
  nickname: string;
  currentRank: string;
  selfComputePoints: string;
  teamComputePoints: string;
  directRefs: string;
  qualifiedDownlineCount: string;
  inviterCode: string;
  inviterNickname: string;
  pendingV8Proposal: boolean;
  pendingV8ProposalCreatedAt?: string;
};

/** F1-RANK-WIRE：名单读取状态。pendingReviewCount 是后端给的全部页里可审核人数，不是已读到的行数。 */
export type F1V8ReviewState = {
  items: F1V8Candidate[];
  pendingReviewCount: number | null;
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

/** F1-RANK-WIRE：月薪领取记录一行（B87-BE-04）。userCode 的字段名后端交接里没写，接上时按实际字段改。 */
export type F1SalaryClaim = {
  claimNo: string;
  billNo: string;
  userId: string;
  userCode?: string;
  nickname: string;
  month: string;
  rankCode: string;
  amountUsdt: string;
  claimedAt: string;
};

export type F1SalaryFilters = { user: string; month: string; rank: string };

export type F1SalaryClaimsState = {
  items: F1SalaryClaim[];
  nextCursor: string | null;
  loading: boolean;
  error: string | null;
};

/** 小数比例字符串换成百分数字符串（"0.044" → "4.4"），按字符串挪小数点，不用浮点乘 100；不是合法小数时返回 undefined。 */
export function ratePct(raw: string | undefined): string | undefined {
  const text = (raw ?? "").trim();
  const match = text.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) return undefined;
  const frac = (match[2] ?? "").padEnd(2, "0");
  const whole = (match[1] + frac.slice(0, 2)).replace(/^0+(?=\d)/, "");
  const rest = frac.slice(2).replace(/0+$/, "");
  return rest ? `${whole}.${rest}` : whole;
}

/** 两个非负十进制字符串比大小：-1、0、1；有一个不是合法数时返回 undefined。 */
export function compareDecimal(a: string, b: string): -1 | 0 | 1 | undefined {
  const parse = (value: string) => {
    const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/);
    return match ? [match[1].replace(/^0+(?=\d)/, ""), (match[2] ?? "").replace(/0+$/, "")] as const : undefined;
  };
  const x = parse(a), y = parse(b);
  if (!x || !y) return undefined;
  if (x[0].length !== y[0].length) return x[0].length > y[0].length ? 1 : -1;
  if (x[0] !== y[0]) return x[0] > y[0] ? 1 : -1;
  const width = Math.max(x[1].length, y[1].length);
  const fx = x[1].padEnd(width, "0"), fy = y[1].padEnd(width, "0");
  return fx === fy ? 0 : fx > fy ? 1 : -1;
}

/** V8 另加的两项条件、五项权益：App 展示的固定文案，后台只读（rank-rules「V8 特别规则」）。 */
export const V8_TERMS = ["另一位 V8 的推荐信", "官方审核"];
export const V8_PERKS = ["渠道宣传", "年度旅游", "专属客服", "资金转移", "新市场优先权"];
