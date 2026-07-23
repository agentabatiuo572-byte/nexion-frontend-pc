"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download } from "lucide-react";
import { DataListPager, type BusinessFormValue } from "../design-kit";
import {
  createUserKycExport,
  downloadUserKycExport,
  fetchUserKycDetail,
  fetchUserKycExports,
  fetchUserKycOverview,
  revokeUserKyc,
  triggerUserKycReview,
  updateUserKycNetworkWhitelist,
  verifyUserKyc,
  type UserKycExportJob,
  type UserKycLedgerRow,
  type UserKycOverview,
  type UserKycStats,
} from "@/lib/admin/user360-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
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

const REASON_CODES = [
  "MANUAL_VERIFICATION",
  "COMPLIANCE_CORRECTION",
  "USER_APPEAL",
  "RISK_ESCALATION",
  "OTHER",
] as const;

const REASON_CODE_LABELS: Record<string, string> = {
  MANUAL_VERIFICATION: "人工材料核验",
  COMPLIANCE_CORRECTION: "合规纠错",
  USER_APPEAL: "用户申诉",
  RISK_ESCALATION: "风险升级",
  OTHER: "其他",
};

function newCommandKey(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

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

function exportStatusLabel(value: unknown) {
  return ({ READY: "可下载", EXPORTED: "已导出", FAILED: "生成失败", EXPIRED: "已过期" } as Record<string, string>)[text(value).toUpperCase()]
    ?? "状态待核对";
}

function exportScopeLabel(value: unknown) {
  return text(value).toUpperCase() === "MASKED_LEDGER" ? "全量脱敏台账" : "已授权范围";
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
  const { toast, openActionConfirm } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canRead = authorities.includes("user_c4_read");
  const canVerify = authorities.includes("user_c4_verify");
  const canRevoke = authorities.includes("user_c4_revoke");
  const canTriggerReview = authorities.includes("user_c4_trigger_review");
  const canExport = authorities.includes("user_c4_export");
  const canWriteNetwork = authorities.includes("user_c4_network_write");
  const [overview, setOverview] = useState<UserKycOverview | null>(null);
  const [detail, setDetail] = useState<UserKycLedgerRow | null>(null);
  const [exports, setExports] = useState<UserKycExportJob[]>([]);
  const [filter, setFilter] = useState<KycFilter>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [current, setCurrent] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const submissionRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const networkSubmissionRef = useRef<{ fingerprint: string; key: string } | null>(null);

  const rows = useMemo(() => overview?.rows ?? [], [overview]);
  const stats = overview?.stats ?? null;
  const activeNetworks = useMemo(() => splitNetworks(overview?.networkWhitelist), [overview?.networkWhitelist]);
  const networkOptions = useMemo(() => Array.from(new Set([...activeNetworks, ...BASE_NETWORKS])), [activeNetworks]);
  const selectedSummary = rows.find((row) => rowKey(row) === current) ?? rows[0] ?? null;
  const selected = rowKey(detail) === rowKey(selectedSummary) ? detail : selectedSummary;
  const total = statusTotal(stats, filter);
  const verifiedPct = text(stats?.verifiedPct, "0.0");

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    setExportError(null);
    if (!canRead) {
      setOverview(null);
      setLoading(false);
      return;
    }
    try {
      const next = await fetchUserKycOverview({
        status: filter === "all" ? undefined : filter,
        pageNum: page,
        pageSize,
      });
      setOverview(next);
      if (canExport) {
        try {
          setExports(await fetchUserKycExports(10));
        } catch (err) {
          setExports([]);
          setExportError(errorMessage(err));
        }
      } else {
        setExports([]);
      }
    } catch (err) {
      setOverview(null);
      setDetail(null);
      setExports([]);
      setError(errorMessage(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [canExport, canRead, filter, page, pageSize]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    const refreshExports = () => { if (canExport) void fetchUserKycExports(10).then(setExports).catch(() => undefined); };
    window.addEventListener("c4-export-created", refreshExports);
    return () => window.removeEventListener("c4-export-created", refreshExports);
  }, [canExport]);

  useEffect(() => {
    if (rows.length === 0) {
      setCurrent("");
      return;
    }
    if (!rows.some((row) => rowKey(row) === current)) {
      setCurrent(rowKey(rows[0]));
    }
  }, [current, rows]);

  useEffect(() => {
    const userId = selectedSummary?.userId;
    if (!canRead || !userId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    void fetchUserKycDetail(userId)
      .then((next) => { if (!cancelled) setDetail(next); })
      .catch((err) => { if (!cancelled) toast(errorMessage(err)); });
    return () => { cancelled = true; };
  }, [canRead, selectedSummary?.userId, toast]);

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

  const changeStatus = (nextStatus: "APPROVED" | "NONE", label: string, amplifies: boolean) => {
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
          实名状态将按当前版本立即变更并保留完整历史。人工标记已验证会放开提现/兑换门槛,提交前会校验 B1 覆盖率红线。
        </>
      ),
      amplifies,
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        title: "核验依据",
        hint: "原因 8-200 字;依据填写工单号、材料编号或复核记录编号。",
        fields: [
          { key: "reasonCode", label: "原因分类", current: nextStatus === "APPROVED" ? "MANUAL_VERIFICATION" : "COMPLIANCE_CORRECTION", inputKind: "select", options: [...REASON_CODES], optionLabels: REASON_CODE_LABELS, required: true },
          { key: "evidenceRef", label: "依据编号", current: "", placeholder: "例如 TICKET-20260719-001", inputKind: "text", required: true, wide: true },
        ],
      },
      run: async (reason, _newValue, businessValue?: BusinessFormValue) => {
        if (!selected?.userId) throw new Error("请选择一条 KYC 台账行");
        const reasonLength = reason.trim().length;
        if (reasonLength < 8 || reasonLength > 200) throw new Error("操作原因需为 8-200 字");
        const reasonCode = businessValue?.reasonCode?.trim();
        const evidenceRef = businessValue?.evidenceRef?.trim();
        if (!reasonCode || !evidenceRef) throw new Error("请选择原因分类并填写依据编号");
        const expectedState = text(selected.backendStatus, "NONE");
        const fingerprint = `${nextStatus}|${selected.userId}|${expectedState}|${reasonCode}|${reason.trim()}|${evidenceRef}`;
        const submission = submissionRef.current?.fingerprint === fingerprint
          ? submissionRef.current
          : { fingerprint, key: newCommandKey("c4-kyc-status") };
        submissionRef.current = submission;
        setBusy(true);
        try {
          const input = { expectedState, reasonCode, reason: reason.trim(), evidenceRef, operator: OPERATOR(), idempotencyKey: submission.key };
          const updated = nextStatus === "APPROVED"
            ? await verifyUserKyc(selected.userId, input)
            : await revokeUserKyc(selected.userId, input);
          submissionRef.current = null;
          setDetail(updated);
          await loadData(true);
          toast(`${label}已生效 · ${rowDisplay(updated)}`);
        } catch (err) {
          toast(errorMessage(err));
          throw err;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const triggerReview = () => {
    if (!selected?.userId) {
      toast("请选择一条 KYC 台账行");
      return;
    }
    openActionConfirm({
      action: `触发增强复审 · ${rowDisplay(selected)}`,
      detail: "本操作只会在 K5 创建或合并一张未结复审工单,不会改变当前实名状态。K5 裁决完成后才会回写 C4 权威台账。",
      completionCopy: "只创建或合并 K5 复审工单；当前实名状态保持不变，K5 裁决完成后才回写 C4。",
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      businessForm: {
        kind: "multi-field",
        title: "复审依据",
        hint: "相同用户若已有未结工单,系统会合并到原工单。",
        fields: [
          { key: "reasonCode", label: "原因分类", current: "RISK_ESCALATION", inputKind: "select", options: [...REASON_CODES], optionLabels: REASON_CODE_LABELS, required: true },
          { key: "evidenceRef", label: "依据编号", current: "", placeholder: "例如 CASE-20260719-001", inputKind: "text", required: true, wide: true },
        ],
      },
      run: async (reason, _newValue, businessValue?: BusinessFormValue) => {
        if (!selected?.userId) throw new Error("请选择一条 KYC 台账行");
        const reasonLength = reason.trim().length;
        if (reasonLength < 8 || reasonLength > 200) throw new Error("操作原因需为 8-200 字");
        const reasonCode = businessValue?.reasonCode?.trim();
        const evidenceRef = businessValue?.evidenceRef?.trim();
        if (!reasonCode || !evidenceRef) throw new Error("请选择原因分类并填写依据编号");
        const fingerprint = `K5|${selected.userId}|${reasonCode}|${reason.trim()}|${evidenceRef}`;
        const submission = submissionRef.current?.fingerprint === fingerprint
          ? submissionRef.current
          : { fingerprint, key: newCommandKey("c4-k5-review") };
        submissionRef.current = submission;
        setBusy(true);
        try {
          const result = await triggerUserKycReview(selected.userId, {
            reasonCode, reason: reason.trim(), evidenceRef, operator: OPERATOR(), idempotencyKey: submission.key,
          });
          submissionRef.current = null;
          await loadData(true);
          toast(`K5 复审工单${text(result.status) === "MERGED" ? "已合并" : "已创建"} · ${text(result.ticketId)}`);
        } catch (err) {
          toast(errorMessage(err));
          throw err;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  const toggleNetwork = (network: string) => {
    if (!canWriteNetwork) {
      toast("当前角色没有修改配对网络的权限");
      return;
    }
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
      reasonMin: 8,
      reasonMax: 200,
      run: (reason) => {
        const fingerprint = `${nextNetworks.join("/")}|${reason.trim()}`;
        const submission = networkSubmissionRef.current?.fingerprint === fingerprint
          ? networkSubmissionRef.current
          : { fingerprint, key: newCommandKey("c4-kyc-network") };
        networkSubmissionRef.current = submission;
        void perform(
          async () => {
            await updateUserKycNetworkWhitelist(nextNetworks.join(" / "), reason, OPERATOR(), submission.key);
            networkSubmissionRef.current = null;
            return `${network} 已${enabled ? "停用" : "启用"}`;
          },
          "配对网络白名单已更新",
        );
      },
    });
  };

  const downloadExport = async (job: UserKycExportJob) => {
    const jobNo = text(job.jobNo, "");
    if (!jobNo) return;
    setBusy(true);
    try {
      const file = await downloadUserKycExport(jobNo);
      saveBlob(file.blob, file.fileName);
      toast(`已下载 · ${file.fileName}`);
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
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
                  <button key={network} className="l-btn sm mc" disabled={busy || !canWriteNetwork} onClick={() => toggleNetwork(network)} style={{ opacity: enabled ? 1 : 0.5 }} title={canWriteNetwork ? `${enabled ? "停用" : "启用"} ${network}` : "无修改权限"}>
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
            <span className="sub">· 后端分页 · 展示用户编码、昵称与脱敏手机号</span>
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
            <span className="sub">· 变更后立即生效并保留记录</span>
            <div className="r">
              {selected && canVerify && text(selected.backendStatus) !== "APPROVED" && <button className="l-btn mc" disabled={busy} onClick={() => changeStatus("APPROVED", "已验证", true)}>人工标记已验证</button>}
              {selected && canRevoke && text(selected.backendStatus) === "APPROVED" && <button className="l-btn mc" disabled={busy} onClick={() => changeStatus("NONE", "未验证", false)}>撤销实名</button>}
              {selected && canTriggerReview && <button className="l-btn" disabled={busy} onClick={triggerReview}>触发复审</button>}
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

      {canExport && (
        <section className="l-card" style={{ marginTop: 12 }}>
          <div className="l-h">
            <span className="ttl">最近导出任务</span>
            <span className="sub">· 任务持久保存,刷新或重新登录后仍可下载</span>
          </div>
          {exportError && <div className="ctint warn" style={{ margin: "0 12px 12px" }}>导出任务暂时无法加载 · {exportError}；实名台账仍可继续核对。</div>}
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 720 }}>
              <thead><tr><th>任务号</th><th>状态</th><th>范围</th><th>行数</th><th>创建时间</th><th>操作</th></tr></thead>
              <tbody>
                {exports.map((job) => (
                  <tr key={text(job.jobNo)}>
                    <td className="mono">{text(job.jobNo)}</td>
                    <td><span className={`bdg ${text(job.status) === "READY" ? "ok" : "dim"}`}>{exportStatusLabel(job.status)}</span></td>
                    <td>{exportScopeLabel(job.scope)}</td>
                    <td className="mono">{asNumber(job.rowCount).toLocaleString("en-US")}</td>
                    <td className="mono">{text(job.createdAt)}</td>
                    <td><button className="l-btn sm" disabled={busy || text(job.status) !== "READY"} onClick={() => void downloadExport(job)}>下载</button></td>
                  </tr>
                ))}
                {exports.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)", padding: 18 }}>暂无导出任务</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="f-foot"><b>权威与引用关系</b>:实名状态、配对地址、网络白名单和监管导出均读取权威业务台账。页面只展示用户编码与脱敏字段;人工标记、撤销和复审触发均带防重号、理由、依据和审计链路。</p>
    </>
  );
}

export function C4HeaderActions({ ctx }: { ctx: CCtx }) {
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canExport = authorities.includes("user_c4_export");
  const submissionRef = useRef<{ fingerprint: string; key: string } | null>(null);
  if (!canExport) return null;
  return (
    <button
      className="f-cta"
      onClick={() => ctx.openActionConfirm({
        action: "监管导出(脱敏)",
        detail: "生成账户编码、实名状态、网络、配对时间与触发来源的脱敏 CSV。任务会写入 L5 报表中心并可在本页最近任务中再次下载。",
        amplifies: false,
        reasonMin: 8,
        reasonMax: 200,
        run: async (reason) => {
          const reasonLength = reason.trim().length;
          if (reasonLength < 8 || reasonLength > 200) throw new Error("导出原因需为 8-200 字");
          const fingerprint = `MASKED_LEDGER|${reason.trim()}`;
          const submission = submissionRef.current?.fingerprint === fingerprint
            ? submissionRef.current
            : { fingerprint, key: newCommandKey("c4-kyc-export") };
          submissionRef.current = submission;
          try {
            const job = await createUserKycExport("MASKED_LEDGER", reason.trim(), OPERATOR(), submission.key);
            submissionRef.current = null;
            window.dispatchEvent(new Event("c4-export-created"));
            ctx.toast(`KYC 脱敏导出已就绪 · ${text(job.jobNo)}`);
          } catch (err) {
            ctx.toast(errorMessage(err));
            throw err;
          }
        },
      })}
    >
      <Download size={14} />
      监管导出(脱敏)
    </button>
  );
}
