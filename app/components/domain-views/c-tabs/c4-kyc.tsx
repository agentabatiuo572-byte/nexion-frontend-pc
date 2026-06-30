"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { DataListPager } from "../design-kit";
import {
  createUserKycExport,
  fetchUserKycOverview,
  updateUserKycNetworkWhitelist,
  updateUserKycStatus,
  type UserKycLedgerRow,
  type UserKycOverview,
  type UserKycStats,
} from "@/lib/admin/user360-client";
import type { CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const BASE_NETWORKS = ["TRC20", "ERC20", "BTC", "ETH"] as const;
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50];

type KycFilter = "all" | "APPROVED" | "NONE" | "PENDING" | "REJECTED";

const FILTERS: { value: KycFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "APPROVED", label: "已验证" },
  { value: "NONE", label: "未验证" },
  { value: "PENDING", label: "复审中" },
  { value: "REJECTED", label: "已拒绝" },
];

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function asNumber(value: unknown, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "C4_REQUEST_FAILED";
  if (message.includes("COVERAGE_BELOW_REDLINE")) {
    return "B1 兑付覆盖率低于红线,后端拒绝人工放开实名通过";
  }
  return message;
}

function splitNetworks(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\/,\s]+/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function rowKey(row: UserKycLedgerRow | null | undefined) {
  return text(row?.userId ?? row?.displayId, "");
}

function rowDisplay(row: UserKycLedgerRow | null | undefined) {
  if (!row) return "—";
  const code = text(row.displayId);
  const name = text(row.nickname, "");
  return name ? `${code} · ${name}` : code;
}

function statusTotal(stats: UserKycStats | null | undefined, filter: KycFilter) {
  if (filter === "APPROVED") return asNumber(stats?.verified);
  if (filter === "NONE") return asNumber(stats?.unverified);
  if (filter === "PENDING") return asNumber(stats?.inReview);
  if (filter === "REJECTED") return asNumber(stats?.rejected);
  return asNumber(stats?.total);
}

