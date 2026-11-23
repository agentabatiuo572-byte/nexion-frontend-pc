/**
 * 产品 2026-11-23：App 和 H5 已不让用户选 TRC20（充值、提现、外部 USDT 付款）。
 * 后台 TRC20 的可操作项置灰，控件旁常显这句原因（OP-126）；已有的 TRC20 记录照常显示和处理。
 */
export const TRC20_CLOSED = "通道暂未开放";

export const TRC20_PAYMENT_METHOD = "CREGIS_USDT_TRC20";
export const D5_APPROVAL_OP = "d5_withdrawal_limits";
export const TRC20_REPLAY_UNVERIFIED = "读不到原单内容，核对不了会不会打开 TRC20，暂不能按原请求重试";
/** 原操作动到 TRC20 的几种情况。调用处按场景补主语（「这张单」「原请求」）和下一步（OP-93、OP-126）。 */
export const TRC20_OPENS_WITHDRAWAL = "会打开 TRC20 提现";
export const TRC20_CHANGES_FEE = "会改 TRC20 网络确认费";
export const TRC20_FEE_UNVERIFIED = "读不到提交时 TRC20 的原确认费，核对不了会不会改它";
export const D5_DIFF_UNREADABLE = "变更详情加载失败，暂不能批准";

export function d5Trc20ConfirmationFeeBlock(before: number | undefined, after: number | undefined) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return TRC20_FEE_UNVERIFIED;
  if (before !== after) return TRC20_CHANGES_FEE;
}

/** D5 preview persists Java map text with complete three-network groups. */
export function d5Trc20ApprovalBlock(before: string, after: string): string | undefined {
  const read = (side: string) => {
    if (!side.startsWith("{") || !side.endsWith("}")) return null;
    const entries = side.slice(1, -1).split(/, (?=[a-z]\w*=)/g);
    const fields = new Map<string, string>();
    for (const entry of entries) {
      const match = /^(\w+)=(\[[^\[\]{}]+\]|[^,\[\]{}]+)$/.exec(entry);
      if (!match || fields.has(match[1])) return null;
      fields.set(match[1], match[2]);
    }
    const network = fields.get("networkEnabled");
    const fee = fields.get("networkConfirmFeeUsd");
    const networkMatch = network?.match(/^\[TRC20=(true|false), BEP20=(?:true|false), ERC20=(?:true|false)\]$/);
    const feeMatch = fee?.match(/^\[TRC20=([^,]+), BEP20=([^,]+), ERC20=([^,]+)\]$/);
    if ((network && !networkMatch) || (fee && !feeMatch?.slice(1).every(value =>
      /^\d+(?:\.\d+)?(?:E[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value))))) return null;
    return { network: networkMatch?.[1], fee: feeMatch ? Number(feeMatch[1]) : undefined };
  };
  const from = read(before);
  const to = read(after);
  if (!from || !to || (from.network === undefined) !== (to.network === undefined)
    || (from.fee === undefined) !== (to.fee === undefined)) return D5_DIFF_UNREADABLE;
  if (from.network === "false" && to.network === "true") return TRC20_OPENS_WITHDRAWAL;
  if (from.fee !== undefined) return d5Trc20ConfirmationFeeBlock(from.fee, to.fee);
}

type CregisReplayRecord = { path: string; body: string };
type CregisSwitchCase = { id?: unknown; network?: unknown; creditEnabled?: unknown };

function commandParts(record: CregisReplayRecord) {
  const [path, query] = record.path.split("?");
  let body: Record<string, unknown> = {};
  try {
    const value = JSON.parse(record.body || "{}");
    if (value && typeof value === "object") body = value;
  } catch { /* Invalid original bodies cannot execute on the server. */ }
  return { path, body, network: new URLSearchParams(query).get("network") ?? body.network };
}

/** An approval replays the server's stored target, which is absent from the decision body. */
function cregisReplayTarget({ path, body, network }: ReturnType<typeof commandParts>) {
  const switchCase = body.decision === "APPROVE" ? /^\/cregis\/switch-cases\/([1-9]\d*)\/decision$/.exec(path)?.[1] : undefined;
  const autoForward = path === "/cregis/auto-forward/policy" && network === "TRC20"
    && (body.action === "APPROVE" || (body.action === "PROPOSE" && (body.collectionEnabled === true || body.paymentEnabled === true)));
  return { switchCase, autoForward };
}

export const needsCregisReplayTarget = (record: CregisReplayRecord) => cregisReplayTarget(commandParts(record));
export const autoForwardFlagOn = (value: unknown) => value === true || value === 1;
const isAutoForwardFlag = (value: unknown) => typeof value === "boolean" || value === 0 || value === 1;

export function opensTrc20AutoForward(policy: Record<string, unknown>) {
  return (autoForwardFlagOn(policy.pendingCollection) && policy.collectionEnabled !== true)
    || (autoForwardFlagOn(policy.pendingPayment) && policy.paymentEnabled !== true);
}

export function cregisTrc20ReplayBlock(
  record: CregisReplayRecord,
  switchCases?: readonly CregisSwitchCase[],
  autoPolicy?: Record<string, unknown> | null,
): string | undefined {
  const { path, body, network } = commandParts(record);
  const { switchCase, autoForward } = needsCregisReplayTarget(record);
  if (switchCase) {
    const ticket = switchCases?.find(row => row && String(row.id) === switchCase);
    if (!ticket) return TRC20_REPLAY_UNVERIFIED;
    if (ticket.network === "TRC20" && ticket.creditEnabled !== false && ticket.creditEnabled !== 0) return TRC20_CLOSED;
  }
  if (network !== "TRC20") return;
  if (path === "/cregis/addresses/provision" || (path === "/cregis/switch-cases" && body.depositEnabled === true)) return TRC20_CLOSED;
  if (autoForward) {
    const collection = body.action === "APPROVE" ? autoPolicy?.pendingCollection : body.collectionEnabled;
    const payment = body.action === "APPROVE" ? autoPolicy?.pendingPayment : body.paymentEnabled;
    if (autoPolicy?.network !== "TRC20" || autoPolicy.version !== body.expectedVersion
        || !isAutoForwardFlag(collection) || !isAutoForwardFlag(payment)
        || typeof autoPolicy.collectionEnabled !== "boolean" || typeof autoPolicy.paymentEnabled !== "boolean") {
      return TRC20_REPLAY_UNVERIFIED;
    }
    if (opensTrc20AutoForward({ ...autoPolicy, pendingCollection: collection, pendingPayment: payment })) return TRC20_CLOSED;
  }
}

export function purchasePaymentChangesTrc20(body: Record<string, unknown>) {
  return Array.isArray(body.channels) && body.channels.some(row => row?.paymentMethod === TRC20_PAYMENT_METHOD);
}
