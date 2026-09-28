import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const client = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/admin/phone-calibration-client.ts","utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: client.exports, require: () => ({}) });
const { phoneProposalError, parsePhoneCalibrationOverview } = client.exports;
const rule = {id:"fixture",platform:"android",model:"Test phone",soc:"Test SoC",gpu:"Test GPU",
  minMemoryGb:6,maxMemoryGb:9,computeValue:24.3,evidence:"Test fixture only"};
const proposal = {expectedRevision:0,effectiveAt:0,thresholds:[19,25,35,47],rules:[rule]};
test("an unreadable phone proposal is isolated without hiding the rest of the A2 queue", () => {
  const a2 = {exports:{}};
  const source = fs.readFileSync("lib/admin/a2-client.ts","utf8") + "\nexport const inspectQueue = normalizeOverview;";
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports:a2.exports,require:(id)=>id.endsWith("phone-calibration-client")?client.exports:{}});
  const result = a2.exports.inspectQueue({operationQueue:[
    {id:"bad",obj:"phone-calibration",phoneCalibrationProposal:JSON.stringify({...proposal,thresholds:[]})},
    {id:"good",obj:"phone-calibration",phoneCalibrationProposal:JSON.stringify(proposal)},
    {id:"other",obj:"another-operation"},
  ]});
  assert.equal(result.operationQueue.length,3);
  assert.ok(result.operationQueue[0].phoneCalibrationError);
  assert.equal(result.operationQueue[0].phoneCalibrationProposal,undefined);
  assert.equal(result.operationQueue[1].phoneCalibrationProposal.rules[0].id,"fixture");
  assert.equal(result.operationQueue[2].id,"other");
});
test("phone rule editing validates continuous thresholds and hardware fields", () => {
  assert.equal(phoneProposalError(proposal),null);
  for (const thresholds of [[19,19,35,47],[0,25,35,47],[19,25,35],[19,25,NaN,47]])
    assert.ok(phoneProposalError({...proposal,thresholds}));
  for (const change of [{soc:""},{gpu:""},{minMemoryGb:9},{computeValue:0},{evidence:"x".repeat(501)}])
    assert.ok(phoneProposalError({...proposal,rules:[{...rule,...change}]}));
  assert.ok(phoneProposalError({...proposal,rules:[rule,rule]}));
});
test("empty and scheduled server catalogs remain distinct; malformed data is rejected", () => {
  const empty = {policy:{revision:0,current:null,scheduled:null},pendingHardware:[],computeUnit:"platform"};
  assert.equal(parsePhoneCalibrationOverview(empty).policy.current,null);
  const published = {version:1,effectiveAt:1000,thresholds:proposal.thresholds,rules:proposal.rules};
  const future = {...published,version:2,effectiveAt:5000};
  assert.equal(parsePhoneCalibrationOverview({...empty,policy:{revision:2,current:published,scheduled:future}}).policy.scheduled.version,2);
  assert.throws(() => parsePhoneCalibrationOverview({...empty,computeUnit:"TOPS"}));
  assert.throws(() => parsePhoneCalibrationOverview({...empty,policy:{revision:0,current:published,scheduled:null}}));
  assert.throws(() => parsePhoneCalibrationOverview({...empty,policy:{revision:0}}));
});
test("A2 phone policy targets one atomic configuration with E6 publication command", () => {
  const registry = {exports:{}};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/admin/high-ops-registry.ts","utf8"), {
    compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText,{exports:registry.exports,require:()=>({})});
  const operation = registry.exports.findHighOp("e6_phone_calibration");
  assert.equal(operation.amplifies,true);
  assert.equal(operation.buildCommand(proposal).params,proposal);
  assert.equal(operation.buildTarget({}).type,"phone_calibration_policy");
  assert.equal(operation.buildTarget({}).id,"phone-calibration");
});
