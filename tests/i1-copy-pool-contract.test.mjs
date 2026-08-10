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

test("文案内容历史的状态徽标和状态机只展示中文", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(component, /st === "draft"[\s\S]{0,100}>草稿<\/span>/);
  assert.match(component, /st === "published"[\s\S]{0,100}>已发布<\/span>/);
  assert.match(component, /className="bdg dim">已归档<\/span>/);
  assert.doesNotMatch(component, /className="bdg (?:warn|ok|dim)">(?:draft|published|archived)<\/span>/);
  assert.doesNotMatch(component, /className="st(?: ok)?">(?:draft|published|archived)/);
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

  assert.match(component, /rollbackTo\(copy, row\.v\)/);
  assert.match(component, /archiveCurrentVersion\(copy, row\.v\)/);
  assert.match(component, /editCopy\(copy, row/);
  assert.match(component, /copy\?\.version === row\.v/);
  assert.match(client, /archiveI1Copy: \(copyKey: string, expectedVersion: string, expectedRevision: number, reason: string\)/);
  assert.match(client, /withReason\(\{ expectedVersion, expectedRevision \}, reason\)/);
  assert.match(component, /COPY_VERSIONS\.filter/);
});

test("I1 草稿、发布、回滚、下架和框架参数都携带当前快照做并发保护", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /expectedRevision: c\.revision/);
  assert.match(component, /rollbackI1CopyVersion\(copy\.key, v, copy\.version, copy\.revision, reason\)/);
  assert.match(component, /archiveI1Copy\(copy\.key, version, copy\.revision, reason\)/);
  assert.match(component, /updateI1Framework\(key, v, cur, reason\)/);
  assert.match(client, /rollbackI1CopyVersion: \(copyKey: string, version: string, expectedVersion: string, expectedRevision: number, reason: string\)/);
  assert.match(client, /withReason\(\{ expectedVersion, expectedRevision \}, reason\)/);
  assert.match(client, /withReason\(\{ value, expectedValue \}, reason\)/);
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

test("I1 A/B 实验从同一文案的非草稿版本创建并走真实接口", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /创建 A\/B 实验/);
  assert.match(component, /version\.st\.toLowerCase\(\) !== "draft"/);
  assert.match(component, /kind: "copy-experiment-create"/);
  assert.match(component, /actions\.createI1Experiment\(/);
  assert.match(client, /createI1Experiment:/);
  assert.match(client, /apiRequest\("\/copy-ab\/experiments", \{ method: "POST"/);
  assert.match(client, /createI1Experiment:[\s\S]{0,240}JSON\.stringify\(withReason\(body, reason\)\)/);
  assert.match(component, /variants,[\s\S]{0,120}note/);
  assert.match(component, /splitPct:/);
  assert.match(designKit, /data-business-form="copy-experiment-create"/);
  assert.match(designKit, /选择文案/);
  assert.match(designKit, /type="range"/);
  assert.match(designKit, /分流合计/);
  assert.match(designKit, /至少选择 2 个不同的非草稿内容版本/);
  assert.match(designKit, /分流比例合计必须为 100%/);
});

test("I1 A/B 实验受众只读继承并明确显示预计覆盖人数", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /estimatedAudience/);
  assert.match(designKit, /继承的文案受众/);
  assert.match(designKit, /只读继承/);
  assert.match(designKit, /预计覆盖/);
  assert.match(designKit, /待估算/);
  assert.match(designKit, /所选版本的继承受众必须完全一致/);
  assert.match(designKit, /copyExperimentAudienceSignature/);
  assert.doesNotMatch(designKit, /copy-experiment-create[\s\S]{0,2500}copy-audience-builder/);
});

test("scheduled 实验通过勾选确认和 8-200 字理由后启动", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /st === "scheduled"/);
  assert.match(component, />启动实验<\/button>/);
  assert.match(component, /kind: "copy-experiment-start"/);
  assert.match(component, /actions\.startI1Experiment\(id, reason\)/);
  assert.match(client, /startI1Experiment:/);
  assert.match(client, /\/copy-ab\/experiments\/\$\{encodeURIComponent\(experimentId\)\}\/start/);
  assert.match(client, /startI1Experiment:[\s\S]{0,280}JSON\.stringify\(withReason\(\{\}, reason\)\)/);
  assert.match(designKit, /data-business-form="copy-experiment-start"/);
  assert.match(designKit, /我已确认实验版本、分流比例和继承受众/);
  assert.match(designKit, /activeBusinessForm\?\.kind === "copy-experiment-create"/);
  assert.match(designKit, /activeBusinessForm\?\.kind === "copy-experiment-start"/);
  assert.match(designKit, /activeBusinessForm\?\.kind === "copy-experiment-discard"/);
  assert.match(designKit, /reasonLength <= reasonMax/);
  assert.match(designKit, /maxLength=\{reasonMax\}/);
});

