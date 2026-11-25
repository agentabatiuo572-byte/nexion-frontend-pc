"use client";

/**
 * I6 多语言与课程的画法零件：课程编辑抽屉、App 里的样子、版本对比。
 * 表单的值、默认值和校验照搬共用确认框的 course-authoring、localized-copy（design-kit 的
 * initialBusinessValue、missingBusinessFields），提交时交给 i6-i18n 里原来的 coursePayload 拼请求，请求不变。
 */
import { blankCopiedContentLanguage, englishCopyHint, fillBlankContentLanguage, isEnglishCopy, mapSingleContentText, trimStoredContent } from "@/lib/admin/content-language-rules";
import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, CircleSlash, EyeOff, Gem, GraduationCap, Plus, Rocket, Shield, Users, Zap, type LucideIcon } from "lucide-react";
import { Button, Decision, Drawer, Field, Input, LocaleTabs, NumberInput, PageTabs, Select, StatusTag, Textarea, useTabIds } from "@/app/components/rd";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { displayAdminError } from "@/lib/admin/error-messages";
import { I6_COURSE_REWARD_DECIMALS, i6Amount } from "@/lib/admin/i6-amount";
import { i6HasCopyText } from "@/lib/admin/i6-copy-quality";
import { amountDisplay } from "@/lib/format";

export type Lang = "zh" | "vi" | "en";
export const LANGS: readonly { key: Lang; label: string; short: string }[] = [
  { key: "zh", label: "中文", short: "中" },
  { key: "vi", label: "越南语", short: "越" },
  { key: "en", label: "英语", short: "英" },
];
const LANG_FIELD: Record<Lang, "Zh" | "Vi" | "En"> = { zh: "Zh", vi: "Vi", en: "En" };

