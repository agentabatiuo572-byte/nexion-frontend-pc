/**
 * L 域视图层契约。ActionConfirmReq = 视图构造的操作确认请求(操作确认 显式 edit 契约:调参传 edit,处置/纯动作不传);
 * L 域写动作仅导出/监管报告/排程模板类,真写落 L.report.* / L.export.* / L.regulatory.* / L.param.*;
 * 聚合导出仍需操作确认(confirm + logAudit 落 admin.report_exported 语义);视图参数普通确认批不落 store。
 */
import type { ReactNode } from "react";
import type { EditSpec, BusinessFormSpec, BusinessFormValue } from "../design-kit";
import type { L2FunnelQuery, L3FinanceQuery, L4OperationsQuery, LBiActions, LBiData } from "@/lib/admin/l-client";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  amplifies?: boolean;
  reasonMin?: number;
  reasonMax?: number;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  completionCopy?: string;
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void | Promise<void>;
};

export type LCtx = {
  toast: (s: string) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  biData?: LBiData | null;
  biLoading?: boolean;
  biError?: string | null;
  reloadBi?: () => Promise<void>;
  biActions?: LBiActions;
  canExport?: boolean;
  canExportFinanceDetail?: boolean;
  canApproveExportTasks?: boolean;
  canExportNetworkTree?: boolean;
  canGenerateRegulatory?: boolean;
  availableAggregateExportTypes?: readonly string[];
  canAccessReportType?: (reportType: string) => boolean;
  l2Query?: L2FunnelQuery;
  setL2Query?: (query: L2FunnelQuery) => void;
  l2SliceExportable?: boolean;
  setL2SliceExportable?: (value: boolean) => void;
  l3Query?: L3FinanceQuery;
  setL3Query?: (query: L3FinanceQuery) => void;
  l4Query?: L4OperationsQuery;
  setL4Query?: (query: L4OperationsQuery) => void;
};
