"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DataListPager, Drawer } from "../design-kit";
import {
  approveUserAssetAdjustment,
  createUserAssetAdjustment,
  fetchUserAssetAdjustmentDetail,
  fetchUserAssetAdjustmentOverview,
  fetchUserAssetAdjustments,
  fetchUserProfilesPage,
  rejectUserAssetAdjustment,
  type User360Profile,
  type UserAssetAdjustment,
  type UserAssetAdjustmentDetail,
  type UserAssetAdjustmentOverview,
  type UserPage,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const ASSETS = ["USDT", "NEX"] as const;
const DIRECTIONS = ["增加", "扣减"] as const;
const REASON_CODES = ["客服补偿", "系统纠错", "活动补发", "争议退回"] as const;
const HISTORY_FILTERS = ["全部", "USDT", "NEX"] as const;
const PENDING_STATUSES = new Set(["PENDING", "PENDING_REVIEW"]);

type Asset = (typeof ASSETS)[number];
type DirectionLabel = (typeof DIRECTIONS)[number];
type HistoryFilter = (typeof HISTORY_FILTERS)[number];

function emptyPage<T>(pageSize: number): UserPage<T> {
  return { total: 0, pageNum: 1, pageSize, records: [] };
}

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function asNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function accountId(account: User360Profile | null | undefined) {
  return account?.id === null || account?.id === undefined ? "" : String(account.id);
}

function displayUser(account: Pick<User360Profile, "userNo" | "nickname" | "phoneMasked"> | null | undefined) {
  if (!account) return "—";
  const code = text(account.userNo);
  const name = text(account.nickname, "");
  return name ? `${code} · ${name}` : code;
}

function displayRowUser(row: UserAssetAdjustment) {
  const code = text(row.userNo);
  const name = text(row.nickname, "");
  return name ? `${code} · ${name}` : code;
}

function formatDate(value: unknown, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatAmountValue(value: unknown) {
  return asNumber(value).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

function formatAdjustmentAmount(row: UserAssetAdjustment) {
  const asset = text(row.asset, "USDT").toUpperCase();
  const sign = text(row.direction).toUpperCase() === "CREDIT" ? "+" : "-";
  const amount = formatAmountValue(row.amount);
  return asset === "USDT" ? `${sign}$${amount}` : `${sign}${amount} ${asset}`;
}

function statusTone(row: UserAssetAdjustment) {
  const tone = text(row.statusTone, "");
  if (tone) return tone;
  const status = text(row.status).toUpperCase();
  if (status === "APPROVED") return "ok";
  if (status === "REJECTED" || status === "SUSPENDED") return "bad";
  return "warn";
}

function statusLabel(row: UserAssetAdjustment) {
  return text(row.statusLabel, text(row.status, "待复核"));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "C3_REQUEST_FAILED";
}

export function C3Adjust({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [overview, setOverview] = useState<UserAssetAdjustmentOverview | null>(null);
  const [pending, setPending] = useState<UserPage<UserAssetAdjustment>>(() => emptyPage(10));
  const [suspended, setSuspended] = useState<UserPage<UserAssetAdjustment>>(() => emptyPage(5));
  const [history, setHistory] = useState<UserPage<UserAssetAdjustment>>(() => emptyPage(10));
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingPageSize, setPendingPageSize] = useState(10);
  const [suspendedPage, setSuspendedPage] = useState(1);
  const [suspendedPageSize, setSuspendedPageSize] = useState(5);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("全部");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seedReady, setSeedReady] = useState(false);

  const [userQuery, setUserQuery] = useState("");
  const [userOptions, setUserOptions] = useState<User360Profile[]>([]);
  const [selectedUser, setSelectedUser] = useState<User360Profile | null>(null);
  const [userSearchLoading, setUserSearchLoading] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const [asset, setAsset] = useState<Asset>("USDT");
  const [direction, setDirection] = useState<DirectionLabel>("增加");
  const [amountText, setAmountText] = useState("120");
  const [reasonCode, setReasonCode] = useState<(typeof REASON_CODES)[number]>("客服补偿");
  const [detail, setDetail] = useState<UserAssetAdjustmentDetail | null>(null);
  const [detailFallback, setDetailFallback] = useState<UserAssetAdjustment | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const capUsd = asNumber(overview?.singleCreditReviewCapUsd, 500);
  const coverage = overview?.coverage ?? {};
  const coverageRatio = asNumber(coverage["coverageRatio"]);
  const redlinePct = asNumber(coverage["redlinePct"]);
  const pendingEscalated = useMemo(() => pending.records.filter((row) => !!row.escalated).length, [pending.records]);

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const historyAsset = historyFilter === "全部" ? undefined : historyFilter;
      const [nextOverview, nextPending, nextSuspended, nextHistory] = await Promise.all([
        fetchUserAssetAdjustmentOverview(),
        fetchUserAssetAdjustments({ status: "PENDING_REVIEW", pageNum: pendingPage, pageSize: pendingPageSize }),
        fetchUserAssetAdjustments({ status: "SUSPENDED", pageNum: suspendedPage, pageSize: suspendedPageSize }),
        fetchUserAssetAdjustments({ asset: historyAsset, historyOnly: true, pageNum: historyPage, pageSize: historyPageSize }),
      ]);
      setOverview(nextOverview);
      setPending(nextPending);
      setSuspended(nextSuspended);
      setHistory(nextHistory);
      setSeedReady(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [historyFilter, historyPage, historyPageSize, pendingPage, pendingPageSize, suspendedPage, suspendedPageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!seedReady) return;
    const timer = window.setTimeout(() => {
      setUserSearchLoading(true);
      fetchUserProfilesPage({ keyword: userQuery.trim() || undefined, pageNum: 1, pageSize: 8 })
        .then((page) => setUserOptions(page.records))
        .catch((err) => toast(errorMessage(err)))
        .finally(() => setUserSearchLoading(false));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [seedReady, toast, userQuery]);

  const refreshAfterWrite = useCallback(async (message: string) => {
    await loadData(true);
    toast(message);
  }, [loadData, toast]);

  const perform = useCallback(async (work: () => Promise<string>, fallbackMessage: string) => {
    setBusy(true);
    try {
      const message = await work();
      await refreshAfterWrite(message || fallbackMessage);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [refreshAfterWrite, toast]);

  const selectUser = (account: User360Profile) => {
    setSelectedUser(account);
    setUserQuery(displayUser(account));
    setShowUserMenu(false);
  };

  const submitAdjustment = () => {
    if (!selectedUser || !accountId(selectedUser)) {
      toast("请选择下拉结果中的账户后再提交");
      setShowUserMenu(true);
      return;
    }
    const amount = Math.abs(asNumber(amountText));
    if (amount <= 0) {
      toast("金额须为正数");
      return;
    }
    const backendDirection = direction === "增加" ? "CREDIT" : "DEBIT";
    const overCap = asset === "USDT" && amount > capUsd;
    openActionConfirm({
      action: `资产调整 · ${displayUser(selectedUser)} · ${direction === "增加" ? "+" : "-"}${formatAmountValue(amount)} ${asset}`,
      detail: (
        <>
          <div className="ctint" data-proof="c3-confirm-user" style={{ marginBottom: 10 }}>
            <b>二次确认目标账户</b> · <span className="mono">{text(selectedUser.userNo)}</span> · {text(selectedUser.nickname)} · {text(selectedUser.phoneMasked)} · 状态 {text(selectedUser.status)} · KYC {text(selectedUser.kycStatus)}。
          </div>
          {overCap ? <b>单笔超过 ${capUsd.toLocaleString("en-US")},后端会保留升级复核标记。</b> : "基础复核路径。"}
          {backendDirection === "CREDIT"
            ? <>加钱方向会在后端校验 B1 覆盖率红线,低于红线时拒绝或进入挂起。</>
            : "扣减方向不放大资金负债,但仍必须留操作理由。"}
        </>
      ),
      amplifies: backendDirection === "CREDIT",
      run: (reason) => {
        void perform(
          async () => {
            const saved = await createUserAssetAdjustment(
              accountId(selectedUser),
              asset,
              backendDirection,
              String(amount),
              `${reasonCode} · ${reason}`,
              OPERATOR(),
            );
            return `调整单 ${text(saved.adjustmentNo)} 已提交复核`;
          },
          "调整单已提交复核",
        );
      },
    });
  };

  const reviewAdjustment = (row: UserAssetAdjustment, approved: boolean) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    if (!adjustmentNo) return toast("调整单号缺失");
    openActionConfirm({
      action: `${approved ? "通过" : "驳回"}资产调整 · ${adjustmentNo}`,
      detail: `${displayRowUser(row)} · ${formatAdjustmentAmount(row)} · ${text(row.reason)}。${approved && row.credit ? "加钱方向会在后端再次校验覆盖率红线。" : "裁决结果写入后端复核链路。"}`,
      amplifies: approved && !!row.credit,
      run: (reason) => {
        void perform(
          async () => {
            await (approved
              ? approveUserAssetAdjustment(adjustmentNo, reason, OPERATOR())
              : rejectUserAssetAdjustment(adjustmentNo, reason, OPERATOR()));
            return `${adjustmentNo} 已${approved ? "通过" : "驳回"}`;
          },
          "调整单已裁决",
        );
      },
    });
  };

  const cancelSuspended = (row: UserAssetAdjustment) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    if (!adjustmentNo) return toast("调整单号缺失");
    openConfirm({
      action: `撤销挂起申请 · ${adjustmentNo}`,
      detail: `${displayRowUser(row)} · ${formatAdjustmentAmount(row)}。撤销按后端驳回写入复核原因,不改余额。`,
      chips: [["落审计", "ready"]],
      reason: true,
      okLabel: "确认撤销",
      run: (reason) => {
        void perform(
          async () => {
            await rejectUserAssetAdjustment(adjustmentNo, reason, OPERATOR());
            return `${adjustmentNo} 已撤销`;
          },
          "挂起申请已撤销",
        );
      },
    });
  };

  const reverseAdjustment = (row: UserAssetAdjustment) => {
    const adjustmentNo = text(row.adjustmentNo, "");
    const userId = row.userId === null || row.userId === undefined ? "" : String(row.userId);
    const amount = Math.abs(asNumber(row.amount));
    const assetName = text(row.asset, "USDT").toUpperCase() as Asset;
    const reverseDirection = text(row.direction).toUpperCase() === "CREDIT" ? "DEBIT" : "CREDIT";
    if (!adjustmentNo || !userId || amount <= 0) {
      toast("冲正所需的后端字段缺失");
      return;
    }
    openActionConfirm({
      action: `冲正调整 · ${adjustmentNo}`,
      detail: (
        <>
          原单 <span className="mono">{adjustmentNo}</span> · {displayRowUser(row)} · {formatAdjustmentAmount(row)}。
          冲正会创建一条新的反向调整单进入复核,不会修改或删除原记录。
        </>
      ),
      amplifies: reverseDirection === "CREDIT",
      run: (reason) => {
        void perform(
          async () => {
            const saved = await createUserAssetAdjustment(
              userId,
              assetName,
              reverseDirection,
              String(amount),
              `冲正 ${adjustmentNo} · ${reason}`,
              OPERATOR(),
            );
            return `冲正单 ${text(saved.adjustmentNo)} 已提交复核`;
          },
          "冲正单已提交复核",
        );
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
        <div className="f-stat"><div className="k">本月调整</div><div className="v">{asNumber(overview?.approved).toLocaleString("en-US")} 笔</div><div className="sub">已通过调整 · 来自后端</div></div>
        <div className="f-stat warn"><div className="k">待确认</div><div className="v">{asNumber(overview?.pending)}</div><div className="sub">{pendingEscalated} 笔超额待复核</div></div>
        <div className="f-stat cyan"><div className="k">挂起(等覆盖率)</div><div className="v">{asNumber(overview?.suspended)}</div><div className="sub">覆盖率恢复后仍需人工重新确认</div></div>
        <div className="f-stat ok"><div className="k">覆盖率(B1)</div><div className="v">{coverageRatio ? `${coverageRatio.toFixed(1)}%` : "—"}</div><div className="sub">红线 {redlinePct ? `${redlinePct}%` : "—"} · 后端实时校验</div></div>
      </div>

      {error && <div className="ctint warn" style={{ marginBottom: 12 }}>C3 数据加载失败 · {error}</div>}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>C3 数据加载中...</div>}

      <div className="two-col r1-12">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">发起调整</span>
            <span className="sub">· 账户必须从后端搜索下拉选择</span>
          </div>
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
                      if (selectedUser && next !== selectedDisplay) setSelectedUser(null);
                      setShowUserMenu(true);
                    }}
                    onFocus={() => setShowUserMenu(true)}
                    placeholder="搜索用户编码 / 用户名 / 手机号"
                    style={{ width: "100%" }}
                  />
                  {showUserMenu && (
                    <div
                      role="listbox"
                      style={{
                        position: "absolute",
                        zIndex: 20,
                        top: 36,
                        left: 0,
                        right: 0,
                        maxHeight: 240,
                        overflowY: "auto",
                        border: "1px solid var(--border-strong)",
                        borderRadius: 8,
                        background: "var(--surface)",
                        boxShadow: "0 14px 38px rgba(0,0,0,.22)",
                        padding: 6,
                      }}
                    >
                      {userSearchLoading && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-4)" }}>搜索中...</div>}
                      {!userSearchLoading && userOptions.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--ink-4)" }}>无匹配用户</div>}
                      {!userSearchLoading && userOptions.map((account) => (
                        <button
                          key={`${text(account.userNo)}-${accountId(account)}`}
                          type="button"
                          onClick={() => selectUser(account)}
                          style={{
                            width: "100%",
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 10,
                            padding: "8px 10px",
                            border: 0,
                            borderRadius: 6,
                            background: accountId(account) === accountId(selectedUser) ? "var(--surface-2)" : "transparent",
                            color: "var(--ink)",
                            cursor: "pointer",
                            textAlign: "left",
                          }}
                        >
                          <span><b className="mono">{text(account.userNo)}</b> · {text(account.nickname)}</span>
                          <span style={{ color: "var(--ink-4)" }}>{text(account.phoneMasked)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ marginTop: 8, fontSize: 12 }}>
                    {selectedUser
                      ? <span className="bdg ok">已选择 {displayUser(selectedUser)} · {text(selectedUser.status)}</span>
                      : <span className="bdg warn">请从下拉结果选择账户</span>}
                  </div>
                </div>
              </div>

              <div className="row"><label>对象</label>
                <div className="chips">
                  {ASSETS.map((item) => (
                    <button key={item} className={`chip${asset === item ? " sel" : ""}`} onClick={() => setAsset(item)}>{item}</button>
                  ))}
                </div>
              </div>
              <div className="row"><label>方向</label>
                <div className="chips">
                  {DIRECTIONS.map((item) => (
                    <button key={item} className={`chip${direction === item ? " sel" : ""}`} onClick={() => setDirection(item)}>{item}{item === "增加" ? "(过红线核验)" : ""}</button>
                  ))}
                </div>
              </div>
              <div className="row"><label>金额</label><input value={amountText} onChange={(event) => setAmountText(event.target.value)} style={{ width: 120 }} /><span style={{ fontSize: 12, color: "var(--ink-4)" }}>单笔 &gt; ${capUsd.toLocaleString("en-US")} 标记升级复核</span></div>
              <div className="row"><label>原因码</label>
                <div className="chips">
                  {REASON_CODES.map((item) => (
                    <button key={item} className={`chip${reasonCode === item ? " sel" : ""}`} onClick={() => setReasonCode(item)}>{item}</button>
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button className="l-btn mc" disabled={busy || !selectedUser} onClick={submitAdjustment}>提交调整(后端复核)</button>
              </div>
            </div>
            <div className="esc-note" style={{ marginTop: 12 }}>
              <div className="b"><b>账户选择</b><br />按用户编码、用户名、手机号搜索后端账户</div>
              <div className="b"><b>加钱方向</b><br />后端实时检查 B1 覆盖率红线</div>
              <div className="b"><b>所有写入</b><br />创建/复核/驳回都走真实接口和幂等号</div>
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">挂起中的加钱申请</span>
            <span className="sub">· 来自 nx_wallet_asset_adjustment</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>调整单</th><th>账户</th><th className="num">金额</th><th>复核说明</th><th>动作</th></tr></thead>
              <tbody>
                {suspended.records.map((row) => (
                  <tr key={text(row.adjustmentNo)} className="click" onClick={() => openDetail(row)}>
                    <td className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{text(row.adjustmentNo)}</td>
                    <td>{displayRowUser(row)}</td>
                    <td className="num mono" style={{ fontWeight: 700, color: "var(--success)" }}>{formatAdjustmentAmount(row)}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{text(row.reviewReason, text(row.reason))}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <button className="l-btn sm mc" disabled={busy} onClick={() => reviewAdjustment(row, true)}>重新确认</button>
                        <button className="l-btn sm" disabled={busy} onClick={() => cancelSuspended(row)}>撤销</button>
                      </span>
                    </td>
                  </tr>
                ))}
                {suspended.records.length === 0 && (
                  <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无挂起申请</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="C3 挂起申请"
            page={suspendedPage}
            pageSize={suspendedPageSize}
            total={suspended.total}
            onPageChange={setSuspendedPage}
            onPageSizeChange={(next) => { setSuspendedPageSize(next); setSuspendedPage(1); }}
            pageSizeOptions={[5, 10, 20]}
          />
          <div className="l-b" style={{ paddingTop: 12 }}>
            <div className="ctint"><b>挂起不会自动放行</b> · 覆盖率恢复后仍由后台复核接口重新确认,通过瞬间后端再校验一次红线。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">待确认队列</span>
          <span className="sub">· 后端分页 · 通过/驳回写真实复核状态</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead><tr><th>调整单</th><th>账户</th><th>对象</th><th className="num">金额</th><th>发起人</th><th>事由</th><th>状态</th><th>动作</th></tr></thead>
            <tbody>
              {pending.records.map((row) => {
                const status = text(row.status).toUpperCase();
                const reviewable = PENDING_STATUSES.has(status);
                return (
                  <tr key={text(row.adjustmentNo)} className="click" onClick={() => openDetail(row)}>
                    <td className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{text(row.adjustmentNo)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                    <td>{displayRowUser(row)}</td>
                    <td><span className="bdg dim">{text(row.asset)}</span></td>
                    <td className="num mono" style={{ fontWeight: 700, color: row.credit ? "var(--success)" : "var(--danger)" }}>{formatAdjustmentAmount(row)}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{text(row.maker)}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{text(row.reason)}</td>
                    <td><span className={`bdg ${statusTone(row)}`}>{statusLabel(row)}</span>{row.escalated && <span className="bdg cyan" style={{ marginLeft: 6 }}>超额</span>}</td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {reviewable ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button className="l-btn sm primary" disabled={busy} onClick={() => reviewAdjustment(row, true)}>通过</button>
                          <button className="l-btn sm" disabled={busy} style={{ color: "var(--danger)" }} onClick={() => reviewAdjustment(row, false)}>驳回</button>
                        </span>
                      ) : <span style={{ fontSize: 12, color: "var(--ink-4)" }}>已裁决</span>}
                    </td>
                  </tr>
                );
              })}
              {pending.records.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无待确认调整单</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="C3 待确认队列"
          page={pendingPage}
          pageSize={pendingPageSize}
          total={pending.total}
          onPageChange={setPendingPage}
          onPageSizeChange={(next) => { setPendingPageSize(next); setPendingPage(1); }}
          pageSizeOptions={[5, 10, 20]}
        />
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">调整历史</span>
          <span className="sub">· 后端分页 · 可查真实详情</span>
          <div className="r">
            <div className="chips">
              {HISTORY_FILTERS.map((item) => (
                <button
                  key={item}
                  className={`chip${historyFilter === item ? " sel" : ""}`}
                  onClick={() => { setHistoryFilter(item); setHistoryPage(1); }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1040 }}>
            <thead><tr><th>调整单</th><th>账户</th><th>对象</th><th className="num">增减</th><th>原因</th><th>复核链路</th><th>落点</th><th>时间</th><th style={{ textAlign: "right" }}>冲正</th></tr></thead>
            <tbody>
              {history.records.map((row) => (
                <tr key={text(row.adjustmentNo)} className="click" onClick={() => openDetail(row)}>
                  <td className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{text(row.adjustmentNo)} <span style={{ fontSize: 10.5, color: "var(--c-ac)" }}>详情›</span></td>
                  <td>{displayRowUser(row)}</td>
                  <td><span className="bdg dim">{text(row.asset)}</span></td>
                  <td className="num mono" style={{ fontWeight: 700, color: row.credit ? "var(--success)" : "var(--danger)" }}>{formatAdjustmentAmount(row)}</td>
                  <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{text(row.reason)}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(row.maker)} → {text(row.checker)}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--c-ac)" }}>{text(row.sink)}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{formatDate(row.reviewedAt ?? row.updatedAt ?? row.createdAt)}</td>
                  <td style={{ textAlign: "right" }} onClick={(event) => event.stopPropagation()}>
                    <button className="l-btn sm mc" disabled={busy} onClick={() => reverseAdjustment(row)}>冲正</button>
                  </td>
                </tr>
              ))}
              {history.records.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>暂无调整历史</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="C3 调整历史"
          page={historyPage}
          pageSize={historyPageSize}
          total={history.total}
          onPageChange={setHistoryPage}
          onPageSizeChange={(next) => { setHistoryPageSize(next); setHistoryPage(1); }}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>

      <p className="f-foot"><b>C3 是余额纠错和补偿入口</b>。账户只展示用户编码与脱敏信息;发起、复核、驳回、挂起重审、冲正发起都保留后端审计链路。</p>

      {detailRow && (
        <Drawer
          title={`调整单明细 · ${text(detailRow.adjustmentNo)}`}
          sub={`${displayRowUser(detailRow)} · ${formatAdjustmentAmount(detailRow)}`}
          onClose={() => { setDetail(null); setDetailFallback(null); }}
          footer={detailRow.ledgerId ? <Link className="l-btn" style={{ flex: 1, justifyContent: "center" }} href="/finance/ledger">去 D4 查账单 →</Link> : undefined}
        >
          {detailLoading && <div className="ctint" style={{ marginBottom: 12 }}>明细加载中...</div>}
          <div className="ctint" style={{ marginBottom: 14 }}>原因:{text(detailRow.reason)}。状态:{statusLabel(detailRow)}。{detailRow.credit ? "加钱方向已接入覆盖率红线校验。" : "扣减方向保留复核与审计链路。"}</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>调整内容</div>
          <div className="kv"><span className="k">账户</span><span className="v">{displayRowUser(detailRow)}</span></div>
          <div className="kv"><span className="k">对象</span><span className="v">{text(detailRow.asset)}</span></div>
          <div className="kv"><span className="k">增减</span><span className="v">{formatAdjustmentAmount(detailRow)}</span></div>
          <div className="kv"><span className="k">原因码</span><span className="v">{text(detailRow.reasonCode)}</span></div>
          <div className="kv"><span className="k">状态</span><span className="v"><span className={`bdg ${statusTone(detailRow)}`}>{statusLabel(detailRow)}</span></span></div>
          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>复核链路</div>
          {(detail?.reviewTrail ?? [
            `创建人:${text(detailRow.maker)}`,
            `创建时间:${formatDate(detailRow.createdAt)}`,
            `复核人:${text(detailRow.checker)}`,
            `复核时间:${formatDate(detailRow.reviewedAt)}`,
            `复核理由:${text(detailRow.reviewReason)}`,
          ]).map((line) => (
            <div className="kv" key={line}><span className="k">节点</span><span className="v">{line}</span></div>
          ))}
          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 4px" }}>账本关联</div>
          <div className="kv"><span className="k">落点</span><span className="v" style={{ color: "var(--c-ac)" }}>{text(detailRow.sink)}</span></div>
          <div className="kv"><span className="k">账单类型</span><span className="v">人工调整(adjustment)</span></div>
          <div className="kv"><span className="k">幂等号</span><span className="v mono">IDEM-{text(detailRow.adjustmentNo)}</span></div>
          <div className="ctint cyan" style={{ marginTop: 14 }}><b>来源</b>: {(detail?.sources ?? ["nx_wallet_asset_adjustment", "nx_user", "nx_audit_log"]).join(" / ")}</div>
        </Drawer>
      )}
    </>
  );
}
