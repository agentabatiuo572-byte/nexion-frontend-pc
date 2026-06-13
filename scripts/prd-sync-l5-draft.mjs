#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const apply = args.has("--apply");
const ownerConfirmed = args.has("--owner-confirmed");
const json = args.has("--json");
const patchToStdout = args.has("--patch");
const applyCheck = args.has("--apply-check");
const patchFileArg = rawArgs.find((arg) => arg.startsWith("--patch-file="));
const patchFile = patchFileArg ? patchFileArg.slice("--patch-file=".length) : null;

if (apply && !ownerConfirmed) {
  throw new Error("Refusing to edit canonical PRD without --owner-confirmed.");
}
if (apply && applyCheck) {
  throw new Error("Refusing to combine --apply-check with --apply; run the check before confirmed apply.");
}

const adminRoot = process.cwd();
const planRoot = path.resolve(adminRoot, "..");
const prdRoot = path.join(planRoot, "PRD");

const targets = {
  product: path.join(prdRoot, "Nexion_产品功能架构设计文档_v3.7.md"),
  opsDev: path.join(prdRoot, "Nexion_运营控制后台_开发落地规格.md"),
  opsV4: path.join(prdRoot, "Nexion_运营控制后台PRD_v4.md"),
  opsConfirm: path.join(prdRoot, "Nexion_运营后台_交互与确认机制改写SPEC.md"),
};

const productRouteCoverage = `
#### UniApp 交付主体路由覆盖

用户端交付主体为 \`Nexion-uniapp\`。截至 L5 终验,Next.js 参考源 80 个路由已全部映射到 UniApp 81 个 pages;唯一新增页为 \`/onboarding/terms\`,用于承接服务条款确认。Next.js 版本仅作为行为参考源保留,后续业务验收以 UniApp 路由覆盖、i18n 镜像、运行时动作 proof 与三端 canon gate 为准。

验收口径:
- Next reference routes:80/80 covered.
- UniApp pages:81 pages.
- 路由缺口:0.
- 阻断类动作缺口:0.
`;

const kycTopupLoop = `
KYC-Express 与充值共用 \`/me/wallet/topup?kyc=1\` 入口。用户从提现触发 KYC 时,top-up 页面必须显示 KYC 状态、验证金额、当前链路和验证完成后的提现解锁说明;完成后返回提现流程继续填写网络、地址、金额与风险披露确认。
`;

const topupWriteRules = `
#### 9.2.5 充值记录写入规则

- regular top-up 写入钱包账单,保留 channel / network / amount / txHash / status。
- KYC top-up 同步写入 KYC verification 状态,并把已验证钱包地址作为提现地址一致性校验依据。
- 充值页必须区分 regular top-up 与 KYC-Express top-up,不得只展示静态说明。
`;

const withdrawClosure = `
#### 9.3.1a 提现提交闭环

- 未 KYC 用户先进入 KYC-Express,完成后回到提现页继续提交。
- 提现提交必须生成 tracking record、wallet bill 与 contribution points 事件。
- \`/me/wallet/withdraw/tracking\` 必须展示 pending / review / paid / rejected 等状态轨迹,并允许从 bill hash 反查。
`;

const teamFinanceControls = `
### 8.1.3 Team finance controls

- Commissions:展示 5 类佣金事件明细,入口必须可从 Team 主页到达。
- V Rank:展示 V0-V12 进度、晋升条件、维持期与奖品/培育奖。
- Balance Match:展示双轨 balance、弱区/强区、日封顶与 spillover 逻辑。
- Leadership Pool:展示全球领导奖池、参与资格、分配周期与说明页。

以上四入口不得为占位按钮;点击后必须进入对应业务页面或任务式说明页,并保留 i18n copy。
`;

const exchangeConfirmation = `
#### 9.4.1a 兑换确认与写入

NEX↔USDT 兑换确认必须展示 from/to amount、rate、fee、KYC/cap 状态与兑换后余额预估。确认后写入 swap record、wallet bill 与 points/cap 变化;失败时不得只 toast,必须保留原余额并展示失败原因。
`;

const repurchaseConfirmation = `
#### 9.5.3a 复投确认与写入

复投确认必须展示复投金额、获得 points、进入 stake/cap 的影响与账单摘要。确认后写入 repurchase event、wallet bill、points delta 与 active stake/cap 变化。
`;

const stakingConfirmation = `
#### 9.6.2a 开仓确认与写入

Staking 开仓必须展示档位 APY、锁期、提前退出 penalty、预计收益和最小质押额。确认后写入 active position 与 wallet bill;用户端展示值必须与后台 G1 参数源一致。
`;

