"use client";

import { useEffect, useState } from "react";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { Explain } from "@/app/components/rd";

const DELAY_MS = 120_000;
export function analyticsUpdateDelayed(asOf: string, now = Date.now()): boolean {
  return now - Date.parse(asOf) > DELAY_MS;
}

/** Only this small status changes when the displayed snapshot passes two minutes. It sits inside a data line
 *  (panel sub or a section head), so it renders inline; the normal update cadence goes into the question mark. */
export function AnalyticsFreshness({ asOf, label = "统计数据", explain = true, onRefresh }: { asOf: string; label?: string; explain?: boolean; onRefresh: () => void }) {
  const [delayed, setDelayed] = useState(() => analyticsUpdateDelayed(asOf));
  useEffect(() => {
    const check = () => setDelayed(analyticsUpdateDelayed(asOf));
    check();
    const remaining = Date.parse(asOf) + DELAY_MS + 1 - Date.now();
    const timer = remaining > 0 ? window.setTimeout(check, remaining) : undefined;
    document.addEventListener("visibilitychange", check);
    return () => { window.clearTimeout(timer); document.removeEventListener("visibilitychange", check); };
  }, [asOf]);
  return <span className={`sa-freshness${delayed ? " sa-freshness-delayed" : ""}`} role="status">
    <span>{label}截至 <time dateTime={asOf}>{formatBusinessTimeCompact(asOf, "未知")}</time>（{businessZone().label}）</span>
    {delayed && <span>统计更新延迟，当前显示的数据已超过 2 分钟。</span>}
    {delayed && <button type="button" className="rd-link" onClick={onRefresh}>读取最新统计</button>}
    {explain && !delayed && <Explain label={`${label || "统计"}更新说明`} content="统计约每分钟更新，另需计算时间。刷新读取最新完成版本。" />}
  </span>;
}
