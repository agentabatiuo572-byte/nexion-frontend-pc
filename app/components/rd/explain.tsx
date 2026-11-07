"use client";

/**
 * Explain 提示图标和气泡（CP-45，DP-06）。解释性文字不铺在页面上：这是什么、显示位置、生效时间、改了会怎样、
 * 数字口径、操作后果都收进它，图标紧挨着被解释的东西。鼠标悬停、点击、键盘（Enter、Space）都能打开，
 * Esc 和点外面关闭，关闭后焦点回到图标。
 *
 * <Explain label="试用天数的说明" rows={[{ k: "这是什么", v: "一次免费试用持续几天" }, { k: "生效时间", v: "立即生效，只影响新试用" }]} />
 * <Explain label="资金口径" content="可用储备 = 储备 − 已扣除质押锁定金额。" />   只有图标
 * <Explain label="待审核是什么意思" content="…">待审核</Explain>   正文里的词：虚线下划线，不加图标
 *
 * - 图标全站一个样子：14px 问号圈、弱文字色，不抢眼；悬停和打开时稍亮。
 * - content 是自由内容（多段用 <p>），rows 按「名称 值」分行；两者都传时 content 在上。
 * - 悬停只认鼠标，触屏点一下就打开。悬停打开的气泡不抢焦点；点击或键盘打开的才把焦点交给气泡，再点一下或 Esc 关。
 */
import { Fragment, useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { CircleHelp } from "lucide-react";

export interface ExplainRow { k: ReactNode; v: ReactNode }

/** side、align：统计数字的问号向上、配置项的问号向下展开，都从问号左边起（align start），不盖住被解释的数字，也不压到侧栏；放不下时自动翻边。 */
export function Explain({ label, content, rows, side, align, children }: { label: string; content?: ReactNode; rows?: readonly ExplainRow[]; side?: "top" | "bottom" | "right" | "left"; align?: "start" | "center" | "end"; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const clear = () => window.clearTimeout(timer.current);
  useEffect(() => clear, []);
  const hover = {
    onPointerEnter: (event: PointerEvent) => { if (event.pointerType !== "mouse") return; clear(); timer.current = window.setTimeout(() => setOpen(true), 100); },
    onPointerLeave: (event: PointerEvent) => { if (event.pointerType !== "mouse" || pinned.current) return; clear(); timer.current = window.setTimeout(() => setOpen(false), 100); },
  };
  const shown = rows?.filter((row) => row.v !== undefined && row.v !== null && row.v !== "") ?? [];
  return (
    <Popover.Root open={open} onOpenChange={(next) => { if (!next) { clear(); pinned.current = false; setOpen(false); } }}>
      <Popover.Trigger
        className="rd-explain"
        data-term={children ? "" : undefined}
        aria-label={label}
        {...hover}
        onClick={(event) => {
          // 自己管开关：悬停打开后点一下是钉住，不是关掉；钉住后再点一下才关。
          event.preventDefault();
          clear();
          if (open && pinned.current) { pinned.current = false; setOpen(false); }
          else { pinned.current = true; setOpen(true); }
        }}
      >
        {children ?? <CircleHelp className="rd-explain-mark" size={14} strokeWidth={1.75} aria-hidden />}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="rd-pop" side={side} align={align} sideOffset={6} collisionPadding={12} {...hover} onOpenAutoFocus={(event) => { if (!pinned.current) event.preventDefault(); }}>
          {content}
          {shown.length > 0 && (
            <dl className="rd-pop-rows" data-after={content ? "" : undefined}>
              {shown.map((row, index) => <Fragment key={index}><dt>{row.k}</dt><dd>{row.v}</dd></Fragment>)}
            </dl>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
