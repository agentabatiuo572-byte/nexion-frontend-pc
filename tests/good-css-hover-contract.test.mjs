import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// Resolve Next's existing dependency rather than adding a test-only package.
const require = createRequire(import.meta.url);
const requireFromNext = createRequire(require.resolve("next/package.json"));
const postcss = requireFromNext("postcss");
const appDirectory = new URL("../app/", import.meta.url);

function readStyles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) return readStyles(path);
    if (!entry.name.endsWith(".css")) return [];
    return [postcss.parse(readFileSync(path, "utf8"), { from: path.pathname })];
  });
}

function hasHoverGuard(rule) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type !== "atrule" || parent.name !== "media") continue;
    const query = parent.params.replace(/\s+/g, "").toLowerCase();
    if (query === "(hover:hover)and(pointer:fine)") return true;
  }
  return false;
}

test("all app CSS hover rules require a fine pointer with hover support", () => {
  const styles = readStyles(appDirectory);
  assert.ok(styles.length > 0, "The app CSS scan must not be empty");
  let hoverRules = 0;
  for (const sheet of styles) {
    sheet.walkRules((rule) => {
      if (!rule.selector.includes(":hover")) return;
      hoverRules += 1;
      const location = `${rule.source.input.file}:${rule.source.start.line}`;
      assert.ok(hasHoverGuard(rule), `Missing full hover guard at ${location}: ${rule.selector}`);
      assert.ok(
        rule.selectors.every((selector) => selector.includes(":hover")),
        `Split non-hover states out of the hover-only rule at ${location}: ${rule.selector}`,
      );
    });
  }
  assert.ok(hoverRules > 0, "The scan must find the app's hover rules");
});

test("SKU drag feedback remains unconditional on touch and coarse pointers", () => {
  const file = new URL("globals.css", appDirectory);
  const sheet = postcss.parse(readFileSync(file, "utf8"), { from: file.pathname });
  const unconditional = new Map();
  sheet.walkRules((rule) => {
    if (!rule.selectors.includes(".dkpage .sku-drop.drag")) return;
    assert.equal(rule.parent.type, "root", "Drag feedback must stay outside media queries");
    rule.walkDecls((declaration) => unconditional.set(declaration.prop, declaration.value));
  });
  assert.equal(unconditional.get("border-color"), "var(--brand)");
  assert.equal(unconditional.get("background"), "var(--brand-soft)");
  assert.equal(unconditional.get("border-style"), "solid");
});
