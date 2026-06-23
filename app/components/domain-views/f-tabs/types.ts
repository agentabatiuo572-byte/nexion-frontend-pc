import type { EditSpec, BusinessFormSpec, BusinessFormValue } from "../design-kit";
import type { OpsVRankRewardItem } from "@/lib/store/admin/platform-config-store";

/**
 * F 域子视图共享类型。
 * Mc:操作确认弹窗规格(op 区分 调参 param / 处置 dispose);由 shell(f-view.tsx)持有 state + 渲染 OperationConfirmModal。
 * 子视图通过 ctx.openActionConfirm(spec) 打开弹窗 —— 真写落点统一在 shell 的 onConfirm(setParam),保证 store 接线单一来源。
 * businessForm + run:复杂业务表单(如 V-Rank 奖励编辑)走 businessForm 渲染 + run 回调真写(对齐 H 域 voucher-config 范式)。
 */
export interface McSpec {
  name: string;
  amplify?: boolean;             // 放大资金流出 → OperationConfirmModal amplifies={true} → B1 覆盖率护栏
  op?: "param" | "dispose" | "param-multi";
  paramKey?: string;
  paramKeys?: { key: string; paramKey: string }[];  // param-multi:businessForm 字段 key → param key 映射(每字段独立 setParam,backend-replaceable)
  fixedVal?: string;             // 处置类固定写入值(approved/rejected/disqualified/frozen/unlocked …)
  status?: string;
  edit?: EditSpec;               // 调参类目标新值编辑规格
  businessForm?: BusinessFormSpec; // 复杂业务表单规格(渲染 BusinessFormBlock)
  run?: (reason: string, businessValue?: BusinessFormValue) => void; // 业务表单真写回调(传则优先于 param/dispose)
  detail?: string;
}
export type Mc = McSpec | null;

/** 子视图上下文:派生读 pget / 打开 操作确认 / 跨域跳转 / toast。全部由 shell 注入,子视图无自有 store。 */
export interface FViewCtx {
  pget: (k: string) => string | undefined;
  openActionConfirm: (m: McSpec) => void;
  nav: (domain: string) => void;
  toast: (msg: string) => void;
  // ── V-Rank 等级奖励(F1)· 读 + CRUD(写经 run 回调,内部 logAudit)+ 代金券/SKU 下拉选项 ──
  rewards: Record<string, OpsVRankRewardItem[]>;
  addReward: (level: string, item: OpsVRankRewardItem, reason: string) => void;
  updateReward: (level: string, id: string, patch: Partial<OpsVRankRewardItem>, reason: string) => void;
  removeReward: (level: string, id: string, reason: string) => void;
  voucherOptions: string[];
  voucherLabels: Record<string, string>;
  skuOptions: string[];
  skuLabels: Record<string, string>;
}
