"use client";

import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataListPager, Modal } from "../design-kit";
import { TabGroup } from "@/app/components/kit/tab-group";
import { fetchK1MultiAccountOverview, K1OutcomeUncertainError, K1_RELEASE_MODE_VALUES, K1_RELEASE_PARAM_LIMITS, newK1CommandKey } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { A2OutcomeUncertainError } from "@/lib/admin/a2-client";
import type { AdminPage, ClusterStatus, K1Cluster, K1ClusterLayer, K1ClusterSort, K1ClusterStatusFilter, K1ProtectedEntry, K1WhitelistRow, KRiskParam } from "@/lib/admin/k-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createPendingMutationStore, createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
/** 账户簇处置与白名单移除共用一张表,调用点 scope 已带动作类型前缀 + 目标 id + 版本
 *  (`cluster-freeze:簇号:版本`、`whitelist-disable:网段`),刷新后仍能用同一命令号重试。 */
const commandAttempt = createPendingMutationStore({
  storageKey: "nexion-admin-k1-multiaccount-commands-v1",
});
/** 释放参数调参带自由输入值,不能用按槽位无条件复用的朴素 store:运营在「结果未知」后改了值再提交,
 *  朴素 store 会复用旧命令号,后端 24h 防重复提交窗把新值当重复提交静默吞掉(界面还报成功)。
 *  按「槽位 + 输入指纹」解析 —— 同键同输入才复用,输入变了铸新号。F 域同类调参用的是同一个组件。 */
const releaseAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-k1-release-commands-v1",
});
const CLUSTER_PAGE_SIZE_OPTIONS = [5, 10, 20];
const WHITELIST_PAGE_SIZE_OPTIONS = [5, 10, 20];
const MAX_FOCUS_RELOCATIONS = 3;
const EMPTY_CLUSTER_PAGE: AdminPage<K1Cluster> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
const EMPTY_WHITELIST_PAGE: AdminPage<K1WhitelistRow> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
// if (ctx.contentError) the K1 component returns a dedicated retry state before rendering any stale business controls.
type WeightDraft = { param: KRiskParam; device: string; payment: string; ip: string; reason: string; commandKey: string };
type ParamDraft = { param: KRiskParam; value: string; reason: string; commandKey: string };
type WhitelistDraft = { cidr: string; note: string; expireText: string; reason: string; commandKey: string };
const PARAM_LIMITS: Record<string, { min: number; max: number; step: number; integer: boolean }> = {
  maxSignupPerIp24h: { min: 1, max: 10, step: 1, integer: true },
  maxAccountsPerDevice: { min: 1, max: 5, step: 1, integer: true },
  maxAccountsPerPaymentInstrument: { min: 1, max: 5, step: 1, integer: true },
  clusterFreezeSuggestThreshold: { min: 0, max: 1, step: 0.05, integer: false },
};

const CLUSTER_ST: Record<ClusterStatus, [string, string]> = {
  detected: ["待判定", "dim"],
  flagged: ["可疑", "warn"],
  frozen: ["已冻结", "bad"],
  released: ["解除误判", "ok"],
  cleared: ["正常", "ok"],
};

// ── 收益释放参数(SPEC-7 搬回,合并底账 §二#5)──────────────────────────
// enum/boolean 的运营可读中文标签(页面禁裸工程串);数值范围与键集统一来源在 k-client,
// 读校验与编辑弹窗共用,避免两处漂移。
const RELEASE_MODE_LABELS: Record<string, string> = {
  manual_only: "仅人工放行",
};
const RELEASE_BOOL_LABELS: Record<string, string> = { true: "开启", false: "关闭" };
const RISK_PARAM_COPY: Record<string, { name: string; sub: string }> = {
  maxSignupPerIp24h: { name: "同一 IP 每天最多注册多少个账号", sub: "正式环境达到上限后，会拒绝该 IP 的新注册。" },
  maxAccountsPerDevice: { name: "同一设备最多关联多少个账号", sub: "超过这个数量后，系统会提示多账户风险。" },
  maxAccountsPerPaymentInstrument: { name: "同一支付工具最多关联多少个账号", sub: "超过这个数量后，系统会提示多账户风险。" },
  linkWeight: { name: "设备、支付工具和 IP 的关联权重", sub: "权重越高，该依据对关联程度的影响越大。" },
  clusterFreezeSuggestThreshold: { name: "建议冻结的关联程度", sub: "达到这个数值只显示建议，不会自动冻结账户。" },
};
const riskParamName = (p: KRiskParam) => RISK_PARAM_COPY[p.key]?.name ?? p.name;
const riskParamSub = (p: KRiskParam) => RISK_PARAM_COPY[p.key]?.sub ?? p.sub;
const RELEASE_PARAM_COPY: Record<string, { name: string; sub: string }> = {
  freePhoneSlotsPerCluster: { name: "同组正常放行的手机号数", sub: "同一组关联账户中，可按正常账户处理的手机号数量。" },
  duplicateAccountPendingFrom: { name: "第几个关联账号起审核收益", sub: "从这个账号开始，新增收益须先审核。" },
  duplicateAccountFreezeFrom: { name: "第几个关联账号起建议冻结", sub: "达到这个账号数只提出冻结建议，不会自动冻结账户。" },
  pendingReleaseHours: { name: "批量放行统计时间范围", sub: "只统计这段时间内的放行记录，不会自动放款。" },
  releaseMode: { name: "收益放行方式", sub: "目前只能人工审核后放行。" },
  freeSlotRequiresBinding: { name: "正常名额是否需要绑定手机号", sub: "开启后，正常放行的名额须绑定手机号。" },
};
const releaseParamName = (p: KRiskParam) => RELEASE_PARAM_COPY[p.key]?.name ?? p.name;
const releaseParamSub = (p: KRiskParam) => RELEASE_PARAM_COPY[p.key]?.sub ?? p.sub;

// 簇状态 → 收益桶结论(展示派生,不动处理流程;权威结算在服务端)。
const CLUSTER_EARNING_IMPACT: Record<ClusterStatus, { label: string; tone: string; desc: string }> = {
  detected: { label: "正常名额内可提现", tone: "dim", desc: "这组账户仍待判定；正常名额内的收益可提现，超出名额的收益须先审核。" },
  flagged: { label: "审核中", tone: "warn", desc: "标记为可疑后，超出正常名额的收益须人工审核。" },
  frozen: { label: "锁定奖励", tone: "bad", desc: "冻结这组账户后，新增收益会锁定，提现审核也会更严格。" },
  released: { label: "恢复正常", tone: "ok", desc: "解除误判后，之后的收益按正常账户处理；之前待审核的仍按审核结果处理。" },
  cleared: { label: "正常释放", tone: "ok", desc: "判定正常后，这组账户退出风险监控；后续收益按普通账户处理。" },
};

function formatThreshold(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "未配置";
}

function strengthColor(v: number, threshold: number) {
  if (!Number.isFinite(threshold)) return "var(--ink-4)";
  return v >= threshold
    ? "var(--danger)"
    : v >= threshold * 0.8 ? "var(--warning)" : "var(--success)";
}

function errorText(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // client 已接咽喉,英文网络错误不再到达;按原压制意图改判「咽喉网络中文」,命中仍走自家短文案。
  return message.includes("网络连接失败或系统暂时连不上")
    ? "暂时无法连接风险服务，请稍后重试"
    : message ? displayAdminError(error) : "暂时无法读取风险数据";
}

/** 释放参数的「放宽」方向判定(口径与 PRD v1 [K1] K1-MD4 逐条一致)。
 *  放宽 = 让更多收益更快进入可提桶 = 放大资金流出方向,须在弹窗告知并由服务端前置 B1 覆盖率核验。
 *  数值键分两族:调**大**是放宽(槽位 / 待审起点 / 重复账号建议线)· 调**小**是放宽(观察窗口 / 在线证明时长)。 */
