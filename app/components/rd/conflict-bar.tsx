"use client";

/**
 * ConflictBar 版本冲突（OP-97）。确认框或修改框提交时发现这项刚被别人改过：框不关、已填的留着，
 * 这一条写进框里的提示（blockedReason、错误条），按钮读最新，读到后由页面按最新的值重开框。
 *
 * <ConflictBar message="这组汇率刚被别人改过，这次没有保存。读取最新后再核对新值。" onRead={readLatest} />
 *
 * - message 写这一页被改的是什么，页面自己定；读取最新失败时组件换成统一的一句，已填的内容还在。
 * - onRead 失败要 throw，组件才知道没读到。
 */
import { useState, type ReactNode } from "react";
import { Button } from "./button";

export function ConflictBar({ message, onRead }: { message: ReactNode; onRead: () => Promise<void> }) {
  const [state, setState] = useState<"idle" | "reading" | "failed">("idle");
  const read = async () => {
    setState("reading");
    try {
      await onRead();
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <span className="rd-toolbar">
      <span>{state === "failed" ? "读取最新失败，稍后再试。已填写的内容还在。" : message}</span>
      <Button size="sm" loading={state === "reading"} onClick={() => void read()}>读取最新</Button>
    </span>
  );
}
