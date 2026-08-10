// 客服中心后台面静态守卫 — 客服已由域 I(I8 工单 + I9 即时会话)迁出,
// 重组为独立域 M 客服中心(/service/*)。守:IA 接线 / M 视图接线 / 数据模型 /
// data-proof 控件存活 / 真写键 / 共享 MessageThread / UniApp 工单字段镜像 / verify needle。
// 真写键前缀沿用 I.support.* / I.session.*(persist 兼容,与 nav 域 code M 解耦)。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionAppRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNI_ROOT = resolveNexionAppRoot({ adminRoot: ROOT });
const failures = [];

function read(relOrAbs) {
  const file = path.isAbsolute(relOrAbs) ? relOrAbs : path.join(ROOT, relOrAbs);
  return fs.readFileSync(file, "utf8");
}

function assertContains(file, needles) {
  const text = read(file);
  for (const needle of needles) {
    if (!text.includes(needle)) failures.push(`${file} missing ${needle}`);
  }
}

function assertRegex(file, regex, label) {
  const text = read(file);
  if (!regex.test(text)) failures.push(`${file} missing ${label}`);
}

function assertAbsent(file, needle, why) {
  if (read(file).includes(needle)) failures.push(`${file} 仍残留 ${needle}(${why})`);
}

// SPEC / modal-spec 文档(内容口径不随迁移变;路由锚点待 PRD 同步阶段更新)
assertContains("docs/remediation/specs/SPEC-L3a01-support-admin-surface.md", [
  "`modal-specs/content-support-ticket-workflow.md`",
]);
assertRegex(
  "docs/remediation/specs/SPEC-L3a01-support-admin-surface.md",
  /\| 状态 \| (approved|verified) \|/,
  "approved or verified spec status",
);
assertContains("docs/remediation/modal-specs/content-support-ticket-workflow.md", [
  "新增 FAQ",
  "运营回复",
  "关闭/重开",
  "owner/lastReplyAt",
]);

// IA 真源:客服迁出域 I → 独立域 M 客服中心(/service/*)
assertContains("lib/nav/console-nav.ts", [
  'code: "M"',
  "客服中心",
  'slug: "service"',
  'id: "M2"',
  'path: "/service/tickets"',
  'id: "M3"',
  'path: "/service/sessions"',
]);
assertAbsent("lib/nav/console-nav.ts", 'path: "/content/support"', "I8 应已迁出至域 M");
assertAbsent("lib/nav/console-nav.ts", 'path: "/content/conversation-center"', "I9 应已迁出至域 M");

// registry summary(DomainHeader)
assertContains("lib/admin/registry/m.ts", [
  'path: "/service/tickets"',
  'path: "/service/sessions"',
]);

// 域 M 视图接线
assertContains("app/components/domain-views/m-view.tsx", [
  'M2: "M2"',
  "<M2Tickets ctx={ctx} />",
  "<M3Sessions ctx={ctx} />",
]);
assertContains("app/components/domain-views/ported.ts", ['"M"']);
assertContains("app/components/domain-views/registry.tsx", ["MDomainView", "M: MDomainView"]);

// 数据模型(类型契约仍在 m-tabs/data.ts;工单/转交种子数组 2026-08 起服务端化,经 lib/admin/m-client 取数)
assertContains("app/components/domain-views/m-tabs/data.ts", [
  "export type SupportTicket",
  "lastReplyAt: number",
  "owner: string",
  "SUPPORT_STATUS_LABEL",             // 状态字典(server-canonical 后仍为前端展示契约)
  "SESSION_CONVOS",
  "export type SessionTransfer",      // 跨坐席转交模型
  "transfer?: SessionTransfer",       // 会话挂转交态(转入待处理)
  "STANDBY_POOL_LABEL",               // 备勤池(转交超时回落语义)
]);
assertContains("lib/admin/m-client.ts", ["SupportTicket"]); // 服务端取数链路存活

