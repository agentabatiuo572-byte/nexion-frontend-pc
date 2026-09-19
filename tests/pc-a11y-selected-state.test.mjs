/**
 * 互斥筛选 / 控件可访问名的**真实组件渲染**验收(#157 #158 #159 #161 #166)。
 *
 * 证据来源两类,都是真跑而不是读源码猜:
 *  1. 真渲染:按本仓既有先例(tests/f4-quota-criteria-behavior.test.mjs)用 TypeScript 转译
 *     + react-dom/server 渲染真实组件,从产出的 DOM 上读 role / aria-selected / aria-label /
 *     aria-labelledby / tabindex —— 这些正是读屏读的东西。
 *  2. 真模块:TabGroup 的键盘移动规则走 lib 形态的纯函数,直接跑真实现验证方向键语义。
 *
 * 不连后端、不登录、不写任何服务。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const nodeRequire = createRequire(import.meta.url);

/** 按本仓先例转译并加载 TS/TSX 模块图;local 依赖按相对/别名解析,裸包走 node require。 */
function loadModuleGraph() {
  const cache = new Map();
  // 写权限门控的组件(如 K1/K2 的调整按钮)只在会话带对应 authority 时渲染。
  // zustand v5 在服务端渲染走 getInitialState(),setState 到不了 SSR —— 所以把测试会话
  // 作为**初始状态**建一个真 zustand store,组件读到的就是真会话分支。
  const { create } = nodeRequire("zustand");
  const fixtureSession = {
    isAuthenticated: true,
    role: "superadmin",
    operator: "fixture",
    session: {
      adminId: 1, username: "superadmin", operator: "fixture", role: "superadmin",
      authorities: [
        "emergency_j3_export", "emergency_j3_alert_config",
        "risk_k1_read", "risk_k1_write", "risk_k1_cluster_flag", "risk_k1_cluster_freeze",
        "risk_k1_cluster_release", "risk_k1_cluster_cleared",
        "risk_k2_write", "risk_k4_write", "risk_k4_user_override", "risk_k4_user_recompute",
        "user_c2_read", "user_c2_account_freeze",
      ],
    },
  };
  const authStub = { useAdminAuth: create(() => ({ ...fixtureSession })) };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", "module", output)((name) => {
      // 样式与 Next 运行时只影响呈现/路由,与可访问语义无关;给最小替身,别把整条模块图带进来。
      if (name.endsWith(".css")) return {};
      if (name === "@/lib/store/admin-auth") return authStub;
      if (name === "next/link") return { default: ({ href, children }) => React.createElement("a", { href: typeof href === "string" ? href : "#" }, children) };
      if (name === "next/navigation") {
        return {
          useRouter: () => ({ replace: () => {}, push: () => {}, back: () => {}, forward: () => {}, refresh: () => {}, prefetch: () => {} }),
          useSearchParams: () => new URLSearchParams(),
          usePathname: () => "/fixture",
          useParams: () => ({}),
        };
      }
      if (!name.startsWith("@/") && !name.startsWith(".")) return nodeRequire(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
      assert.ok(resolved, `local dependency missing: ${name} (from ${path.relative(root, filename)})`);
      return load(resolved);
    }, module.exports, module);
    return module.exports;
  }
  return {
    load,
    TabGroup: load(path.join(root, "app/components/kit/tab-group.tsx")).TabGroup,
    nextTabValue: load(path.join(root, "app/components/kit/tab-group-keyboard.ts")).nextTabValue,
  };
}

const { load, TabGroup, nextTabValue } = loadModuleGraph();

/** 渲染一个真实组件并把 HTML 转成可查询的 DOM 结构(jsdom 不在依赖里,用手写的最小解析)。 */
function renderToHtml(componentPath, exportName, props) {
  const Component = load(path.join(root, componentPath))[exportName];
  assert.equal(typeof Component, "function", `${componentPath} 必须导出 ${exportName}`);
  return renderToStaticMarkup(React.createElement(Component, props));
}

/**
 * 极简 HTML 元素扫描:本仓组件产出的是结构规整的 JSX,只需读出每个标签的
 * role / aria-* / tabindex / 文本,足以断言可访问语义。
 */
