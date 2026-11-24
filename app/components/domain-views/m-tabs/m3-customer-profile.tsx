"use client";

import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { userNicknameText} from "@/lib/admin/brand-copy";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { supportEnhancements, type SupportProfile, type SupportGroup, type SupportFinanceFieldStatus } from "@/lib/admin/m-support-enhancements";
import { perfText } from "./perf-view";
import { profilePerf } from "./perf-wiring";
import { perfFixture, profileFixture, profilePerfFixture } from "./perf-fixture"; // 接线删：夹具
import { supportClient, SupportClientError, isSupportScopeDenial, type SupportMaintenanceHistory } from "@/lib/admin/m-support-client";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { businessOffsetMinutes, businessZone, formatBusinessTimeCompact, parseBusinessTime } from "@/lib/admin/business-time";
import { Icon, Modal } from "../design-kit";
import type { SupportCustomerStatistics } from "@/lib/admin/support-analytics-client";
import type { MCtx } from "./types";
import type { SessionConvo, SupportTicket } from "./data";
import { formatD4Subtype } from "@/lib/admin/d4-ledger-display";
import { SupportAvatar, customerAvatarPath, advisorAvatarPath } from "./support-avatar";
import { compactSupportBoardValue } from "./support-leaderboard";
import { BlockState, Button, Explain, Fact, Facts, Field, Fold, IconButton, Input, IrreversibleTag, Notice, RecordList, Select, StatusTag, Table, Td, Textarea, Th, Timeline, Tr } from "@/app/components/rd";
import { AlertTriangle } from "lucide-react";
import "./m3-customer-profile.css";
import { PaymentSecurityBlock } from "@/app/components/payment-security/payment-security-block";
import { paymentSecurityPorts } from "@/lib/admin/payment-password-client";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { amountDisplay } from "@/lib/format";
import { COUNT_LABELS, CountsExplain, CountsFailed, CountsNotice, CountsRetryButton, InviterValue, countText, useCountsRetryFocus, type CountsView } from "@/app/components/invitation/invitation-view";
import { INVITATION_REREAD_BLOCK, inviterDetailView, supportCountsView, supportLevels } from "@/app/components/invitation/wiring";

const statusText = { READY: "已加载", UNKNOWN: "未知", FORBIDDEN: "无权限", ERROR: "加载失败" };
const asRows = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(v => v && typeof v === "object") : [];
const EMPTY = "—";
const show = (value: unknown): string => value == null || value === "" || value === "-" ? EMPTY : typeof value === "boolean" ? value ? "是" : "否" : typeof value === "string" || typeof value === "number" ? String(value) : EMPTY;
// M-12: compact stamps; the panel states once that times are Beijing time.
const dates = (value: unknown) => formatBusinessTimeCompact(value, EMPTY);
/** 最新一次读取失败、这一组还留着上次读到的数据时写这句（ST-36）。时间用这一组自己的读取时间，写到分钟。 */
const staleText = (group: SupportGroup) => `以下是 ${dates(group.evaluatedAt)}（${businessZone().label}）的数据，刷新失败`;
/** 右栏只有 276 宽：时间写短（今天只写时分，别的日子写月-日 时分），时区放进问号，整句一行（R27）。 */
const staleTextShort = (group: SupportGroup) => {
  const full = dates(group.evaluatedAt), today = dates(new Date().toISOString()).slice(0, 10);
  return `以下是 ${full === EMPTY ? full : full.startsWith(today) ? full.slice(11) : full.slice(5)} 的数据，刷新失败`;
};
const labelState = (value: unknown) => ({ ACTIVE: "活跃", DORMANT: "沉睡", UNKNOWN: "未知", OPEN: "进行中", CLOSED: "已结束", RESOLVED: "已解决", TRANSFERRED: "已转交", BOUND: "已绑定", UNBOUND: "未绑定", ONLINE: "在网", OFFLINE: "离线", online: "在网", offline: "离线", unknown: "未知" }[String(value)] ?? "未知");
const flowStatusLabels: Record<string, string> = {
  CREATED: "已创建", PENDING: "待处理", CONFIRMING: "确认中", WAITING_CONFIRMATION: "等待确认", OPEN: "待对账",
  SUBMITTED: "已提交", REVIEW_PENDING: "待审核", REVIEWING: "审核中", EXTENDED_HOLD: "延长等待", DELAYED: "已延迟", REVIEW_PASSED: "审核通过", PENDING_CHAIN: "等待链上处理", FROZEN: "已冻结", PROCESSING: "处理中", SENT: "已发送", CHAIN_SUBMITTED: "已广播",
  CONFIRMED: "已确认", CREDITED: "已入账", PAID: "已支付", SUCCESS: "成功", POSTED: "已记账", COMPLETED: "已完成", UNSETTLED: "未结算", MANUAL_REVIEW: "人工复核",
  FAILED: "失败", TX_FAILED: "发送失败", TX_ORPHANED: "链上交易异常", DEAD: "交易状态异常", ADDRESS_INVALID: "地址无效", REVIEW_REJECTED: "审核拒绝", REJECTED: "已拒绝", DECLINED: "支付被拒绝", EXPIRED: "已过期", ABNORMAL: "账务异常",
  CHARGEBACK: "拒付待处理", DISPUTED: "拒付争议中", CHARGEBACK_REVIEW: "拒付复核中", CHARGEBACK_REFUNDED: "拒付已退款", CHARGEBACK_RECOVERED: "拒付已追回", CHARGEBACK_PARTIAL: "拒付部分追回", REFUNDED: "已退款", RETURNED: "已退回", CANCELLED: "已取消",
};
/** 日期框按业务时区算当天 0 点，全站时间口径一致。 */
const businessDayStart = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) - businessOffsetMinutes() * 60000).toISOString();
const FLOW_KINDS: Record<string, string> = { DEPOSIT: "充值", WITHDRAWAL: "提现", ADJUSTMENT: "人工调整", ORDER_REFUND: "订单退款", TRIAL_BONUS_REVERSAL: "试用奖励冲回" };
const flowKindLabel = (value: unknown) => FLOW_KINDS[String(value)] ?? formatD4Subtype(value);
const flowStatusLabel = (value: unknown) => Object.hasOwn(flowStatusLabels, String(value)) ? flowStatusLabels[String(value)] : "未知";
// 绑定来源 (B8): only dedicated advisors, supervisors and the super admin see it; unknown values hide the row.
const assignmentSourceLabels: Record<string, string> = { MANUAL: "主管指定", RANDOM: "自动分配", INHERITED: "邀请继承", MIGRATED: "历史迁移", ADVISOR_CODE: "客服邀请码" };
// Display only: thousands separators, backend-padded zeros dropped, at least 2 decimals (same as M1 statistics).
/** 金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点；认不出的照原样写。 */
const grouped = (value: unknown) => /^-?\d+(?:\.\d+)?$/.test(String(value)) ? amountDisplay(String(value)) : show(value);
const USDT_TOTAL_FIELDS = new Set(["creditedDepositTotal", "successfulWithdrawalPrincipalTotal", "processingWithdrawalPrincipalTotal"]);
function financeAmount(row: Record<string, unknown>, key: string, status?: SupportFinanceFieldStatus) {
  if (status !== "READY" && status !== "PARTIAL") return EMPTY;
  const amount = grouped(row[key]);
  if (row.currency === "USDT" && USDT_TOTAL_FIELDS.has(key) && amount === "0" && status !== "READY") return EMPTY;
  return amount;
}
const statisticMoney = (value?: SupportCustomerStatistics["lifetime"][number]["deposits"], exact = false) => {
  const amount = value?.status === "AVAILABLE" || value?.status === "PARTIAL" ? value.confirmed : null;
  const display = exact ? amount == null ? EMPTY : grouped(amount) : compactSupportBoardValue(amount);
  return display !== "-" && display !== EMPTY && value?.status === "PARTIAL" ? `${display}（部分统计）` : display;
};
function Row({ label, value, numeric = false, title, mono = false, amount = false }: { label: ReactNode; value: unknown; numeric?: boolean | "count"; title?: string; /** 用户编码这类编号用等宽字体（TX-28）。 */ mono?: boolean; /** 金额按全站写法显示（PRD §5A）；算力等其他数值照原样。 */ amount?: boolean }) { return <div className="cvp-row"><span className="k">{label}</span><span className={mono ? "v m-user-code" : "v"} data-exact={title} aria-label={title} tabIndex={title ? 0 : undefined}>{numeric && compactSupportBoardValue(value, numeric === "count" ? "count" : "amount") === "-" ? EMPTY : amount ? grouped(value) : show(value)}</span></div>; }
/** 值是标签、链接、问号这类元素时用它（Row 只写文字和数）。 */
function NodeRow({ label, children }: { label: ReactNode; children: ReactNode }) { return <div className="cvp-row"><span className="k">{label}</span><span className="v">{children}</span></div>; }
/** 客户资料框里的一组：只展开入口对应的组，读取失败的组自己展开（DP-04、M11）。 */
/** 无权限的组不做成能点开的折叠：只有标题行和「· 无权限」，没有箭头和「详情」（ST-39，R04）。和折叠的标题行一个样子。 */
function DeniedRow({ title }: { title: string }) {
  return <div className="rd-fold m3-denied-row" data-inset=""><p><span className="rd-fold-title">{title}</span><span className="rd-fold-summary">· 无权限</span></p></div>;
}
function Group({ title, note, summary, open, onOpenChange, group, failed, retry, retrying, rereading, retryLabel, retryDetail, retryError, errorTitle, alertTone, warn, available, live, deniedInTitle, children }: { title: string; note?: string; summary: ReactNode; open: boolean; onOpenChange?: (open: boolean) => void; group?: SupportGroup; failed?: boolean; retry: () => void; retrying?: boolean; /** 旧数据那一行的「重试」正在重读：只留「重试中…」（ST-30、ST-31，R23）。 */ rereading?: boolean; retryLabel?: string; retryDetail?: string; retryError?: string; /** 整组读取失败时错误卡的标题，写「{对象}加载失败」（ST-34）。 */ errorTitle?: string; /** 标题行摘要的颜色：整组失败用红，和右栏、用户详情一致。 */ alertTone?: "warn" | "danger"; /** 组里有要注意的事（比如人数没读全）：默认展开，摘要用 warn 色（DP-04）。 */ warn?: boolean; available?: ReactNode; /** 一直挂着的读屏状态，放在组的最后（不占位置）。 */ live?: ReactNode; /** 无权限时整组换成只有标题行「· 无权限」的静态行（ST-39）。 */ deniedInTitle?: boolean; children: ReactNode }) {
  // 资料第一次就没读到时，失败由框顶的一张错误卡说，依赖资料的各组不再各写一遍「加载失败」（BUG-650）。
  if (!group && failed) return null;
  if (group?.status === "FORBIDDEN" && deniedInTitle) return <DeniedRow title={title} />;
  const status = retryError && group?.status !== "FORBIDDEN" ? "ERROR" : group?.status;
  // 重读失败但上次的数据还在：组顶一行橙黄字写明数据是哪次读到的，原因进问号，原值留着，这一组只有这一个「重试」（ST-36，R15）。
  const stale = retryError && group?.status === "READY" ? staleText(group) : undefined;
  const staleReading = Boolean(stale && rereading);
  return <Fold inset title={title} explain={note} summary={!status ? "正在加载…" : status === "READY" || staleReading ? summary : stale ? "刷新失败" : statusText[status]} alert={!staleReading && (status === "ERROR" || status === "READY" && !!warn)} alertTone={stale ? "warn" : alertTone} {...(onOpenChange ? { open, onOpenChange } : { defaultOpen: open })}>
    {stale && <p className="m3-profile-state" data-tone="warn" role={staleReading ? "status" : "alert"}>{!staleReading && <>{stale}<Explain label="刷新失败的原因" content={retryError} /></>}<CountsRetryButton onRetry={retry} retrying={staleReading} rereading={staleReading} /></p>}
    {available}
    {!stale && (!status ? <BlockState state="loading" compact title="正在加载…" /> : status !== "READY" &&
      <BlockState state={status === "ERROR" ? "error" : "empty"} compact title={status === "ERROR" && errorTitle ? errorTitle : statusText[status]} detail={retryError ?? retryDetail} retrying={retrying} retryLabel={retryLabel ?? `重新加载${title}`} onRetry={status === "ERROR" ? retry : undefined} />)}
    {group?.status === "READY" && children}
    {live}
  </Fold>;
}

