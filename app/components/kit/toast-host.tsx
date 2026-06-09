"use client";

/** ToastHost — 右上角 toast 堆栈,在 root layout 挂载一次。用 toast.* 触发。 */
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from "lucide-react";
import type { ToastKind } from "@/lib/store/ui";
import { useUI } from "@/lib/store/ui";

const KIND: Record<ToastKind, { varName: string; Icon: typeof Info }> = {
  success: { varName: "--v5-success", Icon: CheckCircle2 },
  info: { varName: "--admin-blue", Icon: Info },
  warn: { varName: "--v5-warning", Icon: AlertTriangle },
  error: { varName: "--v5-danger", Icon: XCircle },
};

export function ToastHost() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);

  return (
    <div
      className="pointer-events-none fixed right-5 top-5 flex w-[340px] flex-col gap-2"
      style={{ zIndex: "var(--admin-z-toast)" }}
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => {
          const { varName, Icon } = KIND[t.kind];
          const c = `var(${varName})`;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 24, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-[12px] p-3"
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
