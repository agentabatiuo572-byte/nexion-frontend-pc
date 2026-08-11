import fs from "node:fs";
import path from "node:path";

import {
  evaluateModuleHealthSnapshot,
  isUnmarkedBusinessErrorText,
} from "../tests/e2e/pc-module-health-contract.mjs";

export async function createInAppAcceptanceRunner({
  tab,
  items,
  evidenceDir,
  buildId,
  runId,
}) {
  activeItems = items;
  fs.mkdirSync(evidenceDir, { recursive: true });
  const journalPath = path.join(evidenceDir, "journal-live.json");
  const previous = readPreviousJournal(journalPath, buildId);
  let results = previous?.results ?? [];
  const seenConsoleKeys = new Set();

  for (const log of await tab.dev.logs({ levels: ["error"], limit: 1_000 })) {
    seenConsoleKeys.add(consoleKey(log));
  }

  async function runBatch(batchItems) {
    const batch = [];
    for (const item of batchItems) {
      const row = {
        code: item.code,
        href: item.href,
        label: item.text,
        buildId,
        startedAt: new Date().toISOString(),
        entryMethod: "visible-sidebar",
      };
      try {
        await openFromVisibleSidebar(tab, item);
        row.first = await captureStep(tab, item, "first", evidenceDir, seenConsoleKeys);

        await tab.reload();
        row.reload = await captureStep(tab, item, "reload", evidenceDir, seenConsoleKeys);

        const itemIndex = items.findIndex((candidate) => candidate.code === item.code);
        const nextItem = items[(itemIndex + 1) % items.length];
        await openFromVisibleSidebar(tab, nextItem);
        await waitForHealthyPage(tab, nextItem);
        await tab.back();
        row.back = await captureStep(tab, item, "back", evidenceDir, seenConsoleKeys);

        row.healthy = row.first.healthy && row.reload.healthy && row.back.healthy;
      } catch (error) {
        row.failure = String(error?.message ?? error);
        row.healthy = false;
      }
      row.completedAt = new Date().toISOString();
      results = results.filter((candidate) => candidate.code !== item.code);
      results.push(row);
      results.sort(
        (left, right) =>
          items.findIndex((candidate) => candidate.code === left.code)
          - items.findIndex((candidate) => candidate.code === right.code),
      );
      writeJournal(journalPath, { runId, buildId, results });
      batch.push(row);
    }
    return batch;
  }

  return {
    runBatch,
    summary() {
      return {
        buildId,
        count: results.length,
        healthy: results.filter((row) => row.healthy).length,
        failures: results
          .filter((row) => !row.healthy)
          .map((row) => ({ code: row.code, failure: row.failure, steps: stepFailures(row) })),
      };
    },
  };
}

async function captureStep(tab, item, step, evidenceDir, seenConsoleKeys) {
  const state = await waitForHealthyPage(tab, item);
  const consoleErrors = await collectNewConsoleErrors(tab, seenConsoleKeys);
  const failures = healthFailures(item.code, state, consoleErrors);
  const screenshot = path.join(evidenceDir, `${item.code}-${step}.png`);
  fs.writeFileSync(screenshot, await tab.screenshot({ fullPage: false }));
  return {
    state,
    consoleErrors,
    failures,
    healthy: failures.length === 0,
    screenshot,
  };
}

async function openFromVisibleSidebar(tab, item) {
  const domainIndex = item.code.charCodeAt(0) - "A".charCodeAt(0);
  const sidebar = tab.playwright.getByRole("complementary");
  const domainButton = sidebar.getByRole("button").nth(domainIndex);
  await domainButton.waitFor({ state: "visible", timeoutMs: 10_000 });
  if (await domainButton.getAttribute("aria-expanded") !== "true") {
    await domainButton.click({ timeoutMs: 10_000 });
  }
  const link = sidebar.locator(`a[href="${item.href}"]`).first();
  await link.waitFor({ state: "visible", timeoutMs: 10_000 });
  await tab.playwright.waitForTimeout(250);
  await link.click({ timeoutMs: 10_000 });
  await tab.playwright.waitForTimeout(350);
  if (await tab.url() !== `http://localhost:3002${item.href}`) {
    const freshLink = sidebar.locator(`a[href="${item.href}"]`).first();
    await freshLink.waitFor({ state: "visible", timeoutMs: 10_000 });
    await freshLink.click({ timeoutMs: 10_000 });
  }
  await tab.playwright.waitForURL(`http://localhost:3002${item.href}`, { timeoutMs: 12_000 });
}

async function waitForHealthyPage(tab, item) {
  await tab.playwright.waitForURL(`http://localhost:3002${item.href}`, { timeoutMs: 20_000 });
  await tab.playwright.locator("main h1").first().waitFor({ state: "visible", timeoutMs: 20_000 });
  await tab.playwright.waitForTimeout(750);

  let lastState;
  let lastSignature = "";
  let consecutiveHealthy = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await tab.playwright.waitForTimeout(250);
    lastState = await capturePageState(tab);
    const failures = healthFailures(item.code, lastState, []);
    const signature = JSON.stringify([
      lastState.url,
      lastState.h1,
      lastState.text.length,
      lastState.visibleLoadingCount,
      lastState.alertTexts,
      lastState.unmarkedBusinessErrorTexts,
    ]);
    if (failures.length === 0) {
      consecutiveHealthy = signature === lastSignature ? consecutiveHealthy + 1 : 1;
      if (consecutiveHealthy >= 2) return lastState;
    } else {
      consecutiveHealthy = 0;
    }
    lastSignature = signature;
  }
  return lastState;
}