type CustomerProfile = SupportProfile & { annotations: SupportGroup & { recoveredSystemTags?: unknown[] } };
type ProfileGroup = Exclude<keyof SupportProfile, "actions" | "statistics">;
const profileRefreshGroups = ["identity", "statistics", "finance", "risk", "annotations", "service"] as const;
type ProfileReadErrors = Partial<Record<ProfileGroup | "statistics", string>>;
type ProfileReadIntent = ProfileGroup | "initial" | "refresh" | "statistics" | "annotation-write";
type AnnotationWrite = { scope: string; completeReadback?: () => void };

function isProfileGroup(intent: ProfileReadIntent): intent is ProfileGroup {
  return intent !== "initial" && intent !== "refresh" && intent !== "statistics" && intent !== "annotation-write";
}

function mergeProfileGroups(previous: CustomerProfile, next: SupportProfile, groups: readonly ProfileGroup[]): CustomerProfile {
  const updated: CustomerProfile = { ...previous, ...Object.fromEntries(groups.map(key => [key, next[key]])) };
  if (groups.includes("identity") && next.identity.status === "READY") {
    // Identity reload also owns risk and system tags. Keep custom tags and notes unless requested.
    updated.risk = next.risk;
    const systemTags = next.annotations.data?.systemTags;
    if (Array.isArray(systemTags) && updated.annotations.status !== "FORBIDDEN") {
      updated.annotations = updated.annotations.data
        ? { ...updated.annotations, data: { ...updated.annotations.data, systemTags } }
        : { ...updated.annotations, recoveredSystemTags: systemTags };
    }
  } else if (groups.includes("annotations") && next.annotations.status !== "READY" && next.annotations.status !== "FORBIDDEN") {
    updated.annotations = { ...next.annotations, recoveredSystemTags: previous.annotations.recoveredSystemTags };
  }
  return updated;
}

