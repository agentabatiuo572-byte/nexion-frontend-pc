import http from "node:http";
import https from "node:https";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const HOST = "127.0.0.1";
const H5_PORT = 5176;
const BACKEND_PROXY_PORT = 18116;
const OTP_SINK_PORT = 18111;
const MAX_OTP_BODY_BYTES = 16 * 1024;
const APP_BACKEND_ORIGIN = process.env.APP_BACKEND_ORIGIN || "http://127.0.0.1:8110";
const ISO_ALPHA_2_COUNTRY_CODES = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" "));

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function canonical(path) {
  return resolve(path).replaceAll("/", "\\").toLowerCase();
}

function assertRestrictedRoot(path) {
  if (!isAbsolute(path)) throw new Error("APP_RESTRICTED_EVIDENCE_DIR must be absolute");
  const normalized = canonical(path);
  if (!normalized.split("\\").includes(".restricted")) {
    throw new Error("APP_RESTRICTED_EVIDENCE_DIR must be beneath a .restricted directory");
  }
  mkdirSync(path, { recursive: true });
  return resolve(path);
}

function resolveInsideRestrictedRoot(root, candidate) {
  const absolute = resolve(candidate);
  const child = relative(root, absolute);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error("restricted carrier file must be a child of APP_RESTRICTED_EVIDENCE_DIR");
  }
  return absolute;
}

const evidenceRoot = assertRestrictedRoot(required("APP_RESTRICTED_EVIDENCE_DIR"));
const pfxFile = resolveInsideRestrictedRoot(evidenceRoot, required("APP_TLS_PFX_FILE"));
const pfxPassword = required("APP_TLS_PFX_PASSWORD");
const h5Dist = resolve(required("APP_H5_DIST_DIR"));
const edgeCountryCode = required("APP_EDGE_COUNTRY_CODE");
if (!existsSync(pfxFile) || !statSync(pfxFile).isFile()) throw new Error("TLS PFX file is missing");
if (!existsSync(resolve(h5Dist, "index.html"))) throw new Error("production H5 index.html is missing");
if (!/^[A-Z]{2}$/.test(edgeCountryCode) || !ISO_ALPHA_2_COUNTRY_CODES.has(edgeCountryCode)) {
  throw new Error("APP_EDGE_COUNTRY_CODE must be a canonical ISO-3166 alpha-2 code");
}
if (APP_BACKEND_ORIGIN !== "http://127.0.0.1:8110") {
  throw new Error("APP_BACKEND_ORIGIN must be the frozen loopback backend on port 8110");
}

const tls = { pfx: readFileSync(pfxFile), passphrase: pfxPassword };
const h5Origin = `https://${HOST}:${H5_PORT}`;
const requestLog = resolveInsideRestrictedRoot(evidenceRoot, resolve(evidenceRoot, "carrier-requests.jsonl"));
const otpSinkFile = resolveInsideRestrictedRoot(evidenceRoot, resolve(evidenceRoot, "otp-sink-latest.json"));

function appendSafeRequest(row) {
  writeFileSync(requestLog, `${JSON.stringify(row)}\n`, { flag: "a", encoding: "utf8", mode: 0o600 });
}

function safePath(rawUrl) {
  const url = new URL(rawUrl || "/", h5Origin);
  const pathname = decodeURIComponent(url.pathname);
  const candidate = resolve(h5Dist, `.${pathname}`);
  const child = relative(h5Dist, candidate);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) return null;
  return candidate;
}

const mediaTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const h5Server = https.createServer(tls, (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405).end();
    return;
  }
  let file = safePath(request.url);
  if (!file) {
    response.writeHead(400).end();
    return;
  }
  if (!existsSync(file) || !statSync(file).isFile()) file = resolve(h5Dist, "index.html");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", mediaTypes.get(extname(file).toLowerCase()) || "application/octet-stream");
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "HEAD") {
    response.writeHead(200).end();
    return;
  }
  createReadStream(file).on("error", () => response.writeHead(500).end()).pipe(response);
});

