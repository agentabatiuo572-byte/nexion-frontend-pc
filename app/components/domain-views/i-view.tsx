"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

/**
 * I 内容与合规 — design_handoff_i_domain 设计稿 port(2026-06-11 重构;2026-06-15 客服 I8/I9 迁出至域 M 客服中心)。
 * 7 子页:I1 页面文案对比测试 / I2 Nova 消息推送 / I3 通知活动 /
 *   I4 信任中心 / I5 风险披露 / I6 多语言文案与课程管理。
 * 三类弹窗:OperationConfirmModal(操作确认,显式 edit 契约)/ KConfirmModal(普通确认,复用 K 域原语)。
 * 真写统一走后端 /content/* 接口;概览为空时保持空态,不在前端补业务样例。
 * amplifies 唯一流出方向 = 课程奖励上调(B1 红线核验,SPEC §4 注:拒绝码 V4 目标 422,B1 现行 403)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./i-domain.css";
import { OperationConfirmModal, useToast } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { fetchIContentOverviews, iContentActions, type IContentData } from "@/lib/admin/i-client";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { I1CopyAb } from "./i-tabs/i1-copy-ab";
import { I2Nova } from "./i-tabs/i2-nova";
import { I3Campaign } from "./i-tabs/i3-campaign";
import { I4Trust } from "./i-tabs/i4-trust";
import { I6I18n } from "./i-tabs/i6-i18n";
import type { ConfirmReq, ICtx, ActionConfirmReq } from "./i-tabs/types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const FOLD: Record<string, string> = {
  I1: "I1",
  I2: "I2",
  I3: "I3",
  I4: "I4",
  I5: "I5",
  I6: "I6",
};



function countText(value?: number) {
  return Number(value ?? 0).toLocaleString();
}

function contentErrorForTab(tab: string, content: IContentData) {
  const key = tab === "I1"
    ? "copyAb"
    : tab === "I2"
      ? "nova"
      : tab === "I3"
        ? "campaigns"
        : tab === "I4" || tab === "I5"
          ? "trustDisclosure"
          : "i18nLearning";
  const error = content.errors?.[key];
  if (!error) return null;
  if (tab === "I5" && error === "I4 返回数据格式异常，请刷新重试") {
    return "I5 返回数据格式异常，请刷新重试";
  }
  if (tab === "I5" && error === "I4 数据加载失败，请刷新重试") {
    return "I5 数据加载失败，请刷新重试";
  }
  return error;
}

// 页面上不显示 I1–I7 模块代号，只保留用户能看懂的原因。
function contentErrorText(error: string) {
  if (/^I\d 数据加载失败，请刷新重试$/.test(error)) return "请刷新重试。";
  if (/^I\d 返回数据格式异常，请刷新重试$/.test(error)) return "收到的数据格式不对，请刷新重试。";
  return error;
}

function liveFromBackend(tab: string, content: IContentData, loading: boolean, error: string | null) {
  if (loading || error) return "";
  if (tab === "I1") {
    const stats = content.copyAb?.stats;
    return stats ? `进行中测试 ${countText(stats.runningExps)} 个 · 文案 ${countText(stats.managedCopies)} 条` : "";
  }
  if (tab === "I2") {
    const stats = content.nova?.stats;
    return stats ? `点击率 ${stats.ctr} · 启用频道 ${countText(stats.onlineChannels)}/${countText(stats.totalChannels)}` : "";
  }
  if (tab === "I3") {
    const stats = content.campaigns?.stats;
    return stats ? `紧急通知发送中 ${countText(stats.criticalInflight)} 条 · 本月已发 ${stats.monthSent}` : "";
  }
  if (tab === "I4") {
    const stats = content.trustDisclosure?.stats;
    return stats ? `信任版块 ${countText(stats.managedSections)} 个` : "";
  }
  if (tab === "I5") {
    const stats = content.trustDisclosure?.stats;
    if (!stats) return "";
    const coverage = stats.reackPct !== undefined
      ? `${stats.reackJurisdiction || "适用地区"} 已重新确认 ${stats.reackPct}% · 待确认 ${countText(stats.staleAckUsers)} 人`
      : `待确认 ${countText(stats.staleAckUsers)} 人`;
    return `${coverage} · 近 7 天拦截 ${countText(stats.weeklyGateBlocked)} 次`;
  }
  if (tab === "I6") {
    const stats = content.i18nLearning?.stats;
    return stats ? `词条 ${countText(stats.managedKeys)} 条 · 上线课程 ${countText(stats.coursesOnline)} 门 · 本周发放 ${nexGridBrandText(stats.weeklyNexPayout)}` : "";
  }
  return "";
}

export function IDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "I1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const contentPermissionScope = useAdminAuth((state) => {
    const session = state.session;
    return [
      state.authEpoch,
      state.isAuthenticated,
      state.sessionResolution,
      state.operator,
      session?.adminId,
      session?.operator,
      session?.username,
      session?.role,
      ...(session?.authorities ?? []).slice().sort(),
    ].join("\u0000");
  });
  const scopeKey = [tab, contentPermissionScope].join("\u0000");
  const contentRequestSequence = useRef(0);
  const [contentSnapshot, setContentSnapshot] = useState<{
    data: IContentData;
    dataScope: string | null;
    loading: boolean;
    error: string | null;
    errorScope: string | null;
  }>({ data: {}, dataScope: null, loading: true, error: null, errorScope: null });
  const contentReadable = contentSnapshot.dataScope === scopeKey;
  const content = contentReadable ? contentSnapshot.data : {};
  const contentLoading = contentReadable ? contentSnapshot.loading : true;
  const contentError = contentSnapshot.errorScope === scopeKey ? contentSnapshot.error : null;

  const reloadIContent = useCallback(async () => {
    const requestSequence = ++contentRequestSequence.current;
    setContentSnapshot((current) => ({ ...current, loading: true }));
    try {
      const nextContent = await fetchIContentOverviews();
      if (requestSequence !== contentRequestSequence.current) return;
      const nextError = contentErrorForTab(tab, nextContent);
      setContentSnapshot((current) => {
        if (nextError && current.dataScope === scopeKey) {
          return {
            ...current,
            loading: false,
            error: nextError,
            errorScope: scopeKey,
          };
        }
        return {
          data: nextContent,
          dataScope: scopeKey,
          loading: false,
          error: nextError,
          errorScope: scopeKey,
        };
      });
    } catch (error) {
      if (requestSequence !== contentRequestSequence.current) return;
      setContentSnapshot((current) => ({
        ...current,
        loading: false,
        error: tab + " 数据加载失败，请刷新重试",
        errorScope: scopeKey,
      }));
    }
  }, [scopeKey, tab]);

  useEffect(() => {
    // A completed request from the prior route or auth/permission generation
    // must not repopulate this scope before its own initial read starts.
    contentRequestSequence.current += 1;
    setActionConfirm(null);
    setCf(null);
  }, [scopeKey]);

  useEffect(() => {
    void reloadIContent();
  }, [reloadIContent]);

  const actions = useMemo(
    () => ({
      ...iContentActions,
      reloadIContent,
    }),
    [reloadIContent],
  );

  const ctx: ICtx = {
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
    content,
    actions,
    contentLoading,
    contentError,
  };

  const live = liveFromBackend(tab, content, contentLoading, contentError);
  const right = live ? <span className="f-live"><span className="dot" />{live}</span> : null;

  return (
    <div className="dkpage idom">
      <DomainHeader {...meta} right={right} />

      {contentError && (
        <section className="l-card">
          <div className="l-h">
            <div className="itint danger">
              <b>内容数据加载失败</b> · {contentErrorText(contentError)}
            </div>
            <div className="r">
              <button className="l-btn" type="button" onClick={() => void reloadIContent()}>
                重新加载
              </button>
            </div>
          </div>
        </section>
      )}

      {(!contentError || contentReadable) && tab === "I1" && <I1CopyAb ctx={ctx} />}
      {(!contentError || contentReadable) && tab === "I2" && <I2Nova ctx={ctx} />}
      {(!contentError || contentReadable) && tab === "I3" && <I3Campaign ctx={ctx} />}
      {(!contentError || contentReadable) && tab === "I4" && <I4Trust ctx={ctx} view="trust" />}
      {(!contentError || contentReadable) && tab === "I5" && <I4Trust ctx={ctx} view="disclosures" />}
      {(!contentError || contentReadable) && tab === "I6" && <I6I18n ctx={ctx} />}

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
          onBusinessSelectionChange={mc.onBusinessSelectionChange}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            await mc.run(reason, newValue, businessValue);
            setActionConfirm(null);
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {toastNode}
    </div>
  );
}
