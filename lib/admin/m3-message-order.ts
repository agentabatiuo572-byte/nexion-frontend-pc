import type { SessionMsg } from "@/app/components/domain-views/m-tabs/data";

/** Preserve database sub-millisecond ordering before using the stable message-id tie break. */
export function compareM3Messages(a: SessionMsg, b: SessionMsg): number {
  const fraction = (message: SessionMsg) => (message.sourceCreatedAt?.match(/\.(\d+)/)?.[1] ?? "").padEnd(9, "0").slice(3, 9);
  return a.ts - b.ts || fraction(a).localeCompare(fraction(b)) || a.id! - b.id!;
}
