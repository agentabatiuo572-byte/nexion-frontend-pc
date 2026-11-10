"use client";
import type { ReactNode } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { formatE6Amount } from "@/lib/admin/e6-decimal";

/** Page-owned original-value reveal; commands and confirmation facts keep their raw strings. */
export function E6OriginalValues({ original, children, group = false }: { original: ReactNode; children: ReactNode; group?: boolean }) {
  const Trigger = group ? "div" : "span";
  return <Tooltip.Provider delayDuration={100}><Tooltip.Root>
    <Tooltip.Trigger asChild><Trigger tabIndex={0} className={group ? "e6-original-group" : "e6-original"}>{children}</Trigger></Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="rd-tip" side="bottom" sideOffset={6} collisionPadding={12}>后端原值：{original}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}
export function E6Amount({ raw, precision, currency }: { raw: string; precision: number; currency: string }) {
  return <E6OriginalValues original={`${raw} ${currency}`}><span data-zero={Number(raw) === 0 ? "" : undefined}>{formatE6Amount(raw, precision)}</span></E6OriginalValues>;
}
