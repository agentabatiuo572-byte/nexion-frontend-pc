"use client";

/**
 * 免费试用设置 · 按设备优惠（PLAN 第三节、画板 ①–⑥，B125）：H2 域内组件，不进 rd。
 * 只管呈现和本地草稿：两组优惠（试用期折扣＝比例＋上限、专享立减）各自「跟随默认／单独设置」。
 */
import { useEffect, useRef } from "react";
import { ChevronUp, Info } from "lucide-react";
import { Button, Explain, Field, NumberInput, Segments } from "@/app/components/rd";
import { validBuyPricingValue, type BuyDevice, type BuyPricing } from "@/lib/admin/h2-trial-purchase";

/** 三项默认值（常改参数和高级设置里的值），读不到的是 undefined。 */
export type PricingDefaults = { rate?: string; cap?: string; early?: string };
export type PricingMode = "follow" | "custom";
/** 抽屉里一款设备的优惠草稿。切到单独设置时输入框留空，不放占位（OP-19、OP-14）。 */
export type PricingEdit = { discount: PricingMode; rate: string; cap: string; early: PricingMode; amount: string };
export type PricingField = "rate" | "cap" | "amount";


/** 去掉末尾的 0，整数部分加千分位，不舍入（TX-20）。 */
export function plain(value: string | undefined) {
  if (value === undefined || value.trim() === "") return "—";
  const [int, frac = ""] = value.trim().split(".");
  const rest = frac.replace(/0+$/, "");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${rest ? `.${rest}` : ""}`;
}
/** 输入框里的原值：只去末尾的 0，不加千分位。 */
const raw = (value: string | null) => value === null ? "" : value.includes(".") ? value.replace(/\.?0+$/, "") : value;

const usdt = (value: string | undefined, unit: boolean) => `${plain(value)}${unit ? " USDT" : ""}`;
export const discountValue = (rate: string | undefined, cap: string | undefined, unit = true) => `${plain(rate)}%，最高 ${usdt(cap, unit)}`;
export const defaultDiscount = (defaults: PricingDefaults, unit = true) => discountValue(defaults.rate, defaults.cap, unit);
export const defaultEarly = (defaults: PricingDefaults, unit = true) => usdt(defaults.early, unit);

type Group = { key: "discount" | "early"; text: string; custom: boolean };

/** 每款两组的写法：单独设的在前、用正文，跟随默认的在后、用弱文字；表格、抽屉、确认框同一顺序（DT-14、DT-22）。 */
export function pricingGroups(pricing: BuyPricing, defaults: PricingDefaults, unit = true): Group[] {
  const discount: Group = pricing.discountRate === null
    ? { key: "discount", text: `折扣跟随默认 ${defaultDiscount(defaults, unit)}`, custom: false }
    : { key: "discount", text: `折扣 ${discountValue(pricing.discountRate, pricing.discountCapUSD ?? undefined, unit)}`, custom: true };
  const early: Group = pricing.earlyPurchaseDiscountUSD === null
    ? { key: "early", text: `立减跟随默认 ${defaultEarly(defaults, unit)}`, custom: false }
    : { key: "early", text: `立减 ${usdt(pricing.earlyPurchaseDiscountUSD, unit)}`, custom: true };
  return !discount.custom && early.custom ? [early, discount] : [discount, early];
}
export const pricingLine = (pricing: BuyPricing, defaults: PricingDefaults) => pricingGroups(pricing, defaults).map((group) => group.text).join(" · ");

/** 表格「优惠」格：一组一行，1200 宽列窄时组内在空格和逗号处换行，不横向滚动。 */
export function PricingCell({ pricing, defaults }: { pricing: BuyPricing; defaults: PricingDefaults }) {
  return (
    <span className="h2-price-cell">
      {pricingGroups(pricing, defaults, false).map((group) => <span key={group.key} data-follow={group.custom ? undefined : ""}>{group.text}</span>)}
    </span>
  );
}

/** 一行里的两组：每组整段不折开，放不下整组换到下一行、和上一行左对齐，行首不出现「·」。 */
export function PricingGroups({ pricing, defaults }: { pricing: BuyPricing; defaults: PricingDefaults }) {
  return (
    <span className="h2-price-groups"><span>
      {pricingGroups(pricing, defaults).map((group) => <span key={group.key} className="h2-price-group" data-follow={group.custom ? undefined : ""}>{group.text}</span>)}
    </span></span>
  );
}

/** 两组各自的前后值，确认框差异行用（OP-47）：跟随默认的前值带当时的默认值。 */
export function groupBefore(pricing: BuyPricing, key: Group["key"], defaults: PricingDefaults) {
  if (key === "discount") return pricing.discountRate === null ? `跟随默认 ${defaultDiscount(defaults)}` : discountValue(pricing.discountRate, pricing.discountCapUSD ?? undefined);
  return pricing.earlyPurchaseDiscountUSD === null ? `跟随默认 ${defaultEarly(defaults)}` : usdt(pricing.earlyPurchaseDiscountUSD, true);
}
export function groupAfter(pricing: BuyPricing, key: Group["key"], defaults: PricingDefaults) {
  const follows = key === "discount" ? pricing.discountRate === null : pricing.earlyPurchaseDiscountUSD === null;
  if (follows) return { value: "跟随默认", sub: `改后按默认：${key === "discount" ? defaultDiscount(defaults) : defaultEarly(defaults)}`, full: `跟随默认（${key === "discount" ? defaultDiscount(defaults) : defaultEarly(defaults)}）` };
  const value = groupBefore(pricing, key, defaults);
  return { value, full: value };
}
export const GROUP_NAME = { discount: "试用期折扣", early: "专享立减" } as const;


/** 单独设的组，移除时一起删除（D8）：「折扣 25%，最高 1,000 USDT 和立减 30 USDT」。 */
export function customText(pricing: BuyPricing) {
  return [
    pricing.discountRate !== null && `折扣 ${discountValue(pricing.discountRate, pricing.discountCapUSD ?? undefined)}`,
    pricing.earlyPurchaseDiscountUSD !== null && `立减 ${usdt(pricing.earlyPurchaseDiscountUSD, true)}`,
  ].filter(Boolean).join(" 和 ");
}

export const editFrom = (pricing: BuyPricing): PricingEdit => ({
  discount: pricing.discountRate === null ? "follow" : "custom", rate: raw(pricing.discountRate), cap: raw(pricing.discountCapUSD),
  early: pricing.earlyPurchaseDiscountUSD === null ? "follow" : "custom", amount: raw(pricing.earlyPurchaseDiscountUSD),
});
export const pricingOf = (edit: PricingEdit): BuyPricing => ({
  discountRate: edit.discount === "custom" ? edit.rate.trim() : null,
  discountCapUSD: edit.discount === "custom" ? edit.cap.trim() : null,
  earlyPurchaseDiscountUSD: edit.early === "custom" ? edit.amount.trim() : null,
});

/** 范围和 H2 默认参数一致（D5）：比例 0–100，上限 0–1,000,000 USDT，立减 0–100 USDT 最多两位小数。填错时错误顶替范围，所以写全（VS-103）。 */
export function editErrors(edit: PricingEdit): Partial<Record<PricingField, string>> {
  const errors: Partial<Record<PricingField, string>> = {};
  if (edit.discount === "custom") {
    const rate = edit.rate.trim(), cap = edit.cap.trim();
    if (!rate) errors.rate = "单独设置时不能留空，要填 0–100";
    else if (!validBuyPricingValue(rate, "discountRate")) errors.rate = "要填 0–100 的数";
    if (!cap) errors.cap = "单独设置时不能留空，要填 0–1,000,000";
    else if (!validBuyPricingValue(cap, "discountCapUSD")) errors.cap = "要填 0–1,000,000 的数";
  }
  if (edit.early === "custom") {
    const amount = edit.amount.trim();
    if (!amount) errors.amount = "单独设置时不能留空，要填 0–100";
    else if ((amount.split(".")[1] ?? "").length > 2) errors.amount = "最多两位小数，要填 0–100";
    else if (!validBuyPricingValue(amount, "earlyPurchaseDiscountUSD")) errors.amount = "要填 0–100，最多两位小数";
  }
  return errors;
}

export const TARGET_PRICE_NOTE = "领它试用的用户买它仍按默认；领别款的用户买它才用这里的设置";

/**
 * 一款设备的优惠编辑区（画板 ②a–c）。错误刚切到单独设置时不报，离开输入框后才报（OP-15）。
 */
export function PricingEditor({ device, edit, defaults, isTarget, focusOnOpen, shown, onChange, onBlur, onCollapse }: {
  device: BuyDevice;
  edit: PricingEdit;
  defaults: PricingDefaults;
  isTarget: boolean;
  /** 点「改优惠」打开时，焦点移到第一组的分段（按钮被换掉了，焦点不能落空）。勾选新设备时自动展开，焦点留在勾选框。 */
  focusOnOpen?: boolean;
  /** 哪些输入框已经离开过，只有这些显示错误。 */
  shown: (field: PricingField) => boolean;
  onChange: (next: PricingEdit) => void;
  onBlur: (field: PricingField) => void;
  onCollapse: () => void;
}) {
  const name = device.name || device.productNo;
  const errors = editErrors(edit);
  const error = (field: PricingField) => shown(field) ? errors[field] : undefined;
  const modes = [{ value: "follow" as const, label: "跟随默认" }, { value: "custom" as const, label: "单独设置" }];
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnOpen) box.current?.querySelector<HTMLElement>('[role="radio"][tabindex="0"]')?.focus();
  }, []); // Only when the editor first opens.
  return (
    <div ref={box} className="h2-price-editor" role="group" aria-label={`${name} 的优惠`}>
      <div className="h2-price-editor-head">
        <span>{name} 的优惠</span>
        <Button variant="ghost" size="sm" aria-label={`收起 ${name} 的优惠`} onClick={onCollapse}><ChevronUp size={14} aria-hidden />收起</Button>
      </div>
      {isTarget && <p className="h2-price-target"><Info size={14} strokeWidth={1.9} aria-hidden /><span>{TARGET_PRICE_NOTE}</span></p>}
      <div className="h2-price-group-edit">
        <Field label="试用期折扣" explain="App 票据同名：售价按比例减，有上限">
          <Segments label={`${name} 试用期折扣的设置方式`} value={edit.discount} items={modes} onChange={(discount) => onChange({ ...edit, discount })} />
        </Field>
        <p className="h2-price-default">{edit.discount === "follow" ? `现在 ${defaultDiscount(defaults)}，默认改了一起变` : `默认 ${defaultDiscount(defaults)}`}</p>
        {edit.discount === "custom" && (
          <div className="h2-price-fields">
            <Field label="比例" hint="0–100" error={error("rate")}>
              <NumberInput unit="%" min={0} max={100} value={edit.rate} onBlur={() => onBlur("rate")} onChange={(event) => onChange({ ...edit, rate: event.target.value })} />
            </Field>
            <Field label="最高" hint="0–1,000,000" error={error("cap")}>
              <NumberInput unit="USDT" min={0} max={1_000_000} value={edit.cap} onBlur={() => onBlur("cap")} onChange={(event) => onChange({ ...edit, cap: event.target.value })} />
            </Field>
          </div>
        )}
      </div>
      <div className="h2-price-group-edit">
        <Field label="专享立减" explain="App 票据同名：试用期内购买再减，应付最低为 0">
          <Segments label={`${name} 专享立减的设置方式`} value={edit.early} items={modes} onChange={(early) => onChange({ ...edit, early })} />
        </Field>
        <p className="h2-price-default">{edit.early === "follow" ? `现在 ${defaultEarly(defaults)}，默认改了一起变` : `默认 ${defaultEarly(defaults)}`}</p>
        {edit.early === "custom" && (
          <div className="h2-price-fields">
            <Field label="金额" hint="0–100，最多两位小数" error={error("amount")}>
              <NumberInput unit="USDT" min={0} max={100} step={0.01} value={edit.amount} onBlur={() => onBlur("amount")} onChange={(event) => onChange({ ...edit, amount: event.target.value })} />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

/** 「优惠（USDT）」表头的说明，气泡朝上开，不盖住优惠格（画板 ①b、F14）。 */
export function PricingHeadExplain() {
  return <Explain label="优惠的说明" side="top" align="start" rows={[
    { k: "试用期折扣", v: "App 票据同名，按比例减，有上限" },
    { k: "专享立减", v: "App 票据同名，试用期内购买再减" },
    { k: "怎么读", v: "标有「跟随默认」的随默认值变化" },
    { k: "默认在哪改", v: "默认试用期折扣在常改参数，默认专享立减在高级设置" },
  ]} />;
}