const RELEASE_LOOSEN_WHEN_LARGER = new Set(["freePhoneSlotsPerCluster", "duplicateAccountPendingFrom", "duplicateAccountFreezeFrom"]);
const RELEASE_LOOSEN_WHEN_SMALLER = new Set(["pendingReleaseHours"]);
export function isLooseningRelease(key: string, current: string, next: string): boolean {
  if (RELEASE_LOOSEN_WHEN_LARGER.has(key)) return Number(next) > Number(current);
  if (RELEASE_LOOSEN_WHEN_SMALLER.has(key)) return Number(next) < Number(current);
  // 释放模式:仅人工放行 → 允许在线证明放行 = 多开一条自动放行来源 = 放宽。
  if (key === "releaseMode") return false;
  // 首号绑定要求:开启 → 关闭 = 免费槽不再要求绑定 = 放宽。
  if (key === "freeSlotRequiresBinding") return current === "true" && next === "false";
  return false;
}

function confirmedK1FailureText(error: unknown) {
  return `操作失败，没有生效，已填写的内容还在 · ${errorText(error)}`;
}

function parseNamedWeight(value: string, label: string, fallback: string) {
  const idx = value.indexOf(label);
  if (idx < 0) return fallback;
  const suffix = value.slice(idx + label.length);
  const match = suffix.match(/[0-9]+(?:\.[0-9]+)?/);
  return match?.[0] ?? fallback;
}

function parseLinkWeight(value: string): Pick<WeightDraft, "device" | "payment" | "ip"> {
  return {
    device: parseNamedWeight(value, "设备", "0.50"),
    payment: parseNamedWeight(value, "支付", "0.40"),
    ip: parseNamedWeight(value, "IP", "0.10"),
  };
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function linkWeightValue(draft: WeightDraft) {
  const device = numberValue(draft.device);
  const payment = numberValue(draft.payment);
  const ip = numberValue(draft.ip);
  return `设备 ${device.toFixed(2)} · 支付 ${payment.toFixed(2)} · IP ${ip.toFixed(2)}`;
}

export function K1HeaderActions() {
  return null;
}

// 账户状态三态口径,图与表共用一套 —— 两边各写一份必然漂开(表里三种处置全坍缩成
// 「受限」、正常态还把 ACTIVE 裸英文甩给运营;图里空状态被 ?? 漏过去当成了「正常」绿)。
// 状态字段允许为空(k-client 对该位 allowEmpty),所以「未知」必须是独立一态,
// 不能和「正常」同色 —— 这是反多账户域,把「不知道」画成「没问题」是最危险的一种错。
const RESTRICTED_STATUS = /FROZEN|BANNED|RESTRICTED/i;
const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "正常", NORMAL: "正常", FROZEN: "已冻结", BANNED: "已封禁", RESTRICTED: "已受限",
};

export function isRestrictedStatus(status?: string) {
  return RESTRICTED_STATUS.test(status ?? "");
}

export function isUnknownStatus(status?: string) {
  const value = (status ?? "").trim();
  return !value || /UNKNOWN|未知/i.test(value);
}

/** 页面不许出现枚举值:认识的映射成中文,不认识的说「其它(原值)」而不是裸抛英文码。 */
export function accountStatusLabel(status?: string) {
  const value = (status ?? "").trim();
  if (isUnknownStatus(value)) return "未知";
  return ACCOUNT_STATUS_LABEL[value.toUpperCase()] ?? "状态待核验";
}

