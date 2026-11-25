"use client";

/**
 * M 域「核实后解除」（OP-93 第 8 条）：按原操作重试被后台拒绝，人核实过原操作的结果后，清掉这个标签页里的记录。
 * M4 常见问答、M1 正式转绑、M5 服务规则和欢迎语共用。原操作的框开着时换成这个框，不叠在上面（PG-38）。
 */
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Button, Check, Fact, Facts, Modal } from "@/app/components/rd";
import { useReach } from "@/lib/nav/use-reach";
import { ADMIN_ERROR_MESSAGES } from "@/lib/admin/error-messages";
import { businessStamp, businessZone } from "@/lib/admin/business-time";

export type MReleaseTarget = {
  /** 做的是什么，例如「编辑常见问答」。 */
  action: ReactNode;
  /** 对哪一个，例如问题原文、客户。 */
  object: ReactNode;
  createdAt: number;
  /** 后台拒绝重试时的原因码；认得的才写中文，不认得的不写。 */
  rejection?: string;
};

/** 去操作记录与审批的链接；没有查看权限时不显示（ST-58）。 */
export function MAuditLink() {
  const reach = useReach();
  return reach("/platform/audit", "platform_a2_read")
    ? <Link className="rd-link" href="/platform/audit" prefetch={false}>到操作记录与审批核对</Link> : null;
}

export function mFocusTarget(...targets: (HTMLElement | null | undefined)[]) {
  return targets.find(target => target?.isConnected && target.getClientRects().length > 0
    && !target.matches(":disabled, [aria-disabled=true]")) ?? null;
}

export function MReleaseModal({ target, where, onCancel, onConfirm, returnFocus }: {
  target: MReleaseTarget;
  /** 先到哪里核实，一句话。 */
  where: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const [checked, setChecked] = useState(false);
  const reason = target.rejection ? ADMIN_ERROR_MESSAGES[target.rejection] : undefined;
  return (
    <Modal title="解除原操作记录" icon={ShieldCheck} onClose={onCancel} returnFocus={returnFocus} footer={<>
      <Button onClick={onCancel}>取消</Button>
      <Button variant="primary" disabledReason={checked ? undefined : "先勾选「已核实」"} onClick={onConfirm}>确认解除</Button>
    </>}>
      <Facts>
        <Fact k="原操作">{target.action}</Fact>
        <Fact k="对象"><span className="m-release-object">{target.object}</span></Fact>
        <Fact k="发出时间">{businessStamp(target.createdAt)}（{businessZone().label}）</Fact>
        {reason && <Fact k="拒绝原因">{reason}</Fact>}
      </Facts>
      <div className="m-release-text">
        <p>解除后可以重新提交，原操作不再重试，也不会撤销。</p>
        <p>只清这个标签页里的记录，不进操作记录。</p>
      </div>
      <p className="m-release-text">{where} <MAuditLink /></p>
      <Check label="已核实原操作的结果" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
    </Modal>
  );
}