export const NS_LABEL: Record<string, string> = { conversation: "客服会话", home: "首页", learn: "学习课程", test: "测试词条", notifications: "消息通知" };
export const nsLabel = (ns: string) => NS_LABEL[ns] ?? ns;
export const CATEGORY_LABEL: Record<string, string> = { Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" };
export const CATEGORY_ICON: Record<string, LucideIcon> = { Basics: Rocket, Earn: Zap, Team: Users, Wealth: Gem, Security: Shield };
export const categoryIcon = (value: string) => CATEGORY_ICON[value] ?? BookOpen;
export const categoryLabel = (value: string) => CATEGORY_LABEL[value] ?? "其他分类";
export const FORMAT_LABEL: Record<string, string> = { Article: "图文", Video: "视频", "Hands-on": "实操" };
export const LEVEL_LABEL: Record<string, string> = { Beginner: "入门", Intermediate: "进阶", Advanced: "高级" };
export const COMPLETION_LABEL: Record<string, string> = { quiz_passed: "达到及格分", all_questions_correct: "全部答对" };
export const REWARD_EVENT_LABEL: Record<string, string> = { "quiz.passed": "测验通过时", "course.completed": "课程完成时" };
/** 15ca362f／e0e5c515：这两项已停用，新建不带，编辑和新版本原样带上以前存的值。 */
export const RETIRED_OPTIONS_NOTE = "这两项只留着以前存的值，保存时不变；学完和发奖只看及格分。";
export const RETIRED_OPTIONS_VIEW_NOTE = "这两项只留着以前存的值；学完和发奖只看及格分。";
export function RetiredOption({ text }: { text?: string }) {
  return <span className="i6-retired-value"><span data-empty={text ? undefined : ""}>{text || "—"}</span><StatusTag tone="neutral" icon={CircleSlash}>已停用</StatusTag></span>;
}
/** 时长四档照共用表单（F:954）；后端只取数字当分钟。 */
const DURATIONS = ["5 min", "8 min", "12 min", "15 min"];
export const durationText = (value: string) => {
  const minutes = /(\d+)/.exec(value ?? "")?.[1];
  return minutes ? `${minutes} 分钟` : "—";
};
/** UVT 金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点，不舍入。审批前后值用原值，不经过这里。 */
export const uvtText = (value: unknown) => {
  const raw = i6Amount(value);
  if (raw === undefined) return "—";
  return amountDisplay(raw);
};
/** 后端明确给的 null 是这门课没设奖励，和读不到（「—」）分开写，也不写成 0。 */
export const NO_REWARD = "未设奖励";
export const rewardPerUser = (value: unknown) => value === null ? NO_REWARD : `${uvtText(value)} UVT/人`;

export type CourseMode = "create" | "edit" | "version-create" | "version-edit";
export type CourseForm = Record<string, string>;
export type CourseCurrent = {
  slug: string; version?: string; category: string; format: string; difficulty: string; duration: string; reward: string | null;
  titleZh: string; titleEn: string; titleVi: string; bodyZh: string; bodyEn: string; bodyVi: string;
  quizQuestions: { questionId: string; questionZh: string; questionEn: string; questionVi?: string; optionsZh: string[]; optionsEn: string[]; optionsVi?: string[]; correctOptionIndex: number }[];
  passScore?: number; retryLimit?: number; completionCondition?: string; rewardEvent?: string;
};
export type CourseSpec = { mode: CourseMode; rewardMin: number; rewardMax: number; categories: string[]; formats?: string[]; levels?: string[]; current?: CourseCurrent };

/** 和共用表单 course-authoring 的初始值一字不差（design-kit initialBusinessValue）。 */
export function courseFormState(spec: CourseSpec): CourseForm {
  const current = spec.current;
  const questions = current?.quizQuestions?.length ? current.quizQuestions : [{
    questionId: "q1", questionZh: "", questionEn: "", questionVi: "", optionsZh: ["", ""], optionsEn: ["", ""], optionsVi: ["", ""], correctOptionIndex: 0,
  }];
  const state: CourseForm = {
    slug: current?.slug ?? "",
    version: current?.version ?? "v1",
    category: current?.category ?? spec.categories?.[0] ?? "Basics",
    format: current?.format ?? spec.formats?.[0] ?? "Article",
    difficulty: current?.difficulty ?? spec.levels?.[0] ?? "Beginner",
    duration: current?.duration ?? DURATIONS[0],
    reward: current ? current.reward ?? "" : String(spec.rewardMin),
    publishState: "draft",
    titleZh: current?.titleZh ?? "",
    titleEn: current?.titleEn ?? "",
    titleVi: current?.titleVi ?? "",
    bodyZh: current?.bodyZh ?? "",
    bodyEn: current?.bodyEn ?? "",
    bodyVi: current?.bodyVi ?? "",
    quizCount: String(questions.length),
    passScore: String(current?.passScore ?? 60),
    retries: String(current?.retryLimit ?? 3),
    completionCond: current?.completionCondition ?? "",
    rewardEvent: current?.rewardEvent ?? "",
  };
  questions.forEach((question, questionIndex) => {
    state[`quiz.${questionIndex}.id`] = question.questionId || `q${questionIndex + 1}`;
    state[`quiz.${questionIndex}.questionZh`] = question.questionZh;
    state[`quiz.${questionIndex}.questionEn`] = question.questionEn;
    state[`quiz.${questionIndex}.questionVi`] = question.questionVi ?? "";
    state[`quiz.${questionIndex}.optionCount`] = String(Math.max(2, question.optionsZh.length, question.optionsEn.length, question.optionsVi?.length ?? 0));
    for (let optionIndex = 0; optionIndex < Number(state[`quiz.${questionIndex}.optionCount`]); optionIndex += 1) {
      state[`quiz.${questionIndex}.option.${optionIndex}.zh`] = question.optionsZh[optionIndex] ?? "";
      state[`quiz.${questionIndex}.option.${optionIndex}.en`] = question.optionsEn[optionIndex] ?? "";
      state[`quiz.${questionIndex}.option.${optionIndex}.vi`] = question.optionsVi?.[optionIndex] ?? "";
    }
    state[`quiz.${questionIndex}.correctOptionIndex`] = String(question.correctOptionIndex ?? 0);
  });
  return state;
}

function courseCopyKeys(form: CourseForm, lang: Lang) {
  const suffix = LANG_FIELD[lang];
  return [`title${suffix}`, `body${suffix}`, ...Array.from({ length: Number(form.quizCount || 0) }, (_, question) => [
    `quiz.${question}.question${suffix}`,
    ...Array.from({ length: Number(form[`quiz.${question}.optionCount`] || 0) }, (_, option) => `quiz.${question}.option.${option}.${lang}`),
  ]).flat()];
}

function courseCopyGroup(form: CourseForm, lang: Lang) {
  return { values: courseCopyKeys(form, lang).map(key => i6HasCopyText(form[key] ?? "") ? form[key] : "") };
}

export function mapCourseLanguages(form: CourseForm, required: readonly OperatingLanguageCode[], mode: "edit" | "submit"): CourseForm {
  const transform = mode === "edit" ? blankCopiedContentLanguage : fillBlankContentLanguage;
  const english = courseCopyGroup(form, "en");
  const mapped = { ...form };
  for (const lang of ["zh", "vi"] as const) {
    const { values } = transform(required, lang, english, courseCopyGroup(form, lang));
    courseCopyKeys(form, lang).forEach((key, index) => { mapped[key] = values[index]; });
  }
  return mapped;
}

type Missing = { key: string; text: string; need?: boolean };
function courseRewardPrecisionError(value: string | undefined): string | undefined {
  if ((value?.split(".")[1]?.length ?? 0) > I6_COURSE_REWARD_DECIMALS) {
    return `完成奖励最多填 ${I6_COURSE_REWARD_DECIMALS} 位小数。`;
  }
}

/** 课程抽屉与提交前共用，每项带上字段键，好把错误写在框下。 */
export function courseFormMissing(spec: CourseSpec, state: CourseForm): Missing[] {
  const missing: Missing[] = [];
  const needs = (key: string, text: string) => {
    if (!i6HasCopyText(state[key] ?? "")) missing.push(key === "reward"
      ? { key, text: displayAdminError("LEARNING_REWARD_OUT_OF_RANGE") } : { key, text, need: true });
  };
  const NAMES: Record<string, string> = { slug: "课程标识", category: "分类", format: "形式", difficulty: "难度", duration: "预计时长", reward: "完成奖励", titleZh: "中文标题", titleEn: "英语标题", titleVi: "越南语标题", bodyZh: "中文正文", bodyEn: "英语正文", bodyVi: "越南语正文" };
  Object.keys(NAMES).forEach((key) => needs(key, NAMES[key]));
  for (const key of ["titleZh", "titleEn", "titleVi", "bodyZh", "bodyEn", "bodyVi"]) {
    const limit = key === "titleZh" ? 128 : 1024;
    if (trimStoredContent(state[key] ?? "").length > limit) missing.push({ key, text: `${NAMES[key]}最多 ${limit} 字` });
  }
  if (spec.mode === "version-create" || spec.mode === "version-edit") {
    needs("version", "课程版本号");
    if (!/^v[1-9][0-9]{0,8}$/i.test(state.version || "")) missing.push({ key: "version", text: "版本号格式 v1、v2…" });
  }
  if (i6HasCopyText(state.reward ?? "")) {
    const reward = Number(state.reward);
    const precisionError = courseRewardPrecisionError(state.reward);
    if (precisionError) missing.push({ key: "reward", text: precisionError });
    if (!Number.isFinite(reward)) missing.push({ key: "reward", text: "奖励数值" });
    if (spec.rewardMin != null && reward < spec.rewardMin) missing.push({ key: "reward", text: `奖励 ≥ ${spec.rewardMin}` });
    if (spec.rewardMax != null && reward > spec.rewardMax) missing.push({ key: "reward", text: `奖励 ≤ ${spec.rewardMax}` });
  }
  const quizCount = Number(state.quizCount || 0);
  if (!Number.isInteger(quizCount) || quizCount < 1) missing.push({ key: "quizCount", text: "至少一道测验题" });
  for (let q = 0; q < quizCount; q += 1) {
    needs(`quiz.${q}.id`, `第 ${q + 1} 题标识`);
    needs(`quiz.${q}.questionZh`, `第 ${q + 1} 题中文题干`);
    needs(`quiz.${q}.questionEn`, `第 ${q + 1} 题英语题干`);
    needs(`quiz.${q}.questionVi`, `第 ${q + 1} 题越南语题干`);
    const optionCount = Number(state[`quiz.${q}.optionCount`] || 0);
    if (!Number.isInteger(optionCount) || optionCount < 2) missing.push({ key: `quiz.${q}.optionCount`, text: `第 ${q + 1} 题至少两个选项` });
    for (let o = 0; o < optionCount; o += 1) {
      needs(`quiz.${q}.option.${o}.zh`, `第 ${q + 1} 题选项 ${o + 1} 中文`);
      needs(`quiz.${q}.option.${o}.en`, `第 ${q + 1} 题选项 ${o + 1} 英语`);
      needs(`quiz.${q}.option.${o}.vi`, `第 ${q + 1} 题选项 ${o + 1} 越南语`);
    }
    const correct = Number(state[`quiz.${q}.correctOptionIndex`]);
    if (!Number.isInteger(correct) || correct < 0 || correct >= optionCount) missing.push({ key: `quiz.${q}.correctOptionIndex`, text: `第 ${q + 1} 题正确选项` });
  }
  const passScore = Number(state.passScore);
  const retries = Number(state.retries);
  if (!Number.isInteger(passScore) || passScore < 1 || passScore > 100) missing.push({ key: "passScore", text: "及格分 1–100 的整数" });
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) missing.push({ key: "retries", text: "重试次数 0–10 的整数" });
  return missing;
}

