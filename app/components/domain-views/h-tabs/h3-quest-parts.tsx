"use client";

/**
 * H3 用户任务管理的展示件：任务卡、首日时间线、每周奖励算式、阶段倍率格、App 上的样子、结果未知逐条提醒。
 * 只排版：数据由页面按后端读模型传进来，不发请求、不判权限、不改请求内容。
 * 选项表和取值小工具照旧页面 h3-quest-events.tsx 原样搬过来（那边的 H4 部分不动）。
 */
import { useState, type ReactNode } from "react";
import { Archive, CircleAlert, CircleCheck, CircleHelp, CircleSlash, Clock3, Hourglass, Smartphone } from "lucide-react";
import { Explain, MoreMenu, Segments, StatusTag, type MoreMenuItem } from "@/app/components/rd";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import type { H3QuestEventBinding } from "@/lib/admin/h-client";
import { h3Decimal } from "@/lib/admin/h3-contract";

export type QuestTask = Record<string, any>;

export type { H3Model } from "@/lib/admin/h3-contract";

// ===== 选项表：照旧页面原样 =====
export const TASK_CATEGORY_OPTIONS = ["wallet", "explore", "recommend", "identity", "social"];
export const TASK_CATEGORY_LABELS: Record<string, string> = {
  wallet: "钱包",
  explore: "探索",
  recommend: "推荐",
  identity: "身份",
  social: "社交",
};
export const TASK_ACTION_ROUTES = [
  "/pages/missions/missions",
  "/pages/me/profile",
  "/pages/me/wallet-cards-new",
  "/pages/me/wallet-topup",
  "/pages/me/wallet-exchange",
  "/pages/me/wallet-repurchase",
  "/pages/me/devices",
  "/pages/earn/earn",
  "/pages/store/store",
  "/pages/store/detail?id=stellarbox-s1",
  "/pages/team/team",
  "/pages/team/commissions",
  "/pages/learn/courses",
  "/pages/genesis/marketplace",
];
export const TASK_ACTION_ROUTE_LABELS: Record<string, string> = {
  "/pages/missions/missions": "任务中心",
  "/pages/me/profile": "个人资料",
  "/pages/me/wallet-cards-new": "绑定银行卡",
  "/pages/me/wallet-topup": "钱包充值",
  "/pages/me/wallet-exchange": "UVT / USDT 兑换",
  "/pages/me/wallet-repurchase": "锁定计划",
  "/pages/me/devices": "我的设备",
  "/pages/earn/earn": "收益",
  "/pages/store/store": "商城",
  "/pages/store/detail?id=stellarbox-s1": "UVELBox S1 详情",
  "/pages/team/team": "团队",
  "/pages/team/commissions": "奖励明细",
  "/pages/learn/courses": "学习中心",
  "/pages/staking/staking": "Staking",
  "/pages/genesis/genesis": "创世节点",
  "/pages/genesis/marketplace": "创世节点 转让市场",
};

