"use client";

/**
 * A 平台基础 — design_handoff_a_domain 设计稿 port(2026-06-11 重构)。
 * 4 子页(A5 有独立 page,不入 FOLD):A1 账号 RBAC / A2 审计操作确认中心 / A3 系统配置 / A4 事件中台。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * A1/A2/A3/A4 读写以各自后端 client 为准,本 shell 只负责弹窗与 toast。
 * A 域三铁律 server-canonical 承诺(UI 不变量,见 a-tabs/types.ts 文件头):
 *  ① 全员强制 2FA(不可关)② 新账号默认零写权 ③ 有效超管 ≥2(实时派生 OPERATORS.filter)
 *  ④ A2 append-only + reason-required + 确认即执行+幂等(Idempotency-Key 24h dedup)
 *  ⑤ A3 killswitch 操作面迁 J1/J2(本页只读);server time 单源 / 防重号仍是后端不变量(配置卡 2026-06-24 移除)
 *  ⑥ A4 资金/KPI 只认 is_server_authoritative=true + PII 禁入
 * amplifies 仅资金放大流出方向(A2 工单放行 fund 类 + amplifies 行)。
 */
import { useMemo, useState } from "react";
import "./a-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { A1Accounts } from "./a-tabs/a1-accounts";
import { A2Audit } from "./a-tabs/a2-audit";
import { A3Config } from "./a-tabs/a3-config";
import { A4Events } from "./a-tabs/a4-events";
import type { ACtx, ConfirmReq, ActionConfirmReq } from "./a-tabs/types";

const FOLD: Record<string, string> = { A1: "A1", A2: "A2", A3: "A3", A4: "A4" };

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  A1: ["每点一个功能,服务器都会重新核对你有没有权限", "当前 3 个超级管理员 · 满足「至少 2 个」"],
  A2: ["日志只能往里加 · 谁也改不了删不了,超级管理员也不行", "高风险操作 14 件 · 应急通道 1 件"],
  A3: ["熔断开关、功能灰度都以服务器为准 · 改本地无效", "5 个熔断开关全开 · 运行正常"],
  A4: ["资金和 KPI 只认服务器正式发出的事件", "运行正常 · 今日 420 万条事件"],
};

export function ADomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "A1", [meta.l2Id]);
  const [actionConfirmReq, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: ACtx = {
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
