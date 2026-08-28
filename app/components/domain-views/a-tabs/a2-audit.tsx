"use client";

/**
 * A2 审计 & 操作确认中心 — design_handoff_a_domain/A2 设计稿 port(387 行 + SPEC §4 矩阵 14 行权威 + §7 三铁律)。
 *
 * 全后台最高频工作台:高敏操作动态 + 审计日志 + 执行历史 + 机制参数四块,落 9 大类操作确认清单。
 *
 * A 域三铁律(A2 实装,server-canonical 镜像):
 *  ① append-only — 审计日志只导出不改/删,导出按钮仍需操作确认(强制留痕)。无 endpoint = 无 UI;
 *  ② reason-required — 所有高敏动作提交前必须填操作理由,弹窗校验不通过不写 store;
 *  ③ 确认即执行 + 幂等 — 同一命令 24 小时内重复提交不重复生效，失败时保持待处理且目标域零副作用。
 *
 * 真写键(A.*):
 *  A.appr.<id>.status(approved / rejected / withdrawn)·
 *  A.confirm.reasonMin(理由最短长度)· A.appr.ret(日志保留期)· A.appr.schemaVer(字段结构注册)。
 *
 * 操作确认 显式 edit 契约(2026-06 跨域硬化):
 *  - 调参(理由最短长度 / 保留期 / schema 注册)传 edit:{kind,current,unit};
 *  - 处置(放行 / 驳回)不传 edit。
 *
 * amplifies 仅 A2 fund 类 + amplifies=true(放大资金流出方向)挂 B1 红线预检。
 *
 * 设计稿元素省略:f-bar/f-nav/f-title/f-desc/f-cta 已由 DomainHeader 承担,本组件从 .f-stats 开始。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataListPager, Drawer, useDataListPager } from "../design-kit";
import {
  approveA2Operation,
  createA2CommandKey,
  exportA2Audit,
  fetchA2RetentionLatest,
  fetchA2Overview,
  rejectA2Operation,
  runA2RetentionNow,
  updateA2MechanismParam,
  withdrawA2Operation,
  type A2AuditDomain,
  type A2AuditFilter,
  type A2OperationRow,
  type A2OperationType,
  type A2Overview,
  type RetentionExecution,
} from "@/lib/admin/a2-client";
import {
  A2_AUDIT_DOMAINS,
  canAccessA2Export,
  canAccessA2Write,
  matchesA2AuditFilter,
  matchesA2OperationRole,
  normalizeA2AuditFilter,
  parseA2FilterQuery,
  parseA2ReasonMin,
  parseA2SchemaVersion,
  validateA2MechanismValue,
  validateA2AuditFilterRange,
} from "@/lib/admin/a2-policy";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canApprovePending, type AuthPrincipal } from "@/lib/admin/ops-authority";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { ACtx } from "./types";

/* ────────────────── helpers ────────────────── */

type QType = "all" | A2OperationType;
type QOperator = "all" | "财务" | "风控" | "增长" | "内容" | "客服" | "超管";
type DomainFilter = "all" | A2AuditDomain;

const TYPE_CHIPS: { key: QType; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "fund", label: "资金类" },
  { key: "param", label: "参数类" },
  { key: "acct", label: "处置/账号" },
  { key: "sos", label: "⚡ 应急轨" },
];

const OPERATOR_CHIPS: { key: QOperator; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "财务", label: "财务" },
  { key: "风控", label: "风控" },
  { key: "增长", label: "增长" },
  { key: "内容", label: "内容" },
  { key: "客服", label: "客服" },
  { key: "超管", label: "超管" },
];

const DOMAIN_NAMES: Record<A2AuditDomain, string> = {
  A: "平台", B: "总览", C: "用户", D: "资金", E: "设备", F: "分销",
  G: "金融产品", H: "增长", I: "内容", J: "应急", K: "风控", L: "数据", M: "客服",
};

const DOMAIN_CHIPS: { key: DomainFilter; label: string }[] = [
  { key: "all", label: "全部" },
  ...A2_AUDIT_DOMAINS.map((domain) => ({ key: domain, label: `${domain} ${DOMAIN_NAMES[domain]}` })),
];

const HIST_TONE: Record<string, "ok" | "bad" | "dim" | "warn"> = {
  approved: "ok",
  rejected: "bad",
  withdrawn: "dim",
  expired: "warn",
};

const HIST_LABEL: Record<string, string> = {
  approved: "已执行",
  rejected: "已取消",
  withdrawn: "已撤回",
  expired: "已过期",
};

type OperationMarker = {
  key: string;
  label: string;
  className: string;
};

function operationMarkers(w: A2OperationRow): OperationMarker[] {
  const markers: OperationMarker[] = [];
  if (w.amplifies) {
    markers.push({ key: "amplifies", label: "🔥 放大流出", className: "a2-amp" });
  }
  if (w.sos) {
    markers.push({ key: "sos", label: "⚡ 应急轨", className: "a2-sos" });
  }
  if (markers.length > 0) {
    return markers;
  }
  if (w.type === "acct") {
    return [{ key: "acct", label: "账号/权限高敏", className: "a2-sensitive acct" }];
  }
  if (w.type === "param") {
    return [{ key: "param", label: "参数高敏", className: "a2-sensitive param" }];
  }
  if (w.type === "fund") {
    return [{ key: "fund", label: "资金高敏", className: "a2-sensitive fund" }];
  }
  return [{ key: "general", label: "高敏动作", className: "a2-sensitive" }];
}