/** 和共用表单 localized-copy 的校验一致：三语都要填，原有的变量三语都要带上。 */
export function copyFormMissing(placeholders: readonly string[], input: Record<Lang, string>, required: readonly OperatingLanguageCode[]): Missing[] {
  const state = mapSingleContentText(input, required, "submit");
  const missing: Missing[] = [];
  if (!i6HasCopyText(state.zh)) missing.push({ key: "zh", text: "中文", need: true });
  if (!i6HasCopyText(state.en)) missing.push({ key: "en", text: "英语", need: true });
  if (!i6HasCopyText(state.vi)) missing.push({ key: "vi", text: "越南语", need: true });
  placeholders.forEach((ph) => {
    if (!state.zh.includes(ph) || !state.en.includes(ph) || !state.vi.includes(ph)) missing.push({ key: `ph:${ph}`, text: `变量 ${ph}` });
  });
  for (const { key, label } of LANGS) {
    if (trimStoredContent(state[key]).length > 1024) missing.push({ key, text: `${label}最多 1024 字` });
  }
  return missing;
}

export function blockedText(missing: readonly Missing[]) {
  if (!missing.length) return;
  const first = missing[0].text.replace(/。$/, "");
  const suffix = missing.length > 1 ? `等 ${missing.length} 项` : "";
  return `还没填好：${first}${suffix}。`;
}

