"use client";

import { useEffect, useRef, useState } from "react";
import { m5ManagementClient, supportWelcomeMessageClient, isIndeterminateSupportError, type SupportWelcomeLanguage, type SupportWelcomeMessage, type SupportWelcomeTexts } from "../../../../lib/admin/m-support-client";
import { businessStamp, businessZone, formatBusinessTime } from "../../../../lib/admin/business-time";
import { MessageCircleHeart, Save } from "lucide-react";
import { BlockState, Button, Explain, Fact, Facts, Field, LocaleTabs, Modal, Notice, Panel, StatusTag, Textarea } from "@/app/components/rd";
import { M5PendingWrites, type M5WelcomeSummary } from "./m5-views";
import { createPendingMutationStore, PENDING_MUTATION_TTL_MS } from "../../../../lib/admin/pending-mutation-store";
import { adminShellSessionKey } from "../../../../lib/admin/shell-authorities";
import { isM5ManagementPayload } from "@/lib/admin/m5-management-record";
import { useAdminAuth } from "../../../../lib/store/admin-auth";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { useM5ManagementCommand, type M5ManagementRecord } from "@/lib/admin/use-m5-management-command";
import type { MSupportPermission } from "./m5-service-rules";

type WelcomePayload = Parameters<typeof supportWelcomeMessageClient.update>[0];
type WelcomePendingRecord = M5ManagementRecord<WelcomePayload, SupportWelcomeMessage>;
const welcomeCommands = createPendingMutationStore<WelcomePendingRecord>({ storageKey: "nexion-admin-m-support-welcome-v1", retainExpiredRecords: true, isValidRecord: (row) => Number.isSafeInteger(row.actorId) && isM5ManagementPayload("welcome", row.payload) && (row.before === undefined || isM5ManagementPayload("welcome", row.before, true)) });
const LANGUAGES: Array<{ key: SupportWelcomeLanguage; label: string }> = [{ key: "zh", label: "中文" }, { key: "en", label: "英语" }, { key: "vi", label: "越南语" }];
const MAX = 500;
const EXPIRED = "原请求已超过 24 小时，不能再重试，只能查询原结果；原记录保留。";
const actorStamp = () => { const auth = useAdminAuth.getState(); return adminShellSessionKey(auth.session, auth.authEpoch); };
const fingerprintOf = (payload: WelcomePayload) => `support-welcome:${payload.expectedVersion}`;
// Same count as the backend: Unicode code points after trim. UTF-16 length counts 𠮷 twice.
const codePointLength = (value: string) => Array.from(value.trim()).length;

function textProblem(text: string): string {
  const length = codePointLength(text);
  if (length === 0) return "不能为空";
  if (length > MAX) return `超出 ${length - MAX} 字，最多 ${MAX} 字`;
  return "";
}

function changedLanguages(before: SupportWelcomeTexts, after: SupportWelcomeTexts): SupportWelcomeLanguage[] {
  return LANGUAGES.map(({ key }) => key).filter((key) => before[key] !== after[key].trim());
}

const errorText = displayAdminError;

