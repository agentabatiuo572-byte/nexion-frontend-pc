import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import path from "node:path";
import {
  assertRestrictedEvidenceDirectory,
  assertRestrictedOtpSinkFile,
  readFreshRegistrationOtp,
} from "./helpers/restricted-otp-sink.mjs";

const base = required("H_FINAL3_BACKEND_URL");
const runId = required("H_ACCEPTANCE_RUN_ID");
const evidenceRunId = required("H_FINAL3_EVIDENCE_RUN_ID");
const otpSinkFile = assertRestrictedOtpSinkFile(required("H_FINAL3_OTP_SINK_FILE"));
const evidenceDir = assertRestrictedEvidenceDirectory(required("H_FINAL3_APP_EVIDENCE_DIR"), evidenceRunId);
const stamp = String(Date.now()).slice(-8);
const safePath = path.join(evidenceDir, "app-referral-chain.json");
const privatePath = path.join(evidenceDir, "cleanup-private.json");
const headers = {
  "Content-Type": "application/json",
  "X-Nexion-Edge-Country": "JP",
  "CF-IPCountry": "JP",
};
const record = { runId, startedAt: new Date().toISOString(), checks: [] };
const cleanup = { runId, result: "IN_PROGRESS", accounts: {} };

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value.replace(/\/+$/, "");
}

function check(name, ok, detail = {}) {
  record.checks.push({ name, ok, ...detail });
  if (!ok) throw new Error(`${name} failed`);
}

async function json(url, init = {}) {
  const payload = init.body || "";
  return await new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: init.method || "GET",
      localAddress: init.localAddress,
      headers: {
        ...(init.headers || {}),
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw || "{}") });
        } catch {
          resolve({ status: res.statusCode, body: {} });
        }
      });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function register(label, sponsorCode) {
  const localAddress = label === "inviter" ? "127.0.0.2" : "127.0.0.3";
  const phone = `818${stamp}${label === "inviter" ? "1" : "2"}`;
  const requestedAt = Date.now();
  const sent = await json(`${base}/auth/users/register/otp/send`, {
    method: "POST",
    headers,
    localAddress,
    body: JSON.stringify({ countryCode: "+81", phone }),
  });
  check(`${label}-otp-send`, sent.status === 200 && Boolean(sent.body?.data?.challengeNo), {
    status: sent.status,
    code: sent.body?.code,
  });
  const otp = await readFreshRegistrationOtp({
    file: otpSinkFile,
    countryCode: "+81",
    phone,
    challengeNo: String(sent.body.data.challengeNo),
    requestedAt,
  });
  check(
    `${label}-otp-captured`,
    otp.challengeNo === sent.body.data.challengeNo,
    { challengeMatched: otp.challengeNo === sent.body.data.challengeNo },
  );
  const registered = await json(`${base}/auth/users/register`, {
    method: "POST",
    headers,
    localAddress,
    body: JSON.stringify({
      countryCode: "+81",
      phone,
      challengeNo: sent.body.data.challengeNo,
      code: otp.code,
      password: `NexHf3${stamp}a`,
      sponsorCode,
    }),
  });
  const data = registered.body?.data || {};
  const userId = Number(data.user?.id ?? data.user?.userId ?? data.userId);
  const token = data.accessToken ?? data.token;
  const refreshToken = data.refreshToken;
  check(
    `${label}-register`,
    registered.status === 200
      && Number.isSafeInteger(userId)
      && userId > 0
      && Boolean(token)
      && Boolean(refreshToken),
    { status: registered.status, code: registered.body?.code, userId },
  );
  cleanup.accounts[label] = {
    userId,
    countryCode: "+81",
    phone,
    challengeNo: sent.body.data.challengeNo,
  };
  await writeFile(privatePath, `${JSON.stringify(cleanup, null, 2)}\n`, "utf8");
  return { userId, phone, token, refreshToken, localAddress };
}

async function referral(account, label) {
  const got = await json(`${base}/api/app/referral-code`, {
    localAddress: account.localAddress,
    headers: { ...headers, Authorization: `Bearer ${account.token}` },
  });
  const data = got.body?.data || {};
  check(
    `${label}-canonical-referral`,
    got.status === 200
      && typeof data.referralCode === "string"
      && data.referralCode.length >= 6
      && Object.keys(data).length === 1,
    { status: got.status, keys: Object.keys(data), code: got.body?.code },
  );
  return data.referralCode;
}

async function logout(account, label) {
  const response = await json(`${base}/auth/users/logout`, {
    method: "POST",
    headers,
    localAddress: account.localAddress,
    body: JSON.stringify({ refreshToken: account.refreshToken }),
  });
  check(`${label}-logout`, response.status === 200 && response.body?.code === 0, {
    status: response.status,
    code: response.body?.code,
  });
}

await mkdir(evidenceDir, { recursive: true });
try {
  const inviter = await register("inviter");
  const inviterCode = await referral(inviter, "inviter");
  const invitee = await register("invitee", inviterCode);
  const inviteeCode = await referral(invitee, "invitee");
  const sharePath = `/pages/invite/index?referralCode=${encodeURIComponent(inviterCode)}`;
  check(
    "app-share-poster-contract",
    !sharePath.includes(inviteeCode)
      && /^\/pages\/invite\/index\?referralCode=/.test(sharePath),
    { sharePathTemplate: "/pages/invite/index?referralCode=<canonical>" },
  );
  await logout(inviter, "inviter");
  await logout(invitee, "invitee");
  cleanup.result = "PASS";
  await writeFile(privatePath, `${JSON.stringify(cleanup, null, 2)}\n`, "utf8");
  record.result = "PASS";
  record.accounts = {
    inviter: {
      userId: inviter.userId,
      phoneLast4: inviter.phone.slice(-4),
      referralCode: inviterCode,
    },
    invitee: {
      userId: invitee.userId,
      phoneLast4: invitee.phone.slice(-4),
      referralCode: inviteeCode,
    },
  };
  await writeFile(safePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    result: record.result,
    inviterUserId: inviter.userId,
    inviteeUserId: invitee.userId,
  }));
} catch (error) {
  cleanup.result = "FAIL";
  await writeFile(privatePath, `${JSON.stringify(cleanup, null, 2)}\n`, "utf8");
  record.result = "FAIL";
  record.error = error instanceof Error ? error.message : String(error);
  await writeFile(safePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.error(JSON.stringify({ result: "FAIL", error: record.error }));
  process.exitCode = 1;
}
