import type { Metadata } from "next";
import "./globals.css";
import { ToastHost } from "./components/kit/toast-host";
import { ConfirmDialog } from "./components/kit/confirm-dialog";

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
      suppressHydrationWarning
    >
      <body className="min-h-full">
        {children}
        <ToastHost />
        <ConfirmDialog />
      </body>
    </html>
  );
}
