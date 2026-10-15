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

test("real and preview leaderboard content share width-based canvas and pagination materials", () => {
  const css = readFileSync(new URL("../app/components/domain-views/m-tabs/support-leaderboard.css", import.meta.url), "utf8");
  assert.match(css, /container:sl-board \/ inline-size/);
  assert.match(css, /@container sl-board \(min-width:1270px\)/);
  assert.match(css, /\.sl-content::before\{[^}]*orbit-surface-unified-canvas\.png[^}]*background-size:calc\(100% \* 1536 \/ 1355\) 1024px[^}]*background-position:right top/);
  assert.match(css, /\.sl-pagination\{[^}]*background-size:100% 66px/);
  assert.doesNotMatch(css, /background-size:1314px 66px/);
  const shell = readFileSync(new URL("../app/components/shell/console-shell.tsx", import.meta.url), "utf8");
  assert.match(shell, /padding: pathname === "\/service\/leaderboard" \? 0 : "var\(--admin-gutter\)"/);
});

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

test("pedestal halos retain original pixels without copying fixed identities or opaque cores", async () => {
  const design = new URL("../docs/design/support-analytics-20261006/leaderboard-orbit-20261010/", import.meta.url);
  const record = JSON.parse(readFileSync(new URL("pedestal-halo-restoration-20261015.json", design)));
  const provenance = JSON.parse(readFileSync(new URL(record.maskSource, design)));
  const sourceBytes = readFileSync(new URL(record.source.file, design));
  assert.equal(hash(sourceBytes), record.source.sha256);
  const source = await decode(sourceBytes);
  assert.deepEqual(record.assets.map(a => Object.values(a.bounds)), [[275,295,214,76],[556,295,206,76],[825,295,196,76],[1094,295,194,76]]);
  for (const asset of record.assets) {
    const bytes = readFileSync(new URL(asset.file, assets)), halo = await decode(bytes);
    const coreBytes = readFileSync(new URL(asset.core.file, assets)), core = await decode(coreBytes);
    assert.equal(hash(bytes), asset.sha256); assert.equal(hash(coreBytes), asset.core.sha256);
    assert.deepEqual([halo.info.width, halo.info.height], [asset.bounds.width, asset.bounds.height]);
    let painted = 0;
    for (let y = 0; y < halo.info.height; y++) for (let x = 0; x < halo.info.width; x++) {
      const i = (y * halo.info.width + x) * 4;
      if (halo.data[i + 3] === 0) continue;
      painted++;
      const sx = asset.bounds.left + x, sy = asset.bounds.top + y, from = (sy * source.info.width + sx) * 4;
      assert.deepEqual(halo.data.subarray(i, i + 4), source.data.subarray(from, from + 4));
      for (const shape of provenance.mask.holes.filter(s => s.category !== "extracted-decoration")) {
        const inside = shape.shape === "ellipse" ? ((sx-shape.cx)/shape.rx)**2+((sy-shape.cy)/shape.ry)**2 <= 1
          : sx>=shape.x && sx<shape.x+shape.width && sy>=shape.y && sy<shape.y+shape.height;
        assert.equal(inside, false, `${asset.file}: fixed foreground copied`);
      }
      const cx = sx-asset.core.left, cy = sy-asset.core.top;
      if (cx>=0 && cy>=0 && cx<core.info.width && cy<core.info.height) assert.notEqual(core.data[(cy*core.info.width+cx)*4+3],255);
    }
    assert.equal(painted, asset.restoredPixels); assert(painted>1000);
  }
});

test("podium button artwork preserves the source frame and removes every fixed label", async () => {
  const design = new URL("../docs/design/support-analytics-20261006/leaderboard-orbit-20261010/", import.meta.url);
  const record = JSON.parse(readFileSync(new URL("podium-button-restoration-20261015.json", design)));
  const sourceBytes = readFileSync(new URL(record.source.file, design)), source = await decode(sourceBytes);
  assert.equal(hash(sourceBytes), record.source.sha256);
  assert.deepEqual(record.assets.map(a => a.bounds), [[308,483,153,40],[578,483,155,40],[840,483,155,40],[1106,483,156,40]]);
  assert.deepEqual(record.assets.map(a => a.replacedCopy), [[347,494,77,18],[620,494,76,18],[884,494,75,18],[1149,494,75,18]]);
  for (const asset of record.assets) {
    const bytes = readFileSync(new URL(asset.file, assets)), actual = await decode(bytes);
    assert.equal(hash(bytes), asset.sha256);
    const [left, top, width, height] = asset.bounds, [cx, cy, cw, ch] = asset.replacedCopy;
    assert.deepEqual([actual.info.width, actual.info.height], [width, height]);
    let removed = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = x + left, sy = y + top, to = (y * width + x) * 4, from = (sy * source.info.width + sx) * 4;
      const copy = sx >= cx && sx < cx + cw && sy >= cy && sy < cy + ch;
      if (!copy) assert.deepEqual(actual.data.subarray(to,to+4), source.data.subarray(from,from+4));
      else {
        assert(Math.max(...actual.data.subarray(to,to+3)) < 80, `${asset.file}: source glyph remains`);
        if (Math.min(...source.data.subarray(from,from+3)) > 90) removed++;
      }
      assert.equal(actual.data[to+3], 255);
    }
    assert(removed > 200, `${asset.file}: source label was not removed`);
  }
});
