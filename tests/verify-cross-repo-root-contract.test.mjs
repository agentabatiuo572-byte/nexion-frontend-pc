import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("verify-time J contracts honor the explicit App checkout", () => {
  for (const file of ["./j1-killswitch-contract.test.mjs", "./j2-geoblock-contract.test.mjs"]) {
    const source = read(file);
    assert.match(source, /resolveNexionAppRoot/);
    assert.doesNotMatch(source, /\.\.\/\.\.\/NX1\.0\//);
  }
});
