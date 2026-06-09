"use client";

/**
 * 顶栏 UTC 时钟 — mounted 门控:SSR 渲染静态占位 `--:--:-- UTC`,水合后每秒走字。
 * 避免读 Date.now() 造成 SSR/client 不一致的 hydration error。
 */
import { useEffect, useState } from "react";

function nowUtc(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

export function UtcClock() {
  const [time, setTime] = useState<string | null>(null);

  useEffect(() => {
    setTime(nowUtc());
    const id = setInterval(() => setTime(nowUtc()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="font-mono-tabular text-[12px] tracking-tight"
      style={{ color: "var(--v5-ink-3)" }}
      suppressHydrationWarning
    >
      {time ?? "--:--:--"}
      <span style={{ color: "var(--v5-ink-4)" }}> UTC</span>
    </span>
  );
}
