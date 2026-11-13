"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BellDot, BellRing, CircleHelp, FilePenLine, PenLine, History, RefreshCw, RotateCcw, Scale, ShieldAlert, ShieldCheck, TriangleAlert, SlidersHorizontal, Upload, UserRound, Users } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints,
  Notice, PageHeader, PageTabs, Pager, Panel, ScaleBar, SearchSelect, StatusTag, Table, TableMessage, Td, Th, Tr, useTabIds,
} from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  K1OutcomeUncertainError,
  executeK4Command,
  K4_DIMENSION_KEYS,
  fetchK4WithdrawalAlerts,
  markK4WithdrawalAlertRead,
  newK1CommandKey,
  type K4Model,
  type K4ModelDraftInput,
  type K4ScoreHistory,
  type K4ScoreMappingKey,
  type K4User,
  type K4UserOption,
  type K4WithdrawalAlert,
} from "@/lib/admin/k-client";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { k4Commands, k4Slot, k4Target, saveK4Operation, type K4Attempt, type K4Operation, type K4PendingCommand, type K4Snapshot } from "@/lib/admin/k4-command";
import { openK4Confirmation } from "./k4-confirmations";
import { expiredTag, KRecoveryNotice, MidId, unknownTag, type KRecoveryRow } from "./k-recovery";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import type { KCtx } from "./types";
import {
  BandAxis, BandValues, ContributionTable, Distribution, K4_MAPPING_FIELDS, MAPPING_GROUPS, MappingEditGroup, MappingView, ModelDiff,
  NumberEditRow, VersionFacts, WeightEditRow, WeightTable, changedCount, editableModel, fieldName, fmt, modelDiffRows, type EditableModel,
} from "./k4-parts";

function errorText(error: unknown) {
  return error instanceof Error ? displayAdminError(error) : "操作失败，请稍后重试";
}

type K4Tab = "model" | "users" | "alerts";

/** 原操作的槽位名换成运营看得懂的操作名。 */
function slotLabel(slot: string) {
  if (slot.startsWith("alert-read:")) return "告警标为已读";
  if (slot === "model-draft") return "保存评分规则草稿";
  if (slot === "model-publish") return "发布评分规则草稿";
  if (slot === "batch-recompute") return "全部恢复系统评分";
  if (slot.startsWith("model-restore-")) return "旧版本恢复为草稿";
  if (slot.startsWith("override:")) return "手动改分";
  if (slot.startsWith("recompute:")) return "恢复系统评分";
  return "评分操作";
}

/** 后端存的时间（北京时间、不带时区）写成「2026-11-08 09:20」，时区每块标一次。 */
const stamp = (value: string | null | undefined) => (value ? formatBusinessTimeCompact(value, value) : "—");
/** 规则版本只有一种写法：「v3」。后端给的「k4-v3」去掉前缀。 */
const versionText = (value: string | number | null | undefined) => value === null || value === undefined || value === "" ? "—" : `v${String(value).replace(/^k4-v/i, "").replace(/^v/i, "")}`;

const STATE_TEXT: Record<string, string> = { active: "生效中", draft: "草稿", archived: "已归档" };
const SCORE_STATE_TEXT: Record<string, string> = { "manually-overridden": "人工改分", "model-scored": "系统评分" };
const PRIORITY_TEXT: Record<string, string> = { ESCALATED: "已升级" };
const bandOf = (score: number, model: Pick<K4Model, "bandLowMax" | "bandHighMin">) => score >= model.bandHighMin ? "高风险" : score >= model.bandLowMax ? "中风险" : "低风险";
/** 分档标签：低风险对勾、中风险警示、高风险盾牌，不用时钟。 */
function BandTag({ tone, children }: { tone: string; children: ReactNode }) {
  const state = bandState(tone);
  return <StatusTag tone={state} icon={state === "danger" ? ShieldAlert : state === "warn" ? TriangleAlert : ShieldCheck}>{children}</StatusTag>;
}
const bandState = (tone: string) => (tone === "bad" || tone === "danger" ? "danger" : tone === "warn" ? "warn" : "ok") as "danger" | "warn" | "ok";

export function K4HeaderActions() {
  return null;
}

