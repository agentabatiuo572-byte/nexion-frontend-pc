import { CirclePause, PowerOff, type LucideIcon } from "lucide-react";
import { canActivateE5Device, type E5Device, type E5SimState } from "@/lib/admin/e5-client";
import type { StateTone } from "@/app/components/rd";

export const E5_STATES: Record<E5SimState, { label: string; tone: StateTone; reason: string; icon?: LucideIcon }> = {
  WAITING_ACTIVATION: { label: "待激活", tone: "neutral", reason: "点「激活」或申请强制激活，以行上的操作为准；每人最多 6 台，包含手机。" },
  WAITING_INIT: { label: "等待初始化", tone: "progress", reason: "系统会自动开始，无需操作。" },
  LEGACY_PENDING: { label: "旧任务未结清", tone: "warn", reason: "先核对旧任务；结清前不接新单，改任务池配置不能解决。" },
  RUNNING: { label: "运行中", tone: "ok", reason: "当前任务为空不代表设备没有运行。" },
  WAITING_CONFIG: { label: "等待配置", tone: "warn", reason: "没有可用任务，请去任务池核对。停跑期间不计收益、不补发。" },
  PAUSED: { icon: CirclePause, label: "已暂停", tone: "neutral", reason: "按暂停原因核对；停跑期间不计收益、不补发。" },
  CLOSING: { label: "停用中", tone: "progress", reason: "当前单结束后停用，仍占设备名额，不再接新任务。" },
  STOPPED: { label: "已停用", tone: "done", reason: "设备已停止。仍归原用户的可以申请强制激活；已回收、退役、退款或赠送撤销的不能。" },
  UNBOUND: { label: "已解绑", tone: "done", reason: "已不归原用户，不能再激活。" },
  ERROR: { label: "出错重试中", tone: "danger", reason: "系统每 30 秒自动重试，原错误和下次重试时间见设备详情。" },
  SIM_OFF: { icon: PowerOff, label: "任务已关闭", tone: "neutral", reason: "任务已关闭，本页只读。" },
};

/**
 * 停用、解绑这类设备：按归属说清还能不能再激活（和行上的入口用同一个判断）；读不到归属时保留旧说法。
 * 早期解绑、但仍归原用户的设备后端允许强制激活，所以不叫「已解绑」。
 * 审批申请里的原状态和页面显示的用同一个 label。
 */
function stoppedNote(d: Pick<E5Device, "simState" | "rawStatus" | "ownershipStatus">): { label: string; sub?: string; reason: string } {
  const raw = d.rawStatus.trim().toUpperCase();
  const again = "可以重新激活";
  if (canActivateE5Device(d)) return { label: "已停用", sub: again, reason: "设备已停用；要再用可以点「激活」，每人最多 6 台，包含手机。" };
  if (canActivateE5Device(d, true)) return { label: "已停用", sub: again, reason: raw === "UNBOUND" ? "早期解绑的设备，仍归原用户；可以申请强制激活，另一位管理员批准后生效。" : "设备已停用；要再用可以申请强制激活，另一位管理员批准后生效。" };
  if (d.ownershipStatus === "UNBOUND" || d.simState === "UNBOUND" || raw === "UNBOUND") return { label: "已解绑", sub: "不能再激活", reason: E5_STATES.UNBOUND.reason };
  if (d.ownershipStatus === "RECYCLED" || raw === "RECYCLED") return { label: "已停用", sub: "已回收，不能再激活", reason: "设备已在置换中回收，不能再激活。" };
  if (raw === "RETIRED") return { label: "已停用", sub: "已退役，不能再激活", reason: "设备已退役，不能再激活。" };
  if (d.ownershipStatus === "REFUNDED") return { label: "已停用", sub: "订单已退款，不能再激活", reason: "这台设备的购买订单已退款，不能再激活。" };
  if (d.ownershipStatus === "REVOKED") return { label: "已停用", sub: "赠送已撤销，不能再激活", reason: "这台是活动赠送的设备，赠送已撤销，不能再激活。" };
  if (d.ownershipStatus !== null && d.ownershipStatus !== "OWNED") return { label: "已停用", sub: "不能再激活", reason: "设备已不归原用户，不能再激活。" };
  return { label: "已停用", reason: "设备已停止运行，这页不能重新激活。" };
}

/**
 * 激活说明与行上的入口共用归属和原始状态判断；缺少归属时保留旧规则。
 * label 是列表、详情、确认框里显示的状态（不传时用 E5_STATES），sub 是列表里状态下面的一行，reason 是详情里的说明。
 */
export function e5StateNote(d: Pick<E5Device, "simState" | "rawStatus" | "ownershipStatus">): { label?: string; sub?: string; reason: string } {
  const raw = d.rawStatus.trim().toUpperCase();
  if (d.simState === "WAITING_ACTIVATION") {
    if (canActivateE5Device(d)) return { reason: "可以点「激活」；每人最多 6 台，包含手机。" };
    if (raw === "INACTIVE" && canActivateE5Device(d, true)) return { reason: "不能直接激活，可以申请强制激活，批准后生效；每人最多 6 台，包含手机。" };
    return { reason: "这台设备不能在这页激活。" };
  }
  if (d.simState === "STOPPED" || d.simState === "UNBOUND") return stoppedNote(d);
  return { reason: d.simState ? E5_STATES[d.simState].reason : "" };
}

/** E6 的手机没有设备进度，停用、解绑的几种按同一套叫法显示。 */
export const e5StoppedNote = stoppedNote;
