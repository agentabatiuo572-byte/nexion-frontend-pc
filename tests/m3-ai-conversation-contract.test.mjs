import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "lib/admin/m-client.ts"), "utf8");
const backend = readFileSync(resolve(process.cwd(), "../nexion-backend/src/main/java/ffdd/opsconsole/content/application/OpsConversationService.java"), "utf8");

test("M3 accepts the backend-declared AI conversation row instead of failing the whole real inbox", () => {
  assert.match(backend, /conversationTypes", List\.of\("advisor", "support", "ai"\)/);
  assert.match(source, /\["ADVISOR", "SUPPORT", "AI"\]\.includes\(upper\(row\.conversationType, ""\)\)/);
  assert.match(source, /\(value \|\| ""\)\.toLowerCase\(\) === "advisor" \? "advisor" : "support"/);
});
