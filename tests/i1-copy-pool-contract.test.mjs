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

test("编辑表单复用已有草稿版本或交给服务器生成新版本，并保留当前受众与分流条件", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /version: editingExistingDraft \? editableVersion\?\.v \|\| "" : ""/);
  assert.match(designKit, /version: spec\.version \|\| spec\.versionOptions\?\.\[0\]\?\.value \|\| ""/);
  assert.doesNotMatch(component, /nextCopyVersion/);
  assert.match(component, /audience: editableVersion\?\.audience/);
  assert.match(component, /trafficSplit: editableVersion\?\.trafficSplit/);
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
  assert.match(component, /<b>VI<\/b> ·/);
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

test("内容历史覆盖全部文案，而不是固定展示单个文案位", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(component, /文案内容历史\(b\)/);
  assert.match(component, /data-proof="copy-version-list"/);
  assert.match(component, /pagedVersions\.map/);
  assert.match(component, /版本状态/);
  assert.match(component, /文案位置/);
  assert.match(component, /中英越文案/);
  assert.doesNotMatch(component, /版本详情\(b\).*home\.conversionBanner/);
  assert.doesNotMatch(component, /const HCB = "home\.conversionBanner"/);
});

test("文案版本配置位于文案池之前，并提供真实 CRUD 接口", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.ok(component.indexOf('data-proof="copy-version-catalog"') < component.indexOf('data-proof="copy-pool"'));
  assert.match(component, /\+ 新增版本/);
  assert.match(component, /actions\.createI1CopyVersionOption\(/);
  assert.match(component, /actions\.updateI1CopyVersionOption\(/);
  assert.match(component, /actions\.deleteI1CopyVersionOption\(/);
  assert.match(client, /createI1CopyVersionOption:/);
  assert.match(client, /updateI1CopyVersionOption:/);
  assert.match(client, /deleteI1CopyVersionOption:/);
  assert.match(client, /\/copy-ab\/version-options/);
});

test("新增文案和新增内容版本必须从启用的文案版本配置中选择", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /versionOptions: ACTIVE_VERSION_OPTIONS/);
  assert.match(component, /version: form\.version/);
  assert.match(designKit, /select\("version", "文案版本"/);
  assert.match(designKit, /needs\("version", "文案版本"\)/);
  assert.doesNotMatch(designKit, /input\("version", "首版版本号"/);
  assert.doesNotMatch(designKit, /首版版本号/);
  assert.doesNotMatch(designKit, /系统自动生成/);
  assert.doesNotMatch(component, /首版版本号/);
  assert.match(component, /disabled=\{ACTIVE_VERSION_OPTIONS\.length === 0\}/);
  assert.match(component, /disabled=\{!hasUnusedActiveVersion\}/);
  assert.match(component, /请先新增或启用文案版本/);
  assert.match(component, /copy\.usedVersionKeys \?\? COPY_VERSIONS/);
  assert.match(client, /usedVersionKeys\?: string\[\]/);
});

test("版本列表上的回滚、下架和新增版本操作按实际文案标识执行", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /rollbackTo\(row\.copyKey, row\.v\)/);
  assert.match(component, /archiveCurrentVersion\(row\.copyKey, row\.v\)/);
  assert.match(component, /editCopy\(copy, row/);
  assert.match(component, /copy\?\.version === row\.v/);
  assert.match(client, /archiveI1Copy: \(copyKey: string, expectedVersion: string, reason: string\)/);
  assert.match(client, /withReason\(\{ expectedVersion \}, reason\)/);
  assert.match(component, /COPY_VERSIONS\.filter/);
});

test("版本列表只允许删除草稿版本，并通过独立 DELETE 接口保留理由审计", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(client, /deleteI1CopyDraft: \(copyKey: string, version: string, revision: number, reason: string\) => Promise<void>/);
  assert.match(client, /deleteI1CopyDraft: \(copyKey, version, revision, reason\) => apiRequest\(`\/copy-ab\/copies\/\$\{encodeURIComponent\(copyKey\)\}\/versions\/\$\{encodeURIComponent\(version\)\}`, \{ method: "DELETE", body: JSON\.stringify\(withReason\(\{ expectedVersion: version, expectedRevision: revision \}, reason\)\) \}\)/);
  assert.match(component, /const deleteDraftVersion = \(copyKey: string, version: string, revision: number\) => openActionConfirm\(/);
  assert.match(component, /只有草稿版本可以删除/);
  assert.match(component, /删除后不可恢复/);
  assert.match(component, /保留审计/);
  assert.match(component, /actions\.deleteI1CopyDraft\(copyKey, version, revision, reason\)/);
  assert.match(component, /deleteInFlightRef\.current/);
  assert.match(component, /canWrite && status === "draft" && copy\?\.draftVersion === row\.v[\s\S]*?className="l-btn sm dgr"[\s\S]*?删除草稿/);
  assert.match(component, /disabled=\{deletingDraftKey !== null\}/);
  assert.doesNotMatch(component, /status === "published"[\s\S]{0,250}>删除草稿<\/button>/);
  assert.doesNotMatch(component, /status === "archived"[\s\S]{0,250}>删除草稿<\/button>/);
});

test("版本列表提供真实分页、摘要展示和筛选可访问状态", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(component, /VERSION_PAGE_SIZE = 20/);
  assert.match(component, /pagedVersions/);
  assert.match(component, /上一页/);
  assert.match(component, /下一页/);
  assert.match(component, /aria-pressed=\{versionStatusFlt === key\}/);
  assert.match(component, /textOverflow: "ellipsis"/);
  assert.doesNotMatch(component, /maxRows: COPY_VERSIONS\.length/);
});

test("I1 写按钮按后端 authority 隐藏，并明确展示继承受众覆盖状态", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(component, /useAdminAuth/);
  assert.match(component, /content_i1_write/);
  assert.match(component, /content_i1_copy_create/);
  assert.match(component, /canWrite &&/);
  assert.match(component, /预计覆盖/);
  assert.match(component, /实验启动快照/);
});
