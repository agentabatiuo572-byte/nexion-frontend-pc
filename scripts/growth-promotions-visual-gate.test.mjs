import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {promotionVisualCases,validatePromotionVisualBoards,validatePromotionVisualReviews,validatePromotionVisualFixture} from './growth-promotions-workflow-runtime.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const design=JSON.parse(fs.readFileSync('docs/design/growth-promotions/admin-r1-baseline.json'));
const baseline=JSON.parse(fs.readFileSync('docs/design/growth-promotions/evidence/admin-r1-design/v4-purchase-interval/export-report.json'));
const expected=promotionVisualCases(design,baseline);
function fixture(){
  const files=new Map(),proof={status:'captured-awaiting-independent-review',pageErrors:[],source:{designHash:'design',dirtySourceHash:'source'},boards:[]};
  for(const caseId of expected){
    const width=Number(caseId.split('-').at(-1)),viewport={width,height:1000},file=caseId+'.png',raw=Buffer.from('gate self-test only: '+file);files.set(file,raw);
    const modal=/-(modal|row)-/.test(caseId),geometry={viewport,main:{scrollTop:0,scrollHeight:944,clientHeight:944},dialog:modal?{}:null,dialogBody:modal?{scrollTop:0,scrollHeight:500,clientHeight:500}:null};
    proof.boards.push({caseId,screen:caseId.slice(0,5),theme:caseId.includes('-reduced-transparency-')?'dark':caseId.split('-').at(-2),file,sha256:hash(raw),viewport,dpr:1,clicks:modal?[{action:'click',name:'self-test only'}]:[],segments:[{kind:'main',file,sha256:hash(raw),geometry}],reducedTransparency:caseId.includes('-reduced-transparency-')?{matches:true,backdropFilter:'none'}:null});
  }
  const read=file=>{assert(files.has(file),'Missing self-test file '+file);return files.get(file);};return {proof,files,read};
}
test('approved manifest has exactly 398 unique cases including every special group',()=>{
  assert.equal(expected.length,398);const data=fixture();assert.equal(validatePromotionVisualBoards(data.proof,expected,data.read).length,398);
});
for(const group of ['-modal-rule-dark-','-phase-draft-','-modal-publish-error-','-row-rule-','-reduced-transparency-'])test('missing '+group+' rejects the complete capture',()=>{
  const data=fixture();data.proof.boards=data.proof.boards.filter(b=>!b.caseId.includes(group));assert.throws(()=>validatePromotionVisualBoards(data.proof,expected,data.read),/Incomplete product cases/);
});
test('duplicate cases, changed frames and missing dialog bottom are rejected',()=>{
  let data=fixture();data.proof.boards.push(data.proof.boards[0]);assert.throws(()=>validatePromotionVisualBoards(data.proof,expected,data.read),/Duplicate/);
  data=fixture();data.files.set(data.proof.boards[0].file,Buffer.from('changed'));assert.throws(()=>validatePromotionVisualBoards(data.proof,expected,data.read),/Changed capture/);
  data=fixture();data.proof.boards.find(b=>b.caseId.includes('-modal-rule-')).segments[0].geometry.dialogBody.scrollHeight=900;assert.throws(()=>validatePromotionVisualBoards(data.proof,expected,data.read),/dialogBody bottom/);
});
test('canonical case binds its actual viewport and theme',()=>{
  let data=fixture();data.proof.boards[0].viewport.width=data.proof.boards[0].viewport.width===1280?1440:1280;assert.throws(()=>validatePromotionVisualBoards(data.proof,expected,data.read),/Case viewport differs/);
  data=fixture();data.proof.boards[0].theme=data.proof.boards[0].theme==='dark'?'light':'dark';assert.throws(()=>validatePromotionVisualBoards(data.proof,expected,data.read),/Case theme differs/);
});
test('special fixture and original actual DTO bytes remain bound to current sources',()=>{
  const data=fixture(),dto=Buffer.from('self-test DTO only'),capturedFixture={kind:'explicit-ui-response-fixtures',designHash:'design',sourceHash:'source',serviceSourceHash:'service',actualDtoInputs:[{path:'dto.json',sha256:hash(dto)}],scenes:{}};data.files.set('dto.json',dto);data.proof.source.serviceSourceHash='service';
  for(const board of data.proof.boards.filter(b=>!/^ADM\d{2}-(normal|empty|loading|error|disabled|long)-/.test(b.caseId))){const key=board.caseId.includes('-reduced-transparency-')?board.caseId.replace(/-reduced-transparency-\d+$/,''):board.caseId.replace(/-(dark|light)-\d+$/,'');capturedFixture.scenes[key]={mapping:['self-test only'],actualDtoInputs:['dto.json']};board.mapping=['self-test only'];board.actualDtoInputs=['dto.json'];board.fixtureKind=capturedFixture.kind;}
  const raw=Buffer.from(JSON.stringify(capturedFixture));data.files.set('fixture.json',raw);data.proof.specialFixture={path:'fixture.json',sha256:hash(raw),kind:capturedFixture.kind,actualDtoInputs:capturedFixture.actualDtoInputs};validatePromotionVisualFixture(data.proof,data.read);
  data.files.set('dto.json',Buffer.from('changed'));assert.throws(()=>validatePromotionVisualFixture(data.proof,data.read),/Actual DTO input changed/);
  data.files.set('dto.json',dto);data.files.set('fixture.json',Buffer.from('changed'));assert.throws(()=>validatePromotionVisualFixture(data.proof,data.read),/Special fixture changed/);
});
function reviews(data){
  const images=validatePromotionVisualBoards(data.proof,expected,data.read),review={candidateHash:'candidate',designHash:'design',sourceHash:'source',reviews:[]};
  for(const reviewer of ['A','B']){
    const report={reviewer,verdict:'PASS',wholeVisualAcceptancePass:true,allCurrentImagesActuallyViewed:true,candidateSha256:'candidate',designSha256:'design',product:{sourceHash:'source'},reviewedCases:expected,viewedImages:images.map(i=>({...i,actuallyViewed:true,viewMethod:'self-test only'})),findings:[]};
    const file=reviewer+'.json',raw=Buffer.from(JSON.stringify(report));data.files.set(file,raw);review.reviews.push({reviewer,implemented:false,verdict:'PASS',unresolvedFindings:0,report:file,reportSha256:hash(raw),reviewedBoards:expected});
  }
  return {review,images};
}
test('two reports must bind every viewed frame and the exact current candidate',()=>{
  const data=fixture(),{review,images}=reviews(data);validatePromotionVisualReviews(review,data.proof,'candidate',images,data.read);
  assert.throws(()=>validatePromotionVisualReviews(review,data.proof,'other-candidate',images,data.read),/exact manifest/);
  review.reviews[0].reportSha256='wrong';assert.throws(()=>validatePromotionVisualReviews(review,data.proof,'candidate',images,data.read),/Changed independent report/);
});
test('a signed report that omits any actual image cannot pass',()=>{
  const data=fixture(),{review,images}=reviews(data),first=review.reviews[0],report=JSON.parse(data.files.get(first.report));report.viewedImages.pop();const raw=Buffer.from(JSON.stringify(report));data.files.set(first.report,raw);first.reportSha256=hash(raw);assert.throws(()=>validatePromotionVisualReviews(review,data.proof,'candidate',images,data.read),/actually viewed images/);
});
