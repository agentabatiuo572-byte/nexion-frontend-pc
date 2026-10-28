"use client";

import { useMemo, useState } from "react";
import "./d-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { D1Recon } from "./d-tabs/d1-recon";
import { D2Withdrawals } from "./d-tabs/d2-withdrawals";
import { D3Treasury } from "./d-tabs/d3-treasury";
import { D4Ledger } from "./d-tabs/d4-ledger";
import { D5Params } from "./d-tabs/d5-params";
import { D6Fx } from "./d-tabs/d6-fx";
import { D7PayoutVnd } from "./d-tabs/d7-payout-vnd";
import type { ConfirmReq, DCtx, ActionConfirmReq } from "./d-tabs/types";

const FOLD: Record<string, string> = { D1: "D1", D2: "D2", D3: "D3", D4: "D4", D5: "D5", D6: "D6", D7: "D7" };


export function DDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "D2", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  } as DCtx;

  return (
    <div className="dkpage ddom">
      <DomainHeader {...meta} />

      {tab === "D1" && <D1Recon ctx={ctx} />}
      {tab === "D2" && <D2Withdrawals ctx={ctx} />}
      {tab === "D3" && <D3Treasury ctx={ctx} />}
      {tab === "D4" && <D4Ledger ctx={ctx} />}
      {tab === "D5" && <D5Params ctx={ctx} />}
      {tab === "D6" && <D6Fx ctx={ctx} />}
      {tab === "D7" && <D7PayoutVnd ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          coverage={mc.coverage}
          edit={mc.edit}
          businessForm={mc.businessForm}
          completionCopy={mc.completionCopy}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          auditSink={mc.auditSink}
          onBusinessSelectionChange={mc.onBusinessSelectionChange}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            await mc.run(reason, newValue, businessValue);
            setActionConfirm(null);
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}
