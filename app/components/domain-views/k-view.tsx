"use client";

/**
 * K 风控与反作弊。
 * 页面数据由 /api/admin/risk/* 代理读取后端真实接口;后端无数据时会先种入 MySQL 再回查。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./k-domain.css";
import { RdPage } from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { fetchK1MultiAccountOverview, fetchK2ArbitrageOverview, fetchK3WithdrawRuleOverview, fetchK4ScoringOverview, fetchKRiskOverviews, kRiskActions, type KRiskActions, type KRiskData, type KRiskOverviewQuery } from "@/lib/admin/k-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { KConfirmModal } from "./k-tabs/k-confirm-modal";
import { K1MultiAccount } from "./k-tabs/k1-multiaccount";
import { K2HeaderActions, K2Arbitrage } from "./k-tabs/k2-arbitrage";
import { K3Rules } from "./k-tabs/k3-rules";
import { K4HeaderActions, K4Scoring } from "./k-tabs/k4-scoring";
import type { ConfirmReq, KCtx, ActionConfirmReq } from "./k-tabs/types";

const FOLD: Record<string, string> = { K1: "K1", K2: "K2", K3: "K3", K4: "K4" };

function errorText(error: unknown) {
  return displayAdminError(error);
}

export function KDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "K1", [meta.l2Id]);
  const [risk, setRisk] = useState<KRiskData>({});
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [k2RereadPending, setK2RereadPending] = useState(false);
  const [k2CommandVersion, setK2CommandVersion] = useState(0);
  const [k4RereadPending, setK4RereadPending] = useState(false);
  const [k4CommandVersion, setK4CommandVersion] = useState(0);
  const requestSequence = useRef(0);
  const requireK4Reread = useCallback(() => {
    requestSequence.current += 1;
    setK4RereadPending(true);
  }, []);
  const syncK4Commands = useCallback(() => setK4CommandVersion(version => version + 1), []);
  useEffect(() => {
    if (tab !== "K4" || (!k4RereadPending && risk.scoring)) return;
    if (mc && mc.getPendingReason?.() === undefined) setActionConfirm(null);
    if (cf && cf.getPendingReason?.() === undefined) setCf(null);
  }, [tab, k4RereadPending, risk.scoring, mc, cf, k4CommandVersion]);
  const requireK2Reread = useCallback(() => {
    // An earlier in-flight read cannot satisfy a recovery that just completed.
    requestSequence.current += 1;
    setK2RereadPending(true);
  }, []);
  const syncK2Commands = useCallback(() => setK2CommandVersion((version) => version + 1), []);

  useEffect(() => {
    if (tab !== "K2" || (!k2RereadPending && risk.arbitrage)) return;
    if (mc && mc.getPendingReason?.() === undefined) setActionConfirm(null);
    if (cf && cf.getPendingReason?.() === undefined) setCf(null);
    // Settlement can turn the same recovery dialog into a stale new-edit dialog.
  }, [tab, k2RereadPending, risk.arbitrage, mc, cf, k2CommandVersion]);

  const reloadKRisk = useCallback(async (query?: KRiskOverviewQuery) => {
    const sequence = ++requestSequence.current;
    setContentLoading(true);
    setContentError(null);
    if (query?.withdrawRules || tab === "K3") {
      setRisk((current) => ({ ...current, withdrawRules: undefined }));
    }
    if (query?.scoring || tab === "K4") {
      setRisk((current) => ({ ...current, scoring: undefined }));
    }
    try {
      if (query?.multiAccount) {
        const multiAccount = await fetchK1MultiAccountOverview(query.multiAccount);
        if (sequence === requestSequence.current) {
          setRisk((current) => ({ ...current, multiAccount }));
        }
        return multiAccount;
      } else if (query?.withdrawRules || tab === "K3") {
        const withdrawRules = await fetchK3WithdrawRuleOverview(query?.withdrawRules);
        if (sequence === requestSequence.current) {
          setRisk((current) => ({ ...current, withdrawRules }));
        }
        return;
      } else if (tab === "K2") {
        const arbitrage = await fetchK2ArbitrageOverview();
        if (sequence === requestSequence.current) {
          setRisk((current) => ({ ...current, arbitrage }));
          setK2RereadPending(false);
        }
      } else if (query?.scoring || tab === "K4") {
        const scoring = await fetchK4ScoringOverview(query?.scoring);
        if (sequence === requestSequence.current) {
          setRisk((current) => ({ ...current, scoring }));
          setK4RereadPending(false);
        }
      } else {
        const next = await fetchKRiskOverviews(query);
        if (sequence === requestSequence.current) setRisk(next);
      }
    } catch (error) {
      if (sequence === requestSequence.current) setContentError(errorText(error));
      throw error;
    } finally {
      if (sequence === requestSequence.current) setContentLoading(false);
    }
  }, [tab]);

  const refreshK4Scoring = useCallback(async (query?: Parameters<typeof fetchK4ScoringOverview>[0]) => {
    const activeSequence = requestSequence.current;
    const scoring = await fetchK4ScoringOverview(query);
    if (activeSequence === requestSequence.current) {
      setRisk((current) => ({ ...current, scoring }));
      setK4RereadPending(false);
      return scoring;
    }
  }, []);

  useEffect(() => {
    if (tab !== "K1" && tab !== "K3") void reloadKRisk().catch(() => undefined);
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
    refreshK4Scoring,
  };

  const right =
    tab === "K2" ? <K2HeaderActions />
    : tab === "K4" ? <K4HeaderActions />
    : <span className="f-ro"><span className="d" />设备上报态与后台期望态分离 · 所有操作可追溯</span>;

  const page = (
    <>
      {tab !== "K1" && tab !== "K2" && tab !== "K3" && tab !== "K4" && <DomainHeader {...meta} right={right} />}

      {tab !== "K1" && tab !== "K2" && tab !== "K3" && tab !== "K4" && contentError && (
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">风控数据加载失败</span>
            <span className="sub">· {contentError}</span>
            <div className="r"><button className="l-btn" onClick={() => void reloadKRisk().catch(() => undefined)}>重试</button></div>
          </div>
        </section>
      )}

      {tab === "K1" && <K1MultiAccount ctx={ctx} />}
      {tab === "K2" && <K2Arbitrage ctx={ctx} rereadPending={k2RereadPending} onRereadRequired={requireK2Reread} onCommandsChange={syncK2Commands} />}
      {tab === "K3" && <K3Rules ctx={ctx} />}
      {tab === "K4" && <K4Scoring ctx={ctx} rereadPending={k4RereadPending} onRereadRequired={requireK4Reread} onCommandsChange={syncK4Commands} />}

      {mc && (
        <OperationConfirmModal key={mc.formKey} briefKind={mc.briefKind}
          action={mc.action}
          title={mc.title}
          detail={mc.detail}
          content={mc.content}
          amplifies={mc.amplifies}
          coverage={mc.coverage}
          edit={mc.edit}
          businessForm={mc.businessForm}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          getPendingReason={mc.getPendingReason}
          initialReason={mc.initialReason}
          getPendingBusinessValue={mc.getPendingBusinessValue}
          approval={mc.approval}
          inlineApproval={mc.inlineApproval ? {
            ...mc.inlineApproval,
            retry: mc.inlineApproval.retry ? async () => {
              await mc.inlineApproval!.retry!();
              setActionConfirm((current) => current === mc ? null : current);
            } : undefined,
            recover: async (reason, value, editValue) => {
              const found = await mc.inlineApproval!.recover(reason, value, editValue);
              if (found) setActionConfirm((current) => current === mc ? null : current);
              return found;
            },
          } : undefined}
          effect={mc.effect}
          confirmLabel={mc.confirmLabel}
          confirmTone={mc.confirmTone}
          blockedReason={mc.blockedReason}
          statedBrief={mc.statedBrief}
          facts={mc.facts}
          coverageLead={mc.coverageLead}
          reasonPlaceholder={mc.reasonPlaceholder}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => { await mc.run(reason, newValue, businessValue); setActionConfirm((current) => current === mc ? null : current); }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </>
  );

  return tab === "K1" || tab === "K2" || tab === "K3" || tab === "K4" ? <RdPage className="kdom">{page}</RdPage> : <div className="dkpage kdom">{page}</div>;
}
