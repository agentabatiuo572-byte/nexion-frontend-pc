import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./components/theme-provider";
import { ToastHost } from "./components/kit/toast-host";
import { ConfirmDialog } from "./components/kit/confirm-dialog";

/**
 * Body / display font — Manrope (对齐设计稿 V5 Dark spec:Manrope + JetBrains Mono).
 * 经 next/font 自托管,winning the font-family chain via --font-display → --font-v5.
 */
const manrope = Manrope({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/** JetBrains Mono — ledger amounts, IDs, timestamps, live metrics (tabular). */
const jetMono = JetBrains_Mono({
  variable: "--font-jet-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nexion 运营控制台",
  description: "Nexion Ops Console — 内部运营操盘系统(原型)",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh"
      data-theme="dark"
      className={`${manrope.variable} ${jetMono.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        <ThemeProvider />
        {children}
        <ToastHost />
        <ConfirmDialog />
      </body>
    </html>
  );
}
