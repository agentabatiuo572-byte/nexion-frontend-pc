"use client";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";


import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
/**
 * G7 锁定计划（改版，RdPage）— 数据来自后端 /api/admin/market/nex/repurchase;空库返回空态。
 * 首屏回答：App 入口不开放、还有多少单没结束、一笔锁定到期和提前解锁各拿回多少、每个参数改哪个方向要另一位超级管理员批准。
 * 参数审批、结果未知的保存和恢复沿用 use-g-param-approval；这里只排界面，请求和判断照旧。
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftRight, CalendarDays, CircleHelp, Clock3, Coins, Database, Hourglass, Lock, LockKeyhole, ListOrdered, PieChart, Scale, SlidersHorizontal, Ticket,
} from "lucide-react";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Conclusion, Explain, Fact, Facts, Fold, Notice,
  PageHeader, Panel, RatioBar, RdPage, SegmentBar, Stat, StatBand, StatusDistributionBar, StatusTag, Table, TableMessage, Td, Th,
} from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "../design-kit";
import {
  fetchG7RepurchaseOverview,
  fetchG7RepurchaseOrders,
  updateG7RepurchaseParam,
  queryG7DirectCommand,
  retryG7DirectCommand,
  type G7Order,
  type G7Overview,
  type G7Param,
} from "@/lib/admin/g7-client";
import type { ActionConfirmReq } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { gParamAuthority, useGParamApproval, type GParamRecovery } from "@/lib/admin/use-g-param-approval";
import { canRetryG7DirectCommand, g7DirectCommandExpired, g7DirectCommandVersion, listG7DirectCommands, subscribeG7DirectCommands, type G7DirectCommand } from "@/lib/admin/g7-direct-command";
import { expiredTag, GRecoveryNotice, pendingTag, resolvedTag, unknownTag, type GRecoveryRow } from "./g-recovery";

/** 本页的确认框请求：在共用的 ActionConfirmReq 上只加显示用的字段，提交仍走 run。 */
type G7ConfirmReq = ActionConfirmReq & {
  title?: ReactNode;
  effect?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  statedBrief?: { impact: string; check: string };
  coverageLead?: ReactNode;
  coverageCheck?: string;
  confirmLabelForValue?: (value?: string) => string;
  directRecovery?: { before: { state: "unknown" } | { state: "at-submission"; value: string }; value: string; commandKey: string };
};

/** 六个参数的叫法、单位、方向和生效范围。名字和确认框、原申请、操作记录一致；说法照后端现行行为。 */
const PARAM: Record<string, {
  name: string;
  what: string;
  /** 走审批的方向（要另一位超级管理员批准）；没有的参数确认后立即生效。 */
  loosen?: string;
  tighten?: string;
  existing: string;
  future: string;
  hint: string;
  unit?: string;
  note?: string;
}> = {
  lockDays: {
    name: "锁仓期限",
    what: "一笔锁定从加入到到期的天数",
    existing: "已有订单按下单时的期限到期，到期日不变",
    future: "之后新开的订单按新期限算到期日",
    hint: "1–3650 的整数",
    unit: "天",
    note: "限时锁定计划倍率不在这里改，在「运营阶段设置」。",
  },
  apy: {
    name: "参考年奖励率",
    what: "到期奖励按这个年化比例算：锁定金额 × 年奖励率 × 天数 ÷ 365",
    loosen: "调高",
    tighten: "调低",
    existing: "已有订单保留下单时的奖励率和预计奖励，不重算",
    future: "之后新开的订单按新奖励率算预计奖励",
    hint: "0–300，最多两位小数",
    unit: "%",
  },
  penalty: {
    name: "提前解锁扣款",
    what: "到期前解锁时扣锁定金额的比例；提前解锁不发奖励，这一单已发、没用的抽奖券作废",
    loosen: "调低",
    tighten: "调高",
    existing: "已有订单按下单时的扣款比例，不受影响",
    future: "之后新开的订单提前解锁时按新比例扣",
    hint: "0–100，最多两位小数",
    unit: "%",
  },
  nurture: {
    name: "好友升级奖励倍率",
    what: "锁定计划用户的好友升级奖励倍率，和限时锁定计划倍率相乘后记进开仓记录",
    loosen: "调高",
    tighten: "调低",
    existing: "已有订单开仓时记下的倍率不变",
    future: "之后新开的订单按新倍率记录",
    hint: "1–10，最多两位小数",
    unit: "倍",
    note: "后端目前只把倍率记进开仓记录，不发好友奖励：改了不会马上多发或少发钱；调高仍要批准。",
  },
  lottery: {
    name: "创世节点抽奖券",
    what: "每笔新锁定送几张创世节点抽奖券",
    existing: "已发的券不变，不补发、不收回",
    future: "之后新开的订单按新张数发券；开仓时还会按当时的容量再查一次",
    hint: "0–100 的整数",
    unit: "张",
  },
  presets: {
    name: "锁定金额快捷选项",
    what: "用户加入锁定计划时可以直接点选的金额",
    existing: "不影响已有订单",
    future: "保存后后端给 App 的快捷金额换成新列表；App 入口目前不开放，用户看不到",
    hint: "用 / 分隔，1–12 个大于 0 的金额；后端保存时四舍五入到两位小数、去重并从小到大排",
    unit: "USDT",
  },
};
const CORE_ORDER = ["lockDays", "apy", "penalty", "nurture"];
const MORE_ORDER = ["lottery", "presets"];

/** 订单状态：概览分布用小写码，订单列表用大写码。 */
const STATE_NAME: Record<string, string> = {
  pending_lock: "待锁定",
  active: "锁仓中",
  mature_unclaimed: "到期未领取",
  claimed: "已领取",
  early_withdrawn: "已提前解锁",
  slashed: "已扣罚",
  refunded: "已退款",
};
const OPEN_STATES = ["pending_lock", "active", "mature_unclaimed"];
const DIST_TONE: Record<string, "role-other" | "progress" | "role-3" | "done" | "role-2"> = {
  pending_lock: "role-other", active: "progress", mature_unclaimed: "role-3", claimed: "done", early_withdrawn: "role-2",
};

function messageOf(error: unknown) {
  return displayAdminError(error);
}

