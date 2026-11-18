"use client";

import { useEffect, useState } from "react";
import { fetchA2ReasonPolicy, visibleReasonLength } from "@/lib/admin/a2-client";

/** 自定义表单的理由规则（OP-20～22）：和共用确认框同一份后台政策、同一种数法。下限取较大者，上限取较小者。 */
export function useReasonRule(enabled = true, minimum = 8, maximum = 200) {
  const [policy, setPolicy] = useState<{ min: number; max: number } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setPolicy(null); setError("");
    void fetchA2ReasonPolicy().then(next => { if (active) setPolicy({ min: Math.max(minimum, next.minChars), max: Math.min(maximum, next.maxChars) }); })
      .catch(() => { if (active) setError("理由规则加载失败，暂时无法提交。请关闭弹窗后重试。"); });
    return () => { active = false; };
  }, [enabled, minimum, maximum]);
  const min = policy?.min ?? minimum, max = policy?.max ?? maximum;
  const ok = (reason: string) => { const length = visibleReasonLength(reason); return policy !== null && length >= min && length <= max; };
  const hint = (reason: string) => {
    const length = visibleReasonLength(reason);
    return error || (length < min ? `理由还差 ${min - length} 字` : length > max ? `理由多了 ${length - max} 字` : "");
  };
  return { ready: policy !== null, error, min, max, ok, hint };
}
