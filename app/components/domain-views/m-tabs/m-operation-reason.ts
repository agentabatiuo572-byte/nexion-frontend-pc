"use client";

import { visibleReasonLength } from "@/lib/admin/a2-client";
import { useReasonRule } from "@/lib/admin/use-reason-rule";

export function useMOperationReason(enabled: boolean, text: string) {
  const rule = useReasonRule(enabled);
  const length = visibleReasonLength(text);
  const policyMessage = enabled && !rule.ready ? rule.error || "正在加载，稍候即可提交。" : undefined;
  const fieldError = rule.ready && !rule.ok(text) ? rule.hint(text) : undefined;
  return {
    ok: rule.ok(text),
    count: `${length}/${rule.max}`,
    hint: rule.ready ? `至少 ${rule.min} 字` : policyMessage,
    fieldError,
    blocked: policyMessage || fieldError,
  };
}
