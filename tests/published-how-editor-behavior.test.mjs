import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/components/domain-views/published-how-content-editor.tsx", import.meta.url), "utf8");
const output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const block = () => ({ id: "intro", kind: "text", title: "Introduction", body: "Reviewed explanation." });
const locale = () => ({ blocks: [block()] });
const document = () => ({ version: "draft-1", status: "DRAFT", revision: 7, hasPublishedVersion: true,
  contents: { "team-binary-how": { locales: { zh: locale(), vi: locale() } } } });

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
    if (name === "@/lib/admin/published-content-client") return {
      fetchHowContentAdmin: async () => { fetches++; if (transport.beforeFetch) await transport.beforeFetch(fetches); return structuredClone(server); },
      updateHowContentAdmin: async (payload, reason) => { writes.push({ payload: structuredClone(payload), reason }); if (transport.beforeSave) await transport.beforeSave(); server = { ...payload, revision: server.revision + 1 }; return structuredClone(server); },
    };
    throw new Error(`Unexpected import ${name}`);
  }, exports);
  function render() { cursor = 0; tree = exports.PublishedHowContentEditor(); }
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

test("partial documents open their actual page and preserve its selected locale on refresh", async () => {
  const ui = await mount();
  assert.equal(ui.field("How content key").props.value, "team-binary-how");
  assert.equal(ui.field("How content locale").props.value, "zh");
  await ui.change("How content locale", "vi"); await ui.click("刷新");
  assert.equal(ui.field("How content key").props.value, "team-binary-how");
  assert.equal(ui.field("How content locale").props.value, "vi");
});

test("operators can add/delete blocks and type list items without JSON", async () => {
  const ui = await mount();
  await ui.click("新增内容块");
  assert.equal(ui.nodes().filter(n => n.type === "button" && n.props.children === "删除内容块").length, 2);
  await ui.change("类型", "list");
  await ui.change("列表项 1", "[normal typing is retained");
  assert.equal(ui.field("列表项 1").props.value, "[normal typing is retained");
  await ui.click("新增列表项"); await ui.change("列表项 2", "second item");
  assert.equal(ui.field("列表项 2").props.value, "second item");
  await ui.click("删除内容块");
  assert.equal(ui.nodes().filter(n => n.type === "button" && n.props.children === "删除内容块").length, 1);
  assert.equal(ui.button("删除内容块").props.disabled, true);
});

test("changing a rule-reference block to text removes the incompatible reference", async () => {
  const doc = document(); const item = doc.contents["team-binary-how"].locales.zh.blocks[0];
  Object.assign(item, { kind: "ruleRef", ref: { source: "canonical", key: "F.binary.matchRate", version: "v1" }, body: "Rate {value}" });
  const ui = await mount(doc);
  await ui.change("规则键", "F.binary.threshold");
  await ui.change("引用版本", "v2");
  await ui.change("类型", "text");
  await ui.change("变更理由", "Independent editor regression"); await ui.click("保存并回读");
  assert.equal(ui.writes.length, 1);
  assert.ok(!("ref" in ui.writes[0].payload.contents["team-binary-how"].locales.zh.blocks[0]));
});

test("refreshing a dirty draft asks before discarding and cancellation preserves input", async () => {
  const previousWindow = globalThis.window; let prompts = 0;
  globalThis.window = { confirm: () => { prompts++; return false; } };
  try {
    const ui = await mount(); await ui.change("版本", "unsaved-change");
    const before = ui.fetches(); await ui.click("刷新");
    assert.equal(prompts, 1); assert.equal(ui.fetches(), before);
    assert.equal(ui.field("版本").props.value, "unsaved-change");
  } finally { globalThis.window = previousWindow; }
});

test("failed refresh preserves the last readable server document", async () => {
  const ui = await mount(document(), { beforeFetch: count => { if (count > 1) throw new Error("OFFLINE"); } });
  await ui.click("刷新"); await ui.flush();
  assert.equal(ui.field("版本").props.value, "draft-1");
  assert.match(ui.text(), /OFFLINE/);
});

test("CAS conflict retains the draft and original revision for recovery", async () => {
  const ui = await mount(document(), { beforeSave: () => { throw new Error("CONFIG_REVISION_CONFLICT"); } });
  await ui.change("版本", "local-change"); await ui.change("变更理由", "Independent conflict regression");
  await ui.click("保存并回读"); await ui.flush();
  assert.equal(ui.field("版本").props.value, "local-change");
  assert.equal(ui.writes[0].payload.revision, 7);
  assert.match(ui.text(), /当前未保存内容已保留/);
});

test("pending save locks edits and refresh and blocks rapid duplicate submissions", async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const ui = await mount(document(), { beforeSave: () => pending });
  await ui.change("版本", "pending-change"); await ui.change("变更理由", "Independent pending regression");
  const save = ui.button("保存并回读"); save.props.onClick(); save.props.onClick(); await ui.flush();
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.field("版本").props.disabled, true);
  assert.equal(ui.button("刷新").props.disabled, true);
  assert.equal(ui.button("新增内容块").props.disabled, true);
  release(); await ui.flush(); await ui.flush();
  assert.equal(ui.field("版本").props.value, "pending-change");
  assert.equal(ui.button("刷新").props.disabled, false);
});

test("block and list size limits match the server and empty documents retain CAS revision", async () => {
  const doc = document();
  doc.contents["team-binary-how"].locales.zh.blocks = Array.from({ length: 200 }, (_, i) => ({ ...block(), id: `b-${i}` }));
  Object.assign(doc.contents["team-binary-how"].locales.zh.blocks[0], { kind: "list", items: Array(50).fill("item") });
  const ui = await mount(doc);
  assert.equal(ui.button("新增内容块").props.disabled, true);
  assert.equal(ui.button("新增列表项").props.disabled, true);
  const empty = await mount({ ...document(), contents: {}, revision: 19 });
  await empty.change("版本", "empty-recovery"); await empty.change("变更理由", "Independent empty regression");
  await empty.click("保存并回读"); await empty.flush();
  assert.equal(empty.writes[0].payload.revision, 19);
});

test("editable IDs retain DOM identity, deletion retains survivor keys and moves focus", async () => {
  const doc = document();
  doc.contents["team-binary-how"].locales.zh.blocks.push({ ...block(), id: "second" }, { ...block(), id: "third" });
  const ui = await mount(doc);
  const keys = () => ui.nodes().filter(n => n.type === "div" && n.props.className === "l-card").map(n => n.key);
  const initialKeys = keys();
  await ui.change("ID", "changed-id"); assert.deepEqual(keys(), initialKeys);
  let focused = 0;
  ui.nodes().find(n => n.props.children === "结构化内容块").props.ref.current = { focus: () => { focused++; } };
  await ui.click("删除内容块");
  assert.deepEqual(keys(), initialKeys.slice(1)); assert.equal(focused, 1);
  await ui.change("类型", "list");
  await ui.change("列表项 1", "first"); await ui.click("新增列表项"); await ui.change("列表项 2", "second");
  const listKeys = () => ui.nodes().filter(n => String(n.key).startsWith("how-item-")).map(n => n.key);
  const originalListKeys = listKeys();
  await ui.change("列表项 1", "typed"); assert.deepEqual(listKeys(), originalListKeys);
  await ui.click("删除列表项");
  assert.deepEqual(listKeys(), originalListKeys.slice(1)); assert.equal(focused, 2);
  assert.equal(ui.field("列表项 1").props.value, "second");
});
