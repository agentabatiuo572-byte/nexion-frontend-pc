"use client";

/**
 * 免费试用设置 ·「可购买设备」分区（PLAN 第三节，画板 01–11）：用户除了自己领的试用设备，还能用试用抵扣金买哪些设备。
 * 后台只保存「其他可购买设备」；读取结果里没有这块数据时整块不显示，页面和以前一样。
 * 这里只做界面和状态。读取字段名、整份替换的写接口、版本比对、结果未知的保存与重试都由接线项实现（B90-BE-01），
 * 标了「占位」的地方就是要接的位置。
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CircleDot, Coins, Eye, EyeOff, Package, PackageX, Plus, SlidersHorizontal, X } from "lucide-react";
import { BlockState, Button, Cell, Check, CheckGroup, ConfigList, ConfigRow, Decision, DiffList, Drawer, Explain, Fact, Facts, KeepText, Notice, Panel, StatusTag, Table, TableMessage, Td, Th, type DiffRow } from "@/app/components/rd";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ConfirmReadConflict } from "@/lib/admin/h-conflict-review";
import type { useReach } from "@/lib/nav/use-reach";
import type { HCtx } from "./types";

/** 占位：字段名等后端定（B90-BE-01）。appState 由接线项按商城状态和库存换算：在售有货 shown、下架或被上架条件拦住 hidden、库存 0 soldOut。 */
export type BuyDevice = {
  productNo: string;
  name: string;
  /** 商品目录的类型：DEVICE 实体设备，SHARE 云份额。 */
  productType?: string;
  /** UNLIMITED 是不限库存。 */
  inventoryMode?: string;
  priceUsdt?: number | string;
  stock?: number | string | null;
  appState: "shown" | "hidden" | "soldOut";
  /** App 不显示的原因，比如「商城已下架」「没通过上架条件」。 */
  hiddenReason?: string;
};
export type BuyCandidate = BuyDevice & { selectable: boolean; unavailableReason?: string };
export type BuyList = { version?: string; items: BuyDevice[]; candidates: BuyCandidate[] };

/** 占位：页面读取里的新字段。没有这个字段时返回 undefined，分区不显示；有字段但形状不对时返回 "invalid"，显示区块错误卡。 */
export function readBuyList(raw: unknown): BuyList | "invalid" | undefined {
  if (raw === undefined) return undefined;
  const value = raw as Partial<BuyList> | null;
  if (!value || !Array.isArray(value.items) || !Array.isArray(value.candidates)) return "invalid";
  return value as BuyList;
}

/** 占位：整份替换「其他可购买设备」的提交（B90-BE-01）。入参是改后的完整清单、读取时的版本和理由；出参是四种结果之一。由接线项实现。 */
export type BuyListSubmit = { productNos: string[]; version?: string; reason: string };
export type BuyListOutcome =
  | { kind: "saved" }
  | { kind: "conflict" }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; record: BuyListPending };
export const submitBuyList = async (_input: BuyListSubmit): Promise<BuyListOutcome> => {
  throw new Error("保存可购买设备还没接上，这次没有提交。");
};

/** 占位：结果未知时保留的原操作（PLAN 第三节：原操作人、操作编号、完整清单、原版本、理由）。保存和恢复由接线项接到 pending-mutation-store。 */
export type BuyListPending = {
  commandKey: string;
  createdAt: number;
  expiresAt: number;
  added: string[];
  removed: string[];
  nextNames: string[];
  reason: string;
};

export const BUY_INTRO = "用户领的那台试用设备自动在他的清单里，不用添加；这里添加其他可以用试用抵扣金购买的设备。";
const MONEY_LINE = "减价后的价格低于试用抵扣金时，抵不完的购后到账给用户。";
const BUY_LOCKED = "这项有一次修改结果未知，先到页面上方处理";
const ROW_HELP = {
  what: "用户还能用试用抵扣金买的设备，每次试用限购一款",
  where: "App 试用详情 ›「选择要购买的设备」",
  when: "立即生效，之后发起的购买按新清单，进行中的试用也一样",
  effect: "缺货或用户不符合购买条件时不能选；移除后不能再用试用抵扣金买它，领了这款的用户不受影响",
};
const TARGET_TIP = "勾上后，领了别款的用户也能用试用抵扣金买它";

