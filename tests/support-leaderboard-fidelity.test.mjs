import assert from "node:assert/strict";
import { test } from "node:test";
import { assertApprovedStaticPixels, approvedStaticRegions, approvedDynamicMasks, createApprovedDynamicMask, measureApprovedFullStaticPixels, assertApprovedFullStaticPixels } from "./support-leaderboard-fidelity.mjs";

function image(width = 8, height = 8) {
  return { info: { width, height, channels: 4 }, data: Buffer.from(Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / 32) * 23) % 251)) };
}
const region = [{ id: "material", rect: [2, 2, 4, 4] }];
test("approved material accepts exact bytes and one channel of screenshot rounding", () => {
  const reference = image(), actual = { info: { ...reference.info }, data: Buffer.from(reference.data) };
  actual.data[(3 * 8 + 3) * 4]++;
  const result = assertApprovedStaticPixels(reference, actual, region);
  assert.equal(result[0].maximum, 1);
});

test("full-area coverage checks every unmasked pixel and rejects corruption anywhere", () => {
  const reference=image(), masks=[{id:"portrait",reason:"Authorized interior",ellipse:[4,4,2,2]}],mask=createApprovedDynamicMask(8,8,masks);
  const coverage=assertApprovedFullStaticPixels(reference,reference,masks);
  assert.equal(coverage.checked,coverage.static);assert.equal(coverage.uncovered,0);assert.equal(coverage.total,64);assert(coverage.masked>0&&coverage.static>0);
  for(let p=0;p<64;p++){
    const actual={info:{...reference.info},data:Buffer.from(reference.data)};actual.data[p*4]^=127;
    if(mask[p])assertApprovedFullStaticPixels(reference,actual,masks);
    else assert.throws(()=>assertApprovedFullStaticPixels(reference,actual,masks),/Unapproved full static difference/);
  }
  assert.throws(()=>measureApprovedFullStaticPixels(reference,{info:reference.info,data:reference.data.subarray(4)},masks),/RGBA byte coverage/);
  assert.throws(()=>assertApprovedFullStaticPixels(reference,reference,[{id:"whole",reason:"Rejected empty static area",rect:[0,0,8,8]}]),/Static coverage must not be empty/);
});
test("fixed dynamic masks leave orbit, pedestal, frames, borders, table lines and pagination geometry checked",()=>{
  const width=1536,height=1024,mask=createApprovedDynamicMask(width,height);
  for(const [x,y]of [[240,523],[1300,350],[790,125],[330,316],[382,190],[925,197],[1338,61],[202,593],[525,700],[674,700],[896,700],[594,893],[748,913],[1172,912],[700,970]])assert.equal(mask[y*width+x],0,`${x},${y} must be checked`);
  assert(approvedDynamicMasks.every(s=>s.reason&&!/reconstruct|feather/i.test(s.reason)));
  const reference={info:{width,height,channels:4},data:Buffer.alloc(width*height*4,128)};
  const coverage=assertApprovedFullStaticPixels(reference,reference);assert.equal(coverage.checked,coverage.static);assert.equal(coverage.uncovered,0);
  for(const [x,y]of [[240,523],[1300,350],[382,190],[594,893],[674,700]]){const actual={info:reference.info,data:Buffer.from(reference.data)};actual.data[(y*width+x)*4]=0;assert.throws(()=>assertApprovedFullStaticPixels(reference,actual),/Unapproved full static difference/);}
});
test("one bad static pixel cannot hide in a mean or a whole-table exception", () => {
  const reference = image(), actual = { info: { ...reference.info }, data: Buffer.from(reference.data) };
  actual.data[(3 * 8 + 3) * 4] ^= 127;
  assert.throws(() => assertApprovedStaticPixels(reference, actual, region), /unapproved static difference/);
});
test("a bad edge pixel cannot be hidden by selecting a shifted flat region", () => {
  const reference = { info: { width: 8, height: 8, channels: 4 }, data: Buffer.alloc(8 * 8 * 4, 255) };
  const actual = { info: { ...reference.info }, data: Buffer.from(reference.data) };
  actual.data[(2 * 8 + 2) * 4] = 0;
  assert.throws(() => assertApprovedStaticPixels(reference, actual, region), /unapproved static difference/);
  assert.throws(() => assertApprovedStaticPixels(reference, actual, region, { material: { dx: 2, dy: 0 } }), /geometry exceeds/);
});
test("dynamic changes outside explicit static regions do not weaken static assertions", () => {
  const reference = image(), actual = { info: { ...reference.info }, data: Buffer.from(reference.data) };
  actual.data[0] ^= 127;
  assert.equal(assertApprovedStaticPixels(reference, actual, region).length, 1);
  actual.info.width++;
  assert.throws(() => assertApprovedStaticPixels(reference, actual, region), /viewport width/);
});
test("orbit coverage includes planet, upper and lower rings and local pedestal material", () => {
  assert(approvedStaticRegions.length >= 6);
  assert(approvedStaticRegions.some(region => region.id === "planet-surface"));
  assert(approvedStaticRegions.some(region => region.id === "lower-orbit"));
  assert(approvedStaticRegions.some(region => region.id === "first-pedestal"));
  assert.deepEqual(approvedStaticRegions.filter(region=>region.id.endsWith("pedestal")).map(region=>region.id),["first-pedestal","second-pedestal","third-pedestal","fourth-pedestal"]);
  assert(approvedStaticRegions.every(region => region.rect[2] * region.rect[3] <= 2400));
  assert.throws(() => assertApprovedStaticPixels(image(), image(), []), /coverage must not be empty/);
});
