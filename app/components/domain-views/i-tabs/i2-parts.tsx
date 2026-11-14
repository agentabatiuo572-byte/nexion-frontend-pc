"use client";

/**
 * I2 Nova 消息推送的展示件：频道卡、App 里的消息样子、概率条（可拖）、文字换算。
 * 这里只管怎么画，不发请求、不判权限；数字和状态都由 i2-nova.tsx 传进来。
 */
import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { Bell, Clock, FileText, Radio, Timer, UserRound } from "lucide-react";
import { Explain, StatusTag } from "@/app/components/rd";
import { NOVA_TIME_UNITS, parseNovaDuration } from "@/lib/admin/nova-cadence";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import type { NovaOptionView, NovaSocialEventView, NovaTemplateView } from "@/lib/admin/i-client";

/** 后端 seed 的内置频道写人话名字；新建的频道用运营填的名字。 */
export const CHANNEL_NAME: Record<string, string> = {
  welcome: "欢迎消息", market: "市场动态", upgrade: "设备升级建议", dailySummary: "每日汇总", tradein: "升级置换",
  social: "真实动态", eventClaim: "活动领奖", taskLockMonthly: "月度任务提醒",
};
export const channelName = (key: string, name: string) => name.trim() || CHANNEL_NAME[key] || key;
/** 跟着运营阶段换个人间隔的两个频道，整条配置在「运营阶段设置」里改。 */
export const PHASE_CHANNELS = new Set(["tradein", "taskLockMonthly"]);
/** 用真实事件取材、按五类概率抽的那个频道。 */
export const SOCIAL_CHANNEL = "social";

const SOURCE_TEXT: Record<string, string> = {
  "a4:staking.opened": "有人创建质押订单时",
  "a4:commission.paid": "团队奖励发放时",
  "a4:referral.bound": "邀请关系绑定时",
  "a4:market.curve_advanced": "行情曲线更新时",
};
/** 取材写人话：受控来源先查后端目录，再查固定说法；固定频道的原规则做一次系统文字转换。 */
export function sourceText(trigger: string, name: string, options: readonly NovaOptionView[]) {
  if (!trigger) return operatorCopyText(name);
  if (trigger.startsWith("a4:")) {
    const label = options.find((option) => option.value === trigger)?.label;
    return label ? operatorCopyText(label) : SOURCE_TEXT[trigger] ?? "收到已登记的业务事件时";
  }
  return readable(trigger);
}

/** 后端规则原文里的页面代号写成页面名，旧名称 NEX 写成 UVT 并标旧名（不让裸的 NEX 出现在首屏）。 */
const PAGE_NAME: Record<string, string> = { E3: "「设备使用与升级置换」", H3: "「用户任务管理」", H4: "「活动中心」", H1: "「运营阶段设置」" };
export function readable(text: string) {
  return operatorCopyText(text)
    .replace(/\b(E3|H3|H4|H1)\s*/g, (_, code: string) => PAGE_NAME[code])
    .replace(/\bNEX\b/g, "UVT（旧名称 NEX）");
}

const CATALOG_NAME: Record<string, string> = {
  team_event: "团队事件通知", staking_event: "质押事件通知", market_event: "市场事件通知", "risk-alert": "风险告警", "weekly-quest-refresh": "每周任务刷新",
};
export const catalogName = (name: string) => CATALOG_NAME[name] ?? operatorCopyText(name);

/** 「10 min」→「10 分钟」；读不出数和单位时原样给（系统文字转换后）。skip 是这个阶段不推。 */
export function durationText(raw: string): { text: string; skip: boolean; parsed: boolean } {
  const value = (raw ?? "").trim();
  if (!value) return { text: "—", skip: false, parsed: false };
  if (/^skip$/i.test(value)) return { text: "跳过", skip: true, parsed: true };
  const parsed = parseNovaDuration(value, "minutes");
  if (!parsed.value) return { text: operatorCopyText(value).replace(/\bskip\b/g, "跳过"), skip: false, parsed: false };
  const unit = NOVA_TIME_UNITS.find((item) => item.value === parsed.unit)?.label ?? "";
  return { text: `${parsed.value} ${unit}`, skip: false, parsed: true };
}
export const tickSentence = (tick: string) => {
  const d = durationText(tick);
  return d.parsed ? `每 ${d.text}找一次新素材` : `扫描间隔：${d.text}`;
};
export const cooldownSentence = (cooldown: string) => {
  const d = durationText(cooldown);
  if (d.skip) return "当前运营阶段不推";
  return d.parsed ? `同一个人 ${d.text}内最多一条` : `个人间隔：${d.text}`;
};

