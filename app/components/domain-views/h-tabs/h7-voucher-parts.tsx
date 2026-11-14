"use client";

/**
 * H7 代金券的展示件：金额和时间的写法、券面、券卡、使用情况条、结果未知提醒。
 * 只管排版，不发请求、不改数据；按钮调用页面传进来的处理函数。
 */
import type { ReactNode } from "react";
import { CalendarClock, CheckCircle2, CircleHelp, Clock3, Hourglass, PauseCircle, TriangleAlert } from "lucide-react";
import { Button, Explain, Notice, SegmentBar, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";

import type { H7Voucher } from "@/lib/admin/h-client";
import { h7Stamp } from "@/lib/admin/h7-voucher-time";
export type { H7Voucher } from "@/lib/admin/h-client";

export const SURFACE_LABEL: Record<string, string> = { home: "首页", store: "商城", me: "我的", earn: "收益" };
export const AUDIENCE_LABEL = { new: "新用户", all: "全部用户" } as const;
/** 下单时按 USDT 抵扣（字段名是 USD，这条链路没有换汇）。 */
export const UNIT = "USDT";

/** 后端原值照写：整数部分加千分位，小数位不舍入，最少两位。读不到写「—」。 */
export function amountText(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const raw = String(value);
  if (/e/i.test(raw)) return value.toLocaleString("en-US", { maximumFractionDigits: 20 });
  const [int, frac = ""] = raw.replace(/^-/, "").split(".");
  return `${value < 0 ? "-" : ""}${Number(int).toLocaleString("en-US")}.${frac.padEnd(2, "0")}`;
}

export const countText = (value: number) => value.toLocaleString("en-US");

/** 按真实毫秒显示北京时间；0 是立即／长期的合同哨兵。 */
export function startText(ms: number) { return ms ? h7Stamp(ms) : "立即"; }
export function endText(ms: number) { return ms ? h7Stamp(ms) : "长期有效"; }
export function periodText(v: Pick<H7Voucher, "startAt" | "endAt">) {
  if (!v.startAt && !v.endAt) return "长期有效";
  if (!v.startAt) return `至 ${h7Stamp(v.endAt)}`;
  if (!v.endAt) return `${h7Stamp(v.startAt)} 起，长期有效`;
  return `${h7Stamp(v.startAt)} 至 ${h7Stamp(v.endAt)}`;
}

/** 券面的大字：满减写面额，折扣写「减 8%」（App 显示「8% 折扣」，意思是按订单金额减 8%）。 */
export function faceValue(v: Pick<H7Voucher, "type" | "amountUSD" | "percent">): { value: string; unit?: string; kind: string } {
  return v.type === "fixed"
    ? { value: amountText(v.amountUSD), unit: UNIT, kind: "满减券" }
    : { value: v.percent == null ? "—" : `减 ${v.percent}%`, kind: "折扣券" };
}

/** 门槛和封顶两类券都生效（后端核销两项都检查），有就写。 */
export function conditionLines(v: Pick<H7Voucher, "type" | "minPurchaseUSD" | "maxDiscountUSD">): string[] {
  const min = v.minPurchaseUSD ?? 0, max = v.maxDiscountUSD ?? 0;
  return [
    min > 0 ? `满 ${amountText(min)} ${UNIT} 可用` : "无门槛",
    ...(max > 0 ? [`最多减 ${amountText(max)} ${UNIT}`] : v.type === "percent" ? ["不封顶"] : []),
  ];
}

export function skuText(skus: readonly string[], labels: Record<string, string>): string {
  if (skus.length === 0) return "全部商品";
  if (skus.length === 1) return labels[skus[0]] ?? "指定商品（已不在当前目录）";
  return `${skus.length} 个商品`;
}

export const surfacesText = (surfaces: readonly string[]) => surfaces.map((s) => SURFACE_LABEL[s] ?? "其他页面").join("、") || "不限入口";

/** 一句人话：这张券最后是什么意思。 */
export function voucherSentence(v: Pick<H7Voucher, "type" | "amountUSD" | "percent" | "minPurchaseUSD" | "maxDiscountUSD" | "applicableSkus" | "audience" | "startAt" | "endAt">, labels: Record<string, string>): string {
  const min = v.minPurchaseUSD ?? 0, max = v.maxDiscountUSD ?? 0;
  const gate = min > 0 ? `订单满 ${amountText(min)} ${UNIT}` : "不限订单金额";
  const benefit = v.type === "fixed"
    ? `减 ${amountText(v.amountUSD)} ${UNIT}${max > 0 ? `（最多减 ${amountText(max)} ${UNIT}）` : ""}`
    : `按订单金额减 ${v.percent ?? "—"}%${max > 0 ? `，最多减 ${amountText(max)} ${UNIT}` : "，不封顶"}`;
  const scope = v.applicableSkus.length === 0 ? "所有商品都能用" : v.applicableSkus.length <= 3
    ? `只能用于 ${v.applicableSkus.map((id) => labels[id] ?? `已不在目录的商品（${id}）`).join("、")}`
    : `只能用于选中的 ${v.applicableSkus.length} 个商品`;
  const who = v.audience === "new" ? "发给新用户" : "发给全部用户";
  const period = periodText(v);
  return `${gate}，${benefit}；${scope}；${who}；${period === "长期有效" ? "长期有效" : `有效期 ${period}`}。`;
}

export type H7Phase = "expired" | "upcoming" | "running";
export function voucherPhase(v: Pick<H7Voucher, "startAt" | "endAt">, now: number): H7Phase {
  if (v.endAt > 0 && v.endAt < now) return "expired";
  if (v.startAt > 0 && v.startAt > now) return "upcoming";
  return "running";
}
export const limitReached = (v: Pick<H7Voucher, "issuanceLimit" | "issuedCount">) => v.issuanceLimit > 0 && v.issuedCount >= v.issuanceLimit;

/** 状态标签：投放状态之外，过期、未开始、发完各一枚；过期的不再写「投放中」。 */
export function VoucherTags({ v, now, showPending = true }: { v: H7Voucher; now: number; showPending?: boolean }) {
  const phase = voucherPhase(v, now);
  return (
    <span className="h7-tags">
      {showPending && v.pendingApproval && pendingTag(v.pendingApproval.action)}
      {phase === "expired"
        ? <StatusTag tone="done" icon={Hourglass} explain={`有效期已过，用户不能再领，已领到的也不能再用。模板状态还是「${v.status === "active" ? "投放中" : "已暂停"}」。`}>已过期</StatusTag>
        : v.status === "active"
          ? <StatusTag tone="ok" icon={CheckCircle2} explain="用户可以领；还要符合有效期、发给谁、发行上限和领取入口。">投放中</StatusTag>
          : <StatusTag tone="done" icon={PauseCircle} explain="用户不能再领；已领到的不收回，有效期内仍能用。">已暂停</StatusTag>}
      {phase === "upcoming" && <StatusTag tone="progress" icon={CalendarClock}>{`${h7Stamp(v.startAt).slice(5, 10)} 开始`}</StatusTag>}
      {phase !== "expired" && limitReached(v) && <StatusTag tone="warn" icon={TriangleAlert} explain="已发出的张数到了发行上限，用户领不到了；作废或用掉的也占上限。要继续发，调高发行上限。">已发完</StatusTag>}
    </span>
  );
}

/** 券面：类型、大字、门槛和封顶。卡片、详情、填写预览共用。 */
export function VoucherFace({ v, size = "card" }: { v: Pick<H7Voucher, "type" | "amountUSD" | "percent" | "minPurchaseUSD" | "maxDiscountUSD">; size?: "card" | "large" }) {
  const face = faceValue(v);
  return (
    <div className="h7-face" data-size={size} data-type={v.type}>
      <span className="h7-face-kind">{face.kind}</span>
      <strong className="h7-face-value" data-empty={face.value === "—" ? "" : undefined}><span className="h7-face-num">{face.value}</span>{face.unit && <small>{face.unit}</small>}</strong>
      <span className="h7-face-cond">{conditionLines(v).join("\n")}</span>
    </div>
  );
}

/** 使用情况：已发出的张数按已使用、未使用、已作废分成三段，分母是已发出。 */
export function UsageBar({ v }: { v: H7Voucher }) {
  const sum = v.availableCount + v.redeemedCount + v.revokedCount;
  return (
    <div className="h7-usage">
      <div className="h7-usage-head">
        <span>已使用 <b>{countText(v.redeemedCount)}</b><span className="h7-usage-of"> / 已发出 {countText(v.issuedCount)} 张</span></span>
        <span className="h7-usage-limit">{v.issuanceLimit > 0 ? `上限 ${countText(v.issuanceLimit)} 张` : "不限量"}</span>
      </div>
      {v.issuedCount === 0
        ? <p className="h7-usage-empty">还没有发出</p>
        : sum !== v.issuedCount
          ? <p className="h7-usage-empty">三项合计和已发出对不上，不画比例；请刷新后再看</p>
          : <SegmentBar label="已发出的券" quiet segments={[
            { key: "used", label: "已使用", value: v.redeemedCount, slot: 2, text: `已使用 ${countText(v.redeemedCount)}` },
            { key: "available", label: "未使用", value: v.availableCount, slot: 1, text: `未使用 ${countText(v.availableCount)}` },
            { key: "revoked", label: "已作废", value: v.revokedCount, slot: "other", text: `已作废 ${countText(v.revokedCount)}` },
          ]} />}
    </div>
  );
}

export function VoucherCard({ v, now, skuLabels, selected, onOpen, actions }: { v: H7Voucher; now: number; skuLabels: Record<string, string>; selected?: boolean; onOpen: () => void; actions?: ReactNode }) {
  const phase = voucherPhase(v, now);
  return (
    <article className="h7-card" data-dim={phase === "expired" || v.status === "paused" ? "" : undefined} data-selected={selected ? "" : undefined} aria-label={v.name}>
      <div className="h7-ticket">
        <VoucherFace v={v} />
        <div className="h7-card-body">
          <div className="h7-card-title">
            <h3 className="h7-name" title={v.name}>{v.name}</h3>
            <VoucherTags v={v} now={now} />
          </div>
        </div>
      </div>
      <dl className="h7-card-meta">
        <div><dt>适用</dt><dd title={v.applicableSkus.map((id) => skuLabels[id] ?? id).join("、") || undefined}>{skuText(v.applicableSkus, skuLabels)} · {AUDIENCE_LABEL[v.audience]}</dd></div>
        <div><dt>有效期</dt><dd>{periodText(v)}</dd></div>
      </dl>
      <UsageBar v={v} />
      <div className="h7-card-actions">
        {actions}
        <Button size="sm" variant="ghost" aria-label={`详情 ${v.name}`} onClick={onOpen}>详情</Button>
      </div>
    </article>
  );
}

/** 结果未知的一行：处置是什么、哪张券、什么时候提交的、现在怎样、能做什么。 */
export type H7RecoveryRow = { key: string; name: string; object: ReactNode; submittedAt?: number; tag: ReactNode; ticket?: string; actions: ReactNode };

export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会重复执行。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会建第二张。"}>结果未知</StatusTag>;
}

export function pendingTag(action?: string | null) {
  return <StatusTag tone="warn" icon={Clock3} explain="等另一位管理员在「操作记录与审批」批准。批准前券模板和已发出的券都不变，这张券也不能编辑、暂停或投放。">{action ? `${action}待审批` : "待审批"}</StatusTag>;
}

export function expiredTag() {
  return <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试，只能查询原审批单。查不到也不能据此认定没提交。">已过期</StatusTag>;
}

export function H7RecoveryNotice({ title, explain, rows, link }: { title: ReactNode; explain: ReactNode; rows: H7RecoveryRow[]; link?: ReactNode }) {
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>{title}<Explain label="原申请怎么处理" content={explain} /></>}>
      <ul className="h7-rec" aria-label="原申请">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="h7-rec-name">{row.name}</span>
            <span className="h7-rec-object">{row.object}</span>
            <span className="h7-rec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="h7-rec-state">{row.tag}{row.ticket && <span className="h7-rec-ticket">审批单 <span data-mono="">{row.ticket}</span></span>}</span>
            <span className="h7-rec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      <p className="h7-rec-zone">提交时间为{businessZone().label}{link && <> · {link}</>}</p>
    </Notice>
  );
}
