import type { ActionConfirmReq, ConfirmReq } from "../k-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type DCtx = {
  toast: (s: string) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  openConfirm: (req: ConfirmReq) => void;
};