test("I1 创建实验排除已有活动实验的文案，并限制备注长度", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");

  assert.match(component, /ACTIVE_EXPERIMENT_COPY_KEYS/);
  assert.match(component, /state\.toLowerCase\(\) === "scheduled"/);
  assert.match(component, /state\.toLowerCase\(\) === "running"/);
  assert.match(component, /!ACTIVE_EXPERIMENT_COPY_KEYS\.has\(copy\.value\)/);
  assert.match(component, /EXPERIMENT_COPY_CANDIDATES\.length === 0/);
  assert.match(component, /符合条件的文案已有待启动或进行中的实验/);
  assert.match(designKit, /state\.note\?\.length > 255/);
  assert.match(designKit, /实验备注不能超过 255 字/);
  assert.match(designKit, /textArea\("note", "实验备注（可选）", "实验假设、观察指标或停止条件", 2, 255\)/);
});

test("I1 没有可用文案时创建实验按钮仍可点击并解释阻塞原因", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.doesNotMatch(component, /disabled=\{EXPERIMENT_COPY_OPTIONS\.length === 0\}/);
  assert.match(component, /onClick=\{createExperiment\}>\+ 创建 A\/B 实验<\/button>/);
  assert.match(component, /暂无可创建实验的文案：\$\{experimentUnavailableReason\}/);
});

test("I1 已结算和旧 stopped 状态实验保留采纳入口，弃用为终态且错误码有中文恢复指引", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const errors = read("lib/admin/error-messages.ts");

  assert.match(component, /st === "concluded" \|\| st === "stopped"/);
  assert.doesNotMatch(component, /st === "concluded" \|\| st === "discarded"/);
  assert.match(errors, /COPY_EXPERIMENT_ACTIVE_EXISTS:/);
  assert.match(errors, /COPY_EXPERIMENT_NOT_SCHEDULED:/);
  assert.match(errors, /COPY_EXPERIMENT_AUDIENCE_MISMATCH:/);
  assert.match(errors, /COPY_EXPERIMENT_SPLIT_TOTAL_INVALID:/);
  assert.match(errors, /COPY_EXPERIMENT_METADATA_INVALID:/);
  assert.match(errors, /COPY_EXPERIMENT_NO_EXPOSURE:/);
  assert.match(errors, /COPY_EXPERIMENT_MIN_SAMPLE_NOT_MET:/);
  assert.match(errors, /COPY_EXPERIMENT_WINNER_NOT_UNIQUE:/);
  assert.match(errors, /COPY_EXPERIMENT_WINNER_VERSION_INVALID:/);
});

test("I1 实验写操作使用独立权限，普通文案仍使用 content_i1_write", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");

  assert.match(component, /canWrite = isSuperadmin \|\| !!session\?\.authorities\.includes\("content_i1_write"\)/);
  assert.match(component, /canManageExperiments = isSuperadmin \|\| !!session\?\.authorities\.includes\("content_i1_experiment_manage"\)/);
  assert.match(component, /canManageExperiments && <button[\s\S]{0,300}创建 A\/B 实验/);
  assert.match(component, /canManageExperiments && st === "scheduled"/);
  assert.doesNotMatch(component, /canWrite && st === "scheduled"/);
});

test("I1 scheduled 和 concluded 可确认弃用实验并调用真实 discard 接口", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const designKit = read("app/components/domain-views/design-kit.tsx");
  const client = read("lib/admin/i-client.ts");

  assert.match(component, /const discardExp = \(id: string\)/);
  assert.match(component, /st === "scheduled" \|\| st === "concluded"/);
  assert.match(component, />弃用实验<\/button>/);
  assert.match(component, /actions\.discardI1Experiment\(id, reason\)/);
  assert.match(client, /discardI1Experiment:/);
  assert.match(client, /\/copy-ab\/experiments\/\$\{encodeURIComponent\(experimentId\)\}\/discard/);
  assert.match(client, /discardI1Experiment:[\s\S]{0,280}JSON\.stringify\(withReason\(\{\}, reason\)\)/);
  assert.match(designKit, /kind: "copy-experiment-discard"/);
  assert.match(designKit, /activeBusinessForm\?\.kind === "copy-experiment-discard"/);
  assert.match(designKit, /reasonLength <= reasonMax/);
  assert.match(designKit, /maxLength=\{reasonMax\}/);
});

test("I1 转化仅统计服务端已支付或完成订单事件，PRD 使用独立实验权限口径", () => {
  const component = read("app/components/domain-views/i-tabs/i1-copy-ab.tsx");
  const errors = read("lib/admin/error-messages.ts");
  const retiredPrd = read("docs/PRD/Nexion_运营控制后台PRD_v4.md");
  const prd = read("docs/changes/2026-08-07-prd-v4-merged-draft.md");

  assert.match(component, /仅统计服务端已支付\/已完成订单事件/);
  assert.match(component, /点击、加购、客户端自报不计入转化/);
  assert.match(errors, /COPY_EXPERIMENT_NOT_DISCARDABLE:/);
  assert.match(errors, /CONTENT_EXPERIMENT_CONVERSION_INVALID:/);
  assert.match(retiredPrd, /本文件已退役/);
  assert.match(retiredPrd, /NexGrid_运营控制后台PRD_v4\.md/);
  assert.match(prd, /content_i1_experiment_manage/);
  assert.match(prd, /仅统计服务端确认的已支付\/已完成订单事件/);
  assert.doesNotMatch(prd, /增长限增长相关文案位/);
});
