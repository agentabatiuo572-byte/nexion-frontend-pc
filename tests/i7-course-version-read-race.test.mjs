// Complete production component/read client with deterministic hook/effect adapters.
// No browser/reconciler or live HTTP; only deferred in-memory readonly GETs.
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Isolated candidates may reuse existing installed packages, never source files.
const dependencyRoot = process.env.NEXION_PC_TEST_DEPENDENCY_ROOT || root;
const dependencyRequire = createRequire(path.join(dependencyRoot, 'package.json'));
const ts = dependencyRequire('typescript');
const React = dependencyRequire('react');
const jsx = dependencyRequire('react/jsx-runtime');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const emitted = [], results = [];
let networkAttempts = 0;

// No native transport is imported/called. Only these two read-only URL shapes
// may reach a deferred in-memory Response; every other method/URL throws.
function runtime() {
  const requests = [], cache = new Map(), toasts = [];
  let engine;
  const session = { adminId: 11, username: 'fixture_A', operator: 'fixture_A', role: 'auditor',
    authorities: ['content_i6_read', 'content_i7_read'], menuCodes: ['I', 'I6'] };
  const auth = { session, authEpoch: 1, operator: session.operator, isAuthenticated: true, sessionResolution: 'authenticated' };
  const nativeFake = (input, init = {}) => {
    const url = String(input), method = (init.method || 'GET').toUpperCase();
    if (method !== 'GET' || !/^\/api\/admin\/content\/i18n-learning\/(messages|courses)\/[^/]+\/versions$/.test(url)) {
      networkAttempts++;
      throw new Error('FIXTURE_FORBIDDEN_TRANSPORT');
    }
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    requests.push({ url, method, resolve, reject, done: false });
    return promise;
  };
  const window = { location: { href: 'https://fixture.invalid/content/i18n', origin: 'https://fixture.invalid' }, fetch: nativeFake };
  const context = vm.createContext({ console, Response, Request, Headers, URL, AbortSignal, Error, Date,
    setTimeout, clearTimeout, crypto: global.crypto, window,
    fetch: (...args) => window.fetch(...args) });
  const forbid = () => { throw new Error('FIXTURE_WRITE_OR_UNTESTED_DEPENDENCY_FORBIDDEN'); };
  const pendingStore = { get: forbid, remember: forbid, forget: forbid };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const raw = fs.readFileSync(path.join(root, relative), 'utf8');
    const suffix = relative.endsWith('i6-i18n.tsx') ? '\nexports.__I18nLearningPage=I18nLearningPage;\n' : '';
    const output = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} }; cache.set(relative, module.exports);
    const imports = name => {
      if (name === 'react') return { ...React,
        useState: initial => engine.useState(initial),
        useEffect: (run, deps) => engine.useEffect(run, deps) };
      if (name === 'react/jsx-runtime') return jsx;
      if (name === '@/lib/store/admin-auth') return { useAdminAuth: selector => selector(auth) };
      if (name === '@/lib/admin/use-propose') return { usePropose: () => forbid };
      if (name === '@/lib/admin/high-ops-registry') return { findHighOp: forbid };
      if (name === '@/lib/admin/error-messages') return load('lib/admin/error-messages.ts');
      if (name === '@/lib/admin/outcome-classification') return { outcomeStaysUnknown: forbid };
      if (name === '@/lib/admin/current-operator') return { currentAdminOperator: forbid };
      if (name === '@/lib/admin/i-overview-contract') return { parseIOverview: forbid };
      if (name === '@/lib/admin/pending-mutation-store') return { createPendingMutationStore: () => pendingStore };
      if (name === '../design-kit') return { Drawer: p => jsx.jsx('aside', p), PaginationExemptionList: () => null };
      throw new Error('Unqualified import: ' + name);
    };
    new vm.Script('(function(exports,require,module){\n' + output + suffix + '\n})', { filename: relative }).runInContext(context)(module.exports, imports, module);
    emitted.push({ relative, rawSHA256: sha(Buffer.from(raw)), outputSHA256: sha(Buffer.from(output)),
      wholeSourceCompiled: true, adapterSuffix: suffix.trim() || null });
    cache.set(relative, module.exports); return module.exports;
  }
  const lifecycle = load('lib/admin/auth-lifecycle.ts'); lifecycle.installAdminAuthFetchLifecycle();
  const client = load('lib/admin/i-client.ts');
  const page = load('app/components/domain-views/i-tabs/i6-i18n.tsx');
  const shell = load('lib/admin/shell-authorities.ts');
  const messages = [msg('fixture.home'), msg('fixture.me')];
  const courses = [course('fixture-course-A', 'Fixture course A'), course('fixture-course-B', 'Fixture course B')];
  const content = { i18nLearning: { messages, courses, categories: ['Basics'],
    namespaces: [], integrityIssues: [], hardcodedFindings: [], metrics: [],
    stats: { managedKeys: 2, totalKeys: 2, integrityIssues: 0, coursesOnline: 2, weeklyNexPayout: '0' },
    rewardRange: { min: 0, max: 0 }, featuredCourseId: courses[0].id } };
  const actions = { ...client.iContentActions, reloadIContent: forbid };
  const ctx = { actions, content, contentLoading: false, toast: value => toasts.push(value),
    openConfirm: forbid, openActionConfirm: forbid };
  return { requests, page, context, auth, lifecycle, shell, toasts,
    mount(view) {
      engine = new Hooks(() => page.__I18nLearningPage({ ctx, view }));
      const parent = page.I6I18n({ ctx });
      assert.ok(flat(parent).some(e => e.type.name === 'I18nLearningPage' && e.props.view === view), 'actual permission wrapper mounts consumer');
      engine.commit(); return engine;
    },
    resolve(request, data) { assert.ok(request && !request.done); request.done = true;
      request.resolve(Response.json({ code: 0, message: 'OK', data })); },
    fail(request) { assert.ok(request && !request.done); request.done = true;
      request.resolve(Response.json({ code: 503, message: 'CONFIG_READ_UNAVAILABLE', data: null }, { status: 503 })); },
    pending(kind, id) { const suffix = `/${kind}/${id}/versions`; return requests.find(r => !r.done && r.url.endsWith(suffix)); }
  };
}

