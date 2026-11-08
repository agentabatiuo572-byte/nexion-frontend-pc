"use client";

/**
 * D6 汇率设置（配置页，PG-46）：先看用户现在按什么价下单（买入价），再改基准价、买入点差、报价有效期，调整历史收起，相关页面在页底。
 * 三项共用一个版本号；基准价上调或最终充值报价下降走资金审批，其他方向直接保存。
 * 写操作照提现审核：先存原操作再发；明确被拒留在框里，版本冲突读最新后重开，结果未知转页面上方的待确认（OP-91～OP-97）。
 */
import { useReach } from "@/lib/nav/use-reach";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins, History, RefreshCw, SlidersHorizontal } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, ConfigList, ConflictBar, ConfigRow, Decision, Drawer, Explain, Fact, Facts, Field, KeepText, Fold, Notice, NumberInput, PageHeader, Panel, ReleaseModal, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
import { createA2OperationProposal, fetchA2Overview, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { roleLabel } from "@/lib/nav/console-nav";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { businessClock, businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import {
  d6QuoteRate,
  DRequestError,
  isDOutcomeUnknownError,
  loadD6FxQuote,
  parseD6ApprovalValues,
  preflightD6FxQuote,
  updateD6FxQuote,
  type D6FxQuote,
} from "@/lib/admin/d-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { ActionConfirmReq, DCtx } from "./types";

type ParamKey = "baseRateVndPerUsdt" | "buySpreadPct" | "lockWindowMinutes";
type FxValues = Pick<D6FxQuote, ParamKey>;
type HistoryRow = D6FxQuote["history"][number];

/** 三项的说明直接写在这里：只有三项，只这页用（重构说明 3.3）。scope 是确认框「说明」，只写范围，生效方式由标签说。 */
const PARAMS = [
  {
    key: "baseRateVndPerUsdt", label: "基准价", unit: "₫/USDT", min: 20_000, max: 35_000, step: 1,
    what: "人工设定的 1 USDT 折合越南盾基准",
    when: "基准价上调或买入价下降须另一位有权超管批准后生效；其他方向直接保存，已下的单不变",
    where: "App 和 H5 充值页「银行卡支付」的「牌价」这一行；App 和 H5 银行卡提现确认页「每 USDT 兑换 VND」",
    effect: "买入价跟着变，银行卡提现的新报价也跟着变",
    scope: "影响之后的新付款单和新的提现报价，已下的单不变。",
    hint: "整数，20,000–35,000",
    impact: "用户下单和提现报价都用新价",
    check: "核对新值和改后的买入价，理由写清调价依据。",
    placeholder: "例如：工单号、参考的市场价",
    done: "基准价已更新，新付款单和新的提现报价起生效",
  },
  {
    key: "buySpreadPct", label: "买入点差", unit: "%", min: 0, max: 3, step: 0.01, maxDecimals: 2,
    what: "基准价上加的比例，算出买入价",
    when: "买入价下降须另一位有权超管批准后生效；其他方向直接保存，只影响新付款单",
    where: "App 和 H5 充值页「银行卡支付」的「牌价」这一行",
    effect: "买入价跟着变，提现报价不变",
    scope: "只影响之后的新付款单，已下的单不变。",
    hint: "0–3%，最多两位小数",
    impact: "用户下单的买入价跟着变，提现报价不变",
    check: "核对新值和改后的买入价，理由写清调价依据。",
    placeholder: "例如：工单号、参考的市场价",
    done: "买入点差已更新，新付款单起生效",
  },
  {
    key: "lockWindowMinutes", label: "报价有效期", unit: "分钟", min: 5, max: 120, step: 1,
    what: "用户在充值页下单后，买入价能锁定多久",
    when: "立即生效，只对充值页新建的付款单生效，已下的单不变",
    where: "App 和 H5 充值页「银行卡支付」的「牌价」这一行",
    note: "只管充值页「银行卡支付」新建的付款单。买设备用银行卡付款的报价最长 15 分钟，不受这项影响；提现报价的时长在「越南盾提现参数」改。",
    effect: "之后在充值页新建的付款单按新的时长锁定买入价",
    scope: "只影响之后在充值页新建的付款单，已下的单不变。",
    hint: "整数，5–120 分钟",
    impact: "只管充值页新建付款单的锁价时长",
    check: "核对新的锁价时长，理由写清为什么改。",
    placeholder: "例如：工单号、用户反馈的付款时间",
    done: "报价有效期已更新，新付款单起生效",
  },
] as const;
type Param = (typeof PARAMS)[number];
const paramOf = (key: ParamKey) => PARAMS.find((param) => param.key === key)!;

const READING = "正在读取最新数据，读完再操作";
const LOCKED = "先处理上方的待确认，再调整";
const NO_WRITE = "这个账号现在没有调整权限，不能重试，请在调整历史里核对";
const RETRY_AGAIN = "原操作已被拒绝，再重试结果一样";

function vnd(value: number) {
  return value.toLocaleString("en-US");
}

/** 页面上的值，带单位，不舍入。 */
function valueText(key: ParamKey, value: number) {
  if (key === "buySpreadPct") return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
  if (key === "lockWindowMinutes") return `${value} 分钟`;
  return `${vnd(value)} ₫/USDT`;
}

/** 列表和待确认条写到分钟，抽屉里写到秒。 */
const minuteText = (value: string) => formatBusinessTimeFull(value, "—").slice(0, 16);

function historyBefore(row: HistoryRow): FxValues {
  return { baseRateVndPerUsdt: row.beforeBaseRateVndPerUsdt, buySpreadPct: row.beforeBuySpreadPct, lockWindowMinutes: row.beforeLockWindowMinutes };
}

/** 一条调价记录改了哪几项。列表只列改了的，三项完整的前后值在抽屉里。 */
function historyChanges(row: HistoryRow) {
  const before = historyBefore(row);
  return PARAMS.filter((param) => before[param.key] !== row[param.key]).map((param) => ({ param, before: before[param.key], after: row[param.key] }));
}

function changeText(key: ParamKey, before: number, after: number) {
  const unitless = (value: number) => key === "baseRateVndPerUsdt" ? vnd(value) : key === "lockWindowMinutes" ? String(value) : valueText(key, value);
  return `${paramOf(key).label} ${unitless(before)} → ${valueText(key, after)}`;
}

/** 一次写操作的全部内容。结果未知时原样保存，重试只能发这一份（OP-92、OP-94）。 */
type FxCommand = { param: ParamKey; values: FxValues; before: number; after: number; expectedVersion: number; reason: string; operator: string; proposal?: Parameters<typeof createA2OperationProposal>[0] };
type PendingFx = PendingMutationRecord & FxCommand;
/** 三项共用一个版本号，待确认锁整组，指纹只有一个。 */
const SCOPE = "d6|fx-quote";

const pendingFx = createPendingMutationStore<PendingFx>({
  storageKey: "nexion-admin-d6-fx-commands-v1",
  // 过了 24 小时不能再用原号重试，记录和锁都留着，等人核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => PARAMS.some((param) => param.key === record.param)
    && !!record.values && PARAMS.every((param) => Number.isFinite(record.values[param.key]))
    && [record.before, record.after, record.expectedVersion].every(Number.isFinite)
    && typeof record.reason === "string" && record.reason.length > 0
    && typeof record.operator === "string"
    && (record.proposal === undefined || record.proposal.command?.op === "d6_fx_quote" && record.proposal.reason === record.reason),
});

function fxCommandKey() {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `d6-fx-${uuid.replaceAll("-", "").slice(0, 16)}`;
}

const fxReasonCode = (error: unknown) => error instanceof DRequestError ? error.reasonCode
  : error instanceof Error && "backendMessage" in error ? String(error.backendMessage) : undefined;
const isConflict = (error: unknown) => fxReasonCode(error) === "FX_QUOTE_VERSION_CONFLICT";

/** 重试被拒的原因只写发生了什么，不带「刷新后重试」这类动作句：下一步由待确认条统一给。 */
function retryRejectedReason(cause: unknown) {
  if (isConflict(cause)) return "这期间这组汇率被别人改过，原操作没有再执行。";
  if (fxReasonCode(cause) === "FX_QUOTE_NO_CHANGES") return "现在的值已经和原操作要改成的一样，原操作没有再执行。";
  return `${displayAdminError(cause).split("；")[0].replace(/[。.]$/, "")}。`;
}

export function D6Fx({ ctx }: { ctx: DCtx }) {
  const reach = useReach();
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const operator = session?.operator || session?.username || "";
  const authorities = session?.authorities ?? [];
  const canManage = authorities.includes("finance_d6_manage");
  const canQueryOriginal = authorities.includes("platform_a2_read") || authorities.includes("platform_a2_proposal_create");
  const proposalBlocked = !authorities.includes("platform_a2_proposal_create") && !authorities.includes("platform_a2_write") ? "这个账号没有发起审批的权限" : undefined;
  const [data, setData] = useState<D6FxQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readAt, setReadAt] = useState("");
  const [pending, setPending] = useState<PendingFx | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryRejected, setRetryRejected] = useState("");
  const [pendingNote, setPendingNote] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [currentId, setCurrentId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ param: Param; quote: D6FxQuote; value: string; touched: boolean } | null>(null);
  const [approvalValues, setApprovalValues] = useState<FxValues | null>(null);
  const [approvalReadError, setApprovalReadError] = useState("");
  const loadEpoch = useRef(0);
  const syncPending = useCallback(() => setPending(pendingFx.list()[0] ?? null), []);

  /** 读一次。失败清掉旧值，汇率是资金数据，不留旧的（ST-36）；返回 null。旧请求晚到的结果不用。读失败只是没读到，不按写操作的结果未知说（F5）。 */
  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    setLoading(true);
    try {
      const next = await loadD6FxQuote();
      if (epoch !== loadEpoch.current) return null;
      setData(next);
      setApprovalValues(null);
      setApprovalReadError("");
      if (next.approval?.status === "pending") {
        if (authorities.includes("platform_a2_read")) {
          try {
            const overview = await fetchA2Overview({ domain: "D" });
            if (epoch !== loadEpoch.current) return null;
            const ticket = overview.operationQueue.find((row) => row.id === next.approval?.operationId);
            if (!ticket) throw new Error("原审批单暂未读到");
            setApprovalValues(parseD6ApprovalValues(ticket.after));
          } catch (cause) {
            if (epoch !== loadEpoch.current) return null;
            setApprovalReadError(`待批新值暂时读不到：${displayAdminReadError(cause)}`);
          }
        } else setApprovalReadError("这个账号不能读取原审批单的新值，请有权人员到「操作记录与审批」核对。");
      }
      setReadAt(businessClock(Date.now()));
      setError("");
      return next;
    } catch (err) {
      if (epoch !== loadEpoch.current) return null;
      setData(null);
      setCurrentId(null);
      setError(displayAdminReadError(err));
      return null;
    } finally {
      if (epoch === loadEpoch.current) setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => syncPending(), [syncPending]);

  /**
   * 写操作只走这一条路（OP-92、OP-93）。新操作先存好再发；明确被拒丢号，留在确认框；
   * 结果未知保号，关框，清掉旧值，重读一次，转成页面上方的待确认。
   * 重试的是保留下来的原操作时，被拒也证明不了原操作的结果，继续保留，只有成功才解除。
   */
  const sendCommand = async (item: FxCommand, retry?: PendingFx) => {
    if (!retry && pendingFx.get(SCOPE)) throw new Error(LOCKED);
    const key = retry?.commandKey ?? fxCommandKey();
    pendingFx.remember(SCOPE, key, item);
    if (!pendingFx.isDurablyStored(SCOPE, key)) {
      if (!retry) pendingFx.forget(SCOPE, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    let ticket: A2OperationRow | undefined;
    try {
      if (item.proposal) ticket = await createA2OperationProposal(item.proposal, key, true);
      else await updateD6FxQuote(item.values, item.expectedVersion, item.reason, item.operator, key);
    } catch (cause) {
      const unknown = isDOutcomeUnknownError(cause) || isA2OutcomeUncertainError(cause);
      if (!unknown && !retry) pendingFx.forget(SCOPE, key);
      syncPending();
      if (!unknown) throw cause;
      loadEpoch.current += 1;
      setData(null);
      toast("保存结果未确认，不要重新修改。先看页面上方的提示。", "warn");
      await load();
      return;
    }
    pendingFx.forget(SCOPE, key);
    syncPending();
    // 写回执不包含最近审批，原号重试还可能拿到旧快照，始终回读当前配置和审批。
    await load();
    toast(ticket ? `审批单 ${ticket.id} · ${ticket.status === "pending" ? "等待另一位有权超管批准，当前买入价不变" : "已找回原单，请核对审批结果"}` : paramOf(item.param).done, "success");
  };

  /** 按原操作重试：同命令号、同内容、同理由、同版本号，不接受新输入（OP-94）。 */
  const retryPending = async (record: PendingFx) => {
    if (record.expiresAt <= Date.now() || !canManage || retryRejected) return;
    if (!pendingFx.isDurablyStored(record.fingerprint, record.commandKey)) {
      setPendingNote("浏览器里查不到这条记录，本次没有发送。待确认继续保留，请在调整历史里核对。");
      return;
    }
    setPendingNote("");
    setRetrying(true);
    try {
      await sendCommand(record, record);
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      // 只有后端明确拒绝才给「解除待确认」；登录、权限、限流这类不是对原操作的结论，可以再重试（OP-153）。
      if (isExplicitRejection(cause)) setRetryRejected(retryRejectedReason(cause));
      else setPendingNote(`这次没能确认结果：${retryRejectedReason(cause)}原操作继续保留。`);
    } finally {
      setRetrying(false);
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本地锁，不发请求。 */
  const releasePending = (record: PendingFx) => {
    pendingFx.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(false);
    setRetryRejected("");
    setPendingNote("");
    toast("已解除本页待确认；后端原操作未结案时仍会阻止新提交", "success");
  };

  /** 查原审批单只收尾这次提交的未知结果，不把待批当成已生效。 */
  const queryOriginal = async (record: PendingFx) => {
    setRetrying(true);
    try {
      const ticket = await fetchA2ProposalByKey(record.commandKey, true);
      if (!ticket) { setPendingNote("暂未查到原审批单，结果仍未知，原命令继续保留。"); return; }
      pendingFx.forget(record.fingerprint, record.commandKey);
      syncPending();
      await load();
      toast(`已找回原审批单 ${ticket.id}，请核对审批进度；当前值以本页回读为准`, "success");
    } catch (cause) {
      setPendingNote(`查询没有成功：${displayAdminReadError(cause)}。原命令继续保留。`);
    } finally { setRetrying(false); }
  };

  /** 先填新值再进入共用确认框，方向和按钮始终一致；输入框不随方向跳动。 */
  const openAdjust = (param: Param, quote: D6FxQuote) => setEditing({ param, quote, value: String(quote[param.key]), touched: false });
  const confirmAdjust = (param: Param, quote: D6FxQuote, value: number, formKey = 0, changed?: string, forceApproval = false) => {
    const values: FxValues = { baseRateVndPerUsdt: quote.baseRateVndPerUsdt, buySpreadPct: quote.buySpreadPct, lockWindowMinutes: quote.lockWindowMinutes, [param.key]: value };
    const newRate = d6QuoteRate(values.baseRateVndPerUsdt, values.buySpreadPct);
    const baseIncrease = values.baseRateVndPerUsdt > quote.baseRateVndPerUsdt;
    const approvalRequired = forceApproval || baseIncrease || newRate < quote.quoteRateVndPerUsdt;
    const checkCopy = baseIncrease ? "基准价上调，提交和批准时都会检查可靠兑付覆盖率，低于红线或读不到时不能提交、批准。" : "本次仅降低充值买入价，不触发基准价上调的资金检查；仍需另一位有权超管批准。";
    const req: ActionConfirmReq = {
      briefKind: "config", action: `调整汇率 · ${param.label}`, title: `调整${param.label}`, formKey,
      detail: param.scope,
      blockedReason: value === quote[param.key] ? "最新值已与输入相同，没有需要提交的修改。" : undefined,
      approval: approvalRequired ? { coverageCheckCopy: checkCopy, disabledReason: proposalBlocked ?? (quote.approval?.status === "pending" ? "已有汇率审批单等待处理，请先核对原单" : undefined) } : undefined,
      effect: approvalRequired ? <StatusTag tone="progress" filled explain="另一位有权超管批准前，当前配置不变；批准时重核双方权限和配置版本。">批准后生效</StatusTag> : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: <Facts>
        <Fact k={param.label}><Change from={valueText(param.key, quote[param.key])} to={valueText(param.key, value)} /></Fact>
        {param.key === "lockWindowMinutes" ? <>
          <Fact k="影响范围">之后在充值页「银行卡支付」新建的付款单</Fact>
          <Fact k="不受影响"><KeepText text="买设备用银行卡付款的报价（最长 15 分钟）、提现报价" phrases={["提现报价"]} /></Fact>
        </> : <Fact k="买入价" unit="₫/USDT"><Change from={vnd(quote.quoteRateVndPerUsdt)} to={vnd(newRate)} /></Fact>}
        {approvalRequired && <Fact k="资金检查">{checkCopy}</Fact>}
        {!approvalRequired && quote.approval?.status === "pending" && <Fact k="待批原单" tone="warn">直接保存会更新版本，原审批单批准时须重新核对版本。</Fact>}
        {changed && <Fact k="刚被别人改过" tone="warn">{changed}<p className="rd-note">理由已清空，请按最新的值重写</p></Fact>}
      </Facts>,
      statedBrief: { impact: param.impact, check: param.check }, reasonMin: 8, reasonMax: 200, reasonPlaceholder: param.placeholder,
      confirmLabel: approvalRequired ? "提交审批" : "确认修改，立即生效",
      completionCopy: approvalRequired ? "另一位有权超管批准后才生效，提交审批不改变当前买入价，旧单锁价不回写。" : undefined,
      run: async (reason) => {
        try {
          let proposal: FxCommand["proposal"];
          if (approvalRequired) {
            const preview = await preflightD6FxQuote(values, quote.version, reason);
            proposal = {
              action: "调整汇率", obj: "current", beforeValue: preview.before, afterValue: preview.after,
              operator, operatorRole: roleLabel(session!.role), type: "fund", amplifies: true, sos: false, roleGate: "超管", reason,
              sourceDomain: "D6", target: { domain: "D", type: "fx_quote", id: "current" },
              command: { domain: "D", op: "d6_fx_quote", params: { values: { ...values, expectedVersion: quote.version } } },
            };
          }
          await sendCommand({ param: param.key, values, before: quote[param.key], after: value, expectedVersion: quote.version, reason, operator, ...(proposal ? { proposal } : {}) });
          setEditing(null);
        } catch (cause) {
          const code = fxReasonCode(cause);
          if (isConflict(cause)) openActionConfirm({ ...req, blockedReason: <ConflictBar message="这组汇率刚被别人改过，这次没有保存。读取最新后再核对新值。" onRead={async () => {
            const latest = await load();
            if (!latest) throw new Error("读取最新失败");
            const changes = PARAMS.filter((item) => latest[item.key] !== quote[item.key]).map((item) => changeText(item.key, quote[item.key], latest[item.key])).join("；");
            setEditing({ param, quote: latest, value: String(value), touched: false });
            confirmAdjust(param, latest, value, formKey + 1, changes || "内容有更新，上面已是最新");
          }} /> });
          if (code === "D6_FX_QUOTE_APPROVAL_REQUIRED") openActionConfirm({ ...req, blockedReason: <span className="rd-toolbar">这组调价需要审批，当前输入已保留。<Button size="sm" onClick={() => confirmAdjust(param, quote, value, formKey + 1, undefined, true)}>转为审批</Button></span> });
          if (code === "D6_FX_QUOTE_NOT_APPROVAL_DIRECTION") openActionConfirm({ ...req, blockedReason: <ConflictBar message="后端确认这组调整不属于审批方向，请重新核对直接保存。" onRead={async () => { const latest = await load(); if (!latest) throw new Error("读取最新失败"); confirmAdjust(param, latest, value, formKey + 1); }} /> });
          throw cause;
        }
      },
    };
    openActionConfirm(req);
  };

  const editValue = editing?.value.trim() === "" ? Number.NaN : Number(editing?.value);
  const editError = !editing ? undefined : !Number.isFinite(editValue) || editValue < editing.param.min || editValue > editing.param.max
    || (editing.param.key === "buySpreadPct" ? Math.abs(editValue * 100 - Math.round(editValue * 100)) > 1e-8 : !Number.isInteger(editValue)) ? editing.param.hint : undefined;
  const editQuote = editing && !editError ? d6QuoteRate(editing.param.key === "baseRateVndPerUsdt" ? editValue : editing.quote.baseRateVndPerUsdt, editing.param.key === "buySpreadPct" ? editValue : editing.quote.buySpreadPct) : null;
  const editApproval = !!editing && !editError && (editing.param.key === "baseRateVndPerUsdt" && editValue > editing.quote.baseRateVndPerUsdt || editQuote! < editing.quote.quoteRateVndPerUsdt);
  const editor = editing && <Drawer open onClose={() => {
    if (editing.value === String(editing.quote[editing.param.key])) { setEditing(null); return; }
    ctx.openConfirm({ briefKind: "config", action: "放弃汇率修改", title: "放弃未提交的修改", detail: "新值还没有提交，放弃后需要重新填写。", reason: false, okLabel: "放弃修改", run: () => setEditing(null) });
  }} title={`调整${editing.param.label}`} icon={SlidersHorizontal} tone="role-4"
    footer={<Decision note={editError ? undefined : editApproval ? "另一位有权超管批准前，当前值不变" : "直接保存后生效，旧单不变"} primary={<Button variant="primary" disabledReason={editError ? "先填有效的新值" : editValue === editing.quote[editing.param.key] ? "没有改动" : undefined} onClick={() => confirmAdjust(editing.param, editing.quote, editValue)}>继续填写理由</Button>} />}>
    <Facts><Fact k="当前值">{valueText(editing.param.key, editing.quote[editing.param.key])}</Fact></Facts>
    <Field label="新值" required hint={editing.param.hint} error={editing.touched ? editError : undefined}>
      <NumberInput value={editing.value} unit={editing.param.unit} min={editing.param.min} max={editing.param.max} step={editing.param.step} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onBlur={() => setEditing({ ...editing, touched: true })} />
    </Field>
    {editQuote !== null && <Facts>
      <Fact k="改后买入价" unit="₫/USDT"><Change from={vnd(editing.quote.quoteRateVndPerUsdt)} to={vnd(editQuote)} /></Fact>
      <Fact k="生效方式">{editApproval ? <StatusTag tone="progress" filled>批准后生效</StatusTag> : <StatusTag tone="progress" filled>立即生效</StatusTag>}</Fact>
      <Fact k="影响">{editing.param.scope}</Fact>
    </Facts>}
  </Drawer>;

  const latest = data?.history[0];
  const latestChanges = latest ? historyChanges(latest) : [];
  const history = data?.history ?? [];
  const zone = businessZone().label;
  const blocked = loading ? READING : pending ? LOCKED : editing ? "先完成或关闭当前调整" : undefined;
  const currentIndex = history.findIndex((row) => row.id === currentId);
  const currentRow = currentIndex >= 0 ? history[currentIndex] : null;

  const header = (
    <PageHeader
      pageId="D6"
      title="汇率设置"
      summary="设置 VND/USDT 基准价、买入点差和报价有效期。"
      meta={data ? <span className="rd-toolbar">
        <span>{readAt ? `${readAt} 读取（${zone}）· ` : ""}打开时读取</span>
        <Button variant="ghost" size="sm" loading={loading} disabled={retrying} icon={<RefreshCw size={14} aria-hidden />} onClick={() => void load()}>刷新</Button>
      </span> : undefined}
      readOnly={data && !canManage ? "你只能查看；这个账号没有调整汇率的权限。" : undefined}
    />
  );

  // 待确认常显，读取失败时也在（OP-93）。正文写发生了什么和下一步，动作排在正文下面（DT-09）。
  const pendingNotice = pending && (() => {
    const param = paramOf(pending.param);
    const expired = pending.expiresAt <= Date.now();
    const canAudit = reach("/platform/audit", "platform_a2_read");
    const auditLink = canAudit && <Link className="rd-link" href="/platform/audit?domain=D&object=VND_USDT" prefetch={false}>操作记录与审批</Link>;
    const when = minuteText(new Date(pending.createdAt).toISOString());
    const what = `把${param.label}改成 ${valueText(pending.param, pending.after)}`;
    const retryBlock = expired ? "已超过 24 小时，不能再重试" : !canManage ? NO_WRITE : retryRejected ? RETRY_AGAIN : undefined;
    return (
      <Notice tone="warn" title="保存结果未确认，已停止展示旧的买入价" actionBelow action={<>
        <span data-pair="">
          <Button size="sm" loading={retrying} disabledReason={retryBlock} onClick={() => void retryPending(pending)}>按原操作重试</Button>
          {!retryBlock && <Explain label="按原操作重试会怎样" content="重发原内容和原命令号，已成功的不会重复执行。" />}
        </span>
        {pending.proposal && canQueryOriginal && <Button size="sm" loading={retrying} onClick={() => void queryOriginal(pending)}>查询原审批单</Button>}
        {retryRejected && !expired && <Button size="sm" disabled={retrying} onClick={() => setReleasing(true)}>解除待确认</Button>}
        {auditLink && !expired && <span>到{auditLink}核对</span>}
        <Explain label="技术信息" content={`命令号 ${pending.commandKey} ｜ 原版本 ${pending.expectedVersion} ｜ 理由 ${pending.reason}`}>技术信息</Explain>
      </>}>
        <p>{when}（{zone}）{what} 的操作可能已经提交，{data ? "下面是重新读到的值。" : ""}确认前不能再改。</p>
        {/* 过期后不能重试、不能解除，也不引导关标签页绕过：如实写怎么核对、交给谁（F4、BE-03）。 */}
        {expired && (canAudit
          ? <p>已超过 24 小时，不能再重试。请财务负责人到{auditLink}和下面的调整历史核对这次修改有没有生效。</p>
          : <p>已超过 24 小时，不能再重试。这个账号看不到操作记录，请在下面的调整历史里核对这次修改有没有生效，再交财务负责人处理。</p>)}
        {!expired && !canManage && <p>{NO_WRITE}。</p>}
        {retryRejected && !expired && <>
          <p>重试没有成功：{retryRejected}</p>
          <p>先核对原审批单和调整历史；列表里找不到记录不能证明没执行。「解除待确认」只清本页记录，不会替后端原操作结案，后端仍可能阻止新提交。</p>
        </>}
        {pendingNote && <p>{pendingNote}</p>}
      </Notice>
    );
  })();
  const releaseModal = pending && releasing && (
    <ReleaseModal label={`把${paramOf(pending.param).label}改成 ${valueText(pending.param, pending.after)}`} onCancel={() => setReleasing(false)} onConfirm={() => releasePending(pending)} />
  );

  if (!data) {
    return (
      <>
        {header}
        {pendingNotice}
        {loading
          ? <BlockState state="loading" title="正在读取汇率设置…" />
          : <BlockState state="error" title="汇率设置加载失败"
            detail={<>读不到汇率设置，页面不显示任何旧值。点「重试」；一直失败请联系财务值班人员。{error && <Explain label="失败原因" content={error} />}</>}
            onRetry={() => void load()} />}
        {releaseModal}
        {editor}
      </>
    );
  }

  // 名字和菜单一致；目标页进不去就不显示（X03）。和其他已改版页一样放页底一行（PG-40）。
  const related = [
    reach("/finance/recon", "finance_d1_read") && <Link key="recon" className="rd-link" href="/finance/recon" prefetch={false}>充值与收款对账</Link>,
    reach("/finance/payout-vnd", "finance_d7_read") && <Link key="payout" className="rd-link" href="/finance/payout-vnd" prefetch={false}>越南盾提现参数</Link>,
    reach("/platform/audit", "platform_a2_read") && <Link key="audit" className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>,
    reach("/platform/events") && <Link key="events" className="rd-link" href="/platform/events" prefetch={false}>用户行为事件</Link>,
  ].filter(Boolean);
  // 公式一行不折：空格换成不换行空格，全角括号前后加 WORD JOINER。
  const nbsp = (text: string) => text.replaceAll(" ", "\u00a0").replaceAll("（", "\u2060（").replaceAll("）", "）\u2060");

  return (
    <>
      {header}

      {pendingNotice}

      {/* 正常时一句话、不放大（VS-23）；有待确认时上面的提示条就是结论。 */}
      {loading
        ? <Conclusion state="unknown">{READING}</Conclusion>
        : !pending && (data.approval?.status === "pending"
          ? <Conclusion state="warn">有汇率调整等待批准，当前买入价不变</Conclusion>
          : <Conclusion state="ok" explain="当前值来自汇率读取接口，最近审批状态也来自服务端。这句话不比较市场价。汇率不会自动更新，要人工调整。">当前买入价已读取</Conclusion>)}

      {/* 只有两个数：每格从内容宽往外长，不拉成等宽的半格（DP-12）。 */}
      <StatBand label="汇率摘要" fit>
        <Stat lead tone="role-1" icon={Coins} label="买入价" value={vnd(data.quoteRateVndPerUsdt)} unit="₫/USDT"
          explain={<>
            <p>基准价 ×（1 + 买入点差），取整到十位。</p>
            <p>{nbsp(`${vnd(data.baseRateVndPerUsdt)} ₫/USDT ×（1 + ${valueText("buySpreadPct", data.buySpreadPct)}）= ${vnd(data.quoteRateVndPerUsdt)} ₫/USDT`)}</p>
            <p>用户在 App 和 H5 用银行卡支付时按这个价算。充值页新建付款单时取服务端当时的买入价；买设备用银行卡付款时，在报价那一刻取价，报价有效期内建单沿用这个价。</p>
            <p>用户页面上的「牌价」可能还没刷新。</p>
          </>} />
        <Stat tone="role-other" icon={History} label="最近调整" value={latest ? minuteText(latest.createdAt) : "—"} unit={latest ? zone : undefined}
          sub={latest ? `${maskAuditActor(latest.operator)} · ${latestChanges.map((change) => change.param.label).join("、") || "—"}` : undefined} />
      </StatBand>

      {data.approval && <Panel title="最近审批" icon={History} tone="role-other">
        <Facts>
          <Fact k="审批单">{data.approval.operationId}{reach("/platform/audit", "platform_a2_read") && <> · <Link className="rd-link" href="/platform/audit?domain=D&object=current" prefetch={false}>操作记录与审批</Link></>}</Fact>
          <Fact k="审批状态"><StatusTag tone={data.approval.status === "pending" ? "warn" : "done"}>{({ pending: "等待另一位有权超管批准", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" })[data.approval.status]}</StatusTag></Fact>
          <Fact k="提交人">{maskAuditActor(data.approval.submittedBy)} · {minuteText(data.approval.submittedAt)}（{zone}）</Fact>
          {data.approval.status === "pending" && (approvalValues ? <>
            <Fact k="待批买入价" unit="₫/USDT">{vnd(d6QuoteRate(approvalValues.baseRateVndPerUsdt, approvalValues.buySpreadPct))}<span className="rd-fact-unit">尚未生效</span></Fact>
            {PARAMS.map((param) => <Fact key={param.key} k={`待批${param.label}`}>{valueText(param.key, approvalValues[param.key])}</Fact>)}
          </> : <Fact k="待批新值">{approvalReadError || "正在读取原审批单…"}</Fact>)}
          {data.approval.applied && <Fact k="生效记录">这张单已批准，当前配置以本页当前值为准<Explain label="批准状态和当前值" content="批准状态只表示这张单已批准，之后可能又有直接调整，不能把原单新值当成当前值。" /></Fact>}
        </Facts>
      </Panel>}

      <Panel title="报价参数" icon={SlidersHorizontal} tone="role-4"
        explain="基准价和买入点差决定用户付多少越南盾，报价有效期决定充值付款单的买入价锁多久。每项是什么、显示在哪、什么时候生效，看名称旁的提示；改一项存一项。">
        <ConfigList label="报价参数">
          {PARAMS.map((param) => (
            <ConfigRow key={param.key} name={param.label} what={param.what} when={param.when} where={param.where} effect={param.effect}
              note={"note" in param ? param.note : undefined}
              value={valueText(param.key, data[param.key])}
              action={canManage ? (describedBy) => <Button size="sm" aria-label={`调整 ${param.label}`} aria-describedby={describedBy} disabledReason={blocked} onClick={() => openAdjust(param, data)}>调整</Button> : undefined} />
          ))}
        </ConfigList>
      </Panel>

      <Fold title="调整历史" icon={History} tone="role-other" summary={history.length === 0 ? "暂无调价历史" : history.length >= 50 ? "最近 50 条" : `共 ${history.length} 条`}
        explain={history.length > 0 ? "点一行看这次三项改前改后的完整值和理由全文。" : undefined}>
        <Table label="调整历史">
          <thead>
            <tr>
              <Th>时间（{zone}）</Th>
              <Th>改动 · 理由</Th>
              <Th>操作者</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => {
              const changes = historyChanges(row).map((change) => changeText(change.param.key, change.before, change.after)).join("；") || "—";
              return (
                <Tr key={row.id} selected={row.id === currentId} onOpen={() => setCurrentId(row.id)}>
                  <Td><Cell num main={minuteText(row.createdAt)} /></Td>
                  {/* 理由放第二行，这一列占满剩下的宽度，放不下才省略（ST-02）；完整三项和全文在抽屉里。 */}
                  <Td grow><Cell main={changes} sub={row.reason} title={`${changes}。理由：${row.reason}`} /></Td>
                  <Td><Cell main={maskAuditActor(row.operator)} /></Td>
                </Tr>
              );
            })}
            {history.length === 0 && <TableMessage columns={3}>调价后这里会列出时间、改动、理由和操作者</TableMessage>}
          </tbody>
        </Table>
      </Fold>

      {related.length > 0 && (
        <nav className="rd-links" aria-label="相关页面">
          <span>相关页面</span>
          {related}
        </nav>
      )}

      {/* 单条记录：三项完整的改前改后、当时的买入价、理由全文（F1）。 */}
      <Drawer open={!!currentRow} onClose={() => setCurrentId(null)} title="调整记录" icon={History} tone="role-other"
        sub={currentRow && `${formatBusinessTimeFull(currentRow.createdAt, "—")}（${zone}）`}
        nav={{ hasPrev: currentIndex > 0, hasNext: currentIndex >= 0 && currentIndex < history.length - 1, onPrev: () => setCurrentId(history[currentIndex - 1].id), onNext: () => setCurrentId(history[currentIndex + 1].id) }}>
        {currentRow && (() => {
          const before = historyBefore(currentRow);
          const quoteBefore = d6QuoteRate(before.baseRateVndPerUsdt, before.buySpreadPct);
          const quoteAfter = d6QuoteRate(currentRow.baseRateVndPerUsdt, currentRow.buySpreadPct);
          return (
            <Facts>
              {PARAMS.map((param) => (
                <Fact key={param.key} k={param.label}>
                  {before[param.key] === currentRow[param.key]
                    ? <>{valueText(param.key, currentRow[param.key])}{" "}<span className="rd-note">没改</span></>
                    : <Change from={valueText(param.key, before[param.key])} to={valueText(param.key, currentRow[param.key])} />}
                </Fact>
              ))}
              <Fact k="当时的买入价">
                {quoteBefore === quoteAfter ? <>{vnd(quoteAfter)} ₫/USDT{" "}<span className="rd-note">没变</span></> : <Change from={`${vnd(quoteBefore)} ₫/USDT`} to={`${vnd(quoteAfter)} ₫/USDT`} />}
                <Explain label="当时的买入价怎么算" content="按这次改前、改后的基准价和买入点差算，基准价 ×（1 + 买入点差），取整到十位。" />
              </Fact>
              <Fact k="操作者">{maskAuditActor(currentRow.operator)}</Fact>
              <Fact k="理由"><span className="rd-pre">{currentRow.reason}</span></Fact>
            </Facts>
          );
        })()}
      </Drawer>

      {releaseModal}
      {editor}
    </>
  );
}