const canonUnderBackendParams = `
#### 9.11c.3 核心数字口径三端同源

- staking:APY / penalty / minStake / lockDays。
- Genesis:slot price $24.08、年化 87.9%、royalty/dividend、一级/二级市场开关。
- 设备生命周期:decay -4% / -6% / -23.7%, floor 22%, salvage formula。
- 商品与收益:SKU price、daily earning、route threshold、trial price。
- Team:unilevel 7 层、V Rank 条件、binary cap、leadership pool rule。
- Wallet:withdraw min / fee / cap / KYC gate。

任何端修改上述数字必须同步更新机读 canon source,否则验收失败。
`;

const canonUnderRules = `
#### 13.3.0 核心数字口径锁定

核心数字口径以机读 canon source 为三端共同锚点。staking、Genesis、设备生命周期、商品收益、Team 规则与 Wallet 限额/费用/cap/KYC gate 任何一端发生变更时,必须同步更新 canon source 并通过三端口径 gate;否则不得进入验收。
`;

const i18nAcceptance = `
### 14.5 i18n 验收规则

- zh/en key mirror 必须 0 diff。
- 语言切换必须在 top-up、staking、team、wallet 等核心业务页即时改变可见 copy。
- 用户可见文本不得出现裸 key、mock/demo/simulated/fake 等开发态词。
- 新增业务页必须先补双语 key,再进入验收。
`;

const businessModalContract = `
### 0.3a 业务弹窗契约

- 每个弹窗必须声明 trigger、business target、required input、validation、write action、audit reason、success feedback、persisted echo。
- 弹窗内容必须匹配按钮语义:改角色必须有 role selector;改授权必须有 permission diff;编辑文案必须有 zh/en 字段;创建课程必须有 title/body/category/duration;提现处置必须有 approve/reject/delay/freeze 业务选项。
- 只有 reason textarea 的 edit/create/repair/role/permission/action 弹窗视为 business-incomplete-modal。
- 纯展示弹窗必须显式标 readonly,不得出现可执行主按钮。
- 高敏动作仍使用 confirm-with-reason 外壳,但业务表单体必须在确认外壳内可操作。
`;

const listCapabilityBaseline = `
## 第 8A 章 全后台列表能力基线

- 数据列表必须提供分页或显式小表豁免。
- 默认五件套:pagination、search、filter、sort/status、empty state。
- 小表豁免只允许用于固定短列表、配置摘要、KPI 摘要;豁免必须在页面或规格中声明理由。
- 资金、提现、账单、工单、用户、审计、内容记录类列表不得豁免分页。
`;

const supportDevSpec = `
### 9.9a /content/support 支持后台

- FAQ 管理:创建、编辑、发布、下架、排序、分类。
- Ticket 分类/SLA:category、priority、owner、SLA target。
- 工单处理:回复、关闭、重开、改 owner、改 priority、写 audit reason。
- 工单列表必须支持分页、搜索、状态筛选、owner/priority 筛选和空态。
- 所有写动作必须刷新后仍可见,并写入 audit feed。
`;

const ownerLinkSpec = `
### 4.15 平台参数寄存器 owner-link

平台参数寄存器只做索引和导航,不复制 owner module 的权威配置表。每个参数必须有 owner domain、owner module、canonical field、read source、write route 与 owner-link。用户从参数寄存器点击 owner-link 后,必须能进入 owner 页面完成真实业务操作;例如 G1 staking APY/penalty/minStake 的写入口归 G1 owner module,寄存器只展示并跳转。
`;

const prdGovernanceDevSpec = `
## 第 10 章 PRD canonical 治理

- 产品 PRD canonical 路径固定为 \`D:\\WORKS\\PLAN\\PRD\\Nexion_产品功能架构设计文档_v3.7.md\`。
- 运营后台 canonical 文档固定为 \`D:\\WORKS\\PLAN\\PRD\\Nexion_运营控制后台PRD_v4.md\` 与 \`D:\\WORKS\\PLAN\\PRD\\Nexion_运营控制后台_开发落地规格.md\`。
- \`_bak/\`、\`_bakF/\`、remediation backups 不参与唯一性判断。
- hook、verify gate 与同步流程只认 canonical 文件。
`;

