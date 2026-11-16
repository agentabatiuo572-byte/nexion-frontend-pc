import { CirclePause, PowerOff, type LucideIcon } from "lucide-react";
import type { E5Device, E5SimState } from "@/lib/admin/e5-client";
import type { StateTone } from "@/app/components/rd";

export const E5_STATES: Record<E5SimState, { label: string; tone: StateTone; reason: string; icon?: LucideIcon }> = {
  WAITING_ACTIVATION: { label: "待激活", tone: "neutral", reason: "点「激活」或申请强制激活，以行上的操作为准；每人最多 6 台，包含手机。" },
  WAITING_INIT: { label: "等待初始化", tone: "progress", reason: "系统会自动开始，无需操作。" },
  LEGACY_PENDING: { label: "旧任务未结清", tone: "warn", reason: "先核对旧任务；结清前不接新单，改任务池配置不能解决。" },
  RUNNING: { label: "运行中", tone: "ok", reason: "当前任务为空不代表设备没有运行。" },
  WAITING_CONFIG: { label: "等待配置", tone: "warn", reason: "没有可用任务，请去任务池核对。停跑期间不计收益、不补发。" },
  PAUSED: { icon: CirclePause, label: "已暂停", tone: "neutral", reason: "按暂停原因核对；停跑期间不计收益、不补发。" },
  CLOSING: { label: "停用中", tone: "progress", reason: "当前单结束后停用，仍占设备名额，不再接新任务。" },
  STOPPED: { label: "已停用", tone: "done", reason: "设备已停止。普通停用的可以申请强制激活；已回收、已退役的不能再激活。" },
  UNBOUND: { label: "已解绑", tone: "done", reason: "不再归属原用户，历史记录保留。可以申请强制激活回到原用户；解绑后又被回收或退役的不能。" },
  ERROR: { label: "出错重试中", tone: "danger", reason: "系统每 30 秒自动重试，原错误和下次重试时间见设备详情。" },
  SIM_OFF: { icon: PowerOff, label: "任务已关闭", tone: "neutral", reason: "任务已关闭，本页只读。" },
};

/**
 * 「待激活」「已停用」「已解绑」各混着几种设备，能不能再用要看设备真实的状态（rawStatus，和行上的激活入口同一个依据）。
 * sub 是列表里状态下面的一行，reason 是详情里的说明；其他状态沿用 E5_STATES。
 */
export function e5StateNote(d: Pick<E5Device, "simState" | "rawStatus">): { sub?: string; reason: string } {
  const raw = d.rawStatus.trim().toUpperCase();
  const again = "可以重新激活";
  if (d.simState === "WAITING_ACTIVATION") {
    if (raw === "INVENTORY") return { reason: "可以点「激活」；每人最多 6 台，包含手机。" };
    if (raw === "INACTIVE") return { reason: "不能直接激活，可以申请强制激活，批准后生效；每人最多 6 台，包含手机。" };
    return { reason: "这台设备不能在这页激活。" };
  }
  if (d.simState === "STOPPED") {
    if (raw === "DEACTIVATED" || raw === "INACTIVE") return { sub: again, reason: "设备已停用；要再用可以申请强制激活，另一位管理员批准后生效。" };
    if (raw === "INVENTORY") return { sub: again, reason: "设备已停用；要再用可以点「激活」，每人最多 6 台，包含手机。" };
    if (raw === "RECYCLED") return { sub: "已回收，不能再激活", reason: "设备已在置换中回收，不能再激活。" };
    if (raw === "RETIRED") return { sub: "已退役，不能再激活", reason: "设备已退役，不能再激活。" };
    return { reason: "设备已停止运行，这页不能重新激活。" };
  }
  if (d.simState === "UNBOUND") {
    if (raw === "UNBOUND") return { sub: again, reason: "不再归属原用户，历史记录保留；可以申请强制激活，另一位管理员批准后回到原用户。" };
    if (raw === "RECYCLED") return { sub: "已回收，不能再激活", reason: "解绑后又在置换中回收，不能再激活，也不能回到原用户。" };
    if (raw === "RETIRED") return { sub: "已退役，不能再激活", reason: "解绑后已退役，不能再激活，也不能回到原用户。" };
    return { reason: "不再归属原用户，历史记录保留；这页不能恢复。" };
  }
  return { reason: d.simState ? E5_STATES[d.simState].reason : "" };
}

/** Known backend pause codes are translated; operator-written reasons stay readable. */
export function pausedReasonText(reason: string) {
  const labels: Record<string, string> = { ORDER_REFUND: "订单已退款", PROMOTION_REFUND: "赠送来源订单已退款", DEVICE_PAUSED: "设备已暂停", PHONE_OFFLINE: "手机离线", PHONE_LOW_BATTERY: "手机电量不足", deactivate: "运营取消激活", unbind: "运营解绑" };
  return labels[reason] ?? (/^[A-Z][A-Z0-9_]+$/.test(reason) ? "已暂停，原始原因请核对技术信息" : reason);
}
