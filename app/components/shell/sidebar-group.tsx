"use client";

/**
 * 侧栏单域分组 — 折叠态=图标按钮(点击展开侧栏并打开该组);展开态=域头 + L2 链接列表。
 * active L2 左侧强调条 + surface-2 底;flagship L2 实心色点,scaffold 空心点。
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import type { NavDomain } from "@/lib/nav/console-nav";

export function SidebarGroup({
  domain,
  collapsed,
  isOpen,
  onToggle,
}: {
  domain: NavDomain;
  collapsed: boolean;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const pathname = usePathname();
  const Icon = domain.icon;
  const accent = `var(${domain.accentVar})`;
  const groupActive = domain.l2.some((l2) => l2.path === pathname);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        title={`${domain.code} ${domain.name}`}
        aria-label={`${domain.code} ${domain.name}`}
        className="mx-auto flex h-10 w-10 items-center justify-center rounded-[10px] transition-colors"
        style={{
          background: groupActive ? "var(--v5-surface-2)" : "transparent",
        }}
      >
        <Icon size={18} style={{ color: groupActive ? accent : "var(--v5-ink-3)" }} />
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
        className="group flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-[var(--v5-surface-2)]"
      >
        <Icon size={17} style={{ color: accent }} />
        <span className="flex-1 text-left text-[13px]" style={{ color: "var(--v5-ink-2)" }}>
          {domain.name}
        </span>
        <span
          className="font-mono-tabular text-[10px]"
          style={{ color: "var(--v5-ink-4)" }}
        >
          {domain.code}
        </span>
        <ChevronDown
          size={14}
          style={{
            color: "var(--v5-ink-4)",
            transform: isOpen ? "rotate(0deg)" : "rotate(-90deg)",
            transition: "transform 180ms ease",
          }}
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
            className="overflow-hidden"
            id={`nav-group-${domain.code}`}
          >
            {domain.l2.map((l2) => {
              const active = l2.path === pathname;
              const flagship = l2.status === "flagship";
              return (
                <li key={l2.id}>
                  <Link
                    href={l2.path}
                    prefetch={false}
                    className="relative flex items-center gap-2.5 rounded-[8px] py-1.5 pl-8 pr-2.5 text-[12.5px] transition-colors hover:bg-[var(--v5-surface-2)]"
                    style={{
                      color: active ? "var(--v5-ink)" : "var(--v5-ink-3)",
                      background: active ? "var(--v5-surface-2)" : "transparent",
                      fontWeight: active ? 600 : 400,
                    }}
                  >
                    {active && (
                      <span
                        className="absolute left-[14px] top-1/2 h-3.5 w-[2px] -translate-y-1/2 rounded-full"
                        style={{ background: accent }}
                      />
                    )}
                    <span
                      className="inline-block shrink-0 rounded-full"
                      style={{
                        width: 5,
                        height: 5,
                        background: flagship ? accent : "transparent",
                        border: flagship ? "none" : "1px solid var(--v5-ink-4)",
                      }}
                      aria-hidden
                    />
                    <span className="flex-1 truncate">{l2.name}</span>
                    <span
                      className="font-mono-tabular text-[9px] uppercase tracking-wide"
                      style={{ color: "var(--v5-ink-4)" }}
                    >
                      {l2.id}
                    </span>
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
