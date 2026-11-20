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
 * 只有两三个数时 StatBand 传 fit：每格从内容宽往外长，填满一行，放不下才换行；不拉成等宽的半格让数字孤零零留在左边。
 * 读取失败传 value="—"，不写 0（CP-42）。explain 是口径说明，收进名称旁的提示图标（DP-06、DP-36）；sub 只放数据（昨天全天多少、涉及几个账户），说明不写在 sub 里。
 * 深色主题数字用角色色字，浅色主题数字用正文色、身份靠实色图标底（VS-14），这条写在 rd.css 里。
 * 普通数字 24px，lead 40px（VS-50）。名称、数字、单位、第二行分四层，页面不改字号；长金额放不下时 rd.css 换行，不缩字。
 * 值是 0、0.00、$0、0% 或「—」时弱化：字色弱、图标底灰、lead 不放大，最大的字不给 0（novice-2、visual-1 第 7 条）。
 * 大字只给数字：不带数字的文字（「无权限」「暂时无法估值」）不是答案，16px，传了 lead 也不放大（DT-21）。
 * 这一屏的结论已经放大了数字（Conclusion lead 里的 <b>）时不传 lead，每屏一个 40px。
 * 带 data-cp="stat"，首屏检查按它数。
 * 整张可点：传 href 跳页，或传 onOpen 做页内动作，openLabel 是读屏名字。问号和 sub 里的按钮浮在上面，各点各的。
 * 目标页不可达时不传（X03）。
 *
 * 当选择器用（点一格筛下面的列表，或选一张卡看它的内容）：onOpen 加 selected。选中的一格是选中底加一条品牌色底边，selectedText 写「当前等级」「已筛选」这类字，不只靠颜色。
 * 语义由页面定，原样落到那颗按钮上：筛选开关传 aria-pressed；页签传 role="tab"、aria-selected、aria-controls、id、tabIndex、onKeyDown，
 * 外面的 StatBand 传 role="tablist"，方向键怎么走由页面按页签的规则处理（nextTabValue）。这些都不传时和原来一样。
 *
 * 一格一张卡（E2 等级卡）：StatBand 传 cards，每个 Stat 是一张独立的卡，四张一排，内容区窄于 900 时两两一行，同排同高。
 * 卡头传 head（等级名加小等级条），补充区写成 children（比例条、刻度条、几行小计），排在数字下面，整张卡仍是一颗选择按钮，补充区里的问号各点各的。
 * 选中的卡除了底和底边，底边中间还有一个朝下的小尖角，指着下面跟着它变的面板。整卡要人注意时传 surface="warn"（浅底，不是整卡涂色）。
 * 卡里 sub 排在数字右边（「12 个 · 共 20 个」）。排法样例见 README「等级卡」。
 */
import type { KeyboardEventHandler, ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Explain } from "./explain";
import { IconTile } from "./icon-tile";
import type { RoleTone, StateTone } from "./tone";

/** 0、0.00、$0、0%、「—」：不是要看的数。 */
const ZERO = /^[-–—]$|^\$?0(?:[.,]0+)?\s*%?$/;

/** fit：只有两三个数时传，每格从内容宽往外长填满一行，不拉成等宽的半格（D6）。cards：一格一张卡。role：这组格当页签用时传 tablist。 */
export function StatBand({ children, label, fit, cards, role = "group" }: { children: ReactNode; label?: string; fit?: boolean; cards?: boolean; role?: "group" | "tablist" }) {
  return <div className="rd-stats" role={role} aria-label={label} data-fit={fit ? "" : undefined} data-cards={cards ? "" : undefined}>{children}</div>;
}

export function Stat({ label, value, unit, sub, tone, icon, iconTone, lead, explain, href, onOpen, openLabel, selected, selectedText, head, surface, children, id, role, tabIndex, onKeyDown, "aria-selected": ariaSelected, "aria-controls": ariaControls, "aria-pressed": ariaPressed }: {
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
  /** 这一格是当前选中的：选中底、品牌色底边。 */
  selected?: boolean;
  /** 选中时写的字，比如「当前等级」。 */
  selectedText?: ReactNode;
  /** 卡头，只在 StatBand cards 里用。 */
  head?: ReactNode;
  /** 整卡的浅底，只在 StatBand cards 里用，留给要人注意的卡。 */
  surface?: StateTone;
  /** 补充区，只在 StatBand cards 里用。 */
  children?: ReactNode;
  /** 以下几项原样落到 onOpen 的那颗按钮上。 */
  id?: string;
  role?: "tab";
  tabIndex?: number;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  "aria-selected"?: boolean;
  "aria-controls"?: string;
  "aria-pressed"?: boolean;
}) {
  const zero = typeof value === "number" ? value === 0 : typeof value === "string" && ZERO.test(value.trim());
  const words = !zero && typeof value === "string" && !/\d/.test(value);
  const big = lead && !zero && !words;
  const now = selected && selectedText ? <span className="rd-stat-now">{selectedText}</span> : null;
  return (
    <div className="rd-stat" data-cp="stat" data-lead={big ? "" : undefined} data-selected={selected ? "" : undefined} data-surface={surface}>
      {href && <Link className="rd-stat-hit" href={href} prefetch={false} aria-label={openLabel} />}
      {!href && onOpen && <button type="button" className="rd-stat-hit" aria-label={openLabel} onClick={onOpen} id={id} role={role} tabIndex={tabIndex} onKeyDown={onKeyDown} aria-selected={ariaSelected} aria-controls={ariaControls} aria-pressed={ariaPressed} />}
      {head && <div className="rd-stat-head">{head}{now}</div>}
      {icon && <IconTile tone={zero ? "role-other" : iconTone ?? tone ?? "role-other"} icon={icon} size={big ? 40 : 28} />}
      <div className="rd-stat-main">
        <div className="rd-stat-label">
          {label}
          {explain && <Explain label={typeof label === "string" ? `${label}的口径` : "数字口径"} content={explain} side="top" align="start" />}
          {!head && now}
        </div>
        <div className="rd-stat-value" data-tone={tone} data-zero={zero ? "" : undefined} data-words={words ? "" : undefined}>{value}{unit && <span className="rd-stat-unit">{unit}</span>}</div>
        {sub && <div className="rd-stat-sub">{sub}</div>}
      </div>
      {children && <div className="rd-stat-extra">{children}</div>}
    </div>
  );
}