export function K4Scoring({ ctx, rereadPending, onRereadRequired, onCommandsChange }: {
  ctx: KCtx; rereadPending: boolean; onRereadRequired: () => void; onCommandsChange: () => void;
}) {
  const searchParams = useSearchParams();
  const userCode = searchParams?.get("userCode") ?? null;
  const returnTo = searchParams?.get("returnTo") ?? null;
  const inboundError = returnTo !== null && userCode === null ? "带入链接缺少用户编号，请从用户详情重新进入"
    : userCode !== null && (!/^U\d{8,19}$/.test(userCode) || searchParams?.getAll("userCode").length !== 1)
    ? "带入的用户编号格式无效，请核对用户详情地址后重新进入"
    : returnTo !== null && (!/^\/users\/search\/[^/?#\\]+(?:\?[^#\\]*)?$/.test(returnTo) || searchParams?.getAll("returnTo").length !== 1)
      ? "返回用户详情的地址无效，请从用户详情重新进入" : null;
  const INBOUND_USER = userCode && !inboundError ? { userNo: userCode, returnTo } : null;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuperAdmin = session?.role === "superadmin";
  const canModelWrite = authorities.includes("risk_k4_write");
  const canPublish = isSuperAdmin && authorities.includes("risk_k4_write");
  const canOverride = authorities.includes("risk_k4_user_override");
  const canRecompute = authorities.includes("risk_k4_user_recompute");
  const canReadWithdrawalAlerts = canOverride || isSuperAdmin;
  const reach = useReach();
  const overview = ctx.risk.scoring;
  const [modelDraft, setModelDraft] = useState<EditableModel | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [userOptions, setUserOptions] = useState<K4UserOption[]>([]);
  const [userSearchFor, setUserSearchFor] = useState<string | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);
  const [lookupUser, setLookupUser] = useState<K4User | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [overridePage, setOverridePage] = useState(1);
  const [overridePageSize, setOverridePageSize] = useState(5);
  const [withdrawalAlerts, setWithdrawalAlerts] = useState<K4WithdrawalAlert[]>([]);
  const [withdrawalAlertError, setWithdrawalAlertError] = useState<string | null>(null);
  const [alertsLoaded, setAlertsLoaded] = useState(false);
  const [alertsReading, setAlertsReading] = useState(false);
  const [alertBusy, setAlertBusy] = useState<string | null>(null);
  const [alertUnknown, setAlertUnknown] = useState<string[]>([]);
  const [tab, setTab] = useState<K4Tab>(INBOUND_USER ? "users" : "model");
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<K4ScoreHistory | null>(null);
  const [pending, setPending] = useState<K4PendingCommand[]>([]);
  const [readAt, setReadAt] = useState<number | null>(null);
  const tabIds = useTabIds();
  const pageEffectMounted = useRef(false);
  const lookupSequence = useRef(0);
  const inboundLoaded = useRef<string | null>(null);
  const currentState = useRef({ ctx, rereadPending, lookupUser });
  currentState.current = { ctx, rereadPending, lookupUser };

  const syncPending = useCallback(() => {
    const records = k4Commands.list();
    setPending(records);
    setAlertUnknown(records.flatMap(record => record.alertId ? [record.alertId] : []));
    onCommandsChange();
  }, [onCommandsChange]);
  useEffect(() => { syncPending(); }, [syncPending]);
  useEffect(() => { if (overview) setReadAt(Date.now()); }, [overview]);

  const sourceModel = overview ? (overview.draft ?? overview.model) : null;
  const sourceSignature = sourceModel
    ? `${sourceModel.state}:${sourceModel.version}:${sourceModel.rowVersion}:${JSON.stringify(sourceModel.weights)}:${JSON.stringify(sourceModel.inputSources)}:${JSON.stringify(sourceModel.scoreMappings)}:${sourceModel.bandLowMax}:${sourceModel.bandHighMin}:${sourceModel.autoEscalateScore}`
    : "";

  useEffect(() => {
    if (sourceModel) setModelDraft(editableModel(sourceModel));
    else setModelDraft(null);
    // sourceSignature captures every editable authoritative field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceSignature]);

  const reloadCurrentScoring = () => ctx.reloadKRisk({
    scoring: { overridePageNum: overridePage, overridePageSize },
  });

  useEffect(() => {
    if (!pageEffectMounted.current) {
      pageEffectMounted.current = true;
      return;
    }
    void reloadCurrentScoring();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridePage, overridePageSize]);

  const readWithdrawalAlerts = useCallback(() => {
    let alive = true;
    setAlertsReading(true);
    fetchK4WithdrawalAlerts()
      .then((data) => {
        if (!alive) return;
        setWithdrawalAlerts(data.alerts);
        setWithdrawalAlertError(null);
        for (const record of k4Commands.list()) {
          if (record.alertId && data.alerts.some(alert => alert.id === record.alertId && alert.read)) k4Commands.forget(record.fingerprint, record.commandKey);
        }
        syncPending();
      })
      .catch((error) => {
        if (!alive) return;
        setWithdrawalAlerts([]);
        setWithdrawalAlertError(errorText(error));
      })
      .finally(() => {
        if (!alive) return;
        setAlertsLoaded(true);
        setAlertsReading(false);
      });
    return () => { alive = false; };
  }, [syncPending]);

  useEffect(() => {
    if (!canReadWithdrawalAlerts) return;
    return readWithdrawalAlerts();
  }, [canReadWithdrawalAlerts, readWithdrawalAlerts]);

  useEffect(() => {
    if (!overview) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setUserSearchLoading(true);
      setUserSearchError(null);
      ctx.actions.searchK4Users(userSearch)
        .then((options) => {
          if (alive) setUserOptions(options);
        })
        .catch((error) => {
          if (!alive) return;
          setUserOptions([]);
          setUserSearchError(errorText(error));
        })
        .finally(() => {
          if (!alive) return;
          setUserSearchLoading(false);
          setUserSearchFor(userSearch);
        });
    }, 240);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [ctx.actions, overview, userSearch]);

  const originalFor = (attempt: K4Attempt) => attempt.retained
    ? k4Commands.list().find(record => record.commandKey === attempt.retained!.commandKey && record.fingerprint === attempt.retained!.fingerprint) : undefined;
  const pendingFor = (operation: K4Operation) => {
    const target = k4Target({ fingerprint: k4Slot(operation) });
    return k4Commands.list().find(record => k4Target(record) === target
      || (target.startsWith("score-user:") && k4Target(record) === "score-users")
      || (target === "score-users" && k4Target(record).startsWith("score-user:")));
  };
  const requireReread = () => {
    currentState.current.rereadPending = true;
    onRereadRequired();
    setEditorOpen(false);
  };
  const canWriteOperation = (operation: K4Operation) => {
    const session = useAdminAuth.getState().session;
    const code = ["draft", "publish", "restore"].includes(operation.kind) ? "risk_k4_write"
      : operation.kind === "override" ? "risk_k4_user_override" : "risk_k4_user_recompute";
    return session?.authorities.includes(code) && (operation.kind !== "publish" || session.role === "superadmin");
  };
  const sendOperation = async (operation: K4Operation, attempt: K4Attempt, reason: string, value?: string) => {
    const retained = originalFor(attempt);
    if (!canWriteOperation(operation)) {
      ctx.toast(errorText(new Error("FORBIDDEN")));
      throw new K1OutcomeUncertainError(errorText(new Error("FORBIDDEN")), retained?.commandKey ?? "");
    }
    if (retained && isRetryExpired(retained)) {
      ctx.toast(RETRY_EXPIRED_TEXT);
      throw new Error(RETRY_EXPIRED_TEXT);
    }
    if (!retained) {
      // A closed recovery cannot turn into a fresh edit of old facts.
      if (attempt.retained) throw new Error("请重新读取后从原入口发起新修改");
      const current = currentState.current;
      const live = current.ctx.risk.scoring;
      if (current.rereadPending || current.ctx.contentLoading || current.ctx.contentError || !live?.model) throw new Error("RISK_BACKEND_UNAVAILABLE");
      if (pendingFor(operation)) throw new Error("IDEMPOTENCY_RESULT_UNKNOWN");
      if (operation.kind === "draft" || operation.kind === "publish" || operation.kind === "restore") {
        const before = operation.overview.draft ?? operation.overview.model;
        const now = live.draft ?? live.model;
        if (before.state !== now.state || before.version !== now.version || before.rowVersion !== now.rowVersion) throw new Error("K4_MODEL_CONCURRENT_UPDATE");
        if (operation.kind === "publish" && !live.draft) throw new Error("K4_MODEL_CONCURRENT_UPDATE");
      } else if (operation.kind === "batch") {
        if (live.totalUsers > 1000) throw new Error("K4_SCORE_BATCH_TOO_LARGE");
        if (live.model.version !== operation.overview.model.version) throw new Error("K4_MODEL_VERSION_CONFLICT");
      } else if (current.lookupUser?.userNo !== operation.user.userNo || current.lookupUser?.rowVersion !== operation.user.rowVersion) {
        throw new Error("K4_SCORE_CONCURRENT_UPDATE");
      }
      if (operation.kind === "override" && (!value?.trim() || !/^\d+$/.test(value.trim()) || Number(value) > 100)) throw new Error("SCORE_OVERRIDE_INVALID");
    }
    const saved = retained?.operation ?? saveK4Operation(operation, reason, value);
    const slot = retained?.fingerprint ?? k4Slot(saved);
    const commandKey = retained?.commandKey ?? newK1CommandKey();
    k4Commands.remember(slot, commandKey, { operation: saved });
    if (!k4Commands.isDurablyStored(slot, commandKey)) {
      if (!retained) k4Commands.forget(slot, commandKey);
      syncPending();
      const message = "浏览器存不下原操作，本次没有发送；请保留原记录并重新读取核对";
      ctx.toast(message);
      throw new Error(message);
    }
    attempt.retained = k4Commands.list().find(record => record.commandKey === commandKey);
    syncPending();
    const refreshUserNo = "user" in saved ? saved.user.userNo
      : saved.kind === "publish" || saved.kind === "batch" ? currentState.current.lookupUser?.userNo : undefined;
    try {
      await executeK4Command(saved.request, commandKey);
      k4Commands.forget(slot, commandKey);
      requireReread();
      if (refreshUserNo) {
        lookupSequence.current += 1;
        currentState.current.lookupUser = null;
        setLookupUser(null);
        setLookupLoading(false);
      }
    } catch (error) {
      if (isExplicitRejection(error)) {
        k4Commands.forget(slot, commandKey);
        requireReread();
        syncPending();
        if ("user" in saved) {
          lookupSequence.current += 1;
          currentState.current.lookupUser = null;
          setLookupUser(null);
          setLookupLoading(false);
        }
        try {
          await reloadCurrentScoring();
          if ("user" in saved) await loadUser(saved.user.userNo);
        } catch { /* The read boundary exposes the error and keeps new writes blocked. */ }
        ctx.toast(`操作失败 · ${errorText(error)}`);
        throw error;
      }
      ctx.toast("结果未知 · 可能已经生效，可以在框里按原请求重试，或在页面上方查询原结果");
      throw new K1OutcomeUncertainError(errorText(error), commandKey);
    } finally {
      syncPending();
    }
    try {
      await reloadCurrentScoring();
      if (refreshUserNo) await loadUser(refreshUserNo);
      ctx.toast(saved.successText);
    } catch (error) {
      ctx.toast(`操作已生效，但页面刷新失败。请不要重复提交，点「重新加载」核对 · ${errorText(error)}`);
    }
  };
  const openOperation = (operation: K4Operation) => {
    const retained = pendingFor(operation);
    if (retained && !retained.operation) {
      ctx.toast("原记录没有保存完整请求，只能查询原结果，或到「操作记录与审批」核对");
      return;
    }
    if (retained?.operation && k4Slot(retained.operation) !== k4Slot(operation)) {
      ctx.toast("这个对象有结果未知的原操作，先在页面上方查询原结果或按原请求重试");
      return;
    }
    const original = retained?.operation ?? operation;
    if (!retained && (currentState.current.rereadPending || ctx.contentLoading || ctx.contentError || !ctx.risk.scoring?.model)) {
      ctx.toast("这项没有读到，请刷新后重试");
      return;
    }
    const attempt: K4Attempt = { retained };
    openK4Confirmation(ctx, original, {
      getPendingReason: () => originalFor(attempt)?.operation?.reason,
      getPendingValue: () => {
        const saved = originalFor(attempt)?.operation;
        return saved?.kind === "override" ? String(JSON.parse(saved.request.body).score) : undefined;
      },
      blockedReason: retained && isRetryExpired(retained) ? RETRY_EXPIRED_TEXT : !canWriteOperation(original) ? errorText(new Error("FORBIDDEN")) : undefined,
    }, (reason, value) => sendOperation(original, attempt, reason, value));
  };

  const loadUser = async (id: string): Promise<K4User | null> => {
    const sequence = ++lookupSequence.current;
    const userNo = id.trim();
    setLookupUser(null);
    setLookupError(null);
    setLookupLoading(false);
    if (!userNo) {
      setLookupError("请输入用户编号后再查询");
      return null;
    }
    setLookupLoading(true);
    try {
      const user = await ctx.actions.fetchK4User(userNo);
      if (sequence !== lookupSequence.current) return null;
      setLookupUser(user);
      setUserSearch(user.userNo);
      return user;
    } catch (error) {
      if (sequence !== lookupSequence.current) return null;
      setLookupUser(null);
      setLookupError(errorText(error));
      ctx.toast(`查询失败 · ${errorText(error)}`);
      return null;
    } finally {
      if (sequence === lookupSequence.current) setLookupLoading(false);
    }
  };

  const selectLookupUser = async (option: K4UserOption) => {
    setUserSearch(option.userNo);
    await loadUser(option.userNo);
  };

  const openOverride = (user: K4User) => { if (overview?.model) openOperation({ kind: "override", user, overview: overview as K4Snapshot }); };
  const openRecompute = (user: K4User) => { if (overview?.model) openOperation({ kind: "recompute", user, overview: overview as K4Snapshot }); };

  const prepareRecompute = async (userNo: string) => {
    const user = await loadUser(userNo);
    if (user) openRecompute(user);
  };

  useEffect(() => {
    if (!overview?.model || overview.recomputePending <= 0) return;
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        await ctx.refreshK4Scoring({ overridePageNum: overridePage, overridePageSize });
        if (!cancelled && lookupUser
            && lookupUser.modelVersion !== `k4-v${overview.model!.version}`) {
          await loadUser(lookupUser.userNo);
        }
      } catch {
        // Keep the last authoritative snapshot visible; the next poll retries only the read.
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 1500);
      }
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // Re-arm only when queue or selected-user version changes; ctx methods are stable in KDomainView.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overview?.recomputePending, overview?.model?.version, overridePage, overridePageSize,
    lookupUser?.userNo, lookupUser?.modelVersion]);

  useEffect(() => {
    const key = searchParams?.toString() ?? "";
    if (inboundLoaded.current === key) return;
    inboundLoaded.current = key;
    if (userCode !== null || inboundError) setTab("users");
    if (inboundError) {
      lookupSequence.current += 1;
      setLookupUser(null);
      setLookupLoading(false);
      setUserSearch(userCode ?? "");
      setLookupError(inboundError);
      ctx.toast(inboundError);
    } else if (INBOUND_USER) {
      setUserSearch(INBOUND_USER.userNo);
      void loadUser(INBOUND_USER.userNo);
    }
    // The detail request does not depend on a successful overview read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, userCode, returnTo, inboundError]);

  const markAlertRead = async (alert: K4WithdrawalAlert) => {
    if (k4Commands.list().some(record => record.alertId === alert.id)) { readWithdrawalAlerts(); return; }
    const slot = `alert-read:${alert.id}`;
    const commandKey = newK1CommandKey();
    k4Commands.remember(slot, commandKey, { alertId: alert.id,
      alertRequest: { method: "POST", path: `/scoring/withdrawal-alerts/${encodeURIComponent(alert.id)}/read`, body: null },
    });
    if (!k4Commands.isDurablyStored(slot, commandKey)) {
      k4Commands.forget(slot, commandKey);
      ctx.toast("浏览器存不下原操作，本次没有发送");
      syncPending();
      return;
    }
    setAlertBusy(alert.id);
    try {
      await markK4WithdrawalAlertRead(alert.id, commandKey);
      k4Commands.forget(slot, commandKey);
      setWithdrawalAlerts((current) => current.map((item) => item.id === alert.id ? { ...item, read: true } : item));
    } catch (error) {
      if (isExplicitRejection(error)) k4Commands.forget(slot, commandKey);
      ctx.toast(`标记已读失败 · ${errorText(error)}`);
    } finally {
      setAlertBusy(null);
      syncPending();
    }
  };

  const unreadAlerts = withdrawalAlerts.filter((alert) => !alert.read).length;

  const header = (
    <PageHeader pageId="K4" title="风险评分规则" summary="维护给用户打风险分的模型，查单个用户为什么是这个分。"
      meta={readAt && overview && !ctx.contentError ? `读取于 ${formatBusinessTimeCompact(new Date(readAt).toISOString())}（${businessZone().label}）· 待重新计算时每 1.5 秒自动刷新，其余手动刷新` : undefined}
      readOnly={canModelWrite || canOverride || canRecompute ? undefined : isSuperAdmin ? "当前账号只能查看评分，提现升级告警可以标为已读" : "当前账号只能查看这页"}
      actions={<Button icon={<RefreshCw size={14} aria-hidden />} loading={ctx.contentLoading && Boolean(overview)} onClick={() => void reloadCurrentScoring().catch(() => undefined)}>刷新</Button>} />
  );

  // 原操作提醒：每条写改的是什么、从多少到多少、什么时候提交的。按原请求重试只读保存的原记录，
  // 调用现成的 openOperation 打开原确认框；概览读不到、原来的按钮不在了也能打开。过期的只能查询。
  const queryOriginal = (record: K4PendingCommand) => {
    void reloadCurrentScoring().catch(() => undefined);
    if (record.alertId) readWithdrawalAlerts();
    else if (record.operation && "user" in record.operation) void loadUser(record.operation.user.userNo);
  };
  const originalChange = (record: K4PendingCommand): ReactNode => {
    const op = record.operation;
    if (record.alertId) {
      const alert = withdrawalAlerts.find((item) => item.id === record.alertId);
      return alert ? <>提现 <MidId value={alert.withdrawalNo} /> 的告警</> : "一条提现升级告警";
    }
    if (!op) return "旧版本留下的记录，没有保存原请求";
    if (op.kind === "publish") return `生效版本 v${op.overview.model.version} → v${op.overview.draft?.version ?? "—"}`;
    if (op.kind === "restore") return `v${op.model.version} 的配置 → 草稿`;
    if (op.kind === "batch") return `${fmt(op.overview.totalUsers)} 人按 v${op.overview.model.version} 重算，清除人工改分`;
    if (op.kind === "draft") {
      const base = op.overview.draft ?? op.overview.model;
      const changed = changedCount(modelDiffRows(editableModel(base), { weights: op.input.weights, inputSources: op.input.inputSources, scoreMappings: op.input.scoreMappings,
        bandLowMax: op.input.lowMax, bandHighMin: op.input.highMin, autoEscalateScore: op.input.autoEscalateScore }, op.overview.dimensions));
      return `${op.overview.draft ? `草稿 v${op.overview.draft.version}` : "新草稿"}：改了 ${changed} 项`;
    }
    if (op.kind === "override") return `${op.user.userNo}：有效分 ${op.user.effectiveScore} → ${JSON.parse(op.request.body).score} 分`;
    return `${op.user.userNo}：清除人工改分，按生效规则重算`;
  };
  const recoveryRows: KRecoveryRow[] = pending.map((record) => {
    const expired = isRetryExpired(record);
    const operation = record.operation;
    return {
      key: record.commandKey,
      name: slotLabel(record.fingerprint),
      change: originalChange(record),
      submittedAt: record.createdAt,
      tag: record.alertId ? unknownTag("noRetry") : expired ? expiredTag("direct") : unknownTag("direct"),
      state: expired ? "expired" : "unknown",
      actions: <>
        <Button size="sm" loading={record.alertId ? alertsReading : undefined} onClick={() => queryOriginal(record)}>查询原结果</Button>
        {!record.alertId && <Button size="sm" disabledReason={!operation ? "这是旧版本留下的记录，没有保存原请求，只能查询" : expired ? "原请求超过 24 小时，不能再重试，只能查询" : undefined}
          onClick={() => { if (operation) openOperation(operation); }}>按原请求重试</Button>}
      </>,
    };
  });
  const pendingBars = (
    <KRecoveryNotice title={`有 ${recoveryRows.length} 项原操作要处理`} rows={recoveryRows}
      explain={<><p>提交时没收到确定结果，可能已经生效。先查询原结果：读回现在的评分规则、用户分数或告警状态。读到的是现在的值，不能单凭它认定原操作成没成。</p><p>24 小时内可以按原请求重试：打开原来的确认框，内容和理由都不变，后端认得出是同一次提交，不会重复执行。告警标为已读不提供重试。</p><p>原请求只保存在这个浏览器标签页里。</p></>} />
  );

  const inboundNotice = INBOUND_USER && (
    <Notice tone="progress" title={`从用户详情带入 ${INBOUND_USER.userNo}`}
      action={INBOUND_USER.returnTo && reach(INBOUND_USER.returnTo, "user_c1_read") ? <Link className="rd-link" href={{ pathname: `/users/search/${INBOUND_USER.returnTo.split("/users/search/")[1].split("?")[0]}`, query: Object.fromEntries(new URLSearchParams(INBOUND_USER.returnTo.split("?")[1] ?? "")) }}>返回用户详情</Link> : undefined}>
      已打开「用户分数」并查这位用户的评分。
    </Notice>
  );

  if (ctx.contentLoading) {
    return (
      <>
        {header}
        {pendingBars}
        <div className="k4-loading" aria-label="正在读取风险评分">
          <div className="rd-skeleton k4-skel-line" />
          <div className="rd-skeleton k4-skel-tabs" />
          <div className="k4-skel-grid"><div className="rd-skeleton" /><div className="rd-skeleton" /></div>
          <div className="rd-skeleton k4-skel-block" />
        </div>
      </>
    );
  }

  if (ctx.contentError) {
    return (
      <>
        {header}
        <Conclusion state="unknown" icon={ShieldCheck}>风险评分读取失败，这页没有判断</Conclusion>
        {pendingBars}
        <Panel title="风险评分">
          <BlockState state="error" title="风险评分加载失败" detail={<><p>{ctx.contentError}</p><p>为避免误判，不显示旧数据，也不能保存、发布或改分。</p></>}
            retryLabel="重新加载" onRetry={() => void reloadCurrentScoring().catch(() => undefined)} />
        </Panel>
      </>
    );
  }

  if (!overview?.model || !sourceModel) {
    return (
      <>
        {header}
        <Conclusion state="unknown" icon={ShieldCheck}>风险评分暂不可用，这页没有判断</Conclusion>
        {pendingBars}
        <Panel title="风险评分">
          <BlockState state="error" title="没有拿到当前生效的评分规则" detail="后端没有返回生效模型，这页不拿默认值代替。请重新加载，仍然没有就联系值班人员。"
            retryLabel="重新加载" onRetry={() => void reloadCurrentScoring().catch(() => undefined)} />
        </Panel>
      </>
    );
  }

  const edit = modelDraft ?? editableModel(sourceModel);
  const modelDirty = JSON.stringify(edit) !== JSON.stringify(editableModel(sourceModel));
  const weightTotal = K4_DIMENSION_KEYS.reduce((total, key) => total + edit.weights[key], 0);
  const modelInput: K4ModelDraftInput = {
    expectedVersion: overview.draft?.rowVersion ?? overview.model.rowVersion,
    weights: edit.weights,
    inputSources: edit.inputSources,
    scoreMappings: edit.scoreMappings,
    lowMax: edit.bandLowMax,
    highMin: edit.bandHighMin,
    autoEscalateScore: edit.autoEscalateScore,
  };
  const modelValid = weightTotal === 100
    && K4_DIMENSION_KEYS.every((key) => Number.isInteger(edit.weights[key]) && edit.weights[key] >= 0 && edit.weights[key] <= 100)
    && Number.isInteger(edit.bandLowMax) && edit.bandLowMax >= 0 && edit.bandLowMax < edit.bandHighMin
    && Number.isInteger(edit.bandHighMin) && edit.bandHighMin <= 100
    && Number.isInteger(edit.autoEscalateScore) && edit.autoEscalateScore >= 70
    && edit.autoEscalateScore >= edit.bandHighMin && edit.autoEscalateScore <= 100;
  const orderedMappings = (...keys: K4ScoreMappingKey[]) => keys.every((key, index) => index === 0
    || edit.scoreMappings[keys[index - 1]] <= edit.scoreMappings[key]);
  const mappingsValid = K4_MAPPING_FIELDS.every((field) => {
    const value = edit.scoreMappings[field.key];
    return Number.isInteger(value) && value >= field.min && value <= field.max;
  }) && edit.scoreMappings["multiAccount.mediumMin"] < edit.scoreMappings["multiAccount.highMin"]
    && edit.scoreMappings["account.newDays"] < edit.scoreMappings["account.matureDays"]
    && orderedMappings("multiAccount.mediumScore", "multiAccount.highScore", "multiAccount.fraudScore")
    && orderedMappings("arbitrage.singleScore", "arbitrage.repeatScore", "arbitrage.severeScore")
    && orderedMappings("withdraw.baselineScore", "withdraw.highScore")
    && orderedMappings("account.middleScore", "account.newLargeScore")
    && orderedMappings("anomaly.lowScore", "anomaly.tamperScore");
  const dist = overview.distribution;
  const overridesPage = overview.overrides;
  const overrides = overridesPage.records;
  const activeEdit = editableModel(overview.model);
  const draftEdit = overview.draft ? editableModel(overview.draft) : null;
  const draftRows = draftEdit ? modelDiffRows(activeEdit, draftEdit, overview.dimensions) : [];
  const nextDraftVersion = overview.draft?.version ?? Math.max(overview.model.version, ...overview.modelHistory.map((model) => model.version)) + 1;
  const names = new Map(overview.dimensions.map((item) => [item.dimKey, item.name]));

  // 编辑抽屉里每一项的填错提示：只把旧页面已有的整体校验拆到对应字段，规则不变。
  const issues: Record<string, string | undefined> = {};
  for (const key of K4_DIMENSION_KEYS) {
    const value = edit.weights[key];
    if (!Number.isInteger(value) || value < 0 || value > 100) issues[`w-${key}`] = "要填 0–100 的整数";
  }
  if (weightTotal !== 100) issues.weightTotal = `五项权重合计 ${weightTotal}%，要正好等于 100%（不参与评分的维度也算在内）`;
  if (!Number.isInteger(edit.bandLowMax) || edit.bandLowMax < 0 || edit.bandLowMax > 100) issues.low = "要填 0–100 的整数";
  else if (edit.bandLowMax >= edit.bandHighMin) issues.low = "要小于高风险起始分";
  if (!Number.isInteger(edit.bandHighMin) || edit.bandHighMin < 0 || edit.bandHighMin > 100) issues.high = "要填 0–100 的整数";
  if (!Number.isInteger(edit.autoEscalateScore) || edit.autoEscalateScore < 70 || edit.autoEscalateScore > 100) issues.esc = "要填 70–100 的整数";
  else if (edit.autoEscalateScore < edit.bandHighMin) issues.esc = "不能低于高风险起始分";
  for (const field of K4_MAPPING_FIELDS) {
    const value = edit.scoreMappings[field.key];
    if (!Number.isInteger(value) || value < field.min || value > field.max) issues[field.key] = `要填 ${fmt(field.min)}–${fmt(field.max)} 的整数`;
  }
  const after = (later: K4ScoreMappingKey, earlier: K4ScoreMappingKey, text: string, strict = false) => {
    if (issues[later]) return;
    const a = edit.scoreMappings[earlier];
    const b = edit.scoreMappings[later];
    if (strict ? !(a < b) : !(a <= b)) issues[later] = text;
  };
  after("multiAccount.highMin", "multiAccount.mediumMin", "要大于中风险关联组最少账号数", true);
  after("account.matureDays", "account.newDays", "要大于新账户天数", true);
  after("multiAccount.highScore", "multiAccount.mediumScore", "不能低于中风险关联账户的分");
  after("multiAccount.fraudScore", "multiAccount.highScore", "不能低于高风险关联账户的分");
  after("arbitrage.repeatScore", "arbitrage.singleScore", "不能低于单次异常套利的分");
  after("arbitrage.severeScore", "arbitrage.repeatScore", "不能低于重复套利的分");
  after("withdraw.highScore", "withdraw.baselineScore", "不能低于超过平时水平的分");
  after("account.newLargeScore", "account.middleScore", "不能低于普通新账户的分");
  after("anomaly.tamperScore", "anomaly.lowScore", "不能低于一般异常的分");
  const issueCount = Object.values(issues).filter(Boolean).length;
  const editRows = modelDiffRows(editableModel(sourceModel), edit, overview.dimensions);
  const editChanged = changedCount(editRows);

  const saveModel = () => {
    const original = pendingFor({ kind: "draft", input: modelInput, overview: overview as K4Snapshot });
    if (!original && (!modelValid || !mappingsValid || !modelDirty)) return;
    openOperation({ kind: "draft", input: modelInput, overview: overview as K4Snapshot });
  };
  const publishModel = () => { if (overview.draft && !modelDirty) openOperation({ kind: "publish", overview: overview as K4Snapshot }); };
  const restoreModel = (model: K4Model) => { if (!modelDirty) openOperation({ kind: "restore", model, overview: overview as K4Snapshot }); };
  const recomputeAll = () => openOperation({ kind: "batch", overview: overview as K4Snapshot });
  const editModel = () => {
    const saved = pending.find(record => record.fingerprint === "model-draft")?.operation;
    if (saved?.kind === "draft") setModelDraft({
      weights: saved.input.weights, inputSources: saved.input.inputSources, scoreMappings: saved.input.scoreMappings,
      bandLowMax: saved.input.lowMax, bandHighMin: saved.input.highMin, autoEscalateScore: saved.input.autoEscalateScore,
    });
    setEditorOpen(true);
  };

  // ── 首屏一句话 ──
  const conclusionExplain = <><p>生效版本和草稿取自后端的评分模型；待重新计算是后端这一刻还没按生效规则算好的人数。</p><p>提现升级告警只数发给你本人的最近 50 条里没读的。</p></>;
  const clauses: string[] = [];
  if (canReadWithdrawalAlerts && unreadAlerts > 0) clauses.push(`有 ${unreadAlerts} 条提现升级告警未读`);
  if (overview.recomputePending > 0) clauses.push(`${fmt(overview.recomputePending)} 人正在按 v${overview.model.version} 排队重算`);
  if (overview.draft) clauses.push(`草稿 v${overview.draft.version} 待发布`);
  const alertsFirst = canReadWithdrawalAlerts && unreadAlerts > 0;
  const status = `评分规则 v${overview.model.version} 生效中${clauses.filter((text) => !text.includes("告警")).map((text) => `，${text}`).join("")}`;
  const conclusion = alertsFirst ? (
    <Conclusion state="warn" lead icon={BellRing} explain={conclusionExplain}
      hint={`${status}。到「提现升级告警」逐条核对，处理后标为已读。`}
      action={tab !== "alerts" ? <Button size="sm" onClick={() => setTab("alerts")}>查看告警</Button> : undefined}>
      有 {unreadAlerts} 条提现升级告警未读
    </Conclusion>
  ) : (
    <Conclusion state={overview.draft || overview.recomputePending > 0 ? "neutral" : "ok"} icon={ShieldCheck} explain={conclusionExplain}
      hint={overview.draft && canPublish ? "核对草稿改了什么，没问题就发布。" : undefined}>
      {clauses.length > 0 ? status : `评分规则 v${overview.model.version} 生效中，全部评分用户都已按它算好`}
    </Conclusion>
  );

  const tabs = (
    <PageTabs label="风险评分规则" value={tab} onChange={setTab} ids={tabIds} items={[
      { value: "model", label: "评分模型" },
      { value: "users", label: "用户分数" },
      ...(canReadWithdrawalAlerts ? [{ value: "alerts" as const, label: "提现升级告警", count: alertsLoaded ? (withdrawalAlertError ? "—" : unreadAlerts) : undefined }] : []),
    ]} />
  );

  // ── 评分模型 ──
  const publishBlocked = modelDirty ? "有未保存的修改，先保存草稿或放弃修改" : undefined;
  const versionCards = (
    <div className="rd-split k4-versions" data-even="">
      <Panel title={`生效中 · v${overview.model.version}`} icon={ShieldCheck} tone="ok"
        explain={<><p>新的评分和提现时的风控判断按这一版算。发布后用户分批重算，还没算到的人暂时是旧分数；人工改的分保留；已发出的告警保留当时的分数和版本。</p><p>时间为{businessZone().label}。</p></>}>
        <VersionFacts rows={[
          { key: "pub", label: "发布", value: overview.model.publishedAt ? `${overview.model.publishedBy ?? "—"} · ${stamp(overview.model.publishedAt)}` : "—" },
          { key: "by", label: "起草", value: `${overview.model.createdBy} · ${stamp(overview.model.createdAt)}` },
          { key: "why", label: "理由", value: overview.model.reason },
        ]} />
      </Panel>
      <Panel title={overview.draft ? `草稿 · v${overview.draft.version}` : "草稿"} icon={FilePenLine} tone={overview.draft ? "warn" : "role-other"}
        explain="草稿只存在后台，不影响线上评分。有评分规则修改权限的人可以起草；有这项权限的超级管理员才能发布。"
        actions={<span className="k4-actions">
          {canModelWrite && <Button icon={<SlidersHorizontal size={14} aria-hidden />} onClick={editModel}>{modelDirty ? "继续编辑" : overview.draft ? "编辑草稿" : "起草新版本"}</Button>}
          {canPublish && overview.draft && <Button variant="primary" icon={<Upload size={14} aria-hidden />} disabledReason={publishBlocked} onClick={publishModel}>发布草稿</Button>}
        </span>}>
        {overview.draft ? (
          <VersionFacts rows={[
            { key: "saved", label: "保存", value: `${overview.draft.createdBy} · ${stamp(overview.draft.createdAt)}` },
            { key: "diff", label: "和生效版比", value: changedCount(draftRows) > 0 ? `改了 ${changedCount(draftRows)} 项，见下面标出的值` : "配置无变化" },
            { key: "why", label: "理由", value: overview.draft.reason },
          ]} />
        ) : <p className="k4-quiet">暂无草稿</p>}
        {!canModelWrite && <p className="k4-quiet">你没有修改评分规则的权限，请联系管理员在「角色管理」里开通。</p>}
        {canModelWrite && !canPublish && overview.draft && <p className="k4-quiet">发布要由有评分规则修改权限的超级管理员操作。</p>}
      </Panel>
    </div>
  );

  const modelTab = (
    <div {...tabIds.panel("model")} className="k4-tab">
      {modelDirty && !editorOpen && (
        <Notice tone="warn" title={`有 ${editChanged} 项修改还没保存`}
          action={<span className="k4-actions"><Button size="sm" onClick={editModel}>继续编辑</Button><Button size="sm" variant="ghost" onClick={() => setModelDraft(editableModel(sourceModel))}>放弃修改</Button></span>}>
          修改只在这个页面里，刷新或离开就没了；保存草稿后才能发布或恢复旧版本。
        </Notice>
      )}
      {overview.recomputePending > 0 && (
        <Notice tone="progress" title={`正在按 v${overview.model.version} 重新计算：还有 ${fmt(overview.recomputePending)} 人`}>
          后台每轮最多算 200 人，页面每 1.5 秒自动刷新；还没算到的人暂时用旧分数。
        </Notice>
      )}
      {versionCards}
      <Panel title="五维权重" icon={Scale} tone="role-4" sub="合计 100%"
        explain={<><p>系统评分 = 五个维度各自「子分 × 权重」之和，每一维单独四舍五入到整数，总分在 0–100 之间。</p><p>不参与评分的维度贡献记 0，但权重仍算在合计里，其余维度不会自动补上。</p></>}>
        <WeightTable dimensions={overview.dimensions} active={activeEdit} draft={draftEdit ?? undefined} activeLabel={`生效 v${overview.model.version}`} draftLabel={overview.draft ? `草稿 v${overview.draft.version}` : undefined} />
      </Panel>
      <Panel title="分档线和各档人数" icon={Users} tone="role-3"
        explain={<><p>有效分低于中风险起始分是低风险，达到高风险起始分是高风险，中间是中风险。</p><p>新提现时用户的风险分达到自动升级线，会给有改分权限的管理员和超级管理员发提现升级告警；这笔提现没被「提现风险规则」冻结或延迟的，转人工审核（提现风险规则优先）。分数本身不冻结账户、不动钱包。</p><p>各档人数按每个人现在存的有效分统计，排队重算的人按旧分数计入；占比保留一位小数，相加不一定正好 100%。</p></>}>
        <div className="k4-bands">
          <div className="k4-axis-block">
            <div className="k4-axis-row"><span className="k4-axis-label">生效 v{overview.model.version}</span><BandAxis model={activeEdit} label={`生效 v${overview.model.version} 的分档线`} /></div>
            {draftEdit && <div className="k4-axis-row"><span className="k4-axis-label">草稿 v{overview.draft!.version}</span><BandAxis model={draftEdit} label={`草稿 v${overview.draft!.version} 的分档线`} /></div>}
            <BandValues model={draftEdit ?? activeEdit} before={draftEdit ? activeEdit : undefined} />
          </div>
          <div className="k4-dist-block">
            <p className="k4-block-title">各档人数 <span className="k4-quiet">按生效 v{overview.model.version} 的线 · 共 {fmt(overview.totalUsers)} 人</span></p>
            <Distribution rows={dist} total={overview.totalUsers} />
          </div>
        </div>
      </Panel>
      <Fold title="20 项计分细则" icon={SlidersHorizontal} tone="role-4"
        summary={draftEdit ? `5 个维度 · 草稿改了 ${K4_MAPPING_FIELDS.filter((item) => draftEdit.scoreMappings[item.key] !== activeEdit.scoreMappings[item.key]).length} 项` : "5 个维度 · 生效值"}
        explain="每一维先按这些细则算出 0–100 的子分，再乘权重。随评分规则版本一起保存，发布后才生效。">
        <MappingView dimensions={overview.dimensions} active={activeEdit} draft={draftEdit ?? undefined} />
      </Fold>
      <Fold title="版本历史" icon={History} summary={`共 ${overview.modelHistory.length} 个版本 · ${overview.modelHistory.filter((model) => model.state === "archived").length} 个已归档`}
        explain={<><p>所有没删除的版本，按版本号从新到旧，不分页。已归档的版本可以恢复成草稿，核对后再发布；恢复不会直接改线上评分。</p><p>时间为{businessZone().label}。</p></>}>
        <Table label="版本历史" className="k4-history">
          <thead><tr><Th>版本</Th><Th>起草</Th><Th>发布</Th><Th>理由</Th><Th align="right">操作</Th></tr></thead>
          <tbody>
            {overview.modelHistory.map((model) => (
              <Tr key={`${model.version}-${model.state}`}>
                <Td><span className="k4-version">v{model.version}<StatusTag tone={model.state === "active" ? "ok" : model.state === "draft" ? "warn" : "done"}>{STATE_TEXT[model.state] ?? "状态未知"}</StatusTag></span></Td>
                <Td><Cell main={model.createdBy} sub={stamp(model.createdAt)} /></Td>
                <Td><Cell main={model.publishedBy ?? "—"} sub={model.publishedAt ? stamp(model.publishedAt) : "未发布"} /></Td>
                <Td grow><Cell main={model.reason} title={model.reason} /></Td>
                <Td align="right" data-fit="">
                  {canModelWrite && model.state === "archived"
                    ? <Button size="sm" icon={<RotateCcw size={14} aria-hidden />} disabledReason={modelDirty ? "有未保存的修改，先保存草稿或放弃修改" : undefined} onClick={() => restoreModel(model)}>恢复为草稿</Button>
                    : <span className="k4-quiet">—</span>}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Fold>
    </div>
  );

  // ── 编辑草稿 ──
  const sourceEdit = editableModel(sourceModel);
  const pendingModel = pending.find(record => k4Target(record) === "score-model");
  const modelLocked = rereadPending || Boolean(pendingModel);
  const baseLabel = overview.draft ? "草稿" : "生效";
  const setWeight = (key: (typeof K4_DIMENSION_KEYS)[number], value: number) => setModelDraft({ ...edit, weights: { ...edit.weights, [key]: value } });
  const editor = canModelWrite && (
    <Drawer open={editorOpen} onClose={() => setEditorOpen(false)} icon={SlidersHorizontal} tone="role-4"
      title="编辑评分规则草稿" sub={overview.draft ? `基于草稿 v${overview.draft.version}` : `基于生效 v${overview.model.version}`}
      explain="修改只在这个页面里，保存后成为草稿，线上评分不变；关掉抽屉修改还在，页面上会提示。"
      footer={<Decision note={issueCount > 0 ? `有 ${issueCount} 处要改正` : modelDirty ? `改了 ${editChanged} 项` : undefined}
        others={<Button variant="ghost" disabledReason={modelDirty ? undefined : "没有改动"} onClick={() => setModelDraft(editableModel(sourceModel))}>放弃修改</Button>}
        primary={<Button variant="primary" disabledReason={pendingModel && pendingModel.fingerprint !== "model-draft" ? "这个对象有原操作结果待确认，请先重新读取核对原记录" : issueCount > 0 ? "先改正标出的项" : !modelDirty && !pendingModel ? "没有改动" : undefined} onClick={saveModel}>保存草稿</Button>} />}>
      <section className="k4-edit-section" aria-labelledby="k4-edit-weights">
        <h3 id="k4-edit-weights" className="k4-edit-title">五维权重 <span className={issues.weightTotal ? "k4-sum" : "k4-sum k4-quiet"} data-bad={issues.weightTotal ? "" : undefined}>合计 {weightTotal}%</span></h3>
        {issues.weightTotal && <div className="rd-form-error" role="alert">{issues.weightTotal}</div>}
        {overview.dimensions.map((item) => (
          <WeightEditRow key={item.dimKey} item={item} value={edit.weights[item.dimKey]} on={edit.inputSources[item.dimKey]}
            activeValue={sourceEdit.weights[item.dimKey]} activeOn={sourceEdit.inputSources[item.dimKey]} baseLabel={baseLabel} disabled={modelLocked} error={issues[`w-${item.dimKey}`]}
            onValue={(value) => setWeight(item.dimKey, value)}
            onSource={(on) => setModelDraft({ ...edit, inputSources: { ...edit.inputSources, [item.dimKey]: on } })} />
        ))}
      </section>
      <section className="k4-edit-section" aria-labelledby="k4-edit-bands">
        <h3 id="k4-edit-bands" className="k4-edit-title">分档线和自动升级线</h3>
        <p className="k4-axis-row"><span className="k4-axis-label">改后</span><BandAxis model={edit} label="改后的分档线" /></p>
        <NumberEditRow label="中风险起始分" unit="分" min={0} max={100} value={edit.bandLowMax} baseLabel={baseLabel} activeValue={sourceEdit.bandLowMax} disabled={modelLocked} error={issues.low} ariaLabel="中风险起始分"
          onValue={(value) => setModelDraft({ ...edit, bandLowMax: value })} />
        <NumberEditRow label="高风险起始分" unit="分" min={0} max={100} value={edit.bandHighMin} baseLabel={baseLabel} activeValue={sourceEdit.bandHighMin} disabled={modelLocked} error={issues.high} ariaLabel="高风险起始分"
          onValue={(value) => setModelDraft({ ...edit, bandHighMin: value })} />
        <NumberEditRow label="自动升级线" unit="分" min={70} max={100} value={edit.autoEscalateScore} baseLabel={baseLabel} activeValue={sourceEdit.autoEscalateScore} disabled={modelLocked} error={issues.esc} ariaLabel="自动升级线"
          onValue={(value) => setModelDraft({ ...edit, autoEscalateScore: value })} />
      </section>
      <section className="k4-edit-section" aria-labelledby="k4-edit-maps">
        <h3 id="k4-edit-maps" className="k4-edit-title">20 项计分细则</h3>
        {MAPPING_GROUPS.map((group) => {
          const bad = group.keys.filter((key) => issues[key]).length;
          const changed = group.keys.filter((key) => edit.scoreMappings[key] !== sourceEdit.scoreMappings[key]).length;
          return (
            <MappingEditGroup key={group.dimKey} title={names.get(group.dimKey) ?? group.dimKey} explain={group.explain} alert={bad > 0}
              summary={bad > 0 ? `${bad} 项要改正` : changed > 0 ? `改了 ${changed} 项` : `${group.keys.length} 项`}>
              {group.keys.map((key) => {
                const item = K4_MAPPING_FIELDS.find((entry) => entry.key === key)!;
                return <NumberEditRow key={key} label={fieldName(item.label)} unit={item.unit} min={item.min} max={item.max} value={edit.scoreMappings[key]}
                  baseLabel={baseLabel} activeValue={sourceEdit.scoreMappings[key]} disabled={modelLocked} error={issues[key]} ariaLabel={item.label}
                  onValue={(value) => setModelDraft({ ...edit, scoreMappings: { ...edit.scoreMappings, [key]: value } })} />;
              })}
            </MappingEditGroup>
          );
        })}
      </section>
    </Drawer>
  );

  // ── 用户分数 ──
  const userHref = (userNo: string) => `/users/search/${encodeURIComponent(userNo)}`;
  const userRef = (userNo: string) => reach(userHref(userNo), "user_c1_read")
    ? <Link className="rd-link" href={{ pathname: `/users/search/${encodeURIComponent(userNo)}` }}>{userNo}</Link> : userNo;
  const oldModel = lookupUser && lookupUser.modelVersion !== `k4-v${overview.model.version}`;
  const escalated = lookupUser ? lookupUser.effectiveScore >= overview.model.autoEscalateScore : false;
  const scoreTicks = [0, overview.model.bandLowMax, overview.model.bandHighMin, overview.model.autoEscalateScore, 100]
    .filter((value, index, list) => list.indexOf(value) === index).map((value) => ({ value, text: String(value) }));

  const lookup = (
    <Panel title="查用户的风险分" icon={UserRound} tone="role-3" explain="可以按用户编号、昵称、手机号或推荐码查；候选最多 8 个，按 Enter 选第一个，选中后看分数怎么来的。">
      <div className="k4-lookup" onKeyDown={(event) => {
        // 没有可选的候选时，Enter 按输入的编号直接查（旧页面行为）；有候选时由下拉选第一项。
        if (event.key === "Enter" && !event.defaultPrevented && !event.nativeEvent.isComposing && (event.target as HTMLElement).tagName === "INPUT") {
          event.preventDefault();
          void loadUser(userSearch);
        }
      }}>
        <SearchSelect aria-label="搜索用户编号或用户名" placeholder="搜索用户编号 / 用户名 / 手机号"
          value={userSearch}
          onChange={(next) => {
            lookupSequence.current += 1;
            setLookupUser(null);
            setUserOptions([]);
            setUserSearchError(null);
            setLookupError(null);
            setLookupLoading(false);
            setUserSearch(next);
          }}
          options={userOptions.map((option) => ({ value: option.userNo, label: option.label, extra: <BandTag tone={option.bandTone}>{option.bandLabel}{option.overridden ? " · 人工改分" : ""}</BandTag> }))}
          optionsFor={userSearchLoading ? null : userSearchFor}
          loading={userSearchLoading}
          error={userSearchError ? `候选加载失败 · ${userSearchError}` : undefined}
          empty="暂无匹配用户"
          selected={lookupUser?.userNo}
          onSelect={(value) => { const option = userOptions.find((item) => item.userNo === value); if (option) void selectLookupUser(option); }} />
        <Button variant="primary" loading={lookupLoading} onClick={() => void loadUser(userSearch)}>查询</Button>
      </div>
    </Panel>
  );

  const userResult = lookupLoading
    ? <Panel title="用户评分" id="k4-user"><BlockState state="loading" title="正在加载…" /></Panel>
    : lookupError
      ? <Panel title="用户评分" id="k4-user"><BlockState state="error" title="查询失败" detail={lookupError} onRetry={userSearch.trim() ? () => void loadUser(userSearch) : undefined} /></Panel>
      : !lookupUser
        ? <Panel title="用户评分" id="k4-user"><BlockState state="empty" title="请选择用户，查看风险分怎么来的" /></Panel>
        : (
          <Panel id="k4-user" title={<span className="k4-user-title">{userRef(lookupUser.userNo)}<BandTag tone={lookupUser.bandTone}>{lookupUser.bandLabel}</BandTag>{lookupUser.overridden && <StatusTag tone="warn" icon={PenLine}>人工改分</StatusTag>}</span>}
            sub={`评分时间 ${stamp(lookupUser.asOf)}（${businessZone().label}）`}
            actions={<span className="k4-actions">
              {canOverride && <Button onClick={() => openOverride(lookupUser)}>手动改分</Button>}
              {canRecompute && <Button onClick={() => openRecompute(lookupUser)}>恢复系统评分</Button>}
            </span>}>
            {oldModel && (
              <Notice tone="warn">这个用户还在排队重新计算，这里显示的是 {versionText(lookupUser.modelVersion)} 下的分{canRecompute ? `；可以点「恢复系统评分」马上按 v${overview.model.version} 计算` : ""}。</Notice>
            )}
            <div className="k4-user-top">
              <div className="k4-score">
                <span className="k4-score-k">有效分<Explain label="有效分是什么" content="提现审核、提现升级告警和分布统计都用有效分：有生效的人工改分就是改后的分，否则等于系统评分。" /></span>
                <span className="k4-score-v" data-tone={bandState(lookupUser.bandTone)}>{lookupUser.effectiveScore}<span className="k4-unit">分</span></span>
                <span className="k4-score-sub">{lookupUser.overridden ? "人工改分" : "等于系统评分"} · 系统评分 <b>{lookupUser.modelScore}</b> 分（{bandOf(lookupUser.modelScore, overview.model)}）· 规则版本 {versionText(lookupUser.modelVersion)}</span>
              </div>
              <div className="k4-user-scale">
                <ScaleBar label="有效分在分数轴上的位置" valueText={`有效分 ${lookupUser.effectiveScore} 分；中风险从 ${overview.model.bandLowMax} 分，高风险从 ${overview.model.bandHighMin} 分，自动升级线 ${overview.model.autoEscalateScore} 分`}
                  max={100} value={lookupUser.effectiveScore} fill target={overview.model.autoEscalateScore} ticks={scoreTicks} tone={bandState(lookupUser.bandTone)} />
                <p className={escalated ? "k4-escalate" : "k4-quiet"}>{escalated
                  ? `已达到自动升级线 ${overview.model.autoEscalateScore} 分：新提现会发升级告警，没被「提现风险规则」冻结或延迟的转人工审核`
                  : `离自动升级线 ${overview.model.autoEscalateScore} 分还差 ${overview.model.autoEscalateScore - lookupUser.effectiveScore} 分`}</p>
              </div>
            </div>
            {!canOverride && !canRecompute && <p className="k4-quiet">你没有修改用户风险分的权限。</p>}
            <ContributionTable rows={lookupUser.contributions} total={lookupUser.modelScore} label={`${lookupUser.userNo} 的五维贡献`} />
            <Fold title="最近评分记录" icon={History} summary={lookupUser.history.length > 0 ? `最近 ${lookupUser.history.length} 次 · 最新 ${stamp(lookupUser.history[0].createdAt)}` : "暂无记录"}
              explain={<><p>最多显示最近 20 次，按时间从新到旧；点一行看那一次的五维明细和理由。</p><p>时间为{businessZone().label}。</p></>}>
              {lookupUser.history.length === 0 ? <p className="k4-quiet">暂无历史评分。</p> : (
                <Table label="最近评分记录" className="k4-score-history">
                  <thead><tr><Th>时间</Th><Th>来源</Th><Th>规则版本</Th><Th align="right">系统评分 → 有效分</Th><Th>操作人</Th></tr></thead>
                  <tbody>
                    {lookupUser.history.map((row, index) => (
                      <Tr key={`${row.createdAt}-${row.modelVersion}-${index}`} selected={historyEntry === row} onOpen={() => setHistoryEntry(row)}>
                        <Td><Cell num main={stamp(row.createdAt)} /></Td>
                        <Td>{row.scoreState === "manually-overridden" ? <StatusTag tone="warn" icon={PenLine}>人工改分</StatusTag> : <StatusTag tone="neutral">{SCORE_STATE_TEXT[row.scoreState] ?? "来源未知"}</StatusTag>}</Td>
                        <Td>{versionText(row.modelVersion)}</Td>
                        <Td align="right"><Cell num main={row.modelScore === row.effectiveScore ? `${row.effectiveScore} 分` : `${row.modelScore} → ${row.effectiveScore} 分`} /></Td>
                        <Td><Cell main={row.operator} /></Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Fold>
          </Panel>
        );

  const overrideTable = (
    <Panel title="手动改分记录" icon={FilePenLine} tone="role-other" sub={`共 ${fmt(overridesPage.total)} 条 · 生效中 ${fmt(overview.overrideActive)} 人`}
      explain={<><p>谁、改了谁的分、改成多少、为什么。生效中的排在前面。</p><p>「系统评分」是改分那一刻的系统评分快照，之后不随重算变化，不一定等于改分前的有效分。「已失效」表示这次改分已经不生效：可能被恢复了系统评分，也可能被之后的又一次改分替换。</p><p>时间为{businessZone().label}。</p></>}
      actions={canRecompute ? <Button variant="danger-outline" disabledReason={overview.totalUsers > 1000 ? "超过 1000 人不能手动全部重算；发布评分规则会分批重算，但保留人工改分" : undefined} onClick={recomputeAll}>全部恢复系统评分</Button> : undefined}
      flush>
      <Table label="手动改分记录" className="k4-overrides">
        <thead><tr><Th>用户</Th><Th align="right">系统评分 → 改后</Th><Th>原因</Th><Th>操作人 · 时间</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
        <tbody>
          {overrides.length === 0 && <TableMessage columns={6}>暂无手动改分记录</TableMessage>}
          {overrides.map((row) => (
            <Tr key={`${row.userNo}-${row.timeText}`} selected={lookupUser?.userNo === row.userNo && row.active}>
              <Td><Cell mono main={<button type="button" className="rd-link k4-user-link" onClick={() => { setUserSearch(row.userNo); void loadUser(row.userNo).then(() => document.getElementById("k4-user")?.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior })); }}>{row.userNo}</button>} /></Td>
              <Td align="right"><span className="k4-change"><Change from={String(row.modelScore)} to={String(row.overrideScore)} settled={!row.active} tone={row.active ? (row.overrideScore > row.modelScore ? "danger" : "ok") : undefined} /> <span className="k4-unit">分</span></span></Td>
              <Td grow><Cell main={row.reason} title={row.reason} /></Td>
              <Td><Cell main={row.operator} sub={stamp(row.timeText)} /></Td>
              <Td>{row.active ? <StatusTag tone="progress" icon={PenLine}>生效中</StatusTag> : <StatusTag tone="done">已失效</StatusTag>}</Td>
              <Td align="right" data-fit="">
                {row.active && canRecompute
                  ? <Button size="sm" onClick={async () => { await prepareRecompute(row.userNo); }}>恢复系统评分</Button>
                  : <span className="k4-quiet">{row.active ? "无权限" : "—"}</span>}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
      {overridesPage.total > 0 && <Pager label="手动改分记录" total={overridesPage.total} page={overridesPage.pageNum} pageSize={overridesPage.pageSize} sizes={[5, 10, 20, 50]}
        onPage={setOverridePage} onPageSize={(next) => { setOverridePageSize(next); setOverridePage(1); }} />}
    </Panel>
  );

  const usersTab = (
    <div {...tabIds.panel("users")} className="k4-tab">
      {lookup}
      {userResult}
      {overrideTable}
    </div>
  );

  // ── 提现升级告警 ──
  const alertsTab = canReadWithdrawalAlerts && (
    <div {...tabIds.panel("alerts")} className="k4-tab">
      <Panel title="我的提现升级告警" icon={BellRing} tone="role-other" flush
        sub={alertsLoaded && !withdrawalAlertError ? `最近 ${withdrawalAlerts.length} 条 · 未读 ${unreadAlerts}` : undefined}
        explain={<><p>新提现时用户的风险分达到当时的自动升级线，就给当时有改分权限的管理员和超级管理员各发一条；这笔提现怎么走，「提现风险规则」的冻结和延迟优先，其余转人工审核。</p><p>这里只有发给你本人的最近 50 条；标为已读只改你自己的收件状态，不影响提现，也不影响别人的未读。</p><p>时间为{businessZone().label}。</p></>}
        actions={<Button size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={alertsReading} onClick={() => void readWithdrawalAlerts()}>重新读取</Button>}>
        {!alertsLoaded ? <BlockState state="loading" title="正在读取告警" />
          : withdrawalAlertError ? <BlockState state="error" title="告警加载失败" detail={withdrawalAlertError} onRetry={() => void readWithdrawalAlerts()} />
            : withdrawalAlerts.length === 0 ? <BlockState state="empty" title="暂无提现升级告警" detail="有新提现的风险分达到自动升级线时，会在这里提醒你。" />
              : (
                <Table label="我的提现升级告警" className="k4-alerts">
                  <thead><tr><Th>提现单号</Th><Th align="right">风险分</Th><Th>规则版本 · 评分时间</Th><Th>收到时间</Th><Th>状态</Th><Th align="right">操作</Th></tr></thead>
                  <tbody>
                    {withdrawalAlerts.map((alert) => {
                      const unknown = alertUnknown.includes(alert.id);
                      return (
                        <Tr key={alert.id}>
                          <Td><Cell mono full main={<MidId value={alert.withdrawalNo} />} title={alert.withdrawalNo} sub={alert.priority === null ? undefined : PRIORITY_TEXT[alert.priority] ?? alert.priority} /></Td>
                          <Td align="right"><Cell num main={alert.riskScore == null ? "—" : `${alert.riskScore} 分`} /></Td>
                          <Td><Cell main={versionText(alert.modelVersion)} sub={alert.scoreAsOf ? stamp(alert.scoreAsOf) : "—"} /></Td>
                          <Td><Cell num main={stamp(alert.createdAt).slice(0, 10)} sub={stamp(alert.createdAt).slice(11)} /></Td>
                          <Td>{alert.read ? <StatusTag tone="done">已读</StatusTag> : unknown ? <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag> : <StatusTag tone="warn" icon={BellDot}>未读</StatusTag>}</Td>
                          <Td align="right" data-fit="">
                            {alert.read ? <span className="k4-quiet">—</span>
                              : unknown ? <Button size="sm" loading={alertsReading} onClick={() => void readWithdrawalAlerts()}>查询原结果</Button>
                                : <Button size="sm" loading={alertBusy === alert.id} onClick={() => void markAlertRead(alert)}>标为已读</Button>}
                          </Td>
                        </Tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
        {alertUnknown.length > 0 && !withdrawalAlertError && <div className="k4-panel-note"><Notice tone="warn">标为已读结果未知。这个操作不提供原样重试；点「查询原结果」读回后端记下的状态。</Notice></div>}
      </Panel>
    </div>
  );

  // ── 单次评分明细 ──
  const historyDrawer = (
    <Drawer open={Boolean(historyEntry && lookupUser)} onClose={() => setHistoryEntry(null)} wide title="这次评分的明细" icon={History}
      sub={historyEntry ? `${lookupUser?.userNo ?? ""} · ${stamp(historyEntry.createdAt)}（${businessZone().label}）` : undefined}>
      {historyEntry && <>
        <JudgmentPoints rows={[
          { label: "来源", value: SCORE_STATE_TEXT[historyEntry.scoreState] ?? "来源未知", state: historyEntry.scoreState === "manually-overridden" ? "warn" : undefined },
          { label: "有效分", value: `${historyEntry.effectiveScore} 分` },
          { label: "系统评分", value: `${historyEntry.modelScore} 分 · 规则版本 ${versionText(historyEntry.modelVersion)}` },
          { label: "操作人", value: historyEntry.operator },
          { label: "理由", value: historyEntry.reason },
        ]} />
        <ContributionTable rows={historyEntry.contributions} total={historyEntry.modelScore} label="这次评分的五维贡献" />
      </>}
    </Drawer>
  );

  return (
    <>
      {header}
      {conclusion}
      {pendingBars}
      {inboundNotice}
      {tabs}
      {tab === "model" && modelTab}
      {tab === "users" && usersTab}
      {tab === "alerts" && alertsTab}
      {editor}
      {historyDrawer}
    </>
  );
}