/* ---------- App 里的样子 ---------- */

/**
 * 预览照 App 课程卡的 formatAmount（App src/lib/amount-display.ts，默认两位）：第三位小数 ≥5 进一、固定两位、不加千分位。
 * 没设奖励（空或 0）时写「没有奖励」，不写「0.00 UVT」。后台自己的金额仍按原精度，不走这里。
 */
function appRewardText(value: string): string | null {
  if (!value.trim()) return null;
  const plain = i6Amount(value);
  if (plain === undefined) return "—";
  if (/^0+(\.0*)?$/.test(plain)) return null;
  const [whole, fraction = ""] = plain.split(".");
  const cents = BigInt(whole + fraction.slice(0, 2).padEnd(2, "0")) + (fraction[2] >= "5" ? BigInt(1) : BigInt(0));
  const fixed = cents.toString().padStart(3, "0");
  return `${fixed.slice(0, -2)}.${fixed.slice(-2)}`;
}

export function AppCoursePreview({ lang, title, body, category, format, level, duration, reward, rewardError, quizCount, passScore, retries, caption, hidden }: {
  lang: Lang; title: string; body: string; category: string; format: string; level: string; duration: string; reward: string;
  rewardError?: string;
  quizCount: number; passScore: string; retries: string; caption?: ReactNode;
  /** 线上课程在这种语言下 App 不显示时，写不显示的原因。 */
  hidden?: string;
}) {
  const Icon = categoryIcon(category);
  const langLabel = LANGS.find((item) => item.key === lang)?.label ?? "";
  const rewardText = rewardError ? null : appRewardText(reward);
  return (
    <figure className="i6-phone" aria-label={`App 里这门课的样子（${langLabel}）`}>
      <div className="i6-phone-screen">
        <div className="i6-phone-bar"><span>学习课程</span><span className="i6-phone-lang">{langLabel}</span></div>
        {hidden ? <div className="i6-phone-hidden" role="note"><EyeOff size={20} aria-hidden /><b>{langLabel}用户看不到这门课</b><span>{hidden}</span></div> : <>
        <div className="i6-phone-hero">
          <span className="i6-phone-icon" aria-hidden><Icon size={18} /></span>
          <span className="i6-phone-cat">{categoryLabel(category)} · {FORMAT_LABEL[format] ?? format} · {LEVEL_LABEL[level] ?? level}</span>
        </div>
        <h3 className="i6-phone-title" data-user-content="" data-empty={title.trim() ? undefined : ""}>{title.trim() ? nexGridBrandText(title) : `缺${langLabel}标题`}</h3>
        <div className="i6-phone-meta"><span>{durationText(duration)}</span><span className="i6-phone-reward">{rewardError ?? (rewardText === null ? "没有奖励" : `学完得 ${rewardText} UVT`)}</span></div>
        <p className="i6-phone-body" data-user-content="" data-empty={body.trim() ? undefined : ""}>{body.trim() ? nexGridBrandText(body) : `缺${langLabel}正文`}</p>
        <div className="i6-phone-quiz"><GraduationCap size={14} aria-hidden /><span>测验 {quizCount} 题</span><span>{passScore || "—"} 分及格</span><span>可重试 {retries || "—"} 次</span></div>
        </>}
      </div>
      {caption && <figcaption className="i6-phone-caption">{caption}</figcaption>}
    </figure>
  );
}

