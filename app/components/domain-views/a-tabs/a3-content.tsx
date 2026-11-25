"use client";

/**
 * A3 说明内容：开发者接口文档（W06）和六类业务说明（W07）。
 * 共用的 PublishedContentEditor（F1、I5 也在用）不动；这里按它 developerDocs 分支和 published-how-content-editor.tsx 的逻辑重画界面：
 * 读取、刷新（说明有改动时原生确认）、新增语言的格式检查、理由长度、「没有变化不提交」、请求体都和旧写法一样。
 * 新的只有：编辑和「App 上的样子」并排、保存时选「保存草稿」还是「发布」（等于旧的状态下拉选好再保存）、理由放进确认框。
 * 新内容命令由页面共用store保存原body/key；旧未发键记录仍只读核对，不给它补键重发。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, BookOpenText, Code2, FileText, Plus, RefreshCw, Smartphone, Trash2, TriangleAlert } from "lucide-react";
import { BlockState, Button, Change, DiffList, Explain, Fact, Facts, Field, Fold, IconButton, Input, KeepText, Modal, MoreMenu, Notice, PageTabs, Panel, Segments, Select, StatusTag, Textarea, useTabIds } from "@/app/components/rd";
import { a3HasOriginalReceipt, type A3Command, type A3ContentOriginal, type A3RecoveryProps } from "@/lib/admin/a3-mutations";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchDeveloperDocsAdmin, fetchHowContentAdmin, type PublishedContentDocument, type PublishedHowContentDocument } from "@/lib/admin/published-content-client";

export type A3ContentSummary = { unsaved: number };
type FailedContentDraft = { original: A3ContentOriginal; reason: string };
export type A3ContentRead = {
  value: PublishedContentDocument | PublishedHowContentDocument;
  failed?: FailedContentDraft;
  onApplied?: () => void;
};
export type A3ContentReads = Partial<Record<"docs" | "how", A3ContentRead>> & { selected?: "docs" | "how" };
type ContentRetry = { disabledReason?: string; busy: boolean; run: () => void };
type ContentRecoveryProps = {
  retry: (record: A3Command) => ContentRetry | undefined;
  feedback: (record: A3Command) => { detail: string; next: string } | undefined;
};
type Mode = "DRAFT" | "PUBLISHED";
type Toast = (text: string, kind?: "success" | "error" | "warn" | "info") => void;
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const text = (value: unknown) => typeof value === "string" ? value : "";
function list(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function blocks(value: unknown): Row[] { return Array.isArray(value) ? value.map(row) : []; }

const LANGUAGE_LABELS: Record<string, string> = { zh: "中文", "zh-cn": "简体中文", en: "英语", vi: "越南语", id: "印尼语", ms: "马来语", fil: "菲律宾语", ru: "俄语", kk: "哈萨克语", uz: "乌兹别克语" };
const localeName = (key: string) => LANGUAGE_LABELS[key] ?? key;
const STATUS_NAME: Record<string, string> = { DRAFT: "草稿", PUBLISHED: "已发布", UNPUBLISHED: "已撤下公开版本" };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const contentMap = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value);
type DeletedEdit = { path: string[]; before: Row; draft: Row };
const UNRESOLVED_DELETION = "先核对最新版本中已删除的内容。";

function blocksById(value: unknown) {
  if (!Array.isArray(value)) return;
  const entries: Array<[string, Row]> = [];
  for (const item of value) {
    if (!contentMap(item) || typeof item.id !== "string" || !item.id) return;
    entries.push([item.id, item]);
  }
  const result = Object.fromEntries(entries);
  return Object.keys(result).length === entries.length ? result : undefined;
}

/** Ordered lists without an item ID stay together as edited fields. */
function rebaseContent(latest: Row, submitted: Row, baseline: Row, deleted: DeletedEdit[], path: string[] = []): Row {
  const rebased = { ...latest };
  for (const key of new Set([...Object.keys(submitted), ...Object.keys(baseline)])) {
    const draft = submitted[key];
    const before = baseline[key];
    const current = latest[key];
    if (same(draft, before)) continue;
    const itemPath = [...path, key];
    if (!Object.hasOwn(submitted, key)) {
      delete rebased[key];
    } else if (contentMap(draft) && contentMap(before)) {
      if (contentMap(current)) rebased[key] = rebaseContent(current, draft, before, deleted, itemPath);
      else if (!Object.hasOwn(latest, key)) deleted.push({ path: itemPath, before, draft });
      else rebased[key] = draft;
    } else if (key === "blocks") {
      const currentBlocks = blocksById(current), draftBlocks = blocksById(draft), baselineBlocks = blocksById(before);
      if (currentBlocks && draftBlocks && baselineBlocks) {
        const merged = rebaseContent(currentBlocks, draftBlocks, baselineBlocks, deleted, itemPath);
        const order = [...new Set([...(current as Row[]), ...(draft as Row[])].map(item => String(item.id)))];
        rebased[key] = order.filter(id => Object.hasOwn(merged, id)).map(id => merged[id]);
      } else rebased[key] = draft;
    } else rebased[key] = draft;
  }
  return rebased;
}

function rebaseDocument<K extends "locales" | "contents", T extends { version: string } & Record<K, Row>>(
  latest: T, submitted: T, baseline: T, body: K, deleted: DeletedEdit[],
): T {
  return {
    ...latest,
    version: same(submitted.version, baseline.version) ? latest.version : submitted.version,
    [body]: rebaseContent(latest[body], submitted[body], baseline[body], deleted),
  };
}

function deletedEditRows(edits: DeletedEdit[]) {
  return edits.map(({ path }) => ({
    key: JSON.stringify(path),
    label: path.filter(item => item !== "locales" && item !== "blocks").map(item => PAGE_LABELS[item] ?? localeName(item)).join(" · "),
    text: "最新版本已删除这项内容，你修改过它。你的修改仍保留，尚未恢复到草稿。",
  }));
}

function useContentDelivery(read: A3ContentRead | undefined, ready: boolean, apply: (read: A3ContentRead) => Promise<boolean>) {
  const [applied, setApplied] = useState<A3ContentRead>();
  useEffect(() => {
    if (read && read !== applied && ready) void apply(read).then(accepted => { if (accepted) setApplied(read); });
  }, [read, ready, apply, applied]);
  useEffect(() => {
    if (applied === read) applied?.onApplied?.();
  }, [applied, read]);
}
/** 一种语言里哪几部分和最新版本不同；只在一边有就直说。 */
function localeParts(mine: unknown, latest: unknown, parts: Array<[string, (value: Row) => unknown]>) {
  if (mine === undefined) return "最新版本有，你这边删掉了";
  if (latest === undefined) return "你新加的，最新版本没有";
  return parts.filter(([, pick]) => !same(pick(row(mine)), pick(row(latest)))).map(([name]) => name).join("、") + "不同";
}
const DOC_PARTS: Array<[string, (value: Row) => unknown]> = [["请求示例", (v) => row(v.example).request], ["响应示例", (v) => row(v.example).response], ["接口列表", (v) => v.endpoints], ["事件列表", (v) => v.events]];

