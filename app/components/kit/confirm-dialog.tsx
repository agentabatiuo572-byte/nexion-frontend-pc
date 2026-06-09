"use client";

/** ConfirmDialog — 模态确认框,在 root layout 挂载一次。用 confirm({...}) 调用并 await 结果。 */
import { AnimatePresence, motion } from "framer-motion";
import { useUI } from "@/lib/store/ui";

export function ConfirmDialog() {
  const queue = useUI((s) => s.confirmQueue);
  const resolve = useUI((s) => s.resolveConfirm);
  const top = queue[0];

  return (
    <AnimatePresence>
      {top && (
        <motion.div
          key={top.id}
          className="fixed inset-0 flex items-center justify-center p-6"
          style={{ zIndex: "calc(var(--admin-z-toast) + 5)", background: "rgba(0,0,0,0.55)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={() => !top.hideCancel && resolve(top.id, false)}
        >
          <motion.div
            className="w-full max-w-[400px] rounded-[14px] p-5"
            style={{
              background: "var(--v5-surface)",
              border: "1px solid var(--v5-border-strong)",
              boxShadow: "var(--v5-card-shadow-lift-strong)",
            }}
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-[16px]" style={{ color: "var(--v5-ink)" }}>
              {top.title}
            </h2>
            {top.message && (
              <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--v5-ink-2)" }}>
                {top.message}
              </p>
            )}
            {top.content && <div className="mt-3">{top.content}</div>}

            <div className="mt-5 flex items-center justify-end gap-2.5">
              {!top.hideCancel && (
                <button
                  type="button"
                  onClick={() => resolve(top.id, false)}
                  className="rounded-[9px] px-3.5 py-2 text-[13px] transition-colors hover:bg-[var(--v5-surface-2)]"
                  style={{ color: "var(--v5-ink-3)", fontWeight: 400 }}
                >
                  {top.cancelLabel ?? "取消"}
                </button>
              )}
              <button
                type="button"
                autoFocus
                onClick={() => resolve(top.id, true)}
                className="rounded-[9px] px-4 py-2 text-[13px] font-medium transition-opacity hover:opacity-90 active:opacity-80"
                style={{
                  background: top.danger ? "var(--v5-danger)" : "var(--v5-brand)",
                  color: top.danger ? "#FFFFFF" : "var(--v5-on-brand)",
                }}
              >
                {top.confirmLabel ?? "确认"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
