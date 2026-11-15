import { useAdminAuth } from "@/lib/store/admin-auth";
import { createA2CommandKey } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { fetchTrustDocuments, normalizeTrustDocument, restoreTrustDocumentBody, uploadTrustDocument, type TrustDocument, type TrustDocumentUpload } from "./trust-documents-client";

export type I4DocumentCommand = PendingMutationRecord & {
  owner: number; mode: "upload" | "restore"; document: TrustDocument; fields: TrustDocumentUpload; body: string;
  file?: { name: string; type: string; size: number; lastModified: number; sha256: string };
  observation?: TrustDocument;
};
const pending = createPendingMutationStore<I4DocumentCommand>({ storageKey: "nexion-admin-i4-document-commands-v1", retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.owner) && !!row.document && ["upload", "restore"].includes(row.mode)
    && !!row.fields && Object.values(row.fields).every(value => typeof value === "string") && typeof row.body === "string" });

// PDFs can exceed sessionStorage's entire quota. Persist the actual File in IndexedDB
// before sending; only its metadata/hash and complete form go into the shared record.
async function uploadFile(commandKey: string, operation: "save" | "delete", file?: File): Promise<void> {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open("nexion-admin-i4-upload-files-v1", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("files");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("files", "readwrite");
      const store = transaction.objectStore("files");
      if (operation === "save") store.put(file, commandKey); else store.delete(commandKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export function pendingI4DocumentCommands(): I4DocumentCommand[] {
  const owner = useAdminAuth.getState().session?.adminId;
  return pending.list().filter(row => row.owner === owner).flatMap(row => {
    try {
      const document = normalizeTrustDocument(row.document);
      if (row.fingerprint !== `${owner}|${document.slot}` || !["version", "language", "referenceNo", "verifyUrl", "reason"].every(key => typeof row.fields[key as keyof TrustDocumentUpload] === "string")
        || row.mode === "restore" && row.body !== JSON.stringify({ reason: row.fields.reason.trim(), expectedSha256: document.sha256 })
        || row.mode === "upload" && (!row.file || !/^[0-9a-f]{64}$/.test(row.file.sha256) || !Number.isSafeInteger(row.file.size))) return [];
      return [{ ...row, document, observation: row.observation ? normalizeTrustDocument(row.observation) : undefined }];
    } catch { return []; }
  });
}

export function i4DocumentPermission(slot: TrustDocument["slot"]): string | undefined {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || !auth.session) return "请先登录后再提交。";
  return auth.session.authorities.some(code => code === "content_i4_trust_section_manage" || slot === "whitepaper" && code === "content_i4_publish_standard")
    ? undefined : "当前账号没有这份资料的发布权限，请重新读取核对。";
}

async function finish(command: I4DocumentCommand) {
  pending.forget(command.fingerprint, command.commandKey);
  if (command.file) await uploadFile(command.commandKey, "delete");
}

async function send(command: I4DocumentCommand, retry: boolean, file?: File): Promise<void> {
  if (command.owner !== useAdminAuth.getState().session?.adminId) throw new Error("登录身份已变更，请重新打开页面。");
  const permission = i4DocumentPermission(command.document.slot);
  if (permission) throw new Error(permission);
  if (isRetryExpired(command)) throw new Error(RETRY_EXPIRED_TEXT);
  if (retry && command.mode === "upload") throw new Error("上传结果未知，文件可能已经对外公开；请重新读取，核对文件指纹、大小和上传时间。");
  if (!pending.isDurablyStored(command.fingerprint, command.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let updated: TrustDocument;
  try {
    updated = command.mode === "upload" ? await uploadTrustDocument(command.document, file!, command.fields, command.commandKey)
      : await restoreTrustDocumentBody(command.document.slot, command.body, command.commandKey);
  } catch (error) {
    const failure = error as { status?: number; apiCode?: number };
    const rejected = retry ? isExplicitRejection(error) : !isOutcomeUnknownError(error) && isDeterministicRejection(failure.status ?? 0, failure.apiCode);
    if (rejected) {
      await finish(command);
      if (!retry && error instanceof Error) Object.assign(error, { rejectedCommand: command });
    }
    if (!rejected && command.mode === "upload") throw new OutcomeUnknownError("上传结果未知，文件可能已经对外公开；请重新读取，核对文件指纹、大小和上传时间。");
    throw error;
  }
  if (updated.slot !== command.document.slot || (command.mode === "restore" ? updated.source !== "DEFAULT"
    : updated.source !== "UPLOADED" || updated.sha256 !== command.file!.sha256 || updated.sizeBytes !== command.file!.size
      || ["version", "language", "referenceNo", "verifyUrl"].some(key => (updated[key as keyof TrustDocument] ?? "") !== command.fields[key as keyof TrustDocumentUpload].trim()))) {
    throw new OutcomeUnknownError(command.mode === "restore" ? "App 可能已经改回随系统发布的默认文件。"
      : "没能确认这次操作的结果，文件可能已经对外公开；记录会留着，请重新读取核对。");
  }
  await finish(command);
}

export async function submitI4Document(document: TrustDocument, fields: TrustDocumentUpload, file?: File): Promise<void> {
  const permission = i4DocumentPermission(document.slot);
  if (permission) throw new Error(permission);
  if (pendingI4DocumentCommands().some(row => row.document.slot === document.slot)) throw new Error("这份资料有结果未知的原操作，请先重新读取核对。");
  const owner = useAdminAuth.getState().session!.adminId;
  const commandKey = createA2CommandKey("i4-trust-document");
  const fingerprint = `${owner}|${document.slot}`;
  let metadata: I4DocumentCommand["file"];
  if (file) {
    const sha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    metadata = { name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, sha256 };
    try { await uploadFile(commandKey, "save", file); }
    catch { throw new Error("浏览器无法保存原文件，尚未上传。请允许本地存储后再试。"); }
  }
  const original = { owner, mode: file ? "upload" as const : "restore" as const, document, fields,
    body: file ? "" : JSON.stringify({ reason: fields.reason.trim(), expectedSha256: document.sha256 }), file: metadata };
  pending.remember(fingerprint, commandKey, original);
  if (!pending.isDurablyStored(fingerprint, commandKey)) {
    await finish({ ...original, fingerprint, commandKey, createdAt: 0, expiresAt: 1 });
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  return send(pendingI4DocumentCommands().find(row => row.commandKey === commandKey)!, false, file);
}

export async function retryI4DocumentRestore(saved: I4DocumentCommand) {
  const command = pendingI4DocumentCommands().find(row => row.commandKey === saved.commandKey);
  if (!command || command.mode !== "restore") throw new Error("原操作已处理，请重新读取后再操作。");
  await send(command, true);
}

/** Readback is an observation, never proof that the original upload did or did not execute. */
export async function queryI4DocumentCommand(saved: I4DocumentCommand): Promise<TrustDocument> {
  const command = pendingI4DocumentCommands().find(row => row.commandKey === saved.commandKey);
  if (!command) throw new Error("原操作已处理，请重新读取后再操作。");
  const current = (await fetchTrustDocuments()).find(row => row.slot === command.document.slot)!;
  pending.remember(command.fingerprint, command.commandKey, { ...command, observation: current });
  return current;
}
