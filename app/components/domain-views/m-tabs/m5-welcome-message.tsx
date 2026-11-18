"use client";

import { useEffect, useState } from "react";
import { supportWelcomeMessageClient, isIndeterminateSupportError, type SupportWelcomeLanguage, type SupportWelcomeMessage, type SupportWelcomeTexts } from "../../../../lib/admin/m-support-client";
import { formatBusinessTime } from "../../../../lib/admin/business-time";
import { Modal } from "../design-kit";
import { createPendingMutationStore, PENDING_MUTATION_TTL_MS } from "../../../../lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import { blankCopiedContentLanguage, fillBlankContentLanguage } from "@/lib/admin/content-language-rules";
import { getRequiredContentLanguages, OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import type { MSupportPermission } from "./m5-service-rules";

type WelcomePayload = Parameters<typeof supportWelcomeMessageClient.update>[0];
type WelcomeAttempt = { fingerprint: string; commandKey: string; expiresAt: number; payload: WelcomePayload; editedTexts?: Partial<SupportWelcomeTexts> };
type WelcomePendingRecord = WelcomeAttempt & { createdAt: number; actorId: number };
const LANGUAGES: Array<{ key: SupportWelcomeLanguage; label: string }> = [{ key: "zh", label: "中文" }, { key: "en", label: "English" }, { key: "vi", label: "Tiếng Việt" }];
const welcomeCommands = createPendingMutationStore<WelcomePendingRecord>({
  storageKey: "nexion-admin-m-support-welcome-v1", retainExpiredRecords: true,
  isValidRecord: (row) => Boolean(Number.isSafeInteger(row.actorId) && row.payload && Number.isSafeInteger(row.payload.expectedVersion) && row.payload.texts
    && (row.editedTexts === undefined || (row.editedTexts && typeof row.editedTexts === "object" && !Array.isArray(row.editedTexts)
      && Object.entries(row.editedTexts).every(([key, text]) => typeof text === "string" && LANGUAGES.some((language) => language.key === key))))),
});
const MAX = 500;
const EXPIRED = "上次保存已超过 24 小时，不能再按原操作重试。请查询上次结果，或加载最新内容核对后重新提交。";
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };
// Same count as the backend: Unicode code points after trim. UTF-16 length counts 𠮷 twice.
const codePointLength = (value: string) => Array.from(value.trim()).length;

function textProblem(text: string, required: boolean): string {
  const length = codePointLength(text);
  if (required && length === 0) return "不能为空";
  if (length > MAX) return `超出 ${length - MAX} 字，最多 ${MAX} 字`;
  return "";
}

function changedLanguages(before: SupportWelcomeTexts, after: SupportWelcomeTexts): SupportWelcomeLanguage[] {
  return LANGUAGES.map(({ key }) => key).filter((key) => before[key].trim() !== after[key].trim());
}

function welcomeDraft(texts: SupportWelcomeTexts, required: readonly OperatingLanguageCode[], editedTexts?: Partial<SupportWelcomeTexts>): SupportWelcomeTexts {
  const en = { text: texts.en };
  return {
    en: texts.en,
    zh: blankCopiedContentLanguage(required, "zh", en, { text: texts.zh }).text,
    vi: blankCopiedContentLanguage(required, "vi", en, { text: texts.vi }).text,
    ...editedTexts,
  };
}

function errorText(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "登录已失效，请重新登录。";
  if (status === 403) return "当前账号无权修改欢迎语。";
  if (status === 400 || status === 422) return "内容未通过校验：请检查英文和必填语言是否已填、每种语言不超过 500 字，以及修改理由，再提交。";
  return "欢迎语暂不可用，请重试；当前输入已保留。";
}

