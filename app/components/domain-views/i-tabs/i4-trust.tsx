"use client";
import { useReach } from "@/lib/nav/use-reach";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/**
 * I4 信任中心（改版）。I5 法律条款与风险披露是单独的新版页面，见 i5-disclosures.tsx。
 * 统一来源:后端 /content/trust-disclosure/overview;空库时保持空态,不补前端业务样例。
 * 首屏是 App 合同里六个版块的预览卡，下面是四份公司资料和全部版本。
 * 草稿保存直接写；发布、回滚、下架是提交审批，另一位管理员批准后才生效；PDF 上传和恢复默认直接生效。
 * 操作确认 显式 edit 契约:
 *  - 调参传 edit:回滚(select/current=v);
 *  - 处置不传 edit:发布信任版块 / 下架信任版块。
 * amplifies 全为 false —— I4 不碰 B1。请求、命令号和判断和旧页面一样，只换了画法。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { EyeOff, FilePen, History, LayoutList, Plus, RefreshCw, RotateCcw, Send, ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Fact, Facts, Fold, IrreversibleTag, JudgmentPoints, LocaleTabs, MoreMenu, Notice, PageHeader, Panel, StatusTag, Table, TableMessage, Td, Th, Tr, type JudgmentRow, type MoreMenuItem, type StateTone } from "@/app/components/rd";
import { PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { A2OutcomeUncertainError, createA2CommandKey } from "@/lib/admin/a2-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isOptionalTrustLinkField, validateTrustSectionTrilingualFields } from "@/lib/admin/trust-section-validation";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { I4Documents } from "./i4-documents";
import {
  APP_FIELD_LIMIT, APP_SECTION_ORDER, DraftEditorBody, FieldList, I4RecoveryNotice, LegacyText, RECOVERY_PLACEHOLDER, SECTION_INFO, SectionCard,
  VersionCompare, appBlanking, changedKeys, isArchivedStatus, previewFields, isPublished, localeItems, operatorText, sectionName, timeText, versionProblems,
  type Lang, type SectionCardModel,
} from "./i4-parts";

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
/** 版本一行的状态：公开中的版本写「公开中」，被替代的写「历史版本」。 */
const versionTone = (status: string, live: boolean): { text: string; tone: StateTone } => {
  const value = status.toLowerCase();
  if (value === "draft") return { text: "草稿", tone: "neutral" };
  if (live) return { text: "公开中", tone: "ok" };
  if (value === "superseded") return { text: "历史版本", tone: "done" };
  if (value === "published") return { text: "已下架", tone: "danger" };
  return { text: statusZh(status), tone: "done" };
};
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

const APPROVER = "另一位管理员";
const PENDING_REASON = "有申请等另一位管理员批准，批准或驳回后再改";
/** 现在下架或回滚到不完整的版本，App 的信任中心整页打不开（决定 I4-PD01，后端待办 I4-BE-01）。 */
const ARCHIVE_CONSEQUENCE = "现在下架任何一个版块，App 的信任中心整页不可用";
const FINANCE_LABEL: Record<string, string> = { tvlOnChain: "链上资产总值", mrrValue: "月度收入", mrrDelta: "月度收入变化", activeAccountsValue: "活跃账户数", activeAccountsDelta: "活跃账户变化", devicesOnlineValue: "在线设备数", devicesOnlineDelta: "在线设备变化", payoutsProcessedValue: "累计处理付款", payoutsProcessedDelta: "付款金额变化", "footnote.zh": "中文数据说明", "footnote.vi": "越南语数据说明", "footnote.en": "英文数据说明" };

