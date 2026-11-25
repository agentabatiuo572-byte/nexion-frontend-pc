"use client";

/**
 * 全局命令面板(⌘K)— PoC:验证 shadcn(cmdk)硬交互原语在 V5 皮肤下的融合。
 * 跳转目标消费 IA 统一来源 visibleDomains(role)(与侧边栏同源,按角色过滤),
 * 不维护第二份菜单副本;选中后请求跳转到该 L2 路由。今日概览不在域里,和侧边栏一样按 showHome 单独放。
 * 页面编号只作搜索关键字,不显示(DP-30)。
 */
import * as React from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";

import type { NavDomain } from "@/lib/nav/console-nav";
import { requestPageNavigation } from "@/lib/nav/leave-navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/app/components/ui/command";

interface CommandPaletteProps {
  domains: NavDomain[];
  showHome: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
}

export function CommandPalette({ domains, showHome, open, onOpenChange, triggerRef }: CommandPaletteProps) {
  const router = useRouter();

  const go = React.useCallback(
    (path: string) => {
      // Close the palette's focus scope before the leave dialog captures its opener.
      flushSync(() => onOpenChange(false));
      triggerRef.current?.focus();
      requestPageNavigation(path, router);
    },
    [router, onOpenChange, triggerRef],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="查找功能页面"
      description="搜索并跳转到任意运营模块"
    >
      <CommandInput placeholder="输入页面名称" />
      <CommandList>
        <CommandEmpty>没有匹配的页面</CommandEmpty>
        {showHome && (
          <CommandGroup>
            <CommandItem value="今日概览 首页 B0 /" onSelect={() => go("/")}>
              <span>今日概览</span>
            </CommandItem>
          </CommandGroup>
        )}
        {domains.map((domain) => (
          <CommandGroup key={domain.code} heading={domain.name}>
            {domain.l2.map((l2) => (
              <CommandItem
                key={l2.id}
                value={`${l2.id} ${l2.name} ${domain.name} ${l2.path}`}
                onSelect={() => go(l2.path)}
              >
                <span>{l2.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
