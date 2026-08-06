"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DataListPager, Modal } from "../design-kit";
import { fetchK1MultiAccountOverview, K1OutcomeUncertainError, K1_RELEASE_MODE_VALUES, K1_RELEASE_PARAM_LIMITS, newK1CommandKey } from "@/lib/admin/k-client";
import { A2OutcomeUncertainError } from "@/lib/admin/a2-client";
import type { AdminPage, ClusterStatus, K1Cluster, K1ClusterLayer, K1ClusterSort, K1ClusterStatusFilter, K1WhitelistRow, KRiskParam } from "@/lib/admin/k-client";
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
 *  朴素 store 会复用旧命令号,后端 24h 幂等窗把新值当重复提交静默吞掉(界面还报成功)。
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
// enum/boolean 的运营可读中文标签(页面禁裸工程串);数值范围与键集单源在 k-client,
// 读校验与编辑弹窗共用,避免两处漂移。
const RELEASE_MODE_LABELS: Record<string, string> = {
  attest_or_manual: "在线证明或人工放行",
  manual_only: "仅人工放行",
};
const RELEASE_BOOL_LABELS: Record<string, string> = { true: "开启", false: "关闭" };

// 簇状态 → 收益桶结论(展示派生,不动状态机;权威结算在服务端)。
const CLUSTER_EARNING_IMPACT: Record<ClusterStatus, { label: string; tone: string; desc: string }> = {
  detected: { label: "正常槽内可提", tone: "dim", desc: "仅命中待判,正常手机槽内收益继续可提;超出槽位进入审核中。" },
  flagged: { label: "审核中", tone: "warn", desc: "已标可疑后,同簇超出正常槽位的托管收益进入审核中,等待人工结论。" },
  frozen: { label: "锁定奖励", tone: "bad", desc: "已冻结簇的新增托管收益进入锁定奖励,提现侧同步更严处理。" },
  released: { label: "恢复正常", tone: "ok", desc: "误判解除后,后续收益按正常账户释放;历史待审仍按审计结果处理。" },
  cleared: { label: "正常释放", tone: "ok", desc: "判定正常后退出多账户监控队列,后续收益按普通账户释放。" },
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
  return /failed to fetch|networkerror|backend_unavailable/i.test(message)
    ? "暂时无法连接风险服务，请稍后重试"
    : message || "暂时无法读取风险数据";
}

/** 释放参数的「放宽」方向判定(口径与 PRD v1 [K1] K1-MD4 逐条一致)。
 *  放宽 = 让更多收益更快进入可提桶 = 放大资金流出方向,须在弹窗告知并由服务端前置 B1 覆盖率核验。
 *  数值键分两族:调**大**是放宽(槽位 / 待审起点 / 重复账号建议线)· 调**小**是放宽(观察窗口 / 在线证明时长)。 */
const RELEASE_LOOSEN_WHEN_LARGER = new Set(["freePhoneSlotsPerCluster", "duplicateAccountPendingFrom", "duplicateAccountFreezeFrom"]);
const RELEASE_LOOSEN_WHEN_SMALLER = new Set(["pendingReleaseHours", "appAttestationReleaseHours"]);
export function isLooseningRelease(key: string, current: string, next: string): boolean {
  if (RELEASE_LOOSEN_WHEN_LARGER.has(key)) return Number(next) > Number(current);
  if (RELEASE_LOOSEN_WHEN_SMALLER.has(key)) return Number(next) < Number(current);
  // 释放模式:仅人工放行 → 允许在线证明放行 = 多开一条自动放行来源 = 放宽。
  if (key === "releaseMode") return current === "manual_only" && next === "attest_or_manual";
  // 首号绑定要求:开启 → 关闭 = 免费槽不再要求绑定 = 放宽。
  if (key === "freeSlotRequiresBinding") return current === "true" && next === "false";
  return false;
}

function confirmedK1FailureText(error: unknown) {
  return `K1 操作失败 · 本次写入未生效 · 服务端数据未变化，当前输入已保留 · ${errorText(error)}`;
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
  return <span className="f-ro"><span className="d" />服务端分页 · 判定全部后端落库</span>;
}