export function I4Trust({ ctx, errorText }: { ctx: ICtx; errorText?: string | null }) {
  const { toast, openActionConfirm, actions, content, contentLoading } = ctx;
  const propose = usePropose();
  const session = useAdminAuth((state) => state.session);
  const reach = useReach();
  const isSuperadmin = session?.role === "superadmin";
  const canDraftTrust = isSuperadmin || !!session?.authorities.includes("content_i4_write");
  const canPublishStandard = isSuperadmin || !!session?.authorities.includes("content_i4_publish_standard");
  const canPublishSensitive = isSuperadmin || !!session?.authorities.includes("content_i4_trust_section_manage");
  /** 只有委托提案权、没有提交审批权的账号：按钮照旧给，确认框里先写明后端会拒（I4-N07，已提后端）。 */
  const proposalOnly = !isSuperadmin && !session?.authorities.includes("platform_a2_write") && !!session?.authorities.includes("platform_a2_proposal_create");
  const [secKey, setSecKey] = useState<TrustDetailKey | null>(null);
  const [draftEditor, setDraftEditor] = useState<DraftEditor | null>(null);
  const [detailLang, setDetailLang] = useState<Lang>("zh");
  const [readAt, setReadAt] = useState("");
  const [refreshing, setRefreshing] = useState(false);
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
  // 读取时间只用来显示（北京时间）。
  useEffect(() => { if (data) setReadAt(businessClock(Date.now())); }, [data]);
  const refresh = () => {
    setRefreshing(true);
    void actions.reloadIContent().finally(() => setRefreshing(false));
  };

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

  const openSecDetail = (s: TrustSection) => { setSecKey(s.key); setDetailLang("zh"); };

  // ---------- 显示用：由读到的版本推出来，不发请求 ----------
  const currentVersionOf = (s: TrustSection) => TRUST_SECTION_VERSIONS.find((version) => version.sectionKey === s.key && version.version === s.v);
  const draftsOf = (key: string) => TRUST_SECTION_VERSIONS.filter((version) => version.sectionKey === key && version.status.toLowerCase() === "draft");
  const blankingOf = (key: string, version?: TrustSectionVersion) => appBlanking(key, version?.operator ?? "", version?.fields ?? []);
  const permissionText = (s: TrustSection) => isSensitiveTrustSection(s) ? "信任中心管理权限" : "标准发布权限";
  /** 这一块让 App 信任中心打不开的原因（下架、当前版不完整）。 */
  const sectionProblems = (s: TrustSection) => isArchivedStatus(liveTrustStatus(s)) ? ["已下架"] : versionProblems(currentVersionOf(s));
  const orderedSections = [...TRUST_SECTIONS].sort((left, right) => {
    const a = APP_SECTION_ORDER.indexOf(left.key as typeof APP_SECTION_ORDER[number]);
    const b = APP_SECTION_ORDER.indexOf(right.key as typeof APP_SECTION_ORDER[number]);
    return (a < 0 ? 99 : a) - (b < 0 ? 99 : b);
  });
  const missingSections = APP_SECTION_ORDER.filter((key) => !TRUST_SECTIONS.some((s) => s.key === key));
  /** 除了这一块，别的版块已经让 App 打不开的原因（确认框里说「批准后 App 能不能打开」用）。 */
  const othersBroken = (key: string) => [
    ...missingSections.map((item) => `缺${sectionName(item)}版块`),
    ...orderedSections.filter((s) => s.key !== key && sectionProblems(s).length).map((s) => `${sectionName(s.key)}${sectionProblems(s)[0]}`),
  ];
  const approvalTag = <StatusTag tone="progress" filled explain={`${APPROVER}在「操作记录与审批」批准后才执行，批准前用户看到的不变。`}>批准后生效</StatusTag>;
  const approverFacts = (s: TrustSection) => <>
    <Fact k="谁来批">{APPROVER}，不能是提交人</Fact>
    <Fact k="需有权限">审批权限和{permissionText(s)}</Fact>
  </>;
  const proposalOnlyNotice = proposalOnly
    ? <Notice tone="warn" title="这个账号提交会被后端拒绝">只有委托提案权限的账号，信任中心的申请后端不受理，要有提交审批的权限。</Notice>
    : null;
  const otherIssueNotice = (key: string) => {
    const others = othersBroken(key);
    return others.length ? <Notice tone="danger" title="批准后 App 信任中心仍打不开">{others.join("、")}，要一起处理。</Notice> : null;
  };

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
    title: "删除草稿",
    detail: <>只删除还没发布的草稿；线上版本和历史版本不受影响。</>,
    amplifies: false,
    effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag>删了找不回</IrreversibleTag></>,
    confirmTone: "danger",
    confirmLabel: "删除草稿",
    statedBrief: { impact: "只删这份草稿，用户看到的内容和历史版本都不变。", check: "核对版块和版本号，理由写清为什么删。" },
    facts: <Facts><Fact k="版块">{sectionName(draft.sectionKey)}</Fact><Fact k="草稿">{draft.version} · {draft.fields.length} 个字段</Fact><Fact k="最近保存">{timeText(draft.updatedAt)} · {operatorText(draft.operator)}</Fact></Facts>,
    run: (reason) => runBackend(actions.deleteI4TrustSectionDraft(
      draft.sectionKey, draft.version, draft.revision, reason,
    ), `${draft.sectionKey} ${draft.version} 草稿已删除`),
  });

  const pubSection = (s: TrustSection, draft: TrustSectionVersion) => {
    const trilingualCheck = validateTrustSectionTrilingualFields(draft.fields);
    const problems = versionProblems(draft);
    return openActionConfirm({ briefKind: "content",
      action: <>发布信任版块 · {s.key} {draft.version}</>,
      title: `提交发布 · ${sectionName(s.key)}`,
      detail: (
        <>
          <b>版本差异</b>：当前线上 <span className="mono">{s.v}</span> → 待发布 <span className="mono">{draft.version}</span>；
          另一位管理员批准后才换成新版本，App 下次读取时显示。<b>三语确认</b>必须核对中文、越南语、英文语义一致。
          {requiresDataSource(s) && <>财务数字 / UVT介绍必须填写可追溯的<b>财务/UVT 数据来源</b>。</>}
        </>
      ),
      amplifies: false,
      effect: approvalTag,
      confirmLabel: "提交审批",
      statedBrief: { impact: `批准后用户看到的${sectionName(s.key)}从 ${s.v} 换成 ${draft.version}；批准前不变。`, check: "逐项核对三种语言和关键数字，理由写清依据。" },
      facts: <div className="rd-stack">
        <Facts><Fact k="版块">{sectionName(s.key)}</Fact><Fact k="版本"><Change from={`${s.v}（现在公开）`} to={draft.version} /></Fact>{approverFacts(s)}</Facts>
        {proposalOnlyNotice}
        <VersionCompare beforeLabel={`现在公开的 ${s.v}`} afterLabel={`批准后公开的 ${draft.version}`} before={currentSectionFields(s)} after={draft.fields} problems={problems.filter((item) => item !== "中越英字段不全")}
          afterBlanked={blankingOf(s.key, draft).all ? `提醒：${blankingOf(s.key, draft).all}` : undefined} />
        {otherIssueNotice(s.key)}
      </div>,
      blockedReason: trilingualCheck.valid ? undefined : `中越英字段不完整：${trilingualCheck.missing.join("、")}，先编辑草稿补齐`,
      businessForm: {
        kind: "multi-field",
        fields: [
          ...(requiresDataSource(s) ? [{ key: "dataSource", label: "财务/UVT 数据来源", inputKind: "text" as const, placeholder: "报表、账本快照或市场数据编号", required: true, wide: true, explain: "写清这些数字从哪来，后端最多收 500 字。只是说明，不会替你核对数字。" }] : []),
          { key: "bilingualConfirmed", label: "已逐项核对中、越、英三语，关键数字一致", inputKind: "checkbox" as const, required: true, wide: true },
        ],
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
  };

  const rollbackSection = (s: TrustSection) => {
    const archived = isArchivedStatus(s.status);
    const versionOf = (version: string) => TRUST_SECTION_VERSIONS.find((row) => row.sectionKey === s.key && row.version === version);
    const optionLabels = Object.fromEntries(sectionVersionOptions(s).map((version) => {
      const row = versionOf(version);
      const problems = versionProblems(row);
      return [version, <span key={version}>{version} · {timeText(row?.updatedAt)}{problems.length ? <span className="i4-option-warn"> · 不完整</span> : null}</span>];
    }));
    return openActionConfirm({ briefKind: "content",
      action: <>回滚信任版块 · {s.key}</>,
      title: `${archived ? "提交恢复上线" : "提交回滚"} · ${sectionName(s.key)}`,
      detail: (
        <>
          当前 <b>{s.v}</b>。请选择要恢复的历史版本。提交后等待审批；审批通过并执行后，对外内容恢复为所选版本，权限要求和发布一样。回滚不重新检查三语，旧版本不完整时 App 信任中心整页不可用。
        </>
      ),
      amplifies: false,
      effect: approvalTag,
      confirmTone: "danger",
      confirmLabel: "提交审批",
      statedBrief: { impact: `批准后用户看到的${sectionName(s.key)}换成所选版本；所选版本不完整时 App 信任中心整页不可用。`, check: "先看所选版本完不完整，理由写清为什么回到这一版。" },
      edit: { kind: "select", label: archived ? "恢复成" : "回滚到", current: s.v, currentLabel: archived ? "已下架的版本" : "现在公开", options: sectionVersionOptions(s), optionLabels, hint: "只能选这一块发布过的版本" },
      facts: (value?: string) => {
        const target = value ? versionOf(value) : undefined;
        const problems = target ? versionProblems(target) : [];
        return <div className="rd-stack">
          <Facts>
            <Fact k="版块">{sectionName(s.key)}</Fact>
            <Fact k="现在">{s.v} · {archived ? "已下架" : "公开中"}</Fact>
            {approverFacts(s)}
          </Facts>
          {proposalOnlyNotice}
          {target && <VersionCompare beforeLabel={`现在的 ${s.v}`} afterLabel={`批准后公开的 ${target.version}`} before={currentSectionFields(s)} after={target.fields} problems={problems}
            afterBlanked={blankingOf(s.key, target).all ? `提醒：${blankingOf(s.key, target).all}` : undefined} />}
          {target && problems.length === 0 && <p className="rd-note">所选版本完整：有说明和结构，中越英字段齐全，不超过 {APP_FIELD_LIMIT} 个字段。</p>}
          {otherIssueNotice(s.key)}
        </div>;
      },
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
  };

  const archiveSection = (s: TrustSection) =>
    openActionConfirm({ briefKind: "content",
      action: <>下架信任版块 · {s.key}</>,
      title: `提交下架 · ${sectionName(s.key)}`,
      detail: (
        <>
          当前 <b>{s.v}</b> 生效中。{ARCHIVE_CONSEQUENCE}，不只是隐藏这一块；版本正文保留，可以再恢复上线。执行门槛与发布一致({operatorCopyText(s.roleGate)})。
        </>
      ),
      amplifies: false,
      effect: approvalTag,
      confirmTone: "danger",
      confirmLabel: "提交下架审批",
      statedBrief: { impact: `批准后${sectionName(s.key)}下架；版本正文保留，可以再恢复上线。`, check: "确认是对外内容出了问题非下不可，理由写清依据。" },
      facts: <div className="rd-stack">
        <Facts>
          <Fact k="版块">{sectionName(s.key)}</Fact>
          <Fact k="状态"><Change from={`公开中 ${s.v}`} to="已下架" /></Fact>
          {approverFacts(s)}
        </Facts>
        <Notice tone="danger" title={`${ARCHIVE_CONSEQUENCE}。`}>App 要求六个版块都公开才显示信任中心，已提后端改成可以单独下架。</Notice>
        {proposalOnlyNotice}
      </div>,
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

  const pendingLink = reach(pendingA2Href, "platform_a2_read")
    ? <Link className="rd-link" href={pendingA2Href} prefetch={false}>查看审批</Link> : null;
  const readOnly = !canDraftTrust && !canPublishStandard && !canPublishSensitive
    ? "你只能查看；改内容要有这页的修改或发布权限。"
    : !canPublishStandard && !canPublishSensitive ? "你可以写草稿；提交发布、回滚、下架要有发布权限。" : undefined;
  const header = (
    <PageHeader pageId="I4" title="信任中心" summary="管 App 信任中心的六个版块和四份公司资料。" readOnly={readOnly}
      meta={data && <span className="rd-toolbar">
        {readAt && <span>{readAt} 读取（{businessZone().label}）· 每 10 秒更新</span>}
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={refreshing} onClick={refresh}>刷新</Button>
      </span>} />
  );

  if (contentLoading && !data) {
    return <>{header}<I4RecoveryNotice rows={RECOVERY_PLACEHOLDER} /><BlockState state="loading" title="信任中心数据加载中…" /><I4Documents /></>;
  }
  if (!data) {
    return <>{header}<I4RecoveryNotice rows={RECOVERY_PLACEHOLDER} /><BlockState state="error" title="信任中心读取失败" detail={errorText ?? "暂无信任中心数据"} onRetry={refresh} retrying={refreshing} /><I4Documents /></>;
  }

  // ---------- 首屏结论 ----------
  const allIssues = [
    ...missingSections.map((key) => `缺${sectionName(key)}版块`),
    ...orderedSections.filter((s) => sectionProblems(s).length).map((s) => `${sectionName(s.key)}${sectionProblems(s)[0]}`),
  ];
  // 结论只写前两处，其余写个数；每一处在卡片上都有标记。
  const issues = TRUST_SECTIONS.length === 0 && allIssues.length ? ["后台没有读到任何版块"]
    : allIssues.length > 2 ? [...allIssues.slice(0, 2), `另有 ${allIssues.length - 2} 处`] : allIssues;
  const drafts = TRUST_SECTION_VERSIONS.filter((version) => version.status.toLowerCase() === "draft");
  const draftSections = new Set(drafts.map((version) => version.sectionKey));
  const publicCount = orderedSections.filter((s) => isPublished(s.status)).length;
  const blankedCount = orderedSections.filter((s) => blankingOf(s.key, currentVersionOf(s)).all).length;
  const hint = [
    pendingTrustSectionKeys.size > 0 && `${pendingTrustSectionKeys.size} 个版块等另一位批准`,
    draftSections.size > 0 && `${draftSections.size} 个版块有没公开的草稿`,
  ].filter(Boolean).join(" · ") || undefined;
  const conclusionExplain = <><p>App 只在六个版块都公开、每块当前版都有说明和结构、中越英字段齐全、不超过 {APP_FIELD_LIMIT} 个字段时，才显示信任中心；有一块不满足，整页打不开。</p><p>这里按后台读到的版本判断，安全文本和链接的细则以后端为准。</p></>;
  const conclusion = issues.length
    ? <Conclusion state="danger" icon={ShieldAlert} lead explain={conclusionExplain} explainTitle="怎么判断"
      hint={[hint, "恢复上线或发布完整的版本后才能打开"].filter(Boolean).join(" · ")}>App 信任中心现在整页打不开：{issues.join("、")}</Conclusion>
    : pendingTrustSectionKeys.size > 0
      ? <Conclusion state="warn" explain={conclusionExplain} explainTitle="怎么判断" action={pendingLink} hint={draftSections.size ? `${draftSections.size} 个版块有没公开的草稿` : "批准前用户看到的不变"}>
          <b>{pendingTrustSectionKeys.size}</b> 个版块的申请等另一位批准</Conclusion>
      : draftSections.size > 0
        ? <Conclusion state="neutral" icon={FilePen} explain={conclusionExplain} explainTitle="怎么判断" hint="草稿只在后台，提交发布并批准后才公开">
            六个版块都在公开；<b>{draftSections.size}</b> 个版块有没公开的草稿</Conclusion>
        : <Conclusion state="ok" icon={ShieldCheck} explain={conclusionExplain} explainTitle="怎么判断" hint={blankedCount ? `${blankedCount} 块的文字 App 公开时清空，用户看到的是空的` : undefined}>六个版块都在公开，没有没公开的改动</Conclusion>;

  // ---------- 版块卡 ----------
  const sectionMenu = (s: TrustSection): MoreMenuItem[] => {
    const isArchived = isArchivedStatus(liveTrustStatus(s));
    const isPending = pendingTrustSectionKeys.has(s.key);
    return [
      ...(canPublishTrustSection(s) ? [{ key: "rollback", label: isArchived ? "恢复上线" : "回滚历史版", disabledReason: isPending ? PENDING_REASON : sectionVersionOptions(s).length === 0 ? "没有可以回滚的历史版本" : undefined, onSelect: () => rollbackSection(s) }] : []),
      ...(canPublishTrustSection(s) && !isArchived ? [{ key: "archive", label: "下架", danger: true, disabledReason: isPending ? PENDING_REASON : undefined, onSelect: () => archiveSection(s) }] : []),
    ];
  };
  const cards: SectionCardModel[] = orderedSections.map((s, index) => {
    const current = currentVersionOf(s);
    const blanking = blankingOf(s.key, current);
    const isArchived = isArchivedStatus(liveTrustStatus(s));
    const isPending = pendingTrustSectionKeys.has(s.key);
    const preview = previewFields(s.key, (current?.fields ?? []).filter((field) => !blanking.keys.has(field.key)));
    const menu = sectionMenu(s);
    return {
      key: s.key,
      index: index + 1,
      name: sectionName(s.key, trustDescriptionText(s.desc)),
      status: isArchived ? { text: "已下架", tone: "danger" } : isPublished(s.status) ? { text: "公开中", tone: "ok" } : { text: statusZh(s.status), tone: "warn" },
      version: s.v,
      updatedAt: current?.updatedAt ? timeText(current.updatedAt) : undefined,
      preview,
      blankedAll: blanking.all,
      appNote: isArchived ? "已下架：下架前的内容，用户看不到" : blanking.all ? "App 公开时清空，用户看到的是空的" : undefined,
      draft: draftsOf(s.key).map((draft) => draft.version).join("、") || undefined,
      pending: isPending,
      problems: isArchived ? [] : sectionProblems(s),
      lastChange: s.lastChange,
      selected: secKey === s.key,
      onOpen: () => openSecDetail(s),
      actions: <>
        {canDraftTrust && <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={isPending ? PENDING_REASON : undefined} onClick={() => createSectionDraft(s)}>新建草稿</Button>}
        <Button size="sm" variant="ghost" onClick={() => openSecDetail(s)}>查看</Button>
        {menu.length > 0 && <MoreMenu label={`${sectionName(s.key)}的更多操作`} items={menu} />}
      </>,
    };
  });

  // ---------- 版本行的动作（详情抽屉和全部版本共用） ----------
  const versionActions = (version: TrustSectionVersion) => {
    const section = TRUST_SECTIONS.find((row) => row.key === version.sectionKey);
    const isDraft = ["draft", "DRAFT"].includes(version.status);
    const isPending = pendingTrustSectionKeys.has(version.sectionKey);
    if (!isDraft) return <span className="rd-weak">只读</span>;
    const canPublish = !!section && canPublishTrustSection(section);
    if (!canDraftTrust && !canPublish) return <span className="rd-weak">只读</span>;
    const items: MoreMenuItem[] = canDraftTrust ? [
      { key: "edit", label: "编辑草稿", disabledReason: isPending ? PENDING_REASON : undefined, onSelect: () => editSectionDraft(version) },
      { key: "delete", label: "删除草稿", danger: true, disabledReason: isPending ? PENDING_REASON : undefined, onSelect: () => deleteSectionDraft(version) },
    ] : [];
    return <span className="rd-row-actions">
      {canPublish && <Button size="sm" icon={<Send size={14} aria-hidden />} disabledReason={isPending ? PENDING_REASON : undefined} onClick={() => pubSection(section!, version)}>提交发布</Button>}
      {items.length > 0 && <MoreMenu label={`${sectionName(version.sectionKey)} ${version.version} 的更多操作`} items={items} />}
    </span>;
  };
  /** 和上一版（同一块里更早的一版）比改了几项。 */
  const changeText = (version: TrustSectionVersion) => {
    const list = TRUST_SECTION_VERSIONS.filter((row) => row.sectionKey === version.sectionKey);
    const older = list.slice(list.indexOf(version) + 1).find((row) => row.status.toLowerCase() !== "draft");
    if (!older) return "第一版";
    const count = changedKeys(older.fields, version.fields).size;
    return count ? `比 ${older.version} 改了 ${count} 项` : `和 ${older.version} 一样`;
  };

  // ---------- 详情抽屉 ----------
  const detailIndex = sec ? orderedSections.indexOf(sec) : -1;
  const secCurrent = sec ? currentVersionOf(sec) : undefined;
  const secBlanking = sec ? blankingOf(sec.key, secCurrent) : { keys: new Set<string>() };
  const secVersions = sec ? TRUST_SECTION_VERSIONS.filter((row) => row.sectionKey === sec.key) : [];
  const secPending = sec ? pendingTrustSectionKeys.has(sec.key) : false;
  const secProblems = sec ? sectionProblems(sec) : [];
  const detailPoints: JudgmentRow[] = sec ? [
    { label: "用户现在看到", value: isArchivedStatus(liveTrustStatus(sec)) ? `已下架（${sec.v}），App 信任中心整页打不开` : isPublished(sec.status) ? `${sec.v} 公开中` : `${sec.v}（${statusZh(liveTrustStatus(sec))}）`, state: secProblems.length ? "danger" : undefined, reason: secProblems.length ? secProblems.join("；") : undefined },
    { label: "App 里在哪", value: SECTION_INFO[sec.key]?.where ?? "待核实" },
    ...(secPending ? [{ label: "待审批", value: <>有申请等另一位批准，批准或驳回前不能改{pendingLink && <> · {pendingLink}</>}</>, state: "warn" as const }] : []),
    { label: "提交发布要", value: `${permissionText(sec)}，${APPROVER}批准` },
    { label: "外部链接", value: sectionExternalLink ? <span data-user-content="" className="i4-break">{sectionExternalLink}</span> : "未配置" },
  ] : [];
  const secFooter = sec && (canDraftTrust || canPublishTrustSection(sec)) ? (() => {
    const isArchived = isArchivedStatus(liveTrustStatus(sec));
    const lock = secPending ? PENDING_REASON : undefined;
    return <Decision
      danger={canPublishTrustSection(sec) && !isArchived ? <Button variant="danger-outline" icon={<EyeOff size={14} aria-hidden />} disabledReason={lock} onClick={() => archiveSection(sec)}>下架</Button> : undefined}
      others={canPublishTrustSection(sec) ? <Button icon={isArchived ? <RotateCcw size={14} aria-hidden /> : <Undo2 size={14} aria-hidden />} disabledReason={lock ?? (sectionVersionOptions(sec).length === 0 ? "没有可以回滚的历史版本" : undefined)} onClick={() => rollbackSection(sec)}>{isArchived ? "恢复上线" : "回滚历史版"}</Button> : undefined}
      primary={canDraftTrust ? <Button variant="primary" icon={<Plus size={14} aria-hidden />} disabledReason={lock} onClick={() => createSectionDraft(sec)}>新建草稿</Button> : undefined} />;
  })() : undefined;

  // ---------- 编辑抽屉 ----------
  const editorSection = draftEditor ? TRUST_SECTIONS.find((item) => item.key === draftEditor.sectionKey) : undefined;
  const editorMissing = draftEditor ? [
    !/^v[1-9][0-9]{0,8}$/.test(draftEditor.version) && "版本号（v 加数字）",
    !draftEditor.description.trim() && "版块说明",
    !draftEditor.structure.trim() && "内容结构",
    !draftEditor.reason.trim() && "保存说明",
    draftEditor.fields.some((field) => !field.label.trim() || (!isOptionalTrustLinkField(field.key) && !field.value.trim())) && "空着的字段",
  ].filter(Boolean) as string[] : [];

  return (
    <>
      {header}
      {errorText && <Notice tone="warn" title="数据没有读到最新" action={<Button size="sm" loading={refreshing} onClick={refresh}>重新加载</Button>}>{errorText} 下面是上次读到的内容。</Notice>}
      <I4RecoveryNotice rows={RECOVERY_PLACEHOLDER} />
      {conclusion}

      <Panel title="用户现在看到的" icon={LayoutList} tone="role-2" sub={`受管 ${I4_STATS.managedSections} 个 · 公开中 ${publicCount} 个`}
        explain="按 App 合同里的顺序排。卡里是现在公开的中文内容；点卡片看三种语言、历史版本和草稿。">
        {cards.length === 0
          ? <BlockState state="empty" title="没有读到信任版块" detail="后端没有返回版块，这页不补示例内容。" />
          : <div className="i4-cards">{cards.map((card) => <SectionCard key={card.key} card={card} />)}</div>}
      </Panel>

      <I4Documents />

      <Fold title="全部版本" icon={History} tone="role-3" summary={`${TRUST_SECTION_VERSIONS.length} 个版本${drafts.length ? ` · ${drafts.length} 个草稿` : ""}`}
        explain="每块的历史版本和草稿。谁批准的在「操作记录与审批」里看。">
        <Table label="全部版本" className="i4-version-table">
          <thead><tr><Th>版块</Th><Th>版本</Th><Th>状态</Th><Th>改了什么</Th><Th>最近保存（{businessZone().label}）</Th><Th sticky="end" align="right">操作</Th></tr></thead>
          <tbody>
            {TRUST_SECTION_VERSIONS.map((version) => {
              const section = TRUST_SECTIONS.find((row) => row.key === version.sectionKey);
              const live = !!section && section.v === version.version && isPublished(section.status);
              const state = versionTone(version.status, live);
              return (
                <Tr key={`${version.sectionKey}-${version.version}`} onOpen={section ? () => openSecDetail(section) : undefined}>
                  <Td><Cell main={sectionName(version.sectionKey)} sub={<LegacyText text={trustDescriptionText(version.description)} />} /></Td>
                  <Td><Cell num main={version.version} sub={`${version.fields.length} 个字段`} /></Td>
                  <Td><StatusTag tone={state.tone}>{state.text}</StatusTag></Td>
                  <Td><Cell main={changeText(version)} sub={version.structure} /></Td>
                  <Td><Cell num main={version.updatedAt ? timeText(version.updatedAt) : "—"} sub={operatorText(version.operator)} title={version.operator} /></Td>
                  <Td sticky="end" align="right">{versionActions(version)}</Td>
                </Tr>
              );
            })}
            {TRUST_SECTION_VERSIONS.length === 0 && <TableMessage columns={6}>暂无版本，请先在版块卡上点「新建草稿」。</TableMessage>}
          </tbody>
        </Table>
      </Fold>

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

      <Drawer open={!!sec} onClose={() => setSecKey(null)} icon={SECTION_INFO[sec?.key ?? ""]?.icon ?? ShieldCheck} tone="role-2"
        title={sec ? sectionName(sec.key, trustDescriptionText(sec.desc)) : "信任版块"} sub={sec ? `${sec.v} · ${isArchivedStatus(liveTrustStatus(sec)) ? "已下架" : "公开中"}` : undefined}
        nav={{ hasPrev: detailIndex > 0, hasNext: detailIndex >= 0 && detailIndex < orderedSections.length - 1, onPrev: () => setSecKey(orderedSections[detailIndex - 1].key), onNext: () => setSecKey(orderedSections[detailIndex + 1].key) }}
        footer={secFooter}>
        {sec && <>
          <JudgmentPoints rows={detailPoints} />
          {secBlanking.all && <Notice tone="neutral" title="App 公开时清空这块的文字">{secBlanking.all}</Notice>}
          <section className="rd-stack" aria-label="现在公开的内容">
            <div className="i4-detail-head"><h3>现在公开的内容 · {sec.v}</h3></div>
            <LocaleTabs label="查看语言" value={detailLang} onChange={setDetailLang} items={localeItems(secCurrent?.fields ?? [])} />
            <FieldList label={`${sectionName(sec.key)}现在公开的内容`} fields={secCurrent?.fields ?? []} lang={detailLang} blanked={secBlanking} />
          </section>
          {sec.key === "financials" && FINANCIALS_FIELDS.length > 0 && (
            <Fold inset title="财务字段" summary={`${FINANCIALS_FIELDS.length} 项 · 运营填写的说明文字`}
              explain="这些是运营写的展示文字，不是真实财务统计，页面不计算。「环比」一列后端存的是字段名称，不是环比数，原样显示。">
              <Table label="财务字段">
                <thead><tr><Th>指标</Th><Th>内容</Th><Th>环比（原样）</Th></tr></thead>
                <tbody>
                  {FINANCIALS_FIELDS.map((f) => (
                    <Tr key={f.k}>
                      <Td><Cell main={FINANCE_LABEL[f.k] ?? f.k} /></Td>
                      <Td><span data-user-content="">{nexGridBrandText(f.v)}</span></Td>
                      <Td>{f.delta ? <span data-user-content="">{f.delta}</span> : <span className="rd-weak">—</span>}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </Fold>
          )}
          <Fold inset title="版本和草稿" summary={`${secVersions.length} 个版本${draftsOf(sec.key).length ? ` · ${draftsOf(sec.key).length} 个草稿` : ""}`} defaultOpen={draftsOf(sec.key).length > 0}>
            <ul className="i4-vlist" aria-label={`${sectionName(sec.key)}的版本`}>
              {secVersions.map((version) => {
                const state = versionTone(version.status, version.version === sec.v && isPublished(sec.status));
                const stale = version.status.toLowerCase() === "draft" && !(secCurrent && version.fields.map((f) => f.key).sort().join() === secCurrent.fields.map((f) => f.key).sort().join());
                return (
                  <li key={version.version}>
                    <div className="i4-vlist-main">
                      <span className="i4-vlist-no">{version.version}</span>
                      <StatusTag tone={state.tone}>{state.text}</StatusTag>
                      {stale && <StatusTag tone="warn" explain="字段和现在公开的版本对不上，不能编辑，删掉后新建。">模板已变</StatusTag>}
                      <span className="i4-vlist-change">{changeText(version)} · {version.fields.length} 个字段</span>
                    </div>
                    <div className="i4-vlist-meta">{version.updatedAt ? timeText(version.updatedAt) : "—"} · {operatorText(version.operator)}</div>
                    <div className="i4-vlist-actions">{versionActions(version)}</div>
                  </li>
                );
              })}
            </ul>
            <p className="rd-note">时间为{businessZone().label}；谁批准的在「操作记录与审批」里看{pendingLink && <>：{pendingLink}</>}。</p>
          </Fold>
          <Fold inset title="技术信息" summary="版块标识、后台说明、修订号">
            <Facts>
              <Fact k="版块标识"><span data-mono="">{sec.key}</span></Fact>
              <Fact k="后台说明"><LegacyText text={trustDescriptionText(sec.desc)} /></Fact>
              <Fact k="内容结构">{sec.struct}</Fact>
              <Fact k="确认级">{operatorCopyText(sec.roleGate)}（只是说明，权限以账号为准）</Fact>
              <Fact k="最近改动"><span data-user-content="">{sec.lastChange || "—"}</span></Fact>
              {secCurrent && <Fact k="修订号">{secCurrent.revision}</Fact>}
            </Facts>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={!!draftEditor} onClose={() => setDraftEditor(null)} wide icon={FilePen} tone="role-2"
        title={draftEditor?.mode === "edit" ? "编辑草稿" : "新建草稿"}
        sub={draftEditor ? `${sectionName(draftEditor.sectionKey)}${draftEditor.mode === "edit" ? ` · ${draftEditor.version}` : ""}` : undefined}
        footer={draftEditor && <Decision
          note={editorMissing.length ? `还缺：${editorMissing.join("、")}` : undefined}
          others={<Button onClick={() => setDraftEditor(null)}>取消</Button>}
          primary={<Button variant="primary" data-trust-draft-editor="direct-save" onClick={saveSectionDraft}>保存草稿</Button>} />}>
        {draftEditor && <>
          <div className="i4-doc-effect"><StatusTag tone="neutral" filled explain="保存草稿直接写，不走审批；用户看到的内容不变，提交发布并批准后才公开。">不改公开内容</StatusTag></div>
          <DraftEditorBody editor={draftEditor} onChange={setDraftEditor}
            published={editorSection ? currentSectionFields(editorSection) : []} publishedVersion={editorSection?.v ?? ""}
            blanked={appBlanking(draftEditor.sectionKey, "", draftEditor.fields)} />
        </>}
      </Drawer>
    </>
  );
}
