import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "./components/theme-provider";
import { ToastHost } from "./components/kit/toast-host";
import { ConfirmDialog } from "./components/kit/confirm-dialog";

export const metadata: Metadata = {
  title: "NexGrid 运营控制台",
  description: "NexGrid Ops Console — 内部运营操盘系统(原型)",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh"
      data-theme="dark"
      className="h-full antialiased"
      suppressHydrationWarning
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