export type TemplateState = "published" | "draft" | "archived" | "missing" | string;
export const TEMPLATE_STATE_TEXT: Record<string, string> = { published: "已发布", draft: "草稿", archived: "已归档", missing: "没有模板" };
export function TemplateTag({ state }: { state: TemplateState }) {
  if (state === "published") return <StatusTag tone="ok">已发布</StatusTag>;
  if (state === "draft") return <StatusTag tone="progress">草稿</StatusTag>;
  if (state === "archived") return <StatusTag tone="done">已归档</StatusTag>;
  if (state === "missing") return <StatusTag tone="warn">没有模板</StatusTag>;
  return <StatusTag tone="done">{state}</StatusTag>;
}

/** 一张频道卡。动作由页面传；没有写权限时不传。 */
export function ChannelCard({ name, keyText, on, source, tick, cooldown, phase, template, templateState, warn, stats, ctr, actions, onTemplate }: {
  name: string;
  keyText: string;
  on: boolean;
  source: string;
  tick: string;
  cooldown: string;
  phase?: ReactNode;
  template?: Pick<NovaTemplateView, "name" | "version">;
  templateState: TemplateState;
  warn?: ReactNode;
  stats?: ReactNode;
  ctr: string;
  actions?: ReactNode;
  onTemplate?: () => void;
}) {
  return (
    <article className="i2-channel" data-off={on ? undefined : ""} data-warn={warn ? "" : undefined} aria-label={name}>
      <header className="i2-channel-head">
        <span className="i2-channel-icon" aria-hidden><Radio size={16} /></span>
        <span className="i2-channel-title">
          <b>{name}</b>
          <span className="i2-channel-source">{`取材：${source}`}</span>
        </span>
        {on ? <StatusTag tone="ok">已启用</StatusTag> : <StatusTag tone="done">已停用</StatusTag>}
      </header>
      {warn && <div className="i2-channel-warn">{warn}</div>}
      <dl className="i2-channel-rows">
        <div><dt><Clock size={14} aria-label="扫描间隔" /></dt><dd>{tickSentence(tick)}</dd></div>
        <div><dt><UserRound size={14} aria-label="个人间隔" /></dt><dd>{cooldownSentence(cooldown)}{phase}</dd></div>
        <div><dt><FileText size={14} aria-label="模板" /></dt><dd className="i2-channel-tpl">
          <TemplateTag state={templateState} />
          {template ? (onTemplate
            ? <button type="button" className="rd-link i2-channel-tpl-name" onClick={onTemplate}>{`${template.name} · ${template.version}`}</button>
            : <span className="i2-channel-tpl-name">{`${template.name} · ${template.version}`}</span>)
            : <span className="i2-muted">还没写模板</span>}
        </dd></div>
        {stats}
        <div><dt><Timer size={14} aria-label="点击率" /></dt><dd>
          <span className="i2-muted">{`点击率（存储值）${ctr}`}</span>
        </dd></div>
      </dl>
      <footer className="i2-channel-foot">
        <span className="i2-channel-key" title="频道编号">{keyText}</span>
        {actions && <span className="rd-row-actions">{actions}</span>}
      </footer>
    </article>
  );
}

export const PLACEHOLDERS = ["{actor}", "{name}", "{city}", "{amount}", "{eventType}", "{sourceNote}"] as const;
export const PLACEHOLDER_TEXT: Record<string, string> = {
  "{actor}": "人物（脱敏）", "{name}": "人物（同 {actor}）", "{city}": "地区（脱敏）", "{amount}": "金额区间或人数", "{eventType}": "事件类型代码", "{sourceNote}": "来源备注",
};
export const placeholdersOf = (text: string) => [...new Set(text.match(/\{[A-Za-z][A-Za-z0-9_]*}/g) ?? [])];

