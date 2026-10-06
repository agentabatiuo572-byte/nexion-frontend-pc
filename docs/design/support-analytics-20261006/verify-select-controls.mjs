// Static style contracts only. The browser gate must open and operate every rendered select.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('./select-controls.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('./prototype.html', import.meta.url), 'utf8');
const leaderboard = readFileSync(new URL('./leaderboard.js', import.meta.url), 'utf8');
const block = (selector, declaration = '') => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = [...css.matchAll(new RegExp(escaped + '\\s*\\{([^}]+)\\}', 'g'))].find(item => item[1].includes(declaration));
  assert.ok(match, 'Missing shared rule: ' + selector);
  return match[1];
};
const pixels = name => Number(css.match(new RegExp(name + ':\\s*(\\d+)px'))?.[1]);

assert.equal(pixels('--select-icon-size'), 16);
assert.equal(pixels('--select-icon-inset'), 14);
assert.equal(pixels('--select-icon-gap'), 12);
assert.match(block(':root body select'), /padding-inline-end:\s*calc\(var\(--select-icon-inset\) \+ var\(--select-icon-size\) \+ var\(--select-icon-gap\)\)/, 'The text reserves the entire arrow and its gap');
assert.match(block(':root body select'), /min-block-size:\s*40px/);
assert.match(block(':root .send-demo select'), /min-block-size:\s*36px/);
assert.match(block(':root body select'), /appearance:\s*none/);
assert.match(block(':root body select'), /background-image:\s*var\(--select-chevron\)/);
assert.match(css, /@supports \(appearance: base-select\) and selector\(select::picker\(select\)\)/, 'The styled picker requires native browser support');
assert.match(css, /:root body select,\s*:root body select::picker\(select\)\s*\{\s*appearance: base-select/);
assert.match(css, /:root body select\s*\{\s*background-image: none;\s*white-space: normal;\s*overflow-wrap: anywhere;/, 'Supported browsers keep long closed values readable');
const picker = block(':root body select::picker(select)', 'max-inline-size');
assert.match(picker, /max-inline-size:\s*calc\(100vw - 24px\)/);
assert.match(picker, /max-block-size:\s*min\(320px, calc\(100dvh - 24px\)\)/);
assert.match(picker, /position-try-fallbacks:\s*flip-block, flip-inline, flip-block flip-inline/);
assert.match(block(':root body select option'), /white-space:\s*normal/);
assert.match(block(':root body select option'), /overflow-wrap:\s*anywhere/);
assert.match(block(':root body select:disabled'), /cursor:\s*not-allowed/);
assert.match(block(':root body select:focus-visible'), /outline:\s*2px solid var\(--blue\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
assert.doesNotMatch(css, /!important|text-overflow:\s*ellipsis|outline:\s*(?:none|0)\b/, 'Shared controls must not hide text or keyboard focus');
assert.doesNotMatch(block(':root body select'), /display:\s*none|visibility:\s*hidden|pointer-events:\s*none/, 'The original native control retains interaction and accessibility');

const controls = [...(html + leaderboard).matchAll(/<select\b([^>]*)>/g)];
assert.ok(controls.length >= 23, 'Include page, dialog and leaderboard select templates');
for (const [, attributes] of controls) {
  assert.doesNotMatch(attributes, /style=["'][^"']*(?:padding|appearance|background)/, 'Inline styles must not bypass the shared select contract');
}
console.log(`PASS: shared select style contracts cover ${controls.length} native select templates; browser behavior still requires runtime verification.`);
