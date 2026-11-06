"use client";

import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Coins, Gift, ListChecks, Lock, LockOpen, Network, RefreshCw, ShieldAlert, ShieldCheck, SlidersHorizontal, Snowflake, Users, type LucideIcon } from "lucide-react";
import {
  BlockState, Button, Cell, Change, ChartLegend, Conclusion, ConfigList, ConfigRow, Decision, DiffField, Explain, Fact, Facts, Field, Figure, FilterBar, FilterField, Fold, InlineMeter, Input, IrreversibleTag, JudgmentPoints, KeyValues,
  Modal, MoreMenu, Notice, NumberInput, PageHeader, PageTabs, Pager, Panel, ReleaseModal, SectionNav, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr, useSectionNav,
  type ExplainRow, type JudgmentRow, type SectionNavItem, useTabIds
} from "@/app/components/rd";
import { fetchK1MultiAccountOverview, K1OutcomeUncertainError, K1_RELEASE_MODE_VALUES, K1_RELEASE_PARAM_LIMITS, newK1CommandKey } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { A2OutcomeUncertainError, fetchA2ProposalByKey, fetchA2ReasonPolicy, visibleReasonLength } from "@/lib/admin/a2-client";
import { K1_PARAM_HELP, type K1ParamHelp } from "@/lib/admin/config-help/k1-multiaccount";
import type { AdminPage, ClusterStatus, K1Cluster, K1ClusterLayer, K1ClusterSort, K1ClusterStatusFilter, K1ProtectedEntry, K1WhitelistRow, KRiskParam } from "@/lib/admin/k-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { createPendingMutationStore, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import type { ActionConfirmReq, KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
type K1PendingKind = "cluster" | "note" | "param" | "release-param" | "entry" | "whitelist-add" | "whitelist-remove";
type K1ClusterAction = "flag" | "freeze" | "release" | "clear";
/** 一次写操作的完整内容。先存再发，结果未知时只能按这份原样重试（OP-92～OP-94）。 */
type K1PendingCommand = PendingMutationRecord & {
  kind: K1PendingKind;
  /** 对象：账户组号、参数键、收益记录号或网段。 */
  target: string;
  label: string;
  operator: string;
  reason: string;
  clusterAction?: K1ClusterAction;
  clusterStatus?: ClusterStatus;
  version?: number;
  name?: string;
  value?: string;
  note?: string;
  expireText?: string;
};
type K1PendingExtra = PendingMutationExtra<K1PendingCommand>;
const K1_PENDING_KINDS: readonly K1PendingKind[] = ["cluster", "note", "param", "release-param", "entry", "whitelist-add", "whitelist-remove"];
/** 全部写操作共用一张表，刷新后还能用同一命令号按原内容重试。 */
const pendingCommands = createPendingMutationStore<K1PendingCommand>({
  storageKey: "nexion-admin-k1-multiaccount-commands-v1",
  retainExpiredRecords: true, // 过期不能重试，但记录和对象锁都留着（OP-96）
  // 重试直接用记录里的内容，坏记录不能当原操作重发。
  isValidRecord: (record) => K1_PENDING_KINDS.includes(record.kind) && typeof record.target === "string" && record.target.length > 0
    && typeof record.reason === "string" && typeof record.label === "string"
    && record.fingerprint === `${record.kind}|${record.target}`,
});
/** 待确认时要锁住的对象：同一个账户组、参数、收益或网段。 */
const PENDING_GROUP: Record<K1PendingKind, string> = {
  cluster: "cluster", note: "cluster", param: "param", "release-param": "param", entry: "entry", "whitelist-add": "cidr", "whitelist-remove": "cidr",
};
const RECOVERY_HINT: Record<K1PendingKind, string> = {
  cluster: "可能已经生成审批单。",
  note: "备注可能已经保存。",
  param: "新值可能已经生效。",
  "release-param": "新值可能已经生效。",
  entry: "这笔收益可能已经放行。",
  "whitelist-add": "这个网段可能已经加入。",
  "whitelist-remove": "这个网段可能已经移除。",
};
const CLUSTER_OPS: Record<K1ClusterAction, { def: () => NonNullable<ReturnType<typeof findHighOp>>; from: readonly ClusterStatus[]; after: ClusterStatus; amplifies: boolean }> = {
  flag: { def: () => findHighOp("k1_cluster_flag")!, from: ["detected"], after: "flagged", amplifies: false },
  freeze: { def: () => findHighOp("k1_cluster_freeze")!, from: ["flagged"], after: "frozen", amplifies: false },
  release: { def: () => findHighOp("k1_cluster_release")!, from: ["frozen", "flagged"], after: "released", amplifies: true },
  clear: { def: () => findHighOp("k1_cluster_cleared")!, from: ["detected"], after: "cleared", amplifies: true },
};
const PROPOSAL_STATUS: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
/** 谁批、批准前怎样每次都一样，收进生效标签的提示图标，不占事实行（VS-105）。 */
const APPROVAL_EFFECT = <StatusTag tone="progress" filled explain="超级管理员批准后才生效，超管发起的由另一位超管批准。批准前这组的状态和账户都不变。">批准后生效</StatusTag>;
const IMMEDIATE_EFFECT = <StatusTag tone="progress" filled>立即生效</StatusTag>;
const RISK_REASON_PLACEHOLDER = "写清场景和依据，例如：合租办公网络、已知合作账户、客服举报线索";
const CONFLICT_TEXT = "这项刚被别人改过。";
const EXPIRED_TEXT = "已超过 24 小时，不能再重试，请到操作记录与审批核对。";
/** released / cleared 在批准执行时由后端核验覆盖率。 */
const DISPOSITION_COVERAGE_GATE = "批准执行时检查兑付覆盖率，低于红线或无法读取时不能执行。";
const CLUSTER_PAGE_SIZE_OPTIONS = [5, 10, 20];
const WHITELIST_PAGE_SIZE_OPTIONS = [5, 10, 20];
const MAX_FOCUS_RELOCATIONS = 3;
const DETAIL_ID = "k1-selected-cluster";
/** 上下排（1366 以下）时点一行看不到右边的选中区，滚到选中区（PG-45）；并排时不动。 */
function revealDetail() {
  if (!window.matchMedia("(max-width: 1365px)").matches) return;
  window.requestAnimationFrame(() => document.getElementById(DETAIL_ID)?.scrollIntoView({ block: "start", behavior: "smooth" }));
}
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
type WeightKey = "device" | "payment" | "ip";
/** bad 记数字框填坏的项：填坏时 value 是空串，只有 validity 分得清（CP-54）。 */
type WeightDraft = { param: KRiskParam; device: string; payment: string; ip: string; reason: string; bad: Partial<Record<WeightKey, boolean>> };
type ParamDraft = { param: KRiskParam; value: string; reason: string };
/** 备注就是 reason；changed 是读取最新后别人改了什么。 */
type NoteDraft = { cluster: K1Cluster; reason: string; changed?: string };
type WhitelistDraft = { cidr: string; note: string; expireText: string; reason: string };
type ReasonPolicy = { min: number; max: number } | null;
const PARAM_LIMITS: Record<string, { min: number; max: number; step: number; integer: boolean }> = {
  maxSignupPerIp24h: { min: 1, max: 10, step: 1, integer: true },
  maxAccountsPerDevice: { min: 1, max: 5, step: 1, integer: true },
  maxAccountsPerPaymentInstrument: { min: 1, max: 5, step: 1, integer: true },
  clusterFreezeSuggestThreshold: { min: 0, max: 1, step: 0.05, integer: false },
};
const K1_DISPOSITION_APPROVAL_COPY = "须另一位有权限的超级管理员批准。批准前不执行；本次批准被系统拒绝时，不改变账户组状态和提现限制。";
const K1_DISPOSITION_EFFECT = <StatusTag tone="progress" filled explain={<>{K1_DISPOSITION_APPROVAL_COPY}{DISPOSITION_COVERAGE_GATE}</>}>批准后生效</StatusTag>;

const CLUSTER_ST: Record<ClusterStatus, [string, "warn" | "danger" | "done" | "ok", string]> = {
  detected: ["待判定", "warn", "系统发现的账户组，还没人判定。这组账户不能提现，新增收益先锁定。下一步：标记为可疑，或判定为正常。"],
  flagged: ["可疑", "warn", "已标记可疑，账户没有冻结。这组账户不能提现，新增收益先锁定。下一步：批量冻结，或解除误判。"],
  frozen: ["已冻结", "warn", "这组账户已冻结，不能提现，新增收益先锁定。核实是误判后解除误判。"], // 冻结全站橙黄（VS-20）
  released: ["已解除", "done", "已判定是误判。提现和新增收益改按同组账号数判断，人数达到锁定起点时仍不能提现。有新证据时系统另开一组。"],
  cleared: ["正常", "ok", "已判定为正常，不再算监控中。提现和新增收益改按同组账号数判断，人数达到锁定起点时仍不能提现。有新证据时系统另开一组。"],
};

// ── 收益释放参数(SPEC-7 搬回,合并底账 §二#5)──────────────────────────
// enum/boolean 的运营可读中文标签(页面禁裸工程串);数值范围与键集统一来源在 k-client,
// 读校验与编辑弹窗共用,避免两处漂移。
const RELEASE_MODE_LABELS: Record<string, string> = {
  manual_only: "仅人工放行",
};
const RELEASE_BOOL_LABELS: Record<string, string> = { true: "开启", false: "关闭" };
const RISK_PARAM_NAME: Record<string, string> = {
  maxSignupPerIp24h: "同一 IP 每天最多注册多少个账号",
  maxAccountsPerDevice: "同一设备最多关联多少个账号",
  maxAccountsPerPaymentInstrument: "同一支付工具最多关联多少个账号",
  linkWeight: "设备、支付工具和 IP 的关联权重",
  clusterFreezeSuggestThreshold: "建议冻结的关联程度",
};
const riskParamName = (p: KRiskParam) => RISK_PARAM_NAME[p.key] ?? p.name;
const RELEASE_PARAM_NAME: Record<string, string> = {
  freePhoneSlotsPerCluster: "同组正常放行的手机号数",
  duplicateAccountPendingFrom: "同组账号数达到多少起审核收益",
  duplicateAccountFreezeFrom: "同组账号数达到多少起锁定收益",
  pendingReleaseHours: "批量放行统计时间范围",
  releaseMode: "收益放行方式",
  freeSlotRequiresBinding: "正常名额是否需要绑定手机号",
};
const releaseParamName = (p: KRiskParam) => RELEASE_PARAM_NAME[p.key] ?? p.name;

/** 收益金额按接口给的精度写全，非零不能显示成 0（TX-20）。 */
const amountText = (amount: number) => amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 20 });

/** 时刻按业务时区写，和页头一致。 */
const clockText = (time: number) => new Date(time).toLocaleTimeString("zh-CN", { timeZone: businessZone().zoneId, hour: "2-digit", minute: "2-digit", hour12: false });

function formatThreshold(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "未配置";
}

