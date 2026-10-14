import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canAccessResolvedPath, resolveVisibleDomains } from "../lib/nav/console-nav.ts";

const require = createRequire(import.meta.url);
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
function declarations(path, names) {
  const ast = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast)).join("\n");
}

test("actual support messages gate administrative destinations without removing recommendations or App targets", () => {
  const context = {
    require, exports: {}, session: null, canAccessResolvedPath, resolveVisibleDomains,
    useAdminAuth: selector => selector({ session: context.session }),
    SupportAvatar: ({ name }) => React.createElement("span", null, name),
  };
  const production = declarations("lib/admin/m-support-enhancements.ts", ["legacySupportDestination"]) + "\n" + declarations("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", ["messageTime", "SupportMessage"]);
  runInNewContext(ts.transpileModule(`${production}\nglobalThis.message = SupportMessage;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, context);
  const base = { sender: "agent", agentName: "客服A", authorConfidence: "VERIFIED", senderId: 1456, sourceSenderType: "AGENT", ts: 1, id: 8 };
  const sku = { ...base, kind: "SKU", text: "保留原推荐内容", skuName: "商品A", skuId: "SKU-12" };
  const render = message => renderToStaticMarkup(React.createElement(context.message, { message, customerId: "2005", customerName: "客户", onRevoked() {} }));
  const support = { role: "support", supportReadModes: ["PERSONAL"], menuCodes: ["M1", "M3"], authorities: ["service_m1_read", "service_m3_read"] };
  const authorized = { ...support, menuCodes: [...support.menuCodes, "E1"], authorities: [...support.authorities, "device_e1_read"] };
  for (const session of [null, support, { ...support, menuCodes: ["M1", "E1"] }, { ...support, authorities: [...support.authorities, "device_e1_read"] }, { ...authorized, menuNodes: [] }, { ...authorized, menuNodes: [{ menuCode: "E1", routePath: "/devices/wrong", parentCode: "E" }] }]) {
    context.session = session;
    const html = render(sku);
    assert.doesNotMatch(html, /<a\b[^>]*href="\/devices\/pricing/);
    assert.match(html, /无访问权限/);
    for (const content of ["保留原推荐内容", "商品A", "SKU-12"]) assert.ok(html.includes(content));
  }
  context.session = authorized;
  assert.match(render(sku), /href="\/devices\/pricing\?query=SKU-12"/);
  assert.match(render({ ...sku, targetAvailability: "UNAVAILABLE" }), /商品已不可用；原推荐保留/);
  assert.doesNotMatch(render({ ...sku, targetAvailability: "UNAVAILABLE" }), /href="\/devices\/pricing/);

  context.session = support;
  for (const target of ["/store", "/staking", "/genesis"]) {
    const html = render({ ...base, kind: "TEXT", text: `原推荐 ${target}` });
    assert.doesNotMatch(html, /<a\b/);
    assert.match(html, /无访问权限/);
    assert.ok(html.includes(target));
  }
  context.session = authorized;
  assert.match(render({ ...base, kind: "TEXT", text: "原推荐 /store" }), /href="\/devices\/pricing"/);
  context.session = { ...support, menuCodes: ["G1"] };
  assert.match(render({ ...base, kind: "TEXT", text: "原推荐 /staking" }), /href="\/finance-products\/staking"/);
  context.session = { ...support, menuCodes: ["G4"] };
  assert.match(render({ ...base, kind: "TEXT", text: "原推荐 /genesis" }), /href="\/finance-products\/genesis"/);
  context.session = support;
  for (const [type, label] of [["HOME", "首页"], ["WALLET", "钱包"], ["SUPPORT", "在线客服"]]) {
    const html = render({ ...base, kind: "LINK", text: "保留客户端推荐", linkTarget: { type } });
    assert.ok(html.includes(label));
    assert.ok(html.includes("保留客户端推荐"));
    assert.doesNotMatch(html, /无访问权限/);
  }
});
