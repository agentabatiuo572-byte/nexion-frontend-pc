"use client";

/**
 * ToastHost — 顶部居中 toast 堆栈,在 root layout 挂载一次。用 toast.* 触发。
 * 位置照 Ant Design Message：距视口顶 8px，落在顶栏那一条里，不盖页标题和页头的主按钮。
 * 一行高 40，放得进 56 的顶栏；折成两行也停在页标题上面的留白里。
 */
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import type { ToastKind } from "@/lib/store/ui";
import { useUI } from "@/lib/store/ui";

const KIND: Record<ToastKind, { varName: string; Icon: typeof Info }> = {
  success: { varName: "--rd-ok", Icon: CheckCircle2 },
  info: { varName: "--rd-progress", Icon: Info },
  warn: { varName: "--rd-warn", Icon: AlertTriangle },
  error: { varName: "--rd-danger", Icon: XCircle },
};

export function ToastHost({ dialogId }: { dialogId?: string }) {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  const pause = useUI((s) => s.pauseToast);
  const resume = useUI((s) => s.resumeToast);
  const activeDialog = useUI((s) => s.dialogs.at(-1));
  if (dialogId !== activeDialog || !toasts.length) return null;

  return (
    <div
      className={dialogId ? "rd-dialog-feedback flex flex-col gap-2" : "pointer-events-none fixed left-1/2 flex -translate-x-1/2 flex-col gap-2"}
      role="status"
      style={dialogId ? undefined : {
        zIndex: "var(--admin-z-toast)",
        top: 8,
        width: "min(420px, calc(100vw - 40px))",
      }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const { varName, Icon } = KIND[t.kind];
          const c = `var(${varName})`;
          return (
            <motion.div
              key={t.id}
              onMouseEnter={() => pause(t.id)}
              onMouseLeave={() => resume(t.id)}
              layout
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className={dialogId ? "pointer-events-auto flex items-start gap-2.5 rounded-[12px] p-3" : "pointer-events-auto flex items-start gap-2.5 rounded-[8px] px-3 py-[9px]"}
              style={{
                background: "var(--v5-surface)",
                border: "1px solid var(--v5-border-strong)",
                borderLeft: `3px solid ${c}`,
                boxShadow: "var(--v5-card-shadow-lift-strong)",
              }}
            >
              <Icon size={17} style={{ color: c, marginTop: 1 }} />
              <div className="flex-1">
                <p className="text-[13px] font-medium" style={{ color: "var(--v5-ink)" }}>
                  {t.title}
                </p>
                {t.description && (
                  <p className="mt-0.5 text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
                    {t.description}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="关闭"
                className="shrink-0 rounded-[6px] p-0.5 transition-colors hover:bg-[var(--v5-surface-2)]"
                style={{ color: "var(--v5-ink-4)" }}
              >
                <X size={14} />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
