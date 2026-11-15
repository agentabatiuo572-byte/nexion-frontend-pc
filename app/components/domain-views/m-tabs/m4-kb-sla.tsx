"use client";

/** M4 help center content. Retired ticket configuration remains stored on the server. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpenText, CheckCircle2, FilePen, Pencil, Plus, Trash2, Upload, Archive } from "lucide-react";
import { buildM4FaqCommand, sendM4FaqCommand } from "@/lib/admin/m-client";
import { mCommands, type MCommandRecord } from "@/lib/admin/m-pending-commands";
import type { M4FaqCommand } from "@/lib/admin/m4-faq-command";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { MContentReadError } from "@/lib/admin/m-support-read-contract";
import { businessZone } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
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

const FAQ_KEY = "I.support.faqs";

const CATEGORY_OPTIONS: SupportTicketCategory[] = ["withdrawal", "deposit", "hardware", "account", "earnings", "genesis", "technical", "other"];
const FAQ_CATEGORY_OPTIONS: SupportFaq["category"][] = ["general", ...CATEGORY_OPTIONS];
const SURFACES: SupportFaq["surface"][] = ["Help Center", "Nova"];
const FAQ_PAGE_SIZE = 5;

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
const minReason = (r: string) => r.trim().length >= 8 && r.trim().length <= 200;

type FaqForm = { category: SupportFaq["category"]; surface: SupportFaq["surface"]; language: string; sortOrder: string; question: string; answer: string; status: SupportFaq["status"]; reason: string };

export function M4KbSla({ ctx, title, summary, loadError }: { ctx: MCtx; title: string; summary: string; loadError: string | null }) {
  const { pget, toast, openActionConfirm } = ctx;
  const actorId = useAdminAuth((state) => state.session?.adminId);
  const [needsRead, setNeedsRead] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<MCommandRecord[]>([]);
  const [recovery, setRecovery] = useState<MCommandRecord | null>(null);
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const isSuperAdmin = currentRole === "super" || currentRole === "superadmin";
  const canWriteM4 = isSuperAdmin || Boolean(authorities?.includes("service_m4_write"));
  // Undefined is the initial loading state. Writes stay fail-closed until the
  // strict M4 response validator explicitly publishes a successful "1".
  const knowledgeAvailable = pget("I.support.knowledgeAvailable") === "1" && !needsRead;
  const faqs = useMemo(() => parseParamArray<SupportFaq>(pget(FAQ_KEY), []), [ctx.params, pget]);
  const canEdit = canWriteM4 && knowledgeAvailable && !ctx.contentLoading;

  const [showAddFaq, setShowAddFaq] = useState(false);
  const [editFaq, setEditFaq] = useState<SupportFaq | null>(null);
  useEffect(() => {
    if (!recovery) setEditFaq(current => current ? faqs.find(faq => faq.id === current.id) ?? current : current);
  }, [faqs, recovery]);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupportFaq["category"]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SupportFaq["status"]>("all");
  const [surfaceFilter, setSurfaceFilter] = useState<"all" | SupportFaq["surface"]>("all");
  const [languageFilter, setLanguageFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(FAQ_PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<SupportFaq | null>(null);
  const deleteConfirmation = useRef<{ faq: SupportFaq; request: Parameters<MCtx["openActionConfirm"]>[0] } | null>(null);
  const [statusFailure, setStatusFailure] = useState("");
  const [writePending, setWritePending] = useState(false);
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
  useEffect(syncPending, [syncPending]);
  const blocked = (id?: string) => pendingCommands.some((record) => !record.faq || (id ? record.faq.row.id === id : record.faq.kind === "create"));
  const closeWriteDialogs = () => { setRecovery(null); setEditFaq(null); setShowAddFaq(false); setStatusTarget(null); };
  useEffect(() => { closeWriteDialogs(); }, [actorId]);
  const readCurrent = async () => {
    try {
      await ctx.refreshKnowledge();
      setNeedsRead(false);
      return true;
    } catch (error) {
      setNeedsRead(true);
      toast(displayAdminError(error), "warn");
      return false;
    }
  };
  const commitM4Write = async (command: M4FaqCommand, successMessage: string, onFailure?: (message: string) => void, original?: MCommandRecord): Promise<boolean> => {
    const currentSession = useAdminAuth.getState().session;
    if (writeInFlight.current || !currentSession || command.actorId !== currentSession.adminId
      || !(currentSession.role === "super" || currentSession.role === "superadmin" || currentSession.authorities.includes("service_m4_write"))) return false;
    if (!original && (!canEdit || blocked(command.before?.id))) return false;
    if (original && isRetryExpired(original)) { onFailure?.(RETRY_EXPIRED_TEXT); toast(RETRY_EXPIRED_TEXT, "warn"); return false; }
    const commandKey = original?.commandKey ?? `m4-${crypto.randomUUID()}`;
    const fingerprint = original?.fingerprint ?? `m4|${command.kind === "create" ? "create" : command.row.id}`;
    mCommands.remember(fingerprint, commandKey, { faq: command });
    syncPending();
    if (!mCommands.isDurablyStored(fingerprint, commandKey)) {
      const failure = "原操作未能保存，暂未提交。请恢复浏览器存储后按原请求重试。";
      if (!original) {
        // No request was sent. Keep the draft editable rather than inventing an unknown outcome.
        mCommands.forget(fingerprint, commandKey);
        syncPending();
      }
      onFailure?.(failure); toast(failure, "warn"); return false;
    }
    writeInFlight.current = true;
    setWritePending(true);
    try {
      await sendM4FaqCommand(command, commandKey);
      mCommands.forget(fingerprint, commandKey);
      syncPending();
      closeWriteDialogs();
      if (command.kind === "delete") ctx.closeActionConfirm?.();
      setNeedsRead(true);
      // An idempotency replay is an old receipt. Only the next overview can enable new edits.
      await readCurrent();
      toast(successMessage);
      return true;
    } catch (error) {
      const verdict = error instanceof MContentReadError && error.status === 200 && error.apiCode
        ? { status: error.apiCode, backendMessage: error.backendMessage } : error;
      const rejected = original ? isExplicitRejection(verdict)
        : error instanceof MContentReadError && !error.backendMessage?.startsWith("IDEMPOTENCY_")
          && isDeterministicRejection(error.status, error.apiCode);
      if (rejected) {
        mCommands.forget(fingerprint, commandKey);
        syncPending();
        if (original) {
          closeWriteDialogs();
          if (command.kind === "delete") ctx.closeActionConfirm?.();
        }
        setNeedsRead(true);
        await readCurrent();
      }
      if (!rejected) setRecovery(mCommands.list().find((record) => record.commandKey === commandKey) ?? null);
      const failure = `${rejected ? "后台拒绝了这次操作" : "结果未确认"} · ${displayAdminError(error)}`;
      if (onFailure && (!rejected || !original)) onFailure(failure); else toast(failure, rejected ? "error" : "warn");
      return false;
    } finally {
      writeInFlight.current = false;
      setWritePending(false);
    }
  };
  const retryOriginal = (record: MCommandRecord, onFailure?: (message: string) => void) => {
    if (!record.faq) return Promise.resolve(false);
    const labels = { create: "已保存", edit: "已保存", publish: "已发布", unpublish: "已下架为草稿", delete: "已删除" };
    return commitM4Write(record.faq, `${record.faq.row.id} ${labels[record.faq.kind]}`, onFailure, record);
  };

  const saveFaq = async (form: FaqForm, onFailure: (message: string) => void) => {
    if (recovery) return retryOriginal(recovery, onFailure);
    const sortOrder = Number(form.sortOrder);
    if (!form.question.trim() || !form.answer.trim() || form.question.trim().length > 160 || form.answer.trim().length > 4000 || !minReason(form.reason)) {
      toast("请填写问题、回答，以及 8 字以上的修改理由");
      return false;
    }
    if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 999999) {
      toast("排序值必须是 0–999999 的整数");
      return false;
    }
    if (editFaq) {
      const currentFaq = faqs.find((faq) => faq.id === editFaq.id);
      if (!currentFaq || currentFaq.version !== editFaq.version || currentFaq.status !== editFaq.status) {
        toast("这条问答刚被别人改过或已不在，你填的内容还在；核对最新内容后再保存。");
        return false;
      }
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
    if (!actorId) return false;
    const command = buildM4FaqCommand(editFaq ? "edit" : "create", row, editFaq, form.reason.trim(), actorId);
    const succeeded = await commitM4Write(command, `${row.id} 已保存 · ${catCN(row.category)}常见问答`, onFailure);
    if (succeeded) {
      createFaqTempId.current = null;
      setShowAddFaq(false);
      setEditFaq(null);
    }
    return succeeded;
  };

  const changeFaqStatus = async (id: string, status: SupportFaq["status"], onFailure: (message: string) => void) => {
    if (recovery) return retryOriginal(recovery, onFailure);
    const before = faqs.find((faq) => faq.id === id);
    if (!before || !actorId || !statusTarget || before.version !== statusTarget.version || before.status !== statusTarget.status) return false;
    const row = { ...before, status };
    return commitM4Write(buildM4FaqCommand(status === "published" ? "publish" : "unpublish", row, before,
      status === "published" ? "常见问答 发布例行审核留档" : "常见问答 下架例行审核留档", actorId),
      status === "published" ? `${id} 已发布` : `${id} 已下架为草稿`, onFailure);
  };
  const requestDeleteFaq = (faq: SupportFaq, original?: MCommandRecord) => {
    const published = faq.status === "published";
    const request: Parameters<MCtx["openActionConfirm"]>[0] = {
      action: <>删除常见问答 <span className="mono">{faq.id}</span></>,
      title: "删除这条问答",
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>本页不能恢复</IrreversibleTag></>,
      confirmTone: "danger",
      confirmLabel: original ? "按原请求重试" : "确认删除",
      briefKind: "faq-delete",
      statedBrief: {
        impact: published ? "删除后所有位置都不再读到这条问答，本页也找不回来；账号和资金不受影响。" : "这是草稿，用户本来就看不到；删除后本页找不回来，账号和资金不受影响。",
        check: "核对问题和回答，确认不再需要。只想先不让用户看到，用「下架」，以后还能重新发布。",
      },
      facts: <>{original && <Notice tone="warn" title="结果未知">{isRetryExpired(original) ? "原请求超过 24 小时，不能再重试，只能读回核对。" : "可能已经删除。按原请求重试不会重复执行。"}</Notice>}<Facts>
        <Fact k="问题"><span className="m4-fact-text">{faq.question}</span></Fact>
        <Fact k="给谁看">{surfaceName(faq.surface)} · {languageName(faq.language)}</Fact>
        <Fact k="状态">{published ? "已发布，删除后几分钟内从 App 消失" : "草稿"}</Fact>
      </Facts></>,
      detail: <>删除后要再用，只能重新新建这条问答。</>,
      reasonPlaceholder: "例如：内容已过时，已由新问答替代",
      reasonMin: 8,
      getPendingReason: () => {
        const saved = mCommands.list().find((record) => record.faq?.actorId === actorId && record.faq?.row.id === faq.id);
        return saved?.faq ? JSON.parse(saved.faq.request.body).reason : undefined;
      },
      initialReason: original?.faq ? JSON.parse(original.faq.request.body).reason : undefined,
      blockedReason: !canWriteM4 ? "当前账号没有知识库编辑权限" : original && isRetryExpired(original) ? RETRY_EXPIRED_TEXT : undefined,
      run: async (reason) => {
        const saved = mCommands.list().find((record) => record.faq?.actorId === actorId && record.faq?.row.id === faq.id);
        const current = faqs.find((row) => row.id === faq.id);
        if (saved) return retryOriginal(saved);
        if (!actorId || !current || current.version !== faq.version || current.status !== faq.status) return false;
        return commitM4Write(buildM4FaqCommand("delete", faq, faq, reason, actorId), `${faq.id} 已删除`);
      },
    };
    deleteConfirmation.current = original ? null : { faq, request };
    openActionConfirm(request);
  };
  useEffect(() => {
    if (recovery || !knowledgeAvailable) return;
    setStatusTarget(current => {
      if (!current) return null;
      const fresh = faqs.find(row => row.id === current.id);
      // Do not turn a publish confirmation into an unpublish (or vice versa).
      return fresh?.status === current.status ? fresh : null;
    });
    const current = deleteConfirmation.current;
    if (!current || ctx.actionConfirm !== current.request) return;
    const fresh = faqs.find(row => row.id === current.faq.id);
    if (!fresh) { deleteConfirmation.current = null; ctx.closeActionConfirm?.(); return; }
    if (fresh.version !== current.faq.version || fresh.status !== current.faq.status) requestDeleteFaq(fresh);
  }, [faqs, recovery, knowledgeAvailable]);

  const openCreate = () => { setRecovery(null); createFaqTempId.current = nextFaqId(); setEditFaq(null); setShowAddFaq(true); };
  const openEdit = (faq: SupportFaq) => { setRecovery(null); createFaqTempId.current = null; setShowAddFaq(false); setEditFaq(faq); };
  const openStatus = (faq: SupportFaq) => { setRecovery(null); setStatusFailure(""); setStatusTarget(faq); };

  const restore = (record: MCommandRecord) => {
    if (!record.faq) return;
    closeWriteDialogs();
    setRecovery(record);
    if (record.faq.kind === "delete") requestDeleteFaq(record.faq.row, record);
    else if (record.faq.kind === "publish" || record.faq.kind === "unpublish") {
      setStatusFailure(""); setStatusTarget(record.faq.before);
    } else {
      createFaqTempId.current = record.faq.row.id;
      setEditFaq(record.faq.before); setShowAddFaq(record.faq.kind === "create");
    }
  };
  const pendingRows = pendingCommands.map((record) => ({ key: record.commandKey,
    question: record.faq?.row.question ?? "常见问答", change: record.faq ? ({ create: "新建", edit: "编辑", publish: "发布", unpublish: "下架", delete: "删除" }[record.faq.kind]) : "结果未知",
    submittedAt: record.createdAt, expired: isRetryExpired(record), actions: <>
      <Button size="sm" disabled={writePending} onClick={() => void readCurrent()}>读回核对</Button>
      {record.faq && canWriteM4 && !isRetryExpired(record) && <Button size="sm" disabled={writePending} onClick={() => restore(record)}>按原请求重试</Button>}
    </>,
  }));

  // 首屏数字：只算这页的问答，不随筛选变。读不到时写「—」，不当成 0。
  const published = visibleFaqs.filter((faq) => faq.status === "published");
  const drafts = visibleFaqs.length - published.length;
  // Nova 智能问答已在 App 下线（决定表「全站-Nova」），放在那里的问答算用户看不到。
  const unreachable = published.filter((faq) => !reachesUsers(faq));
  const byLanguage = M4_LANGUAGES.map((language) => ({ name: language.name, count: published.filter((faq) => faq.language === language.code).length })).filter((row) => row.count > 0);
  const otherLanguage = published.filter((faq) => !M4_LANGUAGES.some((language) => language.code === faq.language)).length;
  const loading = !knowledgeAvailable && ctx.contentLoading;
  const failed = !knowledgeAvailable && !ctx.contentLoading;
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

      <M4PendingWrites rows={pendingRows} />


      {loading ? <Conclusion state="unknown">正在读取问答…</Conclusion>
        : failed ? <div className="m4-health" data-module-health-state="error"><Conclusion state="unknown" action={<Button size="sm" onClick={() => void (needsRead ? readCurrent() : ctx.refreshContent())}>重新读取</Button>}
            hint={`暂时不能新建和修改。${loadError ? "客服中心的其他数据也没同步成功。" : ""}`}
            explain={`问答和旧的工单处理时限数据是一起读的，其中一份读不全，问答就显示不了。点「重新读取」${needsRead ? "只重读知识库" : "会重读整个客服中心"}。`}>问答读不到，现在不知道线上有哪些</Conclusion></div>
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
                        <Td><Cell num main={f.updatedAt.slice(0, 16)} sub={`第 ${f.version} 版`} /></Td>
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

      <M4FaqDrawer faq={current} nav={drawerNav} busy={writePending} canWrite={canEdit && !blocked(current?.id)}
        onClose={() => setOpenId(null)} onEdit={() => current && openEdit(current)} onStatus={() => current && openStatus(current)} onDelete={() => current && requestDeleteFaq(current)} />

      {statusTarget && <M4StatusConfirm faq={statusTarget} busy={writePending} disabled={!canWriteM4 || (recovery ? isRetryExpired(recovery) : !canEdit)} failure={statusFailure} retry={recovery ? { expired: isRetryExpired(recovery) } : undefined}
        onCancel={() => { setRecovery(null); setStatusTarget(null); }}
        onConfirm={async () => {
          setStatusFailure("");
          if (await changeFaqStatus(statusTarget.id, statusTarget.status === "draft" ? "published" : "draft", setStatusFailure)) setStatusTarget(null);
        }} />}

      {(showAddFaq || editFaq) && <FaqModal key={recovery?.commandKey ?? editFaq?.id ?? "new"} row={editFaq} recovery={recovery} pending={writePending} disabled={!canWriteM4 || (recovery ? isRetryExpired(recovery) : !canEdit)} onClose={() => { createFaqTempId.current = null; setRecovery(null); setShowAddFaq(false); setEditFaq(null); }} onSave={saveFaq} />}
    </>
  );
}

function FaqModal({
  row,
  pending,
  recovery,
  disabled,
  onClose,
  onSave,
}: {
  row: SupportFaq | null;
  pending: boolean;
  recovery: MCommandRecord | null;
  disabled: boolean;
  onClose: () => void;
  onSave: (form: FaqForm, onFailure: (message: string) => void) => Promise<boolean>;
}) {
  const initial = recovery?.faq?.row ?? row;
  const [category, setCategory] = useState<SupportFaq["category"]>(initial?.category ?? "general");
  const [surface, setSurface] = useState<SupportFaq["surface"]>(initial?.surface ?? "Help Center");
  const [language, setLanguage] = useState<string>(initial?.language ?? "zh-CN");
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 10));
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [status, setStatus] = useState<SupportFaq["status"]>(initial?.status ?? "published");
  const [reason, setReason] = useState(recovery?.faq ? JSON.parse(recovery.faq.request.body).reason as string : "");
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState("");
  // 只管界面：记住打开时的版本，重读后版本变了就把别人改的项列出来，和框里你填的对照。
  const [opened] = useState(row);
  const latest = !recovery && row && opened && row.version !== opened.version ? row : null;
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
    reason: !minReason(reason) ? (reason.trim().length < 8 ? `还差 ${8 - reason.trim().length} 字` : "最多 200 字") : "",
  };
  const blocking = Boolean(errors.question || errors.answer || errors.sort || errors.reason);
  const show = (key: keyof typeof errors) => (tried ? errors[key] : "") || undefined;
  const live = row?.status === "published" || status === "published";
  const unknown = failure.startsWith("结果未确认");
  // 英语问答改成别的语言保存，后端会清掉附带的翻译（OpsSupportKnowledgeService.updateFaq）。
  const translationCount = row?.language === "en-US" && language !== "en-US" ? Object.keys(row.translations ?? {}).length : 0;
  const dirty = question !== (row?.question ?? "") || answer !== (row?.answer ?? "") || reason !== "" || category !== (row?.category ?? "general")
    || surface !== (row?.surface ?? "Help Center") || language !== (row?.language ?? "zh-CN") || sortOrder !== String(row?.sortOrder ?? 10) || status !== (row?.status ?? "published");
  const save = () => {
    setTried(true);
    setFailure("");
    if (blocking) return;
    void onSave({ category, surface, language, sortOrder, question, answer, status, reason }, setFailure);
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
        {row && <span className="m4-form-id" data-mono="">{row.id} · 第 {row.version} 版</span>}
      </>}
      onClose={onClose}
      footer={
        <>
          <Button disabled={pending} onClick={onClose}>取消</Button>
          <Button variant="primary" data-proof="support-faq-save" loading={pending} disabled={disabled} onClick={save}>{recovery ? "按原请求重试" : row ? "保存修改" : status === "published" ? "保存并发布" : "保存草稿"}</Button>
        </>
      }
    >
      {row?.status === "published" && !recovery && <Notice tone="warn">这条在线上，保存后几分钟内用户就会看到新内容。</Notice>}
      {failure && !unknown && !latest && <Notice tone="danger" title="没有保存成功"><p>{failure}</p></Notice>}
      {latest && opened && <Notice tone="warn" title={failure ? "没有保存：这条问答刚被别人改过" : "这条问答刚被别人改过"}>
        <p>现在是第 {latest.version} 版，你改的是第 {opened.version} 版。你填的内容还在，核对后再保存。</p>
        {latestChanges.length > 0 && <ul className="m5-plain-list">{latestChanges.map((line) => <li key={line}>{line}</li>)}</ul>}
      </Notice>}
      {(unknown || recovery) && <Notice tone="warn" title="结果未知">
        <p>{recovery && isRetryExpired(recovery) ? "原请求超过 24 小时，不能再重试，只能读回核对。" : "可能已经保存。内容已锁定为原请求，按原请求重试不会重复执行。"}</p>
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
          <Field label="修改理由" required hint="至少 8 字" error={show("reason")}>
            {(control) => <Textarea disabled={pending || Boolean(recovery)} {...control} data-proof="support-faq-reason" rows={2} value={reason} count={`${reason.trim().length}/200`} onChange={(e) => setReason(e.target.value)} placeholder="例如：帮助中心提现板块补齐" />}
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
