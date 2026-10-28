"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";

import { formatC1RiskBand } from "@/lib/admin/c1-detail-display";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TabGroup } from "@/app/components/kit/tab-group";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  approveUserAssetAdjustment,
  createUserAssetAdjustment,
  fetchUserAssetAdjustmentContext,
  fetchUserAssetAdjustmentAccounts,
  fetchUserAssetAdjustmentDetail,
  fetchUserAssetAdjustmentOverview,
  fetchUserAssetAdjustments,
  rejectUserAssetAdjustment,
  requestLargeUserAssetAdjustment,
  reverseUserAssetAdjustment,
  withdrawUserAssetAdjustment,
  type User360Profile,
  type UserAssetAdjustment,
  type UserAssetAdjustmentContext,
  type UserAssetAdjustmentDetail,
  type UserAssetAdjustmentOverview,
  type UserPage,
} from "@/lib/admin/user360-client";
import { DataListPager, Drawer } from "../design-kit";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const ASSETS = ["USDT", "UVT"] as const;
const REASON_CODES = [
  ["SUPPORT_COMPENSATION", "客服补偿"],
  ["SYSTEM_CORRECTION", "系统纠错"],
  ["CAMPAIGN_REISSUE", "活动补发"],
  ["DISPUTE_RETURN", "争议退回"],
] as const;
const REASON_CODE_LABELS: Record<string, string> = {
  SUPPORT_COMPENSATION: "客服补偿",
  SYSTEM_CORRECTION: "系统纠错",
  CAMPAIGN_REISSUE: "活动补发",
  DISPUTE_RETURN: "争议退回",
  REVERSAL: "冲正",
  OPS_USER_ADJUSTMENT: "运营余额调整",
};
const HISTORY_FILTERS = ["全部", "USDT", "UVT"] as const;

type Asset = (typeof ASSETS)[number];
type Direction = "CREDIT" | "DEBIT";
type HistoryFilter = (typeof HISTORY_FILTERS)[number];

function emptyPage<T>(pageSize: number): UserPage<T> {
  return { total: 0, pageNum: 1, pageSize, records: [] };
}

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatNumber(value: unknown, digits = 6) {
  return number(value).toLocaleString("en-US", { maximumFractionDigits: digits });
}

function formatUsdEquivalent(value: unknown) {
  const parsed = number(value);
  const tinyNonZero = parsed !== 0 && Math.abs(parsed) < 0.000001;
  return parsed.toLocaleString("en-US", {
    minimumFractionDigits: tinyNonZero ? 8 : 2,
    maximumFractionDigits: 8,
  });
}

