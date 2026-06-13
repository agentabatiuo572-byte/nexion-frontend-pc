"use client";

/**
 * 360 HUB · 通知·偏好卡 — C1·deepening。
 * 覆盖:useNotifications 通知流 + markRead/clearAll / usePreferences.notifPrefs / soundEnabled / hapticsEnabled。
 * 处置(补发通知/清理/改偏好)= confirm→操作确认(改他人偏好属高敏)。CGM: A-001/003/004/005。
 */
import { useRef, useState, type MutableRefObject } from "react";
import Link from "next/link";
import { Bell, ArrowUpRight, Volume2, Vibrate } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserNotifications, type NotifKind } from "@/lib/mock/admin/user-360";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { confirm, toast } from "@/lib/store/ui";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

const KIND_LABEL: Record<NotifKind, string> = { earn: "收益", system: "系统", promo: "营销", risk: "风险", social: "社交" };
const KIND_TINT: Record<NotifKind, string> = { earn: "var(--v5-success)", system: "var(--v5-ink-3)", promo: "var(--admin-domain-h)", risk: "var(--v5-danger)", social: "var(--admin-domain-f)" };
const KINDS: NotifKind[] = ["earn", "system", "promo", "risk", "social"];

interface NotifDraft { kind: NotifKind; title: string; body: string; }

/** 补发通知表单 — 运营自填类别 / 标题 / 正文,draftRef 回写父级。 */
function NotifForm({ initial, draftRef }: { initial: NotifDraft; draftRef: MutableRefObject<NotifDraft> }) {
  const [kind, setKind] = useState<NotifKind>(initial.kind);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  draftRef.current = { kind, title, body };
  return (
    <div className="flex flex-col gap-3">
      <div>
        <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>类别</span>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {KINDS.map((k) => {
            const on = kind === k;
            return (
              <button key={k} type="button" onClick={() => setKind(k)}
                className="rounded-full px-2.5 py-0.5 text-[11px] transition-opacity hover:opacity-85"
                style={{
                  background: on ? "color-mix(in srgb, " + KIND_TINT[k] + " 22%, transparent)" : "var(--v5-surface-2)",
                  color: on ? KIND_TINT[k] : "var(--v5-ink-3)",
                  border: `1px solid ${on ? "color-mix(in srgb, " + KIND_TINT[k] + " 40%, transparent)" : "var(--v5-border)"}`,
                }}>
                {KIND_LABEL[k]}
              </button>
            );
          })}
        </div>
      </div>
      <label className="block">
        <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>标题</span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="一行,客户端显示在通知头"
          autoFocus
          className="mt-1 w-full rounded-[8px] px-3 py-2 text-[12.5px] outline-none"
          style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" }}
        />
      </label>
      <label className="block">
        <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>正文</span>
        <textarea
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="通知正文,客户端显示在通知体"
          className="mt-1 w-full resize-none rounded-[8px] px-3 py-2 text-[12.5px] outline-none"
          style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" }}
        />
      </label>
    </div>
  );
}

