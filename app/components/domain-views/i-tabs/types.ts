/**
 * I 域视图层契约 —— 复用 K 域三类弹窗原语:
 *  - ActionConfirmReq = 操作确认(发布/下架/回滚/实验启停/CAP 调整/披露发布/i18n 发布/课程奖励调参);
 *    显式 edit 契约:调参传 edit:{kind:"text", current};纯处置(发布/下架/启停)不传。
 *  - ConfirmReq = 普通确认(I1 实验框架默认参数 = 运营设定 / I6 完整性扫描 = 只读 / 词条草稿);
 *  - 真写统一走后端 /content/* 接口,概览为空时由后端写入 MySQL 种子后再查出。
 * I 域唯一 amplifies 流出方向 = 课程奖励上调(其余 I 域动作不碰 B1)。
 */
import type { DCtx } from "../d-tabs/types";
import type { IContentActions, IContentData } from "@/lib/admin/i-client";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

/** I 域 ctx:后端 content client 是业务权威,前端仅承载弹窗和页面数据。 */
export type ICtx = DCtx & {
  content: IContentData;
  actions: IContentActions;
  contentLoading: boolean;
  contentError: string | null;
};
