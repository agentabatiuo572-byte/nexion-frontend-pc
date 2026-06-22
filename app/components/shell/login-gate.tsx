"use client";

/**
 * LoginGate — 后台账号密码登录。
 */
import type { FormEvent } from "react";
import { useState } from "react";
import { Loader2, LockKeyhole, LogIn, UserRound } from "lucide-react";
import { loginAdmin } from "@/lib/admin/auth-client";
import { useAdminAuth } from "@/lib/store/admin-auth";

export function LoginGate() {
  const signIn = useAdminAuth((s) => s.signIn);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUsername = username.trim();
    if (!normalizedUsername || !password) {
      setError("请输入账号和密码");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const result = await loginAdmin(normalizedUsername, password);
      signIn(result);
      setPassword("");
    } catch {
      setError("账号或密码不正确");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="flex h-screen w-screen items-center justify-center p-6"
      style={{ background: "var(--v5-bg)" }}
    >
      <form
        onSubmit={handleSubmit}
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
          请输入后台账号和密码
        </p>

        <label className="mt-5 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
          账号
        </label>
        <div
          className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3"
          style={{
            background: "var(--v5-surface-3)",
            border: "1px solid var(--v5-border)",
            color: "var(--v5-ink)",
          }}
        >
          <UserRound size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            aria-label="账号"
            className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
            style={{ color: "var(--v5-ink)" }}
          />
        </div>

        <label className="mt-4 block text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
          密码
        </label>
        <div
          className="mt-1.5 flex items-center gap-2 rounded-[9px] px-3"
          style={{
            background: "var(--v5-surface-3)",
            border: "1px solid var(--v5-border)",
            color: "var(--v5-ink)",
          }}
        >
          <LockKeyhole size={15} style={{ color: "var(--v5-ink-4)" }} aria-hidden />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-label="密码"
            className="min-w-0 flex-1 bg-transparent py-2 text-[13px] outline-none"
            style={{ color: "var(--v5-ink)" }}
          />
        </div>

        {error && (
          <p className="mt-3 rounded-[8px] px-3 py-2 text-[12px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 10%, transparent)", color: "var(--v5-danger)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-[10px] py-2.5 text-[13.5px] font-medium transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
        >
          {submitting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <LogIn size={16} aria-hidden />}
          登录
        </button>
      </form>
    </div>
  );
}
