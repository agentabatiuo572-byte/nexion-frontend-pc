/**
 * Facts、Fact 键值列表（CP-41）。详情、抽屉、确认框里成对的「名称：值」，标签弱、值强，长值换行不截断。
 *
 * <Facts>
 *   <Fact k="放行金额" lead tone="role-1" unit="USDT">12,800.50</Fact>
 *   <Fact k="用户">U00000006</Fact>
 *   <Fact k="风险" tone="warn">高优先，风险分 78</Fact>
 *   <Fact k="目标地址"><span data-mono>0x4e1f…</span></Fact>
 * </Facts>
 *
 * - lead 是这次操作的关键数字（金额、数量），弹窗里最大最亮，每个框最多一个，放第一行（VS-102）。
 * - tone 给值上色，规则和页面上的数字一样，先问状态再问角色（VS-11）：风险等级、不能撤销这类传状态色；
 *   金额传 role-1。角色色只在深色主题上字，浅色主题是正文色（VS-14）。不传就是正文色。
 * - k 过 AutoGloss，命中词典的术语带解释。
 */
import type { ReactNode } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { RoleTone, StateTone } from "./tone";

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="rd-facts">{children}</dl>;
}

export function Fact({ k, children, tone, lead, unit }: { k: string; children: ReactNode; tone?: StateTone | RoleTone; lead?: boolean; unit?: ReactNode }) {
  return (
    <div className="rd-fact" data-tone={tone} data-lead={lead ? "" : undefined}>
      <dt><AutoGloss>{k}</AutoGloss></dt>
      <dd>{children}{unit && <span className="rd-fact-unit">{unit}</span>}</dd>
    </div>
  );
}
