"use client";

/**
 * I6 i18n 文案 / I7 教程中心共享数据与动作实现，按路由只渲染各自业务区。
 * 单源:后端 /content/i18n-learning/overview;空库时后端写入 MySQL 种子后再查出。
 * 操作确认 显式 edit 契约:奖励调整 / 换推荐课 = 调参传 edit;
 *   课程发布 / 词条发布 / marketing 多版 / 课程下架 = 处置不传 edit。
 * I 域唯一 amplifies = 课程奖励上调(B1 红线核验,SPEC §4 注:拒绝码 V4 目标 422,
 *   B1 现行 403,以收口裁定为准;审计带 coverageAtSubmit);其余动作 amplifies=false。
 * 完整性扫描 / 新建课程 / 编辑草稿 = 运营设定(仍需操作确认 + 留痕)→ openConfirm。
 */
import { useState } from "react";
import type { ICtx } from "./types";
import { Drawer, PaginationExemptionList } from "../design-kit";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { useAdminAuth } from "@/lib/store/admin-auth";

type NsFlt = "all" | "issues" | "mkt";
type CatFlt = string;

const NS_FLT: [NsFlt, string][] = [
  ["all", "全部"],
  ["issues", "有问题"],
  ["mkt", "marketing 多版"],
];
const HCB_KEY = "milestones.earnCross";

type NsDrawer = { ns: string; keys: number; cov: number; variants: string };
type Namespace = { ns: string; keys: number; coverage: number; variants: string; lastChange: string };
type IntegrityIssue = { code: string; kind: string; cnt: number; samples: string[]; status: string };
type HardcodedFinding = { location: string; rawCopy: string; suggestedKey: string; status: string };
type Course = {
  id: string; title: string; cat: string; icon: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  reward: number; featured: boolean; duration: string; v: string; status: string; body: string;
};
const COURSE_ICON_BY_CAT: Record<string, string> = {
  Basics: "🚀",
  Earn: "⚡",
  Team: "🧬",
  Wealth: "💎",
  Security: "🛡",
};

export function I6I18n({ ctx }: { ctx: ICtx }) {
  return <I18nLearningPage ctx={ctx} view="i18n" />;
}

export function I7Learning({ ctx }: { ctx: ICtx }) {
  return <I18nLearningPage ctx={ctx} view="learn" />;
}

