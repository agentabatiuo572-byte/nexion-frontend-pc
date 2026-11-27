"use client";

/**
 * 免费试用设置 ·「可购买设备」分区（PLAN 第三节，画板 01–11）：用户除了自己领的试用设备，还能用试用抵扣金买哪些设备。
 * 后台只保存「其他可购买设备」；读取结果里没有这块数据时整块不显示，页面和以前一样。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { CircleDot, Coins, Eye, EyeOff, Info, Package, PackageX, Plus, SlidersHorizontal, X } from "lucide-react";
import { BlockState, Button, Cell, Check, CheckGroup, ConfigList, ConfigRow, Decision, DiffList, Drawer, Explain, Fact, Facts, KeepText, Notice, Panel, StatusTag, Table, TableMessage, Td, Th, type DiffRow } from "@/app/components/rd";
import { TipSide } from "@/app/components/rd/button";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ConfirmReadConflict } from "@/lib/admin/h-conflict-review";
import type { updateH2TrialBuyList } from "@/lib/admin/h-client";
import { buyProductReason, changedGroups, FOLLOW_ALL, LISTING_BLOCKED, readH2BuyDevices, type BuyDevice, type BuyList, type BuyListWrite, type BuyPricing, type BuyPricingItem } from "@/lib/admin/h2-trial-purchase";
import { isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { useReach } from "@/lib/nav/use-reach";
import type { HCtx } from "./types";
import { useNavigationLeaveGuard } from "../i-tabs/i5-writes";
import { customText, defaultDiscount, defaultEarly, editErrors, editFrom, GROUP_NAME, groupAfter, groupBefore, PricingCell, PricingEditor, PricingGroups, PricingHeadExplain, pricingLine, pricingOf, type PricingDefaults, type PricingEdit, type PricingField } from "./h2-trial-pricing";

export type BuyListDraft = Pick<BuyListWrite, "version" | "reason"> & {
  productNos: string[];
  /** Present only when the original wire request sends items. */
  items?: BuyPricingItem[];
  added: string[];
  removed: string[];
  nextNames: string[];
  // Local-only baseline for reviewing a rejected replay. Older pending writes lack it.
  review?: { before: BuyDevice[]; added: BuyDevice[] };
  /** 待确认条和技术信息的文字，按提交时的默认值写好存下。 */
  priced?: BuyPricingDraft;
};

type BuyPricingDraft = { changed: string[]; lines: string[] };

export type BuyListPending = PendingMutationRecord & BuyListDraft & Pick<BuyListWrite, "requestNo" | "confirmedActorId">;
export type BuyListSubmitResult = Exclude<Awaited<ReturnType<typeof updateH2TrialBuyList>>, { kind: "unauthenticated" | "forbidden" | "accountMismatch" }>
  | { kind: "stopped" };

export const BUY_INTRO = "用户领的那台试用设备自动在他的清单里，不用添加；这里添加其他可以用试用抵扣金购买的设备。";
const MONEY_LINE = "减价后的价格低于试用抵扣金时，抵不完的购后到账给用户。";
/** 这一项（清单或参数）有一次修改结果未知时，「调整」和提交的禁用原因。 */
export const EDIT_LOCKED = "这项有一次修改结果未知，先到页面上方处理";
export const UNKNOWN_TOAST = "结果未知，不要重复操作，到页面上方处理。";
export const BUY_SAVED = "其他可购买设备 已更新";
const NO_CHANGES = "勾选和现在一样，没有要保存的改动";
const INVALID_PICKED = "请先取消不能新增的设备";
export const BUY_CONFLICT = "这份清单刚被别人改过，这次没有保存";
export const BUY_READ_INVALID = "收到的数据不完整，已停止显示。";
export const BUY_READ_FIRST = "请先读取最新";
const ROW_HELP = {
  what: "用户还能用试用抵扣金买的设备，每次试用限购一款",
  where: "App 试用详情 ›「专享限时折扣设备」",
  when: "立即生效，之后发起的购买按新清单，进行中的试用也一样",
  effect: "缺货或用户不符合购买条件时不能选；移除后不能再用试用抵扣金买它，领了这款的用户不受影响",
};
const TARGET_TIP = "勾上后，领了别款的用户也能用试用抵扣金买它";
/** 有「支持按设备优惠」标识时换用的文字；没有标识时页面和以前完全一样（PLAN 三.8）。 */
const PRICED = {
  money: "折扣后的价格低于试用抵扣金时，抵不完的购后到账给用户。",
  when: "立即生效，之后发起的购买按新清单和新优惠，进行中的试用也一样",
  effect: "缺货或用户不符合购买条件时不能选；移除后不能再用试用抵扣金买它，它的单独优惠一起删除；领了这款试用的用户不受影响",
  targetTip: "勾上后，领了别款的用户也能用试用抵扣金买它。领它试用的用户买它仍按默认；领别款的用户买它才用这里的设置。",
  noChanges: "清单和优惠都和现在一样，没有要保存的改动",
  impact: "之后发起的购买按新清单和新优惠，进行中的试用也一样",
  check: "正在结算的用户：本单适用的优惠变了，提交时要重新确认；已创建的外部付款按原报价支付。前后清单和每款优惠记入操作记录。",
  conflictAux: "读取最新后核对改动，理由要重填。",
};
const invalidText = (count: number) => `有 ${count} 处要改正，改好后才能下一步`;
/** 离开提示里没有「下一步」：写回到编辑去改（OP-126）。 */
const leaveInvalidText = (count: number) => `有 ${count} 处要改正，回到编辑改好后才能保存`;

const priceNumber = (device: BuyDevice) => device.priceUsdt === null ? Infinity : Number(device.priceUsdt);
const byPrice = <T extends BuyDevice>(list: readonly T[]) => [...list].sort((a, b) => priceNumber(a) - priceNumber(b));
/** 金额带千分位，不舍入，不补零（TX-20）。 */
const price = (device: BuyDevice) => device.priceUsdt === null ? "—" : Number(device.priceUsdt).toLocaleString("en-US", { maximumFractionDigits: 6 });
const typeText = (device: BuyDevice) => device.productType === "SHARE" ? "云份额"
  : device.productType === "DEVICE" || device.productType === "SERVER" ? "实体设备" : "—";
