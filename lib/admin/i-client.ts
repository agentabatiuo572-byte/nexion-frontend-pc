import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError, outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { parseIOverview, parseNotificationCampaign, parseNovaSocialEventPage, parseNovaSocialSample } from "@/lib/admin/i-overview-contract";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { parseI4PublishedSnapshot, parseI4SectionVersion } from "./i4-trust-contract";
import { parseI6Course, parseI6CourseVersion, parseI6Issue, parseI6Json, parseI6Message, parseI6Overview } from "./i6-learning-contract";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function idempotencyKey() {
  return `i-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// A transport failure has an unknown outcome: the backend may already have
// committed. Keep the key by exact command fingerprint so a manual retry
// replays the same command instead of creating a second write.
// 落 sessionStorage 而非内存:刷新页面后重试必须仍是同一命令号,否则后端无法去重。
// fingerprint = `${method}:${path}:${body}` —— path 带目标对象 id,method + path 区分动作类型。
type I1Original = { owner: number; method: string; path: string; body: string };
export type I3FormSnapshot = {
  audienceCatalog: NotificationAudienceCatalog;
  deliveryCatalog: NotificationCampaignOverview["deliveryCatalog"];
  estimatedAudience: number | null;
  estimatedAt: number | null;
};
export type I6CommandSnapshot = {
  message?: I18nMessagePairView;
  messageVersion?: I18nMessagePairView;
  course?: LearningCourseView;
  courseVersion?: LearningCourseVersionView;
  integrityIssue?: I18nIntegrityIssueView;
  featuredCourseId?: string;
  featuredCourse?: LearningCourseView;
  stats?: I18nLearningStats;
};
type IContentPending = PendingMutationRecord & { i6?: I1Original & { snapshot?: I6CommandSnapshot }; i4?: I1Original & { snapshot?: TrustSectionVersionView }; i1?: I1Original; i2?: I1Original; i3?: I1Original & { snapshot?: NotificationCampaignRow; formSnapshot?: I3FormSnapshot } };
export type I1Command = PendingMutationRecord & {
  original?: I1Original;
  label: string;
  target: string;
  permission: string;
  reason: string;
  change: string;
};

// One instance for the domain. Retain expired evidence for query-only recovery.
const uncertainCommandKeys = createPendingMutationStore<IContentPending>({
  storageKey: "nexion-admin-i-content-uncertain-commands-v1",
  retainExpiredRecords: (row) => /^(POST|PUT|PATCH|DELETE):\/(copy-ab\/|nova\/|campaigns(?::|\/)|trust-disclosure\/trust-sections\/|i18n-learning\/)/.test(row.fingerprint),
});

export type I6Command = PendingMutationRecord & {
  original?: I1Original;
  scope: string;
  operation: string;
  label: string;
  target: string;
  version: string;
  reason: string;
  input: Record<string, unknown>;
  snapshot?: I6CommandSnapshot;
};

/** Decode persisted originals once; replay always sends their saved bytes. Legacy fingerprints remain recoverable. */
function readI6Command(row: IContentPending): I6Command | undefined {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined || (row.i6 ? row.i6.owner !== owner : !hasPersistedPendingCommandOwner(String(owner)))) return undefined;
  const match = /^(POST|PATCH|DELETE):(\/i18n-learning\/[^:]+):([\s\S]*)$/.exec(row.fingerprint);
  if (!match) return undefined;
  const fallback: I6Command = { ...row, original: undefined, scope: "unknown", operation: "unknown", label: "结果未知", target: "", version: "", reason: "", input: {} };
  try {
    const [, method, path, body] = match;
    const parts = path.split("/").map(decodeURIComponent);
    const parsed: unknown = parseI6Json(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return fallback;
    const input = parsed as Record<string, unknown>;
    if (typeof input.reason !== "string" || typeof input.operator !== "string"
      || row.i6 && (row.i6.method !== method || row.i6.path !== path || row.i6.body !== body)) return fallback;
    let operation: string | undefined, target = parts[3] ?? "", version = parts[5] ?? "", scope = "";
    if (parts.length === 3 && parts[2] === "rescan" && method === "POST") { operation = "rescan"; scope = "rescan"; }
    if (parts[2] === "messages") {
      operation = parts.length === 5 && parts[4] === "draft" && method === "PATCH" ? "message-draft"
        : parts.length === 5 && parts[4] === "publish" && method === "POST" ? "message-publish"
          : parts.length === 4 && method === "DELETE" ? "message-archive"
            : parts.length === 7 && parts[4] === "versions" && parts[6] === "rollback" && method === "POST" ? "message-rollback" : undefined;
      scope = `message:${target}`;
      if (typeof input.expectedVersion !== "string") return { ...fallback, scope, target };
    }
    if (parts[2] === "integrity" && parts.length === 5 && parts[4] === "fix" && method === "POST") {
      operation = "integrity-fix"; target = typeof input.messageKey === "string" ? input.messageKey : ""; scope = `message:${target}`;
    }
    if (parts[2] === "courses") {
      scope = `course:${target}`;
      operation = parts.length === 4 && target === "featured" && method === "PATCH" ? "featured"
        : parts.length === 4 && method === "POST" ? "course-create"
          : parts.length === 4 && method === "DELETE" ? "course-delete"
            : parts.length === 5 && parts[4] === "draft" && method === "PATCH" ? "course-draft"
              : parts.length === 5 && ["publish", "archive"].includes(parts[4]) && method === "POST" ? `course-${parts[4]}`
                : parts[4] === "versions" && parts.length === 5 && method === "POST" ? "version-create"
                  : parts[4] === "versions" && parts.length === 6 && method === "PATCH" ? "version-draft"
                    : parts[4] === "versions" && parts.length === 6 && method === "DELETE" ? "version-delete"
                      : parts[4] === "versions" && parts.length === 7 && ["publish", "rollback"].includes(parts[6]) && method === "POST" ? `version-${parts[6]}` : undefined;
      if (operation === "featured") { target = String(input.courseId ?? ""); scope = "featured"; }
      if (operation === "version-create") version = String(input.version ?? "");
    }
    const labels: Record<string, string> = { rescan: "重新检查全部文案", "message-draft": "保存三语草稿", "message-publish": "发布文案", "message-archive": "归档文案", "message-rollback": "回滚文案", "integrity-fix": "修复并存成草稿", "course-create": "保存新课程草稿", "course-draft": "保存课程草稿", "course-delete": "删除课程草稿", "course-publish": "发布课程", "course-archive": "下架课程", "version-create": "保存新版本草稿", "version-draft": "保存版本草稿", "version-delete": "删除版本草稿", "version-publish": "发布课程版本", "version-rollback": "回滚课程版本", featured: "更换首页推荐课" };
    if (!operation || !labels[operation] || operation !== "rescan" && !target) return { ...fallback, scope, target, version };
    if (["message-draft", "message-publish", "integrity-fix"].includes(operation)
      && !["zh", "en", "vi"].every(key => typeof input[key] === "string")) return { ...fallback, scope, target };
    if (["course-create", "course-draft", "version-create", "version-draft"].includes(operation)) {
      parseI6CourseVersion({ courseId: target, version: version || "v1", status: "DRAFT", payload: input, revision: 0, createdAt: null, updatedAt: null });
      if (operation.endsWith("draft") && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0)) return { ...fallback, scope, target };
    }
    let snapshot: I6CommandSnapshot | undefined;
    if (row.i6?.snapshot) {
      const saved = row.i6.snapshot;
      snapshot = { message: saved.message ? parseI6Message(saved.message) : undefined,
        messageVersion: saved.messageVersion ? parseI6Message(saved.messageVersion) : undefined,
        course: saved.course ? parseI6Course(saved.course) : undefined,
        courseVersion: saved.courseVersion ? parseI6CourseVersion(saved.courseVersion) : undefined,
        integrityIssue: saved.integrityIssue ? parseI6Issue(saved.integrityIssue) : undefined,
        featuredCourse: saved.featuredCourse ? parseI6Course(saved.featuredCourse) : undefined,
        featuredCourseId: saved.featuredCourseId, stats: saved.stats };
      if (snapshot.message && snapshot.message.messageKey !== target || snapshot.course && snapshot.course.id !== target
        || snapshot.messageVersion && (snapshot.messageVersion.messageKey !== target || snapshot.messageVersion.version !== version)
        || snapshot.courseVersion && snapshot.courseVersion.courseId !== target
        || snapshot.featuredCourseId !== undefined && typeof snapshot.featuredCourseId !== "string") return { ...fallback, scope, target, version };
      if (snapshot.stats && (![snapshot.stats.managedKeys, snapshot.stats.totalKeys, snapshot.stats.integrityIssues, snapshot.stats.coursesOnline]
        .every(value => Number.isSafeInteger(value) && value >= 0) || typeof snapshot.stats.weeklyNexPayout !== "string")) return { ...fallback, scope, target, version };
    }
    return { ...row, original: { owner, method, path, body }, scope, operation, label: labels[operation], target, version, reason: input.reason, input, snapshot };
  } catch { return fallback; }
}

export function pendingI6Commands(): I6Command[] {
  return uncertainCommandKeys.list().flatMap(row => { const command = readI6Command(row); return command ? [command] : []; });
}

export function i6RetryPermission(command: I6Command): string | undefined {
  const auth = useAdminAuth.getState(), session = auth.session;
  const permissions = command.operation.startsWith("message-") || ["rescan", "integrity-fix"].includes(command.operation)
    ? ["content_i6_write"] : ["content_i7_write", ...(["course-publish", "version-publish", "version-rollback"].includes(command.operation) ? ["content_i7_course_reward_adjust"] : [])];
  if (!auth.isAuthenticated || auth.logoutPending || !session || !permissions.every(permission => session.authorities.includes(permission))) return "当前账号没有这项操作权限，请查询原结果。";
  if (!command.original) return "原操作记录不完整，只能查询核对，不能重试。";
  return undefined;
}

async function sendI6Command(command: I6Command, retry: boolean): Promise<unknown> {
  const uncertain = (message: string) => Object.assign(new OutcomeUnknownError(message), { commandKey: command.commandKey });
  if (!command.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (command.original?.owner !== useAdminAuth.getState().session?.adminId) throw new Error("登录身份已变更，请重新打开页面。");
  const permission = i6RetryPermission(command);
  if (permission) throw new Error(permission);
  if (isRetryExpired(command)) throw new Error(RETRY_EXPIRED_TEXT);
  if (!uncertainCommandKeys.isDurablyStored(command.fingerprint, command.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, payload: ApiResult<unknown>;
  try {
    response = await guardedFetch(`/api/admin/content${command.original!.path}`, { method: command.original!.method,
      body: command.original!.body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.commandKey }, cache: "no-store" });
    payload = parseI6Json(await response.text()) as ApiResult<unknown>;
  } catch { throw uncertain("结果未知，请查询原结果或按原请求重试。"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Number.isInteger(payload.code)
    || payload.message !== undefined && typeof payload.message !== "string") throw uncertain("原操作回执无法核实，请保留记录并查询原结果。");
  const unknown = response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || isIdempotencyOutcomeOpen(payload.message);
  if (!response.ok || payload.code !== 0 || unknown) {
    const status = response.ok && payload.code! >= 400 && payload.code! < 500 ? payload.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(payload.message, `CONTENT_API_${response.status}`)), { status, reasonCode: payload.message });
    const rejected = retry ? isExplicitRejection(failure) : isDeterministicRejection(response.status, payload.code) && payload.code! < 500;
    if (rejected && !unknown) { uncertainCommandKeys.forget(command.fingerprint, command.commandKey); throw Object.assign(failure, { rejectedCommand: retry ? undefined : command }); }
    throw uncertain(failure.message);
  }
  let valid = false;
  try {
    if (command.operation === "rescan") { parseI6Overview(payload.data); valid = true; }
    else if (command.operation.startsWith("message-")) {
      const message = parseI6Message(payload.data);
      const expected = String(command.input.expectedVersion);
      const next = `v${Number(expected.replace(/^v/i, "")) + 1}`;
      valid = message.messageKey === command.target
        && message.status === (command.operation === "message-draft" ? "draft" : command.operation === "message-archive" ? "archived" : "published")
        && message.version === (["message-draft", "message-rollback"].includes(command.operation) ? next : expected);
    } else if (command.operation === "integrity-fix") valid = parseI6Issue(payload.data).code === command.original!.path.split("/")[3];
    else if (["course-delete", "version-delete"].includes(command.operation)) valid = payload.data === null;
    else if (["version-create", "version-draft"].includes(command.operation)) {
      const version = parseI6CourseVersion(payload.data);
      valid = version.courseId === command.target && version.version === command.version && version.status === "DRAFT"
        && version.revision === (command.operation === "version-create" ? 0 : Number(command.input.expectedRevision) + 1);
    } else {
      const course = parseI6Course(payload.data);
      valid = course.id === command.target && (command.operation === "featured" ? course.featured
        : course.status === (command.operation === "course-archive" ? "archived" : ["course-create", "course-draft"].includes(command.operation) ? "draft" : "published"))
        && (!command.version || course.version === command.version);
    }
  } catch { /* An unreadable success is still an unresolved original. */ }
  if (!valid) throw uncertain("原操作回执无法核实，请保留记录并查询原结果。");
  uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
  return payload.data;
}

export async function retryI6Command(saved: I6Command): Promise<unknown> {
  const command = pendingI6Commands().find(row => row.commandKey === saved.commandKey);
  if (!command) throw new Error("原操作已处理，请重新读取后再操作。");
  return sendI6Command(command, true);
}

async function prepareI6Command(path: string, init: RequestInit, snapshot?: I6CommandSnapshot): Promise<unknown> {
  const owner = useAdminAuth.getState().session?.adminId;
  if (!owner) throw new Error("请先登录后再提交。");
  const i6 = { owner, path, method: init.method!, body: String(init.body), snapshot };
  const fingerprint = `${i6.method}:${path}:${i6.body}`, commandKey = idempotencyKey();
  const command = readI6Command({ fingerprint, commandKey, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, i6 });
  if (!command?.original) throw new Error("原操作记录不完整，尚未提交。");
  const permission = i6RetryPermission(command);
  if (permission) throw new Error(permission);
  if (pendingI6Commands().some(row => row.scope === "unknown" || row.scope === command.scope)) throw new Error("此对象有结果未知的原操作，请先查询原结果。");
  uncertainCommandKeys.remember(fingerprint, commandKey, { i6 });
  if (!uncertainCommandKeys.isDurablyStored(fingerprint, commandKey)) {
    uncertainCommandKeys.forget(fingerprint, commandKey);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return sendI6Command(command, false);
}

/** Readback is evidence of current state, never proof that an old command executed. It never releases a direct record. */
export async function queryI6Command(saved: I6Command) {
  const command = pendingI6Commands().find(row => row.commandKey === saved.commandKey);
  if (!command) throw new Error("原操作已处理，请重新读取后再操作。");
  const overview = parseI6Overview(await apiRequest("/i18n-learning/overview"));
  const messageVersions = command.scope.startsWith("message:")
    ? await iContentActions.fetchI6MessageVersions(command.target) : undefined;
  const courseVersions = command.scope.startsWith("course:") && overview.courses.some(course => course.id === command.target)
    ? await iContentActions.fetchI7CourseVersions(command.target) : undefined;
  return { overview, messageVersions, courseVersions };
}

export type I4DraftCommand = PendingMutationRecord & {
  original?: I1Original;
  snapshot?: TrustSectionVersionView;
  action: "create" | "edit" | "delete";
  sectionKey: string;
  version: string;
  reason: string;
  input?: { version: string; description: string; structure: string; fields: { key: string; label: string; value: string }[];
    expectedRevision?: number; expectedSectionVersion: string; expectedSectionStatus: string };
};

function readI4DraftCommand(row: IContentPending): I4DraftCommand | undefined {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined || (row.i4 ? row.i4.owner !== owner : !hasPersistedPendingCommandOwner(String(owner)))) return undefined;
  const match = /^(POST|PATCH|DELETE):(\/trust-disclosure\/trust-sections\/[^/:]+\/versions(?:\/[^:]+)?):([\s\S]*)$/.exec(row.fingerprint);
  if (!match) return undefined;
  const [, method, path, body] = match;
  const parts = path.split("/").map(decodeURIComponent);
  const action = method === "POST" ? "create" : method === "PATCH" ? "edit" : "delete";
  const fallback: I4DraftCommand = { ...row, action, sectionKey: parts[3], version: parts[5] ?? "", reason: "" };
  try {
    const input = JSON.parse(body) as Record<string, unknown>;
    if (!input || typeof input !== "object" || typeof input.reason !== "string" || typeof input.operator !== "string"
      || (row.i4 && (row.i4.path !== path || row.i4.method !== method || row.i4.body !== body))) return fallback;
    if (action !== "create" && (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 0)) return fallback;
    if (action !== "delete") {
      if (!["version", "description", "structure", "expectedSectionVersion", "expectedSectionStatus"].every(key => typeof input[key] === "string")
        || !Array.isArray(input.fields) || !input.fields.every(field => field && typeof field === "object" && ["key", "label", "value"].every(key => typeof field[key] === "string"))
        || (action === "edit" && input.version !== parts[5])) return fallback;
    }
    return { ...fallback, original: { owner, method, path, body }, reason: input.reason,
      version: action === "create" ? String(input.version) : parts[5],
      input: action === "delete" ? undefined : input as I4DraftCommand["input"],
      snapshot: row.i4?.snapshot ? parseI4SectionVersion(row.i4.snapshot) : undefined };
  } catch { return fallback; }
}

export function pendingI4DraftCommands(): I4DraftCommand[] {
  return uncertainCommandKeys.list().flatMap(row => { const value = readI4DraftCommand(row); return value ? [value] : []; });
}

export function i4DraftPermission(): string | undefined {
  const auth = useAdminAuth.getState();
  return !auth.isAuthenticated || auth.logoutPending || !auth.session?.authorities.includes("content_i4_write")
    ? "当前账号没有草稿维护权限，请查询原结果。" : undefined;
}

async function sendI4DraftCommand(command: I4DraftCommand, retry: boolean): Promise<void> {
  if (!command.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (useAdminAuth.getState().session?.adminId !== command.original.owner) throw new Error("登录身份已变更，请重新打开页面。");
  if (isRetryExpired(command)) throw new Error(RETRY_EXPIRED_TEXT);
  const permission = i4DraftPermission();
  if (permission) throw new Error(permission);
  if (!uncertainCommandKeys.isDurablyStored(command.fingerprint, command.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, payload: ApiResult<unknown>;
  try {
    response = await guardedFetch(`/api/admin/content${command.original.path}`, { method: command.original.method,
      body: command.original.body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.commandKey }, cache: "no-store" });
    payload = await response.json();
  } catch { throw new OutcomeUnknownError("结果未知，请查询原结果或按原请求重试。"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Number.isInteger(payload.code)
    || payload.message !== undefined && typeof payload.message !== "string") throw new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。");
  if (!response.ok || payload.code !== 0 || response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
    const status = response.ok && payload.code! >= 400 && payload.code! < 500 ? payload.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(payload.message, `CONTENT_API_${response.status}`)), { status, reasonCode: payload.message });
    const rejected = retry ? isExplicitRejection(failure)
      : isDeterministicRejection(response.status, payload.code) && payload.code! < 500 && !isIdempotencyOutcomeOpen(payload.message);
    if (rejected && response.headers.get("X-Nexion-Upstream-Outcome") !== "unknown") {
      uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
      throw Object.assign(failure, { rejectedCommand: retry ? undefined : command });
    }
    throw new OutcomeUnknownError(failure.message);
  }
  let valid = command.action === "delete" && payload.data === null;
  if (command.action !== "delete") {
    try {
      const row = parseI4SectionVersion(payload.data);
      valid = row.sectionKey === command.sectionKey && row.version === command.version && row.status.toLowerCase() === "draft"
        && row.revision === (command.action === "create" ? 1 : command.input!.expectedRevision! + 1)
        && row.description === command.input!.description && row.structure === command.input!.structure
        && JSON.stringify(row.fields) === JSON.stringify(command.input!.fields);
    } catch { /* An unreadable success cannot resolve the original command. */ }
  }
  if (!valid) throw new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。");
  uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
}

export async function retryI4DraftCommand(saved: I4DraftCommand): Promise<void> {
  const original = pendingI4DraftCommands().find(row => row.commandKey === saved.commandKey);
  if (!original) throw new Error("原操作已处理，请重新读取后再操作。");
  return sendI4DraftCommand(original, true);
}

async function prepareI4DraftCommand(path: string, init: RequestInit, snapshot?: TrustSectionVersionView): Promise<void> {
  const owner = useAdminAuth.getState().session?.adminId;
  if (!owner) throw new Error("请先登录后再提交。");
  const fingerprint = `${init.method}:${path}:${init.body}`;
  const commandKey = idempotencyKey();
  const i4 = { owner, method: init.method!, path, body: String(init.body), snapshot };
  const command = readI4DraftCommand({ fingerprint, commandKey, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, i4 });
  if (!command?.original) throw new Error("原操作记录不完整，尚未提交。");
  if (pendingI4DraftCommands().some(row => row.sectionKey === command.sectionKey)) throw new Error("此对象有结果未知的原操作，请先到页面上方核对。");
  const permission = i4DraftPermission();
  if (permission) throw new Error(permission);
  uncertainCommandKeys.remember(fingerprint, commandKey, { i4 });
  if (!uncertainCommandKeys.isDurablyStored(fingerprint, commandKey)) {
    uncertainCommandKeys.forget(fingerprint, commandKey);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return sendI4DraftCommand(command, false);
}

export async function fetchI1CopyOverview(): Promise<CopyAbOverview> {
  return parseIOverview("I1", await apiRequest("/copy-ab/overview")) as CopyAbOverview;
}

export async function fetchI2NovaOverview(): Promise<NovaOverview> {
  return parseIOverview("I2", await apiRequest("/nova/overview")) as NovaOverview;
}

export async function fetchI6LearningOverview(): Promise<I18nLearningOverview> {
  return parseIOverview("I6", await apiRequest("/i18n-learning/overview")) as I18nLearningOverview;
}

export async function fetchI4TrustOverview(): Promise<TrustDisclosureOverview> {
  return parseIOverview("I4", await apiRequest("/trust-disclosure/overview")) as TrustDisclosureOverview;
}

/** I4-only read; the backend requires content_i4_read, including for unavailable snapshots. */
export async function fetchI4PublishedSnapshot(signal?: AbortSignal): Promise<TrustPublishedSnapshotView> {
  return parseI4PublishedSnapshot(await apiRequest("/trust-disclosure/published-snapshot", { signal }));
}

/** Preserve BigDecimal budget digits at each I3 JSON boundary, following the E6/G7 decimal boundary convention. */
export function parseI3Json(text: string): unknown {
  return JSON.parse(text.replace(/("budget"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"'));
}

function i3CampaignBody(body: Record<string, unknown>, reason: string): string {
  const budget = body.budget;
  let decimal: string | undefined;
  if (typeof budget === "string") {
    if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(budget)) throw new Error("预算记录格式不正确，请核对 USD 金额。");
    const [coefficient, exponent = "0"] = budget.toLowerCase().split("e");
    const digits = coefficient.replace(/[-.]/g, ""), fraction = coefficient.split(".")[1] ?? "";
    const trailingZeros = digits.length - digits.replace(/0+$/, "").length;
    if (/[1-9]/.test(digits) && BigInt(fraction.length) - BigInt(exponent) - BigInt(trailingZeros) > BigInt(2)) {
      throw new Error(formatAdminApiError("NOTIFICATION_BUDGET_INVALID", "CONTENT_API_422"));
    }
    decimal = budget.replace(/^(-?)0+(?=\d)/, "$1").replace(/^(-?)\./, (_, sign: string) => `${sign}0.`).replace(/\.(?=$|[eE])/, "");
  }
  return "{" + Object.entries(withReason(body, reason)).filter(([, value]) => value !== undefined)
    .map(([key, value]) => JSON.stringify(key) + ":" + (key === "budget" && decimal !== undefined ? decimal : JSON.stringify(value))).join(",") + "}";
}

export type I3Command = PendingMutationRecord & {
  original?: I1Original;
  snapshot?: NotificationCampaignRow;
  formSnapshot?: I3FormSnapshot;
  action: "create" | "draft" | "schedule" | "send-now" | "cancel" | "delete";
  name: string;
  target: string;
  reason: string;
  change: string;
};

/** Decode persisted/legacy JSON once. Original request bytes are never rebuilt for replay. */
function readI3Command(row: IContentPending): I3Command | undefined {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined || (row.i3 ? row.i3.owner !== owner : !hasPersistedPendingCommandOwner(String(owner)))) return undefined;
  const match = row.fingerprint.match(/^(POST|PATCH|DELETE):(\/campaigns(?:\/[^:]+)?):([\s\S]*)$/);
  if (!match || match[2] === "/campaigns/audience-estimate" || match[2].startsWith("/campaigns/caps/")) return undefined;
  const fallback: I3Command = { ...row, action: "create", name: "结果未知", target: "", reason: "", change: "" };
  try {
    const [, method, path, body] = match;
    if (row.i3 && (row.i3.method !== method || row.i3.path !== path || row.i3.body !== body)) return fallback;
    const payload: unknown = parseI3Json(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
    const input = payload as Record<string, unknown>;
    if (typeof input.reason !== "string" || typeof input.operator !== "string") return fallback;
    const [, , id, operation] = path.split("/").map(decodeURIComponent);
    const action = path === "/campaigns" && method === "POST" ? "create"
      : id && method === "PATCH" && operation === "draft" ? "draft"
        : id && method === "DELETE" && !operation ? "delete"
          : id && method === "POST" && ["schedule", "send-now", "cancel"].includes(operation) ? operation as "schedule" | "send-now" | "cancel" : undefined;
    if (!action || action !== "create" && (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 0)) return fallback;
    if (["create", "draft"].includes(action)) {
      if (!["name", "titleZh", "titleVi", "titleEn", "bodyZh", "bodyVi", "bodyEn", "kind", "ctaHref", "ctaLabel", "tier"].every((key) => typeof input[key] === "string")) return fallback;
      const target = input.audienceTarget as Record<string, unknown> | null;
      if (!target || typeof target !== "object" || !["phaseMin", "phaseMax", "language"].every((key) => typeof target[key] === "string")
        || !Number.isInteger(target.registrationDaysMin) || input.budget != null && !(typeof input.budget === "string" && /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(input.budget))) return fallback;
    }
    if (["schedule", "send-now"].includes(action) && typeof input.schedule !== "string") return fallback;
    const snapshot = row.i3?.snapshot ? parseNotificationCampaign(row.i3.snapshot) as NotificationCampaignRow : undefined;
    const formSnapshot = row.i3?.formSnapshot;
    if (formSnapshot && (!formSnapshot.audienceCatalog || !formSnapshot.deliveryCatalog || formSnapshot.audienceCatalog.conditionLogic !== "AND"
      || ![formSnapshot.audienceCatalog.phases, formSnapshot.audienceCatalog.languages, formSnapshot.deliveryCatalog.kinds, formSnapshot.deliveryCatalog.ctaRoutes]
        .every((options) => Array.isArray(options) && options.every((option) => option && typeof option.value === "string" && typeof option.label === "string"))
      || formSnapshot.estimatedAudience !== null && (!Number.isSafeInteger(formSnapshot.estimatedAudience) || formSnapshot.estimatedAudience < 0)
      || formSnapshot.estimatedAt !== null && !Number.isFinite(formSnapshot.estimatedAt))) return fallback;
    if (snapshot && (snapshot.id !== id || snapshot.revision !== input.expectedRevision)) return fallback;
    const change = action === "schedule" ? String(input.schedule) : action === "send-now" ? "已排期 → 已发送"
      : action === "cancel" ? "已排期 → 已取消" : action === "delete" ? "从列表移除"
        : `${input.tier} · ${JSON.stringify(input.audienceTarget)}`;
    return { ...row, original: { owner, method, path, body }, snapshot, formSnapshot, action,
      name: snapshot?.name ?? String(input.name ?? id), target: id ?? "create", reason: input.reason, change };
  } catch { return fallback; }
}

export function pendingI3Commands(): I3Command[] {
  return uncertainCommandKeys.list().flatMap((row) => {
    const command = readI3Command(row);
    return command ? [command] : [];
  });
}

export function i3RetryPermission(command: I3Command): string | undefined {
  if (!i1CanWrite("content_i3_write")) return "当前账号没有这项操作权限，请查询原结果。";
  // The execution permission is checked again server-side. Legacy action records without an original tier cannot prove this prerequisite.
  if (["schedule", "send-now", "cancel"].includes(command.action)) {
    if (!command.snapshot) return "原操作记录不完整，只能查询核对，不能重试。";
    if (command.snapshot.tier === "critical" && !i1CanWrite("content_i3_critical_send")) return "排期、发送和取消紧急通知要有紧急通知发送权限";
  }
  return undefined;
}

async function sendI3Command(command: I3Command, retry: boolean): Promise<void> {
  if (!command.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (useAdminAuth.getState().session?.adminId !== command.original.owner) throw new Error("登录身份已变更，请重新打开页面。");
  if (isRetryExpired(command)) throw new Error(RETRY_EXPIRED_TEXT);
  const permission = i3RetryPermission(command);
  if (permission) throw new Error(permission);
  if (!uncertainCommandKeys.isDurablyStored(command.fingerprint, command.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, payload: ApiResult<unknown>;
  try {
    response = await guardedFetch(`/api/admin/content${command.original.path}`, { method: command.original.method,
      body: command.original.body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.commandKey }, cache: "no-store" });
    payload = parseI3Json(await response.text()) as ApiResult<unknown>;
  } catch {
    throw Object.assign(new OutcomeUnknownError("结果未知，请查询原结果或按原请求重试。"), { commandKey: command.commandKey });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || !Number.isInteger(payload.code)
    || payload.message !== undefined && typeof payload.message !== "string") {
    throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  }
  if (!response.ok || payload.code !== 0 || response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
    const status = response.ok && payload.code! >= 400 && payload.code! < 500 ? payload.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(payload.message, `CONTENT_API_${response.status}`)), { status, reasonCode: payload.message });
    const rejected = retry ? isExplicitRejection(failure)
      : isDeterministicRejection(response.status, payload.code) && payload.code! < 500 && !isIdempotencyOutcomeOpen(payload.message);
    if (rejected && response.headers.get("X-Nexion-Upstream-Outcome") !== "unknown") {
      uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
      throw Object.assign(failure, { rejectedCommand: retry ? undefined : command });
    }
    throw Object.assign(new OutcomeUnknownError(failure.message), { commandKey: command.commandKey });
  }
  // A historical receipt resolves this command only; the page must read current state separately.
  let valid = false;
  if (command.action === "delete") valid = payload.data === null;
  else {
    try {
      const row = parseNotificationCampaign(payload.data) as NotificationCampaignRow;
      const input = JSON.parse(command.original.body) as Record<string, unknown>;
      const expectedStatus = { create: "draft", draft: "draft", schedule: "scheduled", "send-now": "sent", cancel: "cancelled" }[command.action];
      valid = !!row.id && row.status === expectedStatus
        && (command.action === "create" ? row.revision === 0 && row.name === String(input.name).trim()
          : row.id === command.target && row.revision === Number(input.expectedRevision) + (command.action === "send-now" ? 2 : 1));
    } catch { /* Unreadable success is still unknown; retain the original request. */ }
  }
  if (!valid) throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
}

/** Read-only reconciliation does not claim that a current row is the original command's receipt. */
export async function fetchI3CampaignOverview(): Promise<NotificationCampaignOverview> {
  return parseIOverview("I3", await apiRequest<unknown>("/campaigns/overview")) as NotificationCampaignOverview;
}

export async function retryI3Command(saved: I3Command): Promise<void> {
  const command = pendingI3Commands().find((row) => row.commandKey === saved.commandKey);
  if (!command) throw new Error("原操作已处理，请重新读取后再操作。");
  return sendI3Command(command, true);
}

async function prepareI3Command(path: string, init: RequestInit, snapshot?: NotificationCampaignRow, formSnapshot?: I3FormSnapshot): Promise<void> {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined) throw new Error("无法确认当前登录账号，请重新登录后再操作。");
  const fingerprint = `${init.method}:${path}:${init.body}`;
  const commandKey = idempotencyKey();
  const i3 = { owner, method: init.method!, path, body: String(init.body), snapshot, formSnapshot };
  const command = readI3Command({ fingerprint, commandKey, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, i3 });
  if (!command?.original) throw new Error("原操作记录不完整，尚未提交。");
  if (pendingI3Commands().some((row) => !row.original || row.target === command.target)) throw new Error("此对象有结果未知的原操作，请先到页面上方核对。");
  const permission = i3RetryPermission(command);
  if (permission) throw new Error(permission);
  uncertainCommandKeys.remember(fingerprint, commandKey, { i3 });
  if (!uncertainCommandKeys.isDurablyStored(fingerprint, commandKey)) {
    uncertainCommandKeys.forget(fingerprint, commandKey);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return sendI3Command(command, false);
}

export type I2Command = PendingMutationRecord & {
  original?: I1Original;
  action: string;
  object: string;
  target: string;
  reason: string;
  change: string;
  cadence?: { tick: string; cooldown: string };
};

/** The fingerprint contains the original JSON bytes, including legacy records. Parse only at this storage boundary. */
function readI2Command(row: IContentPending): I2Command | undefined {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined || (row.i2 ? row.i2.owner !== owner : !hasPersistedPendingCommandOwner(String(owner)))) return undefined;
  const match = row.fingerprint.match(/^(POST|PATCH|DELETE):(\/nova\/[^:]+):([\s\S]*)$/);
  if (!match) return undefined;
  const fallback: I2Command = { ...row, action: "结果未知", object: "", target: "", reason: "", change: "" };
  try {
    const [, method, path, body] = match;
    if (row.i2 && (row.i2.method !== method || row.i2.path !== path || row.i2.body !== body)) return fallback;
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
    const input = payload as Record<string, unknown>;
    if (typeof input.reason !== "string" || typeof input.operator !== "string") return fallback;
    const parts = path.split("/").slice(2).map(decodeURIComponent);
    const [family, key, operation] = parts;
    let action: string, object: string, target: string, change = "", cadence: I2Command["cadence"];
    if (family === "channels") {
      const creating = method === "POST" && parts.length === 1;
      if (creating || method === "PATCH" && parts.length === 2) {
        if (!["name", "trigger", "tick", "cooldown"].every((field) => typeof input[field] === "string")
          || typeof input.ctr !== "number" || typeof input.enabled !== "boolean" || creating && typeof input.key !== "string") return fallback;
        action = creating ? "新增频道" : "编辑频道";
        object = String(input.name); target = `channel:${key ?? input.key}`;
        cadence = { tick: input.tick as string, cooldown: input.cooldown as string };
      } else if (method === "PATCH" && operation === "status" && parts.length === 3 && typeof input.enabled === "boolean") {
        action = input.enabled ? "启用频道" : "停用频道"; object = key; target = `channel:${key}`;
        change = input.enabled ? "已停用 → 已启用" : "已启用 → 已停用";
      } else if (method === "DELETE" && parts.length === 2) {
        action = "删除频道"; object = key; target = `channel:${key}`;
      } else return fallback;
    } else if (family === "templates") {
      if (method === "POST" && parts.length === 1 || method === "PATCH" && parts.length === 2) {
        if (!["channel", "name", "cta", "version", "titleZh", "bodyZh", "titleVi", "bodyVi", "titleEn", "bodyEn"].every((field) => typeof input[field] === "string")) return fallback;
        action = method === "POST" ? "新建模板草稿" : "保存模板草稿";
        object = String(input.name); target = `channel:${key ?? input.channel}`; change = `${input.version} · 草稿`;
      } else if (method === "PATCH" && operation === "status" && parts.length === 3 && typeof input.status === "string" && ["PUBLISHED", "ARCHIVED"].includes(input.status)) {
        action = input.status === "PUBLISHED" ? "发布模板" : "归档模板"; object = key; target = `channel:${key}`;
        change = input.status === "PUBLISHED" ? "草稿 → 已发布" : "已发布 → 已归档";
      } else if (method === "DELETE" && parts.length === 2) {
        action = "删除模板"; object = key; target = `channel:${key}`;
      } else return fallback;
    } else if (family === "social-distribution" && method === "PATCH" && parts.length === 1) {
      const items = input.items, expected = input.expectedItems;
      const valid = (rows: unknown): rows is { key: string; pct: number }[] => Array.isArray(rows) && rows.length === 5 && rows.every((item) => item && typeof item === "object"
        && typeof item.key === "string" && typeof item.pct === "number" && Number.isInteger(item.pct) && item.pct >= 0 && item.pct <= 100);
      if (!valid(items) || !valid(expected)) return fallback;
      action = "保存事件概率"; object = "真实动态"; target = "distribution";
      change = items.map((item) => `${item.key} ${expected.find((old) => old.key === item.key)?.pct ?? "—"}% → ${item.pct}%`).join(" · ");
    } else if (family === "social-events" && key === "sync" && method === "POST" && parts.length === 2) {
      action = "同步真实事件"; object = "真实动态"; target = "sync";
    } else if (family === "social-events" && /^[1-9]\d*$/.test(key) && Number.isSafeInteger(Number(key))) {
      object = `#${key}`; target = `event:${key}`;
      if (method === "PATCH" && operation === "status" && parts.length === 3 && typeof input.status === "string" && ["ACTIVE", "DISABLED", "EXPIRED"].includes(input.status)) {
        action = input.status === "ACTIVE" ? "恢复事件" : input.status === "DISABLED" ? "停用事件" : "立即过期事件";
        change = input.status === "ACTIVE" ? "已停用 → 有效" : input.status === "DISABLED" ? "有效 → 已停用" : "已过期";
      } else if (method === "DELETE" && parts.length === 2) action = "删除事件";
      else return fallback;
    } else return fallback;
    return { ...row, original: { owner, method, path, body }, action, object, target, reason: input.reason, change, cadence };
  } catch { return fallback; }
}

