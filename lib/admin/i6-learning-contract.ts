import type { I18nIntegrityIssueView, I18nLearningOverview, I18nMessagePairView, LearningCourseVersionView, LearningCourseView } from "./i-client";

/** Keep the BigDecimal token before JSON.parse can round it. */
export function parseI6Json(text: string): unknown {
  return JSON.parse(text.replace(/("rewardNex"\s*:\s*)(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

/** Payloads have already passed the course boundary; blank/null are the same stored option. */
export function validateI6CourseOptions(requested: Partial<Record<"completionCondition" | "rewardEvent", unknown>>, stored?: Partial<Record<"completionCondition" | "rewardEvent", unknown>>) {
  for (const key of ["completionCondition", "rewardEvent"] as const) {
    if (String(requested[key] ?? "").trim() !== String(stored?.[key] ?? "").trim()) {
      throw new Error("LEARNING_COURSE_OPTION_RETIRED");
    }
  }
}

function invalid(): never { throw new Error("数据暂时读不出来，请刷新重试。"); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function strings(value: unknown) { if (!list(value).every(item => typeof item === "string")) invalid(); }
function texts(row: Record<string, unknown>, keys: string[]) { if (!keys.every(key => typeof row[key] === "string")) invalid(); }
function translations(value: unknown) {
  if (value != null && !Object.values(object(value)).every(text => typeof text === "string")) invalid();
}
function natural(value: unknown) { if (!Number.isSafeInteger(value) || Number(value) < 0) invalid(); }
function reward(value: unknown) {
  // Nullable DTO values stay missing; repository-produced zero remains the server's zero.
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) invalid();
  const [mantissa, exponent] = value.toLowerCase().split("e");
  if (exponent === undefined) return value;
  const [whole, fraction = ""] = mantissa.split(".");
  const digits = whole + fraction;
  // Only the decimal-point position is an integer; the amount never enters floating point.
  const shift = Number(exponent);
  // Bound expansion before allocating zeros; preserve valid decimal tokens exactly.
  if (!Number.isSafeInteger(shift) || Math.abs(shift) > 1000) invalid();
  const point = whole.length + shift;
  if (!Number.isSafeInteger(point)) invalid();
  return point <= 0 ? `0.${"0".repeat(-point)}${digits}`
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`;
}
function quiz(value: unknown) {
  for (const item of list(value)) {
    const row = object(item);
    texts(row, ["questionId", "questionZh", "questionEn"]);
    strings(row.optionsZh); strings(row.optionsEn);
    if (row.questionVi != null && typeof row.questionVi !== "string") invalid();
    if (row.optionsVi != null) strings(row.optionsVi);
    translations(row.questionTranslations);
    if (row.optionTranslations != null) Object.values(object(row.optionTranslations)).forEach(strings);
    natural(row.correctOptionIndex);
  }
}

export function parseI6Message(value: unknown): I18nMessagePairView {
  const row = object(value);
  texts(row, ["messageKey", "namespace", "zh", "en", "vi", "status", "version"]);
  strings(row.placeholders);
  if (row.translations !== undefined && !Object.values(object(row.translations)).every(text => typeof text === "string")) invalid();
  for (const key of ["versionCreatedAt", "versionUpdatedAt"]) if (row[key] !== undefined && typeof row[key] !== "string") invalid();
  return row as I18nMessagePairView;
}

export function parseI6Issue(value: unknown): I18nIntegrityIssueView {
  const row = object(value);
  texts(row, ["code", "kind", "status"]); strings(row.samples); natural(row.cnt);
  if (row.repairedCount != null) natural(row.repairedCount);
  if (row.messageKey !== undefined || row.version !== undefined) {
    if (typeof row.messageKey !== "string" || !row.messageKey || typeof row.version !== "string" || !/^v[1-9]\d*$/.test(row.version)) invalid();
  }
  return row as I18nIntegrityIssueView;
}

export function parseI6Course(value: unknown): LearningCourseView {
  const row = object(value);
  texts(row, ["id", "title", "category", "format", "level", "duration", "version", "status", "body", "titleZh", "titleEn", "titleVi", "bodyZh", "bodyEn", "bodyVi"]);
  row.rewardNex = reward(row.rewardNex); natural(row.revision); quiz(row.quizQuestions);
  translations(row.titleTranslations); translations(row.bodyTranslations);
  if (typeof row.featured !== "boolean") invalid();
  for (const key of ["passScore", "retryLimit"]) if (row[key] != null) natural(row[key]);
  for (const key of ["completionCondition", "rewardEvent"]) if (row[key] != null && typeof row[key] !== "string") invalid();
  return row as LearningCourseView;
}

export function parseI6CourseVersion(value: unknown): LearningCourseVersionView {
  const row = object(value);
  texts(row, ["courseId", "version", "status"]); natural(row.revision);
  if (!["DRAFT", "PUBLISHED", "SUPERSEDED"].includes(String(row.status))) invalid();
  for (const key of ["createdAt", "updatedAt"]) if (row[key] !== null && typeof row[key] !== "string") invalid();
  const payload = object(row.payload);
  texts(payload, ["titleZh", "titleEn", "bodyZh", "bodyEn", "category", "format", "difficulty", "duration", "publishState"]);
  for (const key of ["titleVi", "bodyVi", "completionCondition", "rewardEvent", "version"]) if (payload[key] != null && typeof payload[key] !== "string") invalid();
  translations(payload.titleTranslations); translations(payload.bodyTranslations);
  payload.rewardNex = reward(payload.rewardNex);
  if (payload.quizQuestions != null) quiz(payload.quizQuestions);
  for (const key of ["passScore", "retryLimit", "expectedRevision"]) if (payload[key] != null) natural(payload[key]);
  return row as LearningCourseVersionView;
}

export function parseI6Overview(value: unknown): I18nLearningOverview {
  const row = object(value), stats = object(row.stats);
  for (const key of ["managedKeys", "totalKeys", "integrityIssues", "coursesOnline"]) natural(stats[key]);
  texts(stats, ["weeklyNexPayout"]);
  for (const item of list(row.namespaces)) {
    const ns = object(item); texts(ns, ["ns", "variants", "lastChange"]); natural(ns.keys);
    if (typeof ns.coverage !== "number" || !Number.isFinite(ns.coverage) || ns.coverage < 0 || ns.coverage > 100) invalid();
  }
  list(row.messages).forEach(parseI6Message); list(row.integrityIssues).forEach(parseI6Issue);
  if (row.focusMessage != null) parseI6Message(row.focusMessage);
  if (row.publishedMessages !== undefined) {
    for (const [key, value] of Object.entries(object(row.publishedMessages))) {
      const message = parseI6Message(value);
      if (message.messageKey !== key || message.status !== "published") invalid();
    }
  }
  list(row.courses).forEach(parseI6Course);
  for (const item of list(row.hardcodedFindings)) texts(object(item), ["location", "rawCopy", "suggestedKey", "status"]);
  if (row.metrics !== undefined) for (const item of list(row.metrics)) texts(object(item), ["key", "value"]);
  if (row.lastScanAt !== undefined && typeof row.lastScanAt !== "string") invalid();
  const range = object(row.rewardRange);
  if (![range.min, range.max].every(amount => typeof amount === "number" && Number.isFinite(amount)) || Number(range.min) > Number(range.max)) invalid();
  texts(row, ["featuredCourseId"]);
  for (const key of ["categories", "formats", "levels", "statuses", "sources"]) strings(row[key]);
  return row as I18nLearningOverview;
}
