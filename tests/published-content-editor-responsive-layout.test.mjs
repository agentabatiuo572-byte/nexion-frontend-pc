import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chromium } from "playwright";

const css = await readFile(new URL("../app/components/domain-views/published-content-editor.module.css", import.meta.url), "utf8");

function fixture() {
  const section = (id, order) => `
    <section class="sectionCard">
      <div class="formGrid">
        <label class="field"><span>ID</span><input value="${id}"></label>
        <label class="field"><span>顺序</span><input value="${order}"></label>
      </div>
      <label class="field"><span>标题</span><input value="标题"></label>
      <label class="field"><span>正文</span><textarea rows="4">等级权益、票权和培育奖励以服务端结算与佣金事件为准。</textarea></label>
      <button class="button smallButton dangerButton sectionAction">删除段落</button>
    </section>`;
  return `<!doctype html>
    <style>
      :root {
        --surface: #111113; --surface-2: #18181b; --surface-3: #232329;
        --border: #29292f; --border-strong: #3b3b44; --ink: #f5f5f7;
        --ink-2: #d6d6dc; --ink-3: #9999a5; --ink-4: #72727e;
        --cyan: #a993ff; --cyan-soft: rgba(169,147,255,.14);
        --warning-soft: rgba(255,190,61,.12); --danger: #ff6b6b;
        --danger-soft: rgba(255,107,107,.12); --brand: #9edc1d;
        --brand-soft: rgba(158,220,29,.12); --brand-border: rgba(158,220,29,.35);
        --mono: monospace; --r-card: 14px;
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 24px; background: #09090a; font-family: sans-serif; }
      ${css}
    </style>
    <section class="editor">
      <header class="header">
        <div class="heading"><div class="title">Rank How-it-works 策略</div><div class="subtitle">结构化规则说明将由 App remote 读取</div></div>
        <div class="headerActions"><span class="status">PUBLISHED · rev 1</span><button class="button smallButton">刷新</button></div>
      </header>
      <div class="body">
        <div class="formGrid">
          <label class="field"><span>版本</span><input value="2026.08.22"></label>
          <label class="field"><span>状态</span><select><option>PUBLISHED</option></select></label>
        </div>
        <div class="localeToolbar">
          <label class="field"><span>当前 Locale</span><select><option>zh</option></select></label>
          <label class="field"><span>新增 Locale</span><input placeholder="例如 vi、zh-cn"></label>
          <button class="button smallButton">新增 Locale</button>
          <button class="button smallButton dangerButton">删除当前 Locale</button>
        </div>
        <div class="localeEditor">
          <label class="field"><span>页面主说明</span><textarea rows="3">V-Rank 由真实购买、有效直推、团队业绩和页面说明下级等级共同决定。</textarea></label>
          <div class="sectionHeading">规则段落</div>
          <div class="sectionGrid">${section("promotion", 1)}${section("rewards", 2)}</div>
          <button class="button smallButton addAction">新增段落</button>
        </div>
        <details class="preview"><summary>变更预览（只读）</summary></details>
        <div class="footer"><label class="field"><span>变更理由（必填，8–500 字）</span><input></label><button class="button primaryButton">保存并回读</button></div>
      </div>
    </section>`;
}

async function measure(page, width) {
  await page.setViewportSize({ width, height: 1200 });
  await page.setContent(fixture());
  return page.evaluate(() => {
    const editor = document.querySelector(".editor");
    const sectionGrid = document.querySelector(".sectionGrid");
    const formGrid = document.querySelector(".formGrid");
    const input = document.querySelector(".sectionCard input");
    return {
      sectionTracks: getComputedStyle(sectionGrid).gridTemplateColumns.split(" ").filter(Boolean).length,
      formTracks: getComputedStyle(formGrid).gridTemplateColumns.split(" ").filter(Boolean).length,
      inputWidth: input.getBoundingClientRect().width,
      inputBorder: getComputedStyle(input).borderTopWidth,
      overflow: editor.scrollWidth - editor.clientWidth,
      height: editor.getBoundingClientRect().height,
    };
  });
}

test("rank policy editor is a compact two-column card on a wide F1 page", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const layout = await measure(page, 1400);
    assert.equal(layout.sectionTracks, 2);
    assert.equal(layout.formTracks, 2);
    assert.ok(layout.inputWidth >= 240, `section input width was ${layout.inputWidth}px`);
    assert.notEqual(layout.inputBorder, "0px");
    assert.ok(layout.overflow <= 1, `editor overflowed by ${layout.overflow}px`);
    assert.ok(layout.height < 950, `expanded editor height was ${layout.height}px`);
  } finally {
    await browser.close();
  }
});

test("rank policy editor stacks without horizontal overflow on a narrow page", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const layout = await measure(page, 600);
    assert.equal(layout.sectionTracks, 1);
    assert.equal(layout.formTracks, 1);
    assert.ok(layout.inputWidth >= 200, `section input width was ${layout.inputWidth}px`);
    assert.ok(layout.overflow <= 1, `editor overflowed by ${layout.overflow}px`);
  } finally {
    await browser.close();
  }
});