function msg(key) { return { messageKey: key, namespace: 'fixture', version: 'v2', status: 'published',
  revision: 2, zh: key + ' ZH', en: key + ' EN', vi: key + ' VI', placeholders: [], updatedAt: '2026-10-01T00:00:00Z' }; }
function course(id, title) { return { id, title, titleZh: title, titleEn: title, titleVi: title, category: 'Basics',
  format: 'Article', level: 'Beginner', rewardNex: '0', featured: false, duration: '1m', version: 'v2',
  status: 'published', body: 'fixture', bodyZh: 'fixture', bodyEn: 'fixture', bodyVi: 'fixture', revision: 2 }; }
function version(id, n = 2) { return { courseId: id, version: 'v' + n, status: 'PUBLISHED', revision: n,
  payload: { titleZh: id + ' snapshot', titleEn: id + ' snapshot' }, updatedAt: '2026-10-01T00:00:00Z' }; }

// Deterministic hook adapter executes complete production components/effects,
// including cleanup-before-next-effect and unmounted setter isolation. This
// is not a browser/React reconciler/TEST assertion.
class Hooks {
  constructor(render) { this.render = render; this.hooks = []; this.dirty = true; this.alive = true; }
  useState(initial) {
    const i = this.cursor++;
    if (!this.hooks[i]) this.hooks[i] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
    return [this.hooks[i].value, value => {
      if (!this.alive) return;
      const next = typeof value === 'function' ? value(this.hooks[i].value) : value;
      if (!Object.is(next, this.hooks[i].value)) { this.hooks[i].value = next; this.dirty = true; }
    }];
  }
  useEffect(run, deps) {
    const i = this.cursor++, previous = this.hooks[i];
    if (!previous || deps.length !== previous.deps.length || deps.some((v, n) => !Object.is(v, previous.deps[n]))) {
      this.effects.push({ i, run, deps, previous });
    }
  }
  commit() {
    for (let i = 0; this.dirty && i < 12; i++) {
      this.cursor = 0; this.effects = []; this.dirty = false; this.tree = this.render();
      for (const effect of this.effects) {
        effect.previous?.cleanup?.();
        this.hooks[effect.i] = { kind: 'effect', deps: effect.deps, cleanup: effect.run() };
      }
    }
    assert.equal(this.dirty, false, 'bounded render settles');
  }
  unmount() { this.alive = false; for (const h of this.hooks) if (h.kind === 'effect') h.cleanup?.(); }
  find(pred) { const match = flat(this.tree).find(pred); assert.ok(match, 'actual rendered handler exists'); return match; }
  click(pred) { const e = this.find(pred); assert.notEqual(e.props.disabled, true); e.props.onClick({ stopPropagation() {} }); this.commit(); }
  courseView() {
    const panel = flat(this.tree).find(e => e.props['data-proof'] === 'i7-course-version-crud');
    return panel ? { shown: true, text: text(panel), rowKeys: flat(panel).filter(e => e.type === 'tr' && e.key).map(e => e.key) } : { shown: false, text: '', rowKeys: [] };
  }
  messageHistory() { return flat(this.tree).filter(e => e.type === 'tr' && e.key && String(e.key).startsWith('fixture.')).map(e => ({ key: e.key, text: text(e) })); }
}
function flat(value) { if (Array.isArray(value)) return value.flatMap(flat); if (!React.isValidElement(value)) return [];
  return [value, ...flat(value.props.children)]; }
