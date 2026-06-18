"use client";

/**
 * shadcn/ui Dialog — Radix Dialog 之上的封装,已重皮到 Nexion V5 设计 token。
 * 来源:shadcn new-york `dialog`,色彩/圆角/层级全部映射为 --v5-* / --admin-*。
 * 引入方式:手工落地 shadcn 源码(源码归本工程所有,可改),非默认主题。
 * 一致性门见 scripts/check-shadcn-tokens.mjs:本文件禁出现 shadcn 默认语义 token,
 * 色彩/圆角/层级一律走 V5 变量(权威清单在门脚本,勿在此重复列举)。
 */
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@/lib/utils";

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger(props: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal(props: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose(props: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn("fixed inset-0", className)}
      style={{ background: "rgba(0,0,0,0.5)", zIndex: "var(--admin-z-drawer)" }}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          "fixed left-1/2 top-1/2 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 rounded-[var(--admin-radius)] p-6 outline-none",
          className,
        )}
        style={{
          zIndex: "calc(var(--admin-z-drawer) + 1)",
          background: "var(--v5-surface)",
          border: "1px solid var(--v5-border-strong)",
          color: "var(--v5-ink)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.55)",
        }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            aria-label="关闭"
            className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-[var(--admin-radius-sm)] transition-opacity hover:opacity-70"
            style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}
          >
            <XIcon size={15} aria-hidden />
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-header" className={cn("flex flex-col gap-1.5 text-center sm:text-left", className)} {...props} />;
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-footer" className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-[15px] font-semibold leading-none", className)}
      style={{ color: "var(--v5-ink)" }}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-[12.5px]", className)}
      style={{ color: "var(--v5-ink-3)" }}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
