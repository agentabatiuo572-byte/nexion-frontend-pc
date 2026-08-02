import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./e2e/pc-all-modules-final-acceptance.spec.ts", import.meta.url),
  "utf8",
);

test("final75 records every real request failure, not only admin API failures", () => {
  assert.match(source, /requestFailures: string\[\]/);
  assert.match(source, /successfulResponses: string\[\]/);
  assert.match(source, /evidence\.requestFailures\.push\(detail\)/);
  assert.match(source, /expect\(evidence\.requestFailures,[\s\S]{0,120}不允许真实网络失败/);
});

test("navigation abort exemptions require a successful replacement on the same module, method and path", () => {
  assert.match(source, /evidence\.expectedNavigationAborts\.push\(detail\)/);
  assert.match(source, /evidence\.successfulResponses\.some\(\(success\) => success\.startsWith\(`\$\{signature\} `\)\)/);
  assert.doesNotMatch(source, /successfulAdminResponses\.some\(\(success\) => success\.startsWith\(`\$\{signature\} `\)\)/);
});

test("response and requestfailed retain the module phase captured when the request started", () => {
  assert.match(source, /const requestOrigins = new WeakMap<Request, string>\(\);/);
  assert.match(source, /requestOrigins\.set\(request, currentModule\);/);
  assert.match(source, /const originModule = requestOrigins\.get\(request\) \?\? "unattributed";/);
  assert.match(source, /const originModule = requestOrigins\.get\(response\.request\(\)\) \?\? "unattributed";/);
  assert.match(source, /\$\{originModule\}: \$\{request\.method\(\)\}/);
  assert.match(source, /\$\{originModule\}: \$\{response\.request\(\)\.method\(\)\}/);
});

test("final75 waits for M1 portrait media to settle before the real-user navigation continues", () => {
  assert.match(source, /await waitForModuleMediaQuiet\(page, module\);/);
  assert.match(source, /module\.id !== "M1"/);
  assert.match(source, /document\.querySelectorAll<HTMLImageElement>\("main img"\)/);
  assert.match(source, /image\.complete/);
});