const SUMMARY: Record<"ZH" | "VI" | "EN", (e: NovaSocialEventView) => string> = {
  ZH: (e) => ({ withdrawal: `${e.actorDisplay} 在 ${e.cityDisplay} 完成一笔 ${e.amountDisplay} 提现到账`, vrank: `${e.actorDisplay} 的 V 等级刚刚晋升`, genesis: `${e.actorDisplay} 在 ${e.cityDisplay} 完成一笔 ${e.amountDisplay} Genesis 成交`, newUsers: `${e.cityDisplay} 刚刚新增 ${e.amountDisplay}` } as Record<string, string>)[e.eventType] ?? "UVEL 已验证真实动态",
  VI: (e) => ({ withdrawal: `${e.actorDisplay} tại ${e.cityDisplay} vừa nhận khoản rút ${e.amountDisplay}`, vrank: `${e.actorDisplay} vừa được thăng hạng V`, genesis: `${e.actorDisplay} tại ${e.cityDisplay} vừa hoàn tất giao dịch Genesis ${e.amountDisplay}`, newUsers: `${e.cityDisplay} vừa ghi nhận ${e.amountDisplay.replace("人", "người dùng")} mới` } as Record<string, string>)[e.eventType] ?? "Hoạt động thực đã được xác minh trên UVEL",
  EN: (e) => ({ withdrawal: `${e.actorDisplay} in ${e.cityDisplay} received a ${e.amountDisplay} withdrawal`, vrank: `${e.actorDisplay} advanced to a new V rank`, genesis: `${e.actorDisplay} in ${e.cityDisplay} completed a Genesis trade of ${e.amountDisplay}`, newUsers: `${e.cityDisplay} recorded ${e.amountDisplay.replace("人", "users")}` } as Record<string, string>)[e.eventType] ?? "Verified activity on UVEL",
};

/**
 * 预览用：照后端真实动态的渲染规则把一条真实事件填进模板（替换六个变量，正文没有变量时在后面接一句事件摘要），
 * 只在页面里显示，不发请求。其他频道后端不替换变量，原样给。
 */
export function previewText(title: string, body: string, lang: "ZH" | "VI" | "EN", event: NovaSocialEventView | null) {
  if (!event) return { title, body };
  const values: Record<string, string> = {
    actor: event.actorDisplay ?? "", name: event.actorDisplay ?? "", city: event.cityDisplay ?? "", amount: event.amountDisplay ?? "", eventType: event.eventType ?? "", sourceNote: event.sourceNote ?? "",
  };
  const fill = (text: string) => Object.entries(values).reduce((out, [key, value]) => out.split(`{${key}}`).join(value.trim()), text.trim());
  const hasVar = Object.keys(values).some((key) => body.includes(`{${key}}`));
  return { title: fill(title), body: hasVar ? fill(body) : `${fill(body)} · ${SUMMARY[lang](event)}` };
}

const LANG_LABEL = { ZH: "中文", VI: "越南语", EN: "英语" } as const;
const OPEN_LABEL = { ZH: "打开", VI: "Mở", EN: "Open" } as const;
const NOW_LABEL = { ZH: "刚刚", VI: "Vừa xong", EN: "Just now" } as const;

/** 「App 里 Nova 消息的样子」：通知列表里的一行，点开后的正文和跳转按钮。标题、正文按 App 截到 128、512 字。 */
export function AppNotice({ lang, title, body, cta, ctaNote, missing, raw }: {
  lang: "ZH" | "VI" | "EN";
  title: string;
  body: string;
  /** NONE 或空时没有跳转按钮。 */
  cta?: string;
  /** 这个去向 App 打不开时写一句。 */
  ctaNote?: ReactNode;
  /** 这一种语言没填时写的话。 */
  missing?: ReactNode;
  /** 变量原样显示（业务频道）。 */
  raw?: boolean;
}) {
  const shownTitle = title.slice(0, 128);
  const shownBody = body.slice(0, 512);
  return (
    <figure className="i2-phone" aria-label={`App 里的样子（${LANG_LABEL[lang]}）`}>
      <figcaption className="i2-phone-bar">{`App 消息 · ${LANG_LABEL[lang]}`}</figcaption>
      {missing ? <p className="i2-phone-missing">{missing}</p> : (
        <div className="i2-phone-row">
          <span className="i2-phone-icon" aria-hidden><Bell size={14} /></span>
          <div className="i2-phone-main">
            <div className="i2-phone-top"><b>{shownTitle || "（没有标题）"}</b><span>{NOW_LABEL[lang]}</span></div>
            <p className="i2-phone-body" data-raw={raw ? "" : undefined}>{shownBody || "（没有正文）"}</p>
            {cta && cta !== "NONE" && <span className="i2-phone-cta">{`${OPEN_LABEL[lang]} ›`}</span>}
            {ctaNote}
          </div>
        </div>
      )}
    </figure>
  );
}