/** 金额：去掉补的 0，至少两位，带千分位；不舍入。 */
function amount(value: number | string) {
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return String(value);
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${BigInt(match[2]).toLocaleString("en-US")}.${fraction}`;
}

/** 百分数、倍率：去掉补的 0，不补位。 */
function plain(value: number | string) {
  const text = typeof value === "number" ? value.toFixed(6) : value.trim();
  return /^-?\d+\.\d+$/.test(text) ? text.replace(/\.?0+$/, "") : text;
}

function fmtCount(value: number) {
  return value.toLocaleString("en-US");
}

/** 以 1e-6 为单位的整数；读不懂的返回 undefined。 */
function micros(value: string) {
  const match = /^(\d+)(?:\.(\d{0,6}))?$/.exec(value.trim());
  return match ? BigInt(match[1] + (match[2] ?? "").padEnd(6, "0")) : undefined;
}

function fromMicros(value: bigint) {
  const whole = value / BigInt(1_000_000);
  const fraction = String(value % BigInt(1_000_000)).padStart(6, "0");
  return amount(`${whole}.${fraction}`);
}

/** 后端时间按业务时区写成「2026-11-13 09:30」；时区在列头写一次。 */
function timeText(value: string) {
  return value && value !== "-" ? formatBusinessTimeCompact(value, "—") : "—";
}

/** 后端给的「×1.5 · 月 3」：倍率和运营阶段的月份分开写；认不出的原样显示。 */
function phaseMultiplier(raw: string) {
  const match = /^×(\d+(?:\.\d+)?) · 月 (\d+)$/.exec(raw.trim());
  return match ? { value: `${match[1]} 倍`, month: `运营阶段第 ${match[2]} 月` } : undefined;
}

/** 好友升级奖励倍率调高也走审批，但后端目前只记倍率、不发好友奖励，不能说会多付钱。 */
function paysMore(key: string) {
  return key !== "nurture";
}

/** 参数值的写法：写单位，不用 $；空值写「未配置」。 */
function paramValueText(key: string, raw: string | undefined) {
  const value = (raw ?? "").trim();
  if (!value) return "未配置";
  if (key === "apy" || key === "penalty") return `${plain(value)}%`;
  if (key === "lockDays") return `${value} 天`;
  if (key === "nurture") return `${plain(value)} 倍`;
  if (key === "lottery") return `${value} 张 / 单`;
  if (key === "presets") return `${value.split(" / ").map((part) => /^\d+(\.\d+)?$/.test(part) ? part.replace(/^\d+/, (whole) => BigInt(whole).toLocaleString("en-US")) : part).join(" / ")} USDT`;
  return value;
}

function paramName(param: G7Param) {
  return PARAM[param.key]?.name || operatorCopyText(param.name);
}

function paramEditValue(param: G7Param) {
  return param.value || param.displayValue;
}

function orderStatus(status: string) {
  const key = status.toLowerCase();
  const name = STATE_NAME[key];
  if (!name) return <StatusTag tone="warn" icon={CircleHelp} explain={`后端返回的状态是 ${status}，这页不认识，没有换成别的状态。`}>未知状态</StatusTag>;
  if (key === "active") return <StatusTag tone="progress" icon={Lock}>{name}</StatusTag>;
  if (key === "pending_lock" || key === "mature_unclaimed") return <StatusTag tone="neutral" icon={Clock3}>{name}</StatusTag>;
  return <StatusTag tone="done">{name}</StatusTag>;
}

/** 原申请记录的状态：标签、色调和气泡（G 域五页同一写法）。 */
function recoveryTag(record: GParamRecovery) {
  if (record.status === "unknown") return unknownTag("approval");
  if (record.status === "pending") return pendingTag();
  if (record.status === "expired") return expiredTag("approval");
  return resolvedTag(record.status);
}

/** 订单号：放不下时中间省略，留尾段区分。 */
function OrderNo({ value }: { value: string }) {
  const tail = value.slice(-8);
  const head = value.slice(0, Math.max(0, value.length - 8));
  return <span className="g7x-no" title={value} data-mono><span className="g7x-no-head">{head}</span><span className="g7x-no-tail">{tail}</span></span>;
}

/** 后端的金额分布是已取整的一段文字（`$金额 tier 占比% / …`）：认得出就换成 USDT 写法逐条列，认不出原样显示。 */
function distributionRows(text: string) {
  if (!text || text === "-") return [];
  const parts = text.split(" / ").map((part) => /^\$?([\d,]+(?:\.\d+)?) tier (\d+(?:\.\d+)?)%$/.exec(part.trim()));
  if (parts.some((part) => !part)) return null;
  return parts.map((part) => ({ amount: part![1], pct: part![2] }));
}

export function G7Repurchase() {
  return <RdPage className="g7x"><G7RepurchasePage /></RdPage>;
}

function G7RepurchasePage() {
  const reach = useReach();
  const [, toast] = useToast();
  const [mc, setActionConfirm] = useState<G7ConfirmReq | null>(null);
  const openActionConfirm = setActionConfirm;
  const session = useAdminAuth((state) => state.session);
  const isSuperAdmin = session?.role === "superadmin" || session?.role === "super";
  const authorities = session?.authorities ?? [];
  const canPropose = authorities.some((a) => a === "platform_a2_proposal_create" || a === "platform_a2_write");
  const [overview, setOverview] = useState<G7Overview | null>(null);
  const [orders, setOrders] = useState<G7Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [readFailed, setReadFailed] = useState(false);
  useSyncExternalStore(subscribeG7DirectCommands, g7DirectCommandVersion, () => 0);
  const directRecord = (key: string) => session ? listG7DirectCommands(session.adminId).find(record => record.paramKey === key) : undefined;
  const approval = useGParamApproval("G7", toast, setError, async () => {
    // Terminal proposal results invalidate every confirmation based on the old
    // overview, including dialogs opened while the receipt lookup was pending.
    openActionConfirm(null);
    latest.current.readFailed = true;
    setReadFailed(true);
    setOverview(await fetchG7RepurchaseOverview());
    setLockedParams({});
    setReadFailed(false);
  });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [recoverBusy, setRecoverBusy] = useState(false);
  /** 只用于显示：这些错误句已经由原操作提醒里的一行承接，不再在「操作提示」里重复。 */
  const coveredErrors = useRef(new Set<string>());
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 只用于显示：直接修改时后端答复这一项被审批锁住，在这一行标出来。下一次提交仍由后端核对。 */
  const [lockedParams, setLockedParams] = useState<Record<string, string>>({});
  const requestGeneration = useRef(0);
  const moreInFlight = useRef(false);
  const latest = useRef({ overview, loading, busyKey, readFailed });
  latest.current = { overview, loading, busyKey, readFailed };
  const reload = useCallback(async (silent = false) => {
    const generation = ++requestGeneration.current;
    moreInFlight.current = false;
    setLoadingMore(false);
    if (!silent) setLoading(true);
    setReadFailed(true);
    setError("");
    try {
      const [nextOverview, nextOrders] = await Promise.all([
        fetchG7RepurchaseOverview(), fetchG7RepurchaseOrders(),
      ]);
      if (generation !== requestGeneration.current) return;
      setOverview(nextOverview);
      setLockedParams({});
      setReadFailed(false);
      setOrders(nextOrders.orders);
      setNextCursor(nextOrders.nextCursor);
      setHasMore(nextOrders.hasMore);
    } catch (err) {
      if (generation === requestGeneration.current) setError(messageOf(err));
    } finally {
      if (generation === requestGeneration.current && !silent) setLoading(false);
    }
  }, []);

  const paramApproval = {
    ...approval,
    async retry(key: string) {
      const original = approval.record(key);
      try {
        const receipt = await approval.retry(key);
        // G7 PROPOSE dedup replays the historical pending ticket, whereas the
        // by-key GET returns its current status (AuditCenter:948–966,164–177).
        return approval.record(key) ? await approval.query(key) ?? receipt : receipt;
      } catch (err) {
        if (original && !approval.record(key)) {
          openActionConfirm(null);
          latest.current.readFailed = true;
          setReadFailed(true);
          await reload(true);
        }
        throw err;
      }
    },
  };
  /** 直接写的原记录只读核对：读当前配置装上，不当回执、不清记录（参数行和原操作提醒共用这一段）。 */
  const readDirectCommand = async (direct: G7DirectCommand) => {
    // An expired original or a writer whose authority was removed can still
    // read current state. This GET is never a receipt and never clears it.
    openActionConfirm(null);
    latest.current.readFailed = true;
    setReadFailed(true);
    try {
      const result = await queryG7DirectCommand(direct.adminId, direct.commandKey);
      setOverview(result.overview);
      setLockedParams({});
      setReadFailed(false);
      setError(result.message);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  /**
   * 原操作提醒：走审批的原申请和直接写的原记录都列在这里，概览读取中、失败时也显示。
   * retryFor 只在概览读到后传：按原请求重试要开原来的确认框。
   */
  const recoveryNotice = (retryFor?: (direct: G7DirectCommand) => (() => void) | undefined) => {
    const approvals = paramApproval.list();
    const directs = session ? listG7DirectCommands(session.adminId) : [];
    const recover = async (obj: string, retry: boolean) => {
      setRecoverBusy(true);
      try {
        if (retry) await paramApproval.retry(obj);
        else if (!await paramApproval.query(obj)) toast("暂未查到原审批单，原记录继续保留。");
      } catch (err) {
        toast(displayAdminError(err));
      } finally {
        setRecoverBusy(false);
      }
    };
    const rows: GRecoveryRow[] = [
      ...approvals.map((record) => {
        const key = record.request.obj;
        const name = PARAM[key]?.name ?? key;
        const params = record.request.command.params as { value?: unknown; expectedValue?: unknown };
        const to = paramValueText(key, typeof params.value === "string" ? params.value : undefined);
        const from = typeof params.expectedValue === "string" ? paramValueText(key, params.expectedValue) : undefined;
        return {
          key: record.commandKey, name, submittedAt: record.createdAt,
          state: record.ticket?.status === "pending" ? "approval-locked" : record.ticket ? "approval-resolved" : "local-frozen",
          change: from ? <Change from={from} to={to} /> : <>申请改成 {to}</>,
          tag: recoveryTag(record), ticket: record.ticket?.id,
          actions: <>
            <Button size="sm" disabled={recoverBusy} aria-label={`查询${name}的原结果`} onClick={() => void recover(key, false)}>查询原结果</Button>
            {record.canRetry && <Button size="sm" disabled={recoverBusy} aria-label={`按原请求重试${name}`} onClick={() => void recover(key, true)}>按原请求重试</Button>}
          </>,
        };
      }),
      ...directs.map((direct) => {
        const name = PARAM[direct.paramKey]?.name ?? direct.paramKey;
        const retry = canRetryG7DirectCommand(direct) ? retryFor?.(direct) : undefined;
        return {
          key: direct.commandKey, name, submittedAt: direct.createdAt, state: "direct-unknown",
          change: <Change from={direct.currentValue === undefined ? "原值未知" : paramValueText(direct.paramKey, direct.currentValue)} to={paramValueText(direct.paramKey, direct.input.value)} />,
          tag: g7DirectCommandExpired(direct) ? expiredTag("direct") : unknownTag("direct"),
          actions: <>
            <Button size="sm" disabled={recoverBusy || !!busyKey} aria-label={`查询${name}的原结果`} onClick={() => void readDirectCommand(direct)}>查询原结果</Button>
            {retry && <Button size="sm" disabled={recoverBusy || !!busyKey} aria-label={`按原请求重试${name}`} onClick={retry}>按原请求重试</Button>}
          </>,
        };
      }),
    ];
    const waiting = directs.length === 0 && approvals.length > 0 && approvals.every((record) => record.ticket?.status === "pending");
    return <GRecoveryNotice label="原参数操作" rows={rows}
      title={`参数修改的原操作 · ${rows.length} 项`}
      lead={waiting
        ? "有原申请的参数被审批锁住：批准、驳回或撤回之前，这一项调高调低都改不了；其他参数照常可改。"
        : "这些参数先只能查询原结果或按原请求重试，不能改成别的值；其他参数照常可改。"}
      explain={<>
        <p>这里列你在这台电脑上提交过、还没有结论的原操作：走审批的参数申请，和直接生效但没收到结果的修改。原操作只能查询，或在 24 小时内按原内容重试，不能改值。</p>
        <p>要改成别的值，等原操作有结论后再发起新修改。别人提交的审批单不在这里，要到「操作记录与审批」看。</p>
      </>} />;
  };

  useEffect(() => {
    void reload();
    return () => {
      requestGeneration.current += 1;
    };
  }, [reload]);

  const loadMore = async () => {
    if (loading || moreInFlight.current || !hasMore || nextCursor === null) return;
    moreInFlight.current = true;
    setLoadingMore(true);
    setError("");
    const generation = requestGeneration.current;
    try {
      const page = await fetchG7RepurchaseOrders("", nextCursor);
      if (generation !== requestGeneration.current) return;
      setOrders((current) => {
        const seen = new Set(current.map((order) => order.orderNo));
        return [...current, ...page.orders.filter((order) => {
          if (seen.has(order.orderNo)) return false;
          seen.add(order.orderNo);
          return true;
        })];
      });
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (err) {
      if (generation === requestGeneration.current) setError(messageOf(err));
    } finally {
      if (generation === requestGeneration.current) {
        moreInFlight.current = false;
        setLoadingMore(false);
      }
    }
  };

  const confirmModal = mc && (
    <OperationConfirmModal briefKind={mc.briefKind}
      action={mc.action}
      title={mc.title}
      detail={mc.detail}
      amplifies={mc.amplifies}
      coverage={mc.coverage}
      edit={mc.edit}
      businessForm={mc.businessForm}
      reasonMax={mc.reasonMax}
      getPendingReason={mc.getPendingReason}
      getPendingBusinessValue={mc.getPendingBusinessValue}
      effect={mc.effect}
      facts={mc.facts}
      statedBrief={mc.statedBrief}
      coverageLead={mc.coverageLead}
      coverageCheck={mc.coverageCheck}
      confirmLabelForValue={mc.confirmLabelForValue}
      onClose={() => setActionConfirm(null)}
      onConfirm={async (reason, newValue, businessValue) => {
        await mc.run(reason, newValue, businessValue);
        setActionConfirm(null);
      }}
    />
  );

  const canEdit = (key: string) => {
    if (isSuperAdmin) return true;
    if (key === "apy" || key === "lockDays") return authorities.includes("finprod_g7_apy_write");
    if (key === "nurture") return authorities.includes("finprod_g7_nurture_write");
    return authorities.includes("finprod_g7_write");
  };
  const canWriteAny = [...CORE_ORDER, ...MORE_ORDER].some(canEdit);

  const header = (
    <PageHeader pageId="G7" title="锁定计划"
      summary="App 入口目前不开放；这页维护规则、查看历史订单。"
      meta={overview ? "打开时读取，不自动刷新；改完用返回的结果刷新" : undefined}
      readOnly={overview && !canWriteAny ? "你只能查看；这个账号没有修改锁定计划参数的权限。" : undefined} />
  );

  if (loading && !overview) {
    return (
      <>
        {header}
        {recoveryNotice()}
        <BlockState state="loading" title="正在读取锁定计划…" />
        {confirmModal}
      </>
    );
  }

  if (!overview) {
    return (
      <>
        {header}
        {recoveryNotice()}
        <BlockState state="error" title="锁定计划数据读取失败"
          detail={<>页面不显示任何旧数据。点「重新加载」；一直失败请联系值班同事。<Explain label="失败原因" content={error || "没有收到数据。"} /></>}
          retryLabel="重新加载" onRetry={() => void reload()} />
        {confirmModal}
      </>
    );
  }

  const stats = overview.stats;
  const rewardMicros = micros(stats.matureUsd)! - micros(stats.principalUsd)!;
  const busy = !!busyKey;

  const adjustParam = async (param: G7Param) => {
    const direct = directRecord(param.key);
    if (direct && !canRetryG7DirectCommand(direct)) {
      await readDirectCommand(direct);
      return;
    }
    const original = await paramApproval.open(param.key);
    if (original === false) return;
    const view = latest.current;
    if (!direct && !original && (!view.overview || view.loading || view.busyKey || view.readFailed)) return;
    // Saved context drives the recovery facts, even when the original write
    // actually succeeded and today's configuration is different.
    if (original) param = { ...param, value: String(original.request.command.params.expectedValue), displayValue: String(original.request.command.params.expectedValue) };
    const directRecovery: G7ConfirmReq["directRecovery"] = direct ? {
      before: direct.currentValue === undefined ? { state: "unknown" } : { state: "at-submission", value: direct.currentValue },
      value: direct.input.value,
      commandKey: direct.commandKey,
    } : undefined;
    const label = paramName(param);
    const copy = PARAM[param.key];
    const originalCapacity = direct ? direct.g4Capacity : overview.g4Capacity;
    const currentText = directRecovery
      ? directRecovery.before.state === "unknown" ? "未知" : paramValueText(param.key, directRecovery.before.value)
      : paramValueText(param.key, param.value);
    const originalValue = original?.request.command.params.value as string | undefined;
    const loosens = (value?: string) => {
      if (!copy?.loosen || !value) return undefined;
      const next = Number(value);
      const now = Number(paramEditValue(param));
      if (!Number.isFinite(next) || !Number.isFinite(now) || next === now) return undefined;
      return param.key === "penalty" ? next < now : next > now;
    };
    const facts = (value?: string) => {
      const loose = directRecovery || original ? undefined : loosens(value);
      const nextText = value ? paramValueText(param.key, value) : undefined;
      return (
        <div data-proof="g7-param-preview" data-direct-recovery={directRecovery?.before.state} data-original-command={directRecovery?.commandKey}>
          <Facts>
            <Fact k="改的是">{label}</Fact>
            {original
              ? <Fact k="原申请"><Change from={currentText} to={originalValue ? paramValueText(param.key, originalValue) : "—"} /></Fact>
              : <Fact k={directRecovery ? "提交时" : "现在"}>{currentText}</Fact>}
            <Fact k="什么时候生效" tone={loose ? "warn" : undefined}>{directRecovery
              ? "提交结果未知，可能已经执行。请核对原操作，或在 24 小时内按原内容、原命令号重试。"
              : original
              ? original.ticket?.status === "pending"
                ? "审批单在等另一位超级管理员批准；批准前参数不变，这一项被锁住"
                : "原申请结果还没确认：有效期内按原内容、原命令号重试，后端不会重复建单"
              : !copy?.loosen
                ? "确认后立即生效"
                : loose === true
                  ? `${copy.loosen}：提交审批，另一位超级管理员（需有审批批准权限）批准后才生效；批准前参数不变，这一项被锁住`
                  : loose === false
                    ? `${copy.tighten}：确认后立即生效`
                    : nextText
                      ? "和现在一样，没有改动，不保存"
                      : `${copy.loosen}要另一位超级管理员批准；${copy.tighten}确认后立即生效`}</Fact>
            {loose === true && !canPropose && <Fact k="你的权限" tone="warn">这个账号没有发起审批的权限，{copy?.loosen}会被拦下；请有提案权和这项修改权限的同事发起</Fact>}
            <Fact k="已有订单">{copy?.existing ?? "—"}</Fact>
            <Fact k="之后的新订单">{copy?.future ?? "—"}</Fact>
            {loose === true && <Fact k="兑付覆盖率（现在）" tone={overview.coverage.redlineBreached ? "danger" : undefined}>{plain(overview.coverage.coverageRatio)}%，红线 {plain(overview.coverage.redlinePct)}%</Fact>}
          </Facts>
        </div>
      );
    };
    openActionConfirm({ briefKind: "config",
      confirmLabelForValue: (value) => loosens(value) ? "提交审批" : "确认修改",
      action: `调整锁定计划参数 · ${label}`,
      title: directRecovery ? `${label} · 重试原操作` : original ? `${label}的原申请` : `调整${label}`,
      directRecovery,
      detail: <>{copy?.what ?? operatorCopyText(param.sub)}。{param.key === "lottery" ? "保存时后端核对奖池核对编号至少 3 个字，并检查本月已发张数加新的每单张数不超过创世奖池月容量。" : copy?.note}</>,
      effect: copy?.loosen
        ? <StatusTag tone="neutral" icon={ArrowLeftRight} explain={directRecovery ? "提交结果未知，可能已经执行。请核对原操作，或在 24 小时内按原内容、原命令号重试。" : <>
          <p>{paysMore(param.key) ? `${copy.loosen}会让平台多付钱：` : `${copy.loosen}按规则也要审批（后端目前只记倍率、不发好友奖励）：`}先提交审批，另一位超级管理员在「操作记录与审批」批准后才生效，你自己不能批。</p>
          <p>{copy.tighten}确认后立即生效。</p>
        </>}>{directRecovery ? "结果未知" : <>{copy.loosen}要批准 · {copy.tighten}立即生效</>}</StatusTag>
        : <StatusTag tone="progress" filled>{directRecovery ? "结果未知" : "立即生效"}</StatusTag>,
      facts,
      statedBrief: { impact: "改的是之后新开的订单用的规则，已有订单按下单时的规则。", check: directRecovery ? "提交结果未知，可能已经执行。请核对原操作，或在 24 小时内按原内容、原命令号重试。" : "核对新值和方向；理由写清依据或工单号。" },
      coverageLead: paysMore(param.key) ? `${copy?.loosen ?? "放宽"}${label}会让平台多付钱，要另一位超级管理员批准` : `${copy?.loosen ?? "调高"}${label}要另一位超级管理员批准；后端目前不发好友奖励，不会马上多付钱`,
      coverageCheck: "提交审批时和批准时，后端各检查一次：原值没被别人改过；兑付覆盖率不低于红线（这项改动本身不算新增应付款）。低于红线或算不准都拒绝。",
      edit: param.key === "presets"
        ? { kind: "text", current: directRecovery ? undefined : paramEditValue(param), initialValue: direct?.input.value, disallowCurrent: true, hint: copy?.hint }
        : { kind: "number", current: directRecovery ? undefined : paramEditValue(param),
            initialValue: direct?.input.value ?? original?.request.command.params.value as string | undefined,
            unit: param.key === "apy" || param.key === "penalty" ? "%" : param.key === "lockDays" ? "天" : undefined,
            min: param.key === "apy" || param.key === "penalty" || param.key === "lottery" ? 0 : 1,
            max: param.key === "apy" ? 300 : param.key === "penalty" || param.key === "lottery" ? 100 : param.key === "lockDays" ? 3650 : 10,
            step: param.key === "lockDays" || param.key === "lottery" ? 1 : 0.01,
            hint: copy?.hint,
            disallowCurrent: true,
            submitEditValue: param.key === "lottery",
            amplifiesWhen: directRecovery ? undefined : param.key === "penalty" ? "decrease"
              : param.key === "apy" || param.key === "nurture" ? "increase" : undefined },
      businessForm: param.key === "lottery" ? {
        kind: "multi-field",
        title: "核对创世奖池容量",
        hint: originalCapacity ? `本月容量 ${fmtCount(originalCapacity.monthlyCapacity)} 张 · 已发 ${fmtCount(originalCapacity.ticketsIssuedThisMonth)} 张` : undefined,
        fields: [{ key: "g4Ref", label: "创世奖池核对编号", inputKind: "text", placeholder: "例如 POOL-2026-07", required: true, wide: true }],
      } : undefined,
      getPendingReason: () => directRecord(param.key)?.input.reason ?? paramApproval.getPendingReason(param.key),
      getPendingBusinessValue: () => {
        const saved = directRecord(param.key);
        return saved ? { g4Ref: saved.input.g4Ref } : undefined;
      },
      run: async (reason, value, businessValue) => {
        const savedDirect = directRecord(param.key);
        const saved = paramApproval.record(param.key);
        const view = latest.current;
        const currentParam = view.overview?.params.find(row => row.key === param.key);
        const auth = useAdminAuth.getState();
        if ((direct || original) && !savedDirect && !saved) {
          openActionConfirm(null);
          return;
        }
        if (!savedDirect && !saved && (!currentParam || view.loading || view.busyKey || view.readFailed
          || !auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== session?.adminId
          || !auth.session?.authorities.includes(gParamAuthority("G7", param.key)))) {
          openActionConfirm(null);
          setError("当前锁定计划参数暂不能修改，请重新读取当前状态后操作。");
          return;
        }
        if (!savedDirect && !saved && (value === undefined || value === null || String(value).trim() === "")) return;
        setBusyKey(param.key);
        setError("");
        try {
          if (savedDirect) {
            // A replay returns the stored overview; close the original and GET
            // current state before allowing another intention on any parameter.
            await retryG7DirectCommand(savedDirect.adminId, savedDirect.commandKey);
            toast(`${label} 已生效`);
            return;
          }
          if (saved) {
            await paramApproval.retry(saved.request.obj);
            return;
          }
          const result = await paramApproval.run({ key: param.key, current: currentParam!.value, value: String(value), reason },
            () => updateG7RepurchaseParam(param.key, String(value), reason, currentAdminOperator(), businessValue?.g4Ref ?? "", currentParam!.value, view.overview!.g4Capacity));
          setLockedParams(rows => { const next = { ...rows }; delete next[param.key]; return next; });
          if ("direct" in result) {
            setOverview(result.direct);
            toast(`${label} 已生效`);
          }
        } catch (err) {
          const code = (err as { backendMessage?: string } | null)?.backendMessage;
          if (code === "OBJECT_LOCKED_BY_A2" || code === "OBJECT_ALREADY_PENDING") setLockedParams((rows) => ({ ...rows, [param.key]: messageOf(err) }));
          if (paramApproval.record(param.key) || directRecord(param.key)) coveredErrors.current.add(messageOf(err));
          setError(messageOf(err));
          if (saved && !paramApproval.record(saved.request.obj)) openActionConfirm(null);
          if (!paramApproval.record(param.key) && !directRecord(param.key)) toast(`操作失败 · ${messageOf(err)}`);
          throw err;
        } finally {
          if (savedDirect && !directRecord(param.key)) {
            openActionConfirm(null);
            latest.current.readFailed = true;
            setReadFailed(true);
            await reload(true);
          }
          setBusyKey(null);
        }
      },
    });
  };

  const byKey = (key: string) => overview.params.find((param) => param.key === key);
  const records = paramApproval.list();
  const lockedNames = Object.keys(lockedParams).filter((key) => !paramApproval.record(key)).map((key) => PARAM[key]?.name ?? key);
  const openCount = overview.statusBreakdown.filter((row) => OPEN_STATES.includes(row.status.toLowerCase())).reduce((sum, row) => sum + row.count, 0);
  const capacity = overview.g4Capacity;

  const paramRow = (param: G7Param) => {
    const copy = PARAM[param.key];
    const name = paramName(param);
    const record = paramApproval.record(param.key);
    const direct = directRecord(param.key);
    const recovery = record ? records.find((row) => row.commandKey === record.commandKey) : undefined;
    const editable = canEdit(param.key);
    const disabledReason = busy ? "正在处理上一项，稍候再操作" : readFailed && !record && !direct ? "当前值没读到，重新加载后再改" : undefined;
    return (
      <ConfigRow key={param.key} name={name}
        what={copy?.what ?? operatorCopyText(param.sub)}
        when={copy?.loosen ? `${paysMore(param.key) ? `${copy.loosen}会让平台多付钱，` : `${copy.loosen}按规则要审批（目前只记倍率），`}提交审批，另一位超级管理员批准后生效；${copy.tighten}确认后立即生效` : "确认后立即生效"}
        effect={copy ? `${copy.future}；${copy.existing}` : undefined}
        note={[
          copy?.note,
          editable && copy?.loosen && !canPropose ? `这个账号没有发起审批的权限，只能${copy.tighten}；${copy.loosen}请有提案权的同事发起。` : undefined,
          lockedParams[param.key] && !record ? "这一项有一张审批单还没处理完，页面看不到单号；批准、驳回或撤回之前，调高调低都改不了。" : undefined,
        ].filter(Boolean).join(" ") || undefined}
        value={<span className="g7x-param">
          <span className="g7x-value">
            <span className="g7x-value-num" data-empty={param.value.trim() ? undefined : ""}>{paramValueText(param.key, param.value)}</span>
            {recovery && recoveryTag(recovery)}
            {!recovery && direct && (g7DirectCommandExpired(direct) ? expiredTag("direct") : unknownTag("direct"))}
            {!record && lockedParams[param.key] && <StatusTag tone="warn" icon={LockKeyhole} explain={lockedParams[param.key]}>审批锁定中</StatusTag>}
          </span>
          <span className="g7x-dir">{copy?.loosen ? `${copy.loosen}要批准` : "改了立即生效"}</span>
        </span>}
        action={editable || record || direct ? (describedBy) => (
          <Button size="sm" aria-describedby={describedBy} aria-label={record ? `查看${name}的原申请` : direct ? `查看${name}的原操作` : `调整${name}`}
            disabledReason={disabledReason} onClick={() => void adjustParam(param)}>{record ? "查看原申请" : direct ? "查看原操作" : "调整"}</Button>
        ) : undefined} />
    );
  };
  const coreRows = CORE_ORDER.map(byKey).filter((param): param is G7Param => !!param)
    .concat(overview.params.filter((param) => !CORE_ORDER.includes(param.key) && !MORE_ORDER.includes(param.key)));
  const moreRows = MORE_ORDER.map(byKey).filter((param): param is G7Param => !!param);
  const moreAlert = moreRows.some((param) => paramApproval.record(param.key) || directRecord(param.key) || lockedParams[param.key]);

  // 一笔 1,000 USDT 的例子：照后端的算法（预计奖励 = 金额 × 年奖励率 × 天数 ÷ 36500，6 位小数四舍五入；提前解锁扣金额 × 扣款比例）。
  const apyMicros = micros(byKey("apy")?.value ?? "");
  const penaltyMicros = micros(byKey("penalty")?.value ?? "");
  const days = /^\d+$/.test((byKey("lockDays")?.value ?? "").trim()) ? BigInt(byKey("lockDays")!.value.trim()) : undefined;
  const principal = BigInt(1000_000_000);
  const interest = apyMicros !== undefined && days !== undefined
    ? (BigInt(2000) * apyMicros * days + BigInt(36500)) / BigInt(73000) : undefined;
  const deduction = penaltyMicros !== undefined ? BigInt(10) * penaltyMicros : undefined;
  const maturity = interest === undefined ? undefined : principal + interest;
  const early = deduction === undefined || deduction > principal ? undefined : principal - deduction;
  const exampleReady = maturity !== undefined && early !== undefined;

  const originalCount = records.length + (session ? listG7DirectCommands(session.adminId).length : 0);
  const conclusion = lockedNames.length > 0
      ? <Conclusion state="warn" icon={LockKeyhole}
          hint="到「操作记录与审批」找这张审批单，有结论后再改。"
          explain="直接修改时后端答复这一项有一张审批单还没处理完：批准、驳回或撤回之前调高调低都改不了，其他参数照常可改。页面看不到单号，也不知道是谁提交的。">
          {lockedNames.join("、")}被一张审批单锁住，现在改不了</Conclusion>
      : originalCount > 0
      ? <Conclusion state="warn" icon={Clock3}
          hint="在下面逐条查询原结果；24 小时内也可以按原请求重试。"
          explain="提交过的参数修改还没有确定结论：有的在等另一位超级管理员审批，有的没收到结果。有结论之前这几项不能改成别的值，其他参数照常可改。">
          有 {fmtCount(originalCount)} 项参数修改还没有结论</Conclusion>
      : <Conclusion state="neutral" icon={Lock}
          hint="改规则只影响之后新开的订单。"
          explain="未结束是待锁定、锁仓中、到期未领取三种状态的订单，不限哪天下单。已有订单按下单时的规则到期或提前解锁；用户到期后要自己领取，这页不能代领、不能提前解锁。">
          {openCount > 0 ? `还有 ${fmtCount(openCount)} 单锁定计划没有结束` : "没有未结束的锁定计划订单"}</Conclusion>;

  const distRows = distributionRows(overview.amountDistribution);
  const reinvest = stats.reinvestRateAvailable ? `${stats.reinvestRate.toFixed(1).replace(/\.0$/, "")}%` : "—";
  const phaseHref = reach("/growth/phase");
  const phase = phaseMultiplier(overview.phaseGate.value);

  return (
    <>
      {header}
      {confirmModal}
      {error && !Object.values(lockedParams).includes(error) && !coveredErrors.current.has(error) && !/^提交结果(暂未确认|未知)/.test(error) && <Notice tone="warn" title="操作提示">{error}</Notice>}
      {conclusion}
      {recoveryNotice((direct) => {
        const param = byKey(direct.paramKey);
        return param ? () => void adjustParam(param) : undefined;
      })}

      <StatBand label="锁定计划摘要">
        <Stat label="未结束的锁定金额" icon={Lock} tone="role-1" value={amount(stats.principalUsd)} unit="USDT"
          sub={`${fmtCount(openCount)} 单 · 含到期未领取`}
          explain="待锁定、锁仓中、到期未领取三种状态的订单本金合计，不限哪天下单。" />
        <Stat label="到期要付（本金和奖励）" icon={Coins} tone="role-1" value={amount(stats.matureUsd)} unit="USDT"
          sub={`其中奖励 ${fromMicros(rewardMicros > BigInt(0) ? rewardMicros : BigInt(0))} USDT`}
          explain="同一批未结束订单的本金加下单时算好的预计奖励。资金储备页的应付款按自己的口径算，两处不一定相等。" />
        <Stat label="本月新订单" icon={CalendarDays} tone="role-3" value={fmtCount(stats.ordersMonth)} unit="单"
          explain="按后端业务日历，本月 1 日起下单的锁定计划订单数，不限状态。上面两个金额不按月算。" />
        <Stat label="本月发出抽奖券" icon={Ticket} tone="role-4" value={fmtCount(stats.ticketsMonth)} unit="张"
          sub={`创世奖池月容量 ${fmtCount(capacity.monthlyCapacity)} 张`}
          explain="本月 1 日起实际发给锁定计划订单的创世节点抽奖券张数；之后作废的券也算在里面。" />
      </StatBand>

      <div className="rd-split">
        <Panel title="一笔锁定会怎样" icon={Scale} tone="role-1" sub="按 1,000 USDT 举例"
          explain={<>
            <p>看两条：按现在的规则，一笔 1,000 USDT 的锁定到期领取和提前解锁各拿回多少，差多少。</p>
            <p>照后端的算法：预计奖励 = 金额 × 年奖励率 × 天数 ÷ 365，保留 6 位小数；提前解锁扣金额 × 扣款比例，不发奖励。</p>
            <p>只是例子，不是哪一笔真实订单。已有订单按下单时的规则算。</p>
          </>}>
          {exampleReady ? (
            <div className="g7x-paths">
              <div className="g7x-path">
                <div className="g7x-path-head">
                  <span className="g7x-path-name">到期领取</span>
                  <span className="g7x-path-num">{fromMicros(maturity!)}<small>USDT</small></span>
                </div>
                <SegmentBar label="到期领取" legend={false} segments={[
                  { key: "principal", label: "本金", value: Number(principal), slot: 1, text: "本金 1,000.00 USDT" },
                  { key: "reward", label: "预计奖励", value: Number(interest!), slot: 2, text: `预计奖励 ${fromMicros(interest!)} USDT` },
                ]} />
                <p className="g7x-path-sub"><span className="rd-chart-swatch g7x-key" data-slot="1" aria-hidden />本金 1,000.00 USDT　<span className="rd-chart-swatch g7x-key" data-slot="2" aria-hidden />预计奖励 {fromMicros(interest!)} USDT · 锁 {String(days)} 天</p>
              </div>
              <div className="g7x-path">
                <div className="g7x-path-head">
                  <span className="g7x-path-name">提前解锁</span>
                  <span className="g7x-path-num">{fromMicros(early!)}<small>USDT</small></span>
                </div>
                <SegmentBar label="提前解锁" legend={false} segments={[
                  { key: "back", label: "拿回", value: Number(early!), slot: 1, text: `拿回 ${fromMicros(early!)} USDT` },
                  { key: "cut", label: "扣款", value: Number(deduction!), tone: "danger", text: `扣 ${fromMicros(deduction!)} USDT` },
                  { key: "lost", label: "不发的奖励", value: Number(interest!), slot: "other", text: `不发奖励 ${fromMicros(interest!)} USDT` },
                ]} />
                <p className="g7x-path-sub"><span className="rd-chart-swatch g7x-key" data-slot="1" aria-hidden />拿回 {fromMicros(early!)} USDT　<span className="rd-chart-swatch g7x-key" data-tone="danger" aria-hidden />扣 {fromMicros(deduction!)} USDT（{plain(byKey("penalty")!.value)}%）　<span className="rd-chart-swatch g7x-key" data-slot="other" aria-hidden />不发奖励，没用的抽奖券作废</p>
              </div>
              <p className="g7x-path-diff">提前解锁比到期少拿 <b>{fromMicros(maturity! - early!)} USDT</b></p>
            </div>
          ) : (
            <BlockState state="empty" compact title={overview.params.length === 0 ? "没有规则参数，算不出例子" : "规则没配齐，算不出例子"}
              detail="锁仓期限、参考年奖励率、提前解锁扣款三项都配好后，这里画到期和提前解锁的对照。" />
          )}
        </Panel>

        <Panel title="规则参数" icon={SlidersHorizontal} tone="role-4"
          explain={<>
            <p>每项自己保存，只影响之后新开的订单。调高年奖励率、调低提前解锁扣款会让平台多付钱，调高好友升级奖励倍率按规则也算放大方向（后端目前只记倍率、不发好友奖励）；这三种改动要另一位超级管理员批准，批准前什么都不变；反方向确认后立即生效。</p>
            <p>一项有待批的申请时，这一项被审批锁住，调高调低都改不了，直到批准、驳回或撤回；其他参数不受影响。</p>
          </>}>
          {coreRows.length === 0 && <BlockState state="empty" compact title="后端没有返回锁定计划参数" detail="锁定计划产品不存在时后端返回空参数，不是默认值。请联系后端核对 REPURCHASE_90D 产品。" />}
          <ConfigList label="锁定计划参数">
            {coreRows.map(paramRow)}
              <ConfigRow name="限时锁定计划倍率"
                what="运营阶段给锁定计划的限时倍率，和好友升级奖励倍率相乘；按参与当时的倍率算"
                where="跟随运营阶段的当前月份"
                when="在「运营阶段设置」修改，这页只能查看"
                value={<span className="g7x-param">
                  <span className="g7x-value"><span className="g7x-value-num" data-empty={phase ? undefined : ""}>{phase?.value ?? (operatorCopyText(overview.phaseGate.value) || "—")}</span></span>
                  <span className="g7x-dir">{phase ? phase.month : "跟随运营阶段"}</span>
                </span>}
                action={phaseHref ? <Link className="rd-link g7x-nowrap" href="/growth/phase" prefetch={false}>去运营阶段设置</Link> : undefined} />
          </ConfigList>
        </Panel>
      </div>

      <Fold title="抽奖券和快捷金额" icon={Ticket} tone="role-4" alert={moreAlert}
        summary={moreRows.length ? moreRows.map((param) => `${paramName(param)} ${paramValueText(param.key, param.value)}`).join(" · ") : "后端没有返回这两项"}
        explain="每单送几张创世节点抽奖券、用户加入时可点选的金额。都确认后立即生效，不走审批；有原申请或被锁时这组自动展开。">
        <div className="g7x-capacity">
          <div className="g7x-capacity-head">
            <span className="g7x-capacity-name">创世奖池本月容量<Explain label="创世奖池容量怎么看" content={<>
              <p>看条：本月已经发出的抽奖券占创世奖池月容量多少。改每单张数时，后端检查「本月已发 + 新的每单张数」不超过月容量。</p>
              <p>月容量读创世节点的抽奖配置，没配时后端按 100,000 张；配置读不懂时这里显示 0，保存时后端按真实配置核对并拒绝。</p>
            </>} /></span>
            <span className="g7x-capacity-num">{fmtCount(capacity.ticketsIssuedThisMonth)} / {fmtCount(capacity.monthlyCapacity)} 张</span>
          </div>
          <RatioBar label="创世奖池本月已发" value={capacity.ticketsIssuedThisMonth} total={capacity.monthlyCapacity} tone="role-4"
            valueText={`已发 ${fmtCount(capacity.ticketsIssuedThisMonth)} 张，月容量 ${fmtCount(capacity.monthlyCapacity)} 张`}
            state={capacity.monthlyCapacity === 0 ? "empty" : undefined}
            emptyText="月容量读到 0：保存每单张数时后端按真实配置核对"
            invalidText="本月已发超过月容量，之后改每单张数会被拒绝" />
        </div>
        {moreRows.length > 0 && <ConfigList label="抽奖券和快捷金额">{moreRows.map(paramRow)}</ConfigList>}
      </Fold>

      <Panel title="锁定计划订单" icon={ListOrdered} tone="role-3"
        sub={`已显示 ${fmtCount(orders.length)} 单${hasMore ? " · 还有更早的" : ""} · 金额单位 USDT · 时间为${businessZone().label}`}
        explain={<>
          <p>全部锁定计划订单，从新到旧，每次读 20 单，点「加载更多」接着读更早的。这页只能查看，不能领取、提前解锁或退款。</p>
          <p>每单的年奖励率、期限和预计奖励是下单时记下的，改规则不会重算。</p>
        </>}>
        <div className="g7x-orders-head">
          <StatusDistributionBar label="订单状态分布（全部历史，单数和本金）"
            segments={overview.statusBreakdown.map((row) => ({
              key: row.status,
              label: STATE_NAME[row.status.toLowerCase()] ?? operatorCopyText(row.label),
              value: row.count,
              text: `${fmtCount(row.count)} 单 · ${amount(row.principalUsd)} USDT`,
              tone: DIST_TONE[row.status.toLowerCase()] ?? "role-other",
            }))}
            emptyText="还没有锁定计划订单" />
          <span className="g7x-relock">再次锁定率<Explain label="再次锁定率怎么算" content={stats.reinvestRateAvailable ? "到期后再次参与锁定计划的比例。" : "后端目前没有计算这个比例，显示「—」，不代表没人再次锁定。"} /><b data-empty={stats.reinvestRateAvailable ? undefined : ""}>{reinvest}</b></span>
        </div>
        <Table label="锁定计划订单" className="g7x-order-table" data-tight="">
          <thead>
            <tr><Th>订单号</Th><Th>用户</Th><Th align="right">金额 / 预计奖励</Th><Th>下单时规则</Th><Th>状态</Th><Th>开始 / 到期</Th></tr>
          </thead>
          <tbody>
            {orders.length === 0 && <TableMessage columns={6}>暂无锁定计划订单</TableMessage>}
            {orders.map((order) => (
              <tr key={order.orderNo}>
                <Td><Cell main={<OrderNo value={order.orderNo} />} sub={order.billCorrelationPrefix === order.orderNo
                  ? "账单流水：单号-*"
                  : <>账单流水：<span data-mono>{order.billCorrelationPrefix}-*</span></>} /></Td>
                <Td><Cell main={order.userNo} sub={operatorNicknameText(order.nickname)} title={`${order.userNo} · ${operatorNicknameText(order.nickname)}`} /></Td>
                <Td align="right"><Cell num main={amount(order.amountUsdt)} sub={`奖励 ${amount(order.estimatedInterestUsdt)}`} /></Td>
                <Td><Cell num main={`${plain(order.apyPct)}% / 年`} sub={`锁 ${order.lockDays} 天`} /></Td>
                <Td>{orderStatus(order.status)}</Td>
                <Td><Cell num main={timeText(order.lockedAt)} sub={timeText(order.unlockAt)} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {hasMore && nextCursor !== null && <div className="g7x-more">
          <Button size="sm" loading={loadingMore} loadingText="读取中…" disabledReason={loading ? "正在重新读取" : undefined} onClick={() => void loadMore()}>加载更多</Button>
        </div>}
      </Panel>

      <Fold title="未结束订单的金额分布" icon={PieChart} tone="role-other"
        summary={distRows === null ? "见展开" : distRows.length ? `${fmtCount(distRows.length)} 个金额` : "暂无"}
        explain="待锁定、锁仓中、到期未领取的订单按锁定金额分组，每组占这些订单笔数的比例。金额和比例由后端取整到整数，不按月算，也不是快捷选项的档位。">
        {distRows === null
          ? <p className="g7x-wrap">{overview.amountDistribution}</p>
          : distRows.length === 0
            ? <BlockState state="empty" compact title="没有未结束的订单" />
            : <ul className="g7x-dist" aria-label="未结束订单的金额分布">
              {distRows.map((row) => <li key={row.amount}><span>{row.amount} USDT</span><b>{row.pct}%</b></li>)}
            </ul>}
      </Fold>

      <Fold title="技术信息（状态代码和数据来源）" icon={Database} tone="role-other" summary={`${fmtCount(overview.sources.length)} 个来源 · 订单状态 ${fmtCount(overview.stateMachine.length)} 种`}>
        <p className="g7x-flow">订单状态 {fmtCount(overview.stateMachine.length)} 种：{overview.stateMachine.map((state) => STATE_NAME[state] ?? "状态未知").join("、")}</p>
        <p className="g7x-tech" data-mono>{overview.stateMachine.map((state) => `${state} = ${STATE_NAME[state] ?? "未知状态"}`).join(" · ")}</p>
        <p className="g7x-tech" data-mono>{overview.sources.join(" / ")}</p>
      </Fold>
    </>
  );
}
