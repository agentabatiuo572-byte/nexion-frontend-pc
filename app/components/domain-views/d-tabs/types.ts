import type { ToastKind } from "@/lib/store/ui";
import type { ActionConfirmReq, ConfirmReq } from "../k-tabs/types";

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type DCtx = {
  toast: (s: string, kind?: ToastKind) => void;
  openActionConfirm: (req: ActionConfirmReq) => void;
  openConfirm: (req: ConfirmReq) => void;
};
