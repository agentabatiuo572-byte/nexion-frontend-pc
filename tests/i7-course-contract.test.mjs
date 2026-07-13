import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const view = readFileSync(new URL("../app/components/domain-views/i-tabs/i6-i18n.tsx", import.meta.url), "utf8");
const kit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/i-client.ts", import.meta.url), "utf8");

test("I7 exposes real draft update and delete actions", () => {
  assert.match(client, /updateI7CourseDraft/);
  assert.match(client, /deleteI7CourseDraft/);
  assert.match(view, />\s*编辑\s*</);
  assert.match(view, />\s*删除草稿\s*</);
});

test("I7 uses authoritative options with Chinese labels", () => {
  assert.match(view, /formats:\s*data\?\.formats/);
  assert.match(view, /levels:\s*data\?\.levels/);
  assert.match(kit, /Article:\s*"图文"/);
  assert.match(kit, /Beginner:\s*"入门"/);
  assert.match(kit, /published:\s*"已发布"/);
});

test("I7 quiz editor is structured and does not accept semicolon-packed options", () => {
  assert.match(kit, /添加题目/);
  assert.match(kit, /添加选项/);
  assert.doesNotMatch(kit, /选项\(分号分隔\)/);
  assert.match(view, /quizQuestions:/);
});

test("I7 quiz editor marks the correct answer beside each option and explains scoring", () => {
  assert.match(kit, /type="radio"/);
  assert.match(kit, /设为正确答案：选项 \{optionIndex \+ 1\}/);
  assert.match(kit, /正确题数 ÷ 总题数 × 100/);
  assert.doesNotMatch(kit, /correctOptionIndex`, "正确选项"/);
});

test("I7 featured course is selected from published backend courses", () => {
  assert.match(view, /kind:\s*"select"/);
  assert.match(view, /publishedCourseOptions/);
  assert.doesNotMatch(view, /新课 id 填入/);
});

test("I7 course authoring persists Chinese Vietnamese and English copy", () => {
  assert.match(client, /titleVi:\s*string/);
  assert.match(client, /bodyVi:\s*string/);
  assert.match(kit, /越南语标题/);
  assert.match(kit, /越南语正文/);
  assert.match(view, /titleVi:\s*form\?\.titleVi/);
  assert.match(view, /bodyVi:\s*form\?\.bodyVi/);
});

test("I7 quiz persists Vietnamese question and options", () => {
  assert.match(kit, /越南语题干/);
  assert.match(kit, /选项 \$\{optionIndex \+ 1\}（越南语）/);
  assert.match(view, /questionVi:\s*form\?\.\[`quiz\.\$\{questionIndex\}\.questionVi`\]/);
  assert.match(view, /optionsVi:\s*Array\.from/);
});

test("I7 course versions use real backend CRUD publish and rollback endpoints", () => {
  assert.match(client, /fetchI7CourseVersions/);
  assert.match(client, /createI7CourseVersion/);
  assert.match(client, /updateI7CourseVersion/);
  assert.match(client, /deleteI7CourseVersion/);
  assert.match(client, /publishI7CourseVersion/);
  assert.match(client, /rollbackI7CourseVersion/);
  assert.match(client, /courses\/\$\{encodeURIComponent\(courseId\)\}\/versions/);
  assert.match(client, /versions\/\$\{encodeURIComponent\(version\)\}\/publish/);
  assert.match(client, /versions\/\$\{encodeURIComponent\(version\)\}\/rollback/);
  assert.match(view, />版本管理</);
  assert.match(view, />\+ 新版本草稿</);
  assert.match(view, />编辑草稿</);
  assert.match(view, />删除草稿</);
  assert.match(view, />发布</);
  assert.match(view, />回滚到此版本</);
});

test("I7 event copy describes the real progress event and reward ledgers", () => {
  assert.match(view, /实时写入学习事件/);
  assert.match(view, /课程进度表/);
  assert.match(view, /奖励台账/);
  assert.doesNotMatch(view, /占位期按临时编号入库/);
});