/** 版本冲突后的提示：你留着的修改和刚读到的最新版本差在哪，重读和重新提交在哪。 */
function ConflictNotice({ ready, rows, error, loading, onReread, submitHint, originalFailure, hasDeletion, intent }: {
  ready: boolean; rows: Array<{ key: string; label: string; text: ReactNode }>; error: string | null; loading: boolean; onReread: () => void;
  submitHint: string; originalFailure?: string | null; hasDeletion: boolean; intent: Mode | null;
}) {
  const next = hasDeletion ? UNRESOLVED_DELETION : intent === "PUBLISHED" ? "原发布尚未完成。核对后点上方「发布…」重新确认。"
    : intent === "DRAFT" ? "原保存草稿尚未完成。核对后点上方「保存草稿…」重新确认。"
      : rows.length ? `和最新版本不同的有 ${rows.length} 处，核对后${submitHint}：` : "你改的和最新版本一样，不用再提交。";
  return <Notice tone="warn" title={originalFailure ?? "别人刚保存过，你的修改没有保存"} action={<Button size="sm" loading={loading} onClick={onReread}>重新读取</Button>}>
    {ready
      ? <>已读到最新版本，你改的都还在。{next}
        {rows.length > 0 && <div className="a3-conflict-diff"><Facts>{rows.map((item) => <Fact key={item.key} k={item.label}>{item.text}</Fact>)}</Facts></div>}</>
      : loading ? "正在加载最新版本，你改的都还在。"
        : <>最新版本没读到，你改的都还在；先重新读取再核对。{error?.includes("；") ? <span className="rd-note"> {error.split("；").slice(1).join("；")}</span> : null}</>}
  </Notice>;
}
/** 种子版本号带内部前缀 default-，写给人看时去掉；输入框里还是原值。 */
const versionName = (version: string) => version.replace(/^default-/, "") || "—";
const statusOf = (status: string): Mode => status === "UNPUBLISHED" ? "DRAFT" : status as Mode;

function publicLine(doc: { status: string; hasPublishedVersion?: boolean }) {
  if (doc.status === "PUBLISHED") return "已发布，App 读的是这一版";
  if (doc.status === "UNPUBLISHED") return "已撤下公开版本";
  return doc.hasPublishedVersion ? "草稿，App 仍读之前的公开版" : "草稿，还没有公开版";
}

export function A3Content({ commands, recovery, onRecovered, toast, onSummary, contentReads, ...release }: Omit<A3RecoveryProps, "nonce"> & ContentRecoveryProps & { contentReads: A3ContentReads; toast: Toast; onSummary: (summary: A3ContentSummary) => void }) {
  const ids = useTabIds();
  const [tab, setTab] = useState<"docs" | "how">("how");
  const selectedRead = contentReads.selected && contentReads[contentReads.selected];
  useEffect(() => { if (selectedRead && contentReads.selected) setTab(contentReads.selected); }, [selectedRead, contentReads.selected]);
  const [dirty, setDirty] = useState({ docs: false, how: false });
  const markDocs = useCallback((value: boolean) => setDirty((current) => current.docs === value ? current : { ...current, docs: value }), []);
  const markHow = useCallback((value: boolean) => setDirty((current) => current.how === value ? current : { ...current, how: value }), []);
  useEffect(() => { onSummary({ unsaved: Number(dirty.docs) + Number(dirty.how) }); }, [dirty, onSummary]);
  return <div className="rd-tab-stack">
    <PageTabs level={2} ids={ids} label="说明内容" value={tab} onChange={setTab} items={[
      { value: "how", label: "业务说明（6 页）", count: dirty.how ? "未保存" : undefined },
      { value: "docs", label: "开发者接口文档", count: dirty.docs ? "未保存" : undefined },
    ]} />
    <div {...ids.panel("how")} hidden={tab !== "how"}><HowContent commands={commands} recovery={recovery} onRecovered={onRecovered} incoming={contentReads.how} toast={toast} onDirty={markHow} {...release} /></div>
    <div {...ids.panel("docs")} hidden={tab !== "docs"}><DeveloperDocs commands={commands} recovery={recovery} onRecovered={onRecovered} incoming={contentReads.docs} toast={toast} onDirty={markDocs} {...release} /></div>
  </div>;
}

/** 保存草稿和发布共用的确认框：理由 8–500 在框里填，点确认时才校验（旧写法）。 */
/** locked：结果未知时打开的是原提交（内容、方式、理由都是原来的），只能查询、解除或按原操作重试。 */
function SaveModal({ mode, title, busy, error, facts, extra, reason, onReason, reasonMin, locked, retry, onCancel, onConfirm }: {
  mode: Mode; title: string; busy: boolean; error: string | null; facts: ReactNode; extra?: ReactNode;
  locked?: boolean; retry?: ContentRetry; reason: string; onReason: (value: string) => void; reasonMin: number; onCancel: () => void; onConfirm: () => void;
}) {
  const publish = mode === "PUBLISHED";
  const working = busy || Boolean(retry?.busy);
  return <Modal title={locked ? `原提交：${title}` : title} tone={publish ? "danger" : "neutral"} icon={publish ? undefined : FileText} busy={working} dirty={Boolean(reason)} onClose={onCancel}
    sub={publish ? <StatusTag tone="progress" filled>立即替换 App 读到的内容</StatusTag> : <StatusTag tone="neutral" filled>保存草稿，App 读到的不变</StatusTag>}
    footer={<>
      <Button disabled={working} onClick={onCancel}>取消</Button>
      {locked && retry
        ? <Button variant={publish ? "danger" : "primary"} loading={retry.busy} disabledReason={retry.disabledReason} onClick={retry.run}>按原操作重试</Button>
        : <Button variant={publish ? "danger" : "primary"} loading={busy} disabledReason={locked ? "结果未知" : undefined} onClick={onConfirm}>{publish ? "发布" : "保存草稿"}</Button>}
    </>}>
    {error && <Notice tone={locked ? "warn" : "danger"} title={locked ? undefined : "没有保存"}>{error}</Notice>}
    {facts}
    {extra}
    <Field label="变更理由" required help={`${reasonMin}–500 字`}>
      {(control) => <Textarea {...control} aria-label="变更理由" value={reason} disabled={locked || busy} maxLength={500} rows={2} count={`${reason.trim().length}/500`} placeholder="例如：更新提现说明，工单号" onChange={(event) => onReason(event.target.value)} />}
    </Field>
  </Modal>;
}

const SAVE_UNKNOWN_NOTE = <>没收到结果时，先查询原操作。明确查无且未超过 24 小时，才可按原操作重试。</>;
/** 原提交框里还没有对比结果时：能重试的说重试会怎样，不能重试的说查询会怎样。 */
function OriginalNote({ record, retry }: { record: A3Command; retry?: ContentRetry }) {
  if (!a3HasOriginalReceipt(record)) return <>可用「读取当前内容」核对现值，原操作记录和修改锁保留，请到操作记录与审批核对。</>;
  if (isRetryExpired(record)) return <>已超过 24 小时，不能再重试。可查询原操作，记录和修改锁保留。</>;
  if (!retry || retry.disabledReason) return SAVE_UNKNOWN_NOTE;
  return <>重试按原提交的内容、方式和理由再发一次：<KeepText text="已经保存过的不会重复保存，也不会盖掉别人后来的修改。" /></>;
}

function Preview({ title, children }: { title: string; children: ReactNode }) {
  return <aside className="a3-preview" aria-label={`App 上的样子：${title}`}>
    <span className="a3-preview-label"><Smartphone size={14} aria-hidden />App 上的样子</span>
    {children}
  </aside>;
}

/* ────────────────── 开发者接口文档（W06） ────────────────── */

type ContentEditorProps = Omit<A3RecoveryProps, "nonce"> & ContentRecoveryProps & {
  incoming?: A3ContentRead; toast: Toast; onDirty: (value: boolean) => void;
};

