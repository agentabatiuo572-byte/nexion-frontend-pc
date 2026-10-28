import { guardedFetch } from "@/lib/admin/error-messages";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { parsePhoneOverview, parsePhonePage, parsePhoneReceipt, phoneLabels, record, validPhoneRequest, type PhoneCommand, type PhoneRequest, type PhoneReceipt, type PhoneVerification } from "@/lib/admin/phone-replacement-contract";
export class PhoneApiError extends Error {
    constructor(message: string, readonly status: number, readonly unknownOutcome = false, readonly fieldErrors: Record<string, string> = {}) { super(message); }
}
class PhoneOutcomeUnknownError extends PhoneApiError {
    constructor(status: number) { super("提交结果暂不确定，请查询原操作，不要重新提交。", status, true); }
}
async function request(path: string, body?: unknown, key?: string): Promise<unknown> {
    let response: Response;
    try {
        response = await guardedFetch(path, { method: body === undefined ? "GET" : "POST", cache: "no-store",
            headers: body === undefined ? undefined : { "Content-Type": "application/json", "Idempotency-Key": key! },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    }
    catch {
        throw new PhoneApiError(body === undefined ? "查询暂不可用，请稍后重试。" : "提交结果暂不确定，请查询原操作，不要重新提交。", 0, body !== undefined);
    }
    const result: unknown = await response.json().catch(() => null);
    // classification-ok: Validate the API envelope grammar; failure classification below uses the shared predicate.
    const validEnvelope = record(result) && Number.isInteger(result.code) && (result.code === 0 || (Number(result.code) >= 400 && Number(result.code) <= 599));
    if (!response.ok || !record(result) || result.code !== 0) {
        const apiCode = record(result) && typeof result.code === "number" ? result.code : null;
        if (body !== undefined && (response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || !validEnvelope
            || outcomeStaysUnknown(response.status, apiCode) || (apiCode !== null && apiCode !== 0 && outcomeStaysUnknown(apiCode)))) {
            throw new PhoneOutcomeUnknownError(response.ok && apiCode !== null ? apiCode : response.status);
        }
        const data = record(result) && record(result.data) ? result.data : null;
        const reason = typeof data?.reason === "string" && !/^[A-Z_\d:]+$/.test(data.reason) ? data.reason : null;
        const code = record(result) ? String(result.message) : "";
        throw new PhoneApiError(reason ?? phoneLabels[code] ?? (response.status === 403 ? "当前权限或账号范围不允许访问，请返回选择其他账号。"
                : response.status === 401 ? "管理会话已失效，请重新登录。" : "请求未完成，请刷新后核实当前状态。"), response.ok && record(result) && typeof result.code === "number" ? result.code : response.status, false, record(data?.fieldErrors) ? data.fieldErrors as Record<string, string> : {});
    }
    if (result.data == null)
        throw new PhoneApiError("返回内容不完整，请查询原操作。", 502, body !== undefined);
    return result.data;
}
const accountPath = (userId: string) => {
    if (!/^[1-9]\d*$/.test(userId))
        throw new Error("请先选择有效账号。");
    return `/api/admin/users/profiles/${userId}`;
};
const segment = (value: string) => encodeURIComponent(value);
export async function fetchPhoneOverview(userId: string) { return parsePhoneOverview(await request(`${accountPath(userId)}/phone-binding`)); }
export async function fetchPhoneRequests(userId: string, page = 1, size = 10) {
    const result = parsePhonePage<PhoneRequest>(await request(`${accountPath(userId)}/phone-replacement-requests?pageNum=${page}&pageSize=${size}`));
    if (!result.items.every(row => validPhoneRequest(row) && String(row.userId) === userId))
        throw new Error("申请记录与当前账号不匹配，请重新查询。");
    return result;
}
export async function fetchPhoneHistory(userId: string, kind: "SUCCESS" | "REQUEST" | "GRANT", page = 1, size = 10) {
    return parsePhonePage<Record<string, unknown>>(await request(`${accountPath(userId)}/phone-replacements?kind=${kind}&pageNum=${page}&pageSize=${size}`));
}
export async function fetchPhoneOperation(input: {
    operationId: string;
} | {
    commandType: string;
    idempotencyKey: string;
}): Promise<PhoneReceipt | null> {
    const suffix = "operationId" in input ? segment(input.operationId) : `by-idempotency-key?${new URLSearchParams(input)}`;
    try {
        return parsePhoneReceipt(await request(`/api/admin/phone-replacement-operations/${suffix}`));
    }
    catch (failure) {
        if (failure instanceof PhoneApiError && failure.status === 404)
            return null;
        throw failure;
    }
}
function verification(raw: unknown): PhoneVerification {
    if (!record(raw) || typeof raw.evidenceRef !== "string" || typeof raw.requestId !== "string" || typeof raw.supportRef !== "string"
        || typeof raw.verifiedBy !== "number" || typeof raw.verifiedAt !== "number")
        throw new Error("核实结果暂未确认，请查询原核实记录。");
    return raw as unknown as PhoneVerification;
}
export interface PendingPhoneCommand extends PendingMutationRecord {
    owner: number;
    userId: string;
    type: PhoneCommand;
    target: string;
    body: Record<string, unknown>;
}
const pending = createPendingMutationStore<PendingPhoneCommand>({ storageKey: "nexion-admin-phone-commands-v1", retainExpiredRecords: true,
    isValidRecord: row => Number.isSafeInteger(row.owner) && /^[1-9]\d*$/.test(row.userId)
        && ["PHONE_VERIFY", "PHONE_GRANT_ISSUE", "PHONE_REQUEST_CLOSE", "PHONE_GRANT_REVOKE"].includes(row.type)
        && typeof row.target === "string" && record(row.body) });
export function pendingPhoneCommands(owner: number, userId: string) { return pending.list().filter(row => row.owner === owner && row.userId === userId); }
export function preparePhoneCommand(owner: number, userId: string, type: PhoneCommand, target: string, body: Record<string, unknown>) {
    if (pendingPhoneCommands(owner, userId).length)
        throw new Error("这个账号有一个操作结果还没确认，请先查询结果。");
    const key = createA2CommandKey("phone");
    const fingerprint = `${owner}|${userId}|${type}|${key}`;
    pending.remember(fingerprint, key, { owner, userId, type, target, body });
    if (!pending.isDurablyStored(fingerprint, key)) {
        pending.forget(fingerprint, key);
        throw new Error("浏览器无法保存恢复记录，请允许会话存储后再提交。");
    }
    return pending.list().find(row => row.commandKey === key)!;
}
export function forgetPhoneCommand(row: PendingPhoneCommand) { pending.forget(row.fingerprint, row.commandKey); }
function commandPath(row: PendingPhoneCommand) {
    const prefix = accountPath(row.userId);
    if (row.type === "PHONE_GRANT_ISSUE")
        return `${prefix}/phone-replacement-grants`;
    if (row.type === "PHONE_GRANT_REVOKE")
        return `${prefix}/phone-replacement-grants/${segment(row.target)}/revoke`;
    return `${prefix}/phone-replacement-requests/${segment(row.target)}/${row.type === "PHONE_VERIFY" ? "verify" : "close"}`;
}
export async function submitPhoneCommand(row: PendingPhoneCommand): Promise<PhoneReceipt | PhoneVerification> {
    try {
        const data = await request(commandPath(row), row.body, row.commandKey);
        let result: PhoneReceipt | PhoneVerification;
        try {
            result = row.type === "PHONE_VERIFY" ? verification(data) : parsePhoneReceipt(data);
        }
        catch {
            throw new PhoneApiError("结果暂未确认，请先查询原操作，不要重新提交。", 502, true);
        }
        if (!("status" in result) || result.status !== "PENDING")
            forgetPhoneCommand(row);
        return result;
    }
    catch (failure) {
        // Only explicit rejection permits a new, freshly confirmed command. Transport/5xx retains evidence indefinitely.
        if (failure instanceof PhoneApiError && !failure.unknownOutcome && ![401, 403].includes(failure.status))
            forgetPhoneCommand(row);
        throw failure;
    }
}
export async function recoverPhoneCommand(row: PendingPhoneCommand): Promise<PhoneReceipt | PhoneVerification | null> {
    let result: PhoneReceipt | PhoneVerification | null;
    if (row.type === "PHONE_VERIFY") {
        try {
            result = verification(await request(`${accountPath(row.userId)}/phone-replacement-verifications/by-idempotency-key?${new URLSearchParams({ idempotencyKey: row.commandKey })}`));
        }
        catch (failure) {
            if (failure instanceof PhoneApiError && failure.status === 404)
                return null;
            throw failure;
        }
    }
    else
        result = await fetchPhoneOperation({ commandType: row.type, idempotencyKey: row.commandKey });
    if (result && (!("status" in result) || result.status !== "PENDING"))
        forgetPhoneCommand(row);
    return result;
}
/** One installation's locked phone model, for C5 support. */
export interface PhoneModelLock {
    installationId: string; revision: number; platform: string | null; lockedModel: string | null; lockedChip: string | null; reportedModel: string | null;
    held: boolean; released: boolean; releasable: boolean; calibrationStatus: string | null; activationStatus: string | null; updatedAt: number | null;
}
function parseModelLock(value: unknown): PhoneModelLock {
    const text = (field: unknown) => field === null || field === undefined || typeof field === "string";
    if (!record(value) || typeof value.installationId !== "string" || !Number.isSafeInteger(value.revision)
        || typeof value.held !== "boolean" || typeof value.released !== "boolean" || typeof value.releasable !== "boolean"
        || ![value.platform, value.lockedModel, value.lockedChip, value.reportedModel, value.calibrationStatus, value.activationStatus].every(text)
        || !(value.updatedAt === null || value.updatedAt === undefined || Number.isSafeInteger(value.updatedAt)))
        throw new PhoneApiError("机型锁数据异常，请刷新。", 502);
    return value as unknown as PhoneModelLock;
}
export async function fetchPhoneModelLocks(userId: string): Promise<PhoneModelLock[]> {
    const value = await request(`${accountPath(userId)}/phone-model-locks`);
    if (!Array.isArray(value)) throw new PhoneApiError("机型锁数据异常，请刷新。", 502);
    return value.map(parseModelLock);
}
/**
 * Lets the installation lock the model it reports next. Bound to the revision support looked at: a retry
 * returns the released row, and a calibration made meanwhile is a conflict instead of a second release.
 */
export async function releasePhoneModelLock(userId: string, lock: Pick<PhoneModelLock, "installationId" | "revision">,
                                            reason: string, key: string): Promise<PhoneModelLock> {
    return parseModelLock(await request(`${accountPath(userId)}/phone-model-locks/${segment(lock.installationId)}/release`,
        { reason: reason.trim(), confirmed: true, expectedRevision: lock.revision }, key));
}