function ClusterGraph({ c }: { c: K1Cluster }) {
  const gid = useId();
  const W = 320, H = 272, cx = W / 2, cy = H / 2, R = 94;
  const edgeColor = (layer: string) => layer === "device" ? "var(--warning)" : layer === "payment" ? "var(--cyan)" : "var(--ink-4)";
  const nodeColor = (status: string) => /FROZEN|BANNED|RESTRICTED/i.test(status) ? "var(--danger)" : "var(--success)";
  const k = Math.min(c.nodes.length, 8);
  const over = Math.max(c.n - k, 0);
  const total = Math.max(k + (over > 0 ? 1 : 0), 1);
  const positions = new Map(c.nodes.slice(0, k).map((node, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / total;
    return [node[0], { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle), angle }] as const;
  }));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 272, display: "block" }} aria-label={`簇 ${c.id} 关联图谱`}>
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
  const [whitelistDraft, setWhitelistDraft] = useState<WhitelistDraft | null>(null);
  const [draftSubmitting, setDraftSubmitting] = useState<"param" | "weight" | "whitelist" | "release" | null>(null);
  const draftSubmitLock = useRef(false);
  const formId = useId();
  const [focusLookupState, setFocusLookupState] = useState<"idle" | "loading" | "positioning" | "found" | "not-found" | "error">("idle");
  const focusPageLoad = useRef(false);
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusClusterId = (searchParams.get("focusClusterId") ?? "").trim();
  const overview = ctx.risk.multiAccount;
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
    const next = new URLSearchParams(searchParams.toString());
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
        ? `K1 结果未知 · 请用同一命令键重试，不要重复新建操作 · ${error.commandKey}`
        : confirmedK1FailureText(error));
      throw error;
    }
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(ok);
    } catch {
      ctx.toast(`${ok}，但最新数据回读失败；请点击“仅重试 K1”核对服务端状态`);
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
      action: `标记可疑账户簇 · ${c.id}`,
      detail: "只打可疑标签,不冻结资产。标记会同步给风险评分和风险雷达,操作写入后端审计。",
      chips: [["仅标记 · 不动资产", "done"], ["后端落库 + 审计", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => {
        const def = findHighOp("k1_cluster_flag")!;
        return proposeClusterAction(`cluster-flag:${c.id}:${c.version}`, {
          action: `标记可疑账户簇 · ${c.id}`,
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
      detail: `把簇内 ${c.n} 个账户置为冻结簇状态。冻结台账和账户执行仍由后端链路处理,本页只提交处置命令和原因。`,
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
      detail: "解冻/放行方向会放大资金流出,需要操作确认并写清原因。后端会保留审计记录。",
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
      detail: "该动作会把账户簇移出监控队列,会减少后续风险评分输入,必须填写原因。",
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
      chips: [["仅备注 · 不改状态", "done"], ["后端审计", "ready"]],
      reason: true,
      okLabel: "保存备注",
      run: (reason) => runAction(() => ctx.actions.updateK1ClusterReviewNote(c.id, c.version, reason, commandKey), `${c.id} 复审备注已留痕`),
    });
  };

  const adjParam = (p: KRiskParam) => {
    if (p.key === "linkWeight") {
      setWeightDraft({ param: p, ...parseLinkWeight(p.value), reason: "", commandKey: newK1CommandKey() });
      return;
    }
    if (!PARAM_LIMITS[p.key]) {
      ctx.toast(`K1 参数 ${p.key} 不在允许编辑清单中`);
      return;
    }
    setParamDraft({ param: p, value: p.value, reason: "", commandKey: newK1CommandKey() });
  };

  // 收益释放参数编辑:命令号在**提交时**按「槽位 + 输入指纹」解析(见 releaseAttempts 注),
  // 不在开弹窗时铸号 —— 开弹窗时还不知道运营要填什么,提前铸号就没法区分「原样重试」和「改了值再提交」。
  const releaseScope = (key: string) => `release-param:${key}`;
  const releaseFingerprint = (value: string, reason: string) => JSON.stringify([value, reason.trim()]);
  const adjReleaseParam = (p: KRiskParam) => {
    setReleaseDraft({ param: p, value: p.value, reason: "", commandKey: "" });
  };

  const saveReleaseDraft = async () => {
    if (!releaseDraft || draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting("release");
    const scope = releaseScope(releaseDraft.param.key);
    // 同槽位 + 同输入 → 复用命令号(原样重试不重复下单);输入变了 → 自动铸新号(改值再提交不被幂等窗吞掉)。
    const commandKey = releaseAttempts.resolve(
      scope,
      releaseFingerprint(releaseDraft.value, releaseDraft.reason),
      () => newK1CommandKey(),
    );
    try {
      await ctx.actions.updateK1ReleaseParam(releaseDraft.param.key, releaseDraft.value, releaseDraft.reason.trim(), commandKey);
      releaseAttempts.forget(scope);
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError
        ? `K1 结果未知 · 请保留当前弹窗并原样重试 · ${error.commandKey}`
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
      ctx.toast(`${releaseDraft.param.name} 已更新 · 后续结算与提现分诊按新值执行`);
    } catch {
      ctx.toast(`${releaseDraft.param.name} 已写入，但最新数据回读失败；请重试 K1 后核对`);
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
        ? `K1 结果未知 · 请保留当前弹窗并重试 · ${error.commandKey}`
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
      ctx.toast(`${weightDraft.param.name} 已更新为 ${value}`);
    } catch {
      ctx.toast(`${weightDraft.param.name} 已写入，但最新数据回读失败；请重试 K1 后核对`);
    }
  };

  const saveParamDraft = async () => {
    if (!paramDraft || draftSubmitLock.current) return;
    draftSubmitLock.current = true;
    setDraftSubmitting("param");
    try {
      await ctx.actions.updateK1Param(paramDraft.param.key, paramDraft.value, paramDraft.reason.trim(), paramDraft.commandKey);
    } catch (error) {
      ctx.toast(error instanceof K1OutcomeUncertainError ? `K1 结果未知 · 请保留当前弹窗并重试 · ${error.commandKey}` : confirmedK1FailureText(error));
      if (!(error instanceof K1OutcomeUncertainError)) setParamDraft((current) => current ? { ...current, commandKey: newK1CommandKey() } : current);
      return;
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
    setParamDraft(null);
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast(`${paramDraft.param.name} 已更新为 ${paramDraft.value}`);
    } catch {
      ctx.toast(`${paramDraft.param.name} 已写入，但最新数据回读失败；请重试 K1 后核对`);
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
      ctx.toast(error instanceof K1OutcomeUncertainError ? `K1 结果未知 · 请保留当前弹窗并重试 · ${error.commandKey}` : confirmedK1FailureText(error));
      if (!(error instanceof K1OutcomeUncertainError)) setWhitelistDraft((current) => current ? { ...current, commandKey: newK1CommandKey() } : current);
      return;
    } finally {
      draftSubmitLock.current = false;
      setDraftSubmitting(null);
    }
    setWhitelistDraft(null);
    try {
      await ctx.reloadKRisk({ multiAccount: pageQuery });
      ctx.toast("白名单已写入后端");
    } catch {
      ctx.toast("白名单已写入，但最新数据回读失败；请重试 K1 后核对");
    }
  };

  const addWl = () => setWhitelistDraft({ cidr: "", note: "", expireText: "", reason: "", commandKey: newK1CommandKey() });

  const rmWl = (cidr: string) =>
    ctx.openConfirm({
      action: `移除白名单 · ${cidr}`,
      detail: "移除后该网段恢复同 IP 多账户检测。",
      chips: [["恢复 IP 维度检测", "ready"]],
      reason: true,
      okLabel: "确认移除",
      run: async (reason) => {
        const scope = `whitelist-disable:${cidr}`;
        const commandKey = commandAttempt.get(scope) ?? newK1CommandKey();
        commandAttempt.remember(scope, commandKey);
        try {
          await runAction(() => ctx.actions.disableK1Whitelist(cidr, reason, commandKey), "白名单已移除");
          commandAttempt.forget(scope);
        } catch (error) {
          if (!(error instanceof K1OutcomeUncertainError)) commandAttempt.forget(scope);
          throw error;
        }
      },
    });

  if (ctx.contentError) {
    return (
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">K1 数据加载失败</span>
          <span className="sub">· {errorText(ctx.contentError)} · 已隐藏旧数据与写操作，避免误处置</span>
          <div className="r">
            <button className="l-btn" onClick={() => void ctx.reloadKRisk({ multiAccount: pageQuery }).catch(() => undefined)}>仅重试 K1</button>
          </div>
        </div>
      </section>
    );
  }

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K1 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }

  return (
    <div>
      {focusClusterId && (
        <div className="ctint" role="status" style={{ marginBottom: 12 }}>
          已从 J3 带入账户簇 <b>{focusClusterId}</b>；
          {focusLookupState === "loading" && "正在跨分页查询服务器账户簇…"}
          {focusLookupState === "positioning" && "已找到该簇，正在切换到对应分页…"}
          {focusLookupState === "found" && "已按服务器查询结果自动定位。"}
          {focusLookupState === "not-found" && "服务器未找到该簇，未自动选择其他簇；请返回 J3 刷新后重试。"}
          {focusLookupState === "error" && "网络异常或账户簇数据持续变化，未能稳定定位；未自动选择其他簇。"}
          {focusLookupState !== "found" && (
            <button className="l-btn sm" style={{ marginLeft: 8 }} onClick={exitFocusMode}>退出定位后手动查看</button>
          )}
        </div>
      )}
      <div className="f-stats">
        <div className="f-stat"><div className="k">监控中账户簇</div><div className="v">{statText("activeClusters")}</div><div className="sub">按已接入权威维度合成 · 覆盖 {statText("flaggedAccounts")} 个账户</div></div>
        <div className="f-stat warn"><div className="k">高风险簇</div><div className="v">{statText("highClusters")}</div><div className="sub">建议冻结线 {formatThreshold(freezeSuggestThreshold)}</div></div>
        <div className="f-stat danger"><div className="k">已冻结簇</div><div className="v">{statText("frozenClusters")}</div><div className="sub">共 {statText("frozenAccounts")} 个账户</div></div>
        <div className="f-stat ok"><div className="k">新人礼拦截</div><div className="v">{statKnown("giftBlockedUsd") ? `$${statText("giftBlockedUsd")}` : "—"}</div><div className="sub">{statKnown("giftBlockedCnt") ? `${statText("giftBlockedCnt")} 笔重复领取被拦下` : "数据尚未接入，不能判定为 0"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">拦截阈值</span>
          <span className="sub">· K1 参数单源保存；注册 IP、设备指纹、支付工具与邀请奖励均按服务端事实裁决</span>
          <div className="r"><span className="kcode electric">改后下一次校验生效</span></div>
        </div>
        <div className="l-b">
          <div className="param-list">
            {params.map((p) => (
              <div className="p" key={p.key}>
                <div className="txt"><div className="k">{p.name}</div><div className="s">{p.sub}</div></div>
                <span className="v" style={p.key === "linkWeight" ? { fontSize: 13 } : undefined}>{p.value}{p.unit ? ` ${p.unit}` : ""}</span>
                {canWrite && <button className="l-btn sm mc" onClick={() => adjParam(p)}>调整</button>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 收益释放参数(SPEC-7 搬回,合并底账 §二#5):与整簇冻结分开的放行细调。 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">收益释放参数</span>
          <span className="sub">· 托管收益按账户结算,同簇多号超过阈值进入审核中或锁定奖励 · 账号上限与簇冻结建议强度(0-1)在上方「拦截阈值」区调整</span>
          <div className="r"><span className="kcode electric">影响注册后收益分桶 + 提现分诊</span></div>
        </div>
        <div className="l-b">
          {overview && overview.releaseParams.length > 0 ? (
            <>
              <div className="param-list" data-proof="k1-risk-release-params">
                {overview.releaseParams.map((p) => (
                  <div className="p" key={p.key}>
                    <div className="txt"><div className="k">{p.name}</div><div className="s">{p.sub}</div></div>
                    <span className="v">{releaseParamDisplay(p)}{p.unit && K1_RELEASE_PARAM_LIMITS[p.key] ? ` ${p.unit}` : ""}</span>
                    {canWrite && <button className="l-btn sm mc" onClick={() => adjReleaseParam(p)}>调整</button>}
                  </div>
                ))}
              </div>
              <div className="ktint warn" style={{ marginTop: 12 }}>
                <b>落地规则</b> · 正常槽位内收益可提;超过待审起点进入审核中;达到重复账号冻结线(第 N 个账号)仅生成冻结建议,收益落入锁定奖励只在人工冻结簇或触发超槽熔断后发生。审核中的收益<b>不随时间自动放行</b>:释放只认 App 在线证明达标或人工放行两个来源;观察窗口内同簇批量释放有熔断——超出正常槽位数的待审收益自动升为锁定奖励。放宽任一参数 = 放大资金流出方向,请在操作理由写明依据。
              </div>
            </>
          ) : (
            <div className="ktint">服务端尚未下发收益释放参数(后端未升级)· 为避免在错误口径上调参,本卡不提供编辑入口。</div>
          )}
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">三层去重命中列表</span>
          <span className="sub">· 点任意一行看簇详情</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["ip", "IP"], ["device", "设备指纹"], ["payment", "支付工具"]] as const).map(([v, lb]) => (
                <button key={v} aria-pressed={layer === v} className={`chip${layer === v ? " sel" : ""}`} onClick={() => { setLayer(v); setClusterPage(1); }}>{lb}</button>
              ))}
            </div>
            <select className="fld" aria-label="账户簇状态" value={clusterStatus} onChange={(event) => { setClusterStatusFilter(event.target.value as K1ClusterStatusFilter); setClusterPage(1); }} style={{ width: 120 }}>
              <option value="all">全部状态</option><option value="detected">待判定</option><option value="flagged">可疑</option><option value="frozen">已冻结</option><option value="released">已解除</option><option value="cleared">正常</option>
            </select>
            <select className="fld" aria-label="账户簇排序" value={clusterSort} onChange={(event) => { setClusterSort(event.target.value as K1ClusterSort); setClusterPage(1); }} style={{ width: 140 }}>
              <option value="strength_desc">关联强度</option><option value="account_desc">关联账户数</option>
            </select>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>去重键</th><th>维度</th><th className="num">关联账户</th><th>关联强度</th><th>注册时间跨度</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {clusters.map((c, index) => {
                const [stLb, stTone] = CLUSTER_ST[c.status];
                const hot = c.strength >= freezeSuggestThreshold && c.status !== "frozen" && c.status !== "cleared" && c.status !== "released";
                return (
                  <tr
                    key={c.id}
                    className={focusBlocksSelection ? "" : "click"}
                    tabIndex={focusBlocksSelection ? undefined : 0}
                    aria-label={focusBlocksSelection ? undefined : `查看账户簇 ${c.id} 详情`}
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
                        {!focusBlocksSelection && c.status === "detected" && <>{canFlag && <button className="l-btn sm" onClick={() => flagCluster(c)}>标可疑</button>}{canClear && <button className="l-btn sm mc" onClick={() => clearCluster(c)}>判正常</button>}</>}
                        {!focusBlocksSelection && c.status === "flagged" && canFreeze && <button className="l-btn sm mc" onClick={() => freezeCluster(c)}>批量冻结</button>}
                        {!focusBlocksSelection && (c.status === "frozen" || c.status === "flagged") && canRelease && <button className="l-btn sm mc" onClick={() => releaseCluster(c)}>解除误判</button>}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {!clusters.length && <tr><td colSpan={7} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>当前筛选条件下暂无命中簇。可切换维度/状态，或等待下一轮服务端聚类。</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="K1 去重命中列表"
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
            <span className="ttl">簇详情 · {cur.id}</span>
            <span className="sub">· 同一实体的账户群 · 连线标注共享维度</span>
            <div className="r">
              {canWrite && <button className="l-btn" onClick={() => reviewNote(cur)}>人工复审备注</button>}
              {cur.status === "detected" && canFlag && <button className="l-btn" onClick={() => flagCluster(cur)}>标可疑</button>}
              {cur.status === "flagged" && canFreeze && <button className="l-btn mc" onClick={() => freezeCluster(cur)}>批量冻结</button>}
              {(cur.status === "frozen" || cur.status === "flagged") && canRelease && <button className="l-btn mc" onClick={() => releaseCluster(cur)}>解除误判</button>}
            </div>
          </div>
          <div className="cl-split">
            <div className="graph">
              <ClusterGraph c={cur} />
              <div className="ktint" style={{ fontSize: 12 }}><b>判读</b> · {cur.note}</div>
              {(() => {
                // 收益影响(SPEC-7 搬回):簇状态 → 收益桶结论 + 当前释放参数,展示派生不动状态机。
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
                      ? `当前参数:正常释放 ${slots} 个手机槽;第 ${pendingFrom} 个账号起进入审核中;第 ${freezeFrom} 个账号起建议锁定奖励。`
                      : "当前参数:服务端尚未下发收益释放参数,以服务端结算口径为准。"}</div>
                  </div>
                );
              })()}
            </div>
            <div className="tbl-pane">
              <table className="l-tbl">
                <thead><tr><th>账户</th><th>注册时间</th><th>上级</th><th>领过新人礼</th><th className="num">累计入金</th><th>状态</th></tr></thead>
                <tbody>
                  {cur.nodes.map((n) => {
                    const restricted = /FROZEN|BANNED|RESTRICTED/i.test(n[5]);
                    const unknown = !n[5] || /UNKNOWN|未知/i.test(n[5]);
                    const lb = restricted ? "受限" : unknown ? "未知" : n[5];
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
              )) : <div className="ktint" style={{ fontSize: 12 }}>数据尚未接入，当前不能判定本簇重复发放次数为 0。</div>}
            </div>
          </div>
        </section>
      )}

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">IP 白名单</span>
          <span className="sub">· 只影响 IP 维度,不影响设备和支付维度</span>
          <div className="r">{canWrite && <button className="l-btn" onClick={addWl}>+ 添加白名单</button>}</div>
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
              {!whitelist.length && <tr><td colSpan={5} style={{ textAlign: "center", color: "var(--ink-4)", padding: 20 }}>暂无白名单</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="K1 IP 白名单"
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
          <Modal title={`拦截阈值调整 · ${paramDraft.param.name}`} icon="shield" busy={draftSubmitting === "param"} onClose={() => setParamDraft(null)} footer={<>
            <button className="l-btn" disabled={draftSubmitting === "param"} onClick={() => setParamDraft(null)}>取消</button>
            <button className="l-btn mc" disabled={!valueOk || !reasonOk || draftSubmitting === "param"} onClick={() => void saveParamDraft()}>{draftSubmitting === "param" ? "保存中…" : "确认保存"}</button>
            </>}>
            <div className="field">
              <label htmlFor={`${formId}-param-value`}>目标值（{limits.min} - {limits.max}）</label>
              <input id={`${formId}-param-value`} className="fld" type="number" min={limits.min} max={limits.max} step={limits.step} value={paramDraft.value} onChange={(event) => update({ value: event.target.value })} />
              {!valueOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>{limits.integer ? "必须填写范围内的整数" : "必须填写范围内的数字"}</div>}
            </div>
            <div className="field">
              <label htmlFor={`${formId}-param-reason`}>操作理由（必填 · 8-200 字）</label>
              <textarea id={`${formId}-param-reason`} rows={3} maxLength={200} value={paramDraft.reason} onChange={(event) => update({ reason: event.target.value })} />
            </div>
            <div className="ctint">该参数只改变风险建议与聚类阈值，不会自动冻结账户。</div>
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
          <Modal title={`收益释放参数调整 · ${releaseDraft.param.name}`} icon="shield" busy={draftSubmitting === "release"} onClose={() => setReleaseDraft(null)} footer={<>
            <button className="l-btn" disabled={draftSubmitting === "release"} onClick={() => setReleaseDraft(null)}>取消</button>
            <button className="l-btn mc" disabled={!valueOk || !reasonOk || draftSubmitting === "release"} onClick={() => void saveReleaseDraft()}>{draftSubmitting === "release" ? "保存中…" : "确认保存"}</button>
          </>}>
            {limits ? (
              <div className="field">
                <label htmlFor={`${formId}-release-value`}>目标值({limits.min} - {limits.max}{releaseDraft.param.unit ? ` · ${releaseDraft.param.unit}` : ""})</label>
                <input id={`${formId}-release-value`} className="fld" type="number" min={limits.min} max={limits.max} step={limits.step} value={releaseDraft.value} onChange={(event) => update({ value: event.target.value })} />
                {!valueOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>必须填写范围内的整数</div>}
              </div>
            ) : (
              // 可枚举值走下拉不手输(释放模式 / 开关);选项集合与 k-client 校验白名单同源。
              <div className="field">
                <label htmlFor={`${formId}-release-value`}>目标值(下拉可选,不接受自由输入)</label>
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
                <b>该改动会放大资金流出</b> · 放宽后更多收益进入可提桶,服务端会先核验 B1 备付金覆盖率,低于红线将整单拒绝(本次写入不生效)。请在操作理由写明放宽依据。
              </div>
            )}
            <div className="ctint">{releaseDraft.param.note.trim() || "释放参数只改变后续注册、结算与提现分诊,历史审计不回写;放宽方向请在理由写明依据。"}</div>
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
          <Modal title="添加 IP 白名单" icon="shield" busy={draftSubmitting === "whitelist"} onClose={() => setWhitelistDraft(null)} footer={<>
            <button className="l-btn" disabled={draftSubmitting === "whitelist"} onClick={() => setWhitelistDraft(null)}>取消</button>
            <button className="l-btn mc" disabled={!canSave || draftSubmitting === "whitelist"} onClick={() => void saveWhitelistDraft()}>{draftSubmitting === "whitelist" ? "提交中…" : "确认加白"}</button>
          </>}>
            <div className="ctint" style={{ marginBottom: 12 }}>只排除 IP 维度；设备与支付关联仍继续检测，已冻结账户不会自动解冻。</div>
            <div className="field"><label htmlFor={`${formId}-cidr`}>IP / CIDR 网段</label><input id={`${formId}-cidr`} className="fld" value={whitelistDraft.cidr} onChange={(event) => update({ cidr: event.target.value })} placeholder="198.51.100.0/24" />{whitelistDraft.cidr && !cidrOk && <div className="tiny" style={{ color: "var(--danger)", marginTop: 6 }}>请输入合法 IPv4 CIDR（每段不使用前导零）</div>}</div>
            <div className="field"><label htmlFor={`${formId}-whitelist-note`}>白名单备注</label><input id={`${formId}-whitelist-note`} className="fld" maxLength={200} value={whitelistDraft.note} onChange={(event) => update({ note: event.target.value })} placeholder="例如：已核验的办公出口网段" /></div>
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
            title={`拦截阈值调整 · ${weightDraft.param.name}`}
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
              关联强度 = 设备指纹命中 × 设备权重 + 支付工具命中 × 支付权重 + IP 命中 × IP 权重。每项单独填写,合计必须等于 1.00。
            </div>
            <div className="grid g-3" style={{ gap: 10 }}>
              {[
                ["device", "设备指纹权重", "设备指纹 / 浏览器指纹 / App 实例"] as const,
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
                placeholder="例: 根据误判样本回归,降低 IP 权重并提高设备指纹权重"
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
