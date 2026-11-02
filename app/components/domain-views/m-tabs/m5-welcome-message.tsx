"use client";

import { useEffect, useState } from "react";
import { supportClient, supportWelcomeMessageClient, isIndeterminateSupportError, type SupportWelcomeLanguage, type SupportWelcomeMessage, type SupportWelcomeTexts } from "../../../../lib/admin/m-support-client";
import { formatBusinessTime } from "../../../../lib/admin/business-time";
import { Modal } from "../design-kit";
import { createPendingMutationStore, PENDING_MUTATION_TTL_MS } from "../../../../lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import type { MSupportPermission } from "./m5-service-rules";

type WelcomePayload = Parameters<typeof supportWelcomeMessageClient.update>[0];
type WelcomePendingRecord = { fingerprint: string; commandKey: string; createdAt: number; expiresAt: number; actorId: number; payload: WelcomePayload };
const welcomeCommands = createPendingMutationStore<WelcomePendingRecord>({ storageKey: "nexion-admin-m-support-welcome-v1", isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Number.isSafeInteger(row.payload.expectedVersion) && row.payload.texts) });
const LANGUAGES: Array<{ key: SupportWelcomeLanguage; label: string }> = [{ key: "zh", label: "中文" }, { key: "en", label: "English" }, { key: "vi", label: "Tiếng Việt" }];
const MAX = 500;
const EXPIRED = "上次保存已超过 24 小时，不能再按原操作重试。请查询上次结果，或加载最新内容核对后重新提交。";
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };
const fingerprintOf = (payload: WelcomePayload) => `support-welcome:${payload.expectedVersion}`;

function textProblem(text: string): string {
  const length = text.trim().length;
  if (length === 0) return "不能为空";
  if (length > MAX) return `超出 ${length - MAX} 字，最多 ${MAX} 字`;
  return "";
}

function changedLanguages(before: SupportWelcomeTexts, after: SupportWelcomeTexts): SupportWelcomeLanguage[] {
  return LANGUAGES.map(({ key }) => key).filter((key) => before[key] !== after[key].trim());
}

function errorText(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号无权修改欢迎语。";
  if (status === 400 || status === 422) return "内容未通过校验，请检查三种语言的文字和修改理由后再提交。";
  return "欢迎语暂不可用，请重试；当前输入已保留。";
}

