/**
 * ConfigList、ConfigRow 配置项列表（CP-87、CP-88）。一行一项、一行高：名称、提示图标、当前值、动作（DP-06、DP-31）。
 * 这是什么、显示位置、生效时间、改了会怎样都在提示图标的气泡里，不写在行上。
 *
 * <ConfigList label="常改参数">
 *   <ConfigRow name="试用天数" what="一次免费试用持续几天" when="立即生效，只影响新试用"
 *     where="App 领取弹窗「试用时长」" value="3 天"
 *     action={(describedBy) => <Button size="sm" aria-describedby={describedBy} onClick={…}>调整</Button>} />
 * </ConfigList>
 *
 * - what 不超过 25 字，when 写实际路径（TX-36），where 只写核对过的位置；effect 是静态的一句「改了会怎样」，
 *   随输入变的和怎么填放修改框；note 是别的要说明的事，比如现在为什么改不了。
 * - action 收到读屏用的说明 id，交给控件的 aria-describedby。没有修改权限时不传（OP-124）。
 * - 只读项 value 照常写，action 换成「去修改」的链接或不传。
 * - sub 是值的补充数据（编号、库存），和值同一行；说明不放这里。
 * - name 不是纯文字时传 explainLabel，给提示图标起读屏名字；label 是这组配置的名字，读屏按列表读。
 */
import { useId, type ReactNode } from "react";
import { Explain } from "./explain";

export function ConfigList({ label, children }: { label?: string; children: ReactNode }) {
  return <div className="rd-config" role="list" aria-label={label}>{children}</div>;
}

export function ConfigRow({ name, explainLabel, what, when, where, effect, note, value, sub, action, id }: {
  name: ReactNode;
  explainLabel?: string;
  what?: ReactNode;
  when?: ReactNode;
  where?: ReactNode;
  effect?: ReactNode;
  /** 别的要说明的事，比如现在为什么改不了。 */
  note?: ReactNode;
  value: ReactNode;
  /** 值旁边的补充数据，比如商品的编号和库存。 */
  sub?: ReactNode;
  action?: ReactNode | ((describedBy: string | undefined) => ReactNode);
  id?: string;
}) {
  const helpId = useId();
  const rows = [
    { k: "这是什么", v: what },
    { k: "显示位置", v: where },
    { k: "生效时间", v: when },
    { k: "改了会怎样", v: effect },
    { k: "备注", v: note },
  ].filter((row) => row.v);
  const hasHelp = rows.length > 0;
  return (
    <div className="rd-config-row" role="listitem" id={id}>
      <div className="rd-config-name">
        {name}
        {hasHelp && <Explain label={`${explainLabel ?? (typeof name === "string" ? name : "这一项")}的说明`} rows={rows} />}
      </div>
      {hasHelp && <span id={helpId} className="rd-sr-only">{rows.map((row, index) => <span key={index}>{row.k}：{row.v}。</span>)}</span>}
      <div className="rd-config-value">
        <span>{value}</span>
        {sub && <small>{sub}</small>}
      </div>
      <div className="rd-config-action">{typeof action === "function" ? action(hasHelp ? helpId : undefined) : action}</div>
    </div>
  );
}
