"use client";

/**
 * D6 汇率设置（配置页，PG-46）：先看用户现在按什么价下单（买入价），再改基准价、买入点差、报价有效期，调整历史收起，相关页面在页底。
 * 三项共用一个版本号，发的是整组值；修改立即生效（资金审批待后端 BE-02，未交付前不写审批）。
 * 写操作照提现审核：先存原操作再发；明确被拒留在框里，版本冲突读最新后重开，结果未知转页面上方的待确认（OP-91～OP-97）。
 */
import { useReach } from "@/lib/nav/use-reach";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Coins, History, RefreshCw, SlidersHorizontal } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, ConfigList, ConflictBar, ConfigRow, Drawer, Explain, Fact, Facts, KeepText, Fold, Notice, PageHeader, Panel, ReleaseModal, Stat, StatBand, StatusTag, Table, TableMessage, Td, Th, Tr } from "@/app/components/rd";
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
    when: "立即生效，影响之后的新付款单和新的提现报价，已下的单不变",
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
    when: "立即生效，只对新付款单生效，已下的单不变",
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
type FxCommand = { param: ParamKey; values: FxValues; before: number; after: number; expectedVersion: number; reason: string; operator: string };
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
    && typeof record.operator === "string",
});

function fxCommandKey() {
  const uuid = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random().toString(36).slice(2)}`;
  return `d6-fx-${uuid.replaceAll("-", "").slice(0, 16)}`;
}

const isConflict = (error: unknown) => error instanceof DRequestError && error.reasonCode === "FX_QUOTE_VERSION_CONFLICT";

/** 重试被拒的原因只写发生了什么，不带「刷新后重试」这类动作句：下一步由待确认条统一给。 */
function retryRejectedReason(cause: unknown) {
  if (isConflict(cause)) return "这期间这组汇率被别人改过，原操作没有再执行。";
  if (cause instanceof DRequestError && cause.reasonCode === "FX_QUOTE_NO_CHANGES") return "现在的值已经和原操作要改成的一样，原操作没有再执行。";
  return `${displayAdminError(cause).split("；")[0].replace(/[。.]$/, "")}。`;
}

export function D6Fx({ ctx }: { ctx: DCtx }) {
  const reach = useReach();
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const operator = session?.operator || session?.username || "";
  const authorities = session?.authorities ?? [];
  const canManage = session?.role === "superadmin" || session?.role === "super"
    || authorities.includes("finance_d6_manage");
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
  }, []);

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
    let next: D6FxQuote;
    try {
      next = await updateD6FxQuote(item.values, item.expectedVersion, item.reason, item.operator, key);
    } catch (cause) {
      const unknown = isDOutcomeUnknownError(cause);
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
    if (retry) {
      // 回放的是当时存的响应，可能比现在旧，重读一次（OP-94）。
      await load();
    } else {
      loadEpoch.current += 1;
      setData(next);
      setReadAt(businessClock(Date.now()));
      setError("");
      setLoading(false);
    }
    toast(paramOf(item.param).done, "success");
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
    toast("已解除待确认，可以重新调整", "success");
  };

  /** 改一项的确认框。被别人改过时框不关；读到最新后按最新的值重开，自己填的新值保留，理由清空（OP-97）。 */
  const openAdjust = (param: Param, quote: D6FxQuote, formKey = 0, carried?: { value: string; changed: string }) => {
    const current = quote[param.key];
    const lock = param.key === "lockWindowMinutes";
    const req: ActionConfirmReq = {
      briefKind: "config",
      action: `调整汇率 · ${param.label}`,
      title: `调整${param.label}`,
      formKey,
      detail: param.scope,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      // 有效期不改买入价：事实写它管哪些单、不管哪些单（F2）；另两项写买入价，填好新值后写「现在 → 改后」，随输入变。
      facts: (value?: string) => {
        const next = value === undefined ? null : { ...quote, [param.key]: Number(value) };
        return (
          <Facts>
            {lock ? <>
              <Fact k="影响范围">之后在充值页「银行卡支付」新建的付款单</Fact>
              <Fact k="不受影响"><KeepText text="买设备用银行卡付款的报价（最长 15 分钟）、提现报价" phrases={["提现报价"]} /></Fact>
            </> : <Fact k="买入价" unit="₫/USDT">{next
              ? <Change from={vnd(quote.quoteRateVndPerUsdt)} to={vnd(d6QuoteRate(next.baseRateVndPerUsdt, next.buySpreadPct))} />
              : vnd(quote.quoteRateVndPerUsdt)}</Fact>}
            {carried && <Fact k="刚被别人改过" tone="warn">{carried.changed}<p className="rd-note">理由已清空，请按最新的值重写</p></Fact>}
          </Facts>
        );
      },
      edit: {
        kind: "number",
        current: String(current),
        initialValue: carried?.value,
        unit: param.unit,
        min: param.min,
        max: param.max,
        step: param.step,
        maxDecimals: "maxDecimals" in param ? param.maxDecimals : undefined,
        disallowCurrent: true,
        hint: param.hint,
        preview: (value) => {
          const next = Number(value);
          if (lock) return `改成 ${next} 分钟：之后在充值页新建的付款单按 ${next} 分钟锁定买入价`;
          const values = { ...quote, [param.key]: next };
          const quoteText = <>买入价变成 <b>{vnd(d6QuoteRate(values.baseRateVndPerUsdt, values.buySpreadPct))}</b> ₫/USDT</>;
          return param.key === "baseRateVndPerUsdt"
            ? <>改成 {vnd(next)}：{quoteText}，银行卡提现的新报价也跟着变</>
            : <>改成 {valueText(param.key, next)}：{quoteText}，提现报价不变</>;
        },
      },
      reasonPlaceholder: param.placeholder,
      statedBrief: { impact: param.impact, check: param.check },
      confirmLabel: "确认修改，立即生效",
      run: () => undefined,
    };
    const readLatest = (value: string) => async () => {
      const latest = await load();
      if (!latest) throw new Error("读取最新失败");
      const changed = PARAMS.filter((item) => latest[item.key] !== quote[item.key]).map((item) => changeText(item.key, quote[item.key], latest[item.key])).join("；");
      openAdjust(param, latest, formKey + 1, { value, changed: changed || "内容有更新，上面已是最新" });
    };
    openActionConfirm({
      ...req,
      run: async (reason, value) => {
        const next = Number(value);
        try {
          await sendCommand({
            param: param.key,
            values: { baseRateVndPerUsdt: quote.baseRateVndPerUsdt, buySpreadPct: quote.buySpreadPct, lockWindowMinutes: quote.lockWindowMinutes, [param.key]: next },
            before: current,
            after: next,
            expectedVersion: quote.version,
            reason,
            operator,
          });
        } catch (cause) {
          if (isConflict(cause)) openActionConfirm({ ...req, blockedReason: <ConflictBar message="这组汇率刚被别人改过，这次没有保存。读取最新后再核对新值。" onRead={readLatest(value ?? "")} /> });
          throw cause;
        }
      },
    });
  };

  const latest = data?.history[0];
  const latestChanges = latest ? historyChanges(latest) : [];
  const history = data?.history ?? [];
  const zone = businessZone().label;
  const blocked = loading ? READING : pending ? LOCKED : undefined;
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
        {retryRejected && !expired && <Button size="sm" disabled={retrying} onClick={() => setReleasing(true)}>解除待确认</Button>}
        {auditLink && !expired && <span>到{auditLink}核对</span>}
        <Explain label="技术信息" content={`命令号 ${pending.commandKey} ｜ 原版本 ${pending.expectedVersion} ｜ 理由 ${pending.reason}`}>技术信息</Explain>
      </>}>
        <p>{when}（{zone}）{what} 的修改可能已经生效，{data ? "下面是重新读到的值。" : ""}确认前不能再改。</p>
        {/* 过期后不能重试、不能解除，也不引导关标签页绕过：如实写怎么核对、交给谁（F4、BE-03）。 */}
        {expired && (canAudit
          ? <p>已超过 24 小时，不能再重试。请财务负责人到{auditLink}和下面的调整历史核对这次修改有没有生效。</p>
          : <p>已超过 24 小时，不能再重试。这个账号看不到操作记录，请在下面的调整历史里核对这次修改有没有生效，再交财务负责人处理。</p>)}
        {!expired && !canManage && <p>{NO_WRITE}。</p>}
        {retryRejected && !expired && <>
          <p>重试没有成功：{retryRejected}</p>
          <p>{data ? "先" : "先读到汇率设置，再"}展开下面的「调整历史」，找 {when} {what} 的那一条：有就是已经生效，没有就是没生效。核对完点「解除待确认」。</p>
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
        : !pending && <Conclusion state="ok" explain="读取成功，这个窗口里也没有待确认的修改。这句话不比较市场价。汇率不会自动更新，要人工调整。">买入价已生效，没有要处理的事</Conclusion>}

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
    </>
  );
}
