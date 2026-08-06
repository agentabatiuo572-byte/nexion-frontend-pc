import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const e3Carrier = readFileSync(
  new URL("./e2e/e-domain-nonowner-d-20260728.spec.ts", import.meta.url),
  "utf8",
);
const e6Carrier = readFileSync(
  new URL("./e2e/e6-maker-checker-20260728.spec.ts", import.meta.url),
  "utf8",
);
const a2Audit = readFileSync(
  new URL("../app/components/domain-views/a-tabs/a2-audit.tsx", import.meta.url),
  "utf8",
);
const eOwnerCarrier = readFileSync(
  new URL("./e2e/e-domain-final-nowrite-owner-20260729.spec.ts", import.meta.url),
  "utf8",
);

test("E3 separates maker, A2 checker and CAS second writer without authority overlap", () => {
  assert.match(e3Carrier, /accounts\?: \{[\s\S]*maker\?:[\s\S]*secondWriter\?:/);
  assert.match(e3Carrier, /const secondWriterAccount = checkerManifest\.accounts\?\.secondWriter/);
  assert.match(e3Carrier, /expect\(secondWriterAccount\?\.roleCode\)\.toBe\(expectedSecondWriterRole\)/);
  assert.match(e3Carrier, /new Set\(\[makerAccount!\.username, checkerAccount!\.username, secondWriterAccount!\.username\]\)\.size\)\.toBe\(3\)/);
  assert.match(e3Carrier, /expectedCheckerAuthorities = \[[\s\S]*"platform_a2_operation_approve"[\s\S]*"device_e3_read"[\s\S]*"device_e6_read"[\s\S]*\]/);
  assert.doesNotMatch(e3Carrier, /expectedCheckerAuthorities = \[[^\]]*device_e[36]_write/);
  assert.match(e3Carrier, /expectedSecondWriterAuthorities = \[[\s\S]*"device_e3_write"[\s\S]*"device_e6_write"[\s\S]*\]/);
  assert.doesNotMatch(e3Carrier, /expectedSecondWriterAuthorities = \[[^\]]*platform_a2_operation_approve/);
});

