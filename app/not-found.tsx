/**
 * 全局 404 — 未匹配 nav 的路径落此(catch-all 调 notFound() 时)。
 * 渲染于 (console) 布局之外,故自带最小品牌外观 + 返回总览链接。
 */
import Link from "next/link";

export default function NotFound() {
  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 p-6"
      style={{ background: "var(--v5-bg)" }}
    >
      <span
        className="font-mono-tabular text-[44px]"
        style={{ color: "var(--v5-ink-4)" }}
      >
        404
      </span>
      <p className="text-[14px]" style={{ color: "var(--v5-ink-2)" }}>
        该运营模块不存在或路径有误。
      </p>
      <Link
        href="/"
        prefetch={false}
        className="rounded-[10px] px-4 py-2 text-[13px] font-medium"
        style={{ background: "var(--v5-brand)", color: "var(--v5-on-brand)" }}
      >
        返回运营总览
      </Link>
    </div>
  );
}
