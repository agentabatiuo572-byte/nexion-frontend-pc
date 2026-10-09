import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import vm from 'node:vm';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';import {stripComments} from '../scripts/lib/strip-comments.mjs';
const root=process.cwd(),require=createRequire(import.meta.url),ts=require('typescript'),sentinel=path.join(root,'scripts/pending-idempotency-key-sentinel.mjs'),producer='lib/admin/support-group-client.ts',consumer='app/components/domain-views/m-tabs/m1-group-management.tsx';
const source=fs.readFileSync(sentinel,'utf8'),code=ts.transpileModule(source.replace('import.meta.url',JSON.stringify(pathToFileURL(sentinel).href)),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
function execute(replacements={},childProcess){const errors=[],logs=[],fakeFs={...fs,readFileSync(file,...args){const rel=path.relative(root,String(file)).split(path.sep).join('/');return Object.hasOwn(replacements,rel)?replacements[rel]:fs.readFileSync(file,...args);}},module={exports:{}};let exit=0;try{vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='node:child_process'&&childProcess?childProcess:id==='node:fs'?fakeFs:id==='./lib/strip-comments.mjs'?{stripComments}:require(id),process:{execPath:process.execPath,env:process.env,exit:code=>{throw{sentinelExit:code};}},console:{error:x=>errors.push(x),log:x=>logs.push(x)}});}catch(error){if(!Object.hasOwn(error,'sentinelExit'))throw error;exit=error.sentinelExit;}return{exit,errors:errors.join('\n'),logs:logs.join('\n')};}
test('registered exported group store binds its real consumer and runs durable query-only behavior',()=>{const result=execute();assert.equal(result.exit,0,result.errors);assert.match(result.logs,/sentinel PASS/);assert.match(source,/behaviorTest: "tests\/support-group-client.test.mjs"/);assert.match(source,/unresolved original CREATE survives module reload beyond 24h but cannot replay/);assert.match(source,/spawnSync\(process.execPath/);});
test('exported-store registration cannot hide missing runtime binding or removed read/write/durable calls',()=>{const original=fs.readFileSync(path.join(root,consumer),'utf8'),originalProducer=fs.readFileSync(path.join(root,producer),'utf8');const mutants=[{[consumer]:original.replace('groupPendingCommands, observedVersion','groupPendingCommands as unusedGroupStore, observedVersion')},{[consumer]:original.replace('@/lib/admin/support-group-client','@/lib/admin/fake-support-group-client')},{[consumer]:original.replace(/groupPendingCommands\.list/g,'obsoleteGroupStore.list')},{[consumer]:original.replace(/groupPendingCommands\.remember/g,'obsoleteGroupStore.remember')},{[consumer]:original.replace(/groupPendingCommands\.forget/g,'obsoleteGroupStore.forget')},{[consumer]:original.replace(/groupPendingCommands\.isDurablyStored/g,'obsoleteGroupStore.isDurablyStored')},{[producer]:originalProducer.replace('export const groupPendingCommands','const groupPendingCommands')}];for(const mutant of mutants){const result=execute(mutant);assert.equal(result.exit,1);assert.match(result.errors,/support-group-client.ts.*groupPendingCommands/);}});
test('registered exported-store behavior cannot silently disappear while the scanner stays green',()=>{const testFile='tests/support-group-client.test.mjs',result=execute({[testFile]:fs.readFileSync(path.join(root,testFile),'utf8').replace('unresolved original CREATE survives module reload beyond 24h but cannot replay','removed behavior')});assert.equal(result.exit,1);assert.match(result.errors,/行为保护缺失/);});

const behaviorName = 'unresolved original CREATE survives module reload beyond 24h but cannot replay';
const behaviorFile = 'tests/support-group-client.test.mjs';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function sourceHashes(dir, relative = '') {
  const hashes = {};
  for (const entry of fs.readdirSync(path.join(dir, relative), {withFileTypes:true})) {
    if (entry.name === 'node_modules' || entry.name === 'evidence') continue;
    const name = path.join(relative, entry.name);
    if (entry.isDirectory()) Object.assign(hashes, sourceHashes(dir, name));
    else if (entry.isFile()) hashes[name.split(path.sep).join('/')] = digest(fs.readFileSync(path.join(dir, name)));
  }
  return hashes;
}
function isolatedBehaviorFixture(option) {
  const artifacts = process.env.FULL_GATES_MUTANT_ROOT || path.join(os.tmpdir(), 'nexion-full-gates-pending-registration');
  fs.mkdirSync(artifacts, {recursive:true});
  const fixture = fs.mkdtempSync(path.join(artifacts, `${option}-`));
  assert.ok(!fixture.startsWith(root + path.sep), 'mutants must never alter the source checkout');
  for (const dir of ['app', 'lib']) fs.cpSync(path.join(root, dir), path.join(fixture, dir), {recursive:true});
  for (const file of ['package.json', 'scripts/pending-idempotency-key-sentinel.mjs', 'scripts/lib/strip-comments.mjs', behaviorFile, 'tests/helpers.mjs']) {
    fs.mkdirSync(path.dirname(path.join(fixture, file)), {recursive:true});
    fs.copyFileSync(path.join(root, file), path.join(fixture, file));
  }
  fs.symlinkSync(fs.realpathSync(path.join(root, 'node_modules')), path.join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(fixture, 'evidence'));
  return fixture;
}
for (const option of ['skip', 'todo']) test(`real registered behavior marked ${option} is rejected and every isolated source is restored`, () => {
  const fixture = isolatedBehaviorFixture(option), target = path.join(fixture, behaviorFile);
  const before = sourceHashes(fixture), original = fs.readFileSync(target, 'utf8');
  const mutant = original.replace(`test("${behaviorName}",()=>{`, `test("${behaviorName}",{${option}:true},()=>{`);
  assert.notEqual(mutant, original, 'must mutate the real named test');
  const env = {...process.env, GROUP_FE_ROOT:fixture};
  delete env.NODE_TEST_CONTEXT;
  try {
    fs.writeFileSync(target, mutant);
    const behavior = spawnSync(process.execPath, ['--experimental-strip-types','--test','--test-reporter=tap','--test-name-pattern',`^${behaviorName}$`,target], {cwd:fixture,env,encoding:'utf8',timeout:30000});
    fs.writeFileSync(path.join(fixture,'evidence',`behavior-${option}.log`), (behavior.stdout ?? '') + (behavior.stderr ?? ''));
    assert.equal(behavior.error, undefined);
    assert.equal(behavior.status, 0, behavior.stderr);
    assert.match(behavior.stdout, /^# tests 1$/m);
    assert.match(behavior.stdout, /^# pass 0$/m);
    assert.match(behavior.stdout, new RegExp(`^# ${option === 'skip' ? 'skipped' : 'todo'} 1$`, 'm'));
    const gate = spawnSync(process.execPath, [path.join(fixture,'scripts/pending-idempotency-key-sentinel.mjs')], {cwd:fixture,env,encoding:'utf8',timeout:30000});
    fs.writeFileSync(path.join(fixture,'evidence',`sentinel-${option}.log`), (gate.stdout ?? '') + (gate.stderr ?? ''));
    assert.equal(gate.error, undefined);
    assert.equal(gate.status, 1, 'a behavior that did not prove its assertions must fail the sentinel');
    assert.match(gate.stderr, /导出存储行为保护失败/);
  } finally {
    fs.writeFileSync(target, original);
    const after = sourceHashes(fixture);
    fs.writeFileSync(path.join(fixture,'evidence','source-readback.json'), JSON.stringify({before,after,mutantSha256:digest(mutant),restoredSha256:digest(fs.readFileSync(target))},null,2)+'\n');
    assert.deepEqual(after, before, 'every copied source must read back unchanged after the mutant');
  }
});
test('behavior TAP requires exactly one passing test with no missing duplicate or nonzero outcome and no spawn error', () => {
  const counters = {tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0};
  const tap = values => Object.entries(values).map(([name,value])=>`# ${name} ${value}`).join('\n')+'\n';
  const bad = [];
  for (const name of Object.keys(counters)) {
    const missing = {...counters}; delete missing[name];
    bad.push({status:0,stdout:tap(missing)});
    bad.push({status:0,stdout:tap({...counters,[name]:counters[name]+1})});
    bad.push({status:0,stdout:tap(counters)+`# ${name} ${counters[name]}\n`});
  }
  bad.push({status:0,stdout:tap(counters),error:new Error('spawn failed')});
  bad.push({status:null,stdout:tap(counters)});
  for (const result of bad) {
    const outcome = execute({}, {spawnSync:()=>result});
    assert.equal(outcome.exit, 1);
    assert.match(outcome.errors, /导出存储行为保护失败/);
  }
});
