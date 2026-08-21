"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
/**
 * F 分销与团队 — 设计稿 design_handoff_f_domain 内容视图(F1–F5)。
 * 标签:F1 V-Rank 晋升 / F2 网络版税费率 / F3 双轨结算引擎 / F4 池·配额·大使·榜 / F5 佣金事件审计。
 * 导航已按设计稿收编为 F1–F5(旧 F6 硬件配额 / F7 区域大使 / F8 排行榜&反欺诈 已并入 F4「池/配额/大使/榜」聚合视图)。
 *
 * 本 shell 只持有后端快照 state + OperationConfirmModal;各 tab 视觉/布局拆到 f-tabs/*(复用 design-kit 原语 + f-domain.css 设计类)。
 * 真写落点:F1 走后端 teams/ranks;F2/F3/F4/F5 走后端 teams/{rates|binary|leadership-pool|commissions} + commissions/config。
 * - 调参类(op:"param"):F1 V-Rank 字段、F2 费率/参数、F3 双轨配置、F4 池/配额/大使/榜配置写后端;未知 key 直接失败。
 * - 处置类(op:"dispose"):写入固定状态值(approved/rejected/disqualified/frozen/unlocked …)。
 * - 放大资金流出(amplify):OperationConfirmModal amplifies={true} → B1 兑付覆盖率护栏。
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationConfirmModal, useToast, useDomainNav } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import {
  addF1VRankReward,
  executeF3Settlement,
  fetchF3BinaryOverview,
  fetchF4LeadershipPoolOverview,
  fetchF5CommissionAuditOverview,
  downloadF5RedactedCsv,
  updateF5AnomalyConfig,
  fetchF2RatesOverview,
  fetchF1PromotionLog,
  fetchF1RewardPayouts,
  fetchF1VRankOverview,
  removeF1VRankReward,
  updateF1VRankReward,
  updateF1VRankThreshold,
  type F3BinaryOverview,
  type F4LeadershipPoolOverview,
  type F5CommissionAuditOverview,
  type F2RatesOverview,
  type F1Page,
  type F1PayoutFilters,
  type F1PromotionFilters,
  type F1PromotionRecord,
  type F1RewardPayout,
  type F1VRankOverview,
} from "@/lib/admin/f1-client";
import { usePropose } from "@/lib/admin/use-propose";
import { createA2CommandKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { findHighOp, isFFundAmplifyingKey } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { Mc, McSpec, FViewCtx } from "./f-tabs/types";
import { F1Vrank } from "./f-tabs/f1-vrank";
import { F2Rates } from "./f-tabs/f2-rates";
import { F3Binary } from "./f-tabs/f3-binary";
import { F4Ops } from "./f-tabs/f4-ops";
import { F5Audit } from "./f-tabs/f5-audit";
import { operationConfirmErrorMessage } from "@/lib/admin/operation-confirm-error";
import "./f-domain.css";

const FOLD: Record<string, string> = { F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5" };
const ADMIN_OPERATOR = currentAdminOperator;

/** F 域全部 A2 提交共用的在途命令号(sessionStorage + 24h TTL):同槽位同输入才复用,让
 *  outcome-uncertain(网络断 / 503)后的重试带同一 Idempotency-Key 被后端去重;输入变了
 *  (如同一佣金事件先冻结后解冻)铸新号并弃旧号,防真实新操作被当成重复提交静默吞掉。 */
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-f-commands-v1" });

// F 域 polymorphic key→op 分发(对齐后端 OpsTeamService.updateConfig 分发逻辑,commit afe51f2)。
// 4 replay op 全部 params {key,value},后端从 key 派生锁 target id(unilevel→L+layerNo,commission→eventId)。
const F_ACTIVE_KEYS = new Set([
  "directRoyaltyPct", "networkRoyaltyPct", "binaryPairRatePct",
  "maxCombinedOutflowPct", "minPayoutUsdt", "rankWindowDays", "hardwareQuotaPerRank",
]);

