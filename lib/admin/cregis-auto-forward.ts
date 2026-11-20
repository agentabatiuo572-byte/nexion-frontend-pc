import { exceptionObject, exceptionVersion, type ExceptionPage } from "./cregis-exceptions";
export type AutoNetwork="BEP20"|"ERC20"|"TRC20";
const CHAIN:Record<AutoNetwork,string>={BEP20:"2510",ERC20:"60",TRC20:"195"};
export const AUTO_STATES: Record<string,string> = {
  WAIT_COLLECTION:"等待自动归集到 Cregis", COLLECTION_SUBMITTING:"归集到 Cregis 请求提交中，禁止重复发送", COLLECTION_PENDING:"归集到 Cregis 确认中",
  COLLECTION_UNKNOWN:"归集到 Cregis 结果待核查，禁止重发", COLLECTION_FAILED:"归集到 Cregis 未完成", WAIT_PAYMENT:"归集到 Cregis 已确认，等待自动 Cregis 转平台收款钱包",
  PAYMENT_SUBMITTING:"自动 Cregis 转平台收款钱包请求提交中，禁止重复发送", PAYMENT_PENDING:"自动 Cregis 转平台收款钱包确认中", PAYMENT_UNKNOWN:"自动 Cregis 转平台收款钱包结果待核查，禁止重发",
  PAYMENT_FAILED:"自动 Cregis 转平台收款钱包未完成", COMPLETED:"自动归集到 Cregis 及自动 Cregis 转平台收款钱包均已链上确认",
};
export const AUTO_ERRORS: Record<string,string> = {
  CREGIS_AUTO_READ_OR_RISK_UNAVAILABLE:"链上证据、渠道或风控条件待核实，已暂停推进",
  CREGIS_AUTO_USDT_INSUFFICIENT:"来源 USDT 余额不足", CREGIS_AUTO_BNB_REQUIRED:"来源 BNB 不足，须安排链上手续费",
  CREGIS_AUTO_ETH_REQUIRED:"来源 ETH 不足，须安排链上手续费", CREGIS_AUTO_TRX_REQUIRED:"来源 TRX 不足，须安排链上手续费",
  CREGIS_AUTO_CREATE_REJECTED:"供应商明确拒绝创建；排除原因后可申请重试",
  CREGIS_AUTO_SUBMISSION_UNKNOWN:"请求结果不明，只能核对原单，不能重发", CREGIS_AUTO_TRANSACTION_UNCERTAIN:"供应商失败记录存在交易，须核对原单",
  CREGIS_AUTO_PROVIDER_FAILED:"供应商记录为失败，需核查原因", CREGIS_AUTO_PAUSED:"自动发送已暂停",
  CREGIS_AUTO_CALLBACK_QUERY_REQUIRED:"已收到验签回调，等待供应商与链上核实",
};
export function autoForwardStatus(value: unknown,network:AutoNetwork="BEP20") {
  const row={...exceptionObject(value)};exceptionVersion(row.version);
  for(const field of ["makerId","startEventId","pendingCollection","pendingPayment","reason","proposedAt"])row[field]??=null;
  if(row.network==null&&network==="BEP20")row.network="BEP20";
  if(row.configured==null&&network==="BEP20")row.configured=true;
  if(row.gasSymbol==null&&network==="BEP20")row.gasSymbol="BNB";
  const address=(value:unknown)=>typeof value==="string"&&(network==="TRC20"?/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(value):/^0x[0-9a-f]{40}$/i.test(value));
  if(row.network!==network||typeof row.configured!=="boolean"||row.gasSymbol!==({BEP20:"BNB",ERC20:"ETH",TRC20:"TRX"}[network])
    ||typeof row.runtimeApproved!=="boolean"||typeof row.collectionEnabled!=="boolean"||typeof row.paymentEnabled!=="boolean"
    ||typeof row.executionEnabled!=="boolean"||row.amountPolicy!=="GROSS_COLLECTION_NET_PAYMENT_PLATFORM_GAS"
    ||row.configured&&(!address(row.platformAddress)||!address(row.counterpartyAddress))
    ||!row.configured&&(row.platformAddress!==null||row.counterpartyAddress!==null||row.executionEnabled)
    ||row.executionEnabled&&(!row.runtimeApproved||!row.collectionEnabled&&!row.paymentEnabled))throw new Error("自动资金流程配置无效，请刷新核对");
  return row;
}

export function autoForwardPage(page:ExceptionPage,network:AutoNetwork):ExceptionPage {
  if(page.records.some(row=>(row.chainId??(network==="BEP20"?"2510":null))!==CHAIN[network]))throw new Error("自动任务网络不匹配，请刷新核对");
  return page;
}
