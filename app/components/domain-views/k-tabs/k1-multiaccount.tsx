"use client";

import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Coins, Gift, ListChecks, Network, RefreshCw, ShieldAlert, Snowflake, Users } from "lucide-react";
import {
  BlockState, Button, Cell, ChartLegend, Decision, DiffList, Explain, Fact, Facts, Field, Figure, FilterBar, FilterField, Fold, InlineMeter, Input, JudgmentPoints, KeyValues,
  Modal, MoreMenu, Notice, PageHeader, PageTabs, Pager, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, TableMessage, Td, Textarea, Th, Tr, type JudgmentRow,
} from "@/app/components/rd";
import { fetchK1MultiAccountOverview, K1OutcomeUncertainError, K1_RELEASE_MODE_VALUES, K1_RELEASE_PARAM_LIMITS, newK1CommandKey } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessZone } from "@/lib/admin/business-time";
import { A2OutcomeUncertainError } from "@/lib/admin/a2-client";
import type { AdminPage, ClusterStatus, K1Cluster, K1ClusterLayer, K1ClusterSort, K1ClusterStatusFilter, K1ProtectedEntry, K1WhitelistRow, KRiskParam } from "@/lib/admin/k-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createPendingMutationStore, createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
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
const APPROVAL_EFFECT = <StatusTag tone="progress" filled>批准后生效</StatusTag>;
const IMMEDIATE_EFFECT = <StatusTag tone="progress" filled>立即生效</StatusTag>;
const RISK_REASON_PLACEHOLDER = "写清场景和依据，例如：合租办公网络、已知合作账户、客服举报线索";
const CLUSTER_PAGE_SIZE_OPTIONS = [5, 10, 20];
const WHITELIST_PAGE_SIZE_OPTIONS = [5, 10, 20];
const MAX_FOCUS_RELOCATIONS = 3;
const PROTECTED_ENTRY_LIMIT = 200;
const K1_TABS = ["accounts", "earnings", "rules"] as const;
type K1Tab = (typeof K1_TABS)[number];
const pick = <T extends string>(value: string | null | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;
const positiveInt = (value: string | null | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};
const pageSizeOf = (value: string | null | undefined, sizes: readonly number[]) => {
  const parsed = Number(value);
  return sizes.includes(parsed) ? parsed : 5;
};
const EMPTY_CLUSTER_PAGE: AdminPage<K1Cluster> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
const EMPTY_WHITELIST_PAGE: AdminPage<K1WhitelistRow> = { total: 0, pageNum: 1, pageSize: 5, records: [] };
// ctx.contentError 时两个读总览的页签只显示重试，不留旧数据和操作按钮；收益审核另有接口，列表还在，人工放行禁用。
type WeightDraft = { param: KRiskParam; device: string; payment: string; ip: string; reason: string; commandKey: string };
type ParamDraft = { param: KRiskParam; value: string; reason: string; commandKey: string };
type WhitelistDraft = { cidr: string; note: string; expireText: string; reason: string; commandKey: string };
const PARAM_LIMITS: Record<string, { min: number; max: number; step: number; integer: boolean }> = {
  maxSignupPerIp24h: { min: 1, max: 10, step: 1, integer: true },
  maxAccountsPerDevice: { min: 1, max: 5, step: 1, integer: true },
  maxAccountsPerPaymentInstrument: { min: 1, max: 5, step: 1, integer: true },
  clusterFreezeSuggestThreshold: { min: 0, max: 1, step: 0.05, integer: false },
};

const CLUSTER_ST: Record<ClusterStatus, [string, "warn" | "danger" | "done" | "ok", string]> = {
  detected: ["待判定", "warn", "系统发现的账户组，还没人判定。新增收益先锁定。下一步：标记为可疑，或判定为正常。"],
  flagged: ["可疑", "warn", "已标记可疑，账户没有冻结。新增收益先锁定。下一步：批量冻结，或解除误判。"],
  frozen: ["已冻结", "danger", "这组账户已冻结。新增收益先锁定。核实是误判后解除误判。"],
  released: ["已解除", "done", "已判定是误判。新增收益仍按同组账号数决定要不要审核。"],
  cleared: ["正常", "ok", "已判定为正常，退出风险监控。新增收益仍按同组账号数决定要不要审核。"],
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

function formatThreshold(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "未配置";
}

function strengthTone(v: number, threshold: number) {
  if (!Number.isFinite(threshold)) return "neutral" as const;
  return v >= threshold
    ? "danger" as const
    : v >= threshold * 0.8 ? "warn" as const : "ok" as const;
}

const giftHandled = (result: string) => result.includes("拦截") || result.includes("处置");

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
  const edgeColor = (layer: string) => layer === "device" ? "var(--rd-chart-3)" : layer === "payment" ? "var(--rd-chart-2)" : "var(--rd-chart-other)";
  // 三态与账户明细同源:空状态走已结束的灰,绝不能落进「正常」绿。
  const nodeColor = (status: string) => isRestrictedStatus(status) ? "var(--rd-danger)" : isUnknownStatus(status) ? "var(--rd-done)" : "var(--rd-ok)";
  const k = Math.min(c.nodes.length, 8);
  const over = Math.max(c.n - k, 0);
  const total = Math.max(k + (over > 0 ? 1 : 0), 1);
  const positions = new Map(c.nodes.slice(0, k).map((node, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
    return [node[0], { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), angle }] as const;
  }));
  return (
    <Figure width={320} graphic={
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`关联账户组 ${c.id} 关系图`}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--rd-line-strong)" strokeDasharray="3 6" />
        {c.edges.map((edge, index) => {
          const from = positions.get(edge[0]);
          const to = positions.get(edge[1]);
          if (!from || !to) return null;
          return <line key={`${gid}-edge-${index}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={edgeColor(edge[2])} strokeWidth={1.2 + edge[3] * 3} opacity={0.8} />;
        })}
        {Array.from({ length: total }, (_, i) => {
          const a = -Math.PI / 2 + (i * 2 * Math.PI) / total;
          const ux = Math.cos(a), uy = Math.sin(a);
          const x = cx + R * ux, y = cy + R * uy;
          const isOver = i >= k;
          if (isOver) {
            return (
              <g key={`${gid}-o`}>
                <circle cx={x} cy={y} r={13} fill="var(--rd-panel-inner)" stroke="var(--rd-line-strong)" strokeWidth={1.3} strokeDasharray="3 3" />
                <text x={x} y={y + 4} fontSize={11} fontWeight={600} fill="var(--rd-text-3)" textAnchor="middle">{`+${over}`}</text>
                <text x={x} y={uy >= 0 ? y + 30 : y - 22} fontSize={11} fill="var(--rd-text-3)" textAnchor="middle">未列出</text>
              </g>
            );
          }
          const nd = c.nodes[i];
          const col = nodeColor(nd?.[5] ?? "UNKNOWN");
          return (
            <g key={`${gid}-${nd?.[0] ?? i}`}>
              <circle cx={x} cy={y} r={13} fill="var(--rd-panel-inner)" stroke={col} strokeWidth={1.6} />
              <circle cx={x} cy={y} r={3} fill={col} />
              {nd?.[3] === "是" && <circle cx={x + 10} cy={y - 10} r={3.6} fill="var(--rd-warn)" stroke="var(--rd-panel)" strokeWidth={1.5} />}
              <text x={x} y={uy >= 0 ? y + 31 : y - 23} fontSize={11} fill="var(--rd-text-2)" textAnchor="middle">{(nd?.[0] ?? "").slice(4)}</text>
            </g>
          );
        })}
        {!c.edges.length && <text x={cx} y={cy + 4} fontSize={11} fill="var(--rd-text-3)" textAnchor="middle">暂无可展示关联边</text>}
      </svg>
    }>
      <div className="rd-stack">
        <ChartLegend items={[
          { key: "device", label: "共享设备", slot: 3 },
          { key: "payment", label: "共享支付方式", slot: 2 },
          { key: "ip", label: "同 IP 或网段", slot: "other" },
          { key: "weight", label: "线越粗、关联越强" },
        ]} />
        <ChartLegend items={[
          { key: "ok", label: "账户正常", tone: "ok" },
          { key: "bad", label: "已冻结 / 封禁 / 受限", tone: "danger" },
          { key: "unknown", label: "状态未知", tone: "done" },
          { key: "gift", label: "领过新人礼", tone: "warn" },
          { key: "over", label: "+N 本图未画出的账户" },
        ]} />
      </div>
    </Figure>
  );
}

/** 配置项一行：名称、一句说明、当前值、调整。两组规则共用（PG-46）。 */
function ParamTable({ label, rows }: { label: string; rows: readonly { key: string; name: string; sub: string; value: string; action?: ReactNode }[] }) {
  const editable = rows.some((row) => row.action);
  return (
    <Table label={label}>
      <thead><tr><Th>参数</Th><Th align="right">当前值</Th>{editable && <Th align="right">操作</Th>}</tr></thead>
      <tbody>
        {rows.map((row) => (
          <Tr key={row.key}>
            <Td><Cell full main={row.name} sub={row.sub} /></Td>
            <Td align="right"><Cell num main={row.value} /></Td>
            {editable && <Td align="right">{row.action}</Td>}
          </Tr>
        ))}
      </tbody>
    </Table>
  );
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
  const reach = useReach();
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const hasAuthority = (authority: string) => authorities.includes(authority);
  const canWrite = hasAuthority("risk_k1_write");
  const canFlag = hasAuthority("risk_k1_cluster_flag");
  const canFreeze = hasAuthority("risk_k1_cluster_freeze");
  const canRelease = hasAuthority("risk_k1_cluster_release");
  const canClear = hasAuthority("risk_k1_cluster_cleared");
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusClusterId = (searchParams?.get("focusClusterId") ?? "").trim();
  const [tab, setTab] = useState<K1Tab>(() => focusClusterId ? "accounts" : pick(searchParams?.get("tab"), K1_TABS, "accounts"));
  const [layer, setLayer] = useState<K1ClusterLayer>(() => pick(searchParams?.get("clusterLayer"), ["all", "ip", "device", "payment"], "all"));
  const [clusterStatus, setClusterStatusFilter] = useState<K1ClusterStatusFilter>(() => pick(searchParams?.get("clusterStatus"), ["all", "detected", "flagged", "frozen", "released", "cleared"], "all"));
  const [clusterSort, setClusterSort] = useState<K1ClusterSort>(() => pick(searchParams?.get("clusterSort"), ["strength_desc", "account_desc"], "strength_desc"));
  const [clusterPage, setClusterPage] = useState(() => positiveInt(searchParams?.get("page"), 1));
  const [clusterPageSize, setClusterPageSize] = useState(() => pageSizeOf(searchParams?.get("pageSize"), CLUSTER_PAGE_SIZE_OPTIONS));
  const [whitelistPage, setWhitelistPage] = useState(() => positiveInt(searchParams?.get("whitelistPageNum"), 1));
  const [whitelistPageSize, setWhitelistPageSize] = useState(() => pageSizeOf(searchParams?.get("whitelistPageSize"), WHITELIST_PAGE_SIZE_OPTIONS));
  const [selId, setSelId] = useState<string | null>(null);
  const [readAt, setReadAt] = useState("");
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
  const cur = focusBlocksSelection ? undefined : clusters.find((cluster) => cluster.id === selId) ?? clusters[0];
  const isHot = (c: K1Cluster) => c.strength >= freezeSuggestThreshold && c.status !== "frozen" && c.status !== "cleared" && c.status !== "released";

  const exitFocusMode = () => {
    focusPageLoad.current = false;
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.delete("focusClusterId");
    next.delete("source");
    setFocusLookupState("idle");
    setSelId(null);
    router.replace(next.size ? `?${next.toString()}` : "?");
  };

  useEffect(() => {
    if (focusPageLoad.current) return;
    void ctx.reloadKRisk({ multiAccount: pageQuery }).catch(() => undefined);
  }, [ctx.reloadKRisk, pageQuery]);

  useEffect(() => {
    setSelId(null);
  }, [clusterPage, clusterPageSize, layer, clusterStatus, clusterSort]);

  // 页签、筛选、分页写进网址，刷新和复制链接都回到这里（ST-23）；来访参数不动。
  useEffect(() => {
    const url = new URL(window.location.href);
    const write = (name: string, value: string | number, fallback: string | number) => {
      if (value === fallback) url.searchParams.delete(name);
      else url.searchParams.set(name, String(value));
    };
    write("tab", tab, "accounts");
    write("clusterLayer", layer, "all");
    write("clusterStatus", clusterStatus, "all");
    write("clusterSort", clusterSort, "strength_desc");
    write("page", clusterPage, 1);
    write("pageSize", clusterPageSize, 5);
    write("whitelistPageNum", whitelistPage, 1);
    write("whitelistPageSize", whitelistPageSize, 5);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [tab, layer, clusterStatus, clusterSort, clusterPage, clusterPageSize, whitelistPage, whitelistPageSize]);

  useEffect(() => {
    if (overview) setReadAt(new Date().toLocaleTimeString("zh-CN", { timeZone: businessZone().zoneId, hour: "2-digit", minute: "2-digit", hour12: false }));
  }, [overview]);

  useEffect(() => {
    if (!focusClusterId) {
      setFocusLookupState("idle");
      return;
    }
    let active = true;
    focusPageLoad.current = true;
    setFocusLookupState("loading");
    setTab("accounts");
    setLayer("all");
    setClusterStatusFilter("all");
    setSelId(null);
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
          setSelId(focusClusterId);
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

  const clusterFacts = (c: K1Cluster, scope?: ReactNode) => (
    <Facts>
      <Fact k="账户组">{c.id}</Fact>
      <Fact k="关联依据">{c.layerLabel} · {c.key}</Fact>
      <Fact k="关联程度">{c.strength.toFixed(2)}</Fact>
      <Fact k="当前状态">{CLUSTER_ST[c.status][0]}</Fact>
      <Fact k="涉及账户">{scope ?? `${c.n} 个`}</Fact>
    </Facts>
  );

  const flagCluster = (c: K1Cluster) =>
    ctx.openActionConfirm({
      action: `标记可疑账户组 · ${c.id}`,
      detail: "只标记为可疑，不冻结资产。风险评分和风险提醒会同步更新，并保留操作记录。",
      statedBrief: { impact: "批准后这组变成可疑，不动资产；风险评分和风险提醒同步更新。", check: "确认对象、证据和结论，理由写清依据或工单号。" },
      effect: APPROVAL_EFFECT,
      confirmLabel: "提交审批",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: clusterFacts(c),
      reasonMax: 200,
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
      statedBrief: { impact: `批准后冻结这组的全部 ${c.n} 个账户，不只是当前这一个。`, check: "核对账户清单和证据，理由写清依据或工单号。" },
      effect: APPROVAL_EFFECT,
      confirmLabel: "提交审批",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: clusterFacts(c, `全部 ${c.n} 个：${c.nodes.slice(0, 8).map((node) => node[0]).join("、")}${c.n > 8 ? " 等" : ""}`),
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
      statedBrief: { impact: "批准后这组不再按风险组锁定新增收益，改按同组账号数处理，可提现的钱可能变多。", check: "核对账户、证据和触发的风险规则。提交时会先检查兑付覆盖率。" },
      coverageLead: "这项操作可能让平台多付钱",
      effect: APPROVAL_EFFECT,
      confirmLabel: "提交审批",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: clusterFacts(c),
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
      statedBrief: { impact: "批准后这组退出风险监控，新增收益改按同组账号数处理，可提现的钱可能变多。", check: "核对账户和证据。提交时会先检查兑付覆盖率。" },
      coverageLead: "这项操作可能让平台多付钱",
      effect: APPROVAL_EFFECT,
      confirmLabel: "提交审批",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: clusterFacts(c),
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
    ctx.openActionConfirm({
      action: `人工复审备注 · ${c.id}`,
      detail: "记录复审备注并保持当前状态不变。",
      statedBrief: { impact: "只写备注，不改状态，记入操作记录。", check: "确认对象、证据和结论，理由写清依据或工单号。" },
      effect: IMMEDIATE_EFFECT,
      confirmLabel: "保存备注",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: clusterFacts(c),
      reasonMax: 200,
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
      detail: `这笔收益现在是「${entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"}」，放行后用户可以提现。`,
      amplifies: true,
      statedBrief: { impact: "这笔收益立即转为可提现，占用平台储备，记入操作记录。", check: "核对用户、金额和所属账户组。提交时会先检查兑付覆盖率。" },
      coverageLead: "这笔收益放行后可以提现",
      effect: IMMEDIATE_EFFECT,
      confirmLabel: "确认放行",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: <Facts>
        <Fact k="收益记录">{entry.entryNo}</Fact>
        <Fact k="用户">U{entry.userId}</Fact>
        <Fact k="账户组">{entry.clusterId}</Fact>
        <Fact k="金额">{entry.amount.toLocaleString("en-US")} {nexGridBrandText(entry.asset)}</Fact>
      </Facts>,
      reasonMin: 8,
      reasonMax: 200,
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
    ctx.openActionConfirm({
      action: `移出允许名单 · ${cidr}`,
      detail: "移除后该网段恢复同 IP 多账户检测。",
      statedBrief: { impact: "这个网段恢复按 IP 检测，已有账户不会自动冻结。", check: "确认网段和授权来源，理由写清工单号和处理依据。" },
      effect: IMMEDIATE_EFFECT,
      confirmLabel: "确认移除",
      reasonPlaceholder: "写清调整原因和依据",
      reasonMax: 200,
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

  const overviewFailed = Boolean(ctx.contentError);
  const overviewReady = !overviewFailed && overview ? overview : null;
  const pendingEntries = protectedEntries.filter((entry) => entry.bucket === "pending_review");
  const lockedEntries = protectedEntries.length - pendingEntries.length;
  const anyWrite = canWrite || canFlag || canFreeze || canRelease || canClear;
  const filtered = layer !== "all" || clusterStatus !== "all" || clusterSort !== "strength_desc";
  const clearFilters = () => {
    setLayer("all");
    setClusterStatusFilter("all");
    setClusterSort("strength_desc");
    setClusterPage(1);
  };
  const reloadOverview = () => void ctx.reloadKRisk({ multiAccount: pageQuery }).catch(() => undefined);

  /** 一组现在能做的处置，行内和选中区共用。止损的在前，放宽的在后。 */
  const clusterActions = (c: K1Cluster) => {
    const actions: { key: string; label: string; loosen: boolean; run: () => void }[] = [];
    if (focusBlocksSelection) return actions;
    if (c.status === "detected" && canFlag) actions.push({ key: "flag", label: "标记为可疑", loosen: false, run: () => flagCluster(c) });
    if (c.status === "flagged" && canFreeze) actions.push({ key: "freeze", label: "批量冻结", loosen: false, run: () => freezeCluster(c) });
    if (c.status === "detected" && canClear) actions.push({ key: "clear", label: "判定为正常", loosen: true, run: () => clearCluster(c) });
    if ((c.status === "frozen" || c.status === "flagged") && canRelease) actions.push({ key: "release", label: "解除误判", loosen: true, run: () => releaseCluster(c) });
    return actions;
  };

  const userRef = (code: string) => {
    const href = `/users/search/${encodeURIComponent(code)}`;
    return reach(href, "user_c1_read")
      ? <Link className="rd-link" href={`${href}?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}>{code}</Link>
      : code;
  };

  const overviewState = (
    overviewFailed
      ? <BlockState state="error" title="多账户风险数据加载失败" detail={`${errorText(ctx.contentError)} · 为避免误操作，已隐藏数据和操作按钮`} onRetry={reloadOverview} retrying={ctx.contentLoading} retryLabel="重新加载" />
      : <BlockState state="loading" title="多账户风险数据加载中" detail="请稍候" />
  );

  const selectedPanel = (c: K1Cluster) => {
    const [statusLabel, statusTone, statusExplain] = CLUSTER_ST[c.status];
    const hot = isHot(c);
    // 按结算顺序展示新增收益分流，解除误判或判定正常后仍须判断人数。
    const releaseValue = (key: string) => overview?.releaseParams.find((p) => p.key === key)?.value;
    const slots = releaseValue("freePhoneSlotsPerCluster");
    const pendingFrom = releaseValue("duplicateAccountPendingFrom");
    const freezeFrom = releaseValue("duplicateAccountFreezeFrom");
    let impact: { label: string; tone: "danger" | "warn" | "ok" | "neutral"; desc: string } = { label: "尚未确认", tone: "neutral", desc: "收益审核规则暂时加载不出来，新增收益的处理方式尚未确认。" };
    if (["detected", "flagged", "frozen"].includes(c.status)) {
      impact = { label: "锁定奖励", tone: "danger", desc: "账户组处于待判定、可疑或已冻结，新增收益直接记为锁定奖励；收益锁定与账户冻结是两种处理。" };
    } else if (pendingFrom && freezeFrom) {
      impact = c.n >= Number(freezeFrom)
        ? { label: "锁定奖励", tone: "danger", desc: `同组 ${c.n} 个账号已达到收益锁定起点 ${freezeFrom}，新增收益直接记为锁定奖励。` }
        : c.n >= Number(pendingFrom)
          ? { label: "须审核收益", tone: "warn", desc: `同组 ${c.n} 个账号已达到收益审核起点 ${pendingFrom}，新增收益须先人工审核。` }
          : { label: "可提现收益", tone: "ok", desc: "同组账号数未达到收益审核起点，新增收益记为可提现收益。" };
    }
    const ruleText = slots && pendingFrom && freezeFrom
      ? `当前规则：正常手机号名额为 ${slots} 个。账户组待判定、可疑、已冻结，或同组账号数达到 ${freezeFrom} 时，新增收益锁定；其余情况下，账号数达到 ${pendingFrom} 时须审核，未达到时可提现。`
      : "收益审核规则暂时加载不出来。";
    const restricted = c.nodes.filter((n) => isRestrictedStatus(n[5])).length;
    const unknown = c.nodes.filter((n) => isUnknownStatus(n[5])).length;
    const shown = Math.min(c.nodes.length, 8);
    const hidden = Math.max(c.n - shown, 0);
    const openGifts = c.gifts.filter((g) => !giftHandled(g[2])).length;
    const actions = clusterActions(c);
    const primary = actions.find((action) => !action.loosen);
    const loosen = actions.find((action) => action.loosen);
    const rows: JudgmentRow[] = [
      {
        label: "关联程度",
        value: c.strength.toFixed(2),
        state: strengthTone(c.strength, freezeSuggestThreshold),
        reason: hot
          ? `达到建议冻结线 ${formatThreshold(freezeSuggestThreshold)}。这只是建议，不会自动冻结。`
          : `建议冻结线 ${formatThreshold(freezeSuggestThreshold)}`,
      },
      { label: "判读", value: c.note || "—" },
      {
        label: <Explain label="收益影响的规则" content={ruleText}>收益影响</Explain>,
        value: <span data-proof="k1-cluster-earning-impact">{impact.label}</span>,
        state: impact.tone,
        reason: impact.desc,
      },
    ];
    if (c.reviewNote) rows.push({ label: "复审备注", value: c.reviewNote });
    return (
      <Panel title={`账户组 ${c.id}`} sub={`${c.layerLabel} · ${c.n} 个账户`} icon={Users} tone="role-3" actions={<StatusTag tone={statusTone} explain={statusExplain}>{statusLabel}</StatusTag>}>
        <div className="rd-stack">
          <JudgmentPoints rows={rows} />
          {(actions.length > 0 || canWrite) && (
            <Decision
              note={actions.length > 0 ? "处置都要提交审批，批准后才生效。" : undefined}
              danger={loosen && <Button variant="danger-outline" onClick={loosen.run}>{loosen.label}</Button>}
              others={canWrite && <Button onClick={() => reviewNote(c)}>人工复审备注</Button>}
              primary={primary && <Button variant="primary" onClick={primary.run}>{primary.label}</Button>}
            />
          )}
          <div>
            <Fold inset icon={Network} tone="risk" title="关系图" summary={c.edges.length ? `${shown} 个账户，${c.edges.length} 条关联${hidden ? `，${hidden} 个未画出` : ""}` : "暂无可展示关联边"}>
              <ClusterGraph c={c} />
            </Fold>
            <Fold inset icon={Users} tone="users" title="账户明细"
              alert={unknown > 0}
              summary={`${c.nodes.length} 个账户${restricted ? `，${restricted} 个已受限` : ""}${unknown ? `，${unknown} 个状态未知` : ""}`}>
              <Table label={`关联账户组 ${c.id} 的账户`}>
                <thead><tr><Th>账户 · 注册时间</Th><Th>邀请人 · 新人礼</Th><Th align="right">累计入金 · 状态</Th></tr></thead>
                <tbody>
                  {c.nodes.map((n) => (
                    <Tr key={n[0]}>
                      <Td><Cell mono main={userRef(n[0])} sub={n[1].replace("T", " ")} /></Td>
                      <Td><Cell main={n[2]} sub={n[3] === "是" ? "已领" : n[3] === "否" ? "未领" : "未接入"} /></Td>
                      <Td align="right"><Cell num main={n[4]} sub={<StatusTag tone={isRestrictedStatus(n[5]) ? "danger" : isUnknownStatus(n[5]) ? "done" : "ok"}>{accountStatusLabel(n[5])}</StatusTag>} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Fold>
            <Fold inset icon={Gift} tone="risk" title="新人礼重复发放检测"
              alert={!c.gifts.length || openGifts > 0}
              summary={c.gifts.length ? `${c.gifts.length} 条${openGifts ? `，${openGifts} 条要处理` : "，都已拦截或处置"}` : "读不到记录"}>
              {c.gifts.length
                ? <KeyValues rows={c.gifts.map((g) => ({ key: g[0], label: g[1], sub: g[0], value: <StatusTag tone={giftHandled(g[2]) ? "ok" : "warn"}>{g[2]}</StatusTag> }))} />
                : <p className="rd-note">暂时无法读取这组账户的重复发放记录，不能据此认定没有重复发放。</p>}
            </Fold>
          </div>
        </div>
      </Panel>
    );
  };

  const paramAction = (name: string, onClick: () => void) => <Button size="sm" aria-label={`调整${name}`} onClick={onClick}>调整</Button>;

  return (
    <>
      <PageHeader pageId="K1" title="多账户风险排查" summary="找出可能是同一人的账户，判断后处置。"
        meta={<span className="rd-toolbar">
          <span>{readAt ? `${readAt} 读取（${businessZone().label}），` : ""}不自动刷新</span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={ctx.contentLoading || protectedEntriesLoading} onClick={() => { reloadOverview(); void refreshProtectedEntries(); }}>刷新</Button>
        </span>}
        readOnly={anyWrite ? undefined : "你只能查看；处置和调整需要风控权限"} />

      {focusClusterId && (
        <Notice tone={focusLookupState === "not-found" || focusLookupState === "error" ? "warn" : focusLookupState === "found" ? "ok" : "progress"}
          action={focusLookupState !== "found" ? <Button size="sm" onClick={exitFocusMode}>退出定位后手动查看</Button> : undefined}>
          从「篡改防御监控」跳转查看关联账户组 <b>{focusClusterId}</b>；
          {focusLookupState === "loading" && "正在查询全部分页中的关联账户组…"}
          {focusLookupState === "positioning" && "已找到这组账户，正在切换到对应分页…"}
          {focusLookupState === "found" && "已自动定位。"}
          {focusLookupState === "not-found" && "没找到这组账户，请返回「篡改防御监控」刷新后重试。"}
          {focusLookupState === "error" && "网络异常或关联账户数据持续变化，暂时无法定位；请稍后重试。"}
        </Notice>
      )}

      {tab !== "earnings" && pendingEntries.length > 0 && (
        <Notice tone="warn" title={`${pendingEntries.length} 笔收益等人工审核`} action={<Button size="sm" onClick={() => setTab("earnings")}>{canRelease ? "去处理" : "去查看"}</Button>}>
          这些收益审核通过才能提现，不会到期自动放行。
        </Notice>
      )}

      <PageTabs label="多账户风险排查内容" value={tab} onChange={setTab} items={[
        { value: "accounts", label: "账户组排查" },
        { value: "earnings", label: "收益审核", count: pendingEntries.length || undefined },
        { value: "rules", label: "规则与名单" },
      ]} />

      {tab === "accounts" && (overviewReady ? (
        <>
          <StatBand label="关联账户组概况">
            <Stat lead tone="role-3" icon={Users} label="监控中的关联账户组" value={statText("activeClusters")} unit="组" sub={`涉及 ${statText("flaggedAccounts")} 个账户`}
              explain="全部账户组里，还没判定为正常、也没解除的组。不随下面的筛选变。" />
            <Stat icon={ShieldAlert} iconTone={Number(stats.highClusters) > 0 ? "warn" : "role-other"} label="高风险账户组" value={statText("highClusters")} unit="组" sub={`建议冻结的关联强度 ${formatThreshold(freezeSuggestThreshold)}`}
              explain="待判定或可疑、关联程度达到建议冻结线的组。这只是建议，不会自动冻结。" />
            <Stat tone="role-2" icon={Snowflake} label="已冻结账户组" value={statText("frozenClusters")} unit="组" sub={`共 ${statText("frozenAccounts")} 个账户`} />
            <Stat tone="role-1" icon={Gift} label="新人礼拦截" value={statKnown("giftBlockedUsd") ? `$${statText("giftBlockedUsd")}` : "—"} sub={statKnown("giftBlockedCnt") ? `${statText("giftBlockedCnt")} 笔重复领取被拦下` : "数据尚未接入，不能判定为 0"} />
          </StatBand>

          <FilterBar
            scope={<Segments label="关联依据筛选" value={layer} onChange={(value) => { setLayer(value); setClusterPage(1); }} items={[
              { value: "all", label: "全部" }, { value: "ip", label: "IP" }, { value: "device", label: "设备指纹" }, { value: "payment", label: "支付工具" },
            ]} />}
            onClear={clearFilters} canClear={filtered}
            sort={<FilterField><Select aria-label="关联账户组排序" value={clusterSort} onChange={(value) => { setClusterSort(value as K1ClusterSort); setClusterPage(1); }} options={[
              { value: "strength_desc", label: "关联强度" }, { value: "account_desc", label: "关联账户数" },
            ]} /></FilterField>}>
            <FilterField><Select aria-label="关联账户组状态" value={clusterStatus} onChange={(value) => { setClusterStatusFilter(value as K1ClusterStatusFilter); setClusterPage(1); }} options={[
              { value: "all", label: "全部状态" }, { value: "detected", label: "待判定" }, { value: "flagged", label: "可疑" }, { value: "frozen", label: "已冻结" }, { value: "released", label: "已解除" }, { value: "cleared", label: "正常" },
            ]} /></FilterField>
          </FilterBar>

          <div className={clusters.length ? "rd-split" : undefined}>
            <Panel title="可能属于同一人的账户" sub="点一行看证据和处置" icon={Network} tone="role-3" flush>
              <Table label="关联账户组列表">
                <thead>
                  <tr>
                    <Th>关联依据 · 注册时间跨度</Th>
                    <Th align="right" icon={Users} tone="users">账户数</Th>
                    <Th icon={ShieldAlert} tone="risk">关联程度</Th>
                    <Th>状态</Th>
                    <Th align="right">操作</Th>
                  </tr>
                </thead>
                <tbody>
                  {clusters.map((c) => {
                    const [statusLabel, statusTone, statusExplain] = CLUSTER_ST[c.status];
                    const [first, ...rest] = clusterActions(c);
                    return (
                      <Tr key={c.id} selected={c.id === cur?.id} aria-label={focusBlocksSelection ? undefined : `查看关联账户组 ${c.id} 详情`} onOpen={focusBlocksSelection ? undefined : () => setSelId(c.id)}>
                        <Td><Cell mono main={c.key} sub={`${c.layerLabel} · ${c.span}`} title={`${c.key} · ${c.layerLabel} · ${c.span}`} /></Td>
                        <Td align="right"><Cell num main={c.n} /></Td>
                        <Td><Cell main={<InlineMeter value={c.strength} text={c.strength.toFixed(2)} tone={strengthTone(c.strength, freezeSuggestThreshold)} />} sub={isHot(c) ? <StatusTag tone="danger" icon={ShieldAlert}>建议冻结</StatusTag> : undefined} /></Td>
                        <Td><StatusTag tone={statusTone} explain={statusExplain}>{statusLabel}</StatusTag></Td>
                        <Td align="right">
                          {first && (
                            <span className="rd-row-actions">
                              <Button size="sm" onClick={first.run}>{first.label}</Button>
                              {rest.length > 0 && <MoreMenu label={`${c.id} 的更多处置`} items={rest.map((action) => ({ key: action.key, label: action.label, onSelect: action.run }))} />}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                  {!clusters.length && <TableMessage columns={5} role="status">当前条件下没有关联账户组。可调整筛选条件后重试。</TableMessage>}
                </tbody>
              </Table>
              {clusterPageData.total > 0 && <Pager label="关联账户组列表" total={clusterPageData.total} page={clusterPage} pageSize={clusterPageSize} sizes={CLUSTER_PAGE_SIZE_OPTIONS} loading={ctx.contentLoading}
                onPage={setClusterPage} onPageSize={(next) => { setClusterPageSize(next); setClusterPage(1); }} />}
            </Panel>
            {cur ? selectedPanel(cur) : clusters.length > 0 && <BlockState state="loading" title="定位完成后显示这组的详情" />}
          </div>
        </>
      ) : overviewState)}

      {tab === "earnings" && (
        <Panel data-proof="k1-protected-earnings" title="待审核或已锁定的收益" icon={Coins} tone="role-1" flush
          sub={protectedEntries.length ? `待审核 ${pendingEntries.length} 笔 · 已锁定 ${lockedEntries} 笔${protectedEntries.length >= PROTECTED_ENTRY_LIMIT ? ` · 最多显示 ${PROTECTED_ENTRY_LIMIT} 条` : ""}` : "人工放行需要相应权限、操作理由，并留下操作记录"}
          actions={<Button size="sm" disabled={protectedEntriesLoading} onClick={() => void refreshProtectedEntries()}>刷新收益记录</Button>}>
          {protectedEntriesError ? (
            <BlockState state="error" title={protectedEntriesError} detail="当前不提供人工放行入口。" onRetry={() => void refreshProtectedEntries()} retrying={protectedEntriesLoading} />
          ) : (
            <Table label="待审核或已锁定的收益">
              <thead>
                <tr>
                  <Th>收益记录号 · 生成时间</Th>
                  <Th icon={Users} tone="users">用户 / 关联账户组</Th>
                  <Th>来源</Th>
                  <Th align="right" icon={Coins} tone="money">金额</Th>
                  <Th>处理状态</Th>
                  <Th align="right">操作</Th>
                </tr>
              </thead>
              <tbody>
                {protectedEntries.map((entry) => (
                  <Tr key={entry.entryNo}>
                    <Td><Cell mono full main={entry.entryNo} sub={entry.createdAt} /></Td>
                    <Td><Cell mono main={`U${entry.userId}`} sub={entry.clusterId} /></Td>
                    <Td><Cell main={({ TRIAL: "试用收益", DEVICE: "设备收益", TASK: "任务奖励", COMMISSION: "团队奖励", REFERRAL: "邀请奖励", WELCOME: "新人奖励" } as Record<string, string>)[entry.sourceType.toUpperCase()] ?? "来源未知"} sub={<span data-mono>{entry.sourceRef}</span>} /></Td>
                    <Td align="right"><Cell num main={`${entry.amount.toLocaleString("en-US")} ${nexGridBrandText(entry.asset)}`} /></Td>
                    <Td><StatusTag tone={entry.bucket === "bonus_locked" ? "danger" : "warn"} explain={entry.bucket === "bonus_locked" ? "这笔收益被锁定，不能提现。账户组解除后不会自动放行，要人工放行。" : "这笔收益等人工审核，不会到期自动放行。"}>{entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"}</StatusTag></Td>
                    <Td align="right">{canRelease && <Button size="sm" disabledReason={overviewFailed ? "风险数据读取失败，恢复后才能放行" : undefined} onClick={() => releaseProtectedEntry(entry)}>人工放行</Button>}</Td>
                  </Tr>
                ))}
                {!protectedEntriesLoading && protectedEntries.length === 0 && <TableMessage columns={6} role="status">当前没有待审核或已锁定的收益。</TableMessage>}
                {protectedEntriesLoading && protectedEntries.length === 0 && <TableMessage columns={6} role="status">正在加载收益记录…</TableMessage>}
              </tbody>
            </Table>
          )}
        </Panel>
      )}

      {tab === "rules" && (overviewReady ? (
        <>
          <Panel title="风险判断标准" sub="按同一 IP、设备或支付工具找出可能是同一人的账户 · 修改后下次检查生效" icon={ShieldAlert} tone="role-4" flush>
            <ParamTable label="风险判断标准" rows={params.map((p) => ({
              key: p.key, name: riskParamName(p), sub: riskParamSub(p), value: `${p.value}${p.unit ? ` ${p.unit}` : ""}`,
              action: canWrite ? paramAction(riskParamName(p), () => adjParam(p)) : undefined,
            }))} />
          </Panel>

          {/* 收益释放参数(SPEC-7 搬回,合并底账 §二#5):与整簇冻结分开的放行细调。 */}
          <Panel title="关联账户的收益审核规则" sub="同组账户超过正常名额后，新增收益须审核 · 影响后续收益审核与提现" icon={Coins} tone="role-1" flush>
            {overviewReady.releaseParams.length > 0 ? (
              <div data-proof="k1-risk-release-params">
                <ParamTable label="关联账户的收益审核规则" rows={overviewReady.releaseParams.map((p) => ({
                  key: p.key, name: releaseParamName(p), sub: releaseParamSub(p), value: `${releaseParamDisplay(p)}${p.unit && K1_RELEASE_PARAM_LIMITS[p.key] ? ` ${p.unit}` : ""}`,
                  action: canRelease && p.adjustable !== false ? paramAction(releaseParamName(p), () => adjReleaseParam(p)) : undefined,
                }))} />
              </div>
            ) : (
              <BlockState state="error" title="收益审核规则暂时加载不出来，请稍后重试；现在不能调整。" onRetry={reloadOverview} retrying={ctx.contentLoading} />
            )}
          </Panel>
          {overviewReady.releaseParams.length > 0 && (
            <Fold title="处理规则" summary="账户组状态和账号数决定新增收益怎么处理">
              <p className="rd-note">账户组处于「待判定」「可疑」或「已冻结」，或同组账号数达到「第几个关联账号起建议冻结」时，新增收益直接记为锁定奖励，无需先人工冻结账户组。其余情况下，账号数达到审核起点时，新增收益须先审核；未达到时记为可提现收益。收益锁定与账户冻结是两种处理。待审核收益<b>不会因等待时间到期自动放行</b>，只能经人工审核后放行。放宽规则可能增加资金支出，请写明依据。</p>
            </Fold>
          )}

          <Panel title="IP 允许名单" sub="只是不按 IP 检测，设备和支付工具仍照常检测" icon={ListChecks} tone="role-2" flush
            actions={canWrite && <Button size="sm" onClick={addWl}>+ 添加允许名单</Button>}>
            <Table label="IP 允许名单">
              <thead><tr><Th>IP / 网段</Th><Th>备注</Th><Th>添加人</Th><Th>失效时间</Th><Th align="right">操作</Th></tr></thead>
              <tbody>
                {whitelist.map((w) => (
                  <Tr key={w.cidr}>
                    <Td><Cell mono main={w.cidr} /></Td>
                    <Td><Cell main={w.note} title={w.note} /></Td>
                    <Td><Cell main={w.operator} /></Td>
                    <Td><Cell num main={w.expireText} /></Td>
                    <Td align="right">{canWrite && <Button size="sm" onClick={() => rmWl(w.cidr)}>移除</Button>}</Td>
                  </Tr>
                ))}
                {!whitelist.length && <TableMessage columns={5} role="status">暂无允许名单</TableMessage>}
              </tbody>
            </Table>
            {whitelistPageData.total > 0 && <Pager label="IP 允许名单" total={whitelistPageData.total} page={whitelistPage} pageSize={whitelistPageSize} sizes={WHITELIST_PAGE_SIZE_OPTIONS} loading={ctx.contentLoading}
              onPage={setWhitelistPage} onPageSize={(next) => { setWhitelistPageSize(next); setWhitelistPage(1); }} />}
          </Panel>
        </>
      ) : overviewState)}

      {paramDraft && (() => {
        const limits = PARAM_LIMITS[paramDraft.param.key];
        const numeric = Number(paramDraft.value);
        const valueOk = Number.isFinite(numeric) && numeric >= limits.min && numeric <= limits.max
          && (!limits.integer || Number.isInteger(numeric));
        const reasonOk = paramDraft.reason.trim().length >= 8 && paramDraft.reason.trim().length <= 200;
        const update = (patch: Partial<ParamDraft>) => setParamDraft((current) => current ? { ...current, ...patch } : current);
        const busy = draftSubmitting === "param";
        const unit = paramDraft.param.unit ? ` ${paramDraft.param.unit}` : "";
        return (
          <Modal title={`调整风险判断标准 · ${riskParamName(paramDraft.param)}`} busy={busy} onClose={() => setParamDraft(null)} footer={<>
            <Button disabled={busy} onClick={() => setParamDraft(null)}>取消</Button>
            <Button variant="primary" disabled={!valueOk || !reasonOk || busy} onClick={() => void saveParamDraft()}>{busy ? "保存中…" : "确认保存"}</Button>
          </>}>
            <div className="rd-stack">
              <DiffList rows={[{ key: "value", label: "当前值和新值", before: `${paramDraft.param.value}${unit}`, after: `${paramDraft.value}${unit}` }]} emptyNote="还没改动" />
              <Field label={`新值（${limits.min}–${limits.max}）`} help="保存后，下次检查生效。" error={!valueOk ? (limits.integer ? "必须填写范围内的整数" : "必须填写范围内的数字") : undefined}>
                {(control) => <Input {...control} type="number" min={limits.min} max={limits.max} step={limits.step} value={paramDraft.value} onChange={(event) => update({ value: event.target.value })} />}
              </Field>
              <Field label="操作理由（必填 · 8-200 字）">
                {(control) => <Textarea {...control} rows={3} maxLength={200} placeholder="写清调整原因和依据" value={paramDraft.reason} onChange={(event) => update({ reason: event.target.value })} />}
              </Field>
              <Notice tone="neutral">{paramDraft.param.key === "maxSignupPerIp24h" ? "正式环境达到该 IP 的每日注册上限后，会拒绝新注册；不会自动冻结已有账户。" : "该参数会影响关联账户识别或冻结建议，不会自动冻结已有账户。"}</Notice>
            </div>
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
        const busy = draftSubmitting === "release";
        const unit = limits && releaseDraft.param.unit ? ` ${releaseDraft.param.unit}` : "";
        const valueText = (value: string) => isBool ? RELEASE_BOOL_LABELS[value] ?? value : isMode ? RELEASE_MODE_LABELS[value] ?? value : `${value}${unit}`;
        return (
          <Modal title={`调整收益审核规则 · ${releaseParamName(releaseDraft.param)}`} busy={busy} onClose={() => setReleaseDraft(null)} footer={<>
            <Button disabled={busy} onClick={() => setReleaseDraft(null)}>取消</Button>
            <Button variant="primary" disabled={!valueOk || !reasonOk || busy} onClick={() => void saveReleaseDraft()}>{busy ? "保存中…" : "确认保存"}</Button>
          </>}>
            <div className="rd-stack">
              <DiffList rows={[{ key: "value", label: "当前值和新值", before: valueText(releaseDraft.param.value), after: valueText(releaseDraft.value) }]} emptyNote="还没改动" />
              {limits ? (
                <Field label={`新值（${limits.min}–${limits.max}${releaseDraft.param.unit ? ` · ${releaseDraft.param.unit}` : ""}）`} error={!valueOk ? "必须填写范围内的整数" : undefined}>
                  {(control) => <Input {...control} type="number" min={limits.min} max={limits.max} step={limits.step} value={releaseDraft.value} onChange={(event) => update({ value: event.target.value })} />}
                </Field>
              ) : (
                // 可枚举值走下拉不手输(释放模式 / 开关);选项集合与 k-client 校验白名单同源。
                <Field label="新值（从下拉选择）">
                  <Select aria-label="新值（从下拉选择）" value={releaseDraft.value} onChange={(value) => update({ value })}
                    options={(isMode ? [...K1_RELEASE_MODE_VALUES] : ["true", "false"]).map((option) => ({ value: option, label: isMode ? RELEASE_MODE_LABELS[option] : RELEASE_BOOL_LABELS[option] }))} />
                </Field>
              )}
              <Field label="操作理由（必填 · 8-200 字）">
                {(control) => <Textarea {...control} rows={3} maxLength={200} placeholder="写清调整原因和依据" value={releaseDraft.reason} onChange={(event) => update({ reason: event.target.value })} />}
              </Field>
              {/* 必须先过 valueOk:输入框清空时 Number("") = 0,对「调小才是放宽」族会被误判成放宽,
                  对一个根本提交不了的无效值报「放大资金流出」是谎报风险。 */}
              {valueOk && isLooseningRelease(key, releaseDraft.param.value, releaseDraft.value) && (
                // 放大资金流出方向的告知(与其它放大类动作同款口径):真正的拦截在服务端,
                // 本页没有覆盖率数据,不做客户端预检 —— 只如实告知会被核验,不假装拦得住。
                <div data-proof="k1-release-loosen-warning">
                  <Notice tone="warn" title="这项调整可能增加可提现收益">保存前会检查兑付覆盖率，低于红线时无法保存。请在操作理由中写明依据。</Notice>
                </div>
              )}
              <Notice tone="neutral">{key === "releaseMode" && releaseDraft.param.adjustable === false
                ? "在线验证放行尚未开放，当前只能人工审核收益。"
                : "调整只影响后续收益审核和提现，历史记录不会改动；放宽规则时请写明理由。"}</Notice>
            </div>
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
        const busy = draftSubmitting === "whitelist";
        return (
          <Modal title="添加 IP 允许名单" busy={busy} onClose={() => setWhitelistDraft(null)} footer={<>
            <Button disabled={busy} onClick={() => setWhitelistDraft(null)}>取消</Button>
            <Button variant="primary" disabled={!canSave || busy} onClick={() => void saveWhitelistDraft()}>{busy ? "提交中…" : "确认加入"}</Button>
          </>}>
            <div className="rd-stack">
              <Notice tone="neutral">只是不再按 IP 检测；设备和支付工具仍照常检测，已冻结的账户不会自动解冻。</Notice>
              <Field label="IP / CIDR 网段" error={whitelistDraft.cidr && !cidrOk ? "请输入合法 IPv4 CIDR（每段不使用前导零）" : undefined}>
                {(control) => <Input {...control} value={whitelistDraft.cidr} onChange={(event) => update({ cidr: event.target.value })} placeholder="198.51.100.0/24" />}
              </Field>
              <Field label="备注">
                {(control) => <Input {...control} maxLength={200} value={whitelistDraft.note} onChange={(event) => update({ note: event.target.value })} placeholder="例如：已核验的办公出口网段" />}
              </Field>
              <Field label="失效日期" error={whitelistDraft.expireText && !expiryOk ? "失效日期必须晚于今天" : undefined}>
                {(control) => <Input {...control} type="date" value={whitelistDraft.expireText} onChange={(event) => update({ expireText: event.target.value })} />}
              </Field>
              <Field label="操作理由（必填 · 8-200 字）">
                {(control) => <Textarea {...control} rows={3} maxLength={200} placeholder="写清调整原因和依据" value={whitelistDraft.reason} onChange={(event) => update({ reason: event.target.value })} />}
              </Field>
            </div>
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
        const busy = draftSubmitting === "weight";
        return (
          <Modal title={`调整关联权重 · ${riskParamName(weightDraft.param)}`} busy={busy} wide onClose={() => setWeightDraft(null)} footer={<>
            <Button disabled={busy} onClick={() => setWeightDraft(null)}>取消</Button>
            <Button variant="primary" disabled={!canSave || busy} onClick={() => void saveWeightDraft()}>{busy ? "保存中…" : "确认保存"}</Button>
          </>}>
            <div className="rd-stack">
              <Notice tone="neutral">关联强度 = 设备指纹命中 × 设备权重 + 支付工具命中 × 支付权重 + IP 命中 × IP 权重。每项单独填写，三项加起来要等于 1.00。</Notice>
              <div className="rd-split" data-even="">
                {[
                  ["device", "设备指纹权重", "设备指纹 / 浏览器指纹 / 应用实例"] as const,
                  ["payment", "支付工具权重", "银行卡 / 钱包 / 收款工具"] as const,
                  ["ip", "IP 权重", "同出口 IP / 网段"] as const,
                ].map(([key, label, help]) => (
                  <Field key={key} label={label} help={help}>
                    {(control) => <Input {...control} type="number" min={0} max={1} step={0.05} value={weightDraft[key]} onChange={(event) => updateDraft({ [key]: event.target.value } as Partial<WeightDraft>)} placeholder="0.00 - 1.00" />}
                  </Field>
                ))}
              </div>
              <Field label="操作理由（必填 · 8-200 字）">
                {(control) => <Textarea {...control} rows={3} maxLength={200} value={weightDraft.reason} onChange={(event) => updateDraft({ reason: event.target.value })} placeholder="例如：误判多来自同一网络，降低 IP 权重、提高设备指纹权重" />}
              </Field>
              <Notice tone={validNumbers && totalOk ? "neutral" : "danger"}>
                当前合计 {total.toFixed(2)}
                {!validNumbers ? " · 每项必须在 0 到 1 之间" : !totalOk ? " · 三项合计必须等于 1.00" : ` · 保存值 ${linkWeightValue(weightDraft)}`}
                {!reasonOk && <span>{reasonLength < 8 ? ` · 理由还需 ${8 - reasonLength} 字` : " · 理由不能超过 200 字"}</span>}
              </Notice>
            </div>
          </Modal>
        );
      })()}
    </>
  );
}