// 只暴露 Java OpsGrowthController 已接受的规范事件，避免运营手填 JSON 或拼接事件名。
export const H3_BINDING_EVENT_PRODUCERS: Record<string, H3QuestEventBinding["producer"]> = {
  "checkout.started": "ORDER",
  H8_REFERRAL_REWARD_SETTLED: "REFERRAL",
  LEARNING_COURSE_COMPLETED: "LEARNING",
  "admin.device_activated": "DEVICE",
  COMMISSION_UNLOCKED: "COMMISSION",
  H3_STOREFRONT_THREE_PRODUCTS_VIEWED: "SYSTEM",
  H3_GENESIS_SECONDARY_MARKET_VIEWED: "SYSTEM",
  H3_COMPUTE_COMPLETED_50: "SYSTEM",
  H3_REFERRAL_REGISTERED: "SYSTEM",
  H3_EXCHANGE_COMPLETED: "SYSTEM",
  H3_DAY_ONE_PROFILE_SAVED: "SYSTEM",
  H3_DAY_ONE_CARD_BOUND: "SYSTEM",
  H3_DAY_ONE_EARN_PAGE_VIEWED: "SYSTEM",
  H3_DAY_ONE_STORE_PAGE_VIEWED: "SYSTEM",
  H3_DAY_ONE_S1_ROI_VIEWED: "SYSTEM",
};
export const H3_BINDING_EVENT_OPTIONS = Object.keys(H3_BINDING_EVENT_PRODUCERS);
export const H3_BINDING_EVENT_LABELS: Record<string, string> = {
  "checkout.started": "开始下单",
  H8_REFERRAL_REWARD_SETTLED: "邀请奖励结算",
  LEARNING_COURSE_COMPLETED: "学习课程完成",
  "admin.device_activated": "设备激活",
  COMMISSION_UNLOCKED: "团队奖励解锁",
  H3_STOREFRONT_THREE_PRODUCTS_VIEWED: "浏览3个不同商品",
  H3_GENESIS_SECONDARY_MARKET_VIEWED: "查看创世节点转让市场",
  H3_COMPUTE_COMPLETED_50: "完成50笔已验证AI任务",
  H3_REFERRAL_REGISTERED: "有效邀请注册",
  H3_EXCHANGE_COMPLETED: "完成一次兑换",
  H3_DAY_ONE_PROFILE_SAVED: "保存个人资料（首日）",
  H3_DAY_ONE_CARD_BOUND: "绑定支付卡（需服务商确认）",
  H3_DAY_ONE_EARN_PAGE_VIEWED: "查看收益页（首日）",
  H3_DAY_ONE_STORE_PAGE_VIEWED: "查看商城页（首日）",
  H3_DAY_ONE_S1_ROI_VIEWED: "查看 UVELBox S1 收益估算（首日）",
};
export const H3_BINDING_USER_FIELDS = ["user_id", "inviter_user_id"];
export const H3_BINDING_USER_FIELD_LABELS: Record<string, string> = {
  user_id: "事件发生用户",
  inviter_user_id: "邀请人",
};
const PRODUCER_LABELS: Record<string, string> = { ORDER: "订单", REFERRAL: "邀请", LEARNING: "学习", DEVICE: "设备", COMMISSION: "团队奖励", SYSTEM: "系统" };
export const producerText = (producer: string) => PRODUCER_LABELS[producer] ?? producer;

// ===== 取值小工具：照旧页面原样 =====
export function text(value: unknown, fallback = "-") {
  if (value == null || value === "") return fallback;
  return String(value);
}

export function cleanPhaseKey(value: string) {
  return value.replace(/\s*当前\s*/g, "").trim();
}