function resolveFOp(key: string): string {
  if (key.startsWith("F.commission.") && key.endsWith(".status")) return "f_commission_status";
  if (/^F\.unilevel\.(?:nex\.)?L\d+/.test(key)) return "f_unilevel_rule";
  if (F_ACTIVE_KEYS.has(key)) return "f_config";
  return "f_ui_config";
}

function fProposalCommandKey(modalCommandKey: string | undefined, sourceDomain: string, key: string) {
  return modalCommandKey ? `${modalCommandKey}:${sourceDomain}:${key}` : undefined;
}

function errorMessage(error: unknown) {
  // 「结果未知」族(F 直写的 F1OutcomeUncertainError / A2 提案的 A2OutcomeUncertainError)必须
  // 附命令号:它们意味着请求可能已被后端执行,运营要拿这个号去审计记录核对。文案本体仍走
  // displayAdminError 咽喉(错误文案专项的单一出口),这里只补咽喉拿不到的命令号。
  if (error instanceof Error && error.name.endsWith("OutcomeUncertainError")) {
    return operationConfirmErrorMessage(error);
  }
  return displayAdminError(error);
}

function f1ThresholdTarget(paramKey?: string) {
  const match = paramKey?.match(/^F\.vrank\.(V\d{1,2})\.([A-Za-z]+)$/);
  return match ? { rank: match[1], field: match[2] } : null;
}

function currentMonthStart() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
}

