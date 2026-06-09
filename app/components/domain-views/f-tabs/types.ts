import type { EditSpec } from "../design-kit";

/**
 * F 域子视图共享类型。
 * Mc:Maker-Checker 弹窗规格(op 区分 调参 param / 处置 dispose);由 shell(f-view.tsx)持有 state + 渲染 MakerCheckerModal。
 * 子视图通过 ctx.openMc(spec) 打开弹窗 —— 真写落点统一在 shell 的 onConfirm(setParam),保证 store 接线单一来源。
 */
export interface McSpec {
  name: string;
  amplify?: boolean;             // 放大资金流出 → MakerCheckerModal amplifies={true} → B1 覆盖率护栏
  op?: "param" | "dispose";
  paramKey?: string;
  fixedVal?: string;             // 处置类固定写入值(approved/rejected/disqualified/frozen/unlocked …)
  status?: string;
  edit?: EditSpec;               // 调参类目标新值编辑规格
  detail?: string;
}
export type Mc = McSpec | null;

/** 子视图上下文:派生读 pget / 打开 MC / 跨域跳转 / toast。全部由 shell 注入,子视图无自有 store。 */
export interface FViewCtx {
  pget: (k: string) => string | undefined;
  openMc: (m: McSpec) => void;
  nav: (domain: string) => void;
  toast: (msg: string) => void;
}