const priceNumber = (device: BuyDevice) => Number(device.priceUsdt ?? 0);
const byPrice = <T extends BuyDevice>(list: readonly T[]) => [...list].sort((a, b) => priceNumber(a) - priceNumber(b));
/** 金额带千分位，不舍入，不补零（TX-20）。 */
const price = (device: BuyDevice) => device.priceUsdt == null || device.priceUsdt === "" ? "—" : Number(device.priceUsdt).toLocaleString("en-US", { maximumFractionDigits: 6 });
const typeText = (device: BuyDevice) => device.productType === "SHARE" ? "云份额" : "实体设备";
const stockText = (device: BuyDevice) => device.inventoryMode === "UNLIMITED" ? "不限"
  : device.stock == null || device.stock === "" ? "—" : Number(device.stock).toLocaleString("en-US");
const hiddenText = (device: BuyDevice) => device.hiddenReason ?? "商城已下架";

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

export function BuyListPendingNotice({ record, canWrite, onRetry, retrying, auditLink }: {
  record: BuyListPending;
  canWrite: boolean;
  /** 占位：按原操作重试（同操作编号、同清单、同理由），由接线项实现。 */
  onRetry: () => void;
  retrying: boolean;
  auditLink?: ReactNode;
}) {
  const expired = record.expiresAt <= Date.now();
  const op = [record.added.length > 0 && `新增 ${record.added.join("、")}`, record.removed.length > 0 && `移除 ${record.removed.join("、")}`].filter(Boolean).join(" · ");
  return (
    <Notice tone="warn" title="调整其他可购买设备 · 结果未知"
      action={!expired && <Button size="sm" disabled={retrying} disabledReason={canWrite ? undefined : "这个账号已没有这项权限，不能重试。"} onClick={onRetry}>按原操作重试</Button>}>
      {op && <span className="h2-pending-op">{op}</span>}
      {formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，
      <KeepText text="可能已经生效，重试成功或核对清楚前，这项不能再改。" />
      <KeepText text={expired ? " 已超过 24 小时，不能再重试，请到操作记录与审批核对。" : !canWrite ? " 这个账号已没有这项权限，不能重试。" : " 按原操作重试不会重复执行。"} />
      {auditLink && <> {auditLink}</>}
      <Explain label="技术信息" rows={[
        { k: "操作编号", v: <span data-mono="" className="h2-nowrap">{record.commandKey}</span> },
        { k: "改后清单", v: record.nextNames.length > 0 ? record.nextNames.join("、") : "空" },
        { k: "理由", v: record.reason },
      ]} />
    </Notice>
  );
}

export function BuySection({ ctx, list, invalid, trialTargetNo, blocked, reach, onReload, onPending }: {
  ctx: HCtx;
  list?: BuyList;
  /** 收到了这块数据但形状不对：显示区块错误卡，不显示成空清单（ST-34）。 */
  invalid: boolean;
  /** 当前「试用目标商品」的商品编号，候选里给它加标签。 */
  trialTargetNo?: string;
  /** 读取中或这一行结果未知时，「调整」和提交的禁用原因。 */
  blocked?: string;
  reach: ReturnType<typeof useReach>;
  onReload: () => Promise<void>;
  /** 占位：结果未知时把原操作交给页面上方的待确认条，由接线项接到 pending-mutation-store。 */
  onPending: (record: BuyListPending) => void;
}) {
  const canWrite = ctx.can("growth_h2_write");
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [lastReason, setLastReason] = useState("");
  const items = list ? byPrice(list.items) : [];
  const inList = new Set(items.map((item) => item.productNo));
  const { value, sub } = listValue(items);

  // 候选：后端按 R6 给的候选，加上已在清单里、现在不符合条件的保留项（只能保留或取消，不会被悄悄丢掉）。
  const candidates: BuyCandidate[] = list ? byPrice([
    ...list.candidates,
    ...items.filter((item) => !list.candidates.some((candidate) => candidate.productNo === item.productNo)).map((item) => ({ ...item, selectable: false })),
  ]) : [];
  const nameOf = (no: string) => candidates.find((candidate) => candidate.productNo === no)?.name ?? no;
  const added = picked.filter((no) => !inList.has(no));
  const removed = items.filter((item) => !picked.includes(item.productNo));
  const changed = added.length + removed.length > 0;

  const openDrawer = () => { setPicked(items.map((item) => item.productNo)); setLastReason(""); setOpen(true); };
  const toggle = (no: string, on: boolean) => setPicked((current) => on ? [...current, no] : current.filter((item) => item !== no));

  const openConfirm = () => {
    const next = candidates.filter((candidate) => picked.includes(candidate.productNo));
    const kept = items.filter((item) => picked.includes(item.productNo));
    const rows: DiffRow[] = [
      ...added.map((no) => ({ key: no, label: nameOf(no), before: "不在清单", after: "新增" })),
      ...removed.map((item) => item.appState === "hidden"
        ? { key: item.productNo, label: item.name, before: "在清单 · App 不显示", after: "移除", note: "移除后，重新上架也要手动再添加" }
        : { key: item.productNo, label: item.name, before: item.appState === "soldOut" ? "在清单 · 售罄" : "在清单", after: "移除", note: "之后不能再用试用抵扣金买它（正在试用它的用户除外）" }),
      ...kept.map((item) => {
        const state = item.appState === "hidden" ? "在清单 · App 不显示" : item.appState === "soldOut" ? "在清单 · 售罄" : "在清单";
        return { key: item.productNo, label: item.name, before: state, after: state };
      }),
    ];
    const after = listValue(next);
    const send = async (reason: string) => {
      setLastReason(reason);
      const outcome = await submitBuyList({ productNos: next.map((item) => item.productNo), version: list?.version, reason });
      if (outcome.kind === "conflict") {
        throw new ConfirmReadConflict({
          readLatest: async () => { await onReload(); return true; },
          renderNotice: (readLatest) => (
            <Notice tone="warn" action={<Button size="sm" onClick={readLatest}>读取最新</Button>}>
              这份清单刚被别人改过，这次没有保存
              <p className="h2-alert-aux">读取最新后重算增删，理由要重填；没有变化不能提交。</p>
            </Notice>
          ),
        });
      }
      if (outcome.kind === "rejected") {
        throw new ConfirmReadConflict({
          preserveReason: true,
          // 「返回调整」关掉确认框，抽屉里的勾选不动，再进确认框时理由带回来。
          readLatest: async () => { ctx.openActionConfirm(null); return false; },
          renderNotice: (back) => <Notice tone="danger" action={<Button size="sm" onClick={back}>返回调整</Button>}>{outcome.message}</Notice>,
        });
      }
      if (outcome.kind === "unknown") {
        onPending(outcome.record);
        setOpen(false);
        ctx.toast("结果未知，不要重复操作，到页面上方处理。", "warn");
        return;
      }
      setOpen(false);
      await onReload();
      ctx.toast("其他可购买设备 已更新", "success");
    };
    ctx.openActionConfirm({
      briefKind: "config",
      action: "调整其他可购买设备",
      title: <>调整其他可购买设备<Explain label="其他可购买设备的说明" rows={[{ k: "这是什么", v: ROW_HELP.what }, { k: "显示位置", v: ROW_HELP.where }, { k: "生效时间", v: ROW_HELP.when }, { k: "改了会怎样", v: ROW_HELP.effect }]} /></>,
      detail: "",
      amplifies: false,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      statedBrief: { impact: "之后发起的购买按新清单，进行中的试用也一样", check: "核对新增和移除，理由写清调整原因和依据。" },
      facts: (
        <div className="rd-stack">
          <DiffList rows={rows} restTitle="其余设备" />
          <Facts><Fact k="改后共">{after.value === "未添加" ? "0 款" : after.value}{after.sub && <> · {after.sub}</>}</Fact></Facts>
          {added.length > 0 && <div className="h2-money-note"><Notice tone="neutral">{MONEY_LINE}</Notice></div>}
        </div>
      ),
      initialReason: lastReason || undefined,
      blockedReason: blocked,
      reasonPlaceholder: "写清调整原因和依据",
      confirmLabel: "确认修改，立即生效",
      run: send,
    });
  };

  const pricingHref = (no: string) => `/devices/pricing?sku=${encodeURIComponent(no)}`;
  const note = [`改后共 ${picked.length} 款`, added.length > 0 && `新增 ${added.length} 款`, removed.length > 0 && `移除 ${removed.length} 款`].filter(Boolean).join(" · ");

  return (
    <>
      <Panel title={<span tabIndex={-1} data-section-focus="">可购买设备</span>} explainLabel="可购买设备" icon={Package} tone="role-2" explain={<p>{BUY_INTRO}</p>}>
        {invalid || !list ? (
          <BlockState state="error" title="可购买设备加载失败" detail="收到的数据不完整，已停止显示。" onRetry={() => void onReload()} />
        ) : (
          <>
            <ConfigList>
              <ConfigRow name="其他可购买设备" what={ROW_HELP.what} where={ROW_HELP.where} when={ROW_HELP.when} effect={ROW_HELP.effect}
                value={<>{value}{sub && <> · <span className="h2-buy-sub">{sub}</span></>}</>}
                action={canWrite ? (describedBy) => <Button size="sm" aria-label="调整 其他可购买设备" aria-describedby={describedBy} disabledReason={blocked} onClick={openDrawer}>调整</Button> : undefined} />
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
                      <Td><Cell main={item.name} sub={<span data-mono="">{item.productNo}</span>} /></Td>
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

      <Drawer open={open && !!list} onClose={() => setOpen(false)} title="调整其他可购买设备" sub="保存后立即生效" icon={SlidersHorizontal} tone="neutral"
        footer={<Decision note={note}
          others={<Button size="md" onClick={() => setOpen(false)}>取消</Button>}
          primary={<Button variant="primary" size="md" disabledReason={blocked ?? (changed ? undefined : "勾选和现在一样，没有要保存的改动")} onClick={openConfirm}>下一步：核对并保存</Button>} />}>
        <div className="h2-buy-form">
          <div className="h2-buy-checks">
            <CheckGroup legend="其他可购买设备" summary={`候选 ${candidates.length} 款`}
              explain={<><p>能勾的：在售 · 通过上架条件 · 售价大于 0 · 实体设备或云份额</p><p>开没开「允许试用」都不影响。</p></>}>
              {candidates.map((candidate) => {
                const listed = inList.has(candidate.productNo);
                const on = picked.includes(candidate.productNo);
                const disabled = !candidate.selectable && !listed;
                const mark = on && !listed ? "新增" : !on && listed ? "移除" : "";
                const reason = listed && candidate.appState === "hidden"
                  ? `${hiddenText(candidate).replace(/^商城/, "")}，App 不显示；可以保留，重新上架后自动显示`
                  : disabled ? <>不能选：{candidate.unavailableReason ?? "不符合添加条件"}{reach(pricingHref(candidate.productNo)) && <> <Link className="rd-link" href={pricingHref(candidate.productNo)} prefetch={false}>到商品管理与上架条件查看</Link></>}</> : undefined;
                return (
                  <div className="h2-buy-check" data-disabled={disabled ? "" : undefined} key={candidate.productNo}>
                    <Check checked={on} disabled={disabled} onChange={(event) => toggle(candidate.productNo, event.currentTarget.checked)}
                      label={<>
                        {candidate.name}
                        {candidate.productNo === trialTargetNo && <StatusTag tone="neutral" icon={CircleDot} explain={TARGET_TIP}>试用目标商品</StatusTag>}
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
        </div>
      </Drawer>
    </>
  );
}

export { BUY_LOCKED };
