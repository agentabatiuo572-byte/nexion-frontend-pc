import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertRestrictedEvidenceDirectory,
  assertRestrictedOtpSinkFile,
  readFreshRegistrationOtp,
} from "./e2e/helpers/restricted-otp-sink.mjs";

const HARNESS = new URL("./e2e/h8-app-referral-chain-final3.mjs", import.meta.url);
const WRAPPER = new URL("./e2e/h-final3-owner-all.ps1", import.meta.url);

function restrictedFixture() {
  const root = mkdtempSync(join(tmpdir(), "nexion-h8-otp-"));
  const restricted = join(root, ".restricted", "run", "H");
  mkdirSync(restricted, { recursive: true });
  return { root, file: join(restricted, "otp-sink-latest.json") };
}

test("restricted OTP file guard rejects non-absolute and non-restricted carriers", () => {
  assert.throws(() => assertRestrictedOtpSinkFile(null), /absolute/i);
  assert.throws(() => assertRestrictedOtpSinkFile("otp.json"), /absolute/i);
  assert.throws(() => assertRestrictedOtpSinkFile(join(tmpdir(), "otp.json")), /\.restricted/i);
});

test("private H8 evidence is constrained to the matching restricted Run ID", () => {
  const fixture = restrictedFixture();
  try {
    assert.equal(
      assertRestrictedEvidenceDirectory(join(fixture.root, ".restricted", "run", "H"), "run"),
      join(fixture.root, ".restricted", "run", "H"),
    );
    assert.throws(() => assertRestrictedEvidenceDirectory("relative", "run"), /absolute/i);
    assert.throws(() => assertRestrictedEvidenceDirectory(join(fixture.root, "public"), "run"), /\.restricted/i);
    assert.throws(
      () => assertRestrictedEvidenceDirectory(join(fixture.root, ".restricted", "other", "H"), "run"),
      /Run ID/i,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("current sink reader ignores stale or mismatched rows and returns only the exact fresh challenge", async () => {
  const fixture = restrictedFixture();
  try {
    const requestedAt = Date.now();
    writeFileSync(fixture.file, JSON.stringify({
      countryCode: "+81",
      phone: "818000000001",
      challengeNo: "REG-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      code: "111111",
      ttlMinutes: 5,
      receivedAt: new Date(requestedAt - 60_000).toISOString(),
    }));

    setTimeout(() => writeFileSync(fixture.file, JSON.stringify({
      countryCode: "+81",
      phone: "818000000001",
      challengeNo: "REG-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      code: "654321",
      ttlMinutes: 5,
      receivedAt: new Date().toISOString(),
    })), 25);

    const otp = await readFreshRegistrationOtp({
      file: fixture.file,
      countryCode: "+81",
      phone: "818000000001",
      challengeNo: "REG-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      requestedAt,
      timeoutMs: 1_000,
      pollMs: 10,
    });
    assert.equal(otp.code, "654321");
    assert.equal(otp.challengeNo, "REG-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("current sink reader fails closed on malformed or non-matching rows without leaking OTP values", async () => {
  const fixture = restrictedFixture();
  try {
    writeFileSync(fixture.file, "{partial");
    await assert.rejects(
      readFreshRegistrationOtp({
        file: fixture.file,
        countryCode: "+81",
        phone: "818000000002",
        challengeNo: "REG-cccccccccccccccccccccccccccccccc",
        requestedAt: Date.now(),
        timeoutMs: 40,
        pollMs: 5,
      }),
      (error) => {
        assert.match(error.message, /matching fresh registration OTP/i);
        assert.doesNotMatch(error.message, /\d{6}/);
        return true;
      },
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("current sink reader rejects invalid polling bounds before touching the carrier", async () => {
  const fixture = restrictedFixture();
  try {
    await assert.rejects(readFreshRegistrationOtp({
      file: fixture.file,
      countryCode: "+81",
      phone: "818000000003",
      challengeNo: "REG-dddddddddddddddddddddddddddddddd",
      requestedAt: Number.NaN,
      timeoutMs: 0,
      pollMs: 0,
    }), /polling bounds are invalid/i);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("current sink reader rejects every unsafe row-shape boundary", async () => {
  const fixture = restrictedFixture();
  const requestedAt = Date.now();
  const expected = {
    countryCode: "+81",
    phone: "818000000004",
    challengeNo: "REG-eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    code: "123456",
    ttlMinutes: 5,
    receivedAt: new Date(requestedAt).toISOString(),
  };
  const invalidRows = [
    null,
    [],
    { ...expected, countryCode: "+1" },
    { ...expected, phone: "818000000099" },
    { ...expected, challengeNo: "REG-ffffffffffffffffffffffffffffffff" },
    { ...expected, code: "12345" },
    { ...expected, ttlMinutes: 1.5 },
    { ...expected, ttlMinutes: 0 },
    { ...expected, ttlMinutes: 16 },
    { ...expected, receivedAt: "not-a-date" },
    { ...expected, receivedAt: new Date(requestedAt - 60_000).toISOString() },
    { ...expected, receivedAt: new Date(requestedAt + 60_000).toISOString() },
  ];
  try {
    for (const row of invalidRows) {
      writeFileSync(fixture.file, JSON.stringify(row));
      await assert.rejects(readFreshRegistrationOtp({
        file: fixture.file,
        countryCode: expected.countryCode,
        phone: expected.phone,
        challengeNo: expected.challengeNo,
        requestedAt,
        timeoutMs: 3,
        pollMs: 1,
      }), /matching fresh registration OTP/i);
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("H8 wrapper and harness consume the restricted file contract and never call the removed GET /last endpoint", () => {
  const harness = readFileSync(HARNESS, "utf8");
  const wrapper = readFileSync(WRAPPER, "utf8");

  assert.match(harness, /H_FINAL3_OTP_SINK_FILE/);
  assert.match(harness, /readFreshRegistrationOtp/);
  assert.doesNotMatch(harness, /H_FINAL3_OTP_SINK_URL|\/last\b/);

  assert.match(wrapper, /H_FINAL3_OTP_SINK_FILE/);
  assert.match(wrapper, /\/health/);
  assert.match(wrapper, /otpSinkHealth\s*=\s*'204\/HEALTH'/);
  assert.match(wrapper, /OtpSinkUrl must be the frozen loopback carrier/);
  assert.match(wrapper, /EvidenceRoot must be beneath the current restricted Run ID/);
  assert.match(wrapper, /OTP sink file must be beneath the current restricted Run ID/);
  assert.doesNotMatch(wrapper, /\/last\b|otpSinkReadOnly/);

  assert.match(harness, /assertRestrictedEvidenceDirectory/);
  assert.match(harness, /H_FINAL3_EVIDENCE_RUN_ID/);
  assert.match(wrapper, /H_FINAL3_EVIDENCE_RUN_ID\s*=\s*\$RunId/);
  assert.match(wrapper, /H_ACCEPTANCE_RUN_ID\s*=\s*\$waveId/);
});
