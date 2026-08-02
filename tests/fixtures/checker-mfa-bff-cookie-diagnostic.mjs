import { createHmac } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";

if (process.env.CHECKER_MFA_COOKIE_DIAGNOSTIC !== "1") {
  console.error("CHECKER_MFA_COOKIE_DIAGNOSTIC=1 is required");
  process.exit(2);
}
const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be explicitly provided`);
  return value;
};
const baseUrl = new URL(required("CHECKER_MFA_COOKIE_BASE_URL"));
if (!["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname)) {
  throw new Error("diagnostic only permits a loopback PC endpoint");
}
const requestedRoot = path.resolve(required("CHECKER_MFA_COOKIE_RESTRICTED_ROOT"));
const allowedBase = await realpath(path.resolve("D:/workspace/bug-pic/.restricted"));
const canonicalRoot = await realpath(requestedRoot);
const relative = path.relative(allowedBase, canonicalRoot);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
  throw new Error("diagnostic requires a child Run directory under canonical bug-pic/.restricted");
}
const fixture = JSON.parse(await readFile(
  path.join(canonicalRoot, "A", "permission-fixtures", "permission-fixtures.json"),
  "utf8",
));
const login = await fetch(new URL("/api/admin/auth/login", baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: fixture.checker.username,
    password: fixture.checker.password,
  }),
});
const loginPayload = await login.json().catch(() => null);
const challengeId = loginPayload?.data?.mfa?.challengeId;
if (!login.ok || loginPayload?.code !== 0 || !challengeId) {
  throw new Error(`checker login challenge failed status=${login.status} code=${loginPayload?.code ?? "unknown"}`);
}
await safeTotpWindow();
const verification = await fetch(new URL("/api/admin/auth/mfa/verify", baseUrl), {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    challengeId,
    code: currentTotp(fixture.checker.totpSecret),
  }),
});
const verifyPayload = await verification.json().catch(() => null);
const setCookie = verification.headers.get("set-cookie") ?? "";
const cookieSecure = /;\s*Secure(?:;|$)/i.test(setCookie);
const cookiePresent = /^nexion_admin_token=/i.test(setCookie);
const accessTokenExposed = typeof verifyPayload?.data?.accessToken === "string";
console.log(JSON.stringify({
  loginStatus: login.status,
  verifyStatus: verification.status,
  verifyCode: verifyPayload?.code ?? "unknown",
  verifyMessage: verifyPayload?.message ?? "unknown",
  sessionPresent: Boolean(verifyPayload?.data?.session),
  accessTokenExposed,
  setCookiePresent: cookiePresent,
  cookieSecure,
}));

function currentTotp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = String(secret).replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function safeTotpWindow() {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining <= 4_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 500));
  }
}
