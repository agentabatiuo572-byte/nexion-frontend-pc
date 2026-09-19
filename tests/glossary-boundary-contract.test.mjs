import assert from "node:assert/strict";
import test from "node:test";

import { createGlossaryMatcher } from "../lib/admin/glossary-match.ts";

const match = createGlossaryMatcher(["pt", "口径", "质押池", "质押", "计提"], ["累计提现"]);
const terms = (text) => match(text).map((hit) => hit.term);

test("a latin term is never matched inside another latin word", () => {
  // #153: 「Test/Acceptance 夹具与生产聚合严格隔离」被拆成「Test/Acce pt ance」。
  assert.deepEqual(terms("Test/Acceptance 夹具与生产聚合严格隔离"), []);
  for (const word of ["Acceptance", "prompt", "Adapt", "adopt", "script", "crypto", "empty"]) {
    assert.deepEqual(terms(word), [], `${word} 内部的 pt 不是独立术语`);
  }
});

test("a standalone latin term is still annotated", () => {
  assert.deepEqual(terms("pt"), ["pt"]);
  assert.deepEqual(terms("pt 是百分点单位"), ["pt"]);
  assert.deepEqual(terms("加 5pt 的档位"), ["pt"]);
  assert.deepEqual(terms("提升 5 pt"), ["pt"]);
  assert.deepEqual(terms("(pt)"), ["pt"]);
});

test("boundary detection does not hide an adjacent distinct term", () => {
  assert.deepEqual(terms("Acceptance 与 pt 对照"), ["pt"]);
  assert.deepEqual(terms("ptance 不是术语"), []);
});

test("longer terms win and guard words are never split", () => {
  assert.deepEqual(terms("质押池余额"), ["质押池"]);
  assert.deepEqual(terms("质押余额"), ["质押"]);
  // 守护词「累计提现」内部不得拆出「计提」。
  assert.deepEqual(terms("累计提现口径"), ["口径"]);
  assert.deepEqual(terms("累计计提口径"), ["计提", "口径"]);
});

test("hits are ordered, non-overlapping and cover the original text", () => {
  const text = "质押池与 pt 口径";
  const hits = match(text);
  assert.deepEqual(hits.map((hit) => hit.term), ["质押池", "pt", "口径"]);
  for (let i = 1; i < hits.length; i += 1) {
    assert.ok(hits[i].start >= hits[i - 1].end, "命中区间不得重叠");
  }
  for (const hit of hits) {
    assert.equal(text.slice(hit.start, hit.end), hit.term, "命中区间必须精确指向术语原文");
  }
});
