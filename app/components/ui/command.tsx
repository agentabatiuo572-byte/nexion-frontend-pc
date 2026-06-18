"use client";

/**
 * shadcn/ui Command — cmdk 之上的封装(命令面板 / ⌘K),已重皮到 Nexion V5 设计 token。
 * 来源:shadcn new-york `command`,色彩/圆角全部映射为 --v5-* / --admin-*。
 * CommandDialog 复用本工程 V5 皮肤的 ./dialog(Radix Dialog),自带 sr-only 标题保 a11y。
 * 一致性门(scripts/check-shadcn-tokens.mjs):本文件禁出现 shadcn 默认 token。
 */
import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/app/components/ui/dialog";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn("flex h-full w-full flex-col overflow-hidden rounded-[var(--admin-radius)]", className)}
      style={{ background: "var(--v5-surface)", color: "var(--v5-ink)" }}
      {...props}
    />
  );
}

function CommandDialog({
  title = "命令面板",
  description = "搜索并跳转到任意运营模块",
  children,
  className,
  showCloseButton = false,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn("overflow-hidden p-0", className)}
        showCloseButton={showCloseButton}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-[var(--v5-ink-4)]">
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex items-center gap-2.5 px-3.5"
      style={{ borderBottom: "1px solid var(--v5-border)" }}
      cmdk-input-wrapper=""
    >
      <SearchIcon className="size-4 shrink-0" style={{ color: "var(--v5-ink-4)" }} aria-hidden />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-11 w-full bg-transparent py-3 text-[13px] outline-none disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        style={{ color: "var(--v5-ink)" }}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[340px] scroll-py-1 overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-[12.5px]"
      style={{ color: "var(--v5-ink-4)" }}
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn("overflow-hidden p-1.5", className)}
      style={{ color: "var(--v5-ink)" }}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 my-1 h-px", className)}
      style={{ background: "var(--v5-border)" }}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-pointer select-none items-center gap-2 rounded-[var(--admin-radius-sm)] px-2.5 py-2 text-[13px] outline-none",
        "text-[var(--v5-ink-2)] data-[selected=true]:text-[var(--v5-ink)] data-[selected=true]:bg-[var(--v5-surface-3)]",
        "data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto font-mono-tabular text-[11px] tracking-widest", className)}
      style={{ color: "var(--v5-ink-4)" }}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
