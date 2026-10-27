"use client";

/**
 * M-24 / M-20 / D-10: advisor alerts — a short tone, a browser notification and the unread count in the
 * tab title. Each viewer can switch them off; the preference stays in this browser only.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";

export type SupportAlertPrefs = { sound: boolean; desktop: boolean };
const PREFS_KEY = "nexion-admin-m-alert-prefs-v1";
const DEFAULT_PREFS: SupportAlertPrefs = { sound: true, desktop: true };

let prefs: SupportAlertPrefs = DEFAULT_PREFS;
let prefsLoaded = false;
let unreadTotal = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

function loadPrefs(): SupportAlertPrefs {
  if (prefsLoaded || typeof window === "undefined") return prefs;
  prefsLoaded = true;
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<SupportAlertPrefs> | null;
    if (raw) prefs = { sound: raw.sound !== false, desktop: raw.desktop !== false };
  } catch { /* storage unavailable: keep defaults */ }
  return prefs;
}

export function setSupportAlertPrefs(next: SupportAlertPrefs) {
  prefs = next;
  try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* per-viewer convenience only */ }
  if (next.desktop && typeof Notification !== "undefined" && Notification.permission === "default") void Notification.requestPermission().then(emit);
  emit();
}

const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useSupportAlertPrefs(): SupportAlertPrefs {
  return useSyncExternalStore(subscribe, loadPrefs, () => DEFAULT_PREFS);
}
/** Unread messages across the viewer's own conversations; 0 when the service pages have not loaded them. */
export function useSupportUnreadTotal(): number {
  return useSyncExternalStore(subscribe, () => unreadTotal, () => 0);
}
export function desktopPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

let audio: AudioContext | null = null;
function tone() {
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator(), gain = audio.createGain();
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, audio.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(); osc.stop(audio.currentTime + 0.4);
  } catch { /* audio blocked until the first user gesture */ }
}

export function supportAlert(title: string, body: string, tag: string, href = "/service/sessions") {
  const current = loadPrefs();
  if (current.sound) tone();
  if (!current.desktop || desktopPermission() !== "granted" || document.visibilityState === "visible" && document.hasFocus()) return;
  try {
    const notice = new Notification(title, { body, tag });
    notice.onclick = () => { window.focus(); if (!window.location.pathname.startsWith(href)) window.location.href = href; notice.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}

export type AlertConversation = { id: string; customerId?: string; customer?: string; ownerAdminId?: number | null; ownerUnbound?: boolean; unread: number; archived?: boolean; pendingReplyCount?: number | null; pendingReplySince?: number | null };

/**
 * Watches the inbox snapshot and alerts on: more unread in my conversations, a customer newly assigned
 * to me, and (for supervisors) an unassigned inquiry waiting past the alert threshold. The first
 * snapshot only sets the baseline, so opening the page never replays old alerts.
 */
export function useSupportInboxAlerts(conversations: AlertConversation[] | null, adminId: number, supervisor: boolean, alertMinutes: number) {
  const baseline = useRef<{ adminId: number; unread: Map<string, number>; mine: Set<string>; overdue: Set<string> } | null>(null);
  useEffect(() => {
    if (!conversations || !adminId) return;
    const mineRows = conversations.filter((row) => row.ownerAdminId === adminId && !row.archived);
    const unread = new Map(mineRows.map((row) => [row.id, row.unread]));
    // Archived conversations still count as my customers, so un-archiving never looks like a new assignment.
    const mine = new Set(conversations.filter((row) => row.ownerAdminId === adminId).map((row) => row.customerId ?? row.id));
    const now = Date.now();
    const overdue = new Set(supervisor ? conversations.filter((row) => row.ownerUnbound && (row.pendingReplyCount ?? 0) > 0 && row.pendingReplySince && now - row.pendingReplySince >= alertMinutes * 60000).map((row) => row.customerId ?? row.id) : []);
    unreadTotal = mineRows.reduce((sum, row) => sum + row.unread, 0);
    emit();
    const previous = baseline.current;
    baseline.current = { adminId, unread, mine, overdue };
    if (!previous || previous.adminId !== adminId) return;
    const name = (row: AlertConversation) => row.customer || `客户 ${row.customerId ?? ""}`;
    const assigned = mineRows.filter((row) => !previous.mine.has(row.customerId ?? row.id));
    if (assigned.length) supportAlert("新分配的专属客户", assigned.map(name).join("、"), `assigned-${assigned[0].id}`);
    const grown = mineRows.find((row) => !assigned.includes(row) && row.unread > (previous.unread.get(row.id) ?? 0));
    if (grown) { supportAlert(`${name(grown)} 发来新消息`, "打开专属会话回复", `message-${grown.id}`); return; }
    const late = [...overdue].filter((id) => !previous.overdue.has(id));
    if (late.length) supportAlert("有客户等待分配超时", `${late.length} 位客户等待超过 ${alertMinutes} 分钟仍未分配专属客服`, "unassigned-overdue");
  }, [conversations, adminId, supervisor, alertMinutes]);
  // Keep the unread count in the tab title while the service pages are open.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    const apply = () => { document.title = unreadTotal > 0 ? `(${unreadTotal}) ${base}` : base; };
    apply();
    const off = subscribe(apply);
    return () => { off(); document.title = base; unreadTotal = 0; emit(); };
  }, []);
}