function DeveloperDocs({ commands, recovery, onRecovered, incoming, toast, onDirty, retry, feedback }: ContentEditorProps) {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [loadedDocument, setDocument] = useState<PublishedContentDocument | null>(null);
  const [loadedBaseline, setBaseline] = useState<PublishedContentDocument | null>(null);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [addingLocale, setAddingLocale] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [readReady, setReadReady] = useState(false);
  const [originalFailure, setOriginalFailure] = useState<string | null>(null);
  const [intent, setIntent] = useState<Mode | null>(null);
  const [deletedEdits, setDeletedEdits] = useState<DeletedEdit[]>([]);
  const conflictDraft = useRef(false);
  const reading = useRef(false);
  const formRef = useRef({ document: loadedDocument, baseline: loadedBaseline });
  formRef.current = { document: loadedDocument, baseline: loadedBaseline };
  const original = commands.find("docs");
  const savedForm = original?.original.kind === "docs" ? original.original : null;
  const document = mode && savedForm ? savedForm.document : loadedDocument;
  const baseline = mode && savedForm ? savedForm.baseline : loadedBaseline;
  useEffect(() => {
    if (recovery?.original.kind !== "docs") return;
    setReason(recovery.reason); setMode(recovery.original.mode); setError(null); onRecovered();
  }, [recovery, onRecovered]);
  const refresh = useCallback(async (current?: PublishedContentDocument, failure?: FailedContentDraft) => {
    if (!canRead || reading.current) return false;
    const previous = formRef.current;
    reading.current = true;
    setReadReady(false); setLoading(true);
    if (!commands.find("docs")) setMode(null);
    if (!conflictDraft.current) setError(null);
    try {
      const value = current ?? await fetchDeveloperDocsAdmin();
      if (!commands.find("docs")) setMode(null);
      const rejected = failure?.original.kind === "docs" ? failure.original : null;
      if (current) {
        conflictDraft.current = Boolean(rejected);
        setOriginalFailure(rejected ? failure!.reason : null);
        setIntent(rejected?.mode ?? null);
        setMode(null); setReason(""); setError(null);
      }
      const deleted: DeletedEdit[] = [];
      const draft = rejected?.document ?? previous.document;
      const base = rejected?.baseline ?? previous.baseline;
      const editable = conflictDraft.current && draft && base ? rebaseDocument(value, draft, base, "locales", deleted) : value;
      if (current || deleted.length) setDeletedEdits(edits => current ? deleted : [...edits, ...deleted]);
      setDocument(editable);
      setBaseline(value);
      if (conflictDraft.current) setLocale(previous => Object.hasOwn(editable.locales, previous) ? previous : Object.keys(editable.locales)[0] ?? "en");
      if (!conflictDraft.current) { setLocale(Object.keys(value.locales)[0] ?? "en"); setReason(""); }
      setReadReady(true);
      return true;
    } catch (cause) {
      if (!conflictDraft.current) { setDocument(null); setBaseline(null); }
      setError(previous => conflictDraft.current && previous ? `${previous}；${displayAdminError(cause)}` : displayAdminError(cause));
      return false;
    }
    finally { reading.current = false; setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(); }, [refresh]);
  const applyRead = useCallback((read: A3ContentRead) => "locales" in read.value ? refresh(read.value, read.failed) : Promise.resolve(false), [refresh]);
  useContentDelivery(incoming, !loading && !saving, applyRead);
  const hasChanges = useMemo(() => JSON.stringify(document) !== JSON.stringify(baseline), [document, baseline]);
  const remainingIntent = intent && baseline && intent !== statusOf(baseline.status) ? intent : null;
  const dirty = hasChanges || Boolean(remainingIntent) || deletedEdits.length > 0;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  if (!canRead) return <BlockState state="denied" title="没有查看开发者接口文档的权限" />;
  if (loading && !document) return <BlockState state="loading" title="正在加载发布内容…" />;
  if (!document) return <BlockState state="error" title="公开内容状态尚未确认，请刷新重试。" detail={error ?? undefined} onRetry={() => void refresh()} />;

  const updateLocale = (value: Row) => setDocument({ ...document, locales: { ...document.locales, [locale]: value } });
  const addLocale = () => {
    if (original || !readReady || loading || saving || !canWrite) return;
    const normalized = newLocale.trim().toLowerCase().replace("_", "-");
    if (!/^(?:[a-z]{2}|fil)(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setError("语言代码格式无效，例如 en、zh、vi 或 zh-cn。"); return; }
    if (!document.locales[normalized] && Object.keys(document.locales).length >= 10) { setError("最多维护 10 种语言。"); return; }
    const empty = { example: { request: "", response: "" }, endpoints: [{ method: "GET", path: "/" }], events: [""] };
    setDocument({ ...document, locales: { ...document.locales, [normalized]: document.locales[normalized] ?? empty } });
    setLocale(normalized); setNewLocale(""); setError(null); setAddingLocale(false);
  };
  const removeLocale = () => {
    if (original || !readReady || loading || saving || !canWrite) return;
    if (Object.keys(document.locales).length <= 1) { setError("至少保留一种语言。"); return; }
    const next = { ...document.locales }; delete next[locale]; const nextLocale = Object.keys(next)[0];
    setDocument({ ...document, locales: next }); setLocale(nextLocale);
  };
  /** 选「保存草稿」或「发布」就是旧状态下拉选好的那个值；状态变了也算有变化。 */
  const canSave = (target: Mode) => deletedEdits.length === 0 && (hasChanges || target !== statusOf(baseline?.status ?? document.status));
  const save = async (target: Mode) => {
    if (!canWrite || original || loading || saving || !readReady) return;
    if (reason.trim().length < 8 || reason.trim().length > 500) { setError("变更理由需为 8–500 个字符。"); return; }
    if (!canSave(target)) { setError("内容没有变化，无需提交。"); return; }
    setSaving(true); setError(null);
    try {
      const payload = { ...document, status: target };
      const record = commands.capture({ original: { kind: "docs", document: payload, baseline: baseline!, mode: target },
        path: "/api/admin/developer/docs", method: "PUT", body: JSON.stringify({ ...payload, expectedRevision: payload.revision, revision: undefined, reason: reason.trim() }),
        reason: reason.trim(), name: "开发者接口文档", change: `${STATUS_NAME[baseline!.status]} → ${STATUS_NAME[target]} · ${document.version}` });
      await commands.send(record);
      conflictDraft.current = false;
      setOriginalFailure(null); setIntent(null); setDeletedEdits([]);
      setReadReady(false); setReason(""); setMode(null);
      toast(target === "PUBLISHED" ? "开发者接口文档已发布" : "草稿已保存，App 读到的不变", "success");
      await refresh();
    } catch (cause) {
      setError(displayAdminError(cause));
      if ((cause as { reasonCode?: string }).reasonCode === "DEVELOPER_DOCS_VERSION_CONFLICT" && !commands.find("docs")) {
        setOriginalFailure(null); setIntent(target); setReason("");
        conflictDraft.current = true; setReadReady(false); setMode(null);
        await refresh();
      }
    }
    finally { setSaving(false); }
  };

  const localeKeys = Object.keys(document.locales);
  const current = row(document.locales[locale]);
  const example = row(current.example); const endpoints = list(current.endpoints).map(row); const events = list(current.events).map(text);
  const disabled = !canWrite || loading || saving || Boolean(original) || !readReady;
  const setExample = (key: string, next: string) => updateLocale({ ...current, example: { ...example, [key]: next } });
  const changedLocales = baseline ? [...new Set([...Object.keys(document.locales), ...Object.keys(baseline.locales)])].filter((key) => JSON.stringify(document.locales[key]) !== JSON.stringify(baseline.locales[key])) : [];
  const empties = [endpoints.length === 0 && "接口列表是空的", events.filter((item) => item.trim()).length === 0 && "事件列表没有内容", (!text(example.request).trim() || !text(example.response).trim()) && "请求或响应示例是空的"].filter(Boolean) as string[];
  const savedContent = conflictDraft.current && baseline ? baseline : document;
  const originalFeedback = original && feedback(original);

  return <div className="rd-tab-stack" data-testid="published-content-developerDocs">
    {canWrite && <div className="rd-toolbar a3-savebar" data-end="">
      <span className="rd-toolbar-note" data-tone={dirty ? "warn" : undefined}>{dirty ? `有未保存的修改：${changedLocales.map(localeName).join("、") || "版本或状态"}` : "没有未保存的修改"}</span>
      <Button disabledReason={original ? "结果未知" : loading || !readReady ? "正在加载" : saving ? "正在保存" : deletedEdits.length ? UNRESOLVED_DELETION : !canSave("DRAFT") ? "内容没有变化，无需提交。" : undefined} onClick={() => { if (original || !readReady) return; setError(null); setMode("DRAFT"); }}>保存草稿…</Button>
      <Button variant="primary" disabledReason={original ? "结果未知" : loading || !readReady ? "正在加载" : saving ? "正在保存" : deletedEdits.length ? UNRESOLVED_DELETION : !canSave("PUBLISHED") ? "内容没有变化，无需提交。" : undefined} onClick={() => { if (original || !readReady) return; setError(null); setMode("PUBLISHED"); }}>发布…</Button>
    </div>}
    {conflictDraft.current && !mode
      ? <ConflictNotice ready={readReady && Boolean(baseline)} error={error} loading={loading} onReread={() => void refresh()} submitHint="点上方「保存草稿…」或「发布…」重新提交" originalFailure={originalFailure} hasDeletion={deletedEdits.length > 0} intent={remainingIntent}
        rows={baseline ? [
          ...deletedEditRows(deletedEdits),
          ...(document.version !== baseline.version ? [{ key: "version", label: "正文版本", text: <Change from={baseline.version || "空"} to={document.version || "空"} /> }] : []),
          ...[...new Set([...Object.keys(baseline.locales), ...localeKeys])].filter((key) => !same(document.locales[key], baseline.locales[key]))
            .map((key) => ({ key, label: localeName(key), text: localeParts(document.locales[key], baseline.locales[key], DOC_PARTS) })),
        ] : []} />
      : error && !mode && <Notice tone="danger">{error}</Notice>}
    <Panel title="开发者接口文档" icon={Code2} tone="role-2" sub={`${publicLine(savedContent)} · 正文版本 ${versionName(savedContent.version)}`}
      explain={<>
        <p>App 开发者页读取的接口示例、接口列表和事件。保存草稿不改 App 读到的内容，发布后才替换。</p>
        <p>还没发布过自己的版本时，App 读的是系统自带的默认文档。</p>
      </>}
      actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void refresh()}>刷新</Button>}>
      <div className="rd-toolbar a3-locale-bar">
        <Segments label="内容语言" value={locale} onChange={(value) => setLocale(String(value))} items={localeKeys.map((key) => ({ value: key, label: localeName(key), tone: changedLocales.includes(key) ? "progress" as const : undefined }))} />
        {canWrite && <span className="rd-row-actions">
          <Button size="sm" icon={<Plus size={14} aria-hidden />} aria-expanded={addingLocale} disabled={disabled} onClick={() => setAddingLocale(!addingLocale)}>新增语言</Button>
          <MoreMenu label="内容语言的更多操作" items={[{ key: "remove", label: "删除当前语言", danger: true, disabledReason: disabled ? "正在加载或保存" : localeKeys.length <= 1 ? "至少保留一种语言。" : undefined, onSelect: removeLocale }]} />
        </span>}
        <div className="a3-versions">
          <Field label="正文版本" hint="最多 64 字">{(control) => <Input {...control} className="a3-version" maxLength={64} value={document.version} disabled={disabled} onChange={(event) => setDocument({ ...document, version: event.target.value })} />}</Field>
        </div>
      </div>
      {addingLocale && canWrite && <Field label="新增语言" help="两个字母的语言代码或 fil，可带地区，例如 vi、fil、zh-cn">
        {(control) => <span className="a3-inline"><Input {...control} aria-label="新增语言" placeholder="例如 vi、zh-cn" value={newLocale} maxLength={11} disabled={disabled} onChange={(event) => setNewLocale(event.target.value)} /><Button size="sm" disabled={disabled} onClick={addLocale}>添加</Button></span>}
      </Field>}
      <div className="a3-with-preview">
        <div className="rd-form-stack">
          <div className="rd-form-grid" data-cols="2">
            <Field label="请求示例" hint="最多 10000 字">{(control) => <Textarea {...control} className="a3-code" rows={5} maxLength={10000} value={text(example.request)} disabled={disabled} onChange={(event) => setExample("request", event.target.value)} />}</Field>
            <Field label="响应示例" hint="最多 10000 字">{(control) => <Textarea {...control} className="a3-code" rows={5} maxLength={10000} value={text(example.response)} disabled={disabled} onChange={(event) => setExample("response", event.target.value)} />}</Field>
          </div>
          <fieldset className="a3-list" disabled={disabled}>
            <legend>接口列表 · {endpoints.length} 个</legend>
            {endpoints.map((item, index) => <div className="a3-list-row" data-kind="endpoint" key={index}>
              <Input aria-label={`接口 ${index + 1} 方法`} maxLength={16} value={text(item.method)} onChange={(event) => updateLocale({ ...current, endpoints: endpoints.map((entry, itemIndex) => itemIndex === index ? { ...entry, method: event.target.value } : entry) })} />
              <Input aria-label={`接口 ${index + 1} 路径`} maxLength={256} value={text(item.path)} onChange={(event) => updateLocale({ ...current, endpoints: endpoints.map((entry, itemIndex) => itemIndex === index ? { ...entry, path: event.target.value } : entry) })} />
              {!disabled && <IconButton aria-label={`删除接口 ${index + 1}`} onClick={() => updateLocale({ ...current, endpoints: endpoints.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} aria-hidden /></IconButton>}
            </div>)}
            {!disabled && endpoints.length < 100 && <div><Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => updateLocale({ ...current, endpoints: [...endpoints, { method: "GET", path: "/" }] })}>新增接口</Button></div>}
          </fieldset>
          <fieldset className="a3-list" disabled={disabled}>
            <legend>事件列表 · {events.length} 个</legend>
            {events.map((event, index) => <div className="a3-list-row" data-kind="event" key={index}>
              <Input aria-label={`事件 ${index + 1}`} maxLength={128} value={event} onChange={(changeEvent) => updateLocale({ ...current, events: events.map((item, itemIndex) => itemIndex === index ? changeEvent.target.value : item) })} />
              {!disabled && <IconButton aria-label={`删除事件 ${index + 1}`} onClick={() => updateLocale({ ...current, events: events.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={14} aria-hidden /></IconButton>}
            </div>)}
            {!disabled && events.length < 100 && <div><Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => updateLocale({ ...current, events: [...events, ""] })}>新增事件</Button></div>}
          </fieldset>
          {empties.length > 0 && <Notice tone="warn" title="这种语言还不完整">{empties.join("；")}。接口、事件至少各一项，示例不能空，不补齐保存不了。</Notice>}
        </div>
        <Preview title="开发者文档">
          <div className="a3-doc-preview" data-user-content="">
            <b>接口</b>
            {endpoints.length ? <ul>{endpoints.map((item, index) => <li key={index}><span className="a3-method">{text(item.method) || "—"}</span><span className="a3-path">{text(item.path) || "—"}</span></li>)}</ul> : <span className="a3-preview-empty">没有接口</span>}
            <b>事件</b>
            {events.some((item) => item.trim()) ? <ul className="a3-events">{events.filter((item) => item.trim()).map((item, index) => <li key={index}>{item}</li>)}</ul> : <span className="a3-preview-empty">没有事件</span>}
            <b>请求示例</b><pre>{text(example.request) || "—"}</pre>
            <b>响应示例</b><pre>{text(example.response) || "—"}</pre>
          </div>
        </Preview>
      </div>
      <Fold inset title="这种语言的原始内容" summary={`${localeName(locale)} · JSON，只读`}>
        <pre className="a3-json">{JSON.stringify(document.locales[locale], null, 2)}</pre>
      </Fold>
    </Panel>


    {mode && <SaveModal mode={mode} title={mode === "PUBLISHED" ? "发布开发者接口文档" : "保存开发者接口文档草稿"} busy={saving} locked={Boolean(original)} retry={original ? retry(original) : undefined} error={originalFeedback ? originalFeedback.detail : error} reason={original?.reason ?? reason} onReason={setReason} reasonMin={8}
      onCancel={() => setMode(null)} onConfirm={() => void save(mode)}
      facts={<DiffList rows={[
        { key: "status", label: "状态", before: STATUS_NAME[baseline?.status ?? ""] ?? "—", after: mode === "DRAFT" && baseline?.hasPublishedVersion ? "草稿，公开版不变" : STATUS_NAME[mode] },
        { key: "version", label: "正文版本", before: baseline?.version || "—", after: document.version || "—" },
        { key: "locales", label: "语言", before: Object.keys(baseline?.locales ?? {}).map(localeName).join("、") || "—", after: localeKeys.map(localeName).join("、") || "—" },
        { key: "content", label: "有改动的语言", before: "—", after: changedLocales.map(localeName).join("、") || "—" },
      ]} />}
      extra={<Notice tone="neutral">{originalFeedback ? originalFeedback.next : original ? <OriginalNote record={original} retry={retry(original)} /> : SAVE_UNKNOWN_NOTE}</Notice>} />}
  </div>;
}

/* ────────────────── 六类业务说明（W07） ────────────────── */

const PAGE_LABELS: Record<string, string> = { "genesis-how": "创世节点说明", "wallet-exchange-how": "兑换说明", "wallet-repurchase-how": "锁定计划说明", "team-binary-how": "团队平衡奖励说明", "team-commissions-how": "奖励明细说明", "team-unilevel-how": "团队奖励说明" };
const KEYS = ["genesis-how", "wallet-exchange-how", "wallet-repurchase-how", "team-binary-how", "team-commissions-how", "team-unilevel-how"] as const;
const KIND_NAME: Record<string, string> = { text: "正文", list: "列表", callout: "提示说明", ruleRef: "引用系统规则" };
const RETIRED = "wallet-repurchase-how";
function initialDocument(): PublishedHowContentDocument {
  const contents: Record<string, Record<string, unknown>> = {};
  for (const key of KEYS) contents[key] = { locales: { en: { blocks: [{ id: "intro", kind: "text", title: key, body: "" }] } } };
  return { version: "draft-local", status: "DRAFT", contents, revision: 0, source: "server", configKey: "how-it-works.published" };
}
/** 奖励明细说明里花括号的内容由 App 打开时按当前规则填（App commissions-how-content.ts）；认不出的那一块 App 显示「说明暂时无法加载」。 */
const APP_FILLED_PAGE = "team-commissions-how";
const APP_TOKENS: Record<string, string> = {
  directPurchaseRules: "好友购买的奖励规则", networkPurchaseRules: "团队购买的奖励说明", directDeviceRules: "好友设备收益的奖励规则",
  directScope: "好友设备收益发给谁", directPrice: "UVT 价格", coolingDays: "等待天数", binaryRules: "团队平衡奖励的发放周期",
  peerRules: "同级奖励说明", cultivationRules: "好友升级奖励说明", leadershipRules: "团队激励池的参与起点", leadershipVotes: "团队激励池票数",
  peerStatus: "同级奖励是否开放", genesisStatus: "创世节点奖励是否开放", exampleBase: "算例订单金额", exampleRank: "有好友升级奖励的等级",
};
function previewText(page: string, value: string): ReactNode {
  if (page !== APP_FILLED_PAGE) return value;
  return value.split(/(\{[A-Za-z]+\})/).map((part, i) => {
    const token = /^\{([A-Za-z]+)\}$/.exec(part)?.[1];
    if (!token) return part;
    const label = APP_TOKENS[token];
    return <mark key={i} className="a3-token" data-unknown={label ? undefined : ""} title={label ? "App 打开时按当前规则填进来" : "App 认不出这一项，这一块在 App 上会显示「说明暂时无法加载」"}>{label ?? `认不出的 ${part}`}</mark>;
  });
}
const hasAppToken = (blocks: Row[]) => blocks.some((block) => [block.title, block.body, ...list(block.items)].some((value) => /\{[A-Za-z]+\}/.test(text(value))));
const refBlocksOf = (entry: unknown) => Object.values(row(row(entry).locales)).flatMap((locale) => blocks(row(locale).blocks)).filter((block) => block.kind === "ruleRef");

function HowContent({ commands, recovery, onRecovered, incoming, toast, onDirty, retry, feedback }: ContentEditorProps) {
  const session = useAdminAuth((state) => state.session);
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [loadedDocument, setDocument] = useState<PublishedHowContentDocument | null>(null);
  const [loadedBaseline, setBaseline] = useState<PublishedHowContentDocument | null>(null);
  const [key, setKey] = useState<(typeof KEYS)[number]>(KEYS[0]);
  const [locale, setLocale] = useState("en");
  const [newLocale, setNewLocale] = useState("");
  const [addingLocale, setAddingLocale] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [readReady, setReadReady] = useState(false);
  const [originalFailure, setOriginalFailure] = useState<string | null>(null);
  const [intent, setIntent] = useState<Mode | null>(null);
  const [deletedEdits, setDeletedEdits] = useState<DeletedEdit[]>([]);
  const conflictDraft = useRef(false);
  const original = commands.find("how");
  const savedForm = original?.original.kind === "how" ? original.original : null;
  const document = mode && savedForm ? savedForm.document : loadedDocument;
  const baseline = mode && savedForm ? savedForm.baseline : loadedBaseline;
  useEffect(() => {
    if (recovery?.original.kind !== "how") return;
    setReason(recovery.reason); setMode(recovery.original.mode); setError(null); onRecovered();
  }, [recovery, onRecovered]);
  const busyRef = useRef(false);
  const identitySequence = useRef(0);
  const identities = useRef(new WeakMap<Row, { block: string; items: string[] }>());
  const contentHeading = useRef<HTMLHeadingElement | null>(null);
  const stateRef = useRef({ document: loadedDocument, baseline: loadedBaseline, key, locale });
  stateRef.current = { document: loadedDocument, baseline: loadedBaseline, key, locale };
  const refresh = useCallback(async (confirmDiscard = true, current?: PublishedHowContentDocument, failure?: FailedContentDraft) => {
    if (!canRead || busyRef.current) return false;
    const previous = stateRef.current;
    if (!conflictDraft.current && confirmDiscard && JSON.stringify(previous.document) !== JSON.stringify(previous.baseline)
      && !window.confirm("刷新会丢弃尚未保存的说明内容，是否继续？")) return false;
    setReadReady(false); busyRef.current = true; setLoading(true);
    if (!commands.find("how")) setMode(null);
    if (!conflictDraft.current) setError(null);
    try {
      const value = current ?? await fetchHowContentAdmin();
      if (!commands.find("how")) setMode(null);
      const next = Object.keys(value.contents).length ? value : { ...initialDocument(), ...value, contents: initialDocument().contents };
      const rejected = failure?.original.kind === "how" ? failure.original : null;
      if (current) {
        conflictDraft.current = Boolean(rejected);
        setOriginalFailure(rejected ? failure!.reason : null);
        setIntent(rejected?.mode ?? null);
        setMode(null); setReason(""); setError(null);
      }
      const deleted: DeletedEdit[] = [];
      const draft = rejected?.document ?? previous.document;
      const base = rejected?.baseline ?? previous.baseline;
      const editable = conflictDraft.current && draft && base ? rebaseDocument(next, draft, base, "contents", deleted) : next;
      const nextKey = editable.contents[previous.key] ? previous.key : KEYS.find(item => editable.contents[item]) ?? KEYS[0];
      const locales = row(row(editable.contents[nextKey]).locales);
      if (current || deleted.length) setDeletedEdits(edits => current ? deleted : [...edits, ...deleted]);
      setDocument(editable);
      setBaseline(next); setReadReady(true);
      setKey(nextKey);
      setLocale(locales[previous.locale] ? previous.locale : Object.keys(locales)[0] ?? "en");
      return true;
    }
    catch (cause) {
      setError(previous => conflictDraft.current && previous ? `${previous}；${displayAdminError(cause)}` : displayAdminError(cause));
      return false;
    }
    finally { busyRef.current = false; setLoading(false); }
  }, [canRead]);
  useEffect(() => { void refresh(false); }, [refresh]);
  const applyRead = useCallback((read: A3ContentRead) => "contents" in read.value ? refresh(false, read.value, read.failed) : Promise.resolve(false), [refresh]);
  useContentDelivery(incoming, !loading && !saving, applyRead);
  const current = row(row(document?.contents[key]).locales)[locale];
  const currentBlocks = blocks(row(current).blocks);
  const hasChanges = useMemo(() => JSON.stringify(document) !== JSON.stringify(baseline), [document, baseline]);
  const remainingIntent = intent && baseline && intent !== statusOf(baseline.status) ? intent : null;
  const dirty = hasChanges || Boolean(remainingIntent) || deletedEdits.length > 0;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  if (!canRead) return <BlockState state="denied" title="没有查看业务说明的权限" />;
  if (loading && !document) return <BlockState state="loading" title="读取说明内容中…" />;
  if (!document) return <BlockState state="error" title="说明内容加载失败" detail={<>{error} 读不到不等于没有内容：App 可能仍在显示之前发布的或系统自带的说明。</>} onRetry={() => void refresh()} />;

  const locked = !canWrite || loading || saving || Boolean(original) || !readReady;
  const patchLocale = (next: Row) => { if (!document || locked || busyRef.current) return; const entry = row(document.contents[key]); const locales = row(entry.locales); setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, locales: { ...locales, [locale]: next } } } }); };
  const patchEntryVersion = (next: string) => { if (!document || locked || busyRef.current) return; const entry = row(document.contents[key]); setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, version: next } } }); };
  const addLocale = () => { if (!document || locked || busyRef.current) return; const normalized = newLocale.trim().toLowerCase().replace("_", "-"); if (!/^(?:[a-z]{2}|fil)(?:-[a-z0-9]{2,8})?$/.test(normalized)) { setError("语言代码格式无效，例如 en、zh、vi 或 zh-cn。"); return; } const entry = row(document.contents[key]); const locales = row(entry.locales); if (locales[normalized]) { setLocale(normalized); setNewLocale(""); setAddingLocale(false); return; } if (Object.keys(locales).length >= 10) { setError("单页最多 10 种语言。"); return; } setDocument({ ...document, contents: { ...document.contents, [key]: { ...entry, locales: { ...locales, [normalized]: { blocks: [{ id: "intro", kind: "text", title: key, body: "" }] } } } } }); setLocale(normalized); setNewLocale(""); setError(null); setAddingLocale(false); };
  // UI identity is independent of the editable business ID and never enters the API payload.
  const nextIdentity = (kind: string) => `how-${kind}-${++identitySequence.current}`;
  const identityOf = (item: Row) => {
    let identity = identities.current.get(item);
    if (!identity) {
      identity = { block: nextIdentity("block"), items: Array.isArray(item.items) ? item.items.map(() => nextIdentity("item")) : [] };
      identities.current.set(item, identity);
    }
    return identity;
  };
  const patchBlock = (index: number, patch: Row, replace = false, listKeys?: string[]) => {
    const previous = currentBlocks[index];
    const next = replace ? patch : { ...previous, ...patch };
    const identity = identityOf(previous);
    const itemCount = Array.isArray(next.items) ? next.items.length : 0;
    identities.current.set(next, { block: identity.block, items: listKeys ?? Array.from({ length: itemCount }, (_, i) => identity.items[i] ?? nextIdentity("item")) });
    patchLocale({ ...row(current), blocks: currentBlocks.map((item, i) => i === index ? next : item) });
  };
  const removeBlock = (index: number) => {
    if (locked || busyRef.current || currentBlocks.length <= 1) return;
    patchLocale({ ...row(current), blocks: currentBlocks.filter((_, i) => i !== index) });
    contentHeading.current?.focus();
  };
  const removeListItem = (index: number, itemIndex: number) => {
    const item = currentBlocks[index];
    if (locked || busyRef.current || !Array.isArray(item.items) || item.items.length <= 1) return;
    patchBlock(index, { items: item.items.filter((_, i) => i !== itemIndex) }, false,
      identityOf(item).items.filter((_, i) => i !== itemIndex));
    contentHeading.current?.focus();
  };
  const changeKind = (index: number, kind: string) => {
    const next: Row = { ...currentBlocks[index], kind };
    delete next.ref; delete next.items;
    if (kind === "ruleRef") next.ref = { source: "canonical", key: "", version: "" };
    if (kind === "list") next.items = [""];
    patchBlock(index, next, true);
  };
  const addBlock = () => {
    if (!current || currentBlocks.length >= 200) return;
    let number = currentBlocks.length + 1;
    while (currentBlocks.some(item => item.id === `block-${number}`)) number++;
    patchLocale({ ...row(current), blocks: [...currentBlocks, { id: `block-${number}`, kind: "text", title: "", body: "" }] });
  };
  const canSave = (target: Mode) => deletedEdits.length === 0 && (hasChanges || target !== statusOf(baseline?.status ?? document.status));
  const save = async (target: Mode) => {
    if (!document || locked || busyRef.current) return;
    if (reason.trim().length < 8 || reason.trim().length > 500) { setError("变更理由需至少 8 个字符。"); return; }
    if (target === "PUBLISHED" && publishBlockedReasons.length) { setError(`还有没替换的占位符，不能发布：${spotsShown.join("；")}${spotsMore ? ` 等 ${spotsMore + spotsShown.length} 处` : ""}`); return; }
    if (!canSave(target)) { setError("内容没有变化，无需提交。"); return; }
    busyRef.current = true; setSaving(true); setError(null);
    try {
      const payload = { ...document, status: target };
      const record = commands.capture({ original: { kind: "how", document: payload, baseline: baseline!, mode: target },
        path: "/api/admin/content/how-it-works", method: "PUT", body: JSON.stringify({ ...payload, expectedRevision: payload.revision, revision: undefined, reason: reason.trim() }),
        reason: reason.trim(), name: "业务说明", change: `${STATUS_NAME[baseline!.status]} → ${STATUS_NAME[target]} · ${document.version}` });
      await commands.send(record);
      conflictDraft.current = false;
      setOriginalFailure(null); setIntent(null); setDeletedEdits([]);
      setReadReady(false); setReason(""); setMode(null);
      toast(target === "PUBLISHED" ? "业务说明已发布" : "草稿已保存，App 读到的不变", "success");
      busyRef.current = false;
      await refresh(false);
    }
    catch (cause) {
      if ((cause as { reasonCode?: string }).reasonCode === "HOW_CONTENT_VERSION_CONFLICT" && !commands.find("how")) {
        setOriginalFailure(null); setIntent(target); setReason("");
        setError(displayAdminError(cause));
        conflictDraft.current = true; setReadReady(false); setMode(null); busyRef.current = false;
        await refresh(false);
      } else setError(`${displayAdminError(cause)}；当前未保存内容已保留。刷新会丢弃本地修改，请先核对并保留需要的内容。`);
    }
    finally { busyRef.current = false; setSaving(false); }
  };

  const pageChanged = (item: string) => JSON.stringify(document.contents[item]) !== JSON.stringify(baseline?.contents[item]);
  const changedPages = KEYS.filter(pageChanged);
  const refPages = KEYS.filter((item) => refBlocksOf(document.contents[item]).length > 0);
  /** A3-PD01：和后端发布检查一样查全部页面、语言的标题、正文、列表项；草稿不受影响。每处写哪一页、哪种语言、第几块的哪几部分。 */
  const placeholderSpots = Object.entries(document.contents).flatMap(([page, entry]) => Object.entries(row(entry.locales)).flatMap(([lang, locale]) =>
    blocks(row(locale).blocks).flatMap((block, index) => {
      const parts = [text(block.title).includes("{value}") && "标题", text(block.body).includes("{value}") && "正文",
        list(block.items).some(value => text(value).includes("{value}")) && "列表项"].filter(Boolean);
      return parts.length ? [`${PAGE_LABELS[page] ?? page} · ${localeName(lang)} · 第 ${index + 1} 块的${parts.join("、")}`] : [];
    })));
  const publishBlockedReasons = placeholderSpots;
  const spotsShown = placeholderSpots.slice(0, 3), spotsMore = placeholderSpots.length - spotsShown.length;
  const entry = row(document.contents[key]);
  const localeKeys = Object.keys(row(entry.locales));
  const entryVersion = text(entry.version);

  const savedContent = conflictDraft.current && baseline ? baseline : document;
  const originalFeedback = original && feedback(original);
  return <div className="rd-tab-stack" data-testid="published-content-how">
    {canWrite && <div className="rd-toolbar a3-savebar" data-end="">
      <span className="rd-toolbar-note" data-tone={dirty ? "warn" : undefined}>{dirty ? `有未保存的修改：${changedPages.map((item) => PAGE_LABELS[item]).join("、") || "文档版本或状态"}` : "没有未保存的修改"}</span>
      <Button disabledReason={original ? "结果未知" : locked ? "正在加载或保存" : deletedEdits.length ? UNRESOLVED_DELETION : !canSave("DRAFT") ? "内容没有变化，无需提交。" : undefined} onClick={() => { if (original || !readReady) return; setError(null); setMode("DRAFT"); }}>保存草稿…</Button>
      <Button variant="primary" disabledReason={original ? "结果未知" : locked ? "正在加载或保存" : deletedEdits.length ? UNRESOLVED_DELETION : publishBlockedReasons.length ? "还有没替换的占位符，不能发布" : !canSave("PUBLISHED") ? "内容没有变化，无需提交。" : undefined} onClick={() => { if (original || !readReady) return; setError(null); setMode("PUBLISHED"); }}>发布…</Button>
    </div>}
    {conflictDraft.current && !mode
      ? <ConflictNotice ready={readReady && Boolean(baseline)} error={error} loading={loading} onReread={() => void refresh(false)} submitHint="点上方「保存草稿…」或「发布…」重新提交" originalFailure={originalFailure} hasDeletion={deletedEdits.length > 0} intent={remainingIntent}
        rows={baseline ? [
          ...deletedEditRows(deletedEdits),
          ...(document.version !== baseline.version ? [{ key: "version", label: "文档版本", text: <Change from={baseline.version || "空"} to={document.version || "空"} /> }] : []),
          ...changedPages.map((item) => {
            const mineLocales = row(row(document.contents[item]).locales), latestLocales = row(row(baseline.contents[item]).locales);
            const locales = [...new Set([...Object.keys(latestLocales), ...Object.keys(mineLocales)])].filter((key) => !same(mineLocales[key], latestLocales[key]));
            const versionDiffers = !same(row(document.contents[item]).version, row(baseline.contents[item]).version);
            return { key: item, label: PAGE_LABELS[item] ?? item, text: [versionDiffers && "本页版本不同", ...locales.map((key) => `${localeName(key)}：${localeParts(mineLocales[key], latestLocales[key], [["内容块", (v) => v.blocks]])}`)].filter(Boolean).join("；") || "页面设置不同" };
          }),
        ] : []} />
      : error && !mode && <Notice tone="danger">{error}</Notice>}
    {placeholderSpots.length > 0 && <Notice tone="danger" title={`${placeholderSpots.length} 处还有没替换的占位符，现在不能发布`}>
      {spotsShown.map((spot) => <span key={spot} className="a3-check-line">{spot}</span>)}
      {spotsMore > 0 && <span className="a3-check-line">还有 {spotsMore} 处</span>}
      <span className="a3-check-line">把占位符（如 {"{value}"}）换成实际文字，或删掉那一块，再发布；保存草稿不受影响。</span>
    </Notice>}
    <Panel title="业务说明内容" icon={BookOpenText} tone="role-4" sub={`6 页 · ${publicLine(savedContent)} · 文档版本 ${versionName(savedContent.version)}`}
      explain={<>
        <p>App 的「怎么玩」「规则说明」读这六页内容；锁定计划说明的入口已退役，内容仍一起维护。六页一起保存、一起发布，发布时六页都要有内容。</p>
        <p>还没发布过自己的版本时，App 读的是系统自带的默认说明。</p>
      </>}
      actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} disabledReason={saving ? "正在保存" : undefined} onClick={() => void refresh()}>刷新</Button>}>
      <div className="a3-pages" role="group" aria-label="内容页面">
        {KEYS.map((item) => {
          const pageEntry = row(document.contents[item]);
          const count = Object.keys(row(pageEntry.locales)).length;
          const refs = refBlocksOf(pageEntry).length;
          return <button key={item} type="button" className="a3-page-card" aria-pressed={item === key} disabled={loading || saving}
            onClick={() => { setKey(item); setLocale(Object.keys(row(row(document.contents[item]).locales))[0] ?? "en"); }}>
            <span className="a3-page-name">{PAGE_LABELS[item] ?? item}</span>
            <span className="a3-page-meta">{document.contents[item] ? `${count} 种语言 · 版本 ${versionName(text(pageEntry.version) || document.version)}` : "这页还没有内容"}</span>
            <span className="a3-page-tags">
              {pageChanged(item) && <StatusTag tone="progress">未保存</StatusTag>}
              {refs > 0 && <StatusTag tone="warn" icon={TriangleAlert}>{refs} 个规则引用</StatusTag>}
              {item === RETIRED && <StatusTag tone="neutral" icon={Archive}>App 入口已退役</StatusTag>}
            </span>
          </button>;
        })}
      </div>

      <div className="rd-toolbar a3-locale-bar">
        <Segments label="内容语言" value={locale} onChange={(value) => setLocale(String(value))} items={localeKeys.map((item) => ({ value: item, label: localeName(item) }))} />
        {canWrite && <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={locked ? "正在加载或保存" : undefined} aria-expanded={addingLocale} onClick={() => setAddingLocale(!addingLocale)}>新增语言</Button>}
        <div className="a3-versions">
        <Field label={`本页版本（${PAGE_LABELS[key] ?? key}）`} explain="不填就用文档版本；填过再清空会保存不了。" hint="最多 64 字">
          {(control) => <Input {...control} className="a3-version" value={entryVersion} maxLength={64} disabled={locked} placeholder="例如 2026.09.01-genesis-guide" onChange={(event) => patchEntryVersion(event.target.value)} />}
        </Field>
        <Field label="文档版本" hint="最多 64 字">{(control) => <Input {...control} className="a3-version" value={document.version} maxLength={64} disabled={locked} onChange={e => setDocument({ ...document, version: e.target.value })} />}</Field>
        </div>
      </div>
      {addingLocale && canWrite && <Field label="新增内容语言" help="两个字母的语言代码或 fil，可带地区，例如 vi、fil、zh-cn；加了不能在这里删">
        {(control) => <span className="a3-inline"><Input {...control} aria-label="新增内容语言" placeholder="vi" value={newLocale} maxLength={11} disabled={locked} onChange={(event) => setNewLocale(event.target.value)} /><Button size="sm" disabled={locked} onClick={addLocale}>添加</Button></span>}
      </Field>}
      {key === RETIRED && <Notice tone="neutral">App 的锁定计划入口已退役，用户从旧入口会被带到个人中心、看不到这页；内容照常维护和保存。</Notice>}

      <div className="a3-with-preview">
        <div className="rd-form-stack">
          <h3 className="a3-blocks-title" ref={contentHeading} tabIndex={-1}>内容块 · {currentBlocks.length} 个</h3>
          {!current && <p className="rd-note">本页尚无所选语言内容，请先新增语言。</p>}
          {currentBlocks.map((item, index) => <Fold key={identityOf(item).block} inset title={`${index + 1}. ${text(item.title) || "未填标题"}`} summary={`${KIND_NAME[text(item.kind)] ?? text(item.kind)} · ${text(item.id) || "未填标识"}`}
            alert={item.kind === "ruleRef"}>
            <div className="rd-form-stack">
              <div className="rd-form-grid" data-cols="2">
                <Field label="块标识" hint="同一语言里不能重复">{(control) => <Input {...control} value={text(item.id)} maxLength={64} disabled={locked} onChange={e => patchBlock(index, { id: e.target.value })} />}</Field>
                <Field label="类型">{(control) => <Select {...control} aria-label={`内容块 ${index + 1} 类型`} value={text(item.kind)} disabled={locked} onChange={(value) => changeKind(index, value)} options={[{ value: "text", label: "正文" }, { value: "list", label: "列表" }, { value: "callout", label: "提示说明" }, { value: "ruleRef", label: "引用系统规则" }]} />}</Field>
              </div>
              <Field label="标题">{(control) => <Input {...control} value={text(item.title)} maxLength={256} disabled={locked} onChange={e => patchBlock(index, { title: e.target.value })} />}</Field>
              <Field label="正文" help={item.kind === "ruleRef" ? <>必须保留 {"{value}"}，不然草稿也存不了</> : key === APP_FILLED_PAGE && /\{[A-Za-z]+\}/.test(text(item.body)) ? "花括号里的由 App 打开时自动填，原样保留" : undefined}>{(control) => <Textarea {...control} rows={3} value={text(item.body)} maxLength={20000} disabled={locked} onChange={e => patchBlock(index, { body: e.target.value })} />}</Field>
              {item.kind === "ruleRef" && <>
                <Notice tone="warn" title="规则引用块发布不了">发布时系统会拒绝含这种块的说明，草稿照常能存。要发布，先删掉这一块或改成「正文」。</Notice>
                <div className="rd-form-grid" data-cols="2">
                  <Field label="规则标识">{(control) => <Input {...control} value={text(row(item.ref).key)} maxLength={160} disabled={locked} onChange={e => patchBlock(index, { ref: { ...row(item.ref), source: "canonical", key: e.target.value } })} />}</Field>
                  <Field label="引用版本">{(control) => <Input {...control} value={text(row(item.ref).version)} maxLength={128} disabled={locked} onChange={e => patchBlock(index, { ref: { ...row(item.ref), source: "canonical", version: e.target.value } })} />}</Field>
                </div>
              </>}
              {item.kind === "list" && <fieldset className="a3-list">
                <legend>列表项 · {(Array.isArray(item.items) ? item.items : []).length} 项</legend>
                {(Array.isArray(item.items) ? item.items : []).map((value, itemIndex, items) => <div className="a3-list-row" data-kind="item" key={identityOf(item).items[itemIndex]}>
                  <Textarea aria-label={`列表项 ${itemIndex + 1}`} rows={1} value={text(value)} maxLength={2000} disabled={locked} onChange={e => patchBlock(index, { items: items.map((entryValue, i) => i === itemIndex ? e.target.value : entryValue) })} />
                  {canWrite && <IconButton aria-label={`删除 ${key} 内容块 ${text(item.id)} 的列表项 ${itemIndex + 1}${text(value) ? `：${text(value)}` : ""}`} disabled={locked || items.length <= 1} onClick={() => removeListItem(index, itemIndex)}><Trash2 size={14} aria-hidden /></IconButton>}
                </div>)}
                {canWrite && <div><Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={locked ? "正在加载或保存" : Array.isArray(item.items) && item.items.length >= 50 ? "最多 50 项" : undefined} onClick={() => patchBlock(index, { items: [...(Array.isArray(item.items) ? item.items : []), ""] })}>新增列表项</Button></div>}
              </fieldset>}
              {canWrite && <div><Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} aria-label={`删除内容块 ${text(item.id)}（${key}）`} disabledReason={locked ? "正在加载或保存" : currentBlocks.length <= 1 ? "至少保留一个内容块" : undefined} onClick={() => removeBlock(index)}>删除内容块</Button></div>}
            </div>
          </Fold>)}
          {canWrite && <div><Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={locked ? "正在加载或保存" : !current ? "先新增语言" : currentBlocks.length >= 200 ? "最多 200 个内容块" : undefined} onClick={addBlock}>新增内容块</Button></div>}
        </div>
        <Preview title={PAGE_LABELS[key] ?? key}>
          <div className="a3-how-preview" data-user-content="">
            <b className="a3-how-page">{PAGE_LABELS[key] ?? key} · {localeName(locale)}</b>
            {currentBlocks.length === 0 && <span className="a3-preview-empty">这种语言还没有内容</span>}
            {key === APP_FILLED_PAGE && hasAppToken(currentBlocks) && <span className="a3-preview-empty">标色的是 App 打开时按当前规则自动填的内容</span>}
            {currentBlocks.map((item, index) => <section key={index} data-kind={text(item.kind)}>
              {text(item.title) && <h4>{previewText(key, text(item.title))}</h4>}
              {text(item.body) && <p>{item.kind === "ruleRef" ? text(item.body).split("{value}").flatMap((part, i) => i === 0 ? [part] : [<mark key={i}>{"{value}"}</mark>, part]) : previewText(key, text(item.body))}</p>}
              {item.kind === "list" && <ul>{list(item.items).map((value, i) => <li key={i}>{previewText(key, text(value))}</li>)}</ul>}
              {item.kind === "ruleRef" && <span className="a3-preview-empty">规则引用块，不能发布</span>}
            </section>)}
          </div>
        </Preview>
      </div>
    </Panel>


    {mode && <SaveModal mode={mode} title={mode === "PUBLISHED" ? "发布业务说明" : "保存业务说明草稿"} busy={saving} locked={Boolean(original)} retry={original ? retry(original) : undefined} error={originalFeedback ? originalFeedback.detail : error} reason={original?.reason ?? reason} onReason={setReason} reasonMin={8}
      onCancel={() => setMode(null)} onConfirm={() => void save(mode)}
      facts={<DiffList rows={[
        { key: "status", label: "状态", before: STATUS_NAME[baseline?.status ?? ""] ?? "—", after: mode === "DRAFT" && baseline?.hasPublishedVersion ? "草稿，公开版不变" : STATUS_NAME[mode] },
        { key: "version", label: "文档版本", before: baseline?.version || "—", after: document.version || "—" },
        { key: "pages", label: "有改动的页面", before: "—", after: changedPages.map((item) => PAGE_LABELS[item]).join("、") || "—" },
      ]} />}
      extra={<>
        {mode === "PUBLISHED" && refPages.length > 0 && <Notice tone="danger" title="规则引用块发布不了">{refPages.map((item) => PAGE_LABELS[item]).join("、")}含规则引用块，系统会拒绝这次发布。先删掉这些块，或改成「正文」写上实际文字。</Notice>}
        <Notice tone="neutral">{originalFeedback ? originalFeedback.next : original ? <OriginalNote record={original} retry={retry(original)} /> : <>六页一起保存。{SAVE_UNKNOWN_NOTE}</>}<Explain label="App 什么时候读到" content="发布后 App 下次打开这些说明页时读到新内容；网络断开时可能先显示之前读到的那份。" /></Notice>
      </>} />}
  </div>;
}
