"use client";

/**
 * Steps 流程进度（CP-47）。只读，从现有状态字段取当前步，不新增状态。
 *
 * <Steps label="订单进度" items={[
 *   { label: "已下单", state: "done" },
 *   { label: "已支付", state: "current" },
 *   { label: "开通中", state: "todo", sub: "3 单" },
 * ]} />
 *
 * - 当前步带 aria-current="step"，读屏按列表读。
 * - 只给有先后依赖、三步以上的流程。能切换的填写步骤不用它。
 *
 * StageLine 阶段线：平台走到第几个阶段。一排等距的节点，当前阶段的节点高亮并写「当前」，它前面的是实心点、后面的是空心点。只读，点不了。
 * 看它能判断：现在在哪个阶段，前后还有哪些阶段。
 *
 * <StageLine label="开放阶段" currentId={phaseCurrent} stages={[
 *   { id: "p1", label: "启动期" }, { id: "p2", label: "增长期", sub: "运营第 7 个月" }, { id: "p3", label: "成熟期" },
 * ]} />
 *
 * - 节点等距只表示先后，不表示每个阶段一样长，也不表示进度：连线一律是灰的，不随当前阶段上色。
 * - currentId 传 null 或对不上任何阶段时整条不高亮，都是空心点；页面在旁边写「当前阶段待核实」。
 * - 阶段多、放不下时在这一块里横向滚动，两侧有影子，打开时当前阶段滚进可见范围；能滚时这一块 Tab 能到，方向键滚动。
 * - label、sub 可以放 Explain：阶段的门槛、商品、排序收进气泡。只有一个阶段时只有一个节点，不画连线。
 * - 没有阶段传 state="empty" 加一句话；读取中传 state="loading"。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { graphicNote, type GraphicStateProps } from "./graphic-state";

export function Steps({ label, items }: { label: string; items: readonly { label: ReactNode; sub?: ReactNode; state: "done" | "current" | "todo" }[] }) {
  return (
    <ol className="rd-steps" aria-label={label}>
      {items.map((item, index) => (
        <li key={index} className="rd-step" data-state={item.state} aria-current={item.state === "current" ? "step" : undefined}>
          <span className="rd-step-mark">{item.state === "done" ? <Check size={13} strokeWidth={2.4} aria-hidden /> : index + 1}</span>
          <span className="rd-step-label">{item.label}</span>
          {item.sub !== undefined && <span className="rd-step-sub">{item.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

export function StageLine({ label, stages, currentId, ...status }: {
  label: string;
  stages: readonly { id: string; label: ReactNode; sub?: ReactNode }[];
  currentId?: string | null;
} & GraphicStateProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  const drawn = (status.state === undefined || status.state === "ready") && stages.length > 0;
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const measure = () => setScrollable(box.scrollWidth > box.clientWidth + 1);
    measure();
    // 当前阶段滚进可见范围，只动这一块的横向滚动，不带着页面滚。
    const current = box.querySelector<HTMLElement>('[aria-current="step"]');
    if (current) box.scrollLeft = Math.max(0, current.offsetLeft - (box.clientWidth - current.offsetWidth) / 2);
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [drawn, currentId, stages.length]);

  const note = graphicNote(stages.length ? status : { ...status, state: status.state === "loading" || status.state === "failed" ? status.state : "empty" }, false);
  if (note !== undefined) return note;
  if (status.state === "loading") return <span className="rd-skeleton rd-stageline-skeleton" aria-hidden />;
  const currentIndex = stages.findIndex((stage) => stage.id === currentId);
  return (
    <div ref={scrollRef} className="rd-stageline-scroll" role="group" aria-label={label} tabIndex={scrollable ? 0 : undefined}>
      <ol className="rd-stageline">
        {stages.map((stage, index) => {
          const state = currentIndex < 0 ? "plain" : index < currentIndex ? "past" : index === currentIndex ? "current" : "next";
          return (
            <li key={stage.id} className="rd-stage" data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="rd-stage-node" aria-hidden><i /></span>
              <span className="rd-stage-label">{stage.label}{state === "current" && <span className="rd-stage-now">当前</span>}</span>
              {stage.sub !== undefined && <span className="rd-stage-sub">{stage.sub}</span>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