test("E write carriers bind the immutable runtime build artifact instead of the mutable repo build", () => {
  assert.match(e3Carrier, /const FRONTEND_BUILD_ID_PATH = process\.env\.E_NONOWNER_BUILD_ID_PATH/);
  assert.match(e3Carrier, /readFileSync\(FRONTEND_BUILD_ID_PATH, "utf8"\)/);
  assert.doesNotMatch(e3Carrier, /readFileSync\(path\.resolve\("\.next\/BUILD_ID"\)/);
  assert.match(e6Carrier, /const FRONTEND_BUILD_ID_PATH = process\.env\.E6_BUILD_ID_PATH/);
  assert.match(e6Carrier, /readFileSync\(FRONTEND_BUILD_ID_PATH, "utf8"\)/);
  assert.doesNotMatch(e6Carrier, /readFileSync\(path\.resolve\("\.next\/BUILD_ID"\)/);
});

test("E3 pending lifecycle proves maker and independent second-writer conflicts while checker direct write is 403", () => {
  assert.match(e3Carrier, /const secondOperatorDirectWrite = await secondWriter\.request\.patch\("\/api\/admin\/devices\/e3\/config"/);
  assert.match(e3Carrier, /secondOperatorDirectWriteBody\.message\)\.toContain\("OBJECT_LOCKED_BY_A2"\)/);
  assert.match(e3Carrier, /const checkerDirectWrite = await checker\.request\.patch\("\/api\/admin\/devices\/e3\/config"/);
  assert.match(e3Carrier, /expect\(checkerDirectWrite\.status\(\)\)\.toBe\(403\)/);
  assert.match(e3Carrier, /expect\(directWrite\.status\(\) === 409 \|\| directWriteBody\.code === 409\)\.toBe\(true\)/);
  assert.match(e3Carrier, /expect\(selfApprove\.status\(\) === 403 \|\| selfApproveBody\.code === 403\)\.toBe\(true\)/);
  assert.match(e3Carrier, /const terminalReplay = await decideByApi\([\s\S]*"approve"/);
  assert.match(e3Carrier, /expect\(terminalReplay\.status\)\.toBe\(409\)/);
  assert.doesNotMatch(e3Carrier, /checker\.request\.post\("\/api\/admin\/platform\/audit\/operations",/);
});

test("E6 uses the same three-role split and never grants the checker business write", () => {
  assert.match(e6Carrier, /const secondWriterAccount = checkerManifest\.accounts\?\.secondWriter/);
  assert.match(e6Carrier, /new Set\(\[makerAccount!\.username, checkerAccount!\.username, secondWriterAccount!\.username\]\)\.size\)\.toBe\(3\)/);
  assert.doesNotMatch(e6Carrier, /expectedCheckerAuthorities = \[[^\]]*device_e[36]_write/);
  assert.match(e6Carrier, /const secondWriterDirectWrite = await secondWriterPage\.request\.patch\("\/api\/admin\/devices\/compute-config\/params"/);
  assert.match(e6Carrier, /expect\(secondWriterDirectWrite\.status\(\) === 409 \|\| secondWriterDirectWriteBody\.code === 409\)\.toBe\(true\)/);
  assert.match(e6Carrier, /const checkerDirectWrite = await checkerPage\.request\.patch\("\/api\/admin\/devices\/compute-config\/params"/);
  assert.match(e6Carrier, /expect\(checkerDirectWrite\.status\(\)\)\.toBe\(403\)/);
  assert.match(e6Carrier, /expect\(selfApprove\.status\(\) === 403 \|\| selfApproveBody\.code === 403\)\.toBe\(true\)/);
  assert.match(e6Carrier, /terminalReplayRejected/);
  assert.doesNotMatch(e6Carrier, /EXISTING_CHANGE_OPERATION_ID/);
});

test("E6 can honor a scoped E-only write lock without touching a closed cross-domain A6 ticket", () => {
  assert.match(e6Carrier, /const SKIP_CROSS_DOMAIN_WRITE = process\.env\.E6_SKIP_CROSS_DOMAIN_WRITE === "1"/);
  assert.match(e6Carrier, /SKIP_CROSS_DOMAIN_WRITE[\s\S]*skipped: true[\s\S]*scoped-write-lock/);
  assert.match(e6Carrier, /if \(!SKIP_CROSS_DOMAIN_WRITE\) \{[\s\S]*expect\(crossDomainApprove\.status\)\.toBe\(403\)/);
});

test("minimal checker is denied A4 while A4 and outbox evidence remain an independent main or DB responsibility", () => {
  for (const carrier of [e3Carrier, e6Carrier]) {
    assert.match(
      carrier,
      /const checkerA4Denied = await checker(?:Page)?\.request\.get\("\/api\/admin\/platform\/events\/overview"\)/,
    );
    assert.match(carrier, /expect\(checkerA4Denied\.status\(\)\)\.toBe\(403\)/);
    assert.match(carrier, /a4OutboxEvidenceChannel: "main-authorized-db-channel-required"/);
    assert.doesNotMatch(carrier, /expect\(events\.status\(\)\)\.toBe\(200\)/);
  }
});

test("E6 login is session-authoritative and visible reject follows the candidate cancel contract", () => {
  assert.match(
    e6Carrier,
    /function consoleShell\(page: Page\)[\s\S]*page\.locator\("aside"\)\.filter\(\{ has: page\.locator\("nav"\) \}\)/,
  );
  assert.match(e6Carrier, /async function classifyAuthSession\(page: Page\)/);
  assert.match(
    e6Carrier,
    /page\.request\.get\("\/api\/admin\/auth\/session"\)[\s\S]*response\.status\(\) === 200[\s\S]*response\.status\(\) === 401/,
  );
  assert.match(
    e6Carrier,
    /const sessionState = await classifyAuthSession\(page\);[\s\S]*if \(sessionState === "authenticated"\)[\s\S]*return;[\s\S]*const username/,
  );
  assert.match(e6Carrier, /await expect\(shell\)\.toHaveCount\(1\)/);
  assert.match(
    e6Carrier,
    /const stableSessionState = await classifyAuthSession\(page\);[\s\S]*if \(stableSessionState === "authenticated"\)[\s\S]*return;[\s\S]*await username\.fill\(account\.username\)/,
  );
  assert.doesNotMatch(e6Carrier, /waitForLoginState|Promise\.race\(\[[\s\S]*username\.waitFor/);
  assert.match(
    a2Audit,
    /onClick=\{\(e\) => \{ e\.stopPropagation\(\); rejectWo\(w\); \}\}[\s\S]{0,160}>取消<\/button>/,
  );
  assert.match(
    e6Carrier,
    /rejectThroughA2[\s\S]*decideThroughA2\(page, operationId, reason, "取消", "reject", "已取消"\)/,
  );
  assert.match(
    e6Carrier,
    /page\.locator\("tbody tr"\)[\s\S]{0,80}\.filter\(\{ has: page\.getByText\(operationId, \{ exact: true \}\) \}\)/,
  );
  assert.match(e6Carrier, /expect\(row\)\.toHaveCount\(1\)/);
  assert.match(
    e6Carrier,
    /const endpoint = `\/api\/admin\/platform\/audit\/operations\/\$\{encodeURIComponent\(operationId\)\}\/\$\{action\}`/,
  );
  assert.match(
    e6Carrier,
    /new URL\(response\.url\(\)\)\.pathname === endpoint[\s\S]*expect\(response\.status\(\)\)\.toBe\(200\)[\s\S]*apiSuccess\(response, `\$\{action\} \$\{operationId\}`\)/,
  );
  assert.doesNotMatch(
    e6Carrier,
    /decideThroughA2\(page, operationId, reason, "驳回", "reject"/,
  );
  assert.match(
    eOwnerCarrier,
    /const sidebar = page\.locator\("aside"\)\.filter\(\{ has: page\.locator\("nav"\) \}\)/,
  );
  assert.match(eOwnerCarrier, /await expect\(sidebar\)\.toHaveCount\(1\)/);
  assert.match(
    eOwnerCarrier,
    /const group = sidebar\.getByRole\("button", \{ name: \/设备与商城\\s\+E\|E\\s\+设备与商城\/ \}\)/,
  );
  assert.match(eOwnerCarrier, /await expect\(async \(\) => \{[\s\S]*await expect\(link\)\.toBeVisible\(\)[\s\S]*\}\)\.toPass/);
  assert.doesNotMatch(
    eOwnerCarrier,
    /page\.getByRole\("button", \{ name: \/设备与商城\\s\+E\|E\\s\+设备与商城\/ \}\)\.first\(\)/,
  );
  assert.match(eOwnerCarrier, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(eOwnerCarrier, /async function classifyOwnerAuthSession\(page: Page\)/);
  assert.match(
    eOwnerCarrier,
    /const sessionState = await classifyOwnerAuthSession\(page\);[\s\S]*if \(sessionState === "authenticated"\)/,
  );
  assert.match(
    eOwnerCarrier,
    /page\.waitForResponse\(\(response\) =>[\s\S]*"\/api\/admin\/auth\/mfa\/verify"[\s\S]*verifyResponse\.status\(\) === 200/,
  );
  assert.match(
    eOwnerCarrier,
    /const postLoginSessionState = await classifyOwnerAuthSession\(page\);[\s\S]*if \(postLoginSessionState === "authenticated" && await ownerShellVisible\(page, 20_000\)\) return/,
  );
  assert.match(
    eOwnerCarrier,
    /const postLoginTransition = await waitForOwnerLoginTransition\(page, 20_000\);[\s\S]*if \(postLoginTransition === "authenticated"\) return/,
  );
  assert.match(
    eOwnerCarrier,
    /await expect\(async \(\) => \{[\s\S]*await username\.fill\(account\.username\)[\s\S]*await password\.fill\(account\.password\)[\s\S]*await expect\(username\)\.toHaveValue\(account\.username\)[\s\S]*await expect\(password\)\.toHaveValue\(account\.password\)[\s\S]*\}\)\.toPass/,
  );
  assert.match(
    eOwnerCarrier,
    /async function waitForOwnerLoginTransition\(page: Page, timeout: number\)[\s\S]*classifyOwnerAuthSession\(page\)[\s\S]*ownerShell\(page\)[\s\S]*getByLabel\("一次性验证码"\)/,
  );
  assert.match(
    eOwnerCarrier,
    /const mfaSessionState = await classifyOwnerAuthSession\(page\);[\s\S]*if \(mfaSessionState === "authenticated" && await ownerShellVisible\(page, 20_000\)\) return/,
  );
  assert.doesNotMatch(eOwnerCarrier, /await expect\(otp\)\.toBeVisible\(\{ timeout: 15_000 \}\)/);
  assert.doesNotMatch(
    eOwnerCarrier,
    /if \(await page\.locator\("aside"\)\.isVisible\(\)\.catch\(\(\) => false\)\) return/,
  );
});
