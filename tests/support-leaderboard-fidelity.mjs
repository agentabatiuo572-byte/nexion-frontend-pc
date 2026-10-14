import assert from "node:assert/strict";
import sharp from "sharp";

export async function decodeLosslessScreenshot(bytes) {
  // Browser screenshot APIs can return JPEG even when the caller saves a .png filename.
  assert.equal(Buffer.from(bytes).subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "Pixel comparison requires lossless PNG bytes");
  return sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

// Fixed 1536x1024 orbit basis. Live controls, portraits, text and metric holes are excluded individually.
export const approvedStaticRegions = [
  { id: "planet-upper", rect: [1000, 5, 100, 15] },
  { id: "planet-surface", rect: [780, 120, 60, 40] },
  { id: "upper-orbit", rect: [1180, 127, 40, 12] },
  { id: "left-orbit", rect: [208, 324, 28, 28] },
  { id: "lower-orbit", rect: [700, 546, 40, 5] },
  { id: "first-pedestal", rect: [330, 316, 105, 13] },
  { id: "second-pedestal", rect: [609, 316, 105, 13] },
  { id: "third-pedestal", rect: [878, 316, 90, 13] },
  { id: "fourth-pedestal", rect: [1146, 316, 90, 13] },
];

function errorAt(reference, actual, rect, dx, dy) {
  const [left, top, width, height] = rect;
  let maximum = 0, total = 0, changed = 0;
  for (let y = top; y < top + height; y++) for (let x = left; x < left + width; x++) {
    const source = (y * reference.info.width + x) * 4;
    const target = ((y + dy) * actual.info.width + x + dx) * 4;
    for (let channel = 0; channel < 4; channel++) {
      const difference = Math.abs(reference.data[source + channel] - actual.data[target + channel]);
      maximum = Math.max(maximum, difference);
      total += difference;
      if (difference > 1) changed++;
    }
  }
  return { dx, dy, maximum, mean: total / (width * height * 4), changedChannels: changed };
}

export function assertApprovedStaticPixels(reference, actual, regions = approvedStaticRegions, offsets = {}) {
  assert.equal(reference.info.channels, 4, "Reference must be decoded RGBA");
  assert.equal(actual.info.channels, 4, "Screenshot must be decoded RGBA");
  assert.equal(actual.info.width, reference.info.width, "Same component viewport width required");
  assert.equal(actual.info.height, reference.info.height, "Same component viewport height required");
  assert(regions.length > 0, "Static coverage must not be empty");
  return regions.map(({ id, rect }) => {
    const [left, top, width, height] = rect;
    assert(rect.every(Number.isInteger) && left >= 0 && top >= 0 && width > 0 && height > 0
      && left + width <= reference.info.width && top + height <= reference.info.height, id + ": invalid ROI");
    // Only measured DOM rounding may move a region; pixels cannot choose their own best match.
    const { dx = 0, dy = 0 } = offsets[id] || {};
    assert(Number.isInteger(dx) && Number.isInteger(dy) && Math.abs(dx) <= 1 && Math.abs(dy) <= 1, id + ": geometry exceeds one pixel");
    assert(left + dx >= 0 && top + dy >= 0 && left + width + dx <= actual.info.width && top + height + dy <= actual.info.height, id + ": shifted ROI outside screenshot");
    const result = errorAt(reference, actual, rect, dx, dy);
    assert(result.maximum <= 1 && result.changedChannels === 0, id + ": unapproved static difference " + JSON.stringify(result));
    return { id, rect, ...result };
  });
}

// Fixed source/fixture text bounds, never inferred or expanded from a screenshot diff.
// Only changed text/data and portrait interiors are excluded; frames and material remain checked.
export const approvedDynamicMasks = [
  { id: "three-board-copy", reason: "Approved three boards replace four source labels", rect: [220, 87, 484, 22] },
  { id: "hero-period-copy", reason: "Approved shared period and unit copy", rect: [313, 143, 352, 20] },
  ...[382, 662, 925, 1192].flatMap((cx, i) => [
    { id: `podium-${i}-source-portrait`, reason: "Authorized portrait interior", ellipse: [cx, i ? 251 : 248, i ? 49 : 53, i ? 49 : 53] },
    { id: `podium-${i}-live-portrait`, reason: "Authorized portrait interior; border excluded", ellipse: [[381, 661, 925, 1190][i], i ? 251 : 248, i ? 51 : 55, i ? 51 : 55] },
    { id: `podium-${i}-rank`, reason: "Published rank and tie values", rect: [[260, 547, 807, 1071][i], 198, i > 1 ? 83 : 58, 76] },
    { id: `podium-${i}-identity`, reason: "Name, group and approved name-adjacent movement", rect: [cx - 85, 355, 170, 43] },
    { id: `podium-${i}-old-movement`, reason: "Movement relocated after name", rect: [cx - 22, 399, 44, 27] },
    ...[-80, 0, 80].map((dx, j) => ({ id: `podium-${i}-value-${j}`, reason: "Dynamic business value", rect: [cx + dx - 33, 431, 66, 25] })),
    { id: `podium-${i}-metric-copy`, reason: "Approved metric naming and common units", rect: [cx - 110, 459, 220, 18] },
  ]),
  { id: "self-source-portrait", reason: "Authorized portrait interior", ellipse: [1432, 178, 45, 45] },
  { id: "self-live-portrait", reason: "Authorized portrait interior; frame excluded", ellipse: [1432, 179, 46, 46] },
  { id: "self-identity", reason: "Dynamic name and group", rect: [1370, 239, 125, 48] },
  { id: "self-rank", reason: "Rank and movement", rect: [1365, 310, 106, 71] },
  { id: "self-metric-copy", reason: "Approved shared period/unit placement", rect: [1366, 408, 142, 21] },
  { id: "self-value", reason: "Dynamic score and unit", rect: [1365, 435, 121, 40] },
  ...[0, 1, 2, 3, 4].flatMap(i => [
    { id: `row-${i}-rank`, reason: "Published rank and ties", rect: [223, 651 + i * 48, 63, 33] },
    { id: `row-${i}-source-portrait`, reason: "Authorized portrait interior", ellipse: [341, 662 + i * 48, 18, 18] },
    { id: `row-${i}-live-portrait`, reason: "Authorized portrait interior; frame excluded", ellipse: [347, 664 + i * 48, 18, 18] },
    { id: `row-${i}-identity`, reason: "Fixed baseline name, group, self badge and name-adjacent movement bounds", rect: [380, 643 + i * 48, 132, 39] },
    { id: `row-${i}-old-movement`, reason: "Movement moved into identity column", rect: [578, 650 + i * 48, 51, 30] },
    ...[775, 984, 1198].map((x, j) => ({ id: `row-${i}-value-${j}`, reason: "Dynamic business value", rect: [x - 9, 651 + i * 48, j ? 48 : 64, 30] })),
  ]),
  ...[[370, 603, 248, 25], [741, 597, 111, 39], [965, 597, 88, 39], [1154, 597, 108, 39]].map((rect, i) => ({ id: `table-approved-copy-${i}`, reason: "Approved name-adjacent movement column and shared metric units", rect })),
  { id: "page-summary", reason: "Dynamic page range and total", rect: [222, 902, 352, 20] },
  { id: "page-size-value", reason: "Dynamic page size; control edge excluded", rect: [610, 902, 92, 20] },
  { id: "footer-time", reason: "Dynamic update time and fixture disclosure", rect: [1275, 971, 240, 19] },
  { id: "account-name", reason: "Authorized account name and role", rect: [70, 915, 81, 64] },
  { id: "account-source-portrait", reason: "Authorized account portrait interior", ellipse: [50, 939, 24, 24] },
  { id: "account-live-portrait", reason: "Authorized account portrait interior; frame excluded", ellipse: [41, 955, 15, 15] },
];

export function createApprovedDynamicMask(width, height, masks = approvedDynamicMasks) {
  const pixels = new Uint8Array(width * height);
  assert(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0);
  for (const { id, reason, rect, ellipse } of masks) {
    assert(id && reason && Boolean(rect) !== Boolean(ellipse), "Every mask requires a bounded shape and reason");
    const [x, y, w, h] = rect || [ellipse[0] - ellipse[2], ellipse[1] - ellipse[3], ellipse[2] * 2, ellipse[3] * 2];
    assert([x, y, w, h].every(Number.isInteger) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= width && y + h <= height, id + ": invalid mask bounds");
    for (let dy = y; dy < y + h; dy++) for (let dx = x; dx < x + w; dx++) {
      if (!ellipse || ((dx - ellipse[0]) / ellipse[2]) ** 2 + ((dy - ellipse[1]) / ellipse[3]) ** 2 < 1) pixels[dy * width + dx] = 1;
    }
  }
  if (masks === approvedDynamicMasks) {
    assert.equal(width, 1536); assert.equal(height, 1024);
    // Preserve both source and approved merged-grid line coordinates even where text bounds cross them.
    for (const x of [202, 307, 525, 674, 688, 896, 898, 1100, 1107, 1300, 1317, 1515, 1516]) for (let y = 592; y < 881; y++) pixels[y * width + x] = 0;
    for (const y of [592, 593, 638, 640, 641, 684, 688, 689, 732, 736, 737, 778, 784, 785, 828, 832, 833, 878, 880, 881]) for (let x = 202; x < 1517; x++) pixels[y * width + x] = 0;
  }
  return pixels;
}

export function measureApprovedFullStaticPixels(reference, actual, masks = approvedDynamicMasks) {
  const { width, height, channels } = reference.info;
  assert.equal(channels, 4, "Reference must be decoded RGBA");
  assert.equal(actual.info.channels, 4, "Screenshot must be decoded RGBA");
  assert.equal(actual.info.width, width, "Same component viewport width required");
  assert.equal(actual.info.height, height, "Same component viewport height required");
  assert.equal(reference.data.length, width * height * 4, "Reference RGBA byte coverage");
  assert.equal(actual.data.length, width * height * 4, "Screenshot RGBA byte coverage");
  const mask = createApprovedDynamicMask(width, height, masks);
  const result = { total: width * height, masked: 0, static: 0, checked: 0, uncovered: 0, maximum: 0, changedPixels: 0, changedChannels: 0, firstDifferences: [] };
  for (let p = 0; p < mask.length; p++) {
    if (mask[p]) { result.masked++; continue; }
    result.static++; result.checked++;
    let changed = false;
    for (let c = 0; c < 4; c++) {
      const delta = Math.abs(reference.data[p * 4 + c] - actual.data[p * 4 + c]);
      result.maximum = Math.max(result.maximum, delta);
      if (delta > 1) { result.changedChannels++; changed = true; }
    }
    if (changed) { result.changedPixels++; if (result.firstDifferences.length < 20) result.firstDifferences.push([p % width, Math.floor(p / width)]); }
  }
  assert.equal(result.total, result.masked + result.static);
  assert(result.static > 0, "Static coverage must not be empty");
  assert.equal(result.checked, result.static);
  return result;
}

export function assertApprovedFullStaticPixels(reference, actual, masks = approvedDynamicMasks) {
  const result = measureApprovedFullStaticPixels(reference, actual, masks);
  assert(result.maximum <= 1 && result.changedPixels === 0, "Unapproved full static difference " + JSON.stringify(result));
  return result;
}