export function FDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const rawPropose = usePropose();
  const nav = useDomainNav();
  const router = useRouter();
  const session = useAdminAuth((state) => state.session);
  const can = useCallback((authority: string) => {
    const role = session?.role;
    return role === "superadmin"
      || role === "super"
      || (session?.authorities ?? []).includes(authority);
  }, [session]);
  const routeTab = FOLD[meta.l2Id] ?? "F2";
  const [tab, setTab] = useState(routeTab);
  const [mc, setActionConfirm] = useState<Mc>(null);
  const propose = (toast: (message: string) => void, spec: ProposeSpec) =>
    rawPropose(toast, { ...spec, commandKey: spec.commandKey ?? mc?.commandKey });
  const openActionConfirm = (spec: McSpec) =>
    setActionConfirm({
      ...spec,
      commandKey: spec.commandKey ?? createA2CommandKey("f-domain-action"),
    });
  const [f1Overview, setF1Overview] = useState<F1VRankOverview | null>(null);
  const [f1Loading, setF1Loading] = useState(tab === "F1");
  const [f1Error, setF1Error] = useState<string | null>(null);
  const [f1Promotions, setF1Promotions] = useState<F1Page<F1PromotionRecord>>({ items: [], total: 0, limit: 100, nextCursor: "" });
  const [f1Payouts, setF1Payouts] = useState<F1Page<F1RewardPayout>>({ items: [], total: 0, limit: 100, nextCursor: "" });
  const [f1FlowLoading, setF1FlowLoading] = useState(tab === "F1");
  const [f1FlowError, setF1FlowError] = useState<string | null>(null);
  const [f2Overview, setF2Overview] = useState<F2RatesOverview | null>(null);
  const [f2Loading, setF2Loading] = useState(tab === "F2");
  const [f2Error, setF2Error] = useState<string | null>(null);
  const [f3Overview, setF3Overview] = useState<F3BinaryOverview | null>(null);
  const [f3Loading, setF3Loading] = useState(tab === "F3");
  const [f3Error, setF3Error] = useState<string | null>(null);
  const [f4Overview, setF4Overview] = useState<F4LeadershipPoolOverview | null>(null);
  const [f4Loading, setF4Loading] = useState(tab === "F4");
  const [f4Error, setF4Error] = useState<string | null>(null);
  const [f5Overview, setF5Overview] = useState<F5CommissionAuditOverview | null>(null);
  const [f5Loading, setF5Loading] = useState(tab === "F5");
  const [f5Error, setF5Error] = useState<string | null>(null);
  useEffect(() => {
    setTab(routeTab);
  }, [routeTab]);

  const refreshF1 = useCallback(async () => {
    setF1Loading(true);
    setF1FlowLoading(true);
    setF1Error(null);
    setF1FlowError(null);
    try {
      const [overview, promotions, payouts] = await Promise.allSettled([
        fetchF1VRankOverview(),
        fetchF1PromotionLog({ from: currentMonthStart() }),
        fetchF1RewardPayouts(),
      ]);
      if (overview.status === "fulfilled") setF1Overview(overview.value);
      else {
        setF1Overview(null);
        setF1Error(errorMessage(overview.reason));
      }
      if (promotions.status === "fulfilled") setF1Promotions(promotions.value);
      else setF1Promotions({ items: [], total: 0, limit: 100, nextCursor: "" });
      if (payouts.status === "fulfilled") setF1Payouts(payouts.value);
      else setF1Payouts({ items: [], total: 0, limit: 100, nextCursor: "" });
      const flowFailures = [promotions, payouts]
        .filter((result) => result.status === "rejected")
        .map((result) => errorMessage((result as PromiseRejectedResult).reason));
      if (flowFailures.length) setF1FlowError(flowFailures.join(" / "));
    } catch (error) {
      setF1Overview(null);
      setF1Promotions({ items: [], total: 0, limit: 100, nextCursor: "" });
      setF1Payouts({ items: [], total: 0, limit: 100, nextCursor: "" });
      setF1Error(errorMessage(error));
      setF1FlowError(errorMessage(error));
    } finally {
      setF1Loading(false);
      setF1FlowLoading(false);
    }
  }, []);

  const queryF1Promotions = useCallback(async (filters: F1PromotionFilters = {}) => {
    setF1FlowLoading(true);
    setF1FlowError(null);
    try {
      setF1Promotions(await fetchF1PromotionLog(filters));
    } catch (error) {
      setF1Promotions({ items: [], total: 0, limit: 100, nextCursor: "" });
      setF1FlowError(errorMessage(error));
    } finally {
      setF1FlowLoading(false);
    }
  }, []);

  const queryF1Payouts = useCallback(async (filters: F1PayoutFilters = {}) => {
    setF1FlowLoading(true);
    setF1FlowError(null);
    try {
      setF1Payouts(await fetchF1RewardPayouts(filters));
    } catch (error) {
      setF1Payouts({ items: [], total: 0, limit: 100, nextCursor: "" });
      setF1FlowError(errorMessage(error));
    } finally {
      setF1FlowLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F1") void refreshF1();
  }, [refreshF1, tab]);

  const refreshF2 = useCallback(async () => {
    setF2Loading(true);
    setF2Error(null);
    try {
      setF2Overview(await fetchF2RatesOverview());
    } catch (error) {
      setF2Overview(null);
      setF2Error(errorMessage(error));
    } finally {
      setF2Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F2") void refreshF2();
  }, [refreshF2, tab]);

  const refreshF3 = useCallback(async () => {
    setF3Loading(true);
    setF3Error(null);
    try {
      setF3Overview(await fetchF3BinaryOverview());
    } catch (error) {
      setF3Overview(null);
      setF3Error(errorMessage(error));
    } finally {
      setF3Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F3") void refreshF3();
  }, [refreshF3, tab]);

  const refreshF4 = useCallback(async () => {
    setF4Loading(true);
    setF4Error(null);
    try {
      setF4Overview(await fetchF4LeadershipPoolOverview());
    } catch (error) {
      setF4Overview(null);
      setF4Error(errorMessage(error));
    } finally {
      setF4Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F4") void refreshF4();
  }, [refreshF4, tab]);

  const refreshF5 = useCallback(async (query = {}) => {
    setF5Loading(true);
    setF5Error(null);
    try {
      setF5Overview(await fetchF5CommissionAuditOverview(query));
    } catch (error) {
      setF5Overview(null);
      setF5Error(errorMessage(error));
    } finally {
      setF5Loading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F5") void refreshF5();
  }, [refreshF5, tab]);

  // F 域全部 A2 propose 必经此咽喉:命令号先查在途记录再铸新——outcome-uncertain 重试同号让
  // 后端去重,成功 / 确定性失败即收敛丢弃。绕开咽喉直调会失去幂等复用(契约门钉直调恒为 1 处)。
  const proposeStable = async (slot: string, inputFingerprint: string, spec: ProposeSpec) => {
    const commandKey = commandAttempts.resolve(slot, inputFingerprint, () => createA2CommandKey(slot.split(":")[0]));
    try {
      await propose((s: string) => setToast(s), { ...spec, commandKey });
      commandAttempts.forget(slot);
    } catch (error) {
      if (!isA2OutcomeUncertainError(error)) commandAttempts.forget(slot);
      throw error;
    }
  };

  // F 域 5 写函数统一改 A2 propose:按 key 分发到 4 polymorphic op(commit afe51f2)。
  const proposeFConfig = async (sourceDomain: string, key: string, value: string, reason: string, expectedVersion?: number) => {
    const op = resolveFOp(key);
    const def = findHighOp(op);
    if (!def) throw new Error(`F_OP_NOT_FOUND:${op}`);
    await proposeStable(`f-config:${key}`, JSON.stringify([value, reason]), {
      action: `${def.action} · ${key}`,
      obj: key,
      before: "—",
      after: value,
      type: def.type === "fund" ? "fund" : "param",
      // F.* UI keys 资金放大类(F.pool.ratio/F.binary.matchRate 等)由 resolveFOp 路由到 f_ui_config(amplifies=false),
      // 但后端 loosensPayoutControlUiKey 运行时按方向兜底为放大;前端按 key 标 amplifies=true 对齐,
      // 避免「弹窗显 🔥 但 A2 队列丢 🔥」(验收 5.12 缺口 ②)。
      amplifies: isFFundAmplifyingKey(key) || def.amplifies,
      gate: { roles: [] },
      gateLabel: def.gateLabel,
      reason,
      sourceDomain,
      commandKey: fProposalCommandKey(mc?.commandKey, sourceDomain, key),
      command: def.buildCommand({ key, value, expectedVersion }),
      target: def.buildTarget({ key, value, expectedVersion }),
    });
  };

  const updateFConfigBatch = async (
    sourceDomain: "F2" | "F3" | "F4",
    changes: Array<{ key: string; value: string }>,
    reason: string,
  ) => {
    const normalized = changes.map((item) => ({ key: item.key.trim(), value: item.value.trim() }))
      .filter((item) => item.key && item.value);
    if (!normalized.length) throw new Error("F_CONFIG_BATCH_EMPTY");
    const def = findHighOp("f_config_batch");
    if (!def) throw new Error("F_OP_NOT_FOUND:f_config_batch");
    try {
      await proposeStable(`f-config-batch:${sourceDomain}`, JSON.stringify([normalized, reason]), {
        action: `${def.action} · ${normalized.length} 项`,
        obj: normalized.map((item) => item.key).join(","),
        before: "以服务端权威快照为准",
        after: normalized.map((item) => `${item.key}=${item.value}`).join(" / "),
        type: "fund",
        amplifies: normalized.some((item) => isFFundAmplifyingKey(item.key)),
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain,
        command: def.buildCommand({ changes: normalized, sourceDomain }),
        targets: def.buildTargets?.({ changes: normalized, sourceDomain }),
      });
    } catch (error) {
      // A2 submission/validation failure must re-read the authoritative server snapshot so
      // the operator never continues from optimistic partial values.
      if (sourceDomain === "F2") await refreshF2();
      else if (sourceDomain === "F3") await refreshF3();
      else await refreshF4();
      throw error;
    }
  };

  const ctx: FViewCtx = {
    openActionConfirm: (m) => openActionConfirm(m),
    nav,
    toast: (msg) => setToast(msg),
    can,
    vrankRows: f1Overview?.rows ?? [],
    leadership: f1Overview?.leadership ?? null,
    f1Loading,
    f1Error,
    refreshF1,
    updateVRankThreshold: async (rank, field, value, reason) => {
      setF1Overview(await updateF1VRankThreshold(rank, field, value, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    updateF1Config: async (key, value, reason) => {
      await proposeFConfig("F1", key, value, reason);
    },
    rewards: f1Overview?.rewards ?? {},
    addReward: async (level, item, reason) => {
      const { id: _id, ...payload } = item;
      setF1Overview(await addF1VRankReward(level, payload, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    updateReward: async (level, id, patch, reason) => {
      if (!patch.type) throw new Error("请选择奖励类型。");
      setF1Overview(await updateF1VRankReward(level, id, {
        type: patch.type,
        amount: patch.amount,
        voucherId: patch.voucherId,
        skuId: patch.skuId,
        custom: patch.custom,
      }, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    removeReward: async (level, id, reason) => {
      setF1Overview(await removeF1VRankReward(level, id, reason, ADMIN_OPERATOR()));
      setF1Error(null);
    },
    voucherOptions: f1Overview?.voucherOptions ?? [],
    voucherLabels: f1Overview?.voucherLabels ?? {},
    skuOptions: f1Overview?.skuOptions ?? [],
    skuLabels: f1Overview?.skuLabels ?? {},
    f1ConfigValues: f1Overview?.configValues ?? {},
    promotionRecords: f1Promotions.items,
    promotionTotal: f1Promotions.total,
    payoutRecords: f1Payouts.items,
    payoutTotal: f1Payouts.total,
    f1FlowLoading,
    f1FlowError,
    queryPromotions: queryF1Promotions,
    queryPayouts: queryF1Payouts,
    proposeVRankOverride: async (userId, targetV, direction, reason) => {
      const def = findHighOp("f_vrank_override");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_vrank_override");
      await proposeStable(`f-vrank-override:${userId}`, JSON.stringify([targetV, direction, reason]), {
        action: `${def.action} · ${direction === "promote" ? "晋升" : "降级"}至 ${targetV}`,
        obj: `用户 ${userId}`,
        before: "以服务端当前等级为准",
        after: targetV,
        type: "fund",
        amplifies: direction === "promote",
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F1",
        command: def.buildCommand({ userId, targetV, direction }),
        target: def.buildTarget({ userId, targetV, direction }),
      });
    },
    proposePayoutAction: async (payoutId, action, reason) => {
      const def = findHighOp("f_reward_payout_action");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_reward_payout_action");
      await proposeStable(`f-payout-action:${payoutId}`, JSON.stringify([action, reason]), {
        action: `${def.action} · ${action === "reissue" ? "重发" : "冲正"}`,
        obj: `派发单 ${payoutId}`,
        before: "以服务端当前状态为准",
        after: action === "reissue" ? "REISSUED" : "REVERSED",
        type: "fund",
        amplifies: action === "reissue",
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F1",
        command: def.buildCommand({ payoutId, action }),
        target: def.buildTarget({ payoutId, action }),
      });
    },
    f2Metrics: f2Overview?.metrics ?? [],
    f2Unilevel: f2Overview?.unilevel ?? [],
    f2RateTiers: f2Overview?.rateTiers ?? [],
    f2Params: f2Overview?.params ?? [],
    f2CommissionPolicy: f2Overview?.commissionPolicy ?? {},
    f2Guardrails: f2Overview?.guardrails ?? [],
    f2ConfigValues: f2Overview?.configValues ?? {},
    f2Loading,
    f2Error,
    refreshF2,
    updateF2Config: async (key, value, reason) => {
      await proposeFConfig("F2", key, value, reason);
    },
    updateFConfigBatch,
    f3Metrics: f3Overview?.metrics ?? [],
    f3Formula: f3Overview?.formula ?? null,
    f3Settlements: f3Overview?.settlements ?? [],
    f3MaxTrackGmv: f3Overview?.maxTrackGmv ?? 1,
    f3Config: f3Overview?.config ?? null,
    f3ConfigValues: f3Overview?.configValues ?? {},
    f3DailyCap: f3Overview?.dailyCap ?? null,
    f3ParticipantCount: f3Overview?.participantCount ?? 0,
    f3BlockedCount: f3Overview?.blockedCount ?? 0,
    f3MonthlyMatchedUsd: f3Overview?.monthlyMatchedUsd ?? 0,
    f3AutoPlacement7dCount: f3Overview?.autoPlacement7dCount ?? 0,
    f3DailyMatchUsd: f3Overview?.dailyMatchUsd ?? 0,
    f3Loading,
    f3Error,
    refreshF3,
    updateF3Config: async (key, value, reason) => {
      await proposeFConfig("F3", key, value, reason);
    },
    executeF3Settlement: async (ownerUserId, settlementDate, reason) => {
      const result = await executeF3Settlement(ownerUserId, settlementDate, reason);
      await refreshF3();
      return result;
    },
    f4Overview,
    f4Loading,
    f4Error,
    refreshF4,
    updateF4Config: async (key, value, reason, expectedVersion) => {
      await proposeFConfig("F4", key, value, reason, expectedVersion);
    },
    proposeF4Settlement: async (reason) => {
      const def = findHighOp("f4_pool_settle");
      if (!def) throw new Error("F_OP_NOT_FOUND:f4_pool_settle");
      // 指纹带日键:结算是按周期重复的意图,上一周期已决议的票被 24h 幂等回放会把新结算静默吞掉;
      // 日键把该窗口压到当日,跨日重试铸新号(在途票期间由后端 current-week 目标锁兜底)。
      await proposeStable("f4-settle:current-week", JSON.stringify([reason, new Date().toISOString().slice(0, 10)]), {
        action: def.action,
        obj: "F4 当前周领导奖池",
        before: "待结算",
        after: "按实时周 GMV、门槛、票权及月度 cap 结算",
        type: "fund",
        amplifies: true,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F4",
        command: def.buildCommand({}),
        target: def.buildTarget({ weekKey: "current-week" }),
      });
    },
    f5Overview,
    f5Loading,
    f5Error,
    refreshF5,
    exportF5Commissions: async (query, reason) => downloadF5RedactedCsv(query, reason),
    updateF5Config: async (key, value, reason, expectedVersion) => {
      await proposeFConfig("F5", key, value, reason, expectedVersion);
    },
    reverseF5Commission: async (commissionId, refundRef, reason) => {
      const def = findHighOp("f5_commission_reverse");
      if (!def) throw new Error("F_OP_NOT_FOUND:f5_commission_reverse");
      await proposeStable(`f5-reverse:${commissionId}`, JSON.stringify([refundRef, reason]), {
        action: `${def.action} · ${commissionId}`,
        obj: commissionId,
        before: "以服务器执行时状态为准",
        after: "REVERSED",
        type: def.type,
        amplifies: def.amplifies,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F5",
        command: def.buildCommand({ commissionId, refundRef }),
        target: def.buildTarget({ commissionId, refundRef }),
      });
    },
    proposeF4LeaderboardPayout: async (period, reason) => {
      const def = findHighOp("f4_leaderboard_period_payout");
      if (!def) throw new Error("F_OP_NOT_FOUND:f4_leaderboard_period_payout");
      const periodKey = new Date().toISOString().slice(0, 10);
      await proposeStable(`f4-leaderboard:${period}`, JSON.stringify([period, periodKey, reason]), {
        action: def.action,
        obj: `F4 排行榜 ${period}`,
        before: "待派发",
        after: "按对应周期真实佣金榜及奖池配置原子派发",
        type: "fund",
        amplifies: true,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F4",
        command: def.buildCommand({ period }),
        target: def.buildTarget({ period }),
      });
    },
    reissueF5Commissions: async (commissionIds, reason) => {
      const def = findHighOp("f5_commission_reissue");
      if (!def) throw new Error("F_OP_NOT_FOUND:f5_commission_reissue");
      const sortedIds = [...commissionIds].sort();
      await proposeStable("f5-reissue", JSON.stringify([sortedIds, reason]), {
        action: `${def.action} · ${sortedIds.length} 笔`,
        obj: sortedIds.join(","),
        before: "以服务器执行时状态为准",
        after: "重新进入冷却计提",
        type: def.type,
        amplifies: def.amplifies,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F5",
        command: def.buildCommand({ commissionIds: sortedIds }),
        targets: def.buildTargets?.({ commissionIds: sortedIds }),
      });
    },
    suspendF5UserCommissions: async (userId, kinds, suspended, reason) => {
      const def = findHighOp("f5_commission_suspension");
      if (!def) throw new Error("F_OP_NOT_FOUND:f5_commission_suspension");
      const sortedKinds = [...kinds].sort();
      await proposeStable(`f5-suspension:${userId}`, JSON.stringify([sortedKinds, suspended, reason]), {
        action: `${suspended ? "暂停" : "恢复"}用户佣金 · ${userId}`,
        obj: `${userId}:${sortedKinds.join(",")}`,
        before: "以服务器执行时状态为准",
        after: suspended ? "SUSPENDED" : "ACTIVE",
        type: def.type,
        amplifies: def.amplifies,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F5",
        command: def.buildCommand({ userId, kinds: sortedKinds, suspended }),
        target: def.buildTarget({ userId, kinds: sortedKinds, suspended }),
      });
    },
    updateF5AnomalyConfig: async (sigma, layerRatio, reason) => {
      await updateF5AnomalyConfig(sigma, layerRatio, reason, ADMIN_OPERATOR());
      await refreshF5();
    },
  };

  // 跨域 / 跨标签跳转 CTA(放进 DomainHeader 的 right 槽,不改 DomainHeader 组件)
  const CTA: Record<string, { label: string; onClick: () => void }> = {
    F1: { label: "领导池票数权重 →", onClick: () => { setTab("F4"); router.push("/network/leadership-pool"); setToast("已跳转 F4 · 领导池票数权重"); } },
    F2: { label: "合并出口护栏 →", onClick: () => openActionConfirm({
      name: "F2 合并出口保护上限", amplify: false, op: "param",
      paramKey: "F.unilevel.mergeExitMaxPct",
      edit: { kind: "number", current: f2Overview?.configValues["F.unilevel.mergeExitMaxPct"] ?? "25", unit: "%" },
      detail: "限制同一订单经 Influence 与活动倍率放大后的 L1-L7 USDT 合并出口；结算引擎按该上限实时截断，避免重复叠加越界。",
    }) },
    F3: { label: "B5 风险雷达 →", onClick: () => nav("B") },
    F4: { label: "F5 佣金审计 →", onClick: () => { setTab("F5"); router.push("/network/commissions"); setToast("已跳转 F5 · 佣金事件审计"); } },
  };
  const cta = CTA[tab];

  return (
    <div className="dkpage fdom">
      <DomainHeader {...meta} right={cta ? <button className="f-cta" onClick={cta.onClick}>{cta.label}</button> : undefined} />

      {tab === "F1" && <F1Vrank ctx={ctx} />}
      {tab === "F2" && <F2Rates ctx={ctx} />}
      {tab === "F3" && <F3Binary ctx={ctx} />}
      {tab === "F4" && <F4Ops ctx={ctx} />}
      {tab === "F5" && <F5Audit ctx={ctx} />}

      {mc && <OperationConfirmModal
        action={mc.name}
        detail={mc.detail ?? "server-canonical · 改后对下一笔结算生效,不回溯已计提"}
        amplifies={!!mc.amplify}
        // coverage 按当前 tab 选源(A1 批1b 修复):原硬编码 f1Overview?.coverage → 切到 F2-F5 时仍显示 F1 覆盖率(跨域误用)。
        // 现按 tab 路由到对应 overview 的 coverage,与后端 rates()/binary()/leadershipPool()/commissions() 注入的 B1 快照一致。
        coverage={(tab === "F1" ? f1Overview?.coverage
          : tab === "F2" ? f2Overview?.coverage
          : tab === "F3" ? f3Overview?.coverage
          : tab === "F4" ? f4Overview?.coverage
          : tab === "F5" ? f5Overview?.coverage
          : undefined) as { coverageRatio: number; redlinePct: number; sourceEnvironment?: string; runId?: string; sandboxOverrideEnabled?: boolean } | undefined}
        edit={mc.edit}
        businessForm={mc.businessForm}
        completionCopy={mc.completionCopy}
        onClose={() => setActionConfirm(null)}
        onConfirm={async (reason, newVal, businessValue) => {
          try {
          if (mc.run) {
            await mc.run(reason, businessValue, newVal);
          } else if (mc.op === "param" && mc.paramKey) {
            if (!newVal) { setToast("请填写目标新值"); return; }
            const target = f1ThresholdTarget(mc.paramKey);
            if (target) {
              await ctx.updateVRankThreshold(target.rank, target.field, newVal, reason);
            } else if (tab === "F2") {
              await ctx.updateF2Config(mc.paramKey, newVal, reason);
            } else if (tab === "F3") {
              await ctx.updateF3Config(mc.paramKey, newVal, reason);
            } else if (tab === "F4") {
              await ctx.updateF4Config(mc.paramKey, newVal, reason, mc.expectedVersion);
            } else if (tab === "F1") {
              await ctx.updateF1Config(mc.paramKey, newVal, reason);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKey}`);
            }
            setToast(mc.name + " 已生效 · 新值 " + newVal);
          } else if (mc.op === "param-multi" && mc.paramKeys && businessValue) {
            // 多字段调参只生成一张 A2 票；后端 replay 在单事务内整批写入，任一失败整批回滚。
            if (tab === "F3") {
              await ctx.updateFConfigBatch("F3", mc.paramKeys.map(({ key, paramKey }) => ({
                key: paramKey, value: String(businessValue[key] ?? "").trim(),
              })), reason);
            } else if (tab === "F4") {
              await ctx.updateFConfigBatch("F4", mc.paramKeys.map(({ key, paramKey }) => ({
                key: paramKey, value: String(businessValue[key] ?? "").trim(),
              })), reason);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKeys.map((item) => item.paramKey).join(",")}`);
            }
            const summary = mc.paramKeys.map(({ key }) => String(businessValue[key] ?? "").trim()).join(" / ");
            setToast(mc.name + " 已生效 · " + summary);
          } else if (mc.op === "dispose" && mc.paramKey && mc.fixedVal) {
            if (tab === "F1") {
              await ctx.updateF1Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F2") {
              await ctx.updateF2Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F3") {
              await ctx.updateF3Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F4") {
              await ctx.updateF4Config(mc.paramKey, mc.fixedVal, reason, mc.expectedVersion);
            } else if (tab === "F5") {
              if (mc.expectedVersion === undefined) throw new Error("F5_EXPECTED_VERSION_REQUIRED");
              await ctx.updateF5Config(mc.paramKey, mc.fixedVal, reason, mc.expectedVersion);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKey}`);
            }
            // dispose 一律走 A2 propose:此刻只是入了待执行队列,还没落库。原文案「已生效」
            // 会把冻结这种抢时间的动作误报成完成(票在队列里等执行期间冷却可能到期解锁)。
            setToast(mc.name + " 已提交 · A2 待执行队列");
          } else {
            throw new Error("F_CONFIRM_SHAPE_UNKNOWN:" + (mc.op || mc.name)); // 未知确认形状必须响亮失败,禁静默假成功
          }
          setActionConfirm(null);
          } catch (error) {
            // outcome-uncertain 不算「失败」:提案可能已生效,冠以失败会诱导换渠道重做造成重复动作。
            setToast(isA2OutcomeUncertainError(error)
              ? errorMessage(error)
              : "F 域数据提交失败 · " + errorMessage(error));
            // Modal owns the retry/error state and must retain the original command key.
            // Swallowing here clears its submitting state without rendering the recovery path.
            throw error;
          }
        }} />}
      {toastNode}
    </div>
  );
}