export function C4Kyc({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const [overview, setOverview] = useState<UserKycOverview | null>(null);
  const [filter, setFilter] = useState<KycFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => overview?.rows ?? [], [overview]);
  const stats = overview?.stats ?? null;
  const activeNetworks = useMemo(() => splitNetworks(overview?.networkWhitelist), [overview?.networkWhitelist]);
  const networkOptions = useMemo(() => Array.from(new Set([...activeNetworks, ...BASE_NETWORKS])), [activeNetworks]);
  const selected = rows.find((row) => rowKey(row) === current) ?? rows[0] ?? null;
  const total = statusTotal(stats, filter);
  const verifiedPct = text(stats?.verifiedPct, "0.0");

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const next = await fetchUserKycOverview({
        status: filter === "all" ? undefined : filter,
        pageNum: page,
        pageSize,
      });
      setOverview(next);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter, page, pageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (rows.length === 0) {
      setCurrent("");
      return;
    }
    if (!rows.some((row) => rowKey(row) === current)) {
      setCurrent(rowKey(rows[0]));
    }
  }, [current, rows]);

  const perform = useCallback(async (work: () => Promise<string>, fallbackMessage: string) => {
    setBusy(true);
    try {
      const message = await work();
      await loadData(true);
      toast(message || fallbackMessage);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [loadData, toast]);

  const changeStatus = (nextStatus: "APPROVED" | "NONE" | "PENDING", label: string, amplifies: boolean) => {
    if (!selected?.userId) {
      toast("请选择一条 KYC 台账行");
      return;
    }
    openActionConfirm({
      action: `${label} · ${rowDisplay(selected)}`,
      detail: (
        <>
          <div className="ctint" style={{ marginBottom: 10 }}>
            <b>目标账户</b> · <span className="mono">{text(selected.displayId)}</span> · {text(selected.nickname)} · {text(selected.phoneMasked)}。
          </div>
          实名状态变更写入后端 KYC 台账,并产出 admin.kyc_status_changed 审计事件。人工标记已验证会放开提现/兑换门槛,后端会同步校验 B1 覆盖率红线。
        </>
      ),
      amplifies,
      run: (reason) => {
        void perform(
          async () => {
            await updateUserKycStatus(selected.userId!, nextStatus, reason, OPERATOR());
            return `${rowDisplay(selected)} 已更新为${label}`;
          },
          "KYC 状态已更新",
        );
      },
    });
  };

  const triggerReview = () => {
    if (!selected?.userId) {
      toast("请选择一条 KYC 台账行");
      return;
    }
    openConfirm({
      action: `触发增强复审 · ${rowDisplay(selected)}`,
      detail: "触发复审会把该用户实名状态写为复审中,后续 K5 裁决再回写同一条后端状态。",
      chips: [["写后端状态", "ready"], ["裁决回写同源", "done"]],
      reason: true,
      okLabel: "确认触发",
      run: (reason) => {
        void perform(
          async () => {
            await updateUserKycStatus(selected.userId!, "PENDING", reason, OPERATOR());
            return `${rowDisplay(selected)} 已进入复审中`;
          },
          "复审已触发",
        );
      },
    });
  };

  const toggleNetwork = (network: string) => {
    const enabled = activeNetworks.includes(network);
    const nextNetworks = enabled
      ? activeNetworks.filter((item) => item !== network)
      : Array.from(new Set([...activeNetworks, network]));
    if (nextNetworks.length === 0) {
      toast("至少保留一个配对网络");
      return;
    }
    openActionConfirm({
      action: `${enabled ? "停用" : "启用"}配对网络 · ${network}`,
      detail: `${enabled ? `停用后新配对不能再选 ${network}` : `启用 ${network} 作为可选配对网络`}。白名单写入后端配置,不再走前端本地状态。`,
      amplifies: false,
      run: (reason) => {
        void perform(
          async () => {
            await updateUserKycNetworkWhitelist(nextNetworks.join(" / "), reason, OPERATOR());
            return `${network} 已${enabled ? "停用" : "启用"}`;
          },
          "配对网络白名单已更新",
        );
      },
    });
  };

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">已验证</div><div className="v">{asNumber(stats?.verified).toLocaleString("en-US")}</div><div className="sub">占 {verifiedPct}% · 后端统计</div></div>
        <div className="f-stat"><div className="k">未验证</div><div className="v">{asNumber(stats?.unverified).toLocaleString("en-US")}</div><div className="sub">首次提现 / 累计兑换过线前</div></div>
        <div className="f-stat warn"><div className="k">复审中</div><div className="v">{asNumber(stats?.inReview).toLocaleString("en-US")}</div><div className="sub">K5 裁决回写同一状态</div></div>
        <div className="f-stat cyan"><div className="k">验证费</div><div className="v">${asNumber(stats?.feeUsd, 1)}</div><div className="sub">配置值由后端返回</div></div>
      </div>

      {error && <div className="ctint warn" style={{ marginBottom: 12 }}>C4 数据加载失败 · {error}</div>}
      {loading && <div className="ctint" style={{ marginBottom: 12 }}>C4 数据加载中...</div>}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">触发条件与网络白名单</span>
          <span className="sub">· 网络白名单从后端配置读取并写回</span>
          <div className="r"><span className="ccode lock">阈值归 K5 / G2 · 只读</span></div>
        </div>
        <div className="l-b">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div className="ctint"><b>触发场景</b> · 首次提现 / 终身累计兑换过线 / 用户主动验证,命中任一即要求实名。</div>
            <div className="ctint"><b>验证费</b> · ${asNumber(stats?.feeUsd, 1)} 计入用户余额;调整走治理流程。</div>
            <div className="ctint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ width: "100%", marginBottom: 4 }}><b>配对网络白名单</b> · 当前: {text(overview?.networkWhitelist)}</span>
              {networkOptions.map((network) => {
                const enabled = activeNetworks.includes(network);
                return (
                  <button key={network} className="l-btn sm mc" disabled={busy} onClick={() => toggleNetwork(network)} style={{ opacity: enabled ? 1 : 0.5 }} title={`${enabled ? "停用" : "启用"} ${network}`}>
                    {network} · {enabled ? "启用" : "停用"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <div className="two-col r13-1">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">KYC 状态列表</span>
            <span className="sub">· 后端分页 · 只展示用户编码</span>
            <div className="r">
              <div className="chips">
                {FILTERS.map((item) => (
                  <button
                    key={item.value}
                    className={`chip${filter === item.value ? " sel" : ""}`}
                    onClick={() => { setFilter(item.value); setPage(1); }}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>账户</th><th>状态</th><th>配对地址(脱敏)</th><th>网络</th><th>配对时间</th><th>触发来源</th></tr></thead>
              <tbody>
                {rows.map((row) => {
                  const key = rowKey(row);
                  return (
                    <tr key={key} className="click" onClick={() => setCurrent(key)} style={key === current ? { background: "var(--surface-2)" } : undefined}>
                      <td>
                        <div className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{text(row.displayId)}</div>
                        <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(row.nickname)} · {text(row.phoneMasked)}</div>
                      </td>
                      <td><span className={`bdg ${text(row.statusTone, "dim")}`}>{text(row.statusLabel)}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{text(row.pairedAddressMasked)}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{text(row.network)}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{text(row.pairedAt)}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{text(row.triggerSource)}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>该状态下暂无台账行</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="C4 KYC 台账"
            page={page}
            pageSize={pageSize}
            total={total}
            rawTotal={asNumber(stats?.total)}
            onPageChange={setPage}
            onPageSizeChange={(next) => { setPageSize(next); setPage(1); }}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
          />
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">详情 · {text(selected?.displayId)}</span>
            <span className="sub">· 变更写真实接口</span>
            <div className="r">
              {selected && text(selected.backendStatus) !== "APPROVED" && <button className="l-btn mc" disabled={busy} onClick={() => changeStatus("APPROVED", "已验证", true)}>人工标记已验证</button>}
              {selected && text(selected.backendStatus) === "APPROVED" && <button className="l-btn mc" disabled={busy} onClick={() => changeStatus("NONE", "未验证", false)}>撤销实名</button>}
              {selected && text(selected.backendStatus) !== "PENDING" && <button className="l-btn" disabled={busy} onClick={triggerReview}>触发复审</button>}
            </div>
          </div>
          <div className="l-b">
            {!selected && <div className="ctint">请选择一条 KYC 台账行</div>}
            {selected?.info?.map((item) => (
              <div className="kv" key={text(item.key)}>
                <span className="k">{text(item.key)}</span>
                <span className="v">{text(item.value)}</span>
              </div>
            ))}
            {selected && (
              <>
                <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>状态变更历史</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.9 }}>
                  {(selected.history ?? []).map((item) => <div key={item}>· {item}</div>)}
                </div>
              </>
            )}
          </div>
        </section>
      </div>

      <p className="f-foot"><b>权威与引用关系</b>:实名状态、配对地址、网络白名单和监管导出都通过后端接口读取或写入。前端只展示用户编码与脱敏字段,不展示数据库 userId;人工标记/撤销/复审触发均带防重号和审计链路。</p>
    </>
  );
}

export function C4HeaderActions({ ctx }: { ctx: CCtx }) {
  return (
    <button
      className="f-cta"
      onClick={() => ctx.openConfirm({
        action: "监管导出(脱敏)",
        detail: "导出台账账户、状态、网络与配对时间;地址由后端按监管要求脱敏,导出任务和理由写审计。",
        reason: true,
        okLabel: "确认导出",
        run: (reason) => {
          void createUserKycExport("MASKED_LEDGER", reason, OPERATOR())
            .then((job) => ctx.toast(`KYC 脱敏导出已创建 · ${text(job.jobNo)}`))
            .catch((err) => ctx.toast(errorMessage(err)));
        },
      })}
    >
      <Download size={14} />
      监管导出(脱敏)
    </button>
  );
}
