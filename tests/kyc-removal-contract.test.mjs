import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const read = (path) => fs.readFileSync(path, "utf8").toLowerCase();
const forbidden = /\bkyc\b|kyc[A-Z_]|KYC-|\/users\/kyc|\/risk\/kyc-review/;

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : [file];
  });
}

test("operations console exposes no KYC navigation, BFF route, client, or screen", () => {
  for (const path of [
    "lib/nav/console-nav.ts",
    "app/api/admin/users/[...path]/route.ts",
    "app/api/admin/risk/[...path]/route.ts",
    "app/api/admin/market/[...path]/route.ts",
  ]) assert.equal(read(path).includes("kyc"), false, path);

  for (const path of [
    "app/components/domain-views/c-tabs/c4-kyc.tsx",
    "app/components/domain-views/k-tabs/k5-kyc.tsx",
    "lib/admin/k5-contract.ts",
  ]) assert.equal(fs.existsSync(path), false, `${path} must be deleted`);
});

test("operations console runtime contains no KYC capability or gate", () => {
  const violations = ["app", "lib"].flatMap(sourceFiles)
    .filter((file) => /\.(?:ts|tsx|js|mjs|json|css)$/.test(file))
    .filter((file) => forbidden.test(fs.readFileSync(file, "utf8")));

  assert.deepEqual(violations, []);
});

test("current operations product docs retire historical KYC requirements", () => {
  const documents = [
    "docs/PRD/Nexion_运营控制后台PRD_v1.md",
    "docs/PRD/Nexion_运营控制后台PRD_v2.md",
    "docs/PRD/Nexion_运营控制后台PRD_v3.md",
    "docs/PRD/Nexion_运营控制后台_开发落地规格.md",
    "docs/PRD/Nexion_运营后台投产Checklist.md",
    "docs/PRD/Nexion_运营后台_交互与确认机制改写SPEC.md",
  ];

  for (const file of documents) {
    const preamble = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(0, 10).join("\n");
    assert.match(preamble, /2026-08-07/, `${file} must carry the current removal ruling`);
    assert.match(preamble, /不得/, `${file} must prevent historical KYC restoration`);
  }
});

test("all KYC-bearing baseline specs are explicitly historical", () => {
  if (!fs.existsSync("docs/PRD/specs")) return;
  const historicalKyc = /\bkyc\b|KYC-|kyc_|实名|钱包配对/i;
  const documents = sourceFiles("docs/PRD/specs")
    .filter((file) => file.endsWith(".md"))
    .filter((file) => historicalKyc.test(fs.readFileSync(file, "utf8")));

  for (const file of documents) {
    const preamble = fs.readFileSync(file, "utf8").split(/\r?\n/).slice(0, 8).join("\n");
    assert.match(preamble, /现行裁决\(2026-08-07\)/, `${file} must carry the current removal ruling`);
    assert.match(preamble, /不得/, `${file} must prevent historical KYC restoration`);
  }
});