const stockText = (device: BuyDevice) => device.inventoryMode === "UNLIMITED" ? "不限"
  : device.stock === null ? "—" : device.stock.toLocaleString("en-US");
const hiddenText = (device: BuyDevice) => buyProductReason(device.unavailableReason, device.status);
const retainedHint = (device: BuyDevice) => {
  const reason = `${hiddenText(device).replace(/^商城/, "")}，App 不显示；`;
  if (device.unavailableReason === "PRODUCT_TYPE_UNSUPPORTED") return `${reason}不会再显示，可以移除`;
  const when = device.unavailableReason !== "PRODUCT_NOT_AVAILABLE" ? hiddenText(device) === LISTING_BLOCKED ? "通过" : "符合条件"
    : device.status === "PENDING" ? "上架" : device.status === "OFF_SALE" ? "重新上架" : "符合条件";
  return `${reason}可以保留，${when}后自动显示`;
};
const productName = (device: BuyDevice) => device.name || device.productNo;

export function buyListRejection(outcome: Extract<BuyListSubmitResult, { kind: "rejected" }>, base: BuyDevice[], candidates: BuyDevice[]) {
  const retained = base.find((item) => item.productNo === outcome.productNo);
  const refused = retained ?? candidates.find((item) => item.productNo === outcome.productNo);
  if (!refused) return outcome.message;
  return `没有保存：${productName(refused)}：${buyProductReason(outcome.reason, refused.status)}，${retained ? "不能改优惠" : "不能新增"}。`;
}

/** 配置行的值：数量写正文，不用处理的状态写次文字（PLAN R7）。 */
function listValue(items: readonly BuyDevice[]) {
  if (items.length === 0) return { value: "未添加", sub: "" };
  const hidden = items.filter((item) => item.appState === "hidden").length;
  const soldOut = items.filter((item) => item.appState === "soldOut").length;
  return { value: `${items.length} 款`, sub: [hidden && `${hidden} 款 App 不显示`, soldOut && `${soldOut} 款售罄`].filter(Boolean).join(" · ") };
}

function AppState({ device }: { device: BuyDevice }) {
  if (device.appState === "hidden") return <Cell main={<span className="h2-buy-state"><StatusTag tone="neutral" icon={EyeOff}>App 不显示</StatusTag></span>} sub={hiddenText(device)} />;
  if (device.appState === "soldOut") return <Cell main={<span className="h2-buy-state"><StatusTag tone="neutral" icon={PackageX}>售罄</StatusTag></span>} sub="App 显示为缺货" />;
  return <Cell main={<span className="h2-buy-state"><StatusTag tone="neutral" icon={Eye}>显示</StatusTag></span>} />;
}

