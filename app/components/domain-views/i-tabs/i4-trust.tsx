"use client";

/**
 * I4 信任中心 / I5 风险披露复用视图 — 按独立路由与权限渲染。
 * 单源:后端 /content/trust-disclosure/overview;空库时保持空态,不补前端业务样例。
 * 操作确认 显式 edit 契约:
 *  - 调参传 edit:回滚(text/current=v)/ 发布披露新版(text/current=j.v)/ 调整受限动作范围(text/current);
 *  - 处置不传 edit:发布信任版块 / 下架信任版块。
 * amplifies 全为 false —— I4 不碰 B1(条款重签不是熔断、不动账本)。
 * 凭据 / 合规铁律:披露全链 操作员 = 风控,执行门槛 = 风控 / 超管;详情文案体现这一点。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Drawer, PaginationExemptionList, type BusinessFormSpec } from "../design-kit";
import type { ICtx } from "./types";
import type { DisclosureJurisdictionOption, DisclosureVersionItemView } from "@/lib/admin/i-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { A2OutcomeUncertainError, createA2CommandKey } from "@/lib/admin/a2-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isOptionalTrustLinkField, validateTrustSectionTrilingualFields } from "@/lib/admin/trust-section-validation";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { LegalTermsEditor } from "@/app/components/domain-views/legal-terms-editor";
import { PublishedContentEditor } from "@/app/components/domain-views/published-content-editor";

/** I4 信任版块与 I5 披露共用一张表,靠槽位前缀分命名空间;槽位本身已带目标 id + 动作类型
 *  (`trust|版块键:publish`、`disclosure|辖区:matrix-configure`)。落 sessionStorage,刷新后重试仍去重。 */
const commandAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-i4-trust-commands-v1",
});
const trustSlot = (attemptKey: string) => `trust|${attemptKey}`;
const disclosureSlot = (attemptKey: string) => `disclosure|${attemptKey}`;

type TrustSection = {
  key: string; desc: string; struct: string; v: string; status: string; lastChange: string; roleGate: string; highSensitivity: boolean;
};
type TrustSectionVersion = {
  sectionKey: string; version: string; description: string; structure: string;
  fields: { key: string; label: string; value: string }[];
  status: string; revision: number; operator: string; updatedAt: string;
};
type Jurisdiction = {
  code: string; name: string; countryCodes: string[]; v: string; status: string; publishedAt: string; affected: number; ackProgress: number; blocked: number; acked?: number; pendingAck?: number;
};
const statusZh = (status?: string) => ({
  published: "已发布", draft: "草稿", archived: "已归档", superseded: "已取代",
  PUBLISHED: "已发布", DRAFT: "草稿", ARCHIVED: "已归档", SUPERSEDED: "已取代",
  pending: "待处理", active: "已启用", disabled: "已停用",
  PENDING: "待处理", ACTIVE: "已启用", DISABLED: "已停用",
  pending_review: "待发布复核", PENDING_REVIEW: "待发布复核",
} as Record<string, string>)[status ?? ""] ?? "未知状态";
type GateAction = { key: string; name: string; sub: string; st: string; tone: string; active: boolean };
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

