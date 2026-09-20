import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * A2 审计域每一条客户端请求都必须被 platform BFF 放行。
 *
 * 缺陷 #201 的原形:`lib/admin/a2-client.ts` 请求
 * `/api/admin/platform/audit/retention-preview`,而 BFF 的 `backendPath()` 只放行了
 * 五个固定子路径(`overview`/`logs`/`exports`/`reason-policy`/`retention-runs`),
 * 于是代理回 `PLATFORM_ROUTE_NOT_FOUND`(404)。A2 页面把「BFF 漏放行」渲染成
 * 「清理范围读取失败」并永久禁用「立即清理」——一个纯前端路由表的疏漏被显示成
 * 服务端故障,而且**静态类型、构建、既有契约测试全绿**:客户端与代理各自都自洽。
 *
 * 所以判据必须是「两侧求交集」,而不是各自断言字面量:从客户端真实取数路径反推
 * BFF 必须放行的清单,任一缺失即红。客户端将来新增路径而忘了加放行,这条会直接拦住。
 */
const client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/admin/platform/[...path]/route.ts", import.meta.url), "utf8");
// 🔴 剥注释再比对:注释里提到某个子路径不等于它真被放行 —— 不剥就是子串假绿
//    (本仓 h9-parity 哨兵在 2026-08-06 被同样的问题证伪过一次)。红测 RT-allowlist
//    的做法就是只删实现、留注释,那一次必须变红。
const route = routeSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** A2 客户端真实请求的 audit 子路径(相对 `/api/admin/platform/audit`)。 */
function requestedAuditPaths() {
  const paths = new Set();
  for (const match of client.matchAll(/a2Request<[^>]*>\(\s*[`"](\/[^`"$]*)/g)) {
    paths.add(match[1]);
  }
  // exports 走独立 guardedFetch 而非 a2Request。
  for (const match of client.matchAll(/guardedFetch\(\s*[`"]\/api\/admin\/platform\/audit(\/[^`"$]*)/g)) {
    paths.add(match[1]);
  }
  return [...paths].sort();
}

test("A2 client audit paths are all non-empty (判据本身不许空集假绿)", () => {
  const paths = requestedAuditPaths();
  assert.ok(paths.length >= 5, `A2 客户端解析出 ${paths.length} 条路径,判据可能失效`);
});

test("every A2 client audit path is released by the platform BFF allowlist", () => {
  const paths = requestedAuditPaths();
  // 放行判据落在 route.ts 的 audit 分支里:既可能是模板串(`/audit/${parts[1]}` 配合
  // includes 白名单),也可能是整段字面量。两者都算放行,但**必须真在 route 源码里**。
  for (const path of paths) {
    const leaf = path.replace(/^\//, "").split("/")[0];
    const releasedByTemplate = route.includes(`/api/admin/platform/audit/\${parts[1]}`)
      && new RegExp(`["'\`]${leaf}["'\`]`).test(route);
    const releasedByLiteral = route.includes(`/api/admin/platform/audit${path}`);
    assert.ok(
      releasedByTemplate || releasedByLiteral,
      `A2 客户端请求 ${path},但 platform BFF 没有放行它 —— 代理会回 PLATFORM_ROUTE_NOT_FOUND,`
      + `页面把「漏放行」显示成服务端故障(zentao #201 的原形)`,
    );
  }
});

test("retention preview is reachable end to end", () => {
  // #201 点名的那条:客户端取数 → BFF 放行 → 服务端端点三处必须同时存在。
  assert.match(client, /a2Request<RetentionPreview>\("\/retention-preview"/);
  assert.match(route, /"retention-preview"/);
  assert.match(route, /\/api\/admin\/platform\/audit\/\$\{parts\[1\]\}/);
});
