import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CONTRACTS = [
  "f003-nx1-authority-contract.test.mjs",
  "f1-closure-contract.test.mjs",
  "f3-binary-closure-contract.test.mjs",
  "g1-staking-closure-contract.test.mjs",
  "g2-exchange-closure-contract.test.mjs",
  "g3-market-closure-contract.test.mjs",
  "g4-genesis-closure-contract.test.mjs",
  "h3-owner-closure-contract.test.mjs",
  "h4-owner-closure-contract.test.mjs",
  "h5-owner-closure-contract.test.mjs",
  "h7-owner-closure-contract.test.mjs",
  "h8-owner-closure-contract.test.mjs",
  "i1-cross-domain-closure-contract.test.mjs",
  "i2-nova-server-canonical-contract.test.mjs",
  "i3-owner-closure-contract.test.mjs",
  "i4-owner-closure-contract.test.mjs",
  "i5-disclosure-contract.test.mjs",
  "i6-owner-closure-contract.test.mjs",
  "k6-janus-real-api-contract.test.mjs",
  "l6-cross-domain-closure-contract.test.mjs",
];

test("every cross-App acceptance contract resolves its App checkout through the declared root resolver", () => {
  for (const file of CONTRACTS) {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    assert.match(source, /resolveNexionAppRoot/, `${file} must use resolveNexionAppRoot`);
    assert.doesNotMatch(source, /D:(?:\\|\/)workspace(?:\\|\/)NX1\.0/i, `${file} hard-codes the App checkout`);
    assert.doesNotMatch(source, /(?:\.\.\\|\.\.\/)NX1\.0(?:\\|\/)/, `${file} derives the App checkout directly`);
    assert.doesNotMatch(source, /["']NX1\.0(?:\\|\/)/, `${file} embeds an App-root path fragment`);
  }
});
