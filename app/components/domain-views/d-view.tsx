"use client";

import { useMemo, useState } from "react";
import "./d-domain.css";
import { RdPage } from "@/app/components/rd";
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
/** 已改版的页：包 RdPage，页头由页面自己写。 */
const REDESIGNED = ["D1", "D2", "D6", "D7"];


export function DDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "D2", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const recoverApproval = mc?.approval?.recover;

  const ctx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  } as DCtx;

  if (tab === "D3") return <D3Treasury />;
  // 已改版的页包 RdPage，页头在页面里，不再渲染旧的域页头。

  const page = (
    <>
      {!REDESIGNED.includes(tab) && <DomainHeader {...meta} />}

      {tab === "D1" && <D1Recon ctx={ctx} />}
      {tab === "D2" && <D2Withdrawals ctx={ctx} />}
      {tab === "D4" && <D4Ledger ctx={ctx} />}
      {tab === "D5" && <D5Params ctx={ctx} />}
      {tab === "D6" && <D6Fx ctx={ctx} />}
      {tab === "D7" && <D7PayoutVnd ctx={ctx} />}

      {mc && (
        <OperationConfirmModal key={mc.formKey} briefKind={mc.briefKind}
          action={mc.action}
          title={mc.title}
          detail={mc.detail}
          content={mc.content}
          reasonPolicyOptional={mc.reasonPolicyOptional}
          amplifies={mc.amplifies}
          coverage={mc.coverage}
          coverageCheck={mc.coverageCheck}
          edit={mc.edit}
          businessForm={mc.businessForm}
          getPendingReason={mc.getPendingReason}
          getPendingBusinessValue={mc.getPendingBusinessValue}
          completionCopy={mc.completionCopy}
          approval={mc.approval && {
            ...mc.approval,
            recover: recoverApproval && (async (reason) => {
              const found = await recoverApproval(reason);
              if (found) setActionConfirm(null);
              return found;
            }),
          }}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          auditSink={mc.auditSink}
          effect={mc.effect}
          confirmLabel={mc.confirmLabel}
          blockedReason={mc.blockedReason}
          statedBrief={mc.statedBrief}
          facts={mc.facts}
          confirmTone={mc.confirmTone}
          coverageLead={mc.coverageLead}
          reasonPlaceholder={mc.reasonPlaceholder}
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
    </>
  );

  return REDESIGNED.includes(tab) ? <RdPage className="ddom">{page}</RdPage> : <div className="dkpage ddom">{page}</div>;
}
