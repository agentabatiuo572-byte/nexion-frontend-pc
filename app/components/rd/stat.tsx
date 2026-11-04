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
 * 读取失败传 value="—"，不写 0（CP-42）。explain 是口径说明，点开看（DP-36）。
 * 带 data-cp="stat"，首屏检查按它数。
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { Explain } from "./explain";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

export function StatBand({ children, label }: { children: ReactNode; label?: string }) {
  return <div className="rd-stats" role="group" aria-label={label}>{children}</div>;
}

export function Stat({ label, value, unit, sub, tone, icon, iconTone, lead, explain }: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: RoleTone | StateTone;
  icon?: LucideIcon;
  iconTone?: RoleTone | StateTone;
  lead?: boolean;
  explain?: ReactNode;
}) {
  return (
    <div className="rd-stat" data-cp="stat" data-lead={lead ? "" : undefined}>
      {icon && <IconTile tone={iconTone ?? tone ?? "role-other"} icon={icon} size={lead ? 40 : 28} />}
      <div>
        <div className="rd-stat-label">
          {label}
          {explain && <Explain label={typeof label === "string" ? `${label}的口径` : "数字口径"} content={explain} />}
        </div>
        <div className="rd-stat-value" data-tone={tone}>{value}{unit && <span className="rd-stat-unit">{unit}</span>}</div>
        {sub && <div className="rd-stat-sub">{sub}</div>}
      </div>
    </div>
  );
}
