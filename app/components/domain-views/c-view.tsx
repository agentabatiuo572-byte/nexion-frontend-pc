"use client";

/**
 * C 用户与账户 — design_handoff_c_domain 设计稿 port(2026-06-11 重构)。
 * 5 子页:C1 检索画像 / C2 账户操作 / C3 余额资产调整 / C5 安全会话 / C6 注册登录风控。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 各页读写统一走后端 user360/admin-users 接口;冻结、模拟登录、资产调整和安全参数都以服务端返回为准。
 */
import { useMemo, useState } from "react";
import "./c-domain.css";
import { RdPage } from "@/app/components/rd";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { C1Search } from "./c-tabs/c1-search";
import { C2Actions } from "./c-tabs/c2-actions";
import { C3Adjust } from "./c-tabs/c3-adjust";
import { C5Security } from "./c-tabs/c5-security";
import { C6Regrisk } from "./c-tabs/c6-regrisk";
import type { CCtx, ConfirmReq, ActionConfirmReq } from "./c-tabs/types";

const FOLD: Record<string, string> = { C1: "C1", C2: "C2", C3: "C3", C5: "C5", C6: "C6" };
/** 已改版的页：包 RdPage，页头由页面自己写。 */
const REDESIGNED = ["C1"];


export function CDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "C1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: CCtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const page = (
    <>
      {!REDESIGNED.includes(tab) && <DomainHeader {...meta} />}

      {tab === "C1" && <C1Search ctx={ctx} />}
      {tab === "C2" && <C2Actions ctx={ctx} />}
      {tab === "C3" && <C3Adjust ctx={ctx} />}
      {tab === "C5" && <C5Security ctx={ctx} />}
      {tab === "C6" && <C6Regrisk ctx={ctx} />}

      {mc && (
        <OperationConfirmModal briefKind={mc.briefKind}
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          completionCopy={mc.completionCopy}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          getPendingReason={mc.getPendingReason}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            const succeeded = await mc.run(reason, newValue, businessValue);
            if (succeeded !== false) setActionConfirm(null);
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </>
  );

  return REDESIGNED.includes(tab) ? <RdPage className="cdom">{page}</RdPage> : <div className="dkpage cdom">{page}</div>;
}
