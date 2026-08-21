"use client";

/**
 * A 平台基础 — design_handoff_a_domain 设计稿 port(2026-06-11 重构)。
 * 4 子页(A5 有独立 page,不入 FOLD):A1 账号 RBAC / A2 审计操作确认中心 / A3 系统配置 / A4 事件中台。
 * A9 开发者访问审批复用本 shell，数据只来自服务端审批接口。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * A1/A2/A3/A4 读写以各自后端 client 为准,本 shell 只负责弹窗与 toast。
 * A 域三铁律 server-canonical 承诺(UI 不变量,见 a-tabs/types.ts 文件头):
 *  ① 全员强制 2FA(不可关)② 新账号默认零写权 ③ 有效超管 ≥2(实时派生 OPERATORS.filter)
 *  ④ A2 append-only + reason-required + 确认即执行+幂等(Idempotency-Key 24h dedup)
 *  ⑤ A3 killswitch 操作面迁 J1/J2(本页只读);server time 单源 / 防重号仍是后端不变量(配置卡 2026-06-24 移除)
 *  ⑥ A4 资金/KPI 只认 is_server_authoritative=true + PII 禁入
 * amplifies 仅资金放大流出方向(A2 工单放行 fund 类 + amplifies 行)。
 */
import { useEffect, useMemo, useState } from "react";
import "./a-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { A1Accounts } from "./a-tabs/a1-accounts";
import { A2Audit } from "./a-tabs/a2-audit";
import { A3Config } from "./a-tabs/a3-config";
import { A4Events } from "./a-tabs/a4-events";
import { A9DeveloperAccess } from "./a-tabs/a9-developer-access";
import type { ACtx, ConfirmReq, ActionConfirmReq } from "./a-tabs/types";
import { fetchA1Overview } from "@/lib/admin/a1-client";
import { fetchA2Overview } from "@/lib/admin/a2-client";
import { fetchA3Overview } from "@/lib/admin/a3-client";
import { fetchA4Overview } from "@/lib/admin/a4-client";

const FOLD: Record<string, string> = { A1: "A1", A2: "A2", A3: "A3", A4: "A4", A9: "A9" };

const RO_COPY: Record<string, string> = {
  A1: "每点一个功能,服务器都会重新核对你有没有权限",
  A2: "日志只能往里加 · 谁也改不了删不了,超级管理员也不行",
  A3: "熔断开关、功能灰度都以服务器为准 · 改本地无效",
  A4: "资金和 KPI 只认服务器正式发出的事件",
  A9: "审批状态、操作权限和结果只认服务端真实数据",
};

export function ADomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "A1", [meta.l2Id]);
  const [live, setLive] = useState("0");
  const [actionConfirmReq, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: ACtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  useEffect(() => {
    let cancelled = false;
    setLive("0");
    const loadLive = async () => {
      try {
        if (tab === "A1") {
          const overview = await fetchA1Overview();
          if (!cancelled) {
            setLive(`有效超管 ${overview.stats?.effectiveSupers ?? 0} · 启用账号 ${overview.stats?.activeAccounts ?? 0}`);
          }
          return;
        }
        if (tab === "A2") {
          const overview = await fetchA2Overview();
          if (!cancelled) {
            setLive(`待确认 ${overview.stats?.pendingTickets ?? 0} · 今日审计 ${overview.stats?.todayAuditEvents ?? 0}`);
          }
          return;
        }
        if (tab === "A3") {
          const overview = await fetchA3Overview();
          if (!cancelled) {
            setLive(`应急状态正常 ${overview.stats?.killGatesUp ?? 0}/${overview.stats?.killGates ?? 0} · 平台开关开启 ${overview.stats?.flagOnCount ?? 0}`);
          }
          return;
        }
        if (tab === "A9") {
          if (!cancelled) setLive("服务端审批列表 · 状态机/CAS");
          return;
        }
        const overview = await fetchA4Overview();
        if (!cancelled) {
          setLive(`今日事件 ${overview.stats?.todayEvents ?? "0"} · 注册域 ${overview.stats?.registeredDomains ?? 0}`);
        }
      } catch {
        if (!cancelled) setLive("0");
      }
    };
    void loadLive();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  const ro = RO_COPY[tab];
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
      {tab === "A9" && <A9DeveloperAccess />}

      {actionConfirmReq && (
        <OperationConfirmModal
          action={actionConfirmReq.action}
          detail={actionConfirmReq.detail}
          amplifies={actionConfirmReq.amplifies}
          edit={actionConfirmReq.edit}
          businessForm={actionConfirmReq.businessForm}
          reasonMin={actionConfirmReq.reasonMin}
          reasonMax={actionConfirmReq.reasonMax}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            await actionConfirmReq.run(reason, newValue, businessValue);
            setActionConfirm(null);
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}
