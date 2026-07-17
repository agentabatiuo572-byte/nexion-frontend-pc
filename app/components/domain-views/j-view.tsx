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
type JTab = "J1" | "J2" | "J3" | "J4";
const FOLD: Record<string, JTab> = { J1: "J1", J2: "J2", J3: "J3", J4: "J4" };
type J3Window = "24h" | "7d" | "30d";

function readJ3LocationState(): { window: J3Window; page: number; pageSize: number } {
  if (typeof window === "undefined") return { window: "24h", page: 1, pageSize: 5 };
  const params = new URLSearchParams(window.location.search);
  const rawWindow = params.get("window");
  const selectedWindow: J3Window = rawWindow === "7d" || rawWindow === "30d" ? rawWindow : "24h";
  const parsedPage = Number(params.get("accountPage"));
  const parsedPageSize = Number(params.get("accountPageSize"));
  return {
    window: selectedWindow,
    page: Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1,
    pageSize: Number.isInteger(parsedPageSize) && parsedPageSize >= 1 && parsedPageSize <= 100 ? parsedPageSize : 5,
  };
}

function persistJ3LocationState(windowKey: J3Window, page: number, pageSize: number) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set("window", windowKey);
  url.searchParams.set("accountPage", String(page));
  url.searchParams.set("accountPageSize", String(pageSize));
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

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
      const j3State = readJ3LocationState();
      const nextEmergency = tab === "J3"
        ? fetchJEmergencyOverviews(tab, j3State.window, j3State.page, j3State.pageSize)
        : fetchJEmergencyOverviews(tab);
      setEmergency(await nextEmergency);
    } catch (error) {
      setEmergency({});
      setContentError(error instanceof Error ? error.message : "应急控制数据读取失败，请稍后重试。");
      throw error;
    } finally {
      setContentLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    void reloadJEmergency().catch(() => undefined);
  }, [reloadJEmergency]);

  const actions = useMemo(
    () => ({
      ...jEmergencyActions,
      reloadJEmergency,
      loadJ3TamperPage: async (window: "24h" | "7d" | "30d", page: number, pageSize: number) => {
        const tamper = await jEmergencyActions.loadJ3TamperPage(window, page, pageSize);
        persistJ3LocationState(window, tamper.accountPage.page, tamper.accountPage.pageSize);
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
        right={tab === "J3" ? <J3HeaderActions ctx={ctx} /> : tab === "J4" && !contentLoading && !contentError ? <J4HeaderActions ctx={ctx} /> : undefined}
      />

      {contentError && (
        <section className="matrix-card" role="alert">
          <div className="matrix-h">
            <span className="ttl">当前无法确认最新状态</span>
            <span className="sub">· {contentError} 为避免误操作，控制项已隐藏。</span>
            <div className="r"><button type="button" onClick={() => void reloadJEmergency().catch(() => undefined)}>重新读取</button></div>
          </div>
        </section>
      )}

      {!contentError && tab === "J1" && <J1KillSwitch ctx={ctx} />}
      {!contentError && tab === "J2" && <J2GeoBlock ctx={ctx} />}
      {!contentError && tab === "J3" && <J3Tamper ctx={ctx} />}
      {!contentError && tab === "J4" && <J4Sop ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          coverage={mc.coverage}
          edit={mc.edit}
          businessForm={mc.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            try {
              await mc.run(reason, newValue, businessValue);
              setActionConfirm(null);
            } catch {
              // 操作失败时保留确认弹窗，便于修正条件或重试。
            }
          }}
        />
      )}
      {toastNode}
    </div>
  );
}
