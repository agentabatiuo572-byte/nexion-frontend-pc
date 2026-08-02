import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = readFileSync(new URL("./e2e/i6-i001-runtime-gate-20260729.spec.ts", import.meta.url), "utf8");
const loginStart = source.indexOf("async function login(");
const loginEnd = source.indexOf("async function openI6(", loginStart);
const login = source.slice(loginStart, loginEnd);

test("I6 checker MFA never pre-arms its finite listener across a TOTP wait", () => {
  const responseWait = login.indexOf("const verification = page.waitForResponse");
  const freshCode = login.indexOf("const totp = await freshTotp(account.username, account.totpSecret)");
  const stableHydration = login.indexOf("let otpAccepted = false");
  const clear = login.indexOf("await otp.clear()");
  const humanTyping = login.indexOf("await otp.pressSequentially(totp.code, { delay: 60 })");
  const stableWindow = login.indexOf("await page.waitForTimeout(250)", humanTyping);
  const exactValue = login.indexOf("toHaveValue(totp.code");
  const click = login.indexOf("await verifyButton.click()");

  assert.ok(responseWait >= 0 && login.includes("timeout: 20_000"), "MFA response listener must be explicitly finite");
  assert.ok(freshCode >= 0 && freshCode < responseWait, "fresh TOTP must finish before the finite response listener is armed");
  assert.ok(stableHydration > freshCode, "controlled-input hydration must be checked after OTP generation");
  assert.ok(clear > stableHydration, "each retry must start from a focused, cleared OTP input");
  assert.ok(humanTyping > clear, "OTP must be entered through sequential real keyboard events");
  assert.ok(stableWindow > humanTyping, "React-controlled input must stay stable after typing");
  assert.ok(exactValue > stableWindow, "every submitted OTP must be verified after the stable window");
  assert.ok(responseWait > exactValue, "the finite response listener must be armed only after OTP stability is proven");
  assert.ok(click > exactValue, "submit must follow the exact OTP value assertion");
  assert.ok(click > responseWait, "the finite response listener must sit immediately before submit");
  assert.match(login, /page\.request\.get\("\/api\/admin\/auth\/session"\)/, "successful MFA must prove an authenticated session");
  assert.doesNotMatch(login, /otp\.fill\(/, "MFA OTP must not use a synthetic fill shortcut");
});

test("I6 checker MFA boundary model waits for a fresh TOTP step before its network window", () => {
  const freshTotpStart = source.indexOf("async function freshTotp(");
  const freshTotpEnd = source.indexOf("function currentTotp(", freshTotpStart);
  const freshTotp = source.slice(freshTotpStart, freshTotpEnd);

  // Fake clock: at 29s in a 30s step, a code must not be used until the next step.
  const readyAt = (nowMs, lastStep) => {
    const stepMs = 30_000;
    let ready = nowMs;
    const currentStep = Math.floor(nowMs / stepMs);
    if (currentStep <= lastStep) ready = (lastStep + 1) * stepMs + 500;
    const remaining = 30 - (Math.floor(ready / 1_000) % 30);
    if (remaining <= 3) ready += (remaining + 1) * 1_000;
    return ready;
  };

  assert.ok(readyAt(29_000, -1) >= 31_000, "fake clock rejects a code with only one second remaining");
  assert.ok(readyAt(60_000, 2) >= 90_500, "fake clock advances when the last TOTP step was already used");
  assert.match(freshTotp, /remaining <= 3/, "runtime helper must retain boundary protection");
  assert.match(freshTotp, /tryAcquireTotpStepLease/, "runtime helper must coordinate a step lease before calculating a code");
  assert.match(freshTotp, /TOTP_STEP_LEASE_UNAVAILABLE/, "runtime helper must fail closed after bounded lease contention");
  assert.match(login, /timeout: 20_000/, "MFA verify network wait remains bounded at twenty seconds");
});

test("I6 checker MFA multi-process lease permits exactly one account-step claimant", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "i6-mfa-lease-"));
  const leasePath = path.join(tempDir, "account-hash-123.42.lease");
  const worker = `
    const fs = require("node:fs");
    try {
      fs.writeFileSync(process.env.I6_LEASE_PATH, JSON.stringify({ step: 42 }), { flag: "wx" });
      process.stdout.write("claimed");
    } catch (error) {
      process.stdout.write(error && error.code === "EEXIST" ? "contended" : "error");
    }
  `;
  const claim = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", worker], {
      env: { ...process.env, I6_LEASE_PATH: leasePath },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  });

  try {
    const outcomes = await Promise.all([claim(), claim()]);
    assert.deepEqual(outcomes.sort(), ["claimed", "contended"], "two processes cannot reserve the same account TOTP step");
    assert.match(source, /writeFileSync\(leasePath,.*flag: "wx"/s, "runtime lease must use atomic exclusive creation");
    assert.match(source, /recordTotpStepResult\(totp\.lease, "accepted"\)/, "a 200 MFA verify must atomically record the consumed step");
    assert.match(source, /recordTotpStepResult\(totp\.lease, "replayed"\)/, "a replay response must record the consumed step before retry");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
