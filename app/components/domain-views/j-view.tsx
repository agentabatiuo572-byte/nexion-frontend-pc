"use client";

/**
 * J 紧急与合规控制 — design_handoff_j_domain 设计稿 port(2026-06-10 重构)。
 * 4 子页独立:J1 Kill-Switch 矩阵 / J2 Geo-block / J3 篡改防御监控(纯只读) / J4 监管点名应急 SOP。
 * 真写统一走 platform-config-store.setParam(J.killswitch.* / J.geo.* / J.emergency.* / J.autorule.* / J.tamper.alertConfig),
 * persist + 水合门;OperationConfirmModal 显式 edit 契约(调参传 edit,处置不传)。
 * J3 处置权移交:冻结 → C2(/users/actions)、簇建档 → K1(/risk/multi-account),本页仅跨域跳转(PRD §15.4)。
 */
import { useMemo, useState } from "react";
import "./j-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
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
  const setParam = usePlatformConfig((s) => s.setParam);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);

  const ctx: JCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    toast: setToast,
    openActionConfirm: setActionConfirm,
  };

  return (
    <div className="dkpage jdom">
      <DomainHeader
        {...meta}
        right={tab === "J3" ? <J3HeaderActions ctx={ctx} /> : tab === "J4" ? <J4HeaderActions ctx={ctx} /> : undefined}
      />

      {tab === "J1" && <J1KillSwitch ctx={ctx} />}
      {tab === "J2" && <J2GeoBlock ctx={ctx} />}
      {tab === "J3" && <J3Tamper />}
      {tab === "J4" && <J4Sop ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue) => { mc.run(reason, newValue); setActionConfirm(null); }}
        />
      )}
      {toastNode}
    </div>
  );
}
