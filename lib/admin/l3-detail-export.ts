import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";

export const L3_FINANCE_DETAIL_FIELDS = [
  "交易时间", "用户编码（脱敏）", "业务编号", "账单类型", "资产", "方向", "金额", "余额", "状态",
] as const;

export type L3DetailRequest = {
  exportType: "财务资金明细";
  timeRange: string;
  fields: string;
  piiLevel: "HIGH_PII";
  maskPolicy: "MASKED";
  recipient: string;
  ticket: string;
  reason: string;
  operator: string;
};

export type PendingL3Detail = PendingMutationRecord & {
  owner: string;
  request: L3DetailRequest;
  reportId?: string;
};

// One store for the page and its recovery path. The exact serialized request is
// the fingerprint; JSON round trips preserve its property order for byte-identical replay.
export const l3DetailCommands = createPendingMutationStore<PendingL3Detail>({
  storageKey: "nexion-admin-l3-detail-commands-v1",
  retainExpiredRecords: true,
  isValidRecord(record) {
    const request = record.request;
    return typeof record.owner === "string" && record.owner.length > 0
      && !!request && typeof request === "object" && !Array.isArray(request)
      && request.exportType === "财务资金明细" && request.piiLevel === "HIGH_PII" && request.maskPolicy === "MASKED"
      && typeof request.timeRange === "string" && /^\d{4}-\d{2}-\d{2}\/\d{4}-\d{2}-\d{2}$/.test(request.timeRange)
      && typeof request.fields === "string" && request.fields.length > 0
      && request.fields.split(",").every(field => L3_FINANCE_DETAIL_FIELDS.includes(field as typeof L3_FINANCE_DETAIL_FIELDS[number]))
      && [request.recipient, request.ticket, request.reason, request.operator].every(value => typeof value === "string" && value.trim().length > 0)
      && record.fingerprint === JSON.stringify(request)
      && (record.reportId === undefined || typeof record.reportId === "string" && /^EXP-[A-Z0-9]{8}$/.test(record.reportId));
  },
});
