/**
 * 客服中心域 M 视图层契约 —— 由 I8/I9 迁出重组:
 *  - ActionConfirmReq = 操作确认(顾问推送调参 / 受众圈定传 edit;类别启停 / 话术发布 / 模板发布 /
 *    工单升级 / 主动发起 / 互转等处置不传 —— 显式 edit 契约同全域);
 *  - ConfirmReq = 普通确认;
 *  - 真写键前缀沿用 I.support.* / I.session.* 作为后端 adapter key,与 nav 域 code M 解耦。
 */

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type MCtx = {
  pget: (k: string) => string | undefined;
  params: Record<string, string>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  toast: (s: string) => void;
  openActionConfirm: (req: import("../k-tabs/types").ActionConfirmReq) => void;
  openConfirm: (req: import("../k-tabs/types").ConfirmReq) => void;
};
