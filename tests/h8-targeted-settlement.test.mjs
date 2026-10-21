import { nexGridBrandText } from "../lib/admin/brand-copy.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { findHighOp } from "../lib/admin/high-ops-registry.ts";

const snapshot = { expectedH8Version: 7, expectedRhythmMonth: 3, rewardSnapshotHash: "a".repeat(64) };
const definition = findHighOp("h8_referral_settlement_user");

test("targeted command binds exactly one newcomer and the approved reward snapshot", () => {
  assert.deepEqual(definition.buildCommand({ ...snapshot, invitedUserId: "60723153032", limit: 100 }), {
    domain: "H", op: "h8_referral_settlement_user", params: { invitedUserId: 60723153032, ...snapshot },
  });
  assert.deepEqual(definition.buildTarget({ invitedUserId: 60723153032 }),
    findHighOp("h8_referral_settlement").buildTarget({ limit: 20 }));
  for (const invalid of [undefined, null, "", 0, -1, 1.5, "1e3", "abc", Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => definition.buildCommand({ ...snapshot, invitedUserId: invalid }));
  }
});

function render(input) {
  let state = 0;
  const proposals = [];
  const attempts = [];
  let confirmation;
  const data = { enabled: true, pending: 2, version: 7, rhythmMonth: 3, rewardSnapshotHash: snapshot.rewardSnapshotHash,
    params: {}, effectiveRewards: { "newcomer.usdt": 0.015, "newcomer.nex": 0.015, "inviter.nex": 0.015 }, recentSettlements: [] };
  const jsx = (type, props) => ({ type, props });
  const dependencies = {
    "@/lib/admin/brand-copy": { nexGridBrandText },
    react: { useState: (initial) => [[data, false, false, null, input][state++], () => {}],
      useCallback: (fn) => fn, useEffect: () => {}, useRef: (current) => ({ current }) },
    "react/jsx-runtime": { jsx, jsxs: jsx, Fragment: "fragment" },
    "next/link": { default: "a", __esModule: true },
    "@/lib/admin/h-client": { createH8CommandKey: () => "stable-test-command", isH8OutcomeUncertainError: () => false },
    "@/lib/store/admin-auth": { useAdminAuth: (select) => select({ session: { role: "superadmin", authorities: [] } }) },
    "@/lib/admin/use-propose": { usePropose: () => async (_toast, proposal) => { proposals.push(proposal); } },
    "@/lib/admin/high-ops-registry": { findHighOp },
    "@/lib/admin/a2-client": { isA2OutcomeUncertainError: () => false },
    "@/lib/admin/pending-mutation-store": { createSlotAttemptStore: () => ({ resolve: (slot, fingerprint, mint) => {
      attempts.push({ slot, fingerprint }); return mint();
    }, forget: () => {} }) },
    "@/lib/admin/error-messages": { displayAdminError: String },
  };
  const source = readFileSync(new URL("../app/components/domain-views/h-tabs/h8-referral-rewards.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name];
  }, module, module.exports);
  const tree = module.exports.default({ ctx: { openActionConfirm: (value) => { confirmation = value; }, toast: () => {} } });
  const nodes = [];
  function visit(node) {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    nodes.push(node); visit(node.props?.children);
  }
  visit(tree);
  return { button: (text) => nodes.find((node) => node.type === "button" && node.props.children === text),
    confirm: () => confirmation, proposals, attempts };
}

test("actual H8 form proposes B alone even when an older invitation is pending", async () => {
  const form = render("60723153032");
  assert.equal(form.button("结算指定新人").props.disabled, false);
  form.button("结算指定新人").props.onClick();
  assert.equal(form.confirm().edit, undefined);
  await form.confirm().run("本次仅结算 Google 注册新人 B");
  const proposal = form.proposals[0];
  assert.equal(proposal.obj, "新人 60723153032");
  assert.equal(proposal.command.op, "h8_referral_settlement_user");
  assert.deepEqual(proposal.command.params, { invitedUserId: 60723153032, ...snapshot });
  assert.match(proposal.after, /仅结算新人 60723153032/);
  assert.equal(form.attempts[0].slot, "settle|user|60723153032");
  assert.equal(JSON.parse(form.attempts[0].fingerprint)[0], 60723153032);
});

test("invalid input disables targeted settlement and existing batch action stays a batch", async () => {
  for (const input of ["", "-1", "1.5", "1e3", "9007199254740992"]) {
    assert.equal(render(input).button("结算指定新人").props.disabled, true);
  }
  const form = render("60723153032");
  form.button("执行真实结算").props.onClick();
  await form.confirm().run("existing batch behavior", "2");
  assert.equal(form.proposals[0].command.op, "h8_referral_settlement");
  assert.equal(form.proposals[0].command.params.limit, 2);
  assert.equal(form.proposals[0].command.params.invitedUserId, undefined);
});
