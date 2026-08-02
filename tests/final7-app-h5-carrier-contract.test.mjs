import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SPEC = new URL("./e2e/final7-app-h5-f003-l008-dynamic.spec.ts", import.meta.url);
const CARRIER = new URL("./e2e/final7-app-h5-loopback-carrier.mjs", import.meta.url);
const RUNBOOK = new URL("./e2e/final7-app-h5-f003-l008-dynamic.README.md", import.meta.url);

function source(url) {
  return readFileSync(url, "utf8");
}

test("Final7 App H5 carrier keeps browser and OTP transport inside restricted loopback boundaries", () => {
  const carrier = source(CARRIER);

  for (const marker of [
    "APP_RESTRICTED_EVIDENCE_DIR",
    "APP_TLS_PFX_FILE",
    "APP_TLS_PFX_PASSWORD",
    "APP_BACKEND_ORIGIN",
    "https.createServer",
    "http.createServer",
    "otp-sink-latest.json",
    "127.0.0.1",
    ".restricted",
  ]) {
    assert.match(carrier, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(carrier, /APP_BACKEND_ORIGIN[^\n]+http:\/\/127\.0\.0\.1:8110/);
  assert.doesNotMatch(carrier, /console\.(?:log|info|warn|error)\([^\n]*(?:code|payload|body)/i);
  assert.doesNotMatch(carrier, /\/last\b/);
});

test("Final7 HTTPS proxy injects one controller-fixed ISO country only into the frozen loopback upstream", () => {
  const carrier = source(CARRIER);

  assert.match(carrier, /required\("APP_EDGE_COUNTRY_CODE"\)/);
  assert.match(carrier, /ISO_ALPHA_2_COUNTRY_CODES\.has\(edgeCountryCode\)/);
  assert.match(carrier, /APP_BACKEND_ORIGIN !== "http:\/\/127\.0\.0\.1:8110"/);
  assert.match(carrier, /headers\["x-nexion-edge-country"\] = edgeCountryCode/);
  assert.doesNotMatch(carrier, /request\.headers\["x-nexion-edge-country"\]/);
});

test("Final7 App H5 spec enters registration and business pages only through visible controls", () => {
  const spec = source(SPEC);

  for (const marker of [
    ".cta-primary",
    ".rg-phone__in",
    ".rg-otp__in",
    ".rg-field",
    ".rg-cta",
    ".rs-title",
    ".rs-continue",
    ".est-go",
    ".cn-go--glow",
    ".cn-go--on",
    ".nx-team-rank-link",
    ".nx-team-binary-link",
    ".lg-phone__in",
    ".lg-field--flex",
  ]) {
    assert.ok(spec.includes(marker), `missing visible-control marker ${marker}`);
  }
  assert.match(spec, /page\.goto\(runtime\.h5BaseUrl\)/);
  assert.doesNotMatch(spec, /page\.goto\([^\n]*\/pages\//);
  assert.doesNotMatch(spec, /(?:addInitScript|storageState|localStorage|sessionStorage|addCookies|Authorization|accessToken|refreshToken|route\.fulfill)/);
});

test("Final7 App H5 spec covers F1, F3, L6, faults, lifecycle and safe evidence", () => {
  const spec = source(SPEC);

  for (const endpoint of [
    "/api/config/v-ranks",
    "/api/team/rank",
    "/api/config/commission/rates",
    "/api/team/binary",
    "/api/app/analytics/events",
  ]) {
    assert.ok(spec.includes(endpoint), `missing endpoint ${endpoint}`);
  }
  for (const marker of [
    "pageerror",
    "requestfailed",
    "console",
    "unexpectedHttpFailures",
    "page.reload",
    "unknownResult",
    "idempotency",
    "failClosed",
    "route.abort",
    "cleanup-manifest-private.json",
    "safe-result.json",
    "screenshot",
  ]) {
    assert.ok(spec.includes(marker), `missing runtime/evidence marker ${marker}`);
  }
  assert.match(spec, /resolveInsideRestrictedRoot/);
  assert.match(spec, /readFileSync\(runtime\.otpSinkFile/);
  assert.doesNotMatch(spec, /console\.(?:log|info|warn|error)\(/);
  assert.doesNotMatch(spec, /writeFileSync\([^\n]*(?:otp|password|token)/i);
});

test("runbook freezes the controller-selected carrier ports and defers backend changes", () => {
  const runbook = source(RUNBOOK);
  const carrier = source(CARRIER);
  const spec = source(SPEC);

  for (const marker of ["5176", "18116", "18111", "8110", "--trace=on", "DO NOT START", "VITE_NEXGRID_API_BASE_URL"]) {
    assert.ok(runbook.includes(marker), `missing runbook marker ${marker}`);
  }
  assert.doesNotMatch(runbook, /https:\/\/127\.0\.0\.1:5175/);
  assert.match(carrier, /const H5_PORT = 5176/);
  assert.match(spec, /loopbackHttps\("APP_H5_BASE_URL", 5176\)/);
});
