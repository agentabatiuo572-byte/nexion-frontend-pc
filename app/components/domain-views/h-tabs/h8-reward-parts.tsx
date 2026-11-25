"use client";

/**
 * 新人礼与邀请奖励的展示件：金额写法、一笔奖励的去向图、原操作提醒、「已保存，但没读到最新值」提醒。
 * 只管排版，不发请求、不判权限；数据和按钮都由页面传进来。
 */
import type { ReactNode } from "react";
import { CircleHelp, Clock3, Hourglass } from "lucide-react";
import { Explain, KeepText, Notice, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { amountDisplay } from "@/lib/format";

/** 后端金额是普通十进制串（最多 6 位小数）。去掉补的末尾 0，至少 2 位，整数带千分位；不经过浮点，不舍入。 */
export function amountParts(raw: string | number | undefined | null) {
  const text = raw === undefined || raw === null ? "" : String(raw).trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  return { int: match[1].replace(/^0+(?=\d)/, ""), frac: (match[2] ?? "").replace(/0+$/, "") };
}

/** 同一组金额按其中最多的实际小数位对齐，最少 2 位。 */
export function decimalsOf(...values: Array<string | number | undefined | null>) {
  return Math.max(2, ...values.map((value) => amountParts(value)?.frac.length ?? 0));
}

/** 金额按全站写法（amountDisplay）：千分位、去掉末尾 0、整数不写小数点，不为对齐补零；decimals 是旧的对齐位数，不再使用。 */
export function amountText(raw: string | number | undefined | null, _decimals?: number) {
  const parts = amountParts(raw);
  if (!parts) return "—";
  return amountDisplay(`${parts.int}${parts.frac ? `.${parts.frac}` : ""}`);
}

/** 倍率写「×1.5」：去掉补的末尾 0，不补位。 */
export function multiplierText(raw: string | number | undefined | null) {
  const parts = amountParts(raw);
  if (!parts) return "—";
  return `×${parts.int}${parts.frac ? `.${parts.frac}` : ""}`;
}

export function countText(value: number | undefined | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("zh-CN") : "—";
}

/** 一个金额：数字加单位，悬停看后端原值。 */
export function Amount({ value, unit, decimals }: { value: string | number | undefined | null; unit: string; decimals?: number }) {
  const text = amountText(value, decimals);
  if (text === "—") return <span className="h8-amount" data-empty="">—</span>;
  return <span className="h8-amount" title={`系统记录的原值 ${String(value)} ${unit}`}><span>{text}</span><small>{unit}</small></span>;
}

/**
 * 一笔奖励的去向：注册 → 风控筛选 → 结算审批 → 进钱包或先冻结。
 * 看它能判断：用户说没收到新人礼时，卡在哪一步、该去哪查。
 */
export function RewardFlow({ pending, blocked, settled, mode }: { pending: ReactNode; blocked: ReactNode; settled: ReactNode; mode: string }) {
  return (
    <ol className="h8-flow" aria-label="一笔奖励的去向">
      <li className="h8-flow-step">
        <span className="h8-flow-mark" aria-hidden>1</span>
        <div className="h8-flow-body">
          <span className="h8-flow-title">新人注册
            <Explain label="哪些注册会进入结算" content={<>
              <p>生效时间起（含这一刻）注册的正式账号才会进入结算，之前注册的不再进入结算。</p>
              <p>没有邀请人的新人也有新人礼；这时邀请人那一份不发。</p>
            </>} />
          </span>
          <span className="h8-flow-sub">生效时间起注册的，有没有邀请人都算</span>
        </div>
      </li>
      <li className="h8-flow-step">
        <span className="h8-flow-mark" aria-hidden>2</span>
        <div className="h8-flow-body">
          <span className="h8-flow-title">风控筛选
            <Explain label="风控筛选拦什么" content={<>
              <p><KeepText text="两种发放方式都拦：账户被标记的，账户组被标记或冻结的，在「异常套利与刷量排查」被拦截新人礼的。" phrases={["账户组被标记或冻结的，", "在「异常套利与刷量排查」被拦截新人礼的。"]} /></p>
              <p>现在是「{mode}」。{mode === "先过风险检查再发" ? "命中待复核风险的也先不发。" : "只跳过待复核这一层，上面这些照样拦。"}</p>
            </>} />
          </span>
          <span className="h8-flow-branch">
            <span>通过 → 待结算 <b>{pending}</b></span>
            <span>拦下 → 被风控拦下 <b>{blocked}</b></span>
          </span>
        </div>
      </li>
      <li className="h8-flow-step">
        <span className="h8-flow-mark" aria-hidden>3</span>
        <div className="h8-flow-body">
          <span className="h8-flow-title">结算
            <Explain label="结算怎么发生" content={<>
              <p>不会自动结算。要有结算权限的人在这页提交批量或指定新人的结算审批，另一位超级管理员在「操作记录与审批」批准后才发。</p>
              <p>批准时按当时的名单，从最早注册的开始发；奖励配置在这期间变了，要重新提交。</p>
            </>} />
          </span>
          <span className="h8-flow-sub">提交审批，批准后发 · 已结算 <b>{settled}</b></span>
        </div>
      </li>
      <li className="h8-flow-step" data-split="">
        <span className="h8-flow-mark" aria-hidden>4</span>
        <div className="h8-flow-body">
          <span className="h8-flow-title">到用户手里
            <Explain label="已结算为什么还没拿到" content={<>
              <p>已结算不等于新人已经拿到可以提现的钱。</p>
              <p>注册时被标了首购冻结的，新人礼先冻结，等这位新人完成第一笔金额大于 0 的实付订单才解冻，仍受发放方式和覆盖率条件约束；奖励关了以后也会解冻。</p>
              <p>不冻结的和解冻后的，按收益规则分到可提现、待审核或锁定。邀请人那一份同时进邀请人钱包。两边都记进资金账本。</p>
            </>} />
          </span>
          <span className="h8-flow-lanes">
            <span>首购冻结的：先冻结 → 首笔实付订单后解冻</span>
            <span>其余：进钱包，按收益规则分可提现、待审核或锁定</span>
          </span>
        </div>
      </li>
    </ol>
  );
}

export type H8RecoveryRow = {
  key: string;
  /** 改的是什么。 */
  name: string;
  /** 从多少到多少，写人话。 */
  change: ReactNode;
  /** 本机记下这次提交的时间（毫秒）。 */
  submittedAt?: number;
  tag: ReactNode;
  settled?: boolean;
  actions?: ReactNode;
};

export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。到「操作记录与审批」核对；24 小时内可以按原操作重试，不会重复执行。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原操作；24 小时内也可以按原操作重试，不会建第二张。"}>结果未知</StatusTag>;
}

