export const F1_BENEFIT_NAMES = {
  purchaseL1Rate: "好友购买奖励 · 一级",
  purchaseL2Rate: "好友购买奖励 · 二级",
  monthlySalaryUsdt: "月薪",
};
export type F1BenefitField = keyof typeof F1_BENEFIT_NAMES;

export function isF1BenefitField(field: string | undefined): field is F1BenefitField {
  return field !== undefined && Object.hasOwn(F1_BENEFIT_NAMES, field);
}

export function f1BenefitInputError(field: F1BenefitField, value: string): string | undefined {
  const text = value.trim();
  if (field === "monthlySalaryUsdt") {
    return /^\d{1,12}(\.\d{1,6})?$/.test(text) ? undefined : "要填不小于 0 的数，最多 6 位小数";
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text) || compareDecimal(text, "100") === 1) return "要填 0–100 的数，最多 2 位小数";
  return undefined;
}

/** Convert a validated percentage string to the backend's decimal ratio without rounding. */
export function f1BenefitWriteValue(field: F1BenefitField, value: string): string {
  const text = value.trim();
  if (field === "monthlySalaryUsdt") return text;
  const [whole, fraction = ""] = text.split(".");
  const padded = whole.padStart(3, "0");
  const integer = padded.slice(0, -2).replace(/^0+(?=\d)/, "");
  const rest = (padded.slice(-2) + fraction).replace(/0+$/, "");
  return rest ? `${integer}.${rest}` : integer;
}

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


export function f2RankPurchaseRange(rows: Array<{ v: string; purchaseL1Rate?: string; purchaseL2Rate?: string }>) {
  if (rows.length !== 9 || new Set(rows.map(row => row.v)).size !== 9 || rows.some(row => !/^V[0-8]$/.test(row.v))) return null;
  const range = (field: "purchaseL1Rate" | "purchaseL2Rate") => {
    const values = rows.map(row => ratePct(row[field])).filter((value): value is string => value !== undefined);
    if (values.length !== rows.length) return null;
    values.sort((a, b) => compareDecimal(a, b) ?? 0);
    return { min: values[0], max: values[values.length - 1] };
  };
  const l1 = range("purchaseL1Rate"), l2 = range("purchaseL2Rate");
  return l1 && l2 ? { l1, l2 } : null;
}
