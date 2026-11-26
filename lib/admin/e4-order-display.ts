import type { StateTone } from "@/app/components/rd";

// 终态中文标签。
const STATE_LABEL: Record<string, string> = { placed: "已下单", paid: "已支付", provisioning: "开通中", activated: "已激活", inventory: "已入库", cancelled: "已取消", payment_failed: "支付失败", expired: "已过期", refunded: "已退款", provisioning_failed: "开通失败", chargeback: "拒付" };
export const stateLabel = (s: string): string => STATE_LABEL[s] ?? "状态未知";

// 筛选值是后端订单进度契约，不可改。11 个状态分 4 组（ST-68），分组只管显示和读取，不改枚举。
export const ORDER_STATE_GROUPS = [
  { value: "flow", label: "进行中", tone: "progress", allLabel: "全部进行中状态", states: ["placed", "paid", "provisioning"] },
  { value: "delivered", label: "已交付", tone: "ok", allLabel: "全部已交付状态", states: ["activated", "inventory"] },
  { value: "failed", label: "失败", tone: "danger", allLabel: "全部失败状态", states: ["payment_failed", "provisioning_failed", "chargeback"] },
  { value: "closed", label: "已结束", tone: "done", allLabel: "全部已结束状态", states: ["expired", "refunded", "cancelled"] },
] as const satisfies readonly { value: string; label: string; tone: StateTone; allLabel: string; states: readonly string[] }[];
export const ORDER_STATES: readonly string[] = ORDER_STATE_GROUPS.flatMap((group) => group.states);
