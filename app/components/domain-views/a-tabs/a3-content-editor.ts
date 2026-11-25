"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentRecoveryActor } from "@/lib/admin/abe-recovery-access";
import { a3ContentVersionConflict, isA3ContentCommand, type A3Command, type A3ContentOriginal, type A3RecoveryProps } from "@/lib/admin/a3-mutations";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { parseDeveloperDocs, parseHowContent } from "@/lib/admin/published-content-client";
import { useAdminAuth } from "@/lib/store/admin-auth";

type Kind = A3ContentOriginal["kind"];
export type Mode = A3ContentOriginal["mode"];
export type ContentDocument = A3ContentOriginal["document"];
export type ContentCommand = A3Command & { original: A3ContentOriginal };
export type A3ContentRead = {
  value: ContentDocument;
  failed?: { record: ContentCommand; reason: string; closed?: boolean };
  onApplied?: () => void;
  onFailed?: (reason: string) => void;
  onExpired?: () => void;
};
export type A3ContentReads = Partial<Record<Kind, A3ContentRead>> & { selected?: Kind };
export type Row = Record<string, unknown>;
export const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const text = (value: unknown) => typeof value === "string" ? value : "";
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Reference = { commandKey: string; input: ContentDocument };
const referenceKey = (owner: number, kind: Kind) => `nexion-admin-a3-reference-v1:${owner}:${kind}`;
const referenceWriteError = "上次的内容无法存入此标签页的对照，原操作记录和修改锁仍保留。";
export const REFERENCE_BLOCKED = "先对照上次没保存成功的内容，处理完点『放弃我上次的内容』再保存";
export const READBACK_FAILED = "已保存，最新内容暂时读不到";
export const CONFLICT_READ_FAILED = "没有保存，最新版本暂时读不到";

function readReference(owner: number, kind: Kind): Reference | null {
  const value = window.sessionStorage.getItem(referenceKey(owner, kind));
  if (value === null) return null;
  const saved = JSON.parse(value) as Reference;
  if (typeof saved.commandKey !== "string") throw new Error("对照记录无法读取。");
  const input = kind === "docs" ? parseDeveloperDocs(saved.input) : parseHowContent(saved.input);
  return { commandKey: saved.commandKey, input };
}

function storeReference(original: ContentCommand, owner: number) {
  if (original.commandOwnerId !== owner || !currentRecoveryActor(owner)) throw new Error("当前账号无法接收原操作内容。");
  const kind = original.original.kind;
  const before = readReference(owner, kind);
  if (before && before.commandKey !== original.commandKey) throw new Error("请先处理这个编辑器已有的对照，再重试交接。");
  const reference = { commandKey: original.commandKey, input: original.original.document };
  const encoded = JSON.stringify(reference);
  const key = referenceKey(owner, kind);
  window.sessionStorage.setItem(key, encoded);
  if (window.sessionStorage.getItem(key) !== encoded) throw new Error(referenceWriteError);
  return reference;
}

function handoffExpired(failed: A3ContentRead["failed"]) {
  return failed && !failed.closed && isRetryExpired(failed.record);
}

export function useDraftRefresh(dirty: boolean, refresh: () => void) {
  const [asking, setAsking] = useState(false);
  return {
    request: () => { if (dirty) setAsking(true); else refresh(); },
    dialog: {
      asking,
      stay: () => setAsking(false),
      discard: () => { setAsking(false); refresh(); },
      startSave: () => { setAsking(false); return () => {}; },
    },
  };
}

