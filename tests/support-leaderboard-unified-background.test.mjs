import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { test } from "node:test";

const sharp = createRequire(import.meta.url)("sharp");
const assets = new URL("../app/components/domain-views/m-tabs/support-leaderboard-assets/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("orbit-surface-unified-canvas.json", assets)));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const decode = bytes => sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

test("unified preview canvas preserves every source RGBA pixel without resampling", async () => {
  assert.deepEqual(manifest.sources.map(({ file, size, offset }) => [file, size, offset]), [
    ["orbit-surface-navigation.png", [181, 1024], [0, 0]],
    ["orbit-surface-main-canvas.png", [1355, 1024], [181, 0]],
    ["orbit-surface-nav-active.png", [181, 60], [0, 297]],
  ]);
  const expected = Buffer.alloc(1536 * 1024 * 4);
  for (const source of manifest.sources) {
    const bytes = readFileSync(new URL(source.file, assets));
    assert.equal(hash(bytes), source.sha256);
    const image = await decode(bytes);
    assert.deepEqual([image.info.width, image.info.height], source.size);
    const [x, y] = source.offset;
    assert(x >= 0 && y >= 0 && x + image.info.width <= 1536 && y + image.info.height <= 1024);
    for (let row = 0; row < image.info.height; row++) {
      image.data.copy(expected, ((y + row) * 1536 + x) * 4, row * image.info.width * 4, (row + 1) * image.info.width * 4);
    }
  }
  const bytes = readFileSync(new URL(manifest.output.file, assets));
  assert.equal(hash(bytes), manifest.output.sha256);
  const actual = await decode(bytes);
  assert.deepEqual([actual.info.width, actual.info.height], [1536, 1024]);
  assert.deepEqual(actual.data, expected);
  for (let alpha = 3; alpha < expected.length; alpha += 4) assert.equal(expected[alpha], 255);
});
