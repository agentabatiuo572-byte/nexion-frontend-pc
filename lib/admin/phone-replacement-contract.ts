/** The server owns eligibility, expiry and terminal state. Never derive permission from a receipt. */
export interface PhonePolicy {
    available: boolean;
    allowReplacement: boolean | null;
    minReplacementIntervalDays: number | null;
    replacementWindowDays: number | null;
    maxReplacementsInWindow: number | null;
    policyVersion: number | null;
}
export interface PhoneBinding {
    installationId: string;
    userDeviceId: number | null;
    changedAt: number | null;
    bindingVersion: number;
}
export interface PhoneGrant {
    grantId: string;
    requestId: string;
    bindingVersion: number;
    waiveCount: boolean;
    waiveInterval: boolean;
    issuedAt: number;
    expiresAt: number;
    status: string;
    remainingUses: number;
}
export interface PhoneRequest {
    requestId: string;
    requestNo: string;
    userId: number;
    targetInstallationId: string;
    bindingVersion: number;
    reason: string;
    createdAt: number;
    expiresAt: number;
    status: string;
    grantId: string | null;
    supportRef: string | null;
    supportLinkStatus: string;
    closeReason: string | null;
    closedAt: number | null;
}
export interface PhoneEligibility {
    binding: PhoneBinding | null;
    policy: PhonePolicy;
    serverNow: number;
    usedCount: number | null;
    remainingCount: number | null;
    historyComplete: boolean;
    historyCompleteFrom: number | null;
    canReplace: boolean;
    nextAllowedAt: number | null;
    blockedReasons: string[];
    grant: PhoneGrant | null;
}
export interface PhoneSession {
    sessionGroup: "APP" | "H5";
    installationId: string;
    appSessionVersion: number | null;
    executionSupported: boolean;
    sessionCount: number;
    lastActiveAt: string | null;
}
export interface PhoneOverview {
    eligibility: PhoneEligibility;
    currentApp: PhoneSession | null;
    sessions: PhoneSession[];
    pendingRequest: {
        request: PhoneRequest;
        grant: PhoneGrant | null;
    } | null;
    pendingOperations: {
        operationId: string;
        commandType: string;
        status: string;
        submittedAt: number;
    }[];
    executionPauseReason: string | null;
}
export interface PhoneReceipt {
    operationId: string;
    commandType: string;
    status: "PENDING" | "SUCCEEDED" | "FAILED";
    submittedAt: number;
    completedAt: number | null;
    originalResult: Record<string, unknown> | null;
    currentResource: Record<string, unknown> | null;
    auditRef: string | null;
}
export interface PhoneVerification {
    evidenceRef: string;
    requestId: string;
    supportRef: string;
    verifiedBy: number;
    verifiedAt: number;
}
export interface PhonePage<T> {
    items: T[];
    pageNum: number;
    pageSize: number;
    hasMore: boolean;
}
export type PhoneCommand = "PHONE_GRANT_ISSUE" | "PHONE_REQUEST_CLOSE" | "PHONE_GRANT_REVOKE" | "PHONE_VERIFY";
export const phoneFields = ["allowReplacement", "minReplacementIntervalDays", "replacementWindowDays", "maxReplacementsInWindow"] as const;
export const phonePrefix = "E.compute.phoneBinding.";
export const PHONE_GRANT = "user_c5_phone_replacement_exception_grant", PHONE_REVOKE = "user_c5_phone_replacement_exception_revoke";
export const safeInteger = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
export const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parsePhonePolicy(raw: unknown): PhonePolicy | null {
    if (!record(raw) || typeof raw.available !== "boolean")
        return null;
    if (!raw.available) {
        if (!phoneFields.every(key => raw[key] == null) || !(raw.policyVersion === null || safeInteger(raw.policyVersion, 1)))
            return null;
        return raw as unknown as PhonePolicy;
    }
    if (typeof raw.allowReplacement !== "boolean" || !safeInteger(raw.minReplacementIntervalDays)
        || !safeInteger(raw.replacementWindowDays, 1, 365) || !safeInteger(raw.maxReplacementsInWindow, 1, 100)
        || !safeInteger(raw.policyVersion, 1))
        return null;
    return raw as unknown as PhonePolicy;
}
export function phoneDraftError(values: string[]): string {
    if (values.length !== 3 || values.some(v => !/^\d+$/.test(v)))
        return "请填写整数天数和次数。";
    const [interval, window, count] = values.map(Number);
    if (!safeInteger(interval) || interval > Math.floor((253402300799999 - Date.now()) / 86400000))
        return "换机间隔过大，请缩短天数。";
    if (!safeInteger(window, 1, 365))
        return "滚动窗口须为 1 至 365 天。";
    if (!safeInteger(count, 1, 100))
        return "窗口内上限须为 1 至 100 次。";
    return "";
}
export function phonePolicyValues(allow: boolean, values: string[]): Record<string, string> {
    const error = phoneDraftError(values);
    if (error)
        throw new Error(error);
    return Object.fromEntries(phoneFields.map((field, i) => [phonePrefix + field, i === 0 ? (allow ? "on" : "off") : String(Number(values[i - 1]))]));
}
export function canReadPolicyReceipt(rights: readonly string[]) {
    return rights.includes("device_e6_write") || rights.includes("device_e6_flag_toggle")
        || rights.includes("platform_a2_operation_approve") && rights.includes("device_e6_read");
}
export function phoneCommandAllowed(type: PhoneCommand, rights: readonly string[]) {
    return rights.includes(type === "PHONE_GRANT_REVOKE" ? PHONE_REVOKE : PHONE_GRANT);
}
export function parsePhoneReceipt(value: unknown): PhoneReceipt {
    if (!record(value) || typeof value.operationId !== "string" || !value.operationId || typeof value.commandType !== "string"
        || !["PENDING", "SUCCEEDED", "FAILED"].includes(String(value.status)) || !safeInteger(value.submittedAt)
        || !(value.completedAt === null || safeInteger(value.completedAt))
        || !(value.originalResult === null || record(value.originalResult)) || !(value.currentResource === null || record(value.currentResource)))
        throw new Error("操作结果暂未确认，请继续查询原操作。");
    return value as unknown as PhoneReceipt;
}
export function parsePhoneOverview(value: unknown): PhoneOverview {
    if (!record(value) || !record(value.eligibility) || !parsePhonePolicy(value.eligibility.policy)
        || !Array.isArray(value.sessions) || !Array.isArray(value.pendingOperations)
        || !Array.isArray(value.eligibility.blockedReasons) || !value.eligibility.blockedReasons.every(v => typeof v === "string")
        || !safeInteger(value.eligibility.serverNow) || typeof value.eligibility.historyComplete !== "boolean"
        || typeof value.eligibility.canReplace !== "boolean"
        || ![value.eligibility.usedCount, value.eligibility.remainingCount].every(v => v === null || safeInteger(v))
        || !(value.eligibility.binding === null || record(value.eligibility.binding) && safeInteger(value.eligibility.binding.bindingVersion))
        || !value.sessions.every(s => record(s) && ["APP", "H5"].includes(String(s.sessionGroup)) && typeof s.installationId === "string"
            && typeof s.executionSupported === "boolean" && safeInteger(s.sessionCount) && (s.appSessionVersion === null || safeInteger(s.appSessionVersion)))
        || !value.pendingOperations.every(o => record(o) && typeof o.operationId === "string" && typeof o.commandType === "string" && safeInteger(o.submittedAt))
        || !(value.pendingRequest === null || record(value.pendingRequest) && validPhoneRequest(value.pendingRequest.request))
        || ![value.eligibility.grant, record(value.pendingRequest) ? value.pendingRequest.grant : null].every(g => g === null || record(g)
            && typeof g.grantId === "string" && typeof g.status === "string" && safeInteger(g.expiresAt)))
        throw new Error("手机状态读取不完整，请重新查询。");
    return value as unknown as PhoneOverview;
}
export function validPhoneRequest(value: unknown): value is PhoneRequest {
    return record(value) && typeof value.requestId === "string" && typeof value.requestNo === "string" && safeInteger(value.userId, 1)
        && typeof value.targetInstallationId === "string" && safeInteger(value.bindingVersion) && typeof value.status === "string"
        && typeof value.supportLinkStatus === "string" && safeInteger(value.expiresAt) && safeInteger(value.createdAt);
}
export function parsePhonePage<T>(value: unknown): PhonePage<T> {
    if (!record(value) || !Array.isArray(value.items) || !value.items.every(record) || !safeInteger(value.pageNum, 1)
        || !safeInteger(value.pageSize, 1, 100) || typeof value.hasMore !== "boolean" || value.items.length > value.pageSize)
        throw new Error("记录列表读取不完整，请重试。");
    return value as unknown as PhonePage<T>;
}
export const phoneLabels: Record<string, string> = {
    PENDING: "待处理", GRANTED: "已授权", CLOSED: "已关闭", ACTIVE: "有效", CONSUMED: "已使用", REVOKED: "已撤销",
    EXPIRED: "已到期", STALE: "绑定已变化", SUCCEEDED: "已成功", FAILED: "已确定失败", LINKED: "已关联", UNLINKED: "未关联",
    PHONE_GRANT_ISSUE: "授予一次特批", PHONE_REQUEST_CLOSE: "关闭申请", PHONE_GRANT_REVOKE: "撤销特批", PHONE_VERIFY: "核实申请",
    PHONE_POLICY_PUBLISH: "发布手机策略", PHONE_POLICY_PARAM_PUBLISH: "调整手机策略", PHONE_ACTIVATE: "手机激活",
    PHONE_REPLACEMENT_LIMIT_REACHED: "窗口内换机次数已达上限", PHONE_BINDING_TIME_UNKNOWN: "原绑定时间待核实",
    PHONE_REPLACEMENT_DISABLED: "当前策略禁止换机", PHONE_REPLACEMENT_INTERVAL: "尚未满足换机间隔", PHONE_REPLACEMENT_LIMIT: "窗口内换机次数已达上限",
    PHONE_REPLACEMENT_COOLDOWN: "尚未满足换机间隔", PHONE_REPLACEMENT_COUNT_LIMIT: "窗口内换机次数已达上限",
    PHONE_REPLACEMENT_HISTORY_UNKNOWN: "历史次数待核实", PHONE_REPLACEMENT_BINDING_TIME_UNKNOWN: "原绑定时间待核实",
    CURRENT_APP_REQUIRED: "没有当前可执行的 App 会话", PHONE_EXECUTION_UNSUPPORTED: "当前 App 不支持手机执行",
    PHONE_BINDING_REQUIRED: "尚未绑定手机", PHONE_REPLACEMENT_RISK_PAUSED: "手机处于风险暂停，特批不能解除",
    ONBOARDING_CALIBRATION_REQUIRED: "当前安装尚未完成校准", PHONE_CALIBRATION_PENDING_VERIFICATION: "手机校准待核验",
    PHONE_CALIBRATION_RULES_CHANGED: "校准规则已更新，请用户重新校准", LEGAL_TERMS_ACK_REQUIRED: "用户尚未确认当前条款",
    PHONE_REPLACEMENT_POLICY_UNAVAILABLE: "换机策略暂不可用", PHONE_REPLACED: "另一 App 接管后已停止旧手机",
    PHONE_LOW_BATTERY: "手机电量不足", PHONE_OFFLINE: "手机离线", USER_AUTH_REQUIRED: "账号当前不可执行此操作",
    POLICY_VERSION_CHANGED: "策略已更新，请刷新并重新确认", BINDING_VERSION_CHANGED: "绑定已变化，请刷新当前账号",
    GRANT_STATE_CHANGED: "授权状态已变化，请查看当前结果", REQUEST_UNAVAILABLE: "申请已到期、关闭或处理，请刷新",
    ACTIVE_GRANT_EXISTS: "已有有效特批，请先核对现有授权", IDEMPOTENCY_MISMATCH: "该操作标识已用于另一份内容，请查询原结果",
    PERMISSION_DENIED: "当前账号无权执行此操作", ADMIN_AUTH_REQUIRED: "管理会话已失效，请重新登录",
    OPERATION_RESULT_UNKNOWN: "暂未查到原操作，结果仍待核实。请勿重新提交。",
};
export function phoneLabel(value: unknown): string {
    if (value == null || value === "")
        return "—";
    return phoneLabels[String(value)] ?? "状态未知，请刷新或联系有处理权限的主管。";
}
export function phoneConflictMessage(details: unknown): string | null {
    if (!record(details))
        return null;
    const labels: Record<string, string> = { allowReplacement: "允许换机", minReplacementIntervalDays: "最短间隔",
        replacementWindowDays: "滚动窗口", maxReplacementsInWindow: "窗口内次数", policyVersion: "策略版本" };
    const errors = record(details.fieldErrors) ? Object.entries(details.fieldErrors).flatMap(([field, reason]) => {
        const label = labels[field.replace(phonePrefix, "")];
        return label && typeof reason === "string" && !/[A-Z]{3}_/.test(reason) ? [`${label}：${reason}`] : [];
    }) : [];
    return errors.length ? errors.join("；") : typeof details.reason === "string" && !/[A-Z]{3}_/.test(details.reason)
        ? details.reason : typeof details.conflictType === "string" ? phoneLabels[details.conflictType] ?? null : null;
}
