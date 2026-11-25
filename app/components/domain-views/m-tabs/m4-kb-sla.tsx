"use client";

/** M4 help center content. Retired ticket configuration remains stored on the server. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { BookOpenText, CheckCircle2, FilePen, Pencil, Plus, Trash2, Upload, Archive } from "lucide-react";
import { buildM4FaqCommand, sendM4FaqCommand } from "@/lib/admin/m-client";
import { mCommands, type MCommandRecord } from "@/lib/admin/m-pending-commands";
import type { M4FaqCommand } from "@/lib/admin/m4-faq-command";
import { queryM4FaqCommand, readM4FaqRecovery } from "@/lib/admin/m4-faq-command";
import { canInvestigateECommand, eCommandClosureOffer } from "@/lib/admin/e-command-investigation";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { FundClosureModal, fundRecoveryStatus, settledText } from "../fund-command-check";
import { TechInfo, pendingReplayReason, receiptFact, receiptOf } from "../recovery-panel";
import { MAuditLink, mFocusTarget, MReleaseModal } from "./m-release";
import { CLOSURE_KEPT_TEXT } from "../direct-recovery-copy";
import { createPendingRecovery, isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { explicitRejectionCode } from "@/lib/admin/explicit-rejection";
import { isSupportSessionExpired } from "@/lib/admin/m-support-client";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { MContentReadError } from "@/lib/admin/m-support-read-contract";
import { businessZone } from "@/lib/admin/business-time";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { M_RECOVERY, M_RELEASED_TEXT, M_SUBMITTING_VIEW, mNoticeTone, mQueryFailedText, mRecoveryView, mRejectedReason, mUnknownReason, type MRecoveryView } from "@/lib/admin/m-recovery-copy";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  Button, Cell, Conclusion, Explain, Fact, Facts, Field, FilterBar, FilterField, Input, IrreversibleTag, Modal, MoreMenu, Notice, NumberInput,
  PageHeader, Pager, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr,
} from "@/app/components/rd";
import {
  type SupportFaq,
  type SupportTicketCategory,
} from "./data";
import { catCN } from "./hd-ui";
import {
  FaqPreview, FaqStatusTag, M4FaqDrawer, M4PendingWrites, M4StatusConfirm, M4_LANGUAGES, ReachList, audienceSub, languageName, reachesUsers, surfaceName,
} from "./m4-kb-views";
import type { MCtx } from "./types";
import type { M4PendingRow } from "./m4-kb-views";
import { useRecoveryDraftDiscard } from "../recovery-draft-discard";
import { usePendingReplayDeadline, type PendingConfirmRecovery } from "../design-kit";
import { useMOperationReason } from "./m-operation-reason";

const FAQ_KEY = "I.support.faqs";

const CATEGORY_OPTIONS: SupportTicketCategory[] = ["withdrawal", "deposit", "hardware", "account", "earnings", "genesis", "technical", "other"];
const FAQ_CATEGORY_OPTIONS: SupportFaq["category"][] = ["general", ...CATEGORY_OPTIONS];
const SURFACES: SupportFaq["surface"][] = ["Help Center", "Nova"];
const FAQ_PAGE_SIZE = 5;
const DEFAULT_FAQ_LANGUAGE = "en-US";

type FaqRecoveryBindings = PendingConfirmRecovery & { releaseRejectedReplay: () => boolean };
/** 原框和行共用的一份：这条原操作现在怎样、问答还在不在列表里。 */
export type FaqRecoveryInfo = { view: MRecoveryView; currentFact?: string; gone: boolean; audit: boolean; rejected: boolean; release: () => void };
const KIND_NAME = { create: "新建", edit: "编辑", publish: "发布", unpublish: "下架", delete: "删除" } as const;
const DELETE_READ_BLOCK = "问答正在读取或没读到，读到后再删除。";
const STATUS_CHANGED = "这条问答的状态刚变过，请关闭后看最新状态。";
const REVIEW_LATEST = "这条问答刚被别人改过，已换成最新内容，核对后重新确认。";
const GONE_TEXT = "这条问答已不在列表里。";

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function nextFaqId(): string {
  // This ID only lets the diff layer recognize a newly added row. Backend IDs are
  // timestamp-shaped and exceed Number.MAX_SAFE_INTEGER, so never do arithmetic on them.
  return `FAQ-TMP-${crypto.randomUUID()}`;
}


function faqSession(actorId?: number) {
  const auth = useAdminAuth.getState();
  const session = auth.session;
  return auth.isAuthenticated && !auth.logoutPending && !auth.logoutUnknown && session?.adminId === actorId
    && !session?.passwordChangeRequired ? session : null;
}

export const m4FaqRecovery = createPendingRecovery(mCommands, {
  capability: record => record.faq ? "receipt" : "readback",
  canReplay: record => {
    const session = faqSession(record.faq?.actorId);
    return Boolean(record.faq && session?.authorities.includes("service_m4_read") && session.authorities.includes("service_m4_write"));
  },
  explicitRejectionCode: error => explicitRejectionCode(error instanceof MContentReadError && error.status === 200 && error.apiCode
    ? { status: error.apiCode, backendMessage: error.backendMessage } : error),
});

function faqWriteReadBack(command: M4FaqCommand, rows: SupportFaq[]) {
  if (command.kind === "delete") return !rows.some(row => row.id === command.row.id);
  const expected = command.row;
  return rows.some(row => (command.kind === "create" || row.id === expected.id && row.version > command.before!.version)
    && (command.before && row.version > command.before.version + 1 || row.status === expected.status
      && row.question === expected.question && row.answer === expected.answer && row.language === expected.language
      && row.category === expected.category && row.surface === expected.surface && row.sortOrder === expected.sortOrder));
}

type FaqForm = { category: SupportFaq["category"]; surface: SupportFaq["surface"]; language: string; sortOrder: string; question: string; answer: string; status: SupportFaq["status"]; reason: string };
type RecoveredFaqDraft = { row: SupportFaq; before: SupportFaq | null };
const FAQ_EDIT_FIELDS = ["category", "surface", "language", "sortOrder", "question", "answer", "status"] satisfies (keyof FaqForm & keyof SupportFaq)[];

function rebaseFaqDraft(before: SupportFaq, proposed: SupportFaq, latest: SupportFaq): SupportFaq {
  return {
    ...latest,
    ...Object.fromEntries(FAQ_EDIT_FIELDS.filter(field => proposed[field] !== before[field]).map(field => [field, proposed[field]])),
  };
}

