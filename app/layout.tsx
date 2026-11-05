import type { Metadata } from "next";
import "./globals.css";
import "./components/rd/tokens.css";
import "./components/rd/rd.css";
import "./components/shell/shell.css";
import { ToastHost } from "./components/kit/toast-host";
import { ConfirmDialog } from "./components/kit/confirm-dialog";
import { ThemeScript } from "./components/rd/theme-switch";

export const metadata: Metadata = {
  title: "UVEL 运营控制台",
  description: "UVEL 运营控制台",
  icons: { icon: "/uvel-mark-dark.png" },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="zh"
      className="h-full antialiased"
      data-theme="dark"
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full">
        {children}
        <ToastHost />
        <ConfirmDialog />
      </body>
    </html>
  );
}
