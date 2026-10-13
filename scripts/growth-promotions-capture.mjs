import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const hash=value=>createHash('sha256').update(value).digest('hex');
export function readBackendSource(external){
  const file=path.join(external,'services.json');
  const raw=fs.readFileSync(file),service=JSON.parse(raw);
  assert.equal(service.backendPort,8139,'Expected isolated backend port');
  assert.ok(service.runtimeClasses&&fs.existsSync(service.runtimeClasses),'Runtime classes must exist');
  return {backend:'http://127.0.0.1:8139',backendClasses:service.runtimeClasses,backendLauncherPid:service.backendLauncherPid,serviceSource:file,serviceSourceHash:hash(raw)};
}

/** Preserve the actual viewport/layout. Each image is a native browser frame, never a stitch. */
export async function capturePromotionPage(page,file){
  await page.evaluate(()=>document.fonts.ready);
  await page.evaluate(()=>{window.scrollTo(0,0);for(const element of document.querySelectorAll('main,dialog[open] .dialog-body'))element.scrollTop=0;});
  const geometry=()=>page.evaluate(()=>{const main=document.querySelector('main'),dialog=[...document.querySelectorAll('dialog[open]')].at(-1),body=dialog?.querySelector('.dialog-body');const box=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};const scrollBox=e=>e?{...box(e),scrollTop:e.scrollTop,scrollHeight:e.scrollHeight,clientHeight:e.clientHeight}:null;return {main:scrollBox(main),dialog:box(dialog),dialogBody:scrollBox(body),document:{height:document.documentElement.scrollHeight,width:document.documentElement.scrollWidth},viewport:{width:innerWidth,height:innerHeight}};});
  const first=await geometry(),main=first.main;
  if(first.dialog){assert.ok(Math.abs(first.dialog.x-(first.viewport.width-first.dialog.width)/2)<=1,'Dialog must be horizontally centered');assert.ok(Math.abs(first.dialog.y-(first.viewport.height-first.dialog.height)/2)<=1,'Dialog must be vertically centered');}
  const max=main?Math.max(0,main.scrollHeight-main.clientHeight):0,offsets=[0];
  if(max)for(let offset=Math.max(1,main.clientHeight-80);offset<max;offset+=Math.max(1,main.clientHeight-80))offsets.push(offset);
  if(max)offsets.push(max);
  const segments=[];
  for(let index=0;index<offsets.length;index++){
    await page.evaluate(offset=>{const main=document.querySelector('main');if(main)main.scrollTop=offset;},offsets[index]);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const output=index===0?file:file.replace(/\.png$/,`-main-${index}.png`);
    const actual=await geometry();
    await page.screenshot({path:output,fullPage:true,animations:'disabled'});
    segments.push({kind:'main',file:output,sha256:hash(fs.readFileSync(output)),geometry:actual});
  }
  if(main){
    const last=segments.at(-1).geometry.main;
    assert.equal(last.scrollHeight,main.scrollHeight,'Content changed during internal scroll capture');
    assert.ok(last.scrollTop+last.clientHeight>=last.scrollHeight-1,'Internal MAIN bottom not captured');
    for(let n=1;n<segments.length;n++)assert.ok(segments[n].geometry.main.scrollTop<=segments[n-1].geometry.main.scrollTop+main.clientHeight,'Internal MAIN coverage gap');
  }
  const body=first.dialogBody;
  if(body&&body.scrollHeight>body.clientHeight){
    const max=body.scrollHeight-body.clientHeight,offsets=[];
    for(let offset=Math.max(1,body.clientHeight-80);offset<max;offset+=Math.max(1,body.clientHeight-80))offsets.push(offset);
    offsets.push(max);
    for(const [index,offset]of offsets.entries()){
      await page.evaluate(value=>{[...document.querySelectorAll('dialog[open]')].at(-1).querySelector('.dialog-body').scrollTop=value;},offset);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const output=file.replace(/\.png$/,`-dialog-${index+1}.png`),actual=await geometry();
      await page.screenshot({path:output,fullPage:true,animations:'disabled'});
      segments.push({kind:'dialog',file:output,sha256:hash(fs.readFileSync(output)),geometry:actual});
    }
    const last=segments.at(-1).geometry.dialogBody;assert.equal(last.scrollHeight,body.scrollHeight);assert.ok(last.scrollTop+last.clientHeight>=last.scrollHeight-1,'Dialog bottom not captured');
  }
  await page.evaluate(()=>{for(const element of document.querySelectorAll('main,dialog[open] .dialog-body'))element.scrollTop=0;});
  return segments;
}
