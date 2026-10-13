export async function runInteractionChecks({page,open,assert,interactions,manifest}){
  const identity=()=>page.evaluate(()=>window.designBaseline);
  const noPayment=async()=>{
    assert.equal(await page.locator('[data-action=payment],[data-action=cancel]').count(),0);
    assert.equal(await page.locator('main [data-order-mode=unknown]').count(),1);
  };
  // R1: Each reward retains its own receipt, status and original order.
  for(const type of ['device','usdt','nex']){
    await open('rewards');
    await page.locator('[data-reward-type='+type+']').click();
    await page.waitForURL(/screen=reward-detail/);
    const expected=manifest.fixtures.rewardRecords[type],detail=page.locator('[data-detail-type='+type+']');
    assert.equal(await detail.getAttribute('data-detail-status'),expected.status);
    assert.equal(await detail.getAttribute('data-source-order'),expected.order);
    assert.equal(await page.locator('[data-asset-target]').getAttribute('data-asset-target'),expected.asset);
    assert.equal(await page.locator('[data-asset-target]').isDisabled(),!expected.receipt);
    assert.equal(await page.locator('[data-receipt]').count(),expected.receipt?1:0);
    await page.locator('[data-target=order-paid]').click();await page.waitForURL(/screen=order-paid/);
    assert.equal((await identity()).orderNo,expected.order);
  }
  interactions.push({id:'R1-selected-device-usdt-nex-reward-detail-source-and-asset',pass:true});
  // Every order retains its complete item snapshot through every reward link.
  for(const selection of ['bundle','pro','s1','nex']){
    for(const screen of ['order','order-confirmed','order-unknown','order-paid','order-refund']){
      if(screen==='order-confirmed'){
        await open('payment-unknown','normal','zh','dark',390,{selection,queryResult:'unpaid'});
        await page.locator('[data-action=query]').click();
        await page.waitForURL(/screen=order-confirmed/);
      }else await open(screen,'normal','zh','dark',390,{selection});
      const before=await identity();
      const purchases=await page.locator('[data-purchase-line]').allTextContents();
      const amounts=await page.locator('.summary-line.total').allTextContents();
      const rewards=await page.locator('[data-reward-type]').count();
      for(let index=0;index<rewards;index++){
        await page.locator('[data-reward-type]').nth(index).click();
        await page.waitForURL(/screen=reward-detail/);
        await page.locator('main [data-target^=order]').click();
        await page.waitForURL(url=>url.searchParams.get('screen')===screen);
        const after=await identity();
        assert.equal(after.selection,before.selection);
        assert.equal(after.orderNo,before.orderNo);
        assert.equal(after.orderMode,before.orderMode);
        assert.deepEqual(await page.locator('[data-purchase-line]').allTextContents(),purchases);
        assert.deepEqual(await page.locator('.summary-line.total').allTextContents(),amounts);
      }
    }
  }
  for(const locale of ['zh','en','vi']){
    await open('checkout','normal',locale,'dark',390,{selection:'nex'});
    assert.match(await page.locator('main').textContent(),/5[,.]000[,.]00 USDT/);
  }
  interactions.push({id:'R1-all-order-item-snapshots-roundtrip-and-localized-balance',pass:true});
  // R1: NEX uses the existing store/checkout/original-order specimen.
  await open('store');await page.locator('[data-product=nex] [data-target=checkout]').click();await page.waitForURL(/screen=checkout/);
  assert.equal((await identity()).selection,'nex');
  assert.equal(await page.locator('[data-purchase-line]').count(),1);
  assert.equal(await page.locator('[data-reward-type=nex]').count(),1);
  assert.ok((await page.locator('.summary-line.total').textContent()).includes('2,499.00 USDT'));
  await page.locator('[data-action=payment]').click();await page.waitForURL(/screen=payment-unknown/);
  assert.equal((await identity()).orderNo,'DESIGN-ORDER-004');
  await page.locator('[data-target=order-unknown]').click();await page.waitForURL(/screen=order-unknown/);
  await noPayment();assert.equal(await page.locator('[data-reward-type=nex]').count(),1);
  interactions.push({id:'R1-nex-store-checkout-original-order',pass:true});
  // R2: Neither a link, query, reload nor return to Store silently clears unknown.
  await open('payment-unknown');
  const unknownNo=(await identity()).orderNo;
  await page.locator('[data-target=order-unknown]').click();await page.waitForURL(/screen=order-unknown/);await noPayment();
  await page.locator('[data-action=query]').click();await noPayment();
  assert.equal((await identity()).orderNo,unknownNo);await page.reload();await noPayment();
  await page.locator('header [data-action=back]').click();await page.waitForURL(/screen=store/);
  await page.locator('.product-card [data-target=checkout]').first().click();await page.waitForURL(/screen=order-unknown/);await noPayment();
  assert.equal((await identity()).orderNo,unknownNo);
  await open('payment-unknown','normal','zh','dark',390,{queryResult:'unpaid'});
  assert.equal(await page.locator('[data-action=payment]').count(),0);
  await page.locator('[data-action=query]').click();await page.waitForURL(/screen=order-confirmed/);
  assert.equal((await identity()).orderNo,unknownNo);
  assert.equal(await page.locator('[data-query-confirmed]').count(),1);
  assert.equal(await page.locator('[data-action=payment]').isEnabled(),true);
  interactions.push({id:'R2-unknown-original-order-query-only-until-explicit-confirmation',pass:true});
  // R3: Continue does not turn an existing order into a draft or reset the prompt.
  await open('leave-reserved');
  assert.equal(await page.locator('.modal [data-deadline=payBy]').count(),1);
  const original=(await identity()).orderNo;
  await page.locator('[data-action=stay]').click();
  assert.equal(await page.locator('main [data-order-mode=reserved]').count(),1);
  assert.equal(await page.locator('main [data-deadline=payBy]').count(),1);
  await page.locator('header [data-action=leave]').click();await page.waitForURL(/screen=store/);
  assert.equal(await page.locator('[role=dialog]').count(),0);
  await page.locator('[data-target=checkout]').first().click();await page.waitForURL(/screen=checkout/);
  assert.equal((await identity()).orderNo,original);assert.equal((await identity()).orderMode,'reserved');
  assert.equal(await page.locator('main [data-deadline=payBy]').count(),1);
  assert.equal(await page.locator('main [data-deadline=endsAt]').count(),0);
  await page.reload();await page.locator('header [data-action=leave]').click();await page.waitForURL(/screen=store/);
  await open('checkout');const trigger=page.locator('[data-action=leave]').last();await trigger.click();await page.locator('[role=dialog]').waitFor();
  await page.keyboard.press('Tab');assert.equal(await page.locator('[data-action=exit]').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Tab');assert.equal(await page.locator('[data-action=stay]').evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');assert.equal(await trigger.evaluate(el=>el===document.activeElement),true);
  await trigger.click();await page.waitForURL(/screen=store/);
  await open('checkout');await page.locator('[data-action=leave]').last().click();
  await page.locator('.modal-backdrop').click({position:{x:2,y:2}});
  await page.locator('[data-action=leave]').last().click();await page.waitForURL(/screen=store/);
  interactions.push({id:'R3-single-leave-prompt-scope-reserved-payby-focus-and-reload',pass:true});
  // R4: Named sample terms are visible; absence blocks every purchase surface.
  for(const selection of ['pro','s1','nex']){
    await open('rules','normal','zh','dark',390,{selection});
    const required=selection==='pro'?manifest.fixtures.entitlements.deviceRequired:manifest.fixtures.entitlements.fundsRequired;
    for(const field of required)assert.equal(await page.locator('[data-entitlement='+field+']').count(),1);
    assert.equal(await page.locator('[data-terms-disclosure]').count(),1);
  }
  for(const screen of ['checkout','bundle','detail','order']){
    await open(screen,'normal','zh','dark',390,{terms:'missing',selection:'nex'});
    assert.ok(await page.locator('[data-missing-terms]').count());
    const confirms=page.locator('[data-action=payment],[data-action=detail-buy]');
    assert.equal(await confirms.count(),1);assert.equal(await confirms.isDisabled(),true);
  }
  interactions.push({id:'R4-named-design-only-device-funds-terms-missing-blocks-confirmation',pass:true});
  // R5: Return from terms restores the actual source and scroll, including selection.
  await open('checkout','normal','zh','dark',390,{selection:'nex'});
  const rules=page.locator('[data-target=rules]').first();await rules.scrollIntoViewIfNeeded();
  const scroll=await page.locator('main').evaluate(el=>el.scrollTop);
  await rules.click();await page.waitForURL(/screen=rules/);
  await page.locator('header [data-action=back]').click();await page.waitForURL(/screen=checkout/);
  await page.waitForFunction(expected=>Math.abs(document.querySelector('main').scrollTop-expected)<2,scroll);
  assert.equal((await identity()).selection,'nex');assert.equal(await page.locator('[data-reward-type=nex]').count(),1);
  interactions.push({id:'R5-rule-roundtrip-restores-checkout-selection-and-scroll',pass:true});
  // R6: Editing invalidates all prior money/rewards and cannot be undone by navigation.
  await open('bundle');const first=page.locator('.stepper').first();
  assert.equal(await first.locator('[data-action=minus]').isDisabled(),true);
  await first.locator('[data-action=plus]').click();
  assert.equal(await first.locator('output').textContent(),'2');
  assert.equal(await page.locator('[data-action=payment]').isDisabled(),true);
  assert.equal(await page.locator('[data-quote-stale]').count(),1);
  assert.ok((await page.locator('[data-quoted-line]').first().textContent()).includes('—'));
  assert.equal(await page.locator('[data-reward-line]:visible').count(),0);
  await page.locator('[data-target=rules]').click();await page.waitForURL(/screen=rules/);
  await page.locator('header [data-action=back]').click();await page.waitForURL(/screen=bundle/);
  assert.equal(await page.locator('.stepper output').first().textContent(),'2');
  assert.equal(await page.locator('[data-action=payment]').isDisabled(),true);
  for(let n=0;n<6;n++)await page.locator('.stepper').first().locator('[data-action=plus]').click();
  assert.equal(await page.locator('.stepper').first().locator('[data-action=plus]').isDisabled(),true);
  for(let n=0;n<7;n++)await page.locator('.stepper').first().locator('[data-action=minus]').click();
  assert.equal(await page.locator('.stepper output').first().textContent(),'1');
  assert.equal(await page.locator('[data-action=payment]').isDisabled(),true);
  interactions.push({id:'R6-quantity-invalidates-quote-and-remains-stale-after-navigation',pass:true});
  for(const screen of ['rewards','reward-detail','invite']){
    await open(screen);assert.equal(await page.locator('[data-action=claim],[data-action=resend],[data-action=payment]').count(),0);
  }
  interactions.push({id:'rewards-remain-read-only',pass:true});
  for(const screen of ['order-paid','order-refund']){
    await open(screen);assert.equal(await page.locator('[data-action=payment],[data-action=cancel]').count(),0);assert.equal(await page.locator('[data-reward-line]').count(),2);
  }
  interactions.push({id:'paid-refunded-order-retain-independent-reward-statuses',pass:true});
}
