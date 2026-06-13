import type { BusinessFormSpec, EditSpec } from "../design-kit";
import type { OpsSku, OpsReview, OpsTask } from "@/lib/store/admin/platform-config-store";

/**
 * E 域子视图共享类型。
 * shell(e-view.tsx)持有全部 store 接线 + 抽屉(SKU/任务/评价/订单详情)+ OperationConfirmModal,
 * 子视图通过 ctx 回调触发写入 —— 真写落点单一来源在 shell,保证 store 接线不散。
 *
 * Mc 显式 edit 契约(2026-06 跨域硬化):调参传 edit{kind,current,unit};处置/纯动作不传 edit。
 */
export type EOp =
  | "sku-save"        // 新增/编辑 SKU(shell 读 form 状态)→ addSku/updateSku
  | "sku-delete"      // 删除 SKU(需破坏性理由 + 影响确认)
  | "sku-status"      // 上/下架(真 store setSkuStatus)
  | "task-down"       // 下架任务(需破坏性理由 + 影响确认)
  | "task-price"      // 任务改单价(真 store updateTask,操作确认 出价格编辑框)
  | "param"           // 自由值调参 → setParam(paramKey, newValue);操作确认 出「目标新值」
  | "param-fixed"     // 固定值写入 → setParam(paramKey, fixedVal)(如 forceUnlock true/false);不出编辑框
  | "order-refund"    // 退款(放大流出)
  | "order-cancel"    // 取消订单
  | "order-terminal"  // 补建终态(select)
  | "ops-pause";      // DC 批量 pause / 恢复

export interface McSpec {
  name: string;             // 确认弹窗标题(动作名)
  op: EOp;
  detail?: string;          // 副文案(覆盖默认)
  amplify?: boolean;        // 放大资金流出 → OperationConfirmModal amplifies={true} → B1 覆盖率护栏
  edit?: EditSpec;          // 显式 edit 契约:仅自由值/select 调参传
  businessForm?: BusinessFormSpec;
  paramKey?: string;
  fixedVal?: string;        // param-fixed / 处置固定写入值
  target?: string;          // SKU 名 / 实体名(sku-status / sku-save 等)
  isNew?: boolean;          // sku-save:新增 vs 编辑
  hasImg?: boolean;         // sku-save:含产品图
  status?: string;          // sku-status:"on"|"off";ops-pause:"on"|"off"
  taskId?: string;          // task-price:目标任务 id
  orderId?: string;         // 退款 / 取消 / 补建终态目标订单
  dc?: string;              // 运维处置目标数据中心
}
export type Mc = McSpec | null;

/** 订单行(队列 / 状态机派生)。 */
export interface EOrder {
  id: string;
  user: string;
  sku: string;
  amt: number;
  state: string;
  dc: string;
  age: string;
}

/** 子视图上下文:派生读 + 打开抽屉/操作确认 + toast。全部由 shell 注入,子视图无自有 store。 */
export interface EViewCtx {
  hydrated: boolean;
  pget: (k: string) => string | undefined;
  pE: (k: string) => string;
  openActionConfirm: (m: McSpec) => void;
  toast: (msg: string) => void;
  // E1 商品目录 & 代际门
  skus: OpsSku[];
  reviews: OpsReview[];
  phaseCur: string;                              // 当前 Phase(pget('H.phase.current') ?? 'P3')
  openSku: (name?: string) => void;              // 打开 SKU 抽屉(无 name = 新增)
  delSku: (name: string) => void;
  openAddReview: () => void;
  openEditReview: (r: OpsReview) => void;
  toggleReview: (r: OpsReview) => void;
  delReview: (r: OpsReview) => void;
  // E.gen.* 发布门(phaseOffset / forceUnlock)直接走 ctx.pget 读,真 setParam config
  // E2 收益 & 任务引擎(改单价走 ctx.openActionConfirm op:"task-price";新增/下架走真 store)
  tasks: OpsTask[];
  openAddTask: () => void;
  delTask: (t: { id: string; n: string }) => void;
  // E4 订单状态机
  orders: EOrder[];
  orderState: (o: EOrder) => string;
  isCancelled: (id: string) => boolean;
  isRefunded: (id: string) => boolean;
  terminalOf: (id: string) => string | undefined;
  openOrder: (o: EOrder) => void;
  // E5 设备运维
  isDcPaused: (dc: string) => boolean;
}
