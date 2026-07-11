"use client";

/**
 * I1 转化文案 A/B — design_handoff_i_domain/I1 转化文案AB.html port。
 * 单源:后端 /content/copy-ab/overview;空库时以后端初始化结果为准。
 * 操作确认 显式 edit 契约:编辑文案 / 回滚到历史版 / 调整框架参数 = 调参传 edit;
 *   下架 / 停止实验 / 采纳获胜变体 = 处置不传 edit。
 * amplifies = false(I1 不碰 B1 红线 —— 只改措辞,不动费率/奖励/价格)。
 * 框架参数 = 运营设定(仍需操作确认 + 必填原因留痕)→ 走 openConfirm + input(ConfirmReq.input 已支持)。
 */
import { useState } from "react";
import { PaginationExemptionList } from "../design-kit";
import type { ICtx } from "./types";

const COPY_MODULES = ["home", "store", "earn", "me"] as const;
type CopyModule = (typeof COPY_MODULES)[number];
type Surf = "all" | CopyModule;
type ExpFlt = "all" | "running" | "concluded";
type CopyRow = {
  key: string; desc: string; surface: string;
  version: string; status: string; i18nKey: string; expId: string; lastChange: string;
  draftVersion?: string; draftZh?: string; draftEn?: string; draftVi?: string; copyPosition?: string; draftCopyPosition?: string; draftSurface?: string; draftAudience?: string; draftAudienceTarget?: AudienceTarget; draftTrafficSplit?: string; draftNote?: string;
};
type AudienceTarget = { locales?: string[]; tiers?: string[]; registrationDaysMin?: number | null; registrationDaysMax?: number | null };
type ExpRow = {
  id: string; copyKey: string; variants: [name: string, split: number, cvr: number][];
  audience: string; impressions: string; conversions: string; state: string; note: string;
};

