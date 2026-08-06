import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./fixtures/checker-enrollment-secret-sync.mjs", import.meta.url),
  "utf8",
);

test("checker secret sync is explicit, loopback-run scoped, and never logs the secret", () => {
  assert.match(source, /CHECKER_SECRET_SYNC !== "1"/);
  assert.match(source, /required\("CHECKER_SECRET_SYNC_RUN_ID"\)/);
  assert.match(source, /required\("CHECKER_SECRET_SYNC_RESTRICTED_ROOT"\)/);
  assert.match(source, /required\("CHECKER_SECRET_SYNC_DATABASE"\)/);
  assert.match(source, /required\("CHECKER_SECRET_SYNC_MYSQL_PASSWORD"\)/);
  assert.match(source, /required\("CHECKER_SECRET_SYNC_MFA_KEY"\)/);
  assert.match(source, /realpath\(path\.resolve\("D:\/workspace\/bug-pic\/\.restricted"\)\)/);
  assert.match(source, /path\.relative\(allowedBase, canonicalRoot\)/);
  assert.doesNotMatch(source, /console\.log\(.*(?:secret|totpSecret|bodyText)/i);
});

test("sync binds the enrollment evidence to the same checker and atomically updates all 14 manifests", () => {
  assert.match(source, /checker-reset-2fa-summary\.json/);
  assert.match(source, /resetSummary\.accountId !== String\(global\.checker\.id\)/);
  assert.match(source, /resetSummary\.username !== global\.checker\.username/);
  assert.match(source, /MYSQL_PWD/);
  assert.match(source, /SELECT tfa_secret_encrypted/);
  assert.match(source, /createDecipheriv\("aes-256-gcm"/);
  assert.match(source, /for \(const domain of DOMAINS\)/);
  assert.match(source, /await rename\(temporary, file\)/);
  assert.match(source, /updatedManifestCount: 14/);
  assert.match(source, /syncCompleted: true/);
});