function formatPercent(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${parsed.toFixed(1)}%` : "—";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("zh-CN", { hour12: false });
}

function accountId(account: User360Profile | null | undefined) {
  const id = account?.userId ?? account?.id;
  return id === null || id === undefined || id === "" ? "" : String(id);
}

function displayUser(account: Pick<User360Profile, "userNo" | "nickname"> | null | undefined) {
  if (!account) return "—";
  return `${text(account.userNo)} · ${operatorNicknameText(text(account.nickname))}`;
}

function displayRowUser(row: UserAssetAdjustment) {
  return `${text(row.userNo)} · ${operatorNicknameText(text(row.nickname))}`;
}

function statusTone(row: UserAssetAdjustment) {
  const status = text(row.status).toUpperCase();
  if (status === "APPROVED") return "ok";
  if (status === "REJECTED") return "bad";
  if (status === "WITHDRAWN") return "dim";
  return "warn";
}

function statusLabel(row: UserAssetAdjustment) {
  const label = text(row.statusLabel, "");
  return /[\u3400-\u9fff]/.test(label) ? label : ({ PENDING_REVIEW: "待审核", PENDING: "待审核", REQUESTED: "已申请", APPROVED: "已执行", REJECTED: "已拒绝", WITHDRAWN: "已撤回", EXPIRED: "已过期", SUSPENDED: "已挂起" } as Record<string,string>)[text(row.status).toUpperCase()] ?? "状态待核实";
}

function reasonCodeLabel(value: unknown) {
  return REASON_CODE_LABELS[text(value, "").toUpperCase()] ?? "其他";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? displayAdminError(error) : "余额调整请求失败，请刷新后重试";
}

function newIdempotencyKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

/** 三类命令(建单 / 审核 / 冲正)共用一张表,靠 fingerprint 前缀分命名空间;
 *  刷新后仍能用同一命令号重试,避免重复入账。 */
const c3Commands = createPendingMutationStore({
  storageKey: "nexion-admin-c3-adjust-commands-v1",
});
const submitFingerprint = (payload: unknown) => `submit|${JSON.stringify(payload)}`;
const reviewFingerprint = (approved: boolean, adjustmentNo: string, reason: string) =>
  `review|${approved ? "approve" : "reject"}|${adjustmentNo}|${reason}`;
const reverseFingerprint = (adjustmentNo: string, reason: string) => `reverse|${adjustmentNo}|${reason}`;
const withdrawFingerprint = (adjustmentNo: string, reason: string) => `withdraw|${adjustmentNo}|${reason}`;

export function C3Adjust({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const focusUserId = useSearchParams()?.get("userId") ?? "";
  const authorities = session?.authorities ?? [];
  const canCreate = authorities.includes("user_c3_adjust_create");
  const canApprove = authorities.includes("user_c3_adjust_approve");
  const canReverse = authorities.includes("user_c3_adjust_reverse");
  const canReadLedger = authorities.includes("finance_d4_read");
  const isSupport = session?.role === "support";
  const isFinance = session?.role === "finance";
  const [overview, setOverview] = useState<UserAssetAdjustmentOverview | null>(null);
  const [requests, setRequests] = useState<UserPage<UserAssetAdjustment>>(() => emptyPage(5));
  const [requestPage, setRequestPage] = useState(1);
  const [requestPageSize, setRequestPageSize] = useState(5);
  const [history, setHistory] = useState<UserPage<UserAssetAdjustment>>(() => emptyPage(10));
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("全部");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userQuery, setUserQuery] = useState("");
  const [userOptions, setUserOptions] = useState<User360Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<User360Profile | null>(null);
  const [context, setContext] = useState<UserAssetAdjustmentContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [focusError, setFocusError] = useState("");
  const [focusRetry, setFocusRetry] = useState(0);
  const contextGeneration = useRef(0);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [asset, setAsset] = useState<Asset>("USDT");
  const [direction, setDirection] = useState<Direction>("CREDIT");
  const [amountText, setAmountText] = useState("120");
  const [reasonCode, setReasonCode] = useState("SUPPORT_COMPENSATION");
  const [reason, setReason] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [detail, setDetail] = useState<UserAssetAdjustmentDetail | null>(null);
  const [detailFallback, setDetailFallback] = useState<UserAssetAdjustment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const historyAsset = historyFilter === "全部" ? undefined : historyFilter;
      const [nextOverview, nextHistory, nextRequests] = await Promise.all([
        fetchUserAssetAdjustmentOverview(),
        fetchUserAssetAdjustments({ asset: historyAsset, historyOnly: true, pageNum: historyPage, pageSize: historyPageSize }),
        fetchUserAssetAdjustments({ status: "PENDING_REVIEW", pageNum: requestPage, pageSize: requestPageSize }),
      ]);
      setOverview(nextOverview);
      const historyPageCount = Math.max(1, Math.ceil(nextHistory.total / historyPageSize));
      const requestPageCount = Math.max(1, Math.ceil(nextRequests.total / requestPageSize));
      if (historyPage > historyPageCount) {
        setHistory(emptyPage(historyPageSize));
        setHistoryPage(historyPageCount);
      } else {
        setHistory(nextHistory);
      }
      if (requestPage > requestPageCount) {
        setRequests(emptyPage(requestPageSize));
        setRequestPage(requestPageCount);
      } else {
        setRequests(nextRequests);
      }
      return true;
    } catch (err) {
      setOverview(null);
      setHistory(emptyPage(historyPageSize));
      setRequests(emptyPage(requestPageSize));
      setError(errorMessage(err));
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [historyFilter, historyPage, historyPageSize, requestPage, requestPageSize]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setUserSearchLoading(true);
      fetchUserAssetAdjustmentAccounts(userQuery.trim() || undefined)
        .then((page) => setUserOptions(page.records))
        .catch((err) => toast(errorMessage(err)))
        .finally(() => setUserSearchLoading(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [toast, userQuery]);

  const selectedUserId = accountId(selectedUser);
  const selectedAccount = selectedUserId && accountId(context?.account) === selectedUserId ? context?.account ?? null : null;
  const currentBalance = asset === "USDT" ? number(selectedAccount?.walletUsdt) : number(selectedAccount?.walletNex);
  const normalizedAmountText = amountText.trim();
  const amountFormatValid = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalizedAmountText);
  const amount = amountFormatValid ? Number(normalizedAmountText) : Number.NaN;
  const previewAmount = Number.isFinite(amount) ? amount : 0;
  const nexUsdRate = number(context?.nexUsdRate ?? overview?.nexUsdRate);
  const amountUsd = asset === "USDT" ? previewAmount : previewAmount * nexUsdRate;
  const balanceAfter = direction === "CREDIT" ? currentBalance + previewAmount : currentBalance - previewAmount;
  const coverage = (context?.coverage ?? overview?.coverage ?? {}) as Record<string, unknown>;
  const coverageReliable = coverage.reliable === true;
  const coverageRatio = number(coverage.coverageRatio, Number.NaN);
  const redlinePct = number(coverage.redlinePct, Number.NaN);
  const reserveUsd = number(coverage.reserveUsd);
  const liabilitiesUsd = number(coverage.liabilitiesUsd);
  const projectedCoverage = useMemo(() => {
    if (reserveUsd <= 0 || liabilitiesUsd <= 0) return coverageRatio;
    const projectedLiabilities = direction === "CREDIT"
      ? liabilitiesUsd + amountUsd
      : Math.max(0, liabilitiesUsd - amountUsd);
    return projectedLiabilities === 0 ? 999999 : reserveUsd / projectedLiabilities * 100;
  }, [amountUsd, coverageRatio, direction, liabilitiesUsd, reserveUsd]);
  const maxAmount = number(context?.maxAdjustmentAmount ?? overview?.maxAdjustmentAmount, 10000);
  const largeThreshold = number(context?.largeThresholdUsd ?? overview?.singleCreditReviewCapUsd, 500);
  const reasonLength = reason.trim().length;
  const debitInsufficient = direction === "DEBIT" && balanceAfter < 0;
  const largeAdjustment = amountUsd > largeThreshold;
  const supportLargeRequest = isSupport && largeAdjustment;
  const creditCoverageUnavailable = direction === "CREDIT"
    && (!coverageReliable || !Number.isFinite(coverageRatio) || !Number.isFinite(redlinePct));
  const creditBelowRedline = direction === "CREDIT"
    && coverageReliable
    && Number.isFinite(redlinePct)
    && projectedCoverage < redlinePct;
  const formError = !canCreate
    ? "当前角色只有查看权限，不能发起余额调整"
    : loading || error
    ? "数据加载失败，请重新加载后再操作"
    : !selectedAccount
    ? contextLoading ? "正在加载账户资金" : "请先选择账户"
    : contextLoading
      ? "正在加载账户资金"
      : !amountFormatValid || !Number.isFinite(amount)
        ? "请输入数字，最多 6 位小数"
        : amount <= 0
          ? "金额必须大于 0"
        : amountUsd > maxAmount
          ? `单笔金额不得超过 ${formatNumber(maxAmount)} USDT 等值`
          : asset === "UVT" && nexUsdRate <= 0
            ? "当前 UVT 价格不可用，暂不能提交"
            : debitInsufficient
              ? "扣减后余额不足"
              : reasonLength < 8 || reasonLength > 200
                ? "详细原因需填写 8–200 个字符"
                : evidenceRef.trim().length < 3
                  ? "请填写工单号、凭证号等证据引用"
                  : creditCoverageUnavailable && !supportLargeRequest
                    ? "兑付覆盖率暂时算不出来，暂不能加余额"
                  : creditBelowRedline && !supportLargeRequest
                    ? "加完后兑付覆盖率会低于红线"
                    : largeAdjustment && isFinance
                      ? "超过 500 USDT 等值需由财务主管或超级管理员执行"
                    : null;

  const selectUser = (account: User360Profile) => {
    const id = accountId(account);
    const generation = ++contextGeneration.current;
    setSelectedUser(account);
    setFocusError("");
    setContext(null);
    setContextLoading(false);
    setUserQuery(displayUser(account));
    setShowUserMenu(false);
    if (!id) {
      toast("该账户没有有效的用户 ID");
      return;
    }
    setContextLoading(true);
    fetchUserAssetAdjustmentContext(id)
      .then((nextContext) => {
        if (generation !== contextGeneration.current) return;
        if (accountId(nextContext.account) !== id) throw new Error("账户信息不一致，请重新选择");
        setContext(nextContext);
      })
      .catch((err) => { if (generation === contextGeneration.current) toast(errorMessage(err)); })
      .finally(() => { if (generation === contextGeneration.current) setContextLoading(false); });
  };

  useEffect(() => {
    if (!focusUserId) return;
    const generation = ++contextGeneration.current;
    let active = true;
    setFocusError("");
    setSelectedUser(null); setContext(null); setShowUserMenu(false); setContextLoading(false);
    if (!/^\d+$/.test(focusUserId) || !/[1-9]/.test(focusUserId)) { setFocusError("客户编号无效，请返回会话核对。"); return; }
    setContextLoading(true);
    fetchUserAssetAdjustmentContext(focusUserId).then(next => {
      if (!active || generation !== contextGeneration.current) return;
      if (!next.account || accountId(next.account) !== focusUserId) throw new Error("账户与会话中的客户不一致，请返回会话核对。");
      setSelectedUser(next.account); setUserQuery(displayUser(next.account)); setContext(next);
    }).catch(cause => { if (active && generation === contextGeneration.current) setFocusError(errorMessage(cause)); })
      .finally(() => { if (active && generation === contextGeneration.current) setContextLoading(false); });
    return () => { active = false; };
  }, [focusUserId, authEpoch, focusRetry]);

  const submitAdjustment = () => {
    if (formError || !selectedAccount) {
      toast(formError ?? "请检查表单");
      return;
    }
    const id = accountId(selectedAccount);
    if (!id) return toast("该账户没有有效的用户 ID");
    const fingerprint = submitFingerprint({ id, asset, direction, amount: amountText.trim(), reasonCode, reason: reason.trim(), evidenceRef: evidenceRef.trim() });
    const key = c3Commands.get(fingerprint) ?? newIdempotencyKey("c3-adjust");
    c3Commands.remember(fingerprint, key);
    const supportRequest = supportLargeRequest;
    const selectionGeneration = contextGeneration.current;
    openConfirm({
      action: supportRequest
        ? `提交大额调整请求 · ${formatNumber(amount)} ${nexGridBrandText(asset)}`
        : `提交${direction === "CREDIT" ? "增加" : "扣减"}调整申请 · ${formatNumber(amount)} ${nexGridBrandText(asset)}`,
      detail: supportRequest
        ? `${displayUser(selectedAccount)}；超过 500 USDT 等值，提交后需由财务主管或超级管理员处理，余额暂不变。`
        : `${displayUser(selectedAccount)}；提交后需由另一位同事复核，批准后余额才会变化。重复提交不会重复入账。`,
      chips: supportRequest ? [["待主管处理", "ready"], ["余额暂不变", "ready"]] : [["待审核", "ready"], ["余额暂不变", "ready"]],
      reason: false,
      okLabel: "确认提交",
      run: async () => {
        if (selectionGeneration !== contextGeneration.current) {
          toast("账户信息已变化，请重新核对后提交");
          return false;
        }
        setBusy(true);
        try {
          const input = {
            asset, direction, amount: amountText.trim(), reasonCode, reason: reason.trim(), evidenceRef: evidenceRef.trim(),
            operator: OPERATOR(), idempotencyKey: key,
          } as const;
          const result = supportRequest
            ? await requestLargeUserAssetAdjustment(id, input)
            : await createUserAssetAdjustment(id, input);
          const [loaded] = await Promise.all([loadData(true), fetchUserAssetAdjustmentContext(id).then((nextContext) => {
            if (accountId(nextContext.account) !== id) throw new Error("账户信息不一致，请重新选择");
            if (selectionGeneration === contextGeneration.current) setContext(nextContext);
          })]);
          if (!loaded) throw new Error("可能已提交成功，但页面没刷新出来。请不要修改内容，直接重试（不会重复提交）");
          c3Commands.forget(fingerprint);
          setAmountText("");
          setReason("");
          setEvidenceRef("");
          toast(supportRequest
            ? `大额调整请求已提交 · ${text(result.requestNo)}`
            : `调整申请已提交 · ${text(result.adjustmentNo)} · 等待审核`);
        } catch (err) {
          toast(errorMessage(err));
          return false;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const reviewLargeRequest = (row: UserAssetAdjustment, approved: boolean) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    if (!adjustmentNo) return toast("缺少申请编号");
    openActionConfirm({
      action: `${approved ? "批准" : "驳回"}调整申请 · ${adjustmentNo}`,
      detail: `${displayRowUser(row)} · ${text(row.direction) === "CREDIT" ? "+" : "−"}${formatNumber(row.amount)} ${nexGridBrandText(text(row.asset))} · ${text(row.reason)}`,
      amplifies: approved && text(row.direction).toUpperCase() === "CREDIT",
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: approved ? "批准后余额立即变化，并生成账单。" : "驳回后余额不变。",
      run: async (reviewReason) => {
        setBusy(true);
        try {
          const fingerprint = reviewFingerprint(approved, adjustmentNo, reviewReason);
          const commandKey = c3Commands.get(fingerprint)
            ?? newIdempotencyKey(approved ? "c3-approve" : "c3-reject");
          c3Commands.remember(fingerprint, commandKey);
          if (approved) await approveUserAssetAdjustment(adjustmentNo, reviewReason, OPERATOR(), commandKey);
          else await rejectUserAssetAdjustment(adjustmentNo, reviewReason, OPERATOR(), commandKey);
          if (!await loadData(true)) {
            throw new Error("可能已成功，但页面没刷新出来。请不要修改内容，直接重试（不会重复执行）");
          }
          c3Commands.forget(fingerprint);
          toast(`${adjustmentNo} 已${approved ? "执行" : "驳回"}`);
        } catch (err) {
          toast(errorMessage(err));
          return false;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const withdrawRequest = (row: UserAssetAdjustment) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    if (!adjustmentNo) return toast("缺少申请编号");
    openActionConfirm({
      action: `撤回调整申请 · ${adjustmentNo}`,
      detail: "只有提交人能撤回，撤回后余额不变。",
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "撤回后不能再批准或驳回。",
      run: async (withdrawReason) => {
        setBusy(true);
        const fingerprint = withdrawFingerprint(adjustmentNo, withdrawReason);
        const commandKey = c3Commands.get(fingerprint) ?? newIdempotencyKey("c3-withdraw");
        c3Commands.remember(fingerprint, commandKey);
        try {
          await withdrawUserAssetAdjustment(adjustmentNo, withdrawReason, OPERATOR(), commandKey);
          if (!await loadData(true)) throw new Error("可能已撤回，但页面没刷新出来，请直接重试");
          c3Commands.forget(fingerprint);
          toast(`${adjustmentNo} 已撤回`);
        } catch (err) {
          toast(errorMessage(err));
          return false;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const reverseAdjustment = (row: UserAssetAdjustment) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    if (!adjustmentNo) return toast("缺少调整单号");
    openActionConfirm({
      action: `冲正调整 · ${adjustmentNo}`,
      detail: `生成一笔金额相同、方向相反的调整，把原来那笔抵消掉。原记录保留，每笔只能冲正一次。`,
      amplifies: text(row.direction).toUpperCase() === "DEBIT",
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "确认后立即生效。",
      run: async (reverseReason) => {
        setBusy(true);
        try {
          const fingerprint = reverseFingerprint(adjustmentNo, reverseReason);
          const commandKey = c3Commands.get(fingerprint) ?? newIdempotencyKey("c3-reverse");
          c3Commands.remember(fingerprint, commandKey);
          const result = await reverseUserAssetAdjustment(adjustmentNo, reverseReason, OPERATOR(), commandKey);
          if (!await loadData(true)) {
            throw new Error("可能已冲正，但页面没刷新出来。请不要修改内容，直接重试（不会重复执行）");
          }
          c3Commands.forget(fingerprint);
          toast(`冲正已执行 · ${text(result.adjustmentNo)}`);
        } catch (err) {
          toast(errorMessage(err));
          return false;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const openDetail = (row: UserAssetAdjustment) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    if (!adjustmentNo) return;
    setDetailFallback(row);
    setDetail(null);
    setDetailLoading(true);
    fetchUserAssetAdjustmentDetail(adjustmentNo)
      .then(setDetail)
      .catch((err) => toast(errorMessage(err)))
      .finally(() => setDetailLoading(false));
  };

  const detailRow = detail?.adjustment ?? detailFallback;
  const selectedDisplay = selectedUser ? displayUser(selectedUser) : "";

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">已执行</div><div className="v">{number(overview?.approved).toLocaleString("en-US")} 笔</div><div className="sub">余额已变化</div></div>
        <div className="f-stat warn"><div className="k">待审核</div><div className="v">{number(overview?.pending).toLocaleString("en-US")} 笔</div><div className="sub">由提交人以外的同事复核</div></div>
        <div className="f-stat cyan"><div className="k">UVT 价格</div><div className="v">${formatNumber(nexUsdRate || overview?.nexUsdRate)}</div><div className="sub">用来换算是否超过 500 USDT 等值</div></div>
        <div className="f-stat ok"><div className="k">兑付覆盖率</div><div className="v">{formatPercent(coverageRatio)}</div><div className="sub">红线 {formatPercent(redlinePct)}</div></div>
      </div>

      {error && <div className="ctint warn" style={{ marginBottom: 12 }}>余额调整数据加载失败 · {error}</div>}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>正在加载…</div>}

      <div className="two-col r1-12">
        <section className="l-card">
          <div className="l-h"><span className="ttl">余额调整</span><span className="sub">· 选好账户后，右侧会显示调整后的余额</span></div>
          <div className="l-b">
            <div className="adj-form">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <span className="bf-legend">账户</span>
                <div style={{ flex: 1, minWidth: 260, position: "relative" }}>
                  <input
                    aria-label="选择资产调整账户"
                    value={userQuery}
                    onChange={(event) => {
                      const next = event.target.value;
                      setUserQuery(next);
                      if (selectedUser && next !== selectedDisplay) {
                        contextGeneration.current += 1;
                        setSelectedUser(null);
                        setContext(null);
                        setContextLoading(false);
                      }
                      setShowUserMenu(true);
                    }}
                    onFocus={() => setShowUserMenu(true)}
                    placeholder="搜索用户编码 / 用户名 / 手机号"
                    style={{ width: "100%" }}
                  />
                  {showUserMenu && (
                    <div role="listbox" style={{ position: "absolute", zIndex: 20, top: 36, left: 0, right: 0, maxHeight: 240, overflowY: "auto", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface)", boxShadow: "0 14px 38px rgba(0,0,0,.22)", padding: 6 }}>
                      {userSearchLoading && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-4)" }}>搜索中…</div>}
                      {!userSearchLoading && userOptions.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-4)" }}>无匹配用户</div>}
                      {!userSearchLoading && userOptions.map((account) => (
                        <button key={`${text(account.userNo)}-${accountId(account)}`} type="button" onClick={() => selectUser(account)} style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", border: 0, borderRadius: 6, background: accountId(account) === accountId(selectedUser) ? "var(--surface-2)" : "transparent", color: "var(--ink)", cursor: "pointer", textAlign: "left" }}>
                          <span><b className="mono">{text(account.userNo)}</b> · {operatorNicknameText(text(account.nickname))}</span>
                          <span style={{ color: "var(--ink-4)" }}>{text(account.phoneMasked)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {focusError && <div className="itint danger" role="alert">找不到会话中的客户：{focusError}<button className="l-btn sm" type="button" disabled={contextLoading} onClick={() => setFocusRetry(n => n + 1)}>重试</button></div>}
              {selectedAccount && (
                <div className="ctint cyan" data-proof="c3-target-card">
                  <b>{displayUser(selectedAccount)}</b> · 用户ID <span className="mono">{accountId(selectedAccount)}</span><br />
                  状态 {({ ACTIVE: "正常", FROZEN: "冻结", RESTRICTED: "受限", BANNED: "禁用" } as Record<string,string>)[text(selectedAccount.status).toUpperCase()] ?? "状态未知"} · 风险 {formatC1RiskBand(selectedAccount.riskBand)} / {text(selectedAccount.riskScore)} · 注册 {formatDate(selectedAccount.registeredAt)}<br />
                  USDT {formatNumber(selectedAccount.walletUsdt)} · UVT {formatNumber(selectedAccount.walletNex)} · 提现中 {formatNumber(context?.pendingWithdraw)} USDT
                </div>
              )}

              <div className="row"><TabGroup label="资产" labelClassName="bf-legend" value={asset} items={ASSETS} onSelect={setAsset} className="chips" itemClassName={(_item, selected) => `chip${selected ? " sel" : ""}`}>{(item) => nexGridBrandText(item)}</TabGroup></div>
              <div className="row"><TabGroup<Direction> label="方向" labelClassName="bf-legend" value={direction} items={["CREDIT", "DEBIT"]} onSelect={setDirection} className="chips" itemClassName={(_item, selected) => `chip${selected ? " sel" : ""}`}>{(item) => item === "CREDIT" ? "增加" : "扣减"}</TabGroup></div>
              <div className="row"><span className="bf-legend">金额</span><input aria-label="调整金额" value={amountText} onChange={(event) => setAmountText(event.target.value)} inputMode="decimal" style={{ width: 140 }} /><span style={{ fontSize: 12, color: "var(--ink-4)" }}>{asset === "UVT" ? `≈ $${formatUsdEquivalent(amountUsd)}` : "USDT"}</span></div>
              <div className="row"><TabGroup label="原因分类" labelClassName="bf-legend" value={reasonCode} items={REASON_CODES.map(([code]) => code)} onSelect={setReasonCode} className="chips" itemClassName={(_item, selected) => `chip${selected ? " sel" : ""}`}>{(code) => REASON_CODES.find(([value]) => value === code)?.[1]}</TabGroup></div>
              <div className="row" style={{ alignItems: "flex-start" }}><span className="bf-legend">详细原因</span><textarea className="ui-control" aria-label="详细原因" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="8–200 字，说明事实、判断和处理依据" rows={3} style={{ flex: 1 }} /><span style={{ fontSize: 12, color: reasonLength >= 8 && reasonLength <= 200 ? "var(--success)" : "var(--ink-4)" }}>{reasonLength}/200</span></div>
              <div className="row"><span className="bf-legend">凭证</span><input aria-label="证据引用" value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="例如：工单 20260718-001" style={{ flex: 1 }} /></div>
              <div className="row" style={{ justifyContent: "flex-end" }}><button className="l-btn mc" disabled={busy || !!formError} onClick={submitAdjustment}>提交调整申请</button></div>
              {formError && <div className="ctint warn">{formError}</div>}
            </div>
            <div className="ctint" style={{ marginTop: 12 }}>${formatNumber(largeThreshold)} 及以下：客服、财务可以提交；超过 ${formatNumber(largeThreshold)}：只有财务主管或超级管理员能处理。单笔最多 ${formatNumber(maxAmount)} USDT 等值。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">调整后会怎样</span></div>
          <div className="l-b">
            {/* 🔴 zentao #231:未选账户时**不能**展示余额与覆盖率。此前本块无条件渲染,
                于是 currentBalance 取到 number(undefined)=0 显示成「0 USDT」,覆盖率则来自
                全局 overview.coverage —— 一个与所选账户无关的百分比被摆在「本次调整的影响」
                位置上,读起来像是这笔操作的结果。页面别处(账户摘要)早已用 selectedAccount
                门控,这里漏了。覆盖率总览另有独立卡片,不受此影响。 */}
            {!selectedAccount && (
              <div className="ctint cyan" style={{ marginBottom: 12 }}>请先选择账户，这里会显示调整后的余额和覆盖率。</div>
            )}
            <div className="kv"><span className="k">账户</span><span className="v">{displayUser(selectedAccount)}</span></div>
            <div className="kv"><span className="k">当前余额</span><span className="v mono">{selectedAccount ? `${formatNumber(currentBalance)} ${nexGridBrandText(asset)}` : "—"}</span></div>
            <div className="kv"><span className="k">批准后余额</span><span className="v mono" style={{ color: debitInsufficient ? "var(--danger)" : "var(--ink)" }}>{selectedAccount ? `${formatNumber(balanceAfter)} ${nexGridBrandText(asset)}` : "—"}</span></div>
            <div className="kv"><span className="k">USDT 等值</span><span className="v mono">{selectedAccount ? `$${formatUsdEquivalent(amountUsd)}` : "—"}</span></div>
            <div className="kv"><span className="k">当前兑付覆盖率</span><span className="v">{selectedAccount ? formatPercent(coverageRatio) : "—"}</span></div>
            <div className="kv"><span className="k">批准后兑付覆盖率</span><span className="v" style={{ color: selectedAccount && (creditCoverageUnavailable || creditBelowRedline) ? "var(--danger)" : "var(--success)" }}>{selectedAccount ? formatPercent(projectedCoverage) : "—"}</span></div>
            <div className="kv"><span className="k">红线</span><span className="v">{selectedAccount ? formatPercent(redlinePct) : "—"}</span></div>
            <div className="ctint cyan" style={{ marginTop: 14 }}><b>流程</b> · 提交后余额不会马上变，需由另一位同事复核批准后才生效。</div>
          </div>
        </section>
      </div>

      <section className="l-card" data-restored-capability="c3-pending-request-withdrawal">
          <div className="l-h"><span className="ttl">待审核的调整</span><span className="sub">· 批准前余额不变</span><div className="r"><button type="button" className="l-btn sm" aria-label="刷新待审核的调整" disabled={loading || busy} onClick={() => void loadData(true)}>刷新列</button></div></div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 920 }}>
              <thead><tr><th>申请编号</th><th>账户</th><th>金额</th><th>原因</th><th>凭证</th><th>提交人</th><th style={{ textAlign: "right" }}>处理</th></tr></thead>
              <tbody>
                {requests.records.map((row) => (
                  <tr key={text(row.adjustmentNo)}>
                    <td className="mono">{text(row.adjustmentNo)}</td><td>{displayRowUser(row)}</td>
                    <td className="mono">{text(row.direction) === "CREDIT" ? "+" : "−"}{formatNumber(row.amount)} {nexGridBrandText(text(row.asset))}（${formatUsdEquivalent(row.amountUsd)}）</td>
                    <td>{text(row.reason)}</td><td className="mono">{text(row.evidenceRef)}</td><td>{text(row.maker)}</td>
                    <td style={{ textAlign: "right" }}><span style={{ display: "inline-flex", gap: 6 }}>
                      {canCreate && text(row.maker).toLowerCase() === OPERATOR().toLowerCase() && <button className="l-btn sm" disabled={busy} onClick={() => withdrawRequest(row)}>撤回</button>}
                      {canApprove && text(row.maker).toLowerCase() !== OPERATOR().toLowerCase() && <><button className="l-btn sm primary" disabled={busy} onClick={() => reviewLargeRequest(row, true)}>批准</button><button className="l-btn sm" disabled={busy} onClick={() => reviewLargeRequest(row, false)}>驳回</button></>}
                      {(!canApprove && !(canCreate && text(row.maker).toLowerCase() === OPERATOR().toLowerCase())) && <span style={{ color: "var(--ink-4)", fontSize: 12 }}>等待其他同事复核</span>}
                    </span></td>
                  </tr>
                ))}
                {!requests.records.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无待审核的调整</td></tr>}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="待审核的调整"
            page={requestPage}
            pageSize={requestPageSize}
            total={requests.total}
            onPageChange={setRequestPage}
            onPageSizeChange={(next) => { setRequestPageSize(next); setRequestPage(1); }}
            pageSizeOptions={[5, 10, 20, 50]}
          />
      </section>

      <section className="l-card">
        <div className="l-h"><span className="ttl">调整历史</span><span className="sub">· 已生效和已拒绝的</span><div className="r"><TabGroup label="调整历史资产筛选" value={historyFilter} items={HISTORY_FILTERS} onSelect={(item) => { setHistoryFilter(item); setHistoryPage(1); }} className="chips" itemClassName={(_item, selected) => `chip${selected ? " sel" : ""}`}>{(item) => nexGridBrandText(item)}</TabGroup></div></div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1120 }}>
            <thead><tr><th>调整单</th><th>账户</th><th>资产</th><th className="num">增减</th><th>原因</th><th>凭证</th><th>状态</th><th>账单</th><th>时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {history.records.map((row) => {
                const approvedOriginal = text(row.status).toUpperCase() === "APPROVED" && !row.reversalOf && !row.reversedBy;
                const sign = text(row.direction).toUpperCase() === "CREDIT" ? "+" : "−";
                return (
                  <tr key={text(row.adjustmentNo)} className="click" onClick={() => openDetail(row)}>
                    <td className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{text(row.adjustmentNo)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                    <td>{displayRowUser(row)}</td><td><span className="bdg dim">{nexGridBrandText(text(row.asset))}</span></td>
                    <td className="num mono" style={{ fontWeight: 700, color: row.credit ? "var(--success)" : "var(--danger)" }}>{sign}{formatNumber(row.amount)} {nexGridBrandText(text(row.asset))}</td>
                    <td style={{ fontSize: 12 }}>{text(row.reason)}</td><td className="mono" style={{ fontSize: 11.5 }}>{text(row.evidenceRef)}</td>
                    <td><span className={`bdg ${statusTone(row)}`}>{statusLabel(row)}</span>{row.reversalOf && <span className="bdg cyan" style={{ marginLeft: 6 }}>冲正单</span>}{row.reversedBy && <span className="bdg dim" style={{ marginLeft: 6 }}>已冲正</span>}</td>
                    <td onClick={(event) => event.stopPropagation()}>{row.ledgerId && canReadLedger ? <Link href={`/finance/ledger?bizNo=${encodeURIComponent(text(row.adjustmentNo, ""))}`} className="mono" style={{ color: "var(--c-ac)" }}>#{text(row.ledgerId)} →</Link> : row.ledgerId ? <span title="当前角色无账本查看权限">已生成</span> : "—"}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{formatDate(row.reviewedAt ?? row.updatedAt ?? row.createdAt)}</td>
                    <td style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>{approvedOriginal && canReverse ? <button className="l-btn sm mc" disabled={busy} onClick={() => reverseAdjustment(row)}>冲正</button> : <span style={{ color: "var(--ink-4)", fontSize: 12 }}>{approvedOriginal ? "无冲正权限" : "不可冲正"}</span>}</td>
                  </tr>
                );
              })}
              {history.records.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无调整历史</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager label="余额调整历史" page={historyPage} pageSize={historyPageSize} total={history.total} onPageChange={setHistoryPage} onPageSizeChange={(next) => { setHistoryPageSize(next); setHistoryPage(1); }} pageSizeOptions={[5, 10, 20, 50]} />
      </section>

      <p className="f-foot">余额调整只用于纠错和补偿。调错了用「冲正」抵消，原记录会保留。</p>

      {detailRow && (
        <Drawer title={`调整单明细 · ${text(detailRow.adjustmentNo)}`} sub={`${displayRowUser(detailRow)} · ${nexGridBrandText(text(detailRow.asset))}`} onClose={() => { setDetail(null); setDetailFallback(null); }} footer={detailRow.ledgerId && canReadLedger ? <Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href={`/finance/ledger?bizNo=${encodeURIComponent(text(detailRow.adjustmentNo, ""))}`}>定位关联账单 →</Link> : undefined}>
          {detailLoading && <div className="ctint" style={{ marginBottom: 12 }}>正在加载…</div>}
          <div className="kv"><span className="k">状态</span><span className="v"><span className={`bdg ${statusTone(detailRow)}`}>{statusLabel(detailRow)}</span></span></div>
          <div className="kv"><span className="k">金额</span><span className="v">{text(detailRow.direction) === "CREDIT" ? "+" : "−"}{formatNumber(detailRow.amount)} {nexGridBrandText(text(detailRow.asset))}（${formatUsdEquivalent(detailRow.amountUsd)}）</span></div>
          <div className="kv"><span className="k">执行后余额</span><span className="v">{formatNumber(detailRow.balanceAfter)} {nexGridBrandText(text(detailRow.asset))}</span></div>
          <div className="kv"><span className="k">原因分类</span><span className="v">{reasonCodeLabel(detailRow.reasonCode)}</span></div>
          <div className="kv"><span className="k">详细原因</span><span className="v">{text(detailRow.reason)}</span></div>
          <div className="kv"><span className="k">凭证</span><span className="v mono">{text(detailRow.evidenceRef)}</span></div>
          <div className="kv"><span className="k">请求编号</span><span className="v mono">{text(detailRow.idempotencyKey)}</span></div>
          <div className="kv"><span className="k">原调整单</span><span className="v mono">{text(detailRow.reversalOf)}</span></div>
          <div className="kv"><span className="k">冲正单</span><span className="v mono">{text(detailRow.reversedBy)}</span></div>
          <div className="kv"><span className="k">账单号</span><span className="v mono">{text(detailRow.ledgerId)}</span></div>
          <div className="kv"><span className="k">操作人</span><span className="v">{text(detailRow.maker)}</span></div>
          <div className="kv"><span className="k">执行时间</span><span className="v">{formatDate(detailRow.reviewedAt ?? detailRow.updatedAt)}</span></div>
          
        </Drawer>
      )}
    </>
  );
}