function normalizeOperatorIdentity(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function isCurrentOperator(w: A2OperationRow, principal: AuthPrincipal) {
  const current = normalizeOperatorIdentity(principal.name);
  return w.mine || (!!current && current === normalizeOperatorIdentity(w.operator));
}

/* ────────────────── 主组件 ────────────────── */

export function A2Audit({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const session = useAdminAuth((s) => s.session);
  const principal = {
    name: session?.operator || session?.username || operator,
    role: session?.role,
    authorities: session?.authorities ?? [],
  } as AuthPrincipal;
  const canApprove = canApprovePending(principal);
  const canExport = canAccessA2Export(principal.authorities);
  const canWrite = canAccessA2Write(principal.authorities);
  const [overview, setOverview] = useState<A2Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState<A2AuditFilter>({ domain: "all" });
  const [appliedFilter, setAppliedFilter] = useState<A2AuditFilter>({});
  const [routeFilterReady, setRouteFilterReady] = useState(false);
  const [retentionRun, setRetentionRun] = useState<RetentionExecution | null>(null);
  const [retentionRunError, setRetentionRunError] = useState<string | null>(null);
  const [retentionPending, setRetentionPending] = useState(false);

  const loadOverview = useCallback(async (filter: A2AuditFilter) => {
    setLoading(true);
    try {
      setLoadError(null);
      const next = await fetchA2Overview(filter);
      setOverview(next);
      return next;
    } catch (error) {
      setOverview(null);
      const message = displayAdminError(error);
      setLoadError(message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const routeFilter = parseA2FilterQuery(window.location.search);
    setFilterDraft({ domain: routeFilter.domain ?? "all", ...routeFilter });
    setAppliedFilter(routeFilter);
    setRouteFilterReady(true);
  }, []);

  useEffect(() => {
    if (!routeFilterReady) return;
    void loadOverview(appliedFilter).catch(() => undefined);
  }, [appliedFilter, loadOverview, routeFilterReady]);

  const refreshOverview = useCallback(
    () => loadOverview(appliedFilter),
    [appliedFilter, loadOverview],
  );

  const refreshRetentionRun = useCallback(async () => {
    try {
      setRetentionRunError(null);
      setRetentionRun(await fetchA2RetentionLatest());
    } catch (error) {
      setRetentionRun(null);
      setRetentionRunError(displayAdminError(error));
    }
  }, []);

  useEffect(() => {
    void refreshRetentionRun();
  }, [refreshRetentionRun]);

  const stats = overview?.stats ?? {
    pendingTickets: 0,
    fundTickets: 0,
    sosTickets: 0,
    todayAuditEvents: 0,
    weeklyApproved: 0,
    weeklyRejected: 0,
    weeklyExpired: 0,
    weeklyWithdrawn: 0,
  };
  const operationQueue = overview?.operationQueue ?? [];
  const auditLogs = overview?.recentLogs ?? [];
  const operationHistory = overview?.operationHistory ?? [];
  const mechanismParams = overview?.mechanismParams ?? [];
  const confirmCategories = overview?.confirmCategories ?? [];
  const reasonMin = parseA2ReasonMin(mechanismParams.find((p) => p.key === "ttl")?.value);

  const runRetention = () => {
    if (!canWrite) { toast("当前账号没有 A2 执行留存清理权限"); return; }
    const commandKey = createA2CommandKey("a2-retention-run");
    openActionConfirm({
      action: <>立即执行审计冷归档保留清理</>,
      detail: <>只处理已到 <b>expire_at</b> 的新审计行；每行先写入 append-only 冷归档并校验后才删除热表。历史无 expire_at 行、执行审计自身和未归档行都不会删除；同一命令号重试不会重复生效。</>,
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        setRetentionPending(true);
        try {
          const result = await runA2RetentionNow(reason, commandKey);
          setRetentionRun(result);
          toast(result.lockAcquired
            ? `保留清理完成：归档 ${result.archivedRows}，删除热表 ${result.deletedRows}`
            : "已有保留清理在执行，本次未删除任何数据");
        } catch (error) {
          toast(`执行失败:${displayAdminError(error)}`);
          throw error;
        } finally {
          setRetentionPending(false);
        }
      },
    });
  };

  /* 高敏动作过滤 + 分页 */
  const [qType, setQType] = useState<QType>("all");
  const [qOperator, setQOperator] = useState<QOperator>("all");
  const [qPage, setQPage] = useState(0);
  const [qPerPage, setQPerPage] = useState(10);

  /* drawers */
  const [woIdx, setWoIdx] = useState<number | null>(null);
  const [logIdx, setLogIdx] = useState<number | null>(null);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [mcListOpen, setActionConfirmListOpen] = useState(false);

  /* ────────────────── 动作实时态(后端工单状态) ────────────────── */
  const effStatus = (w: A2OperationRow) => w.status;

  /* ────────────────── 高敏动作 ────────────────── */

  const approveWo = (w: A2OperationRow) => {
    const commandKey = createA2CommandKey(`a2-approve-${w.id}`);
    openActionConfirm({
      action: <>确认执行 · {w.id}({w.action})</>,
      detail: (
        <>
          对象 <b>{w.obj}</b> · 变更前 <b>{w.before}</b> · 变更后 <b>{w.after}</b> · 发起人 {w.operator}。
          操作理由必填,确认后一次性事务写入目标域并落审计
          {w.sos ? (<>,<b> 应急轨:确认后立即生效并通知 J 域值班</b></>) : null}。<br />
          执行门槛:<b>{w.roleGate}</b> · 同一次提交在 24 小时内不会重复生效。
        </>
      ),
      amplifies: w.amplifies,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        try {
          await approveA2Operation(w.id, reason, commandKey);
          const next = await refreshOverview();
          const confirmed = next.operationQueue.some((item) => item.id === w.id && item.status === "approved")
            || next.operationHistory.some((item) => item.id === w.id && item.st === "approved");
          if (!confirmed) throw new Error("A2_OPERATION_WRITE_NOT_CONFIRMED");
          toast(`${w.id} 已执行 · 已重新读取服务端状态与审计记录`);
        } catch (error) {
          toast(`执行失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  const rejectWo = (w: A2OperationRow) => {
    const commandKey = createA2CommandKey(`a2-reject-${w.id}`);
    openActionConfirm({
      action: <>取消执行 · {w.id} · {w.action}</>,
      detail: (
        <>
          取消后该动作进入<b>已取消</b>终态，原因必填并随审计永久留痕。需要再做只能重新发起新的操作确认。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        try {
          await rejectA2Operation(w.id, reason, commandKey);
          const next = await refreshOverview();
          const confirmed = next.operationQueue.some((item) => item.id === w.id && item.status === "rejected")
            || next.operationHistory.some((item) => item.id === w.id && item.st === "rejected");
          if (!confirmed) throw new Error("A2_OPERATION_WRITE_NOT_CONFIRMED");
          toast(`${w.id} 已取消 · 已重新读取服务端状态与审计记录`);
        } catch (error) {
          toast(`取消失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  const withdrawWo = (w: A2OperationRow) => {
    const commandKey = createA2CommandKey(`a2-withdraw-${w.id}`);
    openActionConfirm({
      action: <>撤回本人提案 · {w.id}</>,
      detail: <>仅提案发起人可在 pending 状态撤回；服务端以 maker 身份与状态 CAS 双重校验，撤回后释放锁且不执行目标动作。</>,
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        try {
          await withdrawA2Operation(w.id, reason, operator, commandKey);
          const next = await refreshOverview();
          const confirmed = next.operationQueue.some((item) => item.id === w.id && item.status === "withdrawn")
            || next.operationHistory.some((item) => item.id === w.id && item.st === "withdrawn");
          if (!confirmed) throw new Error("A2_WITHDRAW_WRITE_NOT_CONFIRMED");
          toast(`${w.id} 已撤回 · 已重新读取服务端状态与审计记录`);
        } catch (error) {
          toast(`撤回失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  /* ────────────────── 审计日志:导出(仍需操作确认 · 强制留痕) ────────────────── */
  const exportAudit = () => {
    if (!canExport || filteredLogRows.length === 0) return;
    const commandKey = createA2CommandKey("a2-audit-export");
    openActionConfirm({
      action: "导出审计日志",
      detail: (
        <>
          导出范围:当前筛选条件命中的记录;隐私字段脱敏。导出本身也会留一条审计(谁、何时、导了什么范围)。
          可导角色:只读审计(全量)/ 财务·风控(本域)。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        try {
          const file = await exportA2Audit(reason, appliedFilter, commandKey);
          await refreshOverview();
          toast(`已下载 ${file.fileName} · 导出动作已留痕并重新读取服务端记录`);
        } catch (error) {
          toast(`导出失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  /* ────────────────── 机制参数:理由最短长度 / 保留期 / schema 调整 ────────────────── */
  const adjReasonMin = () => {
    const cur = mechanismParams.find((p) => p.key === "ttl")?.value ?? "8 字";
    const commandKey = createA2CommandKey("a2-mechanism-ttl");
    openActionConfirm({
      action: "操作理由最短长度",
      detail: (
        <>
          当前 <b>{cur}</b> · 范围 8–200 字。所有操作确认弹窗提交前校验,不满足时确认按钮保持 disabled。
          这个参数只约束新提交的理由,历史审计按原文保留。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      edit: { kind: "number", current: cur, unit: "字", min: 8, max: 200, step: 1 },
      run: async (reason, v) => {
        const validation = validateA2MechanismValue("ttl", v ?? "");
        if (!validation.ok) {
          toast(`拒绝:${validation.message}`);
          throw new Error(validation.message);
        }
        try {
          await updateA2MechanismParam("ttl", validation.value, reason, commandKey);
          const next = await refreshOverview();
          const readback = next.mechanismParams.find((item) => item.key === "ttl")?.value.match(/\d+/)?.[0];
          if (readback !== validation.value) throw new Error("A2_MECHANISM_WRITE_NOT_CONFIRMED");
          toast(`理由最短长度已更新为 ${validation.value} 字，并完成服务端回读`);
        } catch (error) {
          toast(`调整失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  const adjRet = () => {
    const cur = mechanismParams.find((p) => p.key === "retention")?.value ?? "13 个月";
    const commandKey = createA2CommandKey("a2-mechanism-retention");
    openActionConfirm({
      action: "审计日志保留期",
      detail: (
        <>
          当前 <b>{cur}</b> · 范围 13–36 个月(下限写死,要覆盖完整 12 月运营周期 + 1 月缓冲)。
          改动只对新日志生效,不回溯清理旧账。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      edit: { kind: "number", current: cur, unit: "月", min: 13, max: 36, step: 1 },
      run: async (reason, v) => {
        const validation = validateA2MechanismValue("retention", v ?? "");
        if (!validation.ok) {
          toast(`拒绝:${validation.message}`);
          throw new Error(validation.message);
        }
        try {
          await updateA2MechanismParam("retention", validation.value, reason, commandKey);
          const next = await refreshOverview();
          const readback = next.mechanismParams.find((item) => item.key === "retention")?.value.match(/\d+/)?.[0];
          if (readback !== validation.value) throw new Error("A2_MECHANISM_WRITE_NOT_CONFIRMED");
          toast(`日志保留期已更新为 ${validation.value} 个月，并完成服务端回读`);
        } catch (error) {
          toast(`调整失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  const adjSchema = () => {
    const cur = parseA2SchemaVersion(mechanismParams.find((p) => p.key === "schema")?.value) || "v3";
    const commandKey = createA2CommandKey("a2-mechanism-schema");
    openActionConfirm({
      action: "审计/事件字段结构变更",
      detail: (
        <>
          新增事件名或属性须先在事件中台(A4)注册；当前仅支持已注册的 v3、v4，且只能单调升级。
          全后台共用一套字段结构,各域不许私加字段——口径分裂了取证就对不上。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      edit: { kind: "text", current: cur, unit: "" },
      run: async (reason, v) => {
        const validation = validateA2MechanismValue("schema", v ?? "", cur);
        if (!validation.ok) {
          toast(`拒绝:${validation.message}`);
          throw new Error(validation.message);
        }
        try {
          await updateA2MechanismParam("schema", validation.value, reason, commandKey);
          const next = await refreshOverview();
          const readback = parseA2SchemaVersion(next.mechanismParams.find((item) => item.key === "schema")?.value);
          if (readback !== validation.value) throw new Error("A2_MECHANISM_WRITE_NOT_CONFIRMED");
          toast(`字段结构版本已更新为 ${validation.value}，并完成服务端回读`);
        } catch (error) {
          toast(`变更失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  /* ────────────────── 工单过滤 + 排序(fund 置顶 · stable) ────────────────── */
  const filteredQ = useMemo(() => {
    const arr = operationQueue.filter((w) => w.status === "pending").filter((w) => {
      const tOk = qType === "all" || w.type === qType || (qType === "sos" && w.sos);
      const mOk = qOperator === "all" || matchesA2OperationRole(w.operatorRole, qOperator);
      return tOk && mOk;
    });
    // fund 置顶 stable:用 indexOf 锚定原序,fund 排前
    return arr
      .map((w, i) => ({ w, i }))
      .sort((a, b) => {
        const af = a.w.type === "fund" ? 0 : 1;
        const bf = b.w.type === "fund" ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.i - b.i;
      })
      .map((x) => x.w);
  }, [operationQueue, qType, qOperator]);

  const qTotal = filteredQ.length;
  const qPages = Math.max(1, Math.ceil(qTotal / qPerPage));
  const qSafePage = Math.min(qPage, qPages - 1);
  const qStart = qSafePage * qPerPage;
  const qEnd = Math.min(qStart + qPerPage, qTotal);
  const qRows = filteredQ.slice(qStart, qEnd);

  /* ────────────────── 审计日志过滤 ────────────────── */
  const filteredLogRows = useMemo(
    () => auditLogs.filter((l) => matchesA2AuditFilter(l, appliedFilter)),
    [appliedFilter, auditLogs],
  );
  const auditFilterKey = JSON.stringify(appliedFilter);
  const auditLogPager = useDataListPager(filteredLogRows, { initialPageSize: 10, resetKey: auditFilterKey });
  const historyPager = useDataListPager(operationHistory, {
    initialPageSize: 4,
    resetKey: operationHistory.length,
  });
  const applyAuditFilters = () => {
    const next = normalizeA2AuditFilter(filterDraft);
    const rangeError = validateA2AuditFilterRange(next);
    if (rangeError) {
      toast(rangeError);
      return;
    }
    setAppliedFilter(next);
  };

  /* ────────────────── 渲染 ────────────────── */

  return (
    <>
      {/* ───── 4 f-stat ───── */}
      <div className="f-stats">
        <div className="f-stat warn">
          <div className="k">高敏动作</div>
          <div className="v">{stats.pendingTickets} 件</div>
          <div className="sub">资金类 {stats.fundTickets} 件置顶 · 理由必填留痕</div>
        </div>
        <div className="f-stat danger">
          <div className="k">应急快速轨</div>
          <div className="v">{stats.sosTickets} 件</div>
          <div className="sub">J 域熔断恢复 · 时限以服务端工单记录为准</div>
        </div>
        <div className="f-stat">
          <div className="k">今日审计事件</div>
          <div className="v">{stats.todayAuditEvents.toLocaleString()} 条</div>
          <div className="sub">后台操作统一进入不可修改的审计记录</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">本周执行 / 取消</div>
          <div className="v">{stats.weeklyApproved} / {stats.weeklyRejected}</div>
          <div className="sub">另有 {stats.weeklyExpired} 件校验拦截 · {stats.weeklyWithdrawn} 件主动取消</div>
        </div>
      </div>

      {(loading || loadError) && (
        <div className={`atint${loadError ? " warn" : ""}`} data-module-health-state={loadError ? "error" : undefined} style={{ margin: "12px 0" }}>
          {loadError ? (
            <>
              审计中心读取失败，旧数据已清空，所有操作均已停用：{loadError}
              <button className="l-btn sm" style={{ marginLeft: 10 }} onClick={() => void refreshOverview().catch(() => undefined)}>重新读取</button>
            </>
          ) : "正在读取审计中心服务端数据。"}
        </div>
      )}

      {/* ───── (b) 高敏操作动态 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">高敏操作动态(b)· 待处理</span>
          <span className="sub">· 大额/资金类置顶 · 点击执行会打开独立操作确认弹窗,理由必填后立即生效</span>
          <div className="r chips">
            <span className="lb">筛</span>
            {TYPE_CHIPS.map((c) => (
              <button
                key={c.key}
                className={`chip${qType === c.key ? " sel" : ""}`}
                onClick={() => { setQType(c.key); setQPage(0); }}
              >{c.label}</button>
            ))}
            <span className="lb" style={{ marginLeft: 10 }}>发起人</span>
            {OPERATOR_CHIPS.map((c) => (
              <button
                key={c.key}
                className={`chip${qOperator === c.key ? " sel" : ""}`}
                onClick={() => { setQOperator(c.key); setQPage(0); }}
              >{c.label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                <th>编号</th><th>动作</th><th>对象</th><th>变更内容</th>
                <th>发起人</th><th>标记</th><th>记录时间</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {qRows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                    当前筛选条件下没有高敏操作
                  </td>
                </tr>
              ) : qRows.map((w) => {
                const idx = operationQueue.indexOf(w);
                const status = effStatus(w);
                const isFinal = status !== "pending";
                return (
                  <tr key={w.id} className="click" onClick={() => setWoIdx(idx)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{w.id}</td>
                    <td style={{ fontSize: 12.5 }}>{w.action}</td>
                    <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{w.obj}</td>
                    <td>
                      <span className="a2-ba">
                        <span className="k">变更前</span><span className="o">{w.before}</span>
                        <span className="k">变更后</span><span className="n">{w.after}</span>
                      </span>
                    </td>
                    <td style={{ fontSize: 12 }}>{w.operator}</td>
                    <td>
                      <span className="a2-markers">
                        {operationMarkers(w).map((marker) => (
                          <span key={marker.key} className={marker.className}>{marker.label}</span>
                        ))}
                      </span>
                    </td>
                    <td>
                      <span className="a2-ttl">
                        {w.ts} · 留痕
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isFinal ? (
                        <span className={`bdg ${HIST_TONE[status] ?? "dim"}`}>{HIST_LABEL[status] ?? status}</span>
                      ) : isCurrentOperator(w, principal) ? (
                        <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); withdrawWo(w); }}>撤回本人提案</button>
                      ) : canApprove ? (
                        <>
                          <button
                            className="l-btn sm mc"
                            onClick={(e) => { e.stopPropagation(); approveWo(w); }}
                          >执行</button>{" "}
                          <button
                            className="l-btn sm"
                            onClick={(e) => { e.stopPropagation(); rejectWo(w); }}
                          >取消</button>
                        </>
                      ) : (
                        <span className="bdg dim">
                          待门槛者执行
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* 分页器 */}
        <div className="l-b" style={{ paddingTop: 6, paddingBottom: 0 }}>
          <div className="pager">
            <span className="pager-info">
              {qTotal === 0 ? "无记录" : `显示 ${qStart + 1}–${qEnd} / ${qTotal}`}
            </span>
            <button
              className="pager-btn"
              disabled={qSafePage === 0}
              onClick={() => setQPage(qSafePage - 1)}
            >‹</button>
            <span className="pager-num">{qSafePage + 1} / {qPages}</span>
            <button
              className="pager-btn"
              disabled={qSafePage >= qPages - 1}
              onClick={() => setQPage(qSafePage + 1)}
            >›</button>
            <select
              className="pager-size"
              value={qPerPage}
              onChange={(e) => { setQPerPage(Number(e.target.value)); setQPage(0); }}
            >
              <option value={10}>每页 10</option>
              <option value={20}>每页 20</option>
              <option value={50}>每页 50</option>
            </select>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="atint warn">
            <b>放大资金流出的动作</b>(带 🔥)执行前弹窗里直接给出当前备付金覆盖率和红线对比——
            覆盖率不够时服务器拒绝提交;确认时仍要看当前值有没有恶化。
          </div>
        </div>
      </section>

      {/* ───── (a) 审计日志 + (c) 确认历史 + 机制参数 ───── */}
      <div className="two-col">
        {/* (a) 审计日志 · 只追加 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">审计日志(a)· 只追加</span>
            <span className="sub">· 域、操作者、动作、对象与时间使用同一服务端筛选 · 点行看全字段</span>
            <div className="r">
              {canExport && (
                <button
                  className="l-btn sm"
                  disabled={loading || !!loadError || filteredLogRows.length === 0}
                  title={filteredLogRows.length === 0 ? "当前筛选没有可导出的记录" : undefined}
                  onClick={exportAudit}
                >导出（脱敏）</button>
              )}
            </div>
          </div>
          <div className="l-b" style={{ padding: "10px 20px 0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: 8, marginBottom: 8 }}>
              <label className="field" style={{ margin: 0 }}>
                <span>业务域</span>
                <select
                  className="fld"
                  aria-label="审计业务域"
                  value={filterDraft.domain ?? "all"}
                  onChange={(event) => setFilterDraft((current) => ({ ...current, domain: event.target.value as DomainFilter }))}
                >
                  {DOMAIN_CHIPS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>操作者</span>
                <input className="fld" aria-label="审计操作者" value={filterDraft.operator ?? ""} onChange={(event) => setFilterDraft((current) => ({ ...current, operator: event.target.value }))} placeholder="账号或姓名" />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>动作</span>
                <input className="fld" aria-label="审计动作" value={filterDraft.action ?? ""} onChange={(event) => setFilterDraft((current) => ({ ...current, action: event.target.value }))} placeholder="动作关键词" />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>对象</span>
                <input className="fld" aria-label="审计对象" value={filterDraft.object ?? ""} onChange={(event) => setFilterDraft((current) => ({ ...current, object: event.target.value }))} placeholder="对象编号或类型" />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>开始时间</span>
                <input className="fld" type="datetime-local" aria-label="审计开始时间" value={filterDraft.startTime ?? ""} onChange={(event) => setFilterDraft((current) => ({ ...current, startTime: event.target.value }))} />
              </label>
              <label className="field" style={{ margin: 0 }}>
                <span>结束时间</span>
                <input className="fld" type="datetime-local" aria-label="审计结束时间" value={filterDraft.endTime ?? ""} onChange={(event) => setFilterDraft((current) => ({ ...current, endTime: event.target.value }))} />
              </label>
            </div>
            <div className="row" style={{ gap: 8, justifyContent: "flex-end", marginBottom: 8 }}>
              <button className="l-btn sm" disabled={loading} onClick={() => { setFilterDraft({ domain: "all" }); setAppliedFilter({}); }}>重置</button>
              <button className="l-btn sm mc" disabled={loading} onClick={applyAuditFilters}>查询</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>时间</th><th>操作者</th><th>动作</th><th>对象</th><th>前 → 后</th>
                </tr>
              </thead>
              <tbody>
                {auditLogPager.pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                      暂无审计日志
                    </td>
                  </tr>
                ) : auditLogPager.pageRows.map((l) => {
                  const i = auditLogs.indexOf(l);
                  return (
                    <tr key={l.id} className="click" onClick={() => setLogIdx(i)}>
                      <td className="mono" style={{ fontSize: 11, whiteSpace: "nowrap" }}>{l.ts}</td>
                      <td style={{ fontSize: 11.5 }}>{l.actor} · {l.role}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{l.action}</td>
                      <td style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{l.obj}</td>
                      <td className="mono" style={{ fontSize: 11 }}>{l.delta}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="审计日志"
            page={auditLogPager.page}
            pageSize={auditLogPager.pageSize}
            total={auditLogPager.total}
            rawTotal={auditLogs.length}
            onPageChange={auditLogPager.setPage}
            onPageSizeChange={auditLogPager.setPageSize}
          />
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="atint">
              可见性按角色自动裁剪:客服仅看自己的操作记录;财务看资金域、风控看风控域;
              只读审计可全量查询并脱敏导出。页面最多展示当前筛选最近 500 条;导出超过 5000 条时需缩小筛选范围。
              日志只能看不能改、不能删。
            </div>
          </div>
        </section>

        {/* (c) 执行历史 + 机制参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">执行历史(c)与机制参数</span>
            <span className="sub">· 任一高敏动作的完整操作链可追溯</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>编号</th><th>动作</th><th>终态</th><th>操作 / 留痕</th><th>决策时间</th>
                </tr>
              </thead>
              <tbody>
                {historyPager.pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                      暂无执行历史
                    </td>
                  </tr>
                ) : historyPager.pageRows.map((h) => {
                  const i = operationHistory.indexOf(h);
                  return (
                    <tr key={h.id} className="click" onClick={() => setHistIdx(i)}>
                      <td className="mono">{h.id}</td>
                      <td style={{ fontSize: 12 }}>{h.action}</td>
                      <td>
                        <span className={`bdg ${HIST_TONE[h.st] ?? "dim"}`}>{HIST_LABEL[h.st] ?? h.st}</span>
                      </td>
                      <td style={{ fontSize: 11.5 }}>{h.chain}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{h.t}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="执行历史"
            page={historyPager.page}
            pageSize={historyPager.pageSize}
            total={historyPager.total}
            onPageChange={historyPager.setPage}
            onPageSizeChange={historyPager.setPageSize}
            pageSizeOptions={[4, 8, 12]}
          />
          <div className="l-b" style={{ paddingTop: 8 }}>
            {mechanismParams.map((p) => {
              if (p.key === "reason_required") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="acode lock" title="§1.8 原则二.4 铁律">🔒 强制</span>
                  </div>
                );
              }
              if (p.key === "ttl") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{p.value}</span>
                    {canWrite && <button className="l-btn sm mc" onClick={adjReasonMin}>调整</button>}
                  </div>
                );
              }
              if (p.key === "retention") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub} · {retentionRun
                      ? `最近执行:${retentionRun.evaluatedAt} · 锁:${retentionRun.lockAcquired ? "已取得" : "占用"} · 归档:${retentionRun.archivedRows} · 删除:${retentionRun.deletedRows}`
                      : retentionRunError ? `最近状态读取失败:${retentionRunError}` : "暂无人工执行记录"}</small></span>
                    <span className="v">{p.value}</span>
                    {canWrite && <button className="l-btn sm mc" onClick={adjRet}>调整</button>}
                    {canWrite && <button className="l-btn sm mc" disabled={retentionPending || !overview || !!loadError} onClick={runRetention}>立即清理</button>}
                  </div>
                );
              }
              if (p.key === "confirm_list") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{p.value}</span>
                    <button className="l-btn sm" onClick={() => setActionConfirmListOpen(true)}>看清单</button>
                  </div>
                );
              }
              // schema
              return (
                <div className="a-vrow" key={p.key}>
                  <span className="nm">{p.name}<small>{p.sub}</small></span>
                  <span className="v">{p.value}</span>
                  {canWrite && <button className="l-btn sm mc" onClick={adjSchema}>变更（注册）</button>}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* ───── f-foot ───── */}
      <p className="f-foot">
        <b>分工一句话</b>:这页管「记录谁做了什么 + 操作确认的流程」;「谁能做什么」的授权矩阵在账号页(A1);
        事件叫什么名、带什么字段归事件中台(A4)定义,这页负责落库与可查。
        <b> 执行门槛</b>:资金类 = 财务/超管;风控与账户类 = 风控/超管;
        内容类 = 内容/超管;账号治理与系统参数 = 仅超管。
        应急轨动作（J 域熔断/恢复）按服务端记录的处理时限置顶，超时升级告警到超管。
      </p>

      {/* ───── 高敏动作详情 Drawer ───── */}
      {woIdx !== null && (() => {
        const w = operationQueue[woIdx];
        if (!w) return null;
        const status = effStatus(w);
        const isFinal = status !== "pending";
        return (
          <Drawer
            title={`高敏动作 · ${w.id}`}
            sub={
              <>
                {w.action} · 对象 {w.obj} · 发起人 {w.operator} · 变更前 {w.before} · 变更后 {w.after}
              </>
            }
            onClose={() => setWoIdx(null)}
            footer={
              !isFinal ? (
                canApprove && !isCurrentOperator(w, principal) ? (
                  <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                    <button
                      className="l-btn mc"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => { setWoIdx(null); approveWo(w); }}
                    >执行</button>
                    <button
                      className="l-btn"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => { setWoIdx(null); rejectWo(w); }}
                    >取消</button>
                  </div>
                ) : (
                  <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", textAlign: "center" }}>
                    <span className="bdg dim">
                      {isCurrentOperator(w, principal) ? "需其他具权人员执行" : "待门槛者执行"}
                    </span>
                  </div>
                )
              ) : null
            }
          >
            <div className="l-b" style={{ padding: "4px 0 0" }}>
              <div className="kv"><span className="k">操作理由</span><span className="v" style={{ maxWidth: 360, textAlign: "right" }}>{w.reason}</span></div>
              <div className="kv"><span className="k">记录时间</span><span className="v">{w.ts}{w.sos ? "(应急 SLA)" : "(理由必填留痕)"}</span></div>
              <div className="kv"><span className="k">执行门槛</span><span className="v">{w.roleGate}</span></div>
              <div className="kv"><span className="k">防止重复执行</span><span className="v">同一次提交在 24 小时内重复发送也只会生效一次</span></div>
              <div className="kv"><span className="k">原子性</span><span className="v" style={{ maxWidth: 320, textAlign: "right" }}>确认执行使用一次事务写入目标域；失败则动作保持待处理，目标域不会产生部分结果</span></div>
            </div>
            <div className="atint" style={{ marginTop: 14 }}>
              {w.amplifies ? (
                <>
                  <b>🔥 放大资金流出</b>:提交时备付金覆盖率已过线;放行弹窗会再显示当前覆盖率,
                  恶化到红线下请驳回并注明。
                </>
              ) : w.sos ? (
                <>
                  <b>⚡ 应急轨高敏</b>:涉及熔断、恢复或紧急处置,核对值班授权、影响面和恢复条件后再裁决。
                </>
              ) : w.type === "acct" ? (
                <>
                  <b>账号/权限高敏</b>:A1 新增/禁用管理员、改角色、重置 2FA、强制登出、RBAC 调整都按高敏处理,
                  审核时核对目标账号、申请角色和操作理由。
                </>
              ) : w.type === "param" ? (
                <>
                  <b>参数高敏</b>:参数会影响后续业务规则,审核时核对前后值、影响范围和回滚口径。
                </>
              ) : (
                <>高敏动作:按动作说明核对对象、前后值、影响范围与原因。</>
              )}
            </div>
            {isFinal && (
              <div className="atint" style={{ marginTop: 8 }}>
                动作终态:<span className={`bdg ${HIST_TONE[status] ?? "dim"}`}>{HIST_LABEL[status] ?? status}</span> · 已留痕,无法再次裁决。
              </div>
            )}
          </Drawer>
        );
      })()}

      {/* ───── 审计记录 Drawer ───── */}
      {logIdx !== null && (() => {
        const l = auditLogs[logIdx];
        if (!l) return null;
        const needIdem = l.action.includes("withdraw") || l.action.includes("balance") || l.action.includes("operation_confirmed");
        return (
          <Drawer
            title={`审计记录 · ${l.action}`}
            sub={<>{l.obj} · {l.delta}</>}
            onClose={() => setLogIdx(null)}
          >
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginBottom: 10 }}>
              统一字段结构;只追加,不可改不可删——取证链不可抵赖。
            </div>
            <div className="l-b" style={{ padding: 0 }}>
              <div className="kv"><span className="k">操作者 / 角色</span><span className="v">{l.actor} · {l.role}</span></div>
              <div className="kv"><span className="k">时间</span><span className="v mono">{l.ts}</span></div>
              <div className="kv"><span className="k">对象</span><span className="v">{l.obj}</span></div>
              <div className="kv"><span className="k">前值 → 后值</span><span className="v mono">{l.delta}</span></div>
              <div className="kv"><span className="k">原因</span><span className="v">{l.reason || "—"}</span></div>
              <div className="kv"><span className="k">IP</span><span className="v mono">{l.ip}</span></div>
              <div className="kv"><span className="k">操作 / 留痕</span><span className="v">{l.actor} / 对应角色或超管</span></div>
              <div className="kv"><span className="k">防重号</span><span className="v mono">{l.idempotencyKey || (needIdem ? "idem-… (资金类)" : "—")}</span></div>
            </div>
            <div className="atint" style={{ marginTop: 14 }}>
              隐私字段(手机号/地址)在事件里只存哈希或 ID,导出时再脱敏一层。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 操作链 Drawer ───── */}
      {histIdx !== null && (() => {
        const h = operationHistory[histIdx];
        if (!h) return null;
        return (
          <Drawer
            title={`操作链 · ${h.id}`}
            sub={
              <>
                {h.action} · 终态 <span className={`bdg ${HIST_TONE[h.st] ?? "dim"}`} style={{ marginLeft: 4 }}>{HIST_LABEL[h.st] ?? h.st}</span>
                {" · "}{h.chain} · {h.t}
              </>
            }
            onClose={() => setHistIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 10 }}>
              {h.note}
            </div>
            <div className="atint cyan">
              任何高敏动作的完整操作链(提案→决策→落库)都能这样追溯;这是内部问责的取证地基。
            </div>
          </Drawer>
        );
      })()}

      {/* ───── 9 大类操作确认清单 Drawer ───── */}
      {mcListOpen && (
        <Drawer
          title="操作确认适用动作清单(9 大类汇总)"
          sub="下列动作一律进确认门,理由必填"
          onClose={() => setActionConfirmListOpen(false)}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl">
              <thead>
                <tr>
                  <th>类别</th><th>例子</th><th>执行门槛</th>
                </tr>
              </thead>
              <tbody>
                {confirmCategories.map((c) => (
                  <tr key={c.cat}>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{c.cat}</td>
                    <td style={{ fontSize: 12 }}>{c.examples}</td>
                    <td style={{ fontSize: 12 }}>{c.roleGate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="atint" style={{ marginTop: 14 }}>
            分界线:是否放大资金流出 / 变更权限边界 / 触及用户资产或合规态。
            强制登出、标记、只读、风控自动检测这类即时止血动作不进门(即时生效 + 留痕)。
          </div>
        </Drawer>
      )}
    </>
  );
}
