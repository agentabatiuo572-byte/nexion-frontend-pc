"use client";

/**
 * J 紧急与合规控制 — design_handoff_j_domain 设计稿 port(2026-06-10 重构)。
 * 4 子页独立:J1 Kill-Switch 矩阵 / J2 Geo-block / J3 篡改防御监控(纯只读) / J4 监管点名应急 SOP。
 * 真写统一走后端 /emergency/* 接口;概览为空时由后端写入 MySQL 种子后再查出。
 * OperationConfirmModal 显式 edit 契约(调参传 edit,处置不传)。
 * J3 处置权移交:冻结 → C2(/users/actions)、簇建档 → K1(/risk/multi-account),本页仅跨域跳转(PRD §15.4)。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import "./j-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { fetchJEmergencyOverviews, jEmergencyActions, type JEmergencyData } from "@/lib/admin/j-client";
import { J1KillSwitch } from "./j-tabs/j1-killswitch";
import { J2GeoBlock } from "./j-tabs/j2-geoblock";
import { J3HeaderActions, J3Tamper } from "./j-tabs/j3-tamper";
import { J4HeaderActions, J4Sop } from "./j-tabs/j4-sop";
import type { JCtx, ActionConfirmReq } from "./j-tabs/types";

/** J4 单独成页(对齐 PRD §15.4 应急 SOP 独立;原 J4→J3 折叠取消)。 */
const FOLD: Record<string, string> = { J1: "J1", J2: "J2", J3: "J3", J4: "J4" };

export function JDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "J1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [emergency, setEmergency] = useState<JEmergencyData>({});
  const [contentLoading, setContentLoading] = useState(true);
  const [contentError, setContentError] = useState<string | null>(null);

  const reloadJEmergency = useCallback(async () => {
    setContentLoading(true);
    setContentError(null);
    try {
      setEmergency(await fetchJEmergencyOverviews());
    } catch (error) {
      setContentError(error instanceof Error ? error.message : "J_EMERGENCY_LOAD_FAILED");
    } finally {
      setContentLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadJEmergency();
  }, [reloadJEmergency]);

  const actions = useMemo(
    () => ({
      ...jEmergencyActions,
      reloadJEmergency,
      loadJ3TamperPage: async (page: number, pageSize: number) => {
        const tamper = await jEmergencyActions.loadJ3TamperPage(page, pageSize);
        setEmergency((prev) => ({ ...prev, tamper }));
        return tamper;
      },
    }),
    [reloadJEmergency],
  );

  const ctx: JCtx = {
    pget: () => undefined,
    params: {},
    setParam: () => undefined,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    emergency,
    actions,
    contentLoading,
    contentError,
  };

  return (
    <div className="dkpage jdom">
      <DomainHeader
        {...meta}
        right={tab === "J3" ? <J3HeaderActions ctx={ctx} /> : tab === "J4" ? <J4HeaderActions ctx={ctx} /> : undefined}
      />

      {contentError && (
        <section className="matrix-card">
          <div className="matrix-h">
            <span className="ttl">J 域数据加载失败</span>
            <span className="sub">· {contentError}</span>
          </div>
        </section>
      )}

      {tab === "J1" && <J1KillSwitch ctx={ctx} />}
      {tab === "J2" && <J2GeoBlock ctx={ctx} />}
      {tab === "J3" && <J3Tamper ctx={ctx} />}
      {tab === "J4" && <J4Sop ctx={ctx} />}

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
      {toastNode}
    </div>
  );
}