export function numericValue(value: unknown) {
  if (typeof value === "number") return value;
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function boolValue(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function casExpected(value: string) {
  const normalized = value.trim();
  return !normalized || normalized === "-" ? "__MISSING__" : normalized;
}

export function contractForTask(task: QuestTask, contracts: Array<Record<string, any>> | undefined) {
  // Mission codes are stable across legacy numeric projections and reordering.
  // A missing contract must stay missing, never borrow the adjacent task's facts.
  if (task.taskCode) return contracts?.find((item) => item.taskKey === task.taskCode) ?? {};
  return task.id == null ? {} : contracts?.find((item) => String(item.taskId) === String(task.id)) ?? {};
}

export function taskTitleText(value: string) {
  const branded = nexGridBrandText(value);
  return ({
    "Start your first order": "开始首笔订单", "Complete a qualified referral": "完成一次符合条件的邀请",
    "Complete a learning course": "完成一门课程", "Activate a device": "激活一台设备",
    "查看 UVELBox S1 ROI": "查看 UVELBox S1 预计收益", "购入 Genesis 创世节点": "购入创世节点",
    "锁仓 USDT $1,000+ 进入 365 天 Staking": "锁定不少于 1,000 USDT，参与 365 天质押",
    "扩展硬件 fleet · 加购一台": "扩充设备 · 加购一台", "首台 UVELBox · 止血 $7/天": "首台 UVELBox · 每日收益 7 美元",
  } as Record<string, string>)[branded] ?? branded;
}

// ===== 显示用的数：不舍入，不把空当 0 =====
/** 从「50 UVT」「1.1×」里取出原样的十进制数；没有数字时返回 null。 */
export function decimalOf(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  const match = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(String(value ?? "").replace(/,/g, ""));
  return match ? h3Decimal(match[0]) : null;
}

/** 十进制精确相乘，不经过浮点，不舍入；去掉末尾补的 0。 */
export function mulDecimal(...values: Array<string | null>): string | null {
  if (values.some((value) => value == null || !/^-?\d+(?:\.\d+)?$/.test(value))) return null;
  let digits = BigInt(1);
  let scale = 0;
  for (const value of values as string[]) {
    const [whole, frac = ""] = value.replace("-", "").split(".");
    digits *= BigInt(whole + frac) * BigInt(value.startsWith("-") ? -1 : 1);
    scale += frac.length;
  }
  const negative = digits < BigInt(0);
  const raw = (negative ? -digits : digits).toString().padStart(scale + 1, "0");
  const whole = raw.slice(0, raw.length - scale);
  const frac = raw.slice(raw.length - scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${BigInt(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** 十进制精确相加（奖励合计），同样不舍入。 */
export function sumDecimal(values: string[]): string | null {
  if (values.length === 0) return null;
  const scale = Math.max(...values.map((value) => (value.split(".")[1] ?? "").length));
  let total = BigInt(0);
  for (const value of values) {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
    const [whole, frac = ""] = value.split(".");
    total += BigInt(whole + frac.padEnd(scale, "0"));
  }
  const raw = total.toString().padStart(scale + 1, "0");
  return scale ? `${raw.slice(0, raw.length - scale)}.${raw.slice(raw.length - scale)}`.replace(/\.?0+$/, "") : raw;
}

/** 千分位只给整数部分，编号不走这里。 */
export function amountText(value: string | null) {
  if (value == null) return null;
  if (value.includes(",")) return value;
  const decimal = h3Decimal(value);
  if (decimal === null) return value;
  const [whole, frac] = decimal.split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
}

/** 首日三档奖励「全额 / 宽限 / 0 UVT」。读不懂时返回 null，页面照原文显示。 */
export function parseTriReward(value: unknown): { full: string; grace: string } | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\/\s*0(?:\.0+)?\s*(?:UVT)?\s*$/i.exec(String(value ?? ""));
  return match ? { full: match[1], grace: match[2] } : null;
}

/** 后端旧名称里的 NEX 按真实类型写 UVT，并标出是旧名称。 */
export function legacyAssetText(value: string): { text: string; legacy: boolean } {
  const legacy = /\bNEX\b/i.test(value);
  return { text: nexGridBrandText(value.replace(/\bNEX\b/gi, "UVT")), legacy };
}

// ===== 任务状态 =====
export type TaskStatus = "active" | "paused" | "archived";
export const taskStatusOf = (task: QuestTask): TaskStatus | "unknown" => {
  const status = text(task.status, "");
  return status === "active" || status === "paused" || status === "archived" ? status : "unknown";
};
/** 生效中但完成判定是「未绑定」：App 会下发，用户却做不完。 */
export const taskUnbound = (task: QuestTask) => text(task.completionType, "unbound") === "unbound";
export const activeUnbound = (task: QuestTask) => taskStatusOf(task) === "active" && taskUnbound(task);

export function TaskStatusTag({ task }: { task: QuestTask }) {
  const status = taskStatusOf(task);
  if (status === "active") return <StatusTag tone="ok" icon={CircleCheck} explain="已启用：之后注册的用户（首日任务）、之后发布的每周任务里会有它。已经发给用户的那一份不受影响。">已启用</StatusTag>;
  if (status === "paused") return <StatusTag tone="neutral" icon={CircleSlash} explain="已停用：之后注册和之后发布的每周任务里没有它；已经发给用户的那一份照旧。新建的任务也是这个状态。">已停用</StatusTag>;
  if (status === "archived") return <StatusTag tone="done" icon={Archive} explain="已归档：不能再启用，名称、类别和文字不能改；奖励仍可维护。归档后才能删除。">已归档</StatusTag>;
  return <StatusTag tone="warn" icon={CircleAlert} explain="后端返回了这页不认识的状态，请联系后端核对。">状态未知</StatusTag>;
}

export function unknownTag(kind: "direct" | "approval") {
  return <StatusTag tone="warn" icon={CircleHelp} explain={kind === "direct"
    ? "提交时没收到确定结果，可能已经生效。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会重复执行。"
    : "提交时没收到确定结果，可能已经建了审批单。可以查询原结果；24 小时内也可以按原请求重试，后端认得出是同一次提交，不会建第二张。"}>结果未知</StatusTag>;
}

export function pendingTag(approver = "另一位超级管理员", note = "批准前什么都不变；审批结束前这页不能再改这一项。") {
  return <StatusTag tone="warn" icon={Clock3} explain={`等${approver}在「操作记录与审批」批准。${note}`}>待审批</StatusTag>;
}

/** 申请已建单，但这次没查到审批进度：只能查询，不会重发。 */
export function acknowledgedTag() {
  return <StatusTag tone="neutral" icon={Clock3} explain="申请已建单，这次没查到审批进度。点「查询原结果」再查；不会重发。">已建单</StatusTag>;
}

export function expiredTag(kind: "direct" | "approval") {
  return <StatusTag tone="neutral" icon={Hourglass} explain={kind === "direct"
    ? "原请求超过 24 小时，不能再重试，只能查询；查询读到的是现在的值，不能据此认定原操作成没成，记录继续保留。"
    : "原申请超过 24 小时，不能再重试，只能查询原审批单。明确查不到这张单时可以解除。"}>已过期</StatusTag>;
}

// ===== 任务卡 =====
export type TaskCardProps = {
  task: QuestTask;
  name: string;
  /** 这个任务的完成条件：按 questCode 对上的绑定。 */
  bindings: H3QuestEventBinding[];
  reward: ReactNode;
  rewardNote?: ReactNode;
  localeGaps: string[];
  pending?: ReactNode;
  selected?: boolean;
  onOpen: () => void;
  primary?: ReactNode;
  menu?: MoreMenuItem[];
};

export function bindingEventText(binding: H3QuestEventBinding) {
  return H3_BINDING_EVENT_LABELS[binding.eventType] ?? binding.eventType;
}

export function TaskCard({ task, name, bindings, reward, rewardNote, localeGaps, pending, selected, onOpen, primary, menu }: TaskCardProps) {
  const status = taskStatusOf(task);
  const enabled = bindings.filter((binding) => Number(binding.status) === 1);
  const unbound = taskUnbound(task);
  const warn = status === "active" && unbound;
  const route = text(task.href, "");
  const code = text(task.taskCode ?? task.missionCode ?? task.id, "");
  return (
    <article className="h3-card" data-selected={selected ? "" : undefined} data-warn={warn ? "" : undefined} data-dim={status === "archived" ? "" : undefined} aria-label={name}>
      <header className="h3-card-head">
        <div className="h3-card-tags">
          <TaskStatusTag task={task} />
          <span className="h3-chip">{TASK_CATEGORY_LABELS[text(task.category, "").toLowerCase()] ?? "其他类别"}</span>
          {pending}
        </div>
        <h3 className="h3-card-title">
          <button type="button" className="h3-card-open" onClick={onOpen} aria-label={`看任务详情：${name}`}>{name}</button>
        </h3>
        <span className="h3-card-code" data-mono="">{code || "—"}</span>
      </header>
      <dl className="h3-card-facts">
        <div data-warn={warn ? "" : undefined}>
          <dt>做了什么算完成</dt>
          <dd>{!unbound && enabled.length > 0
            ? enabled.map(bindingEventText).join("、")
            : warn
              ? <span className="h3-card-alert"><CircleAlert size={14} aria-hidden />没绑定完成事件，用户做不完</span>
              : <span className="h3-card-muted">{bindings.length > 0 ? `没有启用的条件（${bindings.length} 条已停用）` : "还没有完成条件"}</span>}</dd>
        </div>
        <div>
          <dt>点了跳到</dt>
          <dd>{route ? TASK_ACTION_ROUTE_LABELS[route] ?? <span data-mono="">{route}</span> : "—"}</dd>
        </div>
        <div>
          <dt>奖励</dt>
          <dd className="h3-card-reward">{reward}{rewardNote && <small>{rewardNote}</small>}</dd>
        </div>
        <div>
          <dt>三语名称</dt>
          <dd>{status === "archived" ? "归档后不能改" : localeGaps.length === 0 ? "英文、中文、越南语都已填写" : `缺${localeGaps.join("、")}`}</dd>
        </div>
      </dl>
      {(primary || (menu && menu.length > 0)) && (
        <footer className="h3-card-actions">
          {primary}
          {menu && menu.length > 0 && <MoreMenu label={`${name} 的更多操作`} items={menu} />}
        </footer>
      )}
    </article>
  );
}

// ===== 首日时间线 =====
export function DayOneTimeline({ triReward, eligibilityHours }: { triReward: string; eligibilityHours: string }) {
  const tri = parseTriReward(triReward);
  const hours = /^\d+$/.test(eligibilityHours.trim()) ? Number(eligibilityHours.trim()) : null;
  const grace = hours != null && hours > 24;
  const amount = (value: string | undefined, fallback: string) => value != null
    ? <><b>{amountText(value)}</b><span>UVT</span></>
    : <b data-empty="">{fallback}</b>;
  const unset = triReward.trim() ? "读不懂" : "还没设置";
  return (
    <figure className="h3-timeline" aria-label={`首日奖励时间线，按领取时刻：注册后 24 小时内全额${tri ? ` ${tri.full} UVT` : ""}，${grace ? `到注册后 ${hours} 小时宽限${tri ? ` ${tri.grace} UVT` : ""}，` : ""}之后过期`}>
      <div className="h3-timeline-track" data-grace={grace ? String(Math.min(Math.max(Math.round((hours! - 24) / 24), 1), 6)) : "0"}>
        <div className="h3-tl-seg" data-kind="full">
          <span className="h3-tl-tick">注册</span>
          <i aria-hidden />
          <span className="h3-tl-name">全额</span>
          <span className="h3-tl-amount">{amount(tri?.full, unset)}</span>
          <span className="h3-tl-note">注册 24 小时内领</span>
        </div>
        {grace && (
          <div className="h3-tl-seg" data-kind="grace">
            <span className="h3-tl-tick">24 小时</span>
            <i aria-hidden />
            <span className="h3-tl-name">宽限</span>
            <span className="h3-tl-amount">{amount(tri?.grace, unset)}</span>
            <span className="h3-tl-note">{`注册 ${hours} 小时内领`}</span>
          </div>
        )}
        <div className="h3-tl-seg" data-kind="expired">
          <span className="h3-tl-tick">{hours == null ? "资格到期 —" : grace ? `${hours} 小时` : "24 小时"}</span>
          <i aria-hidden />
          <span className="h3-tl-name">过期</span>
          <span className="h3-tl-amount"><b data-empty="">0</b><span>UVT</span></span>
          <span className="h3-tl-note">不能再完成和领取</span>
        </div>
      </div>
      <figcaption className="h3-timeline-cap">
        按领取时离注册多久分档，全额时限固定 24 小时
        <Explain label="首日时间怎么算" content={<>
          <p>用户注册时，系统给他定下这一份首日任务：任务、完成条件、名称、类别、跳转、三档奖励、任务加成和资格期限都按那一刻的设置，之后改设置不影响他。</p>
          <p>做完全部任务才能领。按领取那一刻算：注册后不到 24 小时领拿全额；之后、资格期限到之前领拿宽限奖励；到资格期限那一刻（含）按过期处理，不能领取。做完了没及时领，会落到后一档。</p>
          <p>全额和宽限可以设成一样多，不一定「变少」。{hours == null ? "资格期限这次没读到。" : ""}</p>
        </>} />
      </figcaption>
    </figure>
  );
}

// ===== 每周奖励算式 =====
export type FormulaRow = { key: string; label: ReactNode; base: string | null; baseNote: ReactNode; result: string | null; missing?: ReactNode };

export function WeeklyFormula({ rows, h1, h1Phase, weekly, weeklyPhase, h1Link }: {
  rows: FormulaRow[];
  h1: string | null;
  h1Phase: string;
  weekly: string | null;
  weeklyPhase: string;
  h1Link: ReactNode;
}) {
  const factor = (value: string | null, unit?: string) => value == null ? <b data-empty="">—</b> : <b>{value}{unit && <span>{unit}</span>}</b>;
  return (
    <div className="h3-formula" role="table" aria-label="每周奖励怎么算">
      <div className="h3-formula-row" role="row" data-head="">
        <span role="columnheader" />
        <span role="columnheader">基础奖励</span>
        <span role="columnheader" aria-hidden />
        <span role="columnheader">任务加成</span>
        <span role="columnheader" aria-hidden />
        <span role="columnheader">每周阶段倍率</span>
        <span role="columnheader" aria-hidden />
        <span role="columnheader">乘积</span>
      </div>
      {rows.map((row) => (
        <div className="h3-formula-row" role="row" key={row.key}>
          <span role="rowheader" className="h3-formula-label">{row.label}</span>
          <span role="cell" className="h3-formula-cell">{row.base == null ? <b data-empty="">—</b> : <b>{amountText(row.base)}<span>UVT</span></b>}<small>{row.baseNote}</small></span>
          <span className="h3-formula-op" aria-hidden>×</span>
          <span role="cell" className="h3-formula-cell">{factor(h1, " 倍")}<small>{h1Phase ? `${h1Phase} · ` : ""}只读{h1Link}</small></span>
          <span className="h3-formula-op" aria-hidden>×</span>
          <span role="cell" className="h3-formula-cell">{factor(weekly, "×")}<small>{weeklyPhase ? `${weeklyPhase} 的值` : "—"}</small></span>
          <span className="h3-formula-op" aria-hidden>=</span>
          <span role="cell" className="h3-formula-cell" data-result="">{row.result == null ? <b data-empty="">—</b> : <b>{row.result}<span>UVT</span></b>}<small>{row.missing ?? "下一次每周发布时冻结"}</small></span>
        </div>
      ))}
    </div>
  );
}

// ===== 阶段倍率格 =====
export function PhaseStrip({ items, currentPhase, action }: {
  items: Array<{ p: string; mult: string | null }>;
  currentPhase: string;
  action?: (phase: string, mult: string) => ReactNode;
}) {
  return (
    <ol className="h3-phases" aria-label="每周阶段倍率">
      {items.map((item) => {
        const phase = cleanPhaseKey(item.p);
        const value = decimalOf(item.mult);
        const current = phase === currentPhase;
        return (
          <li key={item.p} className="h3-phase" data-current={current ? "" : undefined}>
            <span className="h3-phase-key">{phase}{current && <span className="h3-phase-mark">现在</span>}</span>
            <span className="h3-phase-value" data-empty={value == null ? "" : undefined}>{value == null ? "—" : <>{value}<span>×</span></>}</span>
            {action?.(phase, text(item.mult))}
          </li>
        );
      })}
    </ol>
  );
}

// ===== App 上的样子 =====
export type PreviewTask = { key: string; names: Record<"en" | "zh" | "vi", string>; source: string; category: string; route: string; reward?: string | null };
export type PreviewLocale = "zh" | "en" | "vi";

function previewName(task: PreviewTask, locale: PreviewLocale) {
  // 后端回退顺序：请求的语言 → 英文 → 原名（AppGrowthEngagementService.questState）。
  return task.names[locale] || task.names.en || task.source;
}

export function AppPreview({ kind, tasks, hero, header, footer, empty }: {
  kind: "dayOne" | "weekly";
  tasks: PreviewTask[];
  hero?: PreviewTask | null;
  header: ReactNode;
  footer?: ReactNode;
  empty: ReactNode;
}) {
  const [locale, setLocale] = useState<PreviewLocale>("zh");
  const fallback = [...(hero ? [hero] : []), ...tasks].some((task) => !task.names[locale]);
  return (
    <aside className="h3-preview" aria-label="App 上的样子">
      <div className="h3-preview-top">
        <span className="h3-preview-title"><Smartphone size={14} aria-hidden />App 上的样子
          <Explain label="这个预览怎么来的" content={<>
            <p>按现在已启用的任务和现在的设置画，示意{kind === "dayOne" ? "之后注册的用户" : "下一次发布的每周任务"}会看到什么；已经发给用户的那一份不变。</p>
            <p>没填某种语言的名称时，App 先用英文，再用原名，不自动翻译。</p>
            {kind === "weekly" && <p>App 首页只显示排在最前面的一个一档任务；金额在 App 里会取整显示，实际到账按冻结倍率算，最多保留 6 位小数。</p>}
          </>} />
        </span>
        <Segments label="预览语言" value={locale} onChange={setLocale} items={[
          { value: "zh", label: "中文" },
          { value: "en", label: "EN" },
          { value: "vi", label: "VI" },
        ]} />
      </div>
      <div className="h3-phone">
        <div className="h3-phone-head">{header}</div>
        {hero === null && kind === "weekly" && tasks.length === 0
          ? <p className="h3-phone-empty">{empty}</p>
          : <>
            {hero && (
              <div className="h3-phone-hero">
                <span className="h3-phone-cat">{TASK_CATEGORY_LABELS[hero.category] ?? "其他"}</span>
                <b>{previewName(hero, locale)}</b>
                <span className="h3-phone-reward">{hero.reward == null ? "—" : `+${hero.reward} UVT`}</span>
                <span className="h3-phone-go">去完成 ›</span>
              </div>
            )}
            {tasks.length === 0 && kind === "dayOne" && <p className="h3-phone-empty">{empty}</p>}
            {tasks.length > 0 && (
              <ul className="h3-phone-list">
                {tasks.map((task) => (
                  <li key={task.key}>
                    <span className="h3-phone-cat">{TASK_CATEGORY_LABELS[task.category] ?? "其他"}</span>
                    <span className="h3-phone-name">{previewName(task, locale)}</span>
                    {task.reward !== undefined && <span className="h3-phone-reward">{task.reward == null ? "—" : `+${task.reward}`}</span>}
                    <span className="h3-phone-go" aria-label={`点了跳到${TASK_ACTION_ROUTE_LABELS[task.route] ?? task.route}`}>›</span>
                  </li>
                ))}
              </ul>
            )}
          </>}
        {footer && <div className="h3-phone-foot">{footer}</div>}
      </div>
      {fallback && <p className="h3-preview-note">有任务没填{locale === "zh" ? "中文" : locale === "en" ? "英文" : "越南语"}名称，这里按 App 的回退显示</p>}
    </aside>
  );
}

// ===== 原操作逐条提醒：结果未知、待审批、已建单、已过期（和 G 域、H7 同一排法） =====
export type H3RecoveryRow = { key: string; name: string; change: ReactNode; submittedAt?: number; tag: ReactNode; actions: ReactNode };

export function H3RecoveryList({ rows }: { rows: H3RecoveryRow[] }) {
  if (rows.length === 0) return null;
  const timed = rows.some((row) => row.submittedAt !== undefined);
  return (
    <>
      <ul className="h3-rec" aria-label="原操作">
        {rows.map((row) => (
          <li key={row.key}>
            <span className="h3-rec-name">{row.name}</span>
            <span className="h3-rec-change">{row.change}</span>
            <span className="h3-rec-time">{row.submittedAt === undefined ? "" : `${businessStamp(row.submittedAt)} 提交`}</span>
            <span className="h3-rec-state">{row.tag}</span>
            <span className="h3-rec-actions">{row.actions}</span>
          </li>
        ))}
      </ul>
      {timed && <p className="h3-rec-zone">提交时间为{businessZone().label}</p>}
    </>
  );
}