/** 建议线全页写两位小数，其余参数写接口原值。 */
const riskValueText = (key: string, value: string, unit = "") =>
  `${key === "clusterFreezeSuggestThreshold" ? formatThreshold(Number(value)) : value}${unit ? ` ${unit}` : ""}`;

function strengthTone(v: number, threshold: number) {
  if (!Number.isFinite(threshold)) return "neutral" as const;
  return v >= threshold
    ? "danger" as const
    : v >= threshold * 0.8 ? "warn" as const : "neutral" as const; // 没到线是「还没到」，不是「安全」，不用绿（visual-1 第 3 条）
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

/** 这两项决定收益走向，放宽真的会多放钱。其余几项现在不影响收益，放宽时后端仍查覆盖率。 */
const RELEASE_AFFECTS_EARNINGS = new Set(["duplicateAccountPendingFrom", "duplicateAccountFreezeFrom"]);

/** 后端 validateCross：名额 < 审核起点 ≤ 锁定起点。用另外两项的当前值算这一项能填的范围（OP-15）。 */
function releaseRange(key: string, limits: { min: number; max: number }, params: readonly KRiskParam[]) {
  const read = (name: string) => Number(params.find((p) => p.key === name)?.value);
  const slots = read("freePhoneSlotsPerCluster");
  const pendingFrom = read("duplicateAccountPendingFrom");
  const freezeFrom = read("duplicateAccountFreezeFrom");
  if (key === "freePhoneSlotsPerCluster") return { min: limits.min, max: Math.min(limits.max, pendingFrom - 1), problem: `要小于审核起点 ${pendingFrom}`, next: "要改先调大审核起点。" };
  if (key === "duplicateAccountPendingFrom") return { min: Math.max(limits.min, slots + 1), max: Math.min(limits.max, freezeFrom), problem: `要大于 ${slots}，不大于 ${freezeFrom}`, next: "要改先调大锁定起点。" };
  if (key === "duplicateAccountFreezeFrom") return { min: Math.max(limits.min, pendingFrom), max: limits.max, problem: `不能小于审核起点 ${pendingFrom}`, next: "" };
  return { min: limits.min, max: limits.max, problem: "", next: "" };
}

/** 待批单占着对象时也回 409，这时不是别人改过，文字按 OP-64 走错误码。 */
function isVersionConflict(error: unknown) {
  const { status, backendMessage } = error as { status?: number; backendMessage?: string };
  return status === 409 && backendMessage !== "OBJECT_LOCKED_BY_A2" && backendMessage !== "OBJECT_ALREADY_PENDING";
}

const paramHelpRows = (help: K1ParamHelp | undefined, fallback: string): ExplainRow[] => [
  { k: "这是什么", v: help?.what ?? fallback },
  { k: "怎么填", v: help?.how },
  { k: "生效时间", v: help?.when },
];

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

function parseLinkWeight(value: string): Pick<WeightDraft, WeightKey> {
  return {
    device: parseNamedWeight(value, "设备", "0.50"),
    payment: parseNamedWeight(value, "支付", "0.40"),
    ip: parseNamedWeight(value, "IP", "0.10"),
  };
}

/** 空不是 0：Number("") 是 0，清空的框不能当 0 算。 */
function numberValue(value: string) {
  const parsed = value.trim() ? Number(value) : Number.NaN;
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
                <text className="rd-graph-label" x={x} y={y + 4} fontWeight={600} fill="var(--rd-text-3)" textAnchor="middle">{`+${over}`}</text>
                <text className="rd-graph-label" x={x} y={uy >= 0 ? y + 30 : y - 22} fill="var(--rd-text-3)" textAnchor="middle">未列出</text>
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
              <text className="rd-graph-label" x={x} y={uy >= 0 ? y + 31 : y - 23} fill="var(--rd-text-2)" textAnchor="middle">{(nd?.[0] ?? "").slice(4)}</text>
            </g>
          );
        })}
        {!c.edges.length && <text className="rd-graph-label" x={cx} y={cy + 4} fill="var(--rd-text-3)" textAnchor="middle">暂无可展示关联边</text>}
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

/** 四类修改框共用的理由字段：理由规则和字数算法和确认框相同（OP-20～OP-22）。 */
function reasonProblem(reason: string, policy: ReasonPolicy, policyFailed: boolean) {
  if (!policy) return policyFailed ? "理由规则加载失败，暂时无法提交。请关闭弹窗后重试。" : "正在加载，稍候即可提交。";
  const length = visibleReasonLength(reason);
  if (length < policy.min) return `还差 ${policy.min - length} 字`;
  return length > policy.max ? `超过 ${length - policy.max} 字` : undefined;
}

/** 修改框的外壳：错误留在框里，提交中全部锁定（OP-18、OP-33、OP-82）。说明进标题旁的提示图标，节奏和确认框共用层一样：
 *  字数写在框角，缺什么写在灰按钮的提示里，刚打开不报错，失焦或点过提交才在字段下用警告色写原因（DP-06）。 */
function DraftModal({ title, icon, effect, explain, wide, busy, reading, busyLabel = "保存中…", saveLabel, blocked, dirty, attempted, onAttempt, reasonLabel = "操作理由", reason, placeholder, policy, policyFailed, error, onReason, onReadLatest, onClose, onSave, children }: {
  title: string;
  /** 标题前的图标底和标题下的生效标签（VS-101、VS-106）。 */
  icon?: LucideIcon;
  effect?: ReactNode;
  explain?: readonly ExplainRow[];
  wide?: boolean;
  busy: boolean;
  /** 正在读取最新。没读到之前旧版本不能再提交（OP-97）。 */
  reading?: boolean;
  busyLabel?: string;
  saveLabel: string;
  blocked?: string;
  /** 只靠点选的表单：改过就传 true，点空白不关。 */
  dirty?: boolean;
  attempted: boolean;
  onAttempt: () => void;
  reasonLabel?: string;
  reason: string;
  placeholder: string;
  policy: ReasonPolicy;
  policyFailed: boolean;
  error: { text: string; conflict: boolean } | null;
  onReason: (reason: string) => void;
  onReadLatest?: () => void;
  onClose: () => void;
  onSave: () => void;
  children: ReactNode;
}) {
  const [reasonLeft, setReasonLeft] = useState(false);
  const problem = reasonProblem(reason, policy, policyFailed);
  const length = visibleReasonLength(reason);
  const missing = error?.conflict ? (reading ? "正在读取最新" : "这项刚被别人改过，先读取最新") : [blocked, problem && `${reasonLabel}${problem}`].filter(Boolean).join("；");
  return (
    <Modal title={<>{title}{explain && <Explain label={`${title}的说明`} rows={explain} />}</>} icon={icon} sub={effect} wide={wide} busy={busy} dirty={dirty} onClose={onClose} footer={<>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button variant="primary" disabled={busy} disabledReason={busy ? undefined : missing || undefined} onBlockedClick={onAttempt} onClick={onSave}>{busy ? busyLabel : saveLabel}</Button>
    </>}>
      <div className="rd-stack">
        {error && <Notice tone={error.conflict ? "warn" : "danger"} action={error.conflict && onReadLatest ? <Button size="sm" disabled={busy} loading={reading} onClick={onReadLatest}>读取最新</Button> : undefined}>{error.text}</Notice>}
        {children}
        <Field label={reasonLabel} required hint={`至少 ${policy?.min ?? 8} 字`} error={policyFailed || attempted || reasonLeft ? problem : undefined}>
          {(control) => <Textarea {...control} rows={3} maxLength={200} disabled={busy} placeholder={placeholder} value={reason} count={`${length}/${policy?.max ?? 200}`} onChange={(event) => onReason(event.target.value)} onBlur={() => setReasonLeft(true)} />}
        </Field>
      </div>
    </Modal>
  );
}