export function NotificationSection({ user }: { user: AdminUser }) {
  const n = getUserNotifications(user.id);
  const hydrated = useOpsHydrated();
  const storeAllRead = useUserOps((s) => s.users[user.id]?.notifsAllRead);
  const notifsAllRead = hydrated ? (storeAllRead ?? false) : false;
  const markNotifsRead = useUserOps((s) => s.markNotifsRead);
  const opsLog = useUserOps((s) => s.log);
  const unread = notifsAllRead ? 0 : n.unread;
  const notifDraftRef = useRef<NotifDraft>({ kind: "system", title: "", body: "" });

  async function doSend() {
    const initial: NotifDraft = { kind: "system", title: "", body: "" };
    notifDraftRef.current = initial;
    const yes = await confirm({
      title: "补发通知给该用户?",
      message: `推送给 ${user.nickname}。需对应角色执行确认,操作理由必填并全程留审计,全程留审计。`,
      content: <NotifForm initial={initial} draftRef={notifDraftRef} />,
      confirmLabel: "补发",
    });
    if (!yes) return;
    const { kind, title, body } = notifDraftRef.current;
    const t = title.trim();
    const b = body.trim();
    if (!t) { toast.error("标题必填", "客户端通知头需要文字"); return; }
    if (!b) { toast.error("正文必填", "客户端通知体需要文字"); return; }
    opsLog(user.id, "补发通知", `[${KIND_LABEL[kind]}] ${t} · ${b}`, "neutral");
    toast.success("通知已补发", `${user.id} · ${KIND_LABEL[kind]} · ${t}`);
  }
  async function doMarkRead() {
    const yes = await confirm({ title: "全部标记已读?", message: `清空 ${user.nickname} 的未读标记。`, confirmLabel: "标记已读" });
    if (yes) {
      markNotifsRead(user.id);
      toast.success("已全部标记已读", `${user.id} · ${user.nickname}`);
    }
  }
  return (
    <HubCard icon={<Bell size={15} style={{ color: "var(--admin-domain-i)" }} />} title="通知·偏好卡" tag="C1·deepening · A/I · 改偏好 操作确认">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="通知总数" value={`${n.items.length}`} accent="var(--admin-domain-i)" />
        <HubMetric label="未读" value={`${unread}`} accent={unread > 0 ? "var(--v5-warning)" : "var(--v5-ink-4)"} />
        <HubMetric label="声音" value={n.soundEnabled ? "开" : "关"} />
        <HubMetric label="震动" value={n.hapticsEnabled ? "开" : "关"} />
      </div>

      {/* 订阅偏好 */}
      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>订阅偏好</p>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((k) => {
          const on = n.prefs[k];
          return (
            <span key={k} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]"
              style={{ background: on ? "color-mix(in srgb, " + KIND_TINT[k] + " 14%, transparent)" : "var(--v5-surface-2)", color: on ? KIND_TINT[k] : "var(--v5-ink-4)" }}>
              {KIND_LABEL[k]} · {on ? "订阅" : "关闭"}
            </span>
          );
        })}
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}><Volume2 size={11} /> 声音 {n.soundEnabled ? "开" : "关"}</span>
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}><Vibrate size={11} /> 震动 {n.hapticsEnabled ? "开" : "关"}</span>
      </div>

      {/* 通知流 */}
      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>通知流</p>
      <ul className="flex flex-col gap-1">
        {n.items.slice(0, 6).map((it) => (
          <li key={it.id} className="flex items-start justify-between gap-2 rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--v5-surface-2)", opacity: it.read || notifsAllRead ? 0.66 : 1 }}>
            <div className="min-w-0">
              <p className="text-[11.5px]" style={{ color: "var(--v5-ink)" }}>
                <span className="mr-1.5 rounded-full px-1.5 py-0.5 text-[9.5px]" style={{ background: "color-mix(in srgb, " + KIND_TINT[it.kind] + " 14%, transparent)", color: KIND_TINT[it.kind] }}>{KIND_LABEL[it.kind]}</span>
                {it.title}
              </p>
              <p className="mt-0.5 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>{it.body}</p>
            </div>
            <span className="font-mono-tabular shrink-0 text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{it.tsLabel}{it.read || notifsAllRead ? "" : " · 未读"}</span>
          </li>
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={doSend}
          className="rounded-[8px] px-2.5 py-1.5 text-[11.5px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>补发通知</button>
        <button type="button" onClick={doMarkRead} disabled={unread === 0}
          className="rounded-[8px] px-2.5 py-1.5 text-[11.5px] transition-colors hover:bg-[var(--v5-surface-2)] disabled:opacity-40" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>全部已读</button>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <Link href="/content/notifications" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-i)" }}>I3 推送中心<ArrowUpRight size={11} /></Link>
        <AutoGloss>补发/清理/改订阅偏好在 I 域 · 改他人偏好 操作确认。</AutoGloss>
      </p>
    </HubCard>
  );
}
