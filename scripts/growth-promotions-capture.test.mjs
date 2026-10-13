import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {chromium} from '@playwright/test';
import {capturePromotionPage} from './growth-promotions-capture.mjs';
import {validatePromotionVisualBoards} from './growth-promotions-workflow-runtime.mjs';

test('native nested dialog capture follows the newly opened child and proves its internal bottom',async()=>{
  const dir=path.join(process.env.PROMOTION_EVIDENCE_DIR||'D:/CodexData/test-environments/workflow-runs/growth-promotions-20261007','pc-native-dialog-selftest',randomUUID());fs.mkdirSync(dir,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:1});
    page.on('request',request=>assert.equal(request.url(),'about:blank','Standalone experiment must not access a service'));
    await page.setContent('<!doctype html><meta charset="utf-8"><style>body{margin:0}main{height:944px;overflow:auto}dialog{padding:0;border:0;width:700px;height:500px}dialog.child{width:500px;height:350px}.dialog-body{height:300px;overflow:auto}.child .dialog-body{height:210px}</style><main><div style="height:2400px">Local capture-helper experiment only</div></main><dialog id="parent"><h2>Parent editor</h2><div class="dialog-body"><div style="height:2600px">Unsaved parent input</div></div><button id="open-child">Read rights details</button></dialog>');
    await page.evaluate(()=>{document.querySelector('#parent').showModal();document.querySelector('#open-child').onclick=()=>{const child=document.createElement('dialog');child.id='child';child.className='child';child.innerHTML='<h2>Read-only rights</h2><div class="dialog-body"><div style="height:950px">Actual child scroll content</div></div>';document.querySelector('#parent').append(child);child.showModal();};});
    await page.getByRole('button',{name:'Read rights details'}).click();
    const initial=await page.evaluate(()=>{const parent=document.querySelector('#parent .dialog-body'),child=document.querySelector('#child .dialog-body');return {parent:parent.scrollHeight,child:child.scrollHeight,childViewport:child.clientHeight};});
    assert(initial.parent>initial.child&&initial.child>initial.childViewport,'Experiment must expose the parent/child selection regression');
    const segments=await capturePromotionPage(page,path.join(dir,'local-experiment.png'));
    assert(segments.length>1);assert.equal(segments[0].geometry.dialog.width,500,'The smaller newly mounted child is the actual top layer');
    assert.equal(segments[0].geometry.dialogBody.scrollHeight,initial.child,'Selecting the larger parent would falsely prove the wrong dialog');
    const last=segments.at(-1).geometry.dialogBody;assert(last.scrollTop+last.clientHeight>=initial.child-1,'Child content must be captured through its actual bottom');
    assert(segments.some(segment=>segment.kind==='dialog'&&segment.geometry.dialogBody.scrollTop>0));
    const reset=await page.evaluate(()=>[...document.querySelectorAll('main,dialog[open] .dialog-body')].map(element=>element.scrollTop));assert(reset.every(offset=>offset===0),'Capture must restore both dialogs and main');
    const board={caseId:'ADM03-modal-rule-dark-1280',screen:'ADM03',theme:'dark',viewport:{width:1280,height:1000},dpr:1,file:segments[0].file,sha256:segments[0].sha256,clicks:[{action:'click',name:'Read rights details'}],segments};
    const proof={status:'captured-awaiting-independent-review',pageErrors:[],boards:[board]};validatePromotionVisualBoards(proof,[board.caseId]);
    const incomplete=structuredClone(proof);incomplete.boards[0].segments=incomplete.boards[0].segments.filter(segment=>segment.kind==='main');
    assert.throws(()=>validatePromotionVisualBoards(incomplete,[board.caseId]),/dialogBody bottom/,'A capture of only the child top must not pass');
    fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({kind:'standalone-native-dialog-experiment-not-product-evidence',status:'passed',initial,segments},null,2));
  }finally{await browser.close();}
});
