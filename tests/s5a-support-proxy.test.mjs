import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";

test("private attachment proxy strips image MIME from backend failures and rejects empty success", async () => {
  const backend = createServer((request, response) => {
    const id = request.url?.split("/")[6];
    response.setHeader("Content-Type", "image/png");
    if (id === "bad") { response.writeHead(500); response.end("backend failure"); return; }
    if (id === "empty") { response.writeHead(200); response.end(); return; }
    response.writeHead(200); response.end(Buffer.from([137, 80, 78, 71]));
  });
  await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
  const lease = createServer();
  await new Promise((resolve) => lease.listen(0, "127.0.0.1", resolve));
  const port = lease.address().port;
  await new Promise((resolve) => lease.close(resolve));
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    env: { ...process.env, NEXION_BACKEND_URL: `http://127.0.0.1:${backend.address().port}` },
    windowsHide: true,
    stdio: "ignore",
  });
  const base = `http://127.0.0.1:${port}/api/admin/content/conversations/attachments`;
  const headers = { Cookie: "nexion_admin_token=fixture-token" };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await fetch(`http://127.0.0.1:${port}/`); ready = true; break; } catch { await delay(100); }
    }
    assert.ok(ready, "Next production server did not start");
    const ok = await fetch(`${base}/ok/content`, { headers });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await ok.arrayBuffer())], [137, 80, 78, 71]);
    for (const [id, expectedStatus] of [["bad", 500], ["empty", 502]]) {
      const response = await fetch(`${base}/${id}/content`, { headers });
      assert.equal(response.status, expectedStatus);
      assert.match(response.headers.get("content-type") || "", /^application\/json/);
      assert.doesNotMatch(await response.text(), /backend failure/);
    }
  } finally {
    next.kill();
    await new Promise((resolve) => backend.close(resolve));
  }
});
