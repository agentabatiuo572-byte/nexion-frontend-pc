"use client";

/**
 * L 数据与分析 — design_handoff_l_domain 设计稿 port(2026-06-10 重构)。
 * 5 子页:L1 关键指标 / L2 漏斗·Cohort·留存 / L3 财务报表 / L4 设备·任务·网络报表 / L5 数据导出与监管报告。
 * 读侧无写权威:口径全部单一源派生(KPIS/FUNNEL/REVENUE/LEDGER/LIABILITIES/MATURITY/PHASES/F5);
 * 写动作仅导出/监管报告/排程模板类,真写统一走 L 后端接口并由后端审计留痕;
 * 聚合导出仍需操作确认(confirm + 审计);L1 视图参数是本地小窗,不走确认。操作确认 显式 edit 契约同全域。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./l-domain.css";
import { RdPage } from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { L1Kpi } from "./l-tabs/l1-kpi";
import type { L1ExportSource } from "./l-tabs/l1-export-contract";
import { L2HeaderActions, L2Funnel } from "./l-tabs/l2-funnel";
import { L3HeaderActions, L3Finance } from "./l-tabs/l3-finance";
import { L4HeaderActions, L4Ops } from "./l-tabs/l4-ops";
import { readL4Operations } from "./l-tabs/l4-live-data";
import { L5HeaderActions, L5Export } from "./l-tabs/l5-export";
import { L6HeaderActions, L6BehaviorHeatmap } from "./l-tabs/l6-behavior-heatmap";
import type { LCtx, ActionConfirmReq } from "./l-tabs/types";
import { allowedAggregateExportOptions, canAccessBiReportType, canExportBiReports } from "./l-tabs/l1-l2-live-data";
import { fetchLBiOverview, isLOutcomeUnknownError, lBiActions, type L2FunnelQuery, type L3FinanceQuery, type L4OperationsQuery, type LBiData, type LModuleCode } from "@/lib/admin/l-client";
import { displayAdminError, displayAdminReadError, formatAdminApiError } from "@/lib/admin/error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";

const FOLD: Record<string, string> = { L1: "L1", L2: "L2", L3: "L3", L4: "L4", L5: "L5", L6: "L6" };

export function LDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "L1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [biSnapshot, setBiData] = useState<LBiData | null>(null);
  const [biOwner, setBiOwner] = useState<unknown>(null);
  const [biLoading, setBiLoading] = useState(true);
  const [biError, setBiError] = useState<string | null>(null);
  const [l1ExportSource, setL1ExportSource] = useState<L1ExportSource | null>(null);
  const [l2Query, setL2Query] = useState<L2FunnelQuery>({});
  const [l2SliceExportable, setL2SliceExportable] = useState(true);
  const [l3Query, setL3Query] = useState<L3FinanceQuery>({ period: "month" });
  const [l4Query, setL4Query] = useState<L4OperationsQuery>({ period: "week", phase: "ALL" });
  const session = useAdminAuth((state) => state.session);
  // 活动上报会换掉 session 对象，身份没变，不能因此重读整页（一点击就闪、所选明细被清）。
  const owner = session ? `${session.adminId}:${session.username}` : null;
  const currentOwner = useRef(owner);
  currentOwner.current = owner;
  const readGeneration = useRef(0);
  const biData = biOwner === owner ? biSnapshot : null;
  const aggregateExportOptions = useMemo(
    () => allowedAggregateExportOptions(session?.role, session?.authorities ?? []),
    [session?.role, session?.authorities],
  );

  const reloadBi = useCallback(async () => {
    const generation = ++readGeneration.current;
    const isCurrent = () => generation === readGeneration.current && owner === currentOwner.current;
    setBiOwner(owner);
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
      if (isCurrent()) setBiData(nextData);
    } catch (error) {
      if (isCurrent()) setBiError(displayAdminReadError(error));
    } finally {
      if (isCurrent()) setBiLoading(false);
    }
  }, [l3Query, l4Query, tab, owner]);

  useEffect(() => {
    void reloadBi();
    return () => { ++readGeneration.current; };
  }, [reloadBi]);

  const ctx: LCtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    biData,
    biLoading: biLoading || biOwner !== owner,
    biError: biOwner === owner ? biError : null,
    reloadBi,
    biActions: lBiActions,
    canExport: canExportBiReports(session?.role, session?.authorities ?? [], tab),
    canExportFinanceDetail: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l3_export_detail"),
    canExportLedger: session?.role?.toLowerCase() === "superadmin"
      || ((session?.authorities ?? []).includes("finance_d4_export")
        && (session?.authorities ?? []).some((code) => code === "finance_d4_read" || code === "finance_d4_user_read")),
    canApproveExportTasks: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l5_task_approve"),
    canExportNetworkTree: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l4_export_tree"),
    canGenerateRegulatory: session?.role?.toLowerCase() === "superadmin"
      || (session?.authorities ?? []).includes("bi_l5_regulatory_generate"),
    availableAggregateExportTypes: aggregateExportOptions.map((option) => option.label),
    canAccessReportType: (reportType, containsPii) => canAccessBiReportType(session?.role, session?.authorities ?? [], reportType, containsPii),
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
    tab === "L1" ? null
    : tab === "L2" ? <L2HeaderActions ctx={ctx} />
    : tab === "L3" ? <L3HeaderActions ctx={ctx} />
    : tab === "L4" ? <L4HeaderActions ctx={ctx} />
    : tab === "L5" ? <L5HeaderActions ctx={ctx} />
    : <L6HeaderActions ctx={ctx} />;

  const page = (
    <>
      {tab !== "L1" && <DomainHeader {...meta} right={right} />}

      {tab === "L1" && <L1Kpi key={session ? `${session.adminId}:${session.username}` : "anonymous"} ctx={ctx} onExportSource={setL1ExportSource} source={l1ExportSource?.parentData === biData?.l1 ? l1ExportSource : undefined} title={meta.l2Name} summary={meta.summary} />}
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
          confirmLabel={mc.confirmLabel}
          statedBrief={mc.statedBrief}
          facts={mc.facts}
          getPendingReason={mc.getPendingReason}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            try {
              await mc.run(reason, newValue, businessValue);
            } catch (error) {
              if (!isLOutcomeUnknownError(error)) throw error;
              setActionConfirm(null);
              await reloadBi();
              setToast(displayAdminError(error));
              return;
            }
            setActionConfirm(null);
          }}
        />
      )}
      {toastNode}
    </>
  );
  return tab === "L1" ? <RdPage>{page}</RdPage> : <div className="dkpage ldom">{page}</div>;
}