const supportV4 = `
#### [I6a] Support CMS / Ticket Ops

**① 目的 & 对齐**
管理 \`/content/support\` 的 FAQ 与工单运营面,覆盖 FAQ 内容、Ticket 分类/SLA、回复、关闭、重开、owner/priority 调整与审计理由。用户端对应 \`/me/help\`、\`/me/support\`、\`/me/support/tickets\`。

**② 后台界面**
- FAQ 列表与详情:标题、分类、语言、状态、排序、版本。
- Ticket 列表:ticketId、用户、category、priority、owner、SLA、状态、最近回复。
- Ticket 详情:会话历史、内部备注、owner/priority 操作区、关闭/重开操作区。

**③ 可控参数**
- FAQ category、排序、发布状态。
- Ticket category、priority、owner、SLA target。

**④ 操作动作**
- FAQ 创建/编辑/发布/下架/排序。
- 工单回复、关闭、重开、改 owner、改 priority,均写 audit reason。

**⑤ 接口**
- \`GET /api/admin/support/faqs\`
- \`PUT /api/admin/support/faqs/:id\`
- \`GET /api/admin/support/tickets\`
- \`POST /api/admin/support/tickets/:id/reply\`
- \`PUT /api/admin/support/tickets/:id/status\`
- \`PUT /api/admin/support/tickets/:id/owner\`
- \`PUT /api/admin/support/tickets/:id/priority\`

**⑥ 权限 & 审计**
内容/客服可处理 FAQ 与工单;内容 lead/客服 lead/超管可关闭、重开、改 owner/priority。所有写动作落 A2 审计。

**⑦ 风控 & 联动**
工单 owner/priority/SLA 只影响客服运营,不改变资金或风控判定;涉及提现/KYC 的工单需跳转 D2/K5 owner module 处理。

**⑧ 埋点(事件)**
\`admin.support_faq_updated\`、\`admin.support_ticket_replied\`、\`admin.support_ticket_closed\`、\`admin.support_ticket_owner_changed\`。
`;

const prdGovernanceV4 = `
### 17.5a PRD canonical 治理

- 产品 PRD canonical 路径固定为 \`D:\\WORKS\\PLAN\\PRD\\Nexion_产品功能架构设计文档_v3.7.md\`。
- 运营后台 canonical 文档固定为 \`D:\\WORKS\\PLAN\\PRD\\Nexion_运营控制后台PRD_v4.md\` 与 \`D:\\WORKS\\PLAN\\PRD\\Nexion_运营控制后台_开发落地规格.md\`。
- \`_bak/\`、\`_bakF/\`、remediation backups 不参与唯一性判断。
- hook、verify gate 与同步流程只认 canonical 文件。
`;

const businessModalTemplateSpec = `
### 2.2a 业务弹窗契约

弹窗内容必须匹配触发按钮的业务语义。改角色必须有角色选择;改授权必须有权限 diff;编辑文案必须有 en/zh 或对应业务字段;创建课程必须有 title/body/category/duration;提现处置必须有 approve/reject/delay/freeze 业务选项。只有 reason textarea 的 edit/create/repair/role/permission/action 弹窗视为 business-incomplete-modal。纯展示弹窗必须显式 readonly,不得出现可执行主按钮。
`;

