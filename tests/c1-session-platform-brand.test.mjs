import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
const brand={};new Function('exports',compile(read('lib/admin/brand-copy.ts')))(brand);
const source=read('app/_console/users/search/[id]/page.tsx');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),nodes=[];
function visit(n){nodes.push(n);ts.forEachChild(n,visit);}visit(ast);
const declarations=['asText','displayValue','DataTable'].map(name=>nodes.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(ast));
const column=nodes.find(n=>ts.isObjectLiteralExpression(n)&&n.properties.some(p=>ts.isPropertyAssignment(p)&&p.name.getText(ast)==='key'&&p.initializer.getText(ast)==='"deviceName"'));
assert.ok(column,'actualC1sessiondevicecolumn');
const out={};new Function('exports','require','platformSessionDeviceText',compile(declarations.join('\n')+'\nexport function render(row){return DataTable({rows:[row],columns:['+column.getText(ast)+']});}'))(out,()=>({jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}),brand.platformSessionDeviceText);
function text(n){if(Array.isArray(n))return n.map(text).join('');if(n==null)return '';if(typeof n==='object')return text(n.props?.children);return String(n);}
for(const [raw,expected] of [['NexGrid Phone App','NexGrid Phone App'],['NexGrid H5','NexGrid H5'],['NexGrid App / H5','NexGrid App / H5'],['UVEL Phone App','UVEL Phone App']]){
 test('actualC1table shows source platform label '+raw,()=>{
  const row=Object.freeze({id:'session-1',deviceId:'device-1',deviceName:raw,status:'ACTIVE'});
  assert.equal(text(out.render(row)),'设备'+expected);assert.equal(row.deviceName,raw);assert.equal(row.id,'session-1');assert.equal(row.status,'ACTIVE');
 });
}
test('actualC1table preserves custom names, near matches and historical aliases',()=>{
 for(const raw of ['My NexGrid Phone App','NexGrid Phone App custom','nexgrid Phone App','Nexion Phone App','NexGridPhoneApp','NexGrid Phone App ','Samsung SM-A5360','UVEL Phone App'])assert.equal(text(out.render(Object.freeze({deviceName:raw}))),'设备'+raw);
});
test('actualC1table retains missing value presentation',()=>{for(const raw of [null,undefined,''])assert.equal(text(out.render({deviceName:raw})),'设备-');});
