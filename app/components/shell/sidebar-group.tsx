"use client";

/**
 * 侧栏单域分组 — 折叠态=图标按钮(点击展开侧栏并打开该组);展开态=域头 + L2 链接列表。
 * 图标按业务类别上色(DOMAIN_TONE)。侧栏显示域字母和页面编号,帮运营认页面:页面编号在页名前、和域图标同一列,等宽弱色;域字母在域头箭头前;折叠态的悬停提示写「字母 域名」。面包屑和页头仍不显示编号。
 * 当前页用浅底和紧跟页名的品牌色小点标出。
 * 当前页所在的域收起时,域头也用浅底、加粗和紧跟域名的品牌色小点标出,不自动展开(SH-H01)。名字省略时小点跟在省略号后。域字母紧挨箭头,徽标在字母前。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import type { NavDomain } from "@/lib/nav/console-nav";
import { IconTile } from "@/app/components/rd/icon-tile";
import { DOMAIN_TONE } from "@/app/components/rd/tone";

export function SidebarGroup({
  domain,
  collapsed,
  isOpen,
  badges,
  onToggle,
}: {
  domain: NavDomain;
  collapsed: boolean;
  isOpen: boolean;
  badges?: Record<string, number | "—">;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const tone = DOMAIN_TONE[domain.code] ?? "system";
  const groupActive = domain.l2.some((l2) => l2.path === pathname);
  const counts = domain.l2.map(l2 => badges?.[l2.path]);
  const groupBadge = counts.includes("—") ? "—" : counts.reduce<number>((sum, count) => sum + (typeof count === "number" ? count : 0), 0);
  // 待处理计数徽标:橙黄表示有要处理的(06 第 2.2 节)。读不到写「—」,弱文字,不用橙黄(VS-11);折叠栏也要看得出。
  const navBadge = (n: number | "—") => (
    <span className="rd-nav-badge font-mono-tabular" data-unknown={n === "—" ? "" : undefined} aria-label={n === "—" ? undefined : `${n} 条待处理`}>
      {typeof n === "number" && n > 99 ? "99+" : n}
    </span>
  );

  if (collapsed) {
    const railLabel = groupBadge === "—" ? `${domain.code} ${domain.name} · 待处理数暂时读不到` : `${domain.code} ${domain.name}`;
    return (
      <button
        type="button"
        onClick={onToggle}
        title={railLabel}
        aria-label={railLabel}
        className="rd-nav-rail"
        data-active={groupActive ? "" : undefined}
      >
        <IconTile tone={tone} icon={domain.icon} size={22} />
        {typeof groupBadge === "number" && groupBadge > 0 && <span className="rd-nav-dot-badge" aria-label={`${groupBadge} 条待处理`} />}
        {groupBadge === "—" && <span className="rd-nav-rail-unknown" aria-hidden>—</span>}
      </button>
    );
  }

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={`nav-group-${domain.code}`}
        className="rd-nav-item"
        data-group-open={isOpen ? "" : undefined}
        data-active={groupActive && !isOpen ? "" : undefined}
      >
        <IconTile tone={tone} icon={domain.icon} size={22} />
        <span className="rd-nav-name text-left">
          <span>{domain.name}</span>
          {!isOpen && groupActive && <span className="rd-nav-dot" data-current="" aria-hidden />}
        </span>
        {!isOpen && groupBadge ? navBadge(groupBadge) : null}
        <span className="rd-nav-letter font-mono-tabular">{domain.code}</span>
        <ChevronRight
          size={14}
          className="rd-nav-chevron"
          style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.ul
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="rd-nav-children overflow-hidden"
            id={`nav-group-${domain.code}`}
          >
            {domain.l2.map((l2) => {
              const active = l2.path === pathname;
              return (
                <li key={l2.id}>
                  <Link
                    href={l2.path}
                    prefetch={false}
                    className="rd-nav-sub"
                    aria-current={active ? "page" : undefined}
                    data-active={active ? "" : undefined}
                  >
                    <span className="rd-nav-code font-mono-tabular">{l2.id}</span>
                    <span className="rd-nav-name">
                      <span title={l2.name}>{l2.name}</span>
                      {active && <span className="rd-nav-dot" data-current="" aria-hidden />}
                    </span>
                    {badges?.[l2.path] ? navBadge(badges[l2.path]) : null}
                  </Link>
                </li>
              );
            })}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