/** 确认框里的版本冲突：框不关，按钮读最新（OP-97）。 */
function ConflictBar({ onRead }: { onRead: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "reading" | "failed">("idle");
  const read = async () => {
    setState("reading");
    try {
      await onRead();
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="rd-toolbar">
      <span>{state === "failed" ? "读取最新失败，稍后再试。已填写的内容还在。" : CONFLICT_TEXT}</span>
      <Button size="sm" loading={state === "reading"} onClick={() => void read()}>读取最新</Button>
    </span>
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
  const operator = useAdminAuth((state) => state.session?.operator || state.session?.username || state.operator || "");
  const hasAuthority = (authority: string) => authorities.includes(authority);
  const canWrite = hasAuthority("risk_k1_write");
  const canFlag = hasAuthority("risk_k1_cluster_flag");
  const canFreeze = hasAuthority("risk_k1_cluster_freeze");
  const canRelease = hasAuthority("risk_k1_cluster_release");
  const canClear = hasAuthority("risk_k1_cluster_cleared");
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusClusterId = (searchParams?.get("focusClusterId") ?? "").trim();
  const tabIds = useTabIds();
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
  const [earningsReadAt, setEarningsReadAt] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const [pending, setPending] = useState<K1PendingCommand[]>([]);
  const [retrying, setRetrying] = useState("");
  const [checking, setChecking] = useState("");
  const [proposalNotFound, setProposalNotFound] = useState<string[]>([]);
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [releasing, setReleasing] = useState<K1PendingCommand | null>(null);
  const [draftError, setDraftError] = useState<{ text: string; conflict: boolean } | null>(null);
  const [reasonPolicy, setReasonPolicy] = useState<ReasonPolicy>(null);
  const [reasonPolicyFailed, setReasonPolicyFailed] = useState(false);
  const [weightDraft, setWeightDraft] = useState<WeightDraft | null>(null);
  const [paramDraft, setParamDraft] = useState<ParamDraft | null>(null);
  const [releaseDraft, setReleaseDraft] = useState<ParamDraft | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [protectedEntries, setProtectedEntries] = useState<K1ProtectedEntry[]>([]);
  const [protectedEntriesLoading, setProtectedEntriesLoading] = useState(true);
  const [protectedEntriesError, setProtectedEntriesError] = useState<string | null>(null);
  const [whitelistDraft, setWhitelistDraft] = useState<WhitelistDraft | null>(null);
  const [readingLatest, setReadingLatest] = useState(false);
  const [draftSubmitting, setDraftSubmitting] = useState<"param" | "weight" | "whitelist" | "release" | "note" | null>(null);
  const draftSubmitLock = useRef(false);
  const [focusLookupState, setFocusLookupState] = useState<"idle" | "loading" | "positioning" | "found" | "not-found" | "error">("idle");
  const focusPageLoad = useRef(false);
  const overview = ctx.risk.multiAccount;

  const refreshProtectedEntries = useCallback(async () => {
    setProtectedEntriesLoading(true);
    try {
      setProtectedEntries(await ctx.actions.fetchK1ProtectedEntries());
      setProtectedEntriesError(null);
      setEarningsReadAt(clockText(Date.now()));
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
  const focusSettled = focusLookupState === "not-found" || focusLookupState === "error";
  const queryKey = `${layer}|${clusterStatus}|${clusterSort}|${clusterPage}|${clusterPageSize}`;
  // 换了条件、新结果还没回来时，旧行不能再操作（ST-35）。
  const rowsStale = Boolean(overview) && loadedKey !== queryKey;
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
  }, [ctx.reloadKRisk, pageQuery, focusSettled]);

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
    if (!overview) return;
    setReadAt(clockText(Date.now()));
    setLoadedKey(queryKey);
  }, [overview]);

  // 读取成功后，网址里的页码超出实际范围就校正，失败和加载中不动（ST-26）。
  useEffect(() => {
    if (!overview || ctx.contentLoading || ctx.contentError || focusClusterId || rowsStale) return;
    const lastCluster = Math.max(1, Math.ceil(overview.clusters.total / clusterPageSize));
    const lastWhitelist = Math.max(1, Math.ceil(overview.whitelist.total / whitelistPageSize));
    if (clusterPage > lastCluster) setClusterPage(lastCluster);
    if (whitelistPage > lastWhitelist) setWhitelistPage(lastWhitelist);
  }, [overview, ctx.contentLoading, ctx.contentError, focusClusterId, rowsStale, clusterPage, clusterPageSize, whitelistPage, whitelistPageSize]);

  useEffect(() => { setPending(pendingCommands.list()); }, []);

  const drafting = Boolean(paramDraft || releaseDraft || whitelistDraft || weightDraft || noteDraft);
  const touch = (field: string) => setTouched((current) => current[field] ? current : { ...current, [field]: true });
  /** 字段下的原因：失焦且填过，或点过提交，才写（OP-15）。 */
  const fieldError = (problem: string | undefined, filled: boolean, field: string) => touched.submit || (touched[field] && filled) ? problem : undefined;
  const draftAttempt = { attempted: Boolean(touched.submit), onAttempt: () => touch("submit"), reading: readingLatest };
  useEffect(() => {
    setTouched({});
    if (!drafting) return;
    let active = true;
    setReasonPolicy(null);
    setReasonPolicyFailed(false);
    void fetchA2ReasonPolicy().then((policy) => {
      if (active) setReasonPolicy({ min: policy.minChars, max: policy.maxChars });
    }).catch(() => {
      if (active) setReasonPolicyFailed(true);
    });
    return () => { active = false; };
  }, [drafting]);

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
          focusPageLoad.current = false;
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
      focusPageLoad.current = false;
      if (active) setFocusLookupState("error");
    })().catch(() => {
      focusPageLoad.current = false;
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
  const syncPending = () => setPending(pendingCommands.list());
  const reloadAfter = async (ok: string, failed: string) => {
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(ok);
    } catch {
      ctx.toast(failed);
    }
  };

  /**
   * 写操作共用一条路：先把原操作存好再发（OP-92）。明确失败丢号并抛给框，框里写原因、留输入；结果未知保号，
   * 关框，转成页面上方的待确认条，确认前这个对象不能再操作（OP-93）。
   * 重试的是保留下来的原命令时，明确失败也证明不了原命令的结果，继续保留。只有成功才解除。
   */
  const sendCommand = async (extra: K1PendingExtra, send: (key: string) => Promise<unknown>, done: () => Promise<void>) => {
    const scope = `${extra.kind}|${extra.target}`;
    const retained = pendingCommands.get(scope);
    const key = retained ?? newK1CommandKey();
    pendingCommands.remember(scope, key, extra);
    if (!pendingCommands.isDurablyStored(scope, key)) {
      pendingCommands.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    try {
      await send(key);
    } catch (cause) {
      const unknown = cause instanceof K1OutcomeUncertainError || cause instanceof A2OutcomeUncertainError;
      if (!unknown && !retained) pendingCommands.forget(scope);
      syncPending();
      if (!unknown) throw cause;
      ctx.toast("结果未确认，不要重复操作。到页面上方按原操作重试。");
      return;
    }
    pendingCommands.forget(scope);
    syncPending();
    await done();
  };

  /** 按记录内容发出。首次提交和按原操作重试都走这里，重试不接受新输入（OP-94）。 */
  const runRecord = (record: K1PendingExtra) => {
    const { target, reason } = record;
    const name = record.name ?? target;
    switch (record.kind) {
      case "cluster": {
        const op = CLUSTER_OPS[record.clusterAction!];
        const def = op.def();
        const version = record.version!;
        return sendCommand(record, (key) => propose(() => undefined, {
          action: record.label,
          obj: target,
          before: record.clusterStatus!,
          after: op.after,
          type: "acct",
          amplifies: op.amplifies,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K1",
          command: def.buildCommand({ clusterId: target, expectedVersion: version }),
          target: def.buildTarget({ clusterId: target }),
          commandKey: key,
        }), async () => ctx.toast(`已提交审批，等超级管理员批准。${reach("/platform/audit", "platform_a2_read") ? "到「操作记录与审批」看进度。" : ""}`));
      }
      case "note":
        return sendCommand(record, (key) => ctx.actions.updateK1ClusterReviewNote(target, record.version!, reason, key),
          () => reloadAfter(`${target} 复审备注已保存`, `${target} 复审备注已保存，但页面刷新失败；请点「重新加载」核对`));
      case "param":
        return sendCommand(record, (key) => ctx.actions.updateK1Param(target, record.value!, reason, key),
          () => reloadAfter(`${name}已更新为 ${record.value}`, `${name}已保存，但暂时无法读取最新数据；请刷新本页核对`));
      case "release-param": {
        const effect = target === "duplicateAccountPendingFrom" ? "后续新增收益按新审核起点处理"
          : target === "duplicateAccountFreezeFrom" ? "后续新增收益和当前提现资格按新锁定起点判断"
            : "当前仅人工放行，不影响收益和提现";
        return sendCommand(record, (key) => ctx.actions.updateK1ReleaseParam(target, record.value!, record.version!, reason, key),
          () => reloadAfter(`${name}已保存，${effect}`, `${name}已保存，但暂时无法读取最新数据；请刷新本页核对`));
      }
      case "entry":
        return sendCommand(record, (key) => ctx.actions.manualReleaseK1Entry(target, reason, key), async () => {
          await refreshProtectedEntries();
          ctx.toast(`${target} 已放行。能否提现还看账户组和其他提现条件。`);
        });
      case "whitelist-add":
        return sendCommand(record, (key) => ctx.actions.upsertK1Whitelist(target, record.note!, reason, record.expireText!, key),
          () => reloadAfter("已加入允许名单", "已加入允许名单，但页面刷新失败；请点「重新加载」核对"));
      case "whitelist-remove":
        return sendCommand(record, (key) => ctx.actions.disableK1Whitelist(target, reason, key),
          () => reloadAfter("已从允许名单移除", "已从允许名单移除，但页面刷新失败；请点「重新加载」核对"));
    }
  };

  /** 按原操作重试：同命令号、同内容、同理由。只有成功才解除，被明确拒绝后才给「解除待确认」。 */
  const retryPending = async (record: K1PendingCommand) => {
    // 到期和读不到记录都不是结果，不解除，也不重发（OP-96）。解除只在重试被后端明确拒绝之后。
    if (retryBlocked(record)) {
      syncPending();
      return;
    }
    // 要在 list() 之前查：list() 会从内存副本恢复已删除的记录，那样就成了换号重发。
    if (!pendingCommands.isDurablyStored(record.fingerprint, record.commandKey)) {
      setPendingNotes((current) => ({ ...current, [record.fingerprint]: "浏览器里读不到这条记录，这次没有重发。请到操作记录与审批核对。" }));
      return;
    }
    setRetrying(record.fingerprint);
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    setPendingNotes((current) => ({ ...current, [record.fingerprint]: "" }));
    try {
      await runRecord(record);
    } catch (cause) {
      setPendingNotes((current) => ({ ...current, [record.fingerprint]: `重试被拒绝：${errorText(cause)} 这说明不了原操作的结果，原操作继续保留。` }));
      setRetryRejected((current) => [...current, record.commandKey]);
    } finally {
      setRetrying("");
    }
  };

  const canQueryProposal = reach("/platform/audit", "platform_a2_read");
  /** 重试要的权限和正常入口一样，不能比入口宽（OP-93、OP-123）。 */
  const mayRetry = (record: K1PendingCommand) => record.kind === "cluster"
    ? { flag: canFlag, freeze: canFreeze, release: canRelease, clear: canClear }[record.clusterAction!]
    : record.kind === "release-param" || record.kind === "entry" ? canRelease : canWrite;
  /** 现在不能重试的原因。处置查得到回执，明确查不到才能重发；查询失败不算查不到（OP-95 甲档）。其他写入没有查询接口，走乙档。 */
  const retryBlocked = (record: K1PendingCommand) => record.expiresAt <= Date.now() ? EXPIRED_TEXT
    : !mayRetry(record) ? "这个账号没有这项权限，不能重试，请有权限的同事核对。"
      : record.kind === "cluster" && canQueryProposal && !proposalNotFound.includes(record.commandKey) ? "先查询原提案，明确查不到才能重试。"
        : undefined;

  /** 处置走审批单，按命令号查得到。查到就有了结果，可以解除；查不到说明不了没提交，继续保留（OP-93、OP-95）。 */
  const checkPending = async (record: K1PendingCommand) => {
    setChecking(record.fingerprint);
    setPendingNotes((current) => ({ ...current, [record.fingerprint]: "" }));
    try {
      const original = await fetchA2ProposalByKey(record.commandKey);
      if (!original) {
        setProposalNotFound((current) => [...current, record.commandKey]);
        setPendingNotes((current) => ({ ...current, [record.fingerprint]: "暂未查到原提案，结果仍待核实。" }));
        return;
      }
      pendingCommands.forget(record.fingerprint, record.commandKey);
      syncPending();
      ctx.toast(`查到原提案，${PROPOSAL_STATUS[original.status]}。结果到「操作记录与审批」看。`);
    } catch (cause) {
      setPendingNotes((current) => ({ ...current, [record.fingerprint]: `查询没有成功：${errorText(cause)} 原操作继续保留。` }));
    } finally {
      setChecking("");
    }
  };

  /** 人核实过原操作的结果才解除。只放开本页的锁，不发请求，不写操作记录。 */
  const releasePending = (record: K1PendingCommand) => {
    pendingCommands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    ctx.toast("已解除待确认，可以重新处理");
  };

  const pendingBlocks = new Set(pending.map((record) => `${PENDING_GROUP[record.kind]}:${record.target}`));
  /** 现在不能动的原因，写给人看（OP-126）。依赖最新数据的动作在读取时也等一下（ST-32）。 */
  const blockedBy = (group: string, target: string, loading = ctx.contentLoading) =>
    pendingBlocks.has(`${group}:${target}`) ? "有结果未确认的操作，先到页面上方处理" : loading ? "正在读取最新数据" : undefined;

  /** 已冻结组里账户是冻结状态是应该的，不算异常。 */
  const expectedFrozen = (c: K1Cluster, n: K1Cluster["nodes"][number]) => c.status === "frozen" && /FROZEN/i.test(n[5]);
  const nodeList = (nodes: K1Cluster["nodes"]) => nodes.map((n) => `${n[0]} ${accountStatusLabel(n[5])}`).join("、");
  const accountIssues = (c: K1Cluster) => nodeList(c.nodes.filter((n) => (isRestrictedStatus(n[5]) || isUnknownStatus(n[5])) && !expectedFrozen(c, n)));

  const clusterFacts = (c: K1Cluster, { scope, changed, accounts, restores, money, coverage }: { scope?: ReactNode; changed?: string; accounts?: ReactNode; restores?: boolean; money?: ReactNode; coverage?: boolean } = {}) => {
    // 解除只恢复因这组冻结的账户，封禁、受限的不动（restoreUsersFrozenBySource）。
    const notRestored = restores ? nodeList(c.nodes.filter((n) => isRestrictedStatus(n[5]) && !expectedFrozen(c, n))) : "";
    const issues = restores ? nodeList(c.nodes.filter((n) => isUnknownStatus(n[5]))) : accountIssues(c);
    return (
      <Facts>
        {coverage && <Fact k="覆盖率门槛" tone="warn">{DISPOSITION_COVERAGE_GATE}</Fact>}
        {/* 这次真的会动到账户时，账户数是这个框的关键数字（VS-102）。 */}
        {scope && <Fact k="涉及账户" lead unit="个">{c.n}</Fact>}
        <Fact k="账户组">{c.id}</Fact>
        {changed && <Fact k="别人改了">{changed}</Fact>}
        <Fact k="依据">{c.layerLabel} · {c.key} · 关联程度 {c.strength.toFixed(2)}</Fact>
        <Fact k="当前状态">{CLUSTER_ST[c.status][0]}</Fact>
        {scope ? <Fact k="账户清单">{scope}</Fact> : <Fact k="涉及账户">{c.n} 个</Fact>}
        {accounts && <Fact k="账户冻结">{accounts}</Fact>}
        {notRestored && <Fact k="不会恢复">{notRestored}</Fact>}
        {issues && <Fact k="账户状态异常">{issues}</Fact>}
        {money && <Fact k="资金影响" tone="warn">{money}</Fact>}
      </Facts>
    );
  };

  const clusterRecord = (c: K1Cluster, clusterAction: K1ClusterAction, label: string, reason: string): K1PendingExtra =>
    ({ kind: "cluster", target: c.id, label, operator, reason, clusterAction, clusterStatus: c.status, version: c.version });

  /** 这次会动到的全部账户。读不到的也算在内，写明。 */
  const scopeText = (c: K1Cluster, verb: string) => {
    const codes = c.nodes.map((node) => node[0]).join("、");
    const missing = c.n - c.nodes.length;
    return missing > 0 ? `已读到 ${c.nodes.length} 个：${codes}。还有 ${missing} 个读不到，批准后也会一起${verb}。` : codes;
  };

  /** 四种处置的确认框内容，changed 是读取最新后别人改了什么。 */
  const clusterConfirm = (action: K1ClusterAction, c: K1Cluster, changed?: string): Omit<ActionConfirmReq, "run"> & { label: string } => {
    const common = { effect: APPROVAL_EFFECT, confirmLabel: "提交审批", reasonPlaceholder: RISK_REASON_PLACEHOLDER, reasonMax: 200 };
    if (action === "flag") {
      const label = `标记可疑账户组 · ${c.id}`;
      return { ...common, label, action: label, title: "标记可疑账户组", briefKind: "judgment",
        detail: "只标记为可疑，账户不冻结，提现限制和新增收益的处理都不变，保留操作记录。",
        statedBrief: { impact: "批准后这组变成可疑，账户不冻结，提现限制和新增收益的处理都不变。", check: "确认对象、证据和结论，理由写清依据或工单号。" },
        facts: clusterFacts(c, { changed }) };
    }
    if (action === "freeze") {
      const label = `批量冻结关联账户 · ${c.id}`;
      const missing = c.n - c.nodes.length;
      return { ...common, label, action: label, title: "批量冻结关联账户", briefKind: "security",
        detail: `冻结这组里状态正常的账户。请填写原因，会记入操作记录。`,
        statedBrief: {
          impact: "批准后这组里状态正常的账户全部冻结，退出登录，待处理的提现暂停。",
          check: missing > 0 ? `这里读不到其中 ${missing} 个账户，核对不全。核对已读到的账户和证据，理由写清依据或工单号。` : "核对账户清单和证据，理由写清依据或工单号。",
        },
        facts: clusterFacts(c, { changed, scope: scopeText(c, "冻结"), accounts: "批准后状态正常的账户冻结并退出登录，待处理的提现暂停。" }) };
    }
    if (action === "release") {
      const label = `解除误判 · ${c.id}`;
      const frozen = c.status === "frozen";
      return { ...common, label, action: label, title: "解除误判", briefKind: "funds",
        effect: K1_DISPOSITION_EFFECT,
        detail: "解除后，这些账户可能有更多收益可以提现。请核对影响并写明原因。",
        statedBrief: {
          impact: `批准后${frozen ? "解除因这组冻结的账户，" : ""}这组不再按风险状态限制提现和新增收益，改按同组账号数判断。`,
          check: "核对账户、证据和触发的风险规则。",
        },
        facts: clusterFacts(c, { changed, scope: scopeText(c, frozen ? "解除冻结" : "解除限制"), money: "可提现的钱可能变多", coverage: true, restores: frozen,
          accounts: frozen ? "批准后解除因这组冻结的账户，恢复它们因此暂停的提现。因别的原因冻结的不动。" : undefined }) };
    }
    const label = `判定为正常 · ${c.id}`;
    return { ...common, label, action: label, title: "判定为正常", briefKind: "judgment",
      effect: K1_DISPOSITION_EFFECT,
      detail: "这组不再算监控中，提现和新增收益改按同组账号数判断。请填写判定依据。",
      statedBrief: { impact: "批准后这组不再算监控中，提现和新增收益改按同组账号数判断。", check: "核对账户和证据。" },
      facts: clusterFacts(c, { changed, money: "可提现的钱可能变多", coverage: true }) };
  };

  const clusterChange = (before: K1Cluster, latest: K1Cluster) => [
    before.status !== latest.status ? `状态 ${CLUSTER_ST[before.status][0]} → ${CLUSTER_ST[latest.status][0]}` : "",
    (before.reviewNote ?? "") !== (latest.reviewNote ?? "") ? `复审备注改成「${latest.reviewNote ?? ""}」` : "",
  ].filter(Boolean).join("，") || "内容有更新，下面已是最新";

  const noLongerAllowed = (latest: K1Cluster | undefined) =>
    latest ? `这组现在是「${CLUSTER_ST[latest.status][0]}」，这项操作不能再做。关掉这个框，按最新状态处理。` : "这组已不在当前列表里。关掉这个框，刷新后再处理。";

  /** 处置的确认框。版本冲突时框不关，写明别人改过；读最新后按最新内容重开，理由清空（OP-97）。 */
  const openClusterConfirm = (action: K1ClusterAction, c: K1Cluster, changed?: string, formKey = 0) => {
    const { label, ...req } = clusterConfirm(action, c, changed);
    const readLatest = async () => {
      const latest = (await ctx.reloadKRisk({ multiAccount: pageQuery }))?.clusters.records.find((cluster) => cluster.id === c.id);
      if (latest && CLUSTER_OPS[action].from.includes(latest.status)) openClusterConfirm(action, latest, clusterChange(c, latest), formKey + 1);
      else ctx.openActionConfirm({ ...(latest ? clusterConfirm(action, latest, clusterChange(c, latest)) : req), formKey, blockedReason: noLongerAllowed(latest), run: () => undefined });
    };
    ctx.openActionConfirm({ ...req, formKey,
      run: async (reason) => {
        try {
          await runRecord(clusterRecord(c, action, label, reason));
        } catch (cause) {
          if (isVersionConflict(cause)) ctx.openActionConfirm({ ...req, formKey, blockedReason: <ConflictBar onRead={readLatest} />, run: () => undefined });
          throw cause;
        }
      },
    });
  };

  const adjParam = (p: KRiskParam) => {
    setDraftError(null);
    if (p.key === "linkWeight") {
      setWeightDraft({ param: p, ...parseLinkWeight(p.value), reason: "", bad: {} });
      return;
    }
    if (!PARAM_LIMITS[p.key]) {
      ctx.toast(`这个参数不能在这里修改`);
      return;
    }
    setParamDraft({ param: p, value: "", reason: "" });
  };

  // 数值新值留空，选项类默认选当前值（OP-19）。
  const adjReleaseParam = (p: KRiskParam) => {
    setDraftError(null);
    setReleaseDraft({ param: p, value: K1_RELEASE_PARAM_LIMITS[p.key] ? "" : p.value, reason: "" });
  };

  const releaseProtectedEntry = (entry: K1ProtectedEntry) => {
    ctx.openActionConfirm({ briefKind: "funds",
      action: `人工放行收益 · ${entry.entryNo}`,
      title: "人工放行收益",
      detail: `这笔收益现在是「${entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"}」，放行后解除这笔的待审或锁定状态。`,
      amplifies: true,
      confirmTone: "danger",
      statedBrief: { impact: "立即解除这笔收益的待审或锁定状态，记入操作记录。", check: "核对用户、金额和所属账户组。提交时会先检查兑付覆盖率。" },
      coverageLead: "这笔钱放行后不再锁住",
      effect: <>{IMMEDIATE_EFFECT}<IrreversibleTag /></>,
      confirmLabel: "立即放行",
      reasonPlaceholder: RISK_REASON_PLACEHOLDER,
      facts: <Facts>
        <Fact k="金额" lead tone="role-1" unit={nexGridBrandText(entry.asset)}>{amountText(entry.amount)}</Fact>
        <Fact k="收益记录">{entry.entryNo}</Fact>
        <Fact k="用户">U{entry.userId}</Fact>
        <Fact k="账户组">{entry.clusterId}</Fact>
        <Fact k="前后状态"><Change from={entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"} to="已放行" /></Fact>
        <Fact k="提现">放行不解除账户组限制。账户组待判定、可疑、已冻结或人数达到锁定起点时仍不能提现。</Fact>
      </Facts>,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason) => runRecord({ kind: "entry", target: entry.entryNo, label: `人工放行收益 · ${entry.entryNo}`, operator, reason }),
    });
  };

  const releaseParamDisplay = (p: KRiskParam): string => {
    if (p.key === "releaseMode") return RELEASE_MODE_LABELS[p.value] ?? p.value;
    if (p.key === "freeSlotRequiresBinding") return RELEASE_BOOL_LABELS[p.value] ?? p.value;
    return p.value;
  };

  /** 修改框提交：明确失败留在框里写原因，输入不动；成功或转成待确认才关（OP-34、OP-82、OP-97）。 */
  const submitDraft = async (kind: "param" | "weight" | "whitelist" | "release" | "note", record: K1PendingExtra, close: () => void) => {
    if (draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting(kind);
    setDraftError(null);
    try {
      await runRecord(record);
      close();
    } catch (error) {
      // 没权限再填也没用：提示、关框、重读权限（OP-81、OP-132）。
      if (isPermissionDenied(error)) {
        announcePermissionDenied();
        close();
        return;
      }
      // 只有带版本号的写入才会被别人改过（附录 D）。
      const conflict = (kind === "release" || kind === "note") && isVersionConflict(error);
      setDraftError({ text: conflict ? CONFLICT_TEXT : confirmedK1FailureText(error), conflict });
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
  };

  const saveParamDraft = () => {
    if (!paramDraft) return;
    const name = riskParamName(paramDraft.param);
    void submitDraft("param", { kind: "param", target: paramDraft.param.key, label: `调整风险判断标准 · ${name}`, name, operator, reason: paramDraft.reason.trim(), value: paramDraft.value }, () => setParamDraft(null));
  };

  const saveWeightDraft = () => {
    if (!weightDraft) return;
    const name = riskParamName(weightDraft.param);
    void submitDraft("weight", { kind: "param", target: weightDraft.param.key, label: `调整关联权重 · ${name}`, name, operator, reason: weightDraft.reason.trim(), value: linkWeightValue(weightDraft) }, () => setWeightDraft(null));
  };

  const saveReleaseDraft = () => {
    if (!releaseDraft) return;
    const name = releaseParamName(releaseDraft.param);
    void submitDraft("release", { kind: "release-param", target: releaseDraft.param.key, label: `调整收益审核规则 · ${name}`, name, operator, reason: releaseDraft.reason.trim(), value: releaseDraft.value, version: releaseDraft.param.version }, () => setReleaseDraft(null));
  };

  /** 别人改过：读最新值，新值留着，理由清空，在最新版本上重新核对（OP-97）。读到之前冲突一直留着，保存不可用。 */
  const readLatestReleaseParam = async () => {
    if (!releaseDraft) return;
    setReadingLatest(true);
    try {
      const latest = (await ctx.reloadKRisk({ multiAccount: pageQuery }))?.releaseParams.find((p) => p.key === releaseDraft.param.key);
      if (!latest) {
        setDraftError({ text: "读取最新失败，稍后再试。已填写的内容还在。", conflict: true });
        return;
      }
      setReleaseDraft((current) => current ? { ...current, param: latest, reason: "" } : current);
      setDraftError(null);
    } catch {
      setDraftError({ text: "读取最新失败，稍后再试。已填写的内容还在。", conflict: true });
    } finally {
      setReadingLatest(false);
    }
  };

  const saveNoteDraft = () => {
    if (!noteDraft) return;
    const { cluster } = noteDraft;
    void submitDraft("note", { kind: "note", target: cluster.id, label: `人工复审备注 · ${cluster.id}`, operator, reason: noteDraft.reason.trim(), version: cluster.version }, () => setNoteDraft(null));
  };

  /** 备注是自己写的内容，留着；其余换成最新，在最新版本上再保存（OP-97）。 */
  const readLatestNote = async () => {
    if (!noteDraft) return;
    setReadingLatest(true);
    try {
      const latest = (await ctx.reloadKRisk({ multiAccount: pageQuery }))?.clusters.records.find((cluster) => cluster.id === noteDraft.cluster.id);
      if (!latest) {
        setDraftError({ text: noLongerAllowed(latest), conflict: true });
        return;
      }
      setNoteDraft((current) => current ? { ...current, cluster: latest, changed: clusterChange(current.cluster, latest) } : current);
      setDraftError(null);
    } catch {
      setDraftError({ text: "读取最新失败，稍后再试。已填写的内容还在。", conflict: true });
    } finally {
      setReadingLatest(false);
    }
  };

  const saveWhitelistDraft = () => {
    if (!whitelistDraft) return;
    const cidr = whitelistDraft.cidr.trim();
    void submitDraft("whitelist", { kind: "whitelist-add", target: cidr, label: `添加 IP 允许名单 · ${cidr}`, operator, reason: whitelistDraft.reason.trim(), note: whitelistDraft.note.trim(), expireText: whitelistDraft.expireText }, () => setWhitelistDraft(null));
  };

  const addWl = () => {
    setDraftError(null);
    setWhitelistDraft({ cidr: "", note: "", expireText: "", reason: "" });
  };

  const rmWl = (cidr: string) => {
    ctx.openActionConfirm({ briefKind: "config",
      action: `移出允许名单 · ${cidr}`,
      title: "移出允许名单",
      facts: <Facts><Fact k="网段"><span data-mono="">{cidr}</span></Fact></Facts>,
      detail: "移除后该网段恢复同 IP 多账户检测。",
      statedBrief: { impact: "这个网段恢复按 IP 检测。下次检查可能重新成组，新组不能提现、新增收益锁定；账户不会自动冻结。移除属于收紧，不受新增名单的覆盖率门槛阻断。", check: "确认网段和授权来源，理由写清工单号和处理依据。" },
      effect: IMMEDIATE_EFFECT,
      confirmLabel: "立即移除",
      reasonPlaceholder: "写清调整原因和依据",
      reasonMax: 200,
      run: (reason) => runRecord({ kind: "whitelist-remove", target: cidr, label: `移出允许名单 · ${cidr}`, operator, reason }),
    });
  };

  const overviewFailed = Boolean(ctx.contentError);
  const overviewReady = !overviewFailed && overview ? overview : null;
  const pendingEntries = protectedEntries.filter((entry) => entry.bucket === "pending_review");
  const lockedEntries = protectedEntries.length - pendingEntries.length;
  const entriesAtLimit = protectedEntries.length >= PROTECTED_ENTRY_LIMIT;
  const anyWrite = canWrite || canFlag || canFreeze || canRelease || canClear;
  const filtered = layer !== "all" || clusterStatus !== "all" || clusterSort !== "strength_desc";
  const clearFilters = () => {
    setLayer("all");
    setClusterStatusFilter("all");
    setClusterSort("strength_desc");
    setClusterPage(1);
  };
  const sections: SectionNavItem[] = [
    { id: "risk", label: "风险判断标准" },
    { id: "earnings", label: "收益审核规则", alert: Boolean(overviewReady) && overviewReady?.releaseParams.length === 0 },
    { id: "whitelist", label: "IP 允许名单" },
  ];
  const nav = useSectionNav(sections, { ready: tab === "rules" && Boolean(overviewReady) });
  const reloadOverview = () => void ctx.reloadKRisk({ multiAccount: pageQuery }).catch(() => undefined);

  /** 一组现在能做的处置，行内和选中区共用。止损的在前，放宽的在后。 */
  const clusterActions = (c: K1Cluster) => {
    const actions: { key: string; label: string; loosen: boolean; blocked?: string; run: () => void }[] = [];
    if (focusBlocksSelection) return actions;
    const blocked = blockedBy("cluster", c.id);
    if (c.status === "detected" && canFlag) actions.push({ key: "flag", label: "标记为可疑", loosen: false, blocked, run: () => openClusterConfirm("flag", c) });
    if (c.status === "flagged" && canFreeze) actions.push({ key: "freeze", label: "批量冻结", loosen: false, blocked, run: () => openClusterConfirm("freeze", c) });
    if (c.status === "detected" && canClear) actions.push({ key: "clear", label: "判定为正常", loosen: true, blocked, run: () => openClusterConfirm("clear", c) });
    if ((c.status === "frozen" || c.status === "flagged") && canRelease) actions.push({ key: "release", label: "解除误判", loosen: true, blocked, run: () => openClusterConfirm("release", c) });
    return actions;
  };

  const userRef = (code: string) => {
    const href = `/users/search/${encodeURIComponent(code)}`;
    return reach(href, "user_c1_read")
      ? <Link className="rd-link" href={`${href}?returnTo=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`}>{code}</Link>
      : code;
  };

  // 结论只用接口的统计：监控中减去已冻结，就是待判定和可疑的组（DP-11）。
  const activeCount = Number(stats.activeClusters ?? 0);
  const frozenCount = Number(stats.frozenClusters ?? 0);
  const highCount = Number(stats.highClusters ?? 0);
  const openCount = activeCount - frozenCount;
  const conclusion = !statKnown("activeClusters") || !statKnown("frozenClusters")
    ? <Conclusion state="unknown" hint="统计没有读到，先看下面的列表。">账户组数量暂时读不到</Conclusion>
    : openCount > 0
    ? <Conclusion state="warn" hint="点下面一行看证据，再决定标记、冻结或判定为正常。">有 <b>{openCount}</b> 组账户等判定{highCount > 0 ? `，${highCount} 组达到建议冻结线` : ""}</Conclusion>
    : frozenCount > 0
      ? <Conclusion state="neutral" hint="已冻结的组核实是误判后可以解除。">没有等判定的账户组，{frozenCount} 组已冻结</Conclusion>
      : <Conclusion state="ok" explain="这是系统检查的结果，不是读取失败。系统约每分钟检查一次，目前没有检出。">现在没有风险账户组，不用处理</Conclusion>;

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
      impact = { label: "锁定奖励", tone: "danger", desc: "账户组处于待判定、可疑或已冻结：这组账户不能提现，新增收益直接记为锁定奖励。收益锁定与账户冻结是两种处理。" };
    } else if (pendingFrom && freezeFrom) {
      impact = c.n >= Number(freezeFrom)
        ? { label: "锁定奖励", tone: "danger", desc: `同组 ${c.n} 个账号已达到收益锁定起点 ${freezeFrom}：这组账户不能提现，新增收益直接记为锁定奖励。` }
        : c.n >= Number(pendingFrom)
          ? { label: "须审核收益", tone: "warn", desc: `同组 ${c.n} 个账号已达到收益审核起点 ${pendingFrom}，新增收益须先人工审核。` }
          : { label: "可提现收益", tone: "ok", desc: "同组账号数未达到收益审核起点，新增收益记为可提现收益。" };
    }
    const ruleText = slots && pendingFrom && freezeFrom
      ? `当前规则：正常手机号名额为 ${slots} 个。账户组待判定、可疑、已冻结，或同组账号数达到 ${freezeFrom} 时，这组账户不能提现，新增收益锁定；其余情况下，账号数达到 ${pendingFrom} 时须审核，未达到时可提现。`
      : "收益审核规则暂时加载不出来。";
    const restricted = c.nodes.filter((n) => isRestrictedStatus(n[5]) && !expectedFrozen(c, n)).length;
    const unknown = c.nodes.filter((n) => isUnknownStatus(n[5])).length;
    const shown = Math.min(c.nodes.length, 8);
    const hidden = Math.max(c.n - shown, 0);
    const openGifts = c.gifts.filter((g) => !giftHandled(g[2])).length;
    const issues = accountIssues(c);
    const missing = c.n - c.nodes.length;
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
    if (issues) rows.push({ label: "账户状态", value: [restricted && `${restricted} 个已受限`, unknown && `${unknown} 个状态未知`].filter(Boolean).join("，"), state: restricted ? "danger" : "warn", reason: issues });
    if (c.reviewNote) rows.push({ label: "复审备注", value: c.reviewNote });
    return (
      <Panel id={DETAIL_ID} title={`账户组 ${c.id}`} sub={`${c.layerLabel} · ${c.n} 个账户`} icon={Users} tone="role-3" actions={<StatusTag tone={statusTone} explain={statusExplain}>{statusLabel}</StatusTag>}>
        <div className="rd-stack">
          {(actions.length > 0 || canWrite) && (
            <Decision
              explain={actions.length > 0 ? "处置要提交审批，超级管理员批准后才生效，批准前这组不变。" : undefined}
              others={<>
                {/* 「判定为正常」「解除误判」是判断不是止损，用次按钮：红描边只给不可撤销或直接动钱的入口（VS-25），放宽的资金风险在确认框里按覆盖率提示。 */}
                {loosen && <Button disabledReason={loosen.blocked} onClick={loosen.run}>{loosen.label}</Button>}
                {canWrite && <Button disabledReason={blockedBy("cluster", c.id)} onClick={() => { setDraftError(null); setNoteDraft({ cluster: c, reason: "" }); }}>人工复审备注</Button>}
              </>}
              primary={primary && <Button variant="primary" disabledReason={primary.blocked} onClick={primary.run}>{primary.label}</Button>}
            />
          )}
          <JudgmentPoints rows={rows} />
          <div className="rd-stack">
            <Fold inset icon={Network} tone="risk" title="关系图" summary={c.edges.length ? `${shown} 个账户，${c.edges.length} 条关联${hidden ? `，${hidden} 个未画出` : ""}` : "暂无可展示关联边"}>
              <ClusterGraph c={c} />
            </Fold>
            <Fold inset icon={Users} tone="users" title="账户明细"
              alert={restricted > 0 || unknown > 0}
              alertTone={restricted ? "danger" : "warn"}
              summary={`${c.nodes.length} 个账户${restricted ? `，${restricted} 个已受限` : ""}${unknown ? `，${unknown} 个状态未知` : ""}${missing > 0 ? `，${missing} 个读不到` : ""}`}>
              <Table label={`关联账户组 ${c.id} 的账户`}>
                <thead><tr><Th>账户 · 注册时间</Th><Th>邀请人 · 新人礼</Th><Th align="right">累计入金 · 状态</Th></tr></thead>
                <tbody>
                  {c.nodes.map((n) => (
                    <Tr key={n[0]}>
                      <Td><Cell mono main={userRef(n[0])} sub={`${formatBusinessTimeFull(n[1], "—")}（${businessZone().label}）`} /></Td>
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

  const paramAction = (name: string, blocked: string | undefined, onClick: () => void) => (describedBy: string | undefined) =>
    <Button size="sm" aria-label={`调整${name}`} aria-describedby={describedBy} disabledReason={blocked} onClick={onClick}>调整</Button>;

  return (
    <>
      <PageHeader pageId="K1" title="多账户风险排查" summary="找出可能是同一人的账户，判断后处置。"
        meta={<span className="rd-toolbar">
          <span>{readAt ? `账户组和规则 ${readAt} 读取（${businessZone().label}），` : ""}不自动刷新</span>
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

      {pending.map((record) => {
        const blocked = retryBlocked(record);
        const expired = record.expiresAt <= Date.now();
        return (
        <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} action={<>
          {record.kind === "cluster" && canQueryProposal && <Button size="sm" loading={checking === record.fingerprint} disabled={Boolean(retrying || checking)} onClick={() => void checkPending(record)}>查询原提案</Button>}
          {!expired && <Button size="sm" loading={retrying === record.fingerprint} disabled={Boolean(retrying || checking)} disabledReason={blocked} onClick={() => void retryPending(record)}>按原操作重试</Button>}
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={Boolean(retrying || checking)} onClick={() => setReleasing(record)}>解除待确认</Button>}
        </>}>
          {formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，{expired ? EXPIRED_TEXT : <>{RECOVERY_HINT[record.kind]}{blocked ?? "重发原内容，已成功的不会重复执行。"}</>}
          {reach("/platform/audit", "platform_a2_read") && <> <Link className="rd-link" href={`/platform/audit?domain=K&object=${encodeURIComponent(record.target)}`}>到操作记录核查</Link></>}
          {" "}<Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 操作人 ${record.operator} ｜ 理由 ${record.reason}`} />
          {pendingNotes[record.fingerprint] && !(expired && pendingNotes[record.fingerprint].includes("重试")) && <div>{pendingNotes[record.fingerprint]}</div>}
        </Notice>
        );
      })}

      {tab !== "earnings" && pendingEntries.length > 0 && (
        <Notice tone="warn" title={entriesAtLimit ? `已读到的 ${PROTECTED_ENTRY_LIMIT} 条里有 ${pendingEntries.length} 笔等人工审核，实际可能更多` : `${pendingEntries.length} 笔收益等人工审核`} action={<Button size="sm" onClick={() => setTab("earnings")}>{canRelease ? "去处理" : "去查看"}</Button>}>
          这些收益要人工放行，不会到期自动放行。
        </Notice>
      )}

      <PageTabs ids={tabIds} label="多账户风险排查内容" value={tab} onChange={setTab} items={[
        { value: "accounts", label: "账户组排查" },
        { value: "earnings", label: "收益审核", count: pendingEntries.length || undefined },
        { value: "rules", label: "规则与名单" },
      ]} />

      <div {...tabIds.panel(tab)} className="rd-tab-pane">
      {tab === "accounts" && (
        <>
          {overviewReady && conclusion}
          {overviewReady && (
          <StatBand label="关联账户组概况">
            <Stat tone="role-3" icon={Users} label="监控中的关联账户组" value={statText("activeClusters")} unit="组" sub={`涉及 ${statText("flaggedAccounts")} 个账户`}
              explain="全部账户组里，还没判定为正常、也没解除的组。不随下面的筛选变。" />
            <Stat icon={ShieldAlert} iconTone={Number(stats.highClusters) > 0 ? "warn" : "role-other"} label="高风险账户组" value={statText("highClusters")} unit="组" sub={`建议冻结线 ${formatThreshold(freezeSuggestThreshold)}`}
              explain="待判定或可疑、关联程度达到建议冻结线的组。这只是建议，不会自动冻结。" />
            <Stat tone={Number(stats.frozenClusters) > 0 ? "warn" : undefined} icon={Snowflake} label="已冻结账户组" value={statText("frozenClusters")} unit="组" sub={`共 ${statText("frozenAccounts")} 个账户`} />
            <Stat tone="role-1" icon={Gift} label="新人礼拦截" value={statKnown("giftBlockedUsd") ? `$${statText("giftBlockedUsd")}` : "—"} sub={statKnown("giftBlockedCnt") ? `${statText("giftBlockedCnt")} 笔重复领取被拦下` : "数据尚未接入，不能判定为 0"}
              explain={statKnown("giftBlockedUsd") ? undefined : "后端还没有提供这项统计。其他三个数字是真实读取的，不受影响。"} />
          </StatBand>
          )}

          <FilterBar
            scope={<Segments label="关联依据筛选" value={layer} onChange={(value) => { setLayer(value); setClusterPage(1); }} items={[
              { value: "all", label: "全部" }, { value: "ip", label: "IP" }, { value: "device", label: "设备指纹" }, { value: "payment", label: "支付工具" },
            ]} />}
            onClear={clearFilters} canClear={filtered}
            sort={<FilterField><span className="rd-toolbar"><span className="rd-toolbar-note">排序</span><Select aria-label="关联账户组排序" value={clusterSort} onChange={(value) => { setClusterSort(value as K1ClusterSort); setClusterPage(1); }} options={[
              { value: "strength_desc", label: "关联程度" }, { value: "account_desc", label: "关联账户数" },
            ]} /></span></FilterField>}>
            <FilterField><Select aria-label="关联账户组状态" value={clusterStatus} onChange={(value) => { setClusterStatusFilter(value as K1ClusterStatusFilter); setClusterPage(1); }} options={[
              { value: "all", label: "全部状态" }, { value: "detected", label: "待判定" }, { value: "flagged", label: "可疑" }, { value: "frozen", label: "已冻结" }, { value: "released", label: "已解除" }, { value: "cleared", label: "正常" },
            ]} /></FilterField>
          </FilterBar>

          {overviewReady ? <div className={clusters.length ? "rd-split" : undefined} data-detail={clusters.length ? "" : undefined}>
            <Panel title="可能属于同一人的账户" explain={clusters.length ? "点一行看证据和处置" : undefined} icon={Network} tone="role-3" flush>
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
                  {rowsStale && <TableLoading columns={5} rows={3} />}
                  {!rowsStale && clusters.map((c) => {
                    const [statusLabel, statusTone, statusExplain] = CLUSTER_ST[c.status];
                    const [first, ...rest] = clusterActions(c);
                    return (
                      <Tr key={c.id} selected={c.id === cur?.id} aria-label={focusBlocksSelection ? undefined : `查看关联账户组 ${c.id} 详情`} onOpen={focusBlocksSelection ? undefined : () => { setSelId(c.id); revealDetail(); }}>
                        <Td><Cell mono main={c.key} sub={`${c.layerLabel} · ${c.span}`} title={`${c.key} · ${c.layerLabel} · ${c.span}`} /></Td>
                        <Td align="right"><Cell num main={c.n} /></Td>
                        <Td><Cell main={<InlineMeter value={c.strength} text={c.strength.toFixed(2)} tone={strengthTone(c.strength, freezeSuggestThreshold)} />} sub={isHot(c) ? <StatusTag tone="danger" icon={ShieldAlert}>建议冻结</StatusTag> : undefined} /></Td>
                        <Td><StatusTag tone={statusTone} explain={statusExplain}>{statusLabel}</StatusTag></Td>
                        <Td align="right">
                          {first && (
                            <span className="rd-row-actions">
                              <Button size="sm" disabledReason={first.blocked} onClick={first.run}>{first.label}</Button>
                              {rest.length > 0 && <MoreMenu label={`${c.id} 的更多处置`} items={rest.map((action) => ({ key: action.key, label: action.label, disabledReason: action.blocked, onSelect: action.run }))} />}
                            </span>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                  {!rowsStale && !clusters.length && <TableMessage columns={5} role="status">{layer !== "all" || clusterStatus !== "all" ? "当前条件下没有关联账户组。可调整筛选条件后重试。" : "现在没有风险账户组。同一 IP、设备或支付工具下的账户超过上限时，系统会列在这里。"}</TableMessage>}
                </tbody>
              </Table>
              {clusterPageData.total > 0 && <Pager label="关联账户组列表" total={clusterPageData.total} page={clusterPage} pageSize={clusterPageSize} sizes={CLUSTER_PAGE_SIZE_OPTIONS} loading={ctx.contentLoading}
                onPage={setClusterPage} onPageSize={(next) => { setClusterPageSize(next); setClusterPage(1); }} />}
            </Panel>
            {cur && !rowsStale ? selectedPanel(cur) : clusters.length > 0 && <BlockState state="loading" title={rowsStale ? "正在读取这些条件下的账户组" : "定位完成后显示这组的详情"} />}
          </div> : overviewState}
        </>
      )}

      {tab === "earnings" && (
        <Panel data-proof="k1-protected-earnings" title="待审核或已锁定的收益" icon={Coins} tone="role-1" flush
          sub={[protectedEntries.length ? `待审核 ${pendingEntries.length} 笔 · 已锁定 ${lockedEntries} 笔${entriesAtLimit ? ` · 最多显示 ${PROTECTED_ENTRY_LIMIT} 条` : ""}` : "", earningsReadAt ? `${earningsReadAt} 读取` : ""].filter(Boolean).join(" · ") || undefined}
          explain="人工放行需要相应权限、操作理由，并留下操作记录。"
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
                    <Td><Cell mono full main={entry.entryNo} sub={`${formatBusinessTimeFull(entry.createdAt, "—")}（${businessZone().label}）`} /></Td>
                    <Td><Cell mono main={`U${entry.userId}`} sub={entry.clusterId} /></Td>
                    <Td><Cell main={({ TRIAL: "试用收益", DEVICE: "设备收益", TASK: "任务奖励", COMMISSION: "团队奖励", REFERRAL: "邀请奖励", WELCOME: "新人奖励" } as Record<string, string>)[entry.sourceType.toUpperCase()] ?? "来源未知"} sub={<span data-mono>{entry.sourceRef}</span>} /></Td>
                    <Td align="right"><Cell num full main={`${amountText(entry.amount)} ${nexGridBrandText(entry.asset)}`} /></Td>
                    <Td><StatusTag tone={entry.bucket === "bonus_locked" ? "danger" : "warn"} explain={entry.bucket === "bonus_locked" ? "这笔收益被锁定，不能提现。账户组解除后不会自动放行，要人工放行。" : "这笔收益等人工审核，不会到期自动放行。"}>{entry.bucket === "bonus_locked" ? "锁定奖励" : "审核中"}</StatusTag></Td>
                    <Td align="right">{canRelease && <Button size="sm" disabledReason={blockedBy("entry", entry.entryNo, protectedEntriesLoading) ?? (overviewFailed ? "风险数据读取失败，恢复后才能放行" : undefined)} onClick={() => releaseProtectedEntry(entry)}>人工放行</Button>}</Td>
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
        <div className="rd-config-layout">
          <div className="rd-config-grid">
            <div className="rd-config-rail">
              <SectionNav label="本页分组" items={sections} nav={nav} />
            </div>
            <div className="rd-config-groups">
              <Panel id={nav.anchor("risk")} title="风险判断标准" icon={ShieldAlert} tone="role-4"
                explain="决定哪些账户算同一组。成组后这组账户不能提现、新增收益锁定。这页的修改保存后立即生效，不走审批，参数和允许名单一保存就影响用户；只有账户组的四种处置要超级管理员批准。">
                <ConfigList>
                  {params.map((p) => (
                    <ConfigRow key={p.key} name={riskParamName(p)} what={K1_PARAM_HELP[p.key]?.what ?? p.sub} when={K1_PARAM_HELP[p.key]?.when} effect={K1_PARAM_HELP[p.key]?.direction} value={riskValueText(p.key, p.value, p.unit)}
                      action={canWrite ? paramAction(riskParamName(p), blockedBy("param", p.key), () => adjParam(p)) : undefined} />
                  ))}
                </ConfigList>
              </Panel>

              {/* 收益释放参数(SPEC-7 搬回,合并底账 §二#5):与整簇冻结分开的放行细调。 */}
              <Panel id={nav.anchor("earnings")} title="关联账户的收益审核规则" icon={Coins} tone="role-1" explain="决定新增收益怎么处理；人数达到锁定起点的组也不能提现。保存后立即生效，不走审批，一保存就影响用户。">
                {overviewReady.releaseParams.length > 0 ? (
                  <div className="rd-stack" data-proof="k1-risk-release-params">
                    <ConfigList>
                      {overviewReady.releaseParams.map((p) => {
                        // 前后关系卡死时没有别的值可填，不开框（OP-127）。
                        const limits = K1_RELEASE_PARAM_LIMITS[p.key];
                        const range = limits && releaseRange(p.key, limits, overviewReady.releaseParams);
                        const noRoom = range && range.max <= range.min ? `${range.problem}，现在只能是 ${p.value}。${range.next}` : undefined;
                        return (
                          <ConfigRow key={p.key} name={releaseParamName(p)} what={K1_PARAM_HELP[p.key]?.what ?? p.sub} when={K1_PARAM_HELP[p.key]?.when} effect={K1_PARAM_HELP[p.key]?.direction} value={`${releaseParamDisplay(p)}${p.unit && limits ? ` ${p.unit}` : ""}`}
                            sub={canRelease && noRoom ? "现在只有这一个可填" : undefined}
                            action={canRelease && p.adjustable !== false ? paramAction(releaseParamName(p), blockedBy("param", p.key) ?? noRoom, () => adjReleaseParam(p)) : undefined} />
                        );
                      })}
                    </ConfigList>
                    <Fold inset title="处理规则" summary="从上往下判断，满足哪条就按哪条"
                      explain={<>收益锁定不用先冻结账户组，和账户冻结是两种处理。待审核收益<b>不会因等待时间到期自动放行</b>，只能人工放行。前两条同时让这组账户不能提现。放宽审核起点、锁定起点可能增加资金支出，请写明依据。</>}>
                      <KeyValues rows={[
                        { key: "status", label: "1. 账户组待判定、可疑或已冻结", value: "锁定奖励" },
                        { key: "freeze", label: `2. 同组账号数达到 ${overviewReady.releaseParams.find((p) => p.key === "duplicateAccountFreezeFrom")?.value ?? "—"}`, value: "锁定奖励" },
                        { key: "pending", label: `3. 同组账号数达到 ${overviewReady.releaseParams.find((p) => p.key === "duplicateAccountPendingFrom")?.value ?? "—"}`, value: "须审核" },
                        { key: "else", label: "4. 其余情况", value: "可提现" },
                      ]} />
                    </Fold>
                  </div>
                ) : (
                  <BlockState state="error" title="收益审核规则暂时加载不出来，请稍后重试；现在不能调整。" onRetry={reloadOverview} retrying={ctx.contentLoading} />
                )}
              </Panel>

              <Panel id={nav.anchor("whitelist")} title="IP 允许名单" explain="名单内的网段不再按 IP 检测，设备和支付工具照常。只影响后续检测，既有组和成员限制保留，须在「账户组排查」人工判定或解除。新增、重新启用或延长有效期时，保存会检查兑付覆盖率，低于红线或无法读取时不能保存。移除不受这项门槛阻断。" icon={ListChecks} tone="role-2" flush
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
                        <Td align="right">{canWrite && <Button size="sm" disabledReason={blockedBy("cidr", w.cidr)} onClick={() => rmWl(w.cidr)}>移除</Button>}</Td>
                      </Tr>
                    ))}
                    {!whitelist.length && <TableMessage columns={5} role="status">暂无允许名单</TableMessage>}
                  </tbody>
                </Table>
                {whitelistPageData.total > 0 && <Pager label="IP 允许名单" total={whitelistPageData.total} page={whitelistPage} pageSize={whitelistPageSize} sizes={WHITELIST_PAGE_SIZE_OPTIONS} loading={ctx.contentLoading}
                  onPage={setWhitelistPage} onPageSize={(next) => { setWhitelistPageSize(next); setWhitelistPage(1); }} />}
              </Panel>
            </div>
          </div>
        </div>
        </>
      ) : overviewState)}
      </div>

      {paramDraft && (() => {
        const { param, value, reason } = paramDraft;
        const limits = PARAM_LIMITS[param.key];
        const help = K1_PARAM_HELP[param.key];
        const numeric = Number(value);
        const typed = value.trim() !== "";
        const inRange = Number.isFinite(numeric) && numeric >= limits.min && numeric <= limits.max && (!limits.integer || Number.isInteger(numeric));
        const problem = !typed ? "填写新值" : !inRange ? `要填 ${limits.min}–${limits.max} 的${limits.integer ? "整数" : "数字"}` : numeric === Number(param.value) ? "和当前值一样，没有改动" : undefined;
        const update = (patch: Partial<ParamDraft>) => setParamDraft((current) => current ? { ...current, ...patch } : current);
        const busy = draftSubmitting === "param";
        const limitChange = limits.integer && !problem;
        return (
          <DraftModal title={`调整${riskParamName(param)}`} icon={SlidersHorizontal} effect={IMMEDIATE_EFFECT} explain={paramHelpRows(help, param.sub).filter((row) => row.k !== "怎么填")} busy={busy} saveLabel="保存并立即生效" blocked={problem}
            reason={reason} placeholder="写清调整原因和依据" {...draftAttempt} policy={reasonPolicy} policyFailed={reasonPolicyFailed} error={draftError}
            onReason={(next) => update({ reason: next })} onClose={() => setParamDraft(null)} onSave={saveParamDraft}>
            {limitChange && <Notice tone={numeric > Number(param.value) ? "warn" : "neutral"}>
              {numeric > Number(param.value) ? "调大上限时，保存会检查兑付覆盖率，低于红线或无法读取时不能保存。" : "调小上限属于收紧，不受这项覆盖率门槛阻断。"}
            </Notice>}
            {/* 现在值、新值输入、方向合成一块；范围只写在 hint。 */}
            <DiffField before={riskValueText(param.key, param.value)} unit={param.unit} hint={`${limits.min}–${limits.max} 的${limits.integer ? "整数" : "数字"}`}
              state={problem ? undefined : numeric > Number(param.value) ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="neutral" icon={Lock}>收紧</StatusTag>}
              note={!problem && help?.whatIf ? help.whatIf(riskValueText(param.key, value)) : undefined}
              error={fieldError(problem, typed, "value")}>
              {(control) => <NumberInput {...control} unit={param.unit} min={limits.min} max={limits.max} step={limits.step} disabled={busy} value={value} onChange={(event) => update({ value: event.target.value })} onBlur={() => touch("value")} />}
            </DiffField>
          </DraftModal>
        );
      })()}

      {releaseDraft && (() => {
        const { param, value, reason } = releaseDraft;
        const key = param.key;
        const limits = K1_RELEASE_PARAM_LIMITS[key];
        const range = limits && releaseRange(key, limits, overview?.releaseParams ?? []);
        const help = K1_PARAM_HELP[key];
        const isMode = key === "releaseMode";
        const isBool = key === "freeSlotRequiresBinding";
        const numeric = Number(value);
        const typed = value.trim() !== "";
        const problem = limits && range
          ? !typed ? "填写新值"
            : !Number.isInteger(numeric) || numeric < limits.min || numeric > limits.max ? `要填 ${range.min}–${range.max} 的整数`
              : numeric < range.min || numeric > range.max ? range.problem
                : numeric === Number(param.value) ? "和当前值一样，没有改动" : undefined
          : !(isMode ? (K1_RELEASE_MODE_VALUES as readonly string[]).includes(value) : isBool && (value === "true" || value === "false")) ? "新值不在范围内"
            : value === param.value ? "和当前值一样，没有改动" : undefined;
        const update = (patch: Partial<ParamDraft>) => setReleaseDraft((current) => current ? { ...current, ...patch } : current);
        const busy = draftSubmitting === "release";
        const valueText = (text: string) => isBool ? RELEASE_BOOL_LABELS[text] ?? text : isMode ? RELEASE_MODE_LABELS[text] ?? text : text;
        const loosening = !problem && isLooseningRelease(key, param.value, value);
        const direction = problem || isMode ? undefined : loosening ? <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag> : <StatusTag tone="neutral" icon={Lock}>收紧</StatusTag>;
        return (
          <DraftModal title={`调整${releaseParamName(param)}`} icon={SlidersHorizontal} effect={IMMEDIATE_EFFECT} explain={paramHelpRows(help, param.sub).filter((row) => row.k !== "怎么填")} busy={busy} saveLabel="保存并立即生效" blocked={problem} dirty={value !== param.value}
            reason={reason} placeholder="写清调整原因和依据" {...draftAttempt} policy={reasonPolicy} policyFailed={reasonPolicyFailed} error={draftError}
            onReason={(next) => update({ reason: next })} onReadLatest={() => void readLatestReleaseParam()} onClose={() => setReleaseDraft(null)} onSave={saveReleaseDraft}>
            {/* 现在值、新值输入、方向合成一块；数字用关键数字那一档，选项用 16 那一档（VS-103）。 */}
            <DiffField before={limits ? param.value : valueText(param.value)} unit={limits ? param.unit : undefined} size={limits ? "key" : "body"} hint={range && `${range.min}–${range.max} 的整数`}
              state={direction}
              note={!problem && <>
                {help?.whatIf?.(value)}
                {loosening && !RELEASE_AFFECTS_EARNINGS.has(key) && "保存时仍检查兑付覆盖率，低于红线或无法读取时不能保存。"}
                {/* 放大资金流出方向的告知:真正的拦截在服务端,本页没有覆盖率数据,不做客户端预检。不影响收益的几项写在上一句。 */}
                {loosening && RELEASE_AFFECTS_EARNINGS.has(key) && <span className="rd-diff-note" data-tone="warn" data-proof="k1-release-loosen-warning"><AlertTriangle size={14} strokeWidth={1.9} aria-hidden /><span>{key === "duplicateAccountFreezeFrom" ? "已有余额可能恢复提现，新增收益也可能不再锁定。" : "这项调整可能增加可提现收益。"}保存时检查兑付覆盖率，低于红线不能保存。</span></span>}
              </>}
              error={limits ? fieldError(problem, typed, "value") : undefined}>
              {limits && range
                ? (control) => <NumberInput {...control} unit={param.unit} min={range.min} max={range.max} step={limits.step} disabled={busy} value={value} onChange={(event) => update({ value: event.target.value })} onBlur={() => touch("value")} />
                // 可枚举值走下拉不手输(释放模式 / 开关);选项集合与 k-client 校验白名单同源。
                : <Select aria-label="新值（从下拉选择）" disabled={busy} value={value} onChange={(next) => update({ value: next })}
                  options={(isMode ? [...K1_RELEASE_MODE_VALUES] : ["true", "false"]).map((option) => ({ value: option, label: isMode ? RELEASE_MODE_LABELS[option] : RELEASE_BOOL_LABELS[option] }))} />}
            </DiffField>
          </DraftModal>
        );
      })()}

      {noteDraft && (() => {
        const busy = draftSubmitting === "note";
        return (
          <DraftModal title="人工复审备注" icon={ShieldCheck} effect={IMMEDIATE_EFFECT} explain={[{ k: "影响", v: "只写备注，不改状态，会显示在账户组上，记入操作记录。" }]} busy={busy} saveLabel="保存备注" reasonLabel="复审备注"
            reason={noteDraft.reason} placeholder="写复审结论和依据，例如：合租办公网络，已电话核实不是同一人" {...draftAttempt} policy={reasonPolicy} policyFailed={reasonPolicyFailed} error={draftError}
            onReason={(next) => setNoteDraft((current) => current ? { ...current, reason: next } : current)} onReadLatest={() => void readLatestNote()} onClose={() => setNoteDraft(null)} onSave={saveNoteDraft}>
            {clusterFacts(noteDraft.cluster, { changed: noteDraft.changed })}
          </DraftModal>
        );
      })()}

      {whitelistDraft && (() => {
        const cidr = whitelistDraft.cidr.trim();
        const note = whitelistDraft.note.trim();
        const cidrProblem = isValidCidr(whitelistDraft.cidr) ? undefined : "请输入合法 IPv4 CIDR（每段不使用前导零）";
        const noteProblem = note.length < 2 ? "备注至少 2 个字" : note.length > 200 ? "备注不能超过 200 字" : undefined;
        const expiryProblem = futureIsoDate(whitelistDraft.expireText) ? undefined : "失效日期必须晚于今天";
        const update = (patch: Partial<WhitelistDraft>) => setWhitelistDraft((current) => current ? { ...current, ...patch } : current);
        const busy = draftSubmitting === "whitelist";
        return (
          <DraftModal title="添加 IP 允许名单" icon={ShieldCheck} effect={IMMEDIATE_EFFECT} explain={[{ k: "影响", v: "只影响后续 IP 检测；设备和支付工具仍照常检测。既有组和成员限制保留，须在「账户组排查」人工判定或解除。" }, { k: "生效时间", v: "保存后立即生效，系统约每分钟检查一次，到失效日期后恢复检测。" }]} busy={busy} busyLabel="提交中…" saveLabel="加入并立即生效"
            blocked={cidrProblem ?? noteProblem ?? expiryProblem ?? (pendingBlocks.has(`cidr:${cidr}`) ? "这个网段有结果未确认的操作，先到页面上方处理" : undefined)}
            reason={whitelistDraft.reason} placeholder="写清调整原因和依据" {...draftAttempt} policy={reasonPolicy} policyFailed={reasonPolicyFailed} error={draftError}
            onReason={(next) => update({ reason: next })} onClose={() => setWhitelistDraft(null)} onSave={saveWhitelistDraft}>
            <Notice tone="warn">新增、重新启用或延长有效期时，保存会检查兑付覆盖率，低于红线或无法读取时不能保存。既有组和成员限制保留，须在「账户组排查」人工判定或解除。</Notice>
            <Field label="IP / CIDR 网段" required error={fieldError(cidrProblem, Boolean(whitelistDraft.cidr), "cidr")}>
              {(control) => <Input {...control} disabled={busy} value={whitelistDraft.cidr} onChange={(event) => update({ cidr: event.target.value })} onBlur={() => touch("cidr")} placeholder="198.51.100.0/24" />}
            </Field>
            <Field label="备注" required error={fieldError(noteProblem, Boolean(whitelistDraft.note), "note")}>
              {(control) => <Input {...control} disabled={busy} maxLength={200} value={whitelistDraft.note} onChange={(event) => update({ note: event.target.value })} onBlur={() => touch("note")} placeholder="例如：已核验的办公出口网段" />}
            </Field>
            <Field label="失效日期" required error={fieldError(expiryProblem, Boolean(whitelistDraft.expireText), "expire")}>
              {(control) => <Input {...control} disabled={busy} type="date" value={whitelistDraft.expireText} onChange={(event) => update({ expireText: event.target.value })} onBlur={() => touch("expire")} />}
            </Field>
          </DraftModal>
        );
      })()}

      {weightDraft && (() => {
        const fields = [
          ["device", "设备指纹权重", "设备指纹 / 浏览器指纹 / 应用实例"],
          ["payment", "支付工具权重", "银行卡 / 钱包 / 收款工具"],
          ["ip", "IP 权重", "同出口 IP / 网段"],
        ] as const;
        const fieldProblem = (key: WeightKey) => {
          if (weightDraft.bad[key]) return "不是有效数字";
          if (!weightDraft[key].trim()) return "没有填，不填不算 0";
          const value = numberValue(weightDraft[key]);
          return value >= 0 && value <= 1 ? undefined : "要在 0 到 1 之间";
        };
        const firstProblem = fields.flatMap(([key, label]) => { const problem = fieldProblem(key); return problem ? [`${label}${problem}`] : []; })[0];
        // 合计和有没有改动都按实际发送的两位小数算，不按框里的原始数字。
        const sent = fields.map(([key]) => Number(numberValue(weightDraft[key]).toFixed(2)));
        const total = sent.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
        const totalOk = Math.abs(total - 1) <= 0.001;
        const current = parseLinkWeight(weightDraft.param.value);
        const changed = fields.some(([key], index) => sent[index] !== Number(current[key]));
        const updateDraft = (patch: Partial<WeightDraft>) => setWeightDraft((draft) => draft ? { ...draft, ...patch } : draft);
        const busy = draftSubmitting === "weight";
        const help = K1_PARAM_HELP.linkWeight;
        return (
          <DraftModal title={`调整${riskParamName(weightDraft.param)}`} icon={SlidersHorizontal} effect={IMMEDIATE_EFFECT} wide busy={busy} saveLabel="保存并立即生效"
            explain={[{ k: "怎么算", v: "每种依据按同用账户数给分，乘权重后相加，取组里关联最强的一对账户。只影响建议冻结的提示，不改账户组状态。" }, { k: "怎么填", v: help.how }, { k: "生效时间", v: help.when }]}
            blocked={firstProblem ?? (!totalOk ? "三项合计必须等于 1.00" : !changed ? "保存值和当前值一样，没有改动" : undefined)}
            reason={weightDraft.reason} placeholder="例如：误判多来自同一网络，降低 IP 权重、提高设备指纹权重" {...draftAttempt} policy={reasonPolicy} policyFailed={reasonPolicyFailed} error={draftError}
            onReason={(next) => updateDraft({ reason: next })} onClose={() => setWeightDraft(null)} onSave={saveWeightDraft}>
            {/* 三个值都要填，现在值跟在字段名后面，输入框里是正在填的内容（VS-103）。 */}
            <div className="rd-form-grid" data-cols="3">
              {fields.map(([key, label, fieldHelp]) => (
                <Field key={key} label={label} explain={fieldHelp} hint={`现在 ${current[key]}`} error={fieldError(fieldProblem(key), true, key)}>
                  {(control) => <Input {...control} type="number" min={0} max={1} step={0.05} disabled={busy} value={weightDraft[key]} onChange={(event) => updateDraft({ [key]: event.target.value } as Partial<WeightDraft>)}
                    onInput={(event) => { const { badInput } = event.currentTarget.validity; setWeightDraft((draft) => draft && { ...draft, bad: { ...draft.bad, [key]: badInput } }); }} onBlur={() => { touch(key); touch("total"); }} placeholder="0.00 - 1.00" />}
                </Field>
              ))}
            </div>
            {!firstProblem && <p className={!totalOk && (touched.submit || touched.total) ? "rd-form-error" : "rd-note"}>合计 {total.toFixed(2)}{!totalOk && "，三项合计必须等于 1.00"}</p>}
          </DraftModal>
        );
      })()}

      {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)} explain={releasing.expiresAt <= Date.now() ? "先到操作记录与审批确认原操作结果。解除只移除本页待确认记录和对象锁，不撤销原操作。" : "重试被拒说明不了原操作的结果，先到操作记录确认。解除后原操作不再重试，系统仍按这个对象现在的状态校验。"} />}
    </>
  );
}
