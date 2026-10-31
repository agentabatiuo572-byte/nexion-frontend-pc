import assert from "node:assert/strict";
import test from "node:test";
import { buildVRankBootstrap, emptyVRankBootstrap } from "../lib/admin/vrank-bootstrap.ts";

function complete() {
  return emptyVRankBootstrap().map((row, index) => ({ ...row, titleCn: `等级 ${index}`, titleEn: `Rank ${index}`,
    selfComputePoints: String(index * 100), teamComputePoints: "0", directRefs: "0", requiredDownlineCount: "0",
    leadershipVotes: "0", unilevelDepth: "0", peerBonusPercent: "0" }));
}

test("first configuration requires explicit inputs rather than financial defaults", () => {
  assert.throws(() => buildVRankBootstrap(emptyVRankBootstrap()), /V0.*自购算力点/);
  const rows = complete();
  rows[1].peerBonusPercent = "0.07";
  const result = buildVRankBootstrap(rows);
  assert.deepEqual(result.map((row) => row.rankCode), Array.from({ length: 9 }, (_, index) => `V${index}`));
  assert.equal(result[1].peerBonusRate, 0.0007);
  assert.equal(result[0].unilevelDepth, "0");
  assert.equal(result[0].requiredDownlineRank, null);
  assert.deepEqual(result[8].rewards, []);
});

test("incomplete or reordered ladders and unconditional promotion are rejected", () => {
  assert.throws(() => buildVRankBootstrap(complete().slice(1)), /完整配置/);
  const rows = complete();
  [rows[1], rows[2]] = [rows[2], rows[1]];
  assert.throws(() => buildVRankBootstrap(rows), /等级顺序/);
  const zero = complete();
  zero[1].selfComputePoints = "0";
  assert.throws(() => buildVRankBootstrap(zero), /V1.*大于 0/);
});

test("branch requirements must be explicit and below the rank", () => {
  const rows = complete();
  rows[2].requiredDownlineCount = "2";
  rows[2].requiredDownlineRank = "V2";
  assert.throws(() => buildVRankBootstrap(rows), /低于本级/);
  rows[2].requiredDownlineRank = "V1";
  assert.equal(buildVRankBootstrap(rows)[2].requiredDownlineCount, 2);
  rows[2].requiredDownlineCount = "0";
  assert.throws(() => buildVRankBootstrap(rows), /不要求/);
});

test("unsafe integers, implicit zero and excessive percentage precision are rejected", () => {
  for (const value of ["", "-1", "1.5", "1e3", "9007199254740992"]) {
    const rows = complete();
    rows[1].teamComputePoints = value;
    assert.throws(() => buildVRankBootstrap(rows), /团队算力点/);
  }
  for (const value of ["", "100.01", "0.001", "NaN"]) {
    const rows = complete();
    rows[1].peerBonusPercent = value;
    assert.throws(() => buildVRankBootstrap(rows), /同级奖比例/);
  }
});
