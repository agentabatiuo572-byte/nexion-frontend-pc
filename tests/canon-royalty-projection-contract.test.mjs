import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveNexionAppRoot, resolveNexionBackendRoot } from '../scripts/lib/nexion-workspace-paths.mjs';
const root=path.resolve(import.meta.dirname,'..');
const source=fs.readFileSync(path.join(root,'scripts/canon-sentinel.mjs'),'utf8').replace(/^#!.*\n/,'').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(pathToFileURL(path.join(root,'scripts/canon-sentinel.mjs')).href));
const app=resolveNexionAppRoot({adminRoot:root}),backend=resolveNexionBackendRoot({adminRoot:root});
function run(mutation) {
 let exitCode=0; const stdout=[];
 const context={fs:{...fs,readFileSync(file,...args){const value=fs.readFileSync(file,...args); return mutation?mutation(String(file).replaceAll('\\','/'),value):value;}},path,fileURLToPath,resolveNexionAppRoot,resolveNexionBackendRoot,
 console:{log:value=>stdout.push(value)},process:{env:process.env,exit:code=>{exitCode=code;throw new Error('SENTINEL_EXIT');}}};
 try {vm.runInNewContext(source,context,{timeout:10000});} catch(error) {if(error.message!=='SENTINEL_EXIT')throw error;}
 return {exitCode,stdout:stdout.join('\n')};
}
function changed(file,edit){let applied=false;return {apply:(actual,value)=>{if(actual===file.replaceAll('\\','/')){const next=edit(value);assert.notEqual(next,value,'mutation must change the real source');applied=true;return next;}return value;},check:()=>assert.equal(applied,true)}}
function rejects(file,edit,key){const mutation=changed(file,edit),result=run(mutation.apply);mutation.check();assert.equal(result.exitCode,1);assert.ok(result.stdout.includes(key),result.stdout);}
test('canon sentinel accepts the current server projection and unknown-rate presentation',()=>assert.equal(run().exitCode,0));
for(const locale of ['zh','en','vi']){
 const file=path.join(app,'src/i18n/messages',locale+'.ts');
 test('canon sentinel rejects missing royalty placeholder in '+locale,()=>rejects(file,text=>text.replace(/(royaltyFooter:\s*"[^"\r\n]*)\{royalty\}/,'$12.5%'),'genesis.uni.royaltyTemplate.'+locale));
 test('canon sentinel rejects a hardcoded default beside the placeholder in '+locale,()=>rejects(file,text=>text.replace(/royaltyFooter:\s*"/,'royaltyFooter: "2.5% '),'genesis.uni.royaltyTemplate.'+locale));
 test('canon sentinel rejects missing unknown-rate copy in '+locale,()=>rejects(file,text=>text.replace(/royaltyUnavailable:\s*"[^"\r\n]*"/g,'royaltyUnavailable: ""'),'genesis.uni.royaltyUnavailable.'+locale));
}
test('canon sentinel rejects server royalty default drift',()=>rejects(path.join(backend,'src/main/java/ffdd/opsconsole/market/application/OpsNexMarketService.java'),text=>text.replace(/(case "royalty"\s*->\s*new GenesisParamDef\(\s*key,\s*"nx_genesis_series\.royalty_bps",\s*"NUMBER",\s*")([\d.]+)(")/s,'$19$3'),'genesis.backend.defaultRoyaltyRate'));
test('canon sentinel rejects removing the server rate projection',()=>rejects(path.join(app,'src/store/genesis.ts'),text=>text.replaceAll('remoteRoyaltyPct.value = state.series.royaltyPct','remoteRoyaltyPct.value = 2.5'),'genesis.uni.royaltyRemoteProjection'));
test('canon sentinel rejects replacing the marketplace unknown-rate branch',()=>rejects(path.join(app,'src/pages/genesis/marketplace.vue'),text=>text.replace('presentGenesisRoyalty(genesis.remoteRoyaltyPct)','presentGenesisRoyalty(2.5)'),'genesis.uni.royaltyMarketplaceFallback'));
