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
 * 读取失败传 value="—"，不写 0（CP-42）。explain 是口径说明，字段名带虚线下划线，点开看（DP-36）。
 * 深色主题数字用角色色字，浅色主题数字用正文色、身份靠实色图标底（VS-14），这条写在 rd.css 里。
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

export function StatBand({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="rd-stats" role="group" aria-label={label}>{children}</div>;
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
  return (
    <div className="rd-stat" data-cp="stat" data-lead={lead ? "" : undefined}>
      {href && <Link className="rd-stat-hit" href={href} prefetch={false} aria-label={openLabel} />}
      {!href && onOpen && <button type="button" className="rd-stat-hit" aria-label={openLabel} onClick={onOpen} />}
      {icon && <IconTile tone={iconTone ?? tone ?? "role-other"} icon={icon} size={lead ? 40 : 28} />}
      <div>
        <div className="rd-stat-label">
          {explain ? <Explain label={typeof label === "string" ? `${label}的口径` : "数字口径"} content={explain}>{label}</Explain> : label}
        </div>
        <div className="rd-stat-value" data-tone={tone}>{value}{unit && <span className="rd-stat-unit">{unit}</span>}</div>
        {sub && <div className="rd-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
