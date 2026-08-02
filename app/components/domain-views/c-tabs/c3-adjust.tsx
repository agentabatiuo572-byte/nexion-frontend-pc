"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { currentAdminOperator } from "@/lib/admin/current-operator";
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
const ASSETS = ["USDT", "NEX"] as const;
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
const HISTORY_FILTERS = ["全部", "USDT", "NEX"] as const;

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
  return `${text(account.userNo)} · ${text(account.nickname)}`;
}

function displayRowUser(row: UserAssetAdjustment) {
  return `${text(row.userNo)} · ${text(row.nickname)}`;
}

function statusTone(row: UserAssetAdjustment) {
  const status = text(row.status).toUpperCase();
  if (status === "APPROVED") return "ok";
  if (status === "REJECTED") return "bad";
  return "warn";
}

function statusLabel(row: UserAssetAdjustment) {
  return text(row.statusLabel, text(row.status));
}

function reasonCodeLabel(value: unknown) {
  return REASON_CODE_LABELS[text(value, "").toUpperCase()] ?? "其他已核验原因";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "余额调整请求失败，请刷新后重试";
}

function newIdempotencyKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function C3Adjust({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canCreate = authorities.includes("user_c3_adjust_create");
  const canApprove = authorities.includes("user_c3_adjust_approve");
  const canReverse = authorities.includes("user_c3_adjust_reverse");
  const canReadLedger = authorities.includes("finance_d4_read");
  const isSupport = session?.role === "support";
  const isFinance = session?.role === "finance";
  const [overview, setOverview] = useState<UserAssetAdjustmentOverview | null>(null);
  const [requests, setRequests] = useState<UserPage<UserAssetAdjustment>>(() => emptyPage(5));
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
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [asset, setAsset] = useState<Asset>("USDT");
  const [direction, setDirection] = useState<Direction>("CREDIT");
  const [amountText, setAmountText] = useState("120");
  const [reasonCode, setReasonCode] = useState("SUPPORT_COMPENSATION");
  const [reason, setReason] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [submission, setSubmission] = useState<{ fingerprint: string; key: string } | null>(null);
  const [detail, setDetail] = useState<UserAssetAdjustmentDetail | null>(null);
  const [detailFallback, setDetailFallback] = useState<UserAssetAdjustment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const reviewCommandKeys = useRef(new Map<string, string>());
  const reverseCommandKeys = useRef(new Map<string, string>());

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const historyAsset = historyFilter === "全部" ? undefined : historyFilter;
      const [nextOverview, nextHistory, nextRequests] = await Promise.all([
        fetchUserAssetAdjustmentOverview(),
        fetchUserAssetAdjustments({ asset: historyAsset, historyOnly: true, pageNum: historyPage, pageSize: historyPageSize }),
        fetchUserAssetAdjustments({ status: "PENDING_REVIEW", pageNum: 1, pageSize: 5 }),
      ]);
      setOverview(nextOverview);
      setHistory(nextHistory);
      setRequests(nextRequests);
      return true;
    } catch (err) {
      setOverview(null);
      setHistory(emptyPage(historyPageSize));
      setRequests(emptyPage(5));
      setError(errorMessage(err));
      return false;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [historyFilter, historyPage, historyPageSize]);

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

  const selectedAccount = context?.account ?? null;
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
    ? "余额调整权威数据不可用，请重新加载后再操作"
    : !selectedAccount
    ? contextLoading ? "账户资金信息加载中" : "请先选择账户并等待资金信息校验完成"
    : contextLoading
      ? "账户资金信息加载中"
      : !amountFormatValid || !Number.isFinite(amount)
        ? "金额需使用普通数字格式，且最多保留 6 位小数"
        : amount <= 0
          ? "金额必须大于 0"
        : amountUsd > maxAmount
          ? `单笔金额不得超过 ${formatNumber(maxAmount)} USDT 等值`
          : asset === "NEX" && nexUsdRate <= 0
            ? "当前 NEX 价格不可用，暂不能提交"
            : debitInsufficient
              ? "扣减后余额不足"
              : reasonLength < 8 || reasonLength > 200
                ? "详细原因需填写 8–200 个字符"
                : evidenceRef.trim().length < 3
                  ? "请填写工单号、凭证号等证据引用"
                  : creditCoverageUnavailable && !supportLargeRequest
                    ? "当前资金覆盖率不可可靠计算，暂不能执行增加余额"
                  : creditBelowRedline && !supportLargeRequest
                    ? "入账后资金覆盖率将低于红线"
                    : largeAdjustment && isFinance
                      ? "超过 500 USDT 等值需由财务主管或超级管理员执行"
                    : null;

  const selectUser = (account: User360Profile) => {
    const id = accountId(account);
    setSelectedUser(account);
    setContext(null);
    setUserQuery(displayUser(account));
    setShowUserMenu(false);
    if (!id) {
      toast("该账户缺少有效的用户ID");
      return;
    }
    setContextLoading(true);
    fetchUserAssetAdjustmentContext(id)
      .then(setContext)
      .catch((err) => toast(errorMessage(err)))
      .finally(() => setContextLoading(false));
  };

  const submitAdjustment = () => {
    if (formError || !selectedAccount) {
      toast(formError ?? "请检查表单");
      return;
    }
    const id = accountId(selectedAccount);
    if (!id) return toast("账户缺少有效的用户ID");
    const fingerprint = JSON.stringify({ id, asset, direction, amount: amountText.trim(), reasonCode, reason: reason.trim(), evidenceRef: evidenceRef.trim() });
    const key = submission?.fingerprint === fingerprint ? submission.key : newIdempotencyKey("c3-adjust");
    setSubmission({ fingerprint, key });
    const supportRequest = supportLargeRequest;
    openConfirm({
      action: supportRequest
        ? `提交大额调整请求 · ${formatNumber(amount)} ${asset}`
        : `提交${direction === "CREDIT" ? "增加" : "扣减"}调整申请 · ${formatNumber(amount)} ${asset}`,
      detail: supportRequest
        ? `${displayUser(selectedAccount)}；客服不能直接执行超过 500 USDT 等值的调整，本次只生成待独立复核请求，不改变余额。`
        : `${displayUser(selectedAccount)}；本次只生成待复核调整，不改变余额。独立复核员批准后才更新余额并生成关联账单。网络重试或重复提交不会重复入账。`,
      chips: supportRequest ? [["只建请求", "ready"], ["余额不变", "ready"]] : [["待独立复核", "ready"], ["余额不变", "ready"]],
      reason: false,
      okLabel: supportRequest ? "确认提交请求" : "确认提交调整申请",
      run: async () => {
        setBusy(true);
        try {
          const input = {
            asset, direction, amount: amountText.trim(), reasonCode, reason: reason.trim(), evidenceRef: evidenceRef.trim(),
            operator: OPERATOR(), idempotencyKey: key,
          } as const;
          const result = supportRequest
            ? await requestLargeUserAssetAdjustment(id, input)
            : await createUserAssetAdjustment(id, input);
          const [loaded] = await Promise.all([loadData(true), fetchUserAssetAdjustmentContext(id).then(setContext)]);
          if (!loaded) throw new Error("操作可能已成功，但结果回读失败；请保留当前表单并使用同一请求重试");
          setSubmission(null);
          setAmountText("");
          setReason("");
          setEvidenceRef("");
          toast(supportRequest
            ? `大额调整请求已提交 · ${text(result.requestNo)}`
            : `调整申请已提交 · ${text(result.adjustmentNo)} · 等待独立复核`);
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
    if (!adjustmentNo) return toast("请求编号缺失");
    openActionConfirm({
      action: `${approved ? "批准" : "驳回"}待复核调整 · ${adjustmentNo}`,
      detail: `${displayRowUser(row)} · ${text(row.direction) === "CREDIT" ? "+" : "−"}${formatNumber(row.amount)} ${text(row.asset)} · ${text(row.reason)}`,
      amplifies: approved && text(row.direction).toUpperCase() === "CREDIT",
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: approved ? "批准后才更新余额并生成关联账单。" : "驳回后请求关闭且余额不变。",
      run: async (reviewReason) => {
        setBusy(true);
        try {
          const fingerprint = `${approved ? "approve" : "reject"}|${adjustmentNo}|${reviewReason}`;
          const commandKey = reviewCommandKeys.current.get(fingerprint)
            ?? newIdempotencyKey(approved ? "c3-approve" : "c3-reject");
          reviewCommandKeys.current.set(fingerprint, commandKey);
          if (approved) await approveUserAssetAdjustment(adjustmentNo, reviewReason, OPERATOR(), commandKey);
          else await rejectUserAssetAdjustment(adjustmentNo, reviewReason, OPERATOR(), commandKey);
          if (!await loadData(true)) {
            throw new Error("操作可能已成功，但结果回读失败；请保留当前确认框并使用同一请求重试");
          }
          reviewCommandKeys.current.delete(fingerprint);
          toast(`${adjustmentNo} 已${approved ? "批准" : "驳回"}`);
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
    if (!adjustmentNo) return toast("调整单号缺失");
    openActionConfirm({
      action: `冲正调整 · ${adjustmentNo}`,
      detail: `将创建一条与原单金额相同、方向相反的新调整并立即记账；原记录保持不变，且同一原单只能冲正一次。`,
      amplifies: text(row.direction).toUpperCase() === "DEBIT",
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "确认后立即冲正，并保留原单、新单、账单和审计关联。",
      run: async (reverseReason) => {
        setBusy(true);
        try {
          const fingerprint = `${adjustmentNo}|${reverseReason}`;
          const commandKey = reverseCommandKeys.current.get(fingerprint) ?? newIdempotencyKey("c3-reverse");
          reverseCommandKeys.current.set(fingerprint, commandKey);
          const result = await reverseUserAssetAdjustment(adjustmentNo, reverseReason, OPERATOR(), commandKey);
          if (!await loadData(true)) {
            throw new Error("冲正可能已成功，但结果回读失败；请保留当前确认框并使用同一请求重试");
          }
          reverseCommandKeys.current.delete(fingerprint);
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
        <div className="f-stat"><div className="k">已执行</div><div className="v">{number(overview?.approved).toLocaleString("en-US")} 笔</div><div className="sub">余额与账单均已落地</div></div>
        <div className="f-stat warn"><div className="k">待复核调整</div><div className="v">{number(overview?.pending).toLocaleString("en-US")} 笔</div><div className="sub">提交后由独立复核员处理</div></div>
        <div className="f-stat cyan"><div className="k">NEX 价格</div><div className="v">${formatNumber(nexUsdRate || overview?.nexUsdRate)}</div><div className="sub">用于 500 USDT 等值权限判断</div></div>
        <div className="f-stat ok"><div className="k">资金覆盖率</div><div className="v">{formatPercent(coverageRatio)}</div><div className="sub">红线 {formatPercent(redlinePct)}</div></div>
      </div>

      {error && <div className="ctint warn" style={{ marginBottom: 12 }}>余额调整数据加载失败 · {error}</div>}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>余额调整数据加载中...</div>}

      <div className="two-col r1-12">
        <section className="l-card">
          <div className="l-h"><span className="ttl">余额调整</span><span className="sub">· 选择账户后立即预览影响</span></div>
          <div className="l-b">
            <div className="adj-form">
              <div className="row" style={{ alignItems: "flex-start" }}>
                <label>账户</label>
                <div style={{ flex: 1, minWidth: 260, position: "relative" }}>
                  <input
                    value={userQuery}
                    onChange={(event) => {
                      const next = event.target.value;
                      setUserQuery(next);
                      if (selectedUser && next !== selectedDisplay) { setSelectedUser(null); setContext(null); }
                      setShowUserMenu(true);
                    }}
                    onFocus={() => setShowUserMenu(true)}
                    placeholder="搜索用户编码 / 用户名 / 手机号"
                    style={{ width: "100%" }}
                  />
                  {showUserMenu && (
                    <div role="listbox" style={{ position: "absolute", zIndex: 20, top: 36, left: 0, right: 0, maxHeight: 240, overflowY: "auto", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface)", boxShadow: "0 14px 38px rgba(0,0,0,.22)", padding: 6 }}>
                      {userSearchLoading && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-4)" }}>搜索中...</div>}
                      {!userSearchLoading && userOptions.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-4)" }}>无匹配用户</div>}
                      {!userSearchLoading && userOptions.map((account) => (
                        <button key={`${text(account.userNo)}-${accountId(account)}`} type="button" onClick={() => selectUser(account)} style={{ width: "100%", display: "flex", justifyContent: "space-between", gap: 10, padding: "8px 10px", border: 0, borderRadius: 6, background: accountId(account) === accountId(selectedUser) ? "var(--surface-2)" : "transparent", color: "var(--ink)", cursor: "pointer", textAlign: "left" }}>
                          <span><b className="mono">{text(account.userNo)}</b> · {text(account.nickname)}</span>
                          <span style={{ color: "var(--ink-4)" }}>{text(account.phoneMasked)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {selectedAccount && (
                <div className="ctint cyan" data-proof="c3-target-card">
                  <b>{displayUser(selectedAccount)}</b> · 用户ID <span className="mono">{accountId(selectedAccount)}</span><br />
                  状态 {text(selectedAccount.status)} · KYC {text(selectedAccount.kycStatus)} · 风险 {text(selectedAccount.riskBand)} / {text(selectedAccount.riskScore)} · 注册 {formatDate(selectedAccount.registeredAt)}<br />
                  USDT {formatNumber(selectedAccount.walletUsdt)} · NEX {formatNumber(selectedAccount.walletNex)} · 提现处理中 {formatNumber(context?.pendingWithdraw)} USDT
                </div>
              )}

              <div className="row"><label>资产</label><div className="chips">{ASSETS.map((item) => <button type="button" key={item} className={`chip${asset === item ? " sel" : ""}`} onClick={() => setAsset(item)}>{item}</button>)}</div></div>
              <div className="row"><label>方向</label><div className="chips"><button type="button" className={`chip${direction === "CREDIT" ? " sel" : ""}`} onClick={() => setDirection("CREDIT")}>增加</button><button type="button" className={`chip${direction === "DEBIT" ? " sel" : ""}`} onClick={() => setDirection("DEBIT")}>扣减</button></div></div>
              <div className="row"><label>金额</label><input aria-label="调整金额" value={amountText} onChange={(event) => setAmountText(event.target.value)} inputMode="decimal" style={{ width: 140 }} /><span style={{ fontSize: 12, color: "var(--ink-4)" }}>{asset === "NEX" ? `≈ $${formatUsdEquivalent(amountUsd)}` : "USDT"}</span></div>
              <div className="row"><label>原因分类</label><div className="chips">{REASON_CODES.map(([code, label]) => <button type="button" key={code} className={`chip${reasonCode === code ? " sel" : ""}`} onClick={() => setReasonCode(code)}>{label}</button>)}</div></div>
              <div className="row" style={{ alignItems: "flex-start" }}><label>详细原因</label><textarea aria-label="详细原因" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="8–200 字，说明事实、判断和处理依据" rows={3} style={{ flex: 1 }} /><span style={{ fontSize: 12, color: reasonLength >= 8 && reasonLength <= 200 ? "var(--success)" : "var(--ink-4)" }}>{reasonLength}/200</span></div>
              <div className="row"><label>证据引用</label><input aria-label="证据引用" value={evidenceRef} onChange={(event) => setEvidenceRef(event.target.value)} placeholder="例如：工单 20260718-001" style={{ flex: 1 }} /></div>
              <div className="row" style={{ justifyContent: "flex-end" }}><button className="l-btn mc" disabled={busy || !!formError} onClick={submitAdjustment}>{isSupport && largeAdjustment ? "提交大额调整请求" : "提交调整申请"}</button></div>
              {formError && <div className="ctint warn">{formError}</div>}
            </div>
            <div className="ctint" style={{ marginTop: 12 }}>≤ ${formatNumber(largeThreshold)}：客服、财务可执行；&gt; ${formatNumber(largeThreshold)}：仅财务主管、超级管理员可执行。单笔上限 ${formatNumber(maxAmount)} USDT 等值。</div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h"><span className="ttl">执行影响预览</span><span className="sub">· 提交前核对余额与覆盖率</span></div>
          <div className="l-b">
            <div className="kv"><span className="k">目标账户</span><span className="v">{displayUser(selectedAccount)}</span></div>
            <div className="kv"><span className="k">当前余额</span><span className="v mono">{formatNumber(currentBalance)} {asset}</span></div>
            <div className="kv"><span className="k">批准后余额预估</span><span className="v mono" style={{ color: debitInsufficient ? "var(--danger)" : "var(--ink)" }}>{formatNumber(balanceAfter)} {asset}</span></div>
            <div className="kv"><span className="k">USDT 等值</span><span className="v mono">${formatUsdEquivalent(amountUsd)}</span></div>
            <div className="kv"><span className="k">当前覆盖率</span><span className="v">{formatPercent(coverageRatio)}</span></div>
            <div className="kv"><span className="k">批准后覆盖率预估</span><span className="v" style={{ color: creditCoverageUnavailable || creditBelowRedline ? "var(--danger)" : "var(--success)" }}>{formatPercent(projectedCoverage)}</span></div>
            <div className="kv"><span className="k">红线</span><span className="v">{formatPercent(redlinePct)}</span></div>
            <div className="ctint cyan" style={{ marginTop: 14 }}><b>复核闭环</b> · 提交仅落待复核申请与必达审计；独立复核员批准后，才原子完成余额更新、财务账单与两类业务事件。</div>
          </div>
        </section>
      </div>

      {requests.total > 0 && (
        <section className="l-card">
          <div className="l-h"><span className="ttl">待复核调整</span><span className="sub">· 提交阶段不改变余额</span></div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 920 }}>
              <thead><tr><th>请求编号</th><th>账户</th><th>金额</th><th>原因</th><th>证据</th><th>发起人</th><th style={{ textAlign: "right" }}>处理</th></tr></thead>
              <tbody>{requests.records.map((row) => (
                <tr key={text(row.adjustmentNo)}>
                  <td className="mono">{text(row.adjustmentNo)}</td><td>{displayRowUser(row)}</td>
                  <td className="mono">{text(row.direction) === "CREDIT" ? "+" : "−"}{formatNumber(row.amount)} {text(row.asset)}（${formatUsdEquivalent(row.amountUsd)}）</td>
                  <td>{text(row.reason)}</td><td className="mono">{text(row.evidenceRef)}</td><td>{text(row.maker)}</td>
                  <td style={{ textAlign: "right" }}>{canApprove ? <span style={{ display: "inline-flex", gap: 6 }}><button className="l-btn sm primary" disabled={busy} onClick={() => reviewLargeRequest(row, true)}>批准</button><button className="l-btn sm" disabled={busy} onClick={() => reviewLargeRequest(row, false)}>驳回</button></span> : <span style={{ color: "var(--ink-4)", fontSize: 12 }}>等待独立复核</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      <section className="l-card">
        <div className="l-h"><span className="ttl">调整历史</span><span className="sub">· 已执行与已拒绝记录</span><div className="r"><div className="chips">{HISTORY_FILTERS.map((item) => <button type="button" key={item} className={`chip${historyFilter === item ? " sel" : ""}`} onClick={() => { setHistoryFilter(item); setHistoryPage(1); }}>{item}</button>)}</div></div></div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1120 }}>
            <thead><tr><th>调整单</th><th>账户</th><th>资产</th><th className="num">增减</th><th>原因</th><th>证据</th><th>状态</th><th>账单</th><th>时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {history.records.map((row) => {
                const approvedOriginal = text(row.status).toUpperCase() === "APPROVED" && !row.reversalOf && !row.reversedBy;
                const sign = text(row.direction).toUpperCase() === "CREDIT" ? "+" : "−";
                return (
                  <tr key={text(row.adjustmentNo)} className="click" onClick={() => openDetail(row)}>
                    <td className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{text(row.adjustmentNo)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                    <td>{displayRowUser(row)}</td><td><span className="bdg dim">{text(row.asset)}</span></td>
                    <td className="num mono" style={{ fontWeight: 700, color: row.credit ? "var(--success)" : "var(--danger)" }}>{sign}{formatNumber(row.amount)} {text(row.asset)}</td>
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

      <p className="f-foot"><b>余额调整用于纠错与补偿</b>。提交后等待独立复核；只有批准才生效并记账；拒绝时不改余额；冲正以新的反向记录完成，不覆盖历史。</p>

      {detailRow && (
        <Drawer title={`调整单明细 · ${text(detailRow.adjustmentNo)}`} sub={`${displayRowUser(detailRow)} · ${text(detailRow.asset)}`} onClose={() => { setDetail(null); setDetailFallback(null); }} footer={detailRow.ledgerId && canReadLedger ? <Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href={`/finance/ledger?bizNo=${encodeURIComponent(text(detailRow.adjustmentNo, ""))}`}>定位关联账单 →</Link> : undefined}>
          {detailLoading && <div className="ctint" style={{ marginBottom: 12 }}>明细加载中...</div>}
          <div className="kv"><span className="k">状态</span><span className="v"><span className={`bdg ${statusTone(detailRow)}`}>{statusLabel(detailRow)}</span></span></div>
          <div className="kv"><span className="k">金额</span><span className="v">{text(detailRow.direction) === "CREDIT" ? "+" : "−"}{formatNumber(detailRow.amount)} {text(detailRow.asset)}（${formatUsdEquivalent(detailRow.amountUsd)}）</span></div>
          <div className="kv"><span className="k">执行后余额</span><span className="v">{formatNumber(detailRow.balanceAfter)} {text(detailRow.asset)}</span></div>
          <div className="kv"><span className="k">原因分类</span><span className="v">{reasonCodeLabel(detailRow.reasonCode)}</span></div>
          <div className="kv"><span className="k">详细原因</span><span className="v">{text(detailRow.reason)}</span></div>
          <div className="kv"><span className="k">证据引用</span><span className="v mono">{text(detailRow.evidenceRef)}</span></div>
          <div className="kv"><span className="k">请求唯一标识</span><span className="v mono">{text(detailRow.idempotencyKey)}</span></div>
          <div className="kv"><span className="k">原调整单</span><span className="v mono">{text(detailRow.reversalOf)}</span></div>
          <div className="kv"><span className="k">冲正调整单</span><span className="v mono">{text(detailRow.reversedBy)}</span></div>
          <div className="kv"><span className="k">账单号</span><span className="v mono">{text(detailRow.ledgerId)}</span></div>
          <div className="kv"><span className="k">操作人</span><span className="v">{text(detailRow.maker)}</span></div>
          <div className="kv"><span className="k">执行时间</span><span className="v">{formatDate(detailRow.reviewedAt ?? detailRow.updatedAt)}</span></div>
          <div className="ctint cyan" style={{ marginTop: 14 }}><b>数据来源</b> · 余额调整、用户账户、资金覆盖率、必达审计</div>
        </Drawer>
      )}
    </>
  );
}
