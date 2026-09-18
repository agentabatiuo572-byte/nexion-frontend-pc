import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source = readFileSync(new URL('../lib/admin/disclosure-publication-diagnostic.ts', import.meta.url), 'utf8');
const exports = {};
new Function('exports', ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(exports);
const diagnose = exports.disclosurePublicationIssue;
const mapping = {code:'CN',version:'v1',status:'PUBLISHED'};
const valid = () => ({jurisdiction:'CN',version:'v1',status:'published',languageScope:'zh+vi',chapters:Array.from({length:7},(_,i)=>({jurisdiction:'CN',version:'v1',no:String(i+1).padStart(2,'0'),zh:'标题',vi:'Title',zhBody:'正文',viBody:'Body',en:'',enBody:''}))});
test('missing exact publication is diagnosed, never substituted with other jurisdiction/version',()=>{
 assert.match(diagnose(mapping,[]),/未找到/);
 assert.match(diagnose(mapping,[{...valid(),jurisdiction:'VN'},{...valid(),version:'v2'}]),/未找到/);
});
test('draft, archived and duplicate references are not usable publications',()=>{
 for(const status of ['draft','archived','unknown']) assert.match(diagnose(mapping,[{...valid(),status}]),/未发布/);
 assert.match(diagnose(mapping,[valid(),valid()]),/不唯一/);
});
test('published and superseded exact complete bodies are accepted, inactive mapping not diagnosed',()=>{
 assert.equal(diagnose(mapping,[valid()]),null);
 assert.equal(diagnose(mapping,[{...valid(),status:'SUPERSEDED'}]),null);
 assert.equal(diagnose({...mapping,status:'archived'},[]),null);
});
test('empty, duplicate, mismatched chapters and missing scoped language bodies are diagnosed',()=>{
 for(const mutate of [v=>v.chapters=[],v=>v.chapters[6]=v.chapters[0],v=>v.chapters[0].version='v2',v=>v.chapters[0].zhBody=' ',v=>v.languageScope='zh+vi+en',v=>v.languageScope='unknown']){
 const v=valid();mutate(v);assert.match(diagnose(mapping,[v]),/正文/);
 }
 const v=valid();v.languageScope='zh+vi+en';v.chapters.forEach(c=>{c.en='Title';c.enBody='Body';});assert.equal(diagnose(mapping,[v]),null);
});