function elements(html) {
  const found = [];
  const tag = /<([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>/g;
  let match;
  while ((match = tag.exec(html)) !== null) {
    const attrs = {};
    for (const attr of match[2].matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) attrs[attr[1]] = attr[2];
    for (const attr of match[2].matchAll(/(?:^|\s)([\w:-]+)(?=\s|$)/g)) attrs[attr[1]] ??= "";
    const body = html.slice(match.index + match[0].length);
    const text = body.slice(0, body.indexOf("</" + match[1]) === -1 ? 200 : body.indexOf("</" + match[1]));
    found.push({ tag: match[1], attrs, text: text.replace(/<[^>]*>/g, "") });
  }
  return found;
}

const roleOf = (html, role) => elements(html).filter((element) => element.attrs.role === role);
const byAria = (html, name) => elements(html).filter((element) => element.attrs["aria-label"] === name);
/** 组名:优先 aria-label,其次 aria-labelledby 指向的可见文本。 */
const groupName = (html, element) => {
  if (element.attrs["aria-label"]) return element.attrs["aria-label"];
  const id = element.attrs["aria-labelledby"];
  if (!id) return "";
  return elements(html).find((candidate) => candidate.attrs.id === id)?.text.trim() ?? "";
};
const tablists = (html) => elements(html).filter((element) => element.attrs.role === "tablist");
const tablistNamed = (html, name) => tablists(html).filter((list) => groupName(html, list) === name);
/** 取某个 tablist 内的全部 tab(按文档顺序,到下一个 tablist 为止)。 */
function tabsOf(html, listName) {
  const all = elements(html);
  const start = all.findIndex((element) => element.attrs.role === "tablist" && groupName(html, element) === listName);
  assert.ok(start >= 0, `未找到组名为「${listName}」的 tablist`);
  const tabs = [];
  for (let i = start + 1; i < all.length; i += 1) {
    if (all[i].attrs.role === "tablist") break;
    if (all[i].attrs.role === "tab") tabs.push(all[i]);
  }
  return tabs;
}
const selectedFlags = (tabs) => tabs.map((tab) => tab.attrs["aria-selected"]);
const tabIndexes = (tabs) => tabs.map((tab) => Number(tab.attrs.tabindex));

/** 每个组必须恰好一个选中项,且 roving tabindex 只给选中项。 */
function assertSingleSelection(html, name, expectedIndex, expectedLabels) {
  const tabs = tabsOf(html, name);
  assert.deepEqual(
    tabs.map((tab) => tab.text.trim()),
    expectedLabels,
    `「${name}」的项与顺序必须保持原样`,
  );
  const flags = selectedFlags(tabs);
  assert.equal(flags.filter((value) => value === "true").length, 1, `「${name}」同一时刻只能有一个选中项,实际 ${JSON.stringify(flags)}`);
  assert.equal(flags.indexOf("true"), expectedIndex, `「${name}」的选中项必须是第 ${expectedIndex} 项,实际 ${JSON.stringify(flags)}`);
  const indexes = tabIndexes(tabs);
  assert.deepEqual(indexes.map((value) => (value === 0 ? 0 : -1)), expectedIndex === -1 ? indexes.map(() => -1) : expectedIndex === 0 ? [0, ...indexes.slice(1).map(() => -1)] : indexes.map((_v, i) => (i === expectedIndex ? 0 : -1)), `「${name}」的 roving tabindex 必须落在选中项上,实际 ${JSON.stringify(indexes)}`);
  return tabs;
}

// ── #157 J3 篡改防御:24h/7d/30d 时间范围 ────────────────────────────────────
test("J3 时间范围是带组名的单选组,默认 24h 唯一选中且键盘可移动", () => {
  const tamper = {
    window: "24h",
    hasData: true,
    stats: { deltaPrevPct: 12, highFrequencyAccounts: 2 },
    trend: {
      "24h": { pts: [1, 2, 3], points: [1, 2, 3], max: 3, labels: ["00", "12", "23"] },
      "7d": { pts: [4, 5, 6], points: [4, 5, 6], max: 6, labels: ["一", "四", "日"] },
      "30d": { pts: [7, 8, 9], points: [7, 8, 9], max: 9, labels: ["1", "15", "30"] },
    },
    paths: [], accounts: [],
    accountPage: { page: 1, pageSize: 5, total: 0, pages: 1, hasPrev: false, hasNext: false },
    coverage: { status: "complete", registeredCount: 3, activeCount: 3, registeredPaths: [], activePaths: [], missingPaths: [] },
    alertConfig: { threshold: 5, label: "基准", feedK4: true, effectiveThreshold: 5, effectiveLabel: "生效", sevenDayAlertAccounts: 1, sevenDayPreviewByThreshold: {} },
    sources: ["nx_tamper_events"],
  };
  const html = renderToHtml("app/components/domain-views/j-tabs/j3-tamper.tsx", "J3Tamper", {
    ctx: {
      pget: () => undefined, params: {}, setParam: () => {}, toast: () => {}, openActionConfirm: () => {},
      emergency: { tamper }, contentLoading: false, contentError: null,
      actions: { loadJ3TamperPage: async () => tamper, reloadJEmergency: async () => {} },
    },
  });
  assert.equal(tablistNamed(html, "篡改趋势时间范围").length, 1, "J3 时间范围必须暴露组名");
  assertSingleSelection(html, "篡改趋势时间范围", 0, ["24h", "7d", "30d"]);
  // 键盘语义走真实现。
  const items = ["24h", "7d", "30d"];
  assert.equal(nextTabValue(items, "24h", "ArrowRight"), "7d", "方向键必须移到下一项");
  assert.equal(nextTabValue(items, "30d", "ArrowRight"), "24h", "方向键必须环绕");
  assert.equal(nextTabValue(items, "24h", "ArrowLeft"), "30d", "左方向键必须环绕到末项");
  assert.equal(nextTabValue(items, "7d", "Home"), "24h", "Home 必须到首项");
  assert.equal(nextTabValue(items, "7d", "End"), "30d", "End 必须到末项");
  assert.equal(nextTabValue(items, "7d", "a"), null, "其它按键不得改变选中态");
  assert.equal(nextTabValue([], "24h", "ArrowRight"), null, "空组不得越界");
});

// ── #158 K4 风险评分:五个输入源开关 ─────────────────────────────────────────
test("K4 五个输入源开关各自带上所属维度,不再同名", () => {
  const names = { multiAccount: "多账户", arbitrage: "套利与刷量", withdrawVelocity: "提现速度", accountAge: "账户年龄", abnormal: "异常行为" };
  const model = {
    version: 3, rowVersion: 3, state: "active",
    weights: Object.fromEntries(Object.keys(names).map((key) => [key, 20])),
    inputSources: Object.fromEntries(Object.keys(names).map((key) => [key, true])),
    scoreMappings: {}, bandLowMax: 30, bandHighMin: 70, autoEscalateScore: 85,
    reason: "fixture", createdBy: "fixture", publishedBy: "fixture", createdAt: "2026-09-20T00:00:00",
  };
  const html = renderToHtml("app/components/domain-views/k-tabs/k4-scoring.tsx", "K4Scoring", {
    ctx: {
      pget: () => undefined, params: {}, setParam: () => {}, toast: () => {}, openActionConfirm: () => {}, openConfirm: () => {},
      contentLoading: false, contentError: null, reloadKRisk: async () => {}, refreshK4Scoring: async () => {}, actions: {},
      risk: {
        scoring: {
          model, draft: null, modelHistory: [],
          dimensions: Object.entries(names).map(([dimKey, name]) => ({ dimKey, name, source: "nx_risk_signals", weightPct: 20 })),
          config: { inputSources: { ...model.inputSources }, bandLowMax: 30, bandHighMin: 70, autoEscalateScore: 85 },
          distribution: [], totalUsers: 0, recomputePending: 0,
          overrides: { records: [], total: 0, page: 1, pageSize: 5, pages: 1 }, overrideActive: 0,
        },
      },
    },
  });
  const checkboxes = elements(html).filter((element) => element.tag === "input" && element.attrs.type === "checkbox");
  assert.equal(checkboxes.length, 5, `K4 必须有五个输入源开关,实际 ${checkboxes.length}`);
  const labels = checkboxes.map((box) => box.attrs["aria-label"]);
  assert.deepEqual(
    labels.sort(),
    ["多账户输入源", "套利与刷量输入源", "提现速度输入源", "账户年龄输入源", "异常行为输入源"].sort(),
    "五个开关的可访问名必须各自带上所属维度",
  );
  assert.equal(new Set(labels).size, 5, "五个可访问名必须互不相同(修前是五个同名「输入源已启用」)");
  assert.equal(checkboxes.every((box) => "checked" in box.attrs), true, "checked 状态必须暴露");
});

// ── #161 M2 工单台:状态筛选 + 搜索框 ────────────────────────────────────────
test("M2 状态筛选暴露组名与唯一选中项,搜索框有稳定可访问名", () => {
  const html = renderToHtml("app/components/domain-views/m-tabs/m2-tickets.tsx", "M2Tickets", {
    ctx: {
      pget: (key) => (key.endsWith("Available") ? "1" : undefined),
      params: {}, setParam: async () => true, toast: () => {}, openActionConfirm: () => {}, openConfirm: () => {},
    },
  });
  assert.equal(tablistNamed(html, "工单范围筛选").length, 1, "M2 状态筛选必须暴露组名");
  const tabs = tabsOf(html, "工单范围筛选");
  assert.deepEqual(selectedFlags(tabs), ["true", "false", "false", "false"], "M2 默认「活跃」必须是唯一选中项");
  assert.equal(tabs[0].text.includes("活跃"), true);
  const search = elements(html).find((element) => element.attrs["data-proof"] === "support-ticket-search");
  assert.ok(search, "搜索框必须存在");
  assert.equal(search.attrs["aria-label"], "搜索工单主题、单号、负责人、分类或用户编码", "搜索框必须有稳定可访问名");
  assert.match(search.attrs.placeholder, /搜索主题 \/ 单号 \/ 负责人 \/ 分类 \/ 用户编码/, "可访问名必须与可见提示一致");
});

// ── #166 K1 / K2 参数操作按钮 ───────────────────────────────────────────────
test("K1 每个参数调整按钮的可访问名唯一标识目标参数", () => {
  const param = (key, name, value, unit, sub) => ({ key, name, value, val: value, unit, sub, version: 1, adjustable: true });
  const html = renderToHtml("app/components/domain-views/k-tabs/k1-multiaccount.tsx", "K1MultiAccount", {
    ctx: {
      pget: () => undefined, params: {}, setParam: () => {}, toast: () => {}, openActionConfirm: () => {}, openConfirm: () => {},
      contentLoading: false, contentError: null, reloadKRisk: async () => {}, refreshK4Scoring: async () => {}, actions: {},
      risk: {
        multiAccount: {
          serverCanonical: true, domain: "K1", sources: ["nx_risk_clusters"],
          stats: { activeClusters: 1, flaggedAccounts: 2, highClusters: 0, frozenClusters: 0, frozenAccounts: 0 },
          params: [
            param("maxSignupPerIp24h", "同 IP 24h 最大注册数", "3", "个", "范围 1-10"),
            param("maxAccountsPerDevice", "同设备最大账户数", "2", "个", "范围 1-5"),
            param("maxAccountsPerPaymentInstrument", "同支付工具最大账户数", "2", "个", "范围 1-5"),
            param("linkWeight", "关联权重", "设备 0.50 · 支付 0.40 · IP 0.10", "", "三项总和必须为 1"),
            param("clusterFreezeSuggestThreshold", "冻结建议阈值", "0.7", "", "范围 0-1"),
          ],
          releaseParams: [param("releaseReviewStartAccount", "待审起点", "3", "个", "第 N 个账号起进入审核中")],
          clusters: { records: [], total: 0, page: 1, pageSize: 5, pages: 1 },
          whitelist: { records: [], total: 0, page: 1, pageSize: 5, pages: 1 },
        },
      },
    },
  });
  const buttons = elements(html).filter((element) => element.tag === "button" && element.text.trim() === "调整");
  assert.ok(buttons.length >= 5, `K1 参数区必须有多个调整按钮,实际 ${buttons.length}`);
  const names = buttons.map((button) => button.attrs["aria-label"]);
  assert.ok(names.every(Boolean), `每个调整按钮都必须带可访问名,实际 ${JSON.stringify(names)}`);
  assert.equal(new Set(names).size, names.length, `每个调整按钮必须唯一标识目标参数,实际 ${JSON.stringify(names)}`);
  assert.ok(names.includes("调整同 IP 24h 最大注册数"), `按钮名必须含参数名,实际 ${JSON.stringify(names)}`);
  assert.ok(names.every((name) => name.startsWith("调整")), "按钮名必须同时含动作与参数");
});

test("K2 每个参数调整按钮的可访问名唯一标识目标参数", () => {
  const param = (key, name, value, unit, sub) => ({ key, name, value, val: value, unit, sub, version: 1, adjustable: true });
  const html = renderToHtml("app/components/domain-views/k-tabs/k2-arbitrage.tsx", "K2Arbitrage", {
    ctx: {
      pget: () => undefined, params: {}, setParam: () => {}, toast: () => {}, openActionConfirm: () => {}, openConfirm: () => {},
      contentLoading: false, contentError: null, reloadKRisk: async () => {}, refreshK4Scoring: async () => {}, actions: {},
      risk: {
        arbitrage: {
          serverCanonical: true, domain: "K2", stats: [], sources: ["nx_risk_arbitrage"],
          params: [
            param("trialCycleThreshold", "试用循环异常线", ">= 3 次 / 30 天", "", "同一实体反复开试用"),
            param("welcomeGiftAnomalyThreshold", "新人礼异常发放线", ">= 3 笔 / 实体", "", "重复领取新人礼"),
            param("leaderboardVelocityMultiplier", "刷榜增速倍数", ">= 3x 基线", "", "增长速度相对基线"),
            param("otpGate.resendSeconds", "验证码重发冷却", "60", "秒", "冷却窗口"),
            param("otpGate.dayLimit", "验证码 24h 发送上限", "10", "次/24h", "日上限"),
            param("otpGate.otpTtlSeconds", "验证码有效期", "300", "秒", "有效期"),
            param("otpGate.maxVerifyAttempts", "最多输错次数", "5", "次", "输错上限"),
            param("captchaGate.alwaysScenes", "每次都要求滑块的场景", "register", "场景", "滑块场景"),
            param("captchaGate.afterSends", "累计发送后要求滑块", "3", "次/24h", "累计阈值"),
          ],
          views: [
            { key: "trial", label: "试用循环", sub: "反复开试用", head: [], note: "", rows: [] },
            { key: "tradein", label: "换新套利", sub: "高频下架置换", head: [], note: "", rows: [] },
          ],
        },
      },
    },
  });
  const buttons = elements(html).filter((element) => element.tag === "button" && element.text.trim() === "调整");
  assert.ok(buttons.length >= 9, `K2 参数区必须有多个调整按钮,实际 ${buttons.length}`);
  const names = buttons.map((button) => button.attrs["aria-label"]);
  assert.ok(names.every(Boolean), `每个调整按钮都必须带可访问名,实际 ${JSON.stringify(names)}`);
  assert.equal(new Set(names).size, names.length, `每个调整按钮必须唯一标识目标参数,实际 ${JSON.stringify(names)}`);
});

// ── #159 互斥筛选:L / K6 / A9 / E4 各组唯一选中项 ───────────────────────────
test("A9 开发者访问状态筛选是带组名的单选组,默认 PENDING", () => {
  const html = renderToStaticMarkup(React.createElement(TabGroup, {
    label: "开发者访问申请状态筛选",
    value: "PENDING",
    items: ["", "PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"],
    onSelect: () => {},
    itemClassName: () => "btn sm",
  }, (value) => value || "全部"));
  assert.equal(tablistNamed(html, "开发者访问申请状态筛选").length, 1);
  const tabs = tabsOf(html, "开发者访问申请状态筛选");
  assert.deepEqual(tabs.map((tab) => tab.text.trim()), ["全部", "PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"]);
  assert.deepEqual(selectedFlags(tabs), ["false", "true", "false", "false", "false", "false"], "A9 默认 PENDING 必须是唯一选中项");
  assert.deepEqual(tabIndexes(tabs), [-1, 0, -1, -1, -1, -1], "roving tabindex 只给选中项");
});

test("TabGroup 支持可见组标签并把它作为组名(不抄第二份字符串)", () => {
  const html = renderToStaticMarkup(React.createElement(TabGroup, {
    label: "时间窗",
    labelClassName: "lb",
    value: "7d",
    items: ["1d", "7d", "30d"],
    onSelect: () => {},
    itemClassName: (_value, selected) => `chip${selected ? " sel" : ""}`,
  }, (value) => value));
  const list = tablists(html)[0];
  assert.equal(groupName(html, list), "时间窗", "可见标签文本必须同时成为组名");
  assert.equal(elements(html).some((element) => element.text.trim() === "时间窗"), true, "可见标签必须仍然渲染出来");
  const tabs = tabsOf(html, "时间窗");
  assert.deepEqual(selectedFlags(tabs), ["false", "true", "false"]);
  assert.deepEqual(tabIndexes(tabs), [-1, 0, -1]);
});

test("TabGroup 跳过 disabled 项并保持 roving 焦点可达", () => {
  const html = renderToStaticMarkup(React.createElement(TabGroup, {
    label: "加载中的组",
    value: "b",
    items: ["a", "b", "c"],
    disabled: () => true,
    onSelect: () => {},
  }, (value) => value));
  const tabs = tabsOf(html, "加载中的组");
  assert.equal(tabs.every((tab) => "disabled" in tab.attrs), true, "整组禁用时每项都必须 disabled");
  assert.equal(tabIndexes(tabs).filter((value) => value === 0).length, 0, "无可选项时不得有 roving 焦点落点");
});

test("L1 时间窗 / cohort 粒度 / KPI 卡 / 叠加选择都暴露选中态", () => {
  const kpis = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
    n, kpiId: String(n), name: `指标 ${n}`, target: 50, dir: "gte", unit: "%", available: true,
    value: 60 + n, numerator: 100 + n, denominator: 200, spark: [1, 2, 3, 4, 5, 6],
  }));
  const html = renderToHtml("app/components/domain-views/l-tabs/l1-kpi.tsx", "L1Kpi", {
    ctx: {
      toast: () => {}, openActionConfirm: () => {}, canExport: false, biLoading: false, biError: null,
      biData: {
        l1: {
          module: "L1", kpis, weeks: ["W1", "W2", "W3", "W4", "W5", "W6"], phaseSwitchIndex: 2,
          kpiColors: ["#111", "#222", "#333", "#444", "#555", "#666", "#777", "#888"],
          kpiPlain: Object.fromEntries(kpis.map((kpi) => [String(kpi.n), `口径 ${kpi.n}`])),
          kpiExt: Object.fromEntries(kpis.map((kpi) => [String(kpi.n), { fx: "A / B", fxBold: [], num: "1", den: "2", delta: "1.0", note: "说明", jump: [] }])),
          currentPhase: { code: "P3", month: 5 },
        },
      },
    },
  });
  assert.equal(tablistNamed(html, "时间窗").length, 1, "L1 时间窗必须暴露组名");
  assertSingleSelection(html, "时间窗", 1, ["当日", "滚动 7d", "滚动 30d", "自定义"]);
  assert.equal(tablistNamed(html, "cohort 粒度").length, 1, "L1 cohort 粒度必须暴露组名");
  assertSingleSelection(html, "cohort 粒度", 0, ["注册周 YYYY-Www", "注册月"]);
  const cards = elements(html).filter((element) => (element.attrs.class ?? "").includes("kpi-card"));
  assert.equal(cards.length, 8, `L1 必须渲染八张 KPI 卡,实际 ${cards.length}`);
  assert.equal(cards.every((card) => card.attrs["aria-pressed"] !== undefined), true, "八张 KPI 卡必须暴露选中态");
  assert.equal(cards.filter((card) => card.attrs["aria-pressed"] === "true").length, 1, "同一时刻只能有一张 KPI 卡选中");
  const overlayPicks = elements(html).filter((element) => (element.attrs.class ?? "").includes("chip") && element.attrs["aria-pressed"] !== undefined);
  assert.ok(overlayPicks.length >= 8, "叠加选择是多选组,必须暴露 aria-pressed");
});

