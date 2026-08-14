import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MAvatar } from "../app/components/domain-views/m-tabs/m-avatar.ts";

test("M1 renders a deterministic initials avatar without creating an external image request", () => {
  const first = renderToStaticMarkup(createElement(MAvatar, { name: "客服主管 Alice", size: "sm" }));
  const second = renderToStaticMarkup(createElement(MAvatar, { name: "客服主管 Alice", size: "sm" }));

  assert.equal(first, second, "the same roster identity must produce stable markup");
  assert.match(first, /class="av sm"/);
  assert.match(first, />客A<\/span>/);
  assert.doesNotMatch(first, /<img\b|\bsrc=|https?:\/\//i);

  const m1 = fs.readFileSync(new URL("../app/components/domain-views/m-tabs/m1-overview.tsx", import.meta.url), "utf8");
  const sharedUi = fs.readFileSync(new URL("../app/components/domain-views/m-tabs/hd-ui.tsx", import.meta.url), "utf8");
  assert.match(m1, /<MAvatar name=\{l\.name\} size="sm" \/>/);
  assert.match(sharedUi, /export \{ MAvatar, avInitials \} from "\.\/m-avatar"/);
  assert.doesNotMatch(sharedUi, /photoUrl|<img\b|randomuser\.me/);
});
