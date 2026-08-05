import type { Dispatch, ReactNode, SetStateAction } from "react";
import type { BusinessFormSpec, BusinessFormValue, EditSpec } from "../design-kit";

export type ActionConfirmReq = {
  action: ReactNode;
  detail: ReactNode;
  amplifies?: boolean;
  coverage?: { coverageRatio: number; redlinePct: number };
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  /** 理由字数上限(与 k-tabs / l-tabs 同款透传)。不传时沿用弹窗默认(下限恒 8 字)。 */
  reasonMax?: number;
  run: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void | Promise<void>;
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
