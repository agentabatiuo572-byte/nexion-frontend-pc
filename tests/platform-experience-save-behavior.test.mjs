import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/components/domain-views/a-tabs/platform-experience-config.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const document = () => ({ version: 10, baseUrl: "https://app.uvel.ai/ref/", channels: [], appDownload: { officialUrl: "https://uvel.ai/", iosUrl: "", androidUrl: "", apkUrl: "", version: "1.0.0", releaseNotes: { zh: "正式发布", en: "Release" }, source: "official" }, homeNewcomerTasksEnabled: true, homeWeeklyPromoEnabled: false, ready: true, sources: [] });
// Render the real TSX and run its handlers with isolated React hooks and transport.
// API writes below are in-memory fixtures, never the running business service.
async function mount(initial = document(), transport = {}) {
  const slots = []; const effects = []; let cursor = 0; let tree;
  let server = structuredClone(initial); const writes = []; let fetches = 0;
  const react = {
    useState(value) { const id = cursor++; if (!(id in slots)) slots[id] = typeof value === "function" ? value() : value;
      return [slots[id], next => { slots[id] = typeof next === "function" ? next(slots[id]) : next; }]; },
    useRef(value) { const [ref] = react.useState({ current: value }); return ref; },
    useMemo(fn, deps) { const id = cursor++; if (!slots[id] || deps.some((v, i) => v !== slots[id].deps[i])) slots[id] = { value: fn(), deps }; return slots[id].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const id = cursor++; if (!slots[id] || deps.some((v, i) => v !== slots[id][i])) { slots[id] = deps; effects.push(fn); } },
  };
  const exports = {};
  new Function("require", "exports", output)(name => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return require(name);
    if (name === "@/lib/store/admin-auth") return { useAdminAuth: fn => fn({ session: { role: "superadmin", username: "reviewer" } }) };
    if (name === "@/lib/admin/error-messages") return { displayAdminError: e => e.message };
    if (name === "next/link") return { default: props => props.children };
    if (name === "@/app/components/domain-views/published-content-editor") return { PublishedContentEditor: () => null };
    if (name === "@/app/components/domain-views/published-how-content-editor") return { PublishedHowContentEditor: () => null };
    if (name === "@/lib/admin/platform-experience-client") return { recommendedExperienceChannels: () => [],
      fetchPlatformExperienceConfig: async () => { fetches++; if (transport.beforeFetch) await transport.beforeFetch(fetches); return structuredClone(server); },
      updatePlatformExperienceConfig: async (payload, reason) => { writes.push({ payload: structuredClone(payload), reason }); if (transport.beforeSave) await transport.beforeSave(); server = { ...payload, version: server.version + 1 }; return structuredClone(server); },
    };
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  function render() { cursor = 0; tree = exports.PlatformExperienceConfig(); }
  async function flush() { render(); for (const effect of effects.splice(0)) effect(); await Promise.resolve(); await Promise.resolve(); render(); }
  function nodes(node = tree) {
    if (Array.isArray(node)) return node.flatMap(n => nodes(n));
    if (!node || typeof node !== "object") return [];
    if (typeof node.type === "function") return nodes(node.type(node.props));
    return [node, ...nodes(node.props?.children ?? null)];
  }
  function text(node) { if (Array.isArray(node)) return node.map(text).join(""); if (node == null || typeof node === "boolean") return ""; return typeof node === "object" ? text(node.props?.children) : String(node); }
  function button(label) { const found = nodes().find(n => n.type === "button" && text(n) === label); assert.ok(found, `Missing button: ${label}`); return found; }
  function field(label) {
    const direct = nodes().find(n => ["input", "select", "textarea"].includes(n.type) && n.props["aria-label"] === label);
    if (direct) return direct;
    const parent = nodes().find(n => n.type === "label" && text(n).startsWith(label));
    const found = parent && nodes(parent).find(n => ["input", "select", "textarea"].includes(n.type));
    assert.ok(found, `Missing field: ${label}`); return found;
  }
  async function change(label, value) { field(label).props.onChange({ target: { value } }); await flush(); }
  async function click(label) { const target = button(label); assert.ok(!target.props.disabled, `Disabled button: ${label}`); target.props.onClick(); await flush(); }
  await flush();
  return { button, field, click, change, flush, nodes, text: () => text(tree), writes, fetches: () => fetches };
}

test("short reason shows an error beside the enabled save button", async () => {
  const ui = await mount(); await ui.change("体验配置保存理由", "1"); await ui.click("保存并回读");
  assert.equal(ui.writes.length, 0);
  const alert = ui.nodes().find(n => n.props?.role === "alert");
  assert.match(alert.props.children, /8–200/);
  assert.ok(ui.nodes().indexOf(alert) > ui.nodes().indexOf(ui.button("保存并回读")));
});
test("successful save confirms the version and exact anchor", async () => {
  const ui = await mount(); await ui.change("官方安装链接", "https://uvel.ai/#download");
  await ui.change("体验配置保存理由", "更新官网的下载区域链接"); await ui.click("保存并回读");
  assert.equal(ui.writes[0].payload.appDownload.officialUrl, "https://uvel.ai/#download");
  assert.equal(ui.field("官方安装链接").props.value, "https://uvel.ai/#download");
  assert.equal(ui.field("体验配置保存理由").props.value, "");
  assert.match(ui.nodes().find(n => n.props?.role === "status").props.children, /已保存并回读.*v11/);
});
test("failed save preserves input, displays the error, and allows recovery", async () => {
  const ui = await mount(document(), { beforeSave: () => { throw new Error("当前配置已更新，请刷新后核对"); } });
  await ui.change("官方安装链接", "https://uvel.ai/#download"); await ui.change("体验配置保存理由", "更新官网的下载区域链接"); await ui.click("保存并回读");
  assert.equal(ui.field("官方安装链接").props.value, "https://uvel.ai/#download");
  assert.equal(ui.field("体验配置保存理由").props.value, "更新官网的下载区域链接");
  assert.match(ui.nodes().find(n => n.props?.role === "alert").props.children, /当前配置已更新/);
  assert.ok(!ui.nodes().some(n => n.props?.role === "status"));
  assert.equal(ui.button("保存并回读").props.disabled, false);
});
