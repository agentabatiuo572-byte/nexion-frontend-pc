"use client";

/**
 * L 数据与分析 BI — design_handoff_l_domain 设计稿 port(2026-06-10 重构)。
 * 5 子页:L1 KPI 看板 / L2 漏斗·Cohort·留存 / L3 财务报表 / L4 设备·任务·网络报表 / L5 导出 & 监管报告。
 * 读侧无写权威:口径全部单一源派生(KPIS/FUNNEL/REVENUE/LEDGER/LIABILITIES/MATURITY/PHASES/F5);
 * 写动作仅导出/监管报告/排程模板类,真写统一走 L 后端接口并由后端审计留痕;
 * 聚合导出仍需操作确认(confirm + 审计);视图参数普通确认批(ViewParamModal,会话级)。操作确认 显式 edit 契约同全域。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import "./l-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { L1HeaderActions, L1Kpi } from "./l-tabs/l1-kpi";
import { L2HeaderActions, L2Funnel } from "./l-tabs/l2-funnel";
import { L3HeaderActions, L3Finance } from "./l-tabs/l3-finance";
import { L4HeaderActions, L4Ops } from "./l-tabs/l4-ops";
import { readL4Operations } from "./l-tabs/l4-live-data";
import { L5HeaderActions, L5Export } from "./l-tabs/l5-export";
import { L6HeaderActions, L6BehaviorHeatmap } from "./l-tabs/l6-behavior-heatmap";
import type { LCtx, ActionConfirmReq } from "./l-tabs/types";
import { allowedAggregateExportOptions, canAccessBiReportType, canExportBiReports } from "./l-tabs/l1-l2-live-data";
import { fetchLBiOverview, lBiActions, type L2FunnelQuery, type L3FinanceQuery, type L4OperationsQuery, type LBiData, type LModuleCode } from "@/lib/admin/l-client";
import { displayAdminError, formatAdminApiError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";

const FOLD: Record<string, string> = { L1: "L1", L2: "L2", L3: "L3", L4: "L4", L5: "L5", L6: "L6" };

export function LDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "L1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [biData, setBiData] = useState<LBiData | null>(null);
  const [biLoading, setBiLoading] = useState(true);
  const [biError, setBiError] = useState<string | null>(null);
  const [l2Query, setL2Query] = useState<L2FunnelQuery>({});
  const [l2SliceExportable, setL2SliceExportable] = useState(true);
  const [l3Query, setL3Query] = useState<L3FinanceQuery>({ period: "month" });
  const [l4Query, setL4Query] = useState<L4OperationsQuery>({ period: "week", phase: "ALL" });
  const session = useAdminAuth((state) => state.session);
  const aggregateExportOptions = useMemo(
    () => allowedAggregateExportOptions(session?.role, session?.authorities ?? []),
    [session?.role, session?.authorities],
  );

  const reloadBi = useCallback(async () => {
    if (tab === "L4" && l4Query.period === "custom" && (!l4Query.from || !l4Query.to)) {
      setBiLoading(false);
      setBiError(null);
      return;
    }
    setBiLoading(true);
    setBiError(null);
    setBiData(null);
    try {
      const nextData = await fetchLBiOverview(
        tab as LModuleCode,
        tab === "L3" ? l3Query : undefined,
        tab === "L4" ? l4Query : undefined,
      );
      if (tab === "L4" && !readL4Operations(nextData.l4)) {
        throw new Error(formatAdminApiError("L4_RESPONSE_INVALID", "L4_RESPONSE_INVALID"));
      }
      setBiData(nextData);
    } catch (error) {
      setBiError(displayAdminError(error));
    } finally {
      setBiLoading(false);
    }
  }, [l3Query, l4Query, tab]);

  useEffect(() => {
    void reloadBi();
  }, [reloadBi]);

  const ctx: LCtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    biData,
    biLoading,
    biError,
    reloadBi,
    biActions: lBiActions,
    canExport: canExportBiReports(session?.role, session?.authorities ?? [], tab),
    canExportFinanceDetail: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l3_export_detail"),
    canApproveExportTasks: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l5_task_approve"),
    canExportNetworkTree: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l4_export_tree"),
    canGenerateRegulatory: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l5_regulatory_generate"),
    availableAggregateExportTypes: aggregateExportOptions.map((option) => option.label),
    canAccessReportType: (reportType) => canAccessBiReportType(session?.role, session?.authorities ?? [], reportType),
    l2Query,
    setL2Query,
    l2SliceExportable,
    setL2SliceExportable,
    l3Query,
    setL3Query,
    l4Query,
    setL4Query,
  };

  const right =
    tab === "L1" ? <L1HeaderActions ctx={ctx} />
    : tab === "L2" ? <L2HeaderActions ctx={ctx} />
    : tab === "L3" ? <L3HeaderActions ctx={ctx} />
    : tab === "L4" ? <L4HeaderActions ctx={ctx} />
    : tab === "L5" ? <L5HeaderActions ctx={ctx} />
    : <L6HeaderActions ctx={ctx} />;

  return (
    <div className="dkpage ldom">
      <DomainHeader {...meta} right={right} />

      {tab === "L1" && <L1Kpi ctx={ctx} />}
      {tab === "L2" && <L2Funnel ctx={ctx} />}
      {tab === "L3" && <L3Finance ctx={ctx} />}
      {tab === "L4" && <L4Ops ctx={ctx} />}
      {tab === "L5" && <L5Export ctx={ctx} />}
      {tab === "L6" && <L6BehaviorHeatmap ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          edit={mc.edit}
          businessForm={mc.businessForm}
          completionCopy={mc.completionCopy}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue, businessValue) => {
            const req = mc;
            setActionConfirm(null);
            void Promise.resolve(req.run(reason, newValue, businessValue)).catch((error) => {
              setToast(error instanceof Error ? displayAdminError(error) : "操作失败");
            });
          }}
        />
      )}
      {toastNode}
    </div>
  );
}
