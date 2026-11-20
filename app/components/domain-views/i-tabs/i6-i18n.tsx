"use client";
import { englishCopyHint, isEnglishCopy, mapSingleContentText } from "@/lib/admin/content-language-rules";
import { getRequiredContentLanguages, OPERATING_LANGUAGE_CODES, INTERFACE_LANGUAGES, type InterfaceLanguageCode, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * 多语言与课程（版本发布页，PG-47）。两个页签按读权限给：「App 文案」管已登记文案键的三语草稿、发布、归档、回滚、
 * 完整性检查和写死在 App 里的文字登记；「学习课程」管课程的三语正文、测验、草稿、版本、发布、下架、奖励和首页推荐。
 * 两个页签同时挂着（切走不丢未保存内容），各自的读取和旧页面一样：概览一份，所选文案的历史，所选课程的版本。
 * 写入口和请求照旧：文案六类直接生效；课程草稿、下架、换推荐直接生效；有奖励的课程发布、版本发布、回滚和调奖提交审批。
 * 文案和课程的编辑表单画在这页的抽屉里（字段、默认值、校验照共用表单），确认框只填理由，请求体由原来的拼法生成。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Archive, BadgeCheck, BookOpen, CircleSlash, CodeXml, Eye, EyeOff, FilePen, GraduationCap, History, Languages, ListChecks, Pencil, Plus, RefreshCw, RotateCcw, Search, Send, Star, Trash2, TriangleAlert } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterBar, FilterField, Fold, IconTile, Input, IrreversibleTag, JudgmentPoints, LocaleTabs, MoreMenu, Notice, PageHeader, PageTabs, Pager, Panel, RatioBar, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr, useTabIds, type JudgmentRow, type MoreMenuItem, type StateTone } from "@/app/components/rd";
