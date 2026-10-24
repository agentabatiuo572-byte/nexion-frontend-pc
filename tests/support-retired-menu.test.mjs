import test from "node:test";
import assert from "node:assert/strict";
import { resolveVisibleDomains, findByPath } from "../lib/nav/console-nav.ts";

test("old database menu labels cannot restore ticket or SLA navigation", () => {
  const domains = resolveVisibleDomains({
    role: "superadmin", menuCodes: ["M", "M2", "M4"],
    menuNodes: [
      { menuCode: "M2", menuName: "工单台", routePath: "/service/tickets", parentCode: "M", sortOrder: 2 },
      { menuCode: "M4", menuName: "知识库与 SLA", routePath: "/service/kb-sla", parentCode: "M", sortOrder: 4 },
    ],
  });
  assert.deepEqual(domains.flatMap(domain => domain.l2).map(item => [item.id, item.name]), [["M4", "知识库"]]);
  assert.equal(findByPath("/service/tickets"), null);
});
