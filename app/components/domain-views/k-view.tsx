"use client";

/**
 * K 风控与反作弊 — design_handoff_k_domain 设计稿 port(2026-06-10 重构)。
 * 5 子页:K1 反多账户引擎 / K2 套利刷量检测 / K3 提现风控规则引擎 / K4 风险评分模型 / K5 大额 KYC 复审。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认 + 必填原因)/ —(K 域无视图参数)。
 * 真写统一 platform-config setParam(K.cluster.* / K.arb.* / K.gift.* / K.board.* / K.rule.* / K.score.* / K.kyc.* / K.wl.* / K.k1-k5.*);
 * 单源:K_RISK / REGISTERED_USERS / USERS / WITHDRAWALS(同分派生)/ E.tradein.minHoldingMonths(E3 权威只读)。
 * amplifies 仅放大资金流出方向(解除误判 / 复审通过解冻 / 调阈值放宽 / 停用规则)。
 */
import { useMemo, useState } from "react";
import "./k-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { K1HeaderActions, K1MultiAccount } from "./k-tabs/k1-multiaccount";
import { K2HeaderActions, K2Arbitrage } from "./k-tabs/k2-arbitrage";
import { K3HeaderActions, K3Rules } from "./k-tabs/k3-rules";
import { K4HeaderActions, K4Scoring } from "./k-tabs/k4-scoring";
import { K5HeaderActions, K5Kyc } from "./k-tabs/k5-kyc";
import type { ConfirmReq, KCtx, ActionConfirmReq } from "./k-tabs/types";

const FOLD: Record<string, string> = { K1: "K1", K2: "K2", K3: "K3", K4: "K4", K5: "K5" };

export function KDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "K1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: KCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const right =
    tab === "K1" ? <K1HeaderActions />
    : tab === "K2" ? <K2HeaderActions />
    : tab === "K3" ? <K3HeaderActions ctx={ctx} />
    : tab === "K4" ? <K4HeaderActions />
    : <K5HeaderActions />;

  return (
    <div className="dkpage kdom">
      <DomainHeader {...meta} right={right} />

      {tab === "K1" && <K1MultiAccount ctx={ctx} />}
      {tab === "K2" && <K2Arbitrage ctx={ctx} />}
      {tab === "K3" && <K3Rules ctx={ctx} />}
      {tab === "K4" && <K4Scoring ctx={ctx} />}
      {tab === "K5" && <K5Kyc ctx={ctx} />}

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
