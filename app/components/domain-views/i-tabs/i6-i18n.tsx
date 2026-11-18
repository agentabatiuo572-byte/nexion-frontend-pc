"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * I6 多语言文案 / I7 教程中心共享数据与动作实现，按路由只渲染各自业务区。
 * 统一来源:后端 /content/i18n-learning/overview;空库时后端写入 MySQL 种子后再查出。
 * 操作确认 显式 edit 契约:奖励调整 / 换推荐课 = 调参传 edit;
 *   课程发布 / 词条发布 / 课程下架 = 处置不传 edit。
 * I 域唯一 amplifies = 课程奖励上调(B1 红线核验,SPEC §4 注:拒绝码 V4 目标 422,
 *   B1 现行 403,以收口裁定为准;审计带 coverageAtSubmit);其余动作 amplifies=false。
 * 完整性扫描 / 新建课程 / 编辑草稿 = 运营设定(仍需操作确认 + 留痕)→ openConfirm。
 */
import { useEffect, useState } from "react";
import { IContentReceiptError, type I18nMessagePairView, type I18nNamespaceView, type LearningCourseVersionView } from "@/lib/admin/i-client";
import type { ICtx } from "./types";
import { CONTENT_LANGUAGE_LABELS, Drawer, PaginationExemptionList } from "../design-kit";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminError } from "@/lib/admin/error-messages";
import { messageQualityIssues, messageVariables, type summarizePublishedI6Messages } from "@/lib/admin/i6-copy-quality";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { OPERATING_LANGUAGE_CODES, getRequiredContentLanguages, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

type NsFlt = "all" | "issues";
type CatFlt = string;

const NS_FLT: [NsFlt, string][] = [
  ["all", "全部"],
  ["issues", "有问题"],
];

type Namespace = I18nNamespaceView & { missing: number };
type I6I18nProps = { ctx: ICtx; requiredLanguages: readonly OperatingLanguageCode[]; publishedCoverage?: ReturnType<typeof summarizePublishedI6Messages> };
type IntegrityIssue = { code: string; kind: string; cnt: number; samples: string[]; status: string };
type HardcodedFinding = { location: string; rawCopy: string; suggestedKey: string; status: string };
type Course = {
  id: string; title: string; cat: string; icon: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  reward: number; featured: boolean; duration: string; v: string; status: string; body: string;
  titleZh: string; titleEn: string; titleVi: string; bodyZh: string; bodyEn: string; bodyVi: string;
  quizQuestions: { questionId: string; questionZh: string; questionEn: string; questionVi?: string; optionsZh: string[]; optionsEn: string[]; optionsVi?: string[]; correctOptionIndex: number }[];
  passScore?: number; retryLimit?: number; completionCondition?: string | null; rewardEvent?: string | null; revision: number;
};
const COURSE_ICON_BY_CAT: Record<string, string> = {
  Basics: "🚀",
  Earn: "⚡",
  Team: "🧬",
  Wealth: "💎",
  Security: "🛡",
};

function missingCourseLanguages(course: Pick<Course, "titleZh" | "titleEn" | "titleVi" | "bodyZh" | "bodyEn" | "bodyVi" | "quizQuestions">, required: readonly OperatingLanguageCode[]) {
  const suffixes = { en: "En", zh: "Zh", vi: "Vi" } as const;
  return required.filter((language) => {
    const suffix = suffixes[language];
    return !course[`title${suffix}`].trim() || !course[`body${suffix}`].trim() || course.quizQuestions.some((question) => {
      const options = question[`options${suffix}`];
      return !question[`question${suffix}`]?.trim() || !options || options.length !== question.optionsEn.length || options.some((option) => !option.trim());
    });
  });
}

export function I6I18n(props: I6I18nProps) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const authorities = session?.authorities ?? [];
  const canReadI6 = isSuperadmin || authorities.includes("content_i6_read");
  const canReadI7 = isSuperadmin || authorities.includes("content_i7_read");
  if (!canReadI6 && !canReadI7) {
    return <section className="l-card"><div className="l-b">你没有查看多语言词条或教程的权限。</div></section>;
  }
  return <>{canReadI6 && <I18nLearningPage {...props} view="i18n" />}{canReadI7 && <I18nLearningPage {...props} view="learn" />}</>;
}