test("L2 cohort 粒度 / 漏斗阶段 / 对比 / 指标各自唯一选中项", () => {
  const stageEvents = ["auth.register_completed", "checkout.completed", "wallet.reinvest / 二次 checkout.completed", "withdraw.submitted"];
  const html = renderToHtml("app/components/domain-views/l-tabs/l2-funnel.tsx", "L2Funnel", {
    ctx: { toast: () => {}, openActionConfirm: () => {}, canExport: false, biLoading: false, biError: null, biData: { l2: {
      module: "L2", stageEvents,
      funnel: ["注册", "首购", "复投", "提现"].map((stage, i) => ({ stage, lc: `L${i + 1}`, color: "#123456", users: 1000 - i * 100, cvr: i === 0 ? null : 50 + i, ev: stageEvents[i], source: `nx_event_outbox:${stageEvents[i]}` })),
      funnelExt: ["注册", "首购", "复投", "提现"].map((stage) => ({ plain: `${stage}口径`, inflow: "—", lost: "—", dwell: [1, 2, 3, 4, 5, 6, 7, 8], note: "说明", tg: null, trial: false, v1: false })),
      cohorts: [
        { w: "2026-W01", size: 100, d1: 60, d7: 50, d14: 40, d30: 30, d60: 20 },
        { w: "2026-W02", size: 120, d1: 61, d7: 51, d14: 41, d30: 31, d60: 21 },
      ],
      monthlyCohorts: [],
      curves: { "2026-W01": [[1, 60], [7, 50], [14, 40], [30, 30], [60, 20]], "2026-W02": [[1, 61], [7, 51], [14, 41], [30, 31], [60, 21]] },
      crossAnalysis: Object.fromEntries(["cvr", "ret", "trial"].map((key) => [key, { columns: ["vi", "th"], rows: [["P3", 10, 20, 15]], alert: [0, 0], unit: "%", msg: { pre: "说明", bold: "重点", post: "" }, message: "说明" }])),
      quality: { sameUserJoin: true, stageOrderEnforced: true, incompleteRatesAreNull: true },
      trialSteps: [],
    } } },
  });
  assert.equal(tablistNamed(html, "cohort 粒度").length, 1, "L2 cohort 粒度必须暴露组名");
  assertSingleSelection(html, "cohort 粒度", 0, ["注册周 YYYY-Www", "注册月"]);
  assert.equal(tablistNamed(html, "漏斗阶段下钻").length, 1, "L2 漏斗阶段必须暴露组名");
  const stages = tabsOf(html, "漏斗阶段下钻");
  assert.equal(stages.length, 4, `L2 漏斗必须四级,实际 ${stages.length}`);
  assert.equal(selectedFlags(stages).filter((value) => value === "true").length, 1, "L2 漏斗阶段同一时刻只有一个选中项");
  assert.equal(tabIndexes(stages).filter((value) => value === 0).length, 1, "roving 焦点只落在一个阶段上");
  assert.equal(tablistNamed(html, "指标").length, 1, "L2 交叉分析指标必须暴露组名");
  assert.equal(tablistNamed(html, "对比").length, 1, "L2 对比 cohort 必须暴露组名");
  assert.equal(elements(html).filter((element) => (element.attrs.class ?? "").includes("chip") && element.attrs["aria-pressed"] !== undefined).length >= 5, true, "留存窗是多选组,必须暴露 aria-pressed");
});

