"use client";

/**
 * I1 转化文案 A/B — design_handoff_i_domain/I1 转化文案AB.html port。
 * 单源:后端 /content/copy-ab/overview;空库时以后端初始化结果为准。
 * 操作确认 显式 edit 契约:编辑文案 / 回滚到历史版 / 调整框架参数 = 调参传 edit;
 *   下架 / 停止实验 / 采纳获胜变体 = 处置不传 edit。
 * amplifies = false(I1 不碰 B1 红线 —— 只改措辞,不动费率/奖励/价格)。
 * 框架参数 = 运营设定(仍需操作确认 + 必填原因留痕)→ 走 openConfirm + input(ConfirmReq.input 已支持)。
 */
import { useRef, useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { ICtx } from "./types";

const COPY_MODULES = ["home", "store", "earn", "me"] as const;
type CopyModule = (typeof COPY_MODULES)[number];
type Surf = "all" | CopyModule;
type ExpFlt = "all" | "running" | "concluded";
type VersionStatusFlt = "all" | "draft" | "published" | "archived";
type CopyRow = {
  key: string; desc: string; surface: string;
  version: string; status: string; i18nKey: string; expId: string; lastChange: string;
  draftVersion?: string; draftZh?: string; draftEn?: string; draftVi?: string; copyPosition?: string; draftCopyPosition?: string; draftSurface?: string; draftAudience?: string; draftAudienceTarget?: AudienceTarget; draftTrafficSplit?: string; draftNote?: string;
  revision?: number;
};
type AudienceTarget = { locales?: string[]; tiers?: string[]; registrationDaysMin?: number | null; registrationDaysMax?: number | null };
type VersionRow = {
  copyKey: string; v: string; st: string; chain: string; ts: string;
  zh: string; en: string; vi: string; copyPosition?: string; surface: string;
  audience: string; audienceTarget?: AudienceTarget; trafficSplit: string; versionNote: string;
};
type ExpRow = {
  id: string; copyKey: string; variants: [name: string, split: number, cvr: number][];
  audience: string; estimatedAudience?: number; impressions: string; conversions: string; state: string; note: string;
};

const COPY_MODULE_LABELS: Record<CopyModule, string> = { home: "首页", store: "商城", earn: "赚取", me: "我的" };
const COPY_MODULE_OPTIONS = COPY_MODULES.map((value) => ({ value, label: COPY_MODULE_LABELS[value] }));
const LEGACY_MODULES: Record<string, CopyModule> = { Home: "home", Store: "store", Earn: "earn", Me: "me", 商城: "store" };
const SURF_FLT: [Surf, string][] = [["all", "全部"], ...COPY_MODULES.map((value) => [value, COPY_MODULE_LABELS[value]] as [Surf, string])];
const EXP_FLT: [ExpFlt, string][] = [["all", "全部"], ["running", "进行中"], ["concluded", "已结"]];
const VERSION_PAGE_SIZE = 20;

const VAR_COLORS = ["var(--i-ac)", "var(--admin-cat-5)", "var(--admin-cat-3)"];

function normalizeCopyModule(value?: string): string {
  const raw = value?.trim() ?? "";
  return LEGACY_MODULES[raw] ?? raw.toLowerCase();
}

function composeAudience(form?: Record<string, string>): string {
  const phaseMin = form?.phaseMin || "P1";
  const phaseMax = form?.phaseMax || "P3";
  const phase = phaseMin === phaseMax ? phaseMin : `${phaseMin}-${phaseMax}`;
  const language = !form?.language || form.language === "all" ? "全语言" : form.language;
  const days = Math.max(0, Number(form?.registrationDaysGt || 0));
  return `${phase} · ${language} · 注册>${days}天`;
}

function composeAudienceTarget(form?: Record<string, string>) {
  const phaseMin = form?.phaseMin || "P1";
  const phaseMax = form?.phaseMax || "P3";
  const language = form?.language || "all";
  const registrationDaysGt = Number(form?.registrationDaysGt || 0);
  const start = Number(phaseMin.replace("P", ""));
  const end = Number(phaseMax.replace("P", ""));
  return {
    mode: "structured",
    tiers: Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => `P${start + index}`),
    locales: language === "all" ? [] : [language],
    registrationDaysMin: registrationDaysGt + 1,
    registrationDaysMax: null,
  };
}

