"use client";

import { fBatchIssueText } from "./f-tabs/f-batch-names";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
/**
 * F 分销与团队 — 设计稿 design_handoff_f_domain 内容视图(F1–F5)。
 * 标签:F1 团队等级晋升 / F2 网络版税费率 / F3 左右团队业绩结算 / F4 池·配额·大使·榜 / F5 佣金记录核对。
 * 导航已按设计稿收编为 F1–F5(旧 F6 硬件配额 / F7 区域大使 / F8 排行榜&反欺诈 已并入 F4「池/配额/大使/榜」聚合视图)。
 *
 * 本 shell 只持有后端快照 state + OperationConfirmModal;各 tab 视觉/布局拆到 f-tabs/*(复用 design-kit 原语 + f-domain.css 设计类)。
 * 真写落点:F1 走后端 teams/ranks;F2/F3/F4/F5 走后端 teams/{rates|binary|leadership-pool|commissions} + commissions/config。
 * - 调参类(op:"param"):F1 V-Rank 字段、F2 费率/参数、F3 双轨配置、F4 池/配额/大使/榜配置写后端;未知 key 直接失败。
 * - 处置类(op:"dispose"):写入固定状态值(approved/rejected/disqualified/frozen/unlocked …)。
 * - 放大资金流出(amplify):OperationConfirmModal amplifies={true} → B1 兑付覆盖率护栏。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OperationConfirmModal, useToast, useDomainNav } from "./design-kit";
import { fDirectSettledText, fProposalEndText } from "./f-tabs/f-release";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { f4HeadCapAmplifies, f4MoneyAmplifies, f4MonthlyCap } from "@/lib/admin/f4-money";
import { f4WeeklyCronIssue } from "@/lib/admin/f4-settlement-config";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import {
  addF1VRankReward,
  fetchF3BinaryOverview,
  fetchF4LeadershipPoolOverview,
  fetchF4VoteProjection,
  fetchF4AmbassadorPolicy,
  fetchF5CommissionAuditOverview,
  downloadF5RedactedCsv,
  fetchF2RatesOverview,
  fetchF2DirectReferralPolicy,
  fetchF1PromotionLog,
  fetchF1RewardPayouts,
  fetchF1VRankOverview,
  removeF1VRankReward,
  updateF1VRankReward,
  updateF1VRankThreshold,
  type F3BinaryOverview,
  type F4LeadershipPoolOverview,
  type F4AmbassadorPolicy,
  type F5CommissionAuditOverview,
  type F5CommissionQuery,
  type F2RatesOverview,
  type F1Page,
  type F1PayoutFilters,
  type F1PromotionFilters,
  type F1PromotionRecord,
  type F1RewardPayout,
  type F1VRankOverview,
} from "@/lib/admin/f1-client";
import { usePropose } from "@/lib/admin/use-propose";
import { createA2CommandKey, fetchA2Overview, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { type FDomainAttempt, commandAttempts, F2_ACTIVATION_SLOT, F2_POLICY_SLOT, F2_BOOTSTRAP_SLOT, f2PendingFor, f2ProposalRecord, listF2Proposals, queryF2Proposal, releaseF2Proposal, sendF2Proposal, type F2Recovery } from "@/lib/admin/f2-approval";
import { F3_SETTLEMENT_SLOT, f3ConfigSlot, f3PayoutControlSpec, f3PendingFor, listF3Proposals, queryF3Proposal, releaseF3Proposal, sendF3Proposal, settlementSpec, type F3ConfirmationSnapshot } from "@/lib/admin/f3-approval";
import { listF3ConfigWrites, pendingF3ConfigWrite, queryF3ConfigWrite, sendF3ConfigWrite } from "@/lib/admin/f3-config-write";
import { isF3PayoutControlKey, planF3PayoutControl, type F3PayoutControlKey } from "@/lib/admin/f3-policy";
import { listF1Proposals, queryF1Proposal, releaseF1Proposal, sendF1Proposal } from "@/lib/admin/f1-approval";
import { canRetryF4Proposal, F4_POLICY_SLOT, f4PendingFor, f4PolicySpec, listF4Proposals, matchesF4Confirmation, queryF4Proposal, sendF4Proposal, type F4ConfirmationSnapshot } from "@/lib/admin/f4-approval";
import { canRetryF4Policy, listF4PolicyWrites, queryF4Policy, sendF4Policy } from "@/lib/admin/f4-policy-write";
import { f5ConfirmationSlot, listF5Proposals, queryF5Proposal, releaseF5Proposal, sendF5Proposal, type F5ConfirmationSnapshot } from "@/lib/admin/f5-approval";
import { listF5AnomalyWrites, queryF5Anomaly, sendF5Anomaly } from "@/lib/admin/f5-anomaly-write";
import { F1OutcomeUncertainError, isF1OutcomeUncertainError, type FDirectAttempt } from "@/lib/admin/f1-stable-write";
import { fetchBusinessCalendar } from "@/lib/admin/business-calendar-client";
import { listF1PolicyOperations, queryF1PolicyOperation } from "@/lib/admin/f1-policy-change";
import { pendingConfigApproval, submitConfigApproval, teamFundApprovalAuthority, type TeamFundApprovalValues } from "@/lib/admin/withdrawal-config-approval";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { findHighOp, isFFundAmplifyingKey } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { F4VoteProjectionRead } from "@/lib/admin/f4-vote-projection";
import type { Mc, McSpec, FViewCtx } from "./f-tabs/types";
import { F1Vrank } from "./f-tabs/f1-vrank";
import { rewardKind } from "./f-tabs/f1-shared";
import { F1_VOUCHER_REISSUE, F1_VOUCHER_REISSUE_UNAVAILABLE, F1_VOUCHER_REVERSE_CLAWBACK, F1_VOUCHER_REVERSE_KEEP } from "@/lib/admin/config-help/f1-voucher";
import { RdPage } from "@/app/components/rd";
import { F2Page } from "./f-tabs/f2-page";

import { F3Binary } from "./f-tabs/f3-binary";
import { F4Ops } from "./f-tabs/f4-ops";
import { F5Audit } from "./f-tabs/f5-audit";
import { operationConfirmPlainMessage } from "@/lib/admin/operation-confirm-error";
import { directReferralAmplifies, directReferralSummary, validateDirectReferralUpdate, type DirectReferralPolicy } from "@/lib/admin/direct-referral-policy";
import "./f-tabs/f2-design.css";

const FOLD: Record<string, string> = { F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5" };
const ADMIN_OPERATOR = currentAdminOperator;

// 原七层购买奖励与其他参数继续走既有 A2 命令；直属政策使用独立整组命令。
const F_ACTIVE_KEYS = new Set([
  "directRoyaltyPct", "networkRoyaltyPct", "binaryPairRatePct",
  "maxCombinedOutflowPct", "minPayoutUsdt", "rankWindowDays", "hardwareQuotaPerRank",
]);

function resolveFOp(key: string): string {
  if (key.startsWith("F.commission.") && key.endsWith(".status")) return "f_commission_status";
  if (/^F\.unilevel\.(?:nex\.)?L[1-7]$/.test(key)) return "f_unilevel_rule";
  if (key.startsWith("F.unilevel.")
      && !["F.unilevel.depthGate", "F.unilevel.depthGateRank", "F.unilevel.mergeExitMaxPct"].includes(key)
      && !/^F\.unilevel\.L[1-7]\.paused$/.test(key)) throw new Error("这个参数还没用于结算，不能调整。");
  if (F_ACTIVE_KEYS.has(key)) return "f_config";
  return "f_ui_config";
}

function fProposalCommandKey(modalCommandKey: string | undefined, sourceDomain: string, key: string) {
  return modalCommandKey ? `${modalCommandKey}:${sourceDomain}:${key}` : undefined;
}

function errorMessage(error: unknown) {
  // 「结果未知」族(F 直写的 F1OutcomeUncertainError / A2 提案的 A2OutcomeUncertainError)用结果未知的说法；
  // 页面提示没有「技术信息」，命令号不进句子（全站-标识外露），只留在错误对象上。
  if (error instanceof Error && error.name.endsWith("OutcomeUncertainError")) {
    return operationConfirmPlainMessage(error);
  }
  return displayAdminError(error);
}

function f1ThresholdTarget(paramKey?: string) {
  const match = paramKey?.match(/^F\.vrank\.(V\d{1,2})\.([A-Za-z]+)$/);
  return match ? { rank: match[1], field: match[2] } : null;
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
      teamApprovalOwner: spec.teamApproval ? session?.adminId : undefined,
      f4Owner: spec.f4Snapshot ? session?.adminId : undefined,
    });
  const [f1ReadEpoch, setF1ReadEpoch] = useState(0);
  const [f1ApprovalRanks, setF1ApprovalRanks] = useState<string[]>([]);
  const [f1ProposalEpoch, setF1ProposalEpoch] = useState(0);
  const [f1Overview, setF1Overview] = useState<F1VRankOverview | null>(null);
  const [f1Loading, setF1Loading] = useState(tab === "F1");
  const [f1Error, setF1Error] = useState<string | null>(null);
  const [f1Promotions, setF1Promotions] = useState<F1Page<F1PromotionRecord>>({ items: [], total: 0, limit: 100, nextCursor: "" });
  const [f1Payouts, setF1Payouts] = useState<F1Page<F1RewardPayout>>({ items: [], total: 0, limit: 100, nextCursor: "" });
  const [f1PromotionLoading, setF1PromotionLoading] = useState(tab === "F1");
  const [f1PromotionError, setF1PromotionError] = useState<string | null>(null);
  const [f1PayoutLoading, setF1PayoutLoading] = useState(tab === "F1");
  const [f1PayoutError, setF1PayoutError] = useState<string | null>(null);
  const [f2Overview, setF2Overview] = useState<F2RatesOverview | null>(null);
  const [f2DirectPolicy, setF2DirectPolicy] = useState<DirectReferralPolicy | null>(null);
  const [f2DirectPolicyLoading, setF2DirectPolicyLoading] = useState(tab === "F2");
  const [f2DirectPolicyError, setF2DirectPolicyError] = useState<string | null>(null);
  const [f2ApprovalRows, setF2ApprovalRows] = useState<A2OperationRow[]>([]);
  const [f2Proposals, setF2Proposals] = useState<F2Recovery[]>([]);
  const [f2ReadEpoch, setF2ReadEpoch] = useState(0);
  const [f2ActivationPendingLoading, setF2ActivationPendingLoading] = useState(tab === "F2");
  const [f2ActivationPendingError, setF2ActivationPendingError] = useState<string | null>(null);
  const canReadA2 = can("platform_a2_read");
  const canReadF4 = can("network_f4_read");
  const [f2Loading, setF2Loading] = useState(tab === "F2");
  const [f2Error, setF2Error] = useState<string | null>(null);
  const [f3Proposals, setF3Proposals] = useState<FDomainAttempt[]>([]);
  const [f3ApprovalRows, setF3ApprovalRows] = useState<A2OperationRow[]>([]);
  const [f3ConfigWrites, setF3ConfigWrites] = useState<FDirectAttempt[]>([]);
  const [f3ReadEpoch, setF3ReadEpoch] = useState(0);
  const [f3Overview, setF3Overview] = useState<F3BinaryOverview | null>(null);
  const [f3Loading, setF3Loading] = useState(tab === "F3");
  const [f3Error, setF3Error] = useState<string | null>(null);
  const [f4Overview, setF4Overview] = useState<F4LeadershipPoolOverview | null>(null);
  const [f4VoteProjection, setF4VoteProjection] = useState<F4VoteProjectionRead>({ status: "idle" });
  const [f4AmbassadorPolicy, setF4AmbassadorPolicy] = useState<F4AmbassadorPolicy | null>(null);
  const [f4PolicyLoading, setF4PolicyLoading] = useState(false);
  const [f4Loading, setF4Loading] = useState(tab === "F4");
  const [f4Error, setF4Error] = useState<string | null>(null);
  const [f4Proposals, setF4Proposals] = useState<FDomainAttempt[]>([]);
  const [f4PolicyWrites, setF4PolicyWrites] = useState<FDirectAttempt[]>([]);
  // 恢复区每一行最近一次「查询原结果」查到了什么（只给还留着的记录；查到结论的记录清掉，改用轻提示）。
  const [f4QueryNotes, setF4QueryNotes] = useState<Record<string, { tone: "warn" | "danger"; text: string }>>({});
  const [f4ApprovalRows, setF4ApprovalRows] = useState<A2OperationRow[]>([]);
  const f4Submission = useRef<F4ConfirmationSnapshot | undefined>(undefined);
  const [f5Page, setF5Page] = useState<{
    overview: F5CommissionAuditOverview;
    query: F5CommissionQuery;
    nextQuery: F5CommissionQuery | null;
  } | null>(null);
  const [f5Loading, setF5Loading] = useState(tab === "F5");
  const [f5Error, setF5Error] = useState<string | null>(null);
  const [f5Proposals, setF5Proposals] = useState<FDomainAttempt[]>([]);
  const [f5AnomalyWrites, setF5AnomalyWrites] = useState<FDirectAttempt[]>([]);
  const [f5ApprovalRows, setF5ApprovalRows] = useState<A2OperationRow[]>([]);
  const [f5ApprovalReadError, setF5ApprovalReadError] = useState<string | null>(null);
  const [f5ReadEpoch, setF5ReadEpoch] = useState(0);
  const f5Submission = useRef<F5ConfirmationSnapshot | undefined>(undefined);
  const f5Query = useRef<F5CommissionQuery>({});
  const f1Generation = useRef(0);
  const f1PromotionGeneration = useRef(0);
  const f1PayoutGeneration = useRef(0);
  const f2Generation = useRef(0);
  const f3Generation = useRef(0);
  const f4Generation = useRef(0);
  const f5Generation = useRef(0);
  useEffect(() => {
    setTab(routeTab);
  }, [routeTab]);
  useEffect(() => {
    if (tab !== "F1") {
      f1Generation.current += 1;
      f1PromotionGeneration.current += 1;
      f1PayoutGeneration.current += 1;
    }
    if (tab !== "F2") f2Generation.current += 1;
    if (tab !== "F3") f3Generation.current += 1;
    if (tab !== "F4") f4Generation.current += 1;
    if (tab !== "F5") {
      f5Generation.current += 1;
      f5Query.current = {};
    }
  }, [tab]);
  useEffect(() => () => {
    f1Generation.current += 1;
    f1PromotionGeneration.current += 1;
    f1PayoutGeneration.current += 1;
    f2Generation.current += 1;
    f3Generation.current += 1;
    f4Generation.current += 1;
    f5Generation.current += 1;
  }, []);

  const refreshF1 = useCallback(async () => {
    const request = ++f1Generation.current;
    const promotionRequest = ++f1PromotionGeneration.current;
    const payoutRequest = ++f1PayoutGeneration.current;
    setF1Loading(true);
    setF1PromotionLoading(true);
    setF1PayoutLoading(true);
    setF1Error(null);
    setF1PromotionError(null);
    setF1PayoutError(null);
    try {
      const [overview, promotions, payouts] = await Promise.allSettled([
        fetchF1VRankOverview(),
        fetchF1PromotionLog(),
        fetchF1RewardPayouts(),
      ]);
      if (request !== f1Generation.current) return;
      if (overview.status === "fulfilled") setF1Overview(overview.value);
      else {
        setF1Overview(null);
        setF1Error(errorMessage(overview.reason));
      }
      if (promotionRequest === f1PromotionGeneration.current) {
        if (promotions.status === "fulfilled") setF1Promotions(promotions.value);
        else setF1Promotions({ items: [], total: 0, limit: 100, nextCursor: "" });
        if (promotions.status === "rejected") setF1PromotionError(errorMessage(promotions.reason));
      }
      if (payoutRequest === f1PayoutGeneration.current) {
        if (payouts.status === "fulfilled") setF1Payouts(payouts.value);
        else setF1Payouts({ items: [], total: 0, limit: 100, nextCursor: "" });
        if (payouts.status === "rejected") setF1PayoutError(errorMessage(payouts.reason));
      }
    } catch (error) {
      if (request !== f1Generation.current) return;
      setF1Overview(null);
      setF1Error(errorMessage(error));
      if (promotionRequest === f1PromotionGeneration.current) {
        setF1Promotions({ items: [], total: 0, limit: 100, nextCursor: "" });
        setF1PromotionError(errorMessage(error));
      }
      if (payoutRequest === f1PayoutGeneration.current) {
        setF1Payouts({ items: [], total: 0, limit: 100, nextCursor: "" });
        setF1PayoutError(errorMessage(error));
      }
    } finally {
      if (request === f1Generation.current) setF1Loading(false);
      if (promotionRequest === f1PromotionGeneration.current) setF1PromotionLoading(false);
      if (payoutRequest === f1PayoutGeneration.current) setF1PayoutLoading(false);
    }
  }, []);

  const queryF1Promotions = useCallback(async (filters: F1PromotionFilters = {}, append = false) => {
    const request = ++f1PromotionGeneration.current;
    setF1PromotionLoading(true);
    setF1PromotionError(null);
    try {
      const page = await fetchF1PromotionLog(filters);
      if (request !== f1PromotionGeneration.current) return;
      setF1Promotions((current) => append ? { ...page, items: [...current.items, ...page.items] } : page);
    } catch (error) {
      if (request !== f1PromotionGeneration.current) return;
      if (!append) setF1Promotions({ items: [], total: 0, limit: 100, nextCursor: "" });
      setF1PromotionError(errorMessage(error));
    } finally {
      if (request === f1PromotionGeneration.current) setF1PromotionLoading(false);
    }
  }, []);

  const queryF1Payouts = useCallback(async (filters: F1PayoutFilters = {}, append = false) => {
    const request = ++f1PayoutGeneration.current;
    setF1PayoutLoading(true);
    setF1PayoutError(null);
    try {
      const page = await fetchF1RewardPayouts(filters);
      if (request !== f1PayoutGeneration.current) return;
      setF1Payouts((current) => append ? { ...page, items: [...current.items, ...page.items] } : page);
    } catch (error) {
      if (request !== f1PayoutGeneration.current) return;
      if (!append) setF1Payouts({ items: [], total: 0, limit: 100, nextCursor: "" });
      setF1PayoutError(errorMessage(error));
    } finally {
      if (request === f1PayoutGeneration.current) setF1PayoutLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === "F1") void refreshF1();
  }, [refreshF1, tab]);

  const refreshF2 = useCallback(async () => {
    setF2Proposals(session ? listF2Proposals(session.adminId) : []);
    setF2ReadEpoch(value => value + 1);
    const request = ++f2Generation.current;
    setF2Loading(true);
    setF2Error(null);
    setF2DirectPolicyLoading(true);
    setF2DirectPolicyError(null);
    setF2ActivationPendingLoading(true);
    setF2ActivationPendingError(null);
    try {
      const [overview, policy, audit] = await Promise.allSettled([
        fetchF2RatesOverview(), fetchF2DirectReferralPolicy(),
        canReadA2 ? fetchA2Overview({ domain: "F" }, true) : Promise.resolve(null),
      ]);
      if (request !== f2Generation.current) return null;
      if (policy.status === "fulfilled") setF2DirectPolicy(policy.value);
      else { setF2DirectPolicy(null); setF2DirectPolicyError(errorMessage(policy.reason)); }
      if (overview.status === "fulfilled") setF2Overview(overview.value);
      else { setF2Overview(null); setF2Error(errorMessage(overview.reason)); }
      const observed = session ? listF2Proposals(session.adminId).filter(row => row.ticket) : [];
      const receipts = session ? await Promise.allSettled(observed.map(row => queryF2Proposal(session.adminId, row))) : [];
      if (request !== f2Generation.current) return null;
      // Only successful lookups supersede the queue, including authoritative terminal states.
      const observedIds = new Set(observed.filter((_, index) => receipts[index].status === "fulfilled").map(row => row.ticket!.id));
      if (audit.status === "fulfilled" && audit.value) {
        setF2ApprovalRows(audit.value.operationQueue.filter(row => !observedIds.has(row.id)));
        if (audit.value.operationQueueInvalidCount) setF2ActivationPendingError(errorMessage(new Error("F2_APPROVAL_RESPONSE_INVALID")));
      }
      else { setF2ApprovalRows([]); setF2ActivationPendingError(audit.status === "rejected" ? errorMessage(audit.reason) : "审批进度没读到"); }
      if (session) {
        if (receipts.some(row => row.status === "rejected")) setF2ActivationPendingError("审批进度没读到");
        setF2Proposals(listF2Proposals(session.adminId));
      }
      return policy.status === "fulfilled" ? policy.value : null;
    } catch (error) {
      if (request !== f2Generation.current) return null;
      setF2Overview(null);
      setF2Error(errorMessage(error));
      return null;
    } finally {
      if (request === f2Generation.current) { setF2Loading(false); setF2DirectPolicyLoading(false); setF2ActivationPendingLoading(false); }
    }
  }, [canReadA2, session?.adminId]);

  useEffect(() => {
    if (tab === "F2") void refreshF2();
  }, [refreshF2, tab]);

  const refreshF3 = useCallback(async () => {
    const request = ++f3Generation.current;
    const owner = useAdminAuth.getState().session?.adminId;
    setF3Loading(true);
    setF3Error(null);
    const originals = owner === undefined ? [] : listF3Proposals(owner);
    setF3Proposals(originals);
    setF3ConfigWrites(owner === undefined ? [] : listF3ConfigWrites(owner));
    const [overview, queue, ...lookups] = await Promise.allSettled([
      fetchF3BinaryOverview(),
      canReadA2 ? fetchA2Overview() : Promise.resolve(null),
      ...originals.map(row => queryF3Proposal(owner!, row)),
    ]);
    if (request !== f3Generation.current || owner !== useAdminAuth.getState().session?.adminId) return;
    if (overview.status === "fulfilled") setF3Overview(overview.value as F3BinaryOverview);
    else { setF3Overview(null); setF3Error(errorMessage(overview.reason)); }
    const audit = queue.status === "fulfilled" ? queue.value as Awaited<ReturnType<typeof fetchA2Overview>> | null : null;
    setF3ApprovalRows([...(audit?.operationQueue ?? []), ...lookups.flatMap(row => row.status === "fulfilled" && row.value ? [row.value as A2OperationRow] : [])]);
    if (owner !== undefined) setF3Proposals(listF3Proposals(owner));
    setF3Loading(false);
  }, [canReadA2, session?.adminId]);

  useEffect(() => {
    if (tab === "F3") void refreshF3();
  }, [refreshF3, tab]);

  const recoverF3 = async (original: FDomainAttempt, mode: "query" | "retry" | "release" = "query") => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    setF3Overview(null); setF3Loading(true); setF3ReadEpoch(value => value + 1);
    try {
      const ticket = mode === "release" ? (await releaseF3Proposal(owner, original), null)
        : mode === "retry" ? await sendF3Proposal(owner, original.fingerprint)
        : await queryF3Proposal(owner, original);
      if (ticket) {
        setToast(ticket.status === "pending" ? "已提交，等待审批后执行" : "原申请已处理，请刷新后核对。");
        setActionConfirm(null);
      }
      return ticket;
    } finally {
      if (owner === useAdminAuth.getState().session?.adminId) {
        const retained = listF3Proposals(owner);
        setF3Proposals(retained);
        if (!retained.some(row => row.commandKey === original.commandKey)) {
          setActionConfirm(current => current?.teamApproval?.source === "F3" ? null : current);
        }
        await refreshF3();
      }
    }
  };

  const sendF3 = async (slot: string, spec: ProposeSpec, snapshot?: F3ConfirmationSnapshot) => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!f3Overview || f3Loading || f3Error) throw new Error("团队平衡奖励读取失败，请重新读取后再操作。");
    try {
      const ticket = await sendF3Proposal(owner, slot, spec, snapshot);
      setF3ApprovalRows(rows => [...rows, ticket]);
      setToast("已提交，等待审批后执行");
      return ticket;
    } finally { setF3Proposals(listF3Proposals(owner)); }
  };

  const getF3PayoutControlPending = (key: F3PayoutControlKey) => {
    const originalProposal = f3Proposals.find(row => row.fingerprint === f3ConfigSlot(key));
    return {
      approval: f3PendingFor(f3ApprovalRows, key) ?? f3PendingFor(originalProposal?.ticket ? [originalProposal.ticket] : [], key),
      originalProposal,
      directWrite: f3ConfigWrites.find(row => row.adminId === session?.adminId && row.f3Request?.key === key),
    };
  };

  const submitF3PayoutControl = async (key: F3PayoutControlKey, value: string, reason: string, snapshot?: F3ConfirmationSnapshot) => {
    const current = useAdminAuth.getState().session;
    if (!current || current.adminId !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!f3Overview || f3Loading || f3Error) throw new Error("F3_CONFIG_READ_UNAVAILABLE");
    const plan = planF3PayoutControl(key, value, snapshot?.config ?? f3Overview.config);
    if (!current.authorities.includes(plan.authority)) throw new Error("ADMIN_PERMISSION_DENIED");
    if (plan.direction === "unchanged") return { kind: "unchanged" } as const;
    const pending = getF3PayoutControlPending(key);
    const directWrite = pendingF3ConfigWrite(current.adminId, key);
    if (directWrite) throw new F1OutcomeUncertainError(displayAdminError("F1_REQUEST_OUTCOME_UNKNOWN"), directWrite.commandKey);
    if (plan.direction === "proposal") {
      if (pending.approval) throw new Error("OBJECT_ALREADY_PENDING");
      const ticket = await sendF3(f3ConfigSlot(key), f3PayoutControlSpec(key, plan.before, plan.value, reason), snapshot);
      return { kind: "proposal", ticket } as const;
    }
    try {
      const updated = await sendF3ConfigWrite(current.adminId, key, { value: plan.value, reason });
      if (current.adminId === useAdminAuth.getState().session?.adminId) await refreshF3();
      return { kind: "direct", updated } as const;
    } finally {
      if (current.adminId === useAdminAuth.getState().session?.adminId) setF3ConfigWrites(listF3ConfigWrites(current.adminId));
    }
  };

  const recoverF3PayoutControl = async (key: F3PayoutControlKey, mode: "query" | "retry") => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    try {
      return mode === "query" ? { kind: "query", ...await queryF3ConfigWrite(owner, key) } as const
        : { kind: "retry", updated: await sendF3ConfigWrite(owner, key) } as const;
    } finally {
      if (owner === useAdminAuth.getState().session?.adminId) await refreshF3();
    }
  };

  const refreshF4VoteProjection = useCallback(async () => {
    const request = f4Generation.current;
    const owner = useAdminAuth.getState().session?.adminId;
    setF4VoteProjection(canReadF4 ? { status: "loading" } : { status: "denied" });
    if (!canReadF4) return;
    try {
      const data = await fetchF4VoteProjection();
      if (request === f4Generation.current && owner === useAdminAuth.getState().session?.adminId) setF4VoteProjection({ status: "ready", data });
    } catch (error) {
      if (request === f4Generation.current && owner === useAdminAuth.getState().session?.adminId) setF4VoteProjection(
        (error as { status?: number } | null)?.status === 403 ? { status: "denied" } : { status: "error", message: errorMessage(error) });
    }
  }, [canReadF4]);

  const readF4AmbassadorPolicy = useCallback(async () => {
    const request = f4Generation.current;
    const owner = useAdminAuth.getState().session?.adminId;
    const current = () => request === f4Generation.current && owner === useAdminAuth.getState().session?.adminId;
    setF4PolicyLoading(true);
    try {
      const policy = await fetchF4AmbassadorPolicy();
      if (current()) setF4AmbassadorPolicy(policy);
      return policy;
    } catch (error) {
      if (current()) setF4AmbassadorPolicy(null);
      throw error;
    } finally {
      if (current()) setF4PolicyLoading(false);
    }
  }, []);

  const refreshF4 = useCallback(async () => {
    const request = ++f4Generation.current;
    const owner = useAdminAuth.getState().session?.adminId;
    const originals = owner === undefined ? [] : listF4Proposals(owner);
    setF4Proposals(originals);
    setF4PolicyWrites(owner === undefined ? [] : listF4PolicyWrites(owner));
    setF4Loading(true);
    setF4Error(null);
    void refreshF4VoteProjection();
    setActionConfirm(current => current?.f4Snapshot && !current.f4Recovery ? null : current);
    const [overview, , calendar, queue, ...lookups] = await Promise.allSettled([
      fetchF4LeadershipPoolOverview(),
      readF4AmbassadorPolicy(),
      fetchBusinessCalendar(),
      canReadA2 ? fetchA2Overview() : Promise.resolve(null),
      ...originals.map(row => queryF4Proposal(owner!, row)),
    ]);
    if (request !== f4Generation.current || owner !== useAdminAuth.getState().session?.adminId) return;
    if (overview.status === "fulfilled") {
      const zoneId = calendar.status === "fulfilled" ? calendar.value.trackZones.GROWTH_TEAM : undefined;
      const label = zoneId === "Asia/Shanghai" ? "北京时间" : calendar.status === "fulfilled" ? calendar.value.options.find(option => option.zoneId === zoneId)?.label : undefined;
      const offset = zoneId ? new Intl.DateTimeFormat("en-US", { timeZone: zoneId, timeZoneName: "shortOffset" }).formatToParts(new Date()).find(part => part.type === "timeZoneName")?.value : undefined;
      setF4Overview({ ...overview.value, settlementZone: zoneId && label && offset ? { zoneId, label, offset: offset === "GMT" ? "UTC+0" : offset.replace("GMT", "UTC") } : null });
    }
    else { setF4Overview(null); setF4Error(displayAdminReadError(overview.reason)); }
    const audit = queue.status === "fulfilled" ? queue.value as Awaited<ReturnType<typeof fetchA2Overview>> | null : null;
    setF4ApprovalRows([...(audit?.operationQueue ?? []), ...lookups.flatMap(row => row.status === "fulfilled" && row.value ? [row.value as A2OperationRow] : [])]);
    if (owner !== undefined) {
      const proposals = listF4Proposals(owner), direct = listF4PolicyWrites(owner);
      setF4Proposals(proposals);
      setActionConfirm(current => current?.f4Recovery && ![...proposals, ...direct].some(row => row.commandKey === current.f4Recovery!.original.commandKey) ? null : current);
    }
    setF4Loading(false);
  }, [canReadA2, readF4AmbassadorPolicy, refreshF4VoteProjection, session?.adminId]);

  useEffect(() => {
    if (tab === "F4") void refreshF4();
  }, [refreshF4, tab]);

  const recoverF4: FViewCtx["recoverF4"] = async (record, mode) => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    const original = record.kind === "proposal" ? listF4Proposals(owner).find(row => row.commandKey === record.original.commandKey)
      : listF4PolicyWrites(owner).find(row => row.commandKey === record.original.commandKey);
    if (!original) { setActionConfirm(null); return true; }
    f4Generation.current += 1;
    setF4Overview(null); setF4AmbassadorPolicy(null); setF4Loading(true);
    setF4VoteProjection({ status: "idle" });
    setActionConfirm(current => current?.f4Snapshot && !current.f4Recovery ? null : current);
    let resolved = false;
    const note = (value?: { tone: "warn" | "danger"; text: string }) => setF4QueryNotes(({ [original.commandKey]: _, ...rest }) => value ? { ...rest, [original.commandKey]: value } : rest);
    note();
    try {
      if (record.kind === "policy") {
        if (mode === "retry") { await sendF4Policy(owner); resolved = true; }
        else {
          const result = await queryF4Policy(owner, original as FDirectAttempt);
          resolved = result.settled;
          if (resolved) setToast(fDirectSettledText(result.receipt!.originalStatus));
          else note({ tone: "warn", text: isRetryExpired(original) ? "这次没查到结论，结果仍未知；已过 24 小时，到操作记录与审批核对。" : "这次没查到结论，结果仍未知；可以稍后再查。" });
        }
      } else {
        const ticket = mode === "retry" ? await sendF4Proposal(owner, original.fingerprint) : await queryF4Proposal(owner, original);
        resolved = !!ticket;
        if (mode === "query") {
          if (!ticket) note({ tone: "warn", text: isRetryExpired(original) ? RETRY_EXPIRED_TEXT : "没查到原审批单，可以稍后再查。" });
          else if (ticket.status === "pending") note({ tone: "warn", text: "审批单已建，在等批准；批准前不生效。" });
          else setToast(fProposalEndText(ticket.status));
        } else if (ticket) setToast(ticket.status === "pending" ? "已提交，等待审批后执行" : fProposalEndText(ticket.status));
      }
      return record.kind === "policy" && mode === "query" || resolved;
    } catch (error) {
      // 查询失败的原因写在恢复区这一行；确认框里的查询照旧由框自己显示。
      if (mode === "query") note({ tone: "danger", text: `查询没有成功：${displayAdminError(error)}` });
      throw error;
    } finally {
      const retained = record.kind === "proposal" ? listF4Proposals(owner) : listF4PolicyWrites(owner);
      if (resolved || !retained.some(row => row.commandKey === original.commandKey)) setActionConfirm(null);
      await refreshF4();
    }
  };

  const sendF4 = async (slot: string, spec: ProposeSpec) => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!f4Overview || f4Loading || f4Error) throw new Error("奖励池、名额与排行榜加载失败，请刷新后再操作。");
    if (await f4PendingFor(f4ApprovalRows, spec)) throw new Error("OBJECT_ALREADY_PENDING");
    try {
      const ticket = await sendF4Proposal(owner, slot, spec, f4Submission.current ?? mc?.f4Snapshot);
      setF4ApprovalRows(rows => [...rows, ticket]);
      setToast("已提交，等待审批后执行");
    } finally {
      const records = listF4Proposals(owner);
      setF4Proposals(records);
      const original = records.find(row => row.fingerprint === (slot === F4_POLICY_SLOT ? `${owner}:F4` : slot));
      if (original && !original.ticket) setActionConfirm(current => current?.f4Snapshot
        ? { ...current, f4Snapshot: original.f4Snapshot ?? current.f4Snapshot, f4Recovery: { kind: "proposal", original } } : current);
    }
  };

  const refreshF5 = useCallback(async (query: F5CommissionQuery = f5Query.current) => {
    const request = ++f5Generation.current;
    const owner = useAdminAuth.getState().session?.adminId;
    f5Query.current = query;
    const originals = owner === undefined ? [] : listF5Proposals(owner);
    setF5Proposals(originals);
    setF5AnomalyWrites(owner === undefined ? [] : listF5AnomalyWrites(owner));
    setF5Loading(true);
    setF5Error(null);
    const [overview, queue, ...lookups] = await Promise.allSettled([
      fetchF5CommissionAuditOverview(query),
      canReadA2 ? fetchA2Overview({ domain: "F" }, true) : Promise.resolve(null),
      ...originals.map(row => queryF5Proposal(owner!, row)),
    ]);
    if (request !== f5Generation.current || owner !== useAdminAuth.getState().session?.adminId) return;
    if (overview.status === "fulfilled") setF5Page({ overview: overview.value, query,
      nextQuery: overview.value.nextCursor ? { ...query, cursor: overview.value.nextCursor } : null });
    else { setF5Page(null); setF5Error(errorMessage(overview.reason)); }
    const audit = queue.status === "fulfilled" ? queue.value as Awaited<ReturnType<typeof fetchA2Overview>> | null : null;
    setF5ApprovalRows([...(audit?.operationQueue ?? []), ...lookups.flatMap(row => row.status === "fulfilled" && row.value ? [row.value as A2OperationRow] : [])]);
    setF5ApprovalReadError(queue.status === "rejected" ? errorMessage(queue.reason)
      : audit?.operationQueueInvalidCount ? errorMessage(new Error("F2_APPROVAL_RESPONSE_INVALID")) : null);
    if (owner !== undefined) {
      setF5Proposals(listF5Proposals(owner));
      setF5AnomalyWrites(listF5AnomalyWrites(owner));
    }
    setF5ReadEpoch(epoch => epoch + 1);
    setF5Loading(false);
  }, [canReadA2, session?.adminId]);

  const recoverF5: FViewCtx["recoverF5"] = async (record, mode) => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    const original = (record.kind === "proposal" ? listF5Proposals(owner) : listF5AnomalyWrites(owner)).find(row => row.commandKey === record.original.commandKey);
    if (!original) return true;
    f5Generation.current += 1;
    setF5Page(null); setF5Loading(true);
    try {
      if (record.kind === "anomaly") {
        if (mode === "release") throw new Error("直接保存的原操作只能核对，不能解除记录。");
        if (mode === "retry") await sendF5Anomaly(owner);
        else {
          const result = await queryF5Anomaly(owner, original as FDirectAttempt);
          if (result.settled) {
            setToast(result.receipt!.originalStatus === "CONFIRMED_REJECTED" ? displayAdminError("IDEMPOTENCY_INVESTIGATION_CONFIRMED_REJECTED")
              : result.receipt!.originalStatus === "CONFIRMED_NOT_EXECUTED" ? displayAdminError("IDEMPOTENCY_INVESTIGATION_CONFIRMED_NOT_EXECUTED")
                : result.receipt!.originalStatus === "CONFIRMED_SUCCEEDED" ? "核查确认已执行，记录已解除，不要再做一次。"
                  : "原操作已执行，记录已解除，不要再做一次。");
            return true;
          }
          const current = result.current;
          setToast(`当前金额偏离 ${current.configValues.commissionAnomalySigma}、层比例偏离 ${current.configValues.layerRatioAnomalyPct}%；只供核对，原操作结果仍未知。`);
          return false;
        }
        return true;
      }
      const ticket = mode === "release" ? (await releaseF5Proposal(owner, original), null)
        : mode === "retry" ? await sendF5Proposal(owner, original.fingerprint) : await queryF5Proposal(owner, original);
      if (ticket) setToast(ticket.status === "pending" ? "已提交，等待审批后执行" : "原申请已处理，请核对奖励记录。");
      else if (mode === "query") setToast("没有查到原审批单，不能据此认定没有提交。");
      return mode === "release" || !!ticket;
    } finally { await refreshF5(); }
  };

  const sendF5 = async (slot: string, spec: ProposeSpec) => {
    const owner = useAdminAuth.getState().session?.adminId;
    if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    if (!f5Page || f5Loading || f5Error) throw new Error("F5_CURRENT_DATA_REQUIRED");
    const pending = f5ApprovalRows.filter(row => row.status === "pending").some(row => {
      const obj = row.operationCode === "f_commission_status" ? row.obj.match(/^F\.commission\.(CM-\d+)\.status$/)?.[1] : row.obj;
      return spec.command.op === "f5_commission_suspension" ? row.operationCode === spec.command.op && row.obj === spec.obj
        : spec.command.op === "f5_commission_reissue" ? String(obj).split(",").some(id => (spec.command.params.commissionIds as string[]).includes(id))
          : String(obj).split(",").includes(spec.target?.id ?? "");
    });
    if (pending) throw new Error("OBJECT_ALREADY_PENDING");
    try {
      const ticket = await sendF5Proposal(owner, slot, spec, f5Submission.current);
      setF5ApprovalRows(rows => [...rows.filter(row => row.id !== ticket.id), ticket]);
    } finally { setF5Proposals(listF5Proposals(owner)); }
  };

  useEffect(() => {
    if (tab === "F5") void refreshF5();
  }, [refreshF5, tab]);

  const f2Tickets = [...f2ApprovalRows, ...f2Proposals.flatMap(row => row.ticket ? [row.ticket] : [])];
  const f2Pending = (key: string) => f2PendingFor(f2Tickets, key);
  const f2Record = (slot: string) => session ? f2ProposalRecord(session.adminId, slot) : undefined;
  const f2WriteBlocked = (slot: string): string | undefined => {
    if (slot !== F2_ACTIVATION_SLOT && (f2Loading || f2Error || !f2Overview)) return "七层比例没读到，这部分没有判断";
    // An empty active read is only a candidate: the server also checks hidden historical rows.
    if ([F2_ACTIVATION_SLOT, F2_POLICY_SLOT, F2_BOOTSTRAP_SLOT, "f-config:F.unilevel.nex.L1"].includes(slot)
        && (f2DirectPolicyLoading || f2DirectPolicyError || !f2DirectPolicy)) return "好友奖励政策没读到，暂不能改";
    if (slot === F2_BOOTSTRAP_SLOT && f2Overview?.unilevel.length) return displayAdminError("F2_UNILEVEL_RULES_ALREADY_CONFIGURED");
    if (slot === "f-config-batch:F2") {
      const issue = fBatchIssueText(Array.from({ length: 7 }, (_, i) => `F.unilevel.L${i + 1}.paused`), session?.authorities ?? []);
      if (issue) return issue;
    }
    const key = slot.startsWith("f-config:") ? slot.slice(9) : slot;
    if (f2Pending(key)) return "等另一位管理员批准";
    const layer = key.match(/^F\.unilevel\.(?:nex\.)?(L[1-7])$/)?.[1];
    if (f2Proposals.some(row => !row.ticket && (row.fingerprint === slot || layer && row.spec.target?.type === "unilevel_rule" && row.spec.target.id === layer))) return "上一次申请结果未知，先按原请求重试或去核对";
    return undefined;
  };
  const markF2Loading = () => {
    setF2Loading(true); setF2DirectPolicyLoading(true); setF2ActivationPendingLoading(true);
  };
  const sendF2 = async (slot: string, spec?: ProposeSpec) => {
    if (!session) throw new Error("ADMIN_PERMISSION_DENIED");
    if (spec) {
      const blocked = f2WriteBlocked(slot);
      if (blocked) throw new Error(blocked);
    } else {
      // Recovery invalidates all open new-edit snapshots, even when the lookup fails.
      setF2ReadEpoch(value => value + 1);
      markF2Loading();
      setF2Overview(null);
      setF2DirectPolicy(null);
      setF2ApprovalRows([]);
    }
    try {
      const ticket = await sendF2Proposal(session.adminId, slot, spec);
      setToast(ticket.status === "pending" ? "已提交，等待审批后执行" : "原申请已处理，请刷新后核对。");
    } finally {
      if (!spec) await refreshF2();
      setF2Proposals(listF2Proposals(session.adminId));
    }
  };

  const refreshF1Approvals = useCallback(async () => {
    const current = useAdminAuth.getState().session;
    if (!current) return;
    const policy = listF1PolicyOperations(current.adminId).filter(row => row.original.approval);
    const results = await Promise.allSettled([
      ...(current.authorities.includes("platform_a2_read") ? [fetchA2Overview({}, true)] : []),
      ...policy.map(row => queryF1PolicyOperation(current.adminId, row.commandKey)),
      ...listF1Proposals(current.adminId).filter(row => row.spec).map(row => queryF1Proposal(current.adminId, row)),
    ]);
    if (useAdminAuth.getState().session?.adminId !== current.adminId) return;
    const queue = results.flatMap(result => result.status === "fulfilled" && result.value && "operationQueue" in result.value ? result.value.operationQueue : []);
    const owned = listF1PolicyOperations(current.adminId).flatMap(row => row.ticket ? [row.ticket] : []);
    setF1ApprovalRanks([...new Set([...queue, ...owned].filter(row => row.status === "pending" && row.operationCode === "f1_rank_policy_change" && /^V[0-8]$/.test(row.obj)).map(row => row.obj))]);
    setF1ProposalEpoch(value => value + 1);
  }, []);
  useEffect(() => { if (tab === "F1") void refreshF1Approvals(); }, [tab, session?.adminId, refreshF1Approvals]);

  const recoverF1 = async (slot: string, mode: "query" | "retry" | "release") => {
    const current = useAdminAuth.getState().session;
    const original = current && listF1Proposals(current.adminId).find(row => row.fingerprint === slot);
    if (!current || !original) throw new Error("原操作已处理，请重新读取后再操作。");
    f1Generation.current += 1;
    setF1Overview(null);
    setF1Loading(true);
    let resolved = false;
    try {
      if (mode === "release") {
        await releaseF1Proposal(current.adminId, original);
        resolved = true;
      } else {
        const ticket = mode === "query" ? await queryF1Proposal(current.adminId, original) : await sendF1Proposal(current.adminId, slot);
        resolved = !!ticket;
        if (ticket) setToast(ticket.status === "pending" ? "已提交，等待审批后执行" : "原申请已处理，请刷新后核对。");
      }
      return resolved;
    } finally {
      if (resolved || !listF1Proposals(current.adminId).some(row => row.commandKey === original.commandKey)) setF1ReadEpoch(value => value + 1);
      await refreshF1();
      await refreshF1Approvals();
    }
  };

  // F 域既有命令在此按槽位保号；F2 启停另用同一共享存储保留完整原申请，供显式恢复。
  const proposeStable = async (slot: string, inputFingerprint: string, spec: ProposeSpec, snapshot?: F3ConfirmationSnapshot) => {
    if (spec.sourceDomain === "F3") { await sendF3(slot, spec, snapshot); return; }
    if (spec.sourceDomain === "F2") return sendF2(slot, spec);
    if (spec.sourceDomain === "F4") return sendF4(slot, spec);
    if (spec.sourceDomain === "F5") return sendF5(slot, spec);
    if (spec.sourceDomain === "F1") {
      const current = useAdminAuth.getState().session;
      if (!current || current.adminId !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
      if (!f1Overview || f1Loading || f1Error || slot === "f-vrank-bootstrap:current" && f1Overview.rows.length !== 0) throw new Error("会员等级读取失败，请重新读取后再操作。");
      try {
        await sendF1Proposal(current.adminId, slot, spec);
        setToast("已提交，等待审批后执行");
      } finally { setF1ProposalEpoch(value => value + 1); }
      return;
    }
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
  const proposeFConfig = async (sourceDomain: string, key: string, value: string, reason: string, expectedVersion?: number, amplifies?: boolean, expectedMaterialRevision?: number, snapshot?: F3ConfirmationSnapshot) => {
    if (key === "F.unilevel.nex.L1") {
      const current = await fetchF2DirectReferralPolicy();
      setF2DirectPolicy(current);
      if (current.sevenLayerEnabled && current.purchaseSplit.enabled) throw new Error("DIRECT_REFERRAL_L1_NEX_READONLY");
    }
    const op = resolveFOp(key);
    const def = findHighOp(op);
    if (!def) throw new Error(`F_OP_NOT_FOUND:${op}`);
    const ambassadorId = key.match(/^F\.ambassador\.(\d+)\.status$/)?.[1];
    if (ambassadorId && value === "approved" && expectedMaterialRevision === undefined) throw new Error("缺少材料版本，请重新打开申请核对后提交。");
    const usdtLevel = key.match(/^F\.unilevel\.(L[2-7])$/)?.[1];
    const currentUsdt = usdtLevel ? f2Overview?.unilevel.find((row) => row.l === usdtLevel)?.usdtText : undefined;
    // F2 548c8078 always parses percentage points. Keep '%' for older percentRatio
    // backends too; both persist the same ratio without changing the entered text.
    const commandValue = usdtLevel ? `${value}%` : value;
    const nexLevel = key.match(/^F\.unilevel\.nex\.(L[1-7])$/)?.[1];
    const beforeF2 = nexLevel ? f2Overview?.unilevel.find(row => row.l === nexLevel)?.nexText
      : f2Overview?.configValues[key];
    const f4Snapshot = f4Submission.current ?? mc?.f4Snapshot;
    const beforeF4Overview = f4Snapshot?.overview ?? f4Overview;
    let beforeF4: string | undefined;
    if (sourceDomain === "F4" && beforeF4Overview) {
      const stored = beforeF4Overview.configValues[key];
      if (stored?.trim()) beforeF4 = stored;
      else if (key === "F.pool.top1MaxPct") beforeF4 = "未设置（按 25%）";
      else if (key === "F.pool.top5MaxPct") beforeF4 = "未设置（按 60%）";
      else if (mc?.paramKey === key && mc.edit) beforeF4 = mc.edit.current || "未配置";
      else if (key === "F.pool.periodPrize" && mc?.businessForm?.kind === "multi-field") {
        beforeF4 = JSON.stringify(Object.fromEntries(mc.businessForm.fields.map(field => [field.key, field.current ?? "—"])));
      } else if (ambassadorId) beforeF4 = f4Snapshot?.application?.status;
      else if (key.startsWith("F.quota.usage.")) beforeF4 = beforeF4Overview.quotaUsages.find(row => key === `F.quota.usage.${row.id}.status`)?.status;
      else if (key === "F.leaderboard.paused") beforeF4 = beforeF4Overview.leaderboardPaused === undefined ? undefined : beforeF4Overview.leaderboardPaused ? "on" : "off";
    }
    // Match dd6c94ea: USDT compares percentage points; UVT compares coefficients.
    const rateAmplifies = usdtLevel && currentUsdt != null ? Number(value) > Number(currentUsdt)
      : nexLevel && beforeF2 != null ? Number(value) > Number(beforeF2) : undefined;
    await proposeStable(`f-config:${key}`, JSON.stringify(expectedMaterialRevision === undefined ? [commandValue, reason] : [commandValue, reason, expectedMaterialRevision]), {
      action: ambassadorId ? `${value === "approved" ? "批准" : "驳回"}大使申请 #${ambassadorId}` : `${def.action} · ${key}`,
      obj: ambassadorId ?? key,
      before: sourceDomain === "F4" ? beforeF4 ?? "—" : usdtLevel ? currentUsdt != null ? `${currentUsdt}%` : "—" : sourceDomain === "F2" && beforeF2 != null && beforeF2 !== "__UNCONFIGURED__" ? String(beforeF2) : "—",
      after: commandValue,
      type: op === "f_unilevel_rule" && rateAmplifies !== undefined ? rateAmplifies ? "fund" : "param"
        : ambassadorId && value === "approved" ? "fund" : def.type === "fund" ? "fund" : "param",
      // The server derives the final direction again when it creates the ticket.
      amplifies: ambassadorId ? value === "approved" : rateAmplifies ?? amplifies ?? (isFFundAmplifyingKey(key) || def.amplifies),
      gate: { roles: [] },
      gateLabel: def.gateLabel,
      reason,
      sourceDomain,
      commandKey: fProposalCommandKey(mc?.commandKey, sourceDomain, key),
      command: def.buildCommand({ key, value: commandValue, expectedVersion, expectedMaterialRevision }),
      target: def.buildTarget({ key, value: commandValue, expectedVersion }),
    }, snapshot);
  };

  const updateFConfigBatch = async (
    sourceDomain: "F2" | "F3" | "F4",
    changes: Array<{ key: string; value: string }>,
    reason: string,
    snapshot?: F3ConfirmationSnapshot,
  ) => {
    const normalized = changes.map((item) => ({ key: item.key.trim(), value: item.value.trim() }))
      .filter((item) => item.key && item.value);
    if (!normalized.length) throw new Error("F_CONFIG_BATCH_EMPTY");
    const current = useAdminAuth.getState().session;
    if (!current || current.adminId !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
    const issue = fBatchIssueText(normalized.map(item => item.key), current.authorities);
    if (issue) throw new Error(issue);
    const def = findHighOp("f_config_batch");
    if (!def) throw new Error("F_OP_NOT_FOUND:f_config_batch");
    await proposeStable(`f-config-batch:${sourceDomain}`, JSON.stringify([normalized, reason]), {
      action: `${def.action} · ${normalized.length} 项`,
      obj: normalized.map((item) => item.key).join(","),
      before: sourceDomain === "F2" ? normalized.map(item => `${item.key}=${f2Overview?.configValues[item.key] ?? "—"}`).join(" / ")
        : sourceDomain === "F4" ? normalized.map(item => `${item.key}=${(f4Submission.current?.overview ?? f4Overview)?.configValues[item.key] ?? "—"}`).join(" / ") : "当前设置",
      after: normalized.map((item) => `${item.key}=${item.value}`).join(" / "),
      type: "fund",
      amplifies: normalized.some((item) => sourceDomain === "F4" && (item.key === "F.pool.monthlyCap" || item.key === "F.leaderboard.poolUsd")
        ? f4MoneyAmplifies(item.key, (f4Submission.current?.overview ?? f4Overview)!.configValues, item.value) : isFFundAmplifyingKey(item.key)),
      gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain,
      command: def.buildCommand({ changes: normalized, sourceDomain }),
      targets: def.buildTargets?.({ changes: normalized, sourceDomain }),
    }, snapshot);
  };

  const teamApproval = mc?.teamApproval;
  const f4ModalRecord: McSpec["f4Recovery"] = mc?.f4Recovery ?? (mc?.f4Snapshot
    ? (() => {
      const proposal = f4Proposals.find(row => matchesF4Confirmation(row, mc.f4Snapshot!));
      const policy = f4PolicyWrites.find(row => matchesF4Confirmation(row, mc.f4Snapshot!));
      return proposal ? { kind: "proposal" as const, original: proposal } : policy ? { kind: "policy" as const, original: policy } : undefined;
    })() : undefined);
  const f4PendingOriginal = () => {
    if (!session || !mc?.f4Snapshot) return undefined;
    return [...listF4Proposals(session.adminId), ...listF4PolicyWrites(session.adminId)]
      .find(row => row.commandKey === f4ModalRecord?.original.commandKey || matchesF4Confirmation(row, mc.f4Snapshot!));
  };
  const f4PendingReason = () => {
    const original = f4PendingOriginal();
    return original && ("f4Request" in original ? original.f4Request?.reason : (original as FDomainAttempt).spec?.reason);
  };
  useEffect(() => {
    setActionConfirm(current => current?.f4Snapshot && current.f4Owner !== session?.adminId ? null : current);
  }, [session?.adminId]);
  const canSubmitTeamApproval = (source: keyof TeamFundApprovalValues) =>
    session?.authorities.includes(teamFundApprovalAuthority[source]) ?? false;
  const f3FundPending = f3Proposals.find(row => row.spec?.command.op === "f3_binary_settle");
  const pendingTeamApproval = teamApproval && session && mc.teamApprovalOwner === session.adminId
    ? teamApproval.source === "F3" ? f3FundPending : pendingConfigApproval(teamApproval.source, session.adminId)
    : undefined;
  const requireTeamApprovalSession = (source: keyof TeamFundApprovalValues, owner = session?.adminId) => {
    const current = useAdminAuth.getState().session;
    if (!current || current.adminId !== owner || !current.authorities.includes(teamFundApprovalAuthority[source])) {
      throw new Error("当前账号没有这项操作的权限，请关闭弹窗后重新核对。");
    }
    return current;
  };
  const submitTeamApproval = async <S extends keyof TeamFundApprovalValues>(
    source: S, values: TeamFundApprovalValues[S] | null, reason: string,
    mode: boolean | "retry-original" = false, owner = session?.adminId,
  ) => {
    if (source === "F4") {
      const current = useAdminAuth.getState().session;
      if (!current || current.adminId !== owner) throw new Error("ADMIN_PERMISSION_DENIED");
      if (mode) {
        const original = listF4Proposals(current.adminId).find(row => row.spec?.command.op === "f4_ambassador_policy_change");
        return original ? recoverF4({ kind: "proposal", original }, mode === "retry-original" ? "retry" : "query") : false;
      }
      requireTeamApprovalSession(source, owner);
      if (!values) throw new Error("请填写完整后提交。");
      await sendF4(F4_POLICY_SLOT, f4PolicySpec(values as TeamFundApprovalValues["F4"], reason));
      setActionConfirm(null);
      return true;
    }
    if (source === "F3") {
      if (mode) {
        if (!f3FundPending) return false;
        return !!await recoverF3(f3FundPending, mode === "retry-original" ? "retry" : "query");
      }
      requireTeamApprovalSession(source, owner);
      if (!values) throw new Error("请填写完整后提交。");
      await sendF3(F3_SETTLEMENT_SLOT, settlementSpec(values as TeamFundApprovalValues["F3"], reason), mc?.f3Snapshot);
      setActionConfirm(null);
      return true;
    }
    const current = requireTeamApprovalSession(source, owner);
    const result = await submitConfigApproval(source, current, values, reason, source === "F3" ? refreshF3 : refreshF4, mode);
    if (!result) return false;
    setToast(result.acknowledgement);
    setActionConfirm(null);
    return true;
  };

  const ctx: FViewCtx = {
    canSubmitTeamApproval,
    submitTeamApproval,
    openActionConfirm: (m) => {
      if (m.f4Snapshot && !m.f4Recovery) {
        if (!f4Overview || f4Loading || f4Error) { setToast("奖励池、名额与排行榜加载失败，请刷新后再操作。"); return; }
        if ([...f4Proposals, ...f4PolicyWrites].some(row => matchesF4Confirmation(row, m.f4Snapshot!))) {
          setToast("请先查询保存的原操作。"); return;
        }
      }
      openActionConfirm(m);
    },
    nav,
    toast: (msg) => setToast(msg),
    can: tab === "F4" ? authority => session?.authorities.includes(authority) ?? false : can,
    vrankRows: f1Overview?.rows ?? [],
    leadership: f1Overview?.leadership ?? null,
    f1Loading,
    f1Error,
    f1ReadEpoch,
    f1ApprovalRanks,
    f1Proposals: session ? listF1Proposals(session.adminId) : [],
    f1ProposalEpoch,
    recoverF1,
    refreshF1Approvals,
    invalidateF1: (message) => {
      f1Generation.current += 1;
      setF1Overview(null);
      setF1Loading(false);
      setF1Error(message ?? "原操作正在核对，请重新读取后再发起新修改。");
    },
    refreshF1: async () => { await Promise.all([refreshF1(), refreshF1Approvals()]); },
    f1RewardValuation: f1Overview?.rewardValuationUsdtPerUvt ?? null,
    f1Coverage: f1Overview?.coverage,
    acceptF1PolicyOverview: (overview) => {
      f1Generation.current += 1;
      setF1Overview(overview);
      setF1Loading(false);
      setF1Error(null);
      void refreshF1Approvals();
    },
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
    monthlyPromotionCount: f1Overview?.monthlyPromotionCount ?? null,
    promotionNextCursor: f1Promotions.nextCursor,
    payoutRecords: f1Payouts.items,
    payoutTotal: f1Payouts.total,
    payoutNextCursor: f1Payouts.nextCursor,
    f1PromotionLoading,
    f1PromotionError,
    f1PayoutLoading,
    f1PayoutError,
    queryPromotions: queryF1Promotions,
    queryPayouts: queryF1Payouts,
    proposeVRankBootstrap: async (ranks, reason) => {
      const def = findHighOp("f_vrank_bootstrap");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_vrank_bootstrap");
      await proposeStable("f-vrank-bootstrap:current", JSON.stringify([ranks, reason]), {
        action: def.action, obj: "current", before: "尚未配置会员等级", after: JSON.stringify(ranks),
        type: "param", amplifies: true, gate: { roles: [] }, gateLabel: def.gateLabel,
        reason, sourceDomain: "F1", command: def.buildCommand({ ranks }), target: def.buildTarget({}),
      });
    },
    proposeVRankOverride: async (userId, targetV, direction, reason) => {
      const def = findHighOp("f_vrank_override");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_vrank_override");
      await proposeStable(`f-vrank-override:${userId}`, JSON.stringify([targetV, direction, reason]), {
        action: `${def.action} · ${direction === "promote" ? "晋升" : "降级"}至 ${targetV}`,
        obj: `用户 ${userId}`,
        before: "当前等级",
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
    proposePayoutAction: async (record, action, reason, usedVoucherClawback) => {
      const def = findHighOp("f_reward_payout_action");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_reward_payout_action");
      const { payoutId, rewardType, commissionEventId, sponsorUserId } = record;
      const kind = rewardKind(rewardType);
      const reissue = action === "reissue";
      const voucherReverse = action === "reverse" && kind === "voucher";
      if (voucherReverse && typeof usedVoucherClawback !== "boolean") throw new Error("请选择已用券是否扣回。");
      const clawback = voucherReverse ? usedVoucherClawback : undefined;
      const rewardLabel = { voucher: "券", fund: "资金", sku: "商品", custom: "自定义奖励" }[kind];
      const impact = reissue ? {
        voucher: `${F1_VOUCHER_REISSUE}${F1_VOUCHER_REISSUE_UNAVAILABLE}`,
        fund: sponsorUserId ? "按原发放单重新记一笔应付，付给原邀请人，立即可用" : "按原发放单重新记一笔应付，付给用户本人，先进入冷却期",
        sku: "恢复原商品的履约和权益，并核对库存",
        custom: "只更新发放记录状态，奖品不补发",
      }[kind] : {
        voucher: clawback
          ? `已用券扣回。${F1_VOUCHER_REVERSE_CLAWBACK}`
          : `已用券不扣回。${F1_VOUCHER_REVERSE_KEEP}`,
        fund: commissionEventId ? "已到账的从用户余额扣回并记账，余额不够会失败；还在冷却期的取消待入账，不扣余额" : "没有关联的奖励记录，只更新发放状态，账务不动",
        sku: "取消对应的履约、收回权益，按履约状态退回库存",
        custom: "只更新发放记录状态，奖品不收回",
      }[kind];
      await proposeStable(`f-payout-action:${payoutId}`, JSON.stringify([action, reason, clawback]), {
        action: `奖励发放 · ${reissue ? "重发" : "冲正"} · ${rewardLabel}`,
        obj: `发放单 ${payoutId}`,
        before: "当前状态",
        after: `${reissue ? "已重发" : "已冲正"} · ${rewardLabel}：${impact}`,
        type: "fund",
        amplifies: action === "reissue",
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "F1",
        command: def.buildCommand({ payoutId, action, usedVoucherClawback: clawback }),
        target: def.buildTarget({ payoutId, action }),
      });
    },
    f2Metrics: f2Overview?.metrics ?? [],
    f2PayoutStatistics: f2Overview?.payoutStatistics,
    f2DirectPolicy,
    f2SevenLayerRevision: f2Overview?.sevenLayerRevision ?? null,
    f2DirectPolicyLoading,
    f2DirectPolicyError,
    f2ActivationPending: f2Pending(F2_ACTIVATION_SLOT) ?? null,
    f2BootstrapPending: f2Pending(F2_BOOTSTRAP_SLOT) ?? null,
    f2ActivationPendingLoading,
    f2ActivationPendingError,
    f2ActivationAttempt: f2Proposals.find(row => row.fingerprint === F2_ACTIVATION_SLOT && !row.ticket) ?? null,
    f2Proposals,
    f2ReadEpoch,
    f2PendingFor: key => f2Pending(key)?.id ?? null,
    f2WriteBlocked,
    f2ProposalRecord: f2Record,
    retryF2Proposal: slot => sendF2(slot),
    queryF2Proposal: async slot => {
      if (!session) throw new Error("ADMIN_PERMISSION_DENIED");
      const original = f2Record(slot);
      if (!original) throw new Error("F2_PROPOSAL_ORIGINAL_MISSING");
      setF2ReadEpoch(value => value + 1);
      markF2Loading();
      setF2Overview(null); setF2DirectPolicy(null); setF2ApprovalRows([]);
      try {
        // 查到什么由恢复区那一行原地写，这里不再另弹轻提示。
        return await queryF2Proposal(session.adminId, original);
      } finally { await refreshF2(); setF2Proposals(listF2Proposals(session.adminId)); }
    },
    releaseF2Proposal: async slot => {
      if (!session) throw new Error("ADMIN_PERMISSION_DENIED");
      const original = f2Record(slot);
      if (!original) return;
      setF2ReadEpoch(value => value + 1);
      markF2Loading();
      setF2Overview(null); setF2DirectPolicy(null); setF2ApprovalRows([]);
      try { await releaseF2Proposal(session.adminId, original); }
      finally { await refreshF2(); setF2Proposals(listF2Proposals(session.adminId)); }
    },
    recoverF2SevenLayerActivation: () => sendF2(F2_ACTIVATION_SLOT),
    bootstrapF2Unilevel: async (layers, reason) => {
      const current = await fetchF2DirectReferralPolicy();
      setF2DirectPolicy(current);
      if (current.sevenLayerEnabled && current.policySchemaVersion === 2 && current.purchaseSplit.enabled) {
        throw new Error("L1_LEGACY_NEX_READ_ONLY_DURING_SPLIT");
      }
      const def = findHighOp("f_unilevel_bootstrap");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_unilevel_bootstrap");
      await sendF2(F2_BOOTSTRAP_SLOT, {
        action: def.action, obj: "unilevel_bootstrap/current", before: "无 UNILEVEL 规则", after: "L1–L7",
        type: "fund", amplifies: true, gate: { roles: [] }, gateLabel: def.gateLabel,
        reason, sourceDomain: "F2", command: def.buildCommand({ layers }), target: def.buildTarget({}),
      });
    },
    changeF2SevenLayerActivation: async (action, expectedSevenLayerRevision, expectedPolicyVersion, reason) => {
      if (!can("network_f2_policy_amplify") || !can("platform_a2_proposal_create")) throw new Error("你没有申请团队购买奖励结算的权限。");
      if (f2DirectPolicy?.sevenLayerActivationContractVersion !== 1) throw new Error("团队购买奖励结算暂时不能启用，请刷新后重试。");
      const def = findHighOp("f_seven_layer_activation");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_seven_layer_activation");
      const label = { ACTIVATE: "七层结算启用", PAUSE: "七层结算暂停", RESUME: "七层结算恢复" }[action];
      await sendF2(F2_ACTIVATION_SLOT, {
        action: label, obj: "current", before: f2DirectPolicy.sevenLayerEnabled ? f2DirectPolicy.sevenLayerPaused ? "已启用，已暂停" : "已启用，正常处理" : "未启用",
        after: action === "ACTIVATE" ? "批准后启用，以前的奖励不变" : action === "PAUSE" ? "暂停计算新订单的奖励" : "恢复计算，并补算暂停期间积压的订单",
        type: action === "PAUSE" ? "param" : "fund", amplifies: action !== "PAUSE",
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "F2",
        command: def.buildCommand({ action, expectedSevenLayerRevision, expectedPolicyVersion }), target: def.buildTarget({}),
      });
      await refreshF2();
    },
    updateF2DirectPolicy: async (policy, reason) => {
      const invalid = validateDirectReferralUpdate(policy);
      if (invalid) throw new Error(invalid);
      const current = await fetchF2DirectReferralPolicy();
      setF2DirectPolicy(current);
      if (current.policyVersion !== policy.expectedVersion || current.sevenLayerRevision !== policy.expectedSevenLayerRevision) throw new Error("好友奖励或团队购买奖励规则已被修改，请刷新后再确认（已填写的内容会保留）。");
      const def = findHighOp("f_direct_referral_policy");
      if (!def) throw new Error("F_OP_NOT_FOUND:f_direct_referral_policy");
      await proposeStable("f-direct-referral-policy", JSON.stringify([policy, reason]), {
        action: def.action, obj: "current",
        before: `当前政策版本 ${current.policyVersion}，团队购买奖励规则版本 ${current.sevenLayerRevision}；${directReferralSummary(current)}；原 L1 UVT 系数 ${current.sevenLayerReference.legacyNexPerUsd ?? "未配置"}`,
        after: `${directReferralSummary(policy)}；审批通过后立即对新来源生效`,
        type: "fund", amplifies: directReferralAmplifies(current, policy),
        gate: { roles: [] }, gateLabel: def.gateLabel, reason, sourceDomain: "F2",
        command: def.buildCommand({ ...policy }), target: def.buildTarget({}),
      });
    },
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
    f3Proposals, f3ApprovalRows, f3ReadEpoch, recoverF3,
    f3Metrics: f3Overview?.metrics ?? [],
    f3Amounts: f3Overview ? { monthlyMatchedUsdRaw: f3Overview.monthlyMatchedUsdRaw, dailyMatchUsdRaw: f3Overview.dailyMatchUsdRaw,
      maxDailyCapUsdRaw: f3Overview.maxDailyCapUsdRaw, maxTrackGmvRaw: f3Overview.maxTrackGmvRaw, residualPoolUsdRaw: f3Overview.residualPoolUsdRaw } : undefined,
    f3Statistics: f3Overview?.statistics,
    f3Formula: f3Overview?.formula ?? null,
    f3Settlements: f3Overview?.settlements ?? [],
    f3BlockedAttempts: f3Overview?.blockedAttempts ?? null,
    f3MaxTrackGmv: f3Overview?.maxTrackGmv ?? 1,
    f3Config: f3Overview?.config ?? null,
    f3ConfigValues: f3Overview?.configValues ?? {},
    f3DailyCap: f3Overview?.dailyCap ?? null,
    f3Coverage: f3Overview?.coverage,
    f3ParticipantCount: f3Overview?.participantCount ?? 0,
    f3BlockedCount: f3Overview?.blockedCount ?? 0,
    f3MonthlyMatchedUsd: f3Overview?.monthlyMatchedUsd ?? 0,
    f3AutoPlacement7dCount: f3Overview?.autoPlacement7dCount ?? 0,
    f3DailyMatchUsd: f3Overview?.dailyMatchUsd ?? 0,
    f3Loading,
    f3Error,
    refreshF3,
    getF3PayoutControlPending, submitF3PayoutControl, recoverF3PayoutControl,
    updateF3Config: async (key, value, reason, amplifies, snapshot) => {
      if (isF3PayoutControlKey(key)) await submitF3PayoutControl(key, value, reason, snapshot);
      else await proposeFConfig("F3", key, value, reason, undefined, amplifies, undefined, snapshot);
    },
    f4Overview,
    f4VoteProjection,
    refreshF4VoteProjection,
    f4AmbassadorPolicy,
    f4PolicyLoading,
    retryF4AmbassadorPolicy: async () => { try { await readF4AmbassadorPolicy(); } catch { /* The rule block shows the read failure. */ } },
    refreshF4PolicyBaseline: async () => {
      setF4AmbassadorPolicy(null);
      const policy = await readF4AmbassadorPolicy();
      setActionConfirm(modal => modal?.f4Snapshot?.action === "policy"
        ? { ...modal, f4Snapshot: { ...modal.f4Snapshot, policy } } : modal);
      return policy;
    },
    f4Loading,
    f4Error,
    f4Proposals,
    f4QueryNotes,
    f4PolicyWrites,
    f4ExpiredReason: (snapshot) => [...f4Proposals, ...f4PolicyWrites].some(row => isRetryExpired(row) && matchesF4Confirmation(row, snapshot)) ? RETRY_EXPIRED_TEXT : undefined,
    f4ApprovalRows,
    recoverF4,
    refreshF4,
    submitF4Proposal: sendF4,
    updateF4Config: async (key, value, reason, expectedVersion, expectedMaterialRevision) => {
      if (["F.pool.monthlyCap", "F.leaderboard.poolUsd"].includes(key) && f4MonthlyCap(value) === null) throw new Error("F4_POOL_MONEY_INVALID");
      if (key === "F.pool.settleCron") { const issue = f4WeeklyCronIssue(value); if (issue) throw new Error(issue); }
      const vote = f4Overview?.voteWeights.find((row) => (row.configKey || `F.pool.votes.${row.v}`) === key);
      const headCap = key === "F.pool.top1MaxPct" || key === "F.pool.top5MaxPct";
      const current = f4Submission.current?.overview ?? f4Overview;
      const moneyKey = key === "F.pool.monthlyCap" || key === "F.leaderboard.poolUsd";
      const amplifies = moneyKey && current ? f4MoneyAmplifies(key, current.configValues, value) : headCap && current
        ? f4HeadCapAmplifies(key, current.configValues[key], value)
        : vote ? Number(value) > vote.votes : undefined;
      await proposeFConfig("F4", key, value, reason, expectedVersion, amplifies, expectedMaterialRevision);
    },
    updateF4AmbassadorPolicy: async (policy, reason) => {
      const current = requireTeamApprovalSession("F4");
      if (!f4Overview || !f4AmbassadorPolicy || f4Loading || f4Error) throw new Error("申请规则加载失败，请刷新后再操作。");
      if (f4Proposals.some(row => row.spec?.command.op === "f4_ambassador_policy_change")) throw new Error("OBJECT_ALREADY_PENDING");
      let saved = true;
      try { await sendF4Policy(current.adminId, policy, reason, f4Submission.current ?? mc?.f4Snapshot); }
      catch (error) {
        // Server direction is authoritative. Retain the same form for a proposal.
        if ((error as { backendMessage?: string }).backendMessage === "A2_CONFIRMATION_REQUIRED") {
          await sendF4(F4_POLICY_SLOT, f4PolicySpec(policy, reason));
          saved = false;
        } else throw error;
      } finally {
        const records = listF4PolicyWrites(current.adminId);
        setF4PolicyWrites(records);
        if (records[0]) setActionConfirm(modal => modal?.f4Snapshot
          ? { ...modal, f4Snapshot: records[0].f4Snapshot ?? modal.f4Snapshot, f4Recovery: { kind: "policy", original: records[0] } } : modal);
      }
      await refreshF4();
      return saved;
    },
    proposeF4Settlement: async (reason) => {
      const def = findHighOp("f4_pool_settle");
      if (!def) throw new Error("F_OP_NOT_FOUND:f4_pool_settle");
      await proposeStable("f4-settle:current-week", JSON.stringify([reason]), {
        action: def.action,
        obj: "本周团队激励池",
        before: "待结算",
        after: "按本周已付款成交额、门槛、票数和月度上限结算",
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
    f5Overview: f5Page?.overview ?? null,
    f5AppliedQuery: f5Page?.query ?? null,
    f5NextQuery: f5Page?.nextQuery ?? null,
    f5Loading,
    f5Error,
    f5Proposals,
    f5AnomalyWrites,
    f5ApprovalRows,
    f5ApprovalReadError,
    f5ReadEpoch,
    prepareF5Confirmation: snapshot => { f5Submission.current = snapshot; },
    getF5Operation: snapshot => {
      const owner = useAdminAuth.getState().session?.adminId;
      if (owner === undefined || owner !== session?.adminId) return undefined;
      if (snapshot.action === "anomaly") {
        const original = listF5AnomalyWrites(owner)[0];
        return original ? { kind: "anomaly", original } : undefined;
      }
      const original = listF5Proposals(owner).find(row => row.fingerprint === f5ConfirmationSlot(snapshot));
      return original ? { kind: "proposal", original } : undefined;
    },
    recoverF5,
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
        before: "当前状态",
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
      await proposeStable(`f4-leaderboard:${period}`, JSON.stringify([period, reason]), {
        action: def.action,
        obj: `排行榜 ${period}`,
        before: "待发放",
        after: "按本期奖励榜和奖池设置发放",
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
        before: "当前状态",
        after: "每笔生成一条补发记录",
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
        action: `${suspended ? "暂停" : "恢复"}用户奖励 · ${userId}`,
        obj: `${userId}:${sortedKinds.join(",")}`,
        before: "当前状态",
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
      const owner = useAdminAuth.getState().session?.adminId;
      if (owner === undefined || owner !== session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
      if (!f5Page || f5Loading || f5Error) throw new Error("F5_CURRENT_DATA_REQUIRED");
      try {
        await sendF5Anomaly(owner, { commissionAnomalySigma: sigma, layerRatioAnomalyPct: layerRatio, reason }, f5Submission.current);
      } finally { setF5AnomalyWrites(listF5AnomalyWrites(owner)); }
      setF5Page(null);
      await refreshF5();
    },
  };

  // 跨域 / 跨标签跳转 CTA(放进 DomainHeader 的 right 槽,不改 DomainHeader 组件)
  const CTA: Record<string, { label: string; onClick: () => void }> = {
    F1: { label: "团队激励池票数权重 →", onClick: () => { setTab("F4"); router.push("/network/leadership-pool"); } },
    F3: { label: "风险提醒 →", onClick: () => nav("B") },
    F4: { label: "奖励记录核对 →", onClick: () => { setTab("F5"); router.push("/network/commissions"); } },
  };
  const cta = CTA[tab];

  const page = (
    <>
      {tab === "F1" || tab === "F2" || tab === "F3" || tab === "F4" || tab === "F5" ? null : <DomainHeader {...meta} right={cta ? <button className="f-cta" onClick={cta.onClick}>{cta.label}</button> : undefined} />}


      {tab === "F1" && <F1Vrank ctx={ctx} />}
      {tab === "F2" && <F2Page ctx={ctx} coverage={f2Overview?.coverage} />}
      {tab === "F3" && <F3Binary ctx={ctx} />}
      {tab === "F4" && <F4Ops ctx={ctx} onOpenCommissions={CTA.F4.onClick} />}
      {tab === "F5" && <F5Audit ctx={ctx} />}

      {mc && <OperationConfirmModal key={mc.f4Snapshot ? mc.commandKey : undefined} briefKind={mc.briefKind}
        action={mc.name}
        title={mc.title}
        facts={mc.facts}
        statedBrief={mc.statedBrief}
        effect={mc.effect}
        confirmLabel={mc.confirmLabel}
        confirmTone={mc.confirmTone}
        coverageLead={mc.coverageLead}
        coverageCheck={mc.coverageCheck}
        detail={mc.detail ?? "从下一笔结算开始生效，已经算好的不变。"}
        amplifies={!!mc.amplify}
        coverageReliable={tab === "F4" ? (mc.f4Snapshot ? mc.f4Snapshot.overview.coverage : f4Overview?.coverage)?.reliable === true : undefined}
        coverageUnavailableBlocks={tab === "F4" && ["approve", "policy", "settle", "payout"].includes(mc.f4Snapshot?.action ?? "")}
        // coverage 按当前 tab 选源(A1 批1b 修复):原硬编码 f1Overview?.coverage → 切到 F2-F5 时仍显示 F1 覆盖率(跨域误用)。
        // 现按 tab 路由到对应 overview 的 coverage,与后端 rates()/binary()/leadershipPool()/commissions() 注入的 B1 快照一致。
        coverage={(tab === "F1" ? f1Overview?.coverage
          : tab === "F2" ? f2Overview?.coverage
          : tab === "F3" ? mc.f3Snapshot?.coverage
          : tab === "F4" ? mc.f4Snapshot ? mc.f4Snapshot.overview.coverage : f4Overview?.coverage
          : tab === "F5" ? f5Page?.overview.coverage
          : undefined) as { coverageRatio: number; redlinePct: number } | undefined}
        edit={mc.edit}
        businessForm={mc.businessForm}
        initialReason={mc.f4Snapshot ? f4PendingReason() : teamApproval?.source === "F3" ? f3FundPending?.spec?.reason : undefined}
        getPendingReason={mc.f4Snapshot ? f4PendingReason : teamApproval?.source === "F3" ? () => listF3Proposals(session!.adminId).find(row => row.spec?.command.op === "f3_binary_settle")?.spec?.reason : undefined}
        getPendingBusinessValue={mc.f4Snapshot ? () => f4PendingOriginal()?.f4Snapshot?.businessValue : teamApproval?.source === "F3" && f3FundPending?.spec ? () => {
          const values = f3FundPending.spec!.command.params.values as TeamFundApprovalValues["F3"];
          return { ownerUserId: String(values.ownerUserId), settlementDate: values.settlementDate };
        } : undefined}
        inlineApproval={mc.f4Snapshot ? {
          ...teamApproval,
          resolve: teamApproval?.resolve ?? (() => undefined),
          dialogClassName: teamApproval ? "team-fund-confirm f4-policy-confirm" : undefined,
          pending: !!f4ModalRecord,
          initialRecovery: "retry",
          expired: !!f4ModalRecord && (f4ModalRecord.kind === "proposal" ? !canRetryF4Proposal(f4ModalRecord.original) : !canRetryF4Policy(f4ModalRecord.original)),
          expiredRequestRecovery: f4ModalRecord && isRetryExpired(f4ModalRecord.original) ? "query" : undefined,
          recover: async () => {
            const original = f4ModalRecord ?? (() => {
              const row = f4PendingOriginal();
              return row ? "f4Request" in row ? { kind: "policy" as const, original: row } : { kind: "proposal" as const, original: row as FDomainAttempt } : undefined;
            })();
            return original ? recoverF4(original, "query") : false;
          },
          retry: async () => { if (f4ModalRecord) await recoverF4(f4ModalRecord, "retry"); },
        } : teamApproval ? {
          ...teamApproval,
          dialogClassName: teamApproval.source === "F4" ? "team-fund-confirm f4-policy-confirm" : "team-fund-confirm",
          pending: !!pendingTeamApproval,
          expired: !!pendingTeamApproval && (pendingTeamApproval.expiresAt <= Date.now() || teamApproval.source === "F3" && (!f3FundPending?.request || !!f3FundPending?.received)),
          expiredRequestRecovery: teamApproval.source === "F3" && pendingTeamApproval && isRetryExpired(pendingTeamApproval) ? "query" : undefined,
          disabledReason: mc.teamApprovalOwner === session?.adminId && canSubmitTeamApproval(teamApproval.source)
            ? undefined : "当前账号没有这项操作的权限，请关闭弹窗后重新核对。",
          recover: () => submitTeamApproval(teamApproval.source, null, "", true, mc.teamApprovalOwner),
          retry: async () => { await submitTeamApproval(teamApproval.source, null, "", "retry-original", mc.teamApprovalOwner); },
        } : undefined}
        completionCopy={mc.completionCopy ?? (
          mc.op === "param" || mc.op === "param-multi" || mc.op === "dispose"
            ? "提交后需在「操作记录与审批」确认才生效。"
            : undefined
        )}
        onClose={() => setActionConfirm(null)}
        onConfirm={async (reason, newVal, businessValue) => {
          try {
          if (mc.f4Snapshot) {
            if (mc.f4Owner !== useAdminAuth.getState().session?.adminId) throw new Error("ADMIN_PERMISSION_DENIED");
            if (mc.f4Recovery) { await recoverF4(mc.f4Recovery, "retry"); return; }
            if (!f4Overview || f4Loading || f4Error) throw new Error("奖励池、名额与排行榜加载失败，请刷新后再操作。");
            f4Submission.current = { ...mc.f4Snapshot, value: newVal, businessValue };
          }
          if (mc.run) {
            await mc.run(reason, businessValue, newVal);
          } else if (mc.op === "param" && mc.paramKey) {
            if (!newVal) { setToast("请填写新值"); return; }
            const target = f1ThresholdTarget(mc.paramKey);
            if (target) {
              await ctx.updateVRankThreshold(target.rank, target.field, newVal, reason);
            } else if (tab === "F2") {
              await ctx.updateF2Config(mc.paramKey, newVal, reason);
            } else if (tab === "F3") {
              await ctx.updateF3Config(mc.paramKey, newVal, reason);
            } else if (tab === "F4") {
              await ctx.updateF4Config(mc.paramKey, newVal, reason, mc.expectedVersion, mc.expectedMaterialRevision);
            } else if (tab === "F1") {
              await ctx.updateF1Config(mc.paramKey, newVal, reason);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKey}`);
            }
            if (tab !== "F4") setToast(mc.name + (target ? " 已更新，下一轮评估使用新值" : " 已提交，等待确认"));
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
            if (tab !== "F4") setToast(mc.name + " 已提交，等待确认");
          } else if (mc.op === "dispose" && mc.paramKey && mc.fixedVal) {
            if (tab === "F1") {
              await ctx.updateF1Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F2") {
              await ctx.updateF2Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F3") {
              await ctx.updateF3Config(mc.paramKey, mc.fixedVal, reason);
            } else if (tab === "F4") {
              await ctx.updateF4Config(mc.paramKey, mc.fixedVal, reason, mc.expectedVersion, mc.expectedMaterialRevision);
            } else if (tab === "F5") {
              if (mc.expectedVersion === undefined) throw new Error("F5_EXPECTED_VERSION_REQUIRED");
              await ctx.updateF5Config(mc.paramKey, mc.fixedVal, reason, mc.expectedVersion);
            } else {
              throw new Error(`F_BACKEND_ROUTE_MISSING:${mc.paramKey}`);
            }
            // dispose 一律走 A2 propose:此刻只是入了待执行队列,还没落库。原文案「已生效」
            // 会把冻结这种抢时间的动作误报成完成(票在队列里等执行期间冷却可能到期解锁)。
            if (tab !== "F4") setToast(mc.name + " 已提交，等待确认");
          } else {
            throw new Error("F_CONFIRM_SHAPE_UNKNOWN:" + (mc.op || mc.name)); // 未知确认形状必须响亮失败,禁静默假成功
          }
          setActionConfirm(null);
          } catch (error) {
            // 错误交回确认框，由框里显示（没权限时框关掉、外壳提示），不再另弹同一句轻提示。
            // Modal owns the retry/error state and must retain the original command key.
            // Swallowing here clears its submitting state without rendering the recovery path.
            throw error;
          } finally {
            if (mc.f4Snapshot) f4Submission.current = undefined;
          }
        }} />}
      {toastNode}
    </>
  );
  // F1–F5 已改版：页头在页面里，整页包 RdPage。
  return tab === "F1" || tab === "F2" || tab === "F3" || tab === "F4" || tab === "F5" ? <RdPage className="fdom">{page}</RdPage> : <div className="dkpage fdom">{page}</div>;

}
