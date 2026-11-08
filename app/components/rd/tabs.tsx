"use client";

/**
 * PageTabs 页内页签（CP-23）、Segments 状态分段和时间窗（CP-62，PG-32）。方向键、Home、End 在可用项间
 * 移动并立即选中，禁用项跳过。受控，网址和默认页签由页面管（ST-23、PG-33）。
 * 页签的语义来自 TabGroup；状态分段是单选，用 radiogroup，方向键复用 nextTabValue。
 *
 * 页内页签切不同内容：
 *   <PageTabs label="资金储备内容" value={tab} onChange={setTab}
 *     items={[{ value: "overview", label: "资金概况" }, { value: "due", label: "应付款与到期", count: 3 }]} />
 *   没有读权限的页签不要传进来；count 是别的页签里的待处理数（PG-52），读不到传「—」。
 *   内容面板用 useTabIds 接上，读屏才知道这块内容属于哪个页签：
 *   const ids = useTabIds();
 *   <PageTabs ids={ids} … />
 *   <div {...ids.panel(tab)} className="rd-tab-pane">…</div>
 *
 * 状态分段筛同一张表，点了立即查询（ST-16）：
 *   <Segments label="提现状态分组" value={group} onChange={setGroup} items={[
 *     { value: "todo", label: "要处理", tone: "warn", count: 23 },
 *     { value: "doing", label: "系统处理中", tone: "progress", count: 41 },
 *     { value: "done", label: "已结束", tone: "done", count: 64 },
 *     { value: "all", label: "全部", count: 128 },
 *   ]} />
 *
 * 时间窗（J3、L4、D3）也用 Segments，不传 tone。多选不能用这两个（CP-62）。
 *
 * 页签里面再分一层（D1 的 USDT 充值分四个分区）传 level={2}：下划线式（Ant Design Tabs 默认），
 * 选中项 2px 品牌色下划线、文字 14/500，和外层的底色块分得开，一眼看出是里面的分区。
 */
import { useId, useMemo, useRef, type KeyboardEvent, type ReactNode } from "react";
import { TabGroup } from "@/app/components/kit/tab-group";
import { nextTabValue } from "@/app/components/kit/tab-group-keyboard";
import type { StateTone } from "./tone";

export interface PageTabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** 读不到写「—」，数到上限写「50+」这类文字；0 和「—」弱化。 */
  count?: number | string;
  disabled?: boolean;
}

export interface TabIds {
  tab: (value: string) => string;
  panelId: (value: string) => string;
  panel: (value: string) => { id: string; role: "tabpanel"; "aria-labelledby": string };
}

export function useTabIds(): TabIds {
  const base = useId();
  return useMemo(() => ({
    tab: (value: string) => `${base}-tab-${value}`,
    panelId: (value: string) => `${base}-panel-${value}`,
    panel: (value: string) => ({ id: `${base}-panel-${value}`, role: "tabpanel" as const, "aria-labelledby": `${base}-tab-${value}` }),
  }), [base]);
}

export function PageTabs<T extends string>({ label, value, items, onChange, ids, level = 1 }: { label: string; value: T; items: readonly PageTabItem<T>[]; onChange: (value: T) => void; ids?: TabIds; level?: 1 | 2 }) {
  const byValue = new Map(items.map((item) => [item.value, item]));
  return (
    <TabGroup
      label={label}
      className={level === 2 ? "rd-tabs rd-tabs-sub" : "rd-tabs"}
      value={value}
      items={items.map((item) => item.value)}
      onSelect={onChange}
      disabled={(item) => byValue.get(item)?.disabled ?? false}
      itemClassName={() => "rd-tab"}
      itemId={ids && ((item) => ids.tab(item))}
      itemControls={ids && ((item) => ids.panelId(item))}
    >
      {(item) => {
        const tab = byValue.get(item);
        // 读到 0 也写 0，弱文字色；读不到写「—」，也弱化：和读取中（不传 count）分得开（DT-23、VS-11）。
        return <>{tab?.label}{tab?.count !== undefined ? <span className="rd-tab-count" data-zero={tab.count === 0 || tab.count === "—" ? "" : undefined}>{tab.count}</span> : null}</>;
      }}
    </TabGroup>
  );
}

export interface SegmentItem<T extends string | number> {
  value: T;
  label: ReactNode;
  tone?: StateTone;
  count?: number;
  disabled?: boolean;
}

export function Segments<T extends string | number>({ label, value, items, onChange }: { label: string; value: T; items: readonly SegmentItem<T>[]; onChange: (value: T) => void }) {
  const groupRef = useRef<HTMLDivElement>(null);
  const selectable = items.filter((item) => !item.disabled).map((item) => item.value);
  // 选中项不可用时，roving 焦点落回第一个可用项，否则整组无法用 Tab 进入。
  const focusValue = selectable.includes(value) ? value : selectable[0];
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabValue(selectable, value, event.key);
    if (next === null) return;
    event.preventDefault();
    onChange(next);
    groupRef.current?.querySelectorAll<HTMLElement>('[role="radio"]')[items.findIndex((item) => item.value === next)]?.focus();
  };
  return (
    <div ref={groupRef} role="radiogroup" aria-label={label} className="rd-segs" data-cp="filter" onKeyDown={onKeyDown}>
      {items.map((item) => (
        <button
          key={String(item.value)}
          type="button"
          role="radio"
          aria-checked={item.value === value}
          tabIndex={item.value === focusValue ? 0 : -1}
          disabled={item.disabled}
          className="rd-seg"
          onClick={() => onChange(item.value)}
        >
          {item.tone && <span className="rd-seg-dot" data-tone={item.tone} aria-hidden />}
          {item.label}
          {item.count !== undefined && <span className="rd-seg-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