async function capturePageState(tab) {
  const raw = await tab.playwright.evaluate(() => {
    const main = document.querySelector("main");
    const normalize = (value) => (value ?? "").replace(/\s+/g, " ").trim();
    const isVisible = (element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && element.getClientRects().length > 0;
    };
    if (!main) {
      return {
        url: window.location.href,
        text: "",
        headingCount: 0,
        landmarkCount: 0,
        controlCount: 0,
        visibleLoadingCount: 0,
        alertTexts: [],
        terminalErrorMarkerCount: 0,
        candidateTexts: [],
        h1: "",
      };
    }

    const loadingSelectors = Array.from(main.querySelectorAll(
      '[aria-busy="true"], [data-loading="true"], [data-testid*="skeleton" i], [class*="skeleton" i], .animate-pulse',
    )).filter(isVisible);
    const loadingText = Array.from(main.querySelectorAll("*"))
      .filter(isVisible)
      .map((element) => normalize(element.textContent))
      .filter((value) => /^(?:加载中|正在加载|Loading)(?:…|\.\.\.)?$/i.test(value));
    const excludedSelector =
      '[role="alert"], [data-module-health-state], [data-module-health], [data-module-health-exempt="guidance"]';
    const candidateTexts = Array.from(main.querySelectorAll("p, div, span, li, td, th, pre"))
      .filter(isVisible)
      .filter((element) => !element.closest(excludedSelector))
      .filter(
        (element) =>
          !Array.from(element.children)
            .some((child) => isVisible(child) && normalize(child.textContent).length > 0),
      )
      .map((element) => normalize(element.textContent))
      .filter((value) => value.length > 0 && value.length <= 300);

    return {
      url: window.location.href,
      text: normalize(main.textContent),
      headingCount: main.querySelectorAll("h1, h2").length,
      landmarkCount: main.querySelectorAll('section, table, form, [role="region"]').length,
      controlCount: main.querySelectorAll("button, input, select, textarea, a").length,
      visibleLoadingCount: loadingSelectors.length + loadingText.length,
      alertTexts: Array.from(main.querySelectorAll('[role="alert"]'))
        .filter(isVisible)
        .map((element) => normalize(element.textContent))
        .filter(Boolean),
      terminalErrorMarkerCount: Array.from(main.querySelectorAll(
        '[data-module-health-state="error"], [data-module-health="error"], [data-state="error"]',
      )).filter(isVisible).length,
      candidateTexts: Array.from(new Set(candidateTexts)),
      h1: normalize(main.querySelector("h1")?.textContent),
    };
  });

  return {
    ...raw,
    semanticErrorScanComplete: true,
    unmarkedBusinessErrorTexts: raw.candidateTexts.filter(isUnmarkedBusinessErrorText),
  };
}

function healthFailures(moduleId, state, consoleErrors) {
  const failures = evaluateModuleHealthSnapshot(moduleId, state);
  if (state.url !== `http://localhost:3002${modulePath(moduleId)}`) {
    failures.push(`route mismatch: ${state.url}`);
  }
  if (consoleErrors.length > 0) {
    failures.push(`console errors: ${consoleErrors.map((error) => error.message).join(" | ")}`);
  }
  return failures;
}

function modulePath(moduleId) {
  const item = activeItems.find((candidate) => candidate.code === moduleId);
  return item?.href ?? "__missing__";
}

let activeItems = [];

function writeJournal(journalPath, { runId, buildId, results }) {
  fs.writeFileSync(
    journalPath,
    JSON.stringify({
      runId,
      buildId,
      producer: "tests/e2e/pc-all-modules-final-acceptance.spec.ts",
      inAppProducer: "scripts/run-pc-75-inapp-browser-evidence.mjs",
      tracePolicy: "checked-in Playwright producer uses trace=on; in-app carrier emits an action journal and per-step screenshots",
      completedAt: new Date().toISOString(),
      results,
    }, null, 2),
    "utf8",
  );
}

function readPreviousJournal(journalPath, buildId) {
  if (!fs.existsSync(journalPath)) return undefined;
  const parsed = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  return parsed.buildId === buildId ? parsed : undefined;
}

function consoleKey(log) {
  return [log.timestamp, log.url, log.message].join("|");
}

async function collectNewConsoleErrors(tab, seenConsoleKeys) {
  const fresh = [];
  for (const log of await tab.dev.logs({ levels: ["error"], limit: 1_000 })) {
    const key = consoleKey(log);
    if (!seenConsoleKeys.has(key)) {
      seenConsoleKeys.add(key);
      fresh.push(log);
    }
  }
  return fresh;
}

function stepFailures(row) {
  return ["first", "reload", "back"].flatMap((step) => row[step]?.failures ?? []);
}
