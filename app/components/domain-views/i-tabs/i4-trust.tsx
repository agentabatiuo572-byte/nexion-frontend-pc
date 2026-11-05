"use client";
import { useReach } from "@/lib/nav/use-reach";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * I4 信任中心。I5 法律条款与风险披露是单独的新版页面，见 i5-disclosures.tsx。
 * 统一来源:后端 /content/trust-disclosure/overview;空库时保持空态,不补前端业务样例。
 * 操作确认 显式 edit 契约:
 *  - 调参传 edit:回滚(text/current=v);
 *  - 处置不传 edit:发布信任版块 / 下架信任版块。
 * amplifies 全为 false —— I4 不碰 B1。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { A2OutcomeUncertainError, createA2CommandKey } from "@/lib/admin/a2-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isOptionalTrustLinkField, validateTrustSectionTrilingualFields } from "@/lib/admin/trust-section-validation";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { TrustDocumentsCard } from "@/app/components/domain-views/trust-documents-card";

/** 槽位本身已带目标 id + 动作类型(`trust|版块键:publish`)。落 sessionStorage,刷新后重试仍去重。 */
const commandAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-i4-trust-commands-v1",
});
const trustSlot = (attemptKey: string) => `trust|${attemptKey}`;

const trustDescriptionText = (value: string) => value === "首页 Trust 专项徽章" ? "首页信任与资质徽章" : nexGridBrandText(value);

type TrustSection = {
  key: string; desc: string; struct: string; v: string; status: string; lastChange: string; roleGate: string; highSensitivity: boolean;
};
type TrustSectionVersion = {
  sectionKey: string; version: string; description: string; structure: string;
  fields: { key: string; label: string; value: string }[];
  status: string; revision: number; operator: string; updatedAt: string;
};
const statusZh = (status?: string) => ({
  published: "已发布", draft: "草稿", archived: "已归档", superseded: "已取代",
  PUBLISHED: "已发布", DRAFT: "草稿", ARCHIVED: "已归档", SUPERSEDED: "已取代",
  pending: "待处理", active: "已启用", disabled: "已停用",
  PENDING: "待处理", ACTIVE: "已启用", DISABLED: "已停用",
  pending_review: "待发布复核", PENDING_REVIEW: "待发布复核",
} as Record<string, string>)[status ?? ""] ?? "未知状态";
type TrustDetailKey = string;
type DraftEditor = {
  mode: "create" | "edit";
  sectionKey: string;
  version: string;
  description: string;
  structure: string;
  revision?: number;
  reason: string;
  fields: { key: string; label: string; value: string }[];
};