/** 五类事件的固定显示顺序和图表槽位（金：钱，青：成交，紫：人，品红：人数，灰：没有数据源）。只管显示，提交仍按后端给的顺序。 */
export const DIST_ORDER = ["withdrawal", "genesis", "vrank", "newUsers", "aiClient"] as const;
export const DIST_SLOT: Record<string, 1 | 2 | 3 | 4 | "other"> = { withdrawal: 1, genesis: 2, vrank: 3, newUsers: 4, aiClient: "other" };
export const NO_SOURCE = "aiClient";
export function orderDist<T extends { key: string }>(items: readonly T[]) {
  const rank = (key: string) => { const i = (DIST_ORDER as readonly string[]).indexOf(key); return i < 0 ? 99 : i; };
  return [...items].sort((a, b) => rank(a.key) - rank(b.key));
}

/**
 * 可拖的概率条：拖两段之间的分界，左右两段此消彼长，合计不变；分界也能用方向键挪 1%。
 * 只改调用方的草稿，各项的数字框照样能直接填（填的不自动调平）。
 */
export function DistEditor({ items, values, onChange, disabled }: {
  items: readonly { key: string; name: string }[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  disabled?: boolean;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; startX: number; a: number; b: number } | null>(null);
  const num = (key: string) => { const v = Number(values[key]); return Number.isFinite(v) && v > 0 ? v : 0; };
  const total = items.reduce((sum, item) => sum + num(item.key), 0);
  const scale = Math.max(total, 100);
  const move = (index: number, delta: number, base?: { a: number; b: number }) => {
    const left = items[index].key;
    const right = items[index + 1].key;
    const a0 = base?.a ?? num(left);
    const b0 = base?.b ?? num(right);
    const d = Math.max(-a0, Math.min(b0, delta));
    if (!d && !base) return;
    onChange({ ...values, [left]: String(Math.round(a0 + d)), [right]: String(Math.round(b0 - d)) });
  };
  const down = (index: number) => (event: PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index, startX: event.clientX, a: num(items[index].key), b: num(items[index + 1].key) };
  };
  const moving = (event: PointerEvent<HTMLSpanElement>) => {
    const state = drag.current;
    const width = bar.current?.clientWidth ?? 0;
    if (!state || !width) return;
    move(state.index, Math.round(((event.clientX - state.startX) / width) * scale), state);
  };
  const up = () => { drag.current = null; };
  const key = (index: number) => (event: KeyboardEvent<HTMLSpanElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 5 : 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") { event.preventDefault(); move(index, step); }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") { event.preventDefault(); move(index, -step); }
  };
  let acc = 0;
  return (
    <div className="i2-dist-edit" data-disabled={disabled ? "" : undefined}>
      <div className="i2-dist-track" ref={bar}>
        {items.map((item) => {
          const v = num(item.key);
          return <span key={item.key} className="i2-dist-seg" data-slot={DIST_SLOT[item.key] ?? "other"} style={{ width: `${(v / scale) * 100}%` }} title={`${item.name} ${v}%`} />;
        })}
        {items.slice(0, -1).map((item, index) => {
          acc += num(item.key);
          const next = items[index + 1];
          return (
            <span key={`${item.key}-edge`} className="i2-dist-handle" style={{ left: `${(acc / scale) * 100}%` }}
              role="slider" tabIndex={disabled ? -1 : 0} aria-label={`${item.name}和${next.name}的分界`}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={acc} aria-valuetext={`${item.name} ${num(item.key)}%，${next.name} ${num(next.key)}%`}
              onPointerDown={down(index)} onPointerMove={moving} onPointerUp={up} onPointerCancel={up} onKeyDown={key(index)} />
          );
        })}
      </div>
      <p className="i2-dist-help">拖分界线调整相邻两类，或在下面直接填数</p>
    </div>
  );
}

export function PhaseNote({ text }: { text: string }) {
  return <Explain label="跟随运营阶段" content={<>
    <p>同一个人多久收一次按运营阶段 P1–P6 分档，阶段切换时自动换档。</p>
    <p>阶段在「运营阶段设置」里改，这里只能看。</p>
    {text && <p>{`分档：${operatorCopyText(text).replace(/\bskip\b/g, "跳过")}`}</p>}
  </>} />;
}