/* ---------- 课程编辑抽屉 ---------- */

type EditorTab = "body" | "quiz" | "settings";
const EDITOR_TABS: readonly { value: EditorTab; label: string }[] = [
  { value: "body", label: "正文" }, { value: "quiz", label: "测验与发奖" }, { value: "settings", label: "设置" },
];
const TAB_OF = (key: string): EditorTab => key.startsWith("quiz.") || ["quizCount", "passScore", "retries", "completionCond", "rewardEvent"].includes(key) ? "quiz"
  : ["slug", "version", "category", "format", "difficulty", "duration", "reward"].includes(key) ? "settings" : "body";

export function CourseEditor({ open, spec, initial, requiredLanguages, title, sub, busy, onClose, onSave }: {
  open: boolean;
  spec: CourseSpec | null;
  initial?: CourseForm;
  requiredLanguages: readonly OperatingLanguageCode[];
  title: string;
  sub?: ReactNode;
  busy?: boolean;
  onClose: () => void;
  onSave: (form: CourseForm) => void;
}) {
  const ids = useTabIds();
  const [form, setForm] = useState<CourseForm>({});
  const [tab, setTab] = useState<EditorTab>("body");
  const [lang, setLang] = useState<Lang>("zh");
  const [tried, setTried] = useState(false);
  const specKey = spec ? `${spec.mode}:${spec.current?.slug ?? ""}:${spec.current?.version ?? ""}` : "";
  useEffect(() => {
    if (!spec) return;
    setForm(mapCourseLanguages(initial ?? courseFormState(spec), requiredLanguages, "edit"));
    setTab("body");
    setLang("zh");
    setTried(false);
    // 换了编辑对象才重置；同一对象的 spec 引用变化不清掉已填内容。
  }, [specKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const completed = useMemo(() => mapCourseLanguages(form, requiredLanguages, "submit"), [form, requiredLanguages]);
  const missing = useMemo(() => spec ? courseFormMissing(spec, completed) : [], [spec, completed]);
  if (!spec) return null;
  const rewardPrecisionError = courseRewardPrecisionError(form.reward);
  const rewardError = rewardPrecisionError ?? (missing.some(item => item.key === "reward") ? displayAdminError("LEARNING_REWARD_OUT_OF_RANGE") : undefined);
  const set = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const err = (key: string) => { const item = tried ? missing.find((row) => row.key === key) : undefined; return item ? (item.need ? `请填${item.text}` : item.text) : undefined; };
  const quizCount = Math.max(1, Number(form.quizCount || 1));
  const langMissing = (code: Lang) => courseCopyGroup(completed, code).values.some(value => !value);
  const required = requiredLanguages.includes(lang);
  const copyHint = lang !== "en" && required && isEnglishCopy(courseCopyGroup(form, "en"), courseCopyGroup(form, lang))
    ? englishCopyHint(lang) : undefined;
  const tabMissing = (value: EditorTab) => missing.filter((item) => TAB_OF(item.key) === value).length;
  const F = LANG_FIELD[lang];
  const langLabel = LANGS.find((item) => item.key === lang)!.label;
  const versionMode = spec.mode === "version-create" || spec.mode === "version-edit";
  const addQuestion = () => {
    const index = quizCount;
    setForm((current) => ({ ...current,
      quizCount: String(quizCount + 1),
      [`quiz.${index}.id`]: `q${index + 1}`,
      [`quiz.${index}.questionZh`]: "", [`quiz.${index}.questionEn`]: "", [`quiz.${index}.questionVi`]: "",
      [`quiz.${index}.optionCount`]: "2",
      [`quiz.${index}.option.0.zh`]: "", [`quiz.${index}.option.0.en`]: "", [`quiz.${index}.option.0.vi`]: "",
      [`quiz.${index}.option.1.zh`]: "", [`quiz.${index}.option.1.en`]: "", [`quiz.${index}.option.1.vi`]: "",
      [`quiz.${index}.correctOptionIndex`]: "0",
    }));
  };
  const addOption = (q: number) => {
    const count = Math.max(2, Number(form[`quiz.${q}.optionCount`] || 2));
    setForm((current) => ({ ...current,
      [`quiz.${q}.optionCount`]: String(count + 1),
      [`quiz.${q}.option.${count}.zh`]: "", [`quiz.${q}.option.${count}.en`]: "", [`quiz.${q}.option.${count}.vi`]: "",
    }));
  };
  const durations = DURATIONS.includes(form.duration) || !form.duration ? DURATIONS : [...DURATIONS, form.duration];
  const blocked = blockedText(missing);
  const save = () => onSave(form);
  return (
    <Drawer open={open} onClose={onClose} wide busy={busy} icon={GraduationCap} title={title} sub={sub}
      footer={<Decision note={tried && blocked ? blocked : undefined}
        others={<Button onClick={onClose} disabled={busy}>取消</Button>}
        primary={<Button variant="primary" disabledReason={blocked} onBlockedClick={() => {
          setTried(true);
          const first = missing[0];
          if (first) setTab(TAB_OF(first.key));
        }} onClick={save}>保存草稿</Button>} />}>
      <div className="i6-editor">
        <div className="i6-editor-form">
          <PageTabs level={2} label="编辑哪一部分" value={tab} onChange={setTab} ids={ids}
            items={EDITOR_TABS.map((item) => ({ value: item.value, label: item.label, count: tried && tabMissing(item.value) ? `缺 ${tabMissing(item.value)}` : undefined }))} />
          <div {...ids.panel(tab)} className="i6-editor-pane">
            {tab !== "settings" && <div className="i6-editor-lang">
              <LocaleTabs label="编辑哪种语言" value={lang} onChange={setLang}
                items={LANGS.map((item) => ({ value: item.key, label: item.label, missing: langMissing(item.key) }))} />
            </div>}
            {tab === "body" && <>
              <Field label={`${langLabel}标题`} required={required} error={err(`title${F}`)}>
                <Input value={form[`title${F}`] ?? ""} maxLength={1024} onChange={(event) => set(`title${F}`, event.target.value)} />
              </Field>
              <Field label={`${langLabel}正文`} required={required} help={copyHint} error={err(`body${F}`)}>
                <Textarea rows={8} value={form[`body${F}`] ?? ""} maxLength={1024} count={`${(form[`body${F}`] ?? "").length}/1024`} onChange={(event) => set(`body${F}`, event.target.value)} />
              </Field>
            </>}
            {tab === "quiz" && <>
              {Array.from({ length: quizCount }, (_, q) => {
                const optionCount = Math.max(2, Number(form[`quiz.${q}.optionCount`] || 2));
                const correct = Number(form[`quiz.${q}.correctOptionIndex`] || 0);
                return <fieldset key={q} className="i6-quiz-q">
                  <legend>第 {q + 1} 题</legend>
                  <div className="rd-form-grid" data-cols="2" data-dense="">
                    <Field label="题目标识" required error={err(`quiz.${q}.id`)}>
                      <Input value={form[`quiz.${q}.id`] ?? ""} onChange={(event) => set(`quiz.${q}.id`, event.target.value)} />
                    </Field>
                    <Field label={`${langLabel}题干`} required={required} error={err(`quiz.${q}.question${F}`)}>
                      <Input value={form[`quiz.${q}.question${F}`] ?? ""} onChange={(event) => set(`quiz.${q}.question${F}`, event.target.value)} />
                    </Field>
                  </div>
                  <div className="i6-quiz-options" role="radiogroup" aria-label={`第 ${q + 1} 题的正确答案`}>
                    {Array.from({ length: optionCount }, (_, o) => {
                      const id = `i6-q${q}-o${o}`;
                      const error = err(`quiz.${q}.option.${o}.${lang}`);
                      return <div key={o} className="i6-quiz-option" data-correct={correct === o ? "" : undefined}>
                        <label className="i6-quiz-radio">
                          <input type="radio" name={`quiz-${q}-correct-option`} checked={correct === o} onChange={() => set(`quiz.${q}.correctOptionIndex`, String(o))} />
                          <span>{correct === o ? "正确答案" : "设为正确"}</span>
                        </label>
                        <Input id={id} aria-label={`选项 ${o + 1}（${langLabel}）`} aria-invalid={error ? true : undefined} placeholder={`选项 ${o + 1}`} value={form[`quiz.${q}.option.${o}.${lang}`] ?? ""} onChange={(event) => set(`quiz.${q}.option.${o}.${lang}`, event.target.value)} />
                        {error && <span className="rd-form-error i6-quiz-error" role="alert">{error}</span>}
                      </div>;
                    })}
                  </div>
                  <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={() => addOption(q)}>添加选项</Button>
                </fieldset>;
              })}
              <Button size="sm" icon={<Plus size={14} aria-hidden />} onClick={addQuestion}>添加题目</Button>
              <div className="rd-form-grid" data-cols="2" data-dense="">
                <Field label="及格分" required hint="1–100 的整数" explain="得分 = 答对题数 ÷ 总题数 × 100，四舍五入成整数；达到及格分算通过。" error={err("passScore")}>
                  <NumberInput unit="分" min={1} max={100} value={form.passScore ?? ""} onChange={(event) => set("passScore", event.target.value)} />
                </Field>
                <Field label="最多重试次数" required hint="0–10 的整数" error={err("retries")}>
                  <NumberInput unit="次" min={0} max={10} value={form.retries ?? ""} onChange={(event) => set("retries", event.target.value)} />
                </Field>
              </div>
              {spec.mode !== "create" && (form.completionCond || form.rewardEvent) && <>
                <div className="rd-form-grid" data-cols="2" data-dense="">
                  <Field label="完成条件"><RetiredOption text={COMPLETION_LABEL[form.completionCond ?? ""] ?? form.completionCond} /></Field>
                  <Field label="何时发奖"><RetiredOption text={REWARD_EVENT_LABEL[form.rewardEvent ?? ""] ?? form.rewardEvent} /></Field>
                </div>
                <p className="rd-note">{RETIRED_OPTIONS_NOTE}</p>
              </>}
            </>}
            {tab === "settings" && <>
              <div className="rd-form-grid" data-cols="2" data-dense="">
                <Field label="课程标识" required hint={spec.mode === "create" ? "小写字母、数字、短横线" : "建好后不能改"} error={err("slug")}>
                  <Input value={form.slug ?? ""} readOnly={spec.mode !== "create"} onChange={(event) => set("slug", event.target.value)} />
                </Field>
                {versionMode && <Field label="版本号" required hint="v1、v2…" error={err("version")}>
                  <Input value={form.version ?? ""} onChange={(event) => set("version", event.target.value)} />
                </Field>}
                <Field label="分类">
                  <Select aria-label="分类" value={form.category ?? ""} onChange={(value) => set("category", value)}
                    options={spec.categories.map((value) => ({ value, label: categoryLabel(value) }))} />
                </Field>
                <Field label="形式">
                  <Select aria-label="形式" value={form.format ?? ""} onChange={(value) => set("format", value)}
                    options={(spec.formats?.length ? spec.formats : ["Article", "Video", "Hands-on"]).map((value) => ({ value, label: FORMAT_LABEL[value] ?? value }))} />
                </Field>
                <Field label="难度">
                  <Select aria-label="难度" value={form.difficulty ?? ""} onChange={(value) => set("difficulty", value)}
                    options={(spec.levels?.length ? spec.levels : ["Beginner", "Intermediate", "Advanced"]).map((value) => ({ value, label: LEVEL_LABEL[value] ?? value }))} />
                </Field>
                <Field label="预计时长">
                  <Select aria-label="预计时长" value={form.duration ?? ""} onChange={(value) => set("duration", value)}
                    options={durations.map((value) => ({ value, label: durationText(value) }))} />
                </Field>
                <Field label="学完发多少" required hint={`${spec.rewardMin}–${spec.rewardMax} UVT`} explain="每位学完并通过测验的用户在这个版本领一次。有奖励的课发布要提交审批。" error={rewardPrecisionError ?? err("reward")}>
                  <NumberInput unit="UVT" min={spec.rewardMin} max={spec.rewardMax} value={form.reward ?? ""} onChange={(event) => set("reward", event.target.value)} />
                </Field>
              </div>
              <p className="i6-editor-note"><StatusTag tone="neutral">只存草稿</StatusTag>用户看不到草稿，发布在课程卡或版本列表里操作。</p>
            </>}
          </div>
        </div>
        <AppCoursePreview lang={lang} title={completed[`title${F}`] ?? ""} body={completed[`body${F}`] ?? ""} category={form.category ?? ""} format={form.format ?? ""}
          level={form.difficulty ?? ""} duration={form.duration ?? ""} reward={form.reward ?? ""} rewardError={rewardError} quizCount={quizCount} passScore={form.passScore ?? ""} retries={form.retries ?? ""}
          caption="App 里大致的样子，跟着上面选的语言变" />
      </div>
    </Drawer>
  );
}

/* ---------- 版本对比 ---------- */

export function CompareRows({ beforeLabel, afterLabel, rows }: {
  beforeLabel: ReactNode;
  afterLabel: ReactNode;
  rows: readonly { key: string; label: string; before: string; after: string }[];
}) {
  return (
    <div className="i6-compare" role="table" aria-label="新旧对比">
      <div className="i6-compare-head" role="row">
        <span role="columnheader">语言</span><span role="columnheader">{beforeLabel}</span><span role="columnheader">{afterLabel}</span>
      </div>
      {rows.map((row) => {
        const same = row.before === row.after;
        return <div key={row.key} className="i6-compare-row" role="row" data-same={same ? "" : undefined}>
          <span role="rowheader" className="i6-compare-lang">{row.label}{same ? <small>相同</small> : <StatusTag tone="progress">有改动</StatusTag>}</span>
          <span role="cell" className="i6-compare-text" data-empty={row.before ? undefined : ""}>{row.before || "缺"}</span>
          <span role="cell" className="i6-compare-text" data-after="" data-empty={row.after ? undefined : ""}>{row.after || "缺"}</span>
        </div>;
      })}
    </div>
  );
}
