import assert from "node:assert/strict";
import test from "node:test";

import { guardedFetch, rawFetch } from "../lib/admin/error-messages.ts";

test("guardedFetch converts network TypeError into operator-readable Chinese", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError("Failed to fetch"));
  t.after(() => { globalThis.fetch = original; });

  await assert.rejects(
    () => guardedFetch("/api/admin/anything"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /网络连接失败或后台服务不可达/);
      assert.doesNotMatch(error.message, /检查输入/);
      assert.doesNotMatch(error.message, /Failed to fetch/);
      return true;
    },
  );
});

test("guardedFetch keeps odd non-network-copy rejections attributed to network, not user input", async (t) => {
  const original = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new Error("AbortError: The operation was aborted"));
  t.after(() => { globalThis.fetch = original; });

  await assert.rejects(
    () => guardedFetch("/api/admin/anything"),
    (error) => {
      assert.match(error.message, /网络|不可达/);
      assert.doesNotMatch(error.message, /检查输入/);
      return true;
    },
  );
});

test("guardedFetch passes successful responses through untouched", async (t) => {
  const original = globalThis.fetch;
  const marker = { ok: false, status: 503 };
  globalThis.fetch = () => Promise.resolve(marker);
  t.after(() => { globalThis.fetch = original; });

  // 非 2xx 不是 guardedFetch 的事——response 原样返回,由 client 的 !response.ok 分支走咽喉
  assert.equal(await guardedFetch("/api/admin/anything"), marker);
});

test("rawFetch is a transparent alias for clients that own their exception semantics", async (t) => {
  const original = globalThis.fetch;
  const boom = new TypeError("Failed to fetch");
  globalThis.fetch = () => Promise.reject(boom);
  t.after(() => { globalThis.fetch = original; });

  // OutcomeUncertain 域必须拿到原始 TypeError 自行判断,rawFetch 不许包
  await assert.rejects(() => rawFetch("/api/admin/anything"), (error) => error === boom);
});
