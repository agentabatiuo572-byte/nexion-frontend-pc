"use client";

/**
 * 全局命令面板(⌘K)— PoC:验证 shadcn(cmdk)硬交互原语在 V5 皮肤下的融合。
 * 跳转目标消费 IA 单源 visibleDomains(role)(与侧边栏同源,按角色过滤),
 * 不维护第二份菜单副本;选中即 router.push 到该 L2 路由。
 */
import * as React from "react";
import { useRouter } from "next/navigation";

import type { AdminRole } from "@/lib/nav/console-nav";
import { visibleDomains } from "@/lib/nav/console-nav";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/app/components/ui/command";

interface CommandPaletteProps {
  role: AdminRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ role, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const domains = React.useMemo(() => visibleDomains(role), [role]);

  const go = React.useCallback(
    (path: string) => {
      onOpenChange(false);
      router.push(path);
    },
    [router, onOpenChange],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="全局命令面板"
      description="搜索并跳转到任意运营模块"
    >
      <CommandInput placeholder="跳转到模块 / 搜索 userId·工单·交易…" />
      <CommandList>
        <CommandEmpty>无匹配模块</CommandEmpty>
        {domains.map((domain) => (
          <CommandGroup key={domain.code} heading={`${domain.code} · ${domain.name}`}>
            {domain.l2.map((l2) => (
              <CommandItem
                key={l2.id}
                value={`${l2.id} ${l2.name} ${domain.name} ${l2.path}`}
                onSelect={() => go(l2.path)}
              >
                <span>{l2.name}</span>
                <CommandShortcut>{l2.id}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}
