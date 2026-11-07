/**
 * StatBand、Stat 统计数字（CP-40）。一页最多 4 个，最重要的一个加 lead 放最大（DP-12）。
 * 颜色先问状态，再问角色（VS-11）；常见数字的槽位全站固定（VS-12），页面规格要写明。
 *
 * <StatBand>
 *   <Stat lead tone="warn" icon={Inbox} label="要处理" value="23" unit="笔" />
 *   <Stat icon={Flag} iconTone="warn" label="高优先队列" value="4" unit="笔" />
 *   <Stat tone="role-1" icon={Coins} label="本页金额" value="52,670.00" unit="USDT" explain="只算当前页。" />
 *   <Stat tone="role-4" icon={Gauge} label="每日提现次数上限" value="2" unit="次" />
 * </StatBand>
 *
 * 只有两三个数时 StatBand 传 fit：每格按内容宽，挨着排，放不下才换行；不拉满整行让数字孤零零留在左边。
 * 读取失败传 value="—"，不写 0（CP-42）。explain 是口径说明，收进名称旁的提示图标（DP-06、DP-36）；sub 只放数据（昨天全天多少、涉及几个账户），说明不写在 sub 里。
 * 深色主题数字用角色色字，浅色主题数字用正文色、身份靠实色图标底（VS-14），这条写在 rd.css 里。
 * 普通数字 24px，lead 40px（VS-50）。名称、数字、单位、第二行分四层，页面不改字号；长金额放不下时 rd.css 换行，不缩字。
 * 值是 0、0.00、$0、0% 或「—」时弱化：字色弱、图标底灰、lead 不放大，最大的字不给 0（novice-2、visual-1 第 7 条）。
 * 大字只给数字：不带数字的文字（「无权限」「暂时无法估值」）不是答案，16px，传了 lead 也不放大（DT-21）。
 * 这一屏的结论已经放大了数字（Conclusion lead 里的 <b>）时不传 lead，每屏一个 40px。
 * 带 data-cp="stat"，首屏检查按它数。
 * 整张可点：传 href 跳页，或传 onOpen 做页内动作，openLabel 是读屏名字。问号和 sub 里的按钮浮在上面，各点各的。
 * 目标页不可达时不传（X03）。
 */
import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Explain } from "./explain";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

/** 0、0.00、$0、0%、「—」：不是要看的数。 */
const ZERO = /^[-–—]$|^\$?0(?:[.,]0+)?\s*%?$/;

/** fit：只有两三个数时传，每格按内容宽，挨着排，不拉满整行（D6）。 */
export function StatBand({ children, label, fit }: { children: ReactNode; label?: string; fit?: boolean }) {
  return <div className="rd-stats" role="group" aria-label={label} data-fit={fit ? "" : undefined}>{children}</div>;
}

export function Stat({ label, value, unit, sub, tone, icon, iconTone, lead, explain, href, onOpen, openLabel }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: RoleTone | StateTone;
  icon?: LucideIcon;
  iconTone?: RoleTone | StateTone;
  lead?: boolean;
  explain?: ReactNode;
  href?: string;
  onOpen?: () => void;
  openLabel?: string;
}) {
  const zero = typeof value === "number" ? value === 0 : typeof value === "string" && ZERO.test(value.trim());
  const words = !zero && typeof value === "string" && !/\d/.test(value);
  const big = lead && !zero && !words;
  return (
    <div className="rd-stat" data-cp="stat" data-lead={big ? "" : undefined}>
      {href && <Link className="rd-stat-hit" href={href} prefetch={false} aria-label={openLabel} />}
      {!href && onOpen && <button type="button" className="rd-stat-hit" aria-label={openLabel} onClick={onOpen} />}
      {icon && <IconTile tone={zero ? "role-other" : iconTone ?? tone ?? "role-other"} icon={icon} size={big ? 40 : 28} />}
      <div>
        <div className="rd-stat-label">
          {label}
          {explain && <Explain label={typeof label === "string" ? `${label}的口径` : "数字口径"} content={explain} />}
        </div>
        <div className="rd-stat-value" data-tone={tone} data-zero={zero ? "" : undefined} data-words={words ? "" : undefined}>{value}{unit && <span className="rd-stat-unit">{unit}</span>}</div>
        {sub && <div className="rd-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
