import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const design = path.join(root, "docs/design/support-analytics-20261006/leaderboard-orbit-20261010");
const assets = path.join(root, "app/components/domain-views/m-tabs/support-leaderboard-assets");
const hash = value => createHash("sha256").update(value).digest("hex");
const sourceBytes = await fs.readFile(path.join(design, "approved-design.png"));
assert.equal(hash(sourceBytes), "e3b92e2fbb593171a4658e058c562ec4dbc9403fecafdf8dd85a719ba71f6c3a");
const source = await sharp(sourceBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const provenance = JSON.parse(await fs.readFile(path.join(design, "background-approved-source-restoration-20261014.json"), "utf8"));
const contains = (shape, x, y) => shape.shape === "ellipse"
  ? ((x - shape.cx) / shape.rx) ** 2 + ((y - shape.cy) / shape.ry) ** 2 <= 1
  : x >= shape.x && x < shape.x + shape.width && y >= shape.y && y < shape.y + shape.height;
const excluded = provenance.mask.holes.filter(shape => shape.category !== "extracted-decoration");
const results = [];
for (let i = 0; i < 4; i++) {
  const floor = provenance.mask.holes.find(shape => shape.id === `person-${i + 1}-podium-floor`);
  assert(floor && floor.shape === "ellipse");
  const bounds = { left: floor.cx - floor.rx, top: floor.cy - floor.ry, width: floor.rx * 2, height: floor.ry * 2 };
  const coreBytes = await fs.readFile(path.join(assets, `orbit-pedestal-${i + 1}.png`));
  const core = await sharp(coreBytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const coreLeft = [300, 579, 848, 1116][i], coreTop = 296;
  const data = Buffer.alloc(bounds.width * bounds.height * 4);
  let restoredPixels = 0;
  for (let y = 0; y < bounds.height; y++) for (let x = 0; x < bounds.width; x++) {
    const sx = bounds.left + x, sy = bounds.top + y;
    const cx = sx - coreLeft, cy = sy - coreTop;
    const opaqueCore = cx >= 0 && cy >= 0 && cx < core.info.width && cy < core.info.height
      && core.data[(cy * core.info.width + cx) * 4 + 3] === 255;
    if (!contains(floor, sx, sy) || opaqueCore || excluded.some(shape => contains(shape, sx, sy))) continue;
    const from = (sy * source.info.width + sx) * 4, to = (y * bounds.width + x) * 4;
    source.data.copy(data, to, from, from + 4);
    restoredPixels++;
  }
  assert(restoredPixels > 1000 && restoredPixels < bounds.width * bounds.height);
  // The lower halo must survive; fixed portrait/name pixels must remain transparent.
  assert.equal(data[((350 - bounds.top) * bounds.width + floor.cx - bounds.left) * 4 + 3], 255);
  assert.equal(data[((355 - bounds.top) * bounds.width + floor.cx - bounds.left) * 4 + 3], 0);
  const file = `orbit-pedestal-halo-${i + 1}.png`;
  const png = await sharp(data, { raw: { width: bounds.width, height: bounds.height, channels: 4 } }).png().toBuffer();
  const decoded = await sharp(png).ensureAlpha().raw().toBuffer();
  assert.deepEqual(decoded, data);
  await fs.writeFile(path.join(assets, file), png);
  results.push({ file, sha256: hash(png), bounds, core: { file: `orbit-pedestal-${i + 1}.png`, sha256: hash(coreBytes), left: coreLeft, top: coreTop }, restoredPixels });
}
await fs.writeFile(path.join(design, "pedestal-halo-restoration-20261015.json"), JSON.stringify({
  source: { file: "approved-design.png", sha256: hash(sourceBytes) },
  support: "Original floor ellipses minus existing dynamic/control supports and opaque core pixels. Partial-alpha core pixels retain source underneath. No source portraits or text. Ready-state pedestal only.",
  maskSource: "background-approved-source-restoration-20261014.json",
  assets: results,
}, null, 2) + "\n");
console.log(JSON.stringify(results.map(({ file, restoredPixels }) => ({ file, restoredPixels }))));
