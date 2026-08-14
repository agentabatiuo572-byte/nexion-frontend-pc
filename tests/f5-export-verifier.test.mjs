import assert from "node:assert/strict";
import test from "node:test";

import { verifyF5CsvArtifact } from "../lib/admin/f5-export-verifier.ts";

const encoder = new TextEncoder();

async function sha256(bytes) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", bytes)).toString("hex");
}

async function fixture() {
  const content = encoder.encode(
    '\uFEFF"commissionId","eventId","user","kind","currency","amount","sourceUser","layer","status","settledAt"\r\n'
      + '"CM-1","1","U***0001","network","USDT","12.34","U***0011","2","unlocked","2026-08-10 12:00:00"\r\n',
  );
  return {
    content,
    metadata: {
      exportId: "F5-CSV-test",
      rowCount: 1,
      byteSize: content.byteLength,
      expectedSha: await sha256(content),
      redacted: true,
      filename: "f5-commissions.csv",
    },
  };
}

test("accepts an intact server CSV artifact", async () => {
  const { content, metadata } = await fixture();
  const verified = await verifyF5CsvArtifact(content.buffer, metadata);
  assert.equal(verified.sha256, metadata.expectedSha);
  assert.equal(verified.rowCount, 1);
});

test("rejects tampered export headers", async () => {
  const { content, metadata } = await fixture();
  await assert.rejects(
    verifyF5CsvArtifact(content.buffer, { ...metadata, byteSize: metadata.byteSize + 1 }),
    /F5_EXPORT_ARTIFACT_UNREADABLE/,
  );
  await assert.rejects(
    verifyF5CsvArtifact(content.buffer, { ...metadata, rowCount: 2 }),
    /F5_EXPORT_ARTIFACT_UNREADABLE/,
  );
});

test("rejects a tampered body even when metadata is otherwise well formed", async () => {
  const { content, metadata } = await fixture();
  const tampered = content.slice();
  tampered[tampered.byteLength - 4] ^= 1;
  await assert.rejects(
    verifyF5CsvArtifact(tampered.buffer, metadata),
    /F5_EXPORT_ARTIFACT_UNREADABLE/,
  );
});