test("L4 报表周期是单选组而不是四个独立 checkbox,四类报表也暴露组名", () => {
  const html = renderToHtml("app/components/domain-views/l-tabs/l4-ops.tsx", "L4Ops", {
    ctx: {
      toast: () => {}, openActionConfirm: () => {}, biLoading: false, biError: null, l4Query: { period: "week", phase: "ALL" },
      biData: { l4: {
        available: true, period: { key: "week", label: "本周", from: "2026-09-14", to: "2026-09-20" }, phaseFilter: "ALL",
        device: { summary: { periodPurchasedDevices: 1, periodRetiredDevices: 0, periodLockedDevices: 0, periodFirstYieldDevices: 1, dailyYieldUsdt: 1, dailyYieldNex: 1, degradationLossUsdt: 0, activeDevices: 3 }, byGeneration: [], byModel: [], degradation: [] },
        tasks: { summary: { dispatched: 2, completed: 1, acceptanceRate: 50, queueSaturation: 10, checkinActive: 1, orderedTaskJoin: true }, byTier: [] },
        network: { summary: { directRefs: 1, commissionEvents: 2, commissionPaidUsdt: 1, teamGmvUsdt: 1, promotionRate: 10, commissionTriggerRate: 10 }, teamSizeDist: [], vRankDist: [], commissionStructure: [] },
        phaseEffect: ["P1", "P2", "P3", "P4", "P5", "P6"].map((phase) => ({ phase, activeUsers: 1, retentionRate: 10, conversionRate: 10, yieldUsdt: 1, transitionCount: 0, dialChangeCount: 0, conversionStepPct: 0 })),
        history: [{ bucket: "2026-09-14", devicePurchases: 1, deviceRetirements: 0, yieldUsdt: 1, tasksCompleted: 1, directRefs: 1, commissionPaidUsdt: 1 }],
        quality: { serverCanonical: true, sameActorRates: true, actorCoveragePct: 100, incompleteRatesAreNull: true, eventCount: 5, duplicateEventsIgnored: 0, businessTimeZone: "UTC+08:00" },
        liveFacts: { activeUserDevices: 10, teamRelationships: 20 },
      } },
    },
  });
  const period = tablistNamed(html, "报表周期");
  assert.equal(period.length, 1, "L4 报表周期必须是带组名的单选组(修前是四个独立 checkbox)");
  const periodTabs = tabsOf(html, "报表周期");
  assert.deepEqual(selectedFlags(periodTabs).filter((value) => value === "true").length, 1, "报表周期同一时刻只有一个选中项");
  assert.equal(periodTabs[selectedFlags(periodTabs).indexOf("true")].text.trim(), "周", "L4 默认「周」");
  assert.equal(tablistNamed(html, "L4 四类运营报表").length, 1, "L4 四类报表必须暴露组名");
});