export function useContentEditor<D extends ContentDocument>({
  kind, readLatest, matches, commands, recovery, onRecovered, incoming, toast,
}: Omit<A3RecoveryProps, "nonce"> & {
  kind: Kind; readLatest: () => Promise<D>; matches: (value: ContentDocument) => value is D;
  incoming?: A3ContentRead; toast: (message: string, kind?: "success" | "warn") => void;
}) {
  const session = useAdminAuth(state => state.session);
  const owner = session?.adminId;
  const canRead = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_read") === true;
  const canWrite = session?.role === "superadmin" || session?.authorities?.includes("platform_a3_write") === true;
  const [loadedDocument, setDocument] = useState<D | null>(null);
  const [loadedBaseline, setBaseline] = useState<D | null>(null);
  const [referenceState, setReferenceState] = useState<{ owner: number; value?: Reference | null; error?: string }>();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<Mode | null>(null);
  const [readReady, setReadReady] = useState(false);
  const [intent, setIntent] = useState<Mode | null>(null);
  const [readbackError, setReadbackError] = useState<string | null>(null);
  const [compareError, setCompareError] = useState<string | null>(null);
  const [delivered, setDelivered] = useState<{ read: A3ContentRead; error?: string; reference?: ContentCommand }>();
  const [directDelivered, setDirectDelivered] = useState<ContentCommand>();
  const [readbackContinuation, setReadbackContinuation] = useState<(() => void) | null>(null);
  const readInFlight = useRef(false);
  const afterSave = useRef<(() => void) | null>(null);
  const afterReadback = useRef<(() => void) | null>(null);
  const awaitingReadback = useRef(false);
  const latestCommands = useRef(commands);
  latestCommands.current = commands;

  const original = commands.find(kind);
  const savedForm = original && isA3ContentCommand(original) ? original.original : null;
  const direct = original?.directContentConflict;
  const originalInput = savedForm?.document;
  const originalBase = savedForm?.baseline;
  const document = (mode && original || direct && !readReady) && originalInput && matches(originalInput) ? originalInput : loadedDocument;
  const baseline = mode && original && originalBase && matches(originalBase) ? originalBase : loadedBaseline;
  const reference = referenceState?.owner === owner ? referenceState?.value : undefined;
  const referenceError = referenceState?.owner === owner ? referenceState?.error : undefined;

  useEffect(() => {
    if (!owner || !canRead) return;
    try { setReferenceState({ owner, value: readReference(owner, kind) }); }
    catch { setReferenceState({ owner, error: "上次的内容对照无法读取，请刷新后重试。" }); }
  }, [owner, canRead, kind]);
  useEffect(() => {
    if (recovery?.original.kind !== kind) return;
    setReason(recovery.reason); setMode(recovery.original.mode); setError(null); onRecovered();
  }, [kind, recovery, onRecovered]);

  const install = useCallback((value: D, failed?: A3ContentRead["failed"]) => {
    if (failed && (!owner || failed.record.commandOwnerId !== owner || !currentRecoveryActor(owner))) {
      return { error: "当前账号无法接收原操作内容。" };
    }
    const input = failed?.record.original.document;
    const canRestore = input && matches(input) && !failed.record.directContentConflict
      && input.revision > 0 && input.revision === value.revision;
    setBaseline(value);
    setDocument(canRestore ? { ...input, status: value.status } : value);
    setMode(null); setReason(""); setError(null);
    setIntent(canRestore ? failed.record.original.mode : null);
    setNotice(canRestore ? failed.reason : null);
    setReadReady(true);
    return { reference: failed && !canRestore ? failed.record : undefined };
  }, [matches, owner]);

  const saveReference = useCallback((reference?: ContentCommand) => {
    if (!reference) return;
    try {
      if (!owner) throw new Error(referenceWriteError);
      setReferenceState({ owner, value: storeReference(reference, owner) });
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith("请先处理")) return cause.message;
      if (cause instanceof DOMException && cause.name === "QuotaExceededError") return `此标签页存储空间不足。${referenceWriteError}`;
      return referenceWriteError;
    }
  }, [owner]);

  useLayoutEffect(() => {
    if (!incoming || delivered?.read === incoming || loading || saving || !canRead || !matches(incoming.value)) return;
    if (handoffExpired(incoming.failed)) { incoming.onExpired?.(); return; }
    setDelivered({ read: incoming, ...install(incoming.value, incoming.failed) });
  }, [incoming, delivered, loading, saving, canRead, matches, install]);
  useLayoutEffect(() => {
    if (!incoming || delivered?.read !== incoming || !matches(incoming.value)) return;
    // Recheck after the editor commits. A comparison is only persisted from this step.
    if (handoffExpired(incoming.failed)) {
      if (!delivered.error) install(incoming.value);
      incoming.onExpired?.();
      return;
    }
    const failure = delivered.error ?? saveReference(delivered.reference);
    if (failure) incoming.onFailed?.(failure);
    else incoming.onApplied?.();
  }, [delivered, incoming, install, matches, saveReference]);
  useEffect(() => {
    if (directDelivered) latestCommands.current.settleContent(directDelivered);
  }, [directDelivered]);
  useEffect(() => {
    if (!readbackContinuation) return;
    // The leave guard can now see the draft state committed by both editors.
    setReadbackContinuation(null);
    readbackContinuation();
  }, [readbackContinuation]);

  const refresh = useCallback(async (knownConflict?: ContentCommand) => {
    if (!canRead || readInFlight.current) return false;
    const pending = knownConflict ?? latestCommands.current.find(kind);
    const conflict = pending?.directContentConflict && isA3ContentCommand(pending) ? pending : undefined;
    readInFlight.current = true;
    setReadReady(false); setLoading(true); setError(null);
    try {
      const value = conflict ? await latestCommands.current.readPendingContent(conflict) : await readLatest();
      if (!matches(value)) return false;
      const installed = install(value, conflict && { record: conflict, reason: CONFLICT_READ_FAILED });
      const failure = installed.error ?? saveReference(installed.reference);
      setCompareError(failure ?? null);
      if (failure) return false;
      if (conflict) setDirectDelivered(conflict);
      setReadbackError(null);
      awaitingReadback.current = false;
      const proceed = afterReadback.current;
      afterReadback.current = null;
      if (proceed) setReadbackContinuation(() => proceed);
      return true;
    } catch (cause) {
      const message = displayAdminReadError(cause);
      if (conflict) setCompareError(message);
      else if (awaitingReadback.current) setReadbackError(message);
      else setError(message);
      return false;
    } finally {
      readInFlight.current = false;
      setLoading(false);
    }
  }, [canRead, kind, readLatest, matches, install, saveReference]);
  useEffect(() => { void refresh(); }, [refresh]);

  const body = (value: D) => "locales" in value ? value.locales : value.contents;
  const hasChanges = !!loadedDocument && !!loadedBaseline &&
    (loadedDocument.version !== loadedBaseline.version || !same(body(loadedDocument), body(loadedBaseline)));
  const remainingIntent = intent && loadedBaseline && intent !== (loadedBaseline.status === "UNPUBLISHED" ? "DRAFT" : loadedBaseline.status) ? intent : null;
  const dirty = !readbackError && (hasChanges || remainingIntent === "DRAFT");
  const commonBlocked = reference ? REFERENCE_BLOCKED : referenceError ?? (reference === undefined ? "正在读取内容对照"
    : direct ? compareError || CONFLICT_READ_FAILED
    : original ? "原操作尚未解除"
    : readbackError ? READBACK_FAILED
    : !readReady || loading || saving ? "正在加载或保存" : undefined);

  const beginSave = (target: Mode, saved?: () => void) => {
    afterSave.current = saved ?? null;
    setError(null); setMode(target);
  };
  const cancelSave = () => { afterSave.current = null; setMode(null); };
  const discardDraft = () => { setDocument(loadedBaseline); setIntent(null); setNotice(null); setError(null); };
  const discardReference = () => {
    if (!reference || !owner) return;
    try {
      const key = referenceKey(owner, kind);
      window.sessionStorage.removeItem(key);
      if (window.sessionStorage.getItem(key) !== null) throw new Error("对照未删除，请重试。");
      setReferenceState({ owner, value: null });
      setCompareError(null);
    } catch { setCompareError("对照未删除，请重试。"); }
  };
  const save = async (target: Mode, blocked: string | undefined, name: string, path: string) => {
    if (!canWrite || blocked || !baseline || !document || saving || readInFlight.current) return;
    const note = reason.trim();
    if (note.length < 8 || note.length > 500) { setError("变更理由需为 8–500 个字符。"); return; }
    const proceed = afterSave.current;
    afterSave.current = null;
    setSaving(true); setError(null);
    try {
      const payload = { ...(target === "PUBLISHED" ? baseline : document), status: target };
      const originalInput = { kind, document: payload, baseline, mode: target } as A3ContentOriginal;
      const record = commands.capture({ original: originalInput, path, method: "PUT",
        body: JSON.stringify({ ...payload, expectedRevision: baseline.revision, revision: undefined, reason: note }),
        reason: note, name, change: `${baseline.status === "PUBLISHED" ? "已发布" : "草稿"} → ${target === "PUBLISHED" ? "已发布" : "草稿"} · ${payload.version}` });
      await commands.send(record);
      setNotice(null); setIntent(null);
      setReadReady(false); setReason(""); setMode(null);
      afterReadback.current = proceed;
      awaitingReadback.current = true;
      await refresh();
      if (!proceed) toast(target === "PUBLISHED" ? `${name}已发布` : "草稿已保存，App 读到的不变", "success");
    } catch (cause) {
      const conflict = latestCommands.current.find(kind);
      if (conflict && isA3ContentCommand(conflict) && a3ContentVersionConflict((cause as { reasonCode?: string }).reasonCode)) {
        setMode(null); setReason(""); setNotice(null);
        await refresh({ ...conflict, directContentConflict: true });
      } else setError(displayAdminError(cause));
    } finally { setSaving(false); }
  };
  return { canRead, canWrite, document, baseline, original, loading, saving, mode, reason, setReason, error, notice,
    readReady, dirty, hasChanges, remainingIntent, commonBlocked, direct, readbackError, compareError, reference, referenceError,
    beginSave, cancelSave, discardReference, discardDraft, save, setDocument, setError, refresh };
}
