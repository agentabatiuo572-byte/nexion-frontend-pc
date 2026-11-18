import type { ReactNode } from "react";

/** 短句或指定词组优先整段换行；超过一行时仍可在段内折行。原文保持不变。 */
export function KeepText({ text, phrases, children }: { text: string; phrases?: readonly string[]; children?: (part: string) => ReactNode }) {
  if (phrases?.length === 0) return children ? children(text) : text;
  const pattern = phrases
    ? new RegExp(`(${phrases.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g")
    : /(?<=[，。；])/;
  return <>{text.split(pattern).map((part, index) => phrases && index % 2 === 0
    ? children ? children(part) : part
    : <span key={index} className="rd-keep">{children ? children(part) : part}</span>)}</>;
}