// M2 工单坐席台:控件存活 + 真写键 + 共享线程 + 互转 + 行为
assertContains("app/components/domain-views/m-tabs/m2-tickets.tsx", [
  'data-proof="support-ticket-reply-save"',
  'data-proof="support-ticket-close"',
  'data-proof="support-ticket-escalate"',
  "I.support.tickets",
  "I.session.convos",
  "MessageThread",
  'author: "agent"',
]);
assertRegex(
  "app/components/domain-views/m-tabs/m2-tickets.tsx",
  /closed:\s*\["open"\]/, // 2026-08-03 追平重写:翻转改为状态机转移表,closed 仅可重开为 open
  "M2 关闭/重开状态翻转",
);

// M3 即时会话坐席台:控件存活 + 真写键 + 续聊 + 发起/互转/跨坐席转交 + 共享线程
assertContains("app/components/domain-views/m-tabs/m3-sessions.tsx", [
  'data-proof="session-reply-save"',
  'data-proof="session-initiate"',
  'data-proof="session-to-ticket"',
  'data-proof="session-transfer"',          // 转交发起入口(完整流程,非直改 owner)
  'data-proof="session-transfer-accept"',    // 转入待处理 B 侧:接收接入
  'data-proof="session-transfer-return"',    // 转入待处理 B 侧:手动退回
  'data-proof="session-transfer-fallback"',  // 工作台超时回落备勤池开关
  "I.session.convos",
  "I.session.ui.lastConvo",
  "I.session.workbench.timeoutFallback",     // 超时回落开关真写键(沿用 I.session.* 命名空间)
  "I.support.agents",                        // 2026-08-03:m3 工单联动改走后端转单,坐席字典键为 M3 与 I.support.* 的现存关联
  "MessageThread",
  'sender: "agent"',
]);
// M3 转交弹窗(选目标 + 转交/退回原因 · 例行内部交接,不走 MC)
assertContains("app/components/domain-views/m-tabs/m3-modals.tsx", [
  'data-proof="session-transfer-submit"',
  'data-proof="session-transfer-return-submit"',
  "export function TransferModal",
  "export function ReturnModal",
]);

// M4 知识库与 SLA
assertContains("app/components/domain-views/m-tabs/m4-kb-sla.tsx", [
  'data-proof="support-faq-save"',
  'data-proof="support-sla-category"',
  "I.support.faqs",
  "I.support.sla",
]);

// M5 话术与受众圈定
assertContains("app/components/domain-views/m-tabs/m5-scripts.tsx", [
  'data-proof="session-policy-audience"',
  'data-proof="session-script-new"',
  "I.session.advisor.policy",
]);

// 域 I 已干净摘除客服(改锚现役子页组件导入,防「N 子页」计数注释漂移)
assertContains("app/components/domain-views/i-view.tsx", ["I1CopyAb", "I4Trust", "I6I18n"]);
assertAbsent("app/components/domain-views/i-view.tsx", "I8Support", "客服已迁出域 M");
assertAbsent("app/components/domain-views/i-view.tsx", "I9Conversation", "客服已迁出域 M");

// 自接线断言:本门须在现役管线 verify.mjs 中(2026-08-03 由退役的 verify.sh 迁入;live 探活归 verify:owner-review:live)
assertContains("scripts/verify.mjs", ["admin-support-surface-audit.mjs"]);

// UniApp 工单字段镜像(前端不变,迁移后仍须对齐)
assertContains(path.join(UNI_ROOT, "src/mock/tickets.ts"), [
  "lastReplyAt: number",
  "owner: string",
  'owner: "Marina K."',
]);
assertContains(path.join(UNI_ROOT, "src/store/tickets.ts"), [
  "lastReplyAt: raw.lastReplyAt ?? ticket.updatedAt",
  'owner: raw.owner ?? "Unassigned"',
  "lastReplyAt: now",
]);

// 路由计数:本门只辖 M 面 —— /service 客服路由 = 5;全站 L2 总数随 IA 演进,不在本门硬编码(2026-08-03 去除 72 断言)
const serviceRouteCount = (read("lib/nav/console-nav.ts").match(/path:\s*"\/service\//g) || []).length;
if (serviceRouteCount !== 5) failures.push(`/service routes ${serviceRouteCount}, expected 5`);

if (failures.length) {
  console.error("admin-support-surface-audit (domain M) failed");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("admin-support-surface-audit (domain M 客服中心) passed");
