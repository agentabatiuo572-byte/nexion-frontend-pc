/**
 * H 域视图层契约 —— 复用 K 域三类弹窗原语 + D 域 logAudit 扩展(reason):
 *  - ActionConfirmReq = 操作确认(H1 dial / Phase 切换 / 沙盒 / H2 敏感参数 🔥 / 强制取消/扣款 /
 *    H3 任务清单/奖励/倍率 / H4 活动 / 转盘 / geo / H5 幸运概率 / 里程碑 / Power-Ups);
 *    显式 edit 契约:调参传 edit:{kind:"text",current};纯处置(下架/急停/上下架)不传 edit。
 *  - ConfirmReq = 普通确认(H1 沙盒预览 / H2 非敏感参数直改+原因必填 / H2 auto-push 急停 / H2 取消);
 *  - 真写统一 platform-config setParam(H.*)+ 沿用旧 h-view 已建键(H.phase.dial.<k> / H.event.<id>.status 等)。
 * H 域 amplifies 多处:H1 放松方向 dial(降冷却 cooldown / 降积分门 points / 升封顶 binaryCap)/
 *   H3 升任务奖励 / H4 活动升奖励 / H4 转盘真实奖 / H5 幸运升概率 / H5 升里程碑奖励 / H6 升 NEX 奖励 / H6 降门槛 / H5 Power-Ups。
 * H2 amplifies 不挂(SPEC §0 注:试用收益是折扣不是负债,Model A 拆分;失败概率为内部参数)。
 * 四道前置闸(H2):资格统一裁决 / 30 天冷却 / K2 循环阻断 / 扣款幂等。
 * 三道护栏(H4 转盘):概率合计 = 100、档位 ∈ [2,12]、真实奖过 B1 红线 → 422。
 */
import type { DCtx } from "../d-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type HCtx = Omit<DCtx, "logAudit"> & {
  logAudit: (e: { actor: string; action: string; target: string; reason?: string }) => void;
};
