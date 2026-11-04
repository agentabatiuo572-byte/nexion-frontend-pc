"use client";

/**
 * 侧栏单域分组 — 折叠态=图标按钮(点击展开侧栏并打开该组);展开态=域头 + L2 链接列表。
 * 图标按业务类别上色(DOMAIN_TONE);当前页用品牌色小点和浅底标出。域字母和页面编号不显示(DP-30)。
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
  badges?: Record<string, number>;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const tone = DOMAIN_TONE[domain.code] ?? "system";
  const groupActive = domain.l2.some((l2) => l2.path === pathname);
  const groupBadge = badges ? domain.l2.reduce((sum, l2) => sum + (badges[l2.path] ?? 0), 0) : 0;
  // 待处理计数徽标:橙黄表示有要处理的(06 第 2.2 节)。
  const navBadge = (n: number) => (
    <span className="rd-nav-badge font-mono-tabular" aria-label={`${n} 条待处理`}>
      {n > 99 ? "99+" : n}
    </span>
  );

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={domain.name}
        aria-label={domain.name}
        className="rd-nav-rail"
        data-active={groupActive ? "" : undefined}
      >
        <IconTile tone={tone} icon={domain.icon} size={22} />
        {groupBadge > 0 && <span className="rd-nav-dot-badge" aria-label={`${groupBadge} 条待处理`} />}
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
      >
        <IconTile tone={tone} icon={domain.icon} size={22} />
        <span className="flex-1 truncate text-left">{domain.name}</span>
        {!isOpen && groupBadge > 0 && navBadge(groupBadge)}
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
                    <span className="rd-nav-dot" data-current={active ? "" : undefined} data-scaffold={l2.status === "flagship" ? undefined : ""} aria-hidden />
                    <span className="flex-1 truncate" title={l2.name}>{l2.name}</span>
                    {(badges?.[l2.path] ?? 0) > 0 && navBadge(badges?.[l2.path] ?? 0)}
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
