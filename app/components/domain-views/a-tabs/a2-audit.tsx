"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { PhoneCalibrationReview } from "../e-tabs/phone-calibration-review";

/**
 * A2 操作记录与审批中心 — design_handoff_a_domain/A2 设计稿 port(387 行 + SPEC §4 矩阵 14 行权威 + §7 三铁律)。
 *
 * 全后台最高频工作台:高敏操作动态 + 审计日志 + 执行历史 + 机制参数四块,落 9 大类操作确认清单。
 *
 * A 域三铁律(A2 实装,server-canonical 镜像):
 *  ① append-only — 审计日志只导出不改/删,导出按钮仍需操作确认(强制留痕)。无 endpoint = 无 UI;
 *  ② reason-required — 所有高敏动作提交前必须填操作理由,弹窗校验不通过不写 store;
 *  ③ 确认即执行 + 防重复提交 — 同一命令 24 小时内重复提交不重复生效，失败时保持待处理且目标域零副作用。
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
import { TabGroup } from "@/app/components/kit/tab-group";
import { DataListPager, Drawer, useDataListPager } from "../design-kit";
import {
  approveA2Operation,
  createA2CommandKey,
  exportA2Audit,
  fetchA2RetentionLatest,
  fetchA2RetentionPreview,
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
  type RetentionPreview,
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
  { key: "acct", label: "账号/处置" },
  { key: "sos", label: "⚡ 应急" },
];

const OPERATOR_CHIPS: { key: QOperator; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "财务", label: "财务" },
  { key: "风控", label: "风控" },
  { key: "增长", label: "增长" },
  { key: "内容", label: "内容" },
  { key: "客服", label: "客服" },
  { key: "超管", label: "超级管理员" },
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
    markers.push({ key: "amplifies", label: "🔥 多付钱", className: "a2-amp" });
  }
  if (w.sos) {
    markers.push({ key: "sos", label: "⚡ 应急", className: "a2-sos" });
  }
  if (markers.length > 0) {
    return markers;
  }
  if (w.type === "acct") {
    return [{ key: "acct", label: "账号/权限", className: "a2-sensitive acct" }];
  }
  if (w.type === "param") {
    return [{ key: "param", label: "参数", className: "a2-sensitive param" }];
  }
  if (w.type === "fund") {
    return [{ key: "fund", label: "资金", className: "a2-sensitive fund" }];
  }
  return [{ key: "general", label: "敏感操作", className: "a2-sensitive" }];
}

function normalizeOperatorIdentity(value: string | null | undefined) {
  return (value ?? "").trim().toLocaleLowerCase();
}

function isCurrentOperator(w: A2OperationRow, principal: AuthPrincipal) {
  const current = normalizeOperatorIdentity(principal.name);
  return w.mine || (!!current && current === normalizeOperatorIdentity(w.operator));
}

/* ────────────────── 主组件 ────────────────── */

