import type { BusinessFormSpec, EditSpec } from "../design-kit";
import type { E1GenerationGateData, E1GenerationGateInput } from "@/lib/admin/e1-client";
import type { E2PhoneTier, E2TaskPricingSnapshot } from "@/lib/admin/e2-client";
import type { E3OperationMetric, E3Stats } from "@/lib/admin/e3-client";
import type { E5Datacenter, E5DatacenterStatus, E5Device, E5Overview } from "@/lib/admin/e5-client";
import type { E6ComputeConfigView } from "@/lib/admin/e6-client";
import type { OpsSku, OpsTask } from "@/lib/admin/platform-types";

/**
 * E 域子视图共享类型。
 * shell(e-view.tsx)持有全部 store 接线 + 抽屉(SKU/任务/订单详情)+ OperationConfirmModal,
 * 子视图通过 ctx 回调触发写入 —— 真写落点单一来源在 shell,保证 store 接线不散。
 *
 * Mc 显式 edit 契约(2026-06 跨域硬化):调参传 edit{kind,current,unit};处置/纯动作不传 edit。
 */
export type EOp =
  | "sku-save"        // 新增/编辑 SKU(shell 读 form 状态)→ E1 后端 API
  | "sku-delete"      // 删除 SKU(需破坏性理由 + 影响确认)
  | "sku-status"      // 上/下架(真后端 status)
  | "task-down"       // 下架任务(需破坏性理由 + 影响确认)
  | "task-price"      // 任务改单价(E2 后端 API,操作确认 出价格编辑框)
  | "task-save"       // 任务全参数编辑(抽屉读 taskForm)→ E2 后端 API
  | "task-create"     // 新增任务(原 submitTask 直调,批6 补 modal)→ E2 后端 API
  | "phone-tier"      // 手机算力档位收益 → E2 后端 API
  | "param"           // 自由值调参 → E1/E3 后端配置接口;未接后端的 key 直接失败,不写本地 store
  | "param-multi"     // 多字段调参 → businessForm:{kind:"multi-field"} + paramKeys[];逐字段写后端 config
  | "early-access"    // E1 置换侧抢先购专用命令（权限/审计归 E1）
  | "param-fixed"     // 固定值写入 → E1/E3 后端配置接口;不出编辑框
  | "phase-save"      // E1 阶段新增/编辑
  | "phase-archive"   // E1 阶段归档
  | "generation-gate-save"    // E1 代际门新增/编辑
  | "generation-gate-force"   // E1 代际门强制提前开放/撤销
  | "generation-gate-archive" // E1 代际门归档
  | "order-state"     // E4 订单状态推进/回滚
  | "order-refund"    // 退款(放大流出)
  | "order-cancel"    // 取消订单
  | "order-terminal"  // 补建终态(select)
  | "device-activate" // E5 设备激活
  | "device-deactivate" // E5 设备取消激活/解绑
  | "device-batch"    // E5 按用户批量暂停/恢复
  | "ops-pause"       // DC 批量 pause / 恢复
  | "dc-save"         // 数据中心新增/编辑(businessForm multi-field:id/location/displayName)→ store CRUD
  | "dc-delete";      // 数据中心删除(需破坏性理由)

export interface DatacenterForm {
  dcLocation: string;
  regionLabel: string;
  location: string;
  displayName: string;
  status: E5DatacenterStatus;
  sortOrder: string;
}

