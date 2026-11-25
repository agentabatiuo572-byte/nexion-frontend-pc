"use client";

/**
 * H7 代金券的展示件：金额和时间的写法、券面、券卡、使用情况条、结果未知提醒。
 * 只管排版，不发请求、不改数据；按钮调用页面传进来的处理函数。
 */
import { useState, type ReactNode } from "react";
import { CalendarClock, CheckCircle2, CircleHelp, Clock3, Dices, Hourglass, PauseCircle, TriangleAlert } from "lucide-react";
import { Button, Explain, Fact, Facts, Fold, Notice, SegmentBar, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";

import type { H7PendingApproval, H7Voucher } from "@/lib/admin/h-client";
import { h7DateFacts, h7Stamp, isH7VoucherExpired } from "@/lib/admin/h7-voucher-time";
import { amountDisplay } from "@/lib/format";
export type { H7Voucher } from "@/lib/admin/h-client";

export const SURFACE_LABEL: Record<string, string> = { home: "首页", store: "商城", me: "我的", earn: "收益" };
export const AUDIENCE_LABEL = { new: "新用户", all: "全部用户" } as const;
/** 下单时按 USDT 抵扣（字段名是 USD，这条链路没有换汇）。 */
export const UNIT = "USDT";

/** 后端原值按全站金额写法（amountDisplay）：千分位，去掉末尾 0、整数不写小数点，不舍入。读不到写「—」。 */
export function amountText(value: number | undefined | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return amountDisplay(value);
}

export const countText = (value: number) => value.toLocaleString("en-US");

/** 按真实毫秒显示北京时间；0 是立即／长期的合同哨兵。 */
export function startText(ms: number) { return ms ? h7Stamp(ms) : "立即"; }
export function endText(ms: number) { return ms ? h7Stamp(ms) : "长期有效"; }
/** 改版前建的券起止不在北京时间整天的边界上（比如止于早上 8 点）：详情里写明不是整天。 */
export function startDetailText(ms: number) { return ms && !h7DateFacts(ms).wholeDayBoundary ? `${h7Stamp(ms)}（不是当天 0 点）` : startText(ms); }
export function endDetailText(ms: number) { return ms && !h7DateFacts(ms, true).wholeDayBoundary ? `${h7Stamp(ms)}（不是当天结束）` : endText(ms); }
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

/** 转盘专发券：四个自领入口都拒绝，只有幸运转盘中奖能发；它的空入口不是「不限」。PC 保存不改这一项。 */
export const WHEEL_ONLY_TEXT = "仅转盘发放";
export const WHEEL_ONLY_HELP = "用户不能自己领，只在幸运转盘中奖时发到钱包。";
/** 转盘抽中时券发不出（暂停、过期、发完），这次抽奖整体报错，不会换成别的奖。 */
export const WHEEL_STOP_HINT = "要停发这张券，先在「活动中心」的转盘奖池把这一档的概率调成 0，或先关闭转盘。";

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
  if (isH7VoucherExpired(v.endAt, now)) return "expired";
  if (v.startAt > 0 && v.startAt > now) return "upcoming";
  return "running";
}
export const limitReached = (v: Pick<H7Voucher, "issuanceLimit" | "issuedCount">) => v.issuanceLimit > 0 && v.issuedCount >= v.issuanceLimit;

/** 状态标签：投放状态之外，过期、未开始、发完各一枚；过期的不再写「投放中」。 */
export function VoucherTags({ v, now, showPending = true }: { v: H7Voucher; now: number; showPending?: boolean }) {
  const phase = voucherPhase(v, now);
  const wheelOnly = v.wheelOnly;
  return (
    <span className="h7-tags">
      {showPending && v.pendingApproval && pendingTag(v.pendingApproval)}
      {phase === "expired"
        ? <StatusTag tone="done" icon={Hourglass} explain={wheelOnly ? `有效期已过，转盘抽中这一档会发券失败。${WHEEL_STOP_HINT}` : v.status === "active" ? "有效期已过，用户不能再领，已领到的也不能再用。模板状态还是「投放中」。" : "有效期已过，用户不能再领，已领到的也不能再用。已暂停的不能投放，先编辑有效期。"}>已过期</StatusTag>
        : v.status === "active"
          ? <StatusTag tone="ok" icon={CheckCircle2} explain={wheelOnly ? "用户在幸运转盘抽中这一档时发到钱包；还要在有效期内、没到发行上限。" : "用户可以领；还要符合有效期、发给谁、发行上限和领取入口。"}>投放中</StatusTag>
          : <StatusTag tone="done" icon={PauseCircle} explain={wheelOnly ? `转盘抽中这一档会发券失败；已领到的不收回，有效期内仍能用。${WHEEL_STOP_HINT}` : "用户不能再领；已领到的不收回，有效期内仍能用。"}>已暂停</StatusTag>}
      {wheelOnly && <StatusTag tone="neutral" icon={Dices} explain={WHEEL_ONLY_HELP}>{WHEEL_ONLY_TEXT}</StatusTag>}
      {phase === "upcoming" && <StatusTag tone="progress" icon={CalendarClock}>{`${h7Stamp(v.startAt).slice(5, 10)} 开始`}</StatusTag>}
      {phase !== "expired" && limitReached(v) && <StatusTag tone="warn" icon={TriangleAlert} explain={wheelOnly ? `已发出的张数到了发行上限，转盘抽中这一档会发券失败。${WHEEL_STOP_HINT}` : "已发出的张数到了发行上限，用户领不到了；作废或用掉的也占上限。要继续发，调高发行上限。"}>已发完</StatusTag>}
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

/** 原操作的一行：做的是什么、哪张券、改了什么、什么时候提交的、现在怎样、能做什么。 */
export type H7RecoveryRow = { key: string; name: string; object: ReactNode; change?: ReactNode; submittedAt?: number; tag: ReactNode; ticket?: string; actions: ReactNode; note?: ReactNode; original?: { reason: string; commandKey: string } };

export const H7_DIRECT_RETRY_COPY = "按原操作重试会用原编号、原内容、原理由重新发送一次，已成功的不会重复执行。";

export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可读取当前配置供核对，24 小时内可按原操作重试。"
    : "提交时没收到确定结果，可能已经建了审批单。先查询原结果；明确查不到、没过 24 小时才能按原操作重试，不会建第二张。"}>结果未知</StatusTag>;
}