function I18nLearningPage({ ctx, view, requiredLanguages, publishedCoverage }: I6I18nProps & { view: "i18n" | "learn" }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWriteI6 = isSuperadmin || !!session?.authorities.includes("content_i6_write");
  const canWriteI7 = isSuperadmin || !!session?.authorities.includes("content_i7_write");
  const canAdjustI7Reward = isSuperadmin || !!session?.authorities.includes("content_i7_course_reward_adjust");
  const canPublishI7 = canWriteI7 && canAdjustI7Reward;
  const propose = usePropose();
  const [nsFlt, setNsFlt] = useState<NsFlt>("all");
  const [catFlt, setCatFlt] = useState<CatFlt>("all");
  const [nsDrawerKey, setNsDrawer] = useState<string | null>(null);
  const [hcDrawer, setHcDrawer] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [selectedMessageKey, setSelectedMessageKey] = useState("");
  const [messageVersions, setMessageVersions] = useState<I18nMessagePairView[]>([]);
  const [messageVersionsLoading, setMessageVersionsLoading] = useState(false);
  const [versionCourseId, setVersionCourseId] = useState("");
  const [courseVersions, setCourseVersions] = useState<LearningCourseVersionView[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);
  const [versionsRetry, setVersionsRetry] = useState(0);
  const data = content.i18nLearning;
  useEffect(() => {
    setCourseVersions([]);
    setVersionsError(null);
    if (!versionCourseId) { setVersionsLoading(false); return; }
    let active = true;
    setVersionsLoading(true);
    actions.fetchI7CourseVersions(versionCourseId)
      .then((versions) => { if (active) setCourseVersions(versions); })
      .catch((error) => {
        if (active) {
          setVersionsError(displayAdminError(error));
        }
      })
      .finally(() => { if (active) setVersionsLoading(false); });
    return () => { active = false; };
  }, [actions, versionCourseId, content.i18nLearning, versionsRetry]);
  const I6_STATS = data?.stats ?? { totalKeys: 0, integrityIssues: 0, coursesOnline: 0, weeklyNexPayout: "—" };
  const MESSAGES = data?.messages ?? [];
  const completeLanguageCount = (message: I18nMessagePairView) => requiredLanguages.filter((language) => message[language].trim()).length;
  const NAMESPACES: Namespace[] = (data?.namespaces ?? []).map((row) => {
    const complete = publishedCoverage?.completeByNamespace.get(row.ns) ?? 0;
    return { ...row, coverage: row.keys ? Math.round(complete * 100 / row.keys) : 0, missing: row.keys - complete };
  });
  const nsDrawer = NAMESPACES.find((namespace) => namespace.ns === nsDrawerKey);
  const namespaceMessages = nsDrawer ? MESSAGES.filter((message) => message.namespace === nsDrawer.ns) : [];
  const INTEGRITY_ISSUES: IntegrityIssue[] = data?.integrityIssues ?? [];
  const HARDCODED_FINDINGS: HardcodedFinding[] = data?.hardcodedFindings ?? [];
  const COURSES: Course[] = (data?.courses ?? []).map((c) => ({
    id: c.id,
    title: c.titleZh || c.title,
    cat: c.category,
    icon: COURSE_ICON_BY_CAT[c.category] ?? "📘",
    format: c.format,
    level: c.level,
    reward: Number(c.rewardNex),
    featured: c.featured,
    duration: c.duration,
    v: c.version,
    status: c.status,
    body: c.body,
    titleZh: c.titleZh ?? "",
    titleEn: c.titleEn || "",
    titleVi: c.titleVi || "",
    bodyZh: c.bodyZh ?? "",
    bodyEn: c.bodyEn || "",
    bodyVi: c.bodyVi || "",
    quizQuestions: c.quizQuestions ?? [],
    passScore: c.passScore,
    retryLimit: c.retryLimit,
    completionCondition: c.completionCondition,
    rewardEvent: c.rewardEvent,
    revision: c.revision ?? 0,
  }));
  const TUTORIAL_REWARD_RANGE = data?.rewardRange ?? { min: 0, max: 0 };
  const TUTORIAL_FEATURED_DEFAULT = data?.featuredCourseId ?? "";
  const featuredCourse = COURSES.find((course) => course.id === TUTORIAL_FEATURED_DEFAULT);
  const TUTORIAL_METRICS = (data?.metrics ?? []).map((m) => ({ k: m.key, v: m.value }));
  const runBackend = <T,>(task: Promise<T>, ok: string | ((result: T) => string)) => {
    return task
      .then(async (result) => {
        await actions.reloadIContent();
        toast(typeof ok === "string" ? ok : ok(result));
      })
      .catch((error) => {
        const message = displayAdminError(error);
        toast(error instanceof IContentReceiptError ? message : `操作失败:${message}`);
        throw error;
      });
  };

  const allCourses = COURSES;
  const configuredCategories = (data?.categories ?? []).map((category) => category.trim()).filter(Boolean);
  const courseCategories = configuredCategories.length > 0
    ? configuredCategories
    : [...new Set(allCourses.map((course) => course.cat).filter(Boolean))];
  const categoryFilters: [CatFlt, string][] = [
    ["all", "全部"],
    ...courseCategories.map((category) => [category, `${COURSE_ICON_BY_CAT[category] ?? "📘"} ${{ Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" }[category] ?? category}`] as [CatFlt, string]),
  ];
  const liveReward = (c: Course): string => {
    return `${c.reward} UVT`;
  };
  const liveStatus = (c: Course): string =>
    c.status || "published";
  const liveFeatured = (): string =>
    TUTORIAL_FEATURED_DEFAULT;
  const selectedMessage = MESSAGES.find((message) => message.messageKey === selectedMessageKey) ?? MESSAGES[0];
  const missingLocales = selectedMessage ? requiredLanguages.filter((language) => !selectedMessage[language].trim()).map((language) => CONTENT_LANGUAGE_LABELS[language]) : [];
  const providedLanguages = selectedMessage ? OPERATING_LANGUAGE_CODES.filter((language) => selectedMessage[language].trim()) : [];
  const variables = selectedMessage ? messageVariables(selectedMessage, providedLanguages) : [];
  const variablesMatch = new Set(variables).size === 1;
  const qualityIssues = selectedMessage ? messageQualityIssues(selectedMessage, providedLanguages) : [];
  const publicationIssues = [
    ...missingLocales.map((locale) => `缺少${locale}文案`),
    ...(missingLocales.length === 0 && !variablesMatch ? ["已填写文案的变量不一致"] : []),
    ...qualityIssues,
    ...(selectedMessage?.status === "draft" && missingLocales.length === 0 && providedLanguages.length < OPERATING_LANGUAGE_CODES.length
      ? ["该草稿需先重新保存，才能发布已存内容"] : []),
  ];
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
  const filteredMessages = MESSAGES.filter((message) => {
    const query = messageSearch.trim().toLowerCase();
    return !query || message.messageKey.toLowerCase().includes(query) || message.namespace.toLowerCase().includes(query);
  });
  const statusLabel = (status?: string) => ({ draft: "草稿", published: "已发布", archived: "已归档" }[status ?? ""] ?? "状态未知");
  const categoryLabel = (value: string) => ({ Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" }[value] ?? "其他分类");
  const formatLabel = (value: string) => ({ Article: "图文", Video: "视频", "Hands-on": "实操" }[value] ?? value);
  const levelLabel = (value: string) => ({ Beginner: "入门", Intermediate: "进阶", Advanced: "高级" }[value] ?? value);

  const filteredNs = NAMESPACES.filter((n) => {
    if (nsFlt === "all") return true;
    if (nsFlt === "issues") return n.missing > 0;
    return false;
  });
  const filteredCrs = allCourses.filter((c) => catFlt === "all" || c.cat === catFlt);
  const versionCourse = allCourses.find((course) => course.id === versionCourseId);
  const courseCategoryCount = courseCategories.length;

  /* ============ I6 actions ============ */
  const liveIntegrity = Math.max(0, I6_STATS.integrityIssues);
  const liveIntegritySub = (() => {
    const remain = INTEGRITY_ISSUES.filter((iss) => iss.status !== "fixed");
    if (remain.length === 0) return "已全部修复 · 待重扫确认清零";
    return remain.map((r) => `${r.kind.split(" ")[0]} ${r.cnt}`).join(" · ");
  })();
  const rescan = () =>
    openConfirm({ briefKind: "record",
      errorHandled: true,
      action: <>全量重扫 {I6_STATS.totalKeys} 词条</>,
      detail: <>检查缺少翻译、变量不一致、占位文字、旧品牌名、写死的文字和禁用词。只检查不修改，结果会刷新到下表。</>,
      chips: [["只读扫描 · 普通确认", "done"]],
      okLabel: "开始扫描",
      run: () => runBackend(actions.rescanI6("全量重扫词条完整性"), "检查完成，请看下表的问题"),
    });

  const editKeyDraft = async () => selectedMessage &&
    openActionConfirm({ briefKind: "config",
      action: <>编辑词条草稿 · {selectedMessage.messageKey}</>,
      detail: (
        <>
          英文和运营区域语言必填，已填写语言的占位符须一致。保存只新增或更新版本草稿，不覆盖当前发布版。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "localized-copy",
        requiredLanguages: await getRequiredContentLanguages(),
        mode: "edit",
        keyName: selectedMessage.messageKey,
        zh: selectedMessage.zh,
        en: selectedMessage.en,
        vi: selectedMessage.vi,
      },
      run: (reason, _v, form) => {
        const messageKey = selectedMessage.messageKey;
        setSelectedMessageKey(messageKey);
        return runBackend(actions.saveI6LocalizedDraft(messageKey, {
          zh: form?.zh || "",
          en: form?.en || "",
          vi: form?.vi || "",
          expectedVersion: selectedMessage.version,
        }, reason), `${messageKey} 草稿已保存 · 当前发布版未被覆盖`);
      },
    });

  const pubKey = () =>
    openActionConfirm({ briefKind: "content",
      action: <>发布词条 · {selectedMessage?.messageKey ?? "未选择"} {selectedMessage?.version ?? ""}</>,
      detail: (
        <>
          发布前检查：<b>必填语言{missingLocales.length === 0 ? "完整 ✓" : `待补齐（${missingLocales.join("、")}）`}</b>；
          <b>变量{missingLocales.length > 0 ? "尚未检查（请先补齐必填语言）" : variablesMatch ? `一致 ✓（${variables[0] || "无变量"}）` : "不一致"}</b>；
          <b>占位文字与旧品牌{qualityIssues.length === 0 ? "检查通过 ✓" : `检查未通过：${qualityIssues.join("、")}`}</b>。
          发布后用户下次加载该词条时使用新版本。系统提交时仍会核对发布条件。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        if (!selectedMessage || selectedMessage.status !== "draft" || publicationIssues.length > 0) return false;
        return runBackend(actions.publishI6LocalizedMessage(selectedMessage.messageKey, {
          zh: selectedMessage.zh,
          en: selectedMessage.en,
          vi: selectedMessage.vi,
          expectedVersion: selectedMessage.version,
        }, reason), `${selectedMessage.messageKey} ${selectedMessage.version} 已发布`);
      },
    });

  const archiveKey = () => selectedMessage && openActionConfirm({ briefKind: "record",
    action: <>归档词条 · {selectedMessage.messageKey}</>,
    detail: <>归档后不再显示，历史版本和操作记录仍保留。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.archiveI6LocalizedMessage(
      selectedMessage.messageKey,
      selectedMessage.version,
      reason,
    ), `${selectedMessage.messageKey} 已归档`),
  });

  const rollbackMessageVersion = (target: I18nMessagePairView) =>
    selectedMessage && openActionConfirm({ briefKind: "content",
      action: <>回滚词条 · {selectedMessage.messageKey} → {target.version}</>,
      detail: <>
        把这个旧版本的中文、英文、越南语内容原样复制成一个新版本发布，旧记录不会被改动。
        当前版本 <b>{selectedMessage.version}</b>，回滚到 <b>{target.version}</b>。
      </>,
      amplifies: false,
      run: (reason) => runBackend(actions.rollbackI6LocalizedMessage(
        selectedMessage.messageKey,
        target,
        selectedMessage.version,
        reason,
      ), `${selectedMessage.messageKey} 已从 ${target.version} 恢复为新发布版本`),
    });

  const fixIntegrity = async (issue: IntegrityIssue) => {
    const target = selectedMessage && issue.samples.includes(selectedMessage.messageKey)
      ? selectedMessage
      : issue.samples.map((key) => MESSAGES.find((message) => message.messageKey === key)).find(Boolean);
    if (!target) {
      toast("这个问题没有可修复的已注册词条，请先重扫");
      return;
    }
    openActionConfirm({ briefKind: "config",
      action: <>修复完整性问题 · {issue.kind}</>,
      detail: (
        <>
          {issue.kind} 共 <b>{issue.cnt}</b> 处。在下面补齐这条已注册词条的英文和运营区域语言、修正变量。保存后点「重扫」更新问题数；发布时只检查要发布的那条词条草稿。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "localized-copy",
        requiredLanguages: await getRequiredContentLanguages(),
        mode: "edit",
        keyName: target.messageKey,
        zh: target.zh,
        en: target.en,
        vi: target.vi,
      },
      run: (reason, _v, form) => {
        return runBackend(actions.fixI6Integrity(issue.code, {
          messageKey: target.messageKey,
          zh: form?.zh || "",
          en: form?.en || "",
          vi: form?.vi || "",
        }, reason), (result) => `${issue.kind} ${result.repairedCount} 处已修复 · 待重扫确认`);
      },
    });
  };

  /* ============ tutorial actions ============ */
  const pubCrs = (c: Course) =>
    openActionConfirm({ briefKind: "content",
      action: <>发布课程新版 · {nexGridBrandText(c.title)}</>,
      detail: (
        <>
          分类「{categoryLabel(c.cat)}」 · 奖励 {c.reward} UVT/课。发布到 /learn。{c.reward > 0 ? "带奖励的课程发布要走审批，当前页面还不能提交审批，后台会拒绝直接发布。" : "发布后直接生效。"}
        </>
      ),
      amplifies: false,
      run: async (reason) => {
        const missing = missingCourseLanguages(c, await getRequiredContentLanguages());
        if (missing.length > 0) {
          toast(`请先补齐课程：${missing.map((language) => CONTENT_LANGUAGE_LABELS[language]).join("、")}`);
          return false;
        }
        return runBackend(actions.publishI6Course(c.id, c.v, reason), `${nexGridBrandText(c.title)} 已发布至 /learn`);
      },
    });

  // 唯一 amplifies = 课程奖励调整。
  const adjRwd = (c: Course) =>
    openActionConfirm({ briefKind: "config",
      action: <>课程奖励调整 · {nexGridBrandText(c.title)}</>,
      detail: (
        <>
          分类「{categoryLabel(c.cat)}」完成 UVT 奖励调整 ·{" "}
          <b>调高奖励会多发 UVT</b>，覆盖率低于红线时无法保存。
        </>
      ),
      amplifies: true,
      edit: { kind: "number", current: String(c.reward), unit: "UVT/课", min: TUTORIAL_REWARD_RANGE.min, max: TUTORIAL_REWARD_RANGE.max, step: 1 },
      run: (reason, v) => {
        if (!v) return false;
        const def = findHighOp("i7_course_reward_adjust")!;
        return propose(toast, {
          action: `课程奖励调整 · ${nexGridBrandText(c.title)}`,
          obj: c.id,
          before: `${c.reward} UVT/课`,
          after: `${v} UVT/课`,
          type: "fund",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I7",
          command: def.buildCommand({ courseId: c.id, rewardNex: Number(v) }),
          target: def.buildTarget({ courseId: c.id }),
        });
      },
    });

  const archiveCrs = (c: Course) =>
    openActionConfirm({ briefKind: "content",
      action: <>下架课程 · {nexGridBrandText(c.title)}</>,
      detail: (
        <>
          下架后 /learn 不再展示该课;已开课用户保留进度,但完成奖励不再发放。常规换版直接发新版,只有正文/合规问题才下架。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        return runBackend(actions.archiveI6Course(c.id, c.v, reason), `${nexGridBrandText(c.title)} 已下架`);
      },
    });

  const coursePayload = (form?: Record<string, string>, expectedRevision?: number, retiredOptions?: Pick<Course, "completionCondition" | "rewardEvent">) => {
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
      rewardNex: Number(form?.reward),
      duration: form?.duration || "5 min",
      publishState: "draft",
      quizQuestions,
      passScore: Number(form?.passScore),
      retryLimit: Number(form?.retries),
      ...retiredOptions,
      expectedRevision,
      version: form?.version || undefined,
    };
  };

  const newCrs = async () =>
    openActionConfirm({ briefKind: "config",
      action: <>新建课程(存为草稿)</>,
      detail: (
        <>
          填 课程标识 / 分类 / 形式 / 难度 / 奖励（{TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} UVT）；标题、正文和测验须填写英文和运营区域语言。草稿用户看不到；发布时需要确认，带奖励的课程发布还要审批。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "course-authoring",
        requiredLanguages: await getRequiredContentLanguages(),
        mode: "create",
        rewardMin: TUTORIAL_REWARD_RANGE.min,
        rewardMax: TUTORIAL_REWARD_RANGE.max,
        categories: courseCategories,
        formats: data?.formats,
        levels: data?.levels,
      },
      run: (reason, slug, form) => {
        const id = slug?.trim() || "new";
        return runBackend(actions.createI6Course(id, coursePayload(form), reason), "课程草稿已创建");
      },
    });

  const editCrs = async (c: Course) => openActionConfirm({ briefKind: "config",
    action: <>编辑课程草稿 · {nexGridBrandText(c.title)}</>,
    detail: <>只有草稿可以编辑；测验按题目和选项填写。</>,
    amplifies: false,
    businessForm: {
      kind: "course-authoring",
      requiredLanguages: await getRequiredContentLanguages(),
      mode: "edit",
      rewardMin: TUTORIAL_REWARD_RANGE.min,
      rewardMax: TUTORIAL_REWARD_RANGE.max,
      categories: courseCategories,
      formats: data?.formats,
      levels: data?.levels,
      current: {
        slug: c.id, version: c.v, category: c.cat, format: c.format, difficulty: c.level, duration: c.duration, reward: c.reward,
        titleZh: c.titleZh, titleEn: c.titleEn, titleVi: c.titleVi, bodyZh: c.bodyZh, bodyEn: c.bodyEn, bodyVi: c.bodyVi,
        quizQuestions: c.quizQuestions, passScore: c.passScore, retryLimit: c.retryLimit,
        completionCondition: c.completionCondition, rewardEvent: c.rewardEvent,
      },
    },
    run: (reason, _slug, form) => runBackend(actions.updateI7CourseDraft(c.id, coursePayload(form, c.revision, courseRetiredOptions(c)), reason), `${nexGridBrandText(c.title)} 草稿已更新`),
  });

  const deleteCrs = (c: Course) => openActionConfirm({ briefKind: "record",
    action: <>删除课程草稿 · {nexGridBrandText(c.title)}</>,
    detail: <>只能删除还没发布的草稿；已发布或已归档的课程不能删除。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI7CourseDraft(c.id, reason), `${nexGridBrandText(c.title)} 草稿已删除`),
  });

  const courseRetiredOptions = (c: Course, payload?: LearningCourseVersionView["payload"]) => ({
    completionCondition: payload ? payload.completionCondition : c.completionCondition,
    rewardEvent: payload ? payload.rewardEvent : c.rewardEvent,
  });

  const courseCurrent = (c: Course, version: string, payload?: LearningCourseVersionView["payload"]) => ({
    slug: c.id,
    version,
    category: String(payload?.category ?? c.cat),
    format: String(payload?.format ?? c.format),
    difficulty: String(payload?.difficulty ?? c.level),
    duration: String(payload?.duration ?? c.duration),
    reward: Number(payload?.rewardNex ?? c.reward),
    titleZh: String(payload?.titleZh ?? c.titleZh), titleEn: String(payload?.titleEn ?? c.titleEn), titleVi: String(payload?.titleVi ?? c.titleVi),
    bodyZh: String(payload?.bodyZh ?? c.bodyZh), bodyEn: String(payload?.bodyEn ?? c.bodyEn), bodyVi: String(payload?.bodyVi ?? c.bodyVi),
    quizQuestions: (Array.isArray(payload?.quizQuestions) ? payload.quizQuestions : c.quizQuestions) as Course["quizQuestions"],
    passScore: Number(payload?.passScore ?? c.passScore ?? 60), retryLimit: Number(payload?.retryLimit ?? c.retryLimit ?? 3),
    ...courseRetiredOptions(c, payload),
  });

  const newCourseVersion = async (c: Course) => {
    const maxVersion = Math.max(Number(c.v.replace(/^v/i, "")) || 0,
      ...courseVersions.map((row) => Number(row.version.replace(/^v/i, "")) || 0));
    openActionConfirm({ briefKind: "config",
      action: <>新建课程版本草稿 · {nexGridBrandText(c.title)}</>,
      detail: <>当前发布版继续服务用户；新版本在独立草稿中编辑，发布后才原子替换当前版。</>,
      amplifies: false,
      businessForm: {
        kind: "course-authoring", mode: "version-create", rewardMin: TUTORIAL_REWARD_RANGE.min, rewardMax: TUTORIAL_REWARD_RANGE.max,
        requiredLanguages: await getRequiredContentLanguages(),
        categories: courseCategories, formats: data?.formats, levels: data?.levels,
        current: courseCurrent(c, `v${maxVersion + 1}`),
      },
      run: (reason, _value, form) => runBackend(
        actions.createI7CourseVersion(c.id, coursePayload(form, undefined, courseRetiredOptions(c)), reason), `${nexGridBrandText(c.title)} ${form?.version} 草稿已创建`),
    });
  };

  const editCourseVersion = async (c: Course, row: LearningCourseVersionView) => openActionConfirm({ briefKind: "config",
    action: <>编辑课程版本草稿 · {nexGridBrandText(c.title)} {row.version}</>,
    detail: <>英文和运营区域语言的正文与测验须填写完整。如果别人刚改过，需要刷新后重改。</>,
    amplifies: false,
    businessForm: {
      kind: "course-authoring", mode: "version-edit", rewardMin: TUTORIAL_REWARD_RANGE.min, rewardMax: TUTORIAL_REWARD_RANGE.max,
      requiredLanguages: await getRequiredContentLanguages(),
      categories: courseCategories, formats: data?.formats, levels: data?.levels,
      current: courseCurrent(c, row.version, row.payload),
    },
    run: (reason, _value, form) => runBackend(
      actions.updateI7CourseVersion(c.id, row.version, coursePayload(form, row.revision, courseRetiredOptions(c, row.payload)), reason), `${nexGridBrandText(c.title)} ${row.version} 草稿已更新`),
  });

  const deleteCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({ briefKind: "record",
    action: <>删除课程版本草稿 · {nexGridBrandText(c.title)} {row.version}</>,
    detail: <>只能删除草稿；已发布和历史版本不能删除，以免影响用户进度和奖励。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI7CourseVersion(c.id, row.version, reason), `${row.version} 草稿已删除`),
  });

  const publishCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({ briefKind: "content",
    action: <>发布课程版本 · {nexGridBrandText(c.title)} {row.version}</>,
    detail: <>发布前会检查必填语言的测验、兑付覆盖率和权限；发布后旧版本变为历史版本。{Number(row.payload?.rewardNex ?? c.reward) > 0 ? "这个版本带奖励，发布要走审批，当前页面还不能提交审批，后台会拒绝直接发布。" : ""}</>,
    amplifies: true,
    run: async (reason) => {
      const missing = missingCourseLanguages(courseCurrent(c, row.version, row.payload), await getRequiredContentLanguages());
      if (missing.length > 0) {
        toast(`请先补齐课程版本：${missing.map((language) => CONTENT_LANGUAGE_LABELS[language]).join("、")}`);
        return false;
      }
      return runBackend(actions.publishI7CourseVersion(c.id, row.version, reason), `${row.version} 已发布`);
    },
  });

  const rollbackCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({ briefKind: "content",
    action: <>回滚课程版本 · {nexGridBrandText(c.title)} → {row.version}</>,
    detail: <>回滚后课程内容、测验和奖励设置一起恢复成这个版本；已领过奖励的用户不会重复领取。{Number(row.payload?.rewardNex ?? 0) > 0 ? "目标版本带奖励，回滚要走审批（等额、降额也算），当前页面还不能提交审批，后台会拒绝直接回滚。" : ""}</>,
    amplifies: true,
    run: (reason) => runBackend(actions.rollbackI7CourseVersion(c.id, row.version, reason), `已回滚到 ${row.version}`),
  });

  const setFeat = () => {
    const cur = liveFeatured();
    const publishedCourseOptions = COURSES.filter((course) => liveStatus(course) === "published").map((course) => course.id);
    const publishedCourseLabels = Object.fromEntries(COURSES.filter((course) => liveStatus(course) === "published").map((course) => [course.id, `${nexGridBrandText(course.title)}（${course.id}）`]));
    openActionConfirm({ briefKind: "content",
      action: <>更换推荐位课程</>,
      detail: (
        <>
          推荐位是首页大卡的单一展示位 · 换课等于改变所有用户的首页主推教程；只能从已发布课程中选择。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: cur, options: publishedCourseOptions, optionLabels: publishedCourseLabels, unit: "课程" },
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

  /* ============ render helpers ============ */
  const renderCoverage = (n: Namespace) => {
    if (n.coverage === 100 && n.missing === 0) return <span className="in-full">100% ✓</span>;
    return (
      <>
        <span className="in-cov">
          <i style={{ width: n.coverage + "%" }} />
        </span>
        <span
          className="mono"
          style={{ fontSize: 11.5, marginLeft: 7, color: "var(--warning)" }}
        >
          {n.coverage}%
        </span>
      </>
    );
  };

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">{view === "i18n" ? "多语言词条" : "教程"}数据加载中…</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">暂无{view === "i18n" ? "多语言词条" : "教程"}数据</div></div></section>;
  }

  /* ============ render ============ */
  return (
    <>
      {view === "i18n" && <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管词条</div>
          <div className="v">
            {publishedCoverage?.managedKeys ?? 0} / {I6_STATS.totalKeys}
          </div>
          <div className="sub">已发布词条 · 必填语言</div>
        </div>
        <div className={`f-stat ${liveIntegrity === 0 ? "ok" : "warn"}`}>
          <div className="k">完整性问题</div>
          <div className="v">{liveIntegrity} 处</div>
          <div className="sub">{liveIntegritySub}</div>
        </div>
      </div>

      {/* (I6 · a) 命名空间矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">词条分组</span>
          <span className="sub">· 按有效发布版本汇总必填语言覆盖率</span>
          <div className="r chips">
            {NS_FLT.map(([k, l]) => (
              <button
                key={k}
                className={`chip${nsFlt === k ? " sel" : ""}`}
                onClick={() => setNsFlt(k)}
              >
                {l}
              </button>
            ))}
            {canWriteI6 && <button className="l-btn sm" onClick={rescan}>
              重扫
            </button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>命名空间</th>
                <th className="num">词条数</th>
                <th>覆盖</th>
                <th className="num">缺少词条</th>
                <th>进行中变体</th>
                <th>最近改动</th>
              </tr>
            </thead>
            <tbody>
              {filteredNs.map((n) => (
                  <tr
                    key={n.ns}
                    className="click"
                    onClick={() => setNsDrawer(n.ns)}
                  >
                    <td>
                      <span className="ns-name">{({conversation:"客服会话",home:"首页",learn:"学习课程",test:"测试词条"} as Record<string,string>)[n.ns] ?? n.ns}</span>
                    </td>
                    <td className="num mono">{n.keys}</td>
                    <td>{renderCoverage(n)}</td>
                    <td
                      className="num mono"
                      style={{ color: n.missing > 0 ? "var(--warning)" : "var(--ink-4)" }}
                    >
                      {n.missing > 0 ? n.missing : "—"}
                    </td>
                    <td
                      style={{
                        fontSize: 12,
                        color:
                          n.variants === "—" ? "var(--ink-4)" : "var(--i-ac)",
                      }}
                    >
                      {n.variants}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {n.lastChange}
                    </td>
                  </tr>
              ))}
              <tr>
                <td
                  colSpan={6}
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink-4)",
                    textAlign: "center",
                  }}
                >
                  共 {NAMESPACES.length} 命名空间 · {MESSAGES.length} 词条
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">词条列表</span>
          <span className="sub">· 选择任意词条后编辑、发布或归档</span>
          <div className="r">
            <input
              className="fld"
              aria-label="搜索词条"
              placeholder="搜索词条标识 / 分类"
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              style={{ width: 210 }}
            />
            <span className="sub">只能维护当前已注册词条</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>词条标识</th><th>命名空间</th><th>版本</th><th>状态</th><th>语言完整度</th><th></th></tr></thead>
            <tbody>
              {filteredMessages.map((message) => {
                const languageCount = completeLanguageCount(message);
                const selected = selectedMessage?.messageKey === message.messageKey;
                return <tr key={message.messageKey} className="click" onClick={() => setSelectedMessageKey(message.messageKey)}>
                  <td className="mono" style={{ fontWeight: selected ? 700 : 500 }}>{message.messageKey}</td>
                  <td>{({conversation:"客服会话",home:"首页",learn:"学习课程",test:"测试词条"} as Record<string,string>)[message.namespace] ?? message.namespace}</td>
                  <td className="mono">{message.version}</td>
                  <td><span className={`bdg ${message.status === "published" ? "ok" : message.status === "draft" ? "warn" : "dim"}`}>{statusLabel(message.status)}</span></td>
                  <td>{languageCount}/{requiredLanguages.length} · {languageCount === requiredLanguages.length ? "必填语言完整" : "待补齐"}</td>
                  <td style={{ textAlign: "right" }}><button className="l-btn sm" aria-label={`选择 ${message.messageKey}`} onClick={(event) => { event.stopPropagation(); setSelectedMessageKey(message.messageKey); }}>选择</button></td>
                </tr>;
              })}
              {filteredMessages.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)" }}>暂无符合条件的真实词条</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        {/* (I6 · b) 真实词条详情 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">
              词条详情 · <span className="icode electric">{selectedMessage?.messageKey ?? "未选择"}</span>
            </span>
            <div className="r">
              {!canWriteI6 && <span className="bdg dim">只读</span>}
              {canWriteI6 && selectedMessage && <>
              <button className="l-btn sm" onClick={editKeyDraft}>
                编辑词条草稿
              </button>
              {selectedMessage.status === "draft" && <button className="l-btn sm mc" disabled={publicationIssues.length > 0} onClick={pubKey}>
                发布
              </button>}
              {selectedMessage.status === "published" && <button className="l-btn sm" onClick={archiveKey}>归档</button>}
              </>}
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            {selectedMessage ? <>
              {selectedMessage.status === "draft" && publicationIssues.length > 0 && <div className="itint warn" role="status">暂不能发布：{publicationIssues.join("；")}。请编辑词条草稿后再发布。</div>}
              <div className="ab-grid">
                <div className="ab-prev"><div className="lc">中文 · {statusLabel(selectedMessage.status)}</div><div className="tx">{selectedMessage.zh || (requiredLanguages.includes("zh") ? "待补齐" : "—")}</div></div>
                <div className="ab-prev"><div className="lc">英文 · {statusLabel(selectedMessage.status)}</div><div className="tx">{selectedMessage.en || "待补齐"}</div></div>
                <div className="ab-prev"><div className="lc">越南语 · {statusLabel(selectedMessage.status)}</div><div className="tx">{selectedMessage.vi || (requiredLanguages.includes("vi") ? "待补齐" : "—")}</div></div>
              </div>
              <div className={`itint ${missingLocales.length === 0 ? "ok" : "warn"}`} style={{ marginTop: 8 }}>
                <b>已存内容</b> · 版本 {selectedMessage.version} · 变量 {selectedMessage.placeholders.length ? selectedMessage.placeholders.join("、") : "无"}。草稿保存不会覆盖当前发布版。
              </div>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table className="l-tbl" style={{ minWidth: 520 }}>
                  <thead><tr><th>历史版本</th><th>状态</th><th>必填语言完整度</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
                  <tbody>
                    {messageVersions.map((row) => {
                      const complete = completeLanguageCount(row);
                      return <tr key={`${row.messageKey}-${row.version}`}>
                        <td className="mono">{row.version}</td>
                        <td>{statusLabel(row.status)}</td>
                        <td>{complete}/{requiredLanguages.length}</td>
                        <td style={{ textAlign: "right" }}>
                          {canWriteI6 && row.status === "archived" && selectedMessage.status !== "draft"
                            ? <button className="l-btn sm mc" onClick={() => rollbackMessageVersion(row)}>回滚到此版本</button>
                            : row.version === selectedMessage.version
                              ? <span className="muted">当前版本</span>
                              : <span className="muted">仅保留</span>}
                        </td>
                      </tr>;
                    })}
                    {!messageVersionsLoading && messageVersions.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-4)" }}>暂无历史版本</td></tr>}
                    {messageVersionsLoading && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-4)" }}>版本加载中…</td></tr>}
                  </tbody>
                </table>
              </div>
            </> : <div className="itint">暂无真实词条，请先选择已注册词条；新词条标识需随应用版本登记后再维护。</div>}
          </div>
        </section>

        {/* 完整性扫描卡 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">
              完整性扫描 · {liveIntegrity} 处问题
            </span>
            <span className="sub">· 缺翻译 / 变量不一致 / 占位文字 / 旧品牌名 / 写死的文字 / 禁用词</span>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            {INTEGRITY_ISSUES.map((iss) => (
              <div key={iss.kind} style={{ marginBottom: 12 }}>
                <div
                  className="row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <b style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{iss.kind}</b>
                  <span className="bdg warn">{iss.cnt}</span>
                </div>
                {iss.samples.map((s, j) => (
                  <div
                    key={j}
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      paddingLeft: 4,
                      lineHeight: 1.6,
                    }}
                  >
                    · {s}
                  </div>
                ))}
                {iss.cnt > 0 && canWriteI6 && <button
                  className="l-btn sm mc"
                  style={{ marginTop: 6 }}
                  onClick={() => fixIntegrity(iss)}
                >
                  修复
                </button>}
                {iss.cnt === 0 && <span className="tiny">无需修复</span>}
              </div>
            ))}
            <button
              className="l-btn sm"
              style={{ marginTop: 4 }}
              onClick={() => setHcDrawer(true)}
            >
              疑似硬编码清单(App 扫描)
            </button>
          </div>
        </section>
      </div>

      </>}

      {view === "learn" && <>
      <div className="f-stats">
        <div className="f-stat cyan">
          <div className="k">课程在线</div>
          <div className="v">{I6_STATS.coursesOnline} 门</div>
          <div className="sub">{courseCategoryCount} 分类 · 推荐位 {TUTORIAL_FEATURED_DEFAULT ? 1 : 0} 个</div>
        </div>
        <div className="f-stat">
          <div className="k">本周课程发放 UVT</div>
          <div className="v">{operatorCopyText(I6_STATS.weeklyNexPayout)}</div>
          <div className="sub">学完课程发放，计入兑付统计</div>
        </div>
      </div>

      {/* I7 教程列表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">教程中心 · /learn · {allCourses.length} 门课</span>
          <span className="sub">
            · {courseCategoryCount} 个分类 · 学完发 UVT · 调高奖励要求覆盖率不低于红线
          </span>
          <div className="r chips">
            {categoryFilters.map(([k, l]) => (
              <button
                key={k}
                className={`chip${catFlt === k ? " sel" : ""}`}
                onClick={() => setCatFlt(k)}
              >
                {l}
              </button>
            ))}
            {!canWriteI7 && <span className="bdg dim">只读</span>}
            {canWriteI7 && <button className="l-btn sm primary" onClick={newCrs}>
              + 新建课程
            </button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>课程</th>
                <th>分类</th>
                <th>形式</th>
                <th>难度</th>
                <th className="num">奖励</th>
                <th>推荐位</th>
                <th>时长</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredCrs.map((c) => {
                const st = liveStatus(c);
                const archived = st === "archived";
                const isDraft = st === "draft" || st === "ready";
                const featuredId = liveFeatured();
                const isFeatured = featuredId === c.id;
                return (
                  <tr key={c.id} style={archived ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                        {nexGridBrandText(c.title)}
                      </div>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: "var(--ink-4)",
                        }}
                      >
                        {c.id}
                      </span>
                    </td>
                    <td>
                      <span className="bdg dim">
                        {c.icon} {categoryLabel(c.cat)}
                      </span>
                    </td>
                    <td>
                      <span className="bdg dim">{formatLabel(c.format)}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {levelLabel(c.level)}
                    </td>
                    <td
                      className="num mono"
                      style={{ color: "var(--i-ac)", fontWeight: 700 }}
                    >
                      {liveReward(c)}
                    </td>
                    <td>
                      {isFeatured ? (
                        <span className="bdg cyan">推荐</span>
                      ) : (
                        <span style={{ color: "var(--ink-4)" }}>—</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {operatorCopyText(c.duration)}
                    </td>
                    <td>
                      {archived ? (
                        <span className="bdg dim">已下架</span>
                      ) : isDraft ? (
                        <span className="bdg warn">{statusLabel(st)}</span>
                      ) : (
                        <span className="bdg ok">{statusLabel(st)}</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <button className="l-btn sm" aria-label={`版本管理 ${nexGridBrandText(c.title)}`} onClick={() => setVersionCourseId(c.id)} style={{ marginRight: 6 }}>版本管理</button>
                      {canWriteI7 && <>
                      {isDraft && <>
                      <button className="l-btn sm" aria-label={`编辑 ${nexGridBrandText(c.title)}`} onClick={() => editCrs(c)} style={{ marginRight: 6 }}>编辑</button>
                      {canPublishI7 && <button className="l-btn sm mc" aria-label={`发布 ${nexGridBrandText(c.title)}`} onClick={() => pubCrs(c)} style={{ marginRight: 6 }}>发布</button>}
                      <button className="l-btn sm" aria-label={`删除草稿 ${nexGridBrandText(c.title)}`} onClick={() => deleteCrs(c)} style={{ marginRight: 6 }}>删除草稿</button>
                      </>}
                      {!archived && !isDraft && (
                        <button
                          className="l-btn sm"
                          aria-label={`下架 ${nexGridBrandText(c.title)}`}
                          onClick={() => archiveCrs(c)}
                        >
                          下架
                        </button>
                      )}
                      </>}
                      {canAdjustI7Reward && !archived && !isDraft && (
                        <button
                          className="l-btn sm mc"
                          aria-label={`调整奖励 ${nexGridBrandText(c.title)}`}
                          onClick={() => adjRwd(c)}
                          style={{ marginRight: 6 }}
                        >
                          调奖励
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!contentLoading && filteredCrs.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 28, textAlign: "center", color: "var(--ink-4)" }}>
                    暂无课程数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {versionCourse && <section className="l-card" data-proof="i7-course-version-crud">
        <div className="l-h">
          <span className="ttl">课程版本列表 · {nexGridBrandText(versionCourse.title)}</span>
          <span className="sub">· 当前 {versionCourse.v}</span>
          <div className="r chips">
            {canWriteI7 && <button className="l-btn sm primary" disabled={versionsLoading || !!versionsError} onClick={() => newCourseVersion(versionCourse)}>+ 新版本草稿</button>}
            <button className="l-btn sm" onClick={() => setVersionCourseId("")}>关闭</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 840 }}>
            <thead><tr><th>版本</th><th>状态</th><th>说明</th><th>修订号</th><th>更新时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {!versionsLoading && !versionsError && courseVersions.map((row) => {
                const statusText = { DRAFT: "草稿", PUBLISHED: "已发布", SUPERSEDED: "历史版本" }[row.status] ?? "状态未知";
                return <tr key={`${row.courseId}-${row.version}`}>
                  <td className="mono">{row.version}</td>
                  <td><span className={`bdg ${row.status === "DRAFT" ? "warn" : row.status === "PUBLISHED" ? "ok" : "dim"}`}>{statusText}</span></td>
                  <td>{nexGridBrandText(String(row.payload.titleZh ?? row.payload.titleEn ?? "—"))}</td>
                  <td className="mono">{row.revision}</td>
                  <td className="mono">{row.updatedAt ? new Date(row.updatedAt).toLocaleString("zh-CN") : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.status === "DRAFT" && canWriteI7 && <>
                      <button className="l-btn sm" onClick={() => editCourseVersion(versionCourse, row)} style={{ marginRight: 6 }}>编辑草稿</button>
                      <button className="l-btn sm" onClick={() => deleteCourseVersion(versionCourse, row)} style={{ marginRight: 6 }}>删除草稿</button>
                    </>}
                    {row.status === "DRAFT" && canPublishI7 && <button className="l-btn sm mc" onClick={() => publishCourseVersion(versionCourse, row)}>发布</button>}
                    {row.status === "SUPERSEDED" && canPublishI7 && <button className="l-btn sm mc" onClick={() => rollbackCourseVersion(versionCourse, row)}>回滚到此版本</button>}
                    {row.status === "PUBLISHED" && <span className="muted">当前线上版本</span>}
                  </td>
                </tr>;
              })}
              {versionsError && <tr><td colSpan={6}><div className="itint warn" role="alert">版本列表加载失败：{versionsError}<button className="l-btn sm" style={{ marginLeft: 8 }} onClick={() => setVersionsRetry((value) => value + 1)}>重试</button></div></td></tr>}
              {!versionsLoading && !versionsError && courseVersions.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>暂无历史版本</td></tr>}
              {versionsLoading && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>版本加载中…</td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      <div className="two-col">
        {/* I6 推荐位 + 奖励区间 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">推荐位 + 单课奖励区间</span>
            <span className="sub">· 单一位置,换课走操作确认</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="in-vrow">
              <span className="nm">
                推荐位课程(首页大卡)
                <small>
                  当前：{featuredCourse ? nexGridBrandText(featuredCourse.title) : "未设置推荐课程"} · 单一位置，换课走操作确认
                </small>
              </span>
              <span className="v">{featuredCourse ? nexGridBrandText(featuredCourse.title) : "未设置"}</span>
              {canWriteI7 && <button className="l-btn sm mc" onClick={setFeat}>
                换推荐课
              </button>}
            </div>
            <div className="in-vrow">
              <span className="nm">
                单课奖励区间
                <small>当前奖励范围 10–50 UVT;单课精确值在课程行上调</small>
              </span>
              <span className="v">
                {TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} UVT
              </span>
            </div>
          </div>
        </section>

        {/* I7 课程效果监控 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">课程效果监控</span>
            <span className="sub">
              · 只读 · 数据会进入数据分析和资金对账
            </span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
              }}
            >
              {TUTORIAL_METRICS.map((m) => (
                <div key={operatorCopyText(String(m.k))}>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-4)",
                      marginBottom: 4,
                    }}
                  >
                    {operatorCopyText(String(m.k))}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--ink)",
                      letterSpacing: "-.01em",
                    }}
                  >
                    {operatorCopyText(String(m.v))}
                  </div>
                </div>
              ))}
            </div>
            <div className="itint" style={{ marginTop: 10 }}>
              <b>数据</b> · 开始学习、学完、测验通过都会记录；奖励直接到用户钱包并记账。数据分析可以据此算完课率等指标，财务可以核对课程奖励支出。
            </div>
          </div>
        </section>
      </div>

      </>}

      <p className="f-foot">
        {view === "i18n" ? <><b>权限</b>：保存词条草稿时会检查英文、运营区域语言和变量。发布、归档需要内容主管或超级管理员确认。<b>说明</b>：文案测试、推送、信任中心和教程的文字都来自这里的词条。</> : <><b>权限</b>：课程草稿可以直接保存；发布、下架、换推荐课需要内容主管或超级管理员确认。<b>带奖励的课程</b>（奖励大于 0）首次发布、发布新版本和回滚都要审批，且覆盖率不能低于红线；当前页面还不能提交这项审批。</>}
      </p>
      <PaginationExemptionList
        items={view === "i18n" ? [
          {
            label: "词条分组",
            kind: "reference-catalog",
            maxRows: Math.max(1, NAMESPACES.length),
            reason: `命名空间来自真实词条目录,当前 ${NAMESPACES.length} 组,需要同屏核对必填语言覆盖率和缺少词条`,
          },
        ] : [
          {
            label: `教程中心 · /learn · ${allCourses.length} 门课`,
            kind: "reference-catalog",
            maxRows: Math.max(1, allCourses.length),
            reason: `课程目录来自真实接口,当前 ${allCourses.length} 门;创建新课走草稿流`,
          },
        ]}
      />

      {view === "i18n" && nsDrawer && (
        <Drawer
          title={`命名空间 · ${nsDrawer.ns}`}
          onClose={() => setNsDrawer(null)}
        >
          <div
            className="tint brand"
            style={{ marginBottom: 14, padding: "11px 14px", borderRadius: 9 }}
          >
            <div
              style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}
            >
              {nsDrawer.keys} 个词条 · 必填语言覆盖 {nsDrawer.coverage}%
              {nsDrawer.variants !== "—"
                ? ` · ${nsDrawer.variants} 进行中`
                : ""}
            </div>
            <div
              className="muted tiny"
              style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-4)" }}
            >
              词条按标识组织，应用端按「空间 × 语言」整包拉取当前发布版。
            </div>
          </div>
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="l-tbl" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>词条标识</th>
                  <th>状态</th>
                  <th>语言完整度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {namespaceMessages.map((message) => {
                  const published = Object.hasOwn(data.publishedMessages, message.messageKey) ? data.publishedMessages[message.messageKey] : undefined;
                  return <tr key={message.messageKey}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {message.messageKey}
                    </td>
                    <td style={{ fontSize: 12 }}>{published ? statusLabel(published.status) : "未发布"}</td>
                    <td style={{ fontSize: 12 }}>
                      {requiredLanguages.map((language) => `${published?.[language].trim() ? "" : "缺"}${CONTENT_LANGUAGE_LABELS[language]}`).join(" / ")}
                    </td>
                    <td>
                      <button
                        className="btn xs"
                        onClick={() => {
                          setSelectedMessageKey(message.messageKey);
                          setNsDrawer(null);
                        }}
                      >
                        查看词条
                      </button>
                    </td>
                  </tr>;
                })}
                {namespaceMessages.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                      该命名空间暂无真实词条
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div
            className="itint"
            style={{ fontSize: 12, lineHeight: 1.6 }}
          >
            点「查看词条」可回到词条详情；缺少必填语言或占位符不一致时不能发布。
          </div>
        </Drawer>
      )}

      {view === "i18n" && hcDrawer && (
        <Drawer
          title="疑似硬编码清单(App 扫描)"
          onClose={() => setHcDrawer(false)}
        >
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="l-tbl" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>位置</th>
                  <th>裸文案</th>
                  <th>建议词条</th>
                </tr>
              </thead>
              <tbody>
                {HARDCODED_FINDINGS.map((row) => (
                  <tr key={row.location}>
                    <td style={{ fontSize: 12 }}>{row.location}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {row.rawCopy}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--i-ac)" }}
                    >
                      {row.suggestedKey}
                    </td>
                  </tr>
                ))}
                {HARDCODED_FINDINGS.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                      暂无疑似硬编码
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="itint" style={{ fontSize: 12, lineHeight: 1.6 }}>
            <b>硬编码</b> = 没走词条系统的裸文案,只有一种语言。处置:建词条(英文和运营区域语言必填)→ 替换引用 → 重扫清零。
          </div>
        </Drawer>
      )}
    </>
  );
}
