import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const transpile = file => ts.transpileModule(fs.readFileSync(file,"utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const iosRules = { exports: {} };
vm.runInNewContext(transpile("lib/admin/ios-model-rules.ts"), { exports: iosRules.exports, require: () => ({}) });
const androidRules = { exports: {} };
vm.runInNewContext(transpile("lib/admin/android-soc-rules.ts"),
  { exports: androidRules.exports, require: id => id.endsWith("ios-model-rules") ? iosRules.exports : {} });
const client = { exports: {} };
vm.runInNewContext(transpile("lib/admin/phone-calibration-client.ts"), { exports: client.exports,
  require: id => id.endsWith("ios-model-rules") ? iosRules.exports : id.endsWith("android-soc-rules") ? androidRules.exports : {} });
const { phoneProposalError, parsePhoneCalibrationOverview, parsePhoneProposalView } = client.exports;
const { iosRuleIssues, iosRuleFormIssues, planIosImport, diffIosRules, blankIosRule } = iosRules.exports;
const same = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
const ios = (id, model, min, max, extra = {}) => ({ id, model, aliases: [], minComputeValue: min, maxComputeValue: max,
  enabled: true, valueSource: "OPERATOR_PRESET", catalogClass: "APPLE_RELEASED_HISTORICAL", note: null, ...extra });
const chip = (socKey, ...aliases) => ({socKey, name:`Chip ${socKey}`, manufacturer:"Qualcomm", aliases});
const rule = {id:"fixture",name:"高端",minComputeValue:75,maxComputeValue:95,enabled:true,valueSource:"OPERATOR_PRESET",note:null,
  chips:[chip("sd-8g2","SM8550")]};
const proposal = {expectedRevision:0,effectiveAt:0,thresholds:[19,25,35,47],androidSocRules:[rule],iosModelRules:[],
  androidPresetRemovals:{socKeys:[],aliases:[]}};
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
  assert.equal(result.operationQueue[1].phoneCalibrationProposal.androidSocRules[0].id,"fixture");
  assert.equal(result.operationQueue[1].phoneCalibrationProposal.baseline,null);
  assert.equal(result.operationQueue[2].id,"other");
});
test("Android chip tiers validate ranges, chip keys and identifiers like the server", () => {
  assert.equal(phoneProposalError(proposal),null);
  for (const thresholds of [[19,19,35,47],[0,25,35,47],[19,25,35],[19,25,NaN,47]])
    assert.ok(phoneProposalError({...proposal,thresholds}));
  for (const change of [{name:""},{minComputeValue:100},{maxComputeValue:95.001},{chips:[chip("sd-8g2")]},
    {chips:[chip("sd-8g2","qcom")]},{chips:[chip("sd-8g2","MT6833")]},{chips:[chip("Bad Key","SM8550")]},
    {chips:[chip("a","SM8550"),chip("b"," sm8550 ")]}])
    assert.ok(phoneProposalError({...proposal,androidSocRules:[{...rule,...change}]}), JSON.stringify(change));
  assert.ok(phoneProposalError({...proposal,androidSocRules:[rule,rule]}));
  assert.ok(phoneProposalError({...proposal,androidSocRules:[rule,{...rule,id:"other",chips:[chip("sd-8g2","SM8650")]}]}));
});
test("chips move whole between tiers and removals are remembered", () => {
  const { moveChip, removeChip, setChipAliases, diffAndroidRules } = androidRules.exports;
  const other = {...rule,id:"mid",name:"中端",minComputeValue:55,maxComputeValue:75,chips:[chip("sd-778g","SM7325")]};
  const moved = moveChip([rule,other],"sd-8g2","mid");
  same(moved.map(tier => tier.chips.map(item => item.socKey)),[[],["sd-778g","sd-8g2"]]);
  assert.match(diffAndroidRules([rule,other],moved).map(change => change.details.join(" ")).join(" "),/从「高端」移入/);
  const removed = removeChip([rule],{socKeys:[],aliases:[]},"sd-8g2");
  same([removed.rules[0].chips.length, removed.removals.socKeys],[0,["sd-8g2"]]);
  const trimmed = setChipAliases([{...rule,chips:[chip("sd-8g2","SM8550","kalama")]}],{socKeys:[],aliases:[]},"sd-8g2",["SM8550"]);
  same(trimmed.removals.aliases,["kalama"]);
});
test("empty and scheduled server catalogs remain distinct; malformed data is rejected", () => {
  const empty = {policy:{revision:0,current:null,scheduled:null},pendingHardware:[],computeUnit:"platform"};
  assert.equal(parsePhoneCalibrationOverview(empty).policy.current,null);
  const published = {version:1,effectiveAt:1000,thresholds:proposal.thresholds,androidSocRules:proposal.androidSocRules};
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

test("iPhone model rules need only a model and an operator range, and names stay unique", () => {
  const good = {...proposal,iosModelRules:[ios("ios-16-pro","iPhone 16 Pro",100,120,{aliases:["iPhone17,1"]}),ios("fixed","iPhone 6",12.5,12.5)]};
  assert.equal(phoneProposalError(good),null);
  for (const change of [{model:""},{model:"iPhone"},{model:" apple  iphone "},{minComputeValue:130},{minComputeValue:0},
    {maxComputeValue:120.001},{id:"bad id"},{id:"fixture"},{aliases:["iphone"]},{note:"x".repeat(501)}])
    assert.ok(phoneProposalError({...good,iosModelRules:[{...good.iosModelRules[0],...change}]}), JSON.stringify(change));
  const duplicate = iosRuleIssues([ios("a","iPhone 16 Pro",1,2),ios("b"," IPHONE 16 PRO",1,2)]);
  assert.equal(duplicate[0].index,1);
  assert.equal(duplicate[0].field,"model");
  assert.equal(iosRuleIssues([ios("a","iPhone 6",1,2,{aliases:["iPhone7,2"]}),ios("b","iPhone 6 Plus",1,2,{aliases:["iphone7,2"]})])[0].field,"aliases");
});
test("an edited rule is blamed for the clash it creates, wherever it sits in the list", () => {
  const rules = [ios("a","iPhone 6",1,2), ios("b","iPhone 15",1,2)];
  const issues = iosRuleFormIssues(rules, 0, {...rules[0],aliases:["iPhone 15"]});
  assert.equal(issues[0].field,"aliases");
  assert.equal(iosRuleFormIssues(rules, 0, {...rules[0],id:"b"})[0].field,"id");
  assert.equal(iosRuleFormIssues(rules, null, ios("c","iPhone 7",1,2), ["c"])[0].field,"id");
  same(iosRuleFormIssues(rules, 1, {...rules[1],minComputeValue:3,maxComputeValue:4}),[]);
});
test("a stored policy without iPhone rules reads as an empty list", () => {
  const empty = {policy:{revision:1,current:{version:1,effectiveAt:0,thresholds:[19,25,35,47],rules:[]},scheduled:null},pendingHardware:[],computeUnit:"platform"};
  same(parsePhoneCalibrationOverview(empty).policy.current.iosModelRules,[]);
  assert.throws(() => parsePhoneCalibrationOverview({...empty,policy:{...empty.policy,current:{...empty.policy.current,iosModelRules:[{id:"x"}]}}}));
});
test("preset import only fills missing models and never overwrites operator edits", () => {
  const draft = [ios("ios-16-pro","iPhone 16 Pro",95,115,{enabled:false,aliases:["custom"]}), ios("mine","iPhone 6",1,2,{aliases:["iPhone7,1"]})];
  const presets = [ios("ios-16-pro","iPhone 16 Pro",100,120,{aliases:["iPhone17,1"]}), ios("ios-6-plus","iPhone 6 Plus",12,22,{aliases:["iPhone7,1"]}),
    ios("ios-air","iPhone Air",105,125)];
  const plan = planIosImport(draft, presets);
  same(plan.added.map(rule => rule.id),["ios-air"]);
  same(plan.skipped.map(rule => rule.id),["ios-16-pro"]);
  same(plan.conflicts.map(entry => entry.preset.id),["ios-6-plus"]);
  same(planIosImport([...draft,...plan.added], presets).added,[]);
  same(planIosImport([], [ios("x","iPhone Air",1,2)], ["x"]).conflicts.map(entry => entry.preset.id),["x"]);
  const full = Array.from({length:499},(_,i) => ios(`r${i}`,`Model ${i}`,1,2));
  const capped = planIosImport(full, [ios("p1","iPhone Air",1,2), ios("p2","iPhone 17",1,2)]);
  same([capped.added.map(rule => rule.id), capped.conflicts.map(entry => entry.preset.id)],[["p1"],["p2"]]);
  assert.equal(blankIosRule([], ["ios-operator-1"]).id,"ios-operator-2");
});
test("A2 sees added, modified, disabled and removed iPhone rules against the server baseline", () => {
  const before = [ios("a","iPhone 16 Pro",95,115), ios("b","iPhone 6",10,20), ios("c","iPhone 7",20,30)];
  const after = [ios("a","iPhone 16 Pro",100,120), ios("b","iPhone 6",10,20,{enabled:false}), ios("d","iPhone Air",105,125)];
  const changes = diffIosRules(before, after);
  same(changes.map(change => [change.kind,change.id]),[["modified","a"],["disabled","b"],["added","d"],["removed","c"]]);
  assert.match(changes[0].details[0],/95–115 → 100–120/);
  assert.deepEqual([...diffIosRules([], [ios("n","iPhone 6",10,20,{enabled:false})])[0].details],["范围 10–20","停用"]);
  const view = parsePhoneProposalView({...proposal,iosModelRules:after,baseline:{revision:3,rules:[],iosModelRules:before}});
  assert.equal(view.baseline.revision,3);
  assert.throws(() => parsePhoneProposalView({...proposal,baseline:{revision:"x",rules:[]}}));
  const { iosModelRules: _omitted, ...older } = proposal;
  const inherited = parsePhoneProposalView({...older,baseline:{revision:3,rules:[],iosModelRules:before}});
  assert.equal(inherited.iosRulesInherited,true);
  assert.equal(view.iosRulesInherited,false);
});
