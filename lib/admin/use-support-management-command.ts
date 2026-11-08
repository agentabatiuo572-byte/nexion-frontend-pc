"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "./error-messages";
import { SupportClientError } from "./m-support-client";
import { PENDING_MUTATION_TTL_MS, type PendingMutationRecord, type PendingMutationStore } from "./pending-mutation-store";
import { canReplayGroupCommand } from "./support-group-client";

export type SupportIntent<T> = PendingMutationRecord & { payload: T; denied?: boolean };
type Receipt<R> = { status: "SUCCEEDED"; result: R } | { status: "PENDING" | "UNKNOWN" | "PROCESSING" | "FAILED" };
const withinReplayWindow = (record: PendingMutationRecord, now = Date.now()) => now < record.expiresAt && canReplayGroupCommand(record, now);
const deniedNotice = "当前无权核对原操作。记录已保留，请在恢复权限后查询。";

/** The caller keys the form by operator/session and target. Recovery is always a read before a replay. */
export function useSupportManagementCommand<T, R>(options: {
  store: PendingMutationStore<SupportIntent<T>>;
  slot: string;
  canQuery: boolean;
  canWrite: boolean;
  write: (payload: T, key: string) => Promise<R>;
  query: (key: string, payload: T) => Promise<Receipt<R>>;
  onSuccess: (result: R, payload: T) => void;
  onFailure: (payload: T) => void;
}) {
  const { store, slot, canQuery, canWrite } = options;
  const [pending, setPending] = useState(() => store.list().find(row => row.fingerprint === slot));
  const [message, setMessage] = useState(pending?.denied ? deniedNotice : "");
  const [receiptMissing, setReceiptMissing] = useState(false);
  const [expiredKey, setExpiredKey] = useState("");
  const [denied, setDenied] = useState(pending?.denied === true);
  const [busy, setBusy] = useState(false);
  const running = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!pending) return;
    if (!withinReplayWindow(pending)) { setExpiredKey(pending.commandKey); return; }
    const deadline = Math.min(pending.expiresAt, pending.createdAt + PENDING_MUTATION_TTL_MS);
    const timer = window.setTimeout(() => setExpiredKey(pending.commandKey), deadline - Date.now());
    return () => window.clearTimeout(timer);
  }, [pending]);
  const expired = !!pending && (pending.commandKey === expiredKey || !withinReplayWindow(pending));
  const canReplay = receiptMissing && !denied && !expired && canWrite;

  async function run(action: "submit" | "query" | "replay", input?: T) {
    if (running.current || (action === "query" ? !canQuery : !canWrite)) return;
    let command = store.list().find(row => row.fingerprint === slot);
    if (action === "submit") {
      if (command || input === undefined) return;
      const key = crypto.randomUUID();
      store.remember(slot, key, { payload: input });
      if (!store.isDurablyStored(slot, key)) {
        store.forget(slot, key);
        setMessage("浏览器未能保存原操作，尚未提交。请恢复会话存储后重试。");
        return;
      }
      command = store.list().find(row => row.commandKey === key);
      setPending(command); setDenied(false);
    } else if (!command || command.commandKey !== pending?.commandKey) return;
    if (!command) return;
    const { commandKey, payload } = command;
    if (action === "replay") {
      if (!withinReplayWindow(command)) { setExpiredKey(commandKey); return; }
      if (command.denied) { setDenied(true); setMessage(deniedNotice); return; }
      if (!canReplay) return;
    }
    const epoch = useAdminAuth.getState().authEpoch;
    const current = () => mounted.current && epoch === useAdminAuth.getState().authEpoch;
    running.current = true; setBusy(true); setMessage(""); setReceiptMissing(false);
    try {
      let result: R;
      if (action === "query") {
        const receipt = await options.query(commandKey, payload);
        if (!current()) return;
        if (receipt.status === "FAILED") {
          store.forget(slot, commandKey); setPending(undefined);
          options.onFailure(payload); setMessage("原操作已确认失败，请核对后重新提交。");
          return;
        }
        if (receipt.status !== "SUCCEEDED") {
          setMessage("原操作仍未确认，请稍后再查询。");
          return;
        }
        result = receipt.result;
      } else {
        result = await options.write(payload, commandKey);
        if (!current()) return;
      }
      store.forget(slot, commandKey); setPending(undefined);
      options.onSuccess(result, payload);
    } catch (error) {
      if (!current()) return;
      const status = error instanceof SupportClientError ? (error.status >= 400 ? error.status : error.apiCode) : undefined;
      const code = error instanceof SupportClientError ? error.backendMessage : undefined;
      const forbidden = status === 401 || status === 403;
      if (action === "query" && status === 404 && code === "SUPPORT_COMMAND_NOT_FOUND") {
        const restricted = denied || command.denied === true;
        setReceiptMissing(!restricted);
        setMessage(restricted ? "尚未查到原操作回执，当前授权仍未确认，请稍后再查询。" : "尚未查到原操作回执。");
      } else if (action === "submit" && [400, 404, 409, 422].includes(status ?? 0) && code && !code.startsWith("IDEMPOTENCY_")) {
        store.forget(slot, commandKey); setPending(undefined);
        options.onFailure(payload); setMessage(`本次操作未完成。${displayAdminError(error)}`);
      } else if (forbidden) {
        store.remember(slot, commandKey, { payload, denied: true });
        setDenied(true); setMessage(deniedNotice);
      } else {
        setMessage(action === "query" ? "暂时无法核对原操作，请稍后再查询。" : "本次提交结果待确认，请先查询原操作。");
      }
    } finally {
      running.current = false;
      if (current()) setBusy(false);
    }
  }

  const notice = expired ? `${message}原操作已超过 24 小时，只能继续查询。`
    : canReplay ? `${message}可稍后再查或按原操作重试。` : message;
  return { pending, busy, message: notice, canReplay, denied, run };
}