test("L5 导出任务状态筛选暴露组名与唯一选中项", () => {
  const html = renderToHtml("app/components/domain-views/l-tabs/l5-export.tsx", "L5Export", {
    ctx: { toast: () => {}, openActionConfirm: () => {}, canExport: false, biLoading: false, biError: null, biData: { l5: {
      summary: { totalReports: 1, readyReports: 1, sensitiveReports: 0, pendingConfirm: 0, legacyReadyWithoutSnapshot: 0 },
      exportTasks: [], maskRules: [], exportParams: [], auditRows: [], crossModuleBlockers: [], statusLabels: {},
    } } },
  });
  assert.equal(tablistNamed(html, "导出任务状态筛选").length, 1, "L5 任务状态筛选必须暴露组名");
  assertSingleSelection(html, "导出任务状态筛选", 0, ["全部", "待确认", "生成中", "已就绪（含历史）"]);
});

test("K1 去重维度筛选是单选组而不是四个独立 checkbox", () => {
  const param = (key, name, value, unit, sub) => ({ key, name, value, val: value, unit, sub, version: 1, adjustable: true });
  const html = renderToHtml("app/components/domain-views/k-tabs/k1-multiaccount.tsx", "K1MultiAccount", {
    ctx: {
      pget: () => undefined, params: {}, setParam: () => {}, toast: () => {}, openActionConfirm: () => {}, openConfirm: () => {},
      contentLoading: false, contentError: null, reloadKRisk: async () => {}, refreshK4Scoring: async () => {}, actions: {},
      risk: { multiAccount: {
        serverCanonical: true, domain: "K1", sources: ["nx_risk_clusters"],
        stats: {}, params: [param("clusterFreezeSuggestThreshold", "冻结建议阈值", "0.7", "", "范围 0-1")], releaseParams: [],
        clusters: { records: [], total: 0, page: 1, pageSize: 5, pages: 1 },
        whitelist: { records: [], total: 0, page: 1, pageSize: 5, pages: 1 },
      } },
    },
  });
  assert.equal(tablistNamed(html, "去重命中维度筛选").length, 1, "K1 去重维度必须是带组名的单选组(修前是四个独立 checkbox)");
  assertSingleSelection(html, "去重命中维度筛选", 0, ["全部", "IP", "设备指纹", "支付工具"]);
});

