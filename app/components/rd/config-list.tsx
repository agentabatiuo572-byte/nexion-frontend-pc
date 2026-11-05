/**
 * ConfigList、ConfigRow 配置项列表（CP-87、CP-88）。一行一项：名称、这是什么、什么时候生效、显示位置、当前值、动作。
 *
 * <ConfigList>
 *   <ConfigRow name="试用天数" what="一次免费试用持续几天" when="立即生效，只影响新开始的试用"
 *     where="App 领取弹窗「试用时长」" value="3 天"
 *     action={(describedBy) => <Button size="sm" aria-describedby={describedBy} onClick={…}>调整</Button>} />
 * </ConfigList>
 *
 * - what 不超过 25 字，when 写实际路径（TX-36）。怎么填、改了会怎样放修改框，不铺在这里。
 * - where 只写核对过的位置；影响其他后台页时写页面名，能跳过去。没有就不传。
 * - action 收到说明文字的 id，交给控件的 aria-describedby。没有修改权限时不传（OP-124）。
 * - 只读项 value 照常写，action 换成「去修改」的链接或不传。
 */
import { useId, type ReactNode } from "react";

export function ConfigList({ children }: { children: ReactNode }) {
  return <div className="rd-config">{children}</div>;
}

export function ConfigRow({ name, what, when, where, value, sub, action, id }: {
  name: ReactNode;
  what?: ReactNode;
  when?: ReactNode;
  where?: ReactNode;
  value: ReactNode;
  /** 值下面的弱文字，比如商品的编号和库存。 */
  sub?: ReactNode;
  action?: ReactNode | ((describedBy: string) => ReactNode);
  id?: string;
}) {
  const helpId = useId();
  return (
    <div className="rd-config-row" id={id}>
      <div className="rd-config-main">
        <div className="rd-config-name">{name}</div>
        <div id={helpId} className="rd-config-help">
          {(what || when) && <div>{what}{what && when ? " · " : ""}{when}</div>}
          {where && <div className="rd-config-where">显示位置：{where}</div>}
        </div>
      </div>
      <div className="rd-config-value">
        <span>{value}</span>
        {sub && <small>{sub}</small>}
      </div>
      <div className="rd-config-action">{typeof action === "function" ? action(helpId) : action}</div>
    </div>
  );
}
