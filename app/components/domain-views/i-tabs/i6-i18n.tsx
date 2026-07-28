"use client";

/**
 * I6 i18n 文案 / I7 教程中心共享数据与动作实现，按路由只渲染各自业务区。
 * 单源:后端 /content/i18n-learning/overview;空库时后端写入 MySQL 种子后再查出。
 * 操作确认 显式 edit 契约:奖励调整 / 换推荐课 = 调参传 edit;
 *   课程发布 / 词条发布 / 课程下架 = 处置不传 edit。
 * I 域唯一 amplifies = 课程奖励上调(B1 红线核验,SPEC §4 注:拒绝码 V4 目标 422,
 *   B1 现行 403,以收口裁定为准;审计带 coverageAtSubmit);其余动作 amplifies=false。
 * 完整性扫描 / 新建课程 / 编辑草稿 = 运营设定(仍需操作确认 + 留痕)→ openConfirm。
 */
import { useEffect, useState } from "react";
import type { I18nMessagePairView, LearningCourseVersionView } from "@/lib/admin/i-client";
import type { ICtx } from "./types";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";

type NsFlt = "all" | "issues";
type CatFlt = string;

const NS_FLT: [NsFlt, string][] = [
  ["all", "全部"],
  ["issues", "有问题"],
];

type NsDrawer = { ns: string; keys: number; cov: number; variants: string };
type Namespace = { ns: string; keys: number; coverage: number; variants: string; lastChange: string };
type IntegrityIssue = { code: string; kind: string; cnt: number; samples: string[]; status: string };
type HardcodedFinding = { location: string; rawCopy: string; suggestedKey: string; status: string };
type Course = {
  id: string; title: string; cat: string; icon: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  reward: number; featured: boolean; duration: string; v: string; status: string; body: string;
  titleZh: string; titleEn: string; titleVi: string; bodyZh: string; bodyEn: string; bodyVi: string;
  quizQuestions: { questionId: string; questionZh: string; questionEn: string; questionVi?: string; optionsZh: string[]; optionsEn: string[]; optionsVi?: string[]; correctOptionIndex: number }[];
  passScore?: number; retryLimit?: number; completionCondition?: string; rewardEvent?: string; revision: number;
};
const COURSE_ICON_BY_CAT: Record<string, string> = {
  Basics: "🚀",
  Earn: "⚡",
  Team: "🧬",
  Wealth: "💎",
  Security: "🛡",
};

export function I6I18n({ ctx }: { ctx: ICtx }) {
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const authorities = session?.authorities ?? [];
  const canReadI6 = isSuperadmin || authorities.includes("content_i6_read");
  const canReadI7 = isSuperadmin || authorities.includes("content_i7_read");
  if (!canReadI6 && !canReadI7) {
    return <section className="l-card"><div className="l-b">当前角色没有 I6 文案或 I7 教程读取权限。</div></section>;
  }
  return <>{canReadI6 && <I18nLearningPage ctx={ctx} view="i18n" />}{canReadI7 && <I18nLearningPage ctx={ctx} view="learn" />}</>;
}

