import type { ActionConfirmReq, ConfirmReq } from "../k-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type DCtx = {
  /**
   * Legacy config helpers are kept for older domain context aliases that still
   * extend DCtx. D tabs do not consume them; D1-D5 data now comes from backend
   * finance/treasury APIs.
   */
  pget: (k: string) => string | undefined;
  params: Record<string, unknown>;
  setParam: (k: string, v: string, meta: { action: string; reason: string }) => void;
  toast: (s: string) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  openConfirm: (req: ConfirmReq) => void;
  logAudit?: (entry: unknown) => void;
};