/** B16: the one welcome copy a new user receives from their dedicated advisor (or in the unassigned state) right after registration. */
export function M5WelcomeMessage({ permission, onSummary }: { permission: MSupportPermission; onSummary?: (summary: M5WelcomeSummary) => void }) {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const canWrite = permission === "superadmin" && Boolean(authorities?.includes("service_m1_write"));
  const [current, setCurrent] = useState<SupportWelcomeMessage | null>(null);
  const [draft, setDraft] = useState<SupportWelcomeTexts | null>(null);
  const [latest, setLatest] = useState<SupportWelcomeMessage | null>(null);
  const [readUnavailable, setReadUnavailable] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");
  // expiresAt = the original record's 24h limit: after it the key may no longer be replayed, only looked up.
  const [reload, setReload] = useState(0);
  const preserveDraft = useRef(false);
  const [lang, setLang] = useState<SupportWelcomeLanguage>("zh");
  const command = useM5ManagementCommand({
    store: welcomeCommands, canQuery: Boolean(authorities?.includes("service_m1_read")), canWrite,
    fingerprint: fingerprintOf, write: m5ManagementClient.welcome, query: m5ManagementClient.welcomeCommand,
    onSuccess: () => { preserveDraft.current = false; setConfirm(false); setLoading(true); setReadUnavailable(true); setSaved(true); setReason(""); setReload(n => n + 1); },
    onRefusal: (cause, recovered, payload) => {
      setError(errorText(cause));
      if (recovered) { preserveDraft.current = true; setDraft(payload.texts); setConfirm(false); setLoading(true); setReadUnavailable(true); setReload(n => n + 1); }
      else if (cause instanceof Error && "backendMessage" in cause && cause.backendMessage === "SUPPORT_WELCOME_VERSION_CONFLICT") {
        setConflict(true); setConfirm(false); void refreshLatest();
      }
    },
  });
  const saving = command.busy;
  const retry = command.pending ? { ...command.pending, key: command.pending.commandKey } : null;


  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    supportWelcomeMessageClient.read(controller.signal).then((value) => {
      if (controller.signal.aborted) return;
      const pending = welcomeCommands.list().find((row) => row.actorId === adminId);
      setCurrent(value); setDraft(old => pending ? pending.payload.texts : preserveDraft.current && old ? old : value.texts); setError(""); setLatest(null); setReadUnavailable(false); setConflict(false);
      setReason(pending?.payload.reason ?? "");
    }).catch(() => { if (!controller.signal.aborted) { setReadUnavailable(true); setError("新用户欢迎语暂时加载不了，请重试。"); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [permission, reload, adminId]);

  const problems = draft ? LANGUAGES.map(({ key }) => textProblem(draft[key])) : [];
  const valid = Boolean(draft) && problems.every((problem) => !problem);
  const changed = current && draft ? changedLanguages(current.texts, draft) : [];
  const editable = canWrite && Boolean(current) && !loading && !readUnavailable && !saving && !conflict && !retry;
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canConfirm = editable && valid && changed.length > 0 && reasonOk;

  async function save() {
    if (saving) return;
    if (retry) { await command.run("replay"); return; }
    if (!canConfirm || !current || !draft) return;
    setSaved(false);
    await command.run("submit", { expectedVersion: current.version, texts: { zh: draft.zh.trim(), en: draft.en.trim(), vi: draft.vi.trim() }, reason: reason.trim() }, current);
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
    try { const value = await supportWelcomeMessageClient.read(); if (actor === actorStamp()) setLatest(value); } catch (cause) { if (actor === actorStamp()) setError(displayAdminReadError(cause)); }
  }

  const checkPending = () => command.run("query");
  // Loading current content is a read-only comparison; it cannot settle an expired direct write.
  async function reloadAfterExpiry() {
    const actor = actorStamp();
    try { const value = await supportWelcomeMessageClient.read(); if (actor === actorStamp()) { setCurrent(value); setReadUnavailable(false); } }
    catch (cause) { if (actor === actorStamp()) setError(errorText(cause)); }
  }
  const restore = () => {
    if (!retry) return;
    setDraft(retry.payload.texts); setReason(retry.payload.reason); setError(""); setConfirm(true);
  };
  const original = retry?.before ?? (retry ? { version: retry.payload.expectedVersion, texts: retry.payload.texts, updatedAt: null, updatedBy: null, reason: null } : current);

  const retryExpired = retry !== null && Date.now() >= retry.expiresAt;
  useEffect(() => {
    onSummary?.({ state: loading ? "loading" : readUnavailable ? "failed" : current ? "ready" : "failed", updatedAt: current?.updatedAt ?? null, pending: Boolean(retry) });
  }, [onSummary, current, loading, command.pending, readUnavailable]);
  const shownTexts = draft ?? current?.texts;
  const langLabel = LANGUAGES.find((item) => item.key === lang)?.label ?? lang;
  const submittedAt = retry ? retry.expiresAt - PENDING_MUTATION_TTL_MS : 0;
  const updatedText = current?.updatedAt ? formatBusinessTime(current.updatedAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : null;
  const errorTone = /查不到|还在处理|仍在处理|24 小时/.test(error) ? "warn" : "danger";

  return (
    <section className="m5-welcome" aria-label="新用户欢迎语">
      {retry && <M5PendingWrites rows={[{
        key: retry.key, name: "新用户欢迎语", submittedAt, expired: retryExpired,
        change: `改了${(retry.before ? changedLanguages(retry.before.texts, retry.payload.texts) : LANGUAGES.map(item => item.key)).map((key) => LANGUAGES.find((item) => item.key === key)?.label).join("、") || "内容"}`,
        actions: <>
          <Button size="sm" disabled={saving || !authorities?.includes("service_m1_read")} onClick={() => void checkPending()}>查询原结果</Button>
          {!retryExpired && <Button size="sm" variant="primary" disabled={saving || !canWrite} onClick={restore}>按原请求重试</Button>}
        </>,
      }]} />}
      <Panel icon={MessageCircleHeart} tone="role-3" title="新用户欢迎语" sub={current && !readUnavailable ? `第 ${current.version} 版` : undefined}
        explain="新用户注册后在客服对话里收到的第一条消息：已经有专属客服的以这位客服的名义发，还没有的显示「待分配」。用户语言是中文收中文、越南语收越南语，其他语言都收英语。">
        {permission !== "superadmin" && <Notice tone="neutral">只有超级管理员能改欢迎语，你现在只能查看。</Notice>}
        {loading && !current && <BlockState state="loading" title="正在读取欢迎语…" />}
        {saved && <Notice tone="ok">已保存。之后注册的用户会收到新内容。</Notice>}
        {!loading && (!current || readUnavailable) && <BlockState state="error" title="新用户欢迎语读不到" detail="暂时不能查看和修改。" onRetry={() => setReload((n) => n + 1)} />}
        {(error || command.message) && !readUnavailable && !confirm && !conflict && <Notice tone={errorTone}>{command.message || error}</Notice>}
        {current && shownTexts && !(readUnavailable && !retry) && <div className="m5-welcome-body">
          <div className="m5-welcome-edit">
            <LocaleTabs label="欢迎语语言" value={lang} onChange={setLang}
              items={LANGUAGES.map(({ key, label }) => ({ value: key, label: (draft && current.texts[key] !== draft[key].trim()) ? <>{label} · 已改</> : label, missing: !shownTexts[key].trim() }))} />
            {LANGUAGES.filter(({ key }) => key === lang).map(({ key, label }) => {
              const problem = draft ? problems[LANGUAGES.findIndex((item) => item.key === key)] : "";
              return <Field key={key} label={`${label}欢迎语`} hint="最多 500 字" error={problem || undefined}>
                {(control) => <Textarea {...control} className="m5-welcome-text" rows={6} value={shownTexts[key]} disabled={!editable} count={`${codePointLength(shownTexts[key])}/${MAX}`}
                  onChange={(event) => { const value = event.target.value; setDraft((old) => old ? { ...old, [key]: value } : old); setSaved(false); }} />}
              </Field>;
            })}
            <dl className="m5-meta">
              <div><dt>最近修改</dt><dd data-empty={updatedText ? undefined : ""}>{updatedText ? `${updatedText}（${businessZone().label}）` : "—"}</dd></div>
              <div><dt>修改人</dt><dd data-empty={current.updatedBy ? undefined : ""}>{current.updatedBy || "—"}</dd></div>
              <div><dt>理由</dt><dd data-empty={current.reason ? undefined : ""}>{current.reason || "—"}</dd></div>
            </dl>
          </div>
          <div className="m5-welcome-preview" aria-label={`${langLabel}用户大概看到的样子`}>
            <div className="m5-phone-head">用户在客服对话里看到的样子<Explain label="预览怎么看" content="只示意内容和顺序，字号、头像以 App 为准。有专属客服的显示这位客服的名字和头像，还没有的显示「待分配」。" side="top" align="start" /></div>
            <div className="m5-phone">
              <div className="m5-phone-bar">专属客服 · {langLabel}</div>
              {draft && current.texts[lang] !== draft[lang].trim()
                ? <>
                  <div className="m5-bubble" data-old=""><span className="m5-bubble-tag">现在线上</span>{current.texts[lang]}</div>
                  <div className="m5-bubble" data-user-content=""><span className="m5-bubble-tag" data-new="">保存后</span>{draft[lang].trim() || <span className="m5-bubble-empty">还没有内容</span>}</div>
                </>
                : <div className="m5-bubble" data-user-content=""><span className="m5-bubble-tag">现在线上</span>{current.texts[lang]}</div>}
            </div>
            <p className="m5-preview-note">只对之后注册的用户生效，已注册的不受影响。</p>
          </div>
        </div>}
        {conflict && current && <Notice tone="warn" title="欢迎语已被别人改过" actionBelow
          action={latest ? <Button size="sm" onClick={reviewLatest}>按最新内容重新核对</Button> : <Button size="sm" onClick={() => void refreshLatest()}>加载最新内容</Button>}>
          <p>{latest ? `现在是第 ${latest.version} 版，你改的是第 ${current.version} 版。` : "还没读到最新内容。"}你填的内容还在。</p>
          {latest && <ul className="m5-plain-list">{changedLanguages(current.texts, latest.texts).map((key) => <li key={key}>{LANGUAGES.find((item) => item.key === key)?.label}：已被改为「{latest.texts[key]}」</li>)}</ul>}
        </Notice>}
        {draft && current && permission === "superadmin" && !(readUnavailable && !retry) && <div className="rd-toolbar" data-end="">
          <span className="rd-toolbar-note">{retry ? "上次保存结果未知，先处理它" : changed.length > 0 ? `改了${changed.map((key) => LANGUAGES.find((item) => item.key === key)?.label).join("、")}，还没保存` : "没有改动"}</span>
          <Button variant="primary" icon={<Save size={14} aria-hidden />} disabled={retry ? false : !editable || !valid || changed.length === 0}
            disabledReason={!retry && editable && changed.length === 0 ? "还没有改动" : !retry && editable && !valid ? "有一种语言是空的或超过 500 字" : undefined}
            onClick={() => retry ? restore() : setConfirm(true)}>{retry ? "查看结果未知的保存" : "预览并保存"}</Button>
        </div>}
      </Panel>
      {confirm && original && draft && permission === "superadmin" && <Modal title="保存新用户欢迎语" icon={MessageCircleHeart} wide busy={saving} onClose={() => { if (!saving) setConfirm(false); }}
        sub={<><StatusTag tone="progress" filled>保存后立即生效</StatusTag><span className="m5-modal-id">第 {original.version} 版</span></>}
        footer={<>
          <Button disabled={saving} onClick={() => setConfirm(false)}>返回</Button>
          {retry && retryExpired && <Button disabled={saving} onClick={() => void reloadAfterExpiry()}>加载最新内容</Button>}
          <Button variant="primary" loading={saving} disabled={!canWrite || (!canConfirm && !retry) || retryExpired || saving} disabledReason={saving ? undefined : retryExpired ? "原请求超过 24 小时，只能查询原结果" : !retry && !reasonOk ? "操作理由要 8–200 字" : undefined} onClick={() => void save()}>{retry ? "按原请求重试" : "确认保存"}</Button>
        </>}>
        <div className="m5-wdiff">
          {(retry ? retry.before ? changedLanguages(retry.before.texts, retry.payload.texts) : LANGUAGES.map(item => item.key) : changed).map((key) => <div key={key} className="m5-wdiff-row">
            <div className="m5-wdiff-lang">{LANGUAGES.find((item) => item.key === key)?.label}</div>
            <div className="m5-wdiff-text" data-user-content=""><span className="m5-bubble-tag">现在线上</span>{retry && !retry.before ? "—" : original.texts[key]}</div>
            <div className="m5-wdiff-text" data-new="" data-user-content=""><span className="m5-bubble-tag" data-new="">保存后</span>{(retry ? retry.payload.texts : draft)[key].trim()}</div>
          </div>)}
        </div>
        <Facts>
          <Fact k="谁会收到">之后注册的新用户</Fact>
          <Fact k="不变的">已经注册的用户不会再收到；已发出的欢迎语不改</Fact>
        </Facts>
        {retry && <Notice tone="warn" title="结果未知" action={<Button size="sm" disabled={saving || !authorities?.includes("service_m1_read")} onClick={() => void checkPending()}>查询原结果</Button>}>
          {retryExpired ? EXPIRED : `上次保存在 ${businessStamp(submittedAt)}（${businessZone().label}）提交，可能已经生效。先查询原结果，或按原请求重试，不会重复执行。`}
        </Notice>}
        <Field label="操作理由" required hint="8–200 字">
          {(control) => <Textarea {...control} rows={3} value={reason} maxLength={200} disabled={saving || Boolean(retry)} count={`${reason.trim().length}/200`} placeholder="例如：活动期间欢迎语加上新手指引" onChange={(event) => setReason(event.target.value)} />}
        </Field>
        {(error || command.message) && <Notice tone={errorTone}>{command.message || error}</Notice>}
      </Modal>}
    </section>
  );
}
