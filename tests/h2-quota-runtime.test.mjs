import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const jsx = require("react/jsx-runtime");
const render = require("react-dom/server").renderToStaticMarkup;
const source = readFileSync(new URL("../app/components/domain-views/h-tabs/h2-trial.tsx", import.meta.url), "utf8");

function harness({ writable = true, model = null } = {}) {
  const writes = [], dialogs = [], toasts = [];
  let reloads = 0, hook = 0;
  const context = {
    exports: {},
    require(name) {
      if (name === "react/jsx-runtime") return jsx;
      if (name === "react") return {
        useState: initial => [hook++ === 0 && model ? model : initial === true ? false : initial, () => {}],
        useRef: initial => ({ current: initial }),
        useCallback: fn => fn,
        useMemo: fn => fn(),
        useEffect() {},
      };
      if (name === "../design-kit") return { DataListPager: () => null };
      if (name === "@/lib/admin/h-client") return {
        updateH2TrialParam: async (...args) => { writes.push(args); },
        fetchH2Trials: async () => { throw new Error("unexpected read"); },
        killH2AutoPush: async () => { throw new Error("unexpected command"); },
      };
      if (name === "@/lib/admin/use-propose") return { usePropose: () => () => {} };
      if (name === "@/lib/admin/high-ops-registry") return { findHighOp: () => null };
      if (name === "@/lib/admin/error-messages") return {
        displayAdminError: String,
        formatAdminApiError: (value, fallback) => value || fallback,
      };
      throw new Error(`unexpected import: ${name}`);
    },
  };
  const compiled = ts.transpileModule(`${source}\nexports.ParamRow = ParamRow;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  runInNewContext(compiled.outputText, context);
  const ctx = {
    can: () => writable,
    toast: message => toasts.push(message),
    openActionConfirm: dialog => dialogs.push(dialog),
    openConfirm: dialog => dialogs.push(dialog),
  };
  return {
    writes, dialogs, toasts,
    get reloads() { return reloads; },
    row: param => context.exports.ParamRow({ ctx, param, trialProducts: [], onChanged: async () => { reloads++; } }),
    page: () => { hook = 0; return context.exports.H2Trial({ ctx }); },
  };
}

function walk(node) {
  if (!node || typeof node !== "object") return [];
  return [node, ...[node.props?.children].flat(Infinity).flatMap(walk)];
}

const configured = { key: "seatsLeftToday", name: "每日免费名额上限", cur: "47", section: "live", readOnly: false };
const actual = {
  key: "actualSeatsLeftToday", name: "今日实际剩余免费名额", cur: "46", section: "live", readOnly: true,
  sub: "按试用业务日实时读取，与 App 使用同一名额计数", businessDate: "2026-10-11",
};

test("H2 shows configured 47 and canonical 46 with units; actual counter cannot open a mutation", () => {
  const h = harness();
  const limit = h.row(configured), remaining = h.row(actual);
  assert.match(render(limit), /每日免费名额上限/);
  assert.match(render(limit), /47 张/);
  assert.match(render(remaining), /今日实际剩余免费名额/);
  assert.match(render(remaining), /46 张/);
  assert.match(render(remaining), /业务日期 2026-10-11/);
  const button = walk(remaining).find(node => node.type === "button");
  assert.equal(button.props.disabled, true);
  button.props.onClick();
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.writes.length, 0);
});

test("H2 retains zero and UNKNOWN without replacing either with the configured limit", () => {
  for (const cur of ["0", "UNKNOWN"]) {
    const h = harness(), row = h.row({ ...actual, cur, readOnly: false });
    const html = render(row);
    assert.match(html, cur === "0" ? /0 张/ : /UNKNOWN（暂不可用）/);
    assert.doesNotMatch(html, /47 张/);
    const button = walk(row).find(node => node.type === "button");
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    assert.equal(h.dialogs.length, 0);
    assert.equal(h.writes.length, 0);
  }
});

test("H2 obeys readOnly metadata and permission checks before opening any write dialog", () => {
  for (const [writable, param] of [
    [true, { key: "shadowDailyUSD", name: "收益", cur: "1", hot: true, readOnly: true, sub: "服务端计算，只读" }],
    [false, configured],
  ]) {
    const h = harness({ writable }), row = h.row(param);
    const button = walk(row).find(node => node.type === "button");
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    assert.equal(h.dialogs.length, 0);
    assert.equal(h.writes.length, 0);
    if (param.readOnly) assert.equal(button.props.title, param.sub);
  }
});

test("H2 retains the existing editable limit contract, validation and post-write reload", async () => {
  const h = harness(), row = h.row(configured);
  const button = walk(row).find(node => node.type === "button");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(h.dialogs.length, 1);
  const dialog = h.dialogs[0];
  assert.equal(dialog.edit.kind, "number");
  assert.equal(dialog.edit.current, "47");
  assert.equal(dialog.edit.unit, "张");
  for (const invalid of ["47.5", "4.7E1", "-1", "1000001"]) await dialog.run("调整每日名额上限", invalid);
  assert.equal(h.writes.length, 0);
  await dialog.run("调整每日名额上限", " 48 ");
  assert.deepEqual(h.writes, [["seatsLeftToday", "48", "调整每日名额上限"]]);
  assert.equal(h.reloads, 1);
});

test("H2 drops retired autocharge from both sections and defensively refuses a stale row", () => {
  const retired = { key: "autoChargeAtEnd", name: "到期自动扣款", cur: "开", hot: true };
  const h = harness({ model: {
    params: [configured, actual, { ...retired, section: "newonly" }, { ...retired, section: "live" }],
    gates: [], states: [], sessions: [], stats: {},
  } });
  assert.equal(h.row(retired), null);
  const rows = walk(h.page()).filter(node => node.props?.param).map(node => node.props.param.key);
  assert.deepEqual(rows, ["seatsLeftToday", "actualSeatsLeftToday"]);
  assert.equal(h.dialogs.length, 0);
  assert.equal(h.writes.length, 0);
});