function audienceTargetFields(target?: AudienceTarget) {
  if (!target) return {};
  const tiers = (target.tiers ?? []).map((tier) => Number(tier.replace(/^P/i, ""))).filter(Number.isFinite).sort((a, b) => a - b);
  return {
    phaseMin: tiers.length ? `P${tiers[0]}` : "P1",
    phaseMax: tiers.length ? `P${tiers[tiers.length - 1]}` : "P6",
    language: target.locales?.[0] ?? "all",
    registrationDaysGt: String(Math.max(0, (target.registrationDaysMin ?? 1) - 1)),
  };
}

export function I1CopyAb({ ctx }: { ctx: ICtx }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWrite = isSuperadmin || !!session?.authorities.includes("content_i1_write");
  const canCreateCopy = isSuperadmin || !!session?.authorities.includes("content_i1_copy_create");
  const [surf, setSurf] = useState<Surf>("all");
  const [expFlt, setExpFlt] = useState<ExpFlt>("all");
  const [versionCopyFlt, setVersionCopyFlt] = useState("all");
  const [versionStatusFlt, setVersionStatusFlt] = useState<VersionStatusFlt>("all");
  const [versionPage, setVersionPage] = useState(1);
  const [deletingDraftKey, setDeletingDraftKey] = useState<string | null>(null);
  const deleteInFlightRef = useRef(false);
  const data = content.copyAb;
  const I1_STATS = data?.stats ?? { managedCopies: 0, runningExps: 0, weeklyExposures: "—", topLift: "—" };
  const COPY_POOL: CopyRow[] = (data?.copies ?? []).map((row) => ({
    key: row.key,
    desc: row.desc,
    surface: normalizeCopyModule(row.surface),
    version: row.version,
    status: row.status,
    i18nKey: row.i18nKey,
    expId: row.expId,
    lastChange: row.lastChange,
    draftVersion: row.draftVersion,
    draftZh: row.draftZh,
    draftEn: row.draftEn,
    draftVi: row.draftVi,
    copyPosition: row.copyPosition,
    draftCopyPosition: row.draftCopyPosition,
    draftSurface: row.draftSurface ? normalizeCopyModule(row.draftSurface) : undefined,
    draftAudience: row.draftAudience,
    draftAudienceTarget: row.draftAudienceTarget,
    draftTrafficSplit: row.draftTrafficSplit,
    draftNote: row.draftNote,
    revision: row.revision,
  }));
  const COPY_VERSIONS: VersionRow[] = (data?.versions ?? []).map((row) => ({
    copyKey: row.copyKey,
    v: row.version,
    st: row.status,
    chain: row.chain,
    ts: row.ts,
    zh: row.zh,
    en: row.en,
    vi: row.vi,
    copyPosition: row.copyPosition,
    surface: normalizeCopyModule(row.surface),
    audience: row.audience,
    audienceTarget: row.audienceTarget,
    trafficSplit: row.trafficSplit,
    versionNote: row.versionNote,
  }));
  const EXP_FRAMEWORK = (data?.frameworkParams ?? []).map((row) => ({
    key: row.key,
    name: row.name,
    cur: row.current,
    sub: row.description,
  }));
  const EXPS: ExpRow[] = (data?.experiments ?? []).map((row) => ({
    id: row.id,
    copyKey: row.copyKey,
    variants: row.variants.map((v) => [v.name, v.split, Number(v.cvr)]),
    audience: row.audience,
    estimatedAudience: row.estimatedAudience,
    impressions: row.impressions,
    conversions: row.conversions,
    state: row.state,
    note: row.note,
  }));
  const COPY_TRAFFIC_SPLITS = Array.from(new Set([
    ...(data?.trafficSplits ?? []),
    ...COPY_POOL.map((c) => c.draftTrafficSplit),
    ...COPY_VERSIONS.map((v) => v.trafficSplit),
  ].filter((item): item is string => !!item?.trim())));
  const COPY_POSITION_ROWS = data?.positions ?? [];
  const COPY_POSITIONS = COPY_POSITION_ROWS.map((position) => ({
    value: position.positionKey,
    label: `${position.name} · ${position.positionKey}`,
    surface: normalizeCopyModule(position.surface),
    status: position.status,
  })).filter((position) => position.status.toUpperCase() === "ACTIVE");
  const COPY_POSITION_OPTIONS = COPY_POSITIONS;

  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  const liveCopyStatus = (c: CopyRow): string => c.status;
  const liveExpState = (e: ExpRow): string => e.state;
  const liveFw = (_key: string, cur: string): string => cur;

  const filteredPool = COPY_POOL.filter((c) => surf === "all" || c.surface === surf);
  const filteredVersions = COPY_VERSIONS.filter((row) =>
    (versionCopyFlt === "all" || row.copyKey === versionCopyFlt)
    && (versionStatusFlt === "all" || row.st.toLowerCase() === versionStatusFlt));
  const versionPages = Math.max(1, Math.ceil(filteredVersions.length / VERSION_PAGE_SIZE));
  const safeVersionPage = Math.min(versionPage, versionPages);
  const pagedVersions = filteredVersions.slice((safeVersionPage - 1) * VERSION_PAGE_SIZE, safeVersionPage * VERSION_PAGE_SIZE);
  const filteredExps = EXPS.filter((e) => {
    if (expFlt === "all") return true;
    const st = liveExpState(e);
    if (expFlt === "running") return st === "running";
    return st === "adopted" || st === "discarded" || st === "stopped";
  });

  // 编辑文案(文案池每行通用) —— 默认存草稿,运营也可明确选择发布生效。
  const editCopy = (c: CopyRow, targetVersion?: VersionRow, forceNew = false) => {
    const editableVersion = targetVersion
      ?? COPY_VERSIONS.find((row) => row.copyKey === c.key && row.v === c.draftVersion)
      ?? COPY_VERSIONS.find((row) => row.copyKey === c.key && row.v === c.version);
    const editingExistingDraft = !forceNew && editableVersion?.st.toLowerCase() === "draft";
    openActionConfirm({
      action: <>{forceNew ? "新增版本" : "编辑文案"} · {c.key}</>,
      detail: <>基于 <b>{editableVersion?.v || c.version}</b> 编辑。{editingExistingDraft ? "保存会更新这个草稿。" : "目标版本号由服务器按历史版本自动生成。"}只有明确选择“发布生效”才会对用户生效。</>,
      amplifies: false,
      businessForm: {
        kind: "copy-edit",
        keyName: c.key,
        version: editingExistingDraft ? editableVersion?.v || "" : "",
        surface: editableVersion?.surface || c.surface,
        copyPosition: editableVersion?.copyPosition || c.copyPosition,
        audience: editableVersion?.audience,
        ...audienceTargetFields(editableVersion?.audienceTarget),
        trafficSplit: editableVersion?.trafficSplit,
        trafficSplits: COPY_TRAFFIC_SPLITS,
        modules: COPY_MODULE_OPTIONS,
        positions: COPY_POSITION_OPTIONS,
        zh: editableVersion?.zh || "",
        en: editableVersion?.en || "",
        vi: editableVersion?.vi || "",
        versionNote: editableVersion?.versionNote || "后台编辑文案",
        saveModeChoice: true,
      },
      run: (reason, _value, form) => {
        const payload = {
          version: form?.version || undefined,
          surface: form?.surface || editableVersion?.surface || c.surface,
          copyPosition: form?.copyPosition || editableVersion?.copyPosition || c.copyPosition || "",
          audience: composeAudience(form),
          audienceTarget: composeAudienceTarget(form),
          phaseMin: form?.phaseMin,
          phaseMax: form?.phaseMax,
          language: form?.language,
          registrationDaysGt: Number(form?.registrationDaysGt || 0),
          trafficSplit: form?.trafficSplit || editableVersion?.trafficSplit || COPY_TRAFFIC_SPLITS[0] || "",
          versionNote: form?.versionNote || "后台编辑文案",
          zh: form?.zh || editableVersion?.zh || "",
          en: form?.en || editableVersion?.en || "",
          vi: form?.vi || editableVersion?.vi || "",
        };
        if (form?.saveMode === "存草稿") {
          runBackend(actions.saveI1CopyDraft(c.key, payload, reason), `${c.key} 草稿已保存 · 尚未对用户生效`);
        } else {
          runBackend(actions.publishI1CopyVersion(c.key, payload, reason), `${c.key} 新版本已发布生效`);
        }
      },
    });
  };

  const createCopy = () => openActionConfirm({
    action: <>新增文案</>,
    detail: <>在文案池中新建一条受管文案。提交后会创建首个版本并发布生效，首版版本号由服务器自动生成，文案标识必须全局唯一。</>,
    amplifies: false,
    businessForm: {
      kind: "copy-create",
      modules: COPY_MODULE_OPTIONS,
      positions: COPY_POSITIONS,
      trafficSplits: COPY_TRAFFIC_SPLITS,
    },
    run: (reason, _value, form) => {
      if (!form?.copyKey?.trim()) return;
      const copyKey = form.copyKey.trim();
      runBackend(actions.createI1Copy({
        copyKey,
        description: form.description?.trim() || copyKey,
        surface: form.surface || "home",
        copyPosition: form.copyPosition || "",
        i18nKey: copyKey,
        audience: composeAudience(form),
        audienceTarget: composeAudienceTarget(form),
        phaseMin: form?.phaseMin,
        phaseMax: form?.phaseMax,
        language: form?.language,
        registrationDaysGt: Number(form?.registrationDaysGt || 0),
        trafficSplit: form.trafficSplit || COPY_TRAFFIC_SPLITS[0] || "50",
        versionNote: form.versionNote || "新增文案首版",
        zh: form.zh || "",
        en: form.en || "",
        vi: form.vi || "",
      }, reason), `文案 ${copyKey} 已新增 · 首版已发布`);
    },
  });

  const createCopyPosition = () => openActionConfirm({
    action: <>新增文案位置</>,
    detail: <>新增可复用的文案位置。位置标识全局唯一，并固定绑定一个 App 顶级模块。</>,
    amplifies: false,
    businessForm: { kind: "copy-position-create", modules: COPY_MODULE_OPTIONS },
    run: (reason, _value, form) => {
      if (!form?.positionKey?.trim()) return;
      runBackend(actions.createI1CopyPosition({
        positionKey: form.positionKey.trim(),
        name: form.positionName?.trim() || form.positionKey.trim(),
        surface: form.surface || "home",
        sortOrder: 0,
      }, reason), `文案位置 ${form.positionKey.trim()} 已新增`);
    },
  });

  const deleteCopyPosition = (positionKey: string) => openActionConfirm({
    action: <>删除文案位置 · {positionKey}</>,
    detail: <>仅未被任何文案版本引用的位置可删除；后端会执行引用完整性校验。</>,
    amplifies: false,
    run: (reason) => runBackend(actions.deleteI1CopyPosition(positionKey, reason), `文案位置 ${positionKey} 已删除`),
  });

  const rollbackTo = (copyKey: string, v: string) => openActionConfirm({
    action: <>回滚 · {copyKey} → 重新发布 {v}</>,
    detail: <>回滚 = 把历史版 <b>{v}</b> 重新发布,效果和发新版完全一样(对全体用户生效),所以同样走操作确认。仅完整满足中英越、受众和位置契约的归档版允许恢复。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.rollbackI1CopyVersion(copyKey, v, reason), `${copyKey} 已回滚到 ${v}`);
    },
  });

  const archiveCurrentVersion = (copyKey: string, version: string) => openActionConfirm({
    action: <>下架当前发布版 · {copyKey} {version}</>,
    detail: <>下架后该文案位<b>没有生效版本</b>,App 端会退回内置兜底文案——一般只在文案出合规问题时才这么做;常规换版直接发新版即可。下架立即生效。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.archiveI1Copy(copyKey, version, reason), `${copyKey} ${version} 已下架`);
    },
  });

  const deleteDraftVersion = (copyKey: string, version: string, revision: number) => openActionConfirm({
    action: <>删除草稿 · {copyKey} {version}</>,
    detail: <>只有草稿版本可以删除；删除后不可恢复，但操作理由和删除结果会保留审计。已发布或已归档版本必须保留完整历史，不能物理删除。</>,
    amplifies: false,
    run: (reason) => {
      const mutationKey = `${copyKey}:${version}`;
      if (deleteInFlightRef.current) return;
      deleteInFlightRef.current = true;
      setDeletingDraftKey(mutationKey);
      actions.deleteI1CopyDraft(copyKey, version, revision, reason)
        .then(() => actions.reloadIContent())
        .then(() => toast(`${copyKey} ${version} 草稿已删除`))
        .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          deleteInFlightRef.current = false;
          setDeletingDraftKey(null);
        });
    },
  });

  const adjustFramework = (key: string, name: string, cur: string) => openConfirm({
    action: <>实验框架参数 · {name}</>,
    detail: <>当前默认:<b>{cur}</b> · 只影响<b>之后新建</b>的实验的默认值;已启动实验按启动时锁定的快照跑,不回溯。</>,
    chips: [["运营设定 · 仍需操作确认", "done"], ["改动留审计记录", "ready"]],
    input: { label: "新默认值", placeholder: cur },
    reason: true,
    okLabel: "保存",
    run: (reason, v) => {
      if (!v) return;
      runBackend(actions.updateI1Framework(key, v, reason), `${name} 默认值已更新为 ${v} · 留审计`);
    },
  });

  const stopExp = (id: string) => openActionConfirm({
    action: <>停止实验 · {id}</>,
    detail: <>停止后<b>全部用户回到当前发布版</b>,实验转已结(可再选择采纳或弃用)。停止会改变用户所见文案分布,所以要操作确认。已收集的曝光/转化数据保留,结算页可查。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.stopI1Experiment(id, reason), `${id} 停止已确认生效`);
    },
  });

  const adoptExp = (id: string) => openActionConfirm({
    action: <>采纳获胜变体 · {id}</>,
    detail: <>把获胜变体<b>采纳为该文案位的发布版</b>——这等价于一次正式发布(对全体用户生效),审计会记采纳来源实验号。采纳前确认:数据量达标、提升显著。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.adoptI1Experiment(id, reason), `${id} 获胜变体采纳已确认生效`);
    },
  });

  const renderCopyStatus = (c: CopyRow) => {
    const st = liveCopyStatus(c);
    // 已发布 → ok;已归档/下架 → dim。
    if (st.includes("archived")) return <span className="bdg dim">已下架</span>;
    if (st.includes("published") || st === "published") return <span className="bdg ok">已发布</span>;
    return <span className="bdg dim">{st}</span>;
  };

  const renderVerStatus = (st: string) => {
    if (st === "draft") return <span className="bdg warn">draft</span>;
    if (st === "published") return <span className="bdg ok">published</span>;
    return <span className="bdg dim">archived</span>;
  };

  const renderExpState = (e: ExpRow) => {
    const st = liveExpState(e);
    if (st === "running") return <span className="bdg ok">running</span>;
    if (st === "stopped") return <span className="bdg dim">已停止</span>;
    if (st === "adopted") return <span className="bdg cyan">已采纳</span>;
    return <span className="bdg dim">已弃用</span>;
  };

  const surfaceSummary = COPY_POOL.length
    ? Object.entries(COPY_POOL.reduce<Record<string, number>>((acc, copy) => {
        const key = copy.surface || "未设置";
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {})).map(([surface, count]) => `${surface} ${count}`).join(" · ")
    : "暂无后端文案位";
  const topExperimentId = EXPS.find((exp) => exp.state === "running" || exp.state === "adopted")?.id ?? "";

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">I1 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">I1 暂无真实接口数据</div></div></section>;
  }

  return (
    <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管文案位</div>
          <div className="v">{I1_STATS.managedCopies} 个</div>
          <div className="sub">{surfaceSummary}</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">进行中实验</div>
          <div className="v">{I1_STATS.runningExps} 个</div>
          <div className="sub">分组固定 · 服务器掷签</div>
        </div>
        <div className="f-stat">
          <div className="k">本周变体曝光</div>
          <div className="v">{I1_STATS.weeklyExposures}</div>
          <div className="sub">曝光/转化事件喂漏斗(B3/L2)</div>
        </div>
        <div className="f-stat ok">
          <div className="k">最佳实验提升</div>
          <div className="v">{I1_STATS.topLift}</div>
          <div className="sub">{topExperimentId ? `${topExperimentId} · 来自后端实验记录` : "暂无后端实验记录"}</div>
        </div>
      </div>

      <section className="l-card" data-proof="copy-position-list">
        <div className="l-h">
          <span className="ttl">文案位置配置</span>
          <span className="sub">· 位置由后端统一管理，文案只能选择所属投放模块下的启用位置</span>
          {canWrite && <div className="r"><button type="button" className="l-btn sm mc" onClick={createCopyPosition}>+ 新增位置</button></div>}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 660 }}>
            <thead><tr><th>位置名称</th><th>位置标识</th><th>投放模块</th><th>状态</th><th style={{ textAlign: "right" }}></th></tr></thead>
            <tbody>
              {COPY_POSITION_ROWS.map((position) => {
                const module = normalizeCopyModule(position.surface) as CopyModule;
                return (
                  <tr key={position.positionKey}>
                    <td style={{ fontWeight: 600 }}>{position.name}</td>
                    <td className="mono">{position.positionKey}</td>
                    <td><span className="bdg dim">{COPY_MODULE_LABELS[module] ?? position.surface}</span></td>
                    <td>{position.status.toUpperCase() === "ACTIVE"
                      ? <span className="bdg ok">启用</span>
                      : <span className="bdg dim">停用</span>}</td>
                    <td style={{ textAlign: "right" }}>{canWrite && <button type="button" className="l-btn sm" onClick={() => deleteCopyPosition(position.positionKey)}>删除</button>}</td>
                  </tr>
                );
              })}
              {COPY_POSITION_ROWS.length === 0 && <tr><td colSpan={5}><div className="itint warn">暂无可用文案位置，请先新增位置。</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* (a) 文案池 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">文案池(a)</span>
          <span className="sub">· 每个文案位 = 一条受管内容线:当前发布版 + 版本历史 + 是否有进行中实验</span>
          <div className="r chips">
            <span className="lb">投放模块</span>
            {SURF_FLT.map(([k, l]) => (
              <button type="button" key={k} className={`chip${surf === k ? " sel" : ""}`} aria-pressed={surf === k} onClick={() => setSurf(k)}>{l}</button>
            ))}
            {canCreateCopy && <button type="button" className="l-btn sm mc" onClick={createCopy}>+ 新增文案</button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 860 }}>
            <thead>
              <tr>
                <th>文案位</th>
                <th>投放模块</th>
                <th>文案位置</th>
                <th>发布版</th>
                <th>状态</th>
                <th>中英越词条</th>
                <th>进行中实验</th>
                <th>最近改版</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredPool.map((c) => (
                <tr key={c.key}>
                  <td>
                    <div style={{ fontWeight: 600, color: "var(--ink)" }}>{c.desc}</div>
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{c.key}</span>
                  </td>
                  <td><span className="bdg dim">{COPY_MODULE_LABELS[c.surface as CopyModule] ?? c.surface}</span></td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{c.copyPosition || "—"}</td>
                  <td className="mono" style={{ fontWeight: 700 }}>{c.version}</td>
                  <td>{renderCopyStatus(c)}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{c.i18nKey}</td>
                  <td>{c.expId === "—" ? <span style={{ color: "var(--ink-4)" }}>—</span> : <span className="bdg cyan">{c.expId}</span>}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{c.lastChange}</td>
                  <td style={{ textAlign: "right" }}>
                    {canWrite && <button type="button" className="l-btn sm mc" onClick={() => editCopy(c)}>编辑文案</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ab-sm">
            <span style={{ fontSize: 12, color: "var(--ink-4)", marginRight: 6 }}>版本状态机:</span>
            <span className="st">draft 草稿</span>
            <span className="ar">发布(操作确认)→</span>
            <span className="st ok">published 生效中</span>
            <span className="ar">下架/被新版取代 →</span>
            <span className="st">archived 归档</span>
            <span className="ar" style={{ marginLeft: 10 }}>回滚 = 把历史版重新发布,同样走操作确认</span>
          </div>
        </div>
      </section>

      {/* (b) 覆盖所有文案位的版本列表 */}
      <section className="l-card" data-proof="copy-version-list">
        <div className="l-h">
          <span className="ttl">文案版本列表(b)</span>
          <span className="sub">· 版本属于具体文案，历史版本不可覆盖；新版本号由服务器按该文案自动递增</span>
          <div className="r chips">
            <label className="lb" htmlFor="copy-version-filter">文案</label>
            <select id="copy-version-filter" className="fld" style={{ width: 190, height: 32 }} value={versionCopyFlt} onChange={(event) => { setVersionCopyFlt(event.target.value); setVersionPage(1); }}>
              <option value="all">全部文案</option>
              {COPY_POOL.map((copy) => <option key={copy.key} value={copy.key}>{copy.desc} · {copy.key}</option>)}
            </select>
            <span className="lb">版本状态</span>
            {([['all', '全部'], ['draft', '草稿'], ['published', '已发布'], ['archived', '已归档']] as [VersionStatusFlt, string][]).map(([key, label]) => (
              <button type="button" key={key} className={`chip${versionStatusFlt === key ? " sel" : ""}`} aria-pressed={versionStatusFlt === key} onClick={() => { setVersionStatusFlt(key); setVersionPage(1); }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1280 }}>
            <thead><tr><th>文案标识</th><th>文案位置</th><th>版本</th><th>中英越文案</th><th>受众</th><th>状态</th><th>操作 / 留痕</th><th>时间</th><th style={{ textAlign: "right" }}></th></tr></thead>
            <tbody>
              {pagedVersions.map((row) => {
                const copy = COPY_POOL.find((item) => item.key === row.copyKey);
                const status = row.st.toLowerCase();
                const existingDraft = copy?.draftVersion
                  ? COPY_VERSIONS.find((item) => item.copyKey === copy.key && item.v === copy.draftVersion && item.st.toLowerCase() === "draft")
                  : undefined;
                return (
                  <tr key={`${row.copyKey}:${row.v}`}>
                    <td><div style={{ fontWeight: 600 }}>{copy?.desc || row.copyKey}</div><span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{row.copyKey}</span></td>
                    <td><div className="mono" style={{ fontSize: 11.5 }}>{row.copyPosition || "—"}</div><span className="bdg dim">{COPY_MODULE_LABELS[row.surface as CopyModule] ?? row.surface}</span></td>
                    <td className="mono" style={{ fontWeight: 700 }}>{row.v}</td>
                    <td style={{ minWidth: 300 }}>
                      <div className="tiny" title={row.zh} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>ZH</b> · {row.zh || "—"}</div>
                      <div className="tiny" title={row.vi} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>VI</b> · {row.vi || "—"}</div>
                      <div className="tiny" title={row.en} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>EN</b> · {row.en || "—"}</div>
                    </td>
                    <td style={{ minWidth: 170 }}><div className="tiny">{row.audience || "全量"}</div></td>
                    <td>{renderVerStatus(status)}</td>
                    <td><div className="tiny">{row.chain || "—"}</div>{row.versionNote && <div className="tiny" style={{ color: "var(--ink-4)" }}>{row.versionNote}</div>}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{row.ts}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {canWrite && status === "archived" && <button type="button" className="l-btn sm mc" onClick={() => rollbackTo(row.copyKey, row.v)}>回滚</button>}
                      {canWrite && status === "published" && copy && (existingDraft
                        ? <button type="button" className="l-btn sm" onClick={() => editCopy(copy, existingDraft)}>继续草稿 {existingDraft.v}</button>
                        : <button type="button" className="l-btn sm" onClick={() => editCopy(copy, row, true)}>新增版本</button>)}
                      {canWrite && status === "published" && copy?.version === row.v && <button type="button" className="l-btn sm" style={{ marginLeft: 6 }} onClick={() => archiveCurrentVersion(row.copyKey, row.v)}>下架</button>}
                      {canWrite && status === "draft" && copy?.draftVersion === row.v && <button type="button" className="l-btn sm mc" onClick={() => editCopy(copy, row)}>编辑 / 发布</button>}
                      {canWrite && status === "draft" && copy?.draftVersion === row.v && copy.revision != null && <button type="button" className="l-btn sm dgr" disabled={deletingDraftKey !== null} style={{ marginLeft: 6 }} onClick={() => deleteDraftVersion(row.copyKey, row.v, copy.revision!)}>{deletingDraftKey === `${row.copyKey}:${row.v}` ? "删除中…" : "删除草稿"}</button>}
                    </td>
                  </tr>
                );
              })}
              {filteredVersions.length === 0 && <tr><td colSpan={9}><div className="itint warn">当前筛选条件下没有版本记录。</div></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 8, paddingTop: 10 }}>
          <span className="tiny">共 {filteredVersions.length} 条 · 第 {safeVersionPage}/{versionPages} 页</span>
          <button type="button" className="chip" disabled={safeVersionPage <= 1} onClick={() => setVersionPage(Math.max(1, safeVersionPage - 1))}>上一页</button>
          <button type="button" className="chip" disabled={safeVersionPage >= versionPages} onClick={() => setVersionPage(Math.min(versionPages, safeVersionPage + 1))}>下一页</button>
        </div>
      </section>

      {/* 实验框架默认参数 */}
      <section className="l-card">
          <div className="l-h">
            <span className="ttl">实验框架默认参数</span>
            <span className="sub">· 每个实验启动时按这套默认值锁定,启动后不再变</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            {EXP_FRAMEWORK.map((p) => {
              const cur = liveFw(p.key, p.cur);
              return (
                <div className="p-row" key={p.key}>
                  <div className="txt">
                    <div className="k">{p.name}</div>
                    <div className="s">{p.sub}</div>
                  </div>
                  <span className="v">{cur}</span>
                  {canWrite && <button type="button" className="l-btn sm" onClick={() => adjustFramework(p.key, p.name, cur)}>调整</button>}
                </div>
              );
            })}
            <div className="itint" style={{ marginTop: 10 }}>
              <b>分组怎么发的</b> · 用户首次命中实验时由服务器掷签入组,之后固定不变(换设备也不变);曝光和转化都按服务器记的组归因。用户在本地改自己的组,服务器照旧按原组算,不会污染结论。
            </div>
            <div className="itint cyan" style={{ marginTop: 8 }}>
              <b>不碰钱</b> · 这页只改措辞,费率 / 奖励 / 价格一个都改不了——那些归各业务域,改之前要过备付金红线;文案发布没有这道约束。
            </div>
          </div>
      </section>

      {/* (c) A/B 实验面板 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">A/B 实验面板(c)</span>
          <span className="sub">· 曝光 / 转化 / CVR 全部由事件流结算(服务器口径),不是页面临时拼的数</span>
          <div className="r chips">
            {EXP_FLT.map(([k, l]) => (
              <button type="button" key={k} className={`chip${expFlt === k ? " sel" : ""}`} aria-pressed={expFlt === k} onClick={() => setExpFlt(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>实验</th>
                <th>文案位</th>
                <th>变体 × 分流</th>
                <th>继承文案受众</th>
                <th className="num">曝光</th>
                <th className="num">转化</th>
                <th className="num">CVR</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredExps.map((e) => {
                const st = liveExpState(e);
                const isRunning = st === "running";
                const maxCvr = e.variants.reduce((m, v) => Math.max(m, v[2]), 0);
                return (
                  <tr key={e.id}>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{e.id}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{e.copyKey}</td>
                    <td style={{ minWidth: 230 }}>
                      {e.variants.map((v, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: 7, margin: "2px 0" }}>
                          <span style={{ fontSize: 11.5, color: "var(--ink-3)", minWidth: 104 }}>{v[0]} · {v[1]}%</span>
                          <span className="ab-bar" style={{ flex: 1 }}>
                            <i style={{ width: `${Math.min(100, v[2] * 16)}%`, background: VAR_COLORS[j % VAR_COLORS.length] }} />
                          </span>
                          <span
                            className="mono"
                            style={{
                              fontSize: 11.5,
                              fontWeight: 700,
                              minWidth: 38,
                              textAlign: "right",
                              color: v[2] === maxCvr ? "var(--success)" : undefined,
                            }}
                          >
                            {v[2]}%
                          </span>
                        </div>
                      ))}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {e.audience}
                      <div className="tiny" style={{ color: "var(--ink-4)" }}>实验启动快照 · 预计覆盖 {e.estimatedAudience == null ? "待后端统计" : `${e.estimatedAudience.toLocaleString()} 人`}</div>
                    </td>
                    <td className="num mono">{e.impressions}</td>
                    <td className="num mono">{e.conversions}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{maxCvr}%</td>
                    <td>
                      {renderExpState(e)}
                      <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>{e.note}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {canWrite && isRunning ? (
                        <button type="button" className="l-btn sm mc" onClick={() => stopExp(e.id)}>停止</button>
                      ) : canWrite && st === "discarded" ? (
                        <button type="button" className="l-btn sm mc" onClick={() => adoptExp(e.id)}>采纳获胜</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ab-sm">
            <span style={{ fontSize: 12, color: "var(--ink-4)", marginRight: 6 }}>实验状态机:</span>
            <span className="st">scheduled 待开始</span>
            <span className="ar">到点开跑 →</span>
            <span className="st ok">running 进行中</span>
            <span className="ar">手动结算 / 到期 →</span>
            <span className="st warn">concluded 已结</span>
            <span className="ar">→ adopted 采纳获胜版(等于发布,走操作确认)或 discarded 弃用</span>
          </div>
        </div>
      </section>

      <p className="f-foot">
        <b>执行门槛</b>:草稿随便存(留审计);发布 / 下架 / 回滚 / 实验启停 / 采纳获胜 = 内容执行门槛:内容主管或超管。增长角色只能给<b>增长类文案位</b>(转化横幅这类)当实验发起人,法务和品牌类文案只有内容角色能动——服务器按文案位分类校验发起资格。<b>事件去向</b>:变体曝光 / 转化喂实时漏斗(B3,购买段)和留存 BI(L2,各变体 CVR 曲线);这四类内容事件进入待归属登记清单,待 content 域上线后正式归类。
        <b>边界</b>:活动卡里能独立做 A/B 的通用文案归这页;活动本身的玩法 / 奖励 / 时窗归活动页(H4),互不越界。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "文案池(a)",
            kind: "reference-catalog",
            maxRows: COPY_POOL.length,
            reason: "文案池为后端返回的当前文案位列表,通过界面/状态字段定位后编辑",
          },
          {
            label: "文案版本列表(b)",
            maxRows: VERSION_PAGE_SIZE,
            reason: "版本列表按 20 条分页展示后端版本，并可按文案和状态筛选",
          },
          {
            label: "A/B 实验面板(c)",
            maxRows: EXPS.length,
            reason: "实验面板展示后端返回的实验记录,完整实验归埋点统计",
          },
        ]}
      />
    </>
  );
}
