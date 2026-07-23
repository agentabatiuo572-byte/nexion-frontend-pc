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
import type { ConfirmReq, DCtx, ActionConfirmReq } from "./d-tabs/types";

const FOLD: Record<string, string> = { D1: "D1", D2: "D2", D3: "D3", D4: "D4", D5: "D5" };

// 每页两枚签名 chip(设计稿 f-bar):f-ro = server-canonical 不变量,f-live = 节奏/SLA(K 域同款先例)。
const RO_LIVE: Record<string, [ro: string, live: string]> = {
  D1: ["到账以服务器处理完回调为准 · 客户端记的账不算", "对账实时比对"],
  D2: ["状态只能服务器推进 · 客户端只能看", "到账承诺 48 小时 · 审核 ≤ 2 个工作日"],
  D3: ["储备的底账在这里 · 覆盖率由总账(B1)裁定", "每天 UTC 00:00 批量对账"],
  D4: ["账单与余额以系统记录为准", "每笔资金变动均可追溯"],
  D5: ["节奏类参数由 H1 统一派发 · 这页只是生效的地方", "D5 参数写 finance 接口 · H1 节奏只读"],
};

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

  const [ro, liveSeed] = RO_LIVE[tab];
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{liveSeed}</span>
    </>
  );

  return (
    <div className="dkpage ddom">
      <DomainHeader {...meta} right={right} />

      {tab === "D1" && <D1Recon ctx={ctx} />}
      {tab === "D2" && <D2Withdrawals ctx={ctx} />}
      {tab === "D3" && <D3Treasury ctx={ctx} />}
      {tab === "D4" && <D4Ledger ctx={ctx} />}
      {tab === "D5" && <D5Params ctx={ctx} />}

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