const operations = [
  { id: "product.route.uniappCoverage", file: "product", type: "insertBefore", anchor: "\n## 4. 账户与身份", content: productRouteCoverage },
  { id: "product.kyc.topupLoop", file: "product", type: "insertBefore", anchor: "\n#### 4.4.3 验证后特权", content: kycTopupLoop },
  { id: "product.wallet.topupWriteRules", file: "product", type: "insertBefore", anchor: "\n### 9.3 提现 `/me/wallet/withdraw`", content: topupWriteRules },
  { id: "product.wallet.withdrawClosure", file: "product", type: "insertBefore", anchor: "\n#### 9.3.2 贡献积分门槛", content: withdrawClosure },
  { id: "product.team.financeControls", file: "product", type: "insertBefore", anchor: "\n### 8.2 V 级头衔体系 `/team/rank`", content: teamFinanceControls },
  { id: "product.wallet.exchangeConfirmation", file: "product", type: "insertBefore", anchor: "\n#### 9.4.2 风控参数", content: exchangeConfirmation },
  { id: "product.wallet.repurchaseConfirmation", file: "product", type: "insertBefore", anchor: "\n#### 9.5.4 玩法说明页 `/me/wallet/repurchase/how-it-works`", content: repurchaseConfirmation },
  { id: "product.wallet.stakingConfirmation", file: "product", type: "insertBefore", anchor: "\n#### 9.6.3 玩法说明页 `/staking/how-it-works`", content: stakingConfirmation },
  { id: "product.params.canonUnderBackendParams", file: "product", type: "insertBefore", anchor: "\n### 9.11d Admin Kill Switch + Client-tamper Defense", content: canonUnderBackendParams },
  { id: "product.rules.canonLock", file: "product", type: "insertBefore", anchor: "\n#### 13.3.1 Staking 产品分类", content: canonUnderRules },
  { id: "product.i18n.heading.15_1", file: "product", type: "replace", search: "### 15.1 支持语言", replacement: "### 14.1 支持语言" },
  { id: "product.i18n.heading.15_2", file: "product", type: "replace", search: "### 15.2 实现", replacement: "### 14.2 实现" },
  { id: "product.i18n.heading.15_3", file: "product", type: "replace", search: "### 15.3 命名空间", replacement: "### 14.3 命名空间" },
  { id: "product.i18n.heading.15_4", file: "product", type: "replace", search: "### 15.4 切换机制", replacement: "### 14.4 切换机制" },
  { id: "product.i18n.acceptance", file: "product", type: "insertBefore", anchor: "\n## 15. 非功能需求", content: i18nAcceptance },
  { id: "opsDev.modal.businessContract", file: "opsDev", type: "insertBefore", anchor: "\n### 0.4 Idempotency-Key", content: businessModalContract },
  { id: "opsDev.list.baseline", file: "opsDev", type: "insertBefore", anchor: "\n## 第 9 章 弹窗交互规格总表", content: listCapabilityBaseline },
  { id: "opsDev.support.surface", file: "opsDev", type: "insertBefore", anchor: "\n### 9.10 J 紧急与合规控制", content: supportDevSpec },
  { id: "opsDev.params.ownerLink", file: "opsDev", type: "insertBefore", anchor: "\n### 4.X 易混淆 / 校验铁律", content: ownerLinkSpec },
  { id: "opsDev.prd.governance", file: "opsDev", type: "insertBefore", anchor: "\n## 附:与原 4 卷 PRD 的关系 + 维护约定", content: prdGovernanceDevSpec },
  { id: "opsV4.support.surface", file: "opsV4", type: "insertBefore", anchor: "\n#### [I7] 教程中心", content: supportV4 },
  { id: "opsV4.prd.governance", file: "opsV4", type: "insertBefore", anchor: "\n### 17.6 开放 PM 决议清单", content: prdGovernanceV4 },
  { id: "opsConfirm.modal.businessContract", file: "opsConfirm", type: "insertBefore", anchor: "\n### 2.3 完整范本", content: businessModalTemplateSpec },
];

function normalizeBlock(block) {
  return `\n${block.trim()}\n`;
}

function applyOperation(text, op) {
  if (op.type === "replace") {
    if (text.includes(op.replacement)) {
      return { text, status: "already-present" };
    }
    if (!text.includes(op.search)) {
      return { text, status: "missing-anchor" };
    }
    return { text: text.replace(op.search, op.replacement), status: "planned" };
  }

  const content = normalizeBlock(op.content);
  if (text.includes(content.trim())) {
    return { text, status: "already-present" };
  }
  if (!text.includes(op.anchor)) {
    return { text, status: "missing-anchor" };
  }
  if (op.type === "insertBefore") {
    return { text: text.replace(op.anchor, `${content}${op.anchor}`), status: "planned" };
  }
  if (op.type === "insertAfter") {
    return { text: text.replace(op.anchor, `${op.anchor}${content}`), status: "planned" };
  }
  throw new Error(`Unknown operation type: ${op.type}`);
}