import { fetchI6LearningOverview, i6RetryPermission, pendingI6Commands, queryI6Receipt, retryI6Command, type I6Command, type I6CommandSnapshot, type I18nMessagePairView, type LearningQuizQuestionView, type LearningCourseVersionView, type LearningCourseView } from "@/lib/admin/i-client";
import type { ActionConfirmReq, ConfirmReq, ICtx } from "./types";
import { PaginationExemptionList } from "../design-kit";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import { i6CopyQualityIssues, i6HasCopyText } from "@/lib/admin/i6-copy-quality";
import { hiCourseScope, hiCourseRewardScope, hiRewardProposal, i6CourseProposalPermission, pendingHIRewardCommand, pendingHIRewardCommands, queryI6CourseProposal, releaseExpiredI6CourseProposal, retryI6CourseProposal, submitHIRewardCommand, type HIRewardCommand } from "@/lib/admin/hi-reward-commands";
import { fetchA2Overview, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { isOutcomeUnknownError } from "@/lib/admin/outcome-classification";
import { useIConflictReview } from "@/lib/admin/i-conflict-review";
import { conflictRow, IConflictModal, IConflictPending, inGroup, useIConflictView, type IConflictRow } from "./i-conflict";
import { isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { canInvestigateECommand, eCommandClosureOffer, eCommandSettled } from "@/lib/admin/e-command-investigation";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { FundClosureModal, fundRecoveryStatus, settledText } from "../fund-command-check";
import { OPEN_RESULT_LABELS, TechInfo, receiptFact, receiptOf } from "../recovery-panel";
import { DIRECT_RECOVERY_INTRO, CLOSURE_KEPT_TEXT } from "../direct-recovery-copy";
import { businessStamp, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { I6_COURSE_REWARD_DECIMALS, i6Amount, i6RewardChange } from "@/lib/admin/i6-amount";
import { AppCoursePreview, CATEGORY_LABEL, COMPLETION_LABEL, CompareRows, CourseEditor, FORMAT_LABEL, LANGS, LEVEL_LABEL, REWARD_EVENT_LABEL, RETIRED_OPTIONS_VIEW_NOTE, RetiredOption, blockedText, categoryIcon, categoryLabel, copyFormMissing, courseFormMissing, mapCourseLanguages, durationText, NO_REWARD, nsLabel, rewardPerUser, uvtText, type CourseForm, type CourseSpec, type Lang } from "./i6-parts";

/** 查到原审批单时说结论：还在等批准，或已有结果、执行情况到操作记录看。 */
const ticketText = (ticket: A2OperationRow) => ({
  pending: "已提交，等待审批后执行",
  approved: "原审批单已批准，执行结果到操作记录与审批查看",
  rejected: "原审批单已被驳回，没有执行",
  withdrawn: "原审批单已撤回，没有执行",
  expired: "原审批单已过期，没有执行",
} as Record<string, string>)[ticket.status] ?? "已查到原审批单，结果到操作记录与审批查看";
/** 结果未知不是失败，不加「操作失败」。 */
const failText = (error: unknown) => isOutcomeUnknownError(error) || isA2OutcomeUncertainError(error) ? displayAdminError(error) : `操作失败：${displayAdminError(error)}`;

const COURSE_APPROVAL_OPS = new Set(["i7_course_first_publish", "i7_course_version_publish", "i7_course_version_rollback", "i7_course_reward_adjust"]);
/** 有奖励的课程激活和调奖：后端要另一位超级管理员，并有审批批准权限（A:124、G:717）。 */
const APPROVER = "另一位超级管理员";
const BJ = "北京时间";

type TabKey = "copy" | "courses";
type MsgScope = "all" | "missing" | "draft" | "published" | "archived";
type CatFlt = string;
type Namespace = { ns: string; keys: number; coverage: number; variants: string; lastChange: string };
type IntegrityIssue = { code: string; kind: string; cnt: number; samples: string[]; status: string };
type HardcodedFinding = { location: string; rawCopy: string; suggestedKey: string; status: string };
type Course = {
  id: string; title: string; cat: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  reward: number; featured: boolean; duration: string; v: string; status: string; body: string;
  titleZh: string; titleEn: string; titleVi: string; bodyZh: string; bodyEn: string; bodyVi: string;
  titleTranslations?: LearningCourseView["titleTranslations"];
  bodyTranslations?: LearningCourseView["bodyTranslations"];
  quizQuestions: (LearningQuizQuestionView & { questionVi?: string; optionsVi?: string[] })[];
  passScore?: number; retryLimit?: number; completionCondition?: string; rewardEvent?: string; revision: number;
  /** 后端原值，显示时不经 Number 丢精度。 */
  rewardRaw: string | null;
};
type CopyEditor = { mode: "edit" | "fix"; issue?: IntegrityIssue; zh: string; vi: string; en: string; tried: boolean };
type CourseEditorState = { courseId?: string; spec: CourseSpec; title: string; sub?: ReactNode; save: (form: CourseForm) => void };

const MSG_STATUS: Record<string, { text: string; tone: StateTone }> = {
  draft: { text: "草稿", tone: "neutral" }, published: { text: "已发布", tone: "ok" }, archived: { text: "已归档", tone: "done" },
};
const COURSE_STATUS: Record<string, { text: string; tone: StateTone }> = {
  draft: { text: "草稿", tone: "neutral" }, ready: { text: "草稿", tone: "neutral" }, published: { text: "在线", tone: "ok" }, archived: { text: "已下架", tone: "done" },
};
const VERSION_STATUS: Record<string, { text: string; tone: StateTone }> = {
  DRAFT: { text: "草稿", tone: "neutral" }, PUBLISHED: { text: "线上版本", tone: "ok" }, SUPERSEDED: { text: "历史版本", tone: "done" },
};
/** 后端问题类别的原名（「缺少英文镜像」）写成人话，原名进问号。 */
const ISSUE_NAME: Record<string, string> = { "missing-zh": "缺中文", "missing-en": "缺英语", "missing-vi": "缺越南语", placeholder: "变量不一致", "placeholder-text": "占位文字没换掉", "retired-brand": "用了退役品牌名" };
const issueName = (issue: { code: string; kind: string }) => ISSUE_NAME[issue.code] ?? issue.kind;
/** 审批单前后值原文「v1 · published · 25 UVT」写成「v1 在线 · 25 UVT」。 */
const approvalValue = (value: string) => (value.replace(/\bNEX\b/g, "UVT").replace(/ · published · /g, " 在线 · ").replace(/ · draft · /g, " 草稿 · ").replace(/ · ready · /g, " 草稿 · ").replace(/ · archived · /g, " 已下架 · "));
const msgStatus = (status?: string) => MSG_STATUS[status ?? ""] ?? { text: "状态未知", tone: "warn" as StateTone };
const langValue = (message: Pick<I18nMessagePairView, "zh" | "vi" | "en">, lang: Lang) => message[lang] ?? "";
const missingLangs = (message: Pick<I18nMessagePairView, "zh" | "vi" | "en">, required: readonly OperatingLanguageCode[]) =>
  LANGS.filter((item) => required.includes(item.key) && !i6HasCopyText(langValue(message, item.key)));
const count = (value: number) => value.toLocaleString("en-US");

function readTab(allowed: readonly TabKey[]): TabKey {
  const wanted = new URLSearchParams(window.location.search).get("tab");
  return allowed.find((item) => item === wanted) ?? allowed[0];
}

/** 页面入口：页头、页签、两个页签的读权限。 */
export function I6I18n({ ctx, errorText }: { ctx: ICtx; errorText: string | null }) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const authorities = session?.authorities ?? [];
  const canReadI6 = isSuperadmin || authorities.includes("content_i6_read");
  const canReadI7 = isSuperadmin || authorities.includes("content_i7_read");
  const tabs = useMemo(() => [...(canReadI6 ? ["copy" as const] : []), ...(canReadI7 ? ["courses" as const] : [])], [canReadI6, canReadI7]);
  const tabIds = useTabIds();
  const [tab, setTab] = useState<TabKey | null>(null);
  const [readAt, setReadAt] = useState("");
  const [reloading, setReloading] = useState(false);
  const data = ctx.content.i18nLearning;
  useEffect(() => { if (data) setReadAt(businessStamp(Date.now())); }, [data]);
  useEffect(() => { if (tabs.length) setTab(readTab(tabs)); }, [tabs]);
  const choose = useCallback((next: TabKey) => {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === tabs[0]) url.searchParams.delete("tab");
    else url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [tabs]);
  const reload = () => {
    setReloading(true);
    void ctx.actions.reloadIContent().finally(() => setReloading(false));
  };
  const issues = Math.max(0, data?.stats.integrityIssues ?? 0);
  const header = (
    <PageHeader pageId="I6" title="多语言与课程" summary="管 App 文字的三语版本和学习课程。"
      meta={readAt ? `${readAt.slice(11)} 读取（${BJ}）` : undefined}
      actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={reloading || (ctx.contentLoading && !!data)} onClick={reload}>刷新</Button>} />
  );
  if (!tabs.length) {
    return <>{header}<BlockState state="denied" title="没有查看权限" detail="查看文案要有多语言文案的查看权限，查看课程要有学习课程的查看权限。" /></>;
  }
  return (
    <>
      {header}
      {errorText && <Notice tone="danger" title={data ? "数据没有读到最新" : "数据没有读到"} action={<Button size="sm" loading={reloading} onClick={reload}>重新加载</Button>}>
        {errorText}{data ? " 下面是上一次读到的内容。" : ""}
      </Notice>}
      {tabs.length > 1 && tab && <PageTabs label="多语言与课程" value={tab} onChange={choose} ids={tabIds}
        items={[
          { value: "copy", label: "App 文案", count: data ? issues : undefined },
          { value: "courses", label: "学习课程" },
        ]} />}
      {canReadI6 && <div {...(tabs.length > 1 ? tabIds.panel("copy") : {})} hidden={tab !== "copy"} className="i6-tabpane">
        <I18nLearningPage ctx={ctx} view="i18n" />
      </div>}
      {canReadI7 && <div {...(tabs.length > 1 ? tabIds.panel("courses") : {})} hidden={tab !== "courses"} className="i6-tabpane">
        <I18nLearningPage ctx={ctx} view="learn" />
      </div>}
    </>
  );
}

async function submittedMessageText(placeholders: readonly string[], form: Pick<CopyEditor, "zh" | "en" | "vi">) {
  const required = await getRequiredContentLanguages();
  const missing = copyFormMissing(placeholders, form, required);
  if (missing.length) throw new Error(blockedText(missing));
  return mapSingleContentText(form, required, "submit");
}

function messagePublication(message?: I18nMessagePairView) {
  const missingLocales = message
    ? ([["中文", message.zh], ["英文", message.en], ["越南语", message.vi]] as const).filter(([, value]) => !i6HasCopyText(value)).map(([label]) => label)
    : [];
  const hasEnglish = !!message && i6HasCopyText(message.en);
  const baseCopies = message ? [message.en, message.zh, message.vi].filter(i6HasCopyText) : [];
  const messageVariables = message && hasEnglish
    ? [...baseCopies, ...Object.values(message.translations ?? {}).filter(i6HasCopyText)]
      .map((value) => [...new Set(value.match(/\{[a-zA-Z0-9_.-]+}/g) ?? [])].sort().join("、"))
    : [];
  const variablesMatch = new Set(messageVariables).size === 1;
  const qualityIssues = message ? i6CopyQualityIssues(message.zh, message.en, message.vi) : [];
  const publicationIssues = [
    ...missingLocales.map((locale) => `缺少${locale}文案`),
    ...(new Set(messageVariables.slice(0, baseCopies.length)).size > 1 ? ["已填写文案的变量不一致"] : []),
    ...qualityIssues,
  ];
  return { missingLocales, hasEnglish, messageVariables, variablesMatch, qualityIssues, publicationIssues };
}

function I18nLearningPage({ ctx, view }: { ctx: ICtx; view: "i18n" | "learn" }) {
  const { toast, openActionConfirm, openConfirm, actions: backendActions, content, contentLoading } = ctx;
  const latest = useRef(ctx);
  latest.current = ctx;
  const versionsRead = useRef<LearningCourseVersionView[]>([]);
  const messagesRead = useRef<I18nMessagePairView[]>([]);
  const actions = useMemo<ICtx["actions"]>(() => {
    const snapshot = (selection: { messageKey?: string; courseId?: string; version?: string; issueCode?: string; featured?: boolean }): I6CommandSnapshot => {
      const original = latest.current.content.i18nLearning;
      return {
        message: selection.messageKey ? original?.messages.find(row => row.messageKey === selection.messageKey) : undefined,
        messageVersion: selection.messageKey ? messagesRead.current.find(row => row.messageKey === selection.messageKey && row.version === selection.version) : undefined,
        course: selection.courseId ? original?.courses.find(row => row.id === selection.courseId) : undefined,
        courseVersion: selection.courseId ? versionsRead.current.find(row => row.courseId === selection.courseId && row.version === selection.version) : undefined,
        integrityIssue: selection.issueCode ? original?.integrityIssues.find(row => row.code === selection.issueCode) : undefined,
        featuredCourseId: selection.featured ? original?.featuredCourseId : undefined,
        featuredCourse: selection.featured ? original?.courses.find(row => row.id === original.featuredCourseId) : undefined,
      };
    };
    return { ...backendActions,
      rescanI6: (reason) => backendActions.rescanI6(reason, { stats: latest.current.content.i18nLearning?.stats }),
      saveI6LocalizedDraft: (key, body, reason) => backendActions.saveI6LocalizedDraft(key, body, reason, snapshot({ messageKey: key })),
      publishI6LocalizedMessage: (key, body, reason) => backendActions.publishI6LocalizedMessage(key, body, reason, snapshot({ messageKey: key })),
      archiveI6LocalizedMessage: (key, version, reason) => backendActions.archiveI6LocalizedMessage(key, version, reason, snapshot({ messageKey: key })),
      rollbackI6LocalizedMessage: (key, target, version, reason) => backendActions.rollbackI6LocalizedMessage(key, target, version, reason, snapshot({ messageKey: key, version: target })),
      fixI6Integrity: (code, body, reason) => backendActions.fixI6Integrity(code, body, reason, snapshot({ messageKey: String(body.messageKey), issueCode: code })),
      createI6Course: (id, body, reason) => backendActions.createI6Course(id, body, reason, snapshot({ courseId: id })),
      updateI7CourseDraft: (id, body, reason) => backendActions.updateI7CourseDraft(id, body, reason, snapshot({ courseId: id })),
      deleteI7CourseDraft: (id, reason) => backendActions.deleteI7CourseDraft(id, reason, snapshot({ courseId: id })),
      publishI6Course: (id, reason) => backendActions.publishI6Course(id, reason, snapshot({ courseId: id })),
      archiveI6Course: (id, reason) => backendActions.archiveI6Course(id, reason, snapshot({ courseId: id })),
      createI7CourseVersion: (id, body, reason) => backendActions.createI7CourseVersion(id, body, reason, snapshot({ courseId: id })),
      updateI7CourseVersion: (id, version, body, reason) => backendActions.updateI7CourseVersion(id, version, body, reason, snapshot({ courseId: id, version })),
      deleteI7CourseVersion: (id, version, reason) => backendActions.deleteI7CourseVersion(id, version, reason, snapshot({ courseId: id, version })),
      publishI7CourseVersion: (id, version, reason) => backendActions.publishI7CourseVersion(id, version, reason, snapshot({ courseId: id, version })),
      rollbackI7CourseVersion: (id, version, reason) => backendActions.rollbackI7CourseVersion(id, version, reason, snapshot({ courseId: id, version })),
      updateI6FeaturedCourse: (id, reason) => backendActions.updateI6FeaturedCourse(id, reason, snapshot({ courseId: id, featured: true })),
    };
  }, [backendActions]);
  const conflictReview = useIConflictReview<{
    overview: Awaited<ReturnType<typeof fetchI6LearningOverview>>;
    versions?: LearningCourseVersionView[]; messages?: I18nMessagePairView[];
  }, { scope: string; reason: string; value?: string; form?: Record<string, string> }>();
  const conflictView = useIConflictView(conflictReview.review);
  /** 核对冲突后重开确认框时带回的理由和新值，只用一次。 */
  const prefill = useRef<{ scope: string; reason: string; value?: string } | null>(null);
  const readReady = useRef(false);
  const [, updateRecovery] = useState(0);
  const session = useAdminAuth((state) => state.session);
  const reach = useReach();
  const isSuperadmin = session?.role === "superadmin";
  const canWriteI6 = isSuperadmin || !!session?.authorities.includes("content_i6_write");
  const canWriteI7 = isSuperadmin || !!session?.authorities.includes("content_i7_write");
  const canAdjustI7Reward = isSuperadmin || !!session?.authorities.includes("content_i7_course_reward_adjust");
  const canPublishI7 = canWriteI7 && canAdjustI7Reward;
  const rewardApprovalBlocked = !session?.authorities.some(permission => ["platform_a2_write", "platform_a2_proposal_create"].includes(permission)) ? "缺少提交审批权限" : undefined;
  const canReadA2 = isSuperadmin || !!session?.authorities.includes("platform_a2_read");
  // 已建成、等别人批的课程审批单只在审批中心里；这里读一次，在课程区常显哪门课在等批。
  const [courseApprovals, setCourseApprovals] = useState<A2OperationRow[] | "error" | null>(null);
  const [lookupKey, setLookupKey] = useState("");
  /** 过期后按原请求查不到审批单的记录：可以确认解除。 */
  const [notFoundKeys, setNotFoundKeys] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<HIRewardCommand | null>(null);
  const [ordinaryBusy, setOrdinaryBusy] = useState("");
  const [ordinaryOutcomes, setOrdinaryOutcomes] = useState<Record<string, FundInvestigationOutcome>>({});
  const [closingOrdinary, setClosingOrdinary] = useState<I6Command | null>(null);
  // 恢复列表多于三条时默认只露前三条（和 I3、I4 一样），首屏留给词条表和课程列表。
  const [recoveryAll, setRecoveryAll] = useState(false);
  const courseConfirm = useRef<{ scope: string; request: ActionConfirmReq; versions?: LearningCourseVersionView[]; commandKey: () => string | undefined; finish: () => void } | null>(null);
  const recoveryConfirm = useRef<{ commandKey: () => string | undefined; finish: () => void } | null>(null);
  const reloadCourseApprovals = async () => {
    if (view !== "learn") return;
    const records = pendingHIRewardCommands().filter(record => record.scope.startsWith("I/"));
    const results = await Promise.allSettled(records.map(queryI6CourseProposal));
    const mine = results.flatMap(result => result.status === "fulfilled" && result.value?.status === "pending" ? [result.value] : []);
    try {
      const overview = canReadA2 ? await fetchA2Overview() : undefined;
      const rows = (overview?.operationQueue ?? []).filter(row => {
        return row.status === "pending" && !!row.operationCode && COURSE_APPROVAL_OPS.has(row.operationCode) && !!row.obj;
      });
      setCourseApprovals([...rows, ...mine.filter(ticket => !rows.some(row => row.id === ticket.id))]);
    } catch {
      setCourseApprovals("error");
    }
    const closedCommands = results.flatMap((result, index) => result.status === "fulfilled" && result.value && result.value.status !== "pending" ? [records[index].commandKey] : []);
    if (closedCommands.length) {
      readReady.current = false;
      const confirmation = recoveryConfirm.current;
      if (confirmation && closedCommands.includes(confirmation.commandKey() ?? "")) confirmation.finish();
      await actions.reloadIContent();
    }
    updateRecovery(value => value + 1);
  };
  useEffect(() => { void reloadCourseApprovals(); }, [view, canReadA2, content.i18nLearning]);
  const [catFlt, setCatFlt] = useState<CatFlt>("all");
  const [messageSearch, setMessageSearch] = useState("");
  const [msgScope, setMsgScope] = useState<MsgScope>("all");
  const [msgLang, setMsgLang] = useState<Lang | "">("");
  const [msgNs, setMsgNs] = useState("");
  const [msgPage, setMsgPage] = useState(1);
  const [msgPageSize, setMsgPageSize] = useState(20);
  const [selectedMessageKey, setSelectedMessageKey] = useState("");
  const [messageDrawer, setMessageDrawer] = useState(false);
  const [compareVersion, setCompareVersion] = useState("");
  const [copyEditor, setCopyEditor] = useState<CopyEditor | null>(null);
  const [messageVersions, setMessageVersions] = useState<I18nMessagePairView[]>([]);
  messagesRead.current = messageVersions;
  const [messageVersionsLoading, setMessageVersionsLoading] = useState(false);
  const [versionCourseId, setVersionCourseId] = useState("");
  const [courseTab, setCourseTab] = useState<"content" | "quiz" | "versions">("content");
  const [courseLang, setCourseLang] = useState<Lang>("en");
  const [requiredLanguages, setRequiredLanguages] = useState<readonly OperatingLanguageCode[]>(OPERATING_LANGUAGE_CODES);
  useEffect(() => { void getRequiredContentLanguages().then(setRequiredLanguages); }, []);
  const readRequiredLanguages = async () => {
    const required = await getRequiredContentLanguages();
    setRequiredLanguages(required);
    return required;
  };
  const [courseEditor, setCourseEditor] = useState<CourseEditorState | null>(null);
  const [courseVersions, setCourseVersions] = useState<LearningCourseVersionView[]>([]);
  versionsRead.current = courseVersions;
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsRetry, setVersionsRetry] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const courseTabIds = useTabIds();
  const data = content.i18nLearning;
  useEffect(() => { readReady.current = !!data && !contentLoading && !ctx.contentError; }, [data, contentLoading, ctx.contentError]);

  const newWriteProblem = (scope: string) => {
    const current = latest.current;
    if (conflictReview.blockedReason()) return conflictReview.blockedReason();
    if (!readReady.current || current.contentLoading || current.contentError || !current.content.i18nLearning) return "请先成功重新读取数据，再发起新的修改。";
    if (pendingI6Commands().some(record => record.scope === "unknown" || record.scope === scope)) return "此对象有结果未知的原操作，请先查询原结果。";
    const proposal = scope.startsWith("course:") ? pendingHIRewardCommands().find(record => record.payload.kind === "proposal"
      && record.payload.input.command.domain === "I" && record.payload.input.obj === scope.slice(7) && record.ticketStatus !== "pending") : undefined;
    if (proposal) return proposal.receiptKnown ? "这门课的申请已提交，审批状态还没查到；先点「查询原结果」。" : "此对象有结果未知的原操作，请先查询原结果。";
    return undefined;
  };
  const finishRecovery = async (commandKey?: string, finish?: () => void) => {
    readReady.current = false;
    if (finish) finish();
    else {
      const confirmation = recoveryConfirm.current;
      if (commandKey && confirmation?.commandKey() === commandKey) confirmation.finish();
    }
    await actions.reloadIContent();
    updateRecovery(value => value + 1);
  };
  /** The first request owns its original confirmation; a retry never re-enters the editable callback. */
  const confirmI6 = (scope: string, request: ActionConfirmReq, versions?: LearningCourseVersionView[]) => {
    const blocked = newWriteProblem(scope);
    if (blocked) { toast(blocked, "warn"); return; }
    const openedData = latest.current.content.i18nLearning;
    const openedCopyEditor = copyEditor, openedCourseEditor = courseEditor;
    const finish = () => {
      ctx.closeActionConfirm(confirmation);
      setCopyEditor(current => current === openedCopyEditor ? null : current);
      setCourseEditor(current => current === openedCourseEditor ? null : current);
      if (courseConfirm.current?.request === confirmation) courseConfirm.current = null;
    };
    let original: I6Command | undefined, proposal: HIRewardCommand | undefined, resolved = false;
    const carried = prefill.current?.scope === scope ? prefill.current : null;
    prefill.current = null;
    const confirmation: ActionConfirmReq = { ...request,
      initialReason: carried?.reason,
      edit: request.edit && carried?.value !== undefined ? { ...request.edit, initialValue: carried.value } : request.edit,
      getPendingReason: () => original ? pendingI6Commands().find(row => row.commandKey === original!.commandKey)?.reason
        : proposal ? pendingHIRewardCommands().find(row => row.commandKey === proposal!.commandKey)?.payload.input.reason : undefined,
      run: async (reason, value, form) => {
        if (resolved) { ctx.closeActionConfirm(confirmation); throw new Error("原操作已处理，请重新打开修改入口。"); }
        if (original || proposal) {
          try {
            if (original) { await retryI6Command(original); toast(`${original.label} · 已核对原操作`); }
            else {
              const ticket = await retryI6CourseProposal(proposal!);
              toast(ticketText(ticket));
            }
            resolved = true;
            await finishRecovery(undefined, finish);
          } catch (error) {
            const remains = original ? pendingI6Commands().some(row => row.commandKey === original!.commandKey)
              : pendingHIRewardCommands().some(row => row.commandKey === proposal!.commandKey);
            if (!remains) { resolved = true; await finishRecovery(undefined, finish); }
            throw error;
          } finally { updateRecovery(current => current + 1); }
          return;
        }
        const problem = newWriteProblem(scope);
        if (problem) throw new Error(problem);
        const currentData = latest.current.content.i18nLearning;
        const unchangedCourse = scope.startsWith("course:") && JSON.stringify(openedData?.courses.find(row => row.id === scope.slice(7)))
          === JSON.stringify(currentData?.courses.find(row => row.id === scope.slice(7)));
        if (versions && JSON.stringify(versions) !== JSON.stringify(versionsRead.current)) {
          ctx.closeActionConfirm();
          toast("这份草稿刚被别人改过，请重新打开再删。", "warn");
          return false;
        }
        if (openedData !== currentData && !unchangedCourse) {
          throw new Error("页面刚重新读取过，这次没有提交；关掉后重新打开核对。");
        }
        try {
          const result = await request.run(reason, value, form);
          if (result === false) return false;
          resolved = true;
          await finishRecovery(undefined, finish);
        } catch (error) {
          const key = (error as { commandKey?: string }).commandKey;
          original = key ? pendingI6Commands().find(row => row.commandKey === key) : undefined;
          proposal = key ? pendingHIRewardCommands().find(row => row.commandKey === key) : undefined;
          if (!original && !proposal && await conflictReview.reject(error, { scope, reason, value, form }, async () => {
            const overview = await fetchI6LearningOverview();
            const versions = scope.startsWith("course:") && overview.courses.some(course => course.id === scope.slice(7))
              ? await actions.fetchI7CourseVersions(scope.slice(7)) : undefined;
            const messages = scope.startsWith("message:") ? await actions.fetchI6MessageVersions(scope.slice(8)) : undefined;
            await actions.reloadIContent();
            return { overview, versions, messages };
          })) ctx.closeActionConfirm();
          // Match I1: the domain owns the first rejection and keeps its confirmation, including business 403.
          throw new Error(failText(error));
        } finally { updateRecovery(current => current + 1); }
      },
    };
    courseConfirm.current = { scope, request: confirmation, versions, commandKey: () => original?.commandKey ?? proposal?.commandKey, finish };
    recoveryConfirm.current = courseConfirm.current;
    openActionConfirm(confirmation);
  };
  useEffect(() => {
    setCourseVersions([]);
    setVersionsError(null);
    if (!versionCourseId) { setVersionsLoading(false); return; }
    let active = true;
    setVersionsLoading(true);
    actions.fetchI7CourseVersions(versionCourseId)
      .then((versions) => {
        if (!active) return;
        const confirmation = courseConfirm.current;
        if (confirmation?.scope === `course:${versionCourseId}` && confirmation.versions
          && JSON.stringify(confirmation.versions) !== JSON.stringify(versions)
          && !pendingI6Commands().some(record => record.scope === confirmation.scope)) {
          if (latest.current.activeActionConfirm === confirmation.request) {
            ctx.closeActionConfirm(confirmation.request);
            toast("这份草稿刚被别人改过，请重新打开再删。", "warn");
          }
          courseConfirm.current = null;
        }
        setCourseVersions(versions);
      })
      .catch((error) => {
        if (active) {
          setVersionsError(displayAdminError(error));
        }
      })
      .finally(() => { if (active) setVersionsLoading(false); });
    return () => { active = false; };
  }, [actions, versionCourseId, content.i18nLearning, versionsRetry]);
  const I6_STATS = data?.stats ?? { managedKeys: 0, totalKeys: 0, integrityIssues: 0, coursesOnline: 0, weeklyNexPayout: "—" };
  const NAMESPACES: Namespace[] = data?.namespaces ?? [];
  const MESSAGES = data?.messages ?? [];
  const INTEGRITY_ISSUES: IntegrityIssue[] = data?.integrityIssues ?? [];
  const HARDCODED_FINDINGS: HardcodedFinding[] = data?.hardcodedFindings ?? [];
  const COURSES: Course[] = (data?.courses ?? []).map((c) => ({
    id: c.id,
    title: c.titleZh || c.title,
    cat: c.category,
    format: c.format,
    level: c.level,
    reward: c.rewardNex === null ? Number.NaN : Number(c.rewardNex),
    rewardRaw: c.rewardNex,
    featured: c.featured,
    duration: c.duration,
    v: c.version,
    status: c.status,
    body: c.body,
    titleZh: c.titleZh || c.title,
    titleEn: c.titleEn || "",
    titleVi: c.titleVi || "",
    bodyZh: c.bodyZh || c.body,
    bodyEn: c.bodyEn || "",
    bodyVi: c.bodyVi || "",
    titleTranslations: c.titleTranslations, bodyTranslations: c.bodyTranslations,
    quizQuestions: c.quizQuestions.map(question => ({ ...question, questionVi: question.questionVi ?? undefined, optionsVi: question.optionsVi ?? undefined })),
    passScore: c.passScore ?? undefined,
    retryLimit: c.retryLimit ?? undefined,
    completionCondition: c.completionCondition ?? undefined,
    rewardEvent: c.rewardEvent ?? undefined,
    revision: c.revision,
  }));
  const TUTORIAL_REWARD_RANGE = data?.rewardRange ?? { min: 0, max: 0 };
  const TUTORIAL_FEATURED_DEFAULT = data?.featuredCourseId ?? "";
  const featuredCourse = COURSES.find((course) => course.id === TUTORIAL_FEATURED_DEFAULT);
  const TUTORIAL_METRICS = (data?.metrics ?? []).map((m) => ({ k: m.key, v: m.value }));
  const runBackend = <T,>(task: Promise<T>, ok: string | ((result: T) => string)) => {
    // 失败时确认框还开着，错误写在框里，不再弹一遍。
    return task.then(async (result) => {
      toast(typeof ok === "string" ? ok : ok(result));
    });
  };

  const allCourses = COURSES;
  const configuredCategories = (data?.categories ?? []).map((category) => category.trim()).filter(Boolean);
  const courseCategories = configuredCategories.length > 0
    ? configuredCategories
    : [...new Set(allCourses.map((course) => course.cat).filter(Boolean))];
  const liveStatus = (c: Course): string =>
    c.status;
  const liveFeatured = (): string =>
    TUTORIAL_FEATURED_DEFAULT;
  const selectedMessage = MESSAGES.find((message) => message.messageKey === selectedMessageKey) ?? MESSAGES[0];
  const { missingLocales, messageVariables, variablesMatch, qualityIssues, publicationIssues } = messagePublication(selectedMessage);
  useEffect(() => {
    const messageKey = selectedMessage?.messageKey;
    if (view !== "i18n" || !messageKey) {
      setMessageVersions([]);
      setMessageVersionsLoading(false);
      return;
    }
    let active = true;
    setMessageVersionsLoading(true);
    actions.fetchI6MessageVersions(messageKey)
      .then((versions) => { if (active) setMessageVersions(versions); })
      .catch((error) => {
        if (active) {
          setMessageVersions([]);
          toast(`词条版本加载失败:${displayAdminError(error)}`);
        }
      })
      .finally(() => { if (active) setMessageVersionsLoading(false); });
    return () => { active = false; };
  }, [actions, toast, selectedMessage?.messageKey, content.i18nLearning, view]);
  const statusLabel = (status?: string) => ({ draft: "草稿", published: "已发布", archived: "已归档" }[status ?? ""] ?? "状态未知");

  /* ============ I6 actions ============ */
  const liveIntegrity = Math.max(0, I6_STATS.integrityIssues);
  const rescan = () => {
    const blocked = newWriteProblem("rescan");
    if (blocked) { toast(blocked, "warn"); return; }
    let original: I6Command | undefined, resolved = false, remark = "";
    const confirmation: ConfirmReq = { briefKind: "record",
      freezePendingInput: true, replayPendingInput: true,
      getPendingReason: () => original && pendingI6Commands().some(row => row.commandKey === original!.commandKey) ? remark : undefined,
      action: <>全量重扫 {I6_STATS.managedKeys} 词条</>,
      title: "重新检查全部文案",
      detail: <>按 6 类重新检查全部已登记文案：缺中文、缺英语、缺越南语、变量不一致、占位文字、旧品牌名。不改文案，结果覆盖下面的问题报告。</>,
      effect: <StatusTag tone="neutral" filled>不改文案</StatusTag>,
      statedBrief: { impact: "重新算一遍问题报告，文案和 App 都不变。", check: "检查完看问题报告，有问题的逐条修。" },
      remarkHint: "选填，不会保存",
      okLabel: "开始检查",
      run: async (reason) => {
        remark = reason;
        if (resolved) { ctx.closeConfirm(confirmation); return false; }
        try {
          if (original) await runBackend(retryI6Command(original), "检查完成，请看下表的问题");
          else {
            const problem = newWriteProblem("rescan");
            if (problem) throw new Error(problem);
            await runBackend(actions.rescanI6("全量重扫词条完整性"), "检查完成，请看下表的问题");
          }
          resolved = true;
          await finishRecovery(undefined, () => ctx.closeConfirm(confirmation));
        } catch (error) {
          if (original && !pendingI6Commands().some(row => row.commandKey === original!.commandKey)) { resolved = true; await finishRecovery(undefined, () => ctx.closeConfirm(confirmation)); }
          else original = pendingI6Commands().find(row => row.scope === "rescan");
          throw new Error(failText(error));
        } finally { updateRecovery(value => value + 1); }
      },
    };
    recoveryConfirm.current = { commandKey: () => original?.commandKey, finish: () => ctx.closeConfirm(confirmation) };
    openConfirm(confirmation);
  };

  const editKeyDraft = (form: Pick<CopyEditor, "zh" | "en" | "vi">) => selectedMessage &&
    confirmI6(`message:${selectedMessage.messageKey}`, { briefKind: "config",
      action: <>编辑词条草稿 · {selectedMessage.messageKey}</>,
      title: "保存三语草稿",
      detail: (
        <>
          中文、越南语、英语三份一起存成新草稿；已发布的内容不变，发布后用户才看到。
        </>
      ),
      effect: <StatusTag tone="neutral" filled>只存草稿</StatusTag>,
      statedBrief: { impact: "存成草稿，App 里还是现在发布的文字。", check: "三种语言意思一致，变量原样保留。" },
      confirmLabel: "保存草稿",
      facts: <div className="rd-stack">
        <Facts><Fact k="文案键">{selectedMessage.messageKey}</Fact><Fact k="基于">{selectedMessage.version} · {statusLabel(selectedMessage.status)}</Fact></Facts>
        <CompareRows beforeLabel={`现在 ${selectedMessage.version}`} afterLabel="保存后的草稿"
          rows={LANGS.map((item) => ({ key: item.key, label: item.label, before: langValue(selectedMessage, item.key), after: mapSingleContentText(form, requiredLanguages, "submit")[item.key] }))} />
      </div>,
      amplifies: false,
      run: async (reason) => {
        const messageKey = selectedMessage.messageKey;
        setSelectedMessageKey(messageKey);
        return runBackend(actions.saveI6LocalizedDraft(messageKey, {
          ...await submittedMessageText(selectedMessage.placeholders, form),
          expectedVersion: selectedMessage.version,
        }, reason), `${messageKey} 草稿已保存 · 当前发布版未被覆盖`).then(() => setCopyEditor(null));
      },
    });

  const pubKey = (message = selectedMessage) => {
    const { missingLocales, hasEnglish, messageVariables, variablesMatch, qualityIssues, publicationIssues } = messagePublication(message);
    confirmI6(`message:${message?.messageKey ?? ""}`, { briefKind: "content",
      action: <>发布词条 · {message?.messageKey ?? "未选择"} {message?.version ?? ""}</>,
      title: "发布文案",
      detail: (
        <>
          发布前检查：<b>中越英三语{missingLocales.length === 0 ? "完整" : `待补齐（${missingLocales.join("、")}）`}</b>；
          <b>变量{!hasEnglish ? "尚未检查（请先补齐必填语言）" : variablesMatch ? `一致（${messageVariables[0] || "无变量"}）` : "不一致"}</b>；
          <b>占位文字与旧品牌{qualityIssues.length === 0 ? "检查通过" : `检查未通过：${qualityIssues.join("、")}`}</b>。
          系统提交时仍会核对发布条件。
        </>
      ),
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: { impact: "App 下次成功拉取文案后换成这一版，切回前台会重新拉取。", check: "三种语言都读一遍，变量和占位一致。" },
      confirmLabel: "发布",
      facts: message && <Facts>
        <Fact k="文案键">{message.messageKey}</Fact>
        <Fact k="发布版本">{message.version}</Fact>
        <Fact k="三种语言">{missingLocales.length === 0 ? "齐了" : `缺${missingLocales.join("、")}`}</Fact>
        <Fact k="变量">{messageVariables[0] || "无"}</Fact>
      </Facts>,
      amplifies: false,
      run: (reason) => {
        if (!message || message.status !== "draft" || publicationIssues.length > 0) return false;
        return runBackend(actions.publishI6LocalizedMessage(message.messageKey, {
          zh: message.zh,
          en: message.en,
          vi: message.vi,
          expectedVersion: message.version,
        }, reason), `${message.messageKey} ${message.version} 已发布`);
      },
    });

  };

  const archiveKey = (message = selectedMessage) => message && confirmI6(`message:${message.messageKey}`, { briefKind: "record",
    action: <>归档词条 · {message.messageKey}</>,
    title: "归档文案",
    detail: <>撤下这条远程文案；App 拉到新文案包后改用安装包里自带的文字（有的话）。历史版本保留，能回滚。</>,
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    statedBrief: { impact: "App 不再拿到这条远程文案，屏幕上的字不一定消失。", check: "确认这条文字不再需要后台管理。" },
    confirmLabel: "归档",
    confirmTone: "danger",
    facts: <Facts><Fact k="文案键">{message.messageKey}</Fact><Fact k="现在">{message.version} · 已发布</Fact></Facts>,
    amplifies: false,
    run: (reason) => runBackend(actions.archiveI6LocalizedMessage(
      message.messageKey,
      message.version,
      reason,
    ), `${message.messageKey} 已归档`),
  });

  const rollbackMessageVersion = (target: I18nMessagePairView, message = selectedMessage) =>
    message && confirmI6(`message:${message.messageKey}`, { briefKind: "content",
      action: <>回滚词条 · {message.messageKey} → {target.version}</>,
      title: `回滚到 ${target.version}`,
      detail: <>
        把这个旧版本的三语内容复制成一个新版本发布，旧记录不会被改动。
        当前版本 <b>{message.version}</b>，回滚到 <b>{target.version}</b>。
      </>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: { impact: `复制 ${target.version} 的三语发布成新版本，App 下次拉取文案时换成它；原来的版本和历史都保留。`, check: "逐语言看新旧对比。" },
      confirmLabel: "回滚",
      facts: <div className="rd-stack">
        <Facts><Fact k="文案键">{message.messageKey}</Fact><Fact k="版本"><Change from={`${message.version}（现在）`} to={`新版本（复制 ${target.version}）`} /></Fact></Facts>
        <CompareRows beforeLabel={`现在 ${message.version}`} afterLabel={`回滚后（${target.version} 的内容）`}
          rows={LANGS.map((item) => ({ key: item.key, label: item.label, before: langValue(message, item.key), after: langValue(target, item.key) }))} />
      </div>,
      amplifies: false,
      run: (reason) => runBackend(actions.rollbackI6LocalizedMessage(
        message.messageKey,
        target.version,
        message.version,
        reason,
      ), `${message.messageKey} 已从 ${target.version} 恢复为新发布版本`),
    });

  const fixIntegrity = (issue: IntegrityIssue, form: Pick<CopyEditor, "zh" | "en" | "vi">) =>
    confirmI6(`message:${selectedMessage?.messageKey ?? ""}`, { briefKind: "config",
      action: <>修复完整性问题 · {issue.kind}</>,
      title: "修复并存成草稿",
      detail: (
        <>
          把这条文案的三语存成新草稿，并重新计算「{issueName(issue)}」的问题数。不会自动发布，发布还要在文案上单独点。
        </>
      ),
      effect: <StatusTag tone="neutral" filled>只存草稿</StatusTag>,
      statedBrief: { impact: "存成草稿并重算这类问题，App 里的文字不变。", check: "核对修的是哪一条文案。" },
      confirmLabel: "保存修复",
      facts: selectedMessage && <div className="rd-stack">
        <Facts><Fact k="问题">{issueName(issue)} · {count(issue.cnt)} 处</Fact><Fact k="修哪一条">{selectedMessage.messageKey}</Fact></Facts>
        <CompareRows beforeLabel={`现在 ${selectedMessage.version}`} afterLabel="修复后的草稿"
          rows={LANGS.map((item) => ({ key: item.key, label: item.label, before: langValue(selectedMessage, item.key), after: mapSingleContentText(form, requiredLanguages, "submit")[item.key] }))} />
      </div>,
      amplifies: false,
      run: async (reason) => {
        if (!selectedMessage || !issue.samples.includes(selectedMessage.messageKey)) return false;
        const messageKey = selectedMessage.messageKey;
        return runBackend(actions.fixI6Integrity(issue.code, {
          messageKey, ...await submittedMessageText(selectedMessage.placeholders, form),
        }, reason), (result) => {
          const repairedCount = result.repairedCount
            ?? Number(issue.samples.includes(messageKey) && !result.samples.includes(messageKey));
          return `${issueName(issue)} ${repairedCount} 处已修复 · 重新检查后确认`;
        }).then(() => setCopyEditor(null));
      },
    });

  /* ============ tutorial actions ============ */
  const activateCourse = async (c: Course, kind: "first_publish" | "version_publish" | "version_rollback", reason: string, target: LearningCourseVersionView | LearningCourseView) => {
    const scope = hiCourseScope(c.id);
    if (pendingHIRewardCommand(scope)) throw new Error("此对象有原操作尚未核清，请先查询原结果。");
    const versions = await actions.fetchI7CourseVersions(c.id);
    const currentTarget = kind === "first_publish" ? versions.find(v => v.status === "DRAFT")
      : versions.find(v => v.version === target.version);
    const independent = "payload" in target;
    if (independent ? !currentTarget || currentTarget.version !== target.version || currentTarget.revision !== target.revision
      || currentTarget.status !== target.status || JSON.stringify(currentTarget.payload) !== JSON.stringify(target.payload)
      : kind !== "first_publish" || !!currentTarget)
      throw new Error(`${target.version} 刚变了或读不到，这次没有提交；关掉后重新打开核对。`);
    const current = (await fetchI6LearningOverview()).courses.find(course => course.id === c.id);
    if (!current || current.version !== c.v || current.revision !== c.revision || current.status !== c.status
      || !independent && JSON.stringify(current) !== JSON.stringify(target))
      throw new Error("这门课刚被改过，这次没有提交；关掉后重新打开核对。");
    const rawReward = independent ? target.payload.rewardNex : target.rewardNex;
    if (rawReward !== null && i6Amount(rawReward) === undefined)
      throw new Error("目标版本奖励读不到，本次未提交；请重新读取课程版本后核对。");
    const snapshot = { course: current, courseVersion: independent ? target : undefined };
    if (Number(rawReward) > 0) {
      const session = useAdminAuth.getState().session;
      if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
      const values = { courseId: c.id, version: target.version, expectedRevision: independent ? target.revision : null,
        expectedCurrentVersion: c.v, expectedCurrentRevision: c.revision, expectedCurrentStatus: c.status };
      await submitHIRewardCommand(scope, { kind: "proposal", input: hiRewardProposal(session, `i7_course_${kind}`, values,
        `${c.v} · ${c.status} · ${c.rewardRaw === null ? "—" : `${c.rewardRaw} UVT`}`, `${values.version} · published · ${rawReward} UVT`, reason) }, undefined, undefined, snapshot);
      await reloadCourseApprovals();
      toast("已提交，等待审批后执行");
      return;
    }
    if (kind === "first_publish") return runBackend(backendActions.publishI6Course(c.id, reason, snapshot), `${nexGridBrandText(c.title)} 已发布至 /learn`);
    if (kind === "version_publish") return runBackend(backendActions.publishI7CourseVersion(c.id, target.version, reason, snapshot), `${target.version} 已发布`);
    return runBackend(backendActions.rollbackI7CourseVersion(c.id, target.version, reason, snapshot), `已回滚到 ${target.version}`);
  };

  const courseCommandBlocks = (c: Course, op: string, version?: string) => {
    const pending = pendingHIRewardCommand(hiCourseScope(c.id));
    if (!pending) return false;
    const original = pending.payload;
    const label = original.kind === "proposal" ? `${original.input.action} · ${String(original.input.command.params.version)}` : original.tierName;
    toast(`原操作「${label}」结果未知，先在上方核对原操作再提交新的。`, "warn");
    return true;
  };

  /** 有奖励（> 0）走审批，没有奖励直接执行：标签和谁来批按目标版本的奖励写。 */
  const activationEffect = (reward: number) => reward > 0
    ? <StatusTag tone="progress" filled explain={`${APPROVER}在「操作记录与审批」批准后才执行；批准前课程、进度和发奖都不变。`}>批准后生效</StatusTag>
    : <StatusTag tone="progress" filled>立即生效</StatusTag>;
  const approverFact = (reward: number) => reward > 0
    ? <Fact k="谁来批">{APPROVER}（需有审批批准权限）</Fact> : null;
  const courseChange = (c: Course, target: { version: string; reward: unknown; title?: string; quiz?: number; pass?: unknown }) => <Facts>
    <Fact k="课程">{nexGridBrandText(target.title ?? c.title)}</Fact>
    <Fact k="版本"><Change from={liveStatus(c) === "published" ? `${c.v}（线上）` : `${c.v}（${COURSE_STATUS[liveStatus(c)]?.text ?? "草稿"}）`} to={`${target.version}（线上）`} /></Fact>
    <Fact k="学完发">{liveStatus(c) === "published" && rewardPerUser(c.rewardRaw) !== rewardPerUser(target.reward)
      ? <Change from={rewardPerUser(c.rewardRaw)} to={rewardPerUser(target.reward)} /> : rewardPerUser(target.reward)}</Fact>
    {liveStatus(c) !== "published" && rewardPerUser(c.rewardRaw) !== rewardPerUser(target.reward)
      && <Fact k="课程卡上现在" tone="warn">{`${rewardPerUser(c.rewardRaw)}，发布后换成 ${target.version} 的数`}</Fact>}
    {target.quiz !== undefined && <Fact k="测验">{target.quiz} 题 · {String(target.pass ?? "—")} 分及格</Fact>}
    {approverFact(Number(target.reward))}
  </Facts>;

  const pubCrs = async (c: Course) => {
    if (courseCommandBlocks(c, "i7_course_first_publish")) return;
    let target: LearningCourseVersionView | LearningCourseView | undefined;
    try { target = (await actions.fetchI7CourseVersions(c.id)).find(row => row.status === "DRAFT")
      ?? latest.current.content.i18nLearning?.courses.find(row => row.id === c.id); }
    catch (error) { toast(displayAdminError(error), "warn"); return; }
    if (!target) { toast("这门课没读到，请刷新后再核对。", "warn"); return; }
    const rawReward = "payload" in target ? target.payload.rewardNex : target.rewardNex;
    if (rawReward !== null && i6Amount(rawReward) === undefined) { toast("目标版本奖励读不到，本次未提交；请重新读取课程版本后核对。", "warn"); return; }
    const reward = Number(rawReward);
    confirmI6(`course:${c.id}`, { briefKind: "content",
      action: <>发布课程新版 · {nexGridBrandText(c.title)}</>,
      title: reward > 0 ? "提交审批：发布课程" : "发布课程",
      detail: (
        <>
          分类「{categoryLabel("payload" in target ? target.payload.category as string : target.category)}」 · 奖励 {rewardPerUser(rawReward)}。发布后 App 学习课程里能看到并学这门课。
        </>
      ),
      effect: activationEffect(reward),
      confirmLabel: reward > 0 ? "提交审批" : "发布",
      statedBrief: { impact: reward > 0 ? `批准后课程上线，学完并通过测验的用户每人领 ${uvtText(rawReward)} UVT；批准前用户看不到。` : "发布后用户能看到并学这门课。", check: "三种语言的标题、正文、测验都齐，奖励数核对过。" },
      facts: courseChange(c, "payload" in target ? versionTarget(target) : { version: target.version, reward: target.rewardNex, title: target.title, quiz: target.quizQuestions.length, pass: target.passScore }),
      amplifies: reward > 0,
      coverageLead: "这门课学完会发 UVT",
      coverageCheck: "提交和批准时都检查兑付覆盖率。",
      getPendingReason: () => pendingHIRewardCommand(hiCourseScope(c.id))?.payload.input.reason,
      run: (reason) => activateCourse(c, "first_publish", reason, target),
    });
  };

  // 课程奖励调整沿用原专用审批。
  const adjRwd = (c: Course) => {
    if (rewardApprovalBlocked) { toast(rewardApprovalBlocked, "warn"); return; }
    if (pendingHIRewardCommand(hiCourseRewardScope(c.id))) { toast("此对象有原操作尚未核清，请先查询原结果。", "warn"); return; }
    confirmI6(`course:${c.id}`, { briefKind: "config",
      action: <>课程奖励调整 · {nexGridBrandText(c.title)}</>,
      title: "提交审批：调整课程奖励",
      detail: (
        <>
          分类「{categoryLabel(c.cat)}」完成 UVT 奖励调整。调高会多发 UVT，批准时覆盖率低于红线会被拒。
        </>
      ),
      effect: <StatusTag tone="progress" filled explain={`${APPROVER}在「操作记录与审批」批准后才改；批准前发奖按现在的数。`}>批准后生效</StatusTag>,
      confirmLabel: "提交审批",
      statedBrief: { impact: "批准后，还没发到账的奖励都按新数发；已经发出的不补也不扣。", check: "核对新数在范围内，理由写清为什么调。" },
      edit: { kind: "number", current: c.rewardRaw ?? "", unit: "UVT/人", min: TUTORIAL_REWARD_RANGE.min, max: TUTORIAL_REWARD_RANGE.max, maxDecimals: I6_COURSE_REWARD_DECIMALS,
        amplifiesWhen: (value) => (i6RewardChange(value, c.rewardRaw)?.direction ?? 0) > 0,
        hint: `${TUTORIAL_REWARD_RANGE.min}–${TUTORIAL_REWARD_RANGE.max} UVT/人`,
        preview: (value: string) => {
          const change = i6RewardChange(value, c.rewardRaw);
          return change?.direction ? `批准后每位学完的用户领 ${uvtText(value)} UVT，${change.direction > 0 ? "比现在多" : "比现在少"} ${uvtText(change.amount)} UVT。` : undefined;
        } },
      facts: <Facts>
        <Fact k="课程">{nexGridBrandText(c.title)} · {c.v}</Fact>
        {c.rewardRaw === null && <Fact k="现在">{NO_REWARD}</Fact>}
        <Fact k="按新数发">批准后还没发到账的，包括已学完、奖励还没发的</Fact>
        <Fact k="已经发出的">不补差、不扣回</Fact>
        <Fact k="谁来批">{APPROVER}（需有审批批准和课程调奖权限）</Fact>
      </Facts>,
      amplifies: false,
      coverageLead: "调高后每位学完的用户多领 UVT",
      coverageCheck: "提交时不查覆盖率；调高的申请在批准执行时检查。",
      run: async (reason, v) => {
        if (!v?.trim() || i6Amount(v) === undefined) return false;
        const current = (await fetchI6LearningOverview()).courses.find(course => course.id === c.id);
        if (!current || current.version !== c.v || current.revision !== c.revision || current.status !== c.status || current.rewardNex !== c.rewardRaw)
          throw new Error("这门课刚被改过，这次没有提交；关掉后重新打开核对。");
        const def = findHighOp("i7_course_reward_adjust")!;
        const session = useAdminAuth.getState().session;
        if (!session) throw new Error("请先登录后再提交。");
        const beforeValue = c.rewardRaw === null ? "—" : `${c.rewardRaw} UVT/课`;
        const input = hiRewardProposal(session, "i7_course_reward_adjust", { courseId: c.id, rewardNex: i6Amount(v) }, beforeValue, `${v} UVT/课`, reason);
        return submitHIRewardCommand(hiCourseRewardScope(c.id), { kind: "proposal", input: {
          ...input,
          action: `课程奖励调整 · ${nexGridBrandText(c.title)}`,
          obj: c.id,
          beforeValue,
          afterValue: `${v} UVT/课`,
          type: "fund",
          amplifies: (i6RewardChange(v, c.rewardRaw)?.direction ?? 0) > 0,
          roleGate: def.gateLabel,
          reason,
          sourceDomain: "I7",
          command: def.buildCommand({ courseId: c.id, rewardNex: i6Amount(v) }),
          target: def.buildTarget({ courseId: c.id }),
        } }, undefined, v, { course: current }).then(() => toast("已提交，等待审批后执行"));
      },
    });
  };

  const archiveProblem = (c: Course) => c.featured || liveFeatured() === c.id ? "这门是首页推荐课，不能下架，先换推荐课。" : undefined;
  const archiveCrs = (c: Course) => {
    const blocked = archiveProblem(c);
    if (blocked) { toast(blocked, "warn"); return; }
    confirmI6(`course:${c.id}`, { briefKind: "content",
      action: <>下架课程 · {nexGridBrandText(c.title)}</>,
      title: "下架课程",
      detail: (
        <>
          下架后 App 学习课程里不再显示这门课；用户已有的学习进度和已发的奖励保留，之后不能再学完领奖。
        </>
      ),
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: { impact: "App 里不再显示这门课，已打开课程的用户提交时会提示找不到课。", check: "只有内容或合规问题才下架；常规改版发新版本。" },
      confirmLabel: "下架",
      confirmTone: "danger",
      facts: <div className="rd-stack">
        <Facts><Fact k="课程">{nexGridBrandText(c.title)} · {c.v}</Fact><Fact k="状态"><Change from="在线" to="已下架" /></Fact></Facts>
        {liveFeatured() === c.id && <Notice tone="warn">这门是首页推荐课，不能下架，先换推荐课。</Notice>}
      </div>,
      amplifies: false,
      run: (reason) => {
        const current = latest.current.content.i18nLearning?.courses.find(course => course.id === c.id);
        if (current?.featured || latest.current.content.i18nLearning?.featuredCourseId === c.id) throw new Error("这门是首页推荐课，不能下架，先换推荐课。");
        return runBackend(actions.archiveI6Course(c.id, reason), `${nexGridBrandText(c.title)} 已下架`);
      },
    });
  };

  const coursePayload = (form?: Record<string, string>, expectedRevision?: number) => {
    const quizCount = Number(form?.quizCount || 0);
    const quizQuestions = Array.from({ length: quizCount }, (_, questionIndex) => {
      const optionCount = Number(form?.[`quiz.${questionIndex}.optionCount`] || 0);
      return {
        questionId: form?.[`quiz.${questionIndex}.id`] || `q${questionIndex + 1}`,
        questionZh: form?.[`quiz.${questionIndex}.questionZh`] || "",
        questionEn: form?.[`quiz.${questionIndex}.questionEn`] || "",
        optionsZh: Array.from({ length: optionCount }, (_, optionIndex) => form?.[`quiz.${questionIndex}.option.${optionIndex}.zh`] || ""),
        optionsEn: Array.from({ length: optionCount }, (_, optionIndex) => form?.[`quiz.${questionIndex}.option.${optionIndex}.en`] || ""),
        questionVi: form?.[`quiz.${questionIndex}.questionVi`] || "",
        optionsVi: Array.from({ length: optionCount }, (_, optionIndex) => form?.[`quiz.${questionIndex}.option.${optionIndex}.vi`] || ""),
        correctOptionIndex: Number(form?.[`quiz.${questionIndex}.correctOptionIndex`] || 0),
      };
    });
    return {
      titleZh: form?.titleZh || "",
      titleEn: form?.titleEn || "",
      titleVi: form?.titleVi || "",
      bodyZh: form?.bodyZh || "",
      bodyEn: form?.bodyEn || "",
      bodyVi: form?.bodyVi || "",
      category: form?.category || courseCategories[0] || "Basics",
      format: form?.format || data?.formats?.[0] || "Article",
      difficulty: form?.difficulty || data?.levels?.[0] || "Beginner",
      rewardNex: form?.reward?.trim() ? i6Amount(form.reward) : null,
      duration: form?.duration || "5 min",
      publishState: "draft",
      quizQuestions,
      passScore: Number(form?.passScore),
      retryLimit: Number(form?.retries),
      completionCondition: form?.completionCond ?? "",
      rewardEvent: form?.rewardEvent ?? "",
      expectedRevision,
      version: form?.version || undefined,
    };
  };

  /** 课程草稿的确认框：编辑在抽屉里填完，这里只填理由。 */
  const submittedCourse = async (spec: CourseSpec, form: CourseForm, expectedRevision?: number) => {
    const required = await readRequiredLanguages();
    const completed = mapCourseLanguages(form, required, "submit");
    const missing = courseFormMissing(spec, completed);
    if (missing.length) throw new Error(blockedText(missing));
    const payload = coursePayload(completed, expectedRevision);
    if (spec.mode === "create") return { ...payload, completionCondition: undefined, rewardEvent: undefined };
    return payload;
  };
  const courseDraftFacts = (form: CourseForm, extra?: ReactNode) => <Facts>
    <Fact k="课程">{nexGridBrandText(form.titleZh || form.titleEn || "—")}</Fact>
    {extra}
    {form.reward?.trim() ? <Fact k="学完发" lead unit="UVT/人">{uvtText(form.reward)}</Fact> : <Fact k="学完发" lead>{NO_REWARD}</Fact>}
    <Fact k="测验">{form.quizCount} 题 · {form.passScore} 分及格 · 可重试 {form.retries} 次</Fact>
  </Facts>;
  const draftEffect = <StatusTag tone="neutral" filled>只存草稿</StatusTag>;
  const courseSpec = (mode: CourseSpec["mode"], current?: CourseSpec["current"]): CourseSpec => ({
    mode, rewardMin: TUTORIAL_REWARD_RANGE.min, rewardMax: TUTORIAL_REWARD_RANGE.max, categories: courseCategories, formats: data?.formats, levels: data?.levels, current,
  });

  const newCrs = async () => {
    await readRequiredLanguages();
    const spec = courseSpec("create");
    setCourseEditor({ spec, title: "新建课程", sub: "存成草稿，用户看不到",
      save: (form) => confirmI6(`course:${form.slug.trim()}`, { briefKind: "config",
        action: <>新建课程(存为草稿)</>,
        title: "保存新课程草稿",
        detail: (
          <>
            课程标识、分类、形式、难度、奖励（{TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} UVT）和三语标题、正文、测验一起存成草稿；草稿用户看不到，发布另外操作。
          </>
        ),
        effect: draftEffect,
        confirmLabel: "保存草稿",
        statedBrief: { impact: "存成 v1 草稿，用户看不到；发布另外操作。", check: "课程标识建好后不能改。" },
        facts: courseDraftFacts(form, <Fact k="课程标识">{form.slug}</Fact>),
        amplifies: false,
        run: async (reason) => {
          const id = form.slug?.trim() || "new";
          return runBackend(actions.createI6Course(id, await submittedCourse(spec, form), reason), "课程草稿已创建").then(() => setCourseEditor(null));
        },
      }),
    });
  };

  const editCrsState = (c: Course): CourseEditorState => ({ courseId: c.id, spec: courseSpec("edit", {
    slug: c.id, category: c.cat, format: c.format, difficulty: c.level, duration: c.duration, reward: c.rewardRaw,
    titleZh: c.titleZh, titleEn: c.titleEn, titleVi: c.titleVi, bodyZh: c.bodyZh, bodyEn: c.bodyEn, bodyVi: c.bodyVi,
    quizQuestions: c.quizQuestions, passScore: c.passScore, retryLimit: c.retryLimit,
    completionCondition: c.completionCondition, rewardEvent: c.rewardEvent,
  }), title: "编辑课程草稿", sub: `${c.id} · ${c.v}`,
  save: (form) => confirmI6(`course:${c.id}`, { briefKind: "config",
    action: <>编辑课程草稿 · {nexGridBrandText(c.title)}</>,
    title: "保存课程草稿",
    detail: <>只有草稿可以编辑；别人刚改过时，会先让你核对再保存。</>,
    effect: draftEffect,
    confirmLabel: "保存草稿",
    statedBrief: { impact: "更新这门课的草稿，用户看不到。", check: "三种语言和测验核对过。" },
    facts: courseDraftFacts(form, <Fact k="版本">{c.v}</Fact>),
    amplifies: false,
    run: async (reason) => runBackend(actions.updateI7CourseDraft(c.id, await submittedCourse(courseSpec("edit"), form, c.revision), reason), `${nexGridBrandText(c.title)} 草稿已更新`).then(() => setCourseEditor(null)),
  }) });
  const editCrs = async (c: Course) => { await readRequiredLanguages(); setCourseEditor(editCrsState(c)); };

  const deleteCrs = (c: Course) => confirmI6(`course:${c.id}`, { briefKind: "record",
    action: <>删除课程草稿 · {nexGridBrandText(c.title)}</>,
    title: "删除课程草稿",
    detail: <>只能删还没发布的草稿，已发布或已下架的课不能删。</>,
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>删了找不回</IrreversibleTag></>,
    statedBrief: { impact: "删掉这门课和它的草稿内容。", check: "确认这门课不再需要。" },
    confirmLabel: "删除草稿",
    confirmTone: "danger",
    facts: <Facts><Fact k="课程">{nexGridBrandText(c.title)}</Fact><Fact k="课程标识">{c.id}</Fact></Facts>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI7CourseDraft(c.id, reason), `${nexGridBrandText(c.title)} 草稿已删除`),
  });

  const courseCurrent = (c: Course, version: string, payload?: Record<string, unknown>) => ({
    slug: c.id,
    version,
    category: String(payload?.category ?? c.cat),
    format: String(payload?.format ?? c.format),
    difficulty: String(payload?.difficulty ?? c.level),
    duration: String(payload?.duration ?? c.duration),
    reward: payload ? i6Amount(payload.rewardNex) ?? null : c.rewardRaw,
    titleZh: String(payload?.titleZh ?? c.titleZh), titleEn: String(payload?.titleEn ?? c.titleEn), titleVi: String(payload?.titleVi ?? c.titleVi),
    bodyZh: String(payload?.bodyZh ?? c.bodyZh), bodyEn: String(payload?.bodyEn ?? c.bodyEn), bodyVi: String(payload?.bodyVi ?? c.bodyVi),
    quizQuestions: (Array.isArray(payload?.quizQuestions) ? payload.quizQuestions : c.quizQuestions) as Course["quizQuestions"],
    passScore: Number(payload?.passScore ?? c.passScore ?? 60), retryLimit: Number(payload?.retryLimit ?? c.retryLimit ?? 3),
    completionCondition: String((payload ? payload.completionCondition : c.completionCondition) ?? ""),
    rewardEvent: String((payload ? payload.rewardEvent : c.rewardEvent) ?? ""),
  });

  const newCourseVersion = async (c: Course) => {
    let nextVersion: string | undefined;
    try { nextVersion = await actions.fetchI7NextCourseVersion(c.id); }
    catch (error) { toast(displayAdminError(error), "error"); return; }
    const maxVersion = Math.max(Number(c.v.replace(/^v/i, "")) || 0,
      ...courseVersions.map((row) => Number(row.version.replace(/^v/i, "")) || 0));
    await readRequiredLanguages();
    setCourseEditor({ courseId: c.id, spec: courseSpec("version-create", courseCurrent(c, nextVersion ?? `v${maxVersion + 1}`)), title: "新版本草稿", sub: `${nexGridBrandText(c.title)} · 线上 ${c.v} 照常服务`,
      save: (form) => confirmI6(`course:${c.id}`, { briefKind: "config",
        action: <>新建课程版本草稿 · {nexGridBrandText(c.title)}</>,
        title: "保存新版本草稿",
        detail: <>当前发布版继续服务用户；新版本在独立草稿中编辑，发布后才整体替换当前版。</>,
        effect: draftEffect,
        confirmLabel: "保存草稿",
        statedBrief: { impact: `存成 ${form.version} 草稿；线上 ${c.v} 和用户进度都不变。`, check: "一门课同时只能有一个版本草稿。" },
        facts: courseDraftFacts(form, <Fact k="版本"><Change from={`${c.v}（线上）`} to={`${form.version}（草稿）`} /></Fact>),
        amplifies: false,
        run: async (reason) => runBackend(
          actions.createI7CourseVersion(c.id, await submittedCourse(courseSpec("version-create"), form), reason), `${nexGridBrandText(c.title)} ${form?.version} 草稿已创建`).then(() => setCourseEditor(null)),
      }),
    });
  };

  const editCourseVersionState = (c: Course, row: LearningCourseVersionView): CourseEditorState => ({
    courseId: c.id, spec: courseSpec("version-edit", courseCurrent(c, row.version, row.payload)), title: "编辑版本草稿", sub: `${nexGridBrandText(c.title)} · ${row.version}`,
    save: (form) => confirmI6(`course:${c.id}`, { briefKind: "config",
      action: <>编辑课程版本草稿 · {nexGridBrandText(c.title)} {row.version}</>,
      title: "保存版本草稿",
      detail: <>英文和运营区域语言的正文与测验须填写完整。别人刚改过时，会先让你核对再保存。</>,
      effect: draftEffect,
      confirmLabel: "保存草稿",
      statedBrief: { impact: `更新 ${row.version} 草稿；线上版本不变。`, check: "三种语言和测验核对过。" },
      facts: courseDraftFacts(form, <Fact k="版本">{row.version}（草稿）</Fact>),
      amplifies: false,
      run: async (reason) => runBackend(
        actions.updateI7CourseVersion(c.id, row.version, await submittedCourse(courseSpec("version-edit"), form, row.revision), reason), `${nexGridBrandText(c.title)} ${row.version} 草稿已更新`).then(() => setCourseEditor(null)),
    }),
  });
  const editCourseVersion = async (c: Course, row: LearningCourseVersionView) => { await readRequiredLanguages(); setCourseEditor(editCourseVersionState(c, row)); };

  const deleteCourseVersion = (c: Course, row: LearningCourseVersionView) => confirmI6(`course:${c.id}`, { briefKind: "record",
    action: <>删除课程版本草稿 · {nexGridBrandText(c.title)} {row.version}</>,
    title: `删除 ${row.version} 草稿`,
    detail: <>只能删除草稿；已发布和历史版本不能删除，以免影响用户进度和奖励。</>,
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>删了找不回</IrreversibleTag></>,
    statedBrief: { impact: "只删这份版本草稿，线上版本和用户进度不变。", check: "核对版本号。" },
    confirmLabel: "删除草稿",
    confirmTone: "danger",
    facts: <Facts><Fact k="课程">{nexGridBrandText(c.title)}</Fact><Fact k="版本">{row.version}（草稿）</Fact></Facts>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI7CourseVersion(c.id, row.version, reason), `${row.version} 草稿已删除`),
  }, courseVersions);

  const versionTarget = (row: LearningCourseVersionView) => ({
    version: row.version, reward: row.payload.rewardNex, title: row.payload.titleZh as string,
    quiz: Array.isArray(row.payload.quizQuestions) ? row.payload.quizQuestions.length : undefined, pass: row.payload.passScore,
  });
  const publishCourseVersion = (c: Course, row: LearningCourseVersionView) => {
    if (courseCommandBlocks(c, "i7_course_version_publish", row.version)) return;
    const reward = Number(row.payload.rewardNex);
    confirmI6(`course:${c.id}`, { briefKind: "content",
    action: <>发布课程版本 · {nexGridBrandText(c.title)} {row.version}</>,
    title: reward > 0 ? `提交审批：发布 ${row.version}` : `发布 ${row.version}`,
    detail: <>发布前会检查三语测验、兑付覆盖率和权限；发布后旧版本变为历史版本。</>,
    effect: activationEffect(reward),
    confirmLabel: reward > 0 ? "提交审批" : "发布",
    statedBrief: { impact: `${reward > 0 ? "批准后" : "发布后"}课程整体换成 ${row.version}：正文、测验、奖励一起换；在新版本学完的用户可以再领一次。`, check: "核对新版本的奖励和测验。" },
    facts: courseChange(c, versionTarget(row)),
    amplifies: reward > 0,
    coverageLead: "这个版本学完会发 UVT",
    coverageCheck: "提交和批准时都检查兑付覆盖率。",
    getPendingReason: () => pendingHIRewardCommand(hiCourseScope(c.id))?.payload.input.reason,
    run: (reason) => activateCourse(c, "version_publish", reason, row),
  });
  };

  const rollbackCourseVersion = (c: Course, row: LearningCourseVersionView) => {
    if (courseCommandBlocks(c, "i7_course_version_rollback", row.version)) return;
    const reward = Number(row.payload.rewardNex);
    confirmI6(`course:${c.id}`, { briefKind: "content",
    action: <>回滚课程版本 · {nexGridBrandText(c.title)} → {row.version}</>,
    title: reward > 0 ? `提交审批：回滚到 ${row.version}` : `回滚到 ${row.version}`,
    detail: <>回滚后课程内容、测验和奖励设置一起恢复成这个版本；在这个版本领过奖励的用户不会重复领取。</>,
    effect: activationEffect(reward),
    confirmLabel: reward > 0 ? "提交审批" : "回滚",
    statedBrief: { impact: `${reward > 0 ? "批准后" : "回滚后"}正文、测验、奖励一起回到 ${row.version}；奖励不变或降低也要审批。`, check: "核对回滚后的奖励和测验。" },
    facts: courseChange(c, versionTarget(row)),
    amplifies: reward > 0,
    coverageLead: "这个版本学完会发 UVT",
    coverageCheck: "提交和批准时都检查兑付覆盖率。",
    getPendingReason: () => pendingHIRewardCommand(hiCourseScope(c.id))?.payload.input.reason,
    run: (reason) => activateCourse(c, "version_rollback", reason, row),
  });
  };

  const setFeat = () => {
    const cur = liveFeatured();
    const publishedCourseOptions = COURSES.filter((course) => liveStatus(course) === "published").map((course) => course.id);
    const publishedCourseLabels = Object.fromEntries(COURSES.filter((course) => liveStatus(course) === "published").map((course) => [course.id, `${nexGridBrandText(course.title)}（${course.id}）`]));
    confirmI6("featured", { briefKind: "content",
      action: <>更换推荐位课程</>,
      title: "更换首页推荐课",
      detail: (
        <>
          推荐位只有一个，只能选已发布的课；不能取消推荐。
        </>
      ),
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: { impact: "App 首页先推用户没学完、正在学的课，其次才推这门；不是每个人首页都一样。", check: "选的是已发布的课。" },
      confirmLabel: "更换",
      edit: { kind: "select", current: cur, options: publishedCourseOptions, optionLabels: publishedCourseLabels, unit: "课程" },
      amplifies: false,
      run: (reason, v) => {
        if (!v) return false;
        // audit P1 修:换课必须是「已发布课程 id」(SPEC §4 + 设计稿文案承诺);
        // 校验失败拒写并 toast 提示,防 dev/操作员误输入空字符串/已下架课程让首页大卡指向死链。
        const target = COURSES.find((c) => c.id === v.trim());
        if (!target) { toast(`课程 id ${v} 不存在 · 未执行`); return false; }
        if (liveStatus(target) !== "published") { toast(`${v} 不是已发布课程 · 不可作为推荐位 · 未执行`); return false; }
        return runBackend(actions.updateI6FeaturedCourse(v.trim(), reason), `推荐课程已换成 ${v}`);
      },
    });
  };

  /* ============ 刚被别人改过：看最新的和自己填的，确认后按最新的重建编辑器或确认框 ============ */
  const conflictUi = (() => {
    const conflict = conflictReview.review;
    if (!conflict) return null;
    const scope = conflict.requested.scope;
    const rejected = conflict.rejectedCommand as Partial<I6Command> & Partial<HIRewardCommand> | undefined;
    const proposalInput = rejected?.payload?.kind === "proposal" ? rejected.payload.input : undefined;
    const op = rejected?.operation ?? proposalInput?.command.op ?? "";
    const input: Record<string, unknown> = rejected?.operation ? rejected.input ?? {} : proposalInput?.command.params ?? {};
    const latestOverview = conflict.latest?.overview;
    const carry = (value?: string) => { prefill.current = { scope, reason: conflict.requested.reason, value }; };
    const reward = (value: unknown) => value === undefined || value === "" ? "—" : rewardPerUser(value);
    const quiz = (payload?: { quizQuestions?: unknown; passScore?: unknown }) => Array.isArray(payload?.quizQuestions)
      ? `${payload.quizQuestions.length} 题 · ${String(payload.passScore ?? "—")} 分及格` : "—";
    const courseContentRows = (left: Record<string, unknown> | undefined, right: Record<string, unknown> | undefined): IConflictRow[] => {
      const label = (names: Record<string, string>, value: unknown) => value == null || value === "" ? undefined : names[String(value)] ?? String(value);
      const bodyRow = (label: string, left: unknown, right: unknown): IConflictRow[] => {
        const a = String(left ?? ""), b = String(right ?? "");
        if (a === b) return [];
        let at = 0;
        while (at < a.length && at < b.length && a[at] === b[at]) at++;
        const from = Math.max(0, at - 8);
        const cut = (text: string) => text ? `${from > 0 ? "…" : ""}${text.slice(from, from + 40)}${text.length > from + 40 ? "…" : ""}` : "—";
        return [{ label, left: <span title={a}>{cut(a)}</span>, right: <span title={b}>{cut(b)}</span>, changed: true }];
      };
      const leftQuiz = (left?.quizQuestions ?? []) as Course["quizQuestions"];
      const rightQuiz = (right?.quizQuestions ?? []) as Course["quizQuestions"];
      return [
        ...inGroup("三语内容", [conflictRow("中文标题", left?.titleZh, right?.titleZh), conflictRow("越南语标题", left?.titleVi, right?.titleVi), conflictRow("英语标题", left?.titleEn, right?.titleEn),
          ...bodyRow("中文正文", left?.bodyZh, right?.bodyZh), ...bodyRow("越南语正文", left?.bodyVi, right?.bodyVi), ...bodyRow("英语正文", left?.bodyEn, right?.bodyEn)]),
        ...inGroup("课程设置", [conflictRow("分类", label(CATEGORY_LABEL, left?.category), label(CATEGORY_LABEL, right?.category)),
          conflictRow("形式", label(FORMAT_LABEL, left?.format), label(FORMAT_LABEL, right?.format)), conflictRow("难度", label(LEVEL_LABEL, left?.difficulty), label(LEVEL_LABEL, right?.difficulty)),
          conflictRow("预计时长", left?.duration == null ? undefined : durationText(String(left.duration)), right?.duration == null ? undefined : durationText(String(right.duration)))]),
        ...inGroup("奖励和测验规则", [conflictRow("学完发", reward(left?.rewardNex), reward(right?.rewardNex)),
          conflictRow("完成条件", COMPLETION_LABEL[String(left?.completionCondition)] ?? left?.completionCondition, COMPLETION_LABEL[String(right?.completionCondition)] ?? right?.completionCondition),
          conflictRow("何时发奖", REWARD_EVENT_LABEL[String(left?.rewardEvent)] ?? left?.rewardEvent, REWARD_EVENT_LABEL[String(right?.rewardEvent)] ?? right?.rewardEvent),
          conflictRow("及格分", left?.passScore, right?.passScore), conflictRow("最多重试次数", left?.retryLimit, right?.retryLimit),
          conflictRow("测验", quiz(left), quiz(right))]),
        ...Array.from({ length: Math.max(leftQuiz.length, rightQuiz.length) }, (_, index) => {
          const a = leftQuiz[index], b = rightQuiz[index];
          // 一边没有这一题：整题一行，标「没有这一题」，不逐项列一排「—」。
          if (!a || !b) {
            const only = (a ?? b)!;
            const summary = `${only.questionZh}（${only.optionsZh.length} 个选项）`;
            const absent = <StatusTag tone="neutral" icon={CircleSlash}>没有这一题</StatusTag>;
            return [{ label: "整题", group: `第 ${index + 1} 题`, changed: true, left: a ? summary : absent, right: b ? summary : absent }];
          }
          return inGroup(`第 ${index + 1} 题`, [
            conflictRow("题目编号", a?.questionId, b?.questionId),
            ...LANGS.flatMap((lang) => {
              const suffix = lang.key === "zh" ? "Zh" : lang.key === "vi" ? "Vi" : "En";
              const questionKey = `question${suffix}` as "questionZh" | "questionVi" | "questionEn";
              const optionsKey = `options${suffix}` as "optionsZh" | "optionsVi" | "optionsEn";
              const aOptions = a?.[optionsKey] ?? [], bOptions = b?.[optionsKey] ?? [];
              return [conflictRow(`${lang.label}题干`, a?.[questionKey], b?.[questionKey]),
                ...Array.from({ length: Math.max(aOptions.length, bOptions.length) }, (_, option) =>
                  conflictRow(`选项 ${option + 1} · ${lang.label}`, aOptions[option], bOptions[option]))];
            }),
            conflictRow("正确答案", a ? `选项 ${a.correctOptionIndex + 1}` : undefined, b ? `选项 ${b.correctOptionIndex + 1}` : undefined),
          ]);
        }).flat(),
      ];
    };
    let subject: ReactNode = "这一项";
    let rows: IConflictRow[] = [];
    let columns: [string, string] = ["你打开时", "现在"];
    let gone: string | undefined;
    let note: ReactNode;
    let rebuildLabel = "按最新的重新确认";
    let rebuild: (() => void) | undefined;
    let lead: string | undefined;
    if (scope.startsWith("message:")) {
      const key = scope.slice(8);
      const now = latestOverview?.messages.find((row) => row.messageKey === key);
      const opened = rejected?.snapshot?.message;
      const state = (row?: { version: string; status?: string }) => row ? `${row.version} · ${statusLabel(row.status)}` : "—";
      subject = <>文案 <span className="i6-mono">{key}</span></>;
      if (conflict.latest && !now) gone = "这条文案在最新读取里没有了，不能按最新的重做。";
      if (op === "message-draft" || op === "integrity-fix") {
        columns = ["现在", "你填的"];
        rebuildLabel = "按最新的重新填写";
        rows = [{ label: "版本", left: state(now), right: `基于 ${String(input.expectedVersion ?? opened?.version ?? "—")}`, changed: !!now && now.version !== (input.expectedVersion ?? opened?.version) },
          ...LANGS.map((item) => conflictRow(item.label, now?.[item.key], input[item.key]))];
        note = "三种语言照你填的留着，保存时按最新版本提交。";
        rebuild = () => {
          carry();
          setSelectedMessageKey(key); setMessageDrawer(true);
          const issue = INTEGRITY_ISSUES.find((row) => row.code === rejected?.snapshot?.integrityIssue?.code);
          setCopyEditor((current) => current ? { ...current, tried: false } : { mode: op === "integrity-fix" && issue ? "fix" : "edit", issue,
            zh: String(input.zh ?? ""), vi: String(input.vi ?? ""), en: String(input.en ?? ""), tried: false });
        };
      } else {
        rows = [{ label: "版本", left: opened ? state(opened) : String(input.expectedVersion ?? "—"), right: state(now), changed: !!now && now.version !== (opened?.version ?? input.expectedVersion) },
          ...LANGS.map((item) => conflictRow(item.label, opened?.[item.key], now?.[item.key]))];
        lead = { "message-publish": "别人先改了，这次没发布。", "message-archive": "别人先改了，这次没归档。", "message-rollback": "别人先改了，这次没回滚。" }[op];
        const target = op === "message-rollback" ? conflict.latest?.messages?.find((row) => row.messageKey === key && row.version === rejected?.version) : undefined;
        if (op === "message-rollback" && conflict.latest && !target) gone = `回滚目标 ${rejected?.version ?? ""} 在最新读取里没有了。`;
        rebuild = op === "message-publish" ? () => { carry(); pubKey(now); }
          : op === "message-archive" ? () => { carry(); archiveKey(now); }
            : target ? () => { carry(); rollbackMessageVersion(target, now); } : undefined;
      }
    } else if (scope.startsWith("course:")) {
      const id = scope.slice(7);
      const now = latestOverview?.courses.find((row) => row.id === id);
      const course = COURSES.find((row) => row.id === id);
      const opened = rejected?.snapshot?.course;
      const state = (row?: { version: string; status: string }) => row ? `${row.version} · ${(COURSE_STATUS[row.status] ?? { text: "状态未知" }).text}` : "—";
      subject = <>课程「{nexGridBrandText(now?.titleZh || now?.title || opened?.titleZh || id)}」</>;
      if (conflict.latest && (!now || !course)) gone = "这门课在最新读取里没有了，不能按最新的重做。";
      if (op === "course-draft" || op === "version-draft") {
        const version = op === "version-draft" ? rejected?.version : undefined;
        const nowVersion = version ? conflict.latest?.versions?.find((row) => row.version === version) : undefined;
        const base: Record<string, unknown> | undefined = version ? nowVersion?.payload : now;
        if (!gone && conflict.latest && version && nowVersion?.status !== "DRAFT") gone = `${version} 已经不是草稿了，不能再改。`;
        if (!gone && conflict.latest && !version && now && !["draft", "ready"].includes(now.status)) gone = `这门课现在是 ${state(now)}，不能再改草稿。`;
        columns = ["现在", "你填的"];
        rebuildLabel = "按最新的重新填写";
        rows = courseContentRows(base, input);
        note = "保存会用你填的整份内容替换现在的草稿；别人改的要留，先在编辑框里补上。";
        rebuild = course && (!version || nowVersion) ? () => carry() ?? setCourseEditor((current) => {
          const fresh = version ? editCourseVersionState(course, nowVersion!) : editCrsState(course);
          return current ? fresh : { ...fresh, spec: { ...fresh.spec, current: courseCurrent(course, version ?? course.v, input) } };
        }) : undefined;
      } else if (op.startsWith("i7_course_") || ["course-publish", "version-publish", "version-rollback"].includes(op)) {
        const adjust = op === "i7_course_reward_adjust";
        const firstPublish = op === "i7_course_first_publish" || op === "course-publish";
        const rollback = op === "i7_course_version_rollback" || op === "version-rollback";
        lead = op.startsWith("i7_course_") ? "别人先改了，这次没提交审批。" : rollback ? "别人先改了，这次没回滚。" : "别人先改了，这次没发布。";
        const target = adjust ? undefined : conflict.latest?.versions?.find((row) => firstPublish ? row.status === "DRAFT" : row.version === (input.version ?? rejected?.version));
        const legacy = firstPublish && !target ? now : undefined;
        const openedTarget = rejected?.snapshot?.courseVersion;
        rows = inGroup("课程", [{ label: "课程", left: opened ? state(opened) : `${String(input.expectedCurrentVersion ?? "—")}`, right: state(now), changed: !!opened && !!now && state(opened) !== state(now) },
          conflictRow(adjust ? "现在的奖励" : "课程现在发", reward(opened?.rewardNex), reward(now?.rewardNex))]);
        if (!adjust) {
          const wanted = rollback ? "SUPERSEDED" : "DRAFT";
          rows.push({ group: "课程", ...conflictRow(`要发布的 ${String(target?.version ?? legacy?.version ?? input.version ?? "")}`, openedTarget ? `${reward(openedTarget.payload.rewardNex)} · ${quiz(openedTarget.payload)}` : firstPublish && opened ? `${reward(opened.rewardNex)} · ${quiz(opened)}` : "—",
            target ? `${reward(target.payload.rewardNex)} · ${quiz(target.payload)}` : legacy ? `${reward(legacy.rewardNex)} · ${quiz(legacy)}` : "没有了") });
          rows.push(...courseContentRows(openedTarget?.payload ?? (firstPublish ? opened : undefined), target?.payload ?? legacy));
          if (!gone && conflict.latest && (legacy ? legacy.status !== "draft" : target?.status !== wanted)) gone = `${String(input.version ?? "目标版本")} 现在不能${wanted === "DRAFT" ? "发布" : "回滚"}了（没有了或状态变了）。`;
        } else note = <>你填的新奖励 {reward(input.rewardNex)} 会带回确认框。</>;
        rebuild = !course ? undefined : adjust ? () => { carry(String(input.rewardNex ?? "")); adjRwd(course); }
          : firstPublish ? () => { carry(); void pubCrs(course); }
            : target ? () => { carry(); if (!rollback) publishCourseVersion(course, target); else rollbackCourseVersion(course, target); } : undefined;
      }
    }
    if (!rebuild && !gone) { rebuildLabel = "知道了"; note = "最新的已经读到页面上，关掉后重新打开要做的操作。"; }
    const finish = (task?: () => void) => {
      if (!conflictReview.confirm(conflict, () => undefined)) return;
      conflictView.show();
      if (task) window.setTimeout(task, 0);
    };
    return conflictView.open
      ? <IConflictModal review={conflict} subject={subject} lead={lead} rows={rows} columns={columns} gone={gone} note={note} rebuildLabel={rebuildLabel}
          onReread={() => void conflictReview.reread()} onClose={conflictView.hide} onRebuild={() => finish(rebuild)}
          onDiscard={() => finish(() => { if (scope.startsWith("message:")) setCopyEditor(null); else setCourseEditor(null); })} />
      : <IConflictPending subject={subject} onOpen={conflictView.show} />;
  })();

  /* ============ 等批准和结果未知的课程操作 ============ */
  const courseRecords = view === "learn" ? pendingHIRewardCommands().filter((record) => record.scope.startsWith("I/")) : [];
  /* 普通写（文案、课程草稿、下架、换推荐）结果未知：刷新后也列出来，读不到概览时同样显示。 */
  const ordinaryRecords = pendingI6Commands().filter((record) => record.scope === "unknown"
    || (view === "i18n" ? record.scope === "rescan" || record.scope.startsWith("message:") : record.scope === "featured" || record.scope.startsWith("course:")));
  const ordinaryChange = (record: I6Command) => {
    const from = String(record.input.expectedVersion ?? "");
    switch (record.operation) {
      case "message-draft": return `${from} → 新草稿`;
      case "message-publish": return `发布 ${from}`;
      case "message-archive": return `${from} → 已归档`;
      case "message-rollback": return `${from} → 复制 ${record.version} 发布`;
      case "integrity-fix": return `存成草稿 · ${record.snapshot?.integrityIssue ? issueName(record.snapshot.integrityIssue) : "完整性问题"}`;
      case "rescan": return "重算问题报告";
      case "course-create": return `新课草稿 · 学完发 ${rewardPerUser(record.input.rewardNex)}`;
      case "course-draft": return `草稿 · 学完发 ${rewardPerUser(record.input.rewardNex)}`;
      case "course-delete": return "删除草稿";
      case "course-archive": return "在线 → 已下架";
      case "version-create": case "version-draft": return `${record.version} 草稿 · 学完发 ${rewardPerUser(record.input.rewardNex)}`;
      case "version-delete": return `删除 ${record.version} 草稿`;
      case "featured": return `${record.snapshot?.featuredCourseId || "—"} → ${record.target}`;
      default: return "原记录不完整";
    }
  };
  const queryOrdinary = async (record: I6Command) => {
    setOrdinaryBusy(record.commandKey);
    try {
      let outcome: FundInvestigationOutcome;
      try {
        outcome = { receipt: await queryI6Receipt(record) };
      } catch (error) {
        outcome = { error: displayAdminError(error) };
      }
      setOrdinaryOutcomes(all => ({ ...all, [record.commandKey]: outcome }));
      const receipt = receiptOf(outcome);
      if (eCommandSettled(receipt)) { toast(settledText({ status: receipt!.originalStatus })); await finishRecovery(record.commandKey); return; }
      const overview = await fetchI6LearningOverview();
      if (record.scope.startsWith("message:")) await actions.fetchI6MessageVersions(record.target);
      if (record.scope.startsWith("course:") && overview.courses.some(course => course.id === record.target)) await actions.fetchI7CourseVersions(record.target);
      const shown = ordinaryStatus(record, outcome);
      toast(`${shown.label}：${shown.line}`, "warn");
      await actions.reloadIContent();
    } catch (error) { toast(displayAdminError(error), "warn"); }
    finally { setOrdinaryBusy(""); updateRecovery((value) => value + 1); }
  };
  const retryOrdinary = async (record: I6Command) => {
    setOrdinaryBusy(record.commandKey);
    try {
      await retryI6Command(record);
      toast(`${record.label} · 已按原请求完成`);
      await finishRecovery(record.commandKey);
    } catch (error) {
      toast(failText(error), "warn");
      if (!pendingI6Commands().some((row) => row.commandKey === record.commandKey)) await finishRecovery(record.commandKey);
    } finally { setOrdinaryBusy(""); updateRecovery((value) => value + 1); }
  };
  // 课程操作写课程名，和同一列表里的审批行一致；文案操作写文案键（表格里也是它）。
  const courseOf = (record: I6Command) => record.scope.startsWith("course:") ? COURSES.find((course) => course.id === record.target) : undefined;
  /** 文案和课程原操作这一行怎么说：共用面板的标签和句子（查询失败的原因放标签问号里）。 */
  const ordinaryStatus = (record: I6Command, outcome: FundInvestigationOutcome | undefined) => {
    const shown = fundRecoveryStatus({ outcome, expired: isRetryExpired(record), canQuery: true, canRetry: !isRetryExpired(record) && !i6RetryPermission(record),
      canClose: canInvestigateECommand(record.original?.path.startsWith("/i18n-learning/courses/") ? "content_i7_read" : "content_i6_read") });
    return { ...shown, more: shown.more ?? (outcome && "error" in outcome ? outcome.error : undefined) };
  };
  const ordinaryOpen = ordinaryRecords.filter(record => OPEN_RESULT_LABELS.includes(ordinaryStatus(record, ordinaryOutcomes[record.commandKey]).label)).length;
  const ordinaryItems = ordinaryRecords.map((record) => {
    const expired = isRetryExpired(record);
    const shown = ordinaryStatus(record, ordinaryOutcomes[record.commandKey]);
    return <li key={record.commandKey} role="status">
      <StatusTag tone={shown.tone} explain={shown.more}>{shown.label}</StatusTag>
      <span className="i6-pending-what">{record.label}{record.target ? <> · {courseOf(record) ? nexGridBrandText(courseOf(record)!.titleZh || courseOf(record)!.title) : <span className="i6-mono">{record.target}</span>}</> : null}</span>
      <span className="i6-pending-change">{ordinaryChange(record)}</span>
      <span className="i6-pending-at">{businessStamp(record.createdAt)} 提交</span>
      <span className="i6-pending-act">
        <Button size="sm" disabled={!!ordinaryBusy && ordinaryBusy !== record.commandKey} loading={ordinaryBusy === record.commandKey} onClick={() => void queryOrdinary(record)}>查询原结果</Button>
        {canInvestigateECommand(record.original?.path.startsWith("/i18n-learning/courses/") ? "content_i7_read" : "content_i6_read") && eCommandClosureOffer(ordinaryOutcomes[record.commandKey], expired).conclusions.length > 0 && <Button size="sm" variant="danger-outline" disabled={!!ordinaryBusy} onClick={() => setClosingOrdinary(record)}>核查结案</Button>}
        <Button size="sm" variant="primary" disabledReason={ordinaryBusy ? "正在处理另一项" : expired ? "已超过 24 小时，不能再重试，只能查询。" : i6RetryPermission(record)}
          onClick={() => void retryOrdinary(record)}>按原请求重试</Button>
      </span>
      <span className="i6-pending-note">{shown.line} <TechInfo commandKey={record.commandKey} receipt={receiptOf(ordinaryOutcomes[record.commandKey])} /></span>
    </li>;
  });
  const ordinaryClosure = closingOrdinary && <FundClosureModal label={`${closingOrdinary.label}${closingOrdinary.target ? ` · ${closingOrdinary.target}` : ""}`} createdAt={closingOrdinary.createdAt}
    offer={eCommandClosureOffer(ordinaryOutcomes[closingOrdinary.commandKey], isRetryExpired(closingOrdinary))}
    facts={<Fact k="系统记录">{receiptFact(((outcome) => outcome && "receipt" in outcome ? outcome.receipt : null)(ordinaryOutcomes[closingOrdinary.commandKey]), "记录保留")}</Fact>}
    onClose={() => setClosingOrdinary(null)} onSubmit={async evidence => {
      const record = closingOrdinary;
      const receipt = await queryI6Receipt(record, evidence);
      setOrdinaryOutcomes(all => ({ ...all, [record.commandKey]: { receipt } }));
      setClosingOrdinary(null); updateRecovery(value => value + 1);
      if (eCommandSettled(receipt)) { toast(settledText({ status: receipt!.originalStatus })); await finishRecovery(record.commandKey); }
      else toast(CLOSURE_KEPT_TEXT, "warn");
    }} />;
  const ordinaryExplain = DIRECT_RECOVERY_INTRO;
  const recoveryMore = (total: number) => total > 3
    ? <div className="i-recovery-more"><Button size="sm" variant="ghost" onClick={() => setRecoveryAll((open) => !open)}>{recoveryAll ? "只看前 3 条" : `显示全部 ${total} 条`}</Button></div> : null;
  const ordinaryRecovery = view === "i18n" && ordinaryItems.length > 0
    ? <Panel title={ordinaryOpen === ordinaryItems.length ? "还没结案的文案操作" : "结果未知的文案操作"} icon={TriangleAlert} tone="warn" sub={`${ordinaryItems.length} 项 · 时间为${BJ}`} explain={ordinaryExplain}>
      <ul className="i6-pending" aria-label="结果未知的文案操作">{recoveryAll ? ordinaryItems : ordinaryItems.slice(0, 3)}</ul>
      {recoveryMore(ordinaryItems.length)}
    </Panel> : null;
  const courseApprovalRows = (Array.isArray(courseApprovals) ? courseApprovals : []).filter(row => !courseRecords.some(record =>
    record.ticketStatus === "pending" && record.payload.kind === "proposal"
    && record.payload.input.obj === row.obj && record.payload.input.command.op === row.operationCode));
  const courseRecovery = (() => {
        if (view !== "learn") return null;
        const records = courseRecords;
        const approvals = courseApprovalRows;
        if (!records.length && !approvals.length && !ordinaryItems.length && courseApprovals !== "error") return null;
        const courseTitle = (id: string) => nexGridBrandText(allCourses.find((course) => course.id === id)?.title ?? id);
        // 超过 24 小时的原操作只查原审批单、不重发：查询直接做，不经确认框（共用确认框带锁定理由时按钮固定写「重试原操作」）。
        const lookupExpired = async (record: HIRewardCommand) => {
          setLookupKey(record.commandKey);
          try {
            const ticket = await queryI6CourseProposal(record);
            if (!ticket && isRetryExpired(record)) setNotFoundKeys((keys) => keys.includes(record.commandKey) ? keys : [...keys, record.commandKey]);
            toast(ticket ? ticketText(ticket)
              : isRetryExpired(record) ? "没查到这张审批单。" : "还没查到原审批单，记录继续保留。", "warn");
            if (ticket && ticket.status !== "pending") await finishRecovery(record.commandKey);
            else await reloadCourseApprovals();
          } catch (error) {
            toast(displayAdminError(error), "warn");
          } finally {
            setLookupKey("");
            updateRecovery(value => value + 1);
          }
        };
        const subject = (record: HIRewardCommand) => record.payload.kind === "proposal"
          ? `${record.payload.input.action.split(" · ")[0]} · ${courseTitle(record.payload.input.obj)} ${String(record.payload.input.command.params.version ?? "")}`.trim()
          : "原操作";
        const change = (record: HIRewardCommand) => record.payload.kind === "proposal"
          ? <Change from={approvalValue(record.payload.input.beforeValue)} to={approvalValue(record.payload.input.afterValue)} /> : null;
        const auditHref = "/platform/audit?domain=I";
        const rows = [...records.map((record) => {
              const expired = isRetryExpired(record);
              const queryOnly = expired || record.receiptKnown || !!i6CourseProposalPermission(record);
              const label = subject(record);
              return <li key={record.commandKey} role="status">
                <StatusTag tone={record.ticketStatus === "pending" ? "progress" : expired || record.receiptKnown ? "neutral" : "warn"}>{record.ticketStatus === "pending" ? "等另一位批准" : record.receiptKnown ? "已提交，状态未查到" : expired ? "已超过 24 小时" : "结果未知"}</StatusTag>
                <span className="i6-pending-what">{label}</span>
                <span className="i6-pending-change">{change(record)}</span>
                <span className="i6-pending-at">{businessStamp(record.createdAt)} 提交</span>
                <span className="i6-pending-act">
                <Button size="sm" disabled={!!lookupKey && lookupKey !== record.commandKey} loading={lookupKey === record.commandKey} onClick={() => void lookupExpired(record)}>查询原结果</Button>
                {!record.receiptKnown && expired && notFoundKeys.includes(record.commandKey) && record.ticketStatus !== "pending" && <Button size="sm" variant="primary" disabled={!!lookupKey} onClick={() => setReleasing(record)}>确认解除</Button>}
                {!queryOnly && <Button size="sm" variant="primary" disabled={!!lookupKey}
                  onClick={() => {
                  const confirmation: ActionConfirmReq = { briefKind: "record",
                  action: `核对原操作 · ${label}`,
                  title: "按原请求重试",
                  detail: expired ? <>原操作已超过 24 小时，只查询原审批单，不会重发。</> : <>先按原请求查审批单；查不到才按原请求原样重发，不会重复建单。理由沿用原操作。</>,
                  effect: <StatusTag tone="progress" filled>批准后生效</StatusTag>,
                  statedBrief: { impact: "先查原审批单，查不到才原样重发；不会建第二张单。", check: "核对是哪门课、哪个版本。" },
                  facts: <Facts><Fact k="原操作">{label}</Fact><Fact k="改动">{change(record) ?? "—"}</Fact><Fact k="提交时间">{businessStamp(record.createdAt)}（{BJ}）</Fact></Facts>,
                  confirmLabel: "按原请求重试",
                  getPendingReason: () => pendingHIRewardCommands().find((row) => row.commandKey === record.commandKey)?.payload.input.reason,
                  run: async () => {
                    try {
                      const ticket = await retryI6CourseProposal(record);
                      toast(ticketText(ticket));
                      await finishRecovery(record.commandKey);
                    } catch (error) {
                      if (!pendingHIRewardCommands().some(row => row.commandKey === record.commandKey)) await finishRecovery(record.commandKey);
                      throw error;
                    } finally { updateRecovery(value => value + 1); }
                  },
                };
                  recoveryConfirm.current = { commandKey: () => record.commandKey, finish: () => ctx.closeActionConfirm(confirmation) };
                  openActionConfirm(confirmation);
                }}>按原请求重试</Button>}
                </span>
                {record.receiptKnown && record.ticketStatus !== "pending" && <span className="i6-pending-note">审批单已经建了，批没批准还没查到；点「查询原结果」再查，不会再建一张。</span>}
                {!record.receiptKnown && expired && notFoundKeys.includes(record.commandKey) && <span className="i6-pending-note">按原请求查不到这张审批单，说明没建成；核对后可以确认解除。</span>}
              </li>;
            }), ...approvals.map((row) => <li key={row.id}>
              <StatusTag tone="progress">等另一位批准</StatusTag>
              <span className="i6-pending-what">{row.action.split(" · ")[0]} · {courseTitle(row.obj)}{row.mine ? <small>你发起的</small> : null}</span>
              <span className="i6-pending-change"><Change from={approvalValue(row.before)} to={approvalValue(row.after)} /></span>
              <span className="i6-pending-at">{row.rawTs ? `${formatBusinessTimeCompact(row.rawTs, row.ts)} 提交` : row.ts}</span>
              {reach(auditHref, "platform_a2_read") ? <Link className="rd-link" href={auditHref} prefetch={false}>去审批中心看</Link> : <span />}
            </li>), ...ordinaryItems];
        return <Panel title="等批准和结果未知的课程操作" icon={TriangleAlert} tone="warn" sub={`${records.length + approvals.length + ordinaryItems.length} 项 · 时间为${BJ}`}
          explain={<><p>有奖励的课程发布、发布新版本、回滚和调奖，都要另一位超级管理员批准；批准前课程不变。</p><p>发布、回滚在等批准时，这门课不能再提交发布或回滚；调奖单独审批，不受它拦。两张都批准时，后执行的那张可能因课程已变而失败。</p><p>{ordinaryExplain}</p></>}
          actions={canReadA2 && <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={() => void reloadCourseApprovals()}>刷新审批进度</Button>}>
          <ul className="i6-pending" aria-label="课程审批和结果未知列表">
            {recoveryAll ? rows : rows.slice(0, 3)}
            {courseApprovals === "error" && <li><Notice tone="danger">审批进度读取失败，请点「刷新审批进度」重试。</Notice></li>}
          </ul>
          {recoveryMore(rows.length)}
          {releasing && <ReleaseModal label={<>{subject(releasing)}{change(releasing)}</>}
            explain="原申请超过 24 小时，按原请求查不到这张审批单，说明它没建成。确认时会再查一次，仍查不到才解除。"
            onCancel={() => setReleasing(null)} onConfirm={() => {
              const record = releasing;
              setReleasing(null);
              void releaseExpiredI6CourseProposal(record).then(() => { toast("已解除，这门课可以重新提交"); return finishRecovery(record.commandKey); },
                (error) => toast(displayAdminError(error), "warn")).finally(() => { setNotFoundKeys((keys) => keys.filter((key) => key !== record.commandKey)); updateRecovery((value) => value + 1); });
            }} />}
        </Panel>;
      })();

  /* ============ 读取中、读不到 ============ */
  if (contentLoading && !data) {
    return <>{conflictUi}{ordinaryRecovery}{courseRecovery}{ordinaryClosure}<BlockState state="loading" title={view === "i18n" ? "正在加载文案…" : "正在加载课程…"} /></>;
  }
  if (!data) {
    return <>{conflictUi}{ordinaryRecovery}{courseRecovery}{ordinaryClosure}<BlockState state="error" title={view === "i18n" ? "文案没有读到" : "课程没有读到"} detail="点上方「重新加载」重试。" /></>;
  }

  /* ============ App 文案 ============ */
  if (view === "i18n") {
    const total = MESSAGES.length;
    const filledOf = (lang: Lang) => MESSAGES.filter((message) => i6HasCopyText(langValue(message, lang))).length;
    const missingAny = MESSAGES.filter((message) => missingLangs(message, requiredLanguages).length > 0);
    const drafts = MESSAGES.filter((message) => message.status === "draft");
    const archived = MESSAGES.filter((message) => message.status === "archived");
    const published = MESSAGES.filter((message) => message.status === "published");
    const openIssues = INTEGRITY_ISSUES.filter((issue) => issue.status !== "fixed");
    const i1Copies = new Map((content.copyAb?.copies ?? []).filter((copy) => copy.i18nKey).map((copy) => [copy.i18nKey, copy]));
    const i1Reachable = reach("/content/copy-ab");
    const query = messageSearch.trim().toLowerCase();
    const filteredMessages = MESSAGES.filter((message) => {
      if (query && ![message.messageKey, message.namespace, message.zh, message.vi, message.en].some((value) => (value ?? "").toLowerCase().includes(query))) return false;
      if (msgScope === "missing" && missingLangs(message, requiredLanguages).length === 0) return false;
      if (msgScope !== "all" && msgScope !== "missing" && message.status !== msgScope) return false;
      if (msgLang && (!requiredLanguages.includes(msgLang) || i6HasCopyText(langValue(message, msgLang)))) return false;
      if (msgNs && message.namespace !== msgNs) return false;
      return true;
    });
    const pageCount = Math.max(1, Math.ceil(filteredMessages.length / msgPageSize));
    const page = Math.min(msgPage, pageCount);
    const pageRows = filteredMessages.slice((page - 1) * msgPageSize, page * msgPageSize);
    const filtered = !!query || msgScope !== "all" || !!msgLang || !!msgNs;
    const clearFilters = () => { setMessageSearch(""); setMsgScope("all"); setMsgLang(""); setMsgNs(""); setMsgPage(1); };
    const showList = (next: { lang?: Lang | ""; ns?: string; scope?: MsgScope }) => {
      setMessageSearch("");
      setMsgScope(next.scope ?? "all");
      setMsgLang(next.lang ?? "");
      setMsgNs(next.ns ?? "");
      setMsgPage(1);
      listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const openMessage = (key: string) => { setSelectedMessageKey(key); setCompareVersion(""); setCopyEditor(null); setMessageDrawer(true); };
    const nsRows = NAMESPACES.map((n) => {
      const rows = MESSAGES.filter((message) => message.namespace === n.ns);
      return { ...n, rows: rows.length, missing: LANGS.map((item) => ({ ...item, n: requiredLanguages.includes(item.key) ? rows.filter((message) => !i6HasCopyText(langValue(message, item.key))).length : 0 })) };
    });
    const missingByLang = LANGS.map((item) => ({ ...item, n: total - filledOf(item.key) }));
    const worstNs = [...nsRows].map((n) => ({ ns: n.ns, n: n.missing.reduce((sum, item) => sum + item.n, 0) })).filter((n) => n.n > 0).sort((a, b) => b.n - a.n);
    const conclusionParts = [
      missingAny.length > 0 && `${count(missingAny.length)} 条文案缺翻译`,
      drafts.length > 0 && `${count(drafts.length)} 条草稿没发布`,
      liveIntegrity > 0 && `完整性检查有 ${count(liveIntegrity)} 处问题`,
    ].filter(Boolean) as string[];
    const missingLangText = missingByLang.filter((item) => requiredLanguages.includes(item.key) && item.n > 0).map((item) => item.label).join("、");
    const whereText = worstNs.length === 0 ? "" : worstNs.length === 1 ? `缺的都在「${nsLabel(worstNs[0].ns)}」` : `缺得最多的是「${nsLabel(worstNs[0].ns)}」`;

    /* ---- 文案详情抽屉 ---- */
    const sm = selectedMessage;
    const i1 = sm ? i1Copies.get(sm.messageKey) : undefined;
    const keyPath = sm ? sm.messageKey.split(".").slice(1).join(" › ") : "";
    const smIssues = sm ? openIssues.filter((issue) => issue.cnt > 0 && issue.samples.includes(sm.messageKey)) : [];
    const compareTarget = messageVersions.find((row) => row.version === compareVersion);
    const editorMissing = copyEditor && sm ? copyFormMissing(sm.placeholders ?? [], copyEditor, requiredLanguages) : [];
    const editorBlocked = blockedText(editorMissing);
    const startEdit = async (mode: CopyEditor["mode"], issue?: IntegrityIssue) => {
      const target = issue && !issue.samples.includes(sm?.messageKey ?? "")
        ? issue.samples.map(key => MESSAGES.find(message => message.messageKey === key)).find(Boolean)
        : sm;
      if (!target) return;
      const required = await readRequiredLanguages();
      setSelectedMessageKey(target.messageKey);
      setCopyEditor({ mode, issue, ...mapSingleContentText(target, required, "edit"), tried: false });
    };
    const whenSeen = !sm ? "—" : sm.status === "published" ? "已在远程文案里；App 下次拉取时用它"
      : sm.status === "draft" ? "草稿，用户看不到；发布后 App 下次拉取时换上" : sm.status === "archived" ? "已撤下远程文案；App 拉到新文案包后改用自带文字" : "—";
    const judgment: JudgmentRow[] = sm ? [
      { label: "状态", value: <><StatusTag tone={msgStatus(sm.status).tone}>{msgStatus(sm.status).text}</StatusTag> {sm.version}</> },
      { label: "在 App 哪里", value: <>{nsLabel(sm.namespace)} · <span className="i6-mono">{keyPath || sm.messageKey}</span></> },
      { label: "用户何时看到", value: whenSeen },
      { label: "变量", value: sm.placeholders.length ? <span className="i6-mono">{sm.placeholders.join("、")}</span> : "无" },
      ...(sm.versionCreatedAt || sm.versionUpdatedAt ? [{ label: "这一版", value: (([created, updated]) => created === updated
        ? `创建 ${created}（${BJ}）` : <>创建 {created}<br />更新 {updated}（{BJ}）</>)([sm.versionCreatedAt, sm.versionUpdatedAt].map((at) => formatBusinessTimeCompact(at, "—"))) }] : []),
      ...(i1 ? [{ label: "来源", value: <>页面文案对比测试发布同步{i1Reachable ? <> · <Link className="rd-link" href="/content/copy-ab" prefetch={false}>去页面文案对比测试</Link></> : null}</> }] : []),
    ] : [];
    const drawerFooter = !sm || !canWriteI6 ? undefined : copyEditor
      ? <Decision note={copyEditor.tried && editorBlocked ? editorBlocked : undefined}
          others={<Button onClick={() => setCopyEditor(null)}>取消</Button>}
          primary={<Button variant="primary" disabledReason={editorBlocked} onBlockedClick={() => setCopyEditor({ ...copyEditor, tried: true })}
            onClick={() => copyEditor.mode === "fix" && copyEditor.issue ? fixIntegrity(copyEditor.issue, copyEditor) : editKeyDraft(copyEditor)}>{copyEditor.mode === "fix" ? "保存修复" : "保存草稿"}</Button>} />
      : <Decision
          danger={sm.status === "published" ? <Button variant="danger-outline" icon={<Archive size={14} aria-hidden />} onClick={() => archiveKey()}>归档</Button> : undefined}
          others={<Button icon={<Pencil size={14} aria-hidden />} onClick={() => startEdit("edit")}>编辑三语草稿</Button>}
          primary={sm.status === "draft" ? <Button variant="primary" icon={<Send size={14} aria-hidden />} disabledReason={publicationIssues.length > 0 ? `暂不能发布：${publicationIssues.join("；")}` : undefined} onClick={() => pubKey()}>发布</Button> : undefined} />;

    return <>
      <Conclusion state={conclusionParts.length ? "warn" : "ok"} icon={conclusionParts.length ? TriangleAlert : BadgeCheck}
        hint={conclusionParts.length ? (missingLangText && whereText ? `${whereText}，缺${missingLangText}` : whereText || undefined) : undefined}
        explain="缺翻译按每条文案现在的内容算，草稿也算；完整性问题是上次检查存下的报告。">
        {conclusionParts.length ? conclusionParts.join("，") : `${count(total)} 条文案必填语言完整，没有待发布的草稿`}
      </Conclusion>
      {conflictUi}
      {ordinaryRecovery}
      {ordinaryClosure}

      <Panel title="三种语言齐不齐" icon={Languages} tone="role-2" sub={`共 ${count(total)} 条 · ${count(NAMESPACES.length)} 个模块`}
        explain="按每条文案现在的内容算（草稿也算）。「可上线」是系统算的：已发布、三语齐、变量一致且通过质量检查的才算。">
        <div className="i6-cov">
          <div className="i6-cov-langs">
            {missingByLang.map((item) => <div key={item.key} className="i6-cov-lang">
              <span className="i6-cov-name">{item.label}</span>
              <RatioBar quiet label={`${item.label}填了多少`} value={total - item.n} total={total} tone={item.n > 0 ? "warn" : "ok"}
                state={total === 0 ? "empty" : undefined} emptyText="没有文案" valueText={`${item.label}填了 ${total - item.n} 条，共 ${total} 条`} />
              <span className="i6-cov-num">{total ? `${Math.floor((total - item.n) * 100 / total)}%` : "—"}</span>
              {!requiredLanguages.includes(item.key) ? <span className="i6-cov-ok">选填</span> : item.n > 0
                ? <button type="button" className="i6-cov-miss" onClick={() => showList({ lang: item.key })} aria-label={`看缺${item.label}的 ${item.n} 条`}>缺 {count(item.n)} 条</button>
                : <span className="i6-cov-ok">齐了</span>}
            </div>)}
            <div className="i6-cov-lang" data-total="">
              <span className="i6-cov-name">可上线<span className="rd-sr-only">的文案</span></span>
              <RatioBar quiet label="可上线的文案" value={Math.min(I6_STATS.managedKeys, I6_STATS.totalKeys)} total={I6_STATS.totalKeys} tone="role-2"
                state={I6_STATS.totalKeys === 0 ? "empty" : undefined} emptyText="没有文案" valueText={`可上线 ${I6_STATS.managedKeys} 条，共 ${I6_STATS.totalKeys} 条`} />
              <span className="i6-cov-num">{count(I6_STATS.managedKeys)} / {count(I6_STATS.totalKeys)}</span>
              <span />
            </div>
          </div>
          <div className="i6-cov-ns" role="list" aria-label="按模块看缺多少">
            {nsRows.length === 0 && <p className="i6-muted">没有模块</p>}
            {nsRows.map((n) => {
              const miss = n.missing.filter((item) => item.n > 0);
              return <button key={n.ns} type="button" role="listitem" className="i6-ns" onClick={() => showList({ ns: n.ns })} aria-label={`看「${nsLabel(n.ns)}」的 ${n.keys} 条文案`}>
                <span className="i6-ns-name">{nsLabel(n.ns)}<small>{n.ns} · {count(n.keys)} 条{!["-", "—", ""].includes(n.variants) && ` · 进行中变体 ${n.variants}`}{!["-", "—", ""].includes(n.lastChange) && ` · 最近改动 ${n.lastChange}`}</small></span>
                <span className="i6-ns-miss">{miss.length ? miss.map((item) => <StatusTag key={item.key} tone="warn" icon={TriangleAlert}>缺{item.short} {count(item.n)}</StatusTag>) : <StatusTag tone="ok">必填语言完整</StatusTag>}</span>
                <span className="i6-ns-cov">
                  <RatioBar compact quiet label={`${nsLabel(n.ns)}可上线比例`} value={n.coverage} total={100} tone="role-2" valueText={`可上线 ${n.coverage}%`} />
                  <span className="i6-ns-pct">可上线 {n.coverage}%</span>
                </span>
              </button>;
            })}
          </div>
        </div>
      </Panel>

      <div ref={listRef} className="i6-list-anchor">
        <Panel title="找一句文案" icon={Search} tone="role-other" sub={filtered ? `${count(filteredMessages.length)} / ${count(total)} 条` : `${count(total)} 条`}
          explain="按键名或中文、越南语、英语的内容搜。只能维护已登记的文案键；新建课程会自动登记课程的键。">
          <FilterBar
            scope={<div className="rd-filter-scope-row"><Segments label="按状态看" value={msgScope} onChange={(value) => { setMsgScope(value); setMsgPage(1); }}
              items={[
                { value: "all", label: "全部", count: total },
                { value: "missing", label: "缺翻译", count: missingAny.length, tone: missingAny.length ? "warn" : undefined },
                { value: "draft", label: "草稿", count: drafts.length },
                { value: "published", label: "已发布", count: published.length },
                { value: "archived", label: "已归档", count: archived.length },
              ]} /></div>}
            sort={<Select aria-label="按模块看" value={msgNs} onChange={(value) => { setMsgNs(value); setMsgPage(1); }}
              options={[{ value: "", label: "全部模块" }, ...NAMESPACES.map((n) => ({ value: n.ns, label: nsLabel(n.ns) }))]} />}
            canClear={filtered} onClear={clearFilters}
            applied={msgLang ? [{ key: "lang", label: `缺${LANGS.find((item) => item.key === msgLang)?.label}`, onRemove: () => { setMsgLang(""); setMsgPage(1); } }] : undefined}
            onSubmit={() => setMsgPage(1)} action={<span />}>
            <FilterField grow>
              <Input type="search" aria-label="搜索词条" data-search="" placeholder="搜键名，或中文、越南语、英语里的字" value={messageSearch}
                onChange={(event) => { setMessageSearch(event.target.value); setMsgPage(1); }} />
            </FilterField>
          </FilterBar>
          <Table label="文案列表" className="i6-msg-table">
            <thead><tr><Th>文案键</Th>{LANGS.map((item) => <Th key={item.key}>{item.label}</Th>)}<Th>状态</Th></tr></thead>
            <tbody>
              {pageRows.map((message) => {
                const selected = messageDrawer && sm?.messageKey === message.messageKey;
                return <Tr key={message.messageKey} selected={selected} onOpen={() => openMessage(message.messageKey)}>
                  <Td><span className="i6-key-cell">
                    <button type="button" className="i6-key" aria-label={`选择 ${message.messageKey}`} title={message.messageKey} onClick={() => openMessage(message.messageKey)}>
                      <span className="i6-key-head">{message.messageKey.slice(0, -16)}</span><span className="i6-key-tail">{message.messageKey.slice(-16)}</span>
                    </button>
                    <small>{nsLabel(message.namespace)}{i1Copies.has(message.messageKey) ? " · 来自文案测试" : ""}</small>
                  </span></Td>
                  {LANGS.map((item) => {
                    const text = langValue(message, item.key);
                    return <Td key={item.key}>{i6HasCopyText(text) ? <Cell main={text} title={text} /> : requiredLanguages.includes(item.key) ? <StatusTag tone="warn" icon={TriangleAlert}>缺{item.label}</StatusTag> : "—"}</Td>;
                  })}
                  <Td><Cell main={<StatusTag tone={msgStatus(message.status).tone} icon={message.status === "draft" ? FilePen : undefined}>{msgStatus(message.status).text}</StatusTag>} sub={message.version} /></Td>
                </Tr>;
              })}
              {total === 0 && <TableMessage columns={5}>还没有登记的文案。</TableMessage>}
              {total > 0 && filteredMessages.length === 0 && <TableMessage columns={5}>没有符合条件的文案。<button type="button" className="rd-link" onClick={clearFilters}>清除筛选</button></TableMessage>}
            </tbody>
          </Table>
          {filteredMessages.length > 0 && <Pager label="文案分页" total={filteredMessages.length} page={page} pageSize={msgPageSize} sizes={[20, 50, 100]}
            onPage={setMsgPage} onPageSize={(size) => { setMsgPageSize(size); setMsgPage(1); }} />}
        </Panel>
      </div>

      <Fold title="完整性检查" icon={ListChecks} tone={openIssues.length ? "warn" : "role-other"} alert={liveIntegrity > 0}
        summary={<>{liveIntegrity > 0 ? `${count(liveIntegrity)} 处问题 · ${openIssues.filter((issue) => issue.cnt > 0).map((issue) => `${issueName(issue)} ${count(issue.cnt)}`).join(" · ")}` : INTEGRITY_ISSUES.length ? "问题报告里没有待修的" : "还没有问题报告"}
          <span className="i6-muted"> · {data?.lastScanAt ? `上次检查 ${formatBusinessTimeCompact(data.lastScanAt, "—")}（${BJ}）` : "还没有检查记录"}</span></>}
        explain="检查 6 类：缺中文、缺英语、缺越南语、变量不一致、占位文字、旧品牌名。报告存在后台，点「重新检查」或修复一条后更新；「上次检查」只记点「重新检查」的时间。报告是空的不代表文案都没问题。一条文案可能同时算进几类。"
        actions={canWriteI6 ? <Button size="sm" icon={<RefreshCw size={14} aria-hidden />} onClick={rescan}>重新检查</Button> : undefined}>
        {INTEGRITY_ISSUES.length === 0
          ? <BlockState state="empty" title="还没有问题报告" detail={canWriteI6 ? "点「重新检查」生成一份。" : undefined} />
          : <>{openIssues.filter((issue) => issue.cnt > 0).length > 0 && <ul className="i6-issues" aria-label="问题报告">
            {openIssues.filter((issue) => issue.cnt > 0).map((issue) => <li key={issue.code} className="i6-issue">
              <div className="i6-issue-head">
                <IconTile icon={FilePen} tone="warn" />
                <span className="i6-issue-name">{issueName(issue)}</span>
                <span className="i6-issue-cnt">{count(issue.cnt)} 处</span>
                {canWriteI6 && sm && <span className="i6-issue-fix"><span className="i6-muted" title={sm.messageKey}>所选 <span className="i6-mono">{sm.messageKey.length > 22 ? `…${sm.messageKey.slice(-21)}` : sm.messageKey}</span></span><span data-pair=""><Button size="sm" onClick={() => { setMessageDrawer(true); setCompareVersion(""); startEdit("fix", issue); }}>修复所选文案</Button><Explain label="修的是哪一条" content="修的是列表里最后点过的那条文案（没点过时是第一条）。要修别的，先点「例如」里的键或列表里的文案。" /></span></span>}
              </div>
              {issue.samples.length > 0 && <div className="i6-issue-samples">
                <span className="i6-muted">例如</span>
                {issue.samples.map((sample) => MESSAGES.some((message) => message.messageKey === sample)
                  ? <button key={sample} type="button" className="i6-sample" data-selected={sm?.messageKey === sample ? "" : undefined} onClick={() => openMessage(sample)}>{sample}</button>
                  : <span key={sample} className="i6-sample" data-static="">{sample}</span>)}
              </div>}
            </li>)}
          </ul>}
          {INTEGRITY_ISSUES.some((issue) => issue.status === "fixed" || issue.cnt === 0) && <p className="i6-muted i6-clean">其余 {INTEGRITY_ISSUES.filter((issue) => issue.status === "fixed" || issue.cnt === 0).length} 类没有问题<Explain label="哪几类没有问题" content={INTEGRITY_ISSUES.filter((issue) => issue.status === "fixed" || issue.cnt === 0).map(issueName).join("、")} /></p>}
          </>}
      </Fold>

      <Fold title="写死在 App 里的文字" icon={CodeXml} summary={HARDCODED_FINDINGS.length ? `${count(HARDCODED_FINDINGS.length)} 处 · 后台改不了，要发版` : "没有登记 · 后台改不了，要发版"}
        explain="这些字写在 App 代码里，不走文案系统，这页改不了；要由 App 开发换成文案键，随新版本发布。登记表是人工维护的，重新检查不会更新它；没有登记不代表 App 里没有写死的字。">
        <Table label="写死在 App 里的文字">
          <thead><tr><Th>位置</Th><Th>原文</Th><Th>建议换成的文案键</Th></tr></thead>
          <tbody>
            {HARDCODED_FINDINGS.map((row) => <Tr key={row.location}>
              <Td><Cell main={row.location} title={row.location} /></Td>
              <Td grow><Cell main={row.rawCopy} title={row.rawCopy} /></Td>
              <Td><Cell main={row.suggestedKey} mono title={row.suggestedKey} /></Td>
            </Tr>)}
            {HARDCODED_FINDINGS.length === 0 && <TableMessage columns={3}>没有登记。</TableMessage>}
          </tbody>
        </Table>
      </Fold>

      <PaginationExemptionList
        items={[
          {
            label: "词条分组",
            kind: "reference-catalog",
            maxRows: Math.max(1, NAMESPACES.length),
            reason: `命名空间来自真实词条目录,当前 ${NAMESPACES.length} 组,需要同屏核对三语覆盖率和缺少词条`,
          },
        ]}
      />

      <Drawer open={messageDrawer && !!sm} onClose={() => { setMessageDrawer(false); setCopyEditor(null); }} icon={Languages}
        title={copyEditor ? (copyEditor.mode === "fix" ? "修复文案" : "编辑三语草稿") : "文案详情"} sub={sm?.messageKey}
        footer={drawerFooter}>
        {sm && !copyEditor && <>
          <JudgmentPoints rows={judgment} />
          {sm.status === "draft" && publicationIssues.length > 0 && <Notice tone="warn" title="暂不能发布">{publicationIssues.join("；")}。编辑三语草稿补齐后再发布。</Notice>}
          {smIssues.length > 0 && <Notice tone="warn" title="完整性检查点到这条" action={canWriteI6 ? <Button size="sm" onClick={() => startEdit("fix", smIssues[0])}>修复</Button> : undefined}>
            {smIssues.map(issueName).join("、")}
          </Notice>}
          <section className="i6-langs" aria-label="三种语言">
            {LANGS.map((item) => {
              const text = langValue(sm, item.key);
              return <div key={item.key} className="i6-lang" data-missing={i6HasCopyText(text) ? undefined : ""}>
                <div className="i6-lang-head"><span>{item.label}</span>{!i6HasCopyText(text) && <StatusTag tone="warn" icon={TriangleAlert}>缺{item.label}</StatusTag>}</div>
                <p className="i6-lang-text">{i6HasCopyText(text) ? text : `还没有${item.label}`}</p>
              </div>;
            })}
          </section>
          <Fold inset title="历史版本" icon={History} summary={messageVersionsLoading ? "读取中" : `${count(messageVersions.length)} 个版本 · 时间为${BJ}`}
            explain="回滚是把旧版本的三语复制成新版本发布，旧记录不改；当前还有草稿时不能回滚。">
            <Table label="历史版本">
              <thead><tr><Th>版本</Th><Th>状态</Th><Th>三语</Th><Th>更新时间</Th><Th align="right">操作</Th></tr></thead>
              <tbody>
                {messageVersionsLoading && <TableLoading columns={5} rows={2} />}
                {!messageVersionsLoading && messageVersions.map((row) => {
                  const complete = [row.zh, row.en, row.vi].filter(Boolean).length;
                  const current = row.version === sm.version;
                  return <Tr key={`${row.messageKey}-${row.version}`} selected={compareVersion === row.version}>
                    <Td><Cell main={row.version} sub={current ? "当前版本" : undefined} /></Td>
                    <Td><StatusTag tone={msgStatus(row.status).tone}>{statusLabel(row.status)}</StatusTag></Td>
                    <Td>{complete}/3</Td>
                    <Td><Cell main={formatBusinessTimeCompact(row.versionUpdatedAt, "—")} sub={row.versionCreatedAt ? `创建 ${formatBusinessTimeCompact(row.versionCreatedAt, "—")}` : undefined} /></Td>
                    <Td align="right" data-fit=""><span className="i6-row-actions">
                      {!current && <Button size="sm" variant="ghost" onClick={() => setCompareVersion(compareVersion === row.version ? "" : row.version)}>{compareVersion === row.version ? "收起对比" : "对比"}</Button>}
                      {canWriteI6 && row.status === "archived" && sm.status !== "draft"
                        && <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => rollbackMessageVersion(row)}>回滚到此版本</Button>}
                    </span></Td>
                  </Tr>;
                })}
                {!messageVersionsLoading && messageVersions.length === 0 && <TableMessage columns={5}>暂无历史版本</TableMessage>}
              </tbody>
            </Table>
            {compareTarget && <CompareRows beforeLabel={`${compareTarget.version}（旧）`} afterLabel={`${sm.version}（现在）`}
              rows={LANGS.map((item) => ({ key: item.key, label: item.label, before: langValue(compareTarget, item.key), after: langValue(sm, item.key) }))} />}
          </Fold>
        </>}
        {sm && copyEditor && <>
          {copyEditor.mode === "fix" && copyEditor.issue && <Facts><Fact k="问题">{issueName(copyEditor.issue)} · {count(copyEditor.issue.cnt)} 处</Fact><Fact k="修哪一条">{sm.messageKey}</Fact></Facts>}
          <p className="i6-muted">存成新草稿，已发布的内容不变；发布后用户才看到。</p>
          {i1 && <Notice tone="warn">这条文案来自页面文案对比测试：那边发布时会直接盖掉这里没发布的草稿。</Notice>}
          {LANGS.map((item) => {
            const value = copyEditor[item.key];
            const required = requiredLanguages.includes(item.key);
            const missingVars = (sm.placeholders ?? []).filter((ph) => !value.includes(ph));
            const error = copyEditor.tried && (required || i6HasCopyText(value)) ? (!i6HasCopyText(value) ? `请填${item.label}` : missingVars.length ? `缺变量 ${missingVars.join("、")}` : undefined) : undefined;
            const hint = item.key !== "en" && required && isEnglishCopy({ text: copyEditor.en }, { text: value }) ? englishCopyHint(item.key) : undefined;
            return <Field key={item.key} label={item.label} required={required} hint={sm.placeholders.length ? `要带上 ${sm.placeholders.join("、")}` : undefined} error={error}
              help={hint ?? (i6HasCopyText(langValue(sm, item.key)) && langValue(sm, item.key) !== value ? <>现在：{langValue(sm, item.key)}</> : undefined)}>
              <Textarea rows={3} value={value} onChange={(event) => setCopyEditor({ ...copyEditor, [item.key]: event.target.value })} />
            </Field>;
          })}
        </>}
      </Drawer>
    </>;
  }

  /* ============ 学习课程 ============ */
  const counts = {
    online: allCourses.filter((c) => liveStatus(c) === "published").length,
    draft: allCourses.filter((c) => ["draft", "ready"].includes(liveStatus(c))).length,
    archived: allCourses.filter((c) => liveStatus(c) === "archived").length,
  };
  const filteredCrs = allCourses.filter((c) => catFlt === "all" || c.cat === catFlt);
  const versionCourse = allCourses.find((course) => course.id === versionCourseId);
  const approvalOf = (id: string) => courseApprovalRows.find((row) => row.obj === id)
    ?? courseRecords.find(record => record.payload.kind === "proposal" && record.payload.input.obj === id && record.ticketStatus === "pending");
  const unknownOf = (id: string) => courseRecords.find((record) => record.payload.kind === "proposal" && record.payload.input.obj === id && record.ticketStatus !== "pending");
  const weekly = operatorCopyText(I6_STATS.weeklyNexPayout);
  // 原精度文本只加千分位、补到两位，不舍入；不是数字时照原文显示。
  const weeklyValue = (raw => i6Amount(raw) === undefined ? raw : uvtText(raw))(weekly.replace(/\s*UVT$/, ""));
  const unknownCount = courseRecords.filter((record) => record.ticketStatus !== "pending" && !record.receiptKnown).length + ordinaryRecords.length;
  const submittedCount = courseRecords.filter((record) => record.ticketStatus !== "pending" && record.receiptKnown).length;
  const pendingCourseCount = new Set([...courseApprovalRows.map(row => row.obj), ...courseRecords.filter(record => record.ticketStatus === "pending")
    .map(record => record.payload.kind === "proposal" ? record.payload.input.obj : "")].filter(Boolean)).size;
  /**
   * App 给英语、越南语用户读课时的取法：越南语缺的格用英文；标题、正文、每道题的题干和
   * 至少两个、和中文一样多的选项都读得到才显示，读不到整门课不显示。中文缺格也用英文。
   */
  const appCopy = (c: Course, lang: Lang) => {
    const pick = (own: string | undefined, en: string) => lang !== "en" && own?.trim() ? own : en;
    const own = lang === "zh" ? { title: c.titleZh, body: c.bodyZh } : lang === "vi" ? { title: c.titleVi, body: c.bodyVi } : { title: c.titleEn, body: c.bodyEn };
    return { title: pick(own.title, c.titleEn), body: pick(own.body, c.bodyEn), english: lang !== "en" && (!own.title?.trim() || !own.body?.trim()) };
  };
  const appHidden = (c: Course): InterfaceLanguageCode[] => liveStatus(c) !== "published" ? [] : INTERFACE_LANGUAGES.map(item => item.code).filter(lang => {
    if (lang === "zh") return false;
    const hasText = (value: string | undefined) => /[^ \t\n\v\f\r\u001c-\u001f\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]/u.test(value ?? "");
    const pick = (value: string | undefined, english: string) => hasText(value) ? value : english;
    const title = lang === "en" ? c.titleEn : pick(lang === "vi" ? c.titleVi : c.titleTranslations?.[lang], c.titleEn);
    const body = lang === "en" ? c.bodyEn : pick(lang === "vi" ? c.bodyVi : c.bodyTranslations?.[lang], c.bodyEn);
    if (!hasText(title) || !hasText(body)) return true;
    return c.quizQuestions.some(question => {
      const translated = lang === "vi" ? question.optionsVi : lang === "en" ? undefined : question.optionTranslations?.[lang];
      const options = translated?.length ? translated : question.optionsEn;
      const prompt = lang === "vi" ? question.questionVi : lang === "en" ? undefined : question.questionTranslations?.[lang];
      return !hasText(pick(prompt, question.questionEn)) || options.length < 2 || options.length !== question.optionsZh.length
        || options.some(option => !hasText(option));
    });
  });
  const hiddenTag = (c: Course) => {
    const hidden = appHidden(c);
    if (!hidden.length) return null;
    const who = hidden.map(lang => INTERFACE_LANGUAGES.find(item => item.code === lang)?.zhName).join("、");
    return <StatusTag tone="warn" icon={EyeOff} explain={`后台是在线，但 App 上${who}用户看不到这门课：这种语言的标题、正文或测验题不全（越南语缺的用英文的）。在「详情与版本」建新版本草稿，补齐后发布。`}>{who}用户看不到</StatusTag>;
  };
  const hiddenCount = allCourses.filter(c => appHidden(c).length > 0).length;
  const conclusion = unknownCount > 0
    ? { state: "warn" as const, text: `${count(unknownCount)} 个课程操作结果未知，先核对`, hint: "在下面「等批准和结果未知」里先查询原结果" }
    : submittedCount > 0
      ? { state: "neutral" as const, text: `${count(submittedCount)} 张课程申请已提交，审批状态还没查到`, hint: "在下面点「查询原结果」再查" }
    : pendingCourseCount > 0
      ? { state: "neutral" as const, text: `${count(pendingCourseCount)} 门课在等${APPROVER}批准`, hint: counts.draft ? `另有 ${count(counts.draft)} 门草稿没发布` : undefined }
      : hiddenCount > 0
        ? { state: "warn" as const, text: `${count(hiddenCount)} 门在线课有的语言用户看不到`, hint: "课程卡上标了是哪种语言，补齐后发布新版本" }
      : counts.draft > 0
        ? { state: "warn" as const, text: `${count(counts.online)} 门课在线，${count(counts.draft)} 门草稿还没发布`, hint: "草稿用户看不到，在课程卡上发布" }
        : allCourses.length === 0
          ? { state: "neutral" as const, text: "还没有课程", hint: canWriteI7 ? "点「新建课程」写第一门" : undefined }
          : { state: "ok" as const, text: `${count(counts.online)} 门课在线，没有待处理的`, hint: undefined };
  const courseActions = (c: Course, where: "card" | "drawer") => {
    const st = liveStatus(c);
    const archived = st === "archived";
    const isDraft = st === "draft" || st === "ready";
    const title = nexGridBrandText(c.title);
    const more: MoreMenuItem[] = [];
    if (canWriteI7 && isDraft) more.push({ key: "delete", label: "删除草稿", danger: true, onSelect: () => deleteCrs(c) });
    if (canWriteI7 && !archived && !isDraft) more.push({ key: "archive", label: "下架", danger: true, disabledReason: archiveProblem(c), onSelect: () => archiveCrs(c) });
    const primary = isDraft
      ? <>
        {canWriteI7 && <Button size="sm" icon={<Pencil size={14} aria-hidden />} aria-label={`编辑 ${title}`} onClick={() => editCrs(c)}>编辑</Button>}
        {canPublishI7 && <Button size="sm" variant="primary" icon={<Send size={14} aria-hidden />} aria-label={`发布 ${title}`} onClick={() => pubCrs(c)}>{c.reward > 0 ? "提交发布" : "发布"}</Button>}
      </>
      : !archived && canAdjustI7Reward
        ? <Button size="sm" aria-label={`调整奖励 ${title}`} disabledReason={rewardApprovalBlocked} onClick={() => adjRwd(c)}>调奖励</Button>
        : null;
    return <>
      {where === "card" && <Button size="sm" variant="ghost" aria-label={`版本管理 ${title}`} onClick={() => { setVersionCourseId(c.id); setCourseTab("content"); setCourseLang("en"); }}>详情与版本</Button>}
      <span className="i6-card-act">{primary}{more.length > 0 && <MoreMenu label={`${title} 更多操作`} items={more} />}</span>
    </>;
  };
  const courseDrawerFooter = (c: Course) => {
    const st = liveStatus(c);
    const archived = st === "archived";
    const isDraft = st === "draft" || st === "ready";
    const title = nexGridBrandText(c.title);
    return <Decision
      danger={canWriteI7 && isDraft ? <Button variant="danger-outline" icon={<Trash2 size={14} aria-hidden />} aria-label={`删除草稿 ${title}`} onClick={() => deleteCrs(c)}>删除草稿</Button>
        : canWriteI7 && !archived ? <Button variant="danger-outline" icon={<Archive size={14} aria-hidden />} aria-label={`下架 ${title}`} disabledReason={archiveProblem(c)} onClick={() => archiveCrs(c)}>下架</Button> : undefined}
      others={<>
        <Button onClick={() => setVersionCourseId("")}>关闭</Button>
        {isDraft && canWriteI7 && <Button icon={<Pencil size={14} aria-hidden />} aria-label={`编辑 ${title}`} onClick={() => editCrs(c)}>编辑</Button>}
        {!isDraft && !archived && canAdjustI7Reward && <Button aria-label={`调整奖励 ${title}`} disabledReason={rewardApprovalBlocked} onClick={() => adjRwd(c)}>调奖励</Button>}
      </>}
      primary={isDraft && canPublishI7 ? <Button variant="primary" icon={<Send size={14} aria-hidden />} onClick={() => pubCrs(c)}>{c.reward > 0 ? "提交发布" : "发布"}</Button> : undefined} />;
  };
  const langDone = (c: Course, lang: Lang) => {
    const F = lang === "zh" ? "Zh" : lang === "vi" ? "Vi" : "En";
    return !!(c[`title${F}` as "titleZh"]?.trim() && c[`body${F}` as "bodyZh"]?.trim());
  };

  return <>
    <Conclusion state={conclusion.state} icon={conclusion.state === "ok" ? BadgeCheck : conclusion.state === "warn" ? TriangleAlert : GraduationCap} hint={conclusion.hint}>{conclusion.text}</Conclusion>
    {conflictUi}
    {courseRecovery}
    {ordinaryClosure}
    <StatBand label="课程概况">
      <Stat tone="role-2" icon={GraduationCap} label="在线课程" value={count(I6_STATS.coursesOnline)} unit="门" sub={`共 ${count(allCourses.length)} 门 · 草稿 ${count(counts.draft)} · 已下架 ${count(counts.archived)}`} />
      <Stat tone="role-1" icon={BookOpen} label="近 7 天学完发出" value={weeklyValue} unit="UVT"
        explain="过去 7 天（滚动，不是自然周）已发到正式用户的课程奖励合计，按实际金额显示，不舍入。" />
      <Stat tone="role-4" icon={Star} label="首页推荐" value={featuredCourse ? nexGridBrandText(featuredCourse.title) : "未设置"}
        explain="推荐位只有一个。App 首页先推用户没学完、正在学的课，其次才推这门。" />
      <Stat tone="role-4" icon={ListChecks} label="单课奖励范围" value={`${TUTORIAL_REWARD_RANGE.min}–${TUTORIAL_REWARD_RANGE.max}`} unit="UVT"
        explain="系统固定的范围，这页改不了；每门课的具体数在课程上调。" />
    </StatBand>

    <Panel title="课程" icon={GraduationCap} tone="role-2" sub={`${count(filteredCrs.length)} 门`}
      actions={canWriteI7 ? <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} onClick={newCrs}>新建课程</Button> : <StatusTag tone="neutral" icon={Eye}>只读</StatusTag>}>
      <div className="i6-course-filter">
        <Segments label="按分类看" value={catFlt} onChange={setCatFlt}
          items={[{ value: "all", label: "全部", count: allCourses.length }, ...courseCategories.map((category) => ({ value: category, label: categoryLabel(category), count: allCourses.filter((c) => c.cat === category).length }))]} />
      </div>
      {allCourses.length === 0
        ? <BlockState state="empty" title="还没有课程" detail={canWriteI7 ? "点「新建课程」写第一门，先存成草稿。" : undefined} />
        : filteredCrs.length === 0
          ? <BlockState state="empty" title="这个分类没有课程" />
          : <div className="i6-course-cards">
            {filteredCrs.map((c) => {
              const st = liveStatus(c);
              const status = COURSE_STATUS[st] ?? { text: "状态未知", tone: "warn" as StateTone };
              const Icon = categoryIcon(c.cat);
              const approval = approvalOf(c.id);
              const unknown = unknownOf(c.id);
              return <article key={c.id} className="i6-course" data-dim={st === "archived" ? "" : undefined} data-selected={versionCourseId === c.id ? "" : undefined} aria-label={nexGridBrandText(c.title)}>
                <header className="i6-course-head">
                  <IconTile icon={Icon} tone="role-2" />
                  <div className="i6-course-title">
                    <h3>{nexGridBrandText(c.title)}</h3>
                    <span className="i6-course-tags">
                      <StatusTag tone={status.tone} icon={status.text === "草稿" ? FilePen : undefined}>{status.text}</StatusTag>
                      {liveFeatured() === c.id && <StatusTag tone="progress" icon={Star}>首页推荐</StatusTag>}
                      {hiddenTag(c)}
                      {approval && <StatusTag tone="progress">等另一位批准</StatusTag>}
                      {unknown && <StatusTag tone={unknown.receiptKnown ? "neutral" : "warn"}>{unknown.receiptKnown ? "已提交，状态未查到" : "结果未知"}</StatusTag>}
                    </span>
                  </div>
                </header>
                <div className="i6-course-reward">
                  <span className="i6-course-reward-k">学完发</span>
                  <span className="i6-course-reward-v" data-empty={c.reward > 0 ? undefined : ""}>{c.rewardRaw === null ? <small>{NO_REWARD}</small> : <>{uvtText(c.rewardRaw)}<small>UVT/人</small></>}</span>
                </div>
                <dl className="i6-course-meta">
                  <div><dt>版本</dt><dd>{c.v}</dd></div>
                  <div><dt>测验</dt><dd>{c.quizQuestions.length ? `${c.quizQuestions.length} 题 · ${c.passScore ?? "—"} 分及格` : "没有题"}</dd></div>
                  <div><dt>形式</dt><dd>{categoryLabel(c.cat)} · {FORMAT_LABEL[c.format] ?? c.format} · {LEVEL_LABEL[c.level] ?? c.level} · {durationText(c.duration)}</dd></div>
                  <div><dt>三语</dt><dd className="i6-course-langs">{LANGS.map((item) => <span key={item.key} data-missing={langDone(c, item.key) ? undefined : ""}>{langDone(c, item.key) ? item.short : `缺${item.short}`}</span>)}</dd></div>
                </dl>
                <footer className="i6-course-actions">{courseActions(c, "card")}</footer>
              </article>;
            })}
          </div>}
    </Panel>

    <Fold title="首页推荐" icon={Star} summary={featuredCourse ? `现在推荐「${nexGridBrandText(featuredCourse.title)}」` : "未设置推荐课程"}
      explain="推荐位只有一个，只能选已发布的课，不能取消推荐。App 首页先推用户没学完、正在学的课，其次才推这门。"
      actions={canWriteI7 ? <Button size="sm" onClick={setFeat}>换推荐课</Button> : undefined}>
      <Facts>
        <Fact k="推荐课程">{featuredCourse ? `${nexGridBrandText(featuredCourse.title)}（${featuredCourse.id}）` : "未设置推荐课程"}</Fact>
        <Fact k="单课奖励范围">{TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} UVT，具体数在课程上调</Fact>
      </Facts>
    </Fold>

    <Fold title="课程效果" icon={ListChecks} summary={TUTORIAL_METRICS.length ? `${count(TUTORIAL_METRICS.length)} 项指标` : "还没有指标"}
      explain="开始学习、学完、测验通过都会记录，奖励记进用户的 UVT 账。完课率等指标还没有数据。">
      {TUTORIAL_METRICS.length === 0
        ? <BlockState state="empty" title="还没有指标" detail="完课率、通过率、学完人数暂时算不出来。" />
        : <Facts>{TUTORIAL_METRICS.map((m) => <Fact key={operatorCopyText(String(m.k))} k={operatorCopyText(String(m.k))}>{operatorCopyText(String(m.v))}</Fact>)}</Facts>}
    </Fold>

    <PaginationExemptionList
      items={[
        {
          label: `教程中心 · /learn · ${allCourses.length} 门课`,
          kind: "reference-catalog",
          maxRows: Math.max(1, allCourses.length),
          reason: `课程目录来自真实接口,当前 ${allCourses.length} 门;创建新课走草稿流`,
        },
      ]}
    />

    <Drawer open={!!versionCourse} onClose={() => setVersionCourseId("")} wide icon={GraduationCap}
      title={versionCourse ? nexGridBrandText(versionCourse.title) : "课程"} sub={versionCourse ? `${versionCourse.id} · ${versionCourse.v}` : undefined}
      footer={versionCourse ? courseDrawerFooter(versionCourse) : undefined}>
      {versionCourse && <section data-proof="i7-course-version-crud" className="i6-course-detail">
        <PageTabs level={2} label="课程详情" value={courseTab} onChange={setCourseTab} ids={courseTabIds}
          items={[{ value: "content", label: "内容" }, { value: "quiz", label: "测验与发奖" }, { value: "versions", label: "版本", count: versionsLoading ? undefined : versionsError ? "—" : courseVersions.length }]} />
        <div {...courseTabIds.panel(courseTab)}>
          {courseTab === "content" && <div className="i6-editor">
            <div className="i6-editor-form">
              <div className="i6-editor-lang"><LocaleTabs label="看哪种语言" value={courseLang} onChange={setCourseLang}
                items={LANGS.map((item) => ({ value: item.key, label: item.label, missing: !langDone(versionCourse, item.key) }))} /></div>
              <Facts>
                <Fact k="标题">{(versionCourse[`title${courseLang === "zh" ? "Zh" : courseLang === "vi" ? "Vi" : "En"}` as "titleZh"] || "—")}</Fact>
                <Fact k="状态">{(COURSE_STATUS[liveStatus(versionCourse)] ?? { text: "状态未知" }).text} · {versionCourse.v}{hiddenTag(versionCourse) && <> {hiddenTag(versionCourse)}</>}</Fact>
                <Fact k="学完发" unit={versionCourse.rewardRaw === null ? undefined : "UVT/人"}>{versionCourse.rewardRaw === null ? NO_REWARD : uvtText(versionCourse.rewardRaw)}</Fact>
                <Fact k="分类">{categoryLabel(versionCourse.cat)}</Fact>
                <Fact k="形式和难度">{FORMAT_LABEL[versionCourse.format] ?? versionCourse.format} · {LEVEL_LABEL[versionCourse.level] ?? versionCourse.level}</Fact>
                <Fact k="预计时长">{durationText(versionCourse.duration)}</Fact>
              </Facts>
            </div>
            {(() => {
              // 线上课程按 App 的取法画：缺格用英文，读不全的语言整门不显示。草稿照存的稿画，缺的画成缺稿。
              const online = liveStatus(versionCourse) === "published";
              const copy = online ? appCopy(versionCourse, courseLang) : null;
              const hidden = online && courseLang !== "zh" && appHidden(versionCourse).includes(courseLang);
              return <AppCoursePreview lang={courseLang} title={copy ? copy.title : versionCourse[`title${courseLang === "zh" ? "Zh" : courseLang === "vi" ? "Vi" : "En"}` as "titleZh"]}
                body={copy ? copy.body : versionCourse[`body${courseLang === "zh" ? "Zh" : courseLang === "vi" ? "Vi" : "En"}` as "bodyZh"]} category={versionCourse.cat} format={versionCourse.format}
                level={versionCourse.level} duration={versionCourse.duration} reward={versionCourse.rewardRaw ?? ""} quizCount={versionCourse.quizQuestions.length}
                passScore={String(versionCourse.passScore ?? "")} retries={String(versionCourse.retryLimit ?? "")}
                hidden={hidden ? "标题、正文或测验题不全" : undefined}
                caption={copy?.english && !hidden ? "这种语言没填的部分，App 显示英文" : "App 里大致的样子；线上课程显示已发布的内容"} />;
            })()}
          </div>}
          {courseTab === "quiz" && <div className="rd-stack">
            <Facts>
              <Fact k="及格分">{versionCourse.passScore ?? "—"} 分（答对题数 ÷ 总题数 × 100，四舍五入）</Fact>
              <Fact k="最多重试">{versionCourse.retryLimit ?? "—"} 次</Fact>
              <Fact k="每人领几次">同一用户在同一版本只领一次</Fact>
              {(versionCourse.completionCondition || versionCourse.rewardEvent) && <>
                <Fact k="完成条件"><RetiredOption text={COMPLETION_LABEL[versionCourse.completionCondition ?? ""] ?? versionCourse.completionCondition} /></Fact>
                <Fact k="何时发奖"><RetiredOption text={REWARD_EVENT_LABEL[versionCourse.rewardEvent ?? ""] ?? versionCourse.rewardEvent} /></Fact>
              </>}
            </Facts>
            {(versionCourse.completionCondition || versionCourse.rewardEvent) && <p className="rd-note">{RETIRED_OPTIONS_VIEW_NOTE}</p>}
            {versionCourse.quizQuestions.length === 0 ? <BlockState state="empty" title="还没有测验题" detail="没有题的课不能发布。" />
              : <ol className="i6-quiz-view">
                {versionCourse.quizQuestions.map((q, index) => <li key={q.questionId || index}>
                  <p className="i6-quiz-view-q">{q.questionZh || "—"}<small>{q.questionId}</small></p>
                  <ul>{q.optionsZh.map((option, o) => <li key={o} data-correct={q.correctOptionIndex === o ? "" : undefined}>{option || "—"}{q.correctOptionIndex === o && <StatusTag tone="ok">正确答案</StatusTag>}</li>)}</ul>
                </li>)}
              </ol>}
          </div>}
          {courseTab === "versions" && <div className="rd-stack">
            <div className="i6-version-bar">
              <span className="i6-muted">线上 {versionCourse.v}；新版本先存草稿，发布后整体替换。时间为{BJ}。</span>
              {canWriteI7 && <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={versionsLoading ? "版本列表还在读取" : versionsError ? "版本列表没有读到" : undefined} onClick={() => newCourseVersion(versionCourse)}>新版本草稿</Button>}
            </div>
            {versionsError ? <BlockState state="error" title="版本列表没有读到" detail={versionsError} onRetry={() => setVersionsRetry((value) => value + 1)} />
              : <Table label="课程版本">
                <thead><tr><Th>版本</Th><Th>状态</Th><Th>中文标题</Th><Th align="right">学完发</Th><Th>更新时间</Th><Th align="right">操作</Th></tr></thead>
                <tbody>
                  {versionsLoading && <TableLoading columns={6} rows={3} />}
                  {!versionsLoading && courseVersions.map((row) => {
                    const status = VERSION_STATUS[row.status] ?? { text: "状态未知", tone: "warn" as StateTone };
                    const title = nexGridBrandText(String(row.payload.titleZh ?? row.payload.titleEn ?? "—"));
                    return <Tr key={`${row.courseId}-${row.version}`}>
                      <Td><Cell main={row.version} /></Td>
                      <Td><StatusTag tone={status.tone}>{status.text}</StatusTag></Td>
                      <Td grow><Cell main={title} title={title} /></Td>
                      <Td align="right"><Cell num={row.payload.rewardNex !== null} main={row.payload.rewardNex === null ? NO_REWARD : `${uvtText(row.payload.rewardNex)} UVT`} /></Td>
                      <Td><Cell main={row.updatedAt ? formatBusinessTimeCompact(row.updatedAt, "—") : "—"} /></Td>
                      <Td align="right" data-fit=""><span className="i6-row-actions">
                        {row.status === "DRAFT" && canWriteI7 && <>
                          <Button size="sm" variant="ghost" onClick={() => editCourseVersion(versionCourse, row)}>编辑草稿</Button>
                          <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden />} onClick={() => deleteCourseVersion(versionCourse, row)}>删除草稿</Button>
                        </>}
                        {row.status === "DRAFT" && canPublishI7 && <Button size="sm" variant="primary" onClick={() => publishCourseVersion(versionCourse, row)}>{Number(row.payload.rewardNex) > 0 ? "提交发布" : "发布"}</Button>}
                        {row.status === "SUPERSEDED" && canPublishI7 && <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} onClick={() => rollbackCourseVersion(versionCourse, row)}>回滚到此版本</Button>}
                        {row.status === "PUBLISHED" && <span className="i6-muted">当前线上版本</span>}
                      </span></Td>
                    </Tr>;
                  })}
                  {!versionsLoading && courseVersions.length === 0 && <TableMessage columns={6}>暂无历史版本</TableMessage>}
                </tbody>
              </Table>}
            {!versionsError && !versionsLoading && courseVersions.length > 0 && <Fold inset title="技术信息" summary="每个版本的修订号">
              <Facts>{courseVersions.map((row) => <Fact key={`${row.courseId}-${row.version}`} k={row.version}>修订号 {row.revision}</Fact>)}</Facts>
            </Fold>}
          </div>}
        </div>
      </section>}
    </Drawer>

    <CourseEditor open={!!courseEditor} requiredLanguages={requiredLanguages} spec={courseEditor?.spec ?? null} title={courseEditor?.title ?? ""} sub={courseEditor?.sub}
      onClose={() => setCourseEditor(null)} onSave={(form) => courseEditor?.save(form)} />
  </>;
}