export interface McSpec {
  name: string;             // 确认弹窗标题(动作名)
  op: EOp;
  detail?: string;          // 副文案(覆盖默认)
  amplify?: boolean;        // 放大资金流出 → OperationConfirmModal amplifies={true} → B1 覆盖率护栏
  edit?: EditSpec;          // 显式 edit 契约:仅自由值/select 调参传
  businessForm?: BusinessFormSpec;
  commandKey?: string;        // 弹窗生命周期内稳定；失败重试复用同一幂等键
  paramKey?: string;
  paramKeys?: { key: string; paramKey: string }[];  // param-multi:businessForm 字段 key → param key 映射
  fixedVal?: string;        // param-fixed / 处置固定写入值
  target?: string;          // SKU 名 / 实体名(sku-status / sku-save 等)
  isNew?: boolean;          // sku-save:新增 vs 编辑
  hasImg?: boolean;         // sku-save:含商品媒体(商品主图或商品视频)
  status?: string;          // sku-status:"on"|"off";ops-pause:"on"|"off"
  taskId?: string;          // task-price:目标任务 id
  phoneTier?: number;
  phoneField?: "dailyUsdt" | "dailyNex";
  phaseId?: string;
  generationGateId?: string;
  generationGate?: E1GenerationGateInput;
  orderId?: string;         // 退款 / 取消 / 补建终态目标订单
  deviceId?: number;        // E5 后端设备主键
  deviceNo?: string;        // E5 展示编号(instanceNo)
  deviceAction?: "activate" | "force-activate" | "deactivate" | "unbind";
  userId?: number;
  dc?: string;              // 运维处置目标数据中心
  dcForm?: DatacenterForm;
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
  pE: (k: string) => string;
  openActionConfirm: (m: McSpec) => void;
  toast: (msg: string) => void;
  // E1 商品目录 & 上架门
  canWriteE1: boolean;
  skus: OpsSku[];
  e1Loading: boolean;
  e1Error: string | null;
  e1Gates: E1GenerationGateData | null;
  phaseCur: string;                              // 当前 Phase,仅来自 E1 后端 generation-gates
  refreshE1: () => Promise<void>;
  openSku: (name?: string) => void;              // 打开 SKU 抽屉(无 name = 新增)
  delSku: (name: string) => void;
  // E2 收益 & 任务引擎(任务列表/新增/改单价/下架均走后端 API)
  canWriteE2: boolean;
  tasks: OpsTask[];
  phoneTiers: E2PhoneTier[];
  e2Pricing: E2TaskPricingSnapshot | null;
  e2Loading: boolean;
  e2Error: string | null;
  refreshE2: () => Promise<void>;
  openAddTask: () => void;
  openEditTask: (t: OpsTask) => void;        // 编辑任务全字段(预填抽屉)
  delTask: (t: { id: string; n: string }) => void;
  // E3 生命周期 & Trade-in(配置/指标/tx 监控均走后端 API)
  e3Ready: boolean;
  e3Loading: boolean;
  e3Error: string | null;
  e3Stats: E3Stats | null;
  e3Operations: E3OperationMetric[];
  refreshE3: () => Promise<void>;
  // E4 订单状态机
  canWriteE4: boolean;
  canRefundE4: boolean;
  orders: EOrder[];
  e4Loading: boolean;
  e4Error: string | null;
  e4Page: number;
  e4PageSize: number;
  e4Total: number;
  e4Filter: string;
  e4Keyword: string;
  setE4Page: (page: number) => void;
  setE4PageSize: (pageSize: number) => void;
  setE4Filter: (filter: string) => void;
  setE4Keyword: (keyword: string) => void;
  refreshE4: () => Promise<void>;
  orderState: (o: EOrder) => string;
  isCancelled: (id: string) => boolean;
  isRefunded: (id: string) => boolean;
  terminalOf: (id: string) => string | undefined;
  openOrder: (o: EOrder) => void;
  // E5 设备运维(设备列表/激活/解绑/DC pause 均走后端 API)
  canWriteE5: boolean;
  canForceActivateE5: boolean;
  canUnbindE5: boolean;
  canPauseDcE5: boolean;
  runE5DeviceAction: (deviceId: number, action: "activate" | "deactivate", reason: string) => Promise<void>;
  runE5UserBatch: (userId: number, paused: boolean, reason: string) => Promise<void>;
  e5Devices: E5Device[];
  e5Overview: E5Overview | null;
  e5Datacenters: E5Datacenter[];
  e5Loading: boolean;
  e5Error: string | null;
  e5Page: number;
  e5PageSize: number;
  e5Total: number;
  e5Keyword: string;
  e5StateFilter: string;
  e5KindFilter: string;
  e5HeartbeatFilter: string;
  setE5Keyword: (value: string) => void;
  setE5StateFilter: (value: string) => void;
  setE5KindFilter: (value: string) => void;
  setE5HeartbeatFilter: (value: string) => void;
  setE5Page: (page: number) => void;
  setE5PageSize: (pageSize: number) => void;
  refreshE5: () => Promise<void>;
  isDcPaused: (dc: string) => boolean;
  openDatacenter: (dc?: E5Datacenter) => void;
  deleteDatacenter: (dc: E5Datacenter) => void;
  // E6 算力与设备配置(开关/系数/显卡映射/下载内容均走后端 config API,聚合视图)
  canWriteE6: boolean;
  canToggleE6: boolean;
  e6Config: E6ComputeConfigView | null;
  e6Loading: boolean;
  e6Error: string | null;
  refreshE6: () => Promise<void>;
}