export function expiredTag(kind: "direct" | "approval") {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "direct"
    ? "已超过 24 小时，不能再重试，只能到「操作记录与审批」核对。"
    : "过了 24 小时只能查询、不能再重试；重试被明确拒绝的，核实后可以解除。"}>已过期</StatusTag>;
}

export function pendingTag() {
  return <StatusTag tone="warn" icon={Clock3} explain="等另一位超级管理员在「操作记录与审批」批准。批准前奖励配置不变；等批期间这页不能再发起别的放大修改，调低这类收紧照常保存。">待审批</StatusTag>;
}

/** 原操作提醒：逐条写改的是什么、从多少到多少、什么时候提交的、现在什么状态。概览读取中、读取失败也显示。 */
export function H8RecoveryNotice({ rows }: { rows: H8RecoveryRow[] }) {
  if (rows.length === 0) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  return (
    <Notice tone="warn" title={<>{rows.every(row => row.settled) ? "原操作未执行的草稿" : rows.some(row => row.settled) ? "原操作与草稿" : `还没有结论的原操作 · ${rows.length} 项`}<Explain label="原操作怎么处理" content={<>
      <p>这里列你在这个浏览器标签页里提交过、还没收到确定结果的修改和结算申请。</p>
      <p>原操作有结论之前，这一项不能改成别的值。有参数审批在等批时，别的项也只能收紧、不能放大。别人提交的审批单不在这里，到「操作记录与审批」看。</p>
    </>} /></>}>
      <ul className="h8-rec" aria-label="原操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="h8-rec-name">{row.name}</span>
            <span className="h8-rec-change">{row.change}</span>
            <span className="h8-rec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="h8-rec-state">{row.tag}</span>
            <span className="h8-rec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {timed && <p className="h8-rec-zone">提交时间为{businessZone().label}</p>}
    </Notice>
  );
}

/**
 * 「已保存，但没读到最新值」（F02）：保存的回执收到了，但随后的读取失败。
 * 现在的保存流程还进不了这个状态（回读失败时整页换成读取失败），等代码 worker 区分后挂在结论下面。
 */
export function H8SavedUnreadNotice({ name, value, onReload, reloading, hasData }: { name: string; value: ReactNode; onReload: () => void; reloading?: boolean; hasData: boolean }) {
  return (
    <Notice tone="warn" title={`${name}已保存，但没读到最新值`}
      action={<button type="button" className="rd-inline-retry" disabled={reloading} onClick={onReload}>重新读取</button>}>
      保存后的结果是 {value}。{hasData ? "页面上的其他数字还是保存前读到的，重新读取后再核对。" : "页面现在没有读到的数字，重新读取后再核对。"}
    </Notice>
  );
}
