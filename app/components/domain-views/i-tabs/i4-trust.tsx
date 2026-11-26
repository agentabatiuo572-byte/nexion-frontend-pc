"use client";
import { getRequiredContentLanguages, OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { localizedTrustSectionField, mapTrustSectionLanguageFields, validateTrustSectionTrilingualFields } from "@/lib/admin/trust-section-validation";
import { useReach } from "@/lib/nav/use-reach";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * I4 信任中心（改版）。I5 法律条款与风险披露是单独的新版页面，见 i5-disclosures.tsx。
 * 统一来源:后端 /content/trust-disclosure/overview;空库时保持空态,不补前端业务样例。
 * 首屏是 App 合同里六个版块的预览卡，下面是四份公司资料和全部版本。
 * 草稿保存直接写；发布、回滚、下架是提交审批，另一位管理员批准后才生效；PDF 上传和恢复默认直接生效。
 * 操作确认 显式 edit 契约:
 *  - 调参传 edit:回滚(select/current=v);
 *  - 处置不传 edit:发布信任版块 / 下架信任版块。
 * amplifies 全为 false —— I4 不碰 B1。原请求合同保持，原操作恢复按 R1 独立于新修改。
 */
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { CircleSlash, EyeOff, FilePen, History, Hourglass, LayoutList, Plus, RefreshCw, RotateCcw, Send, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints, LocaleTabs, MoreMenu, Notice, PageHeader, Panel, StatusTag, Table, TableMessage, Td, Th, Tr, type JudgmentRow, type MoreMenuItem, type StateTone } from "@/app/components/rd";
import { PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isOptionalTrustLinkField } from "@/lib/admin/trust-section-validation";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { pendingI4DraftCommands, queryI4DraftReceipt, retryI4DraftCommand, i4DraftRecovery, i4DraftRetryBlockedReason, i4DraftPermission, fetchI4PublishedSnapshot, fetchI4TrustOverview, type I4DraftCommand, type TrustDisclosureOverview } from "@/lib/admin/i-client";
import { useRecoveryQueryErrors } from "@/lib/admin/use-recovery-query-errors";
import { pendingI4SectionCommands, proposeI4Section, queryI4SectionCommand, releaseRejectedI4Section, i4SectionRecovery, retryI4SectionCommand, i4SectionPermission, settleI4ApprovedSections, type I4SectionCommand } from "@/lib/admin/i4-section-commands";
import { TRUST_DOCUMENT_NAMES } from "@/lib/admin/trust-documents-client";
import type { A2OperationRow } from "@/lib/admin/a2-client";
import { i4AppFieldIssue, i4DraftMatchesPublishedFields, i4DraftOmittedTranslations, i4FieldValueIssue, i4HasEnglishFields, i4OmittedTranslations } from "@/lib/admin/i4-trust-contract";
import type { ActionConfirmReq } from "./types";
import { displayAdminError } from "@/lib/admin/error-messages";
import { canInvestigateECommand, eCommandClosureOffer, eCommandSettled } from "@/lib/admin/e-command-investigation";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { FundClosureModal, fundRecoveryStatus, settledText } from "../fund-command-check";
import { OPEN_RESULT_LABELS, TechInfo, receiptFact, receiptOf } from "../recovery-panel";
import { CLOSURE_KEPT_TEXT } from "../direct-recovery-copy";
import { rejectedTag, replayRejectedStatus, useVerifiedRelease, VerifiedReleaseButton } from "../verified-release";
import { RETRY_REJECTED_NEXT, RETRY_REJECTED_TEXT } from "@/lib/admin/retry-rejected";
import { useIConflictReview } from "@/lib/admin/i-conflict-review";
import { conflictRow, IConflictModal, IConflictPending, inGroup, useIConflictView, type IConflictRow } from "./i-conflict";
import { OutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { I4Documents, type I4DocumentRecoveryNotice } from "./i4-documents";
import { i4DocumentRecovery, pendingI4DocumentCommands, queryI4DocumentCommand, type I4DocumentCommand, type I4DocumentUploadDraft } from "@/lib/admin/i4-document-commands";
import { isConfirmedNonExecution, rebaseTerminalDraft, useTerminalDrafts } from "@/lib/admin/use-terminal-drafts";
import {
  APP_FIELD_LIMIT, APP_SECTION_ORDER, DraftEditorBody, FieldList, I4RecoveryNotice, LegacyText, SECTION_INFO, SectionCard, SnapshotLine, snapshotBlanking, snapshotReasonText, type SnapshotState,
  VersionCompare, appBlanking, changedKeys, isArchivedStatus, previewFields, isPublished, localeItems, operatorText, sectionName, timeText, unpublishedEffect, TRUST_MISSING_ENGLISH, versionProblems,
  unknownTag, type Lang, type SectionCardModel, type RecoveryRow,
} from "./i4-parts";

const DRAFT_OPERATION = { create: "新建草稿", edit: "编辑草稿", delete: "删除草稿" } as const;
const SECTION_OPERATION = { publish: "提交发布", rollback: "回滚历史版", archive: "下架" } as const;
const docSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const trustDescriptionText = (value: string) => value === "首页 Trust 专项徽章" ? "首页信任与资质徽章" : nexGridBrandText(value);

type TrustSection = {
  key: string; desc: string; struct: string; v: string; status: string; lastChange: string; roleGate: string; highSensitivity: boolean;
};
type TrustSectionVersion = {
  sectionKey: string; version: string; description: string; structure: string;
  fields: { key: string; label: string; value: string }[];
  status: string; revision: number; operator: string; updatedAt: string;
};
const statusZh = (status?: string) => ({
  published: "已发布", draft: "草稿", archived: "已归档", superseded: "已取代",
  PUBLISHED: "已发布", DRAFT: "草稿", ARCHIVED: "已归档", SUPERSEDED: "已取代",
  pending: "待处理", active: "已启用", disabled: "已停用",
  PENDING: "待处理", ACTIVE: "已启用", DISABLED: "已停用",
  pending_review: "待发布复核", PENDING_REVIEW: "待发布复核",
} as Record<string, string>)[status ?? ""] ?? "未知状态";
/** 审批单的结论，和全站同一套叫法；statusZh 只管内容版本的状态。 */
const TICKET_STATUS: Record<A2OperationRow["status"], string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
/** 版本一行的状态：公开中的版本写「公开中」，被替代的写「历史版本」。 */
const versionTone = (status: string, live: boolean): { text: string; tone: StateTone } => {
  const value = status.toLowerCase();
  if (value === "draft") return { text: "草稿", tone: "neutral" };
  if (live) return { text: "公开中", tone: "ok" };
  if (value === "superseded") return { text: "历史版本", tone: "done" };
  if (value === "published") return { text: "已下架", tone: "danger" };
  return { text: statusZh(status), tone: "done" };
};
type TrustDetailKey = string;
type DraftEditor = {
  mode: "create" | "edit";
  sectionKey: string;
  version: string;
  description: string;
  structure: string;
  revision?: number;
  reason: string;
  fields: { key: string; label: string; value: string }[];
  expectedSectionVersion: string;
  expectedSectionStatus: string;
  published?: TrustSectionVersion;
  editBaseline?: TrustSectionVersion;
  resumedDraft?: { desired: NonNullable<I4DraftCommand["input"]>; before?: TrustSectionVersion; submitted?: true };
};

const trustDraftFieldsForSubmit = (fields: DraftEditor["fields"], required: readonly OperatingLanguageCode[]) =>
  mapTrustSectionLanguageFields(fields.map(({ key, label, value }) => ({
    key: key.trim(), label: label.trim(), value: value.trim(),
  })), required, "submit");

const NO_DRAFT_CHANGES = "没有改动";
function trustDraftUnchanged(editor: DraftEditor, fields: DraftEditor["fields"], required: readonly OperatingLanguageCode[]) {
  const base = editor.editBaseline;
  if (editor.mode !== "edit" || !base || editor.description.trim() !== base.description.trim()
    || editor.structure.trim() !== base.structure.trim()) return false;
  const baseline = trustDraftFieldsForSubmit(base.fields, required);
  return fields.length === baseline.length && fields.every(field =>
    baseline.some(row => row.key === field.key && row.label === field.label && row.value === field.value));
}

const APPROVER = "另一位超级管理员";
const PENDING_REASON = "有申请等另一位超级管理员处理，批准、驳回、撤回或过期后才能再改";
const APPROVED_READBACK_REQUIRED = "审批单已批准，请先重新读取当前版块。";
const FINANCE_LABEL: Record<string, string> = { tvlOnChain: "链上资产总值", mrrValue: "月度收入", mrrDelta: "月度收入变化", activeAccountsValue: "活跃账户数", activeAccountsDelta: "活跃账户变化", devicesOnlineValue: "在线设备数", devicesOnlineDelta: "在线设备变化", payoutsProcessedValue: "累计处理付款", payoutsProcessedDelta: "付款金额变化", "footnote.zh": "中文数据说明", "footnote.vi": "越南语数据说明", "footnote.en": "英文数据说明" };

export function I4Trust({ ctx, errorText }: { ctx: ICtx; errorText?: string | null }) {
  const { toast, openActionConfirm, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const publicationDrafts = useTerminalDrafts<string>();
  const materialDrafts = useTerminalDrafts<I4DocumentUploadDraft>();
  const trustDrafts = useTerminalDrafts<NonNullable<DraftEditor["resumedDraft"]>>();
  const approvalQuery = useRecoveryQueryErrors();
  const materialQuery = useRecoveryQueryErrors();
  const retainTrustDraft = (record: I4DraftCommand) => {
    if (!record.input || !record.original) return;
    const { version, description, structure, fields, expectedRevision, expectedSectionVersion, expectedSectionStatus } = record.input;
    const baseline = record.action === "create" ? record.snapshot : record.editBaseline;
    trustDrafts.remember(record.original.owner, record.action === "create" ? `new:${record.sectionKey}` : `${record.sectionKey}:${record.version}`, {
      desired: { version, description, structure, fields, expectedRevision, expectedSectionVersion, expectedSectionStatus },
      before: baseline,
      submitted: true,
    });
  };
  const rememberPublication = (record: I4SectionCommand, status?: string) => {
    approvalQuery.clear(record.commandKey);
    if (!status || status === "pending" || status === "approved" || record.action !== "publish" || record.owner === undefined) return;
    const statement = record.request?.command.params.dataSourceStatement;
    if (typeof statement === "string") publicationDrafts.remember(record.owner, `${record.sectionKey}:${record.after}`, statement);
  };
  const reach = useReach();

  const canDraftTrust = !!session?.authorities.includes("content_i4_write");
  const canPublishStandard = !!session?.authorities.includes("content_i4_publish_standard");
  const canPublishSensitive = !!session?.authorities.includes("content_i4_trust_section_manage");
  const [secKey, setSecKey] = useState<TrustDetailKey | null>(null);
  const [requiredLanguages, setRequiredLanguages] = useState<readonly OperatingLanguageCode[]>(OPERATING_LANGUAGE_CODES);
  const [draftEditor, setDraftEditor] = useState<DraftEditor | null>(null);
  const [detailLang, setDetailLang] = useState<Lang>("zh");
  const [readAt, setReadAt] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const data = content.trustDisclosure;
  const conflictReview = useIConflictReview<TrustDisclosureOverview, {
    sectionKey?: string; draftEditor?: DraftEditor | null; reason: string; value?: string; form?: Record<string, string>;
  }, I4DraftCommand | I4SectionCommand>();
  const reviewConflict = (error: unknown, requested: NonNullable<typeof conflictReview.review>["requested"]) =>
    conflictReview.reject(error, requested, async () => {
      const latest = await fetchI4TrustOverview();
      await actions.reloadIContent();
      return latest;
    });
  const conflictView = useIConflictView(conflictReview.review);
  /** 核对冲突后重开确认框时带回所选版本和数据来源，只用一次。 */
  const prefill = useRef<{ key: string; value?: string; dataSource?: string } | null>(null);
  const [draftCommands, setDraftCommands] = useState<I4DraftCommand[]>([]);
  const [draftOutcomes, setDraftOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [closingDraft, setClosingDraft] = useState<I4DraftCommand | null>(null);
  const [sectionCommands, setSectionCommands] = useState<I4SectionCommand[]>([]);
  const [sectionReadErrors, setSectionReadErrors] = useState<Record<string, {
    record: I4SectionCommand; status: A2OperationRow["status"]; reason: string;
  }>>({});
  const [documentCommands, setDocumentCommands] = useState<I4DocumentCommand[]>([]);
  const [documentRecovery, setDocumentRecovery] = useState<I4DocumentRecoveryNotice | null>(null);
  const [recovering, setRecovering] = useState<string | null>(null);
  useSyncExternalStore(i4SectionRecovery.subscribe, i4SectionRecovery.getRevision, i4SectionRecovery.getRevision);
  useSyncExternalStore(i4DraftRecovery.subscribe, i4DraftRecovery.getRevision, i4DraftRecovery.getRevision);
  useSyncExternalStore(i4DocumentRecovery.subscribe, i4DocumentRecovery.getRevision, i4DocumentRecovery.getRevision);
  const materialReads = useRef(new Map<string, number>());
  const release = useVerifiedRelease(toast);
  const sectionConfirm = useRef<{ key: string; request: ActionConfirmReq; commandKey: () => string | undefined } | null>(null);
  const inFlight = useRef(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [editorCommandKey, setEditorCommandKey] = useState<string | null>(null);
  const [mustRead, setMustRead] = useState(false);
  const invalidatedData = useRef(data);
  const latest = useRef({ data, errorText, contentLoading, mustRead, draftEditor, editorCommandKey });
  latest.current = { data, errorText, contentLoading, mustRead, draftEditor, editorCommandKey };
  const syncCommands = () => { setDraftCommands(pendingI4DraftCommands()); setSectionCommands(pendingI4SectionCommands()); setDocumentCommands(pendingI4DocumentCommands()); };
  useEffect(() => {
    syncCommands();
    if (pendingI4SectionCommands().some(record => record.ticketStatus === "approved")) void reloadSectionFacts();
  }, []);
  useEffect(() => {
    if (!data || data === invalidatedData.current || contentLoading || errorText) return;
    setMustRead(false);
    setSectionReadErrors(current => {
      const remaining = Object.entries(current).filter(([, { record }]) =>
        !data.trustSections.some(section => section.key === record.sectionKey));
      return remaining.length === Object.keys(current).length ? current : Object.fromEntries(remaining);
    });
  }, [data, contentLoading, errorText]);
  useEffect(() => {
    for (const record of pendingI4SectionCommands()) {
      if (record.receiptKnown && record.ticketStatus !== "approved" && !i4SectionRecovery.state(record).busy) {
        void checkSectionTicket(record).catch(() => undefined);
      }
    }
  }, [data]);
  useEffect(() => {
    const expiry = [...draftCommands, ...sectionCommands, ...documentCommands].filter(row => !isRetryExpired(row)).reduce((at, row) => Math.min(at, row.expiresAt), Infinity);
    if (!Number.isFinite(expiry)) return;
    const timer = window.setTimeout(syncCommands, Math.max(1, expiry - Date.now() + 10));
    return () => window.clearTimeout(timer);
  }, [draftCommands, sectionCommands, documentCommands]);
  const pendingTrustSectionKeys = new Set([...(data?.pendingTrustSectionKeys ?? []), ...sectionCommands.filter(row => row.ticketStatus === "pending").map(row => row.sectionKey)]);
  const pendingTrustSectionList = [...pendingTrustSectionKeys];
  const pendingA2Href = pendingTrustSectionList.length === 1
    ? `/platform/audit?domain=I&object=${encodeURIComponent(pendingTrustSectionList[0])}`
    : "/platform/audit?domain=I";
  const I4_STATS = data?.stats ?? { managedSections: 0, jurisdictions: 0, staleAckUsers: 0, weeklyGateBlocked: 0 };
  const TRUST_SECTIONS: TrustSection[] = (data?.trustSections ?? []).map((s) => ({ ...s, v: s.version }));
  const TRUST_SECTION_VERSIONS: TrustSectionVersion[] = data?.trustSectionVersions ?? [];
  const FINANCIALS_FIELDS = (data?.financialFields ?? []).map((f) => ({ k: f.key, v: f.value, delta: f.label ?? f.delta }));
  const SECTION_FIELDS = (data?.sectionFields ?? []).reduce<Record<string, [string, string][]>>((acc, field) => {
    acc[field.sectionKey] = [...(acc[field.sectionKey] ?? []), [field.key, field.value]];
    return acc;
  }, {});
  const sectionVersionOptions = (section: TrustSection) => TRUST_SECTION_VERSIONS
    .filter((row) => row.sectionKey === section.key
      && ["published", "superseded", "PUBLISHED", "SUPERSEDED"].includes(row.status)
      && (row.version !== section.v || section.status.toLowerCase() === "archived"))
    .map((row) => row.version);
  const reloadSectionFacts = async () => {
    const approvedKeys = pendingI4SectionCommands().filter(record => record.ticketStatus === "approved").map(record => record.commandKey);
    const read = await actions.reloadIContent();
    if (read.ok && read.data.trustDisclosure && approvedKeys.length
      && settleI4ApprovedSections(read.data.trustDisclosure, approvedKeys)) syncCommands();
    return read;
  };
  const rereadAfterResolution = async (sectionKeys: string[], commandKeys: string[]) => {
    invalidatedData.current = latest.current.data;
    setMustRead(true);
    if (latest.current.draftEditor && sectionKeys.includes(latest.current.draftEditor.sectionKey)
      && commandKeys.includes(latest.current.editorCommandKey ?? "")) {
      setDraftEditor(null); setEditorCommandKey(null);
    }
    const confirmation = sectionConfirm.current;
    if (confirmation && sectionKeys.includes(confirmation.key)
      && commandKeys.includes(confirmation.commandKey() ?? "")) {
      ctx.closeActionConfirm(confirmation.request);
      sectionConfirm.current = null;
    }
    return reloadSectionFacts();
  };
  const reportReadback = (message: string, read: Awaited<ReturnType<typeof actions.reloadIContent>>) => {
    if (!read.superseded) toast(read.ok ? message : `${message}；当前状态读取失败。请刷新信任版块。${read.reason}`, read.ok ? "success" : "warn");
  };
  const checkSectionTicket = async (record: I4SectionCommand) => {
    try {
      const ticket = await approvalQuery.read(record.commandKey, () => queryI4SectionCommand(record));
      rememberPublication(record, ticket?.status);
      if (ticket && ticket.status !== "pending") {
        if (ticket.status === "approved") syncCommands();
        const result = await rereadAfterResolution([record.sectionKey], [record.commandKey]);
        const read: typeof result = result.ok && !result.data.trustDisclosure?.trustSections.some(section => section.key === record.sectionKey)
          ? { ok: false, reason: "没读到这个信任版块。" } as const : result;
        if (ticket.status !== "approved" && !read.superseded && !read.ok) {
          const reason = read.reason;
          setSectionReadErrors(current => ({ ...current, [record.commandKey]: { record, status: ticket.status, reason } }));
        }
        reportReadback(`${sectionName(record.sectionKey)} · 审批单${TICKET_STATUS[ticket.status]}`, read);
      }
      return ticket;
    } finally { syncCommands(); }
  };
  const newSectionReason = (key: string, proposing = false): string | undefined => {
    const current = latest.current;
    if (conflictReview.blockedReason()) return conflictReview.blockedReason();
    if (!current.data || current.contentLoading || current.errorText || current.mustRead) return "请先成功重新读取最新内容后再修改。";
    const sectionCommand = pendingI4SectionCommands().find(row => row.sectionKey === key);
    if (sectionCommand?.ticketStatus === "approved") return APPROVED_READBACK_REQUIRED;
    if (sectionCommand || pendingI4DraftCommands().some(row => row.sectionKey === key)) return "此对象有原操作尚未核清，请先查询原操作。";
    if (current.data.pendingTrustSectionKeys.includes(key)) return PENDING_REASON;
    const section = current.data.trustSections.find(row => row.key === key);
    if (!section) return "版块内容已被修改，请刷新后重试";
    return proposing ? i4SectionPermission(key, section.highSensitivity) : i4DraftPermission();
  };
  const runBackend = async (task: () => Promise<void>, ok: string, sectionKey: string, requested: NonNullable<typeof conflictReview.review>["requested"]): Promise<boolean> => {
    const confirmation = requested.draftEditor ? null : sectionConfirm.current;
    try {
      await task();
      if (requested.draftEditor) setDraftEditor(current => current === requested.draftEditor ? null : current);
      if (confirmation) ctx.closeActionConfirm(confirmation.request);
      reportReadback(ok, await rereadAfterResolution([sectionKey], []));
      return true;
    } catch (error) {
      if (await reviewConflict(error, requested)) ctx.closeActionConfirm();
      toast(`操作失败:${displayAdminError(error)}`); return false;
    }
    finally { syncCommands(); }
  };
  const proposeTrustSection = async (_attemptKey: string, fingerprint: string, spec: ProposeSpec) => {
    const confirmation = sectionConfirm.current;
    const section = TRUST_SECTIONS.find(row => row.key === spec.obj)!;
    const result = await proposeI4Section(spec, fingerprint, {
      section: { ...section, version: section.v }, current: currentVersionOf(section),
      target: TRUST_SECTION_VERSIONS.find(row => row.sectionKey === spec.obj && row.version === spec.after),
      otherIssues: othersBroken(spec.obj),
    }, (record, ticket) => rememberPublication(record, ticket.status)).catch(error => {
      const key = (error as { commandKey?: string }).commandKey;
      if (key && pendingI4SectionCommands().some(row => row.commandKey === key && row.receiptKnown)) approvalQuery.fail(key, error);
      throw error;
    });
    if (confirmation) ctx.closeActionConfirm(confirmation.request);
    reportReadback(result.status === "pending" ? "已提交，等待审批后执行" : `审批单${TICKET_STATUS[result.status]}`,
      await rereadAfterResolution([spec.obj], []));
    return result;
  };
  const replayReadProblem = (record: I4SectionCommand | I4DraftCommand) => {
    const current = latest.current;
    if (!current.data || current.contentLoading || current.errorText || current.mustRead
      || !current.data.trustSections.some(row => row.key === record.sectionKey)) return "请先成功重新读取最新内容后再修改。";
    if ("version" in record && record.action !== "create" && !current.data.trustSectionVersions.some(row => row.sectionKey === record.sectionKey && row.version === record.version))
      return "请先读到这份草稿的当前数据。";
  };
  const draftRetryProblem = (record: I4DraftCommand) => replayReadProblem(record) ?? i4DraftRetryBlockedReason(record);
  const sectionRetryBlocked = (record: I4SectionCommand) => {
    if (record.ticketStatus === "approved") return APPROVED_READBACK_REQUIRED;
    const state = i4SectionRecovery.state(record);
    if (state.replayRejection) return RETRY_REJECTED_TEXT;
    if (state.expired) return RETRY_EXPIRED_TEXT;
    if (!record.request || !record.snapshot) return "原操作记录不完整，只能查询核对，不能重试。";
    return replayReadProblem(record) ?? i4SectionPermission(record.sectionKey, record.snapshot.section.highSensitivity) ?? (state.replayBlock ? "请查询原操作" : undefined);
  };
  const openTrustConfirm = (req: ActionConfirmReq, key: string, original?: I4SectionCommand | I4DraftCommand) => {
    let originalKey = original?.commandKey;
    const saved = () => [...pendingI4DraftCommands(), ...pendingI4SectionCommands()].find(row => originalKey ? row.commandKey === originalKey : row.sectionKey === key);
    const proposing = req.briefKind === "content";
    const carried = !original && prefill.current?.key === key ? prefill.current : null;
    prefill.current = null;
    const confirmation: ActionConfirmReq = { ...req,
      edit: req.edit && carried?.value ? { ...req.edit, initialValue: carried.value } : req.edit,
      blockedReason: original ? undefined : req.blockedReason ?? newSectionReason(key, proposing),
      getPendingReason: () => saved()?.reason,
      getPendingRecovery: () => {
        const record = saved();
        if (!record) return;
        const draft = "version" in record;
        const recovery = draft ? i4DraftRecovery : i4SectionRecovery;
        const state = draft ? i4DraftRecovery.state(record) : i4SectionRecovery.state(record);
        return { state, expiresAt: state.expiresAt, blockedReason: draft ? draftRetryProblem(record) : sectionRetryBlocked(record),
          subscribe: recovery.subscribe, getRevision: recovery.getRevision,
          query: () => draft ? recoverDraft(record, false) : recoverSection(record) };
      },
      getPendingBusinessValue: () => {
        const command = saved();
        if (!command) return carried?.dataSource ? { dataSource: carried.dataSource, bilingualConfirmed: "false" } : req.getPendingBusinessValue?.();
        if (!command || !("request" in command) || !command.request) return undefined;
        return { dataSource: String(command.request.command.params.dataSourceStatement ?? ""), bilingualConfirmed: String(command.request.command.params.bilingualConfirmed) };
      },
      run: async (reason, value, form) => {
        const command = saved();
        if (command) {
          const blocked = "version" in command ? draftRetryProblem(command) : sectionRetryBlocked(command);
          if (blocked) throw new Error(blocked);
          try {
            let message = "原请求已写入";
            if ("version" in command) await retryI4DraftCommand(command);
            else {
              const ticket = await retryI4SectionCommand(command).catch(error => {
                if (pendingI4SectionCommands().some(row => row.commandKey === command.commandKey && row.receiptKnown)) approvalQuery.fail(command.commandKey, error);
                throw error;
              });
              rememberPublication(command, ticket.status);
              message = ticket.status === "pending" ? "已提交，等待审批后执行" : `审批单${TICKET_STATUS[ticket.status]}`;
            }
            reportReadback(message, await rereadAfterResolution([key], [command.commandKey]));
            return true;
          } catch (error) {
            if (![...pendingI4DraftCommands(), ...pendingI4SectionCommands()].some(row => row.commandKey === command.commandKey)) await rereadAfterResolution([key], [command.commandKey]);
            throw error;
          } finally { syncCommands(); }
        }
        // A recovered closure is never repurposed into a new mutation.
        if (originalKey) { ctx.closeActionConfirm(); return false; }
        const blocked = newSectionReason(key, proposing);
        if (blocked) throw new Error(blocked);
        try { return await req.run(reason, value, form); }
        catch (error) {
          const retained = saved();
          if (retained) throw new OutcomeUnknownError("request" in retained && retained.receiptKnown
            ? "申请已提交，当前审批结果还没查到，请保留原记录并查询原操作。" : "结果未知，请查询原操作。");
          if (await reviewConflict(error, { sectionKey: key, reason, value, form })) ctx.closeActionConfirm();
          throw new Error(`提交失败：${displayAdminError(error)}`);
        }
        finally { originalKey = saved()?.commandKey; syncCommands(); }
      },
    };
    sectionConfirm.current = { key, request: confirmation, commandKey: () => originalKey };
    openActionConfirm(confirmation);
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reloadSectionFacts();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [actions]);
  // 读取时间只用来显示（北京时间）。
  useEffect(() => { if (data) setReadAt(businessClock(Date.now())); }, [data]);
  // App 实际公开的状态：打开、刷新、有版块换版时取样；读不到不挡整页，卡片退回按后台版本推断。
  const [snapshot, setSnapshot] = useState<SnapshotState>({ loading: true });
  const snapshotSeq = useRef(0);
  const readSnapshot = () => {
    const seq = ++snapshotSeq.current;
    setSnapshot((old) => ({ ...old, loading: true }));
    fetchI4PublishedSnapshot().then(
      (view) => { if (seq === snapshotSeq.current) setSnapshot({ view, loading: false }); },
      (cause) => { if (seq === snapshotSeq.current) setSnapshot({ loading: false, error: displayAdminError(cause) }); });
  };
  const publishedKey = TRUST_SECTIONS.map((s) => `${s.key}:${s.v}:${s.status}`).join("|");
  useEffect(() => { if (publishedKey) readSnapshot(); }, [publishedKey]);
  const refresh = () => {
    setRefreshing(true);
    readSnapshot();
    void reloadSectionFacts().finally(() => setRefreshing(false));
  };

  const liveTrustStatus = (s: TrustSection): string => s.status;
  const normalizedSectionKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const DATA_SOURCE_REQUIRED_SECTIONS = new Set(["financials", "nexnarrative", "nexstory"]);
  const SENSITIVE_TRUST_SECTIONS = new Set(["financials", "nexnarrative", "nexstory", "compliancebadges", "auditsreserves"]);
  const requiresDataSource = (section: TrustSection) => DATA_SOURCE_REQUIRED_SECTIONS.has(normalizedSectionKey(section.key));
  const isSensitiveTrustSection = (section: TrustSection) => section.highSensitivity || SENSITIVE_TRUST_SECTIONS.has(normalizedSectionKey(section.key));
  const canPublishTrustSection = (section: TrustSection) => isSensitiveTrustSection(section) ? canPublishSensitive : canPublishStandard;
  const currentSectionFields = (section: TrustSection) => TRUST_SECTION_VERSIONS
    .find((version) => version.sectionKey === section.key && version.version === section.v)?.fields ?? [];

  const openSecDetail = (s: TrustSection) => { setSecKey(s.key); setDetailLang("zh"); };

  // ---------- 显示用：由读到的版本推出来，不发请求 ----------
  const currentVersionOf = (s: TrustSection) => TRUST_SECTION_VERSIONS.find((version) => version.sectionKey === s.key && version.version === s.v);
  const draftsOf = (key: string) => TRUST_SECTION_VERSIONS.filter((version) => version.sectionKey === key && version.status.toLowerCase() === "draft");
  const blankingOf = (key: string, version?: TrustSectionVersion) => snapshotBlanking(snapshot.view, key) ?? appBlanking(key, version?.operator ?? "", version?.fields ?? []);
  const snapshotSection = (key: string) => snapshot.view?.available && snapshot.view.sourceEnvironment !== "SANDBOX" ? snapshot.view.sections.find((row) => row.sectionKey === key) : undefined;
  const permissionText = (s: TrustSection) => isSensitiveTrustSection(s) ? "信任中心管理权限" : "标准发布权限";
  /** 这一块让 App 信任中心整页打不开的原因：只有公开的版块当前版不完整才算；下架、没发布的版块在 App 上只是收起（App test@0306001c，BUG-441）。 */
  const sectionProblems = (s: TrustSection) => isArchivedStatus(liveTrustStatus(s)) || !isPublished(s.status) ? [] : versionProblems(currentVersionOf(s));
  const orderedSections = [...TRUST_SECTIONS].sort((left, right) => {
    const a = APP_SECTION_ORDER.indexOf(left.key as typeof APP_SECTION_ORDER[number]);
    const b = APP_SECTION_ORDER.indexOf(right.key as typeof APP_SECTION_ORDER[number]);
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  });
  /** 除了这一块，别的版块已经让 App 打不开的原因（确认框里说「批准后 App 能不能打开」用）。 */
  const othersBroken = (key: string) => [
    ...orderedSections.filter((s) => s.key !== key && sectionProblems(s).length).map((s) => `${sectionName(s.key)}${sectionProblems(s)[0]}`),
  ];
  const approvalTag = <StatusTag tone="progress" filled explain={`${APPROVER}在「操作记录与审批」批准后才执行，批准前用户看到的不变。`}>批准后生效</StatusTag>;
  const approverFacts = (s: TrustSection) => <>
    <Fact k="谁来批">{APPROVER}，不能是提交人</Fact>
    <Fact k="需有权限">审批权限和{permissionText(s)}</Fact>
  </>;
  const otherIssueNotice = (key: string, originalIssues?: string[]) => {
    const others = originalIssues ?? othersBroken(key);
    return others.length ? <Notice tone="danger" title="批准后 App 信任中心仍打不开">{others.join("、")}，要一起处理。</Notice> : null;
  };

  // ---------- I4 信任版块动作 ----------
  const mergeTrustDraft = (base: DraftEditor, saved: NonNullable<DraftEditor["resumedDraft"]>, required: readonly OperatingLanguageCode[]) => {
    const { desired, before } = saved;
    const plannedFields = saved.submitted ? mapTrustSectionLanguageFields(desired.fields, required, "load") : desired.fields;
    if (!before) {
      const unchanged = base.mode === "edit" && desired.expectedRevision === base.revision
        || base.mode === "create" && desired.expectedSectionVersion === base.expectedSectionVersion && desired.expectedSectionStatus === base.expectedSectionStatus;
      if (unchanged) return { ...base, version: desired.version, description: desired.description, structure: desired.structure, fields: plannedFields, reason: "" };
      toast("原草稿缺少修改前的内容，已显示最新版本。请对照原拟稿重新选择要改的字段。", "warn");
      return { ...base, reason: "" };
    }
    const merged = rebaseTerminalDraft({ description: before.description, structure: before.structure },
      { description: desired.description, structure: desired.structure }, { description: base.description, structure: base.structure });
    const previousFields = mapTrustSectionLanguageFields(before.fields, required, "load");
    const changed = new Set<string>();
    const mine = new Set<string>();
    const conflicted = new Set<string>();
    const fields = base.fields.map(field => {
      const previous = previousFields.find(row => row.key === field.key);
      const planned = plannedFields.find(row => row.key === field.key);
      if (previous?.label !== field.label || previous?.value !== field.value) changed.add(field.label);
      if (!previous || !planned) return field;
      const result = rebaseTerminalDraft(previous, planned, field);
      if (result.mine.length) mine.add(field.label);
      if (result.overlap.length) conflicted.add(field.label);
      return { ...result.value, key: field.key };
    });
    const labels = { description: "说明", structure: "结构" };
    if (changed.size || merged.others.length) toast(`别人改过：${[...merged.others.map(field => labels[field]), ...changed].join("、")}。你的拟改：${[...merged.mine.map(field => labels[field]), ...mine].join("、") || "无"}。${conflicted.size ? `请核对你的拟改字段：${[...conflicted].join("、")}。` : "请按最新版本重新核对。"}`, "warn");
    return { ...base, ...merged.value, version: base.mode === "create" ? desired.version : base.version, fields, reason: "" };
  };
  const trustDraftKey = (base: DraftEditor) => base.mode === "create" ? `new:${base.sectionKey}` : `${base.sectionKey}:${base.version}`;
  const reopenTrustDraft = (base: DraftEditor, required: readonly OperatingLanguageCode[]) => {
    const saved = trustDrafts.get(session?.adminId, trustDraftKey(base));
    return saved ? { ...mergeTrustDraft(base, saved, required), resumedDraft: saved } : base;
  };
  const rebaseOpenDraft = (editor: DraftEditor, overview: TrustDisclosureOverview, required: readonly OperatingLanguageCode[]) => {
    const section = overview.trustSections.find(row => row.key === editor.sectionKey);
    const published = overview.trustSectionVersions.find(row => row.sectionKey === editor.sectionKey && row.version === section?.version);
    const draft = editor.mode === "edit" ? overview.trustSectionVersions.find(row => row.sectionKey === editor.sectionKey && row.version === editor.version && row.status.toLowerCase() === "draft") : undefined;
    if (!section || !published || editor.mode === "edit" && !draft) {
      toast("没读到此草稿或当前版，已保留输入，请刷新核对。", "warn");
      return null;
    }
    if (editor.expectedSectionVersion === section.version && editor.expectedSectionStatus === section.status
      && editor.revision === draft?.revision && editor.published?.revision === published.revision) return editor;
    const baseline = draft ?? published;
    if (!i4DraftMatchesPublishedFields(editor.sectionKey, published.fields, baseline.fields)) {
      toast("草稿和当前的内容模板不一致，已保留输入，请核对最新模板。", "warn");
      return null;
    }
    return mergeTrustDraft({ ...editor, description: draft?.description ?? section.desc, structure: draft?.structure ?? section.struct,
      fields: mapTrustSectionLanguageFields(baseline.fields, required, "load"), revision: draft?.revision, editBaseline: draft, published,
      expectedSectionVersion: section.version, expectedSectionStatus: section.status },
      { before: editor.editBaseline ?? editor.published, desired: {
        version: editor.version, description: editor.description, structure: editor.structure, fields: editor.fields,
        expectedRevision: editor.revision, expectedSectionVersion: editor.expectedSectionVersion, expectedSectionStatus: editor.expectedSectionStatus,
      } }, required);
  };
  const createSectionDraft = async (s: TrustSection) => {
    const blocked = newSectionReason(s.key);
    if (blocked) { toast(blocked); return; }
    const fields = currentSectionFields(s);
    if (fields.length === 0) {
      toast("现在公开的版本没有内容模板，不能新建草稿");
      return;
    }
    const required = await getRequiredContentLanguages();
    setRequiredLanguages(required);
    setEditorCommandKey(null);
    setDraftEditor(reopenTrustDraft({
      mode: "create",
      sectionKey: s.key,
      version: "",
      description: s.desc,
      structure: s.struct,
      reason: "日常维护信任版块草稿",
      fields: mapTrustSectionLanguageFields(fields, required, "load"), expectedSectionVersion: s.v, expectedSectionStatus: s.status, published: currentVersionOf(s),
    }, required));
  };

  const editSectionDraft = async (draft: TrustSectionVersion) => {
    const section = TRUST_SECTIONS.find((item) => item.key === draft.sectionKey);
    const blocked = newSectionReason(draft.sectionKey);
    if (blocked) { toast(blocked); return; }
    const publishedFields = section ? currentSectionFields(section) : [];
    if (!i4DraftMatchesPublishedFields(draft.sectionKey, publishedFields, draft.fields)) {
      toast("草稿的内容模板已过期，删掉后基于现在公开的版本新建");
      return;
    }
    const required = await getRequiredContentLanguages();
    setRequiredLanguages(required);
    setEditorCommandKey(null);
    setDraftEditor(reopenTrustDraft({
      mode: "edit",
      sectionKey: draft.sectionKey,
      version: draft.version,
      description: draft.description,
      structure: draft.structure,
      revision: draft.revision,
      editBaseline: draft,
      reason: "日常维护信任版块草稿",
      fields: mapTrustSectionLanguageFields(draft.fields, required, "load"), expectedSectionVersion: section!.v, expectedSectionStatus: section!.status, published: currentVersionOf(section!),
    }, required));
  };

  const saveSectionDraft = async () => {
    if (!draftEditor || inFlight.current) return;
    if (editorCommandKey) {
      const original = pendingI4DraftCommands().find(row => row.commandKey === editorCommandKey);
      if (!original) { setDraftEditor(null); setEditorCommandKey(null); return; }
      await recoverDraft(original, true);
      return;
    }
    const blocked = newSectionReason(draftEditor.sectionKey);
    if (blocked) { toast(blocked); return; }
    const sectionSnapshot = TRUST_SECTIONS.find((item) => item.key === draftEditor.sectionKey);
    if (!sectionSnapshot) {
      toast("版块内容已被修改，请刷新后重试");
      return;
    }
    if (!/^v[1-9][0-9]{0,8}$/.test(draftEditor.version) || !draftEditor.description.trim()
      || !draftEditor.structure.trim() || !draftEditor.reason.trim() || draftEditor.fields.length === 0
      || draftEditor.fields.some((field) => !field.key.trim() || !field.label.trim()
        || (!localizedTrustSectionField(field.key) && !isOptionalTrustLinkField(field.key) && !field.value.trim()))) {
      toast("请填完版本、说明、结构、内容和保存说明");
      return;
    }
    inFlight.current = true; setSavingDraft(true);
    try {
      const required = await getRequiredContentLanguages();
      setRequiredLanguages(required);
      const current = latest.current;
      if (!current.data || current.contentLoading || current.errorText || current.mustRead) {
        toast("请先成功重新读取最新内容后再修改。", "warn");
        return;
      }
      const rebased = rebaseOpenDraft(draftEditor, current.data, required);
      if (!rebased) return;
      if (rebased !== draftEditor) {
        setDraftEditor(editor => editor === draftEditor ? rebased : editor);
        return;
      }
      const fields = trustDraftFieldsForSubmit(draftEditor.fields, required);
      const authored = draftEditor.fields.flatMap(field => {
        const localized = localizedTrustSectionField(field.key);
        return localized && field.value.trim() ? [localized.language] : [];
      });
      if (fields.some(field => localizedTrustSectionField(field.key))
        && !validateTrustSectionTrilingualFields(fields, [...required, ...authored]).valid) {
        toast("请补齐英文和运营区域语言的字段；选填语言已填写的，请填完整或全部留空");
        return;
      }
      const fieldIssue = i4FieldValueIssue(fields);
      if (fieldIssue) { toast(fieldIssue); return; }
      // The App contract applies at publication; drafts retain the backend authoring contract.
      const existingDraft = draftEditor.editBaseline;
      if (i4DraftOmittedTranslations(draftEditor.published?.fields ?? [], existingDraft?.fields ?? [], fields)) { toast("这次保存会删掉已有译文，请留着现在公开版本的每一项内容后再保存。"); return; }
      if (trustDraftUnchanged(draftEditor, fields, required)) { toast(NO_DRAFT_CHANGES); return; }
      const payload = {
        version: draftEditor.version,
        description: draftEditor.description.trim(),
        structure: draftEditor.structure.trim(),
        fields,
        expectedSectionVersion: draftEditor.expectedSectionVersion,
        expectedSectionStatus: draftEditor.expectedSectionStatus,
        ...(draftEditor.mode === "edit" ? { expectedRevision: draftEditor.revision ?? 0 } : {}),
      };
      const complete = await runBackend(() => draftEditor.mode === "create"
        ? actions.createI4TrustSectionDraft(draftEditor.sectionKey, payload, draftEditor.reason.trim(), draftEditor.published)
        : actions.updateI4TrustSectionDraft(draftEditor.sectionKey, draftEditor.version, payload, draftEditor.reason.trim(), draftEditor.published, existingDraft), `${draftEditor.sectionKey} ${draftEditor.version} 草稿已保存`, draftEditor.sectionKey,
        { sectionKey: draftEditor.sectionKey, draftEditor, reason: draftEditor.reason });
      const saved = pendingI4DraftCommands().find(row => row.sectionKey === draftEditor.sectionKey);
      if (complete || saved?.original) trustDrafts.consume(session?.adminId, trustDraftKey(draftEditor), draftEditor.resumedDraft);
      if (saved) setEditorCommandKey(saved.commandKey);
    } finally { inFlight.current = false; setSavingDraft(false); }
  };

  const deleteSectionDraft = (draft: TrustSectionVersion, original?: I4DraftCommand) => openTrustConfirm({ briefKind: "record",
    action: <>删除信任版块草稿 · {draft.sectionKey} {draft.version}</>,
    title: "删除草稿",
    detail: <>只删除还没发布的草稿；线上版本和历史版本不受影响。</>,
    amplifies: false,
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>删了找不回</IrreversibleTag></>,
    confirmTone: "danger",
    confirmLabel: "删除草稿",
    statedBrief: { impact: "只删这份草稿，用户看到的内容和历史版本都不变。", check: "核对版块和版本号，理由写清为什么删。" },
    facts: <Facts><Fact k="版块">{sectionName(draft.sectionKey)}</Fact><Fact k="草稿">{draft.version} · {draft.fields.length} 项内容</Fact><Fact k="最近保存">{timeText(draft.updatedAt)} · {operatorText(draft.operator)}</Fact></Facts>,
    run: (reason) => runBackend(() => actions.deleteI4TrustSectionDraft(
      draft.sectionKey, draft.version, draft.revision, reason, draft,
    ), `${draft.sectionKey} ${draft.version} 草稿已删除`, draft.sectionKey, { sectionKey: draft.sectionKey, reason }),
  }, draft.sectionKey, original);

  const pubSection = async (s: TrustSection, draft: TrustSectionVersion, original?: I4SectionCommand) => {
    const languages = original ? [] : await getRequiredContentLanguages();
    const names = { en: "英文", zh: "中文", vi: "越南语" } as const;
    const reviewContent = languages.length ? languages.map((language) => names[language]).join("、") : "内容";
    const missing = localeItems(draft.fields).filter(({ value, missing }) => languages.includes(value) && missing);
    const languageIssue = !i4HasEnglishFields(draft.fields) ? TRUST_MISSING_ENGLISH
      : missing.length ? `缺${missing.map(({ value }) => names[value]).join("、")}` : undefined;
    const contentIssue = i4AppFieldIssue(draft.fields) ?? languageIssue;
    const reviewCheck = `逐项核对${reviewContent}和关键数字`;
    const problems = versionProblems(draft);
    const publicationKey = `${s.key}:${draft.version}`;
    const statement = original ? undefined : publicationDrafts.get(session?.adminId, publicationKey);
    return openTrustConfirm({ briefKind: "content",
      action: <>发布信任版块 · {s.key} {draft.version}</>,
      title: `发布${sectionName(s.key)}`,
      detail: (
        <>
          <b>版本差异</b>：当前线上 <span className="mono">{s.v}</span> → 待发布 <span className="mono">{draft.version}</span>；
          另一位超级管理员批准后才换成新版本，App 下次读取时显示。<b>发布核对</b>须{reviewCheck}。
          {requiresDataSource(s) && <>财务数字 / UVT介绍必须填写可追溯的<b>财务/UVT 数据来源</b>。</>}
        </>
      ),
      amplifies: false,
      effect: approvalTag,
      confirmLabel: "提交审批",
      statedBrief: { impact: `批准后用户看到的${sectionName(s.key)}从 ${s.v} 换成 ${draft.version}；批准前不变。`, check: `${reviewCheck}，理由写清依据。` },
      facts: <div className="rd-stack">
        <Facts><Fact k="版块">{sectionName(s.key)}</Fact><Fact k="版本"><Change from={`${s.v}（现在公开）`} to={draft.version} /></Fact>{approverFacts(s)}</Facts>
        <VersionCompare beforeLabel={`现在公开的 ${s.v}`} afterLabel={`批准后公开的 ${draft.version}`} before={original?.snapshot?.current?.fields ?? currentSectionFields(s)} after={draft.fields} problems={problems.filter((item) => item !== TRUST_MISSING_ENGLISH)}
          afterBlanked={blankingOf(s.key, draft).all ? `提醒：${blankingOf(s.key, draft).all}` : undefined} />
        {otherIssueNotice(s.key, original?.snapshot?.otherIssues)}
      </div>,
      blockedReason: contentIssue,
      getPendingBusinessValue: () => statement === undefined ? undefined : { dataSource: statement, bilingualConfirmed: "false" },
      businessForm: {
        kind: "multi-field",
        fields: [
          ...(requiresDataSource(s) ? [{ key: "dataSource", label: "财务/UVT 数据来源", inputKind: "text" as const, placeholder: "报表、账本快照或市场数据编号", required: true, wide: true, maxLength: 500, explain: "写清这些数字从哪来，最多 500 字。只是说明，不会替你核对数字。" }] : []),
          { key: "bilingualConfirmed", label: `已逐项核对${reviewContent}，关键数字一致`, inputKind: "checkbox" as const, required: true, wide: true },
        ],
      },
      run: async (reason, _value, form) => {
        if (contentIssue) throw new Error(contentIssue);
        const def = findHighOp("i4_trust_section_manage")!;
        const dataSource = form?.dataSource?.trim() || "";
        const bilingualConfirmed = form?.bilingualConfirmed === "true";
        if (dataSource.length > 500) throw new Error("财务/UVT 数据来源最多 500 字。");
        if (requiresDataSource(s) && !dataSource) throw new Error("请填写财务/UVT 数据来源。");
        if (!bilingualConfirmed) throw new Error(`请${reviewCheck}。`);
        if (i4OmittedTranslations(currentSectionFields(s), draft.fields)) throw new Error("这次发布会删掉已有译文，请先留着每一项内容再提交。");
        const fingerprint = JSON.stringify([
          "publish", s.key, s.v, s.status, draft.version, draft.revision,
          dataSource, bilingualConfirmed, reason,
        ]);
        const result = await proposeTrustSection(`${s.key}:publish`, fingerprint, {
          action: `发布信任版块 · ${s.key}`,
          obj: s.key,
          before: s.v,
          after: draft.version,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I4",
          command: def.buildCommand({
            sectionKey: s.key,
            action: "publish",
            version: draft.version,
            expectedRevision: draft.revision,
            expectedVersion: s.v,
            expectedStatus: s.status,
            dataSourceStatement: dataSource,
            bilingualConfirmed,
          }),
          target: def.buildTarget({ sectionKey: s.key }),
        });
        if (result.status === "pending" || result.status === "approved") publicationDrafts.forget(session?.adminId, publicationKey);
        return true;
      },
    }, s.key, original);
  };

  const rollbackSection = (s: TrustSection, original?: I4SectionCommand) => {
    const archived = isArchivedStatus(s.status);
    const versionOf = (version: string) => original?.snapshot?.target?.version === version ? original.snapshot.target : TRUST_SECTION_VERSIONS.find((row) => row.sectionKey === s.key && row.version === version);
    const options = original ? [original.after] : sectionVersionOptions(s);
    const optionLabels = Object.fromEntries(options.map((version) => {
      const row = versionOf(version);
      const problems = versionProblems(row);
      return [version, <span key={version}>{version} · {timeText(row?.updatedAt)}{problems.length ? " · 不完整" : null}</span>];
    }));
    return openTrustConfirm({ briefKind: "content",
      action: <>回滚信任版块 · {s.key}</>,
      title: `${archived ? "恢复上线" : "回滚"}${sectionName(s.key)}`,
      detail: (
        <>
          当前 <b>{s.v}</b>。请选择要恢复的历史版本，批准后对外换成它，权限要求和发布一样。
        </>
      ),
      amplifies: false,
      effect: approvalTag,
      confirmTone: "danger",
      confirmLabel: "提交审批",
      statedBrief: { impact: `批准后用户看到的${sectionName(s.key)}换成所选版本。`, check: "超过 80 项、格式不对或缺英文的不能回滚，缺中文、越南语的那几项 App 上是空的。理由写清为什么回到这一版。" },
      edit: { kind: "select", label: archived ? "恢复成" : "回滚到", current: s.v, currentLabel: archived ? "已下架的版本" : "现在公开", options, optionLabels, hint: `只能选这一块发布过的版本，时间为${businessZone().label}` },
      facts: (value?: string) => {
        const target = value ? versionOf(value) : undefined;
        const problems = target ? versionProblems(target) : [];
        return <div className="rd-stack">
          <Facts>
            <Fact k="版块">{sectionName(s.key)}</Fact>
            <Fact k="现在">{s.v} · {archived ? "已下架" : "公开中"}</Fact>
            {approverFacts(s)}
          </Facts>
          {target && <VersionCompare beforeLabel={`现在的 ${s.v}`} afterLabel={`批准后公开的 ${target.version}`} before={original?.snapshot?.current?.fields ?? currentSectionFields(s)} after={target.fields} problems={problems}
            afterBlanked={blankingOf(s.key, target).all ? `提醒：${blankingOf(s.key, target).all}` : undefined} />}
          {target && problems.length === 0 && i4HasEnglishFields(target.fields) && <p className="rd-note">所选版本完整：有说明和结构，英文齐全，不超过 {APP_FIELD_LIMIT} 项内容。</p>}
          {otherIssueNotice(s.key, original?.snapshot?.otherIssues)}
        </div>;
      },
      run: async (reason, nv) => {
        if (!nv) return false;
        const target = versionOf(nv);
        const fieldIssue = target && i4AppFieldIssue(target.fields);
        if (fieldIssue) throw new Error(fieldIssue);
        if (target && !i4HasEnglishFields(target.fields)) throw new Error("TRUST_SECTION_TRILINGUAL_FIELDS_REQUIRED");
        const def = findHighOp("i4_trust_section_manage")!;
        const fingerprint = JSON.stringify(["rollback", s.key, s.v, s.status, nv, reason]);
        return proposeTrustSection(`${s.key}:rollback`, fingerprint, {
          action: `回滚信任版块 · ${s.key}`,
          obj: s.key,
          before: s.v,
          after: nv,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I4",
          command: def.buildCommand({
            sectionKey: s.key,
            action: "rollback",
            targetVersion: nv,
            expectedVersion: s.v,
            expectedStatus: s.status,
          }),
          target: def.buildTarget({ sectionKey: s.key }),
        }).then(() => true);
      },
    }, s.key, original);
  };

  const archiveSection = (s: TrustSection, original?: I4SectionCommand) =>
    openTrustConfirm({ briefKind: "content",
      action: <>下架信任版块 · {s.key}</>,
      title: `下架${sectionName(s.key)}`,
      detail: (
        <>
          当前 <b>{s.v}</b> 生效中，批准后下架；版本正文保留，可以再恢复上线。
        </>
      ),
      amplifies: false,
      effect: approvalTag,
      confirmLabel: "提交下架审批",
      statedBrief: { impact: `批准后${sectionName(s.key)}下架，App 下次读取时这一块收起；版本正文保留，可以再恢复上线。`, check: "确认用户少看到这一块没问题，理由写清依据。" },
      facts: <div className="rd-stack">
        <Facts>
          <Fact k="版块">{sectionName(s.key)}</Fact>
          <Fact k="状态"><Change from={`公开中 ${s.v}`} to="已下架" /></Fact>
          {approverFacts(s)}
        </Facts>
        <Notice tone={SECTION_INFO[s.key]?.where.startsWith("App 页面不读") ? "neutral" : "warn"} title="用户会少看到">{unpublishedEffect(s.key)}。</Notice>
      </div>,
      run: async (reason) => {
        const def = findHighOp("i4_trust_section_manage")!;
        const fingerprint = JSON.stringify(["archive", s.key, s.v, s.status, reason]);
        return proposeTrustSection(`${s.key}:archive`, fingerprint, {
          action: `下架信任版块 · ${s.key}`,
          obj: s.key,
          before: s.v,
          after: "archived",
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I4",
          command: def.buildCommand({
            sectionKey: s.key,
            action: "archive",
            expectedVersion: s.v,
            expectedStatus: s.status,
          }),
          target: def.buildTarget({ sectionKey: s.key }),
        }).then(() => true);
      },
    }, s.key, original);

  // 抽屉数据。
  const sec = secKey ? TRUST_SECTIONS.find((s) => s.key === secKey) ?? null : null;
  const sectionExternalLink = sec
    ? (SECTION_FIELDS[sec.key] ?? []).find(([key]) => /(^|[._-])(url|link|href)($|[._-])/i.test(key))?.[1] ?? ""
    : "";

  /** 草稿操作这一行怎么说：共用面板的标签和句子（查询失败的原因放标签问号里）。草稿直接生效，不建审批单。 */
  const draftStatus = (record: I4DraftCommand, outcome: FundInvestigationOutcome | undefined) => {
    const shown = fundRecoveryStatus({ outcome, expired: isRetryExpired(record), canQuery: true, canClose: canInvestigateECommand("content_i4_read"),
      canRetry: !draftRetryProblem(record), status: replayRejectedStatus(!!i4DraftRecovery.state(record).replayRejection, outcome) });
    return { ...shown, more: shown.more ?? (outcome && "error" in outcome ? outcome.error : undefined) };
  };
  const recoverDraft = async (record: I4DraftCommand, retry: boolean) => {
    if (inFlight.current || retry && draftRetryProblem(record)) return;
    inFlight.current = true; setRecovering(record.commandKey);
    if (retry) setSavingDraft(true);
    try {
      if (retry) { await retryI4DraftCommand(record); reportReadback(`${record.sectionKey} ${record.version} 草稿已${record.action === "delete" ? "删除" : "保存"}`, await rereadAfterResolution([record.sectionKey], [record.commandKey])); }
      else {
        let outcome: FundInvestigationOutcome;
        try {
          outcome = { receipt: await queryI4DraftReceipt(record) };
        } catch (error) {
          outcome = { error: displayAdminError(error) };
        }
        setDraftOutcomes(all => ({ ...all, [record.commandKey]: outcome }));
        const receipt = receiptOf(outcome);
        if (eCommandSettled(receipt)) {
          if (isConfirmedNonExecution(receipt)) retainTrustDraft(record);
          reportReadback(settledText({ status: receipt!.originalStatus }), await rereadAfterResolution([record.sectionKey], [record.commandKey]));
          return;
        }
        await fetchI4TrustOverview();
        const shown = draftStatus(record, outcome);
        toast(`${shown.label}：${shown.line}`);
        await actions.reloadIContent();
      }
    } catch (error) {
      toast(displayAdminError(error));
      if (!pendingI4DraftCommands().some(row => row.commandKey === record.commandKey)) await rereadAfterResolution([record.sectionKey], [record.commandKey]);
    } finally { inFlight.current = false; setRecovering(null); if (retry) setSavingDraft(false); syncCommands(); }
  };
  const recoverSection = async (record: I4SectionCommand) => {
    if (inFlight.current) return;
    inFlight.current = true; setRecovering(record.commandKey);
    try {
      if (record.ticketStatus === "approved") {
        await rereadAfterResolution([record.sectionKey], [record.commandKey]);
        return;
      }
      const ticket = await checkSectionTicket(record);
      if (!ticket || ticket.status === "pending") toast(ticket ? "已提交，等待审批后执行" : !record.receiptKnown && isRetryExpired(record) ? "没查到这张审批单。" : "还没查到原审批单，记录继续保留。");
    } catch (error) { toast(displayAdminError(error)); }
    finally { inFlight.current = false; setRecovering(null); syncCommands(); }
  };
  const restoreSection = (record: I4SectionCommand) => {
    const snapshot = record.snapshot;
    if (!snapshot) { void recoverSection(record); return; }
    const section = { ...snapshot.section, v: snapshot.section.version };
    if (record.action === "publish" && snapshot.target) pubSection(section, snapshot.target, record);
    else if (record.action === "rollback") rollbackSection(section, record);
    else if (record.action === "archive") archiveSection(section, record);
  };
  const readMaterialOriginal: typeof queryI4DocumentCommand = async (record, evidence) => {
    const reads = materialReads.current;
    reads.set(record.commandKey, (reads.get(record.commandKey) ?? 0) + 1);
    try {
      const result = await queryI4DocumentCommand(record, evidence);
      if (result.draft) materialDrafts.remember(record.owner, record.document.slot, result.draft);
      if (result.error) materialQuery.fail(record.commandKey, result.error);
      else materialQuery.clear(record.commandKey);
      return result;
    } catch (error) {
      materialQuery.fail(record.commandKey, error);
      throw error;
    } finally {
      const remaining = (reads.get(record.commandKey) ?? 1) - 1;
      if (remaining) reads.set(record.commandKey, remaining);
      else reads.delete(record.commandKey);
      syncCommands();
    }
  };
  const materialRejected = (record: I4DocumentCommand) => !!i4DocumentRecovery.state(record).replayRejection;
  const draftRejected = (record: I4DraftCommand) => !!i4DraftRecovery.state(record).replayRejection;
  const shortSha = (sha: string) => `${sha.slice(0, 12)}…`;
  const approvalName = (record: I4SectionCommand) =>
    `${sectionName(record.sectionKey)} · ${SECTION_OPERATION[record.action]}`;
  const approvalChange = (record: I4SectionCommand) => `${record.before} → ${record.after === "archived" ? "已下架" : record.after}`;
  const recoveryRows: RecoveryRow[] = [
    ...Object.values(sectionReadErrors).map(({ record, status, reason }) => ({
      key: record.commandKey, kind: "open" as const, name: approvalName(record), change: approvalChange(record),
      submittedAt: timeText(new Date(record.createdAt).toISOString()),
      tag: <StatusTag tone={status === "approved" ? "ok" : "done"}>{TICKET_STATUS[status]}</StatusTag>,
      note: `当前状态读取失败。${reason}`,
      actions: <Button size="sm" loading={refreshing} onClick={refresh}>重新加载</Button>,
    })),
    ...documentCommands.map(record => {
      const file = record.file;
      const upload = record.mode === "upload";
      return { key: record.commandKey, kind: "unknown" as const, name: `${TRUST_DOCUMENT_NAMES[record.document.slot]} · ${upload ? "上传新版本" : "恢复默认文件"}`,
        change: upload && file ? <span title={`SHA256 ${file.sha256}`}>{`原文件 ${file.name} · ${docSize(file.size)} · 指纹 ${shortSha(file.sha256)}`}</span>
          : <span title={`SHA256 ${record.document.sha256}`}>{`换下 ${record.document.fileName} · 指纹 ${shortSha(record.document.sha256)}`}</span>,
        submittedAt: timeText(new Date(record.createdAt).toISOString()), tag: materialRejected(record) ? rejectedTag() : unknownTag("document"),
        note: materialQuery.errors[record.commandKey] ?? (upload ? "这页不能重发这次上传。原上传成功的话后台留着结果，点「查询原操作」查到就解除记录；查不到就对照现在用的文件指纹和上传时间。"
          : materialRejected(record) ? RETRY_REJECTED_NEXT : isRetryExpired(record) ? RETRY_EXPIRED_TEXT : "先点「查询原操作」；明确查不到，再到这份资料的「恢复默认」里按原操作重试。"),
        actions: <><Button size="sm" onClick={() => {
          void readMaterialOriginal(record).then(result => {
            setDocumentRecovery({ kind: "lookup", key: record.commandKey, settled: result.settled, observation: result.current, error: result.error });
          }, () => undefined);
        }}>查询原操作</Button>
          {materialRejected(record) && <VerifiedReleaseButton disabled={materialReads.current.has(record.commandKey) || !!i4DocumentRecovery.state(record).busy}
            onClick={() => {
              const snapshot = i4DocumentRecovery.releaseSnapshot(record);
              release.ask({ operation: "恢复默认文件", target: `${TRUST_DOCUMENT_NAMES[record.document.slot]} · 换下 ${record.document.fileName}`,
                getSnapshot: () => materialReads.current.has(record.commandKey) ? undefined : snapshot(),
                createdAt: record.createdAt,
                release: () => {
                  const released = i4DocumentRecovery.releaseRejectedReplay(record);
                  if (released) setDocumentRecovery({ kind: "release", key: record.commandKey });
                  syncCommands();
                  return released;
                } });
            }} />}</> };
    }),
    ...draftCommands.map(record => ({ key: record.commandKey, kind: OPEN_RESULT_LABELS.includes(draftStatus(record, draftOutcomes[record.commandKey]).label) ? "open" as const : "unknown" as const,
      name: `${sectionName(record.sectionKey)} · ${DRAFT_OPERATION[record.action]}`,
      change: record.version, submittedAt: timeText(new Date(record.createdAt).toISOString()),
      tag: <StatusTag tone={draftStatus(record, draftOutcomes[record.commandKey]).tone} explain={draftStatus(record, draftOutcomes[record.commandKey]).more}>{draftStatus(record, draftOutcomes[record.commandKey]).label}</StatusTag>,
      note: <>{draftStatus(record, draftOutcomes[record.commandKey]).line} <TechInfo commandKey={record.commandKey} receipt={receiptOf(draftOutcomes[record.commandKey])} /></>,
      actions: <><Button size="sm" loading={recovering === record.commandKey} onClick={() => void recoverDraft(record, false)}>查询原操作</Button>
        {canInvestigateECommand("content_i4_read") && eCommandClosureOffer(draftOutcomes[record.commandKey], isRetryExpired(record)).conclusions.length > 0 && <Button size="sm" variant="danger-outline" disabled={!!recovering} onClick={() => setClosingDraft(record)}>核查结案</Button>}
        {!draftRejected(record) && <Button size="sm" disabledReason={draftRetryProblem(record)}
          onClick={() => {
            if (record.action === "delete" && record.snapshot) deleteSectionDraft(record.snapshot, record);
            else if (record.input) { setEditorCommandKey(record.commandKey); setDraftEditor({ ...record.input, mode: record.action === "create" ? "create" : "edit", sectionKey: record.sectionKey, revision: record.input.expectedRevision, reason: record.reason, published: record.snapshot }); }
            else void recoverDraft(record, true);
          }}>按原操作重试</Button>}
        {draftRejected(record) && <VerifiedReleaseButton disabled={!!recovering || !!i4DraftRecovery.state(record).busy} onClick={() => release.ask({ operation: DRAFT_OPERATION[record.action], target: `${sectionName(record.sectionKey)} · ${record.version}`,
          getSnapshot: i4DraftRecovery.releaseSnapshot(record), createdAt: record.createdAt, release: () => {
            const released = i4DraftRecovery.releaseRejectedReplay(record);
            if (released && latest.current.editorCommandKey === record.commandKey) { setDraftEditor(null); setEditorCommandKey(null); }
            syncCommands();
            return released;
          } })} />}</> })),
    ...sectionCommands.map(record => {
      if (record.ticketStatus === "approved") return {
        key: record.commandKey, kind: "open" as const, name: approvalName(record), change: approvalChange(record),
        submittedAt: timeText(new Date(record.createdAt).toISOString()),
        tag: <StatusTag tone="ok">{TICKET_STATUS.approved}</StatusTag>,
        note: errorText ? `当前状态读取失败。${errorText}` : "待读当前版块。",
        actions: <Button size="sm" loading={refreshing} onClick={refresh}>重新加载</Button>,
      };
      const pending = record.ticketStatus === "pending";
      const releasable = !!i4SectionRecovery.state(record).replayRejection;
      const rejected = releasable && !pending && !record.receiptKnown;
      return { key: record.commandKey, kind: pending ? "pending" as const : record.receiptKnown ? "submitted" as const : "unknown" as const,
        name: approvalName(record), change: approvalChange(record), submittedAt: timeText(new Date(record.createdAt).toISOString()),
        tag: pending ? <StatusTag tone="progress" icon={Hourglass}>等另一位批准</StatusTag> : record.receiptKnown ? <StatusTag tone="neutral" icon={Hourglass}>已提交，状态未查到</StatusTag> : rejected ? rejectedTag() : unknownTag("approval"),
        note: pending || record.receiptKnown ? ["审批单已经建了，点「查询原操作」看状态。", approvalQuery.errors[record.commandKey]].filter(Boolean).join(" ")
          : approvalQuery.errors[record.commandKey] ?? (rejected ? RETRY_REJECTED_NEXT : isRetryExpired(record) ? RETRY_EXPIRED_TEXT : undefined),
        actions: <><Button size="sm" loading={recovering === record.commandKey} onClick={() => void recoverSection(record)}>查询原操作</Button>
          {!record.receiptKnown && !pending && !releasable && <Button size="sm" disabledReason={sectionRetryBlocked(record)}
            onClick={() => restoreSection(record)}>按原操作重试</Button>}
          {rejected && <VerifiedReleaseButton disabled={!!recovering || !!i4SectionRecovery.state(record).busy} onClick={() => release.ask({ operation: SECTION_OPERATION[record.action], target: `${sectionName(record.sectionKey)} · ${approvalChange(record)}`,
            getSnapshot: i4SectionRecovery.releaseSnapshot(record), createdAt: record.createdAt, release: () => { try { releaseRejectedI4Section(record); } finally { syncCommands(); } } })} />}</> };
    }),
  ];
  const releaseModal = <>{closingDraft && <FundClosureModal label={`${sectionName(closingDraft.sectionKey)} · ${closingDraft.version}`} createdAt={closingDraft.createdAt}
    offer={eCommandClosureOffer(draftOutcomes[closingDraft.commandKey], isRetryExpired(closingDraft))}
    facts={<Fact k="系统记录">{receiptFact(((outcome) => outcome && "receipt" in outcome ? outcome.receipt : null)(draftOutcomes[closingDraft.commandKey]), "记录保留")}</Fact>}
    onClose={() => setClosingDraft(null)} onSubmit={async evidence => {
      const record = closingDraft;
      const receipt = await queryI4DraftReceipt(record, evidence);
      setDraftOutcomes(all => ({ ...all, [record.commandKey]: { receipt } }));
      setClosingDraft(null); syncCommands();
      if (eCommandSettled(receipt)) {
        if (isConfirmedNonExecution(receipt)) retainTrustDraft(record);
        reportReadback(settledText({ status: receipt!.originalStatus }), await rereadAfterResolution([record.sectionKey], [record.commandKey]));
      }
      else toast(CLOSURE_KEPT_TEXT);
    }} />}
    {release.dialog}</>;

  /* ---------- 刚被别人改过：看最新的和自己填的，确认后按最新的重建编辑器或确认框 ---------- */
  const conflictUi = (() => {
    const conflict = conflictReview.review;
    if (!conflict) return null;
    const latestData = conflict.latest;
    const rejected = conflict.rejectedCommand;
    const editorAtReject = conflict.requested.draftEditor;
    const key = conflict.requested.sectionKey ?? editorAtReject?.sectionKey ?? rejected?.sectionKey ?? "";
    const nowSection = latestData?.trustSections.find((row) => row.key === key);
    const section = TRUST_SECTIONS.find((row) => row.key === key);
    const nowCurrent = latestData?.trustSectionVersions.find((row) => row.sectionKey === key && row.version === nowSection?.version);
    const state = (row?: { version: string; status: string }) => row ? `${row.version} · ${isArchivedStatus(row.status) ? "已下架" : statusZh(row.status)}` : "—";
    const saved = (row?: TrustSectionVersion) => row ? `${row.updatedAt ? timeText(row.updatedAt) : "—"} · ${operatorText(row.operator)}` : "—";
    // 内容项按语言分组；一边没有这一项时写「没有这一项」，和空内容「—」分开。
    const fieldRows = (left: { key: string; label: string; value: string }[], right: { key: string; label: string; value: string }[]): IConflictRow[] => {
      const groups = ["中文内容", "越南语内容", "英语内容", "其他内容"];
      const groupOf = (fieldKey: string) => groups[["zh", "vi", "en"].indexOf(/[._-](zh|vi|en)$/i.exec(fieldKey)?.[1].toLowerCase() ?? "")] ?? "其他内容";
      const absent = <StatusTag tone="neutral" icon={CircleSlash}>没有这一项</StatusTag>;
      const keys = [...new Set([...left.map((field) => field.key), ...right.map((field) => field.key)])];
      return keys.flatMap((fieldKey): IConflictRow[] => {
        const a = left.find((field) => field.key === fieldKey), b = right.find((field) => field.key === fieldKey);
        const group = groupOf(fieldKey);
        if (!a || !b) return [{ label: b?.label || a?.label || fieldKey, hint: fieldKey, group, changed: true,
          left: a ? <>{a.label || "—"}：{a.value || "—"}</> : absent, right: b ? <>{b.label || "—"}：{b.value || "—"}</> : absent }];
        return [
          ...(a.label !== b.label ? [{ ...conflictRow("名称", a.label, b.label), hint: fieldKey, group }] : []),
          ...(a.value !== b.value ? [{ ...conflictRow(b.label || a.label || fieldKey, a.value, b.value), hint: fieldKey, group }] : []),
        ];
      }).sort((x, y) => groups.indexOf(x.group!) - groups.indexOf(y.group!));
    };
    let rows: IConflictRow[] = [];
    let columns: [string, string] = ["你打开时", "现在"];
    let gone = latestData && (!nowSection || !section) ? "这个版块在最新读取里没有了，不能按最新的重做。" : undefined;
    let note: ReactNode;
    let rebuildLabel = "按最新的重新确认";
    let rebuild: (() => void) | undefined;
    // 删草稿直接执行；发布、回滚、下架都是提交审批。
    const lead = !editorAtReject && rejected ? rejected.action === "delete" ? "别人先改了，这次没删除。" : "别人先改了，这次没提交审批。" : undefined;
    const carry = (extra?: { value?: string; dataSource?: string }) => { prefill.current = { key, ...extra }; };
    if (editorAtReject) {
      columns = ["现在", "你填的"];
      rebuildLabel = "按最新的重新填写";
      const nowDraft = editorAtReject.mode === "edit" ? latestData?.trustSectionVersions.find((row) => row.sectionKey === key && row.version === editorAtReject.version) : undefined;
      if (!gone && latestData && editorAtReject.mode === "edit" && nowDraft?.status.toLowerCase() !== "draft") gone = `${editorAtReject.version} 已经不是草稿了（被删除或已发布）。`;
      const base = editorAtReject.mode === "edit" ? nowDraft?.fields ?? [] : nowCurrent?.fields ?? [];
      const templateChanged = !!nowCurrent && !i4DraftMatchesPublishedFields(key, nowCurrent.fields, editorAtReject.fields);
      rows = [...inGroup("版块", [{ label: "版块现在", left: state(nowSection), right: `基于 ${editorAtReject.expectedSectionVersion}`, changed: nowSection?.version !== editorAtReject.expectedSectionVersion || nowSection?.status !== editorAtReject.expectedSectionStatus },
        conflictRow("版本号", nowDraft?.version ?? nowCurrent?.version, editorAtReject.version),
        conflictRow("版块说明", nowDraft?.description ?? nowCurrent?.description, editorAtReject.description),
        conflictRow("内容结构", nowDraft?.structure ?? nowCurrent?.structure, editorAtReject.structure),
        ...(nowDraft ? [conflictRow("草稿最近保存", saved(nowDraft), "你在改的")] : []),
        ...(templateChanged ? [{ label: "内容模板", left: `${nowCurrent!.fields.length} 项内容`, right: `${editorAtReject.fields.length} 项内容`, changed: true }] : [])]),
        ...fieldRows(mapTrustSectionLanguageFields(base, requiredLanguages, "load"), editorAtReject.fields)];
      note = templateChanged ? "内容模板变了：你填的内容和译文原样留着，不会自动删；保存前对照现在公开的版本核对。" : "你填的内容留在编辑框里，保存时按最新的版本提交。";
      rebuild = latestData && section && (editorAtReject.mode === "create" || nowDraft) ? () => {
        const rebased = rebaseOpenDraft(editorAtReject, latestData, requiredLanguages);
        if (rebased) setDraftEditor(current => current === editorAtReject ? rebased : current);
      } : undefined;
    } else if (rejected?.action === "delete") {
      const nowDraft = latestData?.trustSectionVersions.find((row) => row.sectionKey === key && row.version === rejected.version);
      if (!gone && latestData && nowDraft?.status.toLowerCase() !== "draft") gone = `${rejected.version ?? ""} 已经不是草稿了（被删除或已发布）。`;
      rows = [...inGroup("草稿", [conflictRow("草稿最近保存", saved(rejected.snapshot ?? undefined), saved(nowDraft)), conflictRow("内容", `${rejected.snapshot?.fields.length ?? "—"} 项`, `${nowDraft?.fields.length ?? "—"} 项`),
        conflictRow("版块说明", rejected.snapshot?.description, nowDraft?.description), conflictRow("内容结构", rejected.snapshot?.structure, nowDraft?.structure)]),
        ...fieldRows(rejected.snapshot?.fields ?? [], nowDraft?.fields ?? [])];
      rebuild = nowDraft ? () => { carry(); deleteSectionDraft(nowDraft); } : undefined;
    } else if (rejected && "before" in rejected) {
      const snap = rejected.snapshot;
      rows = [{ label: "版块", left: snap ? state(snap.section) : rejected.before ?? "—", right: state(nowSection), changed: !!snap && state(snap.section) !== state(nowSection), group: "版块" }];
      const target = rejected.action === "publish" ? latestData?.trustSectionVersions.find((row) => row.sectionKey === key && row.version === rejected.after) : undefined;
      if (rejected.action === "publish") {
        rows.push(...inGroup("版块", [conflictRow(`草稿 ${rejected.after ?? ""} 最近保存`, saved(snap?.target), saved(target)),
          conflictRow("版块说明", snap?.target?.description, target?.description), conflictRow("内容结构", snap?.target?.structure, target?.structure)]), ...fieldRows(snap?.target?.fields ?? [], target?.fields ?? []));
        if (!gone && latestData && target?.status.toLowerCase() !== "draft") gone = `${rejected.after ?? "这份草稿"} 已经不是草稿了，不能再提交发布。`;
        note = "内容核对要重新勾。";
      }
      const dataSource = String(rejected.request?.command.params.dataSourceStatement ?? "") || undefined;
      rebuild = !section ? undefined : rejected.action === "publish" ? target && (() => { carry({ dataSource }); pubSection(section, target); })
        : rejected.action === "rollback" ? () => { carry({ value: rejected.after }); rollbackSection(section); }
          : () => { carry(); archiveSection(section); };
    }
    if (!rebuild && !gone) { rebuildLabel = "知道了"; note = "最新的已经读到页面上，关掉后重新打开要做的操作。"; }
    const subject = <>{sectionName(key || "—")}</>;
    const finish = (task?: () => void) => {
      if (!conflictReview.confirm(conflict, () => undefined)) return;
      conflictView.show();
      if (task) window.setTimeout(task, 0);
    };
    return conflictView.open
      ? <IConflictModal review={conflict} subject={subject} lead={lead} rows={rows} columns={columns} gone={gone} note={note} rebuildLabel={rebuildLabel}
          onReread={() => void conflictReview.reread()} onClose={conflictView.hide} onRebuild={() => finish(rebuild)}
          onDiscard={() => finish(() => { if (editorAtReject) { setDraftEditor(null); setEditorCommandKey(null); } })} />
      : <IConflictPending subject={subject} onOpen={conflictView.show} />;
  })();

  const pendingLink = reach(pendingA2Href, "platform_a2_read")
    ? <Link className="rd-link" href={pendingA2Href} prefetch={false}>查看审批</Link> : null;
  const readOnly = !canDraftTrust && !canPublishStandard && !canPublishSensitive
    ? "你只能查看；改内容要有这页的修改或发布权限。"
    : !canPublishStandard && !canPublishSensitive ? "你可以写草稿；提交发布、回滚、下架要有发布权限。" : undefined;
  const header = (
    <PageHeader pageId="I4" title="信任中心" summary="管 App 信任中心的六个版块和四份公司资料。" readOnly={readOnly}
      meta={data && <span className="rd-toolbar">
        {readAt && <span>{readAt} 读取（{businessZone().label}）· 每 10 秒更新</span>}
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={refreshing} onClick={refresh}>刷新</Button>
      </span>} />
  );

  const materialDraftProps = {
    getDraft: (slot: I4DocumentCommand["document"]["slot"]) => materialDrafts.get(session?.adminId, slot),
    queryOriginal: readMaterialOriginal,
    forgetDraft: materialDrafts.forget,
  };
  // 公司资料在三种状态里带同一个 key、都是根片段的直接子元素：读取结束换分支时不重新挂载，抽屉里填到一半的内容、文件和理由留着。
  if (contentLoading && !data) {
    return <>{header}<I4RecoveryNotice rows={recoveryRows} />{releaseModal}{conflictUi}<BlockState state="loading" title="正在加载信任中心数据…" /><I4Documents key="i4-documents" onPendingChange={syncCommands} recovery={documentRecovery} {...materialDraftProps} /></>;
  }
  if (!data) {
    return <>{header}<I4RecoveryNotice rows={recoveryRows} />{releaseModal}{conflictUi}<BlockState state="error" title="信任中心加载失败" detail={errorText ?? "暂无信任中心数据"} onRetry={refresh} retrying={refreshing} /><I4Documents key="i4-documents" onPendingChange={syncCommands} recovery={documentRecovery} {...materialDraftProps} /></>;
  }

  // ---------- 首屏结论 ----------
  const allIssues = [
    ...orderedSections.filter((s) => sectionProblems(s).length).map((s) => `${sectionName(s.key)}${sectionProblems(s)[0]}`),
  ];
  // 结论只写前两处，其余写个数；每一处在卡片上都有标记。
  const issues = TRUST_SECTIONS.length === 0 && allIssues.length ? ["后台没有读到任何版块"]
    : allIssues.length > 2 ? [...allIssues.slice(0, 2), `另有 ${allIssues.length - 2} 处`] : allIssues;
  const drafts = TRUST_SECTION_VERSIONS.filter((version) => version.status.toLowerCase() === "draft");
  const draftSections = new Set(drafts.map((version) => version.sectionKey));
  const publicCount = orderedSections.filter((s) => isPublished(s.status)).length;
  // 只数公开中的版块：没公开的整块收起，谈不上公开时被清掉。
  const blankedCount = orderedSections.filter((s) => isPublished(s.status) && blankingOf(s.key, currentVersionOf(s)).all).length;
  const hint = [
    pendingTrustSectionKeys.size > 0 && `${pendingTrustSectionKeys.size} 个版块等另一位批准`,
    draftSections.size > 0 && `${draftSections.size} 个版块有待发布的草稿`,
  ].filter(Boolean).join(" · ") || undefined;
  const conclusionExplain = <><p>下架或没发布的版块在 App 上整块收起，别的照常显示；六块都没公开时，信任中心照常打开，公司资质、白皮书、平台运行数据和规则与资料还在。</p><p>公开的版块当前版要有说明和结构、英文齐全、不超过 {APP_FIELD_LIMIT} 项内容；有一块不满足，App 信任中心整页读不出来。</p><p>这里按后台读到的版本判断，安全文本和链接的细则以保存时的检查为准。</p></>;
  // 有几块在公开：全公开、只公开一部分、一块都没公开，三种说法。
  const hiddenCount = APP_SECTION_ORDER.length - publicCount;
  const publicLead = hiddenCount === 0 ? "六个版块都在公开" : publicCount === 0 ? "六个版块都没公开，App 信任中心只显示公司资质、白皮书、平台运行数据和规则与资料" : `${publicCount} 个版块在公开，${hiddenCount} 个没公开、在 App 上收起`;
  const blankExplain = <><p>正式环境公开时会清掉这几类内容：运营写的财务、徽章、上市文字；系统迁移写入的管理团队和审计版本；审计没填有效报告地址时的整块。后台照常保存和查看。</p>{conclusionExplain}</>;
  const pendingText = pendingTrustSectionKeys.size > 0 ? `${pendingTrustSectionKeys.size} 个版块等另一位批准` : "";
  const draftText = draftSections.size > 0 ? `${draftSections.size} 个版块有待发布的草稿` : "";
  const conclusion = issues.length
    ? <Conclusion state="danger" icon={ShieldAlert} lead explain={conclusionExplain} explainTitle="怎么判断"
      hint={[hint, "回滚到完整的版本或发布新版后才能打开"].filter(Boolean).join(" · ")}>按后台的版本看，App 信任中心整页打不开：{issues.join("、")}</Conclusion>
    : blankedCount > 0
      ? <Conclusion state="warn" explain={blankExplain} explainTitle="为什么是空的" action={pendingTrustSectionKeys.size > 0 ? pendingLink : undefined}
          hint={[pendingText, draftText].filter(Boolean).join(" · ") || "没有待发布的改动"}>
          {publicLead}；其中 <b>{blankedCount}</b> 个的文字公开时被清掉</Conclusion>
      : pendingTrustSectionKeys.size > 0
        ? <Conclusion state="warn" explain={conclusionExplain} explainTitle="怎么判断" action={pendingLink} hint={draftText || "批准前用户看到的不变"}>
            <b>{pendingTrustSectionKeys.size}</b> 个版块的申请等另一位批准</Conclusion>
        : draftSections.size > 0
          ? <Conclusion state="neutral" icon={FilePen} explain={conclusionExplain} explainTitle="怎么判断" hint="草稿只在后台，提交发布并批准后才公开">
              {publicLead}；<b>{draftSections.size}</b> 个版块有待发布的草稿</Conclusion>
          : <Conclusion state={hiddenCount ? "neutral" : "ok"} icon={hiddenCount ? EyeOff : ShieldCheck} explain={conclusionExplain} explainTitle="怎么判断">{publicLead}；没有待发布的改动</Conclusion>;

  // ---------- 版块卡 ----------
  const sectionMenu = (s: TrustSection): MoreMenuItem[] => {
    const isArchived = isArchivedStatus(liveTrustStatus(s));
    const isPending = pendingTrustSectionKeys.has(s.key);
    return [
      ...(canPublishTrustSection(s) ? [{ key: "rollback", label: isArchived ? "恢复上线" : "回滚历史版", disabledReason: isPending ? PENDING_REASON : newSectionReason(s.key, true) ?? (sectionVersionOptions(s).length === 0 ? "没有可以回滚的历史版本" : undefined), onSelect: () => rollbackSection(s) }] : []),
      ...(canPublishTrustSection(s) && !isArchived ? [{ key: "archive", label: "下架", danger: true, disabledReason: isPending ? PENDING_REASON : newSectionReason(s.key, true) ?? undefined, onSelect: () => archiveSection(s) }] : []),
    ];
  };
  const cards: SectionCardModel[] = orderedSections.map((s, index) => {
    const current = currentVersionOf(s);
    const blanking = blankingOf(s.key, current);
    const isArchived = isArchivedStatus(liveTrustStatus(s));
    const isPending = pendingTrustSectionKeys.has(s.key);
    const publicFields = snapshot.view?.available && snapshot.view.sourceEnvironment !== "SANDBOX"
      ? new Set(snapshotSection(s.key)?.fields.filter((field) => !field.cleared).map((field) => field.key) ?? []) : undefined;
    const preview = previewFields(s.key, (current?.fields ?? []).filter((field) => !blanking.keys.has(field.key) && (!publicFields || publicFields.has(field.key))));
    const menu = sectionMenu(s);
    return {
      key: s.key,
      index: index + 1,
      name: sectionName(s.key, trustDescriptionText(s.desc)),
      status: isArchived ? { text: "已下架", tone: "neutral" } : isPublished(s.status) ? { text: "公开中", tone: "ok" } : { text: statusZh(s.status), tone: "neutral" },
      version: s.v,
      updatedAt: current?.updatedAt ? timeText(current.updatedAt) : undefined,
      operator: current ? operatorText(current.operator) : undefined,
      preview,
      blankedAll: blanking.all,
      appLabel: isArchived ? "下架前的内容" : blanking.all ? "后台存的内容" : "actual" in blanking ? "App 实际给出" : "预计 App 显示",
      appHidden: isArchived ? `已下架：${unpublishedEffect(s.key)}。` : !isPublished(s.status) ? `没公开：${unpublishedEffect(s.key)}。` : blanking.all,
      appTags: (() => {
        const row = snapshotSection(s.key);
        if (!row || blanking.all) return undefined;
        const label = (key: string) => current?.fields.find((field) => field.key === key)?.label || key;
        const cleared = row.fields.filter((field) => field.cleared);
        return [
          ...(cleared.length ? [{ text: `${cleared.length} 项被清空`, explain: cleared.map((field) => `${label(field.key)}：${snapshotReasonText(field.reason, s.key)}`).join("；") }] : []),
          ...(row.version !== s.v ? [{ text: `App 给的是 ${row.version ?? "—"}`, explain: `后台当前版是 ${s.v}，App 取样时给的是 ${row.version ?? "—"}；刷新后再看。` }] : []),
        ];
      })(),
      draft: draftsOf(s.key).map((draft) => draft.version).join("、") || undefined,
      pending: isPending,
      problems: isArchived ? [] : sectionProblems(s),
      lastChange: s.lastChange,
      selected: secKey === s.key,
      onOpen: () => openSecDetail(s),
      actions: <>
        {canDraftTrust && <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={isPending ? PENDING_REASON : newSectionReason(s.key)} onClick={() => createSectionDraft(s)}>新建草稿</Button>}
        <Button size="sm" variant="ghost" onClick={() => openSecDetail(s)}>查看</Button>
        {menu.length > 0 && <MoreMenu label={`${sectionName(s.key)}的更多操作`} items={menu} />}
      </>,
    };
  });

  // ---------- 版本行的动作（详情抽屉和全部版本共用） ----------
  const versionActions = (version: TrustSectionVersion) => {
    const section = TRUST_SECTIONS.find((row) => row.key === version.sectionKey);
    const isDraft = ["draft", "DRAFT"].includes(version.status);
    const isPending = pendingTrustSectionKeys.has(version.sectionKey);
    if (!isDraft) return <span className="rd-weak">只读</span>;
    const canPublish = !!section && canPublishTrustSection(section);
    if (!canDraftTrust && !canPublish) return <span className="rd-weak">只读</span>;
    const items: MoreMenuItem[] = canDraftTrust ? [
      { key: "edit", label: "编辑草稿", disabledReason: isPending ? PENDING_REASON : newSectionReason(version.sectionKey), onSelect: () => editSectionDraft(version) },
      { key: "delete", label: "删除草稿", danger: true, disabledReason: isPending ? PENDING_REASON : newSectionReason(version.sectionKey), onSelect: () => deleteSectionDraft(version) },
    ] : [];
    return <span className="rd-row-actions">
      {canPublish && <Button size="sm" icon={<Send size={14} aria-hidden />} disabledReason={isPending ? PENDING_REASON : newSectionReason(version.sectionKey, true)} onClick={() => pubSection(section!, version)}>提交发布</Button>}
      {items.length > 0 && <MoreMenu label={`${sectionName(version.sectionKey)} ${version.version} 的更多操作`} items={items} />}
    </span>;
  };
  /** 和上一版（同一块里更早的一版）比改了几项。 */
  const changeText = (version: TrustSectionVersion) => {
    const list = TRUST_SECTION_VERSIONS.filter((row) => row.sectionKey === version.sectionKey);
    const older = list.slice(list.indexOf(version) + 1).find((row) => row.status.toLowerCase() !== "draft");
    if (!older) return "第一版";
    const count = changedKeys(older.fields, version.fields).size;
    return count ? `比 ${older.version} 改了 ${count} 项` : `和 ${older.version} 一样`;
  };

  // ---------- 详情抽屉 ----------
  const detailIndex = sec ? orderedSections.indexOf(sec) : -1;
  const secCurrent = sec ? currentVersionOf(sec) : undefined;
  const secBlanking = sec ? blankingOf(sec.key, secCurrent) : { keys: new Set<string>() };
  const secVersions = sec ? TRUST_SECTION_VERSIONS.filter((row) => row.sectionKey === sec.key) : [];
  const secPending = sec ? pendingTrustSectionKeys.has(sec.key) : false;
  const secProblems = sec ? sectionProblems(sec) : [];
  const detailPoints: JudgmentRow[] = sec ? [
    { label: "用户现在看到", value: isArchivedStatus(liveTrustStatus(sec)) ? `已下架（${sec.v}），App 上这一块收起` : isPublished(sec.status) ? `${sec.v} 公开中` : `${sec.v}（${statusZh(liveTrustStatus(sec))}），App 上这一块收起`, state: secProblems.length ? "danger" : undefined, reason: secProblems.length ? secProblems.join("；") : undefined },
    { label: "App 实际给出", ...(() => {
      const view = snapshot.view, row = snapshotSection(sec.key), cleared = row?.fields.filter((field) => field.cleared).length ?? 0;
      if (!view) return { value: snapshot.error ? "没读到，按后台版本推断" : "正在加载…", reason: snapshot.error || undefined };
      if (!view.available) return { value: "整页打不开", state: "danger" as const, reason: snapshotReasonText(view.reason) };
      if (view.sourceEnvironment === "SANDBOX") return { value: "测试环境的演示内容" };
      if (!row) return { value: "—" };
      if (secBlanking.all) return { value: `${row.version ?? "—"} · 文字没公开`, state: "warn" as const };
      return { value: `${row.version ?? "—"} · ${cleared ? `${cleared} 项被清空` : "内容都给出了"}`, state: cleared || row.version !== sec.v ? "warn" as const : undefined, reason: row.version !== sec.v ? `后台当前版是 ${sec.v}` : undefined };
    })() },
    { label: "App 里在哪", value: SECTION_INFO[sec.key]?.where ?? "待核实" },
    ...(secPending ? [{ label: "待审批", value: <>有申请等另一位批准，处理完或过期前不能改{pendingLink && <> · {pendingLink}</>}</>, state: "warn" as const }] : []),
    { label: "提交发布要", value: `${permissionText(sec)}，${APPROVER}批准` },
    { label: "外部链接", value: sectionExternalLink ? <span data-user-content="" className="i4-break">{sectionExternalLink}</span> : "未配置" },
  ] : [];
  const secFooter = sec && (canDraftTrust || canPublishTrustSection(sec)) ? (() => {
    const isArchived = isArchivedStatus(liveTrustStatus(sec));
    const lock = secPending ? PENDING_REASON : newSectionReason(sec.key, true);
    return <Decision
      danger={canPublishTrustSection(sec) && !isArchived ? <Button variant="danger-outline" icon={<EyeOff size={14} aria-hidden />} disabledReason={lock} onClick={() => archiveSection(sec)}>下架</Button> : undefined}
      others={canPublishTrustSection(sec) ? <Button icon={isArchived ? <RotateCcw size={14} aria-hidden /> : <Undo2 size={14} aria-hidden />} disabledReason={lock ?? (sectionVersionOptions(sec).length === 0 ? "没有可以回滚的历史版本" : undefined)} onClick={() => rollbackSection(sec)}>{isArchived ? "恢复上线" : "回滚历史版"}</Button> : undefined}
      primary={canDraftTrust ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={secPending ? PENDING_REASON : newSectionReason(sec.key)} onClick={() => createSectionDraft(sec)}>新建草稿</Button> : undefined} />;
  })() : undefined;

  // ---------- 编辑抽屉 ----------
  const editorSection = draftEditor ? TRUST_SECTIONS.find((item) => item.key === draftEditor.sectionKey) : undefined;
  const editorUnchanged = !!draftEditor && !editorCommandKey
    && editorSection?.v === draftEditor.expectedSectionVersion && editorSection.status === draftEditor.expectedSectionStatus
    && currentVersionOf(editorSection)?.revision === draftEditor.published?.revision
    && draftsOf(draftEditor.sectionKey).some(row => row.version === draftEditor.version && row.revision === draftEditor.revision)
    && trustDraftUnchanged(draftEditor, trustDraftFieldsForSubmit(draftEditor.fields, requiredLanguages), requiredLanguages);
  const editorMissing = draftEditor ? [
    !/^v[1-9][0-9]{0,8}$/.test(draftEditor.version) && "版本号（v 加数字）",
    !draftEditor.description.trim() && "版块说明",
    !draftEditor.structure.trim() && "内容结构",
    !draftEditor.reason.trim() && "保存说明",
    mapTrustSectionLanguageFields(draftEditor.fields, requiredLanguages, "submit").some((field) => !field.label.trim() || (!isOptionalTrustLinkField(field.key) && !field.value.trim())) && "空着的内容项",
  ].filter(Boolean) as string[] : [];

  return (
    <>
      {header}
      {errorText && <Notice tone="warn" title="数据没有读到最新" action={<Button size="sm" loading={refreshing} onClick={refresh}>重新加载</Button>}>{errorText} 下面是上次读到的内容。</Notice>}
      <I4RecoveryNotice rows={recoveryRows} />
      {releaseModal}
      {conflictUi}
      {conclusion}
      <SnapshotLine state={snapshot} onRetry={readSnapshot}
        clearedCount={orderedSections.reduce((sum, s) => sum + (snapshotBlanking(snapshot.view, s.key)?.all ? 0 : snapshotSection(s.key)?.fields.filter((field) => field.cleared).length ?? 0), 0)}
        versionDiff={orderedSections.filter((s) => { const row = snapshotSection(s.key); return row && row.version !== s.v; }).length} />

      <Panel title="用户现在看到的" icon={LayoutList} tone="role-2" sub={`受管 ${I4_STATS.managedSections} 个 · 公开中 ${publicCount} 个`}
        explain="按 App 里的顺序排。卡里是当前版的中文内容，读到 App 实际公开的状态后，没公开的项不列出。点卡片看三种语言、历史版本和草稿。">
        {cards.length === 0
          ? <BlockState state="empty" title="没有读到信任版块" detail="没有读到版块，这页不补示例内容。" />
          : <div className="i4-cards">{cards.map((card) => <SectionCard key={card.key} card={card} />)}</div>}
      </Panel>

      <I4Documents key="i4-documents" onPendingChange={syncCommands} recovery={documentRecovery} {...materialDraftProps} />

      <Fold title="全部版本" icon={History} tone="role-3" summary={`${TRUST_SECTION_VERSIONS.length} 个版本${drafts.length ? ` · ${drafts.length} 个草稿` : ""}`}
        explain="每块的历史版本和草稿。谁批准的在「操作记录与审批」里看。">
        <Table label="全部版本" className="i4-version-table">
          <thead><tr><Th>版块</Th><Th>版本</Th><Th>状态</Th><Th>改了什么</Th><Th>最近保存</Th><Th sticky="end" align="right">操作</Th></tr></thead>
          <tbody>
            {TRUST_SECTION_VERSIONS.map((version) => {
              const section = TRUST_SECTIONS.find((row) => row.key === version.sectionKey);
              const live = !!section && section.v === version.version && isPublished(section.status);
              const state = versionTone(version.status, live);
              return (
                <Tr key={`${version.sectionKey}-${version.version}`} onOpen={section ? () => openSecDetail(section) : undefined}>
                  <Td><Cell main={sectionName(version.sectionKey)} sub={<LegacyText text={trustDescriptionText(version.description)} />} /></Td>
                  <Td><Cell num main={version.version} sub={`${version.fields.length} 项内容`} /></Td>
                  <Td><StatusTag tone={state.tone}>{state.text}</StatusTag></Td>
                  <Td><Cell main={changeText(version)} /></Td>
                  <Td><Cell num main={version.updatedAt ? timeText(version.updatedAt) : "—"} sub={operatorText(version.operator)} title={version.operator} /></Td>
                  <Td sticky="end" align="right" data-fit="">{versionActions(version)}</Td>
                </Tr>
              );
            })}
            {TRUST_SECTION_VERSIONS.length === 0 && <TableMessage columns={6}>暂无版本，请先在版块卡上点「新建草稿」。</TableMessage>}
          </tbody>
        </Table>
        <p className="rd-note i4-docs-zone">时间为{businessZone().label}</p>
      </Fold>

      <PaginationExemptionList
        items={[
          {
            label: "信任中心 · /trust",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "信任中心固定六版块,需同屏核对版本与状态",
          },
        ]}
      />

      <Drawer open={!!sec} onClose={() => setSecKey(null)} icon={SECTION_INFO[sec?.key ?? ""]?.icon ?? ShieldCheck} tone="role-2"
        title={sec ? sectionName(sec.key, trustDescriptionText(sec.desc)) : "信任版块"} sub={sec ? `${sec.v} · ${isArchivedStatus(liveTrustStatus(sec)) ? "已下架" : "公开中"}` : undefined}
        nav={{ hasPrev: detailIndex > 0, hasNext: detailIndex >= 0 && detailIndex < orderedSections.length - 1, onPrev: () => setSecKey(orderedSections[detailIndex - 1].key), onNext: () => setSecKey(orderedSections[detailIndex + 1].key) }}
        footer={secFooter}>
        {sec && <>
          <JudgmentPoints rows={detailPoints} />
          {secBlanking.all && <Notice tone="neutral" title={"actual" in secBlanking ? "App 没有公开这块的文字" : "App 公开时清空这块的文字"}>{secBlanking.all}</Notice>}
          <section className="rd-stack" aria-label="现在公开的内容">
            <div className="i4-detail-head"><h3>现在公开的内容 · {sec.v}</h3></div>
            <LocaleTabs label="查看语言" value={detailLang} onChange={setDetailLang} items={localeItems(secCurrent?.fields ?? [])} />
            <FieldList label={`${sectionName(sec.key)}现在公开的内容`} fields={secCurrent?.fields ?? []} lang={detailLang} blanked={secBlanking} />
          </section>
          {sec.key === "financials" && FINANCIALS_FIELDS.length > 0 && (
            <Fold inset title="财务指标" summary={`${FINANCIALS_FIELDS.length} 项 · 运营填写的说明文字`}
              explain="这些是运营写的展示文字，不是真实财务统计，页面不计算。指标名称是这一项自己存的名称，没存时写默认的中文名。">
              <Table label="财务指标">
                <thead><tr><Th>指标</Th><Th>内容</Th></tr></thead>
                <tbody>
                  {FINANCIALS_FIELDS.map((f) => {
                    const fallback = FINANCE_LABEL[f.k] ?? f.k;
                    // 名称是运营存的文字，原样显示；没存（空或缺）时用默认中文名，默认名和存的不同就写在下面。
                    return (
                      <Tr key={f.k}>
                        <Td><Cell main={f.delta ? <span data-user-content="">{f.delta}</span> : fallback} sub={f.delta && f.delta !== fallback ? fallback : undefined} /></Td>
                        <Td><span data-user-content="">{nexGridBrandText(f.v)}</span></Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </Fold>
          )}
          <Fold inset title="版本和草稿" summary={`${secVersions.length} 个版本${draftsOf(sec.key).length ? ` · ${draftsOf(sec.key).length} 个草稿` : ""}`} defaultOpen={draftsOf(sec.key).length > 0}>
            <ul className="i4-vlist" aria-label={`${sectionName(sec.key)}的版本`}>
              {secVersions.map((version) => {
                const state = versionTone(version.status, version.version === sec.v && isPublished(sec.status));
                const stale = version.status.toLowerCase() === "draft" && !(secCurrent && version.fields.map((f) => f.key).sort().join() === secCurrent.fields.map((f) => f.key).sort().join());
                return (
                  <li key={version.version}>
                    <div className="i4-vlist-main">
                      <span className="i4-vlist-no">{version.version}</span>
                      <StatusTag tone={state.tone}>{state.text}</StatusTag>
                      {stale && <StatusTag tone="warn" explain="内容项和现在公开的版本对不上，不能编辑，删掉后新建。">模板已变</StatusTag>}
                      <span className="i4-vlist-change">{changeText(version)} · {version.fields.length} 项内容</span>
                    </div>
                    <div className="i4-vlist-meta">{version.updatedAt ? timeText(version.updatedAt) : "—"} · {operatorText(version.operator)}</div>
                    <div className="i4-vlist-actions">{versionActions(version)}</div>
                  </li>
                );
              })}
            </ul>
            <p className="rd-note">时间为{businessZone().label}；谁批准的在「操作记录与审批」里看{pendingLink && <>：{pendingLink}</>}。</p>
          </Fold>
          <Fold inset title="技术信息" summary={snapshot.view ? "版块标识、后台说明、修订号、App 取样" : "版块标识、后台说明、修订号"}>
            <Facts>
              <Fact k="版块标识"><span data-mono="">{sec.key}</span></Fact>
              <Fact k="后台说明"><LegacyText text={trustDescriptionText(sec.desc)} /></Fact>
              <Fact k="内容结构">{sec.struct}</Fact>
              <Fact k="确认级">{operatorCopyText(sec.roleGate).replace(/超管/g, "超级管理员")}（只是说明，权限以账号为准）</Fact>
              <Fact k="最近改动"><span data-user-content="">{sec.lastChange || "—"}</span></Fact>
              {secCurrent && <Fact k="修订号">{secCurrent.revision}</Fact>}
              {snapshot.view && <>
                <Fact k="App 取样时间">{timeText(snapshot.view.sampledAt)}（{businessZone().label}）</Fact>
                <Fact k="App 数据来源"><span data-mono="">{snapshot.view.source || "—"} · {snapshot.view.sourceEnvironment || "—"}{snapshot.view.runId ? ` · ${snapshot.view.runId}` : ""}</span></Fact>
                {(() => { const row = snapshot.view.sections.find((item) => item.sectionKey === sec.key); const codes = [...new Set([snapshot.view.reason, row?.reason, ...(row?.fields.map((field) => field.reason) ?? [])].filter(Boolean))]; return codes.length ? <Fact k="App 原因码"><span data-mono="">{codes.join("、")}</span></Fact> : null; })()}
              </>}
            </Facts>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={!!draftEditor} onClose={() => { if (!savingDraft) { setDraftEditor(null); setEditorCommandKey(null); } }} busy={savingDraft} wide icon={FilePen} tone="role-2"
        title={draftEditor?.mode === "edit" ? "编辑草稿" : "新建草稿"}
        sub={draftEditor ? `${sectionName(draftEditor.sectionKey)}${draftEditor.mode === "edit" ? ` · ${draftEditor.version}` : ""}` : undefined}
        footer={draftEditor && <Decision
          note={editorUnchanged ? NO_DRAFT_CHANGES : editorMissing.length ? `还缺：${editorMissing.join("、")}` : undefined}
          others={<Button disabled={savingDraft} onClick={() => { setDraftEditor(null); setEditorCommandKey(null); }}>取消</Button>}
          primary={<Button variant="primary" data-trust-draft-editor="direct-save" loading={savingDraft} disabledReason={editorCommandKey ? (() => { const record = draftCommands.find(row => row.commandKey === editorCommandKey); return record ? draftRetryProblem(record) : "请查询原操作"; })() : newSectionReason(draftEditor.sectionKey) ?? (editorUnchanged ? NO_DRAFT_CHANGES : undefined)} onClick={() => void saveSectionDraft()}>{editorCommandKey ? "按原操作重试" : "保存草稿"}</Button>} />}>
        {draftEditor && <>
          <div className="i4-doc-effect"><StatusTag tone="neutral" filled explain="保存草稿直接写，不走审批；用户看到的内容不变，提交发布并批准后才公开。">不改公开内容</StatusTag></div>
          <DraftEditorBody editor={draftEditor} requiredLanguages={requiredLanguages} frozen={savingDraft || !!editorCommandKey} onChange={setDraftEditor}
            published={draftEditor.published?.fields ?? (editorSection ? currentSectionFields(editorSection) : [])} publishedVersion={draftEditor.published?.version ?? draftEditor.expectedSectionVersion} />
        </>}
      </Drawer>
    </>
  );
}