/** 后端读到的审批锁：读得出单子就写是哪张、谁什么时候提交的；四项都是空的只说明有锁。 */
export function pendingFacts(pending: H7PendingApproval) {
  if (!pending.action && !pending.ticketId && !pending.submittedBy && !pending.submittedAt) return null;
  return [pending.ticketId && `审批单 ${pending.ticketId}`, pending.submittedBy && `${pending.submittedBy} 提交`,
    pending.submittedAt && `${formatBusinessTimeCompact(pending.submittedAt, "—")}（${businessZone().label}）`].filter(Boolean).join(" · ");
}

export function pendingTag(pending?: H7PendingApproval | null) {
  const facts = pending ? pendingFacts(pending) : "";
  if (pending && facts === null) {
    return <StatusTag tone="warn" icon={Clock3} explain="系统显示这张券有一张没结束的审批，但读不到是哪张单、谁提交的；到「操作记录与审批」核对。审批结束前不能编辑、暂停、投放、删除或作废。">审批锁定</StatusTag>;
  }
  // 卡片上只写动作：「删除代金券」→ 删除，「作废未使用的代金券」→ 作废；全名在说明里。
  const short = pending?.action?.replace(/未使用的代金券$|代金券$/, "");
  return <StatusTag tone="warn" icon={Clock3} explain={`${pending?.action ? `${pending.action}：` : ""}等另一位管理员在「操作记录与审批」批准。${facts ? `${facts}。` : ""}批准前券模板和已发出的券都不变，这张券也不能编辑、暂停或投放。`}>{short ? `${short}待审批` : "待审批"}</StatusTag>;
}

/** 申请已建单，但这次没查到审批进度：只能查询，不会重发。 */
export function acknowledgedTag() {
  return <StatusTag tone="neutral" icon={Clock3} explain="申请已建单，这次没查到审批进度。点「查询原结果」再查；不会重发。">已建单</StatusTag>;
}

export function expiredTag() {
  return <StatusTag tone="neutral" icon={Hourglass}>已过期</StatusTag>;
}

export function H7RecoveryNotice({ title, explain, rows, link }: { title: ReactNode; explain: ReactNode; rows: H7RecoveryRow[]; link?: ReactNode }) {
  // 多条时默认露出三条，其余点开再看，首屏留给券（提示不盖正事）。
  const [all, setAll] = useState(false);
  if (rows.length === 0) return null;
  return (
    <Notice tone="warn" title={<>{title}<Explain label="原申请怎么处理" content={explain} /></>}>
      <ul className="h7-rec" aria-label="原申请">
        {(all ? rows : rows.slice(0, 3)).map((row) => (
          <li key={row.key}>
            <span className="h7-rec-name">{row.name}</span>
            <span className="h7-rec-object">{row.object}{row.change && <span className="h7-rec-change">{row.change}</span>}</span>
            <span className="h7-rec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="h7-rec-state">{row.tag}{row.ticket && <span className="h7-rec-ticket">审批单 <span data-mono="">{row.ticket}</span></span>}</span>
            <span className="h7-rec-actions">{row.actions}</span>
            {/* 原理由是要核对的事实，常显；编号只在查证时用，收进技术信息（OP-93、OP-154）。 */}
            {row.original && <span className="h7-rec-reason"><span>原理由</span>{row.original.reason}</span>}
            {row.note && <span className="h7-rec-note">{row.note}</span>}
            {row.original && <div className="h7-rec-tech"><Fold title="技术信息" summary="操作编号" tone="role-4" inset>
              <Facts>
                <Fact k="操作编号"><span data-mono="">{row.original.commandKey}</span></Fact>
              </Facts>
            </Fold></div>}
          </li>
        ))}
      </ul>
      {rows.length > 3 && <Button size="sm" variant="ghost" onClick={() => setAll((open) => !open)}>{all ? "只看前 3 条" : `显示全部 ${rows.length} 条`}</Button>}
      <p className="h7-rec-zone">提交时间为{businessZone().label}{link && <> · {link}</>}</p>
    </Notice>
  );
}
