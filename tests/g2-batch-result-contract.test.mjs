import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeG2BatchResult,
  summarizeG2BatchResult,
} from "../lib/admin/g2-batch-result.ts";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("G2 批处理合同保留完成、跳过原因和失败明细，并识别部分成功", () => {
  const result = normalizeG2BatchResult({
    requestedLimit: 50,
    selectedCount: 3,
    completedCount: 1,
    completed: [{ exchangeNo: "EX-1", status: "COMPLETED", orderStatus: "COMPLETED" }],
    skippedCount: 1,
    skipped: [{ exchangeNo: "EX-2", status: "SKIPPED", orderStatus: "CANCELLED", reasonCode: "GEO_BLOCKED", reason: "地域已封锁" }],
    failedCount: 1,
    failed: [{ exchangeNo: "EX-3", status: "FAILED", orderStatus: "QUEUED", reasonCode: "WALLET_BALANCE_CONFLICT", reason: "钱包余额不足或已变化" }],
    remainingQueuedCount: 1,
    outcome: "PARTIAL",
  });

  assert.equal(result.outcome, "PARTIAL");
  assert.deepEqual(result.completed.map((row) => row.exchangeNo), ["EX-1"]);
  assert.equal(result.skipped[0].reason, "地域已封锁");
  assert.equal(result.failed[0].reasonCode, "WALLET_BALANCE_CONFLICT");
  assert.match(summarizeG2BatchResult(result), /部分完成/);
  assert.match(summarizeG2BatchResult(result), /完成 1 单/);
  assert.match(summarizeG2BatchResult(result), /跳过 1 单/);
  assert.match(summarizeG2BatchResult(result), /失败 1 单/);
});

test("G2 批处理成功响应缺字段或计数失真时必须保持结果未知，不能被接受成完成", () => {
  assert.throws(
    () => normalizeG2BatchResult({ completedCount: 1, completed: ["EX-1"] }),
    /G2_BATCH_RESPONSE_INVALID/,
  );
  assert.throws(
    () => normalizeG2BatchResult({
      requestedLimit: 1,
      selectedCount: 1,
      completedCount: 2,
      completed: ["EX-1"],
      skippedCount: 0,
      skipped: [],
      failedCount: 0,
      failed: [],
      remainingQueuedCount: 0,
      outcome: "COMPLETED",
    }),
    /G2_BATCH_RESPONSE_INVALID/,
  );
});

test("G2 批处理区分空队列与锁竞争，并保留每单权威订单终态", () => {
  const busy = normalizeG2BatchResult({
    requestedLimit: 50,
    selectedCount: 0,
    completedCount: 0,
    completed: [],
    skippedCount: 0,
    skipped: [],
    failedCount: 0,
    failed: [],
    remainingQueuedCount: 2,
    outcome: "BUSY",
  });
  assert.equal(busy.outcome, "BUSY");
  assert.match(summarizeG2BatchResult(busy), /其他操作处理/);

  assert.throws(() => normalizeG2BatchResult({ ...busy, outcome: "EMPTY" }), /G2_BATCH_RESPONSE_INVALID/);
});

test("G2 页面展示服务端批次结果，权威刷新，并对未知结果明确提示同命令号重试", () => {
  const client = read("lib/admin/g2-client.ts");
  const page = read("app/components/domain-views/g-tabs/g2-exchange.tsx");

  assert.match(client, /normalizeG2BatchResult/);
  assert.match(client, /authoritative = await fetchG2ExchangeOverview\(\)/);
  assert.match(client, /const message = displayAdminError\(error\);/,
    "权威回读遇到非 Error 值时，不能将机器码直接交给页面，必须经过展示咽喉");
  assert.match(client, /throw stableMutationHttpFailure\(message, 0\)/);
  assert.match(client, /return \{ overview: authoritative, batch \}/);
  assert.match(page, /summarizeG2BatchResult/);
  assert.match(page, /批次结果/);
  assert.match(page, /跳过原因/);
  assert.match(page, /失败明细/);
  assert.match(page, /row\.orderStatus === "CANCELLED"/);
  assert.match(page, /权威剩余队列/);
  assert.match(page, /同一命令号/);
  assert.doesNotMatch(page, /"今日队列批次处理完成"/);
});