function makePatch(originalTexts, changedTexts) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "nexion-prd-sync-"));
  const chunks = [];
  try {
    for (const [key, target] of Object.entries(targets)) {
      const fileName = path.basename(target);
      const beforePath = path.join(tempRoot, `${key}.before.md`);
      const afterPath = path.join(tempRoot, `${key}.after.md`);
      fs.writeFileSync(beforePath, originalTexts.get(key), "utf8");
      fs.writeFileSync(afterPath, changedTexts.get(key), "utf8");
      try {
        execFileSync(
          "git",
          [
            "-c",
            "core.autocrlf=false",
            "diff",
            "--no-index",
            "--no-color",
            beforePath,
            afterPath,
          ],
          { encoding: "utf8" }
        );
      } catch (error) {
        if (error.status === 1 && error.stdout) {
          const beforeSlash = beforePath.replace(/\\/g, "/");
          const afterSlash = afterPath.replace(/\\/g, "/");
          const beforeLabel = `a/PRD/${fileName}`;
          const afterLabel = `b/PRD/${fileName}`;
          let diff = error.stdout;
          diff = diff
            .split(/\r?\n/)
            .map((line) => {
              if (line.startsWith("diff --git ")) return `diff --git ${beforeLabel} ${afterLabel}`;
              if (line.startsWith("--- ")) return `--- ${beforeLabel}`;
              if (line.startsWith("+++ ")) return `+++ ${afterLabel}`;
              return line;
            })
            .join("\n")
            .split(`a/${beforeSlash}`)
            .join(beforeLabel)
            .split(`b/${afterSlash}`)
            .join(afterLabel)
            .split(beforeSlash)
            .join(beforeLabel)
            .split(afterSlash)
            .join(afterLabel);
          chunks.push(diff.trimEnd());
          continue;
        }
        throw error;
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
  return chunks.join("\n\n");
}

function assertInside(parent, child) {
  const relative = path.relative(parent, child);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside workspace: ${child}`);
  }
}

function checkPatchApplies(patch) {
  const tempName = `__tmp_prd_apply_check_${process.pid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  const tempRoot = path.join(adminRoot, tempName);
  assertInside(adminRoot, tempRoot);
  fs.mkdirSync(path.join(tempRoot, "PRD"), { recursive: true });
  try {
    for (const target of Object.values(targets)) {
      fs.copyFileSync(target, path.join(tempRoot, "PRD", path.basename(target)));
    }
    execFileSync("git", ["apply", "--check", `--directory=${tempName}`, "-"], {
      cwd: adminRoot,
      encoding: "utf8",
      input: `${patch}\n`,
    });
    return "passed";
  } finally {
    assertInside(adminRoot, tempRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

const fileTexts = new Map();
const originalTexts = new Map();
for (const [key, target] of Object.entries(targets)) {
  const text = fs.readFileSync(target, "utf8");
  fileTexts.set(key, text);
  originalTexts.set(key, text);
}

const results = [];
for (const op of operations) {
  const before = fileTexts.get(op.file);
  const { text, status } = applyOperation(before, op);
  fileTexts.set(op.file, text);
  results.push({ id: op.id, file: op.file, status });
}

const missing = results.filter((r) => r.status === "missing-anchor");
if (apply && missing.length > 0) {
  throw new Error(`Refusing to apply with missing anchors: ${missing.map((r) => r.id).join(", ")}`);
}

if (apply) {
  for (const [key, text] of fileTexts) {
    fs.writeFileSync(targets[key], text, "utf8");
  }
}

let patch = "";
let applyCheckStatus = null;
if ((patchToStdout || patchFile || applyCheck) && missing.length === 0) {
  patch = makePatch(originalTexts, fileTexts);
  if (patchFile) {
    const patchPath = path.resolve(adminRoot, patchFile);
    fs.mkdirSync(path.dirname(patchPath), { recursive: true });
    fs.writeFileSync(patchPath, `${patch}\n`, "utf8");
  }
  if (applyCheck) {
    applyCheckStatus = patch.trim().length > 0 ? checkPatchApplies(patch) : "not-needed";
  }
}

const summary = {
  mode: apply ? "apply" : "dry-run",
  targetRoot: prdRoot,
  operations: results.length,
  planned: results.filter((r) => r.status === "planned").length,
  alreadyPresent: results.filter((r) => r.status === "already-present").length,
  missingAnchors: missing.length,
  patchFile: patchFile ? path.resolve(adminRoot, patchFile) : null,
  patchBytes: patch ? Buffer.byteLength(patch, "utf8") : 0,
  applyCheck: applyCheckStatus,
  results,
};

if (patchToStdout) {
  console.log(patch);
} else if (json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(`# PRD Sync L5 ${summary.mode}`);
  console.log(`targetRoot: ${summary.targetRoot}`);
  console.log(`operations: ${summary.operations}`);
  console.log(`planned: ${summary.planned}`);
  console.log(`alreadyPresent: ${summary.alreadyPresent}`);
  console.log(`missingAnchors: ${summary.missingAnchors}`);
  if (summary.patchFile) console.log(`patchFile: ${summary.patchFile}`);
  if (summary.patchBytes) console.log(`patchBytes: ${summary.patchBytes}`);
  if (summary.applyCheck) console.log(`applyCheck: ${summary.applyCheck}`);
  for (const r of results) {
    console.log(`- ${r.status}: ${r.id} (${r.file})`);
  }
}

process.exit(missing.length > 0 ? 2 : 0);
