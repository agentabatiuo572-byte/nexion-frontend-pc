"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError, displayAdminReadError } from "./error-messages";
import { M_RECOVERY, mQueryFailedText, mRejectedReason, mUnknownText } from "./m-recovery-copy";
import { explicitRejectionCode, isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import { isSupportSessionExpired, SupportClientError } from "./m-support-client";
import { createPendingRecovery, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord, type PendingMutationStore } from "./pending-mutation-store";

export type M5ManagementRecord<T, B> = PendingMutationRecord & { actorId: number; payload: T; before?: B; denied?: boolean };

export function createM5ManagementRecovery<T, B>(store: PendingMutationStore<M5ManagementRecord<T, B>>) {
  return createPendingRecovery(store, {
    capability: () => "receipt",
    canReplay(record) {
      const auth = useAdminAuth.getState(), session = auth.session;
      return auth.isAuthenticated && !auth.logoutPending && !auth.logoutUnknown && session?.adminId === record.actorId
        && !session.passwordChangeRequired && ["super", "superadmin"].includes(session.role)
        && session.authorities.includes("service_m1_read") && session.authorities.includes("service_m1_write");
    },
    explicitRejectionCode,
  });
}

const noRecoverySubscription = () => () => {};
const noRecoveryRevision = () => 0;

/** M5 direct writes: restoration depends on the saved request, never on a successful overview read. */
export function useM5ManagementCommand<T, B, R>(options: {
  store: PendingMutationStore<M5ManagementRecord<T, B>>;
  canQuery: boolean;
  canWrite: boolean;
  legacySlot?: string;
  requireMissingReceipt?: boolean;
  receiptRecovery?: {
    controller: ReturnType<typeof createM5ManagementRecovery<T, B>>;
    expiry: "after-missing" | "load-latest";
    readAfterExpiry: (record: M5ManagementRecord<T, B>) => Promise<() => void>;
    canLoadLatest?: boolean;
    canRelease: boolean;
    onLocalRelease: (record: M5ManagementRecord<T, B>, rejection: string) => void;
  };
  fingerprint: (payload: T) => string;
  write: (payload: T, key: string) => Promise<R>;
  query: (key: string, payload: T) => Promise<{ status: "SUCCEEDED"; result: R } | { status: "FAILED" | "UNKNOWN" | "PROCESSING" | "PENDING" }>;
  onSuccess: () => void;
  onRefusal: (error: unknown, recovered: boolean, payload: T, before?: B) => void;
}) {
  const actorId = useAdminAuth(state => state.session?.adminId);
  const epoch = useAdminAuth(state => state.authEpoch);
  const [pending, setPending] = useState<M5ManagementRecord<T, B>>();
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [receiptMissing, setReceiptMissing] = useState(false);
  const [, setDeadline] = useState(0);
  const running = useRef(false);
  const recovery = options.receiptRecovery;
  useSyncExternalStore(recovery?.controller.subscribe ?? noRecoverySubscription,
    recovery?.controller.getRevision ?? noRecoveryRevision, noRecoveryRevision);
  useEffect(() => {
    setPending(options.store.list().find(row => row.actorId === actorId || row.actorId === undefined && row.fingerprint === options.legacySlot));
    setMessage("");
  }, [options.store, actorId, epoch, options.legacySlot]);
  useEffect(() => {
    if (!pending || isRetryExpired(pending)) return;
    const timer = window.setTimeout(() => setDeadline(Date.now()), pending.expiresAt - Date.now());
    return () => window.clearTimeout(timer);
  }, [pending]);
  const recoveryState = pending && recovery?.controller.state(pending);
  const canReplay = options.canWrite && !!pending && !isRetryExpired(pending)
    && (recoveryState ? !recoveryState.replayBlock : !options.requireMissingReceipt || receiptMissing && !pending.denied);

  async function run(action: "submit" | "replay" | "query" | "load-latest", payload?: T, before?: B) {
    const read = action === "query" || action === "load-latest";
    const allowed = action === "load-latest" ? recovery?.canLoadLatest : read ? options.canQuery : options.canWrite;
    if (running.current || !actorId || !allowed) return;
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
    if (action === "load-latest" && (recovery?.expiry !== "load-latest" || !isRetryExpired(record))) return;
    if (action === "replay" && recovery?.controller.state(record).replayBlock) return;
    if (action === "replay" && options.requireMissingReceipt && !canReplay) return;
    if (action === "replay" && isRetryExpired(record)) {
      setMessage("原请求已超过 24 小时，不能再重试，只能查询原结果；请核对最新规则。");
      return;
    }
    if (!read && !store.isDurablyStored(record.fingerprint, record.commandKey)) {
      setMessage(action === "replay" ? "浏览器没能记下这次操作，这次没有发出；之前发出的原操作结果仍未知，请先查询原结果。" : "浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
      return;
    }
    const current = () => actorId === useAdminAuth.getState().session?.adminId && epoch === useAdminAuth.getState().authEpoch;
    running.current = true; setBusy(true); setSubmitting(Boolean(recovery) && action === "submit"); setMessage(""); setReceiptMissing(false);
    if (action !== "query") setPending(record);
    let querying = action === "query";
    try {
      if (recovery) {
        const saved = record;
        const loadLatest = async () => {
          const applyLatest = await recovery.readAfterExpiry(saved);
          if (!current()) return;
          // The two OP-153 exceptions settle from a successful fresh content read.
          store.forget(saved.fingerprint, saved.commandKey);
          setPending(undefined);
          applyLatest();
        };
        if (action === "load-latest") {
          await loadLatest();
        } else if (action === "query") {
          const verdict = await recovery.controller.query(saved, async original => {
            try {
              const receipt = await options.query(original.commandKey, original.payload);
              return { conclusion: receipt.status === "SUCCEEDED" ? "succeeded" : "unknown" };
            } catch (error) {
              if (error instanceof SupportClientError && error.status === 404 && error.backendMessage === "SUPPORT_COMMAND_NOT_FOUND") {
                return { conclusion: "not-found" };
              }
              throw error;
            }
          });
          if (!current() || !verdict) return;
          if (verdict.conclusion === "succeeded" && recovery.controller.settleFromQuery(saved, "succeeded")) {
            setPending(undefined);
            options.onSuccess();
          } else if (verdict.conclusion === "not-found") {
            if (recovery.expiry === "after-missing" && isRetryExpired(saved)) await loadLatest();
            // Text only: the row and dialog add what to do next from the recovery state.
            else setMessage(isRetryExpired(saved) || recovery.controller.state(saved).replayRejection ? M_RECOVERY.notFoundShort : "");
          } else setMessage(M_RECOVERY.unsettled);
        } else {
          if (action === "replay") {
            await recovery.controller.replay(saved, original => options.write(original.payload, original.commandKey));
          } else await options.write(saved.payload, saved.commandKey);
          if (!current()) return;
          recovery.controller.settleAcknowledged(saved);
          setPending(undefined);
          options.onSuccess();
        }
        return;
      }
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
        options.onRefusal(new Error("原请求没有成功，你填的内容还在；请检查后重新提交。"), true, record.payload, record.before);
        setMessage("原请求没有成功，你填的内容还在；请检查后重新提交。");
      } else options.onSuccess();
    } catch (error) {
      if (!current()) return;
      if (recovery && action !== "submit") {
        setPending(record);
        const state = recovery.controller.state(record);
        setMessage(action === "load-latest" ? `最新内容没读到，记录和你填的内容都还在。${displayAdminReadError(error)}`
          : action === "query" ? state.conclusion === "not-found"
            ? `没有查到原操作，最新规则也没读到，记录和你填的内容都还在。${displayAdminReadError(error)}` : mQueryFailedText(displayAdminReadError(error))
            : state.replayRejection ? mRejectedReason(displayAdminError(error)) : mUnknownText(displayAdminError(error)));
        return;
      }
      const rejected = action === "submit" && error instanceof SupportClientError && !isSupportSessionExpired(error)
          && !error.backendMessage?.startsWith("IDEMPOTENCY_") && isDeterministicRejection(error.status, error.apiCode);
      if (rejected) {
        store.forget(record.fingerprint, record.commandKey); setPending(undefined);
        options.onRefusal(error, false, record.payload, record.before);
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
          : recovery ? mUnknownText(displayAdminError(error)) : `结果未知：请查询原结果，或按原请求重试。${displayAdminError(error)}`);
      }
    } finally {
      running.current = false;
      if (current()) { setBusy(false); setSubmitting(false); }
    }
  }
  /** Call after the operator verifies the original outcome. The release itself is local. */
  function releaseRejectedReplay() {
    if (!pending || !recovery?.canRelease || running.current || epoch !== useAdminAuth.getState().authEpoch
      || actorId !== useAdminAuth.getState().session?.adminId) return false;
    const rejection = recovery.controller.state(pending).replayRejection;
    if (!rejection || !recovery.controller.releaseRejectedReplay(pending)) return false;
    setPending(undefined);
    setMessage("");
    recovery.onLocalRelease(pending, rejection);
    return true;
  }
  return { pending, busy, submitting, message, canReplay, recoveryState, releaseRejectedReplay, run };
}
