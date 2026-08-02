import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export function assertRestrictedOtpSinkFile(file) {
  if (typeof file !== "string" || !isAbsolute(file)) {
    throw new Error("OTP sink file must be an absolute path");
  }
  const absolute = resolve(file);
  if (!absolute.split(/[\\/]+/).some((segment) => segment.toLowerCase() === ".restricted")) {
    throw new Error("OTP sink file must be beneath a .restricted directory");
  }
  return absolute;
}

export function assertRestrictedEvidenceDirectory(directory, runId) {
  if (typeof directory !== "string" || !isAbsolute(directory)) {
    throw new Error("private evidence directory must be an absolute path");
  }
  if (typeof runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{2,127}$/.test(runId)) {
    throw new Error("private evidence Run ID is invalid");
  }
  const absolute = resolve(directory);
  const segments = absolute.split(/[\\/]+/);
  const restrictedIndex = segments.findIndex((segment) => segment.toLowerCase() === ".restricted");
  if (restrictedIndex < 0) {
    throw new Error("private evidence directory must be beneath a .restricted directory");
  }
  if (segments[restrictedIndex + 1]?.toLowerCase() !== runId.toLowerCase()) {
    throw new Error("private evidence directory must match the current Run ID");
  }
  return absolute;
}

function matchingOtp(row, expected, now) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const receivedAt = Date.parse(String(row.receivedAt || ""));
  const ttlMinutes = Number(row.ttlMinutes);
  const code = String(row.code || "");
  if (String(row.countryCode || "") !== expected.countryCode
    || String(row.phone || "") !== expected.phone
    || String(row.challengeNo || "") !== expected.challengeNo
    || !/^REG-[a-f0-9]{32}$/i.test(expected.challengeNo)
    || !/^\d{6}$/.test(code)
    || !Number.isInteger(ttlMinutes)
    || ttlMinutes < 1
    || ttlMinutes > 15
    || !Number.isFinite(receivedAt)
    || receivedAt < expected.requestedAt - 2_000
    || receivedAt > now + 5_000) {
    return null;
  }
  return {
    countryCode: expected.countryCode,
    phone: expected.phone,
    challengeNo: expected.challengeNo,
    code,
    ttlMinutes,
    receivedAt: new Date(receivedAt).toISOString(),
  };
}

export async function readFreshRegistrationOtp({
  file,
  countryCode,
  phone,
  challengeNo,
  requestedAt,
  timeoutMs = 20_000,
  pollMs = 100,
}) {
  const absolute = assertRestrictedOtpSinkFile(file);
  if (!Number.isFinite(requestedAt)
    || !Number.isInteger(timeoutMs) || timeoutMs < 1
    || !Number.isInteger(pollMs) || pollMs < 1) {
    throw new Error("OTP sink polling bounds are invalid");
  }
  const expected = {
    countryCode: String(countryCode || ""),
    phone: String(phone || ""),
    challengeNo: String(challengeNo || ""),
    requestedAt,
  };
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(absolute)) {
      try {
        const match = matchingOtp(JSON.parse(readFileSync(absolute, "utf8")), expected, Date.now());
        if (match) return match;
      } catch {
        // The carrier replaces the file atomically; malformed state fails closed.
      }
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, pollMs));
  }
  throw new Error("current carrier did not deliver a matching fresh registration OTP");
}
