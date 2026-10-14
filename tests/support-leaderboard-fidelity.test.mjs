import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { decodeLosslessScreenshot, assertApprovedStaticPixels, approvedStaticRegions, approvedDynamicMasks, createApprovedDynamicMask, measureApprovedFullStaticPixels, assertApprovedFullStaticPixels } from "./support-leaderboard-fidelity.mjs";
import { assertApprovedAmendmentGeometry, createApprovedAmendmentMask, measureApprovedAmendedPixels } from "./support-leaderboard-fidelity.mjs";

function image(width = 8, height = 8) {
  return { info: { width, height, channels: 4 }, data: Buffer.from(Array.from({ length: width * height * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 17 + Math.floor(i / 32) * 23) % 251)) };
}
const region = [{ id: "material", rect: [2, 2, 4, 4] }];
function amendedGeometry() {
  const table={x:203,y:593,width:1312,height:286};let x=table.x;
  const columns=[.08,.28,.17,.16,.16,.15].map((fraction,i)=>{const column={x,y:593,width:1312*fraction,height:46,label:["排名","姓名、组名 / 排名变化","业绩额","首充人数","绑定客户数","操作"][i]};x+=column.width;return column;});
  const border=drawn=>({width:drawn?1:0,style:drawn?"solid":"none",color:"rgba(39, 50, 54, 0.5)"});
  return {table,columns,rows:Array.from({length:5},(_,i)=>({...table,y:639+48*i,height:48})),cells:Array.from({length:36},(_,i)=>({...columns[i%6],y:i<6?593:639+Math.floor((i-6)/6)*48,height:i<6?46:48,left:border(i%6>0),top:border(i>=6),visible:true})),frames:[[323,189,118],[608,198,108],[871,198,108],[1137,198,108],[1379,126,106],[316,782,50]].map(([x,y,width])=>({x,y,width,height:width,borderWidth:2,borderStyle:"solid",borderColor:"rgb(196, 255, 54)",borderRadius:"50%",shadow:"rgba(196, 255, 54, 0.35) 0px 0px 8px 0px",visible:true}))};
}
test("approved grid and ring changes retain the raw failure and require independent geometry",()=>{
  const reference={info:{width:1536,height:1024,channels:4},data:Buffer.alloc(1536*1024*4,128)};
  const actual={info:reference.info,data:Buffer.from(reference.data)};
  for(const [x,y] of [[525,700],[675,700],[662,198]])actual.data[(y*1536+x)*4]=0;
  assert(measureApprovedFullStaticPixels(reference,actual).changedPixels>0);
  const report=measureApprovedAmendedPixels(reference,actual,amendedGeometry());
  assert.equal(report.changedPixels,0);assert.equal(report.total,report.static+report.dynamic+report.amended);
  assert.equal(report.amended,65484);assert(report.static>1200000);
  assert.throws(()=>measureApprovedAmendedPixels(reference,actual),/geometry is required/);
  for(const mutate of [g=>g.columns.splice(1,0,g.columns[1]),g=>g.columns[1].x+=8,g=>g.columns[1].label="当前组",g=>g.cells[7].x+=8,g=>g.cells[7].left.width=0,g=>g.cells[7].left.color="rgb(0, 0, 0)",g=>g.cells[7].top.style="none",g=>g.cells[7].visible=false,g=>g.frames[1].borderColor="rgb(180, 190, 170)",g=>g.frames[1].width+=6,g=>g.frames[1].borderWidth=0,g=>g.frames[1].shadow="none",g=>g.frames[1].visible=false]){const geometry=amendedGeometry();mutate(geometry);assert.throws(()=>assertApprovedAmendmentGeometry(geometry));}
});
test("amended regions cannot hide a bad background pixel, an outer edge, or the whole table",()=>{
  const mask=createApprovedAmendmentMask(1536,1024);
  for(const [x,y] of [[230,620],[720,720],[210,700],[202,593],[1515,700],[500,878],[500,879],[1338,61],[240,523],[382,172]])assert.notEqual(mask[y*1536+x],2,`${x},${y} remains outside approved changes`);
  const reference={info:{width:1536,height:1024,channels:4},data:Buffer.alloc(1536*1024*4,128)};
  for(const [x,y] of [[720,720],[202,593],[1515,700],[500,878],[500,879],[1338,61],[240,523],[382,172]]){const actual={info:reference.info,data:Buffer.from(reference.data)};actual.data[(y*1536+x)*4]=0;assert.equal(measureApprovedAmendedPixels(reference,actual,amendedGeometry()).changedPixels,1,`${x},${y} corruption must remain visible`);}
});
test("pixel input rejects a JPEG saved with a PNG filename before comparing colors", async () => {
  const original = image();
  const png = await sharp(original.data, { raw: original.info }).png().toBuffer();
  const jpeg = await sharp(original.data, { raw: original.info }).jpeg().toBuffer();
  const decoded = await decodeLosslessScreenshot(png);
  assert.deepEqual(decoded.data, original.data);
  await assert.rejects(decodeLosslessScreenshot(jpeg), /requires lossless PNG bytes/);
  await assert.rejects(decodeLosslessScreenshot(png.subarray(0, 4)), /requires lossless PNG bytes/);
});
test("the exposed canvas top strip retains the approved source pixels", async () => {
  const root = new URL("../", import.meta.url);
  const reference = await sharp(readFileSync(new URL("docs/design/support-analytics-20261006/leaderboard-orbit-20261010/approved-design.png", root))).extract({ left: 181, top: 0, width: 1355, height: 20 }).ensureAlpha().raw().toBuffer();
  const canvas = await sharp(readFileSync(new URL("app/components/domain-views/m-tabs/support-leaderboard-assets/orbit-surface-main-canvas.png", root))).extract({ left: 0, top: 0, width: 1355, height: 20 }).ensureAlpha().raw().toBuffer();
  assert.ok(canvas.equals(reference), "The exposed top strip must retain every approved RGBA byte");
});
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