test("K2 检测命中视图是带组名的单选组", () => {
  const html = renderToHtml("app/components/domain-views/k-tabs/k2-arbitrage.tsx", "K2Arbitrage", {
    ctx: {
      pget: () => undefined, params: {}, setParam: () => {}, toast: () => {}, openActionConfirm: () => {}, openConfirm: () => {},
      contentLoading: false, contentError: null, reloadKRisk: async () => {}, refreshK4Scoring: async () => {}, actions: {},
      risk: { arbitrage: {
        serverCanonical: true, domain: "K2", stats: [], params: [], sources: ["nx_risk_arbitrage"],
        views: [
          { key: "trial", label: "试用循环", sub: "反复开试用", head: [], note: "", rows: [] },
          { key: "tradein", label: "换新套利", sub: "高频下架置换", head: [], note: "", rows: [] },
          { key: "gift", label: "新人礼刷取", sub: "重复领取", head: [], note: "", rows: [] },
          { key: "board", label: "排行榜刷榜", sub: "增速异常", head: [], note: "", rows: [] },
        ],
      } },
    },
  });
  assert.equal(tablistNamed(html, "套利检测命中视图").length, 1, "K2 检测视图必须暴露组名");
  assertSingleSelection(html, "套利检测命中视图", 0, ["试用循环", "换新套利", "新人礼刷取", "排行榜刷榜"]);
});

