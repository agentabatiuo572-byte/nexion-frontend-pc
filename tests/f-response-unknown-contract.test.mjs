import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const fView = readFileSync(
  new URL("../app/components/domain-views/f-view.tsx", import.meta.url),
  "utf8",
);
const fTypes = readFileSync(
  new URL("../app/components/domain-views/f-tabs/types.ts", import.meta.url),
  "utf8",
);
const designKit = readFileSync(
  new URL("../app/components/domain-views/design-kit.tsx", import.meta.url),
  "utf8",
);
const a2Client = readFileSync(
  new URL("../lib/admin/a2-client.ts", import.meta.url),
  "utf8",
);

test("F modal intent owns one stable A2 command key until success or cancel", () => {
  assert.match(fTypes, /commandKey\?: string/);
  assert.match(fView, /import \{[^}]*createA2CommandKey[^}]*\} from "@\/lib\/admin\/a2-client"/s);
  assert.match(
    fView,
    /const openActionConfirm = \(spec: McSpec\) =>\s*setActionConfirm\(\{\s*\.\.\.spec,\s*commandKey: spec\.commandKey \?\? createA2CommandKey\("f-domain-action"\),?\s*\}\)/,
  );
  assert.match(fView, /openActionConfirm: \(m\) => openActionConfirm\(m\)/);
});

test("F proposals pass the retained key and derive stable child keys for multi-field intents", () => {
  assert.match(
    fView,
    /rawPropose\(toast, \{ \.\.\.spec, commandKey: spec\.commandKey \?\? mc\?\.commandKey \}\)/,
  );
  assert.match(
    fView,
    /commandKey: fProposalCommandKey\(mc\?\.commandKey, sourceDomain, key\)/,
  );
  assert.match(
    fView,
    /function fProposalCommandKey\(modalCommandKey: string \| undefined, sourceDomain: string, key: string\)/,
  );
});

test("F submit failures reach OperationConfirmModal instead of being consumed by the domain shell", () => {
  assert.match(
    fView,
    /catch \(error\) \{[\s\S]*?setToast\([\s\S]*?"F 域数据提交失败 · " \+ errorMessage\(error\)\)[\s\S]*?throw error;/,
  );
  assert.match(
    designKit,
    /catch \(error\) \{[\s\S]*setSubmitError\(operationConfirmErrorMessage\(error\)\)/,
  );
  assert.match(a2Client, /class A2OutcomeUncertainError extends Error/);
  assert.match(
    a2Client,
    /if \(init\?\.commandKey\) \{\s*throw new A2OutcomeUncertainError/,
  );
});
