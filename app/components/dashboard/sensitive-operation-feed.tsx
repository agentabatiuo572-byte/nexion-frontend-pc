"use client";

/** 高敏操作动态 — 跨域确认动作聚合。presentational,items 由首页组合(含实时提现处置)。 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { RoleBadge } from "@/app/components/kit/role-badge";
import { AutoGloss } from "@/app/components/kit/gloss";

export interface SensitiveOperationItem {
  id: string;
  label: string;
  detail: string;
  href: string;
  role: AdminRole;
}

export function SensitiveOperationFeed({ items }: { items: SensitiveOperationItem[] }) {
  return (
    <div className="rounded-[14px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-center justify-between">
        <span className="font-display text-[15px]" style={{ color: "var(--v5-ink)" }}>高敏操作动态</span>
        <span
          className="font-mono-tabular rounded-full px-2 py-0.5 text-[11px]"
          style={{ background: "color-mix(in srgb, var(--v5-brand) 16%, transparent)", color: "var(--v5-brand)" }}
        >
          {items.length} 项
        </span>
      </div>
      <ul className="mt-3 flex flex-col gap-1.5">
        {items.map((it) => (
          <li key={it.id}>
            <Link
              href={it.href}
              prefetch={false}
              className="flex items-center gap-3 rounded-[10px] p-2.5 transition-colors hover:bg-[var(--v5-surface-2)]"
              style={{ border: "1px solid var(--v5-border)" }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>{it.label}</AutoGloss></p>
                <p className="mt-0.5 text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>{it.detail}</AutoGloss></p>
              </div>
              <RoleBadge role={it.role} size="sm" />
              <ChevronRight size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
            </Link>
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-4 text-center text-[12.5px]" style={{ color: "var(--v5-ink-4)" }}>
            暂无高敏动态
          </li>
        )}
      </ul>
    </div>
  );
}
