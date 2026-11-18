"use client";

/** CP-46 之二 / VS-109：同类对象一条一行，默认 5 条，其余点「查看全部」。
 * <RecordList label="提现历史" records={[{ id: "1", value: "1,000", unit: "USDT", at: "2026-11-06T09:00:00+08:00", object: "TRON", status: <StatusTag tone="done">已完成</StatusTag>, reference: "WD20261106001" }]} />
 * records 按业务需要的顺序传入；不负责筛选、排序、翻页。at 写成「2026-11-06 09:00」（TX-26），时区只写在第一条有时间的记录上（TX-25）。加载、失败由外层 BlockState 处理。
 */
import { useId, useState, useSyncExternalStore, type ReactNode } from "react";
import { Copy } from "lucide-react";
import { businessZone, formatBusinessTimeCompact, parseBusinessTime, subscribeBusinessZone } from "@/lib/admin/business-time";
import { Button, IconButton } from "./button";

export interface RecordListEntry {
  id: string;
  value: ReactNode;
  unit?: ReactNode;
  at?: string;
  object?: ReactNode;
  status?: ReactNode;
  reference?: string;
}

export function RecordList({ records, label = "记录" }: { records: readonly RecordListEntry[]; label?: string }) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<{ id: string; message: string } | null>(null);
  const zone = useSyncExternalStore(subscribeBusinessZone, businessZone, businessZone);
  if (!records.length) return <p className="rd-record-empty">暂无记录</p>;
  const zoned = records.find((record) => record.at && Number.isFinite(parseBusinessTime(record.at)));
  return (
    <div className="rd-record-list">
      <ul className="rd-records" id={listId} aria-label={label}>
        {(expanded ? records : records.slice(0, 5)).map((record) => (
          <li className="rd-record" key={record.id}>
            <div className="rd-record-main">
              <div className="rd-record-value">{record.value}{record.unit && <span className="rd-record-unit">{record.unit}</span>}</div>
              {record.status && <div className="rd-record-status">{record.status}</div>}
            </div>
            {(record.at || record.object) && <div className="rd-record-meta">
              {record.at && <time dateTime={record.at}>{formatBusinessTimeCompact(record.at)}{record === zoned && `（${zone.label}）`}</time>}
              {record.object && <span>{record.object}</span>}
            </div>}
            {record.reference && <div className="rd-record-reference">
              <span>{record.reference}</span>
              <IconButton aria-label={`复制单号 ${record.reference}`} onClick={() => {
                const failed = () => setCopied({ id: record.id, message: "复制失败，请手动选择单号" });
                if (!navigator.clipboard) { failed(); return; }
                void navigator.clipboard.writeText(record.reference!).then(() => setCopied({ id: record.id, message: "已复制单号" }), failed);
              }}><Copy size={14} aria-hidden /></IconButton>
            </div>}
            {copied?.id === record.id && <p className="rd-record-feedback" role="status">{copied.message}</p>}
          </li>
        ))}
      </ul>
      {records.length > 5 && <Button variant="ghost" size="sm" className="rd-record-more" aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(!expanded)}>{expanded ? "收起记录" : `查看全部（${records.length} 条）`}</Button>}
    </div>
  );
}
