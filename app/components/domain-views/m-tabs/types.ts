/**
 * 客服中心域 M 视图层契约 —— 由 I8/I9 迁出重组:
 *  - ActionConfirmReq = 操作确认(顾问推送调参 / 受众圈定传 edit;类别启停 / 话术发布 / 模板发布 /
 *    工单升级 / 主动发起 / 互转等处置不传 —— 显式 edit 契约同全域);
 *  - ConfirmReq = 普通确认;
 *  - 真写键前缀沿用 I.support.* / I.session.* 作为后端 adapter key,与 nav 域 code M 解耦。
 */

export type { ActionConfirmReq, ConfirmReq, ConfirmChip } from "../k-tabs/types";

export type MCtx = {
  pget: (k: string) => string | undefined;
  params: Record<string, string>;
  setParam: (k: string, v: string, meta: { action: string; reason: string; idempotencyKey?: string; commandKey?: string; onBackendResult?: (result: unknown) => void; /** 传了就把失败原因交给调用方，写在确认框里，不弹 toast。 */ onFailure?: (message: string) => void }) => Promise<boolean>;
  refreshConversations: () => Promise<void>;
  refreshContent: () => Promise<void>;
  /** A full content load is running; availability flags are not final yet. */
  contentLoading: boolean;
  /** Re-reads only the knowledge base. A full refresh rebuilds the open conversation and would close the picker. */
  refreshKnowledge: () => Promise<void>;
  loadConversationDetail: (no: string, signal?: AbortSignal, includeCustomerProfile?: boolean) => Promise<void>;
  invalidateScope: (conversationNo?: string, customerId?: string) => void;
  addCustomerTag: (convoId: string, tag: string) => Promise<boolean>;
  removeCustomerTag: (convoId: string, tag: string) => Promise<boolean>;
  addCustomerNote: (convoId: string, text: string) => Promise<boolean>;
  removeCustomerNote: (convoId: string, noteId: string, reason?: string) => Promise<boolean>;
  toast: (s: string) => void;
  /** M5 未绑定策略的「等待分配提醒」分钟数；未读到时按 5 分钟。 */
  unboundAlertMinutes?: number;
  openActionConfirm: (req: import("../k-tabs/types").ActionConfirmReq & { briefKind: import("../design-kit").OperatorBriefKind }) => void;
  openConfirm: (req: import("../k-tabs/types").ConfirmReq) => void;
};