export function I4Trust({ ctx }: { ctx: ICtx }) {
  const { toast, openActionConfirm, actions, content, contentLoading } = ctx;
  const propose = usePropose();
  const session = useAdminAuth((state) => state.session);
  const reach = useReach();
  const isSuperadmin = session?.role === "superadmin";
  const canDraftTrust = isSuperadmin || !!session?.authorities.includes("content_i4_write");
  const canPublishStandard = isSuperadmin || !!session?.authorities.includes("content_i4_publish_standard");
  const canPublishSensitive = isSuperadmin || !!session?.authorities.includes("content_i4_trust_section_manage");
  const [secKey, setSecKey] = useState<TrustDetailKey | null>(null);
  const [draftEditor, setDraftEditor] = useState<DraftEditor | null>(null);
  const data = content.trustDisclosure;
  const pendingTrustSectionKeys = new Set(data?.pendingTrustSectionKeys ?? []);
  const pendingTrustSectionList = [...pendingTrustSectionKeys];
  const pendingA2Href = pendingTrustSectionList.length === 1
    ? `/platform/audit?domain=I&object=${encodeURIComponent(pendingTrustSectionList[0])}`
    : "/platform/audit?domain=I";
  const I4_STATS = data?.stats ?? { managedSections: 0, jurisdictions: 0, staleAckUsers: 0, weeklyGateBlocked: 0 };
  const TRUST_SECTIONS: TrustSection[] = (data?.trustSections ?? []).map((s) => ({ ...s, v: s.version }));
  const TRUST_SECTION_VERSIONS: TrustSectionVersion[] = data?.trustSectionVersions ?? [];
  const FINANCIALS_FIELDS = (data?.financialFields ?? []).map((f) => ({ k: f.key, v: f.value, delta: f.delta }));
  const SECTION_FIELDS = (data?.sectionFields ?? []).reduce<Record<string, [string, string][]>>((acc, field) => {
    acc[field.sectionKey] = [...(acc[field.sectionKey] ?? []), [field.key, field.value]];
    return acc;
  }, {});
  const sectionVersionOptions = (section: TrustSection) => TRUST_SECTION_VERSIONS
    .filter((row) => row.sectionKey === section.key
      && ["published", "superseded", "PUBLISHED", "SUPERSEDED"].includes(row.status)
      && (row.version !== section.v || section.status.toLowerCase() === "archived"))
    .map((row) => row.version);
  const runBackend = async (task: Promise<void>, ok: string): Promise<boolean> => {
    try {
      await task;
      await actions.reloadIContent();
      toast(ok);
      return true;
    } catch (error) {
      toast(`操作失败:${displayAdminError(error)}`);
      return false;
    }
  };
  const proposeTrustSection = async (attemptKey: string, fingerprint: string, spec: ProposeSpec) => {
    const slot = trustSlot(attemptKey);
    const commandKey = commandAttempts.resolve(slot, fingerprint, () => createA2CommandKey("i4-trust-section"));
    try {
      const result = await propose(toast, { ...spec, commandKey });
      commandAttempts.forget(slot);
      if (result === "proposed") await actions.reloadIContent();
      return result;
    } catch (error) {
      if (!(error instanceof A2OutcomeUncertainError)) {
        commandAttempts.forget(slot);
      }
      throw error;
    }
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void actions.reloadIContent();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [actions]);

  const liveTrustStatus = (s: TrustSection): string => s.status;
  const normalizedSectionKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  const DATA_SOURCE_REQUIRED_SECTIONS = new Set(["financials", "nexnarrative", "nexstory"]);
  const SENSITIVE_TRUST_SECTIONS = new Set(["financials", "nexnarrative", "nexstory", "compliancebadges", "auditsreserves"]);
  const requiresDataSource = (section: TrustSection) => DATA_SOURCE_REQUIRED_SECTIONS.has(normalizedSectionKey(section.key));
  const isSensitiveTrustSection = (section: TrustSection) => section.highSensitivity || SENSITIVE_TRUST_SECTIONS.has(normalizedSectionKey(section.key));
  const canPublishTrustSection = (section: TrustSection) => isSensitiveTrustSection(section) ? canPublishSensitive : canPublishStandard;
  const currentSectionFields = (section: TrustSection) => TRUST_SECTION_VERSIONS
    .find((version) => version.sectionKey === section.key && version.version === section.v)?.fields ?? [];
  const sameFieldSchema = (left: { key: string }[], right: { key: string }[]) =>
    left.map((field) => field.key).sort().join("\u0000") === right.map((field) => field.key).sort().join("\u0000");

  const openSecDetail = (s: TrustSection) => setSecKey(s.key);

  // ---------- I4 信任版块动作 ----------
  const createSectionDraft = (s: TrustSection) => {
    const fields = currentSectionFields(s);
    if (fields.length === 0) {
      toast("当前发布版缺少字段模板，无法新建草稿");
      return;
    }
    setDraftEditor({
      mode: "create",
      sectionKey: s.key,
      version: "",
      description: s.desc,
      structure: s.struct,
      reason: "日常维护信任版块草稿",
      fields,
    });
  };

  const editSectionDraft = (draft: TrustSectionVersion) => {
    const section = TRUST_SECTIONS.find((item) => item.key === draft.sectionKey);
    const publishedFields = section ? currentSectionFields(section) : [];
    if (publishedFields.length === 0 || !sameFieldSchema(draft.fields, publishedFields)) {
      toast("草稿字段模板已过期，请删除后基于当前发布版新建");
      return;
    }
    setDraftEditor({
      mode: "edit",
      sectionKey: draft.sectionKey,
      version: draft.version,
      description: draft.description,
      structure: draft.structure,
      revision: draft.revision,
      reason: "日常维护信任版块草稿",
      fields: draft.fields,
    });
  };

  const saveSectionDraft = () => {
    if (!draftEditor) return;
    const sectionSnapshot = TRUST_SECTIONS.find((item) => item.key === draftEditor.sectionKey);
    if (!sectionSnapshot) {
      toast("版块内容已被修改，请刷新后重试");
      return;
    }
    if (!/^v[1-9][0-9]{0,8}$/.test(draftEditor.version) || !draftEditor.description.trim()
      || !draftEditor.structure.trim() || !draftEditor.reason.trim() || draftEditor.fields.length === 0
      || draftEditor.fields.some((field) => !field.key.trim() || !field.label.trim()
        || (!isOptionalTrustLinkField(field.key) && !field.value.trim()))) {
      toast("请完整填写版本、说明、结构、字段和保存说明");
      return;
    }
    const payload = {
      version: draftEditor.version,
      description: draftEditor.description.trim(),
      structure: draftEditor.structure.trim(),
      fields: draftEditor.fields.map((field) => ({ key: field.key.trim(), label: field.label.trim(), value: field.value.trim() })),
      expectedSectionVersion: sectionSnapshot.v,
      expectedSectionStatus: sectionSnapshot.status,
      ...(draftEditor.mode === "edit" ? { expectedRevision: draftEditor.revision ?? 0 } : {}),
    };
    const task = draftEditor.mode === "create"
      ? actions.createI4TrustSectionDraft(draftEditor.sectionKey, payload, draftEditor.reason.trim())
      : actions.updateI4TrustSectionDraft(draftEditor.sectionKey, draftEditor.version, payload, draftEditor.reason.trim());
    void runBackend(task, `${draftEditor.sectionKey} ${draftEditor.version} 草稿已保存`).then((saved) => {
      if (saved) setDraftEditor(null);
    });
  };

  const deleteSectionDraft = (draft: TrustSectionVersion) => openActionConfirm({ briefKind: "record",
    action: <>删除信任版块草稿 · {draft.sectionKey} {draft.version}</>,
    detail: <>只删除还没发布的草稿；线上版本和历史版本不受影响。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI4TrustSectionDraft(
      draft.sectionKey, draft.version, draft.revision, reason,
    ), `${draft.sectionKey} ${draft.version} 草稿已删除`),
  });

  const pubSection = (s: TrustSection, draft: TrustSectionVersion) =>
    openActionConfirm({ briefKind: "content",
      action: <>发布信任版块 · {s.key} {draft.version}</>,
      detail: (
        <>
          <b>版本差异</b>：当前线上 <span className="mono">{s.v}</span> → 待发布 <span className="mono">{draft.version}</span>；
          发布后 信任中心页面即时换新。<b>三语确认</b>必须核对中文、越南语、英文语义一致。
          {requiresDataSource(s) && <>财务数字 / UVT介绍必须填写可追溯的<b>财务/UVT 数据来源</b>。</>}
          <b>执行门槛:{operatorCopyText(s.roleGate)}</b>
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "trust-section-publish",
        currentVersion: s.v,
        targetVersion: draft.version,
        currentFields: currentSectionFields(s),
        targetFields: draft.fields,
        requireDataSource: requiresDataSource(s),
      },
      run: async (reason, _value, form) => {
        const trilingual = validateTrustSectionTrilingualFields(draft.fields);
        if (!trilingual.valid) {
          toast(`中越英字段不完整：${trilingual.missing.join("、")}`);
          return false;
        }
        const def = findHighOp("i4_trust_section_manage")!;
        const dataSource = form?.dataSource?.trim() || "";
        const bilingualConfirmed = form?.bilingualConfirmed === "true";
        const fingerprint = JSON.stringify([
          "publish", s.key, s.v, s.status, draft.version, draft.revision,
          dataSource, bilingualConfirmed, reason,
        ]);
        return proposeTrustSection(`${s.key}:publish`, fingerprint, {
          action: `发布信任版块 · ${s.key}`,
          obj: s.key,
          before: s.v,
          after: draft.version,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I4",
          command: def.buildCommand({
            sectionKey: s.key,
            action: "publish",
            version: draft.version,
            expectedRevision: draft.revision,
            expectedVersion: s.v,
            expectedStatus: s.status,
            dataSourceStatement: dataSource,
            bilingualConfirmed,
          }),
          target: def.buildTarget({ sectionKey: s.key }),
        });
      },
    });

  const rollbackSection = (s: TrustSection) =>
    openActionConfirm({ briefKind: "content",
      action: <>回滚信任版块 · {s.key}</>,
      detail: (
        <>
          当前 <b>{s.v}</b>。请选择要恢复的历史版本。提交后等待审批；审批通过并执行后，对外内容恢复为所选版本，权限要求和发布一样。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: s.v, options: sectionVersionOptions(s) },
      run: async (reason, nv) => {
        if (!nv) return false;
        const def = findHighOp("i4_trust_section_manage")!;
        const fingerprint = JSON.stringify(["rollback", s.key, s.v, s.status, nv, reason]);
        return proposeTrustSection(`${s.key}:rollback`, fingerprint, {
          action: `回滚信任版块 · ${s.key}`,
          obj: s.key,
          before: s.v,
          after: nv,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I4",
          command: def.buildCommand({
            sectionKey: s.key,
            action: "rollback",
            targetVersion: nv,
            expectedVersion: s.v,
            expectedStatus: s.status,
          }),
          target: def.buildTarget({ sectionKey: s.key }),
        });
      },
    });

  const archiveSection = (s: TrustSection) =>
    openActionConfirm({ briefKind: "content",
      action: <>下架信任版块 · {s.key}</>,
      detail: (
        <>
          当前 <b>{s.v}</b> 生效中。下架后 信任中心页面该版块<b>整体隐藏</b>(无内置备用)——一般只在对外内容出合规问题时才这么做;执行门槛与发布一致({operatorCopyText(s.roleGate)})。
        </>
      ),
      amplifies: false,
      run: async (reason) => {
        const def = findHighOp("i4_trust_section_manage")!;
        const fingerprint = JSON.stringify(["archive", s.key, s.v, s.status, reason]);
        return proposeTrustSection(`${s.key}:archive`, fingerprint, {
          action: `下架信任版块 · ${s.key}`,
          obj: s.key,
          before: s.v,
          after: "archived",
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I4",
          command: def.buildCommand({
            sectionKey: s.key,
            action: "archive",
            expectedVersion: s.v,
            expectedStatus: s.status,
          }),
          target: def.buildTarget({ sectionKey: s.key }),
        });
      },
    });

  // 抽屉数据。
  const sec = secKey ? TRUST_SECTIONS.find((s) => s.key === secKey) ?? null : null;
  const sectionExternalLink = sec
    ? (SECTION_FIELDS[sec.key] ?? []).find(([key]) => /(^|[._-])(url|link|href)($|[._-])/i.test(key))?.[1] ?? ""
    : "";

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">信任中心数据加载中…</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">暂无信任中心数据</div></div></section>;
  }

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管信任版块</div>
          <div className="v">{I4_STATS.managedSections} 个</div>
          <div className="sub">财务数字/团队/叙事/徽章/审计/外链</div>
        </div>
      </div>

      {/* (I4 · a) 信任中心 6 版块 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任中心 · /trust</span>
          <span className="sub">· 6 版块 · 财务数字/团队/叙事/徽章/审计/外链</span>
          <div className="r">
            {pendingTrustSectionKeys.size > 0 && <span className="bdg warn">待审批 {pendingTrustSectionKeys.size}</span>}
            <button className="l-btn sm" onClick={() => void actions.reloadIContent()}>刷新状态</button>
            {reach(pendingA2Href, "platform_a2_read") && <Link className="l-btn sm" href={pendingA2Href}>查看审批</Link>}
            <span className="icode danger">敏感合规</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead>
              <tr>
                <th>版块</th>
                <th>当前内容</th>
                <th>版本</th>
                <th>确认级</th>
                <th>状态</th>
                <th>最近改动</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {TRUST_SECTIONS.map((s) => {
                const st = liveTrustStatus(s);
                const isArchived = st === "archived" || st.includes("archived");
                const isPending = pendingTrustSectionKeys.has(s.key);
                return (
                  <tr
                    key={s.key}
                    className="click"
                    onClick={() => openSecDetail(s)}
                    style={isArchived ? { opacity: 0.55 } : undefined}
                  >
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{s.key}</span>
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{trustDescriptionText(s.desc)}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.struct}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{s.v}</td>
                    <td>
                      {isSensitiveTrustSection(s) ? (
                        <span className="bdg warn">{operatorCopyText(s.roleGate)}</span>
                      ) : (
                        <span className="bdg dim">{operatorCopyText(s.roleGate)}</span>
                      )}
                    </td>
                    <td>
                      {isPending && <span className="bdg warn" style={{ marginRight: 6 }}>有新版本待审批</span>}
                      {isArchived ? (
                        <span className="bdg dim">已下架</span>
                      ) : (
                        <span className="bdg ok">{isPending ? "当前版仍生效" : "已发布"}</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{s.lastChange}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canDraftTrust && <><button className="l-btn sm mc" disabled={isPending} onClick={(e) => { e.stopPropagation(); createSectionDraft(s); }}>新建草稿</button>{" "}</>}
                      {canPublishTrustSection(s) && <button className="l-btn sm" disabled={isPending || sectionVersionOptions(s).length === 0} onClick={(e) => { e.stopPropagation(); rollbackSection(s); }}>{isArchived ? "恢复上线" : "回滚历史版"}</button>}
                      {canPublishTrustSection(s) && !isArchived && (
                        <>
                          {" "}
                          <button className="l-btn sm mc" disabled={isPending} onClick={(e) => { e.stopPropagation(); archiveSection(s); }}>下架</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-h" style={{ borderTop: "1px solid var(--border)" }}>
          <span className="ttl">信任版块版本列表</span>
          <span className="sub">· 草稿可编辑、删除 · 可发布或回滚</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead><tr><th>版块</th><th>版本</th><th>说明</th><th>内容结构</th><th>字段数</th><th>状态</th><th>最近更新</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {TRUST_SECTION_VERSIONS.map((version) => {
                const section = TRUST_SECTIONS.find((row) => row.key === version.sectionKey);
                const isDraft = ["draft", "DRAFT"].includes(version.status);
                const isPending = pendingTrustSectionKeys.has(version.sectionKey);
                return <tr key={`${version.sectionKey}-${version.version}`}>
                  <td className="mono">{version.sectionKey}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{version.version}</td>
                  <td>{trustDescriptionText(version.description)}</td>
                  <td>{version.structure}</td>
                  <td className="num">{version.fields.length}</td>
                  <td><span className={`bdg ${isDraft ? "warn" : "ok"}`}>{statusZh(version.status)}</span></td>
                  <td className="mono">{version.updatedAt || "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {isDraft && canDraftTrust && <>
                      <button className="l-btn sm" disabled={isPending} onClick={() => editSectionDraft(version)}>编辑草稿</button>{" "}
                      <button className="l-btn sm danger" disabled={isPending} onClick={() => deleteSectionDraft(version)}>删除草稿</button>{" "}
                    </>}
                    {isDraft && section && canPublishTrustSection(section) && <button className="l-btn sm mc" disabled={isPending} onClick={() => pubSection(section, version)}>{isPending ? "待审批" : "发布草稿"}</button>}
                    {(!isDraft || (!canDraftTrust && (!section || !canPublishTrustSection(section)))) && <span className="tiny">只读{isDraft ? "（无编辑或发布权限）" : "历史版本"}</span>}
                  </td>
                </tr>;
              })}
              {TRUST_SECTION_VERSIONS.length === 0 && <tr><td colSpan={8}><div className="itint">暂无版本，请先在版块那一行点「新建草稿」。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <TrustDocumentsCard />

      <p className="f-foot">
        <b>权限</b>：一般版块由内容同事维护；<b>财务数字、UVT 介绍、对外合规声明必须由对应授权角色或超级管理员发布</b>。版块浏览数据会进入数据分析。
        <span title="§2.4.3 业务域列表扩展 · V4 内容批次 · blocking">。</span>
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "信任中心 · /trust",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "信任中心固定六版块,需同屏核对版本与状态",
          },
        ]}
      />

      {draftEditor && (
        <Drawer
          title={`${draftEditor.mode === "create" ? "新建" : "编辑"}信任版块草稿 · ${draftEditor.sectionKey}`}
          onClose={() => setDraftEditor(null)}
          footer={<>
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDraftEditor(null)}>取消</button>
            <button className="l-btn mc" data-trust-draft-editor="direct-save" style={{ flex: 1, justifyContent: "center" }} onClick={saveSectionDraft}>直接保存草稿</button>
          </>}
        >
          <div className="itint cyan" style={{ marginBottom: 12 }}>
            草稿保存是普通内容编辑，不走敏感确认；只有发布、回滚和下架进入操作确认。
          </div>
          <div className="field"><span className="bf-legend">版本号</span><input aria-label="版本号" className="inp" disabled={draftEditor.mode === "edit"} value={draftEditor.version} placeholder="如 v6" onChange={(event) => setDraftEditor({ ...draftEditor, version: event.target.value })} /></div>
          <div className="field"><span className="bf-legend">版块说明</span><input aria-label="版块说明" className="inp" value={draftEditor.description} onChange={(event) => setDraftEditor({ ...draftEditor, description: event.target.value })} /></div>
          <div className="field"><span className="bf-legend">内容结构</span><input aria-label="内容结构" className="inp" value={draftEditor.structure} onChange={(event) => setDraftEditor({ ...draftEditor, structure: event.target.value })} /></div>
          <div className="field"><span className="bf-legend">保存说明</span><input aria-label="保存说明" className="inp" value={draftEditor.reason} onChange={(event) => setDraftEditor({ ...draftEditor, reason: event.target.value })} /></div>
          <div className="row" style={{ justifyContent: "space-between", margin: "14px 0 8px" }}><b>结构化字段</b><span className="tiny">共 {draftEditor.fields.length} 项</span></div>
          <div className="itint cyan" style={{ marginBottom: 10 }}>字段标识由当前发布版字段模板固定，不可新增、删除或改名；这里只编辑字段名称和内容。</div>
          {draftEditor.fields.map((field, index) => <div className="itint" key={index} style={{ marginBottom: 10 }}>
            <div className="grid g-2" style={{ gap: 8 }}>
              <div className="field">
                <span className="bf-legend">字段标识（系统固定）</span>
                <div className="itint mono" data-trust-field-key="fixed">锁定 · {field.key}</div>
              </div>
              <div className="field"><span className="bf-legend">字段名称</span><input aria-label="字段名称" className="inp" value={field.label} onChange={(event) => setDraftEditor({ ...draftEditor, fields: draftEditor.fields.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} /></div>
            </div>
            <div className="field"><span className="bf-legend">字段内容</span><textarea aria-label="字段内容" className="inp" rows={3} value={field.value} onChange={(event) => setDraftEditor({ ...draftEditor, fields: draftEditor.fields.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item) })} /></div>
          </div>)}
        </Drawer>
      )}

      {/* 版块详情 Drawer */}
      {sec && (
        <Drawer
          title={`版块 · ${sec.key}(${nexGridBrandText(sec.desc)})`}
          onClose={() => setSecKey(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSecKey(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            当前 {sec.v} · {statusZh(liveTrustStatus(sec))} · 执行门槛:{operatorCopyText(sec.roleGate)}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>
            结构化内容字段如下；中文、越南语文案必填，英语文案可选。发布前可预览，发布走操作确认。
          </div>
          {sec.key === "financials" ? (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>财务数字组</div>
              <div style={{ overflowX: "auto" }}>
                <table className="l-tbl" style={{ minWidth: 360 }}>
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th>数值</th>
                      <th>环比</th>
                    </tr>
                  </thead>
                  <tbody>
                    {FINANCIALS_FIELDS.map((f) => (
                      <tr key={f.k}>
                        <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{({tvlOnChain:"链上资产总值",mrrValue:"月度收入",mrrDelta:"月度收入变化",activeAccountsValue:"活跃账户数",activeAccountsDelta:"活跃账户变化",devicesOnlineValue:"在线设备数",devicesOnlineDelta:"在线设备变化",payoutsProcessedValue:"累计处理付款",payoutsProcessedDelta:"付款金额变化","footnote.zh":"中文数据说明","footnote.vi":"越南语数据说明","footnote.en":"英文数据说明"} as Record<string,string>)[f.k] ?? f.k}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{nexGridBrandText(f.v)}</td>
                        <td className="mono" style={{ color: "var(--success)" }}>{f.delta}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>结构化字段</div>
              {(SECTION_FIELDS[sec.key] ?? []).map(([k, v], i) => (
                <div className="kv" key={i}>
                  <span className="k">{k}</span>
                  <span className="v">{nexGridBrandText(v)}</span>
                </div>
              ))}
            </>
          )}
          <div className="itint" style={{ marginTop: 12 }}>
            外部链接：{sectionExternalLink || "未配置"}；App 只显示当前已发布的版本。
          </div>
        </Drawer>
      )}

    </>
  );
}
