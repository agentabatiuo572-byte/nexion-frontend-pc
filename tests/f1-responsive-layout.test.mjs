import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/components/domain-views/f-domain.css", import.meta.url), "utf8");

function fixture(width) {
  return `<!doctype html>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; }
      .fdom { width: ${width}px; }
      ${css}
    </style>
    <main class="fdom">
      <div class="f1-layout-shell">
        <div class="f1-main">
          <section class="ladder">
            <div class="lrow">
              <div class="vbadge">V1</div>
              <div class="lcell"><div class="l1">Starter</div><div class="l2">注册会员 · 网络 1 层 · 同级奖 0%</div></div>
              <div class="rwd-list"><button class="rwd-add">+ 加奖励</button></div>
              <div class="pop"><span class="bar"><span class="f"></span></span><span class="ct">123</span></div>
              <div class="lact"><button>自买额 $500</button><button>直推 3</button></div>
            </div>
          </section>
          <aside class="rcard">人口金字塔</aside>
        </div>
      </div>
    </main>`;
}

async function measure(page, width) {
  await page.setContent(fixture(width));
  return page.evaluate(() => {
    const main = document.querySelector(".f1-main");
    const ladder = document.querySelector(".ladder");
    const row = document.querySelector(".lrow");
    const label = document.querySelector(".lcell .l2");
    const aside = document.querySelector(".rcard");
    const mainStyle = getComputedStyle(main);
    const labelStyle = getComputedStyle(label);
    const mainRect = main.getBoundingClientRect();
    const ladderRect = ladder.getBoundingClientRect();
    const asideRect = aside.getBoundingClientRect();
    return {
      gridTracks: mainStyle.gridTemplateColumns.split(" ").filter(Boolean).length,
      ladderWidth: ladderRect.width,
      labelWidth: label.getBoundingClientRect().width,
      writingMode: labelStyle.writingMode,
      asideBelow: asideRect.top >= ladderRect.bottom - 1,
      rowOverflow: row.scrollWidth - row.clientWidth,
      mainOverflow: main.scrollWidth - Math.ceil(mainRect.width),
    };
  });
}

test("F1 stacks the side panel before the ladder text collapses at common admin widths", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    const layout = await measure(page, 1000);
    assert.equal(layout.gridTracks, 1);
    assert.equal(layout.asideBelow, true);
    assert.ok(layout.ladderWidth >= 990, `ladder width was ${layout.ladderWidth}px`);
    assert.ok(layout.labelWidth >= 150, `label width was ${layout.labelWidth}px`);
    assert.equal(layout.writingMode, "horizontal-tb");
    assert.ok(layout.rowOverflow <= 1, `row overflowed by ${layout.rowOverflow}px`);
    assert.ok(layout.mainOverflow <= 1, `main overflowed by ${layout.mainOverflow}px`);
  } finally {
    await browser.close();
  }
});

test("F1 converts each rank into a compact multi-row card in a narrow content column", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    const layout = await measure(page, 760);
    assert.equal(layout.gridTracks, 1);
    assert.equal(layout.asideBelow, true);
    assert.ok(layout.labelWidth >= 420, `label width was ${layout.labelWidth}px`);
    assert.equal(layout.writingMode, "horizontal-tb");
    assert.ok(layout.rowOverflow <= 1, `row overflowed by ${layout.rowOverflow}px`);
    assert.ok(layout.mainOverflow <= 1, `main overflowed by ${layout.mainOverflow}px`);
  } finally {
    await browser.close();
  }
});

test("F1 keeps the information rail beside the ladder when the content area is genuinely wide", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  try {
    const layout = await measure(page, 1300);
    assert.equal(layout.gridTracks, 2);
    assert.equal(layout.asideBelow, false);
    assert.ok(layout.ladderWidth >= 950, `ladder width was ${layout.ladderWidth}px`);
    assert.ok(layout.rowOverflow <= 1, `row overflowed by ${layout.rowOverflow}px`);
    assert.ok(layout.mainOverflow <= 1, `main overflowed by ${layout.mainOverflow}px`);
  } finally {
    await browser.close();
  }
});

test("F1 remains horizontal and overflow-free in its smallest supported content card", async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
  try {
    const layout = await measure(page, 580);
    assert.equal(layout.gridTracks, 1);
    assert.equal(layout.asideBelow, true);
    assert.ok(layout.labelWidth >= 430, `label width was ${layout.labelWidth}px`);
    assert.equal(layout.writingMode, "horizontal-tb");
    assert.ok(layout.rowOverflow <= 1, `row overflowed by ${layout.rowOverflow}px`);
    assert.ok(layout.mainOverflow <= 1, `main overflowed by ${layout.mainOverflow}px`);
  } finally {
    await browser.close();
  }
});
