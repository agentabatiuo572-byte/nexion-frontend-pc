import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

const root = path.resolve(import.meta.dirname, "..");
const design = path.join(root, "docs/design/support-analytics-20261006/leaderboard-orbit-20261010");
const assets = path.join(root, "app/components/domain-views/m-tabs/support-leaderboard-assets");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const bytes = await fs.readFile(path.join(design, "approved-design.png"));
assert.equal(hash(bytes), "e3b92e2fbb593171a4658e058c562ec4dbc9403fecafdf8dd85a719ba71f6c3a");
const source = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const bounds = [[308,483,153,40],[578,483,155,40],[840,483,155,40],[1106,483,156,40]];
const copyBounds = [[347,494,77,18],[620,494,76,18],[884,494,75,18],[1149,494,75,18]];
const results = [];
for (let i = 0; i < bounds.length; i++) {
  const [left, top, width, height] = bounds[i];
  const [cx, cy, cw, ch] = copyBounds[i];
  assert(cx > left && cy > top && cx + cw < left + width && cy + ch < top + height);
  const data = await sharp(bytes).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer();
  // Replace only the source glyphs; the two clean adjacent rows preserve the local background tone.
  for (let y = cy; y < cy + ch; y++) for (let x = cx; x < cx + cw; x++) {
    const target = ((y - top) * width + x - left) * 4;
    const before = ((cy - 1) * source.info.width + x) * 4;
    const after = ((cy + ch) * source.info.width + x) * 4;
    const weight = (y - cy + 1) / (ch + 1);
    for (let c = 0; c < 4; c++) data[target + c] = Math.round(source.data[before + c] * (1 - weight) + source.data[after + c] * weight);
  }
  const png = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  assert.deepEqual(await sharp(png).ensureAlpha().raw().toBuffer(), data);
  const file = `orbit-podium-button-${i + 1}.png`;
  await fs.writeFile(path.join(assets, file), png);
  results.push({ file, sha256: hash(png), bounds: bounds[i], replacedCopy: copyBounds[i] });
}
await fs.writeFile(path.join(design, "podium-button-restoration-20261015.json"), JSON.stringify({
  source: { file: "approved-design.png", sha256: hash(bytes) },
  use: "Native desktop layout only. Original button frame and orbit material; source glyphs removed by vertical interpolation. HTML retains all labels, icons, focus and actions. Comparison masks and tolerance unchanged.",
  assets: results,
}, null, 2) + "\n");
console.log(JSON.stringify(results.map(({ file, bounds }) => ({ file, bounds }))));
