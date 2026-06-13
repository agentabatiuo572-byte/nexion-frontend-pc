/**
 * AuditTimeline — append-only 审计时间线(谁 / 何时 / 何动作 / 角色 / IP)。
 * 对齐 PRD §A2 审计记录;用于 D2 详情、E1 详情、C1 画像。
 */
import type { AdminRole } from "@/lib/nav/console-nav";
import { RoleBadge } from "./role-badge";

export interface AuditEntry {
  id: string;
  actor: string;
  role: AdminRole;
  action: string;
  detail?: string;
  at: string;
  ip?: string;
}

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="text-[12px]" style={{ color: "var(--v5-ink-4)" }}>
        暂无审计记录
      </p>
    );
  }
  return (
    <ul className="flex flex-col">
      {entries.map((e, i) => {
        const last = i === entries.length - 1;
        return (
          <li key={`${e.id}-${i}`} className="flex gap-3">
            {/* 时间线轴 */}
            <div className="flex flex-col items-center">
              <span
                className="mt-1 inline-block rounded-full"
                style={{ width: 7, height: 7, background: "var(--v5-tech-cyan)" }}
              />
              {!last && <span className="w-px flex-1" style={{ background: "var(--v5-border)" }} />}
            </div>
            {/* 内容 */}
            <div className={`flex-1 ${last ? "" : "pb-3.5"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <RoleBadge role={e.role} size="sm" />
                <span className="text-[12.5px]" style={{ color: "var(--v5-ink)" }}>
                  {e.actor}
                </span>
                <span className="text-[12.5px]" style={{ color: "var(--v5-ink-2)" }}>
                  {e.action}
                </span>
              </div>
              {e.detail && (
                <p className="mt-1 text-[11.5px]" style={{ color: "var(--v5-ink-3)" }}>
                  {e.detail}
                </p>
              )}
              <p className="mt-1 font-mono-tabular text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
                {e.at}
                {e.ip ? ` · ${e.ip}` : ""}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
