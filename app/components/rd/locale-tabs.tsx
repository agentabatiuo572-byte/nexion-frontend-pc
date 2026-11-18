"use client";

/**
 * LocaleTabs 三语编辑（CP-64）。多行正文用语言页签，切换时其他语言的内容不动；缺内容的语言在页签上写「缺失」。
 * 不翻译，也不补内容。每个输入的标签要自己写上语言名（读屏）。
 *
 * <LocaleTabs label="正文语言" value={lang} onChange={setLang} items={[
 *   { value: "zh", label: "中文", missing: !zh.trim() },
 *   { value: "vi", label: "越南语", missing: !vi.trim() },
 *   { value: "en", label: "英语", missing: needEn && !en.trim() },
 * ]} />
 */
import type { ReactNode } from "react";
import { Segments } from "./tabs";

export function LocaleTabs<T extends string>({ label, value, items, onChange }: {
  label: string;
  value: T;
  items: readonly { value: T; label: ReactNode; missing?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <Segments label={label} value={value} onChange={onChange} items={items.map((item) => ({
      value: item.value,
      label: item.missing ? <>{item.label} · 缺失</> : item.label,
      tone: item.missing ? "warn" as const : undefined,
    }))} />
  );
}
