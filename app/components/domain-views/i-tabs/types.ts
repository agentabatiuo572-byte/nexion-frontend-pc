/**
 * I 域视图层契约 —— 复用 K 域三类弹窗原语 + D 域 logAudit 扩展(reason):
 *  - ActionConfirmReq = 操作确认(发布/下架/回滚/实验启停/CAP 调整/披露发布/i18n 发布/课程奖励调参);
 *    显式 edit 契约:调参传 edit:{kind:"text", current};纯处置(发布/下架/启停)不传。
 *  - ConfirmReq = 普通确认(I1 实验框架默认参数 = 运营设定 / I6 完整性扫描 = 只读 / I7 词条草稿);
 *  - 真写统一 platform-config setParam(I.*)+ 共享 useNova store(I2 Nova 通道,旧 i-view 已建)。
 * I 域唯一 amplifies 流出方向 = I7 课程奖励上调(其余 I 域动作不碰 B1)。
 */
import type { DCtx } from "../d-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

/** I 域 ctx:沿用 DCtx(含 logAudit 带 reason 的 admin family 审计写口)。 */
export type ICtx = Omit<DCtx, "logAudit"> & {
  logAudit: (e: { actor: string; action: string; target: string; reason?: string }) => void;
};
