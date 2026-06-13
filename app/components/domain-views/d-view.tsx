"use client";

/**
 * D 资金管理 — design_handoff_d_domain 设计稿 port(2026-06-10 重构)。
 * 5 子页:D1 充值对账中心 / D2 提现审核队列 / D3 资金池水位 / D4 账本账单审计 / D5 提现参数配置。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一 platform-config setParam(D.withdraw.* / D.channel.* / D.fee.* / D.psp.* / D.bin.* /
 * D.chargeback.* / D.reconcile.* / D.adjust.* / D.reserveInjection / D.scope / D.<param>);
 * 单源:LEDGER(储备/覆盖率)/ LIABILITIES(8 科目)/ MATURITY(到期)/ WITHDRAWALS(提现队列,
 * 与 K3_HITS / K5 工单同单同人)/ TOPUPS / D_FUND(聚合口径)。
 * amplifies 仅放大资金流出方向(大额放行 / 解冻 / D5 三参数放松)。
 */
import { useMemo, useState } from "react";
import "./d-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { PHASE } from "@/lib/mock/admin/design-data";
import { D1Recon } from "./d-tabs/d1-recon";
import { D2Withdrawals } from "./d-tabs/d2-withdrawals";
import { D3HeaderActions, D3Treasury } from "./d-tabs/d3-treasury";
import { D4Ledger } from "./d-tabs/d4-ledger";
import { D5Params } from "./d-tabs/d5-params";
import type { ConfirmReq, DCtx, ActionConfirmReq } from "./d-tabs/types";

const FOLD: Record<string, string> = { D1: "D1", D2: "D2", D3: "D3", D4: "D4", D5: "D5" };

// 每页两枚签名 chip(设计稿 f-bar):f-ro = server-canonical 不变量,f-live = 节奏/SLA(K 域同款先例)。
const RO_LIVE: Record<string, [ro: string, live: string]> = {
  D1: ["入账以服务器处理回调为准 · 客户端记账无效", "对账实时比对"],
  D2: ["状态只能服务器推进 · 客户端只能看", "到账承诺 48h · 审核 ≤ 2 工作日"],
  D3: ["储备的底账在这里 · 覆盖率由双账本(B1)裁决", "日批对账 UTC 00:00"],
  D4: ["服务器是唯一账本 · 客户端推的账一律不认", "每笔资金动作必落账"],
  D5: ["节奏类参数归 H1 派发 · 这里只是生效面", `当前 ${PHASE.current} · 月 ${PHASE.month}`],
};

export function DDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "D2", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: DCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    logAudit,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const [ro, live] = RO_LIVE[tab];
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{live}</span>
      {tab === "D3" && <D3HeaderActions ctx={ctx} />}
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
          edit={mc.edit}
          businessForm={mc.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue, businessValue) => { mc.run(reason, newValue, businessValue); setActionConfirm(null); }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}
