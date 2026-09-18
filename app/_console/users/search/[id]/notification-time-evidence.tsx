"use client";

import { useEffect, useState } from "react";
import { Drawer } from "@/app/components/domain-views/design-kit";
import { fetchNotificationTimeEvidence, type NotificationTimeEvidence } from "@/lib/admin/user360-client";
import { displayAdminError } from "@/lib/admin/error-messages";

export function NotificationTimeEvidenceDrawer({ userKey, notificationId, onClose }: {
  userKey: string; notificationId: number; onClose: () => void;
}) {
  const [data, setData] = useState<NotificationTimeEvidence | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setData(null); setError("");
    fetchNotificationTimeEvidence(userKey, notificationId, controller.signal)
      .then(result => {
        if (!active) return;
        if (result.notificationId !== notificationId) throw new Error("通知证据编号不匹配，请重试");
        setData(result);
      })
      .catch(cause => { if (active) setError(displayAdminError(cause)); });
    return () => { active = false; controller.abort(); };
  }, [userKey, notificationId, attempt]);
  return <Drawer title={`通知时间证据 · ${notificationId}`} onClose={onClose}>
    <div style={{ padding: 16, display: "grid", gap: 14 }}>
      <p>只读核验，不修改通知时间或已读状态。</p>
      {!data && !error && <p role="status">正在读取关联证据…</p>}
      {error && <div role="alert"><p>{error}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>重试</button></div>}
      {data && <>
        <p role="status">{data.reason}</p>
        <dl>
          <dt>原记录时间（北京时间）</dt><dd>{data.storedCreatedAt}</dd>
          <dt>投递事实时间（北京时间）</dt><dd>{data.deliveryFactTime ?? "尚不可确认"}</dd>
        </dl>
        {data.facts.length > 0 && <ul>{data.facts.map(fact => <li key={fact.eventId}>
          <strong>{fact.eventName}</strong><br />事件编号：{fact.eventId}<br />
          UTC：{new Date(fact.timestampMillis).toISOString()}
        </li>)}</ul>}
        <p>证据一致仅表示关联可核对，不表示历史记录已修复。</p>
      </>}
    </div>
  </Drawer>;
}
