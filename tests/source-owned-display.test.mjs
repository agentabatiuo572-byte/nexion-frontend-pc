import assert from "node:assert/strict";
import test from "node:test";
import { operatorDeviceName, operatorProductLabel } from "../lib/admin/e-operator-display.ts";
import { operatorCopyText } from "../lib/admin/operator-copy.ts";
import { supportTicketSubjectText } from "../lib/admin/brand-copy.ts";

test("E5 device and SKU labels preserve source names after validation", () => {
  for (const name of ["UVELBox Pro", "NexGridBox Pro", "StellarBox Pro", "NexionBox Pro", "My custom device"]) {
    assert.equal(operatorProductLabel(name), name);
    assert.equal(operatorDeviceName(name, "DEV-123"), name);
  }
  assert.equal(operatorDeviceName("valid name", ""), "设备信息待核验");
});
test("normal operator vocabulary and fixed ticket formatting do not rebrand source words", () => {
  assert.equal(operatorCopyText("NexGrid NEX Lucky Spin"), "NexGrid NEX 幸运转盘");
  assert.equal(supportTicketSubjectText("由会话 CV-123 转入 · NexGrid 3778"), "由会话 CV-123 转入 · NexGrid 3778");
  assert.equal(supportTicketSubjectText("Conversation CV-123"), "会话 CV-123");
});