/** B16: the one welcome copy a new user receives from their dedicated advisor (or in the unassigned state) right after registration. */
export function M5WelcomeMessage({ permission }: { permission: MSupportPermission }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const [current, setCurrent] = useState<SupportWelcomeMessage | null>(null);
  const [draft, setDraft] = useState<SupportWelcomeTexts | null>(null);
  const [latest, setLatest] = useState<SupportWelcomeMessage | null>(null);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  // expiresAt = the original record's 24h limit: after it the key may no longer be replayed, only looked up.
  const [retry, setRetry] = useState<{ key: string; payload: WelcomePayload; expiresAt: number } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    supportWelcomeMessageClient.read(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const pending = permission === "superadmin" ? welcomeCommands.list().find((row) => row.actorId === adminId) : undefined;
      setCurrent(value); setDraft(pending ? pending.payload.texts : value.texts); setError(""); setLatest(null); setReadUnavailable(false); setConflict(false);
      setRetry(pending ? { key: pending.commandKey, payload: pending.payload, expiresAt: pending.expiresAt } : null);
      setReason(pending?.payload.reason ?? "");
    }).catch(() => { if (!controller.signal.aborted) { setReadUnavailable(true); setError("新用户欢迎语暂时加载不了，请重试。"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [permission, reload, adminId]);

  const problems = draft ? LANGUAGES.map(({ key }) => textProblem(draft[key])) : [];
  const valid = Boolean(draft) && problems.every((problem) => !problem);
  const changed = current && draft ? changedLanguages(current.texts, draft) : [];
  const editable = permission === "superadmin" && Boolean(current) && !loading && !readUnavailable && !saving && !conflict && !retry;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canConfirm = editable && valid && changed.length > 0 && reasonOk;

  async function save() {
    if (permission !== "superadmin" || (!canConfirm && !retry) || !current || !draft || saving || !adminId) return;
    if (retry && Date.now() >= retry.expiresAt) { setError(EXPIRED); return; }
    const actor = actorStamp();
    const command = retry ?? {
      expiresAt: Date.now() + PENDING_MUTATION_TTL_MS,
      key: crypto.randomUUID(),
      payload: { expectedVersion: current.version, texts: { zh: draft.zh.trim(), en: draft.en.trim(), vi: draft.vi.trim() }, reason: reason.trim() },
    };
    const fingerprint = fingerprintOf(command.payload);
    if (!retry) welcomeCommands.remember(fingerprint, command.key, { actorId: adminId, payload: command.payload });
    setSaving(true); setError(""); setSaved(false);
    try {
      const value = await supportWelcomeMessageClient.update(command.payload, command.key);
      if (actor !== actorStamp()) return;
      welcomeCommands.forget(fingerprint);
      setCurrent(value); setDraft(value.texts); setReason(""); setConfirm(false); setRetry(null); setLatest(null); setSaved(true);
    } catch (cause) {
      if (actor !== actorStamp()) return;
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      // A version conflict and an unconfirmed result each have their own notice; only rejected input uses the banner.
      setError([400, 401, 403, 422].includes(status) ? errorText(cause) : "");
      if (status === 409 && !isIndeterminateSupportError(cause)) {
        welcomeCommands.forget(fingerprint);
        setRetry(null); setConflict(true); setConfirm(false);
        try { const value = await supportWelcomeMessageClient.read(); if (actor === actorStamp()) setLatest(value); } catch { /* Keep the draft; the conflict notice offers an explicit reload. */ }
      } else if (![400, 401, 403, 422].includes(status)) {
        setRetry(command);
      } else { welcomeCommands.forget(fingerprint); setRetry(null); }
    } finally { setSaving(false); }
  }

  // Keep the languages this operator edited; take every other language from the latest saved version.
  function reviewLatest() {
    if (!latest || !current || !draft) return;
    const edited = changedLanguages(current.texts, draft);
    const next = { ...latest.texts };
    for (const key of edited) next[key] = draft[key];
    setCurrent(latest); setDraft(next); setLatest(null); setConflict(false); setConfirm(false); setReason(""); setError("");
  }

  async function refreshLatest() {
    const actor = actorStamp();
    try { const value = await supportWelcomeMessageClient.read(); if (actor === actorStamp()) setLatest(value); } catch (cause) { if (actor === actorStamp()) setError(errorText(cause)); }
  }

  async function checkPending() {
    if (!retry || saving) return;
    const actor = actorStamp();
    setSaving(true);
    try {
      const result = await supportClient.command(retry.key);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED") {
        const value = await supportWelcomeMessageClient.read();
        if (actor !== actorStamp()) return;
        welcomeCommands.forget(fingerprintOf(retry.payload));
        setCurrent(value); setDraft(value.texts); setRetry(null); setReason(""); setConfirm(false); setError(""); setSaved(true);
      } else if (result.status === "FAILED") {
        welcomeCommands.forget(fingerprintOf(retry.payload));
        setRetry(null); setError("上次保存没有成功，输入已保留；请检查后重新提交。");
      } else setError(Date.now() >= retry.expiresAt ? "查不到上次保存的结果。请加载最新内容核对后重新提交。" : "上次保存仍在处理中，请稍后再查，或按原操作重试。");
    } catch { if (actor === actorStamp()) setError("暂时查不到上次保存的结果，输入已保留。"); }
    finally { setSaving(false); }
  }

  // The original operation can no longer be replayed: drop it, load the latest saved copy and keep the operator's texts as the draft.
  async function reloadAfterExpiry() {
    if (!retry || saving) return;
    const actor = actorStamp();
    setSaving(true);
    try {
      const value = await supportWelcomeMessageClient.read();
      if (actor !== actorStamp()) return;
      welcomeCommands.forget(fingerprintOf(retry.payload), retry.key);
      setCurrent(value); setDraft(retry.payload.texts); setRetry(null); setReason(""); setConfirm(false); setError("");
    } catch (cause) { if (actor === actorStamp()) setError(errorText(cause)); }
    finally { setSaving(false); }
  }

  const retryExpired = retry !== null && Date.now() >= retry.expiresAt;
  return (
    <div className="m-admin-panel m5-welcome-message" aria-label="新用户欢迎语">
      <h2>新用户欢迎语</h2>
      <div className="m-admin-muted">新用户注册后会在客服对话里收到这条消息：有专属客服的由专属客服发出，还没有专属客服的以「待分配客服」显示。修改只对之后注册的用户生效。</div>
      {permission !== "superadmin" && <div className="m-admin-muted">仅超级管理员可修改；当前为只读视图。</div>}
      {loading && <div className="m-admin-muted" role="status">正在加载欢迎语…</div>}
      {error && <div className="m-admin-error" role="alert">{error} {readUnavailable && <button type="button" className="btn btn-sec btn-sm" onClick={() => setReload((n) => n + 1)}>重试</button>}</div>}
      {draft && current && <>
        {LANGUAGES.map(({ key, label }, index) => {
          const problem = problems[index], length = draft[key].trim().length;
          return <label className="field m5-welcome-field" key={key}>
            <span>{label}</span>
            <textarea value={draft[key]} disabled={!editable} aria-invalid={Boolean(problem)} aria-describedby={`m5-welcome-${key}-count`} onChange={(event) => { const value = event.target.value; setDraft((old) => old ? { ...old, [key]: value } : old); setSaved(false); }} />
            <span id={`m5-welcome-${key}-count`} className={`m5-welcome-count${problem ? " invalid" : ""}`}>{problem ? `${problem} · ` : ""}{length}/{MAX}</span>
          </label>;
        })}
        {conflict && <div className="m-admin-error" role="alert">欢迎语已被其他管理员修改。{latest ? `最新版本为 ${latest.version}，你编辑时为版本 ${current.version}。` : "还没取到最新内容。"}你的输入已保留。{latest && <ul>{changedLanguages(current.texts, latest.texts).map((key) => <li key={key}>{LANGUAGES.find((item) => item.key === key)?.label}：已被改为「{latest.texts[key]}」</li>)}</ul>}{latest ? <button type="button" className="btn btn-sec btn-sm" onClick={reviewLatest}>按最新内容重新核对</button> : <button type="button" className="btn btn-sec btn-sm" onClick={() => void refreshLatest()}>加载最新内容</button>}</div>}
        <div className="m-admin-toolbar">
          <span className="m-admin-muted">当前版本 {current.version} · {current.updatedAt ? `最近修改 ${formatBusinessTime(current.updatedAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}${current.updatedBy ? ` · ${current.updatedBy}` : ""}` : "尚未修改过"}{current.reason ? ` · 理由：${current.reason}` : ""}{saved ? " · 已保存" : ""}</span>
          {permission === "superadmin" && <button type="button" className="btn btn-pri btn-sm" disabled={retry ? false : !editable || !valid || changed.length === 0} onClick={() => setConfirm(true)}>{retry ? "继续确认上次提交" : "预览并保存"}</button>}
        </div>
      </>}
      {confirm && current && draft && permission === "superadmin" && <Modal title="确认保存新用户欢迎语" icon="gauge" onClose={() => { if (!saving) setConfirm(false); }} busy={saving} wide footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => setConfirm(false)}>返回</button><button type="button" className="btn btn-pri btn-sm" disabled={(!canConfirm && !retry) || retryExpired || saving} onClick={() => void save()}>{saving ? "保存中…" : retry ? "按原操作重试" : "确认保存"}</button></>}>
        <div className="m-admin-muted">保存后，之后注册的新用户会收到新内容；已经发出的欢迎语不变。</div>
        <div className="m-admin-list m5-welcome-diff">{(retry ? changedLanguages(current.texts, retry.payload.texts) : changed).map((key) => <div key={key}><strong>{LANGUAGES.find((item) => item.key === key)?.label}</strong><p>原：{current.texts[key]}</p><p>新：{(retry ? retry.payload.texts : draft)[key].trim()}</p></div>)}</div>
        <label className="field"><span>修改理由（8–200 字）</span><textarea value={reason} maxLength={200} disabled={saving || Boolean(retry)} onChange={(event) => setReason(event.target.value)} /></label>
        <div className="m-admin-muted">已输入 {reason.trim().length}/200 字</div>
        {retry && (retryExpired
          ? <div className="m-admin-error">{EXPIRED}<button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => void checkPending()}>查询上次结果</button> <button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => void reloadAfterExpiry()}>加载最新内容</button></div>
          : <div className="m-admin-error">上次保存结果尚未确认。请先查询结果，或按原操作重试。<button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => void checkPending()}>查询上次结果</button></div>)}
        {error && <div className="m-admin-error" role="alert">{error}</div>}
      </Modal>}
    </div>
  );
}