export function pendingI2Commands(): I2Command[] {
  return uncertainCommandKeys.list().flatMap((row) => {
    const command = readI2Command(row);
    return command ? [command] : [];
  });
}

/** Receipts are historical results, never a replacement for the current overview. */
function i2ReceiptMatches(command: I2Command, data: unknown): boolean {
  const { path, method, body } = command.original!;
  if (method === "DELETE") return data == null;
  const input = JSON.parse(body) as Record<string, unknown>;
  const [family, key, operation] = path.split("/").slice(2).map(decodeURIComponent);
  if (family === "social-distribution") {
    const expected = input.items as { key: string; pct: number }[];
    return Array.isArray(data) && data.length === expected.length && expected.every((item) =>
      data.some((row) => row && typeof row === "object" && row.key === item.key && row.pct === item.pct));
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const result = data as Record<string, unknown>;
  if (family === "channels") return result.key === (key ?? input.key) && typeof result.enabled === "boolean"
    && result.enabled === (method === "POST" ? false : input.enabled)
    && (operation === "status" || ["name", "trigger", "tick", "cooldown"].every((field) => result[field] === String(input[field]).trim()));
  if (family === "templates") return result.channel === (key ?? input.channel)
    && result.status === (operation === "status" ? input.status : "DRAFT")
    && (operation === "status" || ["name", "cta", "version", "titleZh", "bodyZh", "titleVi", "bodyVi", "titleEn", "bodyEn"].every((field) => result[field] === String(input[field]).trim()));
  if (key === "sync") return ["discovered", "inserted", "duplicates"].every((field) => typeof result[field] === "number" && Number.isInteger(result[field]) && Number(result[field]) >= 0)
    && Array.isArray(result.sources) && result.sources.every((source) => source && typeof source === "object"
      && ["AVAILABLE", "UNAVAILABLE"].includes(source.status)
      && ["sourceType", "sourceTable", "message"].every((field) => typeof source[field] === "string")
      && ["discovered", "inserted", "duplicates"].every((field) => Number.isInteger(source[field]) && source[field] >= 0));
  return result.id === Number(key) && result.status === input.status;
}

async function sendI2Command(command: I2Command, retry: boolean): Promise<unknown> {
  if (!command.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (isRetryExpired(command)) throw new Error(RETRY_EXPIRED_TEXT);
  if (!i1CanWrite("content_i2_write")) throw new Error("当前账号没有这项操作权限，请查询原结果。");
  if (!uncertainCommandKeys.isDurablyStored(command.fingerprint, command.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, payload: ApiResult<unknown>;
  try {
    response = await guardedFetch(`/api/admin/content${command.original.path}`, { method: command.original.method,
      body: command.original.body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.commandKey }, cache: "no-store" });
    payload = await response.json() as ApiResult<unknown>;
  } catch {
    throw Object.assign(new OutcomeUnknownError("结果未知，请查询原结果或按原请求重试。"), { commandKey: command.commandKey });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof payload.code !== "number"
    || payload.message !== undefined && typeof payload.message !== "string") {
    throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  }
  if (!response.ok || payload.code !== 0) {
    // I2 services return ApiResult.fail(4xx, reason) inside HTTP 200. Preserve that business status for the shared retry verdict.
    const status = response.ok && payload.code >= 400 && payload.code < 500 ? payload.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(payload.message, `CONTENT_API_${response.status}`)), { status, reasonCode: payload.message });
    if (retry ? isExplicitRejection(failure) : isDeterministicRejection(response.status, payload.code) && payload.code < 500 && !isIdempotencyOutcomeOpen(payload.message)) {
      uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
      throw Object.assign(failure, { rejectedCommand: retry ? undefined : command });
    }
    throw Object.assign(new OutcomeUnknownError(failure.message), { commandKey: command.commandKey, status: response.status, reasonCode: payload.message });
  }
  if (!i2ReceiptMatches(command, payload.data)) throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
  return payload.data;
}

export async function retryI2Command(saved: I2Command): Promise<void> {
  const command = pendingI2Commands().find((row) => row.commandKey === saved.commandKey);
  if (!command?.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  await sendI2Command(command, true);
}

async function prepareI2Command(path: string, init: RequestInit) {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined) throw new Error("无法确认当前登录账号，请重新登录后再操作。");
  const fingerprint = `${init.method}:${path}:${init.body}`;
  const commandKey = idempotencyKey();
  const original = { owner, method: init.method!, path, body: String(init.body) };
  const command = readI2Command({ fingerprint, commandKey, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, i2: original });
  if (!command?.original) throw new Error("原操作记录不完整，尚未提交。");
  if (!i1CanWrite("content_i2_write")) throw new Error("当前账号没有这项操作权限，请查询原结果。");
  if (pendingI2Commands().some((row) => !row.original || row.target === command.target
    || path === "/nova/channels" && row.original.method === "POST" && row.original.path === path
      && row.object.trim() === command.object.trim())) throw new Error("此对象有结果未知的原操作，请先到页面上方核对。");
  uncertainCommandKeys.remember(fingerprint, commandKey, { i2: original });
  if (!uncertainCommandKeys.isDurablyStored(fingerprint, commandKey)) {
    uncertainCommandKeys.forget(fingerprint, commandKey);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return sendI2Command(command, false);
}

/** Parse durable/legacy requests at their untrusted storage boundary, without rebuilding their JSON. */
function readI1Command(row: IContentPending): I1Command | undefined {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined || (row.i1 ? row.i1.owner !== owner : !hasPersistedPendingCommandOwner(String(owner)))) return undefined;
  const match = row.fingerprint.match(/^(POST|PUT|PATCH|DELETE):(\/copy-ab\/[^:]+):([\s\S]*)$/);
  if (!match) return undefined;
  const fallback: I1Command = { ...row, label: "结果未知", target: "", permission: "", reason: "", change: "" };
  try {
    const [, method, path, body] = match;
    if (row.i1 && (row.i1.method !== method || row.i1.path !== path || row.i1.body !== body)) return fallback;
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fallback;
    const input = payload as Record<string, unknown>;
    if (typeof input.reason !== "string" || typeof input.operator !== "string") return fallback;
    const parts = path.split("/").slice(2).map(decodeURIComponent);
    const [family, key, action, version, tail] = parts;
    let label: string, target: string, permission = "content_i1_write";
    if (family === "positions" && (method === "POST" && parts.length === 1 || method === "DELETE" && parts.length === 2)) {
      if (method === "POST" && typeof input.positionKey !== "string") return fallback;
      label = method === "POST" ? "新增文案位置" : "删除文案位置";
      target = `position:${key ?? input.positionKey}`;
    } else if (family === "version-options" && (method === "POST" && parts.length === 1 || ["PUT", "DELETE"].includes(method) && parts.length === 2)) {
      if (method === "POST" && typeof input.versionKey !== "string") return fallback;
      label = method === "POST" ? "新增文案版本" : method === "PUT" ? "编辑文案版本" : "删除文案版本";
      target = `version:${key ?? input.versionKey}`;
    } else if (family === "copies" && method === "POST" && parts.length === 1) {
      if (typeof input.copyKey !== "string") return fallback;
      label = "新增文案"; target = `copy:${input.copyKey}`; permission = "content_i1_copy_create";
    } else if (family === "copies" && key) {
      label = method === "PATCH" && action === "draft" && parts.length === 3 ? "存草稿"
        : method === "POST" && action === "versions" && parts.length === 3 ? "发布内容版本"
          : method === "POST" && action === "archive" && parts.length === 3 ? "下架当前发布版"
            : method === "POST" && action === "versions" && version && tail === "rollback" && parts.length === 5 ? "回滚"
              : method === "DELETE" && action === "versions" && version && parts.length === 4 ? "删除草稿" : "";
      if (!label) return fallback;
      target = `copy:${key}`;
    } else if (family === "framework" && key && parts.length === 2 && method === "PATCH") {
      label = "实验框架参数"; target = `framework:${key}`; permission = "content_i1_experiment_manage";
    } else if (family === "experiments" && method === "POST") {
      permission = "content_i1_experiment_manage";
      if (parts.length === 1 && typeof input.copyKey === "string") {
        label = "创建 A/B 实验"; target = `copy:${input.copyKey}`;
      } else if (key && parts.length === 3 && ["start", "stop", "discard", "adopt"].includes(action)) {
        label = ({ start: "启动实验", stop: "停止实验", discard: "弃用实验", adopt: "采纳获胜变体" })[action as "start" | "stop" | "discard" | "adopt"];
        target = `exp:${key}`;
      } else return fallback;
    } else return fallback;
    const from = input.expectedValue ?? input.expectedVersion;
    const to = input.value ?? input.version ?? (tail === "rollback" ? version : undefined);
    return { ...row, original: { owner, method, path, body }, label, target, permission, reason: input.reason,
      change: from !== undefined || to !== undefined ? `${from ?? "—"} → ${to ?? "—"}` : "" };
  } catch { return fallback; }
}

export function pendingI1Commands(): I1Command[] {
  return uncertainCommandKeys.list().flatMap((row) => {
    const command = readI1Command(row);
    return command ? [command] : [];
  });
}

function i1CanWrite(permission: string) {
  const session = useAdminAuth.getState().session;
  return !!session && (session.role === "superadmin" || session.authorities.includes(permission));
}

/** Validate the actual write receipt before forgetting its durable evidence. Never use it as current overview. */
function i1ReceiptMatches(command: I1Command, data: unknown) {
  if (!command.original) return false;
  const { path, method, body } = command.original;
  const input = JSON.parse(body) as Record<string, unknown>;
  const parts = path.split("/").slice(2).map(decodeURIComponent);
  const [family, key, action, version, tail] = parts;
  if (method === "DELETE" && ["positions", "version-options"].includes(family)) return data === null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const result = data as Record<string, unknown>;
  if (family === "positions") return result.positionKey === input.positionKey && result.status === "active";
  if (family === "version-options") return result.versionKey === (key ?? input.versionKey)
    && typeof result.status === "string" && result.status.toUpperCase() === String(input.status).toUpperCase()
    && result.revision === (method === "POST" ? 1 : Number(input.expectedRevision) + 1);
  if (family === "framework") return result.key === key && result.current === input.value;
  if (family === "experiments") return typeof result.id === "string" && (key ? result.id === key : result.copyKey === input.copyKey)
    && result.state === (key ? ({ start: "running", stop: "concluded", discard: "discarded", adopt: "adopted" })[action as "start"] : "scheduled")
    && Array.isArray(result.variants) && result.variants.length >= 2;
  if (family === "copies") return result.key === (key ?? input.copyKey)
    && result.revision === (key ? Number(input.expectedRevision) + 1 : 1)
    // 18308d7b preserves the copy's existing publication/archive state. Older
    // receipts still carry draft-saved; neither state changes the draft proof.
    && (action === "draft" ? result.draftVersion === input.version && ["published", "archived", "draft-saved"].includes(String(result.status))
      : method === "DELETE" ? result.draftVersion == null
        : result.version === (tail === "rollback" ? version : action === "archive" ? input.expectedVersion : input.version)
          && result.status === (action === "archive" ? "archived" : "published"));
  return false;
}

async function sendI1Command(command: I1Command, retry: boolean): Promise<unknown> {
  if (!command.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (isRetryExpired(command)) throw new Error(RETRY_EXPIRED_TEXT);
  if (!i1CanWrite(command.permission)) throw new Error("当前账号没有这项操作权限，请查询原结果。");
  if (!uncertainCommandKeys.isDurablyStored(command.fingerprint, command.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, payload: ApiResult<unknown>;
  try {
    response = await guardedFetch(`/api/admin/content${command.original.path}`, { method: command.original.method,
      body: command.original.body, headers: { "Content-Type": "application/json", "Idempotency-Key": command.commandKey }, cache: "no-store" });
    payload = await response.json() as ApiResult<unknown>;
  } catch {
    throw Object.assign(new OutcomeUnknownError("结果未知，请查询原结果或按原请求重试。"), { commandKey: command.commandKey });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  }
  if ((payload.code !== undefined && typeof payload.code !== "number") || (payload.message !== undefined && typeof payload.message !== "string")) {
    throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  }
  const unknown = response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || isIdempotencyOutcomeOpen(payload.message);
  if (!response.ok || payload.code !== 0 || unknown) {
    const status = response.ok && payload.code! >= 400 && payload.code! < 500 ? payload.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(payload.message, `CONTENT_API_${response.status}`)), { status, reasonCode: payload.message });
    const rejected = retry ? isExplicitRejection(failure) : isDeterministicRejection(response.status, payload.code) && payload.code! < 500 && !isIdempotencyOutcomeOpen(payload.message);
    if (rejected && !unknown) {
      uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
      throw Object.assign(failure, { rejectedCommand: retry ? undefined : command });
    }
    throw Object.assign(new OutcomeUnknownError(failure.message), { commandKey: command.commandKey, status: response.status, reasonCode: payload.message });
  }
  if (!i1ReceiptMatches(command, payload.data)) throw Object.assign(new OutcomeUnknownError("原操作回执无法核实，请保留记录并查询原结果。"), { commandKey: command.commandKey });
  uncertainCommandKeys.forget(command.fingerprint, command.commandKey);
  return payload.data;
}

export async function retryI1Command(saved: I1Command): Promise<void> {
  const command = pendingI1Commands().find((row) => row.commandKey === saved.commandKey);
  if (!command?.original) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  await sendI1Command(command, true);
}

async function prepareI1Command(path: string, init: RequestInit) {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined) throw new Error("无法确认当前登录账号，请重新登录后再操作。");
  const fingerprint = `${init.method}:${path}:${init.body}`;
  const key = idempotencyKey();
  const original = { owner, method: init.method!, path, body: String(init.body) };
  const command = readI1Command({ fingerprint, commandKey: key, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000, i1: original });
  if (!command?.original) throw new Error("原操作记录不完整，尚未提交。");
  if (!i1CanWrite(command.permission)) throw new Error("当前账号没有这项操作权限，请查询原结果。");
  if (pendingI1Commands().some((row) => !row.original || row.target === command.target)) throw new Error("此对象有结果未知的原操作，请先到页面上方核对。");
  uncertainCommandKeys.remember(fingerprint, key, { i1: original });
  if (!uncertainCommandKeys.isDurablyStored(fingerprint, key)) {
    uncertainCommandKeys.forget(fingerprint, key);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return sendI1Command(command, false);
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  if (path.startsWith("/copy-ab/") && init?.method && init.method !== "GET") return prepareI1Command(path, init) as Promise<T>;
  if (path.startsWith("/nova/") && init?.method && init.method !== "GET") return prepareI2Command(path, init) as Promise<T>;
  const headers = new Headers(init?.headers);
  const isWrite = !!init?.method && init.method !== "GET" && path !== "/campaigns/audience-estimate";
  const commandFingerprint = isWrite
    ? `${init?.method}:${path}:${typeof init?.body === "string" ? init.body : ""}`
    : "";
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (isWrite && !headers.has("Idempotency-Key")) {
    const stableKey = uncertainCommandKeys.get(commandFingerprint) ?? idempotencyKey();
    uncertainCommandKeys.remember(commandFingerprint, stableKey);
    headers.set("Idempotency-Key", stableKey);
  }
  let res: Response;
  try {
    res = await guardedFetch(`/api/admin/content${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    // Preserve the fingerprint/key pair. The next identical operator retry is
    // a durable idempotent replay, never a fresh mutation.
    if (isWrite) throw new OutcomeUnknownError(error instanceof Error ? error.message : String(error));
    throw error;
  }
  let payload: ApiResult<T>;
  try {
    const text = await res.text();
    payload = text ? ((path === "/campaigns/overview" ? parseI3Json(text) : path.startsWith("/i18n-learning/") ? parseI6Json(text) : JSON.parse(text)) as ApiResult<T>) : {};
  } catch (error) {
    if (isWrite) throw new OutcomeUnknownError(formatAdminApiError(undefined, `CONTENT_API_${res.status}`));
    throw error;
  }
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    // 本域早就是目标口径(只在确定性拒绝时弃号),2026-08-06 改接共享谓词统一来源:
    // 判据只此一处,别处再改口径时不会落下这一面。
    const unknown = outcomeStaysUnknown(res.status, payload.code) || isIdempotencyOutcomeOpen(payload.message);
    if (isWrite && !unknown) {
      uncertainCommandKeys.forget(commandFingerprint);
    }
    const message = payload.message === "DISCLOSURE_JURISDICTION_CODE_EXISTS"
      ? "这个代码已有适用范围在用，请更换代码；如需改名，请编辑已有的适用范围。"
      : payload.message;
    const formatted = formatAdminApiError(message, `CONTENT_API_${res.status}`);
    throw Object.assign(isWrite && unknown ? new OutcomeUnknownError(formatted) : new Error(formatted), { status: res.status, reasonCode: payload.message });
  }
  if (isWrite) uncertainCommandKeys.forget(commandFingerprint);
  return payload.data as T;
}

/** 页面自己存着原操作时传命令号；不传就走上面的指纹存储。 */
function commandHeaders(commandKey?: string): Record<string, string> | undefined {
  return commandKey ? { "Idempotency-Key": commandKey } : undefined;
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string) {
  return { ...body, operator: currentAdminOperator(), reason };
}

export type CopyAbStats = {
  managedCopies: number;
  runningExps: number;
  weeklyExposures: string;
  topLift: string;
};

export type CopyModule = "home" | "store" | "earn" | "me";

export type CopyAudienceTarget = {
  mode: "structured";
  locales: string[];
  tiers: string[];
  registrationDaysMin?: number | null;
  registrationDaysMax?: number | null;
};

export type CopyPositionView = {
  positionKey: string;
  name: string;
  surface: CopyModule;
  sortOrder: number;
  status: string;
};

export type CopyVersionOptionView = {
  versionKey: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "INACTIVE";
  sortOrder: number;
  revision: number;
  usageCount?: number;
};

export type CopyContentRow = {
  key: string;
  desc: string;
  surface: string;
  version: string;
  status: string;
  i18nKey: string;
  expId: string;
  lastChange: string;
  draftVersion?: string;
  draftZh?: string;
  draftEn?: string;
  draftVi?: string;
  copyPosition?: string;
  draftCopyPosition?: string;
  draftSurface?: string;
  draftAudience?: string;
  draftAudienceTarget?: CopyAudienceTarget | null;
  draftTrafficSplit?: string;
  draftNote?: string;
  revision?: number;
  usedVersionKeys?: string[];
};

export type CopyVersionRow = {
  copyKey: string;
  version: string;
  status: string;
  chain: string;
  ts: string;
  zh: string;
  en: string;
  vi: string;
  copyPosition?: string;
  surface: string;
  audience: string;
  audienceTarget?: CopyAudienceTarget | null;
  trafficSplit: string;
  versionNote: string;
  estimatedAudience?: number;
};

export type CopyExperimentRow = {
  id: string;
  copyKey: string;
  variants: { name: string; split: number; cvr: number; version?: string | null; impressions?: number; conversions?: number }[];
  audience: string;
  estimatedAudience?: number;
  impressions: string;
  conversions: string;
  state: string;
  note: string;
};

export type CopyFrameworkParamView = {
  key: string;
  name: string;
  current: string;
  description: string;
};

export type CopyAbOverview = {
  stats: CopyAbStats;
  copies: CopyContentRow[];
  versions: CopyVersionRow[];
  experiments: CopyExperimentRow[];
  frameworkParams: CopyFrameworkParamView[];
  positions: CopyPositionView[];
  versionOptions: CopyVersionOptionView[];
  surfaces: string[];
  audiences: string[];
  trafficSplits: string[];
  sources: string[];
};

export type NovaStats = {
  todayDelivered: string;
  ctr: string;
  ctrTarget: number;
  onlineChannels: number;
  totalChannels: number;
  weeklySocial: string;
};

export type NovaChannelView = {
  key: string;
  name: string;
  trigger: string;
  tick: string;
  cooldown: string;
  phaseKeyed: string;
  ctr: number;
  enabled: boolean;
};

export type NovaTemplateView = {
  channel: string;
  name: string;
  cta: string;
  version: string;
  titleZh: string;
  bodyZh: string;
  titleVi: string;
  bodyVi: string;
  titleEn: string;
  bodyEn: string;
  status: string;
};

export type LearningCourseVersionView = {
  courseId: string;
  version: string;
  status: "DRAFT" | "PUBLISHED" | "SUPERSEDED";
  payload: Record<string, unknown>;
  revision: number;
  createdAt: string | null;
  updatedAt: string | null;
};

export type NovaOptionView = { value: string; label: string };

export type NovaEventDrivenView = {
  name: string;
  reason: string;
  owner: string;
  tone: string;
  status: string;
};

export type NovaSocialDistributionItem = {
  key: string;
  name: string;
  pct: number;
  color: string;
};

export type NovaSocialEventStatus = "ACTIVE" | "DISABLED" | "EXPIRED";

export type NovaSocialEventView = {
  id: number;
  eventType: string;
  eventTypeLabel?: string;
  sourceSystem: string;
  sourceEventId: string;
  actorDisplay: string;
  cityDisplay: string;
  amountDisplay: string;
  sourceNote: string;
  status: NovaSocialEventStatus;
  eligible?: boolean;
  occurredAt: string;
  expiresAt: string;
  verifiedAt?: string | null;
  lastDispatchedAt?: string | null;
  dispatchCount: number;
  createdAt: string;
  updatedAt: string;
};

export type NovaSocialEventPage = {
  items: NovaSocialEventView[];
  page: number;
  pageSize: number;
  total: number;
};

export type NovaSocialEventSampleView = {
  id?: number;
  eventType?: string;
  sourceEventId?: string;
  language: "ZH" | "VI" | "EN";
  title?: string;
  body: string;
};

export type NovaSocialSyncResult = {
  discovered: number;
  inserted: number;
  duplicates: number;
  sources: Array<{
    sourceType: string;
    sourceTable: string;
    status: "AVAILABLE" | "UNAVAILABLE";
    discovered: number;
    inserted: number;
    duplicates: number;
    message: string;
  }>;
};

export type NovaOverview = {
  stats: NovaStats;
  channels: NovaChannelView[];
  eventDriven: NovaEventDrivenView[];
  templates: NovaTemplateView[];
  socialDistribution: NovaSocialDistributionItem[];
  socialEvents: NovaSocialEventView[];
  socialEventTypes: NovaOptionView[];
  socialEventStatuses: NovaOptionView[];
  templateStatuses: string[];
  templateCtaOptions: NovaOptionView[];
  runtimeSourceOptions: NovaOptionView[];
  sources: string[];
};

export type NotificationCampaignStats = {
  monthCampaigns: number;
  monthSent: number;
  monthScheduled: number;
  monthDraft: number;
  criticalInflight: number;
  avgReadRate: string;
  weeklySwipe: string;
};

export type NotificationCampaignRow = {
  id: string;
  name: string;
  kind: string;
  tier: "critical" | "high" | "normal" | "low";
  audience: string;
  reach: string;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  schedule: string;
  sent: string;
  read: string;
  bodyEn: string;
  bodyZh: string;
  bodyVi: string;
  ctaLabel: string;
  ctaHref: string;
  swipeTo: string;
  budget?: string | number | null;
  audienceTarget: NotificationAudienceTarget;
  revision: number;
};

export type NotificationAudienceTarget = {
  phaseMin: string;
  phaseMax: string;
  language: "all" | "zh" | "vi" | "en" | "id" | "ms" | "fil" | "ru" | "kk" | "uz";
  registrationDaysMin: number;
};

export type NotificationAudienceOption = { value: string; label: string };
export type NotificationAudienceCatalog = {
  phases: NotificationAudienceOption[];
  languages: NotificationAudienceOption[];
  conditionLogic: "AND";
};

export type NotificationAudienceEstimateView = {
  target: NotificationAudienceTarget;
  estimatedUsers: number;
};

export type NotificationCapRuleView = {
  tier: "critical" | "high" | "normal" | "low";
  cap: string;
  policy: string;
  locked: boolean;
};

export type NotificationSwipeRouteView = {
  to: string;
  kind: string;
  note: string;
};

export type NotificationCampaignOverview = {
  stats: NotificationCampaignStats;
  campaigns: NotificationCampaignRow[];
  capRules: NotificationCapRuleView[];
  tiers: string[];
  audiences: string[];
  statuses: string[];
  swipeRoutes: NotificationSwipeRouteView[];
  audienceCatalog: NotificationAudienceCatalog;
  deliveryCatalog: {
    kinds: NotificationAudienceOption[];
    ctaRoutes: NotificationAudienceOption[];
  };
  sources: string[];
};

export type TrustDisclosureStats = {
  managedSections: number;
  jurisdictions: number;
  staleAckUsers: number;
  weeklyGateBlocked: number;
  reackJurisdiction?: string;
  reackPct?: number;
};

export type TrustPublishedSnapshotView = {
  sampledAt: string;
  available: boolean;
  reason: string | null;
  source: string | null;
  sourceEnvironment: string;
  runId: string | null;
  sections: Array<{
    sectionKey: string;
    version: string | null;
    available: boolean;
    reason: string | null;
    fields: Array<{ key: string; cleared: boolean; reason: string | null }>;
  }>;
};

export type TrustSectionView = {
  key: string;
  desc: string;
  struct: string;
  version: string;
  status: string;
  lastChange: string;
  roleGate: string;
  highSensitivity: boolean;
};

export type FinancialFieldView = { key: string; value: string; delta: string | null };
export type TrustSectionFieldView = { sectionKey: string; key: string; value: string };
export type TrustSectionVersionView = {
  sectionKey: string;
  version: string;
  description: string;
  structure: string;
  fields: { key: string; label: string; value: string }[];
  status: string;
  revision: number;
  operator: string;
  updatedAt: string;
};
export type DisclosureJurisdictionView = {
  code: string;
  name: string;
  countryCodes: string[];
  version: string;
  status: string;
  publishedAt: string;
  affected: number;
  ackProgress: number;
  blocked: number;
  pendingAck?: number;
  acked?: number;
};
export type DisclosureChapterView = { jurisdiction: string; version: string; no: string; zh: string; vi: string; en: string; zhBody: string; viBody: string; enBody: string };
export type DisclosureVersionItemView = DisclosureDraftView & {
  chapters: DisclosureChapterView[];
  operator?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  affected?: number;
  acked?: number;
  pendingAck?: number;
  blocked?: number;
};
export type DisclosureJurisdictionOption = {
  code: string;
  name: string;
  status: string;
  revision: number;
  referencedVersionCount: number;
  hasActiveMapping: boolean;
  lastOperator: string;
  updatedAt: string;
};
export type DisclosureGateActionView = {
  key: string;
  name: string;
  sub: string;
  status: string;
  tone: string;
  active: boolean;
};
export type DisclosureDraftView = {
  version: string;
  jurisdiction: string;
  languageScope: string;
  effectiveDate: string;
  requiresReack: boolean;
  zh: string;
  vi: string;
  en: string;
  status: string;
  revision?: number;
  contentHash?: string;
};
export type TrustDisclosureOverview = {
  stats: TrustDisclosureStats;
  trustSections: TrustSectionView[];
  trustSectionVersions: TrustSectionVersionView[];
  pendingTrustSectionKeys: string[];
  financialFields: FinancialFieldView[];
  sectionFields: TrustSectionFieldView[];
  jurisdictions: DisclosureJurisdictionView[];
  countryOptions: { code: string; name: string }[];
  chapters: DisclosureChapterView[];
  gatedActions: DisclosureGateActionView[];
  draft?: DisclosureDraftView;
  roleGates: string[];
  languageScopes: string[];
  disclosureVersions: string[];
  disclosureVersionItems?: DisclosureVersionItemView[];
  nextDisclosureVersion?: string;
  nextDisclosureVersionByJurisdiction?: Record<string, string>;
  nextVersionByJurisdiction?: Record<string, string>;
  jurisdictionCatalog?: DisclosureJurisdictionOption[];
  gateScope: string;
  sources: string[];
};

export type I18nLearningStats = {
  managedKeys: number;
  totalKeys: number;
  integrityIssues: number;
  coursesOnline: number;
  weeklyNexPayout: string;
};
export type I18nNamespaceView = { ns: string; keys: number; coverage: number; variants: string; lastChange: string };
export type I18nIntegrityIssueView = { code: string; kind: string; cnt: number; samples: string[]; status: string; repairedCount?: number };
export type I18nHardcodedFindingView = { location: string; rawCopy: string; suggestedKey: string; status: string };
export type I18nMessagePairView = {
  messageKey: string;
  namespace: string;
  en: string;
  zh: string;
  vi: string;
  status: string;
  version: string;
  placeholders: string[];
};
export type LearningCourseView = {
  id: string;
  title: string;
  category: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  rewardNex: string | null;
  featured: boolean;
  duration: string;
  version: string;
  status: string;
  body: string;
  titleZh: string;
  titleEn: string;
  titleVi: string;
  bodyZh: string;
  bodyEn: string;
  bodyVi: string;
  quizQuestions: LearningQuizQuestionView[];
  passScore?: number | null;
  retryLimit?: number | null;
  completionCondition?: string | null;
  rewardEvent?: string | null;
  revision: number;
};
export type LearningQuizQuestionView = {
  questionId: string;
  questionZh: string;
  questionEn: string;
  optionsZh: string[];
  optionsEn: string[];
  correctOptionIndex: number;
  questionVi?: string | null;
  optionsVi?: string[] | null;
};
export type TutorialRewardRange = { min: number; max: number };
export type LearningMetricView = { key: string; value: string };
export type I18nLearningOverview = {
  stats: I18nLearningStats;
  namespaces: I18nNamespaceView[];
  integrityIssues: I18nIntegrityIssueView[];
  hardcodedFindings: I18nHardcodedFindingView[];
  focusMessage?: I18nMessagePairView | null;
  messages: I18nMessagePairView[];
  courses: LearningCourseView[];
  rewardRange: TutorialRewardRange;
  featuredCourseId: string;
  metrics: LearningMetricView[];
  categories: string[];
  formats: string[];
  levels: string[];
  statuses: string[];
  sources: string[];
};

export type IContentData = {
  copyAb?: CopyAbOverview;
  nova?: NovaOverview;
  campaigns?: NotificationCampaignOverview;
  trustDisclosure?: TrustDisclosureOverview;
  disclosures?: TrustDisclosureOverview;
  i18nLearning?: I18nLearningOverview;
  errors?: Partial<Record<IContentErrorKey, string>>;
};

export type IContentErrorKey = "copyAb" | "nova" | "campaigns" | "trustDisclosure" | "disclosures" | "i18nLearning";

export type IContentActions = {
  reloadIContent: () => Promise<void>;
  createI1Copy: (body: Record<string, unknown>, reason: string) => Promise<void>;
  createI1CopyPosition: (body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyPosition: (positionKey: string, reason: string) => Promise<void>;
  createI1CopyVersionOption: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI1CopyVersionOption: (versionKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyVersionOption: (versionKey: string, revision: number, reason: string) => Promise<void>;
  saveI1CopyDraft: (copyKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI1CopyVersion: (copyKey: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI1CopyDraft: (copyKey: string, version: string, revision: number, reason: string) => Promise<void>;
  rollbackI1CopyVersion: (copyKey: string, version: string, expectedVersion: string, expectedRevision: number, reason: string) => Promise<void>;
  archiveI1Copy: (copyKey: string, expectedVersion: string, expectedRevision: number, reason: string) => Promise<void>;
  updateI1Framework: (paramKey: string, value: string, expectedValue: string, reason: string) => Promise<void>;
  createI1Experiment: (body: Record<string, unknown>, reason: string) => Promise<void>;
  startI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  discardI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  stopI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  adoptI1Experiment: (experimentId: string, reason: string) => Promise<void>;
  createI2NovaChannel: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI2NovaChannel: (key: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI2NovaChannelStatus: (key: string, enabled: boolean, reason: string) => Promise<void>;
  deleteI2NovaChannel: (key: string, reason: string) => Promise<void>;
  createI2Template: (body: Record<string, unknown>, reason: string) => Promise<void>;
  updateI2Template: (channel: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  deleteI2Template: (channel: string, reason: string) => Promise<void>;
  updateI2TemplateStatus: (channel: string, status: string, reason: string) => Promise<void>;
  updateI2Distribution: (items: { key: string; pct: number }[], expectedItems: { key: string; pct: number }[], reason: string) => Promise<void>;
  syncI2SocialEvents: (reason: string) => Promise<NovaSocialSyncResult>;
  listI2SocialEvents: (eventType: string, status: string, page: number, pageSize: number) => Promise<NovaSocialEventPage>;
  previewI2SocialEvent: (language: "ZH" | "VI" | "EN") => Promise<NovaSocialEventSampleView | null>;
  updateI2SocialEventStatus: (id: number, status: NovaSocialEventStatus, reason: string) => Promise<void>;
  deleteI2SocialEvent: (id: number, reason: string) => Promise<void>;
  createI3Campaign: (body: Record<string, unknown>, reason: string, formSnapshot?: I3FormSnapshot) => Promise<void>;
  updateI3CampaignDraft: (campaignNo: string, body: Record<string, unknown>, expectedRevision: number, reason: string, snapshot?: NotificationCampaignRow, formSnapshot?: I3FormSnapshot) => Promise<void>;
  estimateI3Audience: (target: NotificationAudienceTarget) => Promise<NotificationAudienceEstimateView>;
  scheduleI3Campaign: (campaignNo: string, scheduledAt: string, expectedRevision: number, reason: string, snapshot?: NotificationCampaignRow) => Promise<void>;
  sendI3CampaignNow: (campaignNo: string, expectedRevision: number, reason: string, snapshot?: NotificationCampaignRow) => Promise<void>;
  cancelI3Campaign: (campaignNo: string, expectedRevision: number, reason: string, snapshot?: NotificationCampaignRow) => Promise<void>;
  deleteI3Campaign: (campaignNo: string, expectedRevision: number, reason: string, snapshot?: NotificationCampaignRow) => Promise<void>;
  updateI3Cap: (tier: string, cap: string, expectedCap: string, reason: string) => Promise<void>;
  publishI4TrustSection: (sectionKey: string, body: { version: string; expectedRevision: number; expectedVersion: string; expectedStatus: string; dataSourceStatement: string; bilingualConfirmed: true }, reason: string) => Promise<void>;
  createI4TrustSectionDraft: (sectionKey: string, body: Record<string, unknown>, reason: string, snapshot?: TrustSectionVersionView) => Promise<void>;
  updateI4TrustSectionDraft: (sectionKey: string, version: string, body: Record<string, unknown>, reason: string, snapshot?: TrustSectionVersionView) => Promise<void>;
  deleteI4TrustSectionDraft: (sectionKey: string, version: string, expectedRevision: number, reason: string, snapshot?: TrustSectionVersionView) => Promise<void>;
  rollbackI4TrustSection: (sectionKey: string, targetVersion: string, expectedVersion: string, expectedStatus: string, reason: string) => Promise<void>;
  archiveI4TrustSection: (sectionKey: string, expectedVersion: string, expectedStatus: string, reason: string) => Promise<void>;
  saveI5DisclosureDraft: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  publishI5Disclosure: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  configureI5Matrix: (jurisdiction: string, body: Record<string, unknown>, reason: string) => Promise<void>;
  archiveI5Matrix: (jurisdiction: string, reason: string) => Promise<void>;
  updateI5GateScope: (scope: string, reason: string) => Promise<void>;
  fetchI5DisclosureVersion: (jurisdiction: string, version: string) => Promise<DisclosureVersionItemView>;
  createI5DisclosureVersion: (jurisdiction: string, body: Record<string, unknown>, reason: string, commandKey?: string) => Promise<void>;
  updateI5DisclosureVersion: (jurisdiction: string, version: string, body: Record<string, unknown>, reason: string, commandKey?: string) => Promise<void>;
  deleteI5DisclosureVersion: (jurisdiction: string, version: string, expectedRevision: number, expectedContentHash: string, reason: string, commandKey?: string) => Promise<void>;
  createI5Jurisdiction: (body: { code: string; name: string }, reason: string, commandKey?: string) => Promise<void>;
  updateI5Jurisdiction: (code: string, body: { name: string; expectedRevision: number }, reason: string, commandKey?: string) => Promise<void>;
  enableI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  disableI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  archiveI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  deleteI5Jurisdiction: (code: string, expectedRevision: number, reason: string) => Promise<void>;
  rescanI6: (reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  saveI6LocalizedDraft: (messageKey: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  publishI6LocalizedMessage: (messageKey: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  archiveI6LocalizedMessage: (messageKey: string, expectedVersion: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  fetchI6MessageVersions: (messageKey: string) => Promise<I18nMessagePairView[]>;
  rollbackI6LocalizedMessage: (messageKey: string, targetVersion: string, expectedVersion: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  fixI6Integrity: (issueCode: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<I18nIntegrityIssueView>;
  createI6Course: (courseId: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  updateI7CourseDraft: (courseId: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  fetchI7CourseVersions: (courseId: string) => Promise<LearningCourseVersionView[]>;
  createI7CourseVersion: (courseId: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  updateI7CourseVersion: (courseId: string, version: string, body: Record<string, unknown>, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  deleteI7CourseVersion: (courseId: string, version: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  publishI7CourseVersion: (courseId: string, version: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  rollbackI7CourseVersion: (courseId: string, version: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  deleteI7CourseDraft: (courseId: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  publishI6Course: (courseId: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  archiveI6Course: (courseId: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
  updateI6CourseReward: (courseId: string, rewardNex: number, reason: string) => Promise<void>;
  updateI6FeaturedCourse: (courseId: string, reason: string, snapshot?: I6CommandSnapshot) => Promise<void>;
};

export async function fetchIContentOverviews(): Promise<IContentData> {
  const trust = apiRequest<unknown>("/trust-disclosure/overview");
  const [copyAb, nova, campaigns, trustDisclosure, disclosures, i18nLearning] = await Promise.allSettled([
    apiRequest<unknown>("/copy-ab/overview").then((value) => parseIOverview("I1", value) as CopyAbOverview),
    apiRequest<unknown>("/nova/overview").then((value) => parseIOverview("I2", value) as NovaOverview),
    fetchI3CampaignOverview(),
    trust.then(value => parseIOverview("I4", value) as TrustDisclosureOverview),
    trust.then(value => parseIOverview("I5", value) as TrustDisclosureOverview),
    apiRequest<unknown>("/i18n-learning/overview").then((value) => parseIOverview("I6", value) as I18nLearningOverview),
  ]);

  const safeError = (moduleId: string, result: PromiseSettledResult<unknown>) => {
    if (result.status === "fulfilled") return undefined;
    const message = result.reason instanceof Error ? result.reason.message : "";
    return message === `${moduleId} 返回数据格式异常，请刷新重试`
      ? message
      : `${moduleId} 数据加载失败，请刷新重试`;
  };

  return {
    copyAb: copyAb.status === "fulfilled" ? copyAb.value : undefined,
    nova: nova.status === "fulfilled" ? nova.value : undefined,
    campaigns: campaigns.status === "fulfilled" ? campaigns.value : undefined,
    trustDisclosure: trustDisclosure.status === "fulfilled" ? trustDisclosure.value : undefined,
    disclosures: disclosures.status === "fulfilled" ? disclosures.value : undefined,
    i18nLearning: i18nLearning.status === "fulfilled" ? i18nLearning.value : undefined,
    errors: {
      copyAb: safeError("I1", copyAb),
      nova: safeError("I2", nova),
      campaigns: safeError("I3", campaigns),
      trustDisclosure: safeError("I4", trustDisclosure),
      disclosures: safeError("I5", disclosures),
      i18nLearning: safeError("I6", i18nLearning),
    },
  };
}

export const iContentActions: Omit<IContentActions, "reloadIContent"> = {
  createI1Copy: (body, reason) => apiRequest("/copy-ab/copies", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI1CopyPosition: (body, reason) => apiRequest("/copy-ab/positions", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyPosition: (positionKey, reason) => apiRequest(`/copy-ab/positions/${encodeURIComponent(positionKey)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI1CopyVersionOption: (body, reason) => apiRequest("/copy-ab/version-options", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI1CopyVersionOption: (versionKey, body, reason) => apiRequest(`/copy-ab/version-options/${encodeURIComponent(versionKey)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyVersionOption: (versionKey, revision, reason) => apiRequest(`/copy-ab/version-options/${encodeURIComponent(versionKey)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision: revision }, reason)) }).then(() => undefined),
  saveI1CopyDraft: (copyKey, body, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI1CopyVersion: (copyKey, body, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI1CopyDraft: (copyKey, version, revision, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedVersion: version, expectedRevision: revision }, reason)) }).then(() => undefined),
  rollbackI1CopyVersion: (copyKey, version, expectedVersion, expectedRevision, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/versions/${encodeURIComponent(version)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedRevision }, reason)) }).then(() => undefined),
  archiveI1Copy: (copyKey, expectedVersion, expectedRevision, reason) => apiRequest(`/copy-ab/copies/${encodeURIComponent(copyKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedRevision }, reason)) }).then(() => undefined),
  updateI1Framework: (paramKey, value, expectedValue, reason) => apiRequest(`/copy-ab/framework/${encodeURIComponent(paramKey)}`, { method: "PATCH", body: JSON.stringify(withReason({ value, expectedValue }, reason)) }).then(() => undefined),
  createI1Experiment: (body, reason) => apiRequest("/copy-ab/experiments", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  startI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/start`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  discardI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/discard`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  stopI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/stop`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  adoptI1Experiment: (experimentId, reason) => apiRequest(`/copy-ab/experiments/${encodeURIComponent(experimentId)}/adopt`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI2NovaChannel: (body, reason) => apiRequest("/nova/channels", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI2NovaChannel: (key, body, reason) => apiRequest(`/nova/channels/${encodeURIComponent(key)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI2NovaChannelStatus: (key, enabled, reason) => apiRequest(`/nova/channels/${encodeURIComponent(key)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ enabled }, reason)) }).then(() => undefined),
  deleteI2NovaChannel: (key, reason) => apiRequest(`/nova/channels/${encodeURIComponent(key)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI2Template: (body, reason) => apiRequest("/nova/templates", { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI2Template: (channel, body, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI2Template: (channel, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI2TemplateStatus: (channel, status, reason) => apiRequest(`/nova/templates/${encodeURIComponent(channel)}/status`, { method: "PATCH", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  updateI2Distribution: (items, expectedItems, reason) => apiRequest("/nova/social-distribution", { method: "PATCH", body: JSON.stringify(withReason({ items, expectedItems }, reason)) }).then(() => undefined),
  syncI2SocialEvents: (reason) => apiRequest<NovaSocialSyncResult>("/nova/social-events/sync", { method: "POST", body: JSON.stringify(withReason({}, reason)) }),
  listI2SocialEvents: (eventType, status, page, pageSize) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (eventType) query.set("eventType", eventType);
    if (status) query.set("status", status);
    return apiRequest<unknown>(`/nova/social-events?${query.toString()}`).then((value) => parseNovaSocialEventPage(value) as NovaSocialEventPage);
  },
  previewI2SocialEvent: (language) => apiRequest<unknown>(`/nova/social-events/sample?language=${encodeURIComponent(language)}`).then((value) => parseNovaSocialSample(value) as NovaSocialEventSampleView | null),
  updateI2SocialEventStatus: (id, status, reason) => apiRequest(`/nova/social-events/${id}/status`, { method: "PATCH", body: JSON.stringify(withReason({ status }, reason)) }).then(() => undefined),
  deleteI2SocialEvent: (id, reason) => apiRequest(`/nova/social-events/${id}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  createI3Campaign: async (body, reason, formSnapshot) => prepareI3Command("/campaigns", { method: "POST", body: i3CampaignBody(body, reason) }, undefined, formSnapshot),
  updateI3CampaignDraft: async (campaignNo, body, expectedRevision, reason, snapshot, formSnapshot) => prepareI3Command(`/campaigns/${encodeURIComponent(campaignNo)}/draft`, { method: "PATCH", body: i3CampaignBody({ ...body, expectedRevision }, reason) }, snapshot, formSnapshot),
  estimateI3Audience: async (target) => {
    const value = await apiRequest<NotificationAudienceEstimateView>("/campaigns/audience-estimate", { method: "POST", body: JSON.stringify({ target }) });
    if (!value || !Number.isSafeInteger(value.estimatedUsers) || value.estimatedUsers < 0 || !value.target
      || Object.entries(target).some(([key, expected]) => value.target[key as keyof NotificationAudienceTarget] !== expected)) throw new Error("I3 受众估算返回数据格式异常，请重新估算");
    return value;
  },
  scheduleI3Campaign: (campaignNo, scheduledAt, expectedRevision, reason, snapshot) => prepareI3Command(`/campaigns/${encodeURIComponent(campaignNo)}/schedule`, { method: "POST", body: JSON.stringify(withReason({ schedule: scheduledAt, expectedRevision }, reason)) }, snapshot),
  sendI3CampaignNow: (campaignNo, expectedRevision, reason, snapshot) => prepareI3Command(`/campaigns/${encodeURIComponent(campaignNo)}/send-now`, { method: "POST", body: JSON.stringify(withReason({ schedule: "now", expectedRevision }, reason)) }, snapshot),
  cancelI3Campaign: (campaignNo, expectedRevision, reason, snapshot) => prepareI3Command(`/campaigns/${encodeURIComponent(campaignNo)}/cancel`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }, snapshot),
  deleteI3Campaign: (campaignNo, expectedRevision, reason, snapshot) => prepareI3Command(`/campaigns/${encodeURIComponent(campaignNo)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }, snapshot),
  updateI3Cap: (tier, cap, expectedCap, reason) => apiRequest(`/campaigns/caps/${encodeURIComponent(tier)}`, { method: "PATCH", body: JSON.stringify(withReason({ cap, expectedCap }, reason)) }).then(() => undefined),
  publishI4TrustSection: (sectionKey, body, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  createI4TrustSectionDraft: (sectionKey, body, reason, snapshot) => prepareI4DraftCommand(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }, snapshot),
  updateI4TrustSectionDraft: (sectionKey, version, body, reason, snapshot) => prepareI4DraftCommand(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions/${encodeURIComponent(version)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }, snapshot),
  deleteI4TrustSectionDraft: (sectionKey, version, expectedRevision, reason, snapshot) => prepareI4DraftCommand(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }, snapshot),
  rollbackI4TrustSection: (sectionKey, targetVersion, expectedVersion, expectedStatus, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ targetVersion, expectedVersion, expectedStatus }, reason)) }).then(() => undefined),
  archiveI4TrustSection: (sectionKey, expectedVersion, expectedStatus, reason) => apiRequest(`/trust-disclosure/trust-sections/${encodeURIComponent(sectionKey)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion, expectedStatus }, reason)) }).then(() => undefined),
  saveI5DisclosureDraft: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  publishI5Disclosure: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  configureI5Matrix: (jurisdiction, body, reason) => apiRequest(`/trust-disclosure/disclosures/matrix/${encodeURIComponent(jurisdiction)}`, { method: "PUT", body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  archiveI5Matrix: (jurisdiction, reason) => apiRequest(`/trust-disclosure/disclosures/matrix/${encodeURIComponent(jurisdiction)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }).then(() => undefined),
  updateI5GateScope: (scope, reason) => apiRequest("/trust-disclosure/disclosures/gated-actions", { method: "PATCH", body: JSON.stringify(withReason({ scope }, reason)) }).then(() => undefined),
  fetchI5DisclosureVersion: (jurisdiction, version) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`),
  createI5DisclosureVersion: (jurisdiction, body, reason, commandKey) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions`, { method: "POST", headers: commandHeaders(commandKey), body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI5DisclosureVersion: (jurisdiction, version, body, reason, commandKey) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`, { method: "PATCH", headers: commandHeaders(commandKey), body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  deleteI5DisclosureVersion: (jurisdiction, version, expectedRevision, expectedContentHash, reason, commandKey) => apiRequest(`/trust-disclosure/disclosures/${encodeURIComponent(jurisdiction)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", headers: commandHeaders(commandKey), body: JSON.stringify(withReason({ expectedRevision, expectedContentHash }, reason)) }).then(() => undefined),
  createI5Jurisdiction: (body, reason, commandKey) => apiRequest("/trust-disclosure/disclosures/jurisdictions", { method: "POST", headers: commandHeaders(commandKey), body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  updateI5Jurisdiction: (code, body, reason, commandKey) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}`, { method: "PATCH", headers: commandHeaders(commandKey), body: JSON.stringify(withReason(body, reason)) }).then(() => undefined),
  enableI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/enable`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  disableI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/disable`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  archiveI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}/archive`, { method: "POST", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  deleteI5Jurisdiction: (code, expectedRevision, reason) => apiRequest(`/trust-disclosure/disclosures/jurisdictions/${encodeURIComponent(code)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedRevision }, reason)) }).then(() => undefined),
  rescanI6: (reason, snapshot) => prepareI6Command("/i18n-learning/rescan", { method: "POST", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  saveI6LocalizedDraft: (messageKey, body, reason, snapshot) => prepareI6Command(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(() => undefined),
  publishI6LocalizedMessage: (messageKey, body, reason, snapshot) => prepareI6Command(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/publish`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(() => undefined),
  archiveI6LocalizedMessage: (messageKey, expectedVersion, reason, snapshot) => prepareI6Command(`/i18n-learning/messages/${encodeURIComponent(messageKey)}`, { method: "DELETE", body: JSON.stringify(withReason({ expectedVersion }, reason)) }, snapshot).then(() => undefined),
  fetchI6MessageVersions: (messageKey) => apiRequest<unknown>(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/versions`).then(value => {
    if (!Array.isArray(value)) throw new Error("词条历史返回数据格式异常，请刷新重试");
    return value.map(parseI6Message);
  }),
  rollbackI6LocalizedMessage: (messageKey, targetVersion, expectedVersion, reason, snapshot) => prepareI6Command(`/i18n-learning/messages/${encodeURIComponent(messageKey)}/versions/${encodeURIComponent(targetVersion)}/rollback`, { method: "POST", body: JSON.stringify(withReason({ expectedVersion }, reason)) }, snapshot).then(() => undefined),
  fixI6Integrity: (issueCode, body, reason, snapshot) => prepareI6Command(`/i18n-learning/integrity/${encodeURIComponent(issueCode)}/fix`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(parseI6Issue),
  createI6Course: (courseId, body, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(() => undefined),
  updateI7CourseDraft: (courseId, body, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/draft`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(() => undefined),
  fetchI7CourseVersions: (courseId) => apiRequest<unknown>(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions`).then(value => {
    if (!Array.isArray(value)) throw new Error("课程版本返回数据格式异常，请刷新重试");
    return value.map(parseI6CourseVersion);
  }),
  createI7CourseVersion: (courseId, body, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions`, { method: "POST", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(() => undefined),
  updateI7CourseVersion: (courseId, version, body, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}`, { method: "PATCH", body: JSON.stringify(withReason(body, reason)) }, snapshot).then(() => undefined),
  deleteI7CourseVersion: (courseId, version, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  publishI7CourseVersion: (courseId, version, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}/publish`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  rollbackI7CourseVersion: (courseId, version, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/versions/${encodeURIComponent(version)}/rollback`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  deleteI7CourseDraft: (courseId, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}`, { method: "DELETE", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  publishI6Course: (courseId, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/publish`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  archiveI6Course: (courseId, reason, snapshot) => prepareI6Command(`/i18n-learning/courses/${encodeURIComponent(courseId)}/archive`, { method: "POST", body: JSON.stringify(withReason({}, reason)) }, snapshot).then(() => undefined),
  updateI6CourseReward: (courseId, rewardNex, reason) => apiRequest(`/i18n-learning/courses/${encodeURIComponent(courseId)}/reward`, { method: "PATCH", body: JSON.stringify(withReason({ rewardNex }, reason)) }).then(() => undefined),
  updateI6FeaturedCourse: (courseId, reason, snapshot) => prepareI6Command("/i18n-learning/courses/featured", { method: "PATCH", body: JSON.stringify(withReason({ courseId }, reason)) }, snapshot).then(() => undefined),
};
