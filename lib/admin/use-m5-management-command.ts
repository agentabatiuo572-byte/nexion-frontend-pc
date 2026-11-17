"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "./error-messages";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { SupportClientError } from "./m-support-client";
import { isRetryExpired, type PendingMutationRecord, type PendingMutationStore } from "./pending-mutation-store";

export type M5ManagementRecord<T, B> = PendingMutationRecord & { actorId: number; payload: T; before?: B; denied?: boolean };

/** M5 direct writes: restoration depends on the saved request, never on a successful overview read. */
export function useM5ManagementCommand<T, B, R>(options: {
  store: PendingMutationStore<M5ManagementRecord<T, B>>;
  canQuery: boolean;
  canWrite: boolean;
  legacySlot?: string;
  requireMissingReceipt?: boolean;
  fingerprint: (payload: T) => string;
  write: (payload: T, key: string) => Promise<R>;
  query: (key: string, payload: T) => Promise<{ status: "SUCCEEDED"; result: R } | { status: "FAILED" | "UNKNOWN" | "PROCESSING" | "PENDING" }>;
  onSuccess: () => void;
  onRefusal: (error: unknown, recovered: boolean, payload: T) => void;
}) {
  const actorId = useAdminAuth(state => state.session?.adminId);
  const epoch = useAdminAuth(state => state.authEpoch);
  const [pending, setPending] = useState<M5ManagementRecord<T, B>>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [receiptMissing, setReceiptMissing] = useState(false);
  const [, setDeadline] = useState(0);
  const running = useRef(false);
  useEffect(() => {
    setPending(options.store.list().find(row => row.actorId === actorId || row.actorId === undefined && row.fingerprint === options.legacySlot));
    setMessage("");
  }, [options.store, actorId, epoch, options.legacySlot]);
  useEffect(() => {
    if (!pending || isRetryExpired(pending)) return;
    const timer = window.setTimeout(() => setDeadline(Date.now()), pending.expiresAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [pending]);
  const canReplay = options.canWrite && !!pending && !isRetryExpired(pending)
    && (!options.requireMissingReceipt || receiptMissing && !pending.denied);

  async function run(action: "submit" | "replay" | "query", payload?: T, before?: B) {
    if (running.current || !actorId || (action === "query" ? !options.canQuery : !options.canWrite)) return;
    if (actorId !== useAdminAuth.getState().session?.adminId || epoch !== useAdminAuth.getState().authEpoch) return;
    const { store } = options;
    let record = store.list().find(row => row.actorId === actorId || row.actorId === undefined && row.fingerprint === options.legacySlot);
    if (action === "submit") {
      if (record || payload === undefined) return;
      const fingerprint = options.fingerprint(payload), key = crypto.randomUUID();
      store.remember(fingerprint, key, { actorId, payload, before });
      if (!store.isDurablyStored(fingerprint, key)) {
        store.forget(fingerprint, key);
        setMessage("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
        return;
      }
      record = store.list().find(row => row.commandKey === key);
    }
    if (!record) return;
    if (action === "replay" && options.requireMissingReceipt && !canReplay) return;
    if (action === "replay" && isRetryExpired(record)) {
      setMessage("原请求已超过 24 小时，不能再重试，只能查询原结果；请核对最新规则。");
      return;
    }
    if (action !== "query" && !store.isDurablyStored(record.fingerprint, record.commandKey)) {
      setMessage(action === "replay" ? "浏览器没能记下这次操作，这次没有发出；之前发出的原操作结果仍未知，请先查询原结果。" : "浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
      return;
    }
    const current = () => actorId === useAdminAuth.getState().session?.adminId && epoch === useAdminAuth.getState().authEpoch;
    running.current = true; setBusy(true); setMessage(""); setReceiptMissing(false);
    if (action !== "query") setPending(record);
    let querying = action === "query";
    try {
      if (!querying) {
        try {
          await options.write(record.payload, record.commandKey);
        } catch (error) {
          if (action !== "replay" || !isExplicitRejection(error)) throw error;
          // A rejected replay says nothing about the original write's outcome.
          querying = true;
        }
        if (!current()) return;
      }
      const receipt = querying ? await options.query(record.commandKey, record.payload) : undefined;
      if (!current()) return;
      if (receipt && receipt.status !== "SUCCEEDED" && receipt.status !== "FAILED") {
        setMessage("原操作结果未知，请稍后再查询原结果。");
        return;
      }
      store.forget(record.fingerprint, record.commandKey); setPending(undefined);
      if (receipt?.status === "FAILED") {
        options.onRefusal(new Error("原请求没有成功，你填的内容还在；请检查后重新提交。"), true, record.payload);
        setMessage("原请求没有成功，你填的内容还在；请检查后重新提交。");
      } else options.onSuccess();
    } catch (error) {
      if (!current()) return;
      const rejected = action === "submit" && error instanceof SupportClientError
          && !error.backendMessage?.startsWith("IDEMPOTENCY_") && isDeterministicRejection(error.status, error.apiCode);
      if (rejected) {
        store.forget(record.fingerprint, record.commandKey); setPending(undefined);
        options.onRefusal(error, false, record.payload);
        setMessage(displayAdminError(error));
      } else {
        if (options.requireMissingReceipt && error instanceof SupportClientError && [401, 403].includes(error.status)) {
          const { actorId: owner, payload: originalPayload, before: originalBefore } = record;
          store.remember(record.fingerprint, record.commandKey, { actorId: owner ?? actorId, payload: originalPayload, before: originalBefore, denied: true });
          record = { ...record, denied: true };
        }
        setPending(record);
        if (querying && error instanceof SupportClientError && error.status === 404 && error.backendMessage === "SUPPORT_COMMAND_NOT_FOUND") setReceiptMissing(!record.denied);
        setMessage(querying ? `暂时查不到原结果；你填的内容和原请求都还在。${displayAdminError(error)}`
          : `结果未知：请查询原结果，或按原请求重试。${displayAdminError(error)}`);
      }
    } finally {
      running.current = false;
      if (current()) setBusy(false);
    }
  }
  return { pending, busy, message, canReplay, run };
}
