"use client";

import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { Button, Check, Fact, Facts, KeepText, Modal, StatusTag } from "@/app/components/rd";
import { businessStamp, businessZone } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { FundInvestigationOutcome } from "@/lib/admin/fund-command-investigation";
import { RETRY_REJECTED_STATUS } from "@/lib/admin/retry-rejected";

/** 恢复行的标签：重试被明确拒绝、原操作结果还没核实。 */
export const rejectedTag = () => <StatusTag tone={RETRY_REJECTED_STATUS.tone}>{RETRY_REJECTED_STATUS.label}</StatusTag>;
/** 共用恢复面板的行：被拒绝、又没查到回执时写「重试被拒绝」；查到回执或查询失败时照查到的写。 */
export const replayRejectedStatus = (rejected: boolean, outcome?: FundInvestigationOutcome) =>
  rejected && !(outcome && ("error" in outcome || outcome.receipt)) ? RETRY_REJECTED_STATUS : undefined;

type Release = {
  operation: ReactNode;
  /** 对象和改动；操作名里已经写了对象时不传。 */
  target?: ReactNode;
  /** target 那一行的名称，默认「对象」；操作名里已有对象、这里只写改了什么时传「改动」。 */
  targetLabel?: string;
  createdAt: number;
  getSnapshot: () => string | undefined;
  /** 返回 pending 时，由调用方在读回和交接完成后解除、反馈。 */
  release: () => boolean | void | "pending";
};

/** 恢复行上的「核实后解除」：和「查询原操作」排在一起、放最后，弱一档。 */
export function VerifiedReleaseButton({ disabled, onClick }: { disabled?: boolean; onClick: () => void }) {
  return <Button size="sm" variant="ghost" disabled={disabled} onClick={onClick}>核实后解除</Button>;
}

/** 重试被明确拒绝后的本地人工解除（OP-93 第 8 条）：写清是哪一条，勾选已核实才能确认；不发请求。 */
export function useVerifiedRelease(toast: (message: string, kind?: "success" | "warn") => void) {
  const [current, setCurrent] = useState<(Release & { snapshot: string }) | null>(null);
  const [verified, setVerified] = useState(false);
  const close = () => setCurrent(null);
  const changed = () => toast("这条记录刚有变化，没有解除，请看最新状态。", "warn");
  return {
    ask: (next: Release) => {
      const snapshot = next.getSnapshot();
      if (snapshot === undefined) { changed(); return; }
      setVerified(false);
      setCurrent({ ...next, snapshot });
    },
    dialog: current && <Modal title="解除原操作记录" icon={ShieldCheck} dirty={verified} onClose={close} footer={<>
      <Button onClick={close}>取消</Button>
      <Button variant="primary" disabledReason={verified ? undefined : "请先勾选「我已核实原操作的结果」"} onClick={() => {
        close();
        try {
          if (current.snapshot !== current.getSnapshot()) { changed(); return; }
          const released = current.release();
          if (released === "pending") return;
          if (released === false) { changed(); return; }
          toast("已解除这条记录。", "success");
        } catch (error) { toast(displayAdminError(error), "warn"); }
      }}>确认解除</Button>
    </>}>
      <div className="rd-stack">
        <Facts>
          <Fact k="原操作">{current.operation}</Fact>
          {current.target && <Fact k={current.targetLabel ?? "对象"}>{current.target}</Fact>}
          <Fact k="发出时间">{`${businessStamp(current.createdAt)}（${businessZone().label}）`}</Fact>
        </Facts>
        <p><KeepText text="重试被拒绝不等于原操作没生效，请先到操作记录与审批核对。" /></p>
        <p><KeepText text="解除后这一项可以重新操作（以当时的数据和权限为准），原操作不再重试，也不会撤销。只清这个标签页里的记录，不进操作记录。" /></p>
        <Check label="我已核实原操作的结果" checked={verified} onChange={(event) => setVerified(event.target.checked)} />
      </div>
    </Modal>,
  };
}
