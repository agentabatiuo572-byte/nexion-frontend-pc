import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../app/components/domain-views/f-tabs/f5-audit.tsx", import.meta.url),
  "utf8",
);
const client = readFileSync(new URL("../lib/admin/f1-client.ts", import.meta.url), "utf8");
const bff = readFileSync(
  new URL("../app/api/admin/teams/[...path]/route.ts", import.meta.url),
  "utf8",
);

test("F5 exposes server-side event filters and explicit batch/history views", () => {
  assert.match(component, /全部币种/);
  assert.match(component, /用户 ID/);
  assert.match(component, /用户群/);
  assert.match(component, /异常预警列表/);
  assert.match(component, /处置批次与历史/);
  assert.match(client, /F5CommissionQuery/);
});

test("F5 exposes reverse, reissue and user-suspension commands through the strict BFF", () => {
  assert.match(client, /reverseF5Commission/);
  assert.match(client, /reissueF5Commissions/);
  assert.match(client, /suspendF5UserCommissions/);
  assert.match(bff, /commissions\/reissue/);
  assert.match(bff, /commission\/suspend/);
});

test("F5 canonical backend routes have an explicit network-domain RBAC gate", () => {
  const backendFilter = readFileSync(
    new URL(
      "../../nexion-backend/src/main/java/ffdd/opsconsole/shared/security/AdminRbacAuthorizationFilter.java",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(backendFilter, /rule\("\/api\/admin\/commissions",\s*"network_"\)/);
  assert.match(backendFilter, /rule\("\/api\/admin\/commissions\/\*\*",\s*"network_"\)/);
  assert.match(backendFilter, /rule\("\/api\/admin\/users\/\*\/commission\/suspend",\s*null\)/);
});

test("F5 UI keeps the D4, B1, A2 and A4 investigation chain discoverable", () => {
  for (const expected of ["D4", "B1", "A2", "A4"]) {
    assert.match(component, new RegExp(expected));
  }
});