export function M3CustomerProfile({ ctx, customerId, source, transferEntry = true, conversation, scopeVersion, onHistory, messageError, onRetryMessages, openRequest = 0 }: { ctx: MCtx; customerId: string; source: "M1" | "M3"; transferEntry?: boolean; conversation?: SessionConvo; scopeVersion?: number; onHistory: (no: string) => void; messageError?: string; onRetryMessages: () => void; /** 每加一次打开一次全部资料：窄宽时入口在对话头的菜单里。 */ openRequest?: number }) {
  const pathname = usePathname(), searchParams = useSearchParams();
  const reach = useReach();
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  const [profileRead, setProfileRead] = useState<{ scope: string; data: CustomerProfile } | null>(null);
  const [error, setError] = useState("");
  const [groupReadErrors, setGroupReadErrors] = useState<ProfileReadErrors>({});
  const [paymentWriteBusy, setPaymentWriteBusy] = useState(false);
  const [statisticsRetryError, setStatisticsRetryError] = useState("");
  // 只给界面用：标签或备注已保存、正在读回最新资料（R25）。
  const [readingBack, setReadingBack] = useState(false);
  const [paymentIdentity, setPaymentIdentity] = useState<{ scope: string; label: string } | null>(null);
  const [reload, setReload] = useState(0), [profileRetry, setProfileRetry] = useState(0), [view360, setView360] = useState(false);
  const [devicePage, setDevicePage] = useState(1), [flowPage, setFlowPage] = useState(1);
  const [deviceGroup, setDeviceGroup] = useState<SupportGroup | null>(null), [flowGroup, setFlowGroup] = useState<SupportGroup | null>(null);
  const [pageError, setPageError] = useState({ devices: "", flows: "" }), [pageRetry, setPageRetry] = useState(0);
  const [currency, setCurrency] = useState(""), [flowStatus, setFlowStatus] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [tag, setTag] = useState(""), [note, setNote] = useState(""), [writing, setWriting] = useState(false), [writeError, setWriteError] = useState("");
  const [historyPage, setHistoryPage] = useState(1), [ticketPage, setTicketPage] = useState(1);
  const [maintenance, setMaintenance] = useState<SupportMaintenanceHistory | null>(null), [maintenanceError, setMaintenanceError] = useState(""), [maintenancePage, setMaintenancePage] = useState(1);
  const [summaryCurrency, setSummaryCurrency] = useState("USDT");
  const [detailSection, setDetailSection] = useState("");
  const [recordSection, setRecordSection] = useState("");
  const open360 = (section = "") => { setDetailSection(section); setRecordSection(section); setView360(true); };
  const previousOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (previousOpenRequest.current === openRequest) return;
    previousOpenRequest.current = openRequest;
    if (openRequest > 0) open360();
  }, [openRequest]);
  useEffect(() => {
    if (!view360 || !detailSection) return;
    const target = [...document.querySelectorAll<HTMLElement>(".m3-service-profile details")].find(element => element.querySelector("summary")?.textContent?.startsWith(detailSection));
    target?.setAttribute("open", ""); target?.scrollIntoView({ block: "nearest" }); target?.querySelector<HTMLElement>("summary")?.focus();
  }, [view360, detailSection]);
  const scopeKey = `${epoch}:${customerId}`, revokedScope = useRef("");
  const scopeDenied = revokedScope.current === scopeKey;
  // A scope refresh revalidates the current customer without remounting the payment block.
  const paymentScope = `${adminShellSessionKey(session, epoch)}:${customerId}:${conversation?.id ?? ""}`;
  // A snapshot revision invalidates the request, while the authorization key owns the retained data.
  const profileAuthorization = `${paymentScope}:${conversation?.ownerAdminId ?? ""}:${conversation?.assignmentId ?? ""}`;
  const profileScope = `${profileAuthorization}:${scopeVersion ?? ""}`;
  const profile = !scopeDenied && profileRead?.scope === profileAuthorization ? profileRead.data : null;
  const previousScopeVersion = useRef(scopeVersion);
  const annotationWrite = useRef<AnnotationWrite | null>(null);
  const requestStamp = `${profileScope}:${reload}:${scopeDenied}`;
  const stamp = useRef(""), mounted = useRef(true); stamp.current = requestStamp;
  const profileReadSequence = useRef(0);
  const [activeReadIntents, setActiveReadIntents] = useState<ReadonlySet<ProfileReadIntent>>(() => new Set());
  const profileReadIntents = useRef(activeReadIntents);
  // The retry handlers and the rendered buttons use the same intent set. Publish it before starting the request.
  const updateReadIntents = (intents: ReadonlySet<ProfileReadIntent>) => {
    profileReadIntents.current = intents;
    setActiveReadIntents(intents);
  };
  const settleAnnotationReadback = () => {
    const write = annotationWrite.current;
    const complete = write?.completeReadback;
    if (write) write.completeReadback = undefined;
    complete?.();
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      settleAnnotationReadback();
    };
  }, []);
  const revokeScope = (message = "可能是客户归属或你的查看范围变了。请重试，或返回列表核对。") => {
    if (revokedScope.current === scopeKey) return;
    revokedScope.current = scopeKey; stamp.current += ":revoked";
    updateReadIntents(new Set());
    settleAnnotationReadback();
    setStatisticsRetryError(""); setGroupReadErrors({});
    setProfileRead(null); setPaymentIdentity(null); setDeviceGroup(null); setFlowGroup(null); setMaintenance(null); setView360(false);
    setTag(""); setNote(""); annotationWrite.current = null; setWriting(false); setWriteError("");
    setError(message);
  };
  const denied = (cause: unknown) => {
    if (cause instanceof SupportClientError
      && (cause.status === 401 || cause.status === 200 && cause.apiCode === 401)) {
      revokeScope(displayAdminReadError(cause));
      return true;
    }
    if (!isSupportScopeDenial(cause)) return false;
    if (revokedScope.current !== scopeKey) { revokeScope(); ctx.invalidateScope(conversation?.id, customerId); }
    return true;
  };
  // 资料卡的「重试」只重读 /360；设备、流水、维护记录各有自己的读取和参数，读成的不重来（ST-35，复审 F04）。范围被收回时各块都已清空，才全部重读。
  const retryProfile = () => { if (stamp.current !== requestStamp) return; if (revokedScope.current === scopeKey) { revokedScope.current = ""; setReload(n => n + 1); } else setProfileRetry(n => n + 1); };
  const applyPaymentIdentity = (group: SupportProfile["identity"]) => {
    const identity = group.data;
    const userNo = String(identity?.userNo ?? customerId);
    setPaymentIdentity(group.status === "READY"
      ? { scope: profileAuthorization, label: `${userNicknameText(String(identity?.nickname ?? userNo), identity?.phoneMasked)} · ${userNo}` }
      : null);
  };
  async function readProfile(requested: readonly ProfileReadIntent[], signal?: AbortSignal) {
    const scope = stamp.current;
    const sequence = ++profileReadSequence.current;
    updateReadIntents(new Set([...profileReadIntents.current, ...requested]));

    let result: { profile: SupportProfile } | { failure: unknown };
    try {
      // 接线删：夹具。夹具开着时客户资料不发读请求。
      result = { profile: perfFixture()?.profile ? profileFixture() : await supportEnhancements.profile(customerId, signal) };
    } catch (failure) {
      result = { failure };
    }
    if (!mounted.current || signal?.aborted || scope !== stamp.current || sequence !== profileReadSequence.current) return;

    // The latest response settles the whole set even when an earlier response has already arrived.
    const intents = profileReadIntents.current;
    updateReadIntents(new Set());
    const groups = [...intents].filter(isProfileGroup);
    const initial = intents.has("initial");
    const refresh = intents.has("refresh");
    const statistics = intents.has("statistics");
    const annotationReadback = intents.has("annotation-write");
    if (annotationReadback) settleAnnotationReadback();

    if ("failure" in result) {
      if (denied(result.failure)) return;
      const reason = displayAdminReadError(result.failure);
      if (initial) {
        setPaymentIdentity(null);
        setError(reason);
      }
      if (statistics && !refresh) setStatisticsRetryError(reason);
      const failedGroups = refresh ? profileRefreshGroups : groups;
      const errors: ProfileReadErrors = Object.fromEntries(failedGroups.map(group => [group, reason]));
      if (annotationReadback) errors.annotations = `已保存。${reason}`;
      setGroupReadErrors(previous => ({ ...previous, ...errors }));
      return;
    }

    const next = result.profile;
    if (initial || refresh || statistics || annotationReadback) {
      setProfileRead({ scope: profileAuthorization, data: next });
      applyPaymentIdentity(next.identity);
      setStatisticsRetryError("");
      setGroupReadErrors({});
      return;
    }

    if (groups.includes("identity")) applyPaymentIdentity(next.identity);
    setProfileRead(previous => ({
      scope: profileAuthorization,
      data: previous?.scope === profileAuthorization ? mergeProfileGroups(previous.data, next, groups) : next,
    }));
    setGroupReadErrors(previous => {
      const errors = { ...previous };
      for (const group of groups) delete errors[group];
      if (groups.includes("identity") && next.identity.status === "READY") delete errors.risk;
      return errors;
    });
  }

  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    const controller = new AbortController();
    const write = annotationWrite.current;
    updateReadIntents(new Set());
    const requested: ProfileReadIntent[] = [];
    if (write && write.scope !== profileAuthorization) {
      settleAnnotationReadback();
      annotationWrite.current = null;
      setWriting(false);
      setWriteError("");
    } else if (write?.completeReadback) {
      // The new snapshot read completes a pending write readback in the same authorization scope.
      requested.push("annotation-write");
    }
    const keepProfile = profile !== null && scopeVersion !== previousScopeVersion.current;
    previousScopeVersion.current = scopeVersion;
    setError("");
    if (!keepProfile) {
      setProfileRead(null); setPaymentIdentity(null);
      setStatisticsRetryError(""); setGroupReadErrors({});
    }
    requested.push(keepProfile ? "refresh" : "initial");
    void readProfile(requested, controller.signal);
    return () => {
      controller.abort();
      profileReadSequence.current++;
    };
  }, [customerId, epoch, reload, profileRetry, profileScope]);
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    if (perfFixture()?.profile) return; // 接线删：夹具。样本客户只有统计组和资金组，其余读取不发。
    const controller = new AbortController(), saved = stamp.current; setDeviceGroup(null); setPageError(e => ({ ...e, devices: "" }));
    supportEnhancements.devices(customerId, devicePage, controller.signal).then(g => { if (!controller.signal.aborted && saved === stamp.current) setDeviceGroup(g); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setPageError(v => ({ ...v, devices: displayAdminError(e) })); });
    return () => controller.abort();
  }, [customerId, epoch, devicePage, pageRetry, reload, profileScope]);
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    if (perfFixture()?.profile) return; // 接线删：夹具。样本客户只有统计组和资金组，其余读取不发。
    const controller = new AbortController(), saved = stamp.current; setFlowGroup(null); setPageError(e => ({ ...e, flows: "" }));
    supportEnhancements.flows(customerId, { pageNum: flowPage, currency: currency || undefined, status: flowStatus || undefined, from: from ? businessDayStart(from) : undefined, to: to ? businessDayStart(to) : undefined }, controller.signal).then(g => { if (!controller.signal.aborted && saved === stamp.current) setFlowGroup(g); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setPageError(v => ({ ...v, flows: displayAdminError(e) })); });
    return () => controller.abort();
  }, [customerId, epoch, flowPage, currency, flowStatus, from, to, pageRetry, reload, profileScope]);
  useEffect(() => {
    if (revokedScope.current === scopeKey) return;
    if (perfFixture()?.profile) return; // 接线删：夹具。样本客户只有统计组和资金组，其余读取不发。
    const controller = new AbortController(), saved = stamp.current; setMaintenance(null); setMaintenanceError("");
    supportClient.maintenanceHistory(customerId, { pageNum: maintenancePage, pageSize: 10, signal: controller.signal }).then(v => { if (!controller.signal.aborted && saved === stamp.current) setMaintenance(v); }).catch(e => { if (!controller.signal.aborted && saved === stamp.current && !denied(e)) setMaintenanceError(displayAdminError(e)); });
    return () => controller.abort();
  }, [customerId, epoch, maintenancePage, reload, profileScope]);
  useEffect(() => { setDevicePage(1); setFlowPage(1); setHistoryPage(1); setTicketPage(1); setMaintenancePage(1); setView360(false); setTag(""); setNote(""); annotationWrite.current = null; setWriting(false); setWriteError(""); }, [customerId, epoch]);
  useEffect(() => {
    const onInvalidated = (event: Event) => {
      const { conversationNo, customerId: affectedCustomer } = (event as CustomEvent<{ conversationNo?: string; customerId?: string }>).detail ?? {};
      if (!conversationNo && !affectedCustomer || affectedCustomer === customerId || Boolean(conversationNo && conversationNo === conversation?.id)) revokeScope();
    };
    window.addEventListener("support-scope-invalidated", onInvalidated);
    return () => window.removeEventListener("support-scope-invalidated", onInvalidated);
  }, [customerId, epoch, conversation?.id]);
  const retryStatistics = () => {
    const active = profileReadIntents.current;
    if (scopeDenied || stamp.current !== requestStamp || annotationWrite.current || paymentWriteBusy || active.has("refresh") || active.has("statistics")) return;
    statisticsFocus.arm();
    return readProfile(groupReadErrors.statistics ? ["refresh", "statistics"] : ["statistics"]);
  };
  const retryGroup = (key: ProfileGroup, arm?: () => void) => {
    const active = profileReadIntents.current;
    if (scopeDenied || stamp.current !== requestStamp || active.has("refresh") || active.has(key)) return;
    arm?.();
    setError("");
    return readProfile([groupReadErrors.statistics ? "refresh" : key]);
  };
  const refreshInFlight = activeReadIntents.has("refresh");
  const groupRereading = (key: ProfileGroup) => refreshInFlight || activeReadIntents.has(key);
  const conversationId = conversation?.id;
  const profileQuery = new URLSearchParams();
  if (conversationId) profileQuery.set("conversationNo", conversationId);
  if (source === "M1" && pathname) {
    const query = searchParams?.toString();
    profileQuery.set("returnTo", query ? `${pathname}?${query}` : pathname);
  }
  const profileSearch = profileQuery.toString();
  const writable = Boolean(!scopeDenied && conversationId && conversation?.ownerAdminId === session?.adminId && (session?.role === "super" || session?.role === "superadmin" || session?.authorities.includes("service_m3_write")));
  const canReadAccount = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities.includes("user_c1hub_read"));
  const annotationsStale = Boolean(groupReadErrors.annotations);
  const annotationScope = `${profileAuthorization}:${writable}`;
  const currentAnnotationScope = useRef(annotationScope); currentAnnotationScope.current = annotationScope;
  async function annotate(action: (id: string) => Promise<boolean>, clear: () => void, failureInDialog = false) {
    if (revokedScope.current === scopeKey || stamp.current !== requestStamp || !conversationId || !writable || annotationsStale || annotationWrite.current || profileReadIntents.current.has("statistics")) return false;
    const saved = stamp.current;
    const writeToken: AnnotationWrite = { scope: profileAuthorization };
    annotationWrite.current = writeToken;
    setWriting(true); setWriteError("");
    const sameWriteScope = () => mounted.current && annotationWrite.current === writeToken && revokedScope.current !== scopeKey && currentAnnotationScope.current === annotationScope;
    let confirmed = false;
    try {
      const ok = await action(conversationId);
      if (!sameWriteScope()) return false;
      // 写请求失败由页面 toast 或删除确认框展示一次。
      if (ok) {
        confirmed = true; clear(); setReadingBack(true);
        await new Promise<void>(resolve => {
          writeToken.completeReadback = resolve;
          // The write can refresh the conversation snapshot before it returns its receipt.
          if (saved !== stamp.current && profileReadIntents.current.has("refresh")) {
            updateReadIntents(new Set([...profileReadIntents.current, "annotation-write"]));
          } else {
            void readProfile(["annotation-write"]);
          }
        });
      }
      return ok;
    } catch(e) {
      if ((!failureInDialog || confirmed) && sameWriteScope() && saved === stamp.current && !denied(e)) setWriteError(confirmed ? `已保存，但资料刷新失败，请重新加载 · ${displayAdminError(e)}` : displayAdminError(e));
      return confirmed;
    } finally { if (mounted.current) setReadingBack(false); if (annotationWrite.current === writeToken) { annotationWrite.current = null; if (mounted.current) setWriting(false); } }
  }
  const identity = profile?.identity.data, finance = profile?.finance.data, service = profile?.service.data, annotations = profile?.annotations.data;
  const paymentSecurityPort = useMemo(() => {
    if (scopeDenied || paymentIdentity?.scope !== profileAuthorization) return null;
    return paymentSecurityPorts.support(customerId);
  }, [scopeDenied, paymentIdentity?.scope, profileAuthorization, customerId]);
  const paymentUserLabel = paymentIdentity?.label ?? customerId;
  const statisticsGroup = profile?.statistics;
  const statistics = statisticsGroup?.status === "READY" ? statisticsGroup.data : null;
  const inviter = inviterDetailView(identity?.inviter, true, reach);
  const levels = supportLevels(identity);
  const levelSummary = [levels.userLevel && `用户分层 ${levels.userLevel}`, levels.vRank && `团队等级 ${levels.vRank}`].filter(Boolean).join(" · ");
  const statisticsRetrying = activeReadIntents.has("statistics");
  const statisticsInFlight = refreshInFlight || statisticsRetrying;
  const statisticsRetry = { onRetry: () => void retryStatistics(), retrying: statisticsInFlight || writing || paymentWriteBusy, rereading: statisticsInFlight };
  const invitationWriteBlock = statisticsRetrying ? INVITATION_REREAD_BLOCK : undefined;
  const counts: CountsView = statisticsRetryError
    ? { kind: "failed", reason: statisticsRetryError, ...statisticsRetry }
    : supportCountsView(statistics?.invitations, statisticsRetry);
  const countsHead = counts.kind === "anomaly" ? "人数暂不显示" : counts.kind === "partial" ? "人数没有读全" : counts.kind === "failed" ? "人数加载失败" : "";
  const statisticsRefreshError = groupReadErrors.statistics;
  const statisticsFocus = useCountsRetryFocus(statisticsRetrying, counts.kind === "ready" && !statisticsRefreshError);
  const statisticsLive = <span role="status" className="rd-sr-only">{statisticsFocus.status}</span>;
  const countsHaveRetry = counts.kind === "failed" || counts.kind === "partial";
  const showStatisticsRetry = Boolean(statisticsRefreshError) && !countsHaveRetry;
  const showStatisticsStale = !statisticsInFlight && Boolean(statisticsRetryError || statisticsRefreshError);
  // 快照重读失败、旧统计还在：标题行摘要也写「刷新失败」，和其他组一样（R22）。
  const statisticsSummaryStale = !statisticsInFlight && Boolean(statisticsRefreshError) && statisticsGroup?.status === "READY";
  // narrow：右栏只有 276 宽，时间写短、时区进问号，整句一行（R27）。
  const statisticsStale = (narrow: boolean) => statisticsGroup?.status === "READY" && (showStatisticsStale || showStatisticsRetry) &&
    <p className="m3-profile-state" data-tone="warn">
      {showStatisticsStale && <>{narrow ? staleTextShort(statisticsGroup) : staleText(statisticsGroup)}{(narrow || statisticsRefreshError) && <Explain label="刷新失败的原因" content={narrow ? <><p>时间为{businessZone().label}。</p>{statisticsRefreshError && <p>{statisticsRefreshError}</p>}</> : statisticsRefreshError} />}</>}
      {showStatisticsRetry && <CountsRetryButton {...statisticsRetry} />}
    </p>;
  const firstKnown = statistics?.first.status === "AVAILABLE";
  const firstConfirmed = firstKnown && statistics?.first.state === "CONFIRMED";
  const firstState = firstConfirmed ? "已首充" : firstKnown && statistics?.first.state === "NONE" ? "未首充" : "未知";
  // 累计业绩额（只算 USDT，自起算点以来）。接线前只有夹具给数，生产路径写「业绩数据暂不可用」（perf-wiring.ts）。
  const perfOfProfile = perfFixture()?.profile ? profilePerfFixture() : profilePerf();
  const cumulativeText = perfOfProfile.cumulative.state === "complete" ? `${perfText(perfOfProfile.cumulative)} USDT（自 2026-11-20 起）` : "—";
  const firstSource = firstConfirmed ? perfOfProfile.firstSource ?? (statistics?.first.kind === "DEPOSIT" ? "充值" : statistics?.first.kind === "DEVICE_PURCHASE" ? "购机" : "-") : "-";
  const advisorName = service?.agentName ?? conversation?.owner;
  const canSeeAssignmentSource = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.supportReadModes?.some(mode => mode === "PERSONAL" || mode === "MANAGED"));
  const assignmentSource = canSeeAssignmentSource && Object.hasOwn(assignmentSourceLabels, String(service?.assignmentSource)) ? assignmentSourceLabels[String(service?.assignmentSource)] : undefined;
  const advisorId = typeof service?.agentAdminId === "number" ? service.agentAdminId : conversation?.ownerAdminId;
  const currencies = asRows(finance?.byCurrency), devices = asRows(deviceGroup?.data?.records), flows = asRows(flowGroup?.data?.records);
  const deviceStatuses = deviceGroup?.data?.fieldStatuses as Record<string,string>|undefined;
  const history = (() => { try { return (JSON.parse(ctx.pget("I.session.convos") ?? "[]") as SessionConvo[]).filter(c => c.customerId === customerId).sort((a,b)=>b.lastTs-a.lastTs); } catch { return []; } })();
  const latestServiceMessage = conversation?.messages.findLast(message => message.sourceSenderType === "AGENT" && message.origin !== "WELCOME");
  const cachedServiceTime = typeof service?.lastServiceAt === "string" ? parseBusinessTime(service.lastServiceAt) : 0;
  const newerServiceMessage = latestServiceMessage && latestServiceMessage.ts > (cachedServiceTime || 0) ? latestServiceMessage : undefined;
  const lastServiceAt = newerServiceMessage?.sourceCreatedAt ?? service?.lastServiceAt;
  const serviceConversationNo = newerServiceMessage?.sourceConversationNo ?? service?.conversationNo;
  const serviceConversationStatus = (source === "M3" ? history.find(row => row.id === serviceConversationNo)?.status.toUpperCase() : undefined) ?? service?.conversationStatus;
  const waitingReply = source === "M3" && history.length === service?.conversationCount && history.every(row => row.pendingReplyCount != null)
    ? history.some(row => row.pendingReplyCount! > 0)
    : service?.waitingReply;
  const tickets = (() => { try { return (JSON.parse(ctx.pget("I.support.tickets") ?? "[]") as SupportTicket[]).filter(t => String(t.userId) === customerId); } catch { return []; } })();
  const financeLabels: Record<string,string> = { creditedDepositTotal: "累计成功充值实际入账", successfulWithdrawalPrincipalTotal: "累计成功提现金额", successfulWithdrawalFeeTotal: "累计提现手续费", successfulWithdrawalNetTotal: "累计提现实际到账", processingWithdrawalPrincipalTotal: "处理中提现金额", balance: "余额", availableBalance: "可用余额" };
  // 一页放得下就不显示（ST-13）。
  const pager = (page: number, total: unknown, set: (n:number)=>void, pageSize = 10, showTotal = true) => page === 1 && typeof total === "number" && total <= pageSize ? null : <div className="m3-profile-pager"><Button size="sm" disabled={page<=1} onClick={()=>set(page-1)}>上一页</Button><span>第 {page} 页{showTotal && <> · {show(total)} 条</>}</span><Button size="sm" disabled={typeof total !== "number" || page*pageSize>=total} onClick={()=>set(page+1)}>下一页</Button></div>;
  const summaryFinance = currencies.find(row => row.currency === summaryCurrency) ?? currencies[0];
  const summaryStatuses = summaryFinance?.fieldStatuses as Record<string, SupportFinanceFieldStatus> | undefined;
  const exactMoney = (key: string) => summaryFinance ? financeAmount(summaryFinance, key, summaryStatuses?.[key]) : EMPTY;
  const risk = profile?.risk.data;
  const riskLevel = ({ LOW: "低风险", MEDIUM: "中风险", HIGH: "高风险", CRITICAL: "高风险", 低风险: "低风险", 中风险: "中风险", 高风险: "高风险" } as Record<string, string>)[String(risk?.level)] ?? "未知";
  const systemTags = Array.isArray(annotations?.systemTags) ? annotations.systemTags : profile?.annotations.recoveredSystemTags;
  const tags = [...(systemTags ?? []), ...(Array.isArray(annotations?.customTags) ? annotations.customTags : [])].filter((value): value is string => typeof value === "string");
  const latestNote = asRows(annotations?.notes).toSorted((a, b) => (Date.parse(String(b.createdAt)) || 0) - (Date.parse(String(a.createdAt)) || 0))[0];
  /** 客户资料第一次就没读到：依赖它的各块由一张错误卡接管，不再各写「正在加载」「币种未同步」；独立读取的支付安全、设备照常（ST-30、ST-34，BUG-650）。 */
  const profileFailed = !profile && !!error;
  const groupReadProps = (key: ProfileGroup) => {
    const reading = groupRereading(key);
    return {
      group: profile?.[key],
      retry: () => void retryGroup(key),
      retryError: groupReadErrors[key],
      retrying: reading,
      rereading: reading,
      retryLabel: reading ? "重试中…" : undefined,
    };
  };
  const summaryState = (key: ProfileGroup, arm?: () => void) => {
    const group = profile?.[key];
    const readError = group?.status === "FORBIDDEN" ? undefined : groupReadErrors[key];
    const status = readError ? "ERROR" : group?.status;
    const reading = groupRereading(key);
    // 上次的数据还在：一句话写明是哪次读到的，原因进问号，免得在 276 宽里折成好几行（ST-36，R15）。
    if (readError && group?.status === "READY") {
      return <p className="m3-profile-state" data-tone="warn" role={reading ? "status" : "alert"}>{!reading && <>{staleTextShort(group)}<Explain label="刷新失败的原因" content={<><p>时间为{businessZone().label}。</p><p>{readError}</p></>} /></>}<CountsRetryButton onRetry={() => void retryGroup(key, arm)} retrying={reading} rereading={reading} /></p>;
    }
    return status === "READY" ? null : <p className="m3-profile-state" role={status === "ERROR" || error ? "alert" : "status"}>{status ? statusText[status] : error ? "加载失败" : "正在加载…"}{readError && <> · {readError}</>}{status === "ERROR" && <button type="button" className="m3-profile-link" aria-disabled={reading || undefined} aria-busy={reading || undefined} onClick={reading ? undefined : () => void retryGroup(key)}>{reading ? "重试中…" : "重新加载"}</button>}</p>;
  };
  // 资金重读失败、旧数据还在时，这一组只留上面那一个「重试」，「部分资金资料暂时无法确认」后面不再给第二个重读入口（R15）。
  const financeStale = profile?.finance.status === "READY" && Boolean(groupReadErrors.finance);
  // 右栏「重新加载资金」仍失败时，这个链接会换成旧数据那一行：焦点落到那一行的「重试」，不掉到页面上（R24）。
  const financeRereading = groupRereading("finance");
  const financeFocus = useCountsRetryFocus(financeRereading, false);
  const annotationState = summaryState("annotations");
  // 标签重读失败、上次的标签还在时，提示写在标签上面（「以下是…」）。
  const annotationsRetained = profile?.annotations.status === "READY" && Boolean(groupReadErrors.annotations);
  /** 四个人数（PRD §6.6-7）：口径问号在「团队奖励范围内」旁；只有人数读不出时换成一行，带原因和重试（07c）；数据异常、没读全常显提示（DP-03）。 */
  const countRows = (narrow: boolean) => counts.kind === "failed"
    // 右栏只有 276 宽：标签和重试一行，原因另起一行占满整行，不在 104 宽的值列里折成碎行。
    ? narrow
      ? <div className="cvp-row m3-invite-failed" role="alert"><span className="k">邀请人数</span><span className="v"><StatusTag tone="warn" icon={AlertTriangle}>加载失败</StatusTag></span><span className="m3-invite-failed-reason"><span>{counts.reason}</span>{counts.onRetry && <CountsRetryButton onRetry={counts.onRetry} retrying={counts.retrying} rereading={counts.rereading} />}</span></div>
      : <NodeRow label="邀请人数"><CountsFailed view={counts} /></NodeRow>
    : <>
      <NodeRow label={`${COUNT_LABELS.direct}（人）`}>{countText(counts, "direct", false)}</NodeRow>
      <NodeRow label={<>{COUNT_LABELS.within}（人）<CountsExplain /></>}>{countText(counts, "within", false)}</NodeRow>
      <NodeRow label={`${COUNT_LABELS.beyond}（人）`}>{countText(counts, "beyond", false)}</NodeRow>
      <NodeRow label={`${COUNT_LABELS.total}（人）`}>{countText(counts, "total", false)}</NodeRow>
      <CountsNotice view={counts} />
    </>;
  /** 会话右栏「首充与邀请」：统计组不是 READY 时只画这一种状态，不画占位行（BUG-631）；无权限时整组是一行静态标题（ST-39）。 */
  const statisticsState = statisticsGroup?.status === "READY" ? null
    : !statisticsGroup ? <BlockState state="loading" compact title="正在加载…" />
    : statisticsGroup.status === "ERROR" ? <BlockState state="error" compact title="首充与邀请加载失败" detail={statisticsRetryError || "这次没读出这组统计，其他资料照常。"} {...statisticsRetry} retryLabel={statisticsInFlight ? "重试中…" : undefined} />
    : <BlockState state="empty" compact title="这组统计暂时无法确认" />;
  const canReleasePayment = session?.role === "superadmin" || Boolean(session?.authorities.includes("user_c5_payment_password_release"));
  const detailLink = (section: string, label = "详情") => <button type="button" className="m3-profile-link" aria-label={`${section}${label}`} onClick={()=>open360(section)}>{label}</button>;
  // 一个币种一列，读不到的项目合成一条提示放在组顶（DP-03、VS-105）。
  const financeGaps = (["FORBIDDEN","ERROR","UNKNOWN"] as const).flatMap(state => {
    const labels = Object.entries(financeLabels).filter(([key]) => currencies.some(row => { const status = (row.fieldStatuses as Record<string,SupportFinanceFieldStatus>|undefined)?.[key]; return financeAmount(row, key, status) === EMPTY && (status === "FORBIDDEN" || status === "ERROR" ? status : "UNKNOWN") === state; })).map(([,label]) => label);
    return labels.length ? [{ state, text: `${labels.join("、")}${state === "FORBIDDEN" ? "无查看权限，请联系管理员核对权限。" : state === "ERROR" ? "加载失败。" : "暂时无法确认。"}` }] : [];
  });
  const financeCell = (row: Record<string, unknown>, key: string) => {
    const state = (row.fieldStatuses as Record<string,SupportFinanceFieldStatus>|undefined)?.[key];
    const amount = financeAmount(row, key, state);
    return amount !== EMPTY && state === "PARTIAL" ? `${amount}（部分统计）` : amount;
  };
  const summaryUnit = nexGridBrandText(String(summaryFinance?.currency ?? ""));
  const devicesRead = !pageError.devices && deviceGroup?.status === "READY";
  const deviceScope = "持有和在网只算现在的设备。完整客户档案里的设备数是全部记录，含已回收和已停用的，两个数不一样是正常的。";
  const heldDevices = compactSupportBoardValue(deviceStatuses?.heldCount === "READY" ? deviceGroup?.data?.heldCount : null, "count");
  // 这个账号在这里能办的事：没有的不给入口，写清谁办（M3、OP-126）。
  const accountEntry = source !== "M1";
  const readOnlyAnnotations = source === "M1" && !conversationId;
  const accountActions = ([["resetPassword", "重置密码", "/users/security"], ["freeze", "冻结账户", "/users/actions"], ["unfreeze", "恢复账户", "/users/actions"], ["adjustBalance", "资金调整", "/users/assets"]] as const).filter(([key]) => profile?.actions[key]?.allowed && identity?.userNo);
  const accountLinks = canReadAccount ? [["提现记录", "hub-withdrawal"], ["设备明细", "hub-devices"]] as const : [];
  const canResetPassword = accountActions.some(([key]) => key === "resetPassword");
  const hasAccountEntry = accountActions.length + accountLinks.length > 0;
  const passwordHelp = "这个账号不能重置密码。客户可以在 App 用验证码自己重设；要后台处理，请有「安全与登录设备」权限的同事办。";
  const accountHelp = "这个账号不能办账户操作。冻结、恢复账户和调整余额，请有权限的同事到「账户操作」「余额与资产调整」办。";
  const entry = detailSection || "基本信息";
  const opens = (title: string) => title.startsWith(entry);
  // 客户资料里的明细记录一次展开一组，避免上下堆叠列表（DP-67）。
  const recordFold = (title: string) => ({ open: recordSection === title, onOpenChange: (open: boolean) => setRecordSection(open ? title : "") });
  const body = <div className="m3-service-profile">
    {profileFailed ? <BlockState state="error" compact title="客户资料加载失败" detail={error} onRetry={retryProfile} retryLabel="重试" />
      : error && <Notice tone="danger" action={<Button size="sm" onClick={retryProfile}>重新加载资料</Button>}>{error}</Notice>}
    {!scopeDenied && <>
    <Group title="基本信息" open={opens("基本信息")} summary={[levelSummary, show(identity?.region)].filter(Boolean).join(" · ")} {...groupReadProps("identity")} failed={Boolean(error)}>
      <Row label="客户姓名" value={userNicknameText(show(identity?.nickname), identity?.phoneMasked)}/><Row label={<>用户编码<Explain label="系统编号" content={`系统编号 ${customerId}`}/></>} value={identity?.userNo} mono/>{inviter && <NodeRow label="邀请人"><InviterValue view={inviter} /></NodeRow>}{levels.userLevel && <Row label="用户分层" value={levels.userLevel}/>}{levels.vRank && <Row label="团队等级" value={levels.vRank}/>}<Row label="手机" value={identity?.phoneMasked}/><Row label="地区" value={identity?.region}/><Row label="注册时间" value={dates(identity?.registeredAt)}/><Row label="最近登录" value={dates(identity?.lastLoginAt)}/>
    </Group>
    {/* 摘要和右栏同一写法：人数读不全时只写这件事并默认展开（DP-04、PG-53）。 */}
    <Group title="首充与邀请统计" open={opens("首充与邀请统计")} summary={statisticsSummaryStale ? "刷新失败" : countsHead || `首充：${firstState}`} warn={!!countsHead || statisticsSummaryStale} note="首充是第一次成功充值或合格付费购机，含购机直接付款；赠送与试用不计入。" group={statisticsGroup} deniedInTitle failed={Boolean(error)} retry={statisticsRetry.onRetry} retrying={statisticsRetry.retrying} retryLabel={statisticsInFlight ? "重试中…" : "重试"} retryDetail={statisticsRetryError || "这次没读出这组统计，其他资料照常。"} errorTitle="首充与邀请加载失败" alertTone={statisticsGroup?.status === "ERROR" ? "danger" : "warn"} live={statisticsLive}>
      {/* 这一组的名称列按最长的「团队奖励范围内（人）」放宽（DESIGN.md 名称列按组定宽）。 */}
      <div className="m3-invite-group" aria-busy={statisticsInFlight || undefined}>{statisticsStale(false)}<Row label="首充状态" value={firstState}/><Row label="首充来源" value={firstSource}/><Row label="首充时间" value={firstConfirmed && statistics?.first.succeededAt ? dates(statistics.first.succeededAt) : "-"}/><Row label="首充金额" value={firstConfirmed && statistics?.first.amount != null && statistics.first.currency ? `${grouped(statistics.first.amount)} ${nexGridBrandText(statistics.first.currency)}` : "-"}/>
      {/* 同一个数一页只写一处（ST-74）：统计和资金两组都读到时，累计业绩额只写在账户资金里；资金组读不到时写在这里。 */}
      {profile?.finance.status === "READY" ? <div className="cvp-row"><span className="k">累计业绩额</span><span className="v"><button type="button" className="rd-link m3-profile-link" onClick={()=>open360("账户资金")}>见下方账户资金</button></span></div> : <Row label="累计业绩额" value={cumulativeText}/>}
      {countRows(false)}
      {statistics?.lifetime.map(row=>{const invited=statistics.invitations.deposits.find(item=>item.currency===row.currency)?.deposits;return <div key={row.currency}><h4>{nexGridBrandText(row.currency)} · 累计</h4>{/* 展开视图是详情，金额写完整值，币种在小标题里（TX-20、TX-21，BUG-652）；侧栏摘要卡照旧用紧凑写法。 */}<Row label="本人充值" value={statisticMoney(row.deposits, true)}/><Row label="团队成员充值" value={statisticMoney(invited, true)}/></div>;})}
      </div>
    </Group>
    <Group title="账户资金（全历史）" open={opens("账户资金（全历史）")} summary={currencies.length ? `${currencies.length} 个币种` : "暂无可信资料"} note="普通资金项按原币写；累计业绩额只算 USDT，自 2026-11-20 起。" {...groupReadProps("finance")} failed={Boolean(error)}>
      <div className="cvp-row"><span className="k">累计业绩额<Explain label="累计业绩额怎么算" content={<><p>这位客户自 2026-11-20 22:57 起的入金减提现，只算 USDT。</p><dl className="m3-perf-rows"><div><dt>购机直接付款</dt><dd>算入金，只算一次</dd></div><div><dt>退款退回余额</dt><dd>不扣；客户把钱提走时按提现扣</dd></div><div><dt>直付退到站外</dt><dd>核实后在核实的那个月扣回</dd></div></dl></>} /></span><span className="v" title={perfOfProfile.cumulative.state === "unavailable" ? perfOfProfile.cumulative.reason : undefined}>{cumulativeText}</span></div>
      {!currencies.length && <p className="m-admin-muted">尚无可信币种资金资料，累计未知。</p>}
      {financeGaps.length > 0 && <Notice tone="warn" action={!financeStale && financeGaps.some(gap => gap.state !== "FORBIDDEN") ? <Button size="sm" loading={financeRereading} loadingText="重试中…" onClick={()=>void retryGroup("finance")}>重新加载资金</Button> : undefined}>部分资金资料暂时无法确认 <Explain label="哪些项目" content={financeGaps.map(gap => <p key={gap.state}>{gap.text}</p>)}/></Notice>}
      {currencies.length > 0 && <Table label="账户资金"><thead><tr><Th>项目</Th>{currencies.map((row,i)=><Th key={String(row.currency??i)} align="right">{nexGridBrandText(String(row.currency ?? "币种未同步"))}</Th>)}</tr></thead><tbody>{Object.entries(financeLabels).map(([key,label])=><Tr key={key}><Td>{label}</Td>{currencies.map((row,i)=><Td key={String(row.currency??i)} align="right">{financeCell(row,key)}</Td>)}</Tr>)}</tbody></Table>}
    </Group>
    <Fold inset title="资金流水" {...recordFold("资金流水")} alert={Boolean(pageError.flows)} summary={pageError.flows ? "加载失败" : flowGroup?.status === "READY" ? `${show(flowGroup.data?.total)} 条` : "打开后查看"}>
      <div className="m3-profile-flow-filters"><Field label="币种"><Select aria-label="流水币种" value={currency} onChange={value=>{setCurrency(value);setFlowPage(1);}} options={[{value:"",label:"全部币种"},...currencies.map(row=>({value:String(row.currency),label:nexGridBrandText(String(row.currency ?? "币种未同步"))}))]}/></Field><Field label="状态"><Select aria-label="流水状态" value={flowStatus} onChange={value=>{setFlowStatus(value);setFlowPage(1);}} options={[{value:"",label:"全部状态"},...Object.entries(flowStatusLabels).map(([value,label])=>({value,label}))]}/></Field><Field label={`起始日期（${businessZone().label}）`}>{control=><Input {...control} type="date" value={from} onChange={e=>{setFrom(e.target.value);setFlowPage(1);}}/>}</Field><Field label={`结束日期（${businessZone().label}，不含）`}>{control=><Input {...control} type="date" value={to} onChange={e=>{setTo(e.target.value);setFlowPage(1);}}/>}</Field></div>
      {pageError.flows ? <div role="alert">{pageError.flows}<Button size="sm" onClick={()=>setPageRetry(n=>n+1)}>重试流水</Button></div> : !flowGroup ? <p role="status">正在加载流水…</p> : flowGroup.status !== "READY" ? <p>{statusText[flowGroup.status]}<Button size="sm" onClick={()=>setPageRetry(n=>n+1)}>重试流水</Button></p> : <>{!flows.length && <p>没有匹配的流水。</p>}{flows.map((r,i)=><Fold inset key={String(r.sourceId??r.id??`${r.bizNo??"flow"}:${i}`)} title={flowKindLabel(r.kind)} summary={`${nexGridBrandText(String(r.currency ?? "币种未同步"))} · ${flowStatusLabel(r.status)} · ${dates(r.createdAt)}`}><Row label="业务单号" value={r.bizNo??r.orderNo}/><Row numeric amount label="金额" value={r.principal}/><Row numeric amount label="费用" value={r.fee}/><Row numeric amount label="实际到账" value={r.net}/><Row label="创建时间" value={dates(r.createdAt)}/><Row label="完成时间" value={dates(r.completedAt)}/></Fold>)}{pager(flowPage,flowGroup.data?.total,setFlowPage)}</>}
    </Fold>
    <Group title="风险信息" open={opens("风险信息")} summary={riskLevel} note="这里只有风险等级。风险案件和账户安全明细要有对应权限的账号在用户详情里看。" {...groupReadProps("risk")} failed={Boolean(error)}><Row label="风险等级" value={riskLevel}/>{profile?.risk.data?.serviceExplanation ? <div className="m3-profile-explanation"><span>服务说明</span><p>{show(profile.risk.data.serviceExplanation)}</p></div> : <Row label="服务说明" value={null}/>}<Row label="评估时间" value={dates(profile?.risk.data?.evaluatedAt)}/></Group>
    {view360 && paymentSecurityPort && <PaymentSecurityBlock key={`${paymentScope}|modal|${paymentSecurityPort.key}`} port={paymentSecurityPort} reloadKey={profileScope} userLabel={paymentUserLabel} canRelease={canReleasePayment} writeBlockedReason={invitationWriteBlock} onWriteBusy={setPaymentWriteBusy} retryMissingRelease />}
    <Fold inset title="设备信息" explain={deviceScope} {...recordFold("设备信息")} alert={Boolean(pageError.devices)} summary={pageError.devices ? "加载失败" : devicesRead ? `持有 ${heldDevices} 台 · 在网 ${compactSupportBoardValue(deviceGroup?.data?.onlineCount, "count")} 台` : deviceGroup ? statusText[deviceGroup.status] : "正在加载…"}>{pageError.devices ? <div role="alert">{pageError.devices}<Button size="sm" onClick={()=>setPageRetry(n=>n+1)}>重试设备</Button></div> : !deviceGroup ? <p role="status">正在加载设备…</p> : deviceGroup.status !== "READY" ? <p>{statusText[deviceGroup.status]}<Button size="sm" onClick={()=>setPageRetry(n=>n+1)}>重试设备</Button></p> : <><Row numeric="count" label="持有设备" value={deviceStatuses?.heldCount==="READY"?deviceGroup.data?.heldCount:null}/><Row numeric="count" label="在网设备" value={deviceGroup.data?.onlineCount}/><Row numeric label="实际总算力" value={deviceGroup.data?.hashrateTotal}/><p className="m-admin-muted">设备记录（含历史）</p>{!devices.length&&<p>没有设备记录。</p>}{devices.map((r,i)=><Fold inset key={String(r.id??i)} title={show(r.name)} summary={show(r.instanceNo)}><Row label="在网情况" value={labelState(r.runtimeStatus)}/><Row numeric label="实际算力" value={r.hashrate}/><Row numeric amount label="实际收益" value={r.dailyUsdt}/><Row label="最近心跳" value={dates(r.heartbeatAt)}/><Row label="激活时间" value={dates(r.activatedAt)}/></Fold>)}{pager(devicePage,deviceGroup.data?.total,setDevicePage)}</>}</Fold>
    <Group title="标签与内部备注" {...recordFold("标签与内部备注")} summary={`${tags.length} 个标签 · ${asRows(annotations?.notes).length} 条备注`} {...groupReadProps("annotations")} failed={Boolean(error)}
      available={(annotations || systemTags?.length) ? <><p className="rd-form-group-title">系统标签（只读）</p><div className="m3-profile-tags">{systemTags?.map(t=><span key={String(t)}>{show(t)}</span>)}</div></> : undefined}>
      {/* 资料重读期间标签和备注都不能改：原因在这一组顶上常显一次（OP-126）；有更优先的原因（不能写、正在保存、上次刷新失败）时不写。 */}
      {writable && !writing && !annotationsStale && invitationWriteBlock && <p className="rd-toolbar-note">{invitationWriteBlock}</p>}
      {/* 已保存、正在读回最新资料：编辑入口都禁用着，原因在这里常显一次（OP-126，R25）。 */}
      {writable && readingBack && <p className="rd-toolbar-note">保存后正在读取最新资料，读完再编辑</p>}
      <p className="rd-form-group-title">自定义标签</p><div className="m3-profile-tags">{Array.isArray(annotations?.customTags)&&annotations.customTags.map(t=><span key={String(t)}>{show(t)} {!readOnlyAnnotations && <IconButton aria-label={`删除标签 ${show(t)}`} disabled={!writable||writing||annotationsStale} disabledReason={writable && !writing && !annotationsStale ? invitationWriteBlock : undefined} onClick={()=>void annotate(id=>ctx.removeCustomerTag(id,String(t)),()=>{})}><Icon name="x" size={12}/></IconButton>}</span>)}</div>
      {writable&&<div className="m3-profile-editor"><Field label="新标签">{control=><Input {...control} value={tag} maxLength={30} disabled={!writable||writing||statisticsRetrying||annotationsStale} onChange={e=>setTag(e.target.value)}/>}</Field><Button size="sm" disabled={!writable||writing||annotationsStale||!tag.trim()} disabledReason={writable && !writing && !annotationsStale && tag.trim() ? invitationWriteBlock : undefined} onClick={()=>void annotate(id=>ctx.addCustomerTag(id,tag.trim()),()=>setTag(""))}>添加标签</Button></div>}
      {asRows(annotations?.notes).length === 0 ? <p className="m-admin-muted">暂无内部备注。</p> : <Timeline label="内部备注" entries={asRows(annotations?.notes).map((r,i) => ({
        id: String(r.id ?? i), actor: show(r.authorName ?? r.author), at: String(r.createdAt ?? ""),
        action: <div className="m3-profile-note-event"><span className="rd-pre">{show(r.text)}</span>{!readOnlyAnnotations && <Button size="sm" disabled={!writable||writing||annotationsStale} disabledReason={writable && !writing && !annotationsStale ? invitationWriteBlock : undefined} onClick={()=>ctx.openActionConfirm({action:"删除内部备注",briefKind:"note-delete",detail:"删除后这条备注不再显示。",facts:<Facts><Fact k="客户">{userNicknameText(show(identity?.nickname), identity?.phoneMasked)}</Fact><Fact k="备注内容">{show(r.text)}</Fact></Facts>,effect:<><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag/></>,confirmLabel:"确认删除备注",confirmTone:"danger",reasonMin:8,reasonMax:200,run:async(reason)=>{let failure="";if(!await annotate(id=>ctx.removeCustomerNote(id,String(r.id),reason,message=>{failure=message;}),()=>{},true))throw new Error(failure||"备注没有删除成功，请核对客户归属和原备注。");return true;}})}>删除备注</Button>}</div>,
      }))} />}
      {writable&&<div className="m3-profile-editor"><Field label="新内部备注">{control=><Textarea {...control} value={note} maxLength={1000} disabled={!writable||writing||statisticsRetrying||annotationsStale} onChange={e=>setNote(e.target.value)}/>}</Field><Button size="sm" disabled={!writable||writing||annotationsStale||!note.trim()} disabledReason={writable && !writing && !annotationsStale && note.trim() ? invitationWriteBlock : undefined} onClick={()=>void annotate(id=>ctx.addCustomerNote(id,note.trim()),()=>setNote(""))}>保存备注</Button></div>}
      {!writable&&<p className="m-admin-muted">只读 <Explain label="谁能修改标签和备注" content={conversation ? "只有这位客户当前的专属客服能改，客服主管审阅时只读。" : "还没有服务会话，标签和备注只读。发出第一条消息后，专属客服就能修改。"}/></p>}{writeError&&<p role="alert">{writeError}</p>}
    </Group>
    <Group title="服务与维护" open={opens("服务与维护")} summary={advisorName ? `当前专属客服 ${String(advisorName)}` : "暂无专属客服"} {...groupReadProps("service")} failed={Boolean(error)}>
      <div className="cvp-row"><span className="k">当前专属客服</span><span className="v m3-profile-advisor"><SupportAvatar name={String(advisorName??"专属客服")} size={22} path={advisorId&&service?.advisorAvatar?advisorAvatarPath(advisorId,customerId):undefined} version={typeof (service?.advisorAvatar as Record<string,unknown>|undefined)?.version==="number"?(service?.advisorAvatar as {version:number}).version:undefined}/>{show(advisorName)}</span></div><Row label="归属状态" value={labelState(service?.assignmentState)}/>{assignmentSource && <Row label="绑定来源" value={assignmentSource}/>}<Row label="会话状态" value={service?.conversationCount===0?"暂无会话":labelState(serviceConversationStatus)}/><Row label="账户活动" value={labelState(service?.activityStatus)}/><Row label="主动维护" value={service?.maintenanceEnabled==null?"未知":service.maintenanceEnabled?"正常维护":"不再维护"}/><Row label="有效活动" value={dates(service?.lastEffectiveAt)}/><Row label="下次维护" value={dates(service?.nextMaintenanceAt)}/><Row label="最近服务" value={dates(lastServiceAt)}/><Row label="首次待联系" value={service?.firstContact}/><Row label="待专属客服回复" value={waitingReply}/>
      {transferEntry && <div className="m3-profile-actions"><a className="rd-btn" data-variant="secondary" data-size="sm" href={`/service/overview?customerId=${customerId}&action=transfer`}><span className="rd-btn-face">维护状态与正式转绑</span></a></div>}
    </Group>
    <Fold inset title="最近服务记录" {...recordFold("最近服务记录")} summary={conversation?.detailReady ? `最近 ${Math.min(4, conversation.messages.length)} 条` : "打开后查看"}>
      {!conversation ? <p>{profile?.service.status === "READY" && service?.conversationCount === 0 ? "暂无服务记录。" : "尚未打开服务会话，可从历史会话查看记录。"}</p>
        : !conversation.detailReady ? <p role={messageError ? "alert" : "status"}>{messageError ? `服务记录加载失败：${messageError}` : "正在加载服务记录…"}{messageError && <Button size="sm" onClick={onRetryMessages}>重试服务记录</Button>}</p>
        : <Timeline label="最近服务记录" entries={conversation.messages.slice(-4).map((message,index) => ({
          id: String(message.id ?? index),
          actor: message.sourceSenderType === "SYSTEM" || message.sourceSenderType === "INTERNAL" ? "系统" : message.sender === "agent" ? message.agentName || "历史专属客服" : conversation.customer || "客户",
          at: Number.isFinite(message.ts) && message.ts > 0 ? new Date(message.ts).toISOString() : "",
          action: <span className="rd-pre">{message.kind === "IMAGE" ? "[图片]" : message.text || "服务记录无正文"}</span>,
          detail: message.authorConfidence !== "VERIFIED" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" ? "作者身份未确认" : undefined,
        }))} />}
    </Fold>
    <Fold inset title="维护记录" {...recordFold("维护记录")} alert={Boolean(maintenanceError)} summary={maintenanceError ? "加载失败" : maintenance ? `执行 ${maintenance.totalExecutions} 次` : "正在加载…"}>
      {maintenanceError ? <p role="alert">{maintenanceError}<Button size="sm" onClick={()=>setReload(n=>n+1)}>重试维护记录</Button></p> : !maintenance ? <p>正在加载…</p> : <>
        <Row numeric="count" label="维护执行次数" value={maintenance.totalExecutions}/><Row numeric="count" label="维护周期总数" value={maintenance.totalCycles}/>
        <Timeline label="维护记录" entries={[
          ...maintenance.executions.map(r => ({ id: `execution:${r.id}`, action: "人工联系", actor: "操作人未提供", at: r.occurredAt })),
          ...maintenance.cycles.map(r => ({ id: `cycle:${r.id}`, action: "维护周期开启", actor: "系统", at: r.occurredAt,
            detail: r.state === "SUCCEEDED" ? "成功周期" : r.state === "OPEN" ? "等待新的有效活动" : r.state === "STOPPED" ? "已停止" : r.state === "TRANSFERRED" ? "已正式转绑" : "未知", tone: r.state === "OPEN" ? "warn" as const : undefined })),
        ]} />
        {pager(maintenancePage,Math.max(maintenance.totalCycles,maintenance.totalExecutions),setMaintenancePage,10,false)}
      </>}
    </Fold>
    <Fold inset title="历史会话" explain="只显示你有权查看的。总数按这位客户的全部会话算。" {...recordFold("历史会话")} summary={typeof service?.conversationCount === "number" && service.conversationCount !== history.length ? `可看 ${history.length} / 共 ${service.conversationCount}` : `${history.length} 段`}>
      <RecordList label="历史会话" records={history.slice((historyPage-1)*5,historyPage*5).map(c => ({ id: c.id,
        value: <Button size="sm" onClick={()=>{setView360(false);onHistory(c.id);}}>{c.status === "open" ? "进行中" : "已结束"}</Button>,
        object: c.owner, at: Number.isFinite(c.lastTs) && c.lastTs > 0 ? new Date(c.lastTs).toISOString() : undefined, reference: c.id,
      }))} />
      {pager(historyPage,history.length,setHistoryPage,5)}
    </Fold>
    {accountEntry && <Fold inset title="账户操作" defaultOpen={opens("账户操作")} summary={hasAccountEntry ? `${accountActions.length + accountLinks.length} 项可用` : "这个账号不能办"}>
      {accountLinks.length > 0 && <div className="m3-profile-actions">
        {accountLinks.map(([label,anchor])=><a key={anchor} className="rd-btn" data-variant="secondary" data-size="sm" href={`/users/search/${encodeURIComponent(customerId)}#${anchor}`}><span className="rd-btn-face">{label}</span></a>)}
      </div>}
      {accountActions.length > 0 && <div className="m3-profile-actions">
        {accountActions.map(([key,label,path])=><a key={key} className="rd-btn" data-variant={key === "freeze" ? "danger-outline" : "secondary"} data-size="sm" href={`${path}?userCode=${encodeURIComponent(String(identity?.userNo))}&userId=${encodeURIComponent(customerId)}${path==="/users/actions"?`&source=${source}`:""}&returnTo=${encodeURIComponent("/service/sessions?customerId="+customerId)}`}><span className="rd-btn-face">{label}</span></a>)}
      </div>}
      {!canResetPassword && <p className="m-admin-muted">{passwordHelp}</p>}
      {accountActions.length < 3 && <p className="m-admin-muted">{accountHelp}</p>}
    </Fold>}
    <small>资料更新时间：{dates(profile?.identity.evaluatedAt)}</small>
    </>}
  </div>;
  return <div className="m3-customer-sidebar">
    <header className="m3-profile-identity"><SupportAvatar name={userNicknameText(String(identity?.nickname ?? "客户"), identity?.phoneMasked)} path={identity?.avatar ? customerAvatarPath(customerId) : undefined} size={44}/><div><h3 className="m3-profile-name" title={userNicknameText(show(identity?.nickname), identity?.phoneMasked)}><span className="m3-profile-nick">{identity?.nickname == null ? "客户资料不完整" : userNicknameText(show(identity.nickname), identity?.phoneMasked)}</span>{levelSummary && <span className="m3-profile-level">{levelSummary}</span>}</h3><p className="m3-profile-meta"><span className="m3-profile-uid">用户编码 <span className="m-user-code">{identity?.userNo == null ? EMPTY : show(identity.userNo)}</span></span>{advisorName && <span className="m3-profile-owner">当前专属客服 {String(advisorName)}</span>}{inviter && <span className="m3-profile-owner m3-profile-inviter">邀请人 <InviterValue view={inviter} /></span>}</p></div></header>
    {!scopeDenied && <div className="m3-profile-entries"><Button size="sm" onClick={()=>open360()}>在本页展开资料</Button><a className="rd-btn m3-profile-full" data-variant="secondary" data-size="sm" href={`/service/customers/${encodeURIComponent(customerId)}${profileSearch ? `?${profileSearch}` : ""}`}><span className="rd-btn-face">查看完整客户档案</span></a></div>}
    {view360 && <Modal title="客户资料全部分组" icon="users" wide onClose={()=>setView360(false)} footer={<Button onClick={()=>setView360(false)}>返回会话</Button>}>{body}</Modal>}
    <div className="m3-profile-body" hidden={view360}>
      {profileFailed ? <BlockState state="error" compact title="客户资料加载失败" detail={error} onRetry={retryProfile} retryLabel="重试" />
        : error && <div className="m3-profile-state" role="alert">{error}<button type="button" className="m3-profile-link" onClick={retryProfile}>重新加载资料</button></div>}
      {!scopeDenied && <>
        {!profileFailed && summaryState("identity")}
        {!view360 && paymentSecurityPort && <PaymentSecurityBlock key={`${paymentScope}|sidebar|${paymentSecurityPort.key}`} port={paymentSecurityPort} reloadKey={profileScope} userLabel={paymentUserLabel} canRelease={canReleasePayment} writeBlockedReason={invitationWriteBlock} onWriteBusy={setPaymentWriteBusy} retryMissingRelease />}
        {!profileFailed && <>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>风险研判<Explain label="风险研判的说明" content="这里只有风险等级。风险案件和账户安全明细要有对应权限的账号在用户详情里看。"/></h4>{detailLink("风险信息")}</div>{summaryState("risk")}{profile?.risk.status === "READY" && <div className="m3-profile-risk" data-tone={riskLevel === "低风险" ? "low" : riskLevel === "中风险" ? "medium" : riskLevel === "高风险" ? "high" : "unknown"}><span>{riskLevel}</span><p>{typeof risk?.serviceExplanation === "string" && risk.serviceExplanation ? risk.serviceExplanation : `评估时间 ${dates(risk?.evaluatedAt)}`}</p></div>}</section>
        <section className="m3-profile-section" data-counts-scope=""><div className="m3-profile-heading"><h4>资金概览</h4><div>{currencies.length > 1 ? <div className="m3-profile-currency"><Select aria-label="资金摘要币种" value={String(summaryFinance?.currency)} onChange={setSummaryCurrency} options={currencies.map(row=>({value:String(row.currency),label:nexGridBrandText(String(row.currency))}))}/></div> : <span>{summaryFinance?.currency == null ? "币种未同步" : summaryUnit}</span>}{detailLink("账户资金")}</div></div>{summaryState("finance", financeFocus.arm)}<div className="m3-profile-funds">{[["balance", "当前余额"], ["creditedDepositTotal", "累计成功充值"], ["successfulWithdrawalPrincipalTotal", "累计成功提现金额"]].map(([key,label])=><button type="button" key={key} onClick={()=>open360("账户资金")} title={exactMoney(key) === EMPTY ? `${label}暂无法确认` : `${label} ${exactMoney(key)} ${summaryUnit}`}><span>{label}</span><strong data-empty={exactMoney(key) === EMPTY || Number(summaryFinance?.[key]) === 0 ? "" : undefined}>{exactMoney(key)}{exactMoney(key) !== EMPTY && <small>{summaryUnit}</small>}{summaryStatuses?.[key] === "PARTIAL" && exactMoney(key) !== EMPTY && <small>部分统计</small>}</strong></button>)}</div>{summaryStatuses && Object.values(summaryStatuses).some(status=>status === "ERROR" || status === "UNKNOWN" || status === "FORBIDDEN") && <p className="m3-profile-state" data-tone="warn">部分资金资料暂时无法确认。{!financeStale && <button type="button" className="m3-profile-link" aria-disabled={financeRereading || undefined} aria-busy={financeRereading || undefined} onClick={financeRereading ? undefined : () => void retryGroup("finance", financeFocus.arm)}>{financeRereading ? "重试中…" : "重新加载资金"}</button>}</p>}</section>
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>客户标签</h4>{detailLink("标签与内部备注", readOnlyAnnotations ? "查看" : "管理")}</div>{annotationsRetained && annotationState}{(!annotationState || tags.length > 0) && <div className="m3-profile-tags">{tags.length ? tags.map((tag,index)=><span key={`${tag}:${index}`}>{tag}</span>) : <p className="m3-profile-state">暂无标签。</p>}</div>}{!annotationsRetained && annotationState}{profile?.annotations.status === "READY" && <><div className="m3-profile-heading"><h4>最新内部备注</h4>{detailLink("标签与内部备注", readOnlyAnnotations ? "查看" : "管理")}</div>{latestNote ? <p className="m3-profile-note" title={show(latestNote.text)}>{show(latestNote.text)}</p> : <p className="m3-profile-state">暂无内部备注。</p>}</>}</section>
        </>}
        <Fold inset title="账户与设备" explain={<><p>{deviceScope}</p><p>时间为{businessZone().label}。</p></>} actions={detailLink("设备信息")} alert={Boolean(pageError.devices)||deviceGroup?.status==="ERROR"} summary={pageError.devices ? "设备读取失败" : devicesRead ? `在网 ${compactSupportBoardValue(deviceGroup?.data?.onlineCount, "count")} / 持有 ${heldDevices} 台` : deviceGroup ? statusText[deviceGroup.status] : "正在加载设备…"}>{pageError.devices ? <p className="m3-profile-state" role="alert">{pageError.devices}<button type="button" className="m3-profile-link" onClick={()=>setPageRetry(n=>n+1)}>重试设备</button></p> : !deviceGroup || deviceGroup.status !== "READY" ? <p className="m3-profile-state">{deviceGroup ? statusText[deviceGroup.status] : "正在加载设备…"}<button type="button" className="m3-profile-link" onClick={()=>setPageRetry(n=>n+1)}>重新加载</button></p> : <><Row label="持有设备" value={heldDevices}/><Row label="在网设备" value={compactSupportBoardValue(deviceGroup.data?.onlineCount, "count")}/><Row label="实际总算力" value={show(deviceGroup.data?.hashrateTotal)}/></>}{!profileFailed && <><Row label="地区" value={identity?.region}/><Row label="脱敏手机号" value={identity?.phoneMasked}/><Row label="注册时间" value={dates(identity?.registeredAt)}/><Row label="最近登录" value={dates(identity?.lastLoginAt)}/><Row label="最近有效活动" value={dates(service?.lastEffectiveAt)}/></>}</Fold>
        {!profileFailed && (statisticsGroup?.status === "FORBIDDEN" ? <DeniedRow title="首充与邀请" /> : <Fold inset title="首充与邀请" actions={detailLink("首充与邀请统计")} alert={statisticsGroup?.status === "ERROR" || !!countsHead || statisticsSummaryStale} alertTone={statisticsGroup?.status === "ERROR" ? "danger" : "warn"} summary={statisticsGroup?.status === "READY" ? statisticsSummaryStale ? "刷新失败" : countsHead || `首充：${firstState}` : statisticsGroup ? statusText[statisticsGroup.status] : "正在加载…"}>{statisticsState ?? <div className="m3-invite-group" aria-busy={statisticsInFlight || undefined}>{statisticsStale(true)}<Row label="首充状态" value={firstState}/>{countRows(true)}<Row label={`邀请累充（${nexGridBrandText(summaryCurrency)}）`} value={statisticMoney(statistics?.invitations.deposits.find(row=>row.currency===summaryCurrency)?.deposits, true)}/><Row label="账户活跃" value={statistics?.activity.status === "AVAILABLE" ? statistics.activity.state === "ACTIVE" ? "活跃" : statistics.activity.state === "INACTIVE" ? "近期未活跃" : EMPTY : EMPTY}/></div>}{statisticsLive}</Fold>)}
        <section className="m3-profile-section"><div className="m3-profile-heading"><h4>快捷操作</h4></div><nav className="m3-profile-shortcuts" aria-label="客户快捷入口">{([["历史会话","历史会话","clock",undefined],["重置密码","账户操作","lock",canResetPassword?undefined:passwordHelp],["账户操作","账户操作","wallet",hasAccountEntry?undefined:accountHelp],[readOnlyAnnotations?"查看备注":"添加备注","标签与内部备注","doc",undefined]] as const).filter(([,section]) => accountEntry || section !== "账户操作").map(([label,section,icon,blocked])=><Button key={label} aria-label={`打开客户资料查看${label}`} disabledReason={blocked} onClick={()=>open360(section)}><span aria-hidden="true"><Icon name={icon} size={15}/></span>{label}</Button>)}</nav>{accountEntry && (!canResetPassword || !hasAccountEntry) && <p className="m3-profile-state">账户操作受限 <Explain label="账户操作受限的说明" content={!canResetPassword && !hasAccountEntry ? "这个账号不能重置密码和办账户操作，把鼠标放到按钮上看谁能办。" : !canResetPassword ? "这个账号不能重置密码，把鼠标放到按钮上看谁能办。" : "这个账号不能办账户操作，把鼠标放到按钮上看谁能办。"} /></p>}</section>
      </>}
    </div>
  </div>;
}
