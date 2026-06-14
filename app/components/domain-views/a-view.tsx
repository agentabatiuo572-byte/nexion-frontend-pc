"use client";

/**
 * A 平台基础 — design_handoff_a_domain 设计稿 port(2026-06-11 重构)。
 * 4 子页(A5 有独立 page,不入 FOLD):A1 账号 RBAC / A2 审计操作确认中心 / A3 系统配置 / A4 事件中台。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一 platform-config setParam(A.*)+ 共享 useAccount store(OpsAccount,沿用旧 a-view)。
 * A 域三铁律 server-canonical 承诺(UI 不变量,见 a-tabs/types.ts 文件头):
 *  ① 全员强制 2FA(不可关)② 新账号默认零写权 ③ 有效超管 ≥2(实时派生 OPERATORS.filter)
 *  ④ A2 append-only + reason-required + 确认即执行+幂等(Idempotency-Key 24h dedup)
 *  ⑤ A3 server time 单源 + killswitch 操作面迁 J1/J2(本页只读)
 *  ⑥ A4 资金/KPI 只认 is_server_authoritative=true + PII 禁入
 * amplifies 仅资金放大流出方向(A2 工单放行 fund 类 + amplifies 行)。
 */
import { useMemo, useState } from "react";
import "./a-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { A1Accounts } from "./a-tabs/a1-accounts";
import { A2Audit } from "./a-tabs/a2-audit";
import { A3Config } from "./a-tabs/a3-config";
import { A4Events } from "./a-tabs/a4-events";
import type { ACtx, ConfirmReq, ActionConfirmReq } from "./a-tabs/types";

const FOLD: Record<string, string> = { A1: "A1", A2: "A2", A3: "A3", A4: "A4" };

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  A1: ["权限判定每次请求在服务器执行 · 前端只管藏菜单", "有效超管 3 个 · 满足 ≥2 底线"],
  A2: ["日志只追加 · 没人能改能删,超管也不行", "高敏动作 14 件 · 应急轨 1 件"],
  A3: ["时间 / 幂等 / 闸 全部服务器权威 · 改本地无效", "7 闸全开 · 管道健康"],
  A4: ["资金和 KPI 口径只认服务器发的事件", "管道正常 · 今日 4.2M 事件"],
};

export function ADomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "A1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [actionConfirmReq, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: ACtx = {
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
    </>
  );

  return (
    <div className="dkpage adom">
      <DomainHeader {...meta} right={right} />

      {tab === "A1" && <A1Accounts ctx={ctx} />}
      {tab === "A2" && <A2Audit ctx={ctx} />}
      {tab === "A3" && <A3Config ctx={ctx} />}
      {tab === "A4" && <A4Events ctx={ctx} />}

      {actionConfirmReq && (
        <OperationConfirmModal
          action={actionConfirmReq.action}
          detail={actionConfirmReq.detail}
          amplifies={actionConfirmReq.amplifies}
          edit={actionConfirmReq.edit}
          businessForm={actionConfirmReq.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue, businessValue) => { actionConfirmReq.run(reason, newValue, businessValue); setActionConfirm(null); }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}
