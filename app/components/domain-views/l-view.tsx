"use client";

/**
 * L 数据与分析 BI — design_handoff_l_domain 设计稿 port(2026-06-10 重构)。
 * 5 子页:L1 KPI 看板 / L2 漏斗·Cohort·留存 / L3 财务报表 / L4 设备·任务·网络报表 / L5 导出 & 监管报告。
 * 读侧无写权威:口径全部单一源派生(KPIS/FUNNEL/REVENUE/LEDGER/LIABILITIES/MATURITY/PHASES/F5);
 * 写动作仅导出/监管报告/排程模板类,真写 L.report.* / L.export.* / L.regulatory.* / L.param.*(setParam + logAudit 双留痕);
 * 聚合导出仍需操作确认(confirm + 审计);视图参数普通确认批(ViewParamModal,会话级)。操作确认 显式 edit 契约同全域。
 */
import { useMemo, useState } from "react";
import "./l-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { L1HeaderActions, L1Kpi } from "./l-tabs/l1-kpi";
import { L2HeaderActions, L2Funnel } from "./l-tabs/l2-funnel";
import { L3HeaderActions, L3Finance } from "./l-tabs/l3-finance";
import { L4HeaderActions, L4Ops } from "./l-tabs/l4-ops";
import { L5HeaderActions, L5Export } from "./l-tabs/l5-export";
import type { LCtx, ActionConfirmReq } from "./l-tabs/types";

const FOLD: Record<string, string> = { L1: "L1", L2: "L2", L3: "L3", L4: "L4", L5: "L5" };

export function LDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "L1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);

  const ctx: LCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    logAudit,
    toast: setToast,
    openActionConfirm: setActionConfirm,
  };

  const right =
    tab === "L1" ? <L1HeaderActions ctx={ctx} />
    : tab === "L2" ? <L2HeaderActions ctx={ctx} />
    : tab === "L3" ? <L3HeaderActions ctx={ctx} />
    : tab === "L4" ? <L4HeaderActions ctx={ctx} />
    : <L5HeaderActions ctx={ctx} />;

  return (
    <div className="dkpage ldom">
      <DomainHeader {...meta} right={right} />

      {tab === "L1" && <L1Kpi ctx={ctx} />}
      {tab === "L2" && <L2Funnel ctx={ctx} />}
      {tab === "L3" && <L3Finance ctx={ctx} />}
      {tab === "L4" && <L4Ops ctx={ctx} />}
      {tab === "L5" && <L5Export ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue) => { mc.run(reason, newValue); setActionConfirm(null); }}
        />
      )}
      {toastNode}
    </div>
  );
}
