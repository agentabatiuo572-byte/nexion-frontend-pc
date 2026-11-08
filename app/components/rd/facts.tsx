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
 *   值是不带数字的文字（JSON、样本过小）时按普通的值显示：大字只给数字（DT-21）。
 * - tone 给值上色，规则和页面上的数字一样，先问状态再问角色（VS-11）：风险等级、不能撤销这类传状态色；
 *   金额传 role-1。角色色只在深色主题上字，浅色主题是正文色（VS-14）。不传就是正文色。
 * - k 过 AutoGloss，命中词典的术语带解释。
 * - 一行里的前后变化写成 <Change from="在线" to="已关停" />：现在值弱，改后的值进行中蓝（VS-103），不要写成「在线 → 已关停」一串。
 *   已经生效的变化（读取最新后别人改了什么）传 settled，新值用正文色，不用待生效的蓝。
 * - 值是「—」时自动弱化，和 Stat 一样（VS-11）；lead 的值是 0 时不放大，也弱化。
 */
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import type { RoleTone, StateTone } from "./tone";

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="rd-facts">{children}</dl>;
}

export function Fact({ k, children, tone, lead, unit }: { k: string; children: ReactNode; tone?: StateTone | RoleTone; lead?: boolean; unit?: ReactNode }) {
  // 关键数字是 0 时不放大，弱化成和「—」一样（VS-11）：最大的字不给 0。
  const zero = lead && typeof children === "string" && /^0(\.0+)?$/.test(children.trim());
  const big = lead && !zero && !(typeof children === "string" && !/\d/.test(children));
  return (
    <div className="rd-fact" data-tone={tone} data-lead={big ? "" : undefined} data-empty={children === "—" || zero ? "" : undefined}>
      <dt><AutoGloss>{k}</AutoGloss></dt>
      <dd>{children}{unit && <span className="rd-fact-unit">{unit}</span>}</dd>
    </div>
  );
}

/** 事实一行里的前后变化。前后靠位置和箭头分，不只靠颜色；读屏读「改为」。 */
export function Change({ from, to, settled }: { from: ReactNode; to: ReactNode; settled?: boolean }) {
  return (
    <span className="rd-fact-change">
      <span>{from}</span>
      <ArrowRight size={14} aria-hidden />
      <span className="rd-sr-only">改为</span>
      <span data-after={settled ? undefined : ""} data-settled={settled ? "" : undefined}>{to}</span>
    </span>
  );
}
