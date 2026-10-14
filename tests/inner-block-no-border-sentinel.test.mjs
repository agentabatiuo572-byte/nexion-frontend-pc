import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cssFilesUnder, scanCss, scanProfileTsx } from "../scripts/inner-block-no-border-sentinel.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("strict CSS blocks the original M3 risk and tone borders in nested files", () => {
  // 已核对的旧风险四规则，夹具不依赖 Git 历史或深克隆。
  const oldCss = `.m3-profile-risk{border:1px solid var(--v5-border);background:var(--v5-surface-2)}
    .m3-profile-risk[data-tone="low"]{background:var(--v5-success-soft);border-color:color-mix(in srgb,var(--v5-success) 24%,var(--v5-border))}
    .m3-profile-risk[data-tone="medium"]{background:var(--v5-warning-soft);border-color:color-mix(in srgb,var(--v5-warning) 24%,var(--v5-border))}
    .m3-profile-risk[data-tone="high"]{background:var(--v5-danger-soft);border-color:color-mix(in srgb,var(--v5-danger) 24%,var(--v5-border))}`;
  const riskHits = scanCss(oldCss, true).filter((hit) => hit.selector.startsWith(".m3-profile-risk"));
  assert.equal(riskHits.length, 4, "base/unknown plus low/medium/high must all be rejected");
  assert.ok(cssFilesUnder(`${root}/app/components/domain-views`).some((file) => file.endsWith("m3-customer-profile.css")));
});

test("strict CSS preserves real controls, focus and row separators without generic card exemptions", () => {
  const fill = "background:color-mix(in srgb,var(--v5-surface-2) 70%,transparent);";
  for (const selector of [".m3-profile-open", ".m3-profile-link", ".profile button", ".profile input", ".profile button:focus-visible"]) {
    assert.equal(scanCss(`${selector}{${fill}border:1px solid var(--v5-border)}`, true).length, 0, selector);
  }
  for (const border of ["border-bottom:1px solid var(--v5-border)", "border:0px solid red", "border:1px solid transparent", "border:1px dashed red"]) {
    assert.equal(scanCss(`.profile-note{${fill}${border}}`, true).length, 0, border);
  }
  assert.equal(scanCss(`.profile-card{${fill}border:1px solid var(--v5-border)}`, true).length, 1);
  assert.equal(scanCss(`.profile button,\n.profile-note{${fill}border:1px solid var(--v5-border)}`, true).length, 1);
  assert.equal(scanCss(`.profile button:hover,\n.profile-note{${fill}border:1px solid var(--v5-border)}`, true).length, 1);
});

test("JSX parser catches static blocks across lines and conditional fills but permits controls and separators", () => {
  const source = `<><div style={{ background: bound ? "var(--v5-surface-2)" : "color-mix(in srgb, red 10%, transparent)", border: "1px solid red" }} />
    <span style={{ background: "var(--v5-surface)",\n border: "1px solid red" }} />
    <button style={{ background: "var(--v5-surface)", border: "1px solid red" }} />
    <input style={{ background: "var(--v5-surface)", border: "1px solid red" }} />
    <div role="button" style={{ background: "var(--v5-surface)", border: "1px solid red" }} />
    <div style={{ background: "var(--v5-surface)", borderBottom: "1px solid red" }} /></>`;
  assert.equal(scanProfileTsx(source).length, 2);
  assert.equal(scanProfileTsx('<span style={{ background: "var(--v5-surface)", border: "0.5px solid red" }} />').length, 1);
  assert.equal(scanProfileTsx('<span style={{ background: "var(--v5-surface)", border: "0px solid red" }} />').length, 0);
  const oldPill = '<span style={{ background: `color-mix(in srgb, ${c} 15%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 30%, transparent)` }} />';
  assert.equal(scanProfileTsx(oldPill).length, 1, "shared pill template background/border must be detected");
});

test("the actual scoped CLI passes and the contract stays wired into verify", () => {
  const result = spawnSync(process.execPath, ["scripts/inner-block-no-border-sentinel.mjs", "--support-profile"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /客服资料 strict CSS \+ page JSX \+ StatusPill/);
  const verify = readFileSync(`${root}/scripts/verify.mjs`, "utf8");
  const gear = verify.match(/\["Support profile static filled-block border contract",[^\n]+/);
  assert.ok(gear, "the scoped contract must be part of verify");
  assert.match(gear[0], /"tests\/inner-block-no-border-sentinel\.test\.mjs"/);
  assert.match(gear[0], /"tests\/c1-acceptance-contract\.test\.mjs"/);
});
