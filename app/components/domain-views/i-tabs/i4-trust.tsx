"use client";

/**
 * I4 信任中心与风险披露(合并页) — design_handoff_i_domain/I4 信任中心与披露.html port。
 * 单源:后端 /content/trust-disclosure/overview;空库时保持空态,不补前端业务样例。
 * 操作确认 显式 edit 契约:
 *  - 调参传 edit:回滚(text/current=v)/ 发布披露新版(text/current=j.v)/ 调整受限动作范围(text/current);
 *  - 处置不传 edit:发布信任版块 / 下架信任版块。
 * amplifies 全为 false —— I4 不碰 B1(条款重签不是熔断、不动账本)。
 * 凭据 / 合规铁律:披露全链 操作员 = 风控,执行门槛 = 风控 / 超管;详情文案体现这一点。
 */
import { useState } from "react";
import { Drawer, PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";

type TrustSection = {
  key: string; desc: string; struct: string; v: string; status: string; lastChange: string; roleGate: string; highSensitivity: boolean;
};
type TrustSectionVersion = {
  sectionKey: string; version: string; description: string; structure: string;
  fields: { key: string; label: string; value: string }[];
  status: string; revision: number; operator: string; updatedAt: string;
};
type Jurisdiction = {
  code: string; name: string; countryCodes: string[]; v: string; status: string; publishedAt: string; affected: number; ackProgress: number; blocked: number;
};
const statusZh = (status?: string) => ({
  published: "已发布", draft: "草稿", archived: "已归档", superseded: "已取代",
  PUBLISHED: "已发布", DRAFT: "草稿", ARCHIVED: "已归档", SUPERSEDED: "已取代",
} as Record<string, string>)[status ?? ""] ?? status ?? "—";
type GateAction = { key: string; name: string; sub: string; st: string; tone: string; active: boolean };
type TrustDetailKey = string;

export function I4Trust({ ctx }: { ctx: ICtx }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const propose = usePropose();
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canManageTrust = isSuperadmin || !!session?.authorities.includes("content_i4_trust_section_manage");
  const canDraftDisclosure = isSuperadmin || !!session?.authorities.includes("content_i4_write");
  const canPublishDisclosure = isSuperadmin || !!session?.authorities.includes("content_i4_disclosure_publish");
  const canAdjustGate = isSuperadmin || !!session?.authorities.includes("content_i4_gate_adjust");
  const [secKey, setSecKey] = useState<TrustDetailKey | null>(null);
  const [jurCode, setJurCode] = useState<string | null>(null);
  const [chapNo, setChapNo] = useState<string | null>(null);
  const data = content.trustDisclosure;
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
  const activeChapter = DISCLOSURE_CHAPTERS.find((c) => c.jurisdiction === activeJurisdictionCode) ?? DISCLOSURE_CHAPTERS[0];
  const CHAPTER_BODY_ZH = activeChapter?.zhBody ?? "";
  const CHAPTER_BODY_VI = activeChapter?.viBody ?? "";
  const CHAPTER_BODY_EN = activeChapter?.enBody ?? "";
  const jurisdictionOptions = JURISDICTIONS.map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const disclosureVersions = data?.disclosureVersions ?? [];
  const countryOptions = (data?.countryOptions ?? []).map((item) => ({ value: item.code, label: `${item.code} · ${item.name}` }));
  const sectionVersionOptions = (sectionKey: string, currentVersion: string) => TRUST_SECTION_VERSIONS
    .filter((row) => row.sectionKey === sectionKey && ["published", "superseded", "PUBLISHED", "SUPERSEDED"].includes(row.status) && row.version !== currentVersion)
    .map((row) => row.version);
  const chaptersFor = (jurisdiction: string, version?: string) => {
    const exact = DISCLOSURE_CHAPTERS.filter((chapter) => chapter.jurisdiction === jurisdiction && (!version || chapter.version === version));
    if (exact.length) return exact;
    const publishedVersion = JURISDICTIONS.find((row) => row.code === jurisdiction)?.v;
    return DISCLOSURE_CHAPTERS.filter((chapter) => chapter.jurisdiction === jurisdiction && (!publishedVersion || chapter.version === publishedVersion));
  };
  const chapterPayload = (form: Record<string, string> | undefined, jurisdiction: string, version: string) => chaptersFor(jurisdiction, version).map((chapter, index) => ({
    no: form?.[`chapter.${index}.no`] || chapter.no,
    zhTitle: form?.[`chapter.${index}.zhTitle`] || chapter.zh,
    viTitle: form?.[`chapter.${index}.viTitle`] || chapter.vi,
    enTitle: form?.[`chapter.${index}.enTitle`] || chapter.en,
    zhBody: form?.[`chapter.${index}.zhBody`] || chapter.zhBody,
    viBody: form?.[`chapter.${index}.viBody`] || chapter.viBody,
    enBody: form?.[`chapter.${index}.enBody`] || chapter.enBody,
  }));
  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  const liveTrustStatus = (s: TrustSection): string => s.status;
  const liveJurVersion = (j: Jurisdiction): string => j.v;
  const gateOn = (k: string): boolean => GATED_ACTIONS.find((g) => g.key === k)?.active ?? false;
  const disclosureDraft = data?.draft;

  const openSecDetail = (s: TrustSection) => setSecKey(s.key);
  const openJurDetail = (j: Jurisdiction) => setJurCode(j.code);
  const openChap = (no: string) => setChapNo(no);

  // ---------- I4 信任版块动作 ----------
  const sectionFieldsFromForm = (form?: Record<string, string>) => Array.from(
    { length: Math.max(0, Number(form?.fieldCount || 0)) },
    (_, index) => ({
      key: form?.[`field.${index}.key`]?.trim() || "",
      label: form?.[`field.${index}.label`]?.trim() || "",
      value: form?.[`field.${index}.value`]?.trim() || "",
    }),
  );

  const createSectionDraft = (s: TrustSection) => openActionConfirm({
    action: <>新建信任版块草稿 · {s.key}</>,
    detail: <>版本号与结构化字段全部保存到后端；草稿不会自动影响当前线上版。</>,
    amplifies: false,
    businessForm: {
      kind: "trust-section-authoring",
      mode: "create",
      sectionKey: s.key,
      description: s.desc,
      structure: s.struct,
      fields: (SECTION_FIELDS[s.key] ?? []).map(([key, value]) => ({ key, label: key, value })),
    },
    run: (reason, _value, form) => runBackend(actions.createI4TrustSectionDraft(s.key, {
      version: form?.version || "",
      description: form?.description || "",
      structure: form?.structure || "",
      fields: sectionFieldsFromForm(form),
    }, reason), `${s.key} 草稿已创建`),
  });

  const editSectionDraft = (draft: TrustSectionVersion) => openActionConfirm({
    action: <>编辑信任版块草稿 · {draft.sectionKey} {draft.version}</>,
    detail: <>仅草稿可编辑；保存时携带修订号，避免覆盖他人的并发修改。</>,
    amplifies: false,
    businessForm: {
      kind: "trust-section-authoring",
      mode: "edit",
      sectionKey: draft.sectionKey,
      version: draft.version,
      description: draft.description,
      structure: draft.structure,
      revision: draft.revision,
      fields: draft.fields,
    },
    run: (reason, _value, form) => runBackend(actions.updateI4TrustSectionDraft(draft.sectionKey, draft.version, {
      version: draft.version,
      description: form?.description || "",
      structure: form?.structure || "",
      fields: sectionFieldsFromForm(form),
      expectedRevision: draft.revision,
    }, reason), `${draft.sectionKey} ${draft.version} 草稿已更新`),
  });

  const deleteSectionDraft = (draft: TrustSectionVersion) => openActionConfirm({
    action: <>删除信任版块草稿 · {draft.sectionKey} {draft.version}</>,
    detail: <>仅删除尚未发布的草稿；线上版与历史已发布快照不受影响。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI4TrustSectionDraft(draft.sectionKey, draft.version, reason), `${draft.sectionKey} ${draft.version} 草稿已删除`),
  });

  const pubSection = (s: TrustSection, draft: TrustSectionVersion) =>
    openActionConfirm({
      action: <>发布信任版块 · {s.key} {draft.version}</>,
      detail: (
        <>
          对外信任内容上线,发布后 /trust 页即时换新。<b>执行门槛:{s.roleGate}</b>
          {s.highSensitivity && "(对外财务/代币叙事是高敏合规面,内容角色无权放行)"}。审计必须带「数据来源」与「对外披露(非内部账本)」标注;带防重号。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        const def = findHighOp("i4_trust_section_manage")!;
        void propose(toast, {
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
          command: def.buildCommand({ sectionKey: s.key, action: "publish", version: draft.version }),
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
      edit: { kind: "select", current: sectionVersionOptions(s.key, s.v)[0] ?? "", options: sectionVersionOptions(s.key, s.v) },
      run: (reason, nv) => {
        if (!nv) return;
        const def = findHighOp("i4_trust_section_manage")!;
        void propose(toast, {
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
          command: def.buildCommand({ sectionKey: s.key, action: "rollback", targetVersion: nv }),
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
      run: (reason) => {
        const def = findHighOp("i4_trust_section_manage")!;
        void propose(toast, {
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
          command: def.buildCommand({ sectionKey: s.key, action: "archive" }),
          target: def.buildTarget({ sectionKey: s.key }),
        });
      },
    });

  // ---------- I4 披露动作 ----------
  const draftDisclosure = () =>
    openActionConfirm({
      action: <>草拟披露新版 · 风控提交</>,
      detail: (
        <>
          披露正文按中文、越南语必填，英语可选维护(占位符一致)。草稿不生效;发布走「执行门槛:风控/超管」操作确认并触发该法域重确认。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "version-authoring",
        version: disclosureDraft?.version ?? "",
        jurisdiction: disclosureDraft?.jurisdiction ?? activeJurisdictionCode,
        zh: CHAPTER_BODY_ZH,
        vi: CHAPTER_BODY_VI,
        en: CHAPTER_BODY_EN,
        chapters: chaptersFor(disclosureDraft?.jurisdiction ?? activeJurisdictionCode, disclosureDraft?.version),
        jurisdictionOptions,
        versionOptions: disclosureVersions,
        languageScopes: data?.languageScopes,
        effectiveDate: disclosureDraft?.effectiveDate,
        requiresReack: disclosureDraft?.requiresReack,
      },
      run: (reason, _v, form) => {
        const version = form?.version?.trim() || disclosureDraft?.version?.trim() || "";
        const jurisdiction = form?.jurisdiction?.trim() || disclosureDraft?.jurisdiction?.trim() || activeJurisdictionCode;
        const zh = form?.zh?.trim() || CHAPTER_BODY_ZH;
        const vi = form?.vi?.trim() || CHAPTER_BODY_VI;
        const en = form?.en?.trim() || CHAPTER_BODY_EN;
        if (!version || !jurisdiction || !zh || !vi) {
          toast("缺少后端披露版本/法域/正文,无法提交草稿");
          return;
        }
        runBackend(actions.saveI4DisclosureDraft(jurisdiction, {
          version,
          jurisdiction,
          languageScope: form?.languageScope || disclosureDraft?.languageScope || "",
          effectiveDate: form?.effectiveDate || disclosureDraft?.effectiveDate || "",
          requiresReack: form?.requiresReack ?? true,
          zh,
          vi,
          en,
          chapters: chapterPayload(form, jurisdiction, version),
        }, reason), "披露草稿已存 · 发布需风控操作确认");
      },
    });

  const configMatrix = (current?: Jurisdiction) =>
    openActionConfirm({
      action: <>{current ? "编辑" : "新增"}法域 × 版本映射</>,
      detail: (
        <>
          增法域、改某法域的生效版本映射都在这里;版本号只增不减。改映射等同给该法域换生效条款,会触发重确认;<b>发起人限风控,执行门槛 = 风控 / 超管</b>。
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
        versionOptions: disclosureVersions,
      },
      run: (reason, _v, form) => {
        const jurisdictionCode = form?.jurisdictionCode?.trim().toUpperCase() || "";
        if (!jurisdictionCode) return;
        runBackend(actions.configureI4Matrix(jurisdictionCode, {
          jurisdictionCode,
          jurisdictionName: form?.jurisdictionName || "",
          countryCodes: (form?.countryCodes || "").split(",").map((code) => code.trim()).filter(Boolean),
          version: form?.version || "",
          status: "draft",
        }, reason), "法域版本映射已保存到后端");
      },
    });

  const archiveMatrix = (j: Jurisdiction) => openActionConfirm({
    action: <>归档法域版本映射 · {j.code}</>,
    detail: <>归档后保留历史版本与审计记录，不再作为有效披露映射。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.archiveI4Matrix(j.code, reason), `${j.code} 映射已归档`),
  });

  const publishDisclosure = (j: Jurisdiction) =>
    openActionConfirm({
      action: <>发布已存披露草稿 · {j.code}</>,
      detail: (
        <>
          <b>合规关键动作</b>:发布只读取服务器已经保存的草稿与固定 7 章快照，不接受确认框临时改正文。发布后 {j.code} 适用国家/地区用户的确认状态转为过期，受限动作在重确认前由服务器拦截。<b>执行门槛 = 风控 / 超管</b>。
        </>
      ),
      amplifies: false,
      edit: { kind: "select", current: disclosureDraft?.jurisdiction === j.code ? disclosureDraft.version : "", options: disclosureDraft?.jurisdiction === j.code ? [disclosureDraft.version] : [] },
      run: (reason, v) => {
        if (!v) return;
        const def = findHighOp("i4_disclosure_publish")!;
        const version = v;
        const jurisdiction = j.code;
        void propose(toast, {
          action: `发布披露新版 · ${j.code}`,
          obj: j.code,
          before: liveJurVersion(j),
          after: version,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I5",
          command: def.buildCommand({ jurisdiction, version }),
          target: def.buildTarget({ jurisdiction }),
        });
      },
    });

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
        const def = findHighOp("i4_gate_adjust")!;
        void propose(toast, {
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
          command: def.buildCommand({ scope: nextScope }),
          target: def.buildTarget({}),
        });
      },
    });
  };

  // 抽屉数据。
  const sec = secKey ? TRUST_SECTIONS.find((s) => s.key === secKey) ?? null : null;
  const jur = jurCode ? JURISDICTIONS.find((j) => j.code === jurCode) ?? null : null;
  const chap = chapNo ? DISCLOSURE_CHAPTERS.find((c) => c.no === chapNo) ?? null : null;
  const sectionExternalLink = sec
    ? (SECTION_FIELDS[sec.key] ?? []).find(([key]) => /(^|[._-])(url|link|href)($|[._-])/i.test(key))?.[1] ?? ""
    : "";

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">I4 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">I4 暂无真实接口数据</div></div></section>;
  }

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管信任版块</div>
          <div className="v">{I4_STATS.managedSections} 个</div>
          <div className="sub">财务数字/团队/叙事/徽章/审计/外链</div>
        </div>
        <div className="f-stat cyan">
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
        </div>
      </div>

      {/* (I4 · a) 信任中心 6 版块 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">信任中心(I4 · a)· /trust</span>
          <span className="sub">· 6 版块 · 财务数字/团队/叙事/徽章/审计/外链</span>
          <div className="r">
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
                      {s.highSensitivity ? (
                        <span className="bdg warn">{s.roleGate}</span>
                      ) : (
                        <span className="bdg dim">{s.roleGate}</span>
                      )}
                    </td>
                    <td>
                      {isArchived ? (
                        <span className="bdg dim">已下架</span>
                      ) : (
                        <span className="bdg ok">已发布</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{s.lastChange}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canManageTrust && <><button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); createSectionDraft(s); }}>新建草稿</button>{" "}
                      <button className="l-btn sm" disabled={sectionVersionOptions(s.key, s.v).length === 0} onClick={(e) => { e.stopPropagation(); rollbackSection(s); }}>回滚历史版</button></>}
                      {canManageTrust && !isArchived && (
                        <>
                          {" "}
                          <button className="l-btn sm mc" onClick={(e) => { e.stopPropagation(); archiveSection(s); }}>下架</button>
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
                return <tr key={`${version.sectionKey}-${version.version}`}>
                  <td className="mono">{version.sectionKey}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{version.version}</td>
                  <td>{version.description}</td>
                  <td>{version.structure}</td>
                  <td className="num">{version.fields.length}</td>
                  <td><span className={`bdg ${isDraft ? "warn" : "ok"}`}>{statusZh(version.status)}</span></td>
                  <td className="mono">{version.updatedAt || "—"}</td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    {canManageTrust && isDraft && <>
                      <button className="l-btn sm" onClick={() => editSectionDraft(version)}>编辑草稿</button>{" "}
                      <button className="l-btn sm mc" disabled={!section} onClick={() => section && pubSection(section, version)}>发布草稿</button>{" "}
                      <button className="l-btn sm danger" onClick={() => deleteSectionDraft(version)}>删除草稿</button>
                    </>}
                    {(!canManageTrust || !isDraft) && <span className="tiny">只读{isDraft ? "（无编辑权限）" : "历史快照"}</span>}
                  </td>
                </tr>;
              })}
              {TRUST_SECTION_VERSIONS.length === 0 && <tr><td colSpan={8}><div className="itint">暂无后端版本快照，请先从版块行点击“新建草稿”。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* I4 披露版本 × 法域矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">披露矩阵(I4 · 披露)· version × jurisdiction</span>
          <span className="sub">· 风控提交 · 风控 / 超管执行</span>
          <div className="r">
            <span className="icode danger">合规关键 · 风控确认</span>
            {canDraftDisclosure && <button className="l-btn sm mc" onClick={draftDisclosure}>草拟新版</button>}
            {canDraftDisclosure && <button className="l-btn sm" onClick={() => configMatrix()}>新增映射</button>}
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
                return (
                  <tr key={j.code} className="click" onClick={() => openJurDetail(j)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{j.code}</span>
                      <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{j.name}</div>
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
                      {canDraftDisclosure && j.status.toLowerCase() === "draft" && <><button className="l-btn sm" onClick={(e) => { e.stopPropagation(); configMatrix(j); }}>编辑草稿映射</button>{" "}</>}
                      {canPublishDisclosure && <><button className="l-btn sm mc" disabled={disclosureDraft?.jurisdiction !== j.code} onClick={(e) => { e.stopPropagation(); publishDisclosure(j); }}>发布已存草稿</button>{" "}</>}
                      {canDraftDisclosure && j.status.toLowerCase() !== "archived" && (
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
          <span className="ttl">披露版本列表(I5)· {activeJurisdiction ? `${activeJurisdiction.code} ${activeJurisdiction.v}` : "暂无后端法域"}</span>
          <span className="sub">· 中文、越南语必备，英语可选 · 占位符一致</span>
        </div>
        <div className="l-b" style={{ paddingTop: 4 }}>
          {DISCLOSURE_CHAPTERS.map((c) => (
            <div className="tr-vrow" key={c.no}>
              <span className="nm">
                <span className="mono" style={{ color: "var(--ink-4)", marginRight: 8 }}>{c.no}</span>
                <b style={{ fontWeight: 600, color: "var(--ink-2)" }}>{c.zh}</b>
                <small style={{ marginLeft: 26, color: "var(--ink-4)" }}>{c.vi || c.en}</small>
              </span>
              <button className="l-btn sm" onClick={() => openChap(c.no)}>查看</button>
            </div>
          ))}
        </div>
      </section>

      {/* I4 re-ack 覆盖监控 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">重确认覆盖监控(I4 · 披露)</span>
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
                <th>进度</th>
                <th className="num">拦截数</th>
              </tr>
            </thead>
            <tbody>
              {JURISDICTIONS.map((j) => {
                const acked = Math.round((j.affected * j.ackProgress) / 100);
                return (
                  <tr key={j.code}>
                    <td>
                      <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{j.code}</span>
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>{liveJurVersion(j)}</td>
                    <td className="num mono">{j.affected.toLocaleString("en-US")}</td>
                    <td className="num mono">{acked.toLocaleString("en-US")}</td>
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

      {/* I4 受限动作范围 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">受限动作范围(I4 · 披露)</span>
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

      <p className="f-foot">
        <b>执行门槛(两套,别混)</b>:信任中心(I4)= 内容执行门槛:一般版块内容角色,<b>财务数字 / NEX 叙事 / 对外合规声明类必须合规或超管执行</b>(财务角色对数字口径有知情确认职能,但仅为知情职能);风险披露(I4)= <b>风控执行门槛:风控 / 超管</b>,内容角色只能草拟、不能提交——条款是合规命脉,不给内容角色单独放行的口子。<b>事件去向</b>:版块曝光喂 BI(信任→转化间接归因);披露确认 / 重确认触发 / 拦截三类事件喂合规覆盖看板(L 域)和风控(K 域,拦截数是闸有效性信号)。披露类事件的归类登记(disclosure 域)是 BI 上线前必办工单,占位期按临时编号入库
        <span title="§2.4.3 domain 枚举扩展 · V4 内容批次 · blocking">。</span>
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "信任中心(I4 · a)· /trust",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "信任中心固定六版块,需同屏核对版本与状态",
          },
          {
            label: "披露矩阵(I4 · 披露)· version × jurisdiction",
            maxRows: Math.max(JURISDICTIONS.length, 1),
            reason: "披露矩阵法域来自后端配置,发布关系需同屏对比",
          },
          {
            label: "重确认覆盖监控(I4 · 披露)",
            maxRows: Math.max(JURISDICTIONS.length, 1),
            reason: "重确认监控法域来自后端配置,完整 ack 事件进 BI",
          },
        ]}
      />

      {/* 版块详情 Drawer */}
      {sec && (
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
      {jur && (
        <Drawer
          title={`法域 · ${jur.code}(${jur.name})`}
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
      {chap && (
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
