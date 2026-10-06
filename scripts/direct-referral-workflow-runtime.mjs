import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const env = process.env;
const startedAt = new Date().toISOString();
const index = process.argv.indexOf('--report');
assert(index >= 0 && process.argv[index + 1], '--report is required');
const report = path.resolve(process.argv[index + 1]);
for (const key of ['WORKFLOW_TASK_ID', 'WORKFLOW_STEP_ID', 'WORKFLOW_CHECK_ID', 'WORKFLOW_RUN_ID', 'WORKFLOW_REPO', 'WORKFLOW_SNAPSHOT_HASH']) assert(env[key], `Missing ${key}`);
assert.equal(path.resolve(env.WORKFLOW_REPO).toLowerCase(), process.cwd().toLowerCase());
const dir = path.join(path.dirname(report), 'pc-evidence', env.WORKFLOW_RUN_ID);
fs.mkdirSync(dir, { recursive: true });
const proofFile = path.join(dir, 'browser.json');
const start = Date.now();
const result = spawnSync(process.execPath, ['scripts/direct-referral-runtime.mjs', '--report', proofFile], { env, stdio: 'inherit', windowsHide: true, timeout: 540000 });
assert(!result.error && result.status === 0, `Browser acceptance failed: ${proofFile}`);
assert(fs.statSync(proofFile).mtimeMs >= start, 'Browser evidence is stale');
const proof = JSON.parse(fs.readFileSync(proofFile, 'utf8'));
assert.equal(proof.status, 'passed');
assert.equal(proof.capability, 'runtime');
assert.equal(path.resolve(proof.source.repo).toLowerCase(), process.cwd().toLowerCase());
assert.deepEqual(proof.pageErrors, []);
assert(proof.steps.length > 0 && proof.steps.every(step => step.status === 'passed' && step.evidence?.length), 'Incomplete browser steps');
const groups = {
  'pc-policy': ['F2-cutover-not-active', 'F2-error-retry', 'F2-validation-cancel', 'F2-one-atomic-proposal', 'F2-approved-readback-persistence', 'F2-seven-revision-conflict', 'F2-late-version-conflict', 'F2-B1-direction'],
  'pc-ledger': ['F5-new-groups-and-current-network', 'F5-CSV-all-rows', 'F5-CSV-filtered-rows'],
  'pc-legacy': ['preserved-/network/v-rank', 'preserved-/network/binary', 'preserved-/network/leadership-pool'],
  'pc-usability': ['F2-readonly', 'F2-keyboard-accessibility', 'F2-theme-narrow', 'F5-native-month-filter'],
  'pc-history': ['F2-empty-independent', 'F2-seven-layer-current'],
};
const steps = Object.entries(groups).map(([id, required]) => {
  const found = required.map(name => { const step = proof.steps.find(item => item.id === name); assert(step, `Missing ${name}`); return step; });
  return { id, status: 'pass', innerSkipped: 0, evidence: [proofFile, proof.source.transport, ...found.flatMap(step => step.evidence)] };
});
fs.writeFileSync(report, JSON.stringify({ taskId: env.WORKFLOW_TASK_ID, stepId: env.WORKFLOW_STEP_ID, checkId: env.WORKFLOW_CHECK_ID, runId: env.WORKFLOW_RUN_ID, repo: env.WORKFLOW_REPO, snapshotHash: env.WORKFLOW_SNAPSHOT_HASH, startedAt, at: new Date().toISOString(), verdict: 'pass', mode: 'full', treeMoved: false, capability: 'runtime', steps }, null, 2));
console.log(`Verified current PC browser interactions using explicit HTTP fixtures; financial persistence is verified separately. ${report}`);