export function BuyListPendingNotice({ record, canWrite, onRetry, onRelease, retrying, auditLink }: {
  record: BuyListPending;
  canWrite: boolean;
  onRetry: () => void;
  onRelease: () => void;
  retrying: boolean;
  auditLink?: ReactNode;
}) {
  const [, refreshDeadline] = useState(0);
  const expired = isRetryExpired(record);
  useEffect(() => {
    if (expired) return;
    const timer = setTimeout(() => refreshDeadline((current) => current + 1), Math.max(1, record.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [expired, record.expiresAt]);
  const rejection = record.replayRejection;
  const priced = record.items ? record.priced : undefined;
  const op = [record.added.length > 0 && `新增 ${record.added.join("、")}`, record.removed.length > 0 && `移除 ${record.removed.join("、")}`,
    !!priced?.changed.length && `改优惠 ${priced.changed.join("、")}`].filter(Boolean).join(" · ");
  return (
    <Notice tone="warn" title="调整其他可购买设备 · 结果未知"
      action={canWrite && (rejection
        ? <Button size="sm" onClick={onRelease}>核实后解除</Button>
        : !expired && <Button size="sm" disabled={retrying} onClick={onRetry}>按原操作重试</Button>)}>
      {op && <span className="h2-pending-op">{op}</span>}
      {formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，
      <KeepText text="可能已经生效，重试成功或核对清楚前，这项不能再改。" />
      <KeepText text={expired ? " 已超过 24 小时，不能再重试，请到操作记录与审批核对。" : !canWrite ? " 这个账号已没有这项权限，不能重试。" : rejection ? " 请核对原操作的结果再解除。" : " 按原操作重试不会重复执行。"} />
      {auditLink && <> {auditLink}</>}
      <Explain label="技术信息" side="bottom" align="end" rows={[
        { k: "操作编号", v: <span data-mono="" className="h2-nowrap">{record.commandKey}</span> },
        { k: "改后清单", v: record.nextNames.length > 0 ? record.nextNames.join("、") : "空" },
        ...(priced?.lines.length ? [{ k: "优惠变化", v: <span className="h2-others-note">{priced.lines.map((line) => <span key={line}>{line}</span>)}</span> }] : []),
        { k: "理由", v: record.reason },
      ]} />
      {rejection && <div><KeepText text={`重试被拒：${rejection}`} /></div>}
    </Notice>
  );
}

/** 抽屉里的内容或按钮被换掉、焦点落空时，放回抽屉容器（OP-46、CP-66）。 */
function refocusDrawer() {
  if (document.activeElement === document.body) document.querySelector<HTMLElement>("[data-h2-buy-drawer]")?.focus();
}

/** 版本冲突读到最新后，别人改了什么写在同一个框里（OP-97）。 */
function changedByOthers(before: BuyDevice[], latest: BuyDevice[]) {
  const names = (from: BuyDevice[], against: BuyDevice[]) => from
    .filter((item) => !against.some((other) => other.productNo === item.productNo)).map(productName).join("、");
  const added = names(latest, before);
  const removed = names(before, latest);
  return added || removed ? `别人已改：${[added && `新增 ${added}`, removed && `移除 ${removed}`].filter(Boolean).join("，")}` : undefined;
}

/** 读取最新后，说明保留的优惠改动、已改成同值的优惠，以及本次无法保存的逐款优惠（OP-97、D8）。 */
function othersPricing(before: BuyDevice[], latest: BuyDevice[], mine: ReadonlyMap<string, ReturnType<typeof changedGroups>>, selected: ReadonlySet<string>, defaults: PricingDefaults, noChanges: boolean): ReactNode[] {
  const old = new Map(before.map((item) => [item.productNo, item]));
  const changed = latest.flatMap((item) => {
    const prior = old.get(item.productNo);
    if (!prior || !selected.has(item.productNo)) return [];
    const current = item.pricing ?? FOLLOW_ALL;
    const groups = changedGroups(prior.pricing ?? FOLLOW_ALL, current);
    const edited = mine.get(item.productNo) ?? [];
    const kept = groups.filter((group) => !item.selectable || !edited.includes(group));
    // 仍可编辑的组已应用草稿；重比没有改动时，双方编辑过的同组已是拟改值。
    const matched = noChanges && item.selectable ? groups.filter((group) => edited.includes(group)) : [];
    const notes = matched.map((group) => (
      <Notice key={`matched-${item.productNo}:${group}`} tone="neutral">
        <KeepText text={`${productName(item)} 的${GROUP_NAME[group]}已被改成 ${groupAfter(current, group, defaults).full}，和你要改的一样`} />
      </Notice>
    ));
    if (kept.length) notes.push(
      <Notice key={item.productNo} tone="neutral" title={`${productName(item)} 刚被别人改过，保存时保留`}>
        <span className="h2-others-note">{kept.map((group) => <span key={group}>{GROUP_NAME[group]}改为 {groupAfter(current, group, defaults).full}</span>)}</span>
      </Notice>
    );
    return notes;
  });
  const gone = [...mine.keys()].filter((no) => old.has(no) && !latest.some((item) => item.productNo === no))
    .map((no) => <Notice key={`gone-${no}`} tone="neutral"><KeepText text={`${productName(old.get(no)!)} 已被移除，这次不保存它的优惠；要加回请重新选择`} /></Notice>);
  const locked = latest.filter((item) => !item.selectable && mine.has(item.productNo)).map((item) => (
    <Notice key={`locked-${item.productNo}`} tone="neutral">
      <KeepText text={`${productName(item)} ${item.status === "OFF_SALE" ? "已下架" : hiddenText(item)}，这次对它的优惠改动不保存`} />
    </Notice>
  ));
  return [...changed, ...gone, ...locked];
}

function buyChoices(list: BuyList | undefined) {
  const items = list ? byPrice(list.items) : [];
  const candidates = list ? byPrice([
    ...list.candidates,
    // Keep configured products that the catalogue no longer offers for addition.
    ...items.filter((item) => !list.candidates.some((candidate) => candidate.productNo === item.productNo))
      .map((item) => ({ ...item, selectable: false })),
  ]) : [];
  return { items, candidates };
}

function rebaseSelection(latest: BuyList, added: BuyDevice[], removed: BuyDevice[]) {
  const removedNos = new Set(removed.map((item) => item.productNo));
  const selection = new Set(latest.items.filter((item) => !removedNos.has(item.productNo)).map((item) => item.productNo));
  const known = new Set([...latest.items, ...latest.candidates].map((item) => item.productNo));
  const missing = added.filter((item) => !known.has(item.productNo))
    .map((item) => ({ ...item, selectable: false, unavailableReason: "PRODUCT_NOT_AVAILABLE" }));
  const base = { ...latest, candidates: [...latest.candidates, ...missing] };
  for (const item of added) selection.add(item.productNo);
  return { base, selection: [...selection] };
}

function applyPricingGroups(base: BuyPricing, wanted: BuyPricing, groups: ReturnType<typeof changedGroups>): BuyPricing {
  const discount = groups.includes("discount") ? wanted : base;
  return {
    discountRate: discount.discountRate,
    discountCapUSD: discount.discountCapUSD,
    earlyPurchaseDiscountUSD: groups.includes("early") ? wanted.earlyPurchaseDiscountUSD : base.earlyPurchaseDiscountUSD,
  };
}

/** 在最新清单上重放成员变化和实际编辑过的优惠组（OP-97、D8）。 */
function rebaseBuyEdits(latest: BuyList, before: BuyDevice[], added: BuyDevice[], removed: BuyDevice[], wanted?: Record<string, BuyPricing>) {
  const review = rebaseSelection(latest, added, removed);
  const original = new Map(before.map((item) => [item.productNo, item.pricing ?? FOLLOW_ALL]));
  const current = new Map(latest.items.map((item) => [item.productNo, item]));
  const mine = new Map<string, ReturnType<typeof changedGroups>>();
  const drafted: Record<string, BuyPricing> = {};
  const prior: Record<string, BuyPricing> = {};
  if (latest.pricing && wanted) {
    for (const [no, value] of Object.entries(wanted)) {
      const groups = changedGroups(original.get(no) ?? FOLLOW_ALL, value);
      if (groups.length) mine.set(no, groups);
    }
    for (const no of review.selection) {
      const item = current.get(no);
      const fresh = item?.pricing ?? FOLLOW_ALL;
      const groups = mine.get(no);
      if (item?.selectable === false || !groups) {
        drafted[no] = fresh;
        continue;
      }
      drafted[no] = applyPricingGroups(fresh, wanted[no], groups);
      const previous = original.get(no);
      if (previous && item) prior[no] = previous;
    }
  }
  return { ...review, drafted, prior, mine };
}

export function buyReplayEdits(record: BuyListPending) {
  const before = readH2BuyDevices(record.review?.before, "journal");
  const added = readH2BuyDevices(record.review?.added, "journal");
  if (!before || !added) return;
  const removed = before.filter(item => !record.productNos.includes(item.productNo));
  const wanted = record.items ? Object.fromEntries(record.items.map(({ productNo, ...pricing }) => [productNo, pricing])) : undefined;
  return { before, added, removed, wanted };
}

export type ReviewBuyReplay = (edits: NonNullable<ReturnType<typeof buyReplayEdits>>, latest: BuyList, defaults?: PricingDefaults) => void;

export function BuySection({ ctx, list, readError, trialTargetNo, blocked, reading, reach, leaveGuard, replayReview, pricing, onReload, onSubmit }: {
  ctx: HCtx;
  list?: BuyList;
  /** 收到了这块数据但形状不对：显示区块错误卡，不显示成空清单（ST-34）。 */
  readError?: string;
  /** 当前「试用目标商品」的商品编号，候选里给它加标签。 */
  trialTargetNo?: string;
  /** 读取中或这一行结果未知时，「调整」和提交的禁用原因。 */
  blocked?: string;
  reading: boolean;
  reach: ReturnType<typeof useReach>;
  /** 抽屉里有没保存的改动时是一个「先问再做」，页头刷新走它（OP-30）；没有改动时是 null。 */
  leaveGuard: RefObject<((next: () => void) => void) | null>;
  replayReview: RefObject<ReviewBuyReplay | null>;
  /** 读取带「支持按设备优惠」标识时传三项默认值：显示「优惠」列和单独设置。不传时和以前完全一样。 */
  pricing?: PricingDefaults;
  onReload: (requireList?: boolean) => Promise<{ list?: BuyList; pricing?: PricingDefaults }>;
  onSubmit: (input: BuyListDraft) => Promise<BuyListSubmitResult>;
}) {
  const canWrite = ctx.can("growth_h2_write");
  const [draftBase, setDraftBase] = useState<BuyList>();
  const [picked, setPicked] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, PricingEdit>>({});
  const [editing, setEditing] = useState<string[]>([]);
  const [touched, setTouched] = useState<string[]>([]);
  const focusEditor = useRef<string>(undefined);
  const [lastReason, setLastReason] = useState("");
  const [rejected, setRejected] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const afterLeave = useRef<() => void>(undefined);
  const formSequence = useRef(0);
  const items = list ? byPrice(list.items) : [];
  const { items: draftItems, candidates } = buyChoices(draftBase);
  const inList = new Set(draftItems.map((item) => item.productNo));
  const { value, sub } = listValue(items);
  const added = picked.filter((no) => !inList.has(no));
  const removed = draftItems.filter((item) => !picked.includes(item.productNo));
  // 已下架或被上架条件拦住、仍保留的款：带着原设置，只能保留或移除（D8）。
  const lockedNos = new Set(candidates.filter((item) => inList.has(item.productNo) && !item.selectable).map((item) => item.productNo));
  const basePricing = (no: string) => draftItems.find((item) => item.productNo === no)?.pricing ?? FOLLOW_ALL;
  const editOf = (no: string) => edits[no] ?? editFrom(basePricing(no));
  const wantedOf = (no: string) => {
    const base = basePricing(no);
    if (lockedNos.has(no)) return base;
    const wanted = pricingOf(editOf(no));
    return applyPricingGroups(base, wanted, changedGroups(base, wanted));
  };
  const repriced = pricing ? draftItems.filter((item) => picked.includes(item.productNo) && !lockedNos.has(item.productNo)
    && changedGroups(basePricing(item.productNo), wantedOf(item.productNo)).length > 0) : [];
  const errorCount = pricing ? picked.filter((no) => !lockedNos.has(no)).reduce((sum, no) => sum + Object.keys(editErrors(editOf(no))).length, 0) : 0;
  const changed = added.length + removed.length + repriced.length > 0;
  const invalidPicked = candidates.some((item) => !item.selectable && added.includes(item.productNo));
  const draftBlock = blocked ?? (invalidPicked ? INVALID_PICKED : errorCount ? invalidText(errorCount) : changed ? undefined : pricing ? PRICED.noChanges : NO_CHANGES);

  const dirty = !!draftBase && changed;
  const leaveThen = useCallback((next: () => void) => {
    if (leaving || ctx.currentActionConfirm()) return;
    afterLeave.current = next;
    setLeaving(true);
  }, [ctx, leaving]);
  // 浏览器后退和换页一样先问（OP-29）。
  useNavigationLeaveGuard(dirty, ({ resume }) => leaveThen(resume), { pathOnly: true });
  const openDrawer = () => {
    // 抽屉开着时「调整」仍可用键盘点到：有改动先问，不重置勾选。
    if (dirty) { afterLeave.current = undefined; setLeaving(true); return; }
    setPicked(items.map((item) => item.productNo)); setLastReason(""); setRejected(undefined); setDraftBase(list);
    setEdits(Object.fromEntries(items.map((item) => [item.productNo, editFrom(item.pricing ?? FOLLOW_ALL)]))); setEditing([]); setTouched([]);
  };
  const closeDrawer = () => { afterLeave.current = undefined; setLeaving(false); setDraftBase(undefined); };
  const continueEditing = () => { afterLeave.current = undefined; setLeaving(false); };
  // 关闭、Esc、点抽屉外、取消：有改动先问（OP-29）。
  const leaveDrawer = () => { if (leaving) continueEditing(); else if (changed) { afterLeave.current = undefined; setLeaving(true); } else closeDrawer(); };
  const discard = () => { const next = afterLeave.current; closeDrawer(); next?.(); };
  useEffect(() => {
    if (!dirty) return;
    leaveGuard.current = leaveThen;
    return () => { leaveGuard.current = null; };
  }, [dirty, leaveGuard, leaveThen]);
  // 换成离开提示时，原来聚焦的勾选框没了。
  useEffect(refocusDrawer, [leaving]);
  const toggle = (no: string, on: boolean) => {
    setPicked((current) => on ? [...current, no] : current.filter((item) => item !== no));
    // 加入设备时就能同时设它的优惠（PLAN 三.2）：新勾上的款展开编辑区，两组先跟随默认。
    if (pricing && on && !inList.has(no)) setEditing((current) => current.includes(no) ? current : [...current, no]);
  };
  const setEdit = (no: string, next: PricingEdit) => setEdits((current) => ({ ...current, [no]: next }));
  const touch = (no: string, field: PricingField) => setTouched((current) => current.includes(`${no}:${field}`) ? current : [...current, `${no}:${field}`]);

  const showConfirm = (base: BuyList, selection: string[], { defaults: pricing, initialReason, initialRejected, rebased, readFresh, drafted, prior }: {
    defaults: PricingDefaults | undefined;
    initialReason?: string;
    initialRejected?: string;
    rebased?: { before: BuyDevice[]; mine: ReturnType<typeof rebaseBuyEdits>["mine"] };
    readFresh?: boolean;
    /** 这次要保存的每款优惠；没传的款按清单里现在的值。 */
    drafted?: Record<string, BuyPricing>;
    /** 读取最新后，自己改的款别人也改过：别人改之前的值（④b）。 */
    prior?: Record<string, BuyPricing>;
  }) => {
    const { items, candidates } = buyChoices(base);
    const selected = new Set(selection);
    const current = new Set(items.map((item) => item.productNo));
    const pickedCandidates = candidates.filter((candidate) => selected.has(candidate.productNo));
    const added = pickedCandidates.filter((candidate) => !current.has(candidate.productNo));
    const removed = items.filter((item) => !selected.has(item.productNo));
    const kept = items.filter((item) => selected.has(item.productNo));
    // Keep the authoritative order (the table and picker sort by price for display).
    const next = base.pricing ? [...base.items.filter((item) => selected.has(item.productNo)), ...added] : pickedCandidates;
    const now = (item: BuyDevice) => item.pricing ?? FOLLOW_ALL;
    const wanted = (item: BuyDevice) => drafted?.[item.productNo] ?? (current.has(item.productNo) ? now(item) : FOLLOW_ALL);
    const repriced = pricing ? kept.filter((item) => changedGroups(now(item), wanted(item)).length > 0) : [];
    const hasChanges = !!(added.length || removed.length || repriced.length);
    const members = rebased && changedByOthers(rebased.before, base.items);
    const pricingNotes = rebased && pricing ? othersPricing(rebased.before, base.items, rebased.mine, selected, pricing, !hasChanges) : [];
    const othersNote = members || pricingNotes.length ? <>
      {members && <Notice tone="neutral">{members}</Notice>}
      {pricingNotes}
    </> : undefined;
    if (added.some((item) => !item.selectable) || !hasChanges && !(pricing && othersNote)) return false;
    // 候选里有同名商品时带上编号才分得清。
    const label = (item: BuyDevice) => candidates.filter((other) => productName(other) === productName(item)).length > 1
      ? `${productName(item)}（${item.productNo}）` : productName(item);
    const removedSub = (item: BuyDevice) => pricing && customText(now(item)) ? `它单独设的${customText(now(item))} 一起删除，重新加入时跟随默认` : undefined;
    const pricingRows: DiffRow[] = pricing ? repriced.flatMap((item) => {
      const groups = changedGroups(now(item), wanted(item));
      return groups.map((group, index) => {
        const after = groupAfter(wanted(item), group, pricing);
        const was = prior?.[item.productNo];
        const others = was && changedGroups(was, now(item)).includes(group);
        const target = item.productNo === trialTargetNo && index === groups.length - 1 ? `领 ${productName(item)} 试用的用户买它仍按默认` : undefined;
        const subs = [after.sub, target].filter(Boolean);
        return {
          key: `${item.productNo}:${group}`, label: `${label(item)} · ${GROUP_NAME[group]}`,
          before: groupBefore(now(item), group, pricing), after: after.value,
          // 数字和单位不拆到两行：只改这一句的显示，存下的文字不变。
          note: others ? `别人刚把它从 ${groupBefore(was, group, pricing)} 改成 ${groupBefore(now(item), group, pricing)}；确认后改为${/^\d/.test(after.value) ? " " : ""}${after.value}`.replace(/ USDT/g, "\u00A0USDT") : undefined,
          sub: subs.length ? <>{subs.map((line, at) => <span key={at} className="h2-diff-line">{line}</span>)}</> : undefined,
        };
      });
    }) : [];
    const rows: DiffRow[] = [
      ...added.map((item) => ({ key: item.productNo, label: label(item), before: "不在清单", after: "新增", sub: pricing ? `优惠：${pricingLine(wanted(item), pricing)}` : undefined })),
      ...removed.map((item) => item.appState === "hidden"
        ? { key: item.productNo, label: label(item), before: "在清单 · App 不显示", after: "移除", note: "移除后，重新上架也要手动再添加", sub: removedSub(item) }
        : { key: item.productNo, label: label(item), before: item.appState === "soldOut" ? "在清单 · 售罄" : "在清单", after: "移除", note: "之后不能再用试用抵扣金买它（正在试用它的用户除外）", sub: removedSub(item) }),
      ...pricingRows,
      ...kept.filter((item) => !repriced.includes(item)).map((item) => {
        const state = item.appState === "hidden" ? "在清单 · App 不显示" : item.appState === "soldOut" ? "在清单 · 售罄" : "在清单";
        return { key: item.productNo, label: label(item), before: state, after: state, display: pricing ? <PricingGroups pricing={now(item)} defaults={pricing} /> : undefined };
      }),
    ];
    const after = listValue(next);
    const submittedPricing = base.pricing ? next.map((item) => ({ productNo: item.productNo, ...wanted(item) })) : undefined;
    const intended = submittedPricing && Object.fromEntries(submittedPricing.map(({ productNo, ...value }) => [productNo, value]));
    const readReview = async () => {
      const { list: latest, pricing: defaults } = await onReload(true);
      if (!latest || latest.pricing !== base.pricing) throw new Error(BUY_READ_INVALID);
      const review = rebaseBuyEdits(latest, base.items, added, removed, intended);
      setDraftBase(review.base);
      setPicked(review.selection);
      setEdits(Object.fromEntries(Object.entries(review.drafted).map(([no, value]) => [no, editFrom(value)])));
      return { ...review, defaults };
    };
    // 被拒的提示跟着这一框里的增删走：改过勾选再打开，「返回调整」按现在的勾选重算。
    const rejection = (message: string) => new ConfirmReadConflict({
      preserveReason: true,
      disabledReason: "请先返回调整",
      readLatest: async () => {
        await readReview();
        setRejected(undefined);
        ctx.openActionConfirm(null);
        // 「下一步」变灰会换节点，确认框关掉后焦点没有去处：等它关完放回抽屉。
        window.setTimeout(refocusDrawer, 100);
        return false;
      },
      renderNotice: (back) => <div className="h2-reject"><Notice tone="danger" action={<Button size="sm" onClick={back}>返回调整</Button>}>{message}</Notice></div>,
    });
    const priced: BuyPricingDraft | undefined = pricing ? {
      changed: repriced.map(productName),
      lines: [
        ...repriced.map((item) => `${productName(item)}：${changedGroups(now(item), wanted(item))
          .map((group) => `${GROUP_NAME[group]} ${groupBefore(now(item), group, pricing)} → ${groupAfter(wanted(item), group, pricing).full}`).join("；")}`),
        ...removed.filter((item) => customText(now(item))).map((item) => `${productName(item)}：移除，单独设的${customText(now(item))} 一起删除`),
        ...added.map((item) => `${productName(item)}（新增）：${pricingGroups(wanted(item))}`),
      ],
    } : undefined;
    function pricingGroups(value: BuyPricing) {
      return [
        `试用期折扣${value.discountRate === null ? `跟随默认 ${defaultDiscount(pricing!)}` : ` ${groupBefore(value, "discount", pricing!)}`}`,
        `专享立减${value.earlyPurchaseDiscountUSD === null ? `跟随默认 ${defaultEarly(pricing!)}` : ` ${groupBefore(value, "early", pricing!)}`}`,
      ].join(" · ");
    }
    const send = async (reason: string) => {
      if (!hasChanges) return;
      setLastReason(reason);
      const outcome = await onSubmit({
        productNos: next.map((item) => item.productNo),
        version: base.version,
        reason,
        added: added.map(productName),
        removed: removed.map(productName),
        nextNames: next.map(productName),
        review: { before: base.items, added },
        ...(submittedPricing ? { items: submittedPricing, priced } : {}),
      });
      if (outcome.kind === "stopped") { closeDrawer(); return; }
      if (outcome.kind === "conflict") {
        throw new ConfirmReadConflict({
          preserveReason: true,
          readLatest: async () => {
            const { base: latest, selection, drafted, prior, mine, defaults } = await readReview();
            setLastReason("");
            if (!showConfirm(latest, selection, { defaults, rebased: { before: base.items, mine }, readFresh: true, drafted, prior })) ctx.openActionConfirm(null);
            return false;
          },
          renderNotice: (readLatest) => (
            <Notice tone="warn" action={<Button size="sm" onClick={readLatest}>读取最新</Button>}>
              {BUY_CONFLICT}
              <p className="h2-alert-aux">{pricing ? PRICED.conflictAux : "读取最新后重算增删，理由要重填；没有变化不能提交。"}</p>
            </Notice>
          ),
        });
      }
      if (outcome.kind === "rejected") {
        const message = buyListRejection(outcome, base.items, added);
        setRejected(message);
        throw rejection(message);
      }
      if (outcome.kind === "unknown") {
        closeDrawer();
        ctx.toast(UNKNOWN_TOAST, "warn");
        return;
      }
      // 从「还没保存」里选了保存：存好后接着做原来要做的（换页，或整页刷新，刷新自带读回）。
      const proceed = afterLeave.current;
      if (proceed) { closeDrawer(); proceed(); }
      else {
        closeDrawer();
        await onReload().catch(() => undefined);
      }
      ctx.toast(BUY_SAVED, "success");
    };
    ctx.openActionConfirm({
      formKey: ++formSequence.current,
      briefKind: "config",
      icon: "sliders",
      action: "调整其他可购买设备",
      title: <>调整其他可购买设备<Explain label="其他可购买设备的说明" side="bottom" align="start" rows={[{ k: "这是什么", v: ROW_HELP.what }, { k: "显示位置", v: ROW_HELP.where }, { k: "生效时间", v: pricing ? PRICED.when : ROW_HELP.when }, { k: "改了会怎样", v: pricing ? PRICED.effect : ROW_HELP.effect }]} /></>,
      detail: "",
      amplifies: false,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: pricing ? { impact: PRICED.impact, check: PRICED.check } : { impact: "之后发起的购买按新清单，进行中的试用也一样", check: "前后清单记入操作记录；改错了再点「调整」改回。" },
      facts: (
        <div className={pricing ? "rd-stack h2-confirm-diff" : "rd-stack"} data-h2-nochange={hasChanges ? undefined : ""}>
          {othersNote}
          <DiffList rows={rows} restTitle="其余设备" named />
          <Facts>
            <Fact k="改后共">{after.value === "未添加" ? "0 款" : after.value}{after.sub && <> · {after.sub}</>}</Fact>
            {pricing && <Fact k="默认的试用期折扣">{defaultDiscount(pricing)}</Fact>}
            {pricing && <Fact k="默认的专享立减">{defaultEarly(pricing)}</Fact>}
          </Facts>
        </div>
      ),
      content: added.length > 0 ? <div className="h2-money-note"><Notice tone="neutral">{pricing ? PRICED.money : MONEY_LINE}</Notice></div> : undefined,
      initialReason: initialReason || undefined,
      initialRejection: initialRejected === undefined ? undefined : rejection(initialRejected),
      blockedReason: !hasChanges ? PRICED.noChanges : readFresh ? undefined : blocked,
      reasonPlaceholder: "写清调整原因和依据",
      confirmLabel: "确认修改，立即生效",
      run: send,
    });
    return true;
  };

  replayReview.current = ({ before, added, removed, wanted }, latest, defaults) => {
    const review = rebaseBuyEdits(latest, before, added, removed, wanted);
    afterLeave.current = undefined;
    setLeaving(false);
    setLastReason("");
    setRejected(undefined);
    setDraftBase(review.base);
    setPicked(review.selection);
    setEdits(Object.fromEntries(Object.entries(review.drafted).map(([no, value]) => [no, editFrom(value)])));
    const { base, selection, drafted, prior, mine } = review;
    if (!showConfirm(base, selection, { defaults, rebased: { before, mine }, readFresh: true, drafted, prior })
      && selection.length === latest.items.length && latest.items.every(item => selection.includes(item.productNo))) {
      ctx.toast(defaults ? PRICED.noChanges : NO_CHANGES, "info");
    }
  };

  const openConfirm = () => {
    if (!canWrite || !draftBase || draftBlock) return;
    if (!leaving) afterLeave.current = undefined;
    setLeaving(false);
    const wanted = pricing ? Object.fromEntries(picked.map((no) => [no, wantedOf(no)])) : undefined;
    if (list && list.version !== draftBase.version) {
      replayReview.current?.({ before: draftBase.items, added: candidates.filter((item) => added.includes(item.productNo)), removed, wanted }, list, pricing);
      return;
    }
    showConfirm(draftBase, picked, { defaults: pricing, initialReason: lastReason, initialRejected: rejected, drafted: wanted });
  };

  const pricingHref = (no: string) => `/devices/pricing?sku=${encodeURIComponent(no)}`;
  const note = invalidPicked ? INVALID_PICKED : [`改后共 ${picked.length} 款`, added.length > 0 && `新增 ${added.length} 款`, removed.length > 0 && `移除 ${removed.length} 款`, repriced.length > 0 && `改优惠 ${repriced.length} 款`].filter(Boolean).join(" · ");
  const targetListed = pricing && trialTargetNo ? items.find((item) => item.productNo === trialTargetNo) : undefined;

  return (
    <>
      <Panel title={<span tabIndex={-1} data-section-focus="">可购买设备</span>} explainLabel="可购买设备" icon={Package} tone="role-2" explain={<p>{BUY_INTRO}</p>}>
        {readError || !list ? (
          <BlockState retryKey="h2-trial-buy-359" state="error" title="可购买设备加载失败" detail={readError ?? BUY_READ_INVALID} retrying={reading} onRetry={() => void onReload().catch(() => undefined)} />
        ) : (
          <>
            <ConfigList>
              <ConfigRow name="其他可购买设备" what={ROW_HELP.what} where={ROW_HELP.where} when={pricing ? PRICED.when : ROW_HELP.when} effect={pricing ? PRICED.effect : ROW_HELP.effect}
                value={pricing
                  ? <><span className="h2-buy-seg">{value}</span>{sub && sub.split(" · ").map((part) => <span className="h2-buy-seg h2-buy-sub" key={part}> · {part}</span>)}</>
                  : <>{value}{sub && <> · <span className="h2-buy-sub">{sub}</span></>}</>}
                action={canWrite ? (describedBy) => <Button size="sm" data-h2-editor-leave aria-label="调整 其他可购买设备" aria-describedby={describedBy} disabledReason={blocked} onClick={openDrawer}>调整</Button> : undefined} />
            </ConfigList>
            {items.length > 0 && <p className="h2-buy-order">按售价从低到高</p>}
            <div className="h2-buy-table">
              <Table label="可购买设备">
                <thead>
                  <tr>
                    <Th icon={Package} tone="devices">{pricing ? "设备 · 商品编号 · 类型" : "设备 · 商品编号"}</Th>
                    <Th>App 显示</Th>
                    {pricing ? <Th>优惠（USDT）<PricingHeadExplain /></Th> : <Th>商品类型</Th>}
                    <Th align="right" icon={Coins} tone="money">售价（USDT）</Th>
                    <Th align="right">库存</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.productNo}>
                      {pricing
                        ? <Td><Cell main={<>{item.name || "—"}{item.productNo === trialTargetNo && <span className="h2-buy-target"><StatusTag tone="neutral" icon={CircleDot}>试用目标商品</StatusTag></span>}</>} sub={<><span data-mono="">{item.productNo}</span> · {typeText(item)}</>} title={`${item.name || "—"} ${item.productNo} ${typeText(item)}`} /></Td>
                        : <Td><Cell main={item.name || "—"} sub={<span data-mono="">{item.productNo}</span>} title={`${item.name || "—"} ${item.productNo}`} /></Td>}
                      <Td><AppState device={item} /></Td>
                      {pricing ? <Td><PricingCell pricing={item.pricing ?? FOLLOW_ALL} defaults={pricing} /></Td> : <Td><Cell main={typeText(item)} /></Td>}
                      <Td align="right"><Cell num main={price(item)} /></Td>
                      <Td align="right"><Cell num main={stockText(item)} /></Td>
                    </tr>
                  ))}
                  {items.length === 0 && <TableMessage columns={5}>还没添加其他设备，用户只能用试用抵扣金买自己的试用设备</TableMessage>}
                </tbody>
              </Table>
            </div>
            {targetListed && <p className="h2-price-note"><Info size={14} strokeWidth={1.9} aria-hidden /><span>领 {productName(targetListed)} 试用的用户买它仍按默认优惠</span></p>}
          </>
        )}
      </Panel>

      <Drawer open={!!draftBase} onClose={leaveDrawer} data-h2-buy-drawer=""
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target;
          // 这几处自己会先问，不再走「点抽屉外」，免得两次提示互相抵消（触屏上点外部在 click 之后才到）。
          if (dirty && target instanceof Element && target.closest("[data-h2-editor-leave], a[href]")) event.preventDefault();
        }}
        title={leaving ? (pricing ? "改动还没保存" : "清单改动还没保存") : "调整其他可购买设备"} sub="保存后立即生效" icon={SlidersHorizontal} tone="neutral"
        footer={leaving
          ? <Decision note={note}
            others={<><Button size="md" onClick={continueEditing}>继续编辑</Button><Button variant="danger-outline" size="md" onClick={discard}>放弃改动并返回</Button></>}
            primary={<TipSide side="top" align="end"><Button variant="primary" size="md" disabledReason={!blocked && !invalidPicked && errorCount ? leaveInvalidText(errorCount) : draftBlock} onClick={openConfirm}>保存并立即生效</Button></TipSide>} />
          : <Decision note={note}
            others={<Button size="md" onClick={leaveDrawer}>取消</Button>}
            primary={<TipSide side="top" align="end"><Button variant="primary" size="md" disabledReason={draftBlock} onClick={openConfirm}>下一步：核对并保存</Button></TipSide>} />}>
        {leaving ? <div className="rd-stack">
          <p>{pricing ? "放弃后，这次的改动不保存，清单和优惠保持原样。" : "放弃后，这次的勾选不保存，清单保持原样。"}</p>
          <Facts>
            {added.length > 0 && <Fact k="新增">{candidates.filter((item) => added.includes(item.productNo)).map(productName).join("、")}</Fact>}
            {removed.length > 0 && <Fact k="移除">{removed.map(productName).join("、")}</Fact>}
            {repriced.length > 0 && <Fact k="改优惠">{repriced.map(productName).join("、")}</Fact>}
          </Facts>
        </div> : <div className="h2-buy-form">
          <div className="h2-buy-checks">
            <CheckGroup summary={`候选 ${candidates.length} 款`}
              legend={<>其他可购买设备<Explain label="其他可购买设备的说明" side="bottom" align="start" content={<><p>能勾的：在售 · 通过上架条件 · 售价大于 0 · 实体设备或云份额</p><p>开没开「允许试用」都不影响。</p></>} /></>}>
              {candidates.map((candidate) => {
                const listed = inList.has(candidate.productNo);
                const on = picked.includes(candidate.productNo);
                const unavailable = !candidate.selectable && !listed;
                const disabled = unavailable && !on;
                const locked = lockedNos.has(candidate.productNo);
                const repricedHere = repriced.some((item) => item.productNo === candidate.productNo);
                const mark = on && !listed ? "新增" : !on && listed ? "移除" : repricedHere ? "优惠已改" : "";
                const reason = listed && candidate.appState === "hidden"
                  ? retainedHint(candidate)
                  : unavailable && on ? `${hiddenText(candidate)}，不能新增，请取消勾选`
                  : unavailable ? <>不能选：{hiddenText(candidate)}{hiddenText(candidate) === LISTING_BLOCKED && "，商城里也不显示"}{reach(pricingHref(candidate.productNo)) && <> <Link className="rd-link" href={pricingHref(candidate.productNo)} prefetch={false}>到商品管理与上架条件查看</Link></>}</> : undefined;
                const editOpen = pricing && on && !locked && !unavailable && editing.includes(candidate.productNo);
                const errors = pricing && on && !locked ? Object.keys(editErrors(editOf(candidate.productNo))).length : 0;
                const name = productName(candidate);
                return (
                  <div className="h2-buy-check" data-disabled={disabled ? "" : undefined} key={candidate.productNo}>
                    <Check checked={on} disabled={disabled} onChange={(event) => toggle(candidate.productNo, event.currentTarget.checked)}
                      label={<>
                        {candidate.name || "—"}
                        {candidate.productNo === trialTargetNo && <Explain label="试用目标商品是什么意思" content={pricing ? PRICED.targetTip : TARGET_TIP} side="bottom" align="start"><StatusTag tone="neutral" icon={CircleDot}>试用目标商品</StatusTag></Explain>}
                        {mark && <span data-change=""><StatusTag tone="progress" icon={mark === "新增" ? Plus : mark === "移除" ? X : SlidersHorizontal}>{mark}</StatusTag></span>}
                      </>}
                      help={<>
                        <span className="h2-product-meta"><span data-mono="">{candidate.productNo}</span> · {typeText(candidate)} · {price(candidate)} USDT · 库存 {stockText(candidate)}</span>
                        {reason && <span className="h2-buy-reason">{reason}</span>}
                      </>} />
                    {pricing && on && !unavailable && (editOpen
                      ? <PricingEditor device={candidate} edit={editOf(candidate.productNo)} defaults={pricing} isTarget={candidate.productNo === trialTargetNo} focusOnOpen={focusEditor.current === candidate.productNo}
                        shown={(field) => touched.includes(`${candidate.productNo}:${field}`)}
                        onChange={(next) => setEdit(candidate.productNo, next)} onBlur={(field) => touch(candidate.productNo, field)}
                        onCollapse={() => {
                          setEditing((current) => current.filter((no) => no !== candidate.productNo));
                          // 「收起」被换掉后焦点回到这一行的「改优惠」（OP-46）。
                          window.setTimeout(() => document.querySelector<HTMLElement>(`[data-h2-buy-drawer] [aria-label="改优惠 ${name}"]`)?.focus(), 0);
                        }} />
                      : <div className="h2-price-sum">
                        <span className="h2-price-sum-k">优惠</span>
                        {errors ? <span className="h2-field-warn">有 {errors} 处要改正</span> : <PricingGroups pricing={wantedOf(candidate.productNo)} defaults={pricing} />}
                        {locked
                          ? <span className="h2-price-sum-lock">{hiddenText(candidate).replace(/^商城/, "")}，不能改优惠</span>
                          : <Button size="sm" aria-label={`改优惠 ${name}`} onClick={() => { focusEditor.current = candidate.productNo; setEditing((current) => [...current, candidate.productNo]); }}>改优惠</Button>}
                      </div>)}
                  </div>
                );
              })}
            </CheckGroup>
          </div>
          <Notice tone="neutral">{pricing ? PRICED.money : MONEY_LINE}</Notice>
        </div>}
      </Drawer>
    </>
  );
}
