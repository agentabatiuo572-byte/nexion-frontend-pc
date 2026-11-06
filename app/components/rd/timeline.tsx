"use client";

/** CP-46 / VS-109：只读时间线，最新在上；审计主体统一在渲染边界打码。
 * <Timeline entries={[{ id: "1", action: "提交提现", actor: "admin:42", at: "2026-11-06T09:00:00+08:00" }]} />
 * at 传原始时间，组件按业务时区写成「2026-11-06 09:00:00」（TX-26），时区只写在第一条有时间的记录上（TX-25）。加载、失败由外层 BlockState 处理。
 */
import { useSyncExternalStore, type ReactNode } from "react";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { businessZone, formatBusinessTimeFull, parseBusinessTime, subscribeBusinessZone } from "@/lib/admin/business-time";

export interface TimelineEntry {
  id: string;
  action: ReactNode;
  actor: string;
  at: string;
  detail?: ReactNode;
  role?: ReactNode;
  ip?: string;
  /** 默认灰；只给失败、待确认上色。事件文字须说明状态。 */
  tone?: "danger" | "warn";
}

export function Timeline({ entries, label = "操作记录" }: { entries: readonly TimelineEntry[]; label?: string }) {
  const zone = useSyncExternalStore(subscribeBusinessZone, businessZone, businessZone);
  if (!entries.length) return <p className="rd-record-empty">暂无操作记录</p>;
  const sorted = [...entries].sort((a, b) => parseBusinessTime(b.at) - parseBusinessTime(a.at));
  const zoned = sorted.find((entry) => Number.isFinite(parseBusinessTime(entry.at)));
  return (
    <ol className="rd-timeline" aria-label={label}>
      {sorted.map((entry) => (
        <li className="rd-timeline-item" key={entry.id} data-tone={entry.tone}>
          <span className="rd-timeline-dot" aria-hidden />
          <div className="rd-timeline-content">
            <div className="rd-timeline-event">{entry.action}</div>
            {entry.detail && <div className="rd-timeline-detail">{entry.detail}</div>}
            <div className="rd-record-meta">
              <time dateTime={entry.at}>{formatBusinessTimeFull(entry.at)}{entry === zoned && `（${zone.label}）`}</time>
              <span>{maskAuditActor(entry.actor)}</span>
              {entry.role && <span>{entry.role}</span>}
              {entry.ip && <span>{entry.ip}</span>}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}