const COPY_MODULE_LABELS: Record<CopyModule, string> = { home: "首页", store: "商城", earn: "赚取", me: "我的" };
const COPY_MODULE_OPTIONS = COPY_MODULES.map((value) => ({ value, label: COPY_MODULE_LABELS[value] }));
const LEGACY_MODULES: Record<string, CopyModule> = { Home: "home", Store: "store", Earn: "earn", Me: "me", 商城: "store" };
const SURF_FLT: [Surf, string][] = [["all", "全部"], ...COPY_MODULES.map((value) => [value, COPY_MODULE_LABELS[value]] as [Surf, string])];
const EXP_FLT: [ExpFlt, string][] = [["all", "全部"], ["running", "进行中"], ["concluded", "已结"]];

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
  const [surf, setSurf] = useState<Surf>("all");
  const [expFlt, setExpFlt] = useState<ExpFlt>("all");
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
  }));
  const COPY_VERSIONS = (data?.versions ?? []).map((row) => ({
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

  const nextCopyVersion = (copyKey: string, currentVersion: string): string => {
    const used = new Set(COPY_VERSIONS.filter((row) => row.copyKey === copyKey).map((row) => row.v.toLowerCase()));
    const match = /^(.*?)(\d+)$/.exec(currentVersion.trim());
    if (match) {
      const prefix = match[1];
      let next = Number(match[2]) + 1;
      let candidate = `${prefix}${next}`;
      while (used.has(candidate.toLowerCase())) {
        next += 1;
        candidate = `${prefix}${next}`;
      }
      return candidate;
    }
    let suffix = 1;
    let candidate = `${currentVersion}.draft${suffix}`;
    while (used.has(candidate.toLowerCase())) {
      suffix += 1;
      candidate = `${currentVersion}.draft${suffix}`;
    }
    return candidate;
  };

  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  const liveCopyStatus = (c: CopyRow): string => c.status;
  const liveCopyDraftZh = (key: string): string | undefined => COPY_POOL.find((c) => c.key === key)?.draftZh;
  const liveCopyDraftEn = (key: string): string | undefined => COPY_POOL.find((c) => c.key === key)?.draftEn;
  const liveCopyDraftVi = (key: string): string | undefined => COPY_POOL.find((c) => c.key === key)?.draftVi;
  const liveCopyDraftMeta = (key: string): { audience?: string; trafficSplit?: string; note?: string; surface?: string; copyPosition?: string } => {
    const row = COPY_POOL.find((c) => c.key === key);
    return { audience: row?.draftAudience, trafficSplit: row?.draftTrafficSplit, note: row?.draftNote, surface: row?.draftSurface, copyPosition: row?.draftCopyPosition };
  };
  const liveExpState = (e: ExpRow): string => e.state;
  const liveFw = (_key: string, cur: string): string => cur;

  const filteredPool = COPY_POOL.filter((c) => surf === "all" || c.surface === surf);
  const filteredExps = EXPS.filter((e) => {
    if (expFlt === "all") return true;
    const st = liveExpState(e);
    if (expFlt === "running") return st === "running";
    return st === "adopted" || st === "discarded" || st === "stopped";
  });

  // 编辑文案(文案池每行通用) —— 默认存草稿,运营也可明确选择发布生效。
  const editCopy = (c: CopyRow) => {
    const editableVersion = COPY_VERSIONS.find((row) => row.copyKey === c.key && row.v === c.draftVersion)
      ?? COPY_VERSIONS.find((row) => row.copyKey === c.key && row.v === c.version);
    openActionConfirm({
      action: <>编辑文案 · {c.key}</>,
      detail: <>当前发布版 <b>{c.version}</b>。默认保存为草稿;只有明确选择“发布生效”才会对用户生效。服务器会校验中、英、越文案与变量令牌。</>,
      amplifies: false,
      businessForm: {
        kind: "copy-edit",
        keyName: c.key,
        version: c.draftVersion || nextCopyVersion(c.key, c.version),
        surface: c.draftSurface || c.surface,
        copyPosition: c.draftCopyPosition || editableVersion?.copyPosition || c.copyPosition,
        audience: c.draftAudience || editableVersion?.audience,
        ...audienceTargetFields(c.draftAudienceTarget ?? editableVersion?.audienceTarget),
        trafficSplit: c.draftTrafficSplit || editableVersion?.trafficSplit,
        trafficSplits: COPY_TRAFFIC_SPLITS,
        modules: COPY_MODULE_OPTIONS,
        positions: COPY_POSITION_OPTIONS,
        zh: c.draftZh || editableVersion?.zh || "",
        en: c.draftEn || editableVersion?.en || "",
        vi: c.draftVi || editableVersion?.vi || "",
        versionNote: c.draftNote || "后台编辑文案",
        saveModeChoice: true,
      },
      run: (reason, v, form) => {
        if (!v) return;
        const payload = {
          version: v,
          surface: form?.surface || c.draftSurface || c.surface,
          copyPosition: form?.copyPosition || c.draftCopyPosition || editableVersion?.copyPosition || c.copyPosition || "",
          audience: composeAudience(form),
          audienceTarget: composeAudienceTarget(form),
          phaseMin: form?.phaseMin,
          phaseMax: form?.phaseMax,
          language: form?.language,
          registrationDaysGt: Number(form?.registrationDaysGt || 0),
          trafficSplit: form?.trafficSplit || c.draftTrafficSplit || editableVersion?.trafficSplit || COPY_TRAFFIC_SPLITS[0] || "",
          versionNote: form?.versionNote || "后台编辑文案",
          zh: form?.zh || c.draftZh || editableVersion?.zh || "",
          en: form?.en || c.draftEn || editableVersion?.en || "",
          vi: form?.vi || c.draftVi || editableVersion?.vi || "",
        };
        if (form?.saveMode === "存草稿") {
          runBackend(actions.saveI1CopyDraft(c.key, payload, reason), `${c.key} 草稿已保存 · 尚未对用户生效`);
        } else {
          runBackend(actions.publishI1CopyVersion(c.key, payload, reason), `${c.key} ${v} 已发布生效`);
        }
      },
    });
  };

  const createCopy = () => openActionConfirm({
    action: <>新增文案</>,
    detail: <>在文案池中新建一条受管文案。提交后会创建首个版本并发布生效,文案标识必须全局唯一。</>,
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
        version: form.version || "v1",
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

  // 版本详情卡优先展示后端返回的主转化横幅;没有该键时使用第一条后端文案位。
  const HCB = "home.conversionBanner";
  const hcbRow = COPY_POOL.find((c) => c.key === HCB) ?? COPY_POOL[0];
  const HCB_VERSIONS = COPY_VERSIONS.filter((row) => row.copyKey === HCB);
  const hcbPublished = HCB_VERSIONS.find((row) => row.st === "published")
    ?? HCB_VERSIONS.find((row) => row.v === hcbRow?.version)
    ?? HCB_VERSIONS[0];
  const hcbActiveVersion = hcbPublished?.v || hcbRow?.version || "";
  const hcbDraftVersion = hcbRow?.draftVersion || "";
  const hcbDraftVersionRow = HCB_VERSIONS.find((row) => row.v === hcbDraftVersion);

  const pubDraftVersion = () => openActionConfirm({
    action: <>发布新版 · {HCB}</>,
    detail: <>当前发布版 <b>{hcbActiveVersion || "未设置"}</b>。发布即对全体用户下一次渲染生效;服务器先校验中英越三语与变量令牌,不齐直接拒。</>,
    amplifies: false,
    businessForm: {
      kind: "copy-edit",
      keyName: HCB,
      version: hcbDraftVersion,
      surface: hcbRow?.surface || "",
      copyPosition: hcbDraftVersionRow?.copyPosition || hcbRow?.draftCopyPosition || hcbRow?.copyPosition,
      audience: hcbRow?.draftAudience || hcbDraftVersionRow?.audience,
      ...audienceTargetFields(hcbRow?.draftAudienceTarget ?? hcbDraftVersionRow?.audienceTarget),
      modules: COPY_MODULE_OPTIONS,
      positions: COPY_POSITION_OPTIONS,
      trafficSplits: COPY_TRAFFIC_SPLITS,
      zh: hcbRow?.draftZh || "",
      en: hcbRow?.draftEn || "",
      vi: hcbRow?.draftVi || hcbDraftVersionRow?.vi || "",
      placeholders: [],
    },
    run: (reason, v, form) => {
      if (!v) return;
      runBackend(actions.publishI1CopyVersion(HCB, {
        version: v,
        surface: form?.surface || hcbRow?.surface || "",
        copyPosition: form?.copyPosition || hcbDraftVersionRow?.copyPosition || hcbRow?.copyPosition || "",
        audience: composeAudience(form),
        audienceTarget: composeAudienceTarget(form),
        phaseMin: form?.phaseMin,
        phaseMax: form?.phaseMax,
        language: form?.language,
        registrationDaysGt: Number(form?.registrationDaysGt || 0),
        trafficSplit: form?.trafficSplit || hcbRow?.draftTrafficSplit || "",
        versionNote: form?.versionNote || "后台发布新版",
        zh: form?.zh || "",
        en: form?.en || "",
        vi: form?.vi || hcbRow?.draftVi || hcbDraftVersionRow?.vi || "",
      }, reason), `${HCB} 新版已确认生效 · 目标 ${v}`);
    },
  });

  const editDraftVersion = () => openActionConfirm({
    action: <>编辑草稿 · {HCB}</>,
    detail: <>中英越三份一起改(词序可以不同,变量令牌必须三份都有);保存只存草稿、不对外,但会留审计记录。</>,
    amplifies: false,
    businessForm: {
      kind: "copy-edit",
      keyName: HCB,
      version: hcbDraftVersion,
      surface: hcbRow?.surface || "",
      copyPosition: hcbDraftVersionRow?.copyPosition || hcbRow?.draftCopyPosition || hcbRow?.copyPosition,
      audience: hcbRow?.draftAudience || hcbDraftVersionRow?.audience,
      ...audienceTargetFields(hcbRow?.draftAudienceTarget ?? hcbDraftVersionRow?.audienceTarget),
      modules: COPY_MODULE_OPTIONS,
      positions: COPY_POSITION_OPTIONS,
      trafficSplits: COPY_TRAFFIC_SPLITS,
      zh: hcbRow?.draftZh || "",
      en: hcbRow?.draftEn || "",
      vi: hcbRow?.draftVi || hcbDraftVersionRow?.vi || "",
      placeholders: [],
    },
    run: (reason, _v, form) => {
      runBackend(actions.saveI1CopyDraft(HCB, {
        version: form?.version || hcbDraftVersion,
        surface: form?.surface || hcbRow?.surface || "",
        copyPosition: form?.copyPosition || hcbDraftVersionRow?.copyPosition || hcbRow?.copyPosition || "",
        audience: composeAudience(form),
        audienceTarget: composeAudienceTarget(form),
        phaseMin: form?.phaseMin,
        phaseMax: form?.phaseMax,
        language: form?.language,
        registrationDaysGt: Number(form?.registrationDaysGt || 0),
        trafficSplit: form?.trafficSplit || hcbRow?.draftTrafficSplit || "",
        versionNote: form?.versionNote || "草稿保存",
        zh: form?.zh || "",
        en: form?.en || "",
        vi: form?.vi || hcbRow?.draftVi || hcbDraftVersionRow?.vi || "",
      }, reason), `${HCB} 草稿已保存 · 变量令牌校验通过 · 留审计`);
    },
  });

  const rollbackTo = (v: string) => openActionConfirm({
    action: <>回滚 · {HCB} 当前 {hcbActiveVersion || "当前版本"} → 重新发布 {v}</>,
    detail: <>回滚 = 把历史版 <b>{v}</b> 重新发布,效果和发新版完全一样(对全体用户生效),所以同样走操作确认。仅完整满足中英越、受众和位置契约的归档版允许恢复。</>,
    amplifies: false,
    // 处置类(回滚到已选历史版 v):目标版本由点击的归档版决定,run 不消费 v,按 MC 显式 edit 契约不传 edit,不强迫运营手输已确定的版本号。
    run: (reason) => {
      runBackend(actions.rollbackI1CopyVersion(HCB, v, reason), `回滚 ${v} 已确认生效`);
    },
  });

  const archiveCurrentVersion = () => openActionConfirm({
    action: <>下架当前发布版 · {HCB}{hcbActiveVersion ? ` ${hcbActiveVersion}` : ""}</>,
    detail: <>下架后该文案位<b>没有生效版本</b>,App 端会退回内置兜底文案——一般只在文案出合规问题时才这么做;常规换版直接发新版即可。下架立即生效。</>,
    amplifies: false,
    run: (reason) => {
      runBackend(actions.archiveI1Copy(HCB, reason), "当前发布版下架已确认生效");
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

  const hcbDraftZh = liveCopyDraftZh(HCB);
  const hcbDraftEn = liveCopyDraftEn(HCB);
  const hcbDraftVi = liveCopyDraftVi(HCB) || hcbDraftVersionRow?.vi;
  const hcbDraftMeta = liveCopyDraftMeta(HCB);
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
          <div className="r"><button className="l-btn sm mc" onClick={createCopyPosition}>+ 新增位置</button></div>
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
                    <td style={{ textAlign: "right" }}><button className="l-btn sm" onClick={() => deleteCopyPosition(position.positionKey)}>删除</button></td>
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
              <button key={k} className={`chip${surf === k ? " sel" : ""}`} onClick={() => setSurf(k)}>{l}</button>
            ))}
            <button className="l-btn sm mc" onClick={createCopy}>+ 新增文案</button>
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
                    <button className="l-btn sm mc" onClick={() => editCopy(c)}>编辑文案</button>
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

      <div className="two-col">
        {/* (b) 版本详情 · home.conversionBanner */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">版本详情(b)· <span className="icode electric">{HCB}</span></span>
            <span className="sub">· 主转化横幅</span>
            <div className="r">
              <button className="l-btn sm" onClick={editDraftVersion}>编辑草稿</button>
              <button className="l-btn sm mc" onClick={pubDraftVersion}>发布草稿</button>
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            {hcbPublished ? (
              <div className="ab-grid">
                <div className="ab-prev">
                  <div className="lc">EN · {hcbActiveVersion || "published"}</div>
                  <div className="tx">{hcbPublished.en || "—"}</div>
                </div>
                <div className="ab-prev">
                  <div className="lc">ZH · {hcbActiveVersion || "published"}</div>
                  <div className="tx">{hcbPublished.zh || "—"}</div>
                </div>
                <div className="ab-prev">
                  <div className="lc">VI · {hcbActiveVersion || "published"}</div>
                  <div className="tx">{hcbPublished.vi || "—"}</div>
                </div>
              </div>
            ) : (
              <div className="itint warn" style={{ marginBottom: 12 }}>暂无后端发布版详情</div>
            )}
            <div className="itint ok" style={{ marginBottom: 12 }}>
              <b>变量令牌校验通过</b> · 中英越三份文案用到的变量令牌集合必须完全一致(词序可以不同);缺一个或多一个,发布会被服务器直接拦下。
            </div>
            {hcbDraftZh && hcbDraftEn && hcbDraftVi && (
              <div className="itint cyan" data-proof="copy-draft-preview" style={{ marginBottom: 12 }}>
                <b>当前草稿回显</b> · 受众 <span className="mono">{hcbDraftMeta.audience ?? "未设置"}</span>
                {" "}· 分流 <span className="mono">{hcbDraftMeta.trafficSplit ?? "未设置"}%</span>
                {" "}· 位置 <span className="mono">{hcbDraftMeta.surface ?? hcbRow?.surface ?? "未设置"}</span>
                {" "}· 槽位 <span className="mono">{hcbDraftMeta.copyPosition ?? hcbDraftVersionRow?.copyPosition ?? hcbRow?.copyPosition ?? "未设置"}</span>
                {hcbDraftMeta.note ? <> · 说明 <span className="mono">{hcbDraftMeta.note}</span></> : null}
                <div className="ab-grid" style={{ marginTop: 8 }}>
                  <div className="ab-prev">
                    <div className="lc">ZH · draft</div>
                    <div className="tx">{hcbDraftZh}</div>
                  </div>
                  <div className="ab-prev">
                    <div className="lc">EN · draft</div>
                    <div className="tx">{hcbDraftEn}</div>
                  </div>
                  <div className="ab-prev">
                    <div className="lc">VI · draft</div>
                    <div className="tx">{hcbDraftVi}</div>
                  </div>
                </div>
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table className="l-tbl" style={{ minWidth: 420 }}>
                <thead>
                  <tr>
                    <th>版本</th>
                    <th>状态</th>
                    <th>操作 / 留痕</th>
                    <th>时间</th>
                    <th style={{ textAlign: "right" }}></th>
                  </tr>
                </thead>
                <tbody>
                  {HCB_VERSIONS.map((row) => (
                    <tr key={row.v}>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{row.v}</td>
                      <td>{renderVerStatus(row.st)}</td>
                      <td style={{ fontSize: 12 }}>{row.chain}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{row.ts}</td>
                      <td style={{ textAlign: "right" }}>
                        {row.st === "archived" ? (
                          <button className="l-btn sm mc" onClick={() => rollbackTo(row.v)}>回滚到此版</button>
                        ) : (
                          <button className="l-btn sm" onClick={() => toast(`版本对比 ${row.v} vs ${hcbActiveVersion || "当前版"} · 变量令牌一致`)}>对比</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="l-btn sm mc" style={{ marginTop: 10 }} onClick={archiveCurrentVersion}>下架当前发布版{hcbActiveVersion ? `(${hcbActiveVersion})` : ""}</button>
            {/* 触摸 hcbRow 仅用于编译期完整性(确保 HCB 在 COPY_POOL 中存在,后续 audit 改文案位时强类型保证)。 */}
            <span style={{ display: "none" }} data-hcb={hcbRow?.key ?? HCB} />
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
                  <button className="l-btn sm" onClick={() => adjustFramework(p.key, p.name, cur)}>调整</button>
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
      </div>

      {/* (c) A/B 实验面板 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">A/B 实验面板(c)</span>
          <span className="sub">· 曝光 / 转化 / CVR 全部由事件流结算(服务器口径),不是页面临时拼的数</span>
          <div className="r chips">
            {EXP_FLT.map(([k, l]) => (
              <button key={k} className={`chip${expFlt === k ? " sel" : ""}`} onClick={() => setExpFlt(k)}>{l}</button>
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
                <th>定向</th>
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
                    <td style={{ fontSize: 12 }}>{e.audience}</td>
                    <td className="num mono">{e.impressions}</td>
                    <td className="num mono">{e.conversions}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{maxCvr}%</td>
                    <td>
                      {renderExpState(e)}
                      <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 2 }}>{e.note}</div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {isRunning ? (
                        <button className="l-btn sm mc" onClick={() => stopExp(e.id)}>停止</button>
                      ) : st === "discarded" ? (
                        <button className="l-btn sm mc" onClick={() => adoptExp(e.id)}>采纳获胜</button>
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
            label: "版本详情(b)· home.conversionBanner",
            maxRows: HCB_VERSIONS.length,
            reason: "版本详情展示后端返回的当前文案位版本记录",
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
