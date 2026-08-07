"use client";

/**
 * C 用户与账户 — design_handoff_c_domain 设计稿 port(2026-06-11 重构)。
 * 5 子页:C1 检索画像 / C2 账户操作 / C3 余额资产调整 / C5 安全会话 / C6 注册登录风控。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 各页读写统一走后端 user360/admin-users 接口;冻结、模拟登录、资产调整和安全参数都以服务端返回为准。
 */
import { useMemo, useState } from "react";
import "./c-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { C1Search, C1HeaderActions, type C1ExportQuery } from "./c-tabs/c1-search";
import { C2Actions } from "./c-tabs/c2-actions";
import { C3Adjust } from "./c-tabs/c3-adjust";
import { C5Security } from "./c-tabs/c5-security";
import { C6Regrisk } from "./c-tabs/c6-regrisk";
import type { CCtx, ConfirmReq, ActionConfirmReq } from "./c-tabs/types";

const FOLD: Record<string, string> = { C1: "C1", C2: "C2", C3: "C3", C5: "C5", C6: "C6" };

// 每页两枚签名 chip(设计稿 f-bar):f-ro = server-canonical 不变量,f-live = 节奏/留痕承诺。
const RO_LIVE: Record<string, [ro: string, live: string]> = {
  C1: ["只能查看 · 要处置去对应页面", "敏感查看全程留痕"],
  C2: ["冻结记录以这页为准", "模拟登录全程只能看 + 限时"],
  C3: ["每笔都记账本 · 不是开后门的地方", "往外加钱时盯着备付金红线"],
  C5: ["账户解锁都在这页处置", "高风险操作 = 先确认 + 安全二次校验"],
  C6: ["只配「什么情况下锁」 · 解锁去 C5", "验证码和锁定都由服务器执行"],
};

export function CDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "C1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [c1ExportQuery, setC1ExportQuery] = useState<C1ExportQuery | null>(null);

  const ctx: CCtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const [ro, live] = RO_LIVE[tab];
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{live}</span>
      {tab === "C1" && <C1HeaderActions ctx={ctx} query={c1ExportQuery} />}
    </>
  );

  return (
    <div className="dkpage cdom">
      <DomainHeader {...meta} right={right} />

      {tab === "C1" && <C1Search ctx={ctx} onExportQueryChange={setC1ExportQuery} />}
      {tab === "C2" && <C2Actions ctx={ctx} />}
      {tab === "C3" && <C3Adjust ctx={ctx} />}
      {tab === "C5" && <C5Security ctx={ctx} />}
      {tab === "C6" && <C6Regrisk ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          completionCopy={mc.completionCopy}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            const succeeded = await mc.run(reason, newValue, businessValue);
            if (succeeded !== false) setActionConfirm(null);
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}
