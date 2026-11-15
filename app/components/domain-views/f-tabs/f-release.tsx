"use client";

/**
 * F 域五页共用的「解除待确认」入口（决定 R1-提案过期）：只给走审批的原申请，过期并且按原请求查询后端明确没有这张审批单时才出现。
 * 按钮打开 rd 的解除框，确认后调页面传进来的解除函数（函数里会再查一次原审批单）。直接保存的原操作不用这个入口。
 */
import { useState, type ReactNode } from "react";
import { Button, ReleaseModal } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";

export const RELEASE_EXPLAIN = "原申请超过 24 小时，按原请求查询，后端明确没有这张审批单：申请没建成，之后也不会再建成。解除前会再查一次。";

export function FReleaseButton({ label, onRelease, toast }: { label: ReactNode; onRelease: () => Promise<unknown>; toast: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>解除待确认</Button>
    {open && <ReleaseModal label={label} explain={RELEASE_EXPLAIN} onCancel={() => setOpen(false)} onConfirm={() => {
      setOpen(false);
      void onRelease().then(() => toast("已解除本页的待确认记录"), (error) => toast(displayAdminError(error)));
    }} />}
  </>;
}