function text(value) { if (Array.isArray(value)) return value.map(text).join(''); if (React.isValidElement(value)) return text(value.props.children);
  return value == null || typeof value === 'boolean' ? '' : String(value); }
async function settle(h) { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); h.commit(); } }
async function setup(view) { const r = runtime(), h = r.mount(view); r.resolve(r.pending('messages', 'fixture.home'), [msg('fixture.home')]); await settle(h); return { r, h }; }
function chooseCourse(h, label) { h.click(e => e.type === 'button' && e.props['aria-label'] === `版本管理 Fixture course ${label}`); }
function closeCourse(h) { h.click(e => e.type === 'button' && text(e) === '关闭'); }
function check(name, actual, expected) { const pass = JSON.stringify(actual) === JSON.stringify(expected); results.push({ name, actual, expected, verdict: pass ? 'PASS' : 'RED' }); }

(async () => {
  // First consumer: existing I6 active cleanup protects selected-key changes.
  {
    const { r, h } = await setup('i18n');
    h.click(e => e.type === 'button' && e.props['aria-label'] === '选择 fixture.me');
    const newer = r.pending('messages', 'fixture.me'); r.resolve(newer, [msg('fixture.me')]); await settle(h);
    check('I6 legal selected key read completes', text(h.tree).includes('fixture.me ZH'), true);
    h.click(e => e.type === 'button' && e.props['aria-label'] === '选择 fixture.home');
    const old = r.pending('messages', 'fixture.home');
    h.click(e => e.type === 'button' && e.props['aria-label'] === '选择 fixture.me');
    r.resolve(r.pending('messages', 'fixture.me'), [msg('fixture.me')]); await settle(h);
    const before = text(h.tree); r.resolve(old, [msg('fixture.home')]); await settle(h);
    check('I6 late old success ignored after new selection', text(h.tree), before);
    h.click(e => e.type === 'button' && e.props['aria-label'] === '选择 fixture.home'); r.fail(r.pending('messages', 'fixture.home')); await settle(h);
    check('I6 current read error visible as toast', r.toasts.some(t => t.startsWith('词条版本加载失败:')), true);
    h.click(e => e.type === 'button' && e.props['aria-label'] === '选择 fixture.me'); r.resolve(r.pending('messages', 'fixture.me'), [msg('fixture.me')]); await settle(h);
    check('I6 explicit selection recovers after error', text(h.tree).includes('fixture.me ZH'), true);
    h.unmount();
  }
  // Second consumer: only existing readonly version-management buttons used.
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A'); const old = r.pending('courses', 'fixture-course-A');
    chooseCourse(h, 'B'); r.resolve(r.pending('courses', 'fixture-course-B'), [version('fixture-course-B')]); await settle(h);
    check('I7 current B normal completion title/rows', { title: h.courseView().text.includes('课程版本列表 · Fixture course B'), keys: h.courseView().rowKeys }, { title: true, keys: ['fixture-course-B-v2'] });
    r.resolve(old, [version('fixture-course-A')]); await settle(h);
    check('I7 A late response must not replace B rows', h.courseView().rowKeys, ['fixture-course-B-v2']);
    h.unmount();
  }
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A'); const old = r.pending('courses', 'fixture-course-A');
    chooseCourse(h, 'B'); r.resolve(old, [version('fixture-course-A')]); await settle(h);
    check('I7 settling old A must keep B loading', h.courseView().text.includes('版本加载中'), true);
    r.fail(r.pending('courses', 'fixture-course-B')); await settle(h);
    check('I7 B failure must not present A history under B', h.courseView().rowKeys, []);
    check('I7 current failure toast visible', r.toasts.some(t => t.startsWith('版本加载失败:')), true);
    closeCourse(h); chooseCourse(h, 'B'); r.resolve(r.pending('courses', 'fixture-course-B'), [version('fixture-course-B')]); await settle(h);
    check('I7 explicit close/reopen recovers B', h.courseView().rowKeys, ['fixture-course-B-v2']); h.unmount();
  }
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A'); const old = r.pending('courses', 'fixture-course-A'); closeCourse(h);
    r.resolve(old, [version('fixture-course-A')]); await settle(h); chooseCourse(h, 'B');
    check('I7 close then late A cannot appear when opening B', h.courseView().rowKeys, []);
    r.resolve(r.pending('courses', 'fixture-course-B'), [version('fixture-course-B')]); await settle(h); h.unmount();
  }
  // Additional recovery adversaries: already loaded rows and obsolete failures.
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A');
    r.resolve(r.pending('courses', 'fixture-course-A'), [version('fixture-course-A')]); await settle(h);
    chooseCourse(h, 'B');
    check('I7 selection clears previously loaded A rows while B is pending', h.courseView().rowKeys, []);
    r.resolve(r.pending('courses', 'fixture-course-B'), [version('fixture-course-B')]); await settle(h); h.unmount();
  }
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A'); const old = r.pending('courses', 'fixture-course-A');
    chooseCourse(h, 'B'); r.fail(old); await settle(h);
    check('I7 obsolete A failure cannot toast for current B', r.toasts, []);
    check('I7 obsolete A failure cannot stop current B loading', h.courseView().text.includes('版本加载中'), true);
    r.resolve(r.pending('courses', 'fixture-course-B'), [version('fixture-course-B')]); await settle(h); h.unmount();
  }
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A'); const old = r.pending('courses', 'fixture-course-A');
    closeCourse(h); r.fail(old); await settle(h);
    check('I7 closed selection failure does not emit a stale toast', r.toasts, []); h.unmount();
  }
  // Actual shell-key and installed fetch epoch guard refute operator bleed.
  {
    const { r, h } = await setup('learn'); chooseCourse(h, 'A'); const old = r.pending('courses', 'fixture-course-A');
    const oldKey = r.shell.adminShellSessionKey(r.auth.session, r.auth.authEpoch);
    r.auth.session = { ...r.auth.session, adminId: 22, username: 'fixture_B', operator: 'fixture_B' }; r.auth.authEpoch++;
    const newKey = r.shell.adminShellSessionKey(r.auth.session, r.auth.authEpoch);
    check('operator change has different real shell key', oldKey !== newKey, true);
    h.unmount(); r.lifecycle.renewAdminAuthLifecycle();
    const fresh = r.mount('learn'); r.resolve(r.pending('messages', 'fixture.home'), [msg('fixture.home')]); await settle(fresh);
    chooseCourse(fresh, 'B'); r.resolve(r.pending('courses', 'fixture-course-B'), [version('fixture-course-B')]); await settle(fresh);
    r.resolve(old, [version('fixture-course-A')]); await settle(fresh);
    check('old operator response cannot replace new mounted consumer', fresh.courseView().rowKeys, ['fixture-course-B-v2']); fresh.unmount();
  }
  assert.equal(networkAttempts, 0);
  const output = { status: 'ACTUAL_PRODUCTION_SOURCE_BOUNDED_OFFLINE_PROBE',
    checks: results.length, passed: results.filter(r => r.verdict === 'PASS').length,
    actualRED: results.filter(r => r.verdict === 'RED').length, results,
    provenance: 'Whole production component and actual i-client API request path, real JSX elements, real error mapping, real auth lifecycle and shell key. Hook dispatcher/deferred Responses are explicit fixture adapters. No network transport/DOM/business execution.',
    sourceExecutions: emitted, networkAttempts, writesInvoked: 0, suiteReexecution: 0,
    maxHeapMiB: 128, maxRSSKiB: process.resourceUsage().maxRSS, completedAtUTC: new Date().toISOString() };
  for (const result of results) {
    await test(result.name, () => {
      assert.equal(JSON.stringify(result.actual), JSON.stringify(result.expected));
    });
  }
  console.log(JSON.stringify(output));
  assert.equal(results.length, 17);
})().catch(error => { console.error(error.stack); process.exitCode = 2; });
