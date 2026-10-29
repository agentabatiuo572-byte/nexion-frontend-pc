import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { formatBusinessTime } from "../lib/admin/business-time.ts";

let active, now = Date.parse("2026-10-29T01:00:00Z"), refreshes = 0;
const timers = new Map(), listeners = new Set(); let nextTimer = 0;
class Clock extends Date { static now() { return now; } }
const context = vm.createContext({
  module: { exports: {} }, exports: {}, Date: Clock,
  window: { setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); } },
  document: { addEventListener(event, fn) { assert.equal(event, "visibilitychange"); listeners.add(fn); }, removeEventListener(event, fn) { assert.equal(event, "visibilitychange"); listeners.delete(fn); } },
  require(name) { return name === "react" ? { useState: (...args) => active.useState(...args), useEffect: (...args) => active.useEffect(...args) } : name === "react/jsx-runtime" ? jsx : name === "@/lib/admin/business-time" ? { formatBusinessTime } : assert.fail(`unexpected dependency ${name}`); },
});
context.exports = context.module.exports;
const file = new URL("../app/components/domain-views/m-tabs/analytics-freshness.tsx", import.meta.url);
vm.runInContext(ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
const { AnalyticsFreshness, analyticsUpdateDelayed } = context.module.exports;
class Mount {
  slots = []; cursor = 0; effects = []; dirty = true; tree; props;
  constructor(asOf) { this.props = { asOf, onRefresh() { refreshes++; } }; }
  useState(initial) { const i = this.cursor++; if (!(i in this.slots)) this.slots[i] = typeof initial === "function" ? initial() : initial; return [this.slots[i], value => { if (!Object.is(value, this.slots[i])) { this.slots[i] = value; this.dirty = true; } }]; }
  useEffect(fn, deps) { const i = this.cursor++, old = this.slots[i]; if (!old || deps.some((dep, j) => !Object.is(dep, old.deps[j]))) this.effects.push(() => { old?.cleanup?.(); this.slots[i] = { deps, cleanup: fn() }; }); }
  render(asOf = this.props.asOf) { this.props.asOf = asOf; this.dirty = true; let renders = 0; active = this; while (this.dirty) { assert.ok(++renders < 10); this.dirty = false; this.cursor = 0; this.tree = AnalyticsFreshness(this.props); this.effects.splice(0).forEach(fn => fn()); } return renderToStaticMarkup(this.tree); }
  close() { this.slots.forEach(slot => slot?.cleanup?.()); }
}
const iso = age => new Date(now - age).toISOString();

test("two-minute threshold uses original source time, never fetch time or rounded minutes", () => {
  assert.equal(analyticsUpdateDelayed(iso(120000), now), false);
  assert.equal(analyticsUpdateDelayed(iso(120001), now), true);
  assert.equal(analyticsUpdateDelayed(iso(60000), now), false);
});

test("fresh snapshot renders its exact supplied time and schedules only one leaf update", () => {
  const sourceTime = iso(60000), d = new Mount(sourceTime);
  try {
    const html = d.render();
    assert.match(html, /统计约每分钟更新，另需计算时间/);
    assert.match(html, new RegExp(sourceTime));
    assert.match(html, /北京时间/);
    assert.doesNotMatch(html, /统计更新延迟|Redis/);
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 60001);
    d.render(); assert.equal(timers.size, 1, "parent renders do not restart the aging clock");
  } finally { d.close(); }
  assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
});

test("the single expiry callback shows a delayed notice and refresh reads through its supplied action", () => {
  const d = new Mount(iso(120000));
  try {
    d.render(); const timer = [...timers.values()][0]; assert.equal(timer.delay, 1);
    now++; timer.fn();
    assert.match(d.render(), /统计更新延迟，当前显示的数据已超过 2 分钟/);
    assert.match(d.render(), /刷新读取最新完成版本/);
    const before = refreshes; d.tree.props.children.find(child => child?.type === "button").props.onClick();
    assert.equal(refreshes, before + 1);
  } finally { d.close(); }
});

test("a fresh published snapshot clears the delayed notice and preserves its new real timestamp", () => {
  const d = new Mount(iso(180000));
  try {
    assert.match(d.render(), /统计更新延迟/); assert.equal(timers.size, 0);
    const fresh = iso(30000), html = d.render(fresh);
    assert.doesNotMatch(html, /统计更新延迟/); assert.match(html, new RegExp(fresh));
    assert.equal(timers.size, 1); assert.equal([...timers.values()][0].delay, 90001);
  } finally { d.close(); }
});

test("tab visibility recovery rechecks elapsed source age without querying or rerendering a parent", () => {
  const d = new Mount(iso(0));
  try {
    d.render(); const before = refreshes; now += 121000;
    [...listeners].forEach(fn => fn()); assert.match(d.render(), /统计更新延迟/);
    assert.equal(refreshes, before, "clock checks never perform a data read");
  } finally { d.close(); }
  assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
});
