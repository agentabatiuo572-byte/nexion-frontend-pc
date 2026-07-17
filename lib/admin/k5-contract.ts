export const K5_PARAM_KEYS = [
  "largeWithdrawReviewUsdt",
  "cumulativeKycThresholdUsdt",
  "reviewSlaDays",
  "reviewTriggerScore",
] as const;

export const K5_ALERT_TYPES = ["threshold-hit", "sla-breach", "large-withdraw-burst"] as const;
export const K5_ALERT_CHANNELS = ["in-app"] as const;
export const K5_ALERT_TONES = ["warn", "bad"] as const;
export const K5_KYC_STATUSES = ["APPROVED", "PENDING", "NONE", "REJECTED", "USER_UNAVAILABLE"] as const;
export type K5KycStatus = (typeof K5_KYC_STATUSES)[number];
export const K5_TICKET_TYPES = ["大额提现", "大额兑换", "累计过线", "手动触发", "风险分触发"] as const;
export type K5TicketType = (typeof K5_TICKET_TYPES)[number];

export function hasAllowedK5AlertEventKey(eventKey: string): boolean {
  return K5_ALERT_TYPES.some((type) => eventKey === type || eventKey.startsWith(`${type}:`));
}

function integerText(value: string): number | null {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value)) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateK5ParamValue(key: string, value: string): boolean {
  const text = value.trim();
  if (key === "largeWithdrawReviewUsdt") {
    const match = text.match(/^(?:>=|>)\s*\$((?:\d+|\d{1,3}(?:,\d{3})+))$/);
    const amount = match ? integerText(match[1]) : null;
    return amount != null && amount >= 100 && amount <= 50000;
  }
  if (key === "cumulativeKycThresholdUsdt") {
    const match = text.match(/^\$((?:\d+|\d{1,3}(?:,\d{3})+))$/);
    const amount = match ? integerText(match[1]) : null;
    return amount != null && amount >= 50 && amount <= 1000;
  }
  if (key === "reviewSlaDays") {
    const days = /^\d+$/.test(text) ? Number(text) : Number.NaN;
    return Number.isInteger(days) && days >= 1 && days <= 15;
  }
  if (key === "reviewTriggerScore") {
    const match = text.match(/^(?:>=|>)\s*(\d+)$/);
    const score = match ? Number(match[1]) : Number.NaN;
    return Number.isInteger(score) && score >= 70 && score <= 100;
  }
  return false;
}

export function hasExactAllowedValues(values: string[], allowed: readonly string[]): boolean {
  return values.length > 0
    && new Set(values).size === values.length
    && values.every((value) => allowed.includes(value));
}

export function validateK5Stats(stats: {
  openTickets: number;
  reviewOverdue: number;
  reviewDecidedMonth: number;
  reviewDecidedPass: number;
  reviewFrozenUsd: number;
}): boolean {
  return Object.values(stats).every((value) => Number.isFinite(value) && value >= 0)
    && stats.reviewOverdue <= stats.openTickets
    && stats.reviewDecidedPass <= stats.reviewDecidedMonth;
}