export function I4Trust({ ctx, view }: { ctx: ICtx; view: "trust" | "disclosures" }) {
  const { toast, openActionConfirm, actions, content, contentLoading } = ctx;
  const pageId = view === "trust" ? "I4" : "I5";
  const propose = usePropose();
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canDraftTrust = isSuperadmin || !!session?.authorities.includes("content_i4_write");
  const canPublishStandard = isSuperadmin || !!session?.authorities.includes("content_i4_publish_standard");
  const canPublishSensitive = isSuperadmin || !!session?.authorities.includes("content_i4_trust_section_manage");
  const canDraftDisclosure = isSuperadmin || !!session?.authorities.includes("content_i5_write");
  const canPublishDisclosure = isSuperadmin || !!session?.authorities.includes("content_i5_disclosure_publish");
  const canAdjustGate = isSuperadmin || !!session?.authorities.includes("content_i5_gate_adjust");
  const [secKey, setSecKey] = useState<TrustDetailKey | null>(null);
  const [jurCode, setJurCode] = useState<string | null>(null);
  const [chapNo, setChapNo] = useState<string | null>(null);
  const [disclosureDetailKey, setDisclosureDetailKey] = useState<string | null>(null);
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
  const JURISDICTIONS: Jurisdiction[] = (data?.jurisdictions ?? []).map((j) => ({ ...j, v: j.version }));
  const DISCLOSURE_CHAPTERS = data?.chapters ?? [];
  const GATED_ACTIONS: GateAction[] = (data?.gatedActions ?? []).map((g) => ({ key: g.key, name: g.name, sub: g.sub, st: g.status, tone: g.tone, active: g.active }));
  const SECTION_FIELDS = (data?.sectionFields ?? []).reduce<Record<string, [string, string][]>>((acc, field) => {
    acc[field.sectionKey] = [...(acc[field.sectionKey] ?? []), [field.key, field.value]];
    return acc;
  }, {});
  const activeJurisdiction = JURISDICTIONS[0];
  const activeJurisdictionCode = activeJurisdiction?.code ?? "";
  const jurisdictionCatalog: DisclosureJurisdictionOption[] = data?.jurisdictionCatalog ?? [];
  const jurisdictionOptions = jurisdictionCatalog.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const activeJurisdictionOptions = jurisdictionCatalog
    .filter((item) => item.status.toLowerCase() === "active")
    .map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const jurisdictionNameFor = (code: string, fallback = code) => jurisdictionCatalog.find((item) => item.code === code)?.name ?? fallback;
  const countryOptions = (data?.countryOptions ?? []).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const sectionVersionOptions = (section: TrustSection) => TRUST_SECTION_VERSIONS
    .filter((row) => row.sectionKey === section.key
      && ["published", "superseded", "PUBLISHED", "SUPERSEDED"].includes(row.status)
      && (row.version !== section.v || section.status.toLowerCase() === "archived"))
    .map((row) => row.version);
  const chaptersFor = (jurisdiction: string, version?: string) => {
    const exact = DISCLOSURE_CHAPTERS.filter((chapter) => chapter.jurisdiction === jurisdiction && (!version || chapter.version === version));
    if (exact.length) return exact;
    const publishedVersion = JURISDICTIONS.find((row) => row.code === jurisdiction)?.v;
    return DISCLOSURE_CHAPTERS.filter((chapter) => chapter.jurisdiction === jurisdiction && (!publishedVersion || chapter.version === publishedVersion));
  };
  const I5_VERSION_ROWS: DisclosureVersionItemView[] = data?.disclosureVersionItems ?? [];
  const compareDisclosureVersionsDesc = (left: string, right: string): number => {
    const leftParts = left.replace(/^v/i, "").split(".").map((part) => Number(part));
    const rightParts = right.replace(/^v/i, "").split(".").map((part) => Number(part));
    const width = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < width; index += 1) {
      const delta = (rightParts[index] ?? 0) - (leftParts[index] ?? 0);
      if (delta !== 0) return delta;
    }
    return right.localeCompare(left);
  };
  const publishedVersionsByJurisdiction = I5_VERSION_ROWS.reduce<Record<string, string[]>>((acc, row) => {
    if (!["published", "superseded"].includes(row.status.toLowerCase())) return acc;
    const versions = acc[row.jurisdiction] ?? [];
    if (!versions.includes(row.version)) acc[row.jurisdiction] = [...versions, row.version].sort(compareDisclosureVersionsDesc);
    return acc;
  }, {});
  const nextVersionFor = (jurisdiction: string) => data?.nextVersionByJurisdiction?.[jurisdiction] ?? data?.nextDisclosureVersionByJurisdiction?.[jurisdiction] ?? data?.nextDisclosureVersion ?? "";
  const chapterPayload = (form: Record<string, string> | undefined) => Array.from({ length: 7 }, (_, index) => ({
    no: form?.[`chapter.${index}.no`] ?? String(index + 1).padStart(2, "0"),
    zhTitle: form?.[`chapter.${index}.zhTitle`] ?? "",
    viTitle: form?.[`chapter.${index}.viTitle`] ?? "",
    enTitle: form?.[`chapter.${index}.enTitle`] ?? "",
    zhBody: form?.[`chapter.${index}.zhBody`] ?? "",
    viBody: form?.[`chapter.${index}.viBody`] ?? "",
    enBody: form?.[`chapter.${index}.enBody`] ?? "",
  }));
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
  const proposeDisclosure = async (attemptKey: string, fingerprint: string, spec: ProposeSpec) => {
    const slot = disclosureSlot(attemptKey);
    const commandKey = commandAttempts.resolve(slot, fingerprint, () => createA2CommandKey("i5-disclosure"));
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
    if (view !== "trust") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void actions.reloadIContent();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [actions, view]);

  useEffect(() => {
    if (view !== "disclosures") return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void actions.reloadIContent();
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [actions, view]);

  const liveTrustStatus = (s: TrustSection): string => s.status;
  const liveJurVersion = (j: Jurisdiction): string => j.v;
  const gateOn = (k: string): boolean => GATED_ACTIONS.find((g) => g.key === k)?.active ?? false;
  const disclosureDraft = data?.draft;
  const disclosureFormSpec = (snapshot: DisclosureVersionItemView | undefined, jurisdiction: string, version: string, mode: "create" | "edit"): BusinessFormSpec => ({
    kind: "version-authoring",
    mode,
    version,
    jurisdiction,
    zh: snapshot?.zh ?? "",
    vi: snapshot?.vi ?? "",
    en: snapshot?.en ?? "",
    chapters: snapshot?.chapters?.length === 7
      ? snapshot.chapters
      : Array.from({ length: 7 }, (_, index) => ({
          jurisdiction,
          version,
          no: String(index + 1).padStart(2, "0"),
          zh: "",
          vi: "",
          en: "",
          zhBody: "",
          viBody: "",
          enBody: "",
        })),
    jurisdictionOptions: mode === "edit" ? jurisdictionOptions.filter((option) => option.value === jurisdiction) : activeJurisdictionOptions,
    languageScope: snapshot?.languageScope,
    languageScopes: data?.languageScopes,
    effectiveDate: snapshot?.effectiveDate,
    requiresReack: snapshot?.requiresReack,
    versionReadonly: true,
    jurisdictionReadonly: mode === "edit",
  });
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
  const openJurDetail = (j: Jurisdiction) => setJurCode(j.code);
  const openChap = (no: string) => setChapNo(no);

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
      toast("版块快照已失效，请刷新后重试");
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

  const deleteSectionDraft = (draft: TrustSectionVersion) => openActionConfirm({
    action: <>删除信任版块草稿 · {draft.sectionKey} {draft.version}</>,
    detail: <>仅删除尚未发布的草稿；线上版与历史已发布快照不受影响。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI4TrustSectionDraft(
      draft.sectionKey, draft.version, draft.revision, reason,
    ), `${draft.sectionKey} ${draft.version} 草稿已删除`),
  });

  const pubSection = (s: TrustSection, draft: TrustSectionVersion) =>
    openActionConfirm({
      action: <>发布信任版块 · {s.key} {draft.version}</>,
      detail: (
        <>
          <b>版本差异</b>：当前线上 <span className="mono">{s.v}</span> → 待发布 <span className="mono">{draft.version}</span>；
          发布后 /trust 页即时换新。<b>三语确认</b>必须核对中文、越南语、英文语义一致。
          {requiresDataSource(s) && <>财务数字 / NEX 叙事必须填写可追溯的<b>财务/NEX 数据来源</b>。</>}
          <b>执行门槛:{s.roleGate}</b>
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
          return;
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
    openActionConfirm({
      action: <>回滚信任版块 · {s.key}</>,
      detail: (
        <>
          当前 <b>{s.v}</b>。回滚 = 把历史版重新发布(对外内容立即回到旧版),等价一次发布,执行门槛与发布一致;审计记 from→to。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: sectionVersionOptions(s)[0] ?? "", options: sectionVersionOptions(s) },
      run: async (reason, nv) => {
        if (!nv) return;
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
    openActionConfirm({
      action: <>下架信任版块 · {s.key}</>,
      detail: (
        <>
          当前 <b>{s.v}</b> 生效中。下架后 /trust 页该版块<b>整体隐藏</b>(无内置兜底)——一般只在对外内容出合规问题时才这么做;执行门槛与发布一致({s.roleGate})。
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

  // ---------- I5 披露动作 ----------
  const draftDisclosure = (editing?: DisclosureVersionItemView) => {
    const initialJurisdiction = editing?.jurisdiction ?? activeJurisdictionOptions[0]?.value ?? "";
    if (!initialJurisdiction) {
      toast("暂无启用法域，请先在法域配置中新增或启用法域");
      return;
    }
    const version = editing?.version ?? nextVersionFor(initialJurisdiction);
    if (!editing && !version) {
      toast("后端尚未返回下一版本号，无法安全新建版本");
      return;
    }
    const base = editing ?? I5_VERSION_ROWS.find((row) => row.jurisdiction === initialJurisdiction && row.status.toLowerCase() === "published");
    openActionConfirm({
      action: <>{editing ? "编辑披露草稿" : "新建披露版本"} · 风控提交</>,
      detail: (
        <>
          披露正文按中文、越南语必填，英语可选维护(占位符一致)。草稿不生效;发布走「执行门槛:风控/超管」操作确认并触发该法域重确认。
        </>
      ),
      amplifies: false,
      businessForm: disclosureFormSpec(base, initialJurisdiction, version, editing ? "edit" : "create"),
      onBusinessSelectionChange: async (form) => {
        if (editing) return disclosureFormSpec(editing, editing.jurisdiction, editing.version, "edit");
        const jurisdiction = form.jurisdiction;
        const nextVersion = nextVersionFor(jurisdiction);
        const currentVersion = JURISDICTIONS.find((row) => row.code === jurisdiction)?.v ?? "";
        let snapshot = I5_VERSION_ROWS.find((row) => row.jurisdiction === jurisdiction && row.version === currentVersion);
        if (!snapshot && currentVersion) {
          try {
            snapshot = await actions.fetchI5DisclosureVersion(jurisdiction, currentVersion);
          } catch {
            toast("目标法域快照加载失败，请刷新后重试");
          }
        }
        return disclosureFormSpec(snapshot, jurisdiction, nextVersion, "create");
      },
      run: (reason, _v, form) => {
        const targetVersion = form?.version?.trim() || "";
        const jurisdiction = form?.jurisdiction?.trim() || "";
        const zh = form?.zh?.trim() || "";
        const vi = form?.vi?.trim() || "";
        const en = form?.en?.trim() || "";
        if (!targetVersion || !jurisdiction || !zh || !vi) {
          toast("缺少后端披露版本/法域/正文,无法提交草稿");
          return;
        }
        const payload = {
          jurisdiction,
          languageScope: form?.languageScope || "zh+vi",
          effectiveDate: form?.effectiveDate || "",
          requiresReack: form?.requiresReack !== "false",
          zh,
          vi,
          en,
          chapters: chapterPayload(form),
          ...(editing ? { expectedRevision: editing.revision, expectedContentHash: editing.contentHash } : {}),
        };
        const task = editing
          ? actions.updateI5DisclosureVersion(jurisdiction, targetVersion, payload, reason)
          : actions.createI5DisclosureVersion(jurisdiction, payload, reason);
        runBackend(task, "披露草稿已存 · 发布需风控操作确认");
      },
    });
  };

  const deleteDisclosureDraft = (row: DisclosureVersionItemView) => openActionConfirm({
    action: <>删除披露草稿 · {row.jurisdiction} {row.version}</>,
    detail: <>仅删除未发布草稿；已发布与已取代版本保持不可变，删除动作写入审计。</>,
    amplifies: false,
    run: (reason) => {
      if (row.revision == null || !row.contentHash) {
        toast("草稿并发校验信息缺失，请刷新后重试");
        return;
      }
      runBackend(actions.deleteI5DisclosureVersion(row.jurisdiction, row.version, row.revision, row.contentHash, reason), "披露草稿已删除");
    },
  });

  const editJurisdiction = (current?: DisclosureJurisdictionOption) => openActionConfirm({
    action: <>{current ? "编辑" : "新增"}披露法域</>,
    detail: <>法域代码创建后不可修改；名称与生命周期由法域配置统一维护，版本和国家映射在下方独立管理。</>,
    amplifies: false,
    businessForm: {
      kind: "disclosure-jurisdiction",
      mode: current ? "edit" : "create",
      code: current?.code,
      name: current?.name,
      revision: current?.revision,
    },
    run: (reason, _v, form) => {
      const code = form?.code?.trim().toUpperCase() || "";
      const name = form?.name?.trim() || "";
      if (!code || !name) return;
      const task = current
        ? actions.updateI5Jurisdiction(current.code, { name, expectedRevision: current.revision }, reason)
        : actions.createI5Jurisdiction({ code, name }, reason);
      runBackend(task, current ? "法域名称已更新" : "法域已新增");
    },
  });

  const changeJurisdictionLifecycle = (item: DisclosureJurisdictionOption, action: "enable" | "disable" | "archive") => {
    const labels = { enable: "启用", disable: "停用", archive: "归档" } as const;
    const statuses = { enable: "ACTIVE", disable: "DISABLED", archive: "ARCHIVED" } as const;
    openActionConfirm({
      action: <>{labels[action]}法域 · {item.code}</>,
      detail: action === "disable"
        ? <>停用后不能再为该法域新建披露版本或新增映射，历史版本与审计记录继续保留。</>
        : action === "archive"
          ? <>归档后法域退出可选目录，历史版本、映射和审计记录永久保留。</>
          : <>启用后该法域可用于新建披露版本和法域版本映射。</>,
      amplifies: false,
      run: (reason) => {
        const def = findHighOp("i5_jurisdiction_status")!;
        const command = def.buildCommand({
          jurisdiction: item.code,
          status: statuses[action],
          expectedRevision: item.revision,
        });
        return proposeDisclosure(
          `${item.code}:jurisdiction-status`,
          JSON.stringify({ command, reason }),
          {
          action: `${labels[action]}披露法域 · ${item.code}`,
          obj: item.code,
          before: item.status,
          after: statuses[action],
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I5",
          command,
          target: def.buildTarget({ jurisdiction: item.code }),
          },
        );
      },
    });
  };

  const deleteJurisdiction = (item: DisclosureJurisdictionOption) => openActionConfirm({
    action: <>删除未使用法域 · {item.code}</>,
    detail: <>仅未被披露版本和当前映射引用的已归档法域可以删除；法域代码保留为审计防重标识，不可重新占用。</>,
    amplifies: false,
    run: (reason) => {
      const def = findHighOp("i5_jurisdiction_delete")!;
      const command = def.buildCommand({ jurisdiction: item.code, expectedRevision: item.revision });
      return proposeDisclosure(
        `${item.code}:jurisdiction-delete`,
        JSON.stringify({ command, reason }),
        {
        action: `删除未使用披露法域 · ${item.code}`,
        obj: item.code,
        before: `${item.name} · ${item.status}`,
        after: "删除",
        type: "param",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "I5",
        command,
        target: def.buildTarget({ jurisdiction: item.code }),
        },
      );
    },
  });

  const configMatrix = (current?: Jurisdiction) =>
    activeJurisdictionOptions.length === 0 ? toast("暂无启用法域，请先维护法域配置") : openActionConfirm({
      action: <>{current ? "编辑" : "新增"}法域 × 版本映射</>,
      detail: (
        <>
          这里仅维护启用法域的适用国家/地区与已发布版本映射。改映射等同给该法域换生效条款,会触发重确认;<b>发起人限风控,执行门槛 = 风控 / 超管</b>。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "disclosure-matrix",
        mode: current ? "edit" : "create",
        jurisdictionCode: current?.code,
        jurisdictionName: current?.name,
        version: current?.v,
        countryCodes: current?.countryCodes ?? [],
        countryOptions,
        jurisdictionOptions: current
          ? activeJurisdictionOptions.filter((option) => option.value === current.code)
          : activeJurisdictionOptions,
        publishedVersionsByJurisdiction,
      },
      run: (reason, _v, form) => {
        const jurisdictionCode = form?.jurisdictionCode?.trim().toUpperCase() || "";
        if (!jurisdictionCode) return;
        const jurisdictionName = jurisdictionCatalog.find((item) => item.code === jurisdictionCode)?.name ?? "";
        const countryCodes = (form?.countryCodes || "").split(",").map((code) => code.trim()).filter(Boolean);
        const version = form?.version || "";
        const def = findHighOp("i5_matrix_configure")!;
        const currentSnapshot = JURISDICTIONS.find((item) => item.code === jurisdictionCode);
        const command = def.buildCommand({
          jurisdictionCode,
          jurisdictionName,
          countryCodes,
          version,
          expectedVersion: currentSnapshot?.v ?? "",
          expectedStatus: currentSnapshot?.status ?? "ABSENT",
          expectedCountryCodes: currentSnapshot?.countryCodes ?? [],
        });
        return proposeDisclosure(
          `${jurisdictionCode}:matrix-configure`,
          JSON.stringify({ command, reason }),
          {
          action: `${current ? "调整" : "新增"}披露法域版本矩阵 · ${jurisdictionCode}`,
          obj: jurisdictionCode,
          before: current ? `${current.v} · ${current.countryCodes.join("、")}` : "未配置",
          after: `${version} · ${countryCodes.join("、")}`,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I5",
          command,
          target: def.buildTarget({ jurisdictionCode }),
          },
        );
      },
    });

  const archiveMatrix = (j: Jurisdiction) => openActionConfirm({
    action: <>归档法域版本映射 · {j.code}</>,
    detail: <>归档后保留历史版本与审计记录，不再作为有效披露映射。</>,
    amplifies: false,
    run: (reason) => {
      const def = findHighOp("i5_matrix_archive")!;
      const command = def.buildCommand({
        jurisdiction: j.code,
        expectedVersion: j.v,
        expectedStatus: j.status,
      });
      return proposeDisclosure(
        `${j.code}:matrix-archive`,
        JSON.stringify({ command, reason }),
        {
        action: `归档披露法域版本矩阵 · ${j.code}`,
        obj: j.code,
        before: `${j.v} · ${statusZh(j.status)}`,
        after: "已归档",
        type: "param",
        amplifies: false,
        gate: { roles: [] },
        gateLabel: def.gateLabel,
        reason,
        sourceDomain: "I5",
        command,
        target: def.buildTarget({ jurisdiction: j.code }),
        },
      );
    },
  });

  const publishDisclosure = (row: DisclosureVersionItemView) => {
    const j = JURISDICTIONS.find((item) => item.code === row.jurisdiction);
    const current = I5_VERSION_ROWS.find((item) => item.jurisdiction === row.jurisdiction && item.status.toLowerCase() === "published");
    const affected = row.affected ?? j?.affected ?? 0;
    const pendingAck = row.pendingAck ?? j?.pendingAck ?? Math.max(0, Math.round(affected * (100 - (j?.ackProgress ?? 0)) / 100));
    const blocked = row.blocked ?? j?.blocked ?? 0;
    openActionConfirm({
      action: <>发布已存披露草稿 · {row.jurisdiction}</>,
      detail: (
        <>
          <b>合规关键动作</b>:发布只审批服务器已经保存的草稿并形成不可变 7 章快照，不接受确认框临时改正文，也不会改变 App 当前投放或用户确认状态。后续切换法域映射时才触发重新确认与服务器受限动作拦截。<b>执行门槛 = 风控 / 超管</b>。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "disclosure-publish-review",
        jurisdiction: row.jurisdiction,
        currentVersion: current?.version ?? j?.v ?? "",
        targetVersion: row.version,
        affected,
        pendingAck,
        blocked,
        gatedActions: GATED_ACTIONS.filter((action) => action.active).map((action) => action.name),
        currentChapters: current?.chapters ?? [],
        targetChapters: row.chapters,
      },
      run: (reason) => {
        const def = findHighOp("i5_disclosure_publish")!;
        const version = row.version;
        const jurisdiction = row.jurisdiction;
        const command = def.buildCommand({
          jurisdiction,
          version,
          expectedRevision: row.revision,
          contentHash: row.contentHash,
        });
        return proposeDisclosure(
          `${jurisdiction}:${version}:publish`,
          JSON.stringify({ command, reason }),
          {
          action: `发布披露新版 · ${jurisdiction}`,
          obj: jurisdiction,
          before: current?.version ?? j?.v ?? "无生效版",
          after: version,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I5",
          command,
          target: def.buildTarget({ jurisdiction }),
          },
        );
      },
    });
  };

  const toggleGate = (g: GateAction) => {
    const on = gateOn(g.key);
    openActionConfirm({
      action: <>{on ? "移出" : "纳入"}受限动作 · {g.name}</>,
      detail: (
        <>
          {on
            ? <>把 <b>{g.name}</b> 移出受限范围:确认状态过期时<b>不再拦截</b>该动作。<b>缩小范围等于放松合规拦截</b>,确认时写清依据。</>
            : <>把 <b>{g.name}</b> 纳入受限范围:确认状态过期时拦截该动作。</>}
          {" "}风控提交,风控 / 超管执行。
        </>
      ),
      amplifies: on, // 移出受限范围(on=true)= 放松合规拦截 → amplifies;纳入(on=false)= 收紧 → false
      run: (reason) => {
        const nextScope = GATED_ACTIONS
          .filter((item) => (item.key === g.key ? !on : item.active))
          .map((item) => item.name)
          .join(" + ") || g.name;
        const def = findHighOp("i5_gate_adjust")!;
        const command = def.buildCommand({ scope: nextScope, expectedScope: data?.gateScope ?? "" });
        return proposeDisclosure(
          `restricted-actions:${g.key}`,
          JSON.stringify({ command, reason }),
          {
          action: `${on ? "移出" : "纳入"}受限动作 · ${g.name}`,
          obj: g.name,
          before: on ? "受限内" : "已移出",
          after: on ? "已移出" : "受限内",
          type: "param",
          amplifies: on,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I5",
          command,
          target: def.buildTarget({}),
          },
        );
      },
    });
  };

  // 抽屉数据。
  const sec = secKey ? TRUST_SECTIONS.find((s) => s.key === secKey) ?? null : null;
  const jur = jurCode ? JURISDICTIONS.find((j) => j.code === jurCode) ?? null : null;
  const chap = chapNo ? DISCLOSURE_CHAPTERS.find((c) => c.no === chapNo) ?? null : null;
  const selectedDisclosureVersion = disclosureDetailKey
    ? I5_VERSION_ROWS.find((row) => `${row.jurisdiction}\u0000${row.version}` === disclosureDetailKey) ?? null
    : null;
  const sectionExternalLink = sec
    ? (SECTION_FIELDS[sec.key] ?? []).find(([key]) => /(^|[._-])(url|link|href)($|[._-])/i.test(key))?.[1] ?? ""
    : "";

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">{pageId} 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">{pageId} 暂无真实接口数据</div></div></section>;
  }

  return (
    <>
      <div className="f-stats">
        {view === "trust" && <div className="f-stat">
          <div className="k">受管信任版块</div>
          <div className="v">{I4_STATS.managedSections} 个</div>
          <div className="sub">财务数字/团队/叙事/徽章/审计/外链</div>
        </div>}
        {view === "disclosures" && <><div className="f-stat cyan">
          <div className="k">披露法域 × 版本</div>
          <div className="v">{I4_STATS.jurisdictions} 法域</div>
          <div className="sub">{JURISDICTIONS.map((j) => j.code).join(" · ") || "暂无后端法域"}</div>
        </div>
        <div className="f-stat warn">
          <div className="k">待重确认用户</div>
          <div className="v">{I4_STATS.staleAckUsers.toLocaleString("en-US")}</div>
          <div className="sub">{activeJurisdiction ? `${activeJurisdiction.code} ${activeJurisdiction.v}` : "暂无后端法域版本"} · 下次提现前必须确认</div>
        </div>
        <div className="f-stat">
          <div className="k">合规闸拦截(本周)</div>
          <div className="v">{I4_STATS.weeklyGateBlocked} 次</div>
          <div className="sub">未确认者发起提现被拦</div>
        </div></>}
      </div>

      {view === "disclosures" && <><LegalTermsEditor /><PublishedContentEditor kind="privacyPolicy" /></>}

      {/* (I4 · a) 信任中心 6 版块 */}
      {view === "trust" && <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任中心(I4 · a)· /trust</span>
          <span className="sub">· 6 版块 · 财务数字/团队/叙事/徽章/审计/外链</span>
          <div className="r">
            {pendingTrustSectionKeys.size > 0 && <span className="bdg warn">A2待确认 {pendingTrustSectionKeys.size}</span>}
            <button className="l-btn sm" onClick={() => void actions.reloadIContent()}>刷新状态</button>
            {(isSuperadmin || session?.authorities.includes("platform_a2_read")) && <Link className="l-btn sm" href={pendingA2Href}>查看A2</Link>}
            <span className="icode danger">高敏合规</span>
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
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2 }}>{s.desc}</div>
                    </td>
                    <td style={{ fontSize: 12, color: "var(--ink-2)" }}>{s.struct}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{s.v}</td>
                    <td>
                      {isSensitiveTrustSection(s) ? (
                        <span className="bdg warn">{s.roleGate}</span>
                      ) : (
                        <span className="bdg dim">{s.roleGate}</span>
                      )}
                    </td>
                    <td>
                      {isPending && <span className="bdg warn" style={{ marginRight: 6 }}>有新版 A2 待确认</span>}
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
          <span className="sub">· 草稿可编辑/删除 · 发布与回滚均基于后端快照</span>
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
                  <td>{version.description}</td>
                  <td>{version.structure}</td>
                  <td className="num">{version.fields.length}</td>
                  <td><span className={`bdg ${isDraft ? "warn" : "ok"}`}>{statusZh(version.status)}</span></td>
                  <td className="mono">{version.updatedAt || "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {isDraft && canDraftTrust && <>
                      <button className="l-btn sm" disabled={isPending} onClick={() => editSectionDraft(version)}>编辑草稿</button>{" "}
                      <button className="l-btn sm danger" disabled={isPending} onClick={() => deleteSectionDraft(version)}>删除草稿</button>{" "}
                    </>}
                    {isDraft && section && canPublishTrustSection(section) && <button className="l-btn sm mc" disabled={isPending} onClick={() => pubSection(section, version)}>{isPending ? "A2待确认" : "发布草稿"}</button>}
                    {(!isDraft || (!canDraftTrust && (!section || !canPublishTrustSection(section)))) && <span className="tiny">只读{isDraft ? "（无编辑或发布权限）" : "历史快照"}</span>}
                  </td>
                </tr>;
              })}
              {TRUST_SECTION_VERSIONS.length === 0 && <tr><td colSpan={8}><div className="itint">暂无后端版本快照，请先从版块行点击“新建草稿”。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>}

      {view === "disclosures" && <>
      {/* I5 法域配置：只维护法域元数据和生命周期 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">法域配置(I5)</span>
          <span className="sub">· 代码 / 名称 / 生命周期 · 国家与版本在下方映射</span>
          <div className="r">
            {canDraftDisclosure && <button className="l-btn sm mc" onClick={() => editJurisdiction()}>新增法域</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 800 }}>
            <thead><tr><th>法域代码</th><th>法域名称</th><th>状态</th><th className="num">引用版本</th><th>当前映射</th><th>最后操作人</th><th>更新时间</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {jurisdictionCatalog.map((item) => {
                const status = item.status.toLowerCase();
                const canDelete = status === "archived" && item.referencedVersionCount === 0 && !item.hasActiveMapping;
                return <tr key={item.code}>
                  <td className="mono" style={{ fontWeight: 700 }}>{item.code}</td>
                  <td>{item.name}</td>
                  <td><span className={`bdg ${status === "active" ? "ok" : status === "disabled" ? "warn" : ""}`}>{statusZh(item.status)}</span></td>
                  <td className="num mono">{item.referencedVersionCount}</td>
                  <td>{item.hasActiveMapping ? "已配置" : "未配置"}</td>
                  <td>{item.lastOperator || "—"}</td>
                  <td className="mono tiny">{item.updatedAt || "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canDraftDisclosure && status !== "archived" && <><button className="l-btn sm" onClick={() => editJurisdiction(item)}>编辑</button>{" "}</>}
                    {canPublishDisclosure && status === "active" && <><button className="l-btn sm" disabled={item.hasActiveMapping} title={item.hasActiveMapping ? "请先归档下方当前映射，再停用法域" : ""} onClick={() => changeJurisdictionLifecycle(item, "disable")}>停用</button>{" "}</>}
                    {canPublishDisclosure && status === "disabled" && <><button className="l-btn sm" onClick={() => changeJurisdictionLifecycle(item, "enable")}>启用</button>{" "}</>}
                    {canPublishDisclosure && status !== "archived" && <><button className="l-btn sm" disabled={item.hasActiveMapping} title={item.hasActiveMapping ? "请先归档下方当前映射，再归档法域" : ""} onClick={() => changeJurisdictionLifecycle(item, "archive")}>归档</button>{" "}</>}
                    {canPublishDisclosure && <button className="l-btn sm" disabled={!canDelete} title={canDelete ? "" : "须先归档法域，且不能存在版本或当前映射"} onClick={() => deleteJurisdiction(item)}>删除</button>}
                  </td>
                </tr>;
              })}
              {jurisdictionCatalog.length === 0 && <tr><td colSpan={8}><div className="itint">暂无法域配置，请先新增法域。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* I5 披露版本 × 法域矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">披露矩阵(I5)· version × jurisdiction</span>
          <span className="sub">· 风控提交 · 风控 / 超管执行</span>
          <div className="r">
            <span className="icode danger">合规关键 · 风控确认</span>
            {canPublishDisclosure && <button className="l-btn sm" onClick={() => configMatrix()}>新增映射</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>法域</th>
                <th>适用国家/地区</th>
                <th>当前版本</th>
                <th>状态</th>
                <th>发布日</th>
                <th className="num">受影响</th>
                <th>重新确认进度</th>
                <th className="num">拦截数</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {JURISDICTIONS.map((j) => {
                const v = liveJurVersion(j);
                const jurisdictionEnabled = jurisdictionCatalog.find((item) => item.code === j.code)?.status.toLowerCase() === "active";
                return (
                  <tr key={j.code} className="click" onClick={() => openJurDetail(j)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{j.code}</span>
                      <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{jurisdictionNameFor(j.code, j.name)}</div>
                    </td>
                    <td>{j.countryCodes?.join("、") || "未配置"}</td>
                    <td className="mono" style={{ fontWeight: 700 }}>{v}</td>
                    <td><span className="bdg ok">{statusZh(j.status)}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{j.publishedAt}</td>
                    <td className="num mono">{j.affected.toLocaleString("en-US")}</td>
                    <td>
                      <span className="tr-prog">
                        <i style={{ width: `${j.ackProgress}%` }} />
                      </span>
                      <span className="mono" style={{ fontSize: 11.5, marginLeft: 6 }}>{j.ackProgress}%</span>
                    </td>
                    <td
                      className="num mono"
                      style={j.blocked > 0 ? { color: "var(--warning)" } : undefined}
                    >
                      {j.blocked}
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canPublishDisclosure && jurisdictionEnabled && j.status.toLowerCase() !== "archived" && <><button className="l-btn sm" onClick={(e) => { e.stopPropagation(); configMatrix(j); }}>调整映射</button>{" "}</>}
                      {canPublishDisclosure && j.status.toLowerCase() !== "archived" && (
                        <button className="l-btn sm" onClick={(e) => { e.stopPropagation(); archiveMatrix(j); }}>归档</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="itint danger">
            <b>披露全链 操作员 = 风控、执行门槛 = 风控 / 超管;内容仅草拟。重新确认不是熔断闸,不进入 J1/J2。</b>
          </div>
          {disclosureDraft && disclosureDraft.version && disclosureDraft.zh && disclosureDraft.vi && (
            <div className="itint cyan" data-proof="disclosure-draft-preview" style={{ marginTop: 10 }}>
              <b>当前披露草稿回显</b> · 版本 <span className="mono">{disclosureDraft.version}</span>
              {" "}· 法域 <span className="mono">{disclosureDraft.jurisdiction ?? ""}</span>
              {" "}· 语言 <span className="mono">{disclosureDraft.languageScope ?? "zh+vi"}</span>
              {" "}· 生效日 <span className="mono">{disclosureDraft.effectiveDate ?? ""}</span>
              {" "}· 重新确认 <span className="mono">{disclosureDraft.requiresReack === false ? "否" : "是"}</span>
              <div className="grid g-3" style={{ gap: 10, marginTop: 8 }}>
                <div className="ab-prev">
                  <div className="lc">中文 · 草稿</div>
                  <div className="tx">{disclosureDraft.zh}</div>
                </div>
                <div className="ab-prev">
                  <div className="lc">越南语 · 草稿</div>
                  <div className="tx">{disclosureDraft.vi}</div>
                </div>
                {disclosureDraft.en && <div className="ab-prev">
                  <div className="lc">英语 · 草稿</div>
                  <div className="tx">{disclosureDraft.en}</div>
                </div>}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* I5 披露版本列表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">披露版本列表(I5) · 法域 × 版本</span>
          <span className="sub">· 草稿可编辑/删除，发布后不可变</span>
          <div className="r">{canDraftDisclosure && <button className="l-btn sm mc" onClick={() => draftDisclosure()}>新建版本</button>}</div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead><tr><th>法域</th><th>版本</th><th>状态</th><th>语言</th><th>生效/更新</th><th>操作员</th><th>章节</th><th style={{ textAlign: "right" }}>操作</th></tr></thead>
            <tbody>
              {I5_VERSION_ROWS.map((row) => {
                const isDraft = row.status.toLowerCase() === "draft";
                const hasConcurrencyToken = row.revision != null && Boolean(row.contentHash);
                const catalogStatus = jurisdictionCatalog.find((item) => item.code === row.jurisdiction)?.status.toLowerCase() ?? "";
                const jurisdictionActive = catalogStatus === "active";
                const jurisdictionArchived = catalogStatus === "archived";
                return <tr key={`${row.jurisdiction}-${row.version}`}>
                  <td className="mono">{row.jurisdiction}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{row.version}</td>
                  <td><span className={`bdg ${isDraft ? "warn" : "ok"}`}>{statusZh(row.status)}</span></td>
                  <td>{row.languageScope === "zh+vi+en" ? "中文 / 越南语 / 英语" : "中文 / 越南语"}</td>
                  <td className="mono tiny">{row.publishedAt || row.updatedAt || row.effectiveDate || "—"}</td>
                  <td>{row.operator || "—"}</td>
                  <td>{row.chapters.length} / 7</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="l-btn sm" onClick={() => setDisclosureDetailKey(`${row.jurisdiction}\u0000${row.version}`)}>查看七章</button>{" "}
                    {isDraft && canDraftDisclosure && <>{!jurisdictionArchived && <><button className="l-btn sm" disabled={!hasConcurrencyToken} title={hasConcurrencyToken ? "" : "缺少后端并发校验信息，请刷新"} onClick={() => draftDisclosure(row)}>编辑版本</button>{" "}</>}<button className="l-btn sm" disabled={!hasConcurrencyToken} title={hasConcurrencyToken ? "" : "缺少后端并发校验信息，请刷新"} onClick={() => deleteDisclosureDraft(row)}>删除草稿</button>{" "}</>}
                    {isDraft && canPublishDisclosure && row.chapters.length === 7 && jurisdictionActive && <button className="l-btn sm mc" disabled={!hasConcurrencyToken} title={hasConcurrencyToken ? "" : "缺少后端并发校验信息，请刷新"} onClick={() => publishDisclosure(row)}>发布</button>}
                    {isDraft && canPublishDisclosure && !jurisdictionActive && <span className="tiny" title="须先启用法域">须先启用法域</span>}
                  </td>
                </tr>;
              })}
              {I5_VERSION_ROWS.length === 0 && <tr><td colSpan={8}><div className="itint">暂无后端披露版本，请等待后端返回 nextVersion 后新建。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* I5 re-ack 覆盖监控 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">重确认覆盖监控(I5)</span>
          <span className="sub">· 改版后各法域确认进度 · 数字来自服务器确认事件</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 620 }}>
            <thead>
              <tr>
                <th>法域</th>
                <th>目标版本</th>
                <th className="num">受影响</th>
                <th className="num">已确认</th>
                <th className="num">待确认</th>
                <th>进度</th>
                <th className="num">拦截数</th>
              </tr>
            </thead>
            <tbody>
              {JURISDICTIONS.map((j) => {
                const pendingAck = j.pendingAck ?? Math.max(0, Math.round(j.affected * (100 - j.ackProgress) / 100));
                const acked = j.acked ?? Math.max(0, j.affected - pendingAck);
                return (
                  <tr key={j.code}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{j.code}</span>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{liveJurVersion(j)}</td>
                    <td className="num mono">{j.affected.toLocaleString("en-US")}</td>
                    <td className="num mono">{acked.toLocaleString("en-US")}</td>
                    <td className="num mono">{pendingAck.toLocaleString("en-US")}</td>
                    <td>
                      <span className="tr-prog">
                        <i style={{ width: `${j.ackProgress}%` }} />
                      </span>
                      <span className="mono" style={{ fontSize: 11.5, marginLeft: 6 }}>{j.ackProgress}%</span>
                    </td>
                    <td
                      className="num mono"
                      style={j.blocked > 0 ? { color: "var(--warning)" } : undefined}
                    >
                      {j.blocked}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 8 }}>
          <div className="itint">
            <b>没确认会怎样</b> · 确认状态已过期的用户,发起受限动作时被服务器拦下并跳去披露页;拦截数持续偏高说明催办不够——重新确认提醒走通知页(I3)的关键级通道,永不被淘汰。
          </div>
        </div>
      </section>

      {/* I5 受限动作范围 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">受限动作范围(I5)</span>
          <span className="sub">· 确认状态过期时,哪些动作会被拦 · 逐项启停(不再手打整串)</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {GATED_ACTIONS.map((g) => {
            const on = gateOn(g.key);
            return (
              <div className="tr-vrow" key={g.key}>
                <span className="nm">
                  <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{g.name}</span>
                  <small style={{ color: "var(--ink-4)" }}>{g.sub}</small>
                </span>
                <span className={`bdg ${g.tone}`}>{g.st}</span>
                {canAdjustGate ? <button className="l-btn sm mc" style={{ opacity: on ? 1 : 0.5 }} onClick={() => toggleGate(g)}>{on ? "受限内 · 移出" : "已移出 · 纳入"}</button> : <span className="tiny">只读</span>}
              </div>
            );
          })}
          <div className="itint warn" style={{ marginTop: 10 }}>
            <b>这不是熔断闸</b> · 重确认是「条款重新签字」机制,不是开关熔断——它不占应急熔断矩阵(J1)的闸位,也不进开关存储。监管点名要停业务,走 J 域;要改条款重签,走这页。J 域的应急剧本(J4)里「发布新披露版」就是引用这页的发布动作。
          </div>
        </div>
      </section>
      </>}

      <p className="f-foot">
        {view === "trust" ? <><b>I4 执行门槛</b>:一般版块由内容角色维护；<b>财务数字 / NEX 叙事 / 对外合规声明必须由对应授权角色或超管发布</b>。版块曝光事件喂 BI 做信任到转化归因。</> : <><b>I5 执行门槛</b>:风险披露由风控起草、风控主管或超管发布；内容角色无发布权限。披露确认、重确认与拦截事件喂合规覆盖看板和风控域。</>}
        <span title="§2.4.3 domain 枚举扩展 · V4 内容批次 · blocking">。</span>
      </p>
      <PaginationExemptionList
        items={view === "trust" ? [
          {
            label: "信任中心(I4 · a)· /trust",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "信任中心固定六版块,需同屏核对版本与状态",
          },
        ] : [
          {
            label: "披露矩阵(I5)· version × jurisdiction",
            maxRows: Math.max(JURISDICTIONS.length, 1),
            reason: "披露矩阵法域来自后端配置,发布关系需同屏对比",
          },
          {
            label: "重确认覆盖监控(I5)",
            maxRows: Math.max(JURISDICTIONS.length, 1),
            reason: "重确认监控法域来自后端配置,完整 ack 事件进 BI",
          },
        ]}
      />

      {view === "trust" && draftEditor && (
        <Drawer
          title={`${draftEditor.mode === "create" ? "新建" : "编辑"}信任版块草稿 · ${draftEditor.sectionKey}`}
          onClose={() => setDraftEditor(null)}
          footer={<>
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDraftEditor(null)}>取消</button>
            <button className="l-btn mc" data-trust-draft-editor="direct-save" style={{ flex: 1, justifyContent: "center" }} onClick={saveSectionDraft}>直接保存草稿</button>
          </>}
        >
          <div className="itint cyan" style={{ marginBottom: 12 }}>
            草稿保存是普通内容编辑，不走高敏确认；只有发布、回滚和下架进入操作确认。
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
      {view === "trust" && sec && (
        <Drawer
          title={`版块 · ${sec.key}(${sec.desc})`}
          onClose={() => setSecKey(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setSecKey(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            当前 {sec.v} · {statusZh(liveTrustStatus(sec))} · 执行门槛:{sec.roleGate}
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
                        <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{f.k}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>{f.v}</td>
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
                  <span className="v">{v}</span>
                </div>
              ))}
            </>
          )}
          <div className="itint" style={{ marginTop: 12 }}>
            外部链接：{sectionExternalLink || "未配置"}；版本由服务器单源持有，App 端只渲染当前发布版。
          </div>
        </Drawer>
      )}

      {/* 法域详情 Drawer */}
      {view === "disclosures" && jur && (
        <Drawer
          title={`法域 · ${jur.code}(${jurisdictionNameFor(jur.code, jur.name)})`}
          onClose={() => setJurCode(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setJurCode(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ink)" }}>
            生效版本 {liveJurVersion(jur)} · {jur.publishedAt} 起 · 受影响用户 {jur.affected.toLocaleString("en-US")}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4, lineHeight: 1.6 }}>
            该法域用户的确认状态按这个版本校验;版本号只增不减。
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>版本与操作 / 留痕</div>
          <div className="kv">
            <span className="k">版本历史</span>
            <span className="v">{liveJurVersion(jur)} 生效 · 此前版本已被新版取代</span>
          </div>
          <div className="kv">
            <span className="k">语言</span>
            <span className="v">中文 + 越南语(英语可选，挂 I6 词条)</span>
          </div>
          <div className="kv">
            <span className="k">操作 / 留痕</span>
            <span className="v">风控 / 超管</span>
          </div>
          <div className="kv">
            <span className="k">法域判定输入</span>
            <span className="v">按用户账号国家/地区代码与本法域配置匹配</span>
          </div>
          <div className="itint" style={{ marginTop: 12 }}>
            给这个法域发新版 = 该法域全部用户确认状态转为已过期,下次受限动作前强制重新确认;提醒经 I3 关键级通道下发。
          </div>
        </Drawer>
      )}

      {/* 章节 Drawer */}
      {view === "disclosures" && selectedDisclosureVersion && (
        <Drawer
          title={`披露版本 · ${selectedDisclosureVersion.jurisdiction} ${selectedDisclosureVersion.version}`}
          onClose={() => setDisclosureDetailKey(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDisclosureDetailKey(null)}>关闭</button>}
        >
          <div className="itint" style={{ marginBottom: 10 }}>
            状态：{statusZh(selectedDisclosureVersion.status)} · 语言：{selectedDisclosureVersion.languageScope === "zh+vi+en" ? "中文 / 越南语 / 英语" : "中文 / 越南语"} · 章节：{selectedDisclosureVersion.chapters.length} / 7
          </div>
          {selectedDisclosureVersion.chapters.map((chapter) => <div className="card" key={chapter.no} style={{ padding: 10, marginTop: 8 }}>
            <b>第 {chapter.no} 章 · {chapter.zh}</b>
            <div className="tiny" style={{ marginTop: 4 }}>{chapter.zhBody}</div>
            <div style={{ marginTop: 8 }}><b>{chapter.vi}</b><div className="tiny">{chapter.viBody}</div></div>
            {chapter.en && <div style={{ marginTop: 8 }}><b>{chapter.en}</b><div className="tiny">{chapter.enBody}</div></div>}
          </div>)}
        </Drawer>
      )}

      {view === "disclosures" && chap && (
        <Drawer
          title={`章节 ${chap.no} · ${chap.zh}(${chap.jurisdiction} ${chap.version})`}
          onClose={() => setChapNo(null)}
          footer={
            <button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setChapNo(null)}>
              关闭
            </button>
          }
        >
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "4px 0 4px", color: "var(--ink)" }}>zh</div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>正文(节选)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontSize: 12.5, lineHeight: 1.7 }}>{chap.zhBody}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 600, margin: "14px 0 4px", color: "var(--ink)" }}>越南语</div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 360 }}>
              <thead>
                <tr>
                  <th>正文(节选)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ fontSize: 12.5, lineHeight: 1.7 }}>{chap.viBody}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="itint" style={{ marginTop: 12 }}>
            中文、越南语镜像 ✓ 占位符一致 ✓ · 用户必须滚到底 + 勾选才能确认;确认记录(版本 + 法域)落在服务器。
          </div>
        </Drawer>
      )}
    </>
  );
}