function I18nLearningPage({ ctx, view }: { ctx: ICtx; view: "i18n" | "learn" }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWriteI6 = isSuperadmin || !!session?.authorities.includes("content_i6_write");
  const canWriteI7 = isSuperadmin || !!session?.authorities.includes("content_i7_write");
  const canAdjustI7Reward = isSuperadmin || !!session?.authorities.includes("content_i7_course_reward_adjust");
  const propose = usePropose();
  const [nsFlt, setNsFlt] = useState<NsFlt>("all");
  const [catFlt, setCatFlt] = useState<CatFlt>("all");
  const [nsDrawer, setNsDrawer] = useState<NsDrawer | null>(null);
  const [hcDrawer, setHcDrawer] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [selectedMessageKey, setSelectedMessageKey] = useState("");
  const [messageVersions, setMessageVersions] = useState<I18nMessagePairView[]>([]);
  const [messageVersionsLoading, setMessageVersionsLoading] = useState(false);
  const [versionCourseId, setVersionCourseId] = useState("");
  const [courseVersions, setCourseVersions] = useState<LearningCourseVersionView[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const data = content.i18nLearning;
  useEffect(() => {
    if (!versionCourseId) { setCourseVersions([]); return; }
    setVersionsLoading(true);
    actions.fetchI7CourseVersions(versionCourseId)
      .then(setCourseVersions)
      .catch((error) => toast(`版本加载失败:${error instanceof Error ? error.message : String(error)}`))
      .finally(() => setVersionsLoading(false));
  }, [actions, toast, versionCourseId, content.i18nLearning]);
  const I6_STATS = data?.stats ?? { managedKeys: 0, totalKeys: 0, integrityIssues: 0, coursesOnline: 0, weeklyNexPayout: "—" };
  const NAMESPACES: Namespace[] = data?.namespaces ?? [];
  const MESSAGES = data?.messages ?? [];
  const INTEGRITY_ISSUES: IntegrityIssue[] = data?.integrityIssues ?? [];
  const HARDCODED_FINDINGS: HardcodedFinding[] = data?.hardcodedFindings ?? [];
  const COURSES: Course[] = (data?.courses ?? []).map((c) => ({
    id: c.id,
    title: c.title,
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
    titleZh: c.titleZh || c.title,
    titleEn: c.titleEn || "",
    titleVi: c.titleVi || "",
    bodyZh: c.bodyZh || c.body,
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
  const TUTORIAL_METRICS = (data?.metrics ?? []).map((m) => ({ k: m.key, v: m.value }));
  const runBackend = (task: Promise<void>, ok: string) => {
    return task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => {
        toast(`操作失败:${error instanceof Error ? error.message : String(error)}`);
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
    return `${c.reward} NEX`;
  };
  const liveStatus = (c: Course): string =>
    c.status || "published";
  const liveFeatured = (): string =>
    TUTORIAL_FEATURED_DEFAULT;
  const selectedMessage = MESSAGES.find((message) => message.messageKey === selectedMessageKey) ?? MESSAGES[0];
  useEffect(() => {
    const messageKey = selectedMessage?.messageKey;
    if (!messageKey) {
      setMessageVersions([]);
      return;
    }
    let active = true;
    setMessageVersionsLoading(true);
    actions.fetchI6MessageVersions(messageKey)
      .then((versions) => { if (active) setMessageVersions(versions); })
      .catch((error) => {
        if (active) {
          setMessageVersions([]);
          toast(`词条版本加载失败:${error instanceof Error ? error.message : String(error)}`);
        }
      })
      .finally(() => { if (active) setMessageVersionsLoading(false); });
    return () => { active = false; };
  }, [actions, toast, selectedMessage?.messageKey, content.i18nLearning]);
  const filteredMessages = MESSAGES.filter((message) => {
    const query = messageSearch.trim().toLowerCase();
    return !query || message.messageKey.toLowerCase().includes(query) || message.namespace.toLowerCase().includes(query);
  });
  const statusLabel = (status?: string) => ({ draft: "草稿", published: "已发布", archived: "已归档" }[status ?? ""] ?? status ?? "未知");
  const categoryLabel = (value: string) => ({ Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" }[value] ?? value);
  const formatLabel = (value: string) => ({ Article: "图文", Video: "视频", "Hands-on": "实操" }[value] ?? value);
  const levelLabel = (value: string) => ({ Beginner: "入门", Intermediate: "进阶", Advanced: "高级" }[value] ?? value);

  const filteredNs = NAMESPACES.filter((n) => {
    if (nsFlt === "all") return true;
    if (nsFlt === "issues") return n.coverage < 100;
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
    openConfirm({
      action: <>全量重扫 {I6_STATS.managedKeys} 词条</>,
      detail: <>扫缺镜像 / 占位符不匹配 / 疑似硬编码 / 禁词,只读不改数据;结果刷新本表。</>,
      chips: [["只读扫描 · 普通确认", "done"]],
      okLabel: "开始扫描",
      run: () => runBackend(actions.rescanI6("全量重扫词条完整性"), liveIntegrity === 0 ? "扫描完成 · 0 处问题 · 清零 ✓" : `扫描完成 · ${liveIntegrity} 处问题`),
    });

  const editKeyDraft = (mode: "create" | "edit") =>
    openActionConfirm({
      action: <>{mode === "create" ? "新增词条" : "编辑词条草稿"}{mode === "edit" && selectedMessage ? ` · ${selectedMessage.messageKey}` : ""}</>,
      detail: (
        <>
          中文、英文、越南语三份一起维护；三种语言的占位符集合必须一致。保存只新增或更新版本草稿，不覆盖当前发布版。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "localized-copy",
        mode,
        keyName: mode === "edit" ? selectedMessage?.messageKey : "",
        zh: mode === "edit" ? selectedMessage?.zh : "",
        en: mode === "edit" ? selectedMessage?.en : "",
        vi: mode === "edit" ? selectedMessage?.vi : "",
        placeholders: mode === "edit" ? selectedMessage?.placeholders : [],
      },
      run: (reason, _v, form) => {
        const messageKey = (mode === "create" ? form?.messageKey : selectedMessage?.messageKey)?.trim() || "";
        if (!messageKey) {
          toast("词条 key 不能为空");
          return;
        }
        setSelectedMessageKey(messageKey);
        return runBackend(actions.saveI6LocalizedDraft(messageKey, {
          zh: form?.zh || "",
          en: form?.en || "",
          vi: form?.vi || "",
          expectedVersion: mode === "edit" ? selectedMessage?.version : undefined,
        }, reason), `${messageKey} 草稿已保存 · 当前发布版未被覆盖`);
      },
    });

  const pubKey = () =>
    openActionConfirm({
      action: <>发布词条 · {selectedMessage?.messageKey ?? "未选择"} {selectedMessage?.version ?? ""}</>,
      detail: (
        <>
          发布即对全体用户下一次渲染生效。服务器发布闸:
          <b> zh/en/vi 镜像齐 ✓ 占位符一致 ✓ 禁词扫描通过 ✓</b>
          ——任何一项不过直接拒,<b>禁止单语言发布</b>。审计记录带语言集字段,印证两语言同步。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        if (!selectedMessage) return;
        return runBackend(actions.publishI6LocalizedMessage(selectedMessage.messageKey, {
          zh: selectedMessage.zh,
          en: selectedMessage.en,
          vi: selectedMessage.vi,
          expectedVersion: selectedMessage.version,
        }, reason), `${selectedMessage.messageKey} ${selectedMessage.version} 已发布`);
      },
    });

  const archiveKey = () => selectedMessage && openActionConfirm({
    action: <>归档词条 · {selectedMessage.messageKey}</>,
    detail: <>归档后不再作为当前发布内容；历史版本和审计记录继续保留。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.archiveI6LocalizedMessage(
      selectedMessage.messageKey,
      selectedMessage.version,
      reason,
    ), `${selectedMessage.messageKey} 已归档`),
  });

  const rollbackMessageVersion = (target: I18nMessagePairView) =>
    selectedMessage && openActionConfirm({
      action: <>回滚词条 · {selectedMessage.messageKey} → {target.version}</>,
      detail: <>
        服务器将历史三语快照复制为新的单调递增发布版本，不改写历史记录。
        当前版本 <b>{selectedMessage.version}</b> 与目标版本 <b>{target.version}</b> 均会写入审计和 A4 事件。
      </>,
      amplifies: false,
      run: (reason) => runBackend(actions.rollbackI6LocalizedMessage(
        selectedMessage.messageKey,
        target.version,
        selectedMessage.version,
        reason,
      ), `${selectedMessage.messageKey} 已从 ${target.version} 恢复为新发布版本`),
    });

  const fixIntegrity = (issue: IntegrityIssue) =>
    openActionConfirm({
      action: <>修复完整性问题 · {issue.kind}</>,
      detail: (
        <>
          {issue.kind} 共 <b>{issue.cnt}</b> 处。补齐缺失的镜像 / 修正占位符 / 替换硬编码为词条引用;保存后入待重扫确认队列,重扫清零相关词条才能发版。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "localized-copy",
        mode: "edit",
        keyName: selectedMessage?.messageKey ?? "",
        zh: selectedMessage?.zh ?? "",
        en: selectedMessage?.en ?? "",
        vi: selectedMessage?.vi ?? "",
        placeholders: selectedMessage?.placeholders,
      },
      run: (reason, _v, form) => {
        if (!selectedMessage) return;
        return runBackend(actions.fixI6Integrity(issue.code, {
          messageKey: selectedMessage.messageKey,
          zh: form?.zh || "",
          en: form?.en || "",
          vi: form?.vi || "",
        }, reason), `${issue.kind} ${issue.cnt} 处已修复 · 待重扫确认`);
      },
    });

  /* ============ tutorial actions ============ */
  const pubCrs = (c: Course) =>
    openActionConfirm({
      action: <>发布课程新版 · {c.title}</>,
      detail: (
        <>
          分类「{c.cat}」 · 奖励 {c.reward} NEX/课。定版发布至 /learn;受 B1 红线约束(本次只发布版本,不涨奖励,不挂 amplifies)。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.publishI6Course(c.id, reason), `${c.title} 已发布至 /learn`);
      },
    });

  // 唯一 amplifies = 课程奖励调整。
  const adjRwd = (c: Course) =>
    openActionConfirm({
      action: <>课程奖励调整 · {c.title}</>,
      detail: (
        <>
          分类「{c.cat}」完成 NEX 奖励调整 ·{" "}
          <b>放大 NEX 流出,受 B1 兑付覆盖率红线约束</b>。后端会在提交时校验覆盖率,不达标直接拒绝。
        </>
      ),
      amplifies: true,
      edit: { kind: "number", current: String(c.reward), unit: "NEX/课", min: TUTORIAL_REWARD_RANGE.min, max: TUTORIAL_REWARD_RANGE.max, step: 1 },
      run: (reason, v) => {
        if (!v) return;
        const def = findHighOp("i7_course_reward_adjust")!;
        void propose(toast, {
          action: `课程奖励调整 · ${c.title}`,
          obj: c.id,
          before: `${c.reward} NEX/课`,
          after: `${v} NEX/课`,
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
    openActionConfirm({
      action: <>下架课程 · {c.title}</>,
      detail: (
        <>
          下架后 /learn 不再展示该课;已开课用户保留进度,但完成奖励不再发放。常规换版直接发新版,只有正文/合规问题才下架。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.archiveI6Course(c.id, reason), `${c.title} 下架已确认生效`);
      },
    });

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
      rewardNex: Number(form?.reward),
      duration: form?.duration || "5 min",
      publishState: "draft",
      quizQuestions,
      passScore: Number(form?.passScore),
      retryLimit: Number(form?.retries),
      completionCondition: form?.completionCond || "quiz_passed",
      rewardEvent: form?.rewardEvent || "quiz.passed",
      expectedRevision,
      version: form?.version || undefined,
    };
  };

  const newCrs = () =>
    openActionConfirm({
      action: <>新建课程(存为草稿)</>,
      detail: (
        <>
          填 slug / 分类 / 形式 / 难度 / 奖励({TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} NEX 区间内);标题正文另在词条库(I6)建双语词条。草稿不对外,发布需操作确认。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "course-authoring",
        mode: "create",
        rewardMin: TUTORIAL_REWARD_RANGE.min,
        rewardMax: TUTORIAL_REWARD_RANGE.max,
        categories: courseCategories,
        formats: data?.formats,
        levels: data?.levels,
      },
      run: (reason, slug, form) => {
        const id = slug?.trim() || "new";
        runBackend(actions.createI6Course(id, coursePayload(form), reason), "课程草稿已建 · 发布需操作确认");
      },
    });

  const editCrs = (c: Course) => openActionConfirm({
    action: <>编辑课程草稿 · {c.title}</>,
    detail: <>仅草稿可编辑；分类、形式、难度均来自后端配置，测验按题目和选项结构化维护。</>,
    amplifies: false,
    businessForm: {
      kind: "course-authoring",
      mode: "edit",
      rewardMin: TUTORIAL_REWARD_RANGE.min,
      rewardMax: TUTORIAL_REWARD_RANGE.max,
      categories: courseCategories,
      formats: data?.formats,
      levels: data?.levels,
      current: {
        slug: c.id, category: c.cat, format: c.format, difficulty: c.level, duration: c.duration, reward: c.reward,
        titleZh: c.titleZh, titleEn: c.titleEn, titleVi: c.titleVi, bodyZh: c.bodyZh, bodyEn: c.bodyEn, bodyVi: c.bodyVi,
        quizQuestions: c.quizQuestions, passScore: c.passScore, retryLimit: c.retryLimit,
        completionCondition: c.completionCondition, rewardEvent: c.rewardEvent,
      },
    },
    run: (reason, _slug, form) => runBackend(actions.updateI7CourseDraft(c.id, coursePayload(form, c.revision), reason), `${c.title} 草稿已更新`),
  });

  const deleteCrs = (c: Course) => openActionConfirm({
    action: <>删除课程草稿 · {c.title}</>,
    detail: <>只允许删除未发布草稿；已发布或已归档课程由服务端拒绝删除，操作写入审计。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI7CourseDraft(c.id, reason), `${c.title} 草稿已删除`),
  });

  const reloadVersions = (courseId: string, task: Promise<void>, ok: string) => {
    task.then(() => actions.reloadIContent())
      .then(() => actions.fetchI7CourseVersions(courseId))
      .then((versions) => { setCourseVersions(versions); toast(ok); })
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  const courseCurrent = (c: Course, version: string, payload?: Record<string, unknown>) => ({
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
    completionCondition: String(payload?.completionCondition ?? c.completionCondition ?? "quiz_passed"),
    rewardEvent: String(payload?.rewardEvent ?? c.rewardEvent ?? "quiz.passed"),
  });

  const newCourseVersion = (c: Course) => {
    const maxVersion = Math.max(Number(c.v.replace(/^v/i, "")) || 0,
      ...courseVersions.map((row) => Number(row.version.replace(/^v/i, "")) || 0));
    openActionConfirm({
      action: <>新建课程版本草稿 · {c.title}</>,
      detail: <>当前发布版继续服务用户；新版本在独立草稿中编辑，发布后才原子替换当前版。</>,
      amplifies: false,
      businessForm: {
        kind: "course-authoring", mode: "version-create", rewardMin: TUTORIAL_REWARD_RANGE.min, rewardMax: TUTORIAL_REWARD_RANGE.max,
        categories: courseCategories, formats: data?.formats, levels: data?.levels,
        current: courseCurrent(c, `v${maxVersion + 1}`),
      },
      run: (reason, _value, form) => reloadVersions(c.id,
        actions.createI7CourseVersion(c.id, coursePayload(form), reason), `${c.title} ${form?.version} 草稿已创建`),
    });
  };

  const editCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({
    action: <>编辑课程版本草稿 · {c.title} {row.version}</>,
    detail: <>使用服务端 revision 做并发校验；三语正文和三语测验必须同时完整。</>,
    amplifies: false,
    businessForm: {
      kind: "course-authoring", mode: "version-edit", rewardMin: TUTORIAL_REWARD_RANGE.min, rewardMax: TUTORIAL_REWARD_RANGE.max,
      categories: courseCategories, formats: data?.formats, levels: data?.levels,
      current: courseCurrent(c, row.version, row.payload),
    },
    run: (reason, _value, form) => reloadVersions(c.id,
      actions.updateI7CourseVersion(c.id, row.version, coursePayload(form, row.revision), reason), `${c.title} ${row.version} 草稿已更新`),
  });

  const deleteCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({
    action: <>删除课程版本草稿 · {c.title} {row.version}</>,
    detail: <>仅草稿可删除；已发布和历史版本由服务端拒绝，避免破坏用户进度与奖励账本。</>,
    amplifies: false,
    run: (reason) => reloadVersions(c.id, actions.deleteI7CourseVersion(c.id, row.version, reason), `${row.version} 草稿已删除`),
  });

  const publishCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({
    action: <>发布课程版本 · {c.title} {row.version}</>,
    detail: <>发布前服务端复核三语测验、B1 兑付覆盖率和专用权限；成功后旧发布版转为历史版。</>,
    amplifies: true,
    run: (reason) => reloadVersions(c.id, actions.publishI7CourseVersion(c.id, row.version, reason), `${row.version} 已发布`),
  });

  const rollbackCourseVersion = (c: Course, row: LearningCourseVersionView) => openActionConfirm({
    action: <>回滚课程版本 · {c.title} → {row.version}</>,
    detail: <>回滚只接受服务端历史快照；课程内容、测验和奖励配置一起原子恢复，用户奖励仍按课程+用户+版本幂等。</>,
    amplifies: true,
    run: (reason) => reloadVersions(c.id, actions.rollbackI7CourseVersion(c.id, row.version, reason), `已回滚到 ${row.version}`),
  });

  const setFeat = () => {
    const cur = liveFeatured();
    const publishedCourseOptions = COURSES.filter((course) => liveStatus(course) === "published").map((course) => course.id);
    const publishedCourseLabels = Object.fromEntries(COURSES.filter((course) => liveStatus(course) === "published").map((course) => [course.id, `${course.title}（${course.id}）`]));
    openActionConfirm({
      action: <>更换推荐位课程</>,
      detail: (
        <>
          推荐位是首页大卡的单一展示位 · 换课等于改变所有用户的首页主推教程；只能从已发布课程中选择。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: cur, options: publishedCourseOptions, optionLabels: publishedCourseLabels, unit: "课程" },
      run: (reason, v) => {
        if (!v) return;
        // audit P1 修:换课必须是「已发布课程 id」(SPEC §4 + 设计稿文案承诺);
        // 校验失败拒写并 toast 提示,防 dev/操作员误输入空字符串/已下架课程让首页大卡指向死链。
        const target = COURSES.find((c) => c.id === v.trim());
        if (!target) { toast(`课程 id ${v} 不存在 · 未执行`); return; }
        if (liveStatus(target) !== "published") { toast(`${v} 不是已发布课程 · 不可作为推荐位 · 未执行`); return; }
        runBackend(actions.updateI6FeaturedCourse(v.trim(), reason), `推荐位已更换为 ${v} · 已写审计`);
      },
    });
  };

  /* ============ render helpers ============ */
  const renderCoverage = (n: Namespace) => {
    if (n.coverage === 100) return <span className="in-full">100% ✓</span>;
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
    return <section className="l-card"><div className="l-b"><div className="itint">{view === "i18n" ? "I6" : "I7"} 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">{view === "i18n" ? "I6" : "I7"} 暂无真实接口数据</div></div></section>;
  }

  /* ============ render ============ */
  return (
    <>
      {view === "i18n" && <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管词条</div>
          <div className="v">
            {I6_STATS.managedKeys} / {I6_STATS.totalKeys}
          </div>
          <div className="sub">真实词条目录 × zh/en/vi</div>
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
          <span className="ttl">命名空间矩阵(I6 · a)</span>
          <span className="sub">· 按真实词条实时汇总三语覆盖率</span>
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
                <th className="num">key 数</th>
                <th>覆盖</th>
                <th className="num">缺 key</th>
                <th>进行中变体</th>
                <th>最近改动</th>
              </tr>
            </thead>
            <tbody>
              {filteredNs.map((n) => {
                const missing = Math.round((n.keys * (100 - n.coverage)) / 100);
                return (
                  <tr
                    key={n.ns}
                    className="click"
                    onClick={() =>
                      setNsDrawer({
                        ns: n.ns,
                        keys: n.keys,
                        cov: n.coverage,
                        variants: n.variants,
                      })
                    }
                  >
                    <td>
                      <span className="ns-name">{n.ns}</span>
                    </td>
                    <td className="num mono">{n.keys}</td>
                    <td>{renderCoverage(n)}</td>
                    <td
                      className="num mono"
                      style={{ color: missing > 0 ? "var(--warning)" : "var(--ink-4)" }}
                    >
                      {missing > 0 ? missing : "—"}
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
                );
              })}
              <tr>
                <td
                  colSpan={6}
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink-4)",
                    textAlign: "center",
                  }}
                >
                  … 共 30+ 命名空间 · 768 词条(全站 ~770)
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
              placeholder="搜索 key / 命名空间"
              value={messageSearch}
              onChange={(event) => setMessageSearch(event.target.value)}
              style={{ width: 210 }}
            />
            {canWriteI6 && <button className="l-btn sm mc" onClick={() => editKeyDraft("create")}>新增词条</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>词条 key</th><th>命名空间</th><th>版本</th><th>状态</th><th>语言完整度</th><th></th></tr></thead>
            <tbody>
              {filteredMessages.map((message) => {
                const languageCount = [message.zh, message.en, message.vi].filter(Boolean).length;
                const selected = selectedMessage?.messageKey === message.messageKey;
                return <tr key={message.messageKey} className="click" onClick={() => setSelectedMessageKey(message.messageKey)}>
                  <td className="mono" style={{ fontWeight: selected ? 700 : 500 }}>{message.messageKey}</td>
                  <td>{message.namespace}</td>
                  <td className="mono">{message.version}</td>
                  <td><span className={`bdg ${message.status === "published" ? "ok" : message.status === "draft" ? "warn" : "dim"}`}>{statusLabel(message.status)}</span></td>
                  <td>{languageCount}/3 · {languageCount === 3 ? "中英越完整" : "待补齐"}</td>
                  <td style={{ textAlign: "right" }}><button className="l-btn sm" onClick={(event) => { event.stopPropagation(); setSelectedMessageKey(message.messageKey); }}>选择</button></td>
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
              <button className="l-btn sm" onClick={() => editKeyDraft("edit")}>
                编辑三语草稿
              </button>
              {selectedMessage.status === "draft" && <button className="l-btn sm mc" onClick={pubKey}>
                发布
              </button>}
              {selectedMessage.status === "published" && <button className="l-btn sm" onClick={archiveKey}>归档</button>}
              </>}
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            {selectedMessage ? <>
              <div className="ab-grid">
                <div className="ab-prev"><div className="lc">ZH · {statusLabel(selectedMessage.status)}</div><div className="tx">{selectedMessage.zh || "待补齐"}</div></div>
                <div className="ab-prev"><div className="lc">EN · {statusLabel(selectedMessage.status)}</div><div className="tx">{selectedMessage.en || "待补齐"}</div></div>
                <div className="ab-prev"><div className="lc">VI · {statusLabel(selectedMessage.status)}</div><div className="tx">{selectedMessage.vi || "待补齐"}</div></div>
              </div>
              <div className={`itint ${selectedMessage.zh && selectedMessage.en && selectedMessage.vi ? "ok" : "warn"}`} style={{ marginTop: 8 }}>
                <b>三语镜像</b> · 版本 {selectedMessage.version} · 占位符 {selectedMessage.placeholders.length ? selectedMessage.placeholders.join("、") : "无"}。草稿保存不会覆盖当前发布版。
              </div>
              <div style={{ overflowX: "auto", marginTop: 12 }}>
                <table className="l-tbl" style={{ minWidth: 520 }}>
                  <thead><tr><th>历史版本</th><th>状态</th><th>三语完整度</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
                  <tbody>
                    {messageVersions.map((row) => {
                      const complete = [row.zh, row.en, row.vi].filter(Boolean).length;
                      return <tr key={`${row.messageKey}-${row.version}`}>
                        <td className="mono">{row.version}</td>
                        <td>{statusLabel(row.status)}</td>
                        <td>{complete}/3</td>
                        <td style={{ textAlign: "right" }}>
                          {canWriteI6 && row.status === "archived" && selectedMessage.status !== "draft"
                            ? <button className="l-btn sm mc" onClick={() => rollbackMessageVersion(row)}>回滚到此版本</button>
                            : row.version === selectedMessage.version
                              ? <span className="muted">当前版本</span>
                              : <span className="muted">仅保留</span>}
                        </td>
                      </tr>;
                    })}
                    {!messageVersionsLoading && messageVersions.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-4)" }}>暂无版本快照</td></tr>}
                    {messageVersionsLoading && <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--ink-4)" }}>版本加载中…</td></tr>}
                  </tbody>
                </table>
              </div>
            </> : <div className="itint">暂无真实词条，请先新增词条草稿。</div>}
          </div>
        </section>

        {/* 完整性扫描卡 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">
              完整性扫描 · {liveIntegrity} 处问题
            </span>
            <span className="sub">· 缺镜像 / 占位符 / 疑似硬编码 / 禁词</span>
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
          <div className="k">课程 NEX 派发(本周)</div>
          <div className="v">{I6_STATS.weeklyNexPayout}</div>
          <div className="sub">完成发奖 · 喂流出口径(B1)</div>
        </div>
      </div>

      {/* I7 教程列表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">教程中心(I7) · /learn · {allCourses.length} 课</span>
          <span className="sub">
            · {courseCategoryCount} 分类 · 学完发 NEX · 涨奖励过 B1 红线
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
                        {c.title}
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
                      {c.duration}
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
                      <button className="l-btn sm" onClick={() => setVersionCourseId(c.id)} style={{ marginRight: 6 }}>版本管理</button>
                      {canWriteI7 && <>
                      {isDraft && <>
                      <button className="l-btn sm" onClick={() => editCrs(c)} style={{ marginRight: 6 }}>编辑</button>
                      <button className="l-btn sm mc" onClick={() => pubCrs(c)} style={{ marginRight: 6 }}>发布</button>
                      <button className="l-btn sm" onClick={() => deleteCrs(c)} style={{ marginRight: 6 }}>删除草稿</button>
                      </>}
                      {!archived && !isDraft && (
                        <button
                          className="l-btn sm"
                          onClick={() => archiveCrs(c)}
                        >
                          下架
                        </button>
                      )}
                      </>}
                      {canAdjustI7Reward && !archived && !isDraft && (
                        <button
                          className="l-btn sm mc"
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
          <span className="ttl">课程版本列表 · {versionCourse.title}</span>
          <span className="sub">· 数据来自后端版本快照 · 当前 {versionCourse.v}</span>
          <div className="r chips">
            {canWriteI7 && <button className="l-btn sm primary" onClick={() => newCourseVersion(versionCourse)}>+ 新版本草稿</button>}
            <button className="l-btn sm" onClick={() => setVersionCourseId("")}>关闭</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 840 }}>
            <thead><tr><th>版本</th><th>状态</th><th>说明</th><th>修订号</th><th>更新时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {courseVersions.map((row) => {
                const statusText = { DRAFT: "草稿", PUBLISHED: "已发布", SUPERSEDED: "历史版本" }[row.status] ?? row.status;
                return <tr key={`${row.courseId}-${row.version}`}>
                  <td className="mono">{row.version}</td>
                  <td><span className={`bdg ${row.status === "DRAFT" ? "warn" : row.status === "PUBLISHED" ? "ok" : "dim"}`}>{statusText}</span></td>
                  <td>{String(row.payload.titleZh ?? row.payload.titleEn ?? "—")}</td>
                  <td className="mono">{row.revision}</td>
                  <td className="mono">{row.updatedAt ? new Date(row.updatedAt).toLocaleString("zh-CN") : "—"}</td>
                  <td style={{ textAlign: "right" }}>
                    {row.status === "DRAFT" && canWriteI7 && <>
                      <button className="l-btn sm" onClick={() => editCourseVersion(versionCourse, row)} style={{ marginRight: 6 }}>编辑草稿</button>
                      <button className="l-btn sm" onClick={() => deleteCourseVersion(versionCourse, row)} style={{ marginRight: 6 }}>删除草稿</button>
                    </>}
                    {row.status === "DRAFT" && canAdjustI7Reward && <button className="l-btn sm mc" onClick={() => publishCourseVersion(versionCourse, row)}>发布</button>}
                    {row.status === "SUPERSEDED" && canAdjustI7Reward && <button className="l-btn sm mc" onClick={() => rollbackCourseVersion(versionCourse, row)}>回滚到此版本</button>}
                    {row.status === "PUBLISHED" && <span className="muted">当前线上版本</span>}
                  </td>
                </tr>;
              })}
              {!versionsLoading && courseVersions.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 24, color: "var(--ink-4)" }}>暂无版本快照</td></tr>}
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
                  当前固定第 1 课「What is Nexion · 5 分钟速成」· 单一位置,换课走操作确认
                </small>
              </span>
              <span className="v">{liveFeatured()}</span>
              {canWriteI7 && <button className="l-btn sm mc" onClick={setFeat}>
                换推荐课
              </button>}
            </div>
            <div className="in-vrow">
              <span className="nm">
                单课奖励区间
                <small>权威口径 10–50 NEX;单课精确值在课程行上调</small>
              </span>
              <span className="v">
                {TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} NEX
              </span>
            </div>
          </div>
        </section>

        {/* I7 课程效果监控 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">课程效果监控</span>
            <span className="sub">
              · 只读 · 数字喂 BI(L 域)+ D 对账 + B1 流出
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
                <div key={m.k}>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-4)",
                      marginBottom: 4,
                    }}
                  >
                    {m.k}
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
                    {m.v}
                  </div>
                </div>
              ))}
            </div>
            <div className="itint" style={{ marginTop: 10 }}>
              <b>事件去向</b> · 开课、完课、测验通过实时写入学习事件；进度进入课程进度表，奖励进入奖励台账并同步钱包与资金流水。BI(L 域)可据此计算完课率、参与深度和回访贡献，B1/D 域可对账课程奖励流出。
            </div>
          </div>
        </section>
      </div>

      </>}

      <p className="f-foot">
        {view === "i18n" ? <><b>执行门槛</b>:词条草稿保存即校验中、英、越三语和占位符并留审计；词条发布/归档需内容主管或超管确认。<b>底座地位</b>:I1、I2、I4 与 I7 的可见文案都使用这里的三语词条。</> : <><b>执行门槛</b>:课程草稿可保存；发布、下架、换推荐课需内容主管或超管确认。<b>课程奖励上调</b>必须走高敏审批并通过 B1 备付金红线校验。</>}
      </p>
      <PaginationExemptionList
        items={view === "i18n" ? [
          {
            label: "命名空间矩阵(I6 · a)",
            kind: "reference-catalog",
            maxRows: Math.max(1, NAMESPACES.length),
            reason: `命名空间来自真实词条目录,当前 ${NAMESPACES.length} 组,需要同屏核对三语覆盖率和缺 key`,
          },
        ] : [
          {
            label: `教程中心(I7) · /learn · ${allCourses.length} 课`,
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
              {nsDrawer.keys} 个词条 · 三语覆盖 {nsDrawer.cov}%
              {nsDrawer.variants !== "—"
                ? ` · ${nsDrawer.variants} 进行中`
                : ""}
            </div>
            <div
              className="muted tiny"
              style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-4)" }}
            >
              词条按 key 组织,App 端按「空间 × 语言」整包拉取当前发布版。
            </div>
          </div>
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="l-tbl" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>key</th>
                  <th>状态</th>
                  <th>语言完整度</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {MESSAGES.filter((message) => message.namespace === nsDrawer.ns).map((message) => (
                  <tr key={message.messageKey}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {message.messageKey}
                    </td>
                    <td style={{ fontSize: 12 }}>{statusLabel(message.status)}</td>
                    <td style={{ fontSize: 12 }}>
                      {message.zh ? "中" : "缺中"} / {message.en ? "英" : "缺英"} / {message.vi ? "越" : "缺越"}
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
                  </tr>
                ))}
                {MESSAGES.filter((message) => message.namespace === nsDrawer.ns).length === 0 && (
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
            点「查看词条」可回到词条详情编辑中、英、越三语；缺少任一语言或占位符不一致时均不能发布。
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
            <b>硬编码</b> = 没走词条系统的裸文案,只有一种语言。处置:建词条(中、英、越三语)→ 替换引用 → 重扫清零。
          </div>
        </Drawer>
      )}
    </>
  );
}