/** 详情与执行确认均完整展示已持久化的前后值。 */
export function A2ChangeReview({ before, after }: { before: string; after: string }) {
  const labels: Record<string, string> = {
    skuId: "商品编号", id: "商品编号", name: "商品名称", tier: "商品档位", tagline: "卖点", badge: "角标",
    gpu: "GPU", vram: "显存", hashRate: "算力", power: "功耗", datacenter: "数据中心", uptime: "在线率",
    warranty: "保修", phoneDailyEarn: "手机日产收益", phoneDailyEarnNex: "手机日产 UVT", price: "价格",
    dailyEarn: "日产收益", dailyEarnNex: "日产 UVT", shareYieldMin: "份额收益下限", shareYieldMax: "份额收益上限",
    baseRate: "收益展示文字", sold: "累计销量", stock: "库存", rating: "评分", reviews: "评价数",
    aiImageGenPerMin: "图像生成性能", aiLlmTokensPerSec: "大模型推理性能", aiVideoMinPerHour: "视频渲染性能",
    aiFineTuneMins: "LoRA 微调性能", aiUnlocks: "解锁算力池", features: "产品特性", generation: "产品代际",
    lifecycle: "生命周期", supersededBy: "后继商品", tradeinDiscount: "换新折扣", unlockPhase: "解锁阶段",
    purchaseGate: "购买限制", imageAssetId: "产品图标识", imageObjectKey: "产品图对象键", imagePreviewUrl: "产品图预览",
    tag: "商品标签", status: "商城状态", inventoryMode: "库存模式", expectedUpdatedAt: "修改前的更新时间",
    updatedAt: "更新时间", trialEligible: "允许试用", productType: "商品类型", reason: "操作理由", operator: "操作人",
    rankMin: "最低 V 等级", directsMin: "最低有效直接邀请", teamUsdtMin: "最低团队业绩", mode: "条件组合",
    activeDirectMin: "最低有效直接邀请", teamVolumeMin: "最低团队业绩",
    enforce: "启用限制", quotaCap: "总配额", quotaSold: "已用配额", quotaPeriod: "配额周期",
  };
  const format = (value: unknown): string => {
    if (value === null) return "未设置";
    if (Array.isArray(value)) return value.map(format).join("\n");
    if (typeof value === "object") return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${labels[key] ?? key}：${format(item)}`).join("\n") || "无（新建）";
    return typeof value === "boolean" ? (value ? "是" : "否") : String(value);
  };
  const review = (value: string) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? format(parsed) : value;
    } catch { return value; }
  };
  return <dl aria-label="完整变更内容" style={{ display: "grid", gap: 8, margin: "12px 0" }}>
    <dt>变更前</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review(before)}</dd>
    <dt>变更后</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review(after)}</dd>
  </dl>;
}

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
  const canWithdraw = principal.authorities.includes("platform_a2_proposal_create");
  const [overview, setOverview] = useState<A2Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filterDraft, setFilterDraft] = useState<A2AuditFilter>({ domain: "all" });
  const [appliedFilter, setAppliedFilter] = useState<A2AuditFilter>({});
  const [routeFilterReady, setRouteFilterReady] = useState(false);
  const [retentionRun, setRetentionRun] = useState<RetentionExecution | null>(null);
  const [retentionRunError, setRetentionRunError] = useState<string | null>(null);
  const [retentionPreview, setRetentionPreview] = useState<RetentionPreview | null>(null);
  const [retentionPreviewError, setRetentionPreviewError] = useState<string | null>(null);
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

  /* 操作前预览:与执行同谓词的服务端计数,让「立即清理」在点击前就能说清本次范围(缺陷 99)。 */
  const refreshRetentionPreview = useCallback(async () => {
    try {
      setRetentionPreviewError(null);
      setRetentionPreview(await fetchA2RetentionPreview());
    } catch (error) {
      setRetentionPreview(null);
      setRetentionPreviewError(displayAdminError(error));
    }
  }, []);

  useEffect(() => {
    void refreshRetentionRun();
  }, [refreshRetentionRun]);

  useEffect(() => {
    void refreshRetentionPreview();
  }, [refreshRetentionPreview]);

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
    if (!canWrite) { toast("你没有清理操作记录的权限"); return; }
    // 服务端预览拿不到时不允许执行:操作前无法说清范围的高风险动作,宁可挡住。
    if (!retentionPreview) {
      toast(retentionPreviewError
        ? `清理范围加载失败，暂不能清理：${retentionPreviewError}`
        : "正在加载清理范围，请稍后重试");
      return;
    }
    const preview = retentionPreview;
    const commandKey = createA2CommandKey("a2-retention-run");
    openActionConfirm({
      action: <>归档并清理已到期操作记录</>,
      detail: (
        <>
          按保留期 {preview.retentionMonths} 个月计算，<b>可清理 {preview.eligibleRows} 条</b>
          {preview.earliestExpireAt ? <>（最早到期 <b>{preview.earliestExpireAt}</b>）</> : null}。
          未到期的 <b>{preview.notYetExpiredRows}</b> 条和旧版历史记录 <b>{preview.legacyRowsWithoutExpireAt}</b> 条不受影响。
          到期记录会先长期归档，再从在线列表移除，<b>不可撤销</b>。需要 <b>{preview.approvalAuthority}</b> 权限。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        setRetentionPending(true);
        try {
          const result = await runA2RetentionNow(reason, commandKey);
          setRetentionRun(result);
          toast(result.lockAcquired
            ? `清理完成：已归档 ${result.archivedRows} 条，从在线列表移除 ${result.deletedRows} 条`
            : "已有清理正在进行，本次没有删除任何记录");
          void refreshRetentionPreview();
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
    if (w.phoneCalibrationError) { toast(w.phoneCalibrationError); return; }
    const commandKey = createA2CommandKey(`a2-approve-${w.id}`);
    openActionConfirm({
      action: <>确认执行 · {w.id}({w.action})</>,
      detail: (
        <>
          对象 <b>{w.obj}</b> · 发起人 {w.operator}。
          <A2ChangeReview before={w.before} after={w.after} />
          确认后立即执行
          {w.sos ? (<>，<b>并通知应急值班人员</b></>) : null}。<br />
          谁能执行：<b>{w.roleGate}</b>
          {w.phoneCalibrationProposal && <PhoneCalibrationReview proposal={w.phoneCalibrationProposal} />}
          {w.phoneCalibrationError && <p role="alert">{w.phoneCalibrationError}</p>}
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
          toast(`${w.id} 已执行`);
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
          取消后不能恢复，如需再做请重新发起。
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
          toast(`${w.id} 已取消`);
        } catch (error) {
          toast(`取消失败:${displayAdminError(error)}`);
          throw error;
        }
      },
    });
  };

  const withdrawWo = (w: A2OperationRow) => {
    if (!canWithdraw) { toast("你没有撤回申请的权限"); return; }
    const commandKey = createA2CommandKey(`a2-withdraw-${w.id}`);
    openActionConfirm({
      action: <>撤回我的申请 · {w.id}</>,
      detail: <>撤回后原操作不会执行。只有申请人本人能撤回。</>,
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
          toast(`${w.id} 已撤回`);
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
      action: "导出操作记录",
      detail: (
        <>

          导出当前筛选出的记录，隐私信息会被隐藏。导出操作本身也会被记录。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason) => {
        try {
          const file = await exportA2Audit(reason, appliedFilter, commandKey);
          await refreshOverview();
          toast(`已下载 ${file.fileName}`);
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
          当前 <b>{cur}</b> · 可设 8–200 字。所有确认弹窗里的理由不够这个字数就不能提交，已有记录不受影响。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      edit: { kind: "number", current: cur, unit: "字", min: 8, max: 200, step: 1 },
      run: async (reason, v) => {
        const validation = validateA2MechanismValue("ttl", v ?? "");
        if (!validation.ok) {
          toast(`没有提交 · ${validation.message}`);
          throw new Error(validation.message);
        }
        try {
          await updateA2MechanismParam("ttl", validation.value, reason, commandKey);
          const next = await refreshOverview();
          const readback = next.mechanismParams.find((item) => item.key === "ttl")?.value.match(/\d+/)?.[0];
          if (readback !== validation.value) throw new Error("A2_MECHANISM_WRITE_NOT_CONFIRMED");
          toast(`理由最短长度已改为 ${validation.value} 字`);
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
      action: "操作记录保留期",
      detail: (
        <>
          当前 <b>{cur}</b> · 可设 13–36 个月（至少覆盖一个完整的 12 个月运营周期）。只对之后的新记录生效。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      edit: { kind: "number", current: cur, unit: "月", min: 13, max: 36, step: 1 },
      run: async (reason, v) => {
        const validation = validateA2MechanismValue("retention", v ?? "");
        if (!validation.ok) {
          toast(`没有提交 · ${validation.message}`);
          throw new Error(validation.message);
        }
        try {
          await updateA2MechanismParam("retention", validation.value, reason, commandKey);
          const next = await refreshOverview();
          const readback = next.mechanismParams.find((item) => item.key === "retention")?.value.match(/\d+/)?.[0];
          if (readback !== validation.value) throw new Error("A2_MECHANISM_WRITE_NOT_CONFIRMED");
          toast(`保留期已改为 ${validation.value} 个月`);
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
      action: "升级记录字段版本",
      detail: (
        <>

          只能逐版升级到已登记的版本（目前有 v3、v4）。新事件或字段请先在「用户行为事件」登记。
        </>
      ),
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      edit: { kind: "text", current: cur, unit: "" },
      run: async (reason, v) => {
        const validation = validateA2MechanismValue("schema", v ?? "", cur);
        if (!validation.ok) {
          toast(`没有提交 · ${validation.message}`);
          throw new Error(validation.message);
        }
        try {
          await updateA2MechanismParam("schema", validation.value, reason, commandKey);
          const next = await refreshOverview();
          const readback = parseA2SchemaVersion(next.mechanismParams.find((item) => item.key === "schema")?.value);
          if (readback !== validation.value) throw new Error("A2_MECHANISM_WRITE_NOT_CONFIRMED");
          toast(`字段版本已升级为 ${validation.value}`);
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
          <div className="k">待确认操作</div>
          <div className="v">{stats.pendingTickets} 件</div>
          <div className="sub">其中资金类 {stats.fundTickets} 件</div>
        </div>
        <div className="f-stat danger">
          <div className="k">应急操作</div>
          <div className="v">{stats.sosTickets} 件</div>
          <div className="sub">紧急停用与恢复，优先处理</div>
        </div>
        <div className="f-stat">
          <div className="k">今日操作记录</div>
          <div className="v">{stats.todayAuditEvents.toLocaleString()} 条</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">本周执行 / 取消</div>
          <div className="v">{stats.weeklyApproved} / {stats.weeklyRejected}</div>
          <div className="sub">另有 {stats.weeklyExpired} 件过期 · {stats.weeklyWithdrawn} 件撤回</div>
        </div>
      </div>

      {(loading || loadError) && (
        <div className={`atint${loadError ? " warn" : ""}`} data-module-health-state={loadError ? "error" : undefined} style={{ margin: "12px 0" }}>
          {loadError ? (
            <>
              操作记录加载失败，旧数据已清空，所有操作已暂停：{loadError}
              <button className="l-btn sm" style={{ marginLeft: 10 }} onClick={() => void refreshOverview().catch(() => undefined)}>重新读取</button>
            </>
          ) : "正在加载…"}
        </div>
      )}

      {/* ───── (b) 高敏操作动态 ───── */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">待确认的操作</span>
          <span className="sub">· 资金类排在最前</span>
          <div className="r" style={{ display: "flex", gap: 10 }}>
            <TabGroup label="操作类型" labelClassName="lb" value={qType} items={TYPE_CHIPS.map((c) => c.key)}
              onSelect={(key) => { setQType(key); setQPage(0); }} className="chips"
              itemClassName={(_key, selected) => `chip${selected ? " sel" : ""}`}>
              {(key) => TYPE_CHIPS.find((c) => c.key === key)?.label}
            </TabGroup>
            <TabGroup label="发起人" labelClassName="lb" value={qOperator} items={OPERATOR_CHIPS.map((c) => c.key)}
              onSelect={(key) => { setQOperator(key); setQPage(0); }} className="chips"
              itemClassName={(_key, selected) => `chip${selected ? " sel" : ""}`}>
              {(key) => OPERATOR_CHIPS.find((c) => c.key === key)?.label}
            </TabGroup>
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

                    没有符合条件的待确认操作
                  </td>
                </tr>
              ) : qRows.map((w) => {
                const idx = operationQueue.indexOf(w);
                const status = effStatus(w);
                const isFinal = status !== "pending";
                return (
                  <tr key={w.id} className="click" onClick={() => setWoIdx(idx)}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{w.id}</td>
                    <td style={{ fontSize: 12.5 }}>{nexGridBrandText(w.action)}</td>
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
                        {w.ts}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {isFinal ? (
                        <span className={`bdg ${HIST_TONE[status] ?? "dim"}`}>{HIST_LABEL[status] ?? status}</span>
                      ) : isCurrentOperator(w, principal) ? (
                        <button className="l-btn sm" disabled={!canWithdraw} onClick={(e) => { e.stopPropagation(); withdrawWo(w); }}>撤回我的申请</button>
                      ) : canApprove ? (
                        <>
                          <button
                            className="l-btn sm mc"
                            disabled={!!w.phoneCalibrationError}
                            onClick={(e) => { e.stopPropagation(); approveWo(w); }}
                          >执行</button>{" "}
                          <button
                            className="l-btn sm"
                            onClick={(e) => { e.stopPropagation(); rejectWo(w); }}
                          >取消</button>
                        </>
                      ) : (
                        <span className="bdg dim">
                          等待有权限的人执行
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
            <b>带 🔥 的操作会让平台多付钱</b>，执行时弹窗会显示当前兑付覆盖率，低于红线将无法执行。
          </div>
        </div>
      </section>

      {/* ───── (a) 审计日志 + (c) 确认历史 + 机制参数 ───── */}
      <div className="two-col">
        {/* (a) 审计日志 · 只追加 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">操作记录</span>
            <span className="sub">· 点击一行查看详情</span>
            <div className="r">
              {canExport && (
                <button
                  className="l-btn sm"
                  disabled={loading || !!loadError || filteredLogRows.length === 0}
                  title={filteredLogRows.length === 0 ? "当前筛选没有可导出的记录" : undefined}
                  onClick={exportAudit}
                >导出</button>
              )}
            </div>
          </div>
          <div className="l-b" style={{ padding: "10px 20px 0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(150px, 1fr))", gap: 8, marginBottom: 8 }}>
              <label className="field" style={{ margin: 0 }}>
                <span>模块</span>
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
                      暂无操作记录
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
            label="操作记录"
            page={auditLogPager.page}
            pageSize={auditLogPager.pageSize}
            total={auditLogPager.total}
            rawTotal={auditLogs.length}
            onPageChange={auditLogPager.setPage}
            onPageSizeChange={auditLogPager.setPageSize}
          />
          <div className="l-b" style={{ paddingTop: 8 }}>
            <div className="atint">

              各角色只能看到自己负责范围的记录（客服只看自己的）。最多显示最近 500 条，导出不超过 5000 条，超出请缩小筛选范围。
              记录不能修改或删除，超过保留期的才会归档移出。
            </div>
          </div>
        </section>

        {/* (c) 执行历史 + 机制参数 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">处理历史与记录设置</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 520 }}>
              <thead>
                <tr>
                  <th>编号</th><th>动作</th><th>结果</th><th>处理人</th><th>处理时间</th>
                </tr>
              </thead>
              <tbody>
                {historyPager.pageRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                      暂无处理历史
                    </td>
                  </tr>
                ) : historyPager.pageRows.map((h) => {
                  const i = operationHistory.indexOf(h);
                  return (
                    <tr key={h.id} className="click" onClick={() => setHistIdx(i)}>
                      <td className="mono">{h.id}</td>
                      <td style={{ fontSize: 12 }}>{nexGridBrandText(h.action)}</td>
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
            label="处理历史"
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
                    <span className="acode lock" title="系统固定，不能关闭">🔒 强制</span>
                  </div>
                );
              }
              if (p.key === "ttl") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{operatorCopyText(p.value)}</span>
                    {canWrite && <button className="l-btn sm mc" onClick={adjReasonMin}>调整</button>}
                  </div>
                );
              }
              if (p.key === "retention") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub} · {retentionPreview
                      ? `可清理 ${retentionPreview.eligibleRows} 条${retentionPreview.earliestExpireAt ? `（最早到期 ${retentionPreview.earliestExpireAt}）` : ""} · 未到期 ${retentionPreview.notYetExpiredRows} 条 · 旧版历史 ${retentionPreview.legacyRowsWithoutExpireAt} 条`
                      : retentionPreviewError ? `清理范围加载失败，暂不能清理：${retentionPreviewError}` : "正在加载清理范围"} · {retentionRun
                      ? `上次清理 ${retentionRun.evaluatedAt}${retentionRun.lockAcquired ? "" : "（当时有其他清理在进行）"} · 归档 ${retentionRun.archivedRows} 条 · 移除 ${retentionRun.deletedRows} 条`
                      : retentionRunError ? `上次清理情况加载失败：${retentionRunError}` : "还没有手动清理过"}</small></span>
                    <span className="v">{operatorCopyText(p.value)}</span>
                    {canWrite && <button className="l-btn sm mc" onClick={adjRet}>调整</button>}
                    {canWrite && <button className="l-btn sm mc" disabled={retentionPending || !overview || !!loadError || !retentionPreview} onClick={runRetention}>立即清理</button>}
                  </div>
                );
              }
              if (p.key === "confirm_list") {
                return (
                  <div className="a-vrow" key={p.key}>
                    <span className="nm">{p.name}<small>{p.sub}</small></span>
                    <span className="v">{operatorCopyText(p.value)}</span>
                    <button className="l-btn sm" onClick={() => setActionConfirmListOpen(true)}>查看清单</button>
                  </div>
                );
              }
              // schema
              return (
                <div className="a-vrow" key={p.key}>
                  <span className="nm">{p.name}<small>{p.sub}</small></span>
                  <span className="v">{operatorCopyText(p.value)}</span>
                  {canWrite && <button className="l-btn sm mc" onClick={adjSchema}>升级版本</button>}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <p className="f-foot">
        <b>谁能执行</b>：资金类由财务执行，风控和账户类由风控执行，内容类由内容运营执行，账号和系统设置只有超级管理员能执行；超级管理员可执行全部。应急操作排在最前，超时会提醒超级管理员。
      </p>

      {/* ───── 高敏动作详情 Drawer ───── */}
      {woIdx !== null && (() => {
        const w = operationQueue[woIdx];
        if (!w) return null;
        const status = effStatus(w);
        const isFinal = status !== "pending";
        return (
          <Drawer
            title={`待确认操作 · ${w.id}`}
            sub={
              <>
                {w.action} · 对象 {w.obj} · 发起人 {w.operator}
              </>
            }
            onClose={() => setWoIdx(null)}
            footer={
              !isFinal ? (
                canApprove && !isCurrentOperator(w, principal) ? (
                  <div style={{ display: "flex", gap: 8, padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
                    <button
                      className="l-btn mc"
                      disabled={!!w.phoneCalibrationError}
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
                      {isCurrentOperator(w, principal) ? "需由其他有权限的人执行" : "等待有权限的人执行"}
                    </span>
                  </div>
                )
              ) : null
            }
          >
            <div className="l-b" style={{ padding: "4px 0 0" }}>
              <A2ChangeReview before={w.before} after={w.after} />
              {w.phoneCalibrationProposal && <PhoneCalibrationReview proposal={w.phoneCalibrationProposal} />}
              {w.phoneCalibrationError && <p role="alert">{w.phoneCalibrationError}</p>}
              <div className="kv"><span className="k">操作理由</span><span className="v" style={{ maxWidth: 360, textAlign: "right" }}>{w.reason}</span></div>
              <div className="kv"><span className="k">记录时间</span><span className="v">{w.ts}{w.sos ? "（应急，优先处理）" : ""}</span></div>
              <div className="kv"><span className="k">谁能执行</span><span className="v">{w.roleGate}</span></div>
            </div>
            <div className="atint" style={{ marginTop: 14 }}>
              {w.amplifies ? (
                <>
                  <b>🔥 会让平台多付钱</b>：执行时会再次显示当前兑付覆盖率，如已跌破红线请取消并注明原因。
                </>
              ) : w.sos ? (
                <>
                  <b>⚡ 应急操作</b>：涉及紧急停用或恢复，请核对值班授权、影响范围和恢复条件后再处理。
                </>
              ) : w.type === "acct" ? (
                <>
                  <b>账号/权限</b>：请核对目标账号、申请的角色和操作理由。
                </>
              ) : w.type === "param" ? (
                <>
                  <b>参数</b>：请核对修改前后的值和影响范围。
                </>
              ) : (
                <>请核对操作对象、修改前后的值和理由。</>
              )}
            </div>
            {isFinal && (
              <div className="atint" style={{ marginTop: 8 }}>
                已处理：<span className={`bdg ${HIST_TONE[status] ?? "dim"}`}>{HIST_LABEL[status] ?? status}</span>，不能再次处理。
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
            title={`操作记录 · ${l.action}`}
            sub={<>{l.obj} · {l.delta}</>}
            onClose={() => setLogIdx(null)}
          >

            <div className="l-b" style={{ padding: 0 }}>
              <div className="kv"><span className="k">操作者 / 角色</span><span className="v">{l.actor} · {l.role}</span></div>
              <div className="kv"><span className="k">时间</span><span className="v mono">{l.ts}</span></div>
              <div className="kv"><span className="k">对象</span><span className="v">{l.obj}</span></div>
              <div className="kv"><span className="k">前值 → 后值</span><span className="v mono">{l.delta}</span></div>
              <div className="kv"><span className="k">原因</span><span className="v">{l.reason || "—"}</span></div>
              <div className="kv"><span className="k">IP</span><span className="v mono">{l.ip}</span></div>
              <div className="kv"><span className="k">请求编号</span><span className="v mono">{l.idempotencyKey || (needIdem ? "缺失" : "—")}</span></div>
            </div>
            <div className="atint" style={{ marginTop: 14 }}>
              手机号、地址等隐私信息只以加密编号保存，导出时也会隐藏。
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
            title={`处理过程 · ${h.id}`}
            sub={
              <>
                {h.action} · 结果 <span className={`bdg ${HIST_TONE[h.st] ?? "dim"}`} style={{ marginLeft: 4 }}>{HIST_LABEL[h.st] ?? h.st}</span>
                {" · "}{h.chain} · {h.t}
              </>
            }
            onClose={() => setHistIdx(null)}
          >
            <div className="atint" style={{ marginBottom: 10 }}>
              {h.note}
            </div>

          </Drawer>
        );
      })()}

      {/* ───── 9 大类操作确认清单 Drawer ───── */}
      {mcListOpen && (
        <Drawer
          title="需要确认的操作（9 类）"
          sub="以下操作都要填写理由并确认"
          onClose={() => setActionConfirmListOpen(false)}
        >
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl">
              <thead>
                <tr>
                  <th>类别</th><th>例子</th><th>谁能执行</th>
                </tr>
              </thead>
              <tbody>
                {confirmCategories.map((c) => (
                  <tr key={c.cat}>
                    <td style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-2)" }}>{operatorCopyText(c.cat)}</td>
                    <td style={{ fontSize: 12 }}>{operatorCopyText(c.examples)}</td>
                    <td style={{ fontSize: 12 }}>{operatorCopyText(c.roleGate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="atint" style={{ marginTop: 14 }}>
            判断标准：是否会让平台多付钱、改变权限、动到用户资产或合规状态。强制登出、标记、查看和风控自动检测等止损操作无需确认，立即生效并记录。
          </div>
        </Drawer>
      )}
    </>
  );
}
