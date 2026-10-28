import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { formatAdminApiError } from "../lib/admin/error-messages.ts";

const files = ["m-view.tsx", ...["m1-analytics-workbench", "m1-group-management", "m3-dedicated-chat", "m3-modals", "m4-kb-sla", "m5-scripts", "m5-service-rules", "self-avatar-editor", "support-bulk-composer", "support-leaderboard", "m6-leaderboard"].map(name => `m-tabs/${name}.tsx`)];
const forbidden = /后端|服务端|服务器(?:侧|会)?校验|数据库|未落库|自动验收|验收占位|执行器|未接入|不会伪造|sourceVersion|真实数据|查询版本|不会以零|不会使用旧成员版本|话术挂双语词条|中英(?:越)?镜像|维护双语镜像|来源已核实|来源刷新失败|原始业绩额|真实统计期|这不代表客服或业绩为零|不能认定没有客服或业绩|公开成绩不授予|摘要暂未提供|暂无可信实时信号|作用于真实会话|重读第一页|\bI6\b|\bJ1\b/;

test("formal support copy excludes implementation explanations, including accessibility and dialogs", () => {
  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(new URL(`../app/components/domain-views/${file}`, import.meta.url), "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function visit(node) {
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) && forbidden.test(node.text)) {
        violations.push(`${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${node.text.trim()}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  assert.deepEqual(violations, []);
});

test("formal M5 excludes placeholder controls while still filtering nonbusiness rows", () => {
  const source = fs.readFileSync(new URL("../app/components/domain-views/m-tabs/m5-scripts.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /showAutoAcceptance|scriptPlaceholderCount|replyTemplatePlaceholderCount|placeholder-toggle/);
  assert.match(source, /scripts\.filter\(\(row\) => !isAutoAcceptancePlaceholder\(row\.text\)\)/);
  assert.match(source, /replyTemplates\.filter\(\(row\) => !isAutoAcceptancePlaceholder\(row\.text\)\)/);
  assert.match(source, /ADVISOR_AUTOPUSH_EXECUTOR_AVAILABLE = false/);
  assert.match(source, /仅允许停用/);
  assert.match(source, /不会触发主动推送/);
});

test("support diagnostic mappings explain outcomes and recovery without internal sources", () => {
  for (const code of ["SUPPORT_CONTRACT_MALFORMED", "SUPPORT_DECIMAL_INVALID", "M3_TIMEOUT_POLICY_NOT_CONFIGURED", "M3_CONVERSATION_SNAPSHOT_UNSTABLE", "M3_CONVERSATION_SNAPSHOT_SUPERSEDED", "M3_CONVERSATION_DETAIL_INVALID", "M3_CONVERSATION_PAGE_MALFORMED", "M3_CONVERSATION_PAGE_INCOMPLETE"]) {
    const copy = formatAdminApiError(code, "");
    assert.doesNotMatch(copy, /后端|服务端|接口|初始化|迁移|本地默认值|快照|补拉|推测(?:值|金额)|分页读取|格式异常/);
    assert.match(copy, /重试|刷新|重新连接|重新加载|联系/);
  }
  const decimalCopy = formatAdminApiError("SUPPORT_DECIMAL_INVALID", "");
  assert.match(decimalCopy, /金额.*无法确认/);
  assert.match(decimalCopy, /停止.*操作/);
});

test("generic 503 preserves unknown write outcome and forbids duplicate submission", () => {
  for (const code of ["SUPPORT_API_503", "F1_REQUEST_FAILED_503", "BI_API_503", "AUDIT_BACKEND_UNAVAILABLE", "SERVICE_UNAVAILABLE", "Service Unavailable"]) {
    const copy = formatAdminApiError(code, "");
    assert.match(copy, /结果尚未确认/);
    assert.match(copy, /查询原命令|核对原操作/);
    assert.match(copy, /不要重复提交/);
    assert.doesNotMatch(copy, /未生效|后端|后台|服务端/);
  }
});

test("M3 attachment errors use the shared product mapping", () => {
  const source = fs.readFileSync(new URL("../app/components/domain-views/m-tabs/m3-dedicated-chat.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /error:\s*cause instanceof Error[\s\S]{0,100}\? cause\.message/);
  assert.match(source, /state: "error", error: displayAdminError\(cause\)/);
});