export function M4KbSla({ ctx, title, summary, loadError, onDeleteBlock }: { onDeleteBlock: (reason?: string) => void; ctx: MCtx; title: string; summary: string; loadError: string | null }) {
  const { pget, toast, openActionConfirm } = ctx;
  const actorId = useAdminAuth((state) => state.session?.adminId);
  const [knowledgeRead, setKnowledgeRead] = useState<{ kind: "idle" | "reading" } | { kind: "failed"; reason: string }>({ kind: "idle" });
  const needsRead = knowledgeRead.kind !== "idle";
  const [pendingCommands, setPendingCommands] = useState<MCommandRecord[]>([]);
  const [outcomes, setOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [closing, setClosing] = useState<MCommandRecord | null>(null);
  const [releasing, setReleasing] = useState<MCommandRecord | null>(null);
  // 只管显示的查询结论。删除框的内容由上层渲染，要随时读到最新值，所以另存一份引用。
  const outcomesNow = useRef(outcomes);
  const putOutcome = (key: string, value?: FundInvestigationOutcome) => {
    const { [key]: _previous, ...rest } = outcomesNow.current;
    outcomesNow.current = value ? { ...rest, [key]: value } : rest;
    setOutcomes(outcomesNow.current);
  };
  const [recovery, setRecovery] = useState<MCommandRecord | null>(null);
  const [recoveredDraft, setRecoveredDraft] = useState<RecoveredFaqDraft | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const discardDraft = useRecoveryDraftDiscard();
  const [reconfirmations, setReconfirmations] = useState<MCommandRecord[]>([]);
  const continuedCommand = useRef<string | null>(null);
  const recoveryRevision = useSyncExternalStore(m4FaqRecovery.subscribe, m4FaqRecovery.getRevision, () => 0);
  usePendingReplayDeadline(pendingCommands.reduce<number | undefined>((first, row) =>
    !isRetryExpired(row) && (first === undefined || row.expiresAt < first) ? row.expiresAt : first, undefined));
  const canQueryM4 = Boolean(faqSession(actorId)?.authorities.includes("service_m4_read"));
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const canWriteM4 = Boolean(authorities?.includes("service_m4_write"));
  // Undefined is the initial loading state. Writes stay fail-closed until the
  // strict M4 response validator explicitly publishes a successful "1".
  const knowledgeAvailable = pget("I.support.knowledgeAvailable") === "1" && !needsRead;
  const faqs = useMemo(() => parseParamArray<SupportFaq>(pget(FAQ_KEY), []), [ctx.params, pget]);
  // 当前版本的修改人：没有这项（旧后端）是 undefined，查不到是 null，不补成别人。
  const faqAuthors = useMemo(() => { const raw = pget("I.support.faqLastModifiedBy"); return raw ? JSON.parse(raw) as Record<string, string | null> : null; }, [ctx.params, pget]);
  const authorOf = (id: string) => faqAuthors ? faqAuthors[id] ?? null : undefined;
  const versionLine = (f: SupportFaq) => authorOf(f.id) === undefined ? `第 ${f.version} 版` : `第 ${f.version} 版 · ${authorOf(f.id) ?? "修改人未记录"}`;
  const canEdit = canWriteM4 && knowledgeAvailable && !ctx.contentLoading;

  const [showAddFaq, setShowAddFaq] = useState(false);
  const [editFaq, setEditFaq] = useState<SupportFaq | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupportFaq["category"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SupportFaq["status"]>("all");
  const [surfaceFilter, setSurfaceFilter] = useState<"all" | SupportFaq["surface"]>("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FAQ_PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<SupportFaq | null>(null);
  const deleteFormKey = useRef(0);
  const deleteFailure = useRef<Error | null>(null);
  const deleteConfirmation = useRef<{ faq: SupportFaq; request: Parameters<MCtx["openActionConfirm"]>[0]; commandKey?: string } | null>(null);
  const releaseFromDelete = useRef<typeof deleteConfirmation.current>(null);
  const dialogOpener = useRef<HTMLElement | null>(null);
  const releaseOpener = useRef<HTMLElement | null>(null);
  const liveDialog = useRef({ recovery, deleteRequest: ctx.actionConfirm });
  liveDialog.current = { recovery, deleteRequest: ctx.actionConfirm };
  useLayoutEffect(() => () => { liveDialog.current = { recovery: null, deleteRequest: null }; }, []);
  const factsAvailable = knowledgeAvailable && !ctx.contentLoading;
  const liveKnowledge = useRef({ available: factsAvailable, faqs, canEdit, needsRead });
  liveKnowledge.current = { available: factsAvailable, faqs, canEdit, needsRead };
  const deleteDialog = deleteConfirmation.current;
  const ordinaryDelete = deleteDialog && deleteDialog.request === ctx.actionConfirm
    && !pendingCommands.some(row => row.commandKey === deleteDialog.commandKey);
  const deleteBlock = ordinaryDelete ? !factsAvailable ? DELETE_READ_BLOCK
    : !faqs.some(row => row.id === deleteDialog.faq.id) ? GONE_TEXT : undefined : undefined;
  useLayoutEffect(() => { onDeleteBlock(deleteBlock); }, [deleteBlock, onDeleteBlock]);
  function closeDeleteDialog() {
    const target = deleteConfirmation.current;
    if (target) ctx.closeActionConfirm?.(target.request);
  }
  const currentRecoveryInfo = useRef(recoveryInfo);
  currentRecoveryInfo.current = recoveryInfo;
  const currentRecoveryBindings = useRef(faqRecoveryBindings);
  currentRecoveryBindings.current = faqRecoveryBindings;
  const activeElement = () => document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const returnToFaq = (opener: HTMLElement | null, faqId?: string) =>
    mFocusTarget(opener, [...document.querySelectorAll<HTMLElement>("[data-faq-id]")].find(row => row.dataset.faqId === faqId),
      document.querySelector<HTMLElement>('input[aria-label="搜索常见问答"]'));
  const openRelease = (record: MCommandRecord, fromDelete = false) => {
    releaseFromDelete.current = fromDelete ? deleteConfirmation.current : null;
    releaseOpener.current = fromDelete ? null : activeElement();
    if (fromDelete && deleteConfirmation.current) ctx.closeActionConfirm?.(deleteConfirmation.current.request);
    setReleasing(record);
  };
  const cancelRelease = () => {
    const original = releaseFromDelete.current;
    releaseFromDelete.current = null;
    setReleasing(null);
    if (original) openActionConfirm(original.request);
  };
  const [statusFailure, setStatusFailure] = useState<Error | null>(null);
  const [writePending, setWritePending] = useState(false);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);
  const writeInFlight = useRef(false);
  const createFaqTempId = useRef<string | null>(null);

  const visibleFaqs = useMemo(() => faqs.filter(faq => faq.surface !== "Ticket Create"), [faqs]);
  const conditions = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [
      { key: "q", on: Boolean(q), label: `关键词「${query.trim()}」`, noun: `含「${query.trim()}」`, test: (faq: SupportFaq) => [faq.id, faq.question, faq.answer, faq.surface].some((value) => value.toLowerCase().includes(q)), clear: () => setQuery("") },
      { key: "surface", on: surfaceFilter !== "all", label: surfaceName(surfaceFilter), noun: `显示在${surfaceName(surfaceFilter)}`, test: (faq: SupportFaq) => faq.surface === surfaceFilter, clear: () => setSurfaceFilter("all") },
      { key: "language", on: languageFilter !== "all", label: languageName(languageFilter), noun: `${languageName(languageFilter)}`, test: (faq: SupportFaq) => faq.language === languageFilter, clear: () => setLanguageFilter("all") },
      { key: "category", on: categoryFilter !== "all", label: `分类：${catCN(categoryFilter)}`, noun: `「${catCN(categoryFilter)}」分类`, test: (faq: SupportFaq) => faq.category === categoryFilter, clear: () => setCategoryFilter("all") },
      { key: "status", on: statusFilter !== "all", label: statusFilter === "published" ? "已发布" : "草稿", noun: statusFilter === "published" ? "已发布" : "草稿", test: (faq: SupportFaq) => faq.status === statusFilter, clear: () => setStatusFilter("all") },
    ].filter((condition) => condition.on);
  }, [categoryFilter, languageFilter, query, statusFilter, surfaceFilter]);
  const filteredFaqs = useMemo(() => visibleFaqs
    .filter((faq) => conditions.every((condition) => condition.test(faq)))
    .sort((a, b) => a.sortOrder - b.sortOrder || b.updatedAt.localeCompare(a.updatedAt)), [conditions, visibleFaqs]);
  const pageCount = Math.max(1, Math.ceil(filteredFaqs.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedFaqs = filteredFaqs.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  useEffect(() => setPage(1), [query, categoryFilter, statusFilter, surfaceFilter, languageFilter]);
  const clearFilters = () => conditions.forEach((condition) => condition.clear());

  const syncPending = useCallback(() => setPendingCommands(mCommands.list().filter((record) => record.faq?.actorId === actorId
    || record.fingerprint.startsWith("cmd|I.support.faq"))), [actorId]);
  useEffect(syncPending, [syncPending, recoveryRevision]);
  const blocked = (id?: string, records = pendingCommands) => records.some(record => record.faq
    ? record.faq.row.id === id || (id === undefined && record.faq.kind === "create")
    : record.fingerprint.startsWith("cmd|I.support.faq"));
  const closeWriteDialogs = () => { continuedCommand.current = null; setRecoveredDraft(null); setRecovery(null); setEditFaq(null); setShowAddFaq(false); setStatusTarget(null); };
  useEffect(() => { closeWriteDialogs(); setReconfirmations([]); }, [actorId]);
  const readCurrent = async (written = false) => {
    const epoch = useAdminAuth.getState().authEpoch;
    setKnowledgeRead({ kind: "reading" });
    try {
      const rows = await ctx.refreshKnowledge();
      if (epoch !== useAdminAuth.getState().authEpoch) return;
      setKnowledgeRead({ kind: "idle" });
      return rows;
    } catch (error) {
      if (epoch !== useAdminAuth.getState().authEpoch) return;
      const reason = displayAdminReadError(error);
      setKnowledgeRead({ kind: "failed", reason: written ? `操作已成功，最新问答暂时读不到。${reason}` : reason });
    }
  };
  const commitM4Write = async (command: M4FaqCommand, successMessage: string, onFailure?: (error: Error, latest?: SupportFaq[]) => void, original?: MCommandRecord): Promise<boolean> => {
    const currentSession = faqSession(command.actorId);
    const epoch = useAdminAuth.getState().authEpoch;
    if (writeInFlight.current || liveKnowledge.current.needsRead || !currentSession?.authorities.includes("service_m4_write")) return false;
    if (original ? m4FaqRecovery.state(original).replayBlock : !liveKnowledge.current.canEdit || blocked(command.before?.id, mCommands.list())) return false;
    const commandKey = original?.commandKey ?? `m4-${crypto.randomUUID()}`;
    const fingerprint = original?.fingerprint ?? `m4|${command.kind === "create" ? "create" : command.row.id}`;
    if (!original) mCommands.remember(fingerprint, commandKey, { faq: command });
    if (!mCommands.isDurablyStored(fingerprint, commandKey)) {
      const failure = "原操作未能保存，暂未提交。请恢复浏览器存储后按原请求重试。";
      if (!original) mCommands.forget(fingerprint, commandKey);
      onFailure?.(new Error(failure)); toast(failure, "warn"); return false;
    }
    const record = original ?? mCommands.list().find(row => row.commandKey === commandKey);
    if (!record) return false;
    if (command.kind === "delete" && deleteConfirmation.current?.faq.id === command.row.id) {
      deleteConfirmation.current.commandKey = commandKey;
    }
    const continued = continuedCommand.current;
    if (!original) setSubmittingKey(commandKey);
    syncPending();
    writeInFlight.current = true;
    setWritePending(true);
    const stillCurrent = () => epoch === useAdminAuth.getState().authEpoch && Boolean(faqSession(command.actorId));
    try {
      try {
        if (original) await m4FaqRecovery.replay(original, saved => sendM4FaqCommand(saved.faq!, saved.commandKey));
        else await sendM4FaqCommand(command, commandKey);
      } catch (error) {
        if (!stillCurrent()) return false;
        // 登录过期说明不了原操作有没有执行，保留原记录（和客服其他入口一致）。
        const rejected = !original && error instanceof MContentReadError && !isSupportSessionExpired(error)
          && !error.backendMessage?.startsWith("IDEMPOTENCY_") && isDeterministicRejection(error.status, error.apiCode);
        let latest: SupportFaq[] | undefined;
        if (rejected) {
          mCommands.forget(fingerprint, commandKey);
          syncPending();
          latest = await readCurrent();
        } else {
          if (command.kind !== "delete") setRecovery(record);
          if (continued) setReconfirmations(rows => rows.filter(row => row.commandKey !== continued));
        }
        const refusedReplay = original && m4FaqRecovery.state(original).replayRejection;
        const reason = displayAdminError(error);
        const failure = `${rejected ? "后台拒绝了这次操作" : refusedReplay ? "后台已拒绝重试" : "结果未知"} · ${reason}`;
        // 框里已有这条原操作的结论句，未知和重试被拒只补原因。
        if (onFailure) onFailure(rejected ? new Error(failure, { cause: error }) : new OutcomeUnknownError(refusedReplay ? mRejectedReason(reason) : mUnknownReason(reason), { cause: error }), latest);
        else toast(failure, rejected ? "error" : "warn");
        return false;
      }
      if (!stillCurrent()) return false;
      // The validated write receipt settles the command. The overview separately
      // gates new writes until the current data can be read.
      m4FaqRecovery.settleAcknowledged(record);
      if (continued) setReconfirmations(rows => rows.filter(row => row.commandKey !== continued));
      syncPending();
      if (command.kind === "delete") {
        if (isOpenCommand(record)) { closeDeleteDialog(); toast(successMessage); }
      } else {
        closeWriteDialogs();
        toast(successMessage);
      }
      await readCurrent(true);
      return true;
    } finally {
      writeInFlight.current = false;
      setWritePending(false);
      setSubmittingKey(null);
    }
  };
  const retryOriginal = (record: MCommandRecord, onFailure?: (error: Error) => void) => {
    if (!record.faq) return Promise.resolve(false);
    putOutcome(record.commandKey);
    const labels = { create: "已保存", edit: "已保存", publish: "已发布", unpublish: "已下架为草稿", delete: "已删除" };
    return commitM4Write(record.faq, `${record.faq.row.id} ${labels[record.faq.kind]}`, onFailure, record);
  };

  const saveFaq = async (form: FaqForm, onFailure: (error: Error, clearReason?: boolean) => void) => {
    if (recovery) return retryOriginal(recovery, onFailure);
    const sortOrder = Number(form.sortOrder);
    if (!form.question.trim() || !form.answer.trim() || form.question.trim().length > 160 || form.answer.trim().length > 4000) {
      toast("请检查问题和回答。");
      return false;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999) {
      toast("排序值必须是 0–999999 的整数");
      return false;
    }
    const row: SupportFaq = {
      id: editFaq?.id ?? createFaqTempId.current ?? (createFaqTempId.current = nextFaqId()),
      category: form.category,
      question: form.question.trim(),
      answer: form.answer.trim(),
      status: form.status,
      surface: form.surface,
      language: form.language as SupportFaq["language"],
      sortOrder,
      version: editFaq ? editFaq.version + 1 : 1,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    const rebase = (latest: SupportFaq) => {
      if (!editFaq) return;
      setRecoveredDraft({ before: editFaq, row: rebaseFaqDraft(editFaq, row, latest) });
      setEditFaq(latest);
      setDraftRevision(value => value + 1);
    };
    if (editFaq) {
      const latest = faqs.find(faq => faq.id === editFaq.id);
      if (!latest) return false;
      if (latest.version !== editFaq.version || latest.status !== editFaq.status) { rebase(latest); return false; }
    }
    if (!actorId) return false;
    const command = buildM4FaqCommand(editFaq ? "edit" : "create", row, editFaq, form.reason.trim(), actorId);
    const succeeded = await commitM4Write(command, `${row.id} 已保存 · ${catCN(row.category)}常见问答`, (error, rows) => {
      const conflict = editFaq && error.cause instanceof MContentReadError && error.cause.backendMessage === "SUPPORT_FAQ_CONCURRENT_MODIFICATION";
      const latest = conflict ? rows?.find(faq => faq.id === row.id) : undefined;
      if (latest) rebase(latest);
      else onFailure(error, Boolean(conflict));
    });
    if (succeeded) {
      createFaqTempId.current = null;
      setShowAddFaq(false);
      setEditFaq(null);
    }
    return succeeded;
  };

  const changeFaqStatus = async (id: string, status: SupportFaq["status"], onFailure: (error: Error) => void) => {
    if (recovery) return retryOriginal(recovery, onFailure);
    const before = faqs.find((faq) => faq.id === id);
    if (!actorId || !statusTarget) return false;
    function reviewStatus(latest?: SupportFaq) {
      if (!latest || latest.status === status) onFailure(new Error(latest ? STATUS_CHANGED : GONE_TEXT));
      else {
        setStatusTarget(latest);
        onFailure(new Error(REVIEW_LATEST));
      }
    }
    if (!factsAvailable) return false;
    if (!before || before.status !== statusTarget.status || before.version !== statusTarget.version) {
      reviewStatus(before);
      return false;
    }
    const row = { ...before, status };
    return commitM4Write(buildM4FaqCommand(status === "published" ? "publish" : "unpublish", row, before,
      status === "published" ? "常见问答 发布例行审核留档" : "常见问答 下架例行审核留档", actorId),
      status === "published" ? `${id} 已发布` : `${id} 已下架为草稿`, (error, rows) => {
        if (rows && error.cause instanceof MContentReadError && error.cause.backendMessage === "SUPPORT_FAQ_CONCURRENT_MODIFICATION") {
          reviewStatus(rows.find(row => row.id === id));
        } else onFailure(error);
      });
  };
  const requestDeleteFaq = (faq: SupportFaq, original?: MCommandRecord, continued?: string) => {
    const savedCommand = () => mCommands.list().find(record => record.faq?.kind === "delete"
      && record.faq.actorId === actorId && record.faq.row.id === faq.id);
    const currentFaq = () => liveKnowledge.current.available ? liveKnowledge.current.faqs.find(row => row.id === faq.id) : undefined;
    const shownFaq = () => savedCommand()?.faq?.row ?? currentFaq() ?? faq;
    if (liveDialog.current.deleteRequest !== deleteConfirmation.current?.request) {
      deleteFailure.current = null;
      continuedCommand.current = continued ?? null;
      dialogOpener.current = activeElement();
    }
    const opener = dialogOpener.current;
    const request: Parameters<MCtx["openActionConfirm"]>[0] = {
      formKey: ++deleteFormKey.current,
      returnFocus: () => returnToFaq(opener, faq.id),
      action: <>删除常见问答 <span className="mono">{faq.id}</span></>,
      title: "删除这条问答",
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>本页不能恢复</IrreversibleTag></>,
      confirmTone: "danger",
      confirmLabel: "确认删除",
      briefKind: "faq-delete",
      statedBrief: () => ({
        impact: shownFaq().status === "published"
          ? "删除后所有位置都不再读到这条问答，本页也找不回来；账号和资金不受影响。"
          : "这是草稿，用户本来就看不到；删除后本页找不回来，账号和资金不受影响。",
        check: "核对问题和回答，确认不再需要。只想先不让用户看到，用「下架」，以后还能重新发布。",
      }),
      facts: () => {
        const fresh = currentFaq();
        const saved = savedCommand();
        const shown = shownFaq();
        const now = saved && currentRecoveryInfo.current(saved).currentFact;
        return <>{deleteRecoveryNotice(saved)}<Facts>
          <Fact k="问题"><span className="m4-fact-text">{shown.question}</span></Fact>
          <Fact k="给谁看">{surfaceName(shown.surface)} · {languageName(shown.language)}</Fact>
          <Fact k="状态">{!saved && liveKnowledge.current.available && !fresh ? GONE_TEXT
            : shown.status === "published" ? "已发布，删除后几分钟内从 App 消失" : "草稿"}</Fact>
          {now && <Fact k="现在" tone="warn">{now}</Fact>}
        </Facts></>;
      },
      detail: <>删除后要再用，只能重新新建这条问答。</>,
      reasonPlaceholder: "例如：内容已过时，已由新问答替代",
      reasonMin: 8,
      getPendingReason: () => {
        const saved = savedCommand();
        return saved?.faq ? JSON.parse(saved.faq.request.body).reason : undefined;
      },
      getPendingRecovery: () => {
        const saved = savedCommand();
        return saved ? currentRecoveryBindings.current(saved) : undefined;
      },
      initialReason: original?.faq ? JSON.parse(original.faq.request.body).reason : undefined,
      blockedReason: !canWriteM4 ? "当前账号没有知识库编辑权限" : undefined,
      run: async (reason) => {
        const saved = savedCommand();
        deleteFailure.current = null;
        const onFailure = (error: Error) => { deleteFailure.current = error; };
        if (saved) return retryOriginal(saved, onFailure);
        const fresh = currentFaq();
        if (!actorId || blocked(faq.id, mCommands.list())) return false;
        if (!fresh) {
          onFailure(new Error(liveKnowledge.current.available ? GONE_TEXT : DELETE_READ_BLOCK));
          return false;
        }
        if (fresh.version !== faq.version || fresh.status !== faq.status) {
          onFailure(new Error(REVIEW_LATEST));
          requestDeleteFaq(fresh);
          return false;
        }
        return commitM4Write(buildM4FaqCommand("delete", faq, faq, reason, actorId), `${faq.id} 已删除`, (error, latest) => {
          onFailure(error);
          const fresh = latest?.find(row => row.id === faq.id);
          if (fresh && (fresh.version !== faq.version || fresh.status !== faq.status) && liveDialog.current.deleteRequest === request) requestDeleteFaq(fresh);
        });
      },
    };
    deleteConfirmation.current = { faq, request, commandKey: original?.commandKey };
    openActionConfirm(request);
  };

  const openCreate = () => {
    closeWriteDialogs();
    dialogOpener.current = activeElement();
    createFaqTempId.current = nextFaqId();
    setShowAddFaq(true);
  };
  const openEdit = (faq: SupportFaq) => {
    closeWriteDialogs();
    dialogOpener.current = activeElement();
    createFaqTempId.current = null;
    setEditFaq(faq);
  };
  const openStatus = (faq: SupportFaq) => {
    closeWriteDialogs();
    dialogOpener.current = activeElement();
    setStatusFailure(null);
    setStatusTarget(faq);
  };

  const restore = (record: MCommandRecord) => {
    if (!record.faq) return;
    closeWriteDialogs();
    dialogOpener.current = activeElement();
    if (record.faq.kind === "delete") {
      requestDeleteFaq(record.faq.row, record);
      return;
    }
    setRecovery(record);
    if (record.faq.kind === "publish" || record.faq.kind === "unpublish") {
      setStatusFailure(null);
      setStatusTarget(record.faq.before);
    } else {
      createFaqTempId.current = record.faq.row.id;
      setEditFaq(record.faq.before);
      setShowAddFaq(record.faq.kind === "create");
    }
  };

  function isOpenCommand(record: MCommandRecord) {
    const original = deleteConfirmation.current;
    return record.faq?.kind === "delete"
      ? Boolean(original && liveDialog.current.deleteRequest === original.request && original.commandKey === record.commandKey)
      : liveDialog.current.recovery?.commandKey === record.commandKey;
  }

  function continueFaq(record: MCommandRecord, rows: SupportFaq[], keepOpener = false) {
    const command = record.faq;
    if (!command) return;
    const fresh = rows.find(row => row.id === command.row.id);
    closeWriteDialogs();
    if (!keepOpener) dialogOpener.current = activeElement();
    continuedCommand.current = record.commandKey;
    if (command.kind === "create" || command.kind === "edit") {
      setRecoveredDraft({
        row: command.before && fresh ? rebaseFaqDraft(command.before, command.row, fresh) : command.row,
        before: command.before,
      });
      setDraftRevision(value => value + 1);
      createFaqTempId.current = command.kind === "create" ? nextFaqId() : null;
      setEditFaq(command.kind === "edit" ? fresh ?? command.before : null);
      setShowAddFaq(command.kind === "create");
    } else if (command.kind === "delete" && fresh) requestDeleteFaq(fresh, undefined, record.commandKey);
    else if (fresh && fresh.status === command.before?.status) {
      setStatusFailure(null);
      setStatusTarget(fresh);
    }
  }

  async function applyFaqConclusion(record: MCommandRecord, conclusion: "succeeded" | "not-executed" | "rejected") {
    const command = record.faq;
    if (!command) return false;
    const epoch = useAdminAuth.getState().authEpoch;
    const latest = await readCurrent();
    if (!latest || epoch !== useAdminAuth.getState().authEpoch || !faqSession(command.actorId)) return false;
    if (conclusion === "succeeded" && !faqWriteReadBack(command, latest)) return false;
    const opened = isOpenCommand(record);
    if (!m4FaqRecovery.settleFromQuery(record, conclusion)) return false;
    syncPending();
    const fresh = latest.find(row => row.id === command.row.id);
    if (conclusion === "succeeded") {
      if (opened) {
        if (command.kind === "delete") closeDeleteDialog();
        else closeWriteDialogs();
      }
      return false;
    }

    const canContinue = command.kind === "create" || (fresh
      && (command.kind === "edit" || command.kind === "delete" || fresh.status === command.before?.status));
    setReconfirmations(rows => [...rows, record]);
    if (opened) {
      if (canContinue) continueFaq(record, latest, true);
      else if (command.kind === "delete") closeDeleteDialog();
      else closeWriteDialogs();
    }
    return command.kind !== "create" && !fresh;
  }

  async function queryOriginal(record: MCommandRecord, evidence?: Parameters<typeof queryM4FaqCommand>[1]) {
    const command = record.faq;
    if (!command || !faqSession(command.actorId)?.authorities.includes("service_m4_read") || m4FaqRecovery.state(record).busy) return;
    if (command.kind === "delete" && isOpenCommand(record)) deleteFailure.current = null;
    const epoch = useAdminAuth.getState().authEpoch;
    const current = () => epoch === useAdminAuth.getState().authEpoch && Boolean(faqSession(command.actorId));
    try {
      // 查询中不留上一次的结论，也不当成查无。
      putOutcome(record.commandKey);
      const next = await m4FaqRecovery.query(record, saved => readM4FaqRecovery(saved, evidence));
      if (!next || !current()) return;
      putOutcome(record.commandKey, { receipt: next.receipt });
      if (next.conclusion === "succeeded" || next.conclusion === "not-executed" || next.conclusion === "rejected") {
        const gone = await applyFaqConclusion(record, next.conclusion);
        if (current() && next.receipt && !mCommands.list().some(row => row.commandKey === record.commandKey)) {
          const status = next.conclusion === "rejected" ? "CONFIRMED_REJECTED" : next.receipt.originalStatus;
          ctx.toast(gone ? `查到原操作的结论，记录已解除。${GONE_TEXT}` : settledText({ status }), gone ? "warn" : "success");
        }
      } else if (evidence) ctx.toast(CLOSURE_KEPT_TEXT, "warn");
    } catch (error) {
      if (current()) putOutcome(record.commandKey, { error: evidence ? displayAdminError(error) : displayAdminReadError(error) });
      if (evidence) throw error;
    }
  }

  function faqRecoveryBindings(record: MCommandRecord): FaqRecoveryBindings {
    const state = m4FaqRecovery.state(record);
    return {
      state, expiresAt: state.expiresAt,
      blockedReason: state.expired ? RETRY_EXPIRED_TEXT : needsRead ? "问答没读到，先点「重试」。" : pendingReplayReason(state, "当前账号没有知识库编辑权限，不能重试。"),
      subscribe: m4FaqRecovery.subscribe, getRevision: m4FaqRecovery.getRevision,
      query: canQueryM4 ? () => queryOriginal(record) : undefined,
      releaseRejectedReplay: () => {
        const session = faqSession(record.faq?.actorId);
        if (!session?.authorities.includes("service_m4_read") || !m4FaqRecovery.releaseRejectedReplay(record)) return false;
        if (isOpenCommand(record)) {
          if (record.faq?.kind === "delete") closeDeleteDialog();
          else closeWriteDialogs();
        }
        syncPending();
        return true;
      },
    };
  }

  /** 这条原操作现在怎样：行、原框、删除框同一句。查到的回执用资金页共用的说法，其余用 M 域共用的。 */
  function recoveryInfo(record: MCommandRecord): FaqRecoveryInfo & { more?: string } {
    const state = m4FaqRecovery.state(record);
    const outcome = outcomesNow.current[record.commandKey];
    const receipt = receiptOf(outcome);
    const original = record.faq?.row;
    const fresh = original && factsAvailable ? faqs.find(row => row.id === original.id) : undefined;
    const gone = Boolean(original && record.faq?.kind !== "create" && factsAvailable && !fresh);
    const currentFact = record.faq?.kind !== "delete" ? undefined : gone ? "已不在列表里"
      : fresh && original && (fresh.version !== original.version || fresh.status !== original.status)
        ? `第 ${fresh.version} 版，${fresh.status === "published" ? "已发布" : "草稿"}，和提交时不同` : undefined;
    const shared = fundRecoveryStatus({ outcome, expired: state.expired, canQuery: canQueryM4, canClose: canInvestigateECommand("service_m4_read"), canRetry: false });
    const found: MRecoveryView & { more?: string } = ["succeeded", "not-executed", "rejected"].includes(state.conclusion)
      ? knowledgeRead.kind === "reading" ? { tone: "progress", label: "核对中", line: "后台已有结论，正在核对最新问答…" }
        : { tone: "warn", label: "待核对", line: "后台已有结论，最新问答还没核对上；问答读到后再查询一次。" }
      : shared.label === "已处理" && !state.expired ? { ...shared, line: "后台已处理，看不出成没成，请到操作记录与审批核对。" } : shared;
    const last = !outcome ? "" : "error" in outcome ? mQueryFailedText(outcome.error) : receipt ? `这次查到「${found.label}」。`
      : state.conclusion !== "not-found" ? M_RECOVERY.unsettled : state.replayRejection || state.expired ? M_RECOVERY.notFoundShort : "";
    const view: MRecoveryView & { more?: string } = submittingKey === record.commandKey ? M_SUBMITTING_VIEW : !record.faq
      ? { tone: "neutral", label: "不能查询", line: "升级前的记录查不了原结果，到操作记录与审批核对。" }
      : !state.busy && !state.replayRejection && (receipt || shared.label === "没有查询权限" || !outcome && !state.expired && state.conclusion === "unknown")
        ? state.expired && !found.line.includes("24 小时") ? { ...found, line: `${RETRY_EXPIRED_TEXT}${found.line}` } : found : mRecoveryView(state, { last });
    return { view, more: view.more, currentFact, gone, audit: gone || Boolean(state.replayRejection) || state.expired || !record.faq || view.line.includes("操作记录与审批"),
      rejected: Boolean(state.replayRejection) && !state.busy, release: () => openRelease(record) };
  }
  const goneText = (record: MCommandRecord) => record.faq?.kind === "delete" ? "这条问答已不在列表里，看不出是不是这次删的。" : GONE_TEXT;
  const deleteRecoveryNotice = (record?: MCommandRecord) => {
    // 第一次提交还在等结果时不算结果未知；没有原操作可恢复的失败写在框里（OP-82）。
    const failure = deleteFailure.current;
    if (!record) return failure && !isOutcomeUnknownError(failure) ? <Notice tone="danger" title="没有删除"><p>{failure.message}</p></Notice> : null;
    const { view, gone, audit, rejected } = currentRecoveryInfo.current(record);
    if (view === M_SUBMITTING_VIEW) return null;
    return <Notice tone={mNoticeTone(view)} title={view.label} actionBelow action={rejected ? <Button size="sm" onClick={() => openRelease(record, true)}>核实后解除</Button> : undefined}>
      <p>{gone && goneText(record)}{view.line}</p>
      {audit && <MAuditLink />}
      {failure?.message && !m4FaqRecovery.state(record).busy && <p>{failure.message}</p>}
    </Notice>;
  };
  const activeRecovery = recovery ? faqRecoveryBindings(recovery) : undefined;
  const activeInfo = recovery ? recoveryInfo(recovery) : undefined;
  const currentStatusFaq = statusTarget && faqs.find(row => row.id === statusTarget.id);
  const statusBlock = !canEdit ? "问答正在读取或没读到，读到后再操作。"
    : !currentStatusFaq ? GONE_TEXT : currentStatusFaq.status !== statusTarget?.status ? STATUS_CHANGED : undefined;
  const pendingRows = pendingCommands.map((record) => {
    const state = m4FaqRecovery.state(record);
    const outcome = outcomes[record.commandKey];
    const { view, more, gone, audit } = recoveryInfo(record);
    return { key: record.commandKey,
    question: record.faq?.row.question ?? "常见问答", change: record.faq ? KIND_NAME[record.faq.kind] : "旧记录",
    submittedAt: record.createdAt, expired: state.expired,
    status: { tone: view.tone, label: view.label, more },
    note: <>{gone && goneText(record)}{view.line} {audit && <><MAuditLink /> </>}<TechInfo commandKey={record.commandKey} receipt={receiptOf(outcome)} /></>,
    actions: submittingKey !== record.commandKey && <>
      {record.faq && <Button size="sm" loading={state.busy === "query"} loadingText="查询中…" disabled={writePending || state.busy === "replay"}
        disabledReason={canQueryM4 ? undefined : "当前账号没有知识库查看权限"} onClick={() => void queryOriginal(record)}>查询原结果</Button>}
      {canInvestigateECommand("service_m4_read") && eCommandClosureOffer(outcomes[record.commandKey], isRetryExpired(record)).conclusions.length > 0 && <Button size="sm" variant="danger-outline" disabled={writePending || Boolean(state.busy)} onClick={() => setClosing(record)}>核查结案</Button>}
      {record.faq && canWriteM4 && !state.expired && !state.replayRejection && <Button size="sm" disabled={writePending}
        disabledReason={writePending ? undefined : faqRecoveryBindings(record).blockedReason} onClick={() => restore(record)}>按原请求重试</Button>}
      {state.replayRejection && canQueryM4 && <Button size="sm" variant="ghost" disabled={writePending || Boolean(state.busy)} onClick={() => openRelease(record)}>核实后解除</Button>}
    </> };
  });
  const draftRows = reconfirmations.flatMap<M4PendingRow>(record => {
    const command = record.faq;
    if (!command) return [];
    const fresh = faqs.find(row => row.id === command.row.id);
    const draft = command.kind === "create" || command.kind === "edit";
    const action = draft ? "继续修改" : "重新确认";
    const occupied = blocked(command.before?.id);
    const ended = factsAvailable && command.kind !== "create" && !fresh ? "这条问答已不在列表里，不能再继续。"
      : factsAvailable && fresh && (command.kind === "publish" || command.kind === "unpublish") && fresh.status !== command.before?.status
        ? `这条问答现在已是${fresh.status === "published" ? "已发布" : "草稿"}，不用再${KIND_NAME[command.kind]}。` : undefined;
    const reason = occupied ? "这条问答有一个结果未知的操作，先处理它。" : ended;
    const editing = draft && continuedCommand.current === record.commandKey && Boolean(showAddFaq || editFaq);
    const dismiss = () => setReconfirmations(rows => rows.filter(row => row.commandKey !== record.commandKey));
    return [{
      key: record.commandKey, question: command.row.question, change: KIND_NAME[command.kind], submittedAt: record.createdAt, expired: false,
      status: { tone: "done" as const, label: draft ? "可继续修改" : "可重新确认" },
      note: reason ?? "原操作已有结论，核对最新问答后重新确认。",
      actions: <>
        {!ended && <Button size="sm" disabled={!canEdit || writePending} disabledReason={reason} onClick={() => continueFaq(record, faqs)}>{action}</Button>}
        <Button size="sm" variant="ghost" disabledReason={occupied ? reason : editing ? "正在编辑这份草稿" : undefined}
          onClick={() => draft ? discardDraft.ask(dismiss) : dismiss()}>{draft ? "放弃这份草稿" : "不再处理"}</Button>
      </>,
    }];
  });

  // 首屏数字：只算这页的问答，不随筛选变。读不到时写「—」，不当成 0。
  const published = visibleFaqs.filter((faq) => faq.status === "published");
  const drafts = visibleFaqs.length - published.length;
  // Nova 智能问答已在 App 下线（决定表「全站-Nova」），放在那里的问答算用户看不到。
  const unreachable = published.filter((faq) => !reachesUsers(faq));
  const byLanguage = M4_LANGUAGES.map((language) => ({ name: language.name, count: published.filter((faq) => faq.language === language.code).length })).filter((row) => row.count > 0);
  const otherLanguage = published.filter((faq) => !M4_LANGUAGES.some((language) => language.code === faq.language)).length;
  const loading = !knowledgeAvailable && (knowledgeRead.kind === "reading" || ctx.contentLoading);
  const failed = !knowledgeAvailable && !loading;
  const toggleStatus = (status: SupportFaq["status"]) => setStatusFilter((current) => current === status ? "all" : status);
  const languageOptions = [...M4_LANGUAGES.map((language) => language.code), ...new Set(visibleFaqs.map((faq) => faq.language).filter((code) => !M4_LANGUAGES.some((language) => language.code === code)))];

  // 没有结果时分清是「没有这类问答」还是「几个条件合起来太窄」。
  const narrowMessage = () => {
    const empty = conditions.find((condition) => !visibleFaqs.some(condition.test));
    if (empty) return `知识库里没有${empty.noun}的问答。`;
    return conditions.length > 1 ? "每个条件单独都有问答，合在一起没有：少选一个条件试试。" : "没有符合当前筛选条件的问答。";
  };

  const current = knowledgeAvailable && openId ? visibleFaqs.find((faq) => faq.id === openId) ?? null : null;
  const currentIndex = current ? pagedFaqs.findIndex((faq) => faq.id === current.id) : -1;
  const drawerNav = currentIndex >= 0 ? {
    onPrev: () => setOpenId(pagedFaqs[currentIndex - 1]?.id ?? null),
    onNext: () => setOpenId(pagedFaqs[currentIndex + 1]?.id ?? null),
    hasPrev: currentIndex > 0,
    hasNext: currentIndex < pagedFaqs.length - 1,
  } : undefined;
  const tableColumns = canEdit ? 7 : 6;

  return (
    <>
      <PageHeader pageId="M4" title={title} summary={summary}
        actions={canEdit && <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabled={writePending || blocked()} onClick={openCreate}>新建问答</Button>}
        readOnly={knowledgeAvailable && !canWriteM4 ? "你只能查看；新建、编辑、发布、下架和删除问答需要知识库编辑权限" : undefined} />

      <M4PendingWrites rows={[...pendingRows, ...draftRows]} />
      {discardDraft.dialog}
      {closing && <FundClosureModal label={closing.faq?.row.question ?? "常见问答"} createdAt={closing.createdAt}
        offer={eCommandClosureOffer(outcomes[closing.commandKey], isRetryExpired(closing))}
        facts={<Fact k="系统记录">{receiptFact(((outcome) => outcome && "receipt" in outcome ? outcome.receipt : null)(outcomes[closing.commandKey]), "记录保留")}</Fact>}
        onClose={() => setClosing(null)} onSubmit={async evidence => {
          await queryOriginal(closing, evidence);
          setClosing(null);
        }} />}
      {releasing?.faq && <MReleaseModal key={releasing.commandKey}
        returnFocus={() => returnToFaq(releaseOpener.current ?? dialogOpener.current, releasing.faq?.row.id)}
        target={{ action: `${KIND_NAME[releasing.faq.kind]}常见问答`, object: releasing.faq.row.question, createdAt: releasing.createdAt, rejection: m4FaqRecovery.state(releasing).replayRejection }}
        where="被拒说明不了原操作有没有生效，先核实。" onCancel={cancelRelease} onConfirm={() => {
          const released = faqRecoveryBindings(releasing).releaseRejectedReplay();
          if (released) {
            releaseFromDelete.current = null;
            setReleasing(null);
            putOutcome(releasing.commandKey);
          } else cancelRelease();
          toast(released ? recoveryInfo(releasing).gone ? `已解除这条记录。${GONE_TEXT}` : M_RELEASED_TEXT : "这条记录刚有变化，没有解除，请看最新状态。", released ? "success" : "warn");
        }} />}

      {loading ? <Conclusion state="unknown">正在读取问答…</Conclusion>
        : failed ? <div className="m4-health" data-module-health-state="error"><Conclusion state="unknown" action={<Button size="sm" onClick={() => void readCurrent()}>重试</Button>}
            hint={<>{knowledgeRead.kind === "failed" ? knowledgeRead.reason : pget("I.support.knowledgeError")} 暂时不能新建和修改。{loadError && "客服中心的其他数据也没同步成功。"}</>}
            explain="问答和旧的工单处理时限数据是一起读的，其中一份读不全，问答就显示不了。点「重试」只重读知识库。">问答加载失败</Conclusion></div>
          : visibleFaqs.length === 0 ? <Conclusion state="neutral" icon={BookOpenText} hint={canEdit ? "点右上角「新建问答」写第一条。" : undefined}>还没有问答</Conclusion>
            : unreachable.length > 0
              ? <Conclusion state="warn" hint="可以筛「显示位置」和「语言」找到它们。"
                  explain="状态是已发布，但用户看不到：Nova 智能问答已在 App 下线；App 帮助中心只按中文、英语、越南语读取。">
                  {published.length} 条在线上，其中 {unreachable.length} 条用户实际看不到
                </Conclusion>
              : <Conclusion state="ok" hint={drafts > 0 ? `${drafts} 条草稿还没发布，用户看不到。` : undefined}>{published.length} 条问答在线上</Conclusion>}

      <StatBand label="问答数量" fit>
        <Stat icon={BookOpenText} tone="role-2" label="全部问答" value={knowledgeAvailable ? visibleFaqs.length : "—"} unit={knowledgeAvailable ? "条" : undefined}
          sub={knowledgeAvailable && visibleFaqs.length > 0 ? `帮助中心 ${visibleFaqs.filter((faq) => faq.surface === "Help Center").length} · Nova（已下线）${visibleFaqs.filter((faq) => faq.surface === "Nova").length}` : undefined}
          explain="知识库里全部问答，含草稿；不随下面的筛选变。" />
        <Stat icon={CheckCircle2} tone="role-2" label="已发布" value={knowledgeAvailable ? published.length : "—"} unit={knowledgeAvailable ? "条" : undefined}
          sub={knowledgeAvailable && published.length > 0 ? [...byLanguage.map((row) => `${row.name} ${row.count}`), ...(otherLanguage ? [`其他 ${otherLanguage}`] : [])].join(" · ") : undefined}
          explain="在线上的问答，按语言分。点这一格只看已发布的。"
          onOpen={knowledgeAvailable && (published.length > 0 || statusFilter === "published") ? () => toggleStatus("published") : undefined} openLabel="只看已发布的问答"
          selected={statusFilter === "published"} selectedText="已筛选" aria-pressed={statusFilter === "published"} />
        <Stat icon={FilePen} tone="role-2" label="草稿" value={knowledgeAvailable ? drafts : "—"} unit={knowledgeAvailable ? "条" : undefined}
          sub={knowledgeAvailable && drafts > 0 ? "用户看不到" : undefined}
          explain="只在后台，用户和客服都读不到。点这一格只看草稿。"
          onOpen={knowledgeAvailable && (drafts > 0 || statusFilter === "draft") ? () => toggleStatus("draft") : undefined} openLabel="只看草稿"
          selected={statusFilter === "draft"} selectedText="已筛选" aria-pressed={statusFilter === "draft"} />
      </StatBand>

      <FilterBar
        more={<>
          <FilterField label="分类">
            <Select aria-label="常见问答 分类筛选" value={categoryFilter === "all" ? "" : categoryFilter} onChange={(value) => setCategoryFilter((value || "all") as typeof categoryFilter)}
              options={[{ value: "", label: "全部分类" }, ...FAQ_CATEGORY_OPTIONS.map((category) => ({ value: category, label: catCN(category) }))]} />
          </FilterField>
          <FilterField label="状态">
            <Select aria-label="常见问答 状态筛选" value={statusFilter === "all" ? "" : statusFilter} onChange={(value) => setStatusFilter((value || "all") as typeof statusFilter)}
              options={[{ value: "", label: "全部状态" }, { value: "published", label: "已发布" }, { value: "draft", label: "草稿" }]} />
          </FilterField>
        </>}
        moreCount={(categoryFilter !== "all" ? 1 : 0) + (statusFilter !== "all" ? 1 : 0)}
        applied={conditions.filter((condition) => condition.key === "category" || condition.key === "status").map((condition) => ({ key: condition.key, label: condition.label, onRemove: condition.clear }))}
        onClear={clearFilters}
        canClear={conditions.length > 0}
        result={knowledgeAvailable && conditions.length > 0 ? `筛出 ${filteredFaqs.length} 条，共 ${visibleFaqs.length} 条` : undefined}
      >
        <FilterField grow><Input aria-label="搜索常见问答" placeholder="搜索编号、问题或回答" value={query} onChange={(event) => setQuery(event.target.value)} /></FilterField>
        <FilterField>
          <Select aria-label="常见问答 位置筛选" value={surfaceFilter === "all" ? "" : surfaceFilter} onChange={(value) => setSurfaceFilter((value || "all") as typeof surfaceFilter)}
            options={[{ value: "", label: "全部位置" }, ...SURFACES.map((surface) => ({ value: surface, label: surfaceName(surface) }))]} />
        </FilterField>
        <FilterField>
          <Select aria-label="常见问答 语言筛选" value={languageFilter === "all" ? "" : languageFilter} onChange={(value) => setLanguageFilter(value || "all")}
            options={[{ value: "", label: "全部语言" }, ...languageOptions.map((code) => ({ value: code, label: languageName(code) }))]} />
        </FilterField>
      </FilterBar>

      <Panel flush icon={BookOpenText} tone="role-2" title="问答" sub={`时间为${businessZone().label}`} explain="按排序值从小到大排，同值的后更新的在前。帮助中心也按排序值排，同值时顺序可能不同。点一行看全文和谁读得到。">
        <Table label="问答列表" className="m4-table">
          <thead><tr>
            <Th>问题</Th>
            <Th className="m4-col-cat">分类</Th>
            <Th className="m4-col-who"><Explain label="给谁看怎么算" content="显示位置加语言。帮助中心的问答给 App 里界面是这个语言的用户看；中文问答客服回复时也能查到。Nova 智能问答已下线，放在那里的用户看不到。">给谁看</Explain></Th>
            <Th className="m4-col-state">状态</Th>
            <Th className="m4-col-sort" align="right">排序</Th>
            <Th className="m4-col-upd">最近更新</Th>
            {canEdit && <Th sticky="end">操作</Th>}
          </tr></thead>
          <tbody>
            {loading ? <TableLoading columns={tableColumns} rows={FAQ_PAGE_SIZE} />
              : failed ? <TableMessage columns={tableColumns} role="alert">列表先不显示，读到后再列出。</TableMessage>
                : visibleFaqs.length === 0 ? <TableMessage columns={tableColumns} role="status">知识库里还没有问答</TableMessage>
                  : pagedFaqs.length === 0 ? <TableMessage columns={tableColumns} role="status">{narrowMessage()} <Button size="sm" onClick={clearFilters}>清除筛选</Button></TableMessage>
                    : pagedFaqs.map((f) => (
                      <Tr key={f.id} data-proof="support-faq-row" data-faq-id={f.id} selected={openId === f.id} onOpen={() => setOpenId(f.id)}>
                        <Td grow><Cell main={f.question} sub={f.answer} title={f.question} /></Td>
                        <Td><Cell main={catCN(f.category)} /></Td>
                        <Td><Cell main={surfaceName(f.surface)} sub={audienceSub(f)} /></Td>
                        <Td><FaqStatusTag status={f.status} /></Td>
                        <Td align="right"><Cell num main={f.sortOrder} /></Td>
                        <Td><Cell num main={f.updatedAt.slice(0, 16)} sub={versionLine(f)} title={authorOf(f.id) === undefined ? undefined : versionLine(f)} /></Td>
                        {canEdit && <Td sticky="end" data-fit="">
                          <span className="m4-row-actions">
                            <Button size="sm" variant="ghost" icon={<Pencil size={14} aria-hidden />} disabled={writePending || blocked(f.id)} onClick={() => openEdit(f)}>编辑</Button>
                            {f.status === "draft"
                              ? <Button size="sm" data-proof="support-faq-publish" icon={<Upload size={14} aria-hidden />} disabled={writePending || blocked(f.id)} onClick={() => openStatus(f)}>发布</Button>
                              : <Button size="sm" data-proof="support-faq-unpublish" icon={<Archive size={14} aria-hidden />} disabled={writePending || blocked(f.id)} onClick={() => openStatus(f)}>下架</Button>}
                            <MoreMenu label={`更多操作：${f.question}`} disabled={writePending || blocked(f.id)} items={[{ key: "delete", label: <><Trash2 size={14} aria-hidden /> 删除</>, danger: true, onSelect: () => requestDeleteFaq(f) }]} />
                          </span>
                        </Td>}
                      </Tr>
                    ))}
          </tbody>
        </Table>
        {knowledgeAvailable && filteredFaqs.length > 0 && <Pager label="问答列表" total={filteredFaqs.length} page={currentPage} pageSize={pageSize} sizes={[5, 10, 20, 50]} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />}
      </Panel>

      <M4FaqDrawer faq={current} author={current ? authorOf(current.id) : undefined} nav={drawerNav} busy={writePending} canWrite={canEdit && !blocked(current?.id)}
        onClose={() => setOpenId(null)} onEdit={() => current && openEdit(current)} onStatus={() => current && openStatus(current)} onDelete={() => current && requestDeleteFaq(current)} />

      {statusTarget && !releasing && <M4StatusConfirm faq={statusTarget} returnFocus={() => returnToFaq(dialogOpener.current, statusTarget.id)} busy={writePending || Boolean(activeRecovery?.state?.busy)} disabled={activeRecovery ? Boolean(activeRecovery.blockedReason || activeRecovery.state?.replayBlock) : Boolean(statusBlock)}
        disabledReason={activeRecovery ? activeRecovery.blockedReason : statusBlock} failure={statusFailure} retry={activeRecovery} info={activeInfo} onQuery={activeRecovery?.query && (() => { setStatusFailure(null); void activeRecovery.query!(); })}
        onCancel={() => { setRecovery(null); setStatusTarget(null); }}
        onConfirm={async () => {
          setStatusFailure(null);
          if (await changeFaqStatus(statusTarget.id, statusTarget.status === "draft" ? "published" : "draft", setStatusFailure)) setStatusTarget(null);
        }} />}

      {(showAddFaq || editFaq) && !releasing && <FaqModal key={recovery?.commandKey ?? `${editFaq?.id ?? "new"}:${draftRevision}`} returnFocus={() => returnToFaq(dialogOpener.current, editFaq?.id)} row={editFaq} draft={recoveredDraft} authorOf={authorOf} recovery={recovery} recoveryBindings={activeRecovery} info={activeInfo} gone={Boolean(!recovery && editFaq && knowledgeAvailable && !faqs.some(faq => faq.id === editFaq.id))} pending={writePending || Boolean(activeRecovery?.state?.busy)} disabled={activeRecovery ? Boolean(activeRecovery.blockedReason || activeRecovery.state?.replayBlock) : !canEdit} onClose={() => { createFaqTempId.current = null; setRecoveredDraft(null); setRecovery(null); setShowAddFaq(false); setEditFaq(null); }} onSave={saveFaq} />}
    </>
  );
}

function FaqModal({
  row,
  draft,
  authorOf,
  pending,
  recovery,
  recoveryBindings,
  info,
  gone,
  disabled,
  onClose,
  onSave,
  returnFocus,
}: {
  row: SupportFaq | null;
  draft: RecoveredFaqDraft | null;
  authorOf: (id: string) => string | null | undefined;
  pending: boolean;
  recovery: MCommandRecord | null;
  recoveryBindings?: FaqRecoveryBindings;
  /** 恢复原操作时：和行同一份结论。 */
  info?: FaqRecoveryInfo;
  /** 要改的问答已不在列表里（不是恢复原操作时）：内容留着能复制，不能保存。 */
  gone: boolean;
  disabled: boolean;
  onClose: () => void;
  onSave: (form: FaqForm, onFailure: (error: Error, clearReason?: boolean) => void) => Promise<boolean>;
  returnFocus: () => HTMLElement | null;
}) {
  const initial = recovery?.faq?.row ?? draft?.row ?? row;
  const [category, setCategory] = useState<SupportFaq["category"]>(initial?.category ?? "general");
  const [surface, setSurface] = useState<SupportFaq["surface"]>(initial?.surface ?? "Help Center");
  const [language, setLanguage] = useState<string>(initial?.language ?? DEFAULT_FAQ_LANGUAGE);
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 10));
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [status, setStatus] = useState<SupportFaq["status"]>(initial?.status ?? "published");
  const [reason, setReason] = useState(recovery?.faq ? JSON.parse(recovery.faq.request.body).reason as string : "");
  const reasonRule = useMOperationReason(!recovery, reason);
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  // 只管界面：记住打开时的版本，重读后版本变了就把别人改的项列出来，和框里你填的对照。
  const [opened] = useState(draft?.before ?? row);
  const latest = !recovery && row && opened && (row.version !== opened.version || row.status !== opened.status) ? row : null;
  const latestChanges = latest && opened ? [
    opened.question !== latest.question && `问题（最新）：${latest.question}`,
    opened.answer !== latest.answer && `回答（最新）：${latest.answer}`,
    opened.surface !== latest.surface && `显示位置：${surfaceName(opened.surface)} → ${surfaceName(latest.surface)}`,
    opened.language !== latest.language && `语言：${languageName(opened.language)} → ${languageName(latest.language)}`,
    opened.category !== latest.category && `分类：${catCN(opened.category)} → ${catCN(latest.category)}`,
    opened.sortOrder !== latest.sortOrder && `排序：${opened.sortOrder} → ${latest.sortOrder}`,
    opened.status !== latest.status && `发布状态：${opened.status === "published" ? "已发布" : "草稿"} → ${latest.status === "published" ? "已发布" : "草稿"}`,
  ].filter((line): line is string => Boolean(line)) : [];
  // 和 saveFaq 同一套规则，只用来把错写在对应的框下面；真正挡写入的仍是 saveFaq。
  const sortValue = Number(sortOrder);
  const errors = {
    question: !question.trim() ? "请写问题" : question.trim().length > 160 ? `超出 ${question.trim().length - 160} 字，后台最多收 160 字` : "",
    answer: !answer.trim() ? "请写回答" : answer.trim().length > 4000 ? `超出 ${answer.trim().length - 4000} 字，后台最多收 4000 字` : "",
    sort: !Number.isInteger(sortValue) || sortValue < 0 || sortValue > 999999 ? "填 0–999999 的整数" : "",
  };
  const blocking = Boolean(errors.question || errors.answer || errors.sort || !reasonRule.ok);
  const show = (key: keyof typeof errors) => (tried ? errors[key] : "") || undefined;
  const live = row?.status === "published" || status === "published";
  const unknown = isOutcomeUnknownError(failure);
  const querying = recoveryBindings?.state?.busy === "query";
  // 英语问答改成别的语言保存，后端会清掉附带的翻译（OpsSupportKnowledgeService.updateFaq）。
  const translationCount = row?.language === "en-US" && language !== "en-US" ? Object.keys(row.translations ?? {}).length : 0;
  const dirty = question !== (row?.question ?? "") || answer !== (row?.answer ?? "") || reason !== "" || category !== (row?.category ?? "general")
    || surface !== (row?.surface ?? "Help Center") || language !== (row?.language ?? DEFAULT_FAQ_LANGUAGE) || sortOrder !== String(row?.sortOrder ?? 10) || status !== (row?.status ?? "published");
  const save = () => {
    setTried(true);
    setFailure(null);
    if (!recovery && blocking) return;
    void onSave({ category, surface, language, sortOrder, question, answer, status, reason }, (error, clearReason) => {
      if (clearReason) { setReason(""); setTried(false); }
      setFailure(error);
    });
  };
  return (
    <Modal
      title={row ? "编辑问答" : "新建问答"}
      icon={row ? Pencil : Plus}
      className="m4-faq-form"
      wide
      busy={pending}
      dirty={dirty}
      sub={<>
        {live ? <StatusTag tone="progress" filled>{row?.status === "published" && status === "draft" ? "保存后立即下架" : "保存后立即生效"}</StatusTag> : <StatusTag tone="neutral" filled>保存草稿，线上不变</StatusTag>}
        {row && <span className="m4-form-id"><span data-mono="">{row.id} · 第 {row.version} 版</span>{authorOf(row.id) && <> · {authorOf(row.id)} 改</>}</span>}
      </>}
      onClose={onClose}
      returnFocus={returnFocus}
      footer={
        <>
          <Button disabled={pending} onClick={onClose}>取消</Button>
          {recovery && <Button variant={recoveryBindings?.state?.replayBlock && !info?.rejected ? "primary" : "secondary"} loading={querying} loadingText="查询中…" disabled={pending} disabledReason={recoveryBindings?.query ? undefined : "当前账号没有知识库查看权限"}
            onClick={() => { setFailure(null); void recoveryBindings?.query?.(); }}>查询原结果</Button>}
          {info?.rejected ? <Button onClick={info.release}>核实后解除</Button>
            : <Button variant={recovery && recoveryBindings?.state?.replayBlock ? "secondary" : "primary"} data-proof="support-faq-save" loading={pending && !querying} loadingText="提交中…" disabled={disabled || gone}
              disabledReason={pending ? undefined : recovery ? recoveryBindings?.blockedReason : gone ? "这条问答已不在列表里，不能保存" : disabled ? "问答正在读取或没读到，读到后再保存" : reasonRule.blocked} onClick={save}>{recovery ? "按原请求重试" : row ? "保存修改" : status === "published" ? "保存并发布" : "保存草稿"}</Button>}
        </>
      }
    >
      {gone && <Notice tone="warn" title="这条问答已不在列表里" action={<MAuditLink />}><p>不能再保存。要再用，复制下面的内容新建一条。</p></Notice>}
      {row?.status === "published" && !recovery && !gone && <Notice tone="warn">这条在线上，保存后几分钟内用户就会看到新内容。</Notice>}
      {failure && !unknown && !latest && <Notice tone="danger" title="没有保存成功"><p>{failure?.message}</p></Notice>}
      {latest && opened && <Notice tone="warn" title={failure ? "没有保存：这条问答刚被别人改过" : "这条问答刚被别人改过"}>
        <p>现在是第 {latest.version} 版{authorOf(latest.id) && <>（{authorOf(latest.id)} 改的）</>}，你改的是第 {opened.version} 版。你改过的项目已带到最新问答。核对后重新填写理由并保存。</p>
        {latestChanges.length > 0 && <ul className="m5-plain-list">{latestChanges.map((line) => <li key={line}>{line}</li>)}</ul>}
      </Notice>}
      {info && <Notice tone={mNoticeTone(info.view)} title={info.view.label} action={info.audit ? <MAuditLink /> : undefined}>
        <p>{info.gone && GONE_TEXT}{info.view.line}</p>
        {failure?.message && <p>{failure.message}</p>}
        <p>框里是原来提交的内容，已锁定。</p>
      </Notice>}
      <div className="m4-form">
        <div className="m4-form-fields">
          <div className="rd-form-grid" data-cols="2" data-dense="">
            <Field label="显示位置" explain="帮助中心：App 里「我的 › 帮助中心」。Nova 智能问答已在 App 下线，选它用户看不到。">
              <Segments label="显示位置" value={surface} onChange={setSurface} items={SURFACES.map((value) => ({ value, label: surfaceName(value), disabled: pending || Boolean(recovery) }))} />
            </Field>
            <Field label="语言">
              {(control) => <Select disabled={pending || Boolean(recovery)} {...control} aria-label="问答语言" value={language} onChange={setLanguage}
                options={[...M4_LANGUAGES.map((option) => ({ value: option.code, label: option.name })), ...(M4_LANGUAGES.some((option) => option.code === language) ? [] : [{ value: language, label: language }])]} />}
            </Field>
          </div>
          {surface === "Nova" && <Notice tone="warn">Nova 智能问答已在 App 下线，放在这里的问答用户看不到。</Notice>}
          {translationCount > 0 && <Notice tone="warn">改成{languageName(language)}保存后，这条附带的 {translationCount} 种翻译会被清掉。</Notice>}
          <section aria-label={status === "published" ? "保存后谁读得到" : "发布后谁读得到"}>
            <h3 className="m4-block-title">{status === "published" ? "保存后谁读得到" : "发布后谁读得到"}</h3>
            <ReachList faq={{ surface, language }} label={status === "published" ? "保存后谁读得到" : "发布后谁读得到"} />
          </section>
          <Field label="问题" required error={show("question")}>
            {(control) => <Textarea disabled={pending || Boolean(recovery)} {...control} data-proof="support-faq-question" rows={1} value={question} count={`${question.trim().length}/160`} onChange={(e) => setQuestion(e.target.value)} placeholder="用户会怎么问，就怎么写。例如：提现审核要多久？" />}
          </Field>
          <Field label="回答" required error={show("answer")}>
            {(control) => <Textarea disabled={pending || Boolean(recovery)} {...control} className="m4-answer" data-proof="support-faq-answer" rows={5} value={answer} count={`${answer.trim().length}/4000`} onChange={(e) => setAnswer(e.target.value)} placeholder={"写清用户自己能做的步骤；换行会原样显示。\n例如：提现提交后一般 24 小时内审核完成。"} />}
          </Field>
          <div className="rd-form-grid" data-cols="3" data-dense="">
            <Field label="分类">
              {(control) => <Select disabled={pending || Boolean(recovery)} {...control} aria-label="问答分类" value={category} onChange={(value) => setCategory(value as SupportFaq["category"])} options={FAQ_CATEGORY_OPTIONS.map((c) => ({ value: c, label: catCN(c) }))} />}
            </Field>
            <Field label="排序" hint="小值靠前" explain="0–999999 的整数，从小到大排。同值时本页后更新的在前，帮助中心的顺序可能不同。" error={show("sort")}>
              {(control) => <NumberInput disabled={pending || Boolean(recovery)} {...control} min={0} max={999999} step={1} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />}
            </Field>
            <Field label="发布状态">
              <Segments label="发布状态" value={status} onChange={setStatus} items={[{ value: "published", label: "已发布", disabled: pending || Boolean(recovery) }, { value: "draft", label: "草稿", disabled: pending || Boolean(recovery) }]} />
            </Field>
          </div>
          <Field label="操作理由" required hint={recovery ? undefined : reasonRule.hint} error={!recovery && (tried || reason) ? reasonRule.fieldError : undefined}>
            {(control) => <Textarea disabled={pending || Boolean(recovery)} {...control} data-proof="support-faq-reason" rows={2} value={reason} count={reasonRule.count} onChange={(e) => setReason(e.target.value)} placeholder="例如：帮助中心提现板块补齐" />}
          </Field>
        </div>
        <aside className="m4-form-preview" aria-label="帮助中心里大概这样">
          <h3 className="m4-block-title">帮助中心里大概这样<Explain label="预览怎么来的" content="按 App 帮助中心的排版近似画出：问题一行，展开是回答，换行原样保留。实际字号和折行以 App 为准。" /></h3>
          <FaqPreview question={question} answer={answer} />
        </aside>
      </div>
    </Modal>
  );
}
