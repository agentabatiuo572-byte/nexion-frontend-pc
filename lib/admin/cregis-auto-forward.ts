import { exceptionObject, exceptionVersion } from "./cregis-exceptions";
export const AUTO_STATES: Record<string,string> = {
  WAIT_COLLECTION:"等待自动归集", COLLECTION_SUBMITTING:"归集请求提交中，禁止重复发送", COLLECTION_PENDING:"归集确认中",
  COLLECTION_UNKNOWN:"归集结果待核查，禁止重发", COLLECTION_FAILED:"归集未完成", WAIT_PAYMENT:"归集已确认，等待自动付款",
  PAYMENT_SUBMITTING:"付款请求提交中，禁止重复发送", PAYMENT_PENDING:"甲方付款确认中", PAYMENT_UNKNOWN:"付款结果待核查，禁止重发",
  PAYMENT_FAILED:"甲方付款未完成", COMPLETED:"归集及甲方付款均已链上确认",
};
export const AUTO_ERRORS: Record<string,string> = {
  CREGIS_AUTO_READ_OR_RISK_UNAVAILABLE:"链上证据、渠道或风控条件待核实，已暂停推进",
  CREGIS_AUTO_USDT_INSUFFICIENT:"来源 USDT 余额不足", CREGIS_AUTO_BNB_REQUIRED:"来源 BNB 不足，须安排链上手续费",
  CREGIS_AUTO_CREATE_REJECTED:"供应商明确拒绝创建；排除原因后可申请重试",
  CREGIS_AUTO_SUBMISSION_UNKNOWN:"请求结果不明，只能核对原单，不能重发", CREGIS_AUTO_TRANSACTION_UNCERTAIN:"供应商失败记录存在交易，须核对原单",
  CREGIS_AUTO_PROVIDER_FAILED:"供应商记录为失败，需核查原因", CREGIS_AUTO_PAUSED:"自动发送已暂停",
  CREGIS_AUTO_CALLBACK_QUERY_REQUIRED:"已收到验签回调，等待供应商与链上核实",
};
export function autoForwardStatus(value: unknown) {
  const row={...exceptionObject(value)};exceptionVersion(row.version);
  for(const field of ["makerId","startEventId","pendingCollection","pendingPayment","reason","proposedAt"])row[field]??=null;
  if(typeof row.runtimeApproved!=="boolean"||typeof row.collectionEnabled!=="boolean"||typeof row.paymentEnabled!=="boolean"
    ||typeof row.executionEnabled!=="boolean"||row.amountPolicy!=="GROSS_COLLECTION_NET_PAYMENT_PLATFORM_GAS"
    ||typeof row.platformAddress!=="string"||!/^0x[0-9a-f]{40}$/i.test(row.platformAddress)
    ||typeof row.counterpartyAddress!=="string"||!/^0x[0-9a-f]{40}$/i.test(row.counterpartyAddress)
    ||row.executionEnabled&&(!row.runtimeApproved||!row.collectionEnabled&&!row.paymentEnabled))throw new Error("自动资金流程配置无效，请刷新核对");
  return row;
}
