"use client";

import { visibleReasonLength } from "@/lib/admin/a2-client";
import { useReasonRule } from "@/lib/admin/use-reason-rule";

export function useMOperationReason(enabled: boolean, text: string) {
  const rule = useReasonRule(enabled);
  const length = visibleReasonLength(text);
  // 客服中心这几个接口按去掉首尾空白后的长度（含中间的空格）最多 200 收，前端取更严的一边（OP-16）。
  const trimmed = text.trim().length;
  const tooLong = trimmed > 200 ? `理由连同中间的空格最多 200 个字符，现在 ${trimmed} 个` : undefined;
  const policyMessage = enabled && !rule.ready ? rule.error || "正在加载，稍候即可提交。" : undefined;
  const fieldError = rule.ready && !rule.ok(text) ? rule.hint(text) : tooLong;
  return {
    ok: rule.ok(text) && !tooLong,
    count: `${length}/${rule.max}`,
    hint: rule.ready ? `至少 ${rule.min} 字` : policyMessage,
    fieldError,
    blocked: policyMessage || fieldError,
  };
}
