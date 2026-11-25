"use client";

/**
 * 免费试用设置 ·「可购买设备」分区（PLAN 第三节，画板 01–11）：用户除了自己领的试用设备，还能用试用抵扣金买哪些设备。
 * 后台只保存「其他可购买设备」；读取结果里没有这块数据时整块不显示，页面和以前一样。
 */
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleDot, Coins, Eye, EyeOff, Package, PackageX, Plus, SlidersHorizontal, X } from "lucide-react";
import { BlockState, Button, Cell, Check, CheckGroup, ConfigList, ConfigRow, Decision, DiffList, Drawer, Explain, Fact, Facts, KeepText, Notice, Panel, StatusTag, Table, TableMessage, Td, Th, type DiffRow } from "@/app/components/rd";
import { TipSide } from "@/app/components/rd/button";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ConfirmReadConflict } from "@/lib/admin/h-conflict-review";
import type { updateH2TrialBuyList } from "@/lib/admin/h-client";
import { buyProductReason, LISTING_BLOCKED, type BuyDevice, type BuyList, type BuyListWrite } from "@/lib/admin/h2-trial-purchase";
import { isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import type { useReach } from "@/lib/nav/use-reach";
import type { HCtx } from "./types";

export type BuyListDraft = Omit<BuyListWrite, "requestNo" | "confirmedActorId"> & {
  added: string[];
  removed: string[];
  nextNames: string[];
};

export type BuyListPending = PendingMutationRecord & BuyListDraft & Pick<BuyListWrite, "requestNo" | "confirmedActorId"> & {
  retryRejection?: string;
};
export type BuyListSubmitResult = Exclude<Awaited<ReturnType<typeof updateH2TrialBuyList>>, { kind: "unauthenticated" | "forbidden" | "accountMismatch" }>
  | { kind: "stopped" };

export const BUY_INTRO = "用户领的那台试用设备自动在他的清单里，不用添加；这里添加其他可以用试用抵扣金购买的设备。";
const MONEY_LINE = "减价后的价格低于试用抵扣金时，抵不完的购后到账给用户。";
const BUY_LOCKED = "这项有一次修改结果未知，先到页面上方处理";
export const BUY_CONFLICT = "这份清单刚被别人改过，这次没有保存";
export const BUY_READ_INVALID = "收到的数据不完整，已停止显示。";
const ROW_HELP = {
  what: "用户还能用试用抵扣金买的设备，每次试用限购一款",
  where: "App 试用详情 ›「专享限时折扣设备」",
  when: "立即生效，之后发起的购买按新清单，进行中的试用也一样",
  effect: "缺货或用户不符合购买条件时不能选；移除后不能再用试用抵扣金买它，领了这款的用户不受影响",
};
const TARGET_TIP = "勾上后，领了别款的用户也能用试用抵扣金买它";

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
  const rejection = record.retryRejection;
  const op = [record.added.length > 0 && `新增 ${record.added.join("、")}`, record.removed.length > 0 && `移除 ${record.removed.join("、")}`].filter(Boolean).join(" · ");
  return (
    <Notice tone="warn" title="调整其他可购买设备 · 结果未知"
      action={canWrite && (rejection
        ? <Button size="sm" onClick={onRelease}>解除原操作记录</Button>
        : !expired && <Button size="sm" disabled={retrying} onClick={onRetry}>按原操作重试</Button>)}>
      {op && <span className="h2-pending-op">{op}</span>}
      {formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，
      <KeepText text="可能已经生效，重试成功或核对清楚前，这项不能再改。" />
      <KeepText text={expired ? " 已超过 24 小时，不能再重试，请到操作记录与审批核对。" : !canWrite ? " 这个账号已没有这项权限，不能重试。" : rejection ? " 请核对原操作的结果再解除。" : " 按原操作重试不会重复执行。"} />
      {auditLink && <> {auditLink}</>}
      <Explain label="技术信息" side="bottom" align="end" rows={[
        { k: "操作编号", v: <span data-mono="" className="h2-nowrap">{record.commandKey}</span> },
        { k: "改后清单", v: record.nextNames.length > 0 ? record.nextNames.join("、") : "空" },
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
function changedByOthers(before: BuyList, latest: BuyList) {
  const names = (from: BuyList, against: BuyList) => from.items
    .filter((item) => !against.items.some((other) => other.productNo === item.productNo)).map(productName).join("、");
  const added = names(latest, before);
  const removed = names(before, latest);
  return added || removed ? `别人已改：${[added && `新增 ${added}`, removed && `移除 ${removed}`].filter(Boolean).join("，")}` : undefined;
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

export function BuySection({ ctx, list, readError, trialTargetNo, blocked, reading, reach, leaveGuard, onReload, onSubmit }: {
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
  onReload: (requireList?: boolean) => Promise<BuyList | undefined>;
  onSubmit: (input: BuyListDraft) => Promise<BuyListSubmitResult>;
}) {
  const canWrite = ctx.can("growth_h2_write");
  const [draftBase, setDraftBase] = useState<BuyList>();
  const [picked, setPicked] = useState<string[]>([]);
  const [lastReason, setLastReason] = useState("");
  const [rejected, setRejected] = useState<string>();
  const [leaving, setLeaving] = useState(false);
  const afterLeave = useRef<() => void>(undefined);
  const formSequence = useRef(0);
  const router = useRouter();
  const items = list ? byPrice(list.items) : [];
  const { items: draftItems, candidates } = buyChoices(draftBase);
  const inList = new Set(draftItems.map((item) => item.productNo));
  const { value, sub } = listValue(items);
  const added = picked.filter((no) => !inList.has(no));
  const removed = draftItems.filter((item) => !picked.includes(item.productNo));
  const changed = added.length + removed.length > 0;
  const invalidPicked = candidates.some((item) => !item.selectable && added.includes(item.productNo));
  const draftBlock = blocked ?? (invalidPicked ? "请先取消不能新增的设备" : changed ? undefined : "勾选和现在一样，没有要保存的改动");

  const dirty = !!draftBase && changed;
  const openDrawer = () => {
    // 抽屉开着时「调整」仍可用键盘点到：有改动先问，不重置勾选。
    if (dirty) { afterLeave.current = undefined; setLeaving(true); return; }
    setPicked(items.map((item) => item.productNo)); setLastReason(""); setRejected(undefined); setDraftBase(list);
  };
  const closeDrawer = () => { afterLeave.current = undefined; setLeaving(false); setDraftBase(undefined); };
  const continueEditing = () => { afterLeave.current = undefined; setLeaving(false); };
  // 关闭、Esc、点抽屉外、取消：有改动先问（OP-29）。
  const leaveDrawer = () => { if (leaving) continueEditing(); else if (changed) { afterLeave.current = undefined; setLeaving(true); } else closeDrawer(); };
  const discard = () => { const next = afterLeave.current; closeDrawer(); next?.(); };
  useEffect(() => {
    if (!dirty) return;
    const leaveThen = (next: () => void) => { afterLeave.current = next; setLeaving(true); };
    leaveGuard.current = leaveThen;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    // 侧栏、面包屑和抽屉里的链接会换页：先问，放弃后再去。
    const intercept = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.target && link.target !== "_self" || link.hasAttribute("download") || link.origin !== window.location.origin
        || link.pathname === window.location.pathname) return;
      event.preventDefault();
      event.stopPropagation();
      leaveThen(() => router.push(`${link.pathname}${link.search}${link.hash}`));
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", intercept, true);
    return () => {
      leaveGuard.current = null;
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", intercept, true);
    };
  }, [dirty, leaveGuard, router]);
  // 换成离开提示时，原来聚焦的勾选框没了。
  useEffect(refocusDrawer, [leaving]);
  const toggle = (no: string, on: boolean) => setPicked((current) => on ? [...current, no] : current.filter((item) => item !== no));

  const showConfirm = (base: BuyList, selection: string[], initialReason: string, initialRejected?: string, othersNote?: string) => {
    const { items, candidates } = buyChoices(base);
    const selected = new Set(selection);
    const current = new Set(items.map((item) => item.productNo));
    const next = candidates.filter((candidate) => selected.has(candidate.productNo));
    const added = next.filter((candidate) => !current.has(candidate.productNo));
    const removed = items.filter((item) => !selected.has(item.productNo));
    const kept = items.filter((item) => selected.has(item.productNo));
    if (added.some((item) => !item.selectable) || (!added.length && !removed.length)) return false;
    // 候选里有同名商品时带上编号才分得清。
    const label = (item: BuyDevice) => candidates.filter((other) => productName(other) === productName(item)).length > 1
      ? `${productName(item)}（${item.productNo}）` : productName(item);
    const rows: DiffRow[] = [
      ...added.map((item) => ({ key: item.productNo, label: label(item), before: "不在清单", after: "新增" })),
      ...removed.map((item) => item.appState === "hidden"
        ? { key: item.productNo, label: label(item), before: "在清单 · App 不显示", after: "移除", note: "移除后，重新上架也要手动再添加" }
        : { key: item.productNo, label: label(item), before: item.appState === "soldOut" ? "在清单 · 售罄" : "在清单", after: "移除", note: "之后不能再用试用抵扣金买它（正在试用它的用户除外）" }),
      ...kept.map((item) => {
        const state = item.appState === "hidden" ? "在清单 · App 不显示" : item.appState === "soldOut" ? "在清单 · 售罄" : "在清单";
        return { key: item.productNo, label: label(item), before: state, after: state };
      }),
    ];
    const after = listValue(next);
    const readReview = async () => {
      const latest = await onReload(true);
      if (!latest) throw new Error(BUY_READ_INVALID);
      const review = rebaseSelection(latest, added, removed);
      setDraftBase(review.base);
      setPicked(review.selection);
      return review;
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
      renderNotice: (back) => <Notice tone="danger" action={<Button size="sm" onClick={back}>返回调整</Button>}>{message}</Notice>,
    });
    const send = async (reason: string) => {
      setLastReason(reason);
      const outcome = await onSubmit({
        productNos: next.map((item) => item.productNo),
        version: base.version,
        reason,
        added: added.map(productName),
        removed: removed.map(productName),
        nextNames: next.map(productName),
      });
      if (outcome.kind === "stopped") { closeDrawer(); return; }
      if (outcome.kind === "conflict") {
        throw new ConfirmReadConflict({
          preserveReason: true,
          readLatest: async () => {
            const { base: latest, selection } = await readReview();
            setLastReason("");
            if (!showConfirm(latest, selection, "", undefined, changedByOthers(base, latest))) ctx.openActionConfirm(null);
            return false;
          },
          renderNotice: (readLatest) => (
            <Notice tone="warn" action={<Button size="sm" onClick={readLatest}>读取最新</Button>}>
              {BUY_CONFLICT}
              <p className="h2-alert-aux">读取最新后重算增删，理由要重填；没有变化不能提交。</p>
            </Notice>
          ),
        });
      }
      if (outcome.kind === "rejected") {
        const refused = outcome.productNo === undefined ? undefined
          : [...base.candidates, ...base.items].find((item) => item.productNo === outcome.productNo);
        const message = refused && outcome.productNo !== undefined
          ? `没有保存：${productName(refused)}${buyProductReason(outcome.reason, refused.status)}，不能新增。` : outcome.message;
        setRejected(message);
        throw rejection(message);
      }
      if (outcome.kind === "unknown") {
        closeDrawer();
        ctx.toast("结果未知，不要重复操作，到页面上方处理。", "warn");
        return;
      }
      // 从「还没保存」里选了保存：存好后接着做原来要做的（换页，或整页刷新，刷新自带读回）。
      const proceed = afterLeave.current;
      closeDrawer();
      if (proceed) proceed();
      else await onReload().catch(() => undefined);
      ctx.toast("其他可购买设备 已更新", "success");
    };
    ctx.openActionConfirm({
      formKey: ++formSequence.current,
      briefKind: "config",
      icon: "sliders",
      action: "调整其他可购买设备",
      title: <>调整其他可购买设备<Explain label="其他可购买设备的说明" side="bottom" align="start" rows={[{ k: "这是什么", v: ROW_HELP.what }, { k: "显示位置", v: ROW_HELP.where }, { k: "生效时间", v: ROW_HELP.when }, { k: "改了会怎样", v: ROW_HELP.effect }]} /></>,
      detail: "",
      amplifies: false,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: { impact: "之后发起的购买按新清单，进行中的试用也一样", check: "前后清单记入操作记录；改错了再点「调整」改回。" },
      facts: (
        <div className="rd-stack">
          {othersNote && <Notice tone="neutral">{othersNote}</Notice>}
          <DiffList rows={rows} restTitle="其余设备" named />
          <Facts><Fact k="改后共">{after.value === "未添加" ? "0 款" : after.value}{after.sub && <> · {after.sub}</>}</Fact></Facts>
        </div>
      ),
      content: added.length > 0 ? <div className="h2-money-note"><Notice tone="neutral">{MONEY_LINE}</Notice></div> : undefined,
      initialReason: initialReason || undefined,
      initialRejection: initialRejected === undefined ? undefined : rejection(initialRejected),
      blockedReason: blocked,
      reasonPlaceholder: "写清调整原因和依据",
      confirmLabel: "确认修改，立即生效",
      run: send,
    });
    return true;
  };

  const openConfirm = () => {
    if (!canWrite || !draftBase || draftBlock) return;
    if (!leaving) afterLeave.current = undefined;
    setLeaving(false);
    showConfirm(draftBase, picked, lastReason, rejected);
  };

  const pricingHref = (no: string) => `/devices/pricing?sku=${encodeURIComponent(no)}`;
  const note = invalidPicked ? "请先取消不能新增的设备" : [`改后共 ${picked.length} 款`, added.length > 0 && `新增 ${added.length} 款`, removed.length > 0 && `移除 ${removed.length} 款`].filter(Boolean).join(" · ");

  return (
    <>
      <Panel title={<span tabIndex={-1} data-section-focus="">可购买设备</span>} explainLabel="可购买设备" icon={Package} tone="role-2" explain={<p>{BUY_INTRO}</p>}>
        {readError || !list ? (
          <BlockState retryKey="h2-trial-buy-359" state="error" title="可购买设备加载失败" detail={readError ?? BUY_READ_INVALID} retrying={reading} onRetry={() => void onReload().catch(() => undefined)} />
        ) : (
          <>
            <ConfigList>
              <ConfigRow name="其他可购买设备" what={ROW_HELP.what} where={ROW_HELP.where} when={ROW_HELP.when} effect={ROW_HELP.effect}
                value={<>{value}{sub && <> · <span className="h2-buy-sub">{sub}</span></>}</>}
                action={canWrite ? (describedBy) => <Button size="sm" data-h2-editor-leave aria-label="调整 其他可购买设备" aria-describedby={describedBy} disabledReason={blocked} onClick={openDrawer}>调整</Button> : undefined} />
            </ConfigList>
            {items.length > 0 && <p className="h2-buy-order">按售价从低到高</p>}
            <div className="h2-buy-table">
              <Table label="可购买设备">
                <thead>
                  <tr>
                    <Th icon={Package} tone="devices">设备 · 商品编号</Th>
                    <Th>App 显示</Th>
                    <Th>商品类型</Th>
                    <Th align="right" icon={Coins} tone="money">售价（USDT）</Th>
                    <Th align="right">库存</Th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.productNo}>
                      <Td><Cell main={item.name || "—"} sub={<span data-mono="">{item.productNo}</span>} title={`${item.name || "—"} ${item.productNo}`} /></Td>
                      <Td><AppState device={item} /></Td>
                      <Td><Cell main={typeText(item)} /></Td>
                      <Td align="right"><Cell num main={price(item)} /></Td>
                      <Td align="right"><Cell num main={stockText(item)} /></Td>
                    </tr>
                  ))}
                  {items.length === 0 && <TableMessage columns={5}>还没添加其他设备，用户只能用试用抵扣金买自己的试用设备</TableMessage>}
                </tbody>
              </Table>
            </div>
          </>
        )}
      </Panel>

      <Drawer open={!!draftBase} onClose={leaveDrawer} data-h2-buy-drawer=""
        onInteractOutside={(event) => {
          const target = event.detail.originalEvent.target;
          // 这几处自己会先问，不再走「点抽屉外」，免得两次提示互相抵消（触屏上点外部在 click 之后才到）。
          if (dirty && target instanceof Element && target.closest("[data-h2-editor-leave], a[href]")) event.preventDefault();
        }}
        title={leaving ? "清单改动还没保存" : "调整其他可购买设备"} sub="保存后立即生效" icon={SlidersHorizontal} tone="neutral"
        footer={leaving
          ? <Decision note={note}
            others={<><Button size="md" onClick={continueEditing}>继续编辑</Button><Button variant="danger-outline" size="md" onClick={discard}>放弃改动并返回</Button></>}
            primary={<TipSide side="top" align="end"><Button variant="primary" size="md" disabledReason={draftBlock} onClick={openConfirm}>保存并立即生效</Button></TipSide>} />
          : <Decision note={note}
            others={<Button size="md" onClick={leaveDrawer}>取消</Button>}
            primary={<TipSide side="top" align="end"><Button variant="primary" size="md" disabledReason={draftBlock} onClick={openConfirm}>下一步：核对并保存</Button></TipSide>} />}>
        {leaving ? <div className="rd-stack">
          <p>放弃后，这次的勾选不保存，清单保持原样。</p>
          <Facts>
            {added.length > 0 && <Fact k="新增">{candidates.filter((item) => added.includes(item.productNo)).map(productName).join("、")}</Fact>}
            {removed.length > 0 && <Fact k="移除">{removed.map(productName).join("、")}</Fact>}
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
                const mark = on && !listed ? "新增" : !on && listed ? "移除" : "";
                const reason = listed && candidate.appState === "hidden"
                  ? retainedHint(candidate)
                  : unavailable && on ? `${hiddenText(candidate)}，不能新增，请取消勾选`
                  : unavailable ? <>不能选：{hiddenText(candidate)}{hiddenText(candidate) === LISTING_BLOCKED && "，商城里也不显示"}{reach(pricingHref(candidate.productNo)) && <> <Link className="rd-link" href={pricingHref(candidate.productNo)} prefetch={false}>到商品管理与上架条件查看</Link></>}</> : undefined;
                return (
                  <div className="h2-buy-check" data-disabled={disabled ? "" : undefined} key={candidate.productNo}>
                    <Check checked={on} disabled={disabled} onChange={(event) => toggle(candidate.productNo, event.currentTarget.checked)}
                      label={<>
                        {candidate.name || "—"}
                        {candidate.productNo === trialTargetNo && <Explain label="试用目标商品是什么意思" content={TARGET_TIP} side="bottom" align="start"><StatusTag tone="neutral" icon={CircleDot}>试用目标商品</StatusTag></Explain>}
                        {mark && <span data-change=""><StatusTag tone="progress" icon={mark === "新增" ? Plus : X}>{mark}</StatusTag></span>}
                      </>}
                      help={<>
                        <span className="h2-product-meta"><span data-mono="">{candidate.productNo}</span> · {typeText(candidate)} · {price(candidate)} USDT · 库存 {stockText(candidate)}</span>
                        {reason && <span className="h2-buy-reason">{reason}</span>}
                      </>} />
                  </div>
                );
              })}
            </CheckGroup>
          </div>
          <Notice tone="neutral">{MONEY_LINE}</Notice>
        </div>}
      </Drawer>
    </>
  );
}

export { BUY_LOCKED };