test("K6 模块导航暴露组名与唯一选中项", () => {
  const html = renderToHtml("app/components/domain-views/k-tabs/k6-janus-c2.tsx", "K6JanusC2", {});
  assert.equal(tablistNamed(html, "C2 控制台模块").length, 1, "K6 模块导航必须暴露组名");
  const tabs = tabsOf(html, "C2 控制台模块");
  assert.deepEqual(selectedFlags(tabs), ["true", "false", "false", "false", "false"], "K6 默认「看板」是唯一选中项");
  assert.deepEqual(tabIndexes(tabs), [0, -1, -1, -1, -1], "roving 焦点落在选中模块");
});

test("E4 订单状态筛选暴露组名与唯一选中项", () => {
  const html = renderToHtml("app/components/domain-views/e-tabs/e4-orders.tsx", "E4Orders", {
    ctx: {
      orders: [], e4Keyword: "", setE4Keyword: () => {}, e4Filter: "all", setE4Filter: () => {},
      e4Loading: false, e4Error: null, e4Page: 1, e4Total: 0, orderState: () => "placed", openOrder: () => {},
    },
  });
  assert.equal(tablistNamed(html, "订单状态筛选").length, 1, "E4 订单状态筛选必须暴露组名");
  const tabs = tabsOf(html, "订单状态筛选");
  assert.equal(tabs[0].text.trim(), "全部");
  assert.deepEqual(selectedFlags(tabs), tabs.map((_tab, index) => (index === 0 ? "true" : "false")), "E4 同一时刻只有一个选中项");
});
