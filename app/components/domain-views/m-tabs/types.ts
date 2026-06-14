/**
 * 客服中心域 M 视图层契约 —— 由 I8/I9 迁出重组,沿用 D 域 logAudit 扩展(reason):
 *  - ActionConfirmReq = 操作确认(顾问推送调参 / 受众圈定传 edit;类别启停 / 话术发布 / 模板发布 /
 *    工单升级 / 主动发起 / 互转等处置不传 —— 显式 edit 契约同全域);
 *  - ConfirmReq = 普通确认;
 *  - 真写键前缀沿用 I.support.* / I.session.*(persist 兼容),与 nav 域 code M 解耦。
 */
import type { DCtx } from "../d-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

/** M 域 ctx:沿用 DCtx(含 logAudit 带 reason 的 admin family 审计写口)。 */
export type MCtx = Omit<DCtx, "logAudit"> & {
  logAudit: (e: { actor: string; action: string; target: string; reason?: string }) => void;
};
