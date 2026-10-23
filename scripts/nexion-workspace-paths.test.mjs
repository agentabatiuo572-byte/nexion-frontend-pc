import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveNexionAppRoot, resolveNexionBackendRoot, resolveNexionJanusRoot, resolveNexionPrdRoot } from "./lib/nexion-workspace-paths.mjs";

const REAL_ADMIN = path.resolve("D:/workspace/nexion-ops-console");
const HIGH_ADMIN = path.resolve("D:/workspace/nexion-高保真/nexion-ops-console");
const normalize = (value) => path.normalize(value);

test("managed worktrees prefer canonical workspace projects over stale task sibling aliases", () => {
  const adminRoot = path.resolve("D:/workspace/.worktrees/candidate");
  for (const [resolve, name] of [[resolveNexionAppRoot, "NX1.0-UniApp"], [resolveNexionBackendRoot, "nexion-backend"], [resolveNexionJanusRoot, "NX1.0-Janus"]]) {
    const expected = path.resolve("D:/workspace", name);
    const stale = path.resolve("D:/workspace/.worktrees", name);
    const exists = candidate => [expected, stale].some(root => normalize(candidate) === normalize(root));
    assert.equal(normalize(resolve({ adminRoot, env: {}, exists })), normalize(expected));
  }
});

test("Janus source evidence resolves real and isolated worktrees without accepting a missing configured root", () => {
  const expected = path.resolve("D:/workspace/NX1.0-Janus");
  const exists = candidate => normalize(candidate) === normalize(expected);
  for (const adminRoot of [REAL_ADMIN, HIGH_ADMIN, path.resolve("D:/workspace/.worktrees/candidate")]) {
    assert.equal(normalize(resolveNexionJanusRoot({ adminRoot, env: {}, exists })), normalize(expected));
  }
  assert.throws(() => resolveNexionJanusRoot({ adminRoot: REAL_ADMIN, env: { NEXION_JANUS_ROOT: "Z:/missing/Janus" }, exists }), /NEXION_JANUS_ROOT.*不存在/);
  assert.throws(() => resolveNexionJanusRoot({ adminRoot: REAL_ADMIN, env: {}, exists: () => false }), /未找到 Nexion Janus 项目/);
});

test("real and nested admin layouts resolve the declared NX1.0 checkout", () => {
  const expected = path.resolve("D:/workspace/NX1.0");
  const exists = (candidate) => normalize(candidate) === normalize(expected);
  assert.equal(normalize(resolveNexionAppRoot({ adminRoot: REAL_ADMIN, env: {}, exists })), normalize(expected));
  assert.equal(normalize(resolveNexionAppRoot({ adminRoot: HIGH_ADMIN, env: {}, exists })), normalize(expected));
});

test("real and nested admin layouts resolve the backend checkout", () => {
  const expected = path.resolve("D:/workspace/nexion-backend");
  const exists = (candidate) => normalize(candidate) === normalize(expected);
  assert.equal(normalize(resolveNexionBackendRoot({ adminRoot: REAL_ADMIN, env: {}, exists })), normalize(expected));
  assert.equal(normalize(resolveNexionBackendRoot({ adminRoot: HIGH_ADMIN, env: {}, exists })), normalize(expected));
});

test("real and nested admin layouts resolve the authoritative PC PRD directory", () => {
  const expected = path.resolve("D:/workspace/nexion-ops-console/docs/PRD");
  const legacyWorkspacePrd = path.resolve("D:/workspace/PRD");
  const highFidelityPrd = path.resolve("D:/workspace/nexion-高保真/nexion-ops-console/docs/PRD");
  const exists = (candidate) => [expected, legacyWorkspacePrd, highFidelityPrd]
    .some((pathValue) => normalize(candidate) === normalize(pathValue));
  assert.equal(normalize(resolveNexionPrdRoot({ adminRoot: REAL_ADMIN, env: {}, exists })), normalize(expected));
  assert.equal(normalize(resolveNexionPrdRoot({ adminRoot: HIGH_ADMIN, env: {}, exists })), normalize(expected));
  assert.throws(
    () => resolveNexionPrdRoot({ adminRoot: REAL_ADMIN, env: { NEXION_PRD_ROOT: "Z:/missing/PRD" }, exists: () => false }),
    /NEXION_PRD_ROOT.*不存在/,
  );
});

test("explicit checkout paths are authoritative and fail closed", () => {
  const app = path.resolve("E:/custom/NX1.0");
  const backend = path.resolve("E:/custom/nexion-backend");
  assert.equal(
    normalize(resolveNexionAppRoot({ adminRoot: REAL_ADMIN, env: { NEXION_APP_ROOT: app }, exists: (value) => normalize(value) === normalize(app) })),
    normalize(app),
  );
  assert.equal(
    normalize(resolveNexionBackendRoot({ adminRoot: REAL_ADMIN, env: { NEXION_BACKEND_ROOT: backend }, exists: (value) => normalize(value) === normalize(backend) })),
    normalize(backend),
  );
  assert.throws(
    () => resolveNexionAppRoot({ adminRoot: REAL_ADMIN, env: { NEXION_APP_ROOT: "Z:/missing/NX1.0" }, exists: () => false }),
    /NEXION_APP_ROOT.*不存在/,
  );
  assert.throws(
    () => resolveNexionBackendRoot({ adminRoot: REAL_ADMIN, env: { NEXION_BACKEND_ROOT: "Z:/missing/backend" }, exists: () => false }),
    /NEXION_BACKEND_ROOT.*不存在/,
  );
});