function I18nLearningPage({ ctx, view }: { ctx: ICtx; view: "i18n" | "learn" }) {
  const { toast, openActionConfirm, openConfirm, actions, content, contentLoading } = ctx;
  const session = useAdminAuth((state) => state.session);
  const isSuperadmin = session?.role === "superadmin";
  const canWriteI6 = isSuperadmin || !!session?.authorities.includes("content_i6_write");
  const canWriteI7 = isSuperadmin || !!session?.authorities.includes("content_i7_write");
  const canAdjustI7Reward = isSuperadmin || !!session?.authorities.includes("content_i7_course_reward_adjust");
  const propose = usePropose();
  const [nsFlt, setNsFlt] = useState<NsFlt>("all");
  const [catFlt, setCatFlt] = useState<CatFlt>("all");
  const [nsDrawer, setNsDrawer] = useState<NsDrawer | null>(null);
  const [hcDrawer, setHcDrawer] = useState(false);
  const data = content.i18nLearning;
  const I6_STATS = data?.stats ?? { managedKeys: 0, totalKeys: 0, integrityIssues: 0, coursesOnline: 0, weeklyNexPayout: "—" };
  const NAMESPACES: Namespace[] = data?.namespaces ?? [];
  const INTEGRITY_ISSUES: IntegrityIssue[] = data?.integrityIssues ?? [];
  const HARDCODED_FINDINGS: HardcodedFinding[] = data?.hardcodedFindings ?? [];
  const COURSES: Course[] = (data?.courses ?? []).map((c) => ({
    id: c.id,
    title: c.title,
    cat: c.category,
    icon: COURSE_ICON_BY_CAT[c.category] ?? "📘",
    format: c.format,
    level: c.level,
    reward: Number(c.rewardNex),
    featured: c.featured,
    duration: c.duration,
    v: c.version,
    status: c.status,
    body: c.body,
  }));
  const TUTORIAL_REWARD_RANGE = data?.rewardRange ?? { min: 0, max: 0 };
  const TUTORIAL_FEATURED_DEFAULT = data?.featuredCourseId ?? "";
  const TUTORIAL_METRICS = (data?.metrics ?? []).map((m) => ({ k: m.key, v: m.value }));
  const focusMessage = data?.focusMessage;
  const runBackend = (task: Promise<void>, ok: string) => {
    task
      .then(() => actions.reloadIContent())
      .then(() => toast(ok))
      .catch((error) => toast(`操作失败:${error instanceof Error ? error.message : String(error)}`));
  };

  const allCourses = COURSES;
  const configuredCategories = (data?.categories ?? []).map((category) => category.trim()).filter(Boolean);
  const courseCategories = configuredCategories.length > 0
    ? configuredCategories
    : [...new Set(allCourses.map((course) => course.cat).filter(Boolean))];
  const categoryFilters: [CatFlt, string][] = [
    ["all", "全部"],
    ...courseCategories.map((category) => [category, `${COURSE_ICON_BY_CAT[category] ?? "📘"} ${category}`] as [CatFlt, string]),
  ];
  const liveReward = (c: Course): string => {
    return `${c.reward} NEX`;
  };
  const liveStatus = (c: Course): string =>
    c.status || "published";
  const liveFeatured = (): string =>
    TUTORIAL_FEATURED_DEFAULT;
  const hcbDraftZh = focusMessage?.zh;
  const hcbDraftEn = focusMessage?.en;
  const hcbStatus = focusMessage?.status;

  const filteredNs = NAMESPACES.filter((n) => {
    if (nsFlt === "all") return true;
    if (nsFlt === "issues") return n.coverage < 100;
    return n.variants.includes("多版");
  });
  const filteredCrs = allCourses.filter((c) => catFlt === "all" || c.cat === catFlt);
  const courseCategoryCount = courseCategories.length;

  /* ============ I6 actions ============ */
  const liveIntegrity = Math.max(0, I6_STATS.integrityIssues);
  const liveIntegritySub = (() => {
    const remain = INTEGRITY_ISSUES.filter((iss) => iss.status !== "fixed");
    if (remain.length === 0) return "已全部修复 · 待重扫确认清零";
    return remain.map((r) => `${r.kind.split(" ")[0]} ${r.cnt}`).join(" · ");
  })();
  const rescan = () =>
    openConfirm({
      action: <>全量重扫 {I6_STATS.managedKeys} 词条</>,
      detail: <>扫缺镜像 / 占位符不匹配 / 疑似硬编码 / 禁词,只读不改数据;结果刷新本表。</>,
      chips: [["只读扫描 · 普通确认", "done"]],
      okLabel: "开始扫描",
      run: () => runBackend(actions.rescanI6("全量重扫词条完整性"), liveIntegrity === 0 ? "扫描完成 · 0 处问题 · 清零 ✓" : `扫描完成 · ${liveIntegrity} 处问题`),
    });

  const editKeyDraft = () =>
    openActionConfirm({
      action: <>编辑草稿 · {HCB_KEY}(中英同步)</>,
      detail: (
        <>
          中英两份一起改:占位符 <span className="mono">{"{amount}"}</span>{" "}
          <span className="mono">{"{nex}"}</span> 两边必须都有(词序可以不同);保存只存草稿,留审计记录。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "localized-copy",
        keyName: HCB_KEY,
        zh: "完成 {amount} USDT 复投并获得 {nex} NEX 奖励",
        en: "Reinvest {amount} USDT and earn {nex} NEX",
        placeholders: ["{amount}", "{nex}"],
      },
      run: (reason, _v, form) => {
        runBackend(actions.saveI6LocalizedDraft(HCB_KEY, {
          zh: form?.zh || focusMessage?.zh || "",
          en: form?.en || focusMessage?.en || "",
        }, reason), `${HCB_KEY} 草稿已保存 · 占位符校验通过 · 留审计`);
      },
    });

  const pubKey = () =>
    openActionConfirm({
      action: <>发布词条 · {HCB_KEY} v4 → v5</>,
      detail: (
        <>
          发布即对全体用户下一次渲染生效。服务器发布闸:
          <b> en/zh 镜像齐 ✓ 占位符一致 ✓ 禁词扫描通过 ✓</b>
          ——任何一项不过直接拒,<b>禁止单语言发布</b>。审计记录带语言集字段,印证两语言同步。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.publishI6LocalizedMessage(HCB_KEY, {
          zh: focusMessage?.zh || "",
          en: focusMessage?.en || "",
        }, reason), `milestones.earnCross v5 已确认生效`);
      },
    });

  const mkAB = () =>
    openActionConfirm({
      action: <>开 marketing 多版 A/B · {HCB_KEY}</>,
      detail: (
        <>
          给该词条加变体并分流(合计 100%);分组由服务器掷签、对单个用户固定。曝光/转化按 I1 实验框架结算,喂漏斗与
          BI。增长角色也可发起 marketing 类多版。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.startI6MarketingExperiment(HCB_KEY, reason), "marketing 多版 A/B 已确认生效");
      },
    });

  const fixIntegrity = (issue: IntegrityIssue) =>
    openActionConfirm({
      action: <>修复完整性问题 · {issue.kind}</>,
      detail: (
        <>
          {issue.kind} 共 <b>{issue.cnt}</b> 处。补齐缺失的镜像 / 修正占位符 / 替换硬编码为词条引用;保存后入待重扫确认队列,重扫清零相关词条才能发版。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "localized-copy",
        keyName: issue.kind,
        zh: `${issue.kind} 修复后的中文镜像 · {amount}`,
        en: `${issue.kind} repaired English mirror · {amount}`,
        placeholders: issue.kind.includes("placeholder") ? ["{amount}"] : undefined,
      },
      run: (reason, _v, form) => {
        runBackend(actions.fixI6Integrity(issue.code, {
          zh: form?.zh || "",
          en: form?.en || "",
        }, reason), `${issue.kind} ${issue.cnt} 处已修复 · 待重扫确认`);
      },
    });

  /* ============ tutorial actions ============ */
  const pubCrs = (c: Course) =>
    openActionConfirm({
      action: <>发布课程新版 · {c.title}</>,
      detail: (
        <>
          分类「{c.cat}」 · 奖励 {c.reward} NEX/课。定版发布至 /learn;受 B1 红线约束(本次只发布版本,不涨奖励,不挂 amplifies)。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.publishI6Course(c.id, reason), `${c.title} 已发布至 /learn`);
      },
    });

  // 唯一 amplifies = 课程奖励调整。
  const adjRwd = (c: Course) =>
    openActionConfirm({
      action: <>课程奖励调整 · {c.title}</>,
      detail: (
        <>
          分类「{c.cat}」完成 NEX 奖励调整 ·{" "}
          <b>放大 NEX 流出,受 B1 兑付覆盖率红线约束</b>。后端会在提交时校验覆盖率,不达标直接拒绝。
        </>
      ),
      amplifies: true,
      edit: { kind: "text", current: String(c.reward), unit: "NEX/课" },
      run: (reason, v) => {
        if (!v) return;
        const def = findHighOp("i7_course_reward_adjust")!;
        void propose(toast, {
          action: `课程奖励调整 · ${c.title}`,
          obj: c.id,
          before: `${c.reward} NEX/课`,
          after: `${v} NEX/课`,
          type: "fund",
          amplifies: true,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "I7",
          command: def.buildCommand({ courseId: c.id, rewardNex: Number(v) }),
          target: def.buildTarget({ courseId: c.id }),
        });
      },
    });

  const archiveCrs = (c: Course) =>
    openActionConfirm({
      action: <>下架课程 · {c.title}</>,
      detail: (
        <>
          下架后 /learn 不再展示该课;已开课用户保留进度,但完成奖励不再发放。常规换版直接发新版,只有正文/合规问题才下架。
        </>
      ),
      amplifies: false,
      run: (reason) => {
        runBackend(actions.archiveI6Course(c.id, reason), `${c.title} 下架已确认生效`);
      },
    });

  const newCrs = () =>
    openActionConfirm({
      action: <>新建课程(存为草稿)</>,
      detail: (
        <>
          填 slug / 分类 / 形式 / 难度 / 奖励({TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} NEX 区间内);标题正文另在词条库(I6)建双语词条。草稿不对外,发布需操作确认。
        </>
      ),
      amplifies: false,
      businessForm: {
        kind: "course-authoring",
        rewardMin: TUTORIAL_REWARD_RANGE.min,
        rewardMax: TUTORIAL_REWARD_RANGE.max,
        categories: courseCategories,
      },
      run: (reason, slug, form) => {
        const id = slug?.trim() || "new";
        const title = form?.titleZh?.trim() || id;
        const category = form?.category || courseCategories[0] || "Basics";
        const reward = Number(form?.reward);
        runBackend(actions.createI6Course(id, {
          titleZh: form?.titleZh || title,
          titleEn: form?.titleEn || title,
          bodyZh: form?.bodyZh || "",
          bodyEn: form?.bodyEn || "",
          category,
          format: form?.format || "Article",
          difficulty: form?.difficulty || "Beginner",
          rewardNex: Number.isFinite(reward) ? reward : TUTORIAL_REWARD_RANGE.min,
          duration: form?.duration || "5 min",
          publishState: form?.publishState || "draft",
        }, reason), "课程草稿已建 · 发布需操作确认");
      },
    });

  const setFeat = () => {
    const cur = liveFeatured();
    openActionConfirm({
      action: <>更换推荐位课程</>,
      detail: (
        <>
          推荐位是首页大卡的单一展示位 · 换课等于改变所有用户的首页主推教程,操作确认;新课 id 填入「目标新值」(必须是已发布课程)。
        </>
      ),
      amplifies: false,
      edit: { kind: "text", current: cur, unit: "课程 id" },
      run: (reason, v) => {
        if (!v) return;
        // audit P1 修:换课必须是「已发布课程 id」(SPEC §4 + 设计稿文案承诺);
        // 校验失败拒写并 toast 提示,防 dev/操作员误输入空字符串/已下架课程让首页大卡指向死链。
        const target = COURSES.find((c) => c.id === v.trim());
        if (!target) { toast(`课程 id ${v} 不存在 · 未执行`); return; }
        if (liveStatus(target) === "archived") { toast(`${v} 已下架 · 不可作为推荐位 · 未执行`); return; }
        runBackend(actions.updateI6FeaturedCourse(v.trim(), reason), `推荐位已更换为 ${v} · 已写审计`);
      },
    });
  };

  /* ============ render helpers ============ */
  const renderCoverage = (n: Namespace) => {
    if (n.coverage === 100) return <span className="in-full">100% ✓</span>;
    return (
      <>
        <span className="in-cov">
          <i style={{ width: n.coverage + "%" }} />
        </span>
        <span
          className="mono"
          style={{ fontSize: 11.5, marginLeft: 7, color: "var(--warning)" }}
        >
          {n.coverage}%
        </span>
      </>
    );
  };

  if (contentLoading && !data) {
    return <section className="l-card"><div className="l-b"><div className="itint">{view === "i18n" ? "I6" : "I7"} 数据加载中...</div></div></section>;
  }
  if (!data) {
    return <section className="l-card"><div className="l-b"><div className="itint danger">{view === "i18n" ? "I6" : "I7"} 暂无真实接口数据</div></div></section>;
  }

  /* ============ render ============ */
  return (
    <>
      {view === "i18n" && <>
      <div className="f-stats">
        <div className="f-stat">
          <div className="k">受管词条</div>
          <div className="v">
            {I6_STATS.managedKeys} / {I6_STATS.totalKeys}
          </div>
          <div className="sub">30+ 命名空间 × en/zh</div>
        </div>
        <div className={`f-stat ${liveIntegrity === 0 ? "ok" : "warn"}`}>
          <div className="k">完整性问题</div>
          <div className="v">{liveIntegrity} 处</div>
          <div className="sub">{liveIntegritySub}</div>
        </div>
      </div>

      {/* (I6 · a) 命名空间矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">命名空间矩阵(I6 · a)</span>
          <span className="sub">· 30+ 命名空间 × en/zh · 选展示 12 个</span>
          <div className="r chips">
            {NS_FLT.map(([k, l]) => (
              <button
                key={k}
                className={`chip${nsFlt === k ? " sel" : ""}`}
                onClick={() => setNsFlt(k)}
              >
                {l}
              </button>
            ))}
            {canWriteI6 && <button className="l-btn sm" onClick={rescan}>
              重扫
            </button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>命名空间</th>
                <th className="num">key 数</th>
                <th>覆盖</th>
                <th className="num">缺 key</th>
                <th>进行中变体</th>
                <th>最近改动</th>
              </tr>
            </thead>
            <tbody>
              {filteredNs.map((n) => {
                const missing = Math.round((n.keys * (100 - n.coverage)) / 100);
                return (
                  <tr
                    key={n.ns}
                    className="click"
                    onClick={() =>
                      setNsDrawer({
                        ns: n.ns,
                        keys: n.keys,
                        cov: n.coverage,
                        variants: n.variants,
                      })
                    }
                  >
                    <td>
                      <span className="ns-name">{n.ns}</span>
                    </td>
                    <td className="num mono">{n.keys}</td>
                    <td>{renderCoverage(n)}</td>
                    <td
                      className="num mono"
                      style={{ color: missing > 0 ? "var(--warning)" : "var(--ink-4)" }}
                    >
                      {missing > 0 ? missing : "—"}
                    </td>
                    <td
                      style={{
                        fontSize: 12,
                        color:
                          n.variants === "—" ? "var(--ink-4)" : "var(--i-ac)",
                      }}
                    >
                      {n.variants}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {n.lastChange}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td
                  colSpan={6}
                  style={{
                    fontSize: 11.5,
                    color: "var(--ink-4)",
                    textAlign: "center",
                  }}
                >
                  … 共 30+ 命名空间 · 768 词条(全站 ~770)
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        {/* (I6 · b) 词条详情 · milestones.earnCross 演示位 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">
              词条详情 · <span className="icode electric">{HCB_KEY}</span>
            </span>
            <div className="r">
              {!canWriteI6 && <span className="bdg dim">只读</span>}
              {canWriteI6 && <>
              <button className="l-btn sm" onClick={editKeyDraft}>
                编辑(中英同步)
              </button>
              <button className="l-btn sm mc" onClick={pubKey}>
                发布
              </button>
              <button className="l-btn sm mc" onClick={mkAB}>
                开 marketing 多版 A/B
              </button>
              </>}
            </div>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            <div className="ab-grid">
              <div className="ab-prev">
                <div className="lc">EN · v4 生效中</div>
                <div className="tx">
                  You just crossed <em>{"{amount}"}</em> in lifetime earnings —{" "}
                  <em>{"{nex}"}</em> NEX is on its way 🎉
                </div>
              </div>
              <div className="ab-prev">
                <div className="lc">ZH · v4 生效中</div>
                <div className="tx">
                  累计收益突破 <em>{"{amount}"}</em>!奖励 <em>{"{nex}"}</em> NEX 马上到账 🎉
                </div>
              </div>
            </div>
            <div className="itint ok" style={{ marginTop: 8 }}>
              <b>占位符校验通过</b> · 两边都用了{" "}
              <span className="mono">{"{amount}"}</span> 和{" "}
              <span className="mono">{"{nex}"}</span>,词序不同没关系;少一个多一个,发布按钮直接被服务器拒。
            </div>
            {hcbDraftZh && hcbDraftEn && (
              <div className="itint cyan" data-proof="i18n-draft-preview" style={{ marginTop: 8 }}>
                <b>当前草稿回显</b> · 状态 <span className="mono">{hcbStatus ?? "draft"}</span>
                <div className="ab-grid" style={{ marginTop: 8 }}>
                  <div className="ab-prev">
                    <div className="lc">ZH · draft</div>
                    <div className="tx">{hcbDraftZh}</div>
                  </div>
                  <div className="ab-prev">
                    <div className="lc">EN · draft</div>
                    <div className="tx">{hcbDraftEn}</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 完整性扫描卡 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">
              完整性扫描 · {liveIntegrity} 处问题
            </span>
            <span className="sub">· 缺镜像 / 占位符 / 疑似硬编码 / 禁词</span>
          </div>
          <div className="l-b" style={{ paddingTop: 6 }}>
            {INTEGRITY_ISSUES.map((iss) => (
              <div key={iss.kind} style={{ marginBottom: 12 }}>
                <div
                  className="row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <b style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{iss.kind}</b>
                  <span className="bdg warn">{iss.cnt}</span>
                </div>
                {iss.samples.map((s, j) => (
                  <div
                    key={j}
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-3)",
                      paddingLeft: 4,
                      lineHeight: 1.6,
                    }}
                  >
                    · {s}
                  </div>
                ))}
                {canWriteI6 && <button
                  className="l-btn sm mc"
                  style={{ marginTop: 6 }}
                  onClick={() => fixIntegrity(iss)}
                >
                  修复
                </button>}
              </div>
            ))}
            <button
              className="l-btn sm"
              style={{ marginTop: 4 }}
              onClick={() => setHcDrawer(true)}
            >
              疑似硬编码清单(App 扫描)
            </button>
          </div>
        </section>
      </div>

      </>}

      {view === "learn" && <>
      <div className="f-stats">
        <div className="f-stat cyan">
          <div className="k">课程在线</div>
          <div className="v">{I6_STATS.coursesOnline} 门</div>
          <div className="sub">{courseCategoryCount} 分类 · 推荐位 {TUTORIAL_FEATURED_DEFAULT ? 1 : 0} 个</div>
        </div>
        <div className="f-stat">
          <div className="k">课程 NEX 派发(本周)</div>
          <div className="v">{I6_STATS.weeklyNexPayout}</div>
          <div className="sub">完成发奖 · 喂流出口径(B1)</div>
        </div>
      </div>

      {/* I7 教程列表 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">教程中心(I7) · /learn · {allCourses.length} 课</span>
          <span className="sub">
            · {courseCategoryCount} 分类 · 学完发 NEX · 涨奖励过 B1 红线
          </span>
          <div className="r chips">
            {categoryFilters.map(([k, l]) => (
              <button
                key={k}
                className={`chip${catFlt === k ? " sel" : ""}`}
                onClick={() => setCatFlt(k)}
              >
                {l}
              </button>
            ))}
            {!canWriteI7 && <span className="bdg dim">只读</span>}
            {canWriteI7 && <button className="l-btn sm primary" onClick={newCrs}>
              + 新建课程
            </button>}
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead>
              <tr>
                <th>课程</th>
                <th>分类</th>
                <th>形式</th>
                <th>难度</th>
                <th className="num">奖励</th>
                <th>推荐位</th>
                <th>时长</th>
                <th>状态</th>
                <th style={{ textAlign: "right" }}></th>
              </tr>
            </thead>
            <tbody>
              {filteredCrs.map((c) => {
                const st = liveStatus(c);
                const archived = st === "archived";
                const isDraft = st === "draft" || st === "ready";
                const featuredId = liveFeatured();
                const isFeatured = featuredId === c.id;
                return (
                  <tr key={c.id} style={archived ? { opacity: 0.55 } : undefined}>
                    <td>
                      <div style={{ fontWeight: 600, color: "var(--ink)" }}>
                        {c.title}
                      </div>
                      <span
                        className="mono"
                        style={{
                          fontSize: 11,
                          color: "var(--ink-4)",
                        }}
                      >
                        {c.id}
                      </span>
                    </td>
                    <td>
                      <span className="bdg dim">
                        {c.icon} {c.cat}
                      </span>
                    </td>
                    <td>
                      <span className="bdg dim">{c.format}</span>
                    </td>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {c.level}
                    </td>
                    <td
                      className="num mono"
                      style={{ color: "var(--i-ac)", fontWeight: 700 }}
                    >
                      {liveReward(c)}
                    </td>
                    <td>
                      {isFeatured ? (
                        <span className="bdg cyan">FEATURED</span>
                      ) : (
                        <span style={{ color: "var(--ink-4)" }}>—</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {c.duration}
                    </td>
                    <td>
                      {archived ? (
                        <span className="bdg dim">已下架</span>
                      ) : isDraft ? (
                        <span className="bdg warn">{st}</span>
                      ) : (
                        <span className="bdg ok">published</span>
                      )}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {canWriteI7 && <>
                      <button
                        className="l-btn sm mc"
                        onClick={() => pubCrs(c)}
                        style={{ marginRight: 6 }}
                      >
                        发布
                      </button>
                      {!archived && (
                        <button
                          className="l-btn sm"
                          onClick={() => archiveCrs(c)}
                        >
                          下架
                        </button>
                      )}
                      </>}
                      {canAdjustI7Reward && (
                        <button
                          className="l-btn sm mc"
                          onClick={() => adjRwd(c)}
                          style={{ marginRight: 6 }}
                        >
                          调奖励
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!contentLoading && filteredCrs.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ padding: 28, textAlign: "center", color: "var(--ink-4)" }}>
                    暂无课程数据
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="two-col">
        {/* I6 推荐位 + 奖励区间 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">推荐位 + 单课奖励区间</span>
            <span className="sub">· 单一位置,换课走操作确认</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="in-vrow">
              <span className="nm">
                推荐位课程(首页大卡)
                <small>
                  当前固定第 1 课「What is Nexion · 5 分钟速成」· 单一位置,换课走操作确认
                </small>
              </span>
              <span className="v">{liveFeatured()}</span>
              {canWriteI7 && <button className="l-btn sm mc" onClick={setFeat}>
                换推荐课
              </button>}
            </div>
            <div className="in-vrow">
              <span className="nm">
                单课奖励区间
                <small>权威口径 10–50 NEX;单课精确值在课程行上调</small>
              </span>
              <span className="v">
                {TUTORIAL_REWARD_RANGE.min}–{TUTORIAL_REWARD_RANGE.max} NEX
              </span>
            </div>
          </div>
        </section>

        {/* I7 课程效果监控 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">课程效果监控</span>
            <span className="sub">
              · 只读 · 数字喂 BI(L 域)+ D 对账 + B1 流出
            </span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
              }}
            >
              {TUTORIAL_METRICS.map((m) => (
                <div key={m.k}>
                  <div
                    style={{
                      fontSize: 11.5,
                      color: "var(--ink-4)",
                      marginBottom: 4,
                    }}
                  >
                    {m.k}
                  </div>
                  <div
                    className="mono"
                    style={{
                      fontSize: 22,
                      fontWeight: 700,
                      color: "var(--ink)",
                      letterSpacing: "-.01em",
                    }}
                  >
                    {m.v}
                  </div>
                </div>
              ))}
            </div>
            <div className="itint" style={{ marginTop: 10 }}>
              <b>事件去向</b> · 开课/完课/测验通过喂数据 BI(L 域:完课率、参与深度、回访贡献)和实时漏斗(教育→转化间接归因);完成发的 NEX 进资金对账(D)和流出监控(B1)。课程类事件的归类登记(learn 域)是 BI 上线前必办工单,占位期按临时编号入库(§2.4.3)。
            </div>
          </div>
        </section>
      </div>

      </>}

      <p className="f-foot">
        {view === "i18n" ? <><b>执行门槛</b>:词条草稿保存即校验镜像与占位符并留审计；词条发布/回滚需内容主管或超管确认。<b>底座地位</b>:I1、I2、I4 与 I7 的可见文案都使用这里的双语词条。</> : <><b>执行门槛</b>:课程草稿可保存；发布、下架、换推荐课需内容主管或超管确认。<b>课程奖励上调</b>必须走高敏审批并通过 B1 备付金红线校验。</>}
      </p>
      <PaginationExemptionList
        items={view === "i18n" ? [
          {
            label: "命名空间矩阵(I6 · a)",
            kind: "reference-catalog",
            maxRows: 13,
            reason: "命名空间固定十三组,需要同屏核对覆盖率和缺 key",
          },
        ] : [
          {
            label: `教程中心(I7) · /learn · ${allCourses.length} 课`,
            kind: "reference-catalog",
            maxRows: Math.max(1, allCourses.length),
            reason: `课程目录来自真实接口,当前 ${allCourses.length} 门;创建新课走草稿流`,
          },
        ]}
      />

      {view === "i18n" && nsDrawer && (
        <Drawer
          title={`命名空间 · ${nsDrawer.ns}`}
          onClose={() => setNsDrawer(null)}
        >
          <div
            className="tint brand"
            style={{ marginBottom: 14, padding: "11px 14px", borderRadius: 9 }}
          >
            <div
              style={{ fontWeight: 600, color: "var(--ink)", fontSize: 13 }}
            >
              {nsDrawer.keys} 个词条 · zh 覆盖 {nsDrawer.cov}%
              {nsDrawer.variants !== "—"
                ? ` · ${nsDrawer.variants} 进行中`
                : ""}
            </div>
            <div
              className="muted tiny"
              style={{ marginTop: 4, fontSize: 11.5, color: "var(--ink-4)" }}
            >
              词条按 key 组织,App 端按「空间 × 语言」整包拉取当前发布版。
            </div>
          </div>
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="l-tbl" style={{ minWidth: 420 }}>
              <thead>
                <tr>
                  <th>key</th>
                  <th>en</th>
                  <th>zh</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    `${nsDrawer.ns}.title`,
                    "(published v3)",
                    "(published v3)",
                  ],
                  [
                    `${nsDrawer.ns}.subtitle`,
                    "(published v2)",
                    "(published v2)",
                  ],
                  [
                    `${nsDrawer.ns}.ctaLabel`,
                    "(published v4)",
                    "(published v4)",
                  ],
                ].map((row) => (
                  <tr key={row[0]}>
                    <td className="mono" style={{ fontSize: 12 }}>
                      {row[0]}
                    </td>
                    <td style={{ fontSize: 12 }}>{row[1]}</td>
                    <td style={{ fontSize: 12 }}>{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="itint"
            style={{ fontSize: 12, lineHeight: 1.6 }}
          >
            点「词条详情」卡可中英并排编辑;缺镜像的词条在完整性校验表里列着,补齐前发不了版。
          </div>
        </Drawer>
      )}

      {view === "i18n" && hcDrawer && (
        <Drawer
          title="疑似硬编码清单(App 扫描)"
          onClose={() => setHcDrawer(false)}
        >
          <div style={{ overflowX: "auto", marginBottom: 12 }}>
            <table className="l-tbl" style={{ minWidth: 480 }}>
              <thead>
                <tr>
                  <th>位置</th>
                  <th>裸文案</th>
                  <th>建议词条</th>
                </tr>
              </thead>
              <tbody>
                {HARDCODED_FINDINGS.map((row) => (
                  <tr key={row.location}>
                    <td style={{ fontSize: 12 }}>{row.location}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      {row.rawCopy}
                    </td>
                    <td
                      className="mono"
                      style={{ fontSize: 11.5, color: "var(--i-ac)" }}
                    >
                      {row.suggestedKey}
                    </td>
                  </tr>
                ))}
                {HARDCODED_FINDINGS.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: "var(--ink-4)", fontSize: 12, textAlign: "center" }}>
                      暂无疑似硬编码
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="itint" style={{ fontSize: 12, lineHeight: 1.6 }}>
            <b>硬编码</b> = 没走词条系统的裸文案,只有一种语言。处置:建词条(双语)→ 替换引用 → 重扫清零。
          </div>
        </Drawer>
      )}
    </>
  );
}
