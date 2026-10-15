import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const files=['growth-promotions-runtime.mjs','growth-promotions-runtime-cases.mjs','growth-promotions-visual.mjs'];
const read=file=>fs.readFileSync(new URL(file,import.meta.url),'utf8');
const runtime=ts.createSourceFile(files[0],read(files[0]),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=runtime.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='command');
assert(declaration);

function command({disabled=false,clickError,responseError}={}){
  let rejectWait,waits=0,clicks=0;
  const reply={status:()=>200,json:async()=>({code:0,data:{status:'SUCCEEDED'}})};
  const dialog={getByRole:()=>({disabled})};
  const page={getByRole:()=>dialog,waitForResponse:(_predicate,options)=>{
    assert.equal(options.timeout,45000);waits++;
    if(responseError)return Promise.reject(responseError);
    if(clickError)return new Promise((_resolve,reject)=>{rejectWait=reject;});
    return Promise.resolve(reply);
  }};
  const expect=target=>({toBeVisible:async()=>{},toHaveCount:async()=>{},toBeEnabled:async()=>{if(target.disabled)throw Error('DISABLED_OR_DEPENDENCY_NOT_READY');}});
  const click=async()=>{clicks++;if(clickError)throw clickError;};
  const run=new Function('page','expect','fill','click','assert',declaration.getText(runtime)+';return command;')(page,expect,async()=>{},click,assert);
  return {run,closed:()=>rejectWait?.(Error('Target page closed')),counts:()=>({waits,clicks})};
}

test('disabled commands report the first gate failure without starting a response wait',async()=>{
  const action=command({disabled:true});await assert.rejects(action.run('创建'),/DISABLED_OR_DEPENDENCY_NOT_READY/);assert.deepEqual(action.counts(),{waits:0,clicks:0});
});
test('click failure is retained and later browser closure cannot create an unhandled response rejection',async()=>{
  const first=Error('CLICK_FAILED'),action=command({clickError:first}),unhandled=[];
  const observe=error=>unhandled.push(error);process.on('unhandledRejection',observe);
  try{await assert.rejects(action.run('创建'),error=>error===first);action.closed();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(unhandled,[]);assert.deepEqual(action.counts(),{waits:1,clicks:1});}
  finally{process.off('unhandledRejection',observe);}
});
test('response failure propagates and successful commands retain the original result checks',async()=>{
  const first=Error('RESPONSE_TIMEOUT'),failed=command({responseError:first});await assert.rejects(failed.run('创建'),error=>error===first);
  const successful=command();assert.deepEqual(await successful.run('创建'),{status:'SUCCEEDED'});assert.deepEqual(successful.counts(),{waits:1,clicks:1});
});
test('every promotion response wait is jointly owned with its triggering click',()=>{
  let count=0;
  for(const file of files){
    const source=read(file),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=node=>{
      if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='waitForResponse'){
        count++;const after=source.slice(node.end);assert.match(after,/^\s*;\s*const\s+\[[\w]+\]\s*=\s*await Promise\.all\(/,file+' must handle both pending operations before another await');
      }
      ts.forEachChild(node,visit);
    };visit(ast);
  }
  assert.equal(count,9);
});
