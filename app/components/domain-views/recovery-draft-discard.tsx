"use client";

import { useState } from "react";
import { Button, Decision, Modal } from "@/app/components/rd";

export function useRecoveryDraftDiscard() {
  const [discard, setDiscard] = useState<(() => void) | null>(null);
  const close = () => setDiscard(null);
  return {
    ask: (remove: () => void) => setDiscard(() => remove),
    dialog: discard && <Modal title="放弃这份草稿" onClose={close} footer={<Decision
      others={<Button onClick={close}>取消</Button>}
      danger={<Button variant="danger-outline" onClick={() => { discard(); close(); }}>确认放弃草稿</Button>} />}>
      <p>放弃后将从这个页面移除这份待恢复草稿。</p>
    </Modal>,
  };
}
