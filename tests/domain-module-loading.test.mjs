import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

function load(file, dependencies, browser = {}) {
  const source = readFileSync(new URL(`../app/components/domain-views/${file}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", compiled)(name => {
    assert.ok(Object.hasOwn(dependencies, name), `unexpected eager dependency ${name}`);
    return dependencies[name];
  }, module, module.exports, browser);
  return module.exports;
}

test("M1 stays eager, unrelated page code waits for navigation, and M subpage navigation preserves the boundary", () => {
  const mounted = [], core = { react: React, "react/jsx-runtime": jsx };
  const states = load("domain-module-state.tsx", core);
  const { DomainViewSwitch } = load("registry.tsx", {
    ...core,
    "./domain-module-state": states,
    "./m-view": { MDomainView: ({ meta }) => React.createElement("p", null, `M ${meta.l2Id}`) },
    "next/dynamic": { __esModule: true, default: (loader, { loading: Loading }) => () => { mounted.push(loader.toString()); return React.createElement(Loading); } },
  });
  const m1 = DomainViewSwitch({ code: "M", meta: { l2Id: "M1" } });
  assert.match(renderToStaticMarkup(m1), /M M1/);
  assert.equal(mounted.length, 0);
  assert.equal(m1.key, DomainViewSwitch({ code: "M", meta: { l2Id: "M3" } }).key, "ongoing reception must not remount on M subpage changes");
  assert.match(renderToStaticMarkup(React.createElement(DomainViewSwitch, { code: "C", meta: { l2Id: "C1" } })), /role="status"/);
  assert.equal(mounted.length, 1); assert.match(mounted[0], /c-view/);
  renderToStaticMarkup(React.createElement(DomainViewSwitch, { code: "M", meta: { l2Id: "M6" } }));
  assert.equal(mounted.length, 2); assert.match(mounted[1], /m6-leaderboard/);
});

test("a failed page chunk replaces content with a visible recovery action that reloads fresh assets", () => {
  let reloads = 0;
  const { DomainModuleBoundary } = load("domain-module-state.tsx", { react: React, "react/jsx-runtime": jsx }, { location: { reload() { reloads++; } } });
  const boundary = new DomainModuleBoundary({ children: React.createElement("p", null, "已授权页面") });
  assert.match(renderToStaticMarkup(boundary.render()), /已授权页面/);
  boundary.state = DomainModuleBoundary.getDerivedStateFromError(new Error("chunk unavailable"));
  const failed = boundary.render();
  assert.match(renderToStaticMarkup(failed), /role="alert".*重新加载页面/);
  assert.doesNotMatch(renderToStaticMarkup(failed), /已授权页面/);
  failed.props.children.find(child => child?.type === "button").props.onClick();
  assert.equal(reloads, 1);
});
