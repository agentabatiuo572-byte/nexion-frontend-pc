/**
 * L 域视图层契约。ActionConfirmReq = 视图构造的操作确认请求(操作确认 显式 edit 契约:调参传 edit,处置/纯动作不传);
 * L 域写动作仅导出/监管报告/排程模板类,真写落 L.report.* / L.export.* / L.regulatory.* / L.param.*;
 * 聚合导出仍需操作确认(confirm + logAudit 落 admin.report_exported 语义);视图参数普通确认批不落 store。
 */
import type { ReactNode } from "react";
import type { EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  amplifies?: boolean;
  edit?: EditSpec;
  run: (reason: string, newValue?: string) => void;
};

export type LCtx = {
  pget: (k: string) => string | undefined;
  params: Record<string, unknown>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  /** A2 留痕(导出/报告类强留痕;含 PII 标 masking_policy)。 */
  logAudit: (e: { actor: string; action: string; target: string; before?: string; after?: string; reason?: string }) => void;
  toast: (s: string) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
};
