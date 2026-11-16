"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, X } from "lucide-react";
import { Button, Explain, IconButton, Notice, type StateTone } from "@/app/components/rd";

/** 两分钟内发出的才算运营刚做完操作产生的记录；页面分批读进来的旧记录不算。 */
const FRESH_MS = 2 * 60 * 1000;
/**
 * 运营刚做完操作产生的记录排在最前面，并把面板滚进视野：已经有记录时再多一条，新的不会藏在「展开全部」后面。
 * 面板原来是空的就不用排：新面板本身就出现在页面上方。没有发出时间的行不排。
 */
export function useFreshFirst<T extends { key: string; createdAt?: number }>(rows: readonly T[]) {
  const known = useRef<Set<string> | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const keys = rows.map(row => row.key);
  const signature = keys.join("\n");
  useEffect(() => {
    const before = known.current;
    known.current = new Set(keys);
    if (!before?.size) return;
    const now = Date.now();
    const added = rows.filter(row => !before.has(row.key) && row.createdAt !== undefined && now - row.createdAt < FRESH_MS).map(row => row.key);
    setFresh(list => [...added, ...list.filter(key => !added.includes(key) && keys.includes(key))]);
    if (added.length) box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
  const ordered = [...fresh.flatMap(key => rows.filter(row => row.key === key)), ...rows.filter(row => !fresh.includes(row.key))];
  return { ordered, box };
}

/** 面板标题：结果未知、在等审批、已有结论分开数，只写有的那几种。 */
/** 按原号查到已处理完或记为失败：后端对这两种不收「仍未知」，结案框只给能提交的结论。 */
export function closureKnown(outcome?: { receipt: { originalStatus: string } | null } | { error: string }) {
  const status = outcome && "receipt" in outcome ? outcome.receipt?.originalStatus : undefined;
  return status === "SUCCEEDED" || status === "FAILED";
}

export function recoveryTitle(unknown: number, waiting = 0, ended = 0) {
  return [unknown ? `${unknown} 项操作结果未知` : "", waiting ? `${waiting} 项${unknown ? "" : "操作"}在等审批` : "", ended ? `${ended} 项${unknown || waiting ? "" : "操作"}已有结论` : ""].filter(Boolean).join("，");
}

/** 查到已解决的记录：一行轻提示，不占一张卡。 */
export function SettledLine({ label, text, onDismiss }: { label: ReactNode; text: string; onDismiss?: () => void }) {
  return <p className="fund-settled" role="status">
    <CheckCircle2 size={14} aria-hidden />
    <span><b>{label}</b> {text}</span>
    {onDismiss && <IconButton aria-label="关闭这条提示" onClick={onDismiss}><X size={14} aria-hidden /></IconButton>}
  </p>;
}

export type RecoveryItem = {
  key: string;
  /** 操作和对象，一行写得下。 */
  object: ReactNode;
  /** 发出时间：两分钟内发出的新记录排到最前（见 useFreshFirst）。 */
  createdAt?: number;
  /** 状态标签（StatusTag），六个字以内。 */
  tag: ReactNode;
  /** 紧跟标签的一句结论：这条现在怎样、下一步做什么。 */
  line: string;
  /** 最近一次查询的回答；回答变了这一行自动展开。 */
  note?: ReactNode;
  /** note 不是纯文字时用它判断回答变没变。 */
  noteKey?: string;
  actions?: ReactNode;
  /** 展开后显示：发出时间、较长的说明。 */
  detail?: ReactNode;
  /** 原请求和原请求编号，放在展开内容的最后。 */
  tech?: ReactNode;
};

/**
 * 结果未知、待审批这类记录的通用面板，和资金页的面板同一个样子（同一组 fund-* 类）：设备域、账户操作、客服组管理用它。
 * 一行标题加问号里的通用说明；每条一行（箭头和对象、状态标签、一句结论、右侧按钮），点行首箭头看细节；默认露三条。
 */
export function RecoveryPanel({ title, explain, explainLabel = "这些记录怎么处理", foot, items, tone = "warn", label = "结果未知的操作" }: {
  title: ReactNode; explain?: ReactNode; explainLabel?: string; foot?: ReactNode; items: readonly RecoveryItem[]; tone?: StateTone; label?: string;
}) {
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<string[]>([]);
  const { ordered, box } = useFreshFirst(items);
  const seen = useRef<Record<string, string>>({});
  const answers = items.map(item => [item.key, typeof item.note === "string" ? item.note : item.noteKey ?? ""] as const);
  useEffect(() => {
    const fresh = answers.filter(([key, answer]) => answer && seen.current[key] !== undefined && seen.current[key] !== answer).map(([key]) => key);
    seen.current = Object.fromEntries(answers);
    if (fresh.length) setOpen(keys => [...new Set([...keys, ...fresh])]);
  });
  if (!items.length) return null;
  const shownItems = all ? ordered : ordered.slice(0, 3);
  return <div ref={box}><Notice tone={tone} title={<>{title}{explain && <Explain label={explainLabel} content={explain} />}</>}>
    <ul className="fund-rows" aria-label={label}>{shownItems.map(item => {
      const expanded = open.includes(item.key);
      const id = `recovery-row-${item.key.replace(/[^A-Za-z0-9_-]/g, "-")}`;
      return <li key={item.key} className="fund-row">
        <div className="fund-row-line">
          <button type="button" className="fund-row-toggle" aria-expanded={expanded} aria-controls={id}
            onClick={() => setOpen(keys => expanded ? keys.filter(key => key !== item.key) : [...keys, item.key])}>
            <ChevronRight className="fund-row-chevron" size={14} aria-hidden /><span className="fund-row-title">{item.object}</span>
          </button>
          {item.tag}
          <span className="fund-row-text">{item.line}</span>
          <span className="fund-row-actions">{item.actions}</span>
        </div>
        {expanded && <div className="fund-row-detail" id={id}>{item.detail}{item.note && <div role="status">{item.note}</div>}{item.tech}</div>}
      </li>;
    })}</ul>
    {(items.length > 3 || foot) && <div className="fund-rows-foot">
      {items.length > 3 && <Button size="sm" variant="ghost" aria-expanded={all} onClick={() => setAll(value => !value)}>{all ? "只看前 3 条" : `展开全部 ${items.length} 条`}</Button>}
      {foot}
    </div>}
  </Notice></div>;
}
