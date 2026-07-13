"use client";

/**
 * K 风控与反作弊。
 * 页面数据由 /api/admin/risk/* 代理读取后端真实接口;后端无数据时会先种入 MySQL 再回查。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import "./k-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { fetchKRiskOverviews, kRiskActions, type KRiskActions, type KRiskData, type KRiskOverviewQuery } from "@/lib/admin/k-client";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { K1HeaderActions, K1MultiAccount } from "./k-tabs/k1-multiaccount";
import { K2HeaderActions, K2Arbitrage } from "./k-tabs/k2-arbitrage";
import { K3HeaderActions, K3Rules } from "./k-tabs/k3-rules";
import { K4HeaderActions, K4Scoring } from "./k-tabs/k4-scoring";
import { K5HeaderActions, K5Kyc } from "./k-tabs/k5-kyc";
import { K6JanusC2 } from "./k-tabs/k6-janus-c2";
import type { ConfirmReq, KCtx, ActionConfirmReq } from "./k-tabs/types";

const FOLD: Record<string, string> = { K1: "K1", K2: "K2", K3: "K3", K4: "K4", K5: "K5", K6: "K6" };

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export function KDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "K1", [meta.l2Id]);
  const [risk, setRisk] = useState<KRiskData>({});
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const reloadKRisk = useCallback(async (query?: KRiskOverviewQuery) => {
    setContentLoading(true);
    setContentError(null);
    try {
      setRisk(await fetchKRiskOverviews(query));
    } catch (error) {
      setContentError(errorText(error));
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab !== "K6") void reloadKRisk();
    else setContentLoading(false);
  }, [reloadKRisk, tab]);

  const actions = useMemo<KRiskActions>(() => ({ ...kRiskActions, reloadKRisk }), [reloadKRisk]);

  const ctx: KCtx = {
    pget: () => undefined,
    params: {},
    setParam: () => undefined,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
    risk,
    actions,
    contentLoading,
    contentError,
    reloadKRisk,
  };

  const right =
    tab === "K1" ? <K1HeaderActions />
    : tab === "K2" ? <K2HeaderActions />
    : tab === "K3" ? <K3HeaderActions ctx={ctx} />
    : tab === "K4" ? <K4HeaderActions />
    : tab === "K5" ? <K5HeaderActions />
    : <span className="f-ro"><span className="d" />设备上报态与后台期望态分离 · 所有操作可追溯</span>;

  return (
    <div className="dkpage kdom">
      <DomainHeader {...meta} right={right} />

      {tab !== "K6" && contentError && (
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">K 域数据加载失败</span>
            <span className="sub">· {contentError}</span>
            <div className="r"><button className="l-btn" onClick={() => void reloadKRisk()}>重试</button></div>
          </div>
        </section>
      )}

      {tab === "K1" && <K1MultiAccount ctx={ctx} />}
      {tab === "K2" && <K2Arbitrage ctx={ctx} />}
      {tab === "K3" && <K3Rules ctx={ctx} />}
      {tab === "K4" && <K4Scoring ctx={ctx} />}
      {tab === "K5" && <K5Kyc ctx={ctx} />}
      {tab === "K6" && <K6JanusC2 />}

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