/** B16: the one welcome copy a new user receives from their dedicated advisor (or in the unassigned state) right after registration. */
export function M5WelcomeMessage({ permission }: { permission: MSupportPermission }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const [current, setCurrent] = useState<SupportWelcomeMessage | null>(null);
  const [draft, setDraft] = useState<SupportWelcomeTexts | null>(null);
  const [requiredLanguages, setRequiredLanguages] = useState<readonly OperatingLanguageCode[]>(OPERATING_LANGUAGE_CODES);
  const [latest, setLatest] = useState<SupportWelcomeMessage | null>(null);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [conflict, setConflict] = useState<WelcomeAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  // expiresAt = the original record's 24h limit: after it the key may no longer be replayed, only looked up.
  const [retry, setRetry] = useState<WelcomeAttempt | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    Promise.all([supportWelcomeMessageClient.read(controller.signal), getRequiredContentLanguages()]).then(([value, required]) => {
      if (controller.signal.aborted) return;
      const pending = permission === "superadmin" ? welcomeCommands.list().find((row) => row.actorId === adminId) : undefined;
      setRequiredLanguages(required);
      const source = pending && !pending.editedTexts ? pending.payload.texts : value.texts;
      setCurrent(value); setDraft(welcomeDraft(source, required, pending?.editedTexts)); setError(""); setLatest(null); setReadUnavailable(false); setConflict(null);
      setRetry(pending ?? null);
      setReason(pending?.payload.reason ?? "");
    }).catch(() => { if (!controller.signal.aborted) { setReadUnavailable(true); setError("新用户欢迎语暂时加载不了，请重试。"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [permission, reload, adminId]);

  const problems = draft ? LANGUAGES.map(({ key }) => textProblem(draft[key], requiredLanguages.includes(key))) : [];
  const textsForSave = retry?.payload.texts ?? (draft && (() => {
    const en = { text: draft.en.trim() };
    const zh = fillBlankContentLanguage(requiredLanguages, "zh", en, { text: draft.zh.trim() });
    const vi = fillBlankContentLanguage(requiredLanguages, "vi", en, { text: draft.vi.trim() });
    return { en: en.text, zh: zh.text, vi: vi.text };
  })());
  const valid = Boolean(draft) && problems.every((problem) => !problem);
  const changed = current && textsForSave ? changedLanguages(current.texts, textsForSave) : [];
  const editable = permission === "superadmin" && Boolean(current) && !loading && !readUnavailable && !saving && !conflict && !retry;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canConfirm = editable && valid && changed.length > 0 && reasonOk;

  async function save() {
    if (permission !== "superadmin" || (!canConfirm && !retry) || !current || !draft || !textsForSave || saving || !adminId) return;
    if (retry && Date.now() >= retry.expiresAt) { setError(EXPIRED); return; }
    const actor = actorStamp();
    let command = retry;
    if (!command) {
      const payload = { expectedVersion: current.version, texts: textsForSave, reason: reason.trim() };
      const editedTexts: Partial<SupportWelcomeTexts> = {};
      for (const key of changedLanguages(welcomeDraft(current.texts, requiredLanguages), draft)) editedTexts[key] = draft[key];
      command = {
        fingerprint: `support-welcome:${JSON.stringify(payload)}`,
        commandKey: crypto.randomUUID(),
        expiresAt: Date.now() + PENDING_MUTATION_TTL_MS,
        payload,
        editedTexts,
      };
      welcomeCommands.remember(command.fingerprint, command.commandKey, { actorId: adminId, payload, editedTexts });
    }
    setSaving(true); setError(""); setSaved(false);
    try {
      let value = await supportWelcomeMessageClient.update(command.payload, command.commandKey);
      if (actor !== actorStamp()) return;
      if (retry) {
        try {
          value = await supportWelcomeMessageClient.read();
        } catch {
          if (actor === actorStamp()) setError("暂时查不到上次保存的结果，输入已保留。");
          return;
        }
        if (actor !== actorStamp()) return;
      }
      welcomeCommands.forget(command.fingerprint, command.commandKey);
      setCurrent(value); setDraft(welcomeDraft(value.texts, requiredLanguages)); setReason(""); setConfirm(false); setRetry(null); setLatest(null); setSaved(true);
    } catch (cause) {
      if (actor !== actorStamp()) return;
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      // A version conflict and an unconfirmed result each have their own notice; only rejected input uses the banner.
      setError([400, 401, 403, 422].includes(status) ? errorText(cause) : "");
      if (status === 409 && !isIndeterminateSupportError(cause)) {
        welcomeCommands.forget(command.fingerprint, command.commandKey);
        setRetry(null); setConflict(command); setConfirm(false);
        try { const value = await supportWelcomeMessageClient.read(); if (actor === actorStamp()) setLatest(value); } catch { /* Keep the draft; the conflict notice offers an explicit reload. */ }
      } else if (![400, 401, 403, 422].includes(status)) {
        setRetry(command);
      } else {
        welcomeCommands.forget(command.fingerprint, command.commandKey); setRetry(null);
        if (!command.editedTexts) { setLatest(current); setConflict(command); setConfirm(false); }
      }
    } finally { setSaving(false); }
  }

  // Keep the languages this operator edited; take every other language from the latest saved version.
  function reviewLatest() {
    if (!latest || !conflict) return;
    setCurrent(latest); setDraft(welcomeDraft(latest.texts, requiredLanguages, conflict.editedTexts)); setLatest(null); setConflict(null); setConfirm(false); setReason(""); setError("");
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
      const result = await supportWelcomeMessageClient.command(retry.commandKey, retry.payload);
      if (actor !== actorStamp()) return;
      if (result.status === "SUCCEEDED") {
        const value = await supportWelcomeMessageClient.read();
        if (actor !== actorStamp()) return;
        welcomeCommands.forget(retry.fingerprint, retry.commandKey);
        setCurrent(value); setDraft(welcomeDraft(value.texts, requiredLanguages)); setRetry(null); setReason(""); setConfirm(false); setError(""); setSaved(true);
      } else if (result.status === "FAILED") {
        welcomeCommands.forget(retry.fingerprint, retry.commandKey);
        setRetry(null); setError("上次保存没有成功，输入已保留；请检查后重新提交。");
        if (!retry.editedTexts && current) { setLatest(current); setConflict(retry); setConfirm(false); }
      } else setError(Date.now() >= retry.expiresAt ? "查不到上次保存的结果。请加载最新内容核对后重新提交。" : "上次保存仍在处理中，请稍后再查，或按原操作重试。");
    } catch { if (actor === actorStamp()) setError("暂时查不到上次保存的结果，输入已保留。"); }
    finally { setSaving(false); }
  }

  async function reloadAfterExpiry() {
    if (!retry || saving) return;
    const actor = actorStamp();
    setSaving(true);
    try {
      const value = await supportWelcomeMessageClient.read();
      if (actor !== actorStamp()) return;
      welcomeCommands.forget(retry.fingerprint, retry.commandKey);
      if (retry.editedTexts) {
        setCurrent(value); setDraft(welcomeDraft(value.texts, requiredLanguages, retry.editedTexts));
      } else { setLatest(value); setConflict(retry); }
      setRetry(null); setReason(""); setConfirm(false); setError("");
    } catch (cause) { if (actor === actorStamp()) setError(errorText(cause)); }
    finally { setSaving(false); }
  }

  const retryExpired = retry !== null && Date.now() >= retry.expiresAt;
  const conflictBase = conflict && current?.version === conflict.payload.expectedVersion && conflict.editedTexts ? current.texts : conflict?.payload.texts;
  return (
    <div className="m-admin-panel m5-welcome-message" aria-label="新用户欢迎语">
      <h2>新用户欢迎语</h2>
      <div className="m-admin-muted">新用户注册后会在客服对话里收到这条消息：有专属客服的由专属客服发出，还没有专属客服的以「待分配客服」显示。修改只对之后注册的用户生效。</div>
      {permission !== "superadmin" && <div className="m-admin-muted">仅超级管理员可修改；当前为只读视图。</div>}
      {loading && <div className="m-admin-muted" role="status">正在加载欢迎语…</div>}
      {error && <div className="m-admin-error" role="alert">{error} {readUnavailable && <button type="button" className="btn btn-sec btn-sm" onClick={() => setReload((n) => n + 1)}>重试</button>}</div>}
      {draft && current && <>
        {LANGUAGES.map(({ key, label }, index) => {
          const problem = problems[index], length = codePointLength(draft[key]);
          const required = requiredLanguages.includes(key);
          return <label className="field m5-welcome-field" key={key}>
            <span>{label}{required ? " *" : "（选填）"}</span>
            <textarea value={draft[key]} placeholder={required ? undefined : "选填，不填时新用户收到英文"} disabled={!editable} aria-invalid={Boolean(problem)} aria-describedby={`m5-welcome-${key}-count`} onChange={(event) => { const value = event.target.value; setDraft((old) => old ? { ...old, [key]: value } : old); setSaved(false); }} />
            <span id={`m5-welcome-${key}-count`} className={`m5-welcome-count${problem ? " invalid" : ""}`}>{problem ? `${problem} · ` : ""}{length}/{MAX}</span>
          </label>;
        })}
        {conflict && <div className="m-admin-error" role="alert">{conflict.editedTexts ? "欢迎语已被其他管理员修改。" : "无法确定旧提交中哪些语言由你编辑。请逐项核对原提交与最新内容，重新填写要修改的语言。"}{latest ? `最新版本为 ${latest.version}，你编辑时为版本 ${conflict.payload.expectedVersion}。` : "还没取到最新内容。"}{conflict.editedTexts && "你的输入已保留。"}{latest && conflictBase && <ul>{changedLanguages(conflictBase, latest.texts).map((key) => <li key={key}>{LANGUAGES.find((item) => item.key === key)?.label}：{conflict.editedTexts ? "已被改为" : `原提交「${conflictBase[key]}」，最新内容`}「{latest.texts[key]}」</li>)}</ul>}{latest ? <button type="button" className="btn btn-sec btn-sm" onClick={reviewLatest}>按最新内容重新核对</button> : <button type="button" className="btn btn-sec btn-sm" onClick={() => void refreshLatest()}>加载最新内容</button>}</div>}
        <div className="m-admin-toolbar">
          <span className="m-admin-muted">当前版本 {current.version} · {current.updatedAt ? `最近修改 ${formatBusinessTime(current.updatedAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}${current.updatedBy ? ` · ${current.updatedBy}` : ""}` : "尚未修改过"}{current.reason ? ` · 理由：${current.reason}` : ""}{saved ? " · 已保存" : ""}</span>
          {permission === "superadmin" && <button type="button" className="btn btn-pri btn-sm" disabled={retry ? false : !editable || !valid || changed.length === 0} onClick={() => setConfirm(true)}>{retry ? "继续确认上次提交" : "预览并保存"}</button>}
        </div>
      </>}
      {confirm && current && textsForSave && permission === "superadmin" && <Modal title="确认保存新用户欢迎语" icon="gauge" onClose={() => { if (!saving) setConfirm(false); }} busy={saving} wide footer={<><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" disabled={saving} onClick={() => setConfirm(false)}>返回</button><button type="button" className="btn btn-pri btn-sm" disabled={(!canConfirm && !retry) || retryExpired || saving} onClick={() => void save()}>{saving ? "保存中…" : retry ? "按原操作重试" : "确认保存"}</button></>}>
        <div className="m-admin-muted">保存后，之后注册的新用户会收到新内容；已经发出的欢迎语不变。</div>
        <div className="m-admin-list m5-welcome-diff">{changed.map((key) => <div key={key}><strong>{LANGUAGES.find((item) => item.key === key)?.label}</strong><p>原：{current.texts[key]}</p><p>新：{textsForSave[key]}</p></div>)}</div>
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
