import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { BusinessFormSpec, BusinessFormValue, EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  amplifies?: boolean;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void;
};

export type ConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  chips?: [text: string, tone: "done" | "ready"][];
  reason?: boolean;
  input?: { label: string; placeholder?: string; options?: string[] };
  okLabel?: string;
  run: (reason: string, value?: string) => void;
};

export type ConfirmChip = [text: string, tone: "done" | "ready"];

export type GCtx = {
  toast: (s: string) => void;
  openActionConfirm: Dispatch<SetStateAction<ActionConfirmReq | null>>;
  openConfirm: Dispatch<SetStateAction<ConfirmReq | null>>;
};
