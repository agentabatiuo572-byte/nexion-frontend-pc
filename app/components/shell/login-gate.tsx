"use client";

/**
 * LoginGate — 原型登录壳(无真鉴权)。退出后出现,选运营身份 + 角色即可重新进入。
 * 仅用于让退出/RBAC 演示闭环;非安全边界。
 */
import { useState } from "react";
import type { AdminRole } from "@/lib/nav/console-nav";
import { ROLE_LABEL } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";

const ROLES: AdminRole[] = [
  "superadmin",
  "finance",
  "risk",
  "growth",
  "content",
  "support",
  "auditor",
];

export function LoginGate() {
  const signIn = useAdminAuth((s) => s.signIn);
  const [operator, setOperator] = useState("总管理员");
  const [role, setRole] = useState<AdminRole>("superadmin");

  return (
    <div
      className="flex h-screen w-screen items-center justify-center p-6"
      style={{ background: "var(--v5-bg)" }}
    >
      <div
        className="w-full max-w-sm rounded-[var(--admin-radius)] p-7"
        style={{
          background: "var(--v5-surface)",
          border: "1px solid var(--v5-border)",
          boxShadow: "var(--v5-card-shadow-lift-strong)",
        }}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-[9px] font-display"
          style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)", fontWeight: 600, fontSize: 18 }}
        >
          N
        </span>
        <h1 className="font-display mt-4 text-[20px]" style={{ color: "var(--v5-ink)" }}>
          运营控制台登录
        </h1>
        <p className="mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-3)" }}>
          原型环境 · 选择运营身份与角色进入
        </p>

        <label className="mt-5 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
          运营账号
        </label>
        <input
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="mt-1.5 w-full rounded-[9px] px-3 py-2 text-[13px] outline-none"
          style={{
            background: "var(--v5-surface-3)",
            border: "1px solid var(--v5-border)",
            color: "var(--v5-ink)",
          }}
        />

        <label className="mt-4 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
          角色
        </label>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as AdminRole)}
          className="mt-1.5 w-full rounded-[9px] px-3 py-2 text-[13px] outline-none"
          style={{
            background: "var(--v5-surface-3)",
            border: "1px solid var(--v5-border)",
            color: "var(--v5-ink)",
          }}
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => signIn(operator.trim() || "运营", role)}
          className="mt-6 w-full rounded-[10px] py-2.5 text-[13.5px] font-medium transition-opacity hover:opacity-90 active:opacity-80"
          style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
        >
          进入控制台
        </button>
      </div>
    </div>
  );
}
