"use client";

import { useEffect, useState } from "react";
import { formatBusinessTime } from "@/lib/admin/business-time";

const DELAY_MS = 120_000;
export function analyticsUpdateDelayed(asOf: string, now = Date.now()): boolean {
  return now - Date.parse(asOf) > DELAY_MS;
}

/** Only this small status changes when the displayed snapshot passes two minutes. */
export function AnalyticsFreshness({ asOf, label = "统计数据", onRefresh }: { asOf: string; label?: string; onRefresh: () => void }) {
  const [delayed, setDelayed] = useState(() => analyticsUpdateDelayed(asOf));
  useEffect(() => {
    const check = () => setDelayed(analyticsUpdateDelayed(asOf));
    check();
    const remaining = Date.parse(asOf) + DELAY_MS + 1 - Date.now();
    const timer = remaining > 0 ? window.setTimeout(check, remaining) : undefined;
    document.addEventListener("visibilitychange", check);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", check); };
  }, [asOf]);
  return <div className={`sa-freshness${delayed ? " sa-freshness-delayed" : ""}`} role="status">
    <span>{label}截至 <time dateTime={asOf}>{formatBusinessTime(asOf, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }, "未知")}</time>。</span>
    <span>{delayed ? "统计更新延迟，当前显示的数据已超过 2 分钟。" : "统计约每分钟更新，另需计算时间。"}刷新读取最新完成版本。</span>
    {delayed && <button type="button" onClick={onRefresh}>读取最新统计</button>}
  </div>;
}