const backendTarget = new URL(APP_BACKEND_ORIGIN);
const backendProxy = https.createServer(tls, (request, response) => {
  const requestUrl = new URL(request.url || "/", `https://${request.headers.host || HOST}`);
  if (!requestUrl.pathname.startsWith("/api/") && requestUrl.pathname !== "/actuator/health") {
    response.writeHead(404).end();
    return;
  }
  response.setHeader("Access-Control-Allow-Origin", h5Origin);
  response.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Accept,Content-Type,Idempotency-Key,Authorization,X-Expected-Version");
  response.setHeader("Vary", "Origin");
  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }
  const headers = { ...request.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.connection;
  // Ignore any browser-supplied value. The controller-frozen loopback carrier
  // is the trusted ingress and injects exactly one validated country code.
  headers["x-nexion-edge-country"] = edgeCountryCode;
  const startedAt = Date.now();
  const upstream = http.request({
    protocol: backendTarget.protocol,
    hostname: backendTarget.hostname,
    port: backendTarget.port,
    method: request.method,
    path: `${requestUrl.pathname}${requestUrl.search}`,
    headers,
  }, (upstreamResponse) => {
    const responseHeaders = { ...upstreamResponse.headers };
    delete responseHeaders["access-control-allow-origin"];
    delete responseHeaders["access-control-allow-credentials"];
    response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
    upstreamResponse.pipe(response);
    upstreamResponse.on("end", () => appendSafeRequest({
      at: new Date().toISOString(),
      method: request.method || "UNKNOWN",
      path: requestUrl.pathname,
      status: upstreamResponse.statusCode || 502,
      durationMs: Date.now() - startedAt,
    }));
  });
  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end();
    appendSafeRequest({
      at: new Date().toISOString(),
      method: request.method || "UNKNOWN",
      path: requestUrl.pathname,
      status: 502,
      durationMs: Date.now() - startedAt,
    });
  });
  request.pipe(upstream);
});

function readJsonBody(request) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let bytes = 0;
    request.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_OTP_BODY_BYTES) {
        rejectBody(new Error("OTP sink request is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        rejectBody(new Error("OTP sink request is invalid JSON"));
      }
    });
    request.on("error", rejectBody);
  });
}

const otpSink = http.createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== "POST" || request.url !== "/deliver") {
    response.writeHead(404).end();
    return;
  }
  try {
    const value = await readJsonBody(request);
    const row = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const countryCode = String(row.countryCode || "").trim();
    const phone = String(row.phone || "").trim();
    const challengeNo = String(row.challengeNo || "").trim();
    const code = String(row.code || "").trim();
    const ttlMinutes = Number(row.ttlMinutes);
    if (!/^\+[0-9]{1,4}$/.test(countryCode)
      || !/^[0-9]{6,15}$/.test(phone)
      || !/^REG-[a-f0-9]{32}$/i.test(challengeNo)
      || !/^[0-9]{6}$/.test(code)
      || !Number.isInteger(ttlMinutes)
      || ttlMinutes < 1
      || ttlMinutes > 15) {
      response.writeHead(422).end();
      return;
    }
    const temp = `${otpSinkFile}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ countryCode, phone, challengeNo, code, ttlMinutes, receivedAt: new Date().toISOString() })}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temp, otpSinkFile);
    response.writeHead(204).end();
  } catch {
    if (!response.headersSent) response.writeHead(400);
    response.end();
  }
});

const servers = [h5Server, backendProxy, otpSink];
function shutdown(exitCode = 0) {
  let pending = servers.length;
  const done = () => {
    pending -= 1;
    if (pending === 0) process.exit(exitCode);
  };
  for (const server of servers) server.close(done);
  setTimeout(() => process.exit(exitCode || 1), 5_000).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => {
  process.stderr.write(`Final7 carrier failed: ${error.message}\n`);
  shutdown(1);
});

h5Server.listen(H5_PORT, HOST);
backendProxy.listen(BACKEND_PROXY_PORT, HOST);
otpSink.listen(OTP_SINK_PORT, HOST, () => {
  process.stdout.write(`Final7 carrier ready: H5=${h5Origin} backendProxy=https://${HOST}:${BACKEND_PROXY_PORT} otpSink=http://${HOST}:${OTP_SINK_PORT}/deliver\n`);
});
