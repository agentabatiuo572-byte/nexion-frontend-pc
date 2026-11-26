/** Compare the conversion from the previous step; ties keep the earlier step. */
export function lowestConversionIndex(rates: readonly (number | null | undefined)[]): number | null {
  return rates.reduce<number | null>((lowest, rate, index) => {
    if (index === 0 || rate == null) return lowest;
    return lowest === null || rate < rates[lowest]! ? index : lowest;
  }, null);
}

const FUNNEL_EVENT_NAMES = new Map([
  ["auth.register_completed", "注册完成"],
  ["checkout.completed", "完成购买"],
  ["wallet.reinvest", "复投"],
  ["wallet.reinvest / 二次 checkout.completed", "复投或第二次完成购买"],
  ["withdraw.submitted", "提交提现"],
]);

export function funnelEventText(event: string | undefined): string {
  return event ? FUNNEL_EVENT_NAMES.get(event) ?? "未识别的事件" : "—";
}
