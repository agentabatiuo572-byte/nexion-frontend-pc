import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Design-only exporter. --freeze records an intentional design revision; ordinary checks never rewrite the manifest.
const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../..');
const htmlPath = path.join(directory, 'admin-r1-baseline.html');
const manifestPath = path.join(directory, 'admin-r1-baseline.json');
const evidence = path.join(directory, 'evidence/admin-r1-design/v4-purchase-interval');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = async file => hash(await readFile(file));
const sources = ['app/globals.css', 'app/components/domain-views/h-domain.css', 'app/components/shell/console-shell.tsx', 'app/components/shell/sidebar.tsx', 'lib/admin/registry/f.ts', 'app/components/domain-views/f-tabs/f1-vrank.tsx', 'docs/PRD/growth-promotions/PRODUCT-PRD.md', 'docs/PRD/growth-promotions/ADMIN-PRD.md', 'docs/PRD/growth-promotions/IMPLEMENTATION.md', 'docs/design/growth-promotions/assets/concept-admin-app.png', 'public/uvel-mark-dark.png', 'public/uvel-mark-light.png'];
const screens = ['ADM01', 'ADM02', 'ADM03', 'ADM04', 'ADM05', 'ADM06', 'ADM07', 'ADM08', 'ADM09'];
const states = ['normal', 'empty', 'loading', 'error', 'disabled', 'long'];
const themes = ['dark', 'light'];
const viewports = [{ width: 1440, height: 1000 }, { width: 1280, height: 1000 }];
const modalScenes = [['ADM02','templates'],['ADM04','rule'],['ADM04','rule-usdt'],['ADM04','rule-nex'],['ADM04','dual'],['ADM04','combination'],['ADM04','rights'],['ADM05','budget'],['ADM06','submit'],['ADM06','withdraw'],['ADM06','reject'],['ADM06','approve'],['ADM06','publish'],['ADM06','unknown'],['ADM07','pause'],['ADM07','resume'],['ADM07','end'],['ADM07','archive'],['ADM08','retry'],['ADM08','reconcile'],['ADM08','reversal'],['ADM08','cancel-reward'],['ADM08','reverse-reward'],['ADM08','adjudicate']];
const phaseScenes=[['ADM06','draft'],['ADM06','pending'],['ADM06','approved'],['ADM07','active'],['ADM07','paused'],['ADM07','ended'],['ADM07','archived']];
const failureScenes=[['ADM04','rule'],['ADM05','budget'],['ADM06','submit'],['ADM06','withdraw'],['ADM06','reject'],['ADM06','publish'],['ADM07','resume'],['ADM07','archive'],['ADM08','cancel-reward'],['ADM08','reverse-reward'],['ADM08','adjudicate']];
const tokenNames = ['--v5-bg','--v5-surface','--v5-surface-2','--v5-surface-3','--v5-border','--v5-border-strong','--v5-ink','--v5-ink-2','--v5-ink-3','--v5-ink-4','--v5-brand','--v5-on-brand','--v5-on-brand-2','--v5-success','--v5-success-soft','--v5-warning','--v5-warning-soft','--v5-danger','--v5-danger-soft','--admin-domain-h','--admin-blue','--admin-violet','--admin-teal','--admin-sidebar-w','--admin-topbar-h','--admin-gutter','--r-card','--font-display','--font-jet-mono','--font-v5'];
const designHash = await hashFile(htmlPath);
const checkerHash = await hashFile(fileURLToPath(import.meta.url));
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async file => [file, await hashFile(path.join(repo, file))])));
await mkdir(evidence, { recursive: true });
let playwright;
for (const moduleRoot of [process.env.PLAYWRIGHT_FROM, path.join(repo, 'package.json'), 'D:/WORKS/PLAN/admin-ops/package.json'].filter(Boolean)) {
  try { playwright = createRequire(moduleRoot)('playwright'); break; }
  catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
}
if (!playwright) throw new Error('Use an already installed Playwright; no dependency installation is authorized.');
const browser = await playwright.chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: viewports[0], deviceScaleFactor: 1, locale: 'zh-CN', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [], requests = [], checks = [], captures = [], ruleBindingChecks = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
const urlFor = (screen, state, theme, modal, extra={}) => {
  const url = pathToFileURL(htmlPath);
  url.search = new URLSearchParams({ screen, state, theme, export: '1', ...(modal ? { modal } : {}), ...extra });
  return url.href;
};
const open = async (screen, state, theme, modal, extra={}) => {
  await page.goto(urlFor(screen, state, theme, modal, extra));
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true');
  await page.evaluate(() => document.fonts.ready);
};
const computedTokens = async () => page.evaluate(names => Object.fromEntries(names.map(name => [name, getComputedStyle(document.documentElement).getPropertyValue(name).trim()])), tokenNames);
const geometry = async () => page.evaluate(() => {
  const box = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; };
  const dialog=document.querySelector('dialog'),dialogBody=document.getElementById('dialog-content');
  return { sidebar:box('.sidebar'), topbar:box('.topbar'), main:box('main'), document:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight}, viewport:{width:innerWidth,height:innerHeight}, scroll:{x:scrollX,y:scrollY}, modal:dialog.open?{box:box('dialog'),bodyScrollTop:dialogBody.scrollTop,bodyHeight:dialogBody.clientHeight,bodyScrollHeight:dialogBody.scrollHeight}:null, zoom:devicePixelRatio, bodyFont:getComputedStyle(document.body).fontFamily };
});
const assertBoard = async (screen, state, width) => {
  assert.equal(await page.locator('body').getAttribute('data-screen'), screen);
  assert.equal(await page.locator('body').getAttribute('data-state'), state);
  const box = await geometry();
  assert.equal(box.sidebar.width, 252, screen + ': source sidebar width');
  assert.equal(box.topbar.height, 56, screen + ': source topbar height');
  assert.equal(box.main.x, 252, screen + ': main origin');
  assert.equal(box.document.width, width, screen + ': no document horizontal overflow');
  const tableOverflow = await page.locator('.table-wrap').evaluateAll(nodes => nodes.filter(node => node.scrollWidth > node.clientWidth + 1).map(node => ({ scroll:node.scrollWidth,width:node.clientWidth })));
  assert.deepEqual(tableOverflow, [], screen + ': tables fit the supported desktop widths');
  if (state === 'loading') {
    assert.ok(await page.locator('[aria-busy=true]').count());
    assert.equal(await page.locator('.value').count(), 0, 'loading must not fake zero metrics');
  }
  if (state === 'error') assert.ok(await page.getByRole('button', {name:'重试读取样例', exact:true}).count());
  if (state === 'empty') assert.match(await page.locator('#board-content').innerText(), /未配置|还没有|尚未|暂无|没有匹配/);
  if (screen === 'ADM06' && state === 'disabled') assert.equal(await page.getByRole('button', {name:'发布确认样例',exact:true}).isDisabled(), true);
  if (screen === 'ADM07' && ['normal','long'].includes(state) && !['ended','archived'].includes(new URL(page.url()).searchParams.get('phase'))) {
    assert.match(await page.locator('#board-content').innerText(), /当前已发布 · v1/);
    assert.match(await page.locator('#board-content').innerText(), /改版候选 · v2/);
  }
  if (screen === 'ADM09' && ['normal','long'].includes(state)) assert.match(await page.locator('#board-content').innerText(), /曝光分母缺失/);
  return box;
};
const capture = async (name, data) => {
  const file = name + '.png';
  await page.screenshot({ path:path.join(evidence,file), fullPage:!data.modal, animations:'disabled' });
  captures.push({file,sha256:await hashFile(path.join(evidence,file)),url:page.url(),captureMode:data.modal?'viewport':'full-page',...data,geometry:await geometry()});
  if(data.modal&&await page.locator('#dialog-content').evaluate(el=>el.scrollHeight>el.clientHeight+1)){
    await page.locator('#dialog-content').evaluate(el=>el.scrollTop=el.scrollHeight);
    const bottomFile=name+'-bottom.png';
    await page.screenshot({path:path.join(evidence,bottomFile),fullPage:false,animations:'disabled'});
    captures.push({file:bottomFile,sha256:await hashFile(path.join(evidence,bottomFile)),url:page.url(),captureMode:'viewport-modal-bottom',...data,geometry:await geometry()});
    await page.locator('#dialog-content').evaluate(el=>el.scrollTop=0);
  }
};
try {
  const tokens = {};
  for (const theme of themes) { await open('ADM01','normal',theme); tokens[theme] = await computedTokens(); }
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const documentNode = await cdp.send('DOM.getDocument');
  const fonts = {};
  for (const selector of ['h1','.logo b','.stat .value','.pagehead p','tbody td']) {
    const {nodeId} = await cdp.send('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector});
    fonts[selector] = (await cdp.send('CSS.getPlatformFontsForNode',{nodeId})).fonts;
  }
  await cdp.detach();
  if (process.argv.includes('--freeze')) {
    const manifest = {
      schemaVersion:1, kind:'design-baseline-only', designVersion:'admin-r1-20261008-v4', frozenAt:new Date().toISOString(),
      sourceCommit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(), designFile:path.basename(htmlPath), designHash, checkerHash, sourceHashes,
      authority:'docs/PRD/growth-promotions/PRODUCT-PRD.md is the sole business contract. This fixture does not approve production policies.',
      designDecision:'Refine the existing concept and H4 V5 shell. Preserve H-domain orange, flat surfaces, real shell geometry and local font fallback. Never backfill this baseline from product runtime screenshots.',
      tokens, fonts:{declared:tokens.dark['--font-v5'],actualPlatformFonts:fonts,externalFonts:false},
      renderer:{browser:'Chromium',version:browser.version(),os:process.platform,viewportUnit:'CSS px',viewports,deviceScaleFactor:1,zoom:'100%',locale:'zh-CN',timezone:'Asia/Tokyo',reducedMotion:'reduce',scroll:'document x=0 y=0; normal boards full-page, modals viewport-only so native backdrop exactly covers the capture',network:'file-only; no HTTP preview or API calls'},
      coverage:{screens,states,themes,baseBoards:screens.length*states.length*themes.length*viewports.length,modalScenes,modalBoards:modalScenes.length*themes.length*viewports.length,phaseScenes,failureScenes,revisionFindings:['complete reward editor','budget inputs and field errors','state-bound lifecycle and evidence-bound recovery','disabled write controls','repurchase and rank conditions','actual row edit fixture binding','repurchase min/max uses the same valid purchase age fact; 30..90 example'],reducedTransparency:['ADM06/publish/dark/1440','ADM08/reconcile/dark/1280']},
      fixture:{id:'admin-r1-approved-test-only',asOf:'2026-10-07T03:00:00Z',activeVersion:1,draftVersion:2,activityId:'DEMO-PROMOTION-01',scope:'isolated synthetic design data, never production',approvedTestRefs:['TEST-APPROVED-R1-20261007','TEST-RIGHTS-DEVICE-01','TEST-ASSET-USDT-01','TEST-ASSET-NEX-01','TEST-RBAC-01'],amountExamples:{USDT:'20.000000',NEX:'1000.000000'},disabled:'missing policy references and RBAC mapping; publish disabled',assetImages:['public/uvel-mark-dark.png','public/uvel-mark-light.png'],productImagery:'No invented device photo used in PC tables. Product names are fixtures, not catalog assertions.'},
      states:{normal:'approved test fixture only',empty:'no matching facts or unconfigured draft; no fake zero',loading:'skeleton and busy semantics; repeated actions disabled',error:'read failure with preserved scope and original-command recovery specimen',disabled:'read-only capability or policy gap; actions disabled with visible reason',long:'long activity and public copy, large exact decimal amount; wraps rather than shrinks'},
      dimensions:{sidebar:252,topbar:56,gutter:22,cardRadius:16,inputRadius:8,buttonMinHeight:40,headingPx:23,headingWeight:600,bodyPx:13,tableBodyPx:12.5,cardPadding:'18px 20px 20px',spacing:'14px stats; 16px cards; 18/22px form grid'},
      limitations:['Only a fixed design HTML is exported, not product implementation.','No API, database, financial execution, business persistence, production approval or production deployment is verified.','No two independent product-vs-design pixel review has run.','PC board language is zh-CN; English and Vietnamese copy approvals remain product acceptance work.','Fonts use the existing local fallback chain; compare only after matching recorded actual platform fonts.','Existing V5/H source tokens are preserved; this exporter is not a WCAG certification.'],
      commands:{freeze:'node docs/design/growth-promotions/admin-r1-baseline-check.mjs --freeze',verify:'node docs/design/growth-promotions/admin-r1-baseline-check.mjs',export:'node docs/design/growth-promotions/admin-r1-baseline-check.mjs --export'},
      refreezeRule:'Any visual change must be an explicit design revision with a new hash and recaptured design boards before product comparison. Ordinary verification never changes frozen hashes.'
    };
    await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
    console.log('FROZEN '+designHash); 
  }
  const manifest = JSON.parse(await readFile(manifestPath,'utf8'));
  assert.equal(designHash,manifest.designHash,'design drift: record an intentional new design revision before export');
  assert.equal(checkerHash,manifest.checkerHash,'checker drift');
  assert.deepEqual(sourceHashes,manifest.sourceHashes,'contract/style/source drift');
  assert.deepEqual(tokens,manifest.tokens,'token drift');
  assert.deepEqual(fonts,manifest.fonts.actualPlatformFonts,'actual font drift');
  const exporting = process.argv.includes('--export');
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const theme of themes) for (const screen of screens) for (const state of states) {
      await open(screen,state,theme);
      const box = await assertBoard(screen,state,viewport.width);
      checks.push({screen,state,theme,viewport,result:'PASS',geometry:box});
      if(exporting) await capture(`${screen}-${state}-${theme}-${viewport.width}`,{screen,state,theme,viewport,modal:null});
    }
    for(const theme of themes) for(const [screen,modal] of modalScenes){
      await open(screen,'normal',theme,modal);
      assert.equal(await page.locator('dialog').isVisible(),true);
      assert.equal(await page.locator('dialog').evaluate(el=>el.contains(document.activeElement)),true,'modal focus');
      if(exporting) await capture(`${screen}-modal-${modal}-${theme}-${viewport.width}`,{screen,state:'normal',theme,viewport,modal});
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog').isVisible(),false);
    }
    for(const theme of themes)for(const [screen,phase]of phaseScenes){
      await open(screen,'normal',theme,null,{phase});await assertBoard(screen,'normal',viewport.width);
      if(exporting)await capture(`${screen}-phase-${phase}-${theme}-${viewport.width}`,{screen,state:'normal',theme,viewport,phase});
      const actions=page.locator('main button[data-modal]:enabled');
      for(let i=0;i<await actions.count();i++){await actions.nth(i).click();assert.equal(await page.locator('dialog').isVisible(),true);await page.keyboard.press('Escape');}
    }
    for(const theme of themes)for(const [screen,modal]of failureScenes){
      await open(screen,'normal',theme,modal,{modalState:'error'});
      assert.match(await page.locator('dialog').innerText(),/保留|未通过/);
      if(exporting)await capture(`${screen}-modal-${modal}-error-${theme}-${viewport.width}`,{screen,state:'normal',theme,viewport,modal,modalState:'error'});
    }
  }
  const expectedRules = [
    {key:'rule',sku:'StellarBox S1',quantity:'1',repeat:'每满一组发放',perOrder:'2',perPerson:'2',role:'buyer',type:'DEVICE',giftSku:'赠品设备 B',giftQuantity:'1',rights:'测试权益 01 · 已批准',displayReward:'设备赠礼 赠品设备 B × 1 · 测试权益'},
    {key:'rule-usdt',sku:'Orbit Hub',quantity:'1',repeat:'每满一组发放',perOrder:'2',perPerson:'2',role:'buyer',type:'USDT',amount:'20.000000',policy:'USDT 测试政策 01 · 已批准',displayReward:'USDT 奖励 20.000000 USDT · 测试政策'},
    {key:'rule-nex',sku:'Quantum Node',quantity:'1',repeat:'每满一组发放',perOrder:'1',perPerson:'1',role:'buyer',type:'NEX',amount:'1000.000000',policy:'NEX 测试政策 01 · 已批准',displayReward:'NEX 奖励 1,000.000000 NEX · 测试政策'}
  ];
  const readRuleForm = async () => {
    const value = label => page.locator('dialog').getByLabel(label,{exact:false}).inputValue();
    const role = await page.locator('dialog [data-beneficiary]').getAttribute('data-beneficiary');
    const type = await page.locator('dialog [data-reward-type]').inputValue();
    return {sku:await value('购买设备'),quantity:await value('每组购买数量'),repeat:await value('计奖方式'),perOrder:await value('每单最大计奖组数'),perPerson:await value('活动内每人最大计奖组数'),role,type,
      ...(type==='DEVICE'?{giftSku:await value('赠送设备'),giftQuantity:await value('每组赠送数量'),rights:await value('设备权益引用')}:{amount:await value('每组 '+type+' 奖励金额'),policy:await value(type+' 资产政策')})};
  };
  for(const viewport of viewports)for(const theme of themes){
    await page.setViewportSize(viewport);await open('ADM04','normal',theme);
    const rows=page.locator('main table').first().locator('tbody tr');
    assert.equal(await rows.count(),expectedRules.length,'all purchase-rule edit rows covered');
    for(const [index,expected]of expectedRules.entries()){
      const row=rows.nth(index),cells=await row.locator('td').allInnerTexts();
      const normalized=cells.map(cell=>cell.replace(/\s+/g,' ').trim());
      assert.deepEqual(normalized,[expected.sku+' 购买 '+expected.quantity+' 台为一组','每组发放','购买者',expected.displayReward,'每单 '+expected.perOrder+' 组 每人累计 '+expected.perPerson+' 组','编辑'],'table fixture '+expected.sku);
      await row.getByRole('button',{name:'编辑',exact:true}).click();
      assert.equal(await page.locator('dialog').getAttribute('data-modal-key'),expected.key);
      const {key,displayReward,...expectedForm}=expected,before=await readRuleForm();
      assert.deepEqual(before,expectedForm,'clicked rule form matches table: '+expected.sku);
      if(exporting)await capture(`ADM04-row-${key}-${theme}-${viewport.width}`,{screen:'ADM04',state:'normal',theme,viewport,modal:key,trigger:'actual table row edit',row:index});
      await page.getByRole('button',{name:'确认查看样例',exact:true}).click();
      assert.match(await page.locator('#modal-result').innerText(),/未写入/);
      assert.deepEqual(await readRuleForm(),before,'unchanged confirmation preserves every rule field');
      await page.getByRole('button',{name:'取消',exact:true}).click();
      assert.deepEqual(await row.locator('td').allInnerTexts(),cells,'confirmation leaves table unchanged');
      await row.getByRole('button',{name:'编辑',exact:true}).click();
      assert.deepEqual(await readRuleForm(),before,'reopening preserves rule identity and limits');
      await page.keyboard.press('Escape');
      ruleBindingChecks.push({key,theme,viewport,table:normalized,beforeConfirm:before,unchangedConfirm:'PASS',reopened:'PASS'});
    }
  }
  await open('ADM04','normal','dark','rule');
  for(const label of ['每组购买数量','计奖方式','每单最大计奖组数','活动内每人最大计奖组数','赠送设备','每组赠送数量','设备权益引用'])assert.equal(await page.getByLabel(label,{exact:false}).count(),1,'reward contract field: '+label);
  for(const [modal,asset]of [['rule-usdt','USDT'],['rule-nex','NEX']]){await open('ADM04','normal','dark',modal);assert.equal(await page.getByLabel('每组 '+asset+' 奖励金额',{exact:false}).count(),1);assert.equal(await page.getByLabel(asset+' 资产政策',{exact:false}).count(),1);}
  await open('ADM04','normal','dark','dual');
  assert.equal(await page.locator('[data-beneficiary]').count(),2);
  const inviter=page.locator('[data-beneficiary=inviter]');
  const inviterValue=await inviter.locator('[data-money]').inputValue();
  await page.locator('[data-reward-type=buyer]').selectOption('NEX');
  assert.match(await page.locator('[data-type-confirm=buyer]').innerText(),/清空原类型字段/);
  await page.locator('[data-confirm-type=buyer]').click();
  assert.equal(await page.locator('[data-beneficiary=buyer] [data-money]').inputValue(),'');
  assert.equal(await inviter.locator('[data-money]').inputValue(),inviterValue,'changing buyer never mutates inviter');
  await open('ADM04','normal','dark','combination');
  assert.equal(await page.getByLabel('购买设备 1',{exact:true}).count(),1);assert.equal(await page.getByLabel('购买设备 2',{exact:true}).count(),1);
  assert.equal(await page.getByLabel('最低数量 1',{exact:true}).inputValue(),'1');assert.equal(await page.getByLabel('最低数量 2',{exact:true}).inputValue(),'1');
  await open('ADM05','normal','dark','budget');
  for(const label of ['USDT 总预算','NEX 总预算','赠品设备 B 总额度（台）','赠品设备 C 总额度（台）'])assert.equal(await page.getByLabel(label,{exact:true}).count(),1);
  assert.match(await page.locator('dialog').innerText(),/已成交义务|已占用/);
  await open('ADM05','normal','dark','budget',{modalState:'error'});
  assert.equal(await page.getByLabel('USDT 总预算',{exact:true}).getAttribute('aria-invalid'),'true');
  await page.getByRole('button',{name:'确认查看样例',exact:true}).click();assert.match(await page.locator('#modal-result').innerText(),/修正/);
  assert.equal(await page.getByLabel('USDT 总预算',{exact:true}).inputValue(),'1000.000000','failed budget keeps input');
  await page.locator('dialog [data-modal=unknown]').click();assert.equal(await page.getByLabel('USDT 总预算',{exact:true}).inputValue(),'1000.000000','original-command lookup keeps budget input');assert.match(await page.locator('#modal-result').innerText(),/保持不变/);
  for(const key of ['cancel-reward','reverse-reward','adjudicate']){
    await open('ADM08','normal','dark',key);
    await page.getByLabel('操作理由',{exact:false}).fill('已核对原订单与关联处置依据');
    await page.getByRole('button',{name:'确认查看样例',exact:true}).click();assert.match(await page.locator('#modal-result').innerText(),/证据/);
    await page.locator('input[name=evidence]').first().check();
    await page.getByRole('button',{name:'确认查看样例',exact:true}).click();assert.match(await page.locator('#modal-result').innerText(),/未写入/);
    assert.equal(await page.locator('dialog [data-money]').count(),0,'disposition cannot change original amount');
  }
  await open('ADM08','normal','dark','reverse-reward',{modalState:'error'});const failureReason=await page.getByLabel('操作理由',{exact:false}).inputValue();await page.locator('dialog [data-modal=unknown]').click();assert.equal(await page.getByLabel('操作理由',{exact:false}).inputValue(),failureReason);assert.equal(await page.locator('input[name=evidence]:checked').count(),1,'failed disposition lookup preserves selected evidence');
  await open('ADM04','disabled','dark');
  const edits=page.getByRole('button',{name:'编辑',exact:true});assert.equal(await edits.count(),3);
  for(let i=0;i<await edits.count();i++){assert.equal(await edits.nth(i).isDisabled(),true);await edits.nth(i).click({force:true});assert.equal(await page.locator('dialog').isVisible(),false);}
  for(const modal of ['rule','rule-usdt','rule-nex','dual','combination','budget']){await open(modal==='budget'?'ADM05':'ADM04','disabled','dark',modal);assert.equal(await page.locator('#dialog-confirm').isDisabled(),true);assert.equal(await page.locator('dialog input:enabled,dialog select:enabled,dialog textarea:enabled').count(),0);}
  await open('ADM03','normal','dark');
  assert.equal(await page.locator('input[name=ranks]').count(),13);
  assert.equal(await page.getByLabel('最短购机间隔（天）',{exact:false}).inputValue(),'30');assert.equal(await page.getByLabel('最长购机间隔（天，可不设）',{exact:false}).inputValue(),'90');
  await page.locator('#rank-mode').selectOption('range');assert.equal(await page.locator('#rank-range').isVisible(),true);assert.equal(await page.locator('#rank-set').isVisible(),false);
  await page.getByLabel('最低等级',{exact:true}).selectOption({label:'V2'});await page.getByLabel('最高等级',{exact:true}).selectOption({label:'V5'});assert.match(await page.locator('#audience-validity').innerText(),/失效/);
  for(const [phase,expected]of [['draft','提交审核样例'],['pending','驳回样例'],['approved','发布确认样例']]){await open('ADM06','normal','dark',null,{phase});assert.equal(await page.getByRole('button',{name:expected,exact:true}).isEnabled(),true);}
  for(const [phase,modal]of [['active','pause'],['paused','resume'],['ended','archive']]){await open('ADM07','normal','dark',null,{phase});assert.equal(await page.locator('main button[data-modal="'+modal+'"]').isEnabled(),true);}
  for(const screen of screens){
    await open(screen,'normal','dark');
    const triggers=page.locator('main button[data-modal]:enabled');
    for(let index=0;index<await triggers.count();index++){
      await triggers.nth(index).click();
      assert.equal(await page.locator('dialog').isVisible(),true,screen+': every actual modal trigger opens');
      await page.keyboard.press('Escape');
    }
  }
  await page.setViewportSize(viewports[0]);
  await open('ADM06','normal','dark');
  await page.getByRole('button',{name:'发布确认样例',exact:true}).click();
  await page.getByRole('button',{name:'确认查看样例',exact:true}).click();
  assert.match(await page.locator('#modal-result').innerText(),/至少 8 字/);
  await page.locator('dialog textarea').fill('仅核对当前设计确认画面');
  await page.getByRole('button',{name:'确认查看样例',exact:true}).click();
  assert.match(await page.locator('#modal-result').innerText(),/未写入/);
  await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.activeElement.textContent),'发布确认样例');
  await page.reload();
  assert.equal(await page.locator('body').getAttribute('data-screen'),'ADM06','query-selected board survives reload');
  const storage = await page.evaluate(()=>({local:localStorage.length,session:sessionStorage.length}));
  assert.deepEqual(storage,{local:0,session:0},'design has no business persistence');
  const reduceSession=await context.newCDPSession(page);
  await reduceSession.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-reduced-motion',value:'reduce'}]});
  for(const [screen,modal,width] of [['ADM06','publish',1440],['ADM08','reconcile',1280]]){
    await page.setViewportSize({width,height:1000});await open(screen,'normal','dark',modal);
    assert.equal(await page.locator('dialog').evaluate(el=>getComputedStyle(el,'::backdrop').backdropFilter),'none');
    if(exporting)await capture(`${screen}-modal-${modal}-reduced-transparency-${width}`,{screen,state:'normal',theme:'dark',viewport:{width,height:1000},modal,reducedTransparency:true});
  }
  await reduceSession.detach();
  assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);
  assert.equal(await hashFile(htmlPath),designHash);assert.equal(await hashFile(fileURLToPath(import.meta.url)),checkerHash);
  const report={kind:'offline-design-render-verification',capability:'runtime',testedAt:new Date().toISOString(),designHash,checkerHash,browser:browser.version(),status:'PASS',boards:checks.length,modalBoards:modalScenes.length*themes.length*viewports.length,interactionChecks:['reason-required specimen','modal focus and Escape','focus returns to trigger','query board after reload','no storage writes','reduced transparency fallback','12 actual rule-row openings preserve SKU, role, reward, quantities, references and limits before and after unchanged confirmation'],pageErrors:errors,httpRequests:requests,checks,ruleBindingChecks,captures,limitations:manifest.limitations};
  await writeFile(path.join(evidence,exporting?'export-report.json':'check-report.json'),JSON.stringify(report,null,2)+'\n');
  const links=captures.map(c=>`<a href="${c.file}">${c.file}</a>`).join('\n');
  if(exporting)await writeFile(path.join(evidence,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PC R1 固定设计画板</title><style>body{font:14px/1.8 system-ui;max-width:1100px;margin:32px auto}a{display:block}code{overflow-wrap:anywhere}</style><h1>PC R1 设计基准</h1><p>仅设计导出；不证明产品、资产或独立像素验收。基准 hash：<code>${designHash}</code></p><p>${checks.length} 页态画板 + ${captures.length-checks.length} 弹窗/回退画板。</p>${links}</html>`);
  console.log(JSON.stringify({status:'PASS',designHash,boards:checks.length,captures:captures.length,pageErrors:errors.length,httpRequests:requests.length}));
}catch(error){
  await writeFile(path.join(evidence,'failure-report.json'),JSON.stringify({status:'FAIL',designHash,checkerHash,checkedBoards:checks.length,error:String(error),pageErrors:errors},null,2)+'\n');
  await page.screenshot({path:path.join(evidence,'failure.png'),fullPage:true}).catch(()=>{});
  throw error;
}finally{await browser.close();}