function ClusterGraph({ c }: { c: K1Cluster }) {
  const gid = useId();
  const W = 320, H = 272, cx = W / 2, cy = H / 2, R = 94;
  const edgeColor = (layer: string) => layer === "device" ? "var(--warning)" : layer === "payment" ? "var(--cyan)" : "var(--ink-4)";
  // 三态与右侧账户表同源:空状态走 --ink-4,绝不能落进「正常」绿。
  const nodeColor = (status: string) => isRestrictedStatus(status) ? "var(--danger)" : isUnknownStatus(status) ? "var(--ink-4)" : "var(--success)";
  const k = Math.min(c.nodes.length, 8);
  const over = Math.max(c.n - k, 0);
  const total = Math.max(k + (over > 0 ? 1 : 0), 1);
  const positions = new Map(c.nodes.slice(0, k).map((node, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
    return [node[0], { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), angle }] as const;
  }));
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 272, display: "block" }} aria-label={`关联账户组 ${c.id} 关系图`}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--border)" strokeDasharray="3 6" />
      {c.edges.map((edge, index) => {
        const from = positions.get(edge[0]);
        const to = positions.get(edge[1]);
        if (!from || !to) return null;
        return <line key={`${gid}-edge-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edgeColor(edge[2])} strokeWidth={1.2 + edge[3] * 3} opacity={0.68} />;
      })}
      {Array.from({ length: total }, (_, i) => {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
        const ux = Math.cos(a), uy = Math.sin(a);
        const x = cx + R * ux, y = cy + R * uy;
        const isOver = i >= k;
        if (isOver) {
          return (
            <g key={`${gid}-o`}>
              <circle cx={x} cy={y} r={13} fill="var(--surface-2)" stroke="var(--border-strong)" strokeWidth={1.3} strokeDasharray="3 3" />
              <text x={x} y={y + 4} fontSize={11} fontWeight={700} fill="var(--ink-4)" textAnchor="middle">{`+${over}`}</text>
              <text x={x} y={uy >= 0 ? y + 30 : y - 22} fontSize={10.5} fill="var(--ink-4)" textAnchor="middle">未列出</text>
            </g>
          );
        }
        const nd = c.nodes[i];
        const col = nodeColor(nd?.[5] ?? "UNKNOWN");
        return (
          <g key={`${gid}-${nd?.[0] ?? i}`}>
            <circle cx={x} cy={y} r={18} fill={col} opacity={0.1} />
            <circle cx={x} cy={y} r={13} fill="var(--surface-2)" stroke={col} strokeWidth={1.6} />
            <circle cx={x} cy={y} r={3} fill={col} />
            {nd?.[3] === "是" && <circle cx={x + 10} cy={y - 10} r={3.6} fill="var(--warning)" stroke="var(--surface)" strokeWidth={1.5} />}
            <text x={x} y={uy >= 0 ? y + 31 : y - 23} fontSize={11} fill="var(--ink-2)" textAnchor="middle">{(nd?.[0] ?? "").slice(4)}</text>
          </g>
        );
      })}
      {!c.edges.length && <text x={cx} y={cy + 4} fontSize={11} fill="var(--ink-4)" textAnchor="middle">暂无可展示关联边</text>}
    </svg>
    <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", padding: "10px 4px 2px", fontSize: 11.5, color: "var(--ink-3)", textWrap: "pretty" }}>
      <LegendItem swatch={<EdgeSwatch color="var(--warning)" />}>共享设备</LegendItem>
      <LegendItem swatch={<EdgeSwatch color="var(--cyan)" />}>共享支付方式</LegendItem>
      <LegendItem swatch={<EdgeSwatch color="var(--ink-4)" />}>同 IP 或网段</LegendItem>
      <LegendItem swatch={<EdgeSwatch color="var(--ink-3)" thick />}>线越粗、关联越强</LegendItem>
      <LegendItem swatch={<NodeSwatch color="var(--success)" />}>账户正常</LegendItem>
      <LegendItem swatch={<NodeSwatch color="var(--danger)" />}>已冻结 / 封禁 / 受限</LegendItem>
      <LegendItem swatch={<NodeSwatch color="var(--ink-4)" />}>状态未知</LegendItem>
      <LegendItem swatch={<DotSwatch />}>领过新人礼</LegendItem>
      <LegendItem swatch={<OverflowSwatch />}>本图未画出的账户</LegendItem>
    </div>
    </>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>{swatch}{children}</span>;
}

function EdgeSwatch({ color, thick }: { color: string; thick?: boolean }) {
  return <span style={{ width: 16, height: thick ? 3.5 : 1.5, borderRadius: 2, background: color, opacity: 0.8 }} />;
}

function NodeSwatch({ color }: { color: string }) {
  return <span style={{ width: 11, height: 11, borderRadius: "50%", background: color, opacity: 0.85 }} />;
}

function DotSwatch() {
  return <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--warning)" }} />;
}

function OverflowSwatch() {
  return <span className="mono" style={{ color: "var(--ink-4)", fontWeight: 600 }}>+N</span>;
}

function isValidCidr(value: string) {
  const match = value.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/);
  return !!match && match.slice(1, 5).every((part) => /^(0|[1-9]\d{0,2})$/.test(part) && Number(part) <= 255);
}

function futureIsoDate(value: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isFinite(parsed.getTime()) && parsed > today;
}

export function K1MultiAccount({ ctx }: { ctx: KCtx }) {
  const propose = usePropose();
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const hasAuthority = (authority: string) => authorities.includes(authority);
  const canWrite = hasAuthority("risk_k1_write");
  const canFlag = hasAuthority("risk_k1_cluster_flag");
  const canFreeze = hasAuthority("risk_k1_cluster_freeze");
  const canRelease = hasAuthority("risk_k1_cluster_release");
  const canClear = hasAuthority("risk_k1_cluster_cleared");
  const [layer, setLayer] = useState<K1ClusterLayer>("all");
  const [clusterStatus, setClusterStatusFilter] = useState<K1ClusterStatusFilter>("all");
  const [clusterSort, setClusterSort] = useState<K1ClusterSort>("strength_desc");
  const [clusterPage, setClusterPage] = useState(1);
  const [clusterPageSize, setClusterPageSize] = useState(5);
  const [whitelistPage, setWhitelistPage] = useState(1);
  const [whitelistPageSize, setWhitelistPageSize] = useState(5);
  const [sel, setSel] = useState(0);
  const [weightDraft, setWeightDraft] = useState<WeightDraft | null>(null);
  const [paramDraft, setParamDraft] = useState<ParamDraft | null>(null);
  const [releaseDraft, setReleaseDraft] = useState<ParamDraft | null>(null);
  const [protectedEntries, setProtectedEntries] = useState<K1ProtectedEntry[]>([]);
  const [protectedEntriesLoading, setProtectedEntriesLoading] = useState(true);
  const [protectedEntriesError, setProtectedEntriesError] = useState<string | null>(null);
  const [whitelistDraft, setWhitelistDraft] = useState<WhitelistDraft | null>(null);
  const [draftSubmitting, setDraftSubmitting] = useState<"param" | "weight" | "whitelist" | "release" | null>(null);
  const draftSubmitLock = useRef(false);
  const formId = useId();
  const [focusLookupState, setFocusLookupState] = useState<"idle" | "loading" | "positioning" | "found" | "not-found" | "error">("idle");
  const focusPageLoad = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusClusterId = (searchParams?.get("focusClusterId") ?? "").trim();
  const overview = ctx.risk.multiAccount;

  const refreshProtectedEntries = useCallback(async () => {
    setProtectedEntriesLoading(true);
    try {
      setProtectedEntries(await ctx.actions.fetchK1ProtectedEntries());
      setProtectedEntriesError(null);
    } catch (error) {
      setProtectedEntries([]);
      setProtectedEntriesError(errorText(error));
    } finally {
      setProtectedEntriesLoading(false);
    }
  }, [ctx.actions]);

  useEffect(() => { void refreshProtectedEntries(); }, [refreshProtectedEntries]);
  const stats = overview?.stats ?? {};
  const params = overview?.params ?? [];
  const freezeThresholdParam = params.find((param) => param.key === "clusterFreezeSuggestThreshold");
  const parsedFreezeSuggestThreshold = Number(freezeThresholdParam?.value);
  const freezeSuggestThreshold = Number.isFinite(parsedFreezeSuggestThreshold)
    && parsedFreezeSuggestThreshold >= 0
    && parsedFreezeSuggestThreshold <= 1
    ? parsedFreezeSuggestThreshold
    : Number.POSITIVE_INFINITY;
  const clusterPageData = overview?.clusters ?? EMPTY_CLUSTER_PAGE;
  const whitelistPageData = overview?.whitelist ?? EMPTY_WHITELIST_PAGE;
  const clusters = clusterPageData.records;
  const whitelist = whitelistPageData.records;
  const pageQuery = useMemo(() => ({
    clusterPageNum: clusterPage,
    clusterPageSize,
    clusterLayer: layer,
    clusterStatus,
    clusterSort,
    whitelistPageNum: whitelistPage,
    whitelistPageSize,
  }), [clusterPage, clusterPageSize, layer, clusterStatus, clusterSort, whitelistPage, whitelistPageSize]);
  const focusBlocksSelection = Boolean(focusClusterId) && focusLookupState !== "found";
  const cur = focusBlocksSelection ? undefined : clusters[sel] ?? clusters[0];

  const exitFocusMode = () => {
    focusPageLoad.current = false;
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("focusClusterId");
    next.delete("source");
    setFocusLookupState("idle");
    setSel(0);
    router.replace(next.size ? `?${next.toString()}` : "?");
  };

  useEffect(() => {
    if (focusPageLoad.current) return;
    void ctx.reloadKRisk({ multiAccount: pageQuery }).catch(() => undefined);
  }, [ctx.reloadKRisk, pageQuery]);

  useEffect(() => {
    setSel(0);
  }, [clusterPage, clusterPageSize, layer, clusterStatus, clusterSort]);

  useEffect(() => {
    if (!focusClusterId) {
      setFocusLookupState("idle");
      return;
    }
    let active = true;
    focusPageLoad.current = true;
    setFocusLookupState("loading");
    setLayer("all");
    setClusterStatusFilter("all");
    setSel(0);
    void (async () => {
      const searchPageSize = 50;
      for (let relocation = 0; active && relocation < MAX_FOCUS_RELOCATIONS; relocation += 1) {
        let searchPage = 1;
        let targetPage: number | null = null;
        while (active) {
          const result = await fetchK1MultiAccountOverview({
            clusterPageNum: searchPage,
            clusterPageSize: searchPageSize,
            clusterLayer: "all",
            clusterStatus: "all",
            clusterSort,
            whitelistPageNum: 1,
            whitelistPageSize: 5,
          });
          const index = result.clusters.records.findIndex((cluster) => cluster.id === focusClusterId);
          if (index >= 0) {
            const absoluteIndex = (searchPage - 1) * searchPageSize + index;
            targetPage = Math.floor(absoluteIndex / clusterPageSize) + 1;
            break;
          }
          const totalPages = Math.max(1, Math.ceil(result.clusters.total / searchPageSize));
          if (searchPage >= totalPages) break;
          searchPage += 1;
        }
        if (!active) return;
        if (targetPage === null) {
          if (active) setFocusLookupState("not-found");
          return;
        }
        setFocusLookupState("positioning");
        setClusterPage(targetPage);
        const positioned = await ctx.reloadKRisk({
          multiAccount: {
            clusterPageNum: targetPage,
            clusterPageSize,
            clusterLayer: "all",
            clusterStatus: "all",
            clusterSort,
            whitelistPageNum: whitelistPage,
            whitelistPageSize,
          },
        });
        if (!active) return;
        const positionedIndex = positioned?.clusters.records.findIndex((cluster) => cluster.id === focusClusterId) ?? -1;
        if (positionedIndex >= 0) {
          setSel(positionedIndex);
          setFocusLookupState("found");
          focusPageLoad.current = false;
          return;
        }
        setFocusLookupState("loading");
      }
      if (active) setFocusLookupState("error");
    })().catch(() => {
      if (active) setFocusLookupState("error");
    }).finally(() => {
      focusPageLoad.current = false;
    });
    return () => {
      active = false;
      focusPageLoad.current = false;
    };
  }, [clusterPageSize, clusterSort, ctx.reloadKRisk, focusClusterId, whitelistPage, whitelistPageSize]);

  const statKnown = (key: string) => stats[key] !== null && stats[key] !== undefined;
  const statText = (key: string) => statKnown(key) ? fmt(Number(stats[key])) : "—";
  const runAction = async (work: () => Promise<void>, ok: string) => {
    try {
      await work();
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError
        ? `结果暂未确认 · 请直接重试（不会重复执行），不要新建操作 · 命令号 ${error.commandKey}`
        : confirmedK1FailureText(error));
      throw error;
    }
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(ok);
    } catch {
      ctx.toast(`${ok}，但页面刷新失败；请点「重新加载」核对`);
    }
  };

  const proposeClusterAction = async (scope: string, spec: Parameters<typeof propose>[1]) => {
    const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
    commandAttempt.remember(scope, commandKey);
    try {
      const result = await propose(ctx.toast, { ...spec, commandKey });
      commandAttempt.forget(scope);
      return result;
    } catch (error) {
      if (!(error instanceof A2OutcomeUncertainError)) commandAttempt.forget(scope);
      throw error;
    }
  };

  const flagCluster = (c: K1Cluster) =>
    ctx.openConfirm({
      action: `标记可疑账户组 · ${c.id}`,
      detail: "只标记为可疑，不冻结资产。风险评分和风险提醒会同步更新，并保留操作记录。",
      chips: [["只标记，不动资产", "done"], ["记入操作记录", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => {
        const def = findHighOp("k1_cluster_flag")!;
        return proposeClusterAction(`cluster-flag:${c.id}:${c.version}`, {
          action: `标记可疑账户组 · ${c.id}`,
          obj: c.id,
          before: c.status,
          after: "flagged",
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K1",
          command: def.buildCommand({ clusterId: c.id, expectedVersion: c.version }),
          target: def.buildTarget({ clusterId: c.id }),
        });
      },
    });

  const freezeCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `批量冻结关联账户 · ${c.id}`,
      detail: `冻结这组里的 ${c.n} 个账户。请填写原因，会记入操作记录。`,
      reasonMax: 200,
      run: (reason) => {
        const def = findHighOp("k1_cluster_freeze")!;
        return proposeClusterAction(`cluster-freeze:${c.id}:${c.version}`, {
          action: `批量冻结关联账户 · ${c.id}`,
          obj: c.id,
          before: c.status,
          after: "frozen",
          type: "acct",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K1",
          command: def.buildCommand({ clusterId: c.id, expectedVersion: c.version }),
          target: def.buildTarget({ clusterId: c.id }),
        });
      },
    });

  const releaseCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `解除误判 · ${c.id}`,
      detail: "解除后，这些账户可能有更多收益可以提现。请核对影响并写明原因。",
      amplifies: true,
      reasonMax: 200,
      run: (reason) => {
        const def = findHighOp("k1_cluster_release")!;
        return proposeClusterAction(`cluster-release:${c.id}:${c.version}`, {
          action: `解除误判 · ${c.id}`,
          obj: c.id,
          before: c.status,
          after: "released",
          type: "acct",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K1",
          command: def.buildCommand({ clusterId: c.id, expectedVersion: c.version }),
          target: def.buildTarget({ clusterId: c.id }),
        });
      },
    });

  const clearCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `判定为正常 · ${c.id}`,
      detail: "这组账户将退出风险监控，后续风险评分也会受影响。请填写判定依据。",
      amplifies: true,
      reasonMax: 200,
      run: (reason) => {
        const def = findHighOp("k1_cluster_cleared")!;
        return proposeClusterAction(`cluster-clear:${c.id}:${c.version}`, {
          action: `判定为正常 · ${c.id}`,
          obj: c.id,
          before: c.status,
          after: "cleared",
          type: "acct",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K1",
          command: def.buildCommand({ clusterId: c.id, expectedVersion: c.version }),
          target: def.buildTarget({ clusterId: c.id }),
        });
      },
    });

  const reviewNote = (c: K1Cluster) => {
    const commandKey = newK1CommandKey();
    ctx.openConfirm({
      action: `人工复审备注 · ${c.id}`,
      detail: "记录复审备注并保持当前状态不变。",
      chips: [["只写备注，不改状态", "done"], ["记入操作记录", "ready"]],
      reason: true,
      okLabel: "保存备注",
      run: (reason) => runAction(() => ctx.actions.updateK1ClusterReviewNote(c.id, c.version, reason, commandKey), `${c.id} 复审备注已保存`),
    });
  };

  const adjParam = (p: KRiskParam) => {
    if (p.key === "linkWeight") {
      setWeightDraft({ param: p, ...parseLinkWeight(p.value), reason: "", commandKey: newK1CommandKey() });
      return;
    }
    if (!PARAM_LIMITS[p.key]) {
      ctx.toast(`这个参数不能在这里修改`);
      return;
    }
    setParamDraft({ param: p, value: p.value, reason: "", commandKey: newK1CommandKey() });
  };

  // 收益释放参数编辑:命令号在**提交时**按「槽位 + 输入指纹」解析(见 releaseAttempts 注),
  // 不在开弹窗时铸号 —— 开弹窗时还不知道运营要填什么,提前铸号就没法区分「原样重试」和「改了值再提交」。
  const releaseScope = (key: string) => `release-param:${key}`;
  const releaseFingerprint = (value: string, version: number, reason: string) =>
    JSON.stringify([value, version, reason.trim()]);
  const adjReleaseParam = (p: KRiskParam) => {
    setReleaseDraft({ param: p, value: p.value, reason: "", commandKey: "" });
  };

  const releaseProtectedEntry = (entry: K1ProtectedEntry) => {
    ctx.openActionConfirm({
      action: `人工放行收益 · ${entry.entryNo}`,
      detail: `${entry.userId} · ${entry.clusterId} · ${entry.amount} ${nexGridBrandText(entry.asset)} · ${entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"}`,
      amplifies: true,
      reasonMin: 8,
      reasonMax: 200,
      completionCopy: "收益已人工放行，并记入操作记录。",
      run: async (reason) => {
        const scope = `earnings-release:${entry.entryNo}`;
        const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
        commandAttempt.remember(scope, commandKey);
        try {
          await ctx.actions.manualReleaseK1Entry(entry.entryNo, reason, commandKey);
          commandAttempt.forget(scope);
          await refreshProtectedEntries();
          ctx.toast(`${entry.entryNo} 已放行，可以提现`);
        } catch (error) {
          if (!(error instanceof K1OutcomeUncertainError)) commandAttempt.forget(scope);
          throw error;
        }
      },
    });
  };

  const saveReleaseDraft = async () => {
    if (!releaseDraft || draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting("release");
    const scope = releaseScope(releaseDraft.param.key);
    // 同槽位 + 同输入 → 复用命令号(原样重试不重复下单);输入变了 → 自动铸新号(改值再提交不被防重复提交窗吞掉)。
    const commandKey = releaseAttempts.resolve(
      scope,
      releaseFingerprint(releaseDraft.value, releaseDraft.param.version, releaseDraft.reason),
      () => newK1CommandKey(),
    );
    try {
      await ctx.actions.updateK1ReleaseParam(releaseDraft.param.key, releaseDraft.value,
        releaseDraft.param.version, releaseDraft.reason.trim(), commandKey);
      releaseAttempts.forget(scope);
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError
        ? `结果暂未确认 · 请保留弹窗直接重试 · 命令号 ${error.commandKey}`
        : confirmedK1FailureText(error));
      // 确定性失败 = 本次命令已终结,丢弃该槽位;下次提交(无论输入变没变)都会铸新号。
      // 结果未知则**不丢弃** —— 原样重试要复用同号,改了值则由指纹自动换号。
      if (!(error instanceof K1OutcomeUncertainError)) releaseAttempts.forget(scope);
      return;
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
    setReleaseDraft(null);
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(`${releaseParamName(releaseDraft.param)}已更新，后续收益审核与提现按新值执行`);
    } catch {
      ctx.toast(`${releaseParamName(releaseDraft.param)}已保存，但暂时无法读取最新数据；请刷新本页核对`);
    }
  };

  const releaseParamDisplay = (p: KRiskParam): string => {
    if (p.key === "releaseMode") return RELEASE_MODE_LABELS[p.value] ?? p.value;
    if (p.key === "freeSlotRequiresBinding") return RELEASE_BOOL_LABELS[p.value] ?? p.value;
    return p.value;
  };

  const saveWeightDraft = async () => {
    if (!weightDraft || draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting("weight");
    const value = linkWeightValue(weightDraft);
    try {
      await ctx.actions.updateK1Param(weightDraft.param.key, value, weightDraft.reason.trim(), weightDraft.commandKey);
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError
        ? `结果暂未确认 · 请保留弹窗直接重试 · 命令号 ${error.commandKey}`
        : confirmedK1FailureText(error));
      if (!(error instanceof K1OutcomeUncertainError)) {
        setWeightDraft((current) => current ? { ...current, commandKey: newK1CommandKey() } : current);
      }
      return;
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
    setWeightDraft(null);
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(`${riskParamName(weightDraft.param)} 已更新为 ${value}`);
    } catch {
      ctx.toast(`${riskParamName(weightDraft.param)} 已保存，但页面刷新失败；请点「重新加载」核对`);
    }
  };

  const saveParamDraft = async () => {
    if (!paramDraft || draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting("param");
    try {
      await ctx.actions.updateK1Param(paramDraft.param.key, paramDraft.value, paramDraft.reason.trim(), paramDraft.commandKey);
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError ? `结果暂未确认 · 请保留弹窗直接重试 · 命令号 ${error.commandKey}` : confirmedK1FailureText(error));
      if (!(error instanceof K1OutcomeUncertainError)) setParamDraft((current) => current ? { ...current, commandKey: newK1CommandKey() } : current);
      return;
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
    setParamDraft(null);
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(`${riskParamName(paramDraft.param)}已更新为 ${paramDraft.value}`);
    } catch {
      ctx.toast(`${riskParamName(paramDraft.param)}已保存，但暂时无法读取最新数据；请刷新本页核对`);
    }
  };

  const saveWhitelistDraft = async () => {
    if (!whitelistDraft || draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting("whitelist");
    try {
      await ctx.actions.upsertK1Whitelist(
        whitelistDraft.cidr.trim(), whitelistDraft.note.trim(), whitelistDraft.reason.trim(),
        whitelistDraft.expireText, whitelistDraft.commandKey,
      );
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError ? `结果暂未确认 · 请保留弹窗直接重试 · 命令号 ${error.commandKey}` : confirmedK1FailureText(error));
      if (!(error instanceof K1OutcomeUncertainError)) setWhitelistDraft((current) => current ? { ...current, commandKey: newK1CommandKey() } : current);
      return;
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
    setWhitelistDraft(null);
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast("已加入允许名单");
    } catch {
      ctx.toast("已加入允许名单，但页面刷新失败；请点「重新加载」核对");
    }
  };

  const addWl = () => setWhitelistDraft({ cidr: "", note: "", expireText: "", reason: "", commandKey: newK1CommandKey() });

  const rmWl = (cidr: string) =>
    ctx.openConfirm({
      action: `移出允许名单 · ${cidr}`,
      detail: "移除后该网段恢复同 IP 多账户检测。",
      chips: [["恢复按 IP 检测", "ready"]],
      reason: true,
      okLabel: "确认移除",
      run: async (reason) => {
        const scope = `whitelist-disable:${cidr}`;
        const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
        commandAttempt.remember(scope, commandKey);
        try {
          await runAction(() => ctx.actions.disableK1Whitelist(cidr, reason, commandKey), "已从允许名单移除");
          commandAttempt.forget(scope);
        } catch (error) {
          if (!(error instanceof K1OutcomeUncertainError)) commandAttempt.forget(scope);
          throw error;
        }
      },
    });

  if (ctx.contentError) {
    return (
      <section className="l-card" data-module-health-state="error">
        <div className="l-h">
          <span className="ttl">多账户风险数据加载失败</span>
          <span className="sub">· {errorText(ctx.contentError)} · 为避免误操作，已隐藏数据和操作按钮</span>
          <div className="r">
            <button className="l-btn" onClick={() => void ctx.reloadKRisk({ multiAccount: pageQuery }).catch(() => undefined)}>重新加载</button>
          </div>
        </div>
      </section>
    );
  }

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">多账户风险数据加载中</span><span className="sub">· 请稍候</span></div></section>;
  }

  return (
    <div>
      {focusClusterId && (
        <div className="ctint" role="status" style={{ marginBottom: 12 }}>
          从「篡改防御监控」跳转查看关联账户组 <b>{focusClusterId}</b>；
          {focusLookupState === "loading" && "正在查询全部分页中的关联账户组…"}
          {focusLookupState === "positioning" && "已找到这组账户，正在切换到对应分页…"}
          {focusLookupState === "found" && "已自动定位。"}
          {focusLookupState === "not-found" && "没找到这组账户，请返回「篡改防御监控」刷新后重试。"}
          {focusLookupState === "error" && "网络异常或关联账户数据持续变化，暂时无法定位；请稍后重试。"}
          {focusLookupState !== "found" && (
            <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={exitFocusMode}>退出定位后手动查看</button>
          )}
        </div>
      )}
      <div className="f-stats">
        <div className="f-stat"><div className="k">监控中的关联账户组</div><div className="v">{statText("activeClusters")}</div><div className="sub">涉及 {statText("flaggedAccounts")} 个账户</div></div>
        <div className="f-stat warn"><div className="k">高风险账户组</div><div className="v">{statText("highClusters")}</div><div className="sub">建议冻结的关联强度 {formatThreshold(freezeSuggestThreshold)}</div></div>
        <div className="f-stat danger"><div className="k">已冻结账户组</div><div className="v">{statText("frozenClusters")}</div><div className="sub">共 {statText("frozenAccounts")} 个账户</div></div>
        <div className="f-stat ok"><div className="k">新人礼拦截</div><div className="v">{statKnown("giftBlockedUsd") ? `$${statText("giftBlockedUsd")}` : "—"}</div><div className="sub">{statKnown("giftBlockedCnt") ? `${statText("giftBlockedCnt")} 笔重复领取被拦下` : "数据尚未接入，不能判定为 0"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">风险判断标准</span>
          <span className="sub">· 按同一 IP、设备或支付工具找出可能是同一人的账户</span>
          <div className="r"><span className="kcode electric">修改后下次检查生效</span></div>
        </div>
        <div className="l-b">
          <div className="param-list">
            {params.map((p) => (
              <div className="p" key={p.key}>
                <div className="txt"><div className="k">{riskParamName(p)}</div><div className="s">{riskParamSub(p)}</div></div>
                <span className="v" style={p.key === "linkWeight" ? { fontSize: 13 } : undefined}>{p.value}{p.unit ? ` ${p.unit}` : ""}</span>
                {canWrite && <button className="l-btn sm mc" aria-label={`调整${riskParamName(p)}`} onClick={() => adjParam(p)}>调整</button>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 收益释放参数(SPEC-7 搬回,合并底账 §二#5):与整簇冻结分开的放行细调。 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">关联账户的收益审核规则</span>
          <span className="sub">· 同组账户超过正常名额后，新增收益须审核；账户数量和冻结建议标准在上方调整</span>
          <div className="r"><span className="kcode electric">影响后续收益审核与提现</span></div>
        </div>
        <div className="l-b">
          {overview && overview.releaseParams.length > 0 ? (
            <>
              <div className="param-list" data-proof="k1-risk-release-params">
                {overview.releaseParams.map((p) => (
                  <div className="p" key={p.key}>
                    <div className="txt"><div className="k">{releaseParamName(p)}</div><div className="s">{releaseParamSub(p)}</div></div>
                    <span className="v">{releaseParamDisplay(p)}{p.unit && K1_RELEASE_PARAM_LIMITS[p.key] ? ` ${p.unit}` : ""}</span>
                    {canRelease && p.adjustable !== false && <button className="l-btn sm mc" aria-label={`调整${releaseParamName(p)}`} onClick={() => adjReleaseParam(p)}>调整</button>}
                  </div>
                ))}
              </div>
              <div className="ktint warn" style={{ marginTop: 12 }}>
                <b>处理规则</b> · 正常名额内的收益可提现；超过审核起点后，新增收益须先审核。达到建议冻结的账号数时，系统只提出建议，不会自动冻结账户。只有人工冻结账户组，或短时间内放行数量超限，收益才会转为锁定奖励。待审核收益<b>不会因等待时间到期自动放行</b>，须通过应用在线验证或人工放行。放宽规则可能增加资金支出，请写明依据。
              </div>
            </>
          ) : (
            <div className="ktint">收益审核规则暂时加载不出来，请稍后重试；现在不能调整。</div>
          )}
        </div>
      </section>

      <section className="l-card" data-proof="k1-protected-earnings">
        <div className="l-h">
          <span className="ttl">待审核或已锁定的收益</span>
          <span className="sub">· 人工放行需要相应权限、操作理由，并留下操作记录</span>
          <div className="r"><button className="l-btn" disabled={protectedEntriesLoading} onClick={() => void refreshProtectedEntries()}>刷新收益记录</button></div>
        </div>
        {protectedEntriesError ? (
          <div className="l-b"><div className="ktint bad">{protectedEntriesError} · 当前不提供人工放行入口。</div></div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 900 }}>
              <thead><tr><th>收益记录号</th><th>用户 / 关联账户组</th><th>来源</th><th>处理状态</th><th className="num">金额</th><th>生成时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {protectedEntries.map((entry) => <tr key={entry.entryNo}>
                  <td className="mono">{entry.entryNo}</td>
                  <td><div className="mono">U{entry.userId}</div><div className="tiny">{entry.clusterId}</div></td>
                  <td><div>{({ TRIAL: "试用收益", DEVICE: "设备收益", TASK: "任务奖励", COMMISSION: "团队分成", REFERRAL: "邀请奖励", WELCOME: "新人奖励" } as Record<string, string>)[entry.sourceType.toUpperCase()] ?? "来源未知"}</div><div className="tiny mono">{entry.sourceRef}</div></td>
                  <td><span className={`bdg ${entry.bucket === "bonus_locked" ? "bad" : "warn"}`}>{entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"}</span></td>
                  <td className="num mono">{entry.amount.toLocaleString("en-US")} {nexGridBrandText(entry.asset)}</td>
                  <td className="mono tiny">{entry.createdAt}</td>
                  <td style={{ textAlign: "right" }}>{canRelease && <button className="l-btn sm mc" onClick={() => releaseProtectedEntry(entry)}>人工放行</button>}</td>
                </tr>)}
                {!protectedEntriesLoading && protectedEntries.length === 0 && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: 22 }}>当前没有待审核或已锁定的收益。</td></tr>}
                {protectedEntriesLoading && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: 22 }}>正在加载收益记录…</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">可能属于同一人的账户</span>
          <span className="sub">· 可按 IP、设备或支付工具筛选；点击一行查看详情</span>
          <div className="r">
            <TabGroup<"all" | "ip" | "device" | "payment">
              className="chips"
              label="关联依据筛选"
              value={layer}
              items={["all", "ip", "device", "payment"] as const}
              onSelect={(v) => { setLayer(v); setClusterPage(1); }}
              itemClassName={(_v, selected) => `chip${selected ? " sel" : ""}`}
            >{(v) => ({ all: "全部", ip: "IP", device: "设备指纹", payment: "支付工具" })[v]}</TabGroup>
            <select className="fld" aria-label="关联账户组状态" value={clusterStatus} onChange={(event) => { setClusterStatusFilter(event.target.value as K1ClusterStatusFilter); setClusterPage(1); }} style={{ width: 120 }}>
              <option value="all">全部状态</option><option value="detected">待判定</option><option value="flagged">可疑</option><option value="frozen">已冻结</option><option value="released">已解除</option><option value="cleared">正常</option>
            </select>
            <select className="fld" aria-label="关联账户组排序" value={clusterSort} onChange={(event) => { setClusterSort(event.target.value as K1ClusterSort); setClusterPage(1); }} style={{ width: 140 }}>
              <option value="strength_desc">关联强度</option><option value="account_desc">关联账户数</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>关联依据</th><th>依据类型</th><th className="num">关联账户数</th><th>关联程度</th><th>注册时间跨度</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {clusters.map((c, index) => {
                const [stLb, stTone] = CLUSTER_ST[c.status];
                const hot = c.strength >= freezeSuggestThreshold && c.status !== "frozen" && c.status !== "cleared" && c.status !== "released";
                return (
                  <tr
                    key={c.id}
                    className={focusBlocksSelection ? "" : "click"}
                    tabIndex={focusBlocksSelection ? undefined : 0}
                    aria-label={focusBlocksSelection ? undefined : `查看关联账户组 ${c.id} 详情`}
                    onClick={() => { if (!focusBlocksSelection) setSel(index); }}
                    onKeyDown={(event) => {
                      if (!focusBlocksSelection && event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        setSel(index);
                      }
                    }}
                    style={hot ? { background: "var(--danger-soft)" } : undefined}
                  >
                    <td className="mono" style={{ color: "var(--ink)" }}>{c.key}</td>
                    <td><span className="bdg dim">{c.layerLabel}</span></td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{c.n}</td>
                    <td>
                      <span className="meter">
                        <span className="track"><i style={{ width: `${c.strength * 100}%`, background: strengthColor(c.strength, freezeSuggestThreshold) }} /></span>
                        <span className="n" style={{ color: strengthColor(c.strength, freezeSuggestThreshold) }}>{c.strength.toFixed(2)}</span>
                      </span>
                      {hot && <span className="bdg bad" style={{ marginLeft: 9, verticalAlign: "middle" }}>建议冻结</span>}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{c.span}</td>
                    <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                        {!focusBlocksSelection && c.status === "detected" && <>{canFlag && <button className="l-btn sm" onClick={() => flagCluster(c)}>标记为可疑</button>}{canClear && <button className="l-btn sm mc" onClick={() => clearCluster(c)}>判定为正常</button>}</>}
                        {!focusBlocksSelection && c.status === "flagged" && canFreeze && <button className="l-btn sm mc" onClick={() => freezeCluster(c)}>批量冻结</button>}
                        {!focusBlocksSelection && (c.status === "frozen" || c.status === "flagged") && canRelease && <button className="l-btn sm mc" onClick={() => releaseCluster(c)}>解除误判</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!clusters.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>当前条件下没有关联账户组。可调整筛选条件后重试。</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="关联账户组列表"
          page={clusterPage}
          pageSize={clusterPageSize}
          total={clusterPageData.total}
          onPageChange={setClusterPage}
          onPageSizeChange={(next) => {
            setClusterPageSize(next);
            setClusterPage(1);
          }}
          pageSizeOptions={CLUSTER_PAGE_SIZE_OPTIONS}
        />
      </section>

      {cur && (
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">关联账户组详情 · {cur.id}</span>
            <span className="sub">· 连线表示账户之间共有的设备、支付工具或 IP</span>
            <div className="r">
              {canWrite && <button className="l-btn" onClick={() => reviewNote(cur)}>人工复审备注</button>}
              {cur.status === "detected" && canFlag && <button className="l-btn" onClick={() => flagCluster(cur)}>标记为可疑</button>}
              {cur.status === "flagged" && canFreeze && <button className="l-btn mc" onClick={() => freezeCluster(cur)}>批量冻结</button>}
              {(cur.status === "frozen" || cur.status === "flagged") && canRelease && <button className="l-btn mc" onClick={() => releaseCluster(cur)}>解除误判</button>}
            </div>
          </div>
          <div className="cl-split">
            <div className="graph">
              <ClusterGraph c={cur} />
              <div className="ktint" style={{ fontSize: 12 }}><b>判读</b> · {cur.note}</div>
              {(() => {
                // 收益影响(SPEC-7 搬回):簇状态 → 收益桶结论 + 当前释放参数,展示派生不动处理流程。
                const impact = CLUSTER_EARNING_IMPACT[cur.status];
                const releaseValue = (key: string) => overview?.releaseParams.find((p) => p.key === key)?.value;
                const slots = releaseValue("freePhoneSlotsPerCluster");
                const pendingFrom = releaseValue("duplicateAccountPendingFrom");
                const freezeFrom = releaseValue("duplicateAccountFreezeFrom");
                return (
                  <div className={`ktint${impact.tone === "bad" ? " bad" : impact.tone === "warn" ? " warn" : ""}`} data-proof="k1-cluster-earning-impact" style={{ fontSize: 12, marginTop: 10 }}>
                    <b>收益影响</b> · 当前结论:<span className={`bdg ${impact.tone}`} style={{ marginLeft: 6 }}>{impact.label}</span>
                    <div style={{ marginTop: 6 }}>{impact.desc}</div>
                    <div style={{ marginTop: 6 }}>{slots && pendingFrom && freezeFrom
                      ? `当前规则：前 ${slots} 个手机号的收益可正常处理；第 ${pendingFrom} 个关联账号起须审核收益；第 ${freezeFrom} 个关联账号起建议冻结。`
                      : "收益审核规则暂时加载不出来。"}</div>
                  </div>
                );
              })()}
            </div>
            <div className="tbl-pane">
              <table className="l-tbl">
                <thead><tr><th>账户</th><th>注册时间</th><th>上级</th><th>领过新人礼</th><th className="num">累计入金</th><th>状态</th></tr></thead>
                <tbody>
                  {cur.nodes.map((n) => {
                    const restricted = isRestrictedStatus(n[5]);
                    const unknown = isUnknownStatus(n[5]);
                    const lb = accountStatusLabel(n[5]);
                    const tone = restricted ? "bad" : unknown ? "dim" : "ok";
                    return (
                      <tr key={n[0]}>
                        <td className="mono" style={{ color: "var(--ink)" }}>{n[0]}</td>
                        <td className="mono" style={{ fontSize: 11.5 }}>{n[1]}</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{n[2]}</td>
                        <td>{n[3] === "是" ? <span className="bdg warn">已领</span> : n[3] === "否" ? <span className="bdg dim">未领</span> : <span className="bdg dim">未接入</span>}</td>
                        <td className="num mono">{n[4]}</td>
                        <td><span className={`bdg ${tone}`}>{lb}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div style={{ fontSize: 13, fontWeight: 600, margin: "16px 0 8px", color: "var(--ink)" }}>新人礼重复发放检测</div>
              {cur.gifts.length ? cur.gifts.map((g) => (
                <div className="gift-row" key={g[0]}>
                  <span className="gid">{g[0]}</span>
                  <span className="gtx">{g[1]}</span>
                  <span className={`bdg ${g[2].includes("拦截") || g[2].includes("处置") ? "ok" : "warn"}`}>{g[2]}</span>
                </div>
              )) : <div className="ktint" style={{ fontSize: 12 }}>暂时无法读取这组账户的重复发放记录，不能据此认定没有重复发放。</div>}
            </div>
          </div>
        </section>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">IP 允许名单</span>
          <span className="sub">· 只是不按 IP 检测，设备和支付工具仍照常检测</span>
          <div className="r">{canWrite && <button className="l-btn" onClick={addWl}>+ 添加允许名单</button>}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 680 }}>
            <thead><tr><th>IP / 网段</th><th>备注</th><th>添加人</th><th>失效时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {whitelist.map((w) => (
                <tr key={w.cidr}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{w.cidr}</td>
                  <td style={{ fontSize: 12.5 }}>{w.note}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{w.operator}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{w.expireText}</td>
                  <td style={{ textAlign: "right" }}>{canWrite && <button className="l-btn sm" onClick={() => rmWl(w.cidr)}>移除</button>}</td>
                </tr>
              ))}
              {!whitelist.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-4)", padding: 20 }}>暂无允许名单</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="IP 允许名单"
          page={whitelistPage}
          pageSize={whitelistPageSize}
          total={whitelistPageData.total}
          onPageChange={setWhitelistPage}
          onPageSizeChange={(next) => {
            setWhitelistPageSize(next);
            setWhitelistPage(1);
          }}
          pageSizeOptions={WHITELIST_PAGE_SIZE_OPTIONS}
        />
      </section>

      {paramDraft && (() => {
        const limits = PARAM_LIMITS[paramDraft.param.key];
        const numeric = Number(paramDraft.value);
        const valueOk = Number.isFinite(numeric) && numeric >= limits.min && numeric <= limits.max
          && (!limits.integer || Number.isInteger(numeric));
        const reasonOk = paramDraft.reason.trim().length >= 8 && paramDraft.reason.trim().length <= 200;
        const update = (patch: Partial<ParamDraft>) => setParamDraft((current) => current ? { ...current, ...patch } : current);
        return (
          <Modal title={`调整风险判断标准 · ${riskParamName(paramDraft.param)}`} icon="shield" busy={draftSubmitting === "param"} onClose={() => setParamDraft(null)} footer={<>
            <button className="l-btn" disabled={draftSubmitting === "param"} onClick={() => setParamDraft(null)}>取消</button>
            <button className="l-btn mc" disabled={!valueOk || !reasonOk || draftSubmitting === "param"} onClick={() => void saveParamDraft()}>{draftSubmitting === "param" ? "保存中…" : "确认保存"}</button>
            </>}>
            <div className="field">
              <label htmlFor={`${formId}-param-value`}>新值（{limits.min}–{limits.max}）</label>
              <input id={`${formId}-param-value`} className="fld" type="number" min={limits.min} max={limits.max} step={limits.step} value={paramDraft.value} onChange={(event) => update({ value: event.target.value })} />
              {!valueOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>{limits.integer ? "必须填写范围内的整数" : "必须填写范围内的数字"}</div>}
            </div>
            <div className="field">
              <label htmlFor={`${formId}-param-reason`}>操作理由（必填 · 8-200 字）</label>
              <textarea id={`${formId}-param-reason`} rows={3} maxLength={200} value={paramDraft.reason} onChange={(event) => update({ reason: event.target.value })} />
            </div>
            <div className="ctint">{paramDraft.param.key === "maxSignupPerIp24h" ? "正式环境达到该 IP 的每日注册上限后，会拒绝新注册；不会自动冻结已有账户。" : "该参数会影响关联账户识别或冻结建议，不会自动冻结已有账户。"}</div>
          </Modal>
        );
      })()}

      {releaseDraft && (() => {
        const key = releaseDraft.param.key;
        const limits = K1_RELEASE_PARAM_LIMITS[key];
        const isMode = key === "releaseMode";
        const isBool = key === "freeSlotRequiresBinding";
        const numeric = Number(releaseDraft.value);
        const valueOk = limits
          ? Number.isInteger(numeric) && numeric >= limits.min && numeric <= limits.max
          : isMode ? (K1_RELEASE_MODE_VALUES as readonly string[]).includes(releaseDraft.value)
            : isBool ? releaseDraft.value === "true" || releaseDraft.value === "false"
              : false;
        const reasonOk = releaseDraft.reason.trim().length >= 8 && releaseDraft.reason.trim().length <= 200;
        const update = (patch: Partial<ParamDraft>) => setReleaseDraft((current) => current ? { ...current, ...patch } : current);
        return (
          <Modal title={`调整收益审核规则 · ${releaseParamName(releaseDraft.param)}`} icon="shield" busy={draftSubmitting === "release"} onClose={() => setReleaseDraft(null)} footer={<>
            <button className="l-btn" disabled={draftSubmitting === "release"} onClick={() => setReleaseDraft(null)}>取消</button>
            <button className="l-btn mc" disabled={!valueOk || !reasonOk || draftSubmitting === "release"} onClick={() => void saveReleaseDraft()}>{draftSubmitting === "release" ? "保存中…" : "确认保存"}</button>
          </>}>
            {limits ? (
              <div className="field">
                <label htmlFor={`${formId}-release-value`}>新值（{limits.min}–{limits.max}{releaseDraft.param.unit ? ` · ${releaseDraft.param.unit}` : ""}）</label>
                <input id={`${formId}-release-value`} className="fld" type="number" min={limits.min} max={limits.max} step={limits.step} value={releaseDraft.value} onChange={(event) => update({ value: event.target.value })} />
                {!valueOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>必须填写范围内的整数</div>}
              </div>
            ) : (
              // 可枚举值走下拉不手输(释放模式 / 开关);选项集合与 k-client 校验白名单同源。
              <div className="field">
                <label htmlFor={`${formId}-release-value`}>新值（从下拉选择）</label>
                <select id={`${formId}-release-value`} className="fld" value={releaseDraft.value} onChange={(event) => update({ value: event.target.value })}>
                  {(isMode ? [...K1_RELEASE_MODE_VALUES] : ["true", "false"]).map((option) => (
                    <option key={option} value={option}>{isMode ? RELEASE_MODE_LABELS[option] : RELEASE_BOOL_LABELS[option]}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="field">
              <label htmlFor={`${formId}-release-reason`}>操作理由（必填 · 8-200 字）</label>
              <textarea id={`${formId}-release-reason`} rows={3} maxLength={200} value={releaseDraft.reason} onChange={(event) => update({ reason: event.target.value })} />
            </div>
            {/* 必须先过 valueOk:输入框清空时 Number("") = 0,对「调小才是放宽」族会被误判成放宽,
                对一个根本提交不了的无效值报「放大资金流出」是谎报风险。 */}
            {valueOk && isLooseningRelease(key, releaseDraft.param.value, releaseDraft.value) && (
              // 放大资金流出方向的告知(与其它放大类动作同款口径):真正的拦截在服务端,
              // 本页没有覆盖率数据,不做客户端预检 —— 只如实告知会被核验,不假装拦得住。
              <div className="ktint warn" data-proof="k1-release-loosen-warning" style={{ marginTop: 10 }}>
                <b>这项调整可能增加可提现收益</b> · 保存前会检查兑付覆盖率，低于红线时无法保存。请在操作理由中写明依据。
              </div>
            )}
            <div className="ctint">{key === "releaseMode" && releaseDraft.param.adjustable === false
              ? "在线验证放行尚未开放，当前只能人工审核收益。"
              : "调整只影响后续收益审核和提现，历史记录不会改动；放宽规则时请写明理由。"}</div>
          </Modal>
        );
      })()}

      {whitelistDraft && (() => {
        const cidrOk = isValidCidr(whitelistDraft.cidr);
        const noteOk = whitelistDraft.note.trim().length >= 2 && whitelistDraft.note.trim().length <= 200;
        const expiryOk = futureIsoDate(whitelistDraft.expireText);
        const reasonOk = whitelistDraft.reason.trim().length >= 8 && whitelistDraft.reason.trim().length <= 200;
        const canSave = cidrOk && noteOk && expiryOk && reasonOk;
        const update = (patch: Partial<WhitelistDraft>) => setWhitelistDraft((current) => current ? { ...current, ...patch } : current);
        return (
          <Modal title="添加 IP 允许名单" icon="shield" busy={draftSubmitting === "whitelist"} onClose={() => setWhitelistDraft(null)} footer={<>
            <button className="l-btn" disabled={draftSubmitting === "whitelist"} onClick={() => setWhitelistDraft(null)}>取消</button>
            <button className="l-btn mc" disabled={!canSave || draftSubmitting === "whitelist"} onClick={() => void saveWhitelistDraft()}>{draftSubmitting === "whitelist" ? "提交中…" : "确认加入"}</button>
          </>}>
            <div className="ctint" style={{ marginBottom: 12 }}>只是不再按 IP 检测；设备和支付工具仍照常检测，已冻结的账户不会自动解冻。</div>
            <div className="field"><label htmlFor={`${formId}-cidr`}>IP / CIDR 网段</label><input id={`${formId}-cidr`} className="fld" value={whitelistDraft.cidr} onChange={(event) => update({ cidr: event.target.value })} placeholder="198.51.100.0/24" />{whitelistDraft.cidr && !cidrOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>请输入合法 IPv4 CIDR（每段不使用前导零）</div>}</div>
            <div className="field"><label htmlFor={`${formId}-whitelist-note`}>备注</label><input id={`${formId}-whitelist-note`} className="fld" maxLength={200} value={whitelistDraft.note} onChange={(event) => update({ note: event.target.value })} placeholder="例如：已核验的办公出口网段" /></div>
            <div className="field"><label htmlFor={`${formId}-whitelist-expiry`}>失效日期</label><input id={`${formId}-whitelist-expiry`} className="fld" type="date" value={whitelistDraft.expireText} onChange={(event) => update({ expireText: event.target.value })} />{whitelistDraft.expireText && !expiryOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>失效日期必须晚于今天</div>}</div>
            <div className="field"><label htmlFor={`${formId}-whitelist-reason`}>操作理由（必填 · 8-200 字）</label><textarea id={`${formId}-whitelist-reason`} rows={3} maxLength={200} value={whitelistDraft.reason} onChange={(event) => update({ reason: event.target.value })} /></div>
          </Modal>
        );
      })()}

      {weightDraft && (() => {
        const device = numberValue(weightDraft.device);
        const payment = numberValue(weightDraft.payment);
        const ip = numberValue(weightDraft.ip);
        const weights = [device, payment, ip];
        const validNumbers = weights.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
        const total = weights.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
        const totalOk = Math.abs(total - 1) <= 0.001;
        const reasonLength = weightDraft.reason.trim().length;
        const reasonOk = reasonLength >= 8 && reasonLength <= 200;
        const canSave = validNumbers && totalOk && reasonOk;
        const updateDraft = (patch: Partial<WeightDraft>) => setWeightDraft((current) => current ? { ...current, ...patch } : current);
        return (
          <Modal
            title={`调整关联权重 · ${riskParamName(weightDraft.param)}`}
            icon="shield"
            busy={draftSubmitting === "weight"}
            onClose={() => setWeightDraft(null)}
            footer={
              <>
                <button className="l-btn" disabled={draftSubmitting === "weight"} onClick={() => setWeightDraft(null)}>取消</button>
                <button className="l-btn mc" disabled={!canSave || draftSubmitting === "weight"} onClick={() => void saveWeightDraft()}>{draftSubmitting === "weight" ? "保存中…" : "确认保存"}</button>
              </>
            }
          >
            <div className="ctint" style={{ marginBottom: 12 }}>
              关联强度 = 设备指纹命中 × 设备权重 + 支付工具命中 × 支付权重 + IP 命中 × IP 权重。每项单独填写，三项加起来要等于 1.00。
            </div>
            <div className="grid g-3" style={{ gap: 10 }}>
              {[
                ["device", "设备指纹权重", "设备指纹 / 浏览器指纹 / 应用实例"] as const,
                ["payment", "支付工具权重", "银行卡 / 钱包 / 收款工具"] as const,
                ["ip", "IP 权重", "同出口 IP / 网段"] as const,
              ].map(([key, label, help]) => (
                <div className="field" key={key} style={{ marginBottom: 0 }}>
                  <label htmlFor={`${formId}-weight-${key}`}>{label}</label>
                  <input
                    id={`${formId}-weight-${key}`}
                    className="fld"
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={weightDraft[key]}
                    onChange={(e) => updateDraft({ [key]: e.target.value } as Partial<WeightDraft>)}
                    placeholder="0.00 - 1.00"
                  />
                  <div className="tiny" style={{ marginTop: 6, color: "var(--ink-3)" }}>{help}</div>
                </div>
              ))}
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor={`${formId}-weight-reason`}>操作理由（必填 · 8-200 字）</label>
              <textarea
                id={`${formId}-weight-reason`}
                rows={3}
                maxLength={200}
                value={weightDraft.reason}
                onChange={(e) => updateDraft({ reason: e.target.value })}
                placeholder="例如：误判多来自同一网络，降低 IP 权重、提高设备指纹权重"
              />
            </div>
            <div className={`ctint${validNumbers && totalOk ? "" : " danger"}`} style={{ marginTop: 10 }}>
              当前合计 <span className="mono">{total.toFixed(2)}</span>
              {!validNumbers ? " · 每项必须在 0 到 1 之间" : !totalOk ? " · 三项合计必须等于 1.00" : ` · 保存值 ${linkWeightValue(weightDraft)}`}
              {!reasonOk && <span>{reasonLength < 8 ? ` · 理由还需 ${8 - reasonLength} 字` : " · 理由不能超过 200 字"}</span>}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
