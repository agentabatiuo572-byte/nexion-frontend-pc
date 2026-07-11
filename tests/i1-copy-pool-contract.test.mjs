import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("I1 文案池提供新增文案入口，并把行操作表达为编辑文案", () => {
  const source = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(source, /onClick=\{createCopy\}>\+ 新增文案<\/button>/);
  assert.match(source, /onClick=\{\(\) => editCopy\(c\)\}>编辑文案<\/button>/);
  assert.doesNotMatch(source, /onClick=\{\(\) => pubNewVersion\(c\)\}>发布新版<\/button>/);
});

test("新增文案通过 I1 真实创建接口提交，并在成功后重新加载列表", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /actions\.createI1Copy\(/);
  assert.match(component, /\.then\(\(\) => actions\.reloadIContent\(\)\)/);
  assert.match(client, /createI1Copy: \(body: Record<string, unknown>, reason: string\) => Promise<void>/);
  assert.match(client, /createI1Copy: \(body, reason\) => apiRequest\("\/copy-ab\/copies", \{ method: "POST"/);
});

test("编辑文案允许存草稿或发布生效，而不是把编辑动作强制等同于发布", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /saveModeChoice: true/);
  assert.match(component, /form\?\.saveMode === "存草稿"/);
  assert.match(component, /actions\.saveI1CopyDraft/);
  assert.match(component, /actions\.publishI1CopyVersion/);
  assert.match(designKit, /saveModeChoice\?: boolean/);
  assert.match(designKit, /saveMode: "存草稿"/);
  assert.match(designKit, /select\("saveMode", "保存为", \["存草稿", "发布生效"\]\)/);
});

test("编辑表单使用独立草稿版本，并保留当前受众与分流条件", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /version: c\.draftVersion \|\| nextCopyVersion\(c\.key, c\.version\)/);
  assert.match(component, /row\.v\.toLowerCase\(\)/);
  assert.match(component, /used\.has\(candidate\.toLowerCase\(\)\)/);
  assert.match(component, /audience: c\.draftAudience \|\| editableVersion\?\.audience/);
  assert.match(component, /trafficSplit: c\.draftTrafficSplit \|\| editableVersion\?\.trafficSplit/);
  assert.match(designKit, /audience: spec\.audience \?\? spec\.audiences\?\.\[0\] \?\? ""/);
  assert.match(designKit, /trafficSplit: spec\.trafficSplit \?\? spec\.trafficSplits\?\.\[0\] \?\? ""/);
});

test("I1 投放模块固定为 home store earn me，旧模块只做兼容归一化", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(component, /const COPY_MODULES = \["home", "store", "earn", "me"\] as const/);
  assert.match(component, /商城: "store"/);
  assert.match(component, /Home: "home"/);
  assert.match(component, /Me: "me"/);
  assert.match(component, /modules: COPY_MODULE_OPTIONS/);
  assert.doesNotMatch(component, /row\.surface === "Me" \|\| row\.surface === "商城" \? row\.surface : "Home"/);
});

test("文案位置来自 overview，并通过真实新增删除接口维护和回载", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(client, /export type CopyPositionView =/);
  assert.match(client, /positions: CopyPositionView\[\]/);
  assert.match(client, /createI1CopyPosition:/);
  assert.match(client, /deleteI1CopyPosition:/);
  assert.match(client, /apiRequest\("\/copy-ab\/positions", \{ method: "POST"/);
  assert.match(client, /apiRequest\(`\/copy-ab\/positions\/\$\{encodeURIComponent\(positionKey\)\}`, \{ method: "DELETE"/);
  assert.match(component, /data-proof="copy-position-list"/);
  assert.match(component, /actions\.createI1CopyPosition\(/);
  assert.match(component, /actions\.deleteI1CopyPosition\(/);
  assert.match(component, /positions: COPY_POSITION_OPTIONS/);
  assert.match(designKit, /kind: "copy-position-create"/);
  assert.match(designKit, /select\("copyPosition", "文案位置"/);
});

test("新增和编辑使用结构化受众，并序列化 P 范围、语言和注册天数", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /function composeAudience\(/);
  assert.match(component, /audience: composeAudience\(form\)/);
  assert.match(designKit, /phaseMin/);
  assert.match(designKit, /phaseMax/);
  assert.match(designKit, /language/);
  assert.match(designKit, /registrationDaysGt/);
  assert.match(designKit, /最低 P 阶段/);
  assert.match(designKit, /最高 P 阶段/);
  assert.match(designKit, /注册天数/);
});

test("越南语和文案位置贯穿 overview 类型、表单、草稿与发布载荷", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(client, /draftVi\?: string/);
  assert.match(client, /copyPosition\?: string/);
  assert.match(client, /vi: string/);
  assert.match(designKit, /textArea\("vi", "越南语 vi 文案"/);
  assert.match(designKit, /needs\("vi", "越南语文案"\)/);
  assert.match(component, /vi: form\?\.vi/);
  assert.match(component, /copyPosition: form\?\.copyPosition/);
  assert.match(component, /VI ·/);
});

test("I1 文案位置来自后端配置列表，并提供配置增删入口", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(client, /positions: CopyPositionView\[\]/);
  assert.match(client, /createI1CopyPosition:/);
  assert.match(client, /deleteI1CopyPosition:/);
  assert.match(component, /文案位置配置/);
  assert.match(component, /actions\.createI1CopyPosition\(/);
  assert.match(component, /actions\.deleteI1CopyPosition\(/);
  assert.match(component, /positions: COPY_POSITIONS/);
  assert.match(designKit, /select\("copyPosition", "文案位置"/);
});

test("新增和编辑文案使用结构化受众条件，而不是扁平受众字符串", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(designKit, /select\("phaseMin", "最低 P 阶段"/);
  assert.match(designKit, /select\("phaseMax", "最高 P 阶段"/);
  assert.match(designKit, /select\("language", "语言"/);
  assert.match(designKit, /input\("registrationDaysGt", "注册时长大于\(天\)"/);
  assert.match(component, /phaseMin: form\?\.phaseMin/);
  assert.match(component, /phaseMax: form\?\.phaseMax/);
  assert.match(component, /language: form\?\.language/);
  assert.match(component, /registrationDaysGt: Number\(form\?\.registrationDaysGt/);
});

test("I1 文案支持越南语，并固定投放到 App 四个顶级模块", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /home: "首页"/);
  assert.match(component, /store: "商城"/);
  assert.match(component, /earn: "赚取"/);
  assert.match(component, /me: "我的"/);
  assert.match(component, /vi: form\?\.vi/);
  assert.match(designKit, /textArea\("vi", "越南语 vi 文案"/);
  assert.match(designKit, /select\("surface", "投放模块"/);
  assert.doesNotMatch(designKit, /input\("surface", "投放位置 surface"/);
});
