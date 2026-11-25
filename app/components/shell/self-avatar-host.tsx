"use client";

/**
 * 账号菜单的「更换本人头像」：哪一页都能从右上角账号换本人头像，用的是客服工作台里同一个 SelfAvatarEditor、同一个共用确认框，
 * 发出去的请求和工作台里一模一样。挂在 RdPage 里（新外观的抽屉和确认框），放到 body 末尾，不受顶栏的层叠和裁切影响。
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { RdPage } from "@/app/components/rd";
import { OperationConfirmModal, useToast, type OperatorBriefKind } from "@/app/components/domain-views/design-kit";
import type { ActionConfirmReq } from "@/app/components/domain-views/k-tabs/types";
import { SelfAvatarEditor } from "@/app/components/domain-views/m-tabs/self-avatar-editor";

export default function ShellSelfAvatar({ name, onClose }: { name: string; onClose: () => void }) {
  const [, toast] = useToast();
  const [confirm, setConfirm] = useState<(ActionConfirmReq & { briefKind: OperatorBriefKind }) | null>(null);
  return createPortal(
    <RdPage className="shell-self-avatar">
      <SelfAvatarEditor name={name} launch onClosed={onClose} onChanged={() => undefined}
        ctx={{ toast, openActionConfirm: setConfirm,
          closeActionConfirm: request => setConfirm(current => current === request ? null : current),
          refreshContent: async () => undefined }} />
      {confirm && <OperationConfirmModal action={confirm.action} title={confirm.title} detail={confirm.detail}
        reasonMin={confirm.reasonMin} reasonMax={confirm.reasonMax} briefKind={confirm.briefKind} effect={confirm.effect}
        confirmLabel={confirm.confirmLabel} confirmTone={confirm.confirmTone} blockedReason={confirm.blockedReason}
        facts={confirm.facts} statedBrief={confirm.statedBrief} reasonPlaceholder={confirm.reasonPlaceholder}
        onClose={() => setConfirm(null)}
        onConfirm={async (reason) => {
          const current = confirm;
          const succeeded = await current.run(reason);
          if (succeeded !== false) setConfirm((open) => open === current ? null : open);
        }} />}
    </RdPage>,
    document.body,
  );
}
