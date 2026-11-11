import { CirclePause, PowerOff, type LucideIcon } from "lucide-react";
import type { E5SimState } from "@/lib/admin/e5-client";
import type { StateTone } from "@/app/components/rd";

export const E5_STATES: Record<E5SimState, { label: string; tone: StateTone; reason: string; icon?: LucideIcon }> = {
  WAITING_ACTIVATION: { label: "待激活", tone: "neutral", reason: "仅待激活设备可普通激活；每人最多 6 台，包含手机。" },
  WAITING_INIT: { label: "等待初始化", tone: "progress", reason: "系统会自动开始，无需操作。" },
  LEGACY_PENDING: { label: "旧任务未结清", tone: "warn", reason: "先核对旧任务；结清前不接新单，改任务池配置不能解决。" },
  RUNNING: { label: "运行中", tone: "ok", reason: "当前任务为空不代表设备没有运行。" },
  WAITING_CONFIG: { label: "等待配置", tone: "warn", reason: "没有可用任务，请去任务池核对。停跑期间不计收益、不补发。" },
  PAUSED: { icon: CirclePause, label: "已暂停", tone: "neutral", reason: "按暂停原因核对；停跑期间不计收益、不补发。" },
  CLOSING: { label: "停用中", tone: "progress", reason: "当前单完成并结算后停用，仍占设备名额，不再接新任务。" },
  STOPPED: { label: "已停用", tone: "done", reason: "设备已停止；重新启动须提交强制激活审批。" },
  UNBOUND: { label: "已解绑", tone: "done", reason: "不再归属原用户，保留历史事实；不能重复解绑。" },
  ERROR: { label: "出错重试中", tone: "danger", reason: "系统每 30 秒自动重试，原错误和下次重试时间见设备详情。" },
  SIM_OFF: { icon: PowerOff, label: "任务已关闭", tone: "neutral", reason: "任务已关闭，本页只读。" },
};

/** Known backend pause codes are translated; operator-written reasons stay readable. */
export function pausedReasonText(reason: string) {
  const labels: Record<string, string> = { ORDER_REFUND: "订单已退款", PROMOTION_REFUND: "赠送来源订单已退款", DEVICE_PAUSED: "设备已暂停", PHONE_OFFLINE: "手机离线", PHONE_LOW_BATTERY: "手机电量不足" };
  return labels[reason] ?? (/^[A-Z][A-Z0-9_]+$/.test(reason) ? "已暂停，原始原因请核对技术信息" : reason);
}
