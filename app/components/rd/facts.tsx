/**
 * Facts、Fact 键值列表（CP-41）。详情、抽屉里成对的「名称：值」，标签弱、值强，长值换行不截断。
 *
 * <Facts>
 *   <Fact k="实际手续费">62.40 USDT</Fact>
 *   <Fact k="目标地址"><span data-mono>0x4e1f…</span></Fact>
 * </Facts>
 *
 * k 过 AutoGloss，命中词典的术语带解释。
 */
import type { ReactNode } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="rd-facts">{children}</dl>;
}

export function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="rd-fact">
      <dt><AutoGloss>{k}</AutoGloss></dt>
      <dd>{children}</dd>
    </div>
  );
}
