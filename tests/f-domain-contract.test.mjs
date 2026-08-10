import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

/**
 * F 域前后端契约(验收 5.12 F 域三项缺口修复)。
 *
 * 覆盖:F1 V-Rank 晋升 / F2 费率 / F3 双轨 / F4 池·配额·大使·榜 / F5 佣金事件 ——
 *   ① 端点+字段对齐:5 fetcher 派后端 teams/{ranks|rates|binary|leadership-pool|commissions}
 *   ② polymorphic key→op 路由对齐后端 OpsTeamService.replay 4 case 分发
 *   ③ amplifies 默认 + UI key 资金放大集对齐后端 loosensPayoutControlUiKey 真值
 *   ④ F5 佣金事件行带 D4/B1/L4 跨域 CTA
 */
const OPS_ROOT = path.resolve(import.meta.dirname, "..");
const BACKEND_ROOT = path.resolve(OPS_ROOT, "..", "nexion-backend");

function read(root, relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

// 后端 loosensPayoutControlUiKey 静态 switch key 白单(权崴资金放大集)。
// 注:F.unilevel.L{n}/F.unilevel.nex.L{n} 走由 isUnilevelRuleKey 勹缀分支处理,不在此 7 个靕态 key 内。
const BACKEND_LOOSENS_KEYS = [
  "F.binary.matchRate",
  "F.binary.threshold",
  "F.pool.ratio",
  "F.pool.top1MaxPct",
  "F.pool.top5MaxPct",
  "F.pool.periodPrize",
  "F.promo.weekMultiplier",
  "F.peer.rate",
];

// ---------- ① F1-F5 client 端点+字段对齐 ----------

test("F1-F5 admin clients hit canonical team endpoints with idempotency", () => {
  const client = read(OPS_ROOT, "lib/admin/f1-client.ts");
  // 5 读路徍对齐后端 OpsTeamController @RequestMapping /teams/{ranks|rates|binary|leadership-pool|commissions}
  assert.match(client, /\/ranks/);
  assert.match(client, /\/rates/);
  assert.match(client, /\/binary/);
  assert.match(client, /\/leadership-pool/);
  assert.match(client, /\/commissions/);
  // 写路径 /commissions/config/{key}(后端 polymorphic dispatch,commit afe51f2)由 **A2 提案通道**
  // 执行 —— 2026-08-06 清掉了 f1-client 里五个零调用的 updateF*TeamConfig 死函数,前端不再直调该端点。
  // 真源在 f-view.tsx 的 proposeFConfig(下面「proposeFConfig honors per-key fund-amplifies」那条守它)。
  assert.doesNotMatch(client, /updateF\w*TeamConfig/,
    "TeamConfig 死代码复活:全仓零调用,配置写统一走 A2 提案通道");
  // 幂等:每个写函数都必须带稳定命令号(stableIdempotencyKey → Idempotency-Key 头)。
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /F1_WRITE_REQUIRES_STABLE_KEY/,
    "写路径必须硬拒无幂等键的请求 —— 这是删掉现铸后门后唯一的保底闸");
  // 5 fetcher 名(F1-F5 各一条)
  assert.match(client, /export async function fetchF1VRankOverview/);
  assert.match(client, /export async function fetchF2RatesOverview/);
  assert.match(client, /export async function fetchF3BinaryOverview/);
  assert.match(client, /export async function fetchF4LeadershipPoolOverview/);
  assert.match(client, /export async function fetchF5CommissionAuditOverview/);
});

test("F1/F2/F3 writers use durable payload-bound idempotency end to end", () => {
  const client = read(OPS_ROOT, "lib/admin/f1-client.ts");
  const teamService = read(
    BACKEND_ROOT,
    "src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java",
  );
  const binaryController = read(
    BACKEND_ROOT,
    "src/main/java/ffdd/opsconsole/team/web/OpsBinarySettlementController.java",
  );
  const binaryService = read(
    BACKEND_ROOT,
    "src/main/java/ffdd/opsconsole/team/application/BinaryCommissionSettlementService.java",
  );

  assert.match(client, /stableIdempotencyKey/);
  assert.match(client, /\/binary\/settlements/);
  assert.match(binaryController,
    /@RequestHeader\(OpsAdminApi\.IDEMPOTENCY_KEY_HEADER\)\s+String idempotencyKey/);
  assert.match(binaryController, /actor\.username\(\),\s*idempotencyKey/);
  assert.match(binaryService, /"F3_BINARY_SETTLEMENT"/);
  assert.match(binaryService, /requestHash\(ownerUserId,\s*settlementDate,\s*normalizedReason\)/);
  assert.match(binaryService, /idempotencyService\.execute\(/);

  for (const scope of [
    "F1_VRANK_THRESHOLD_UPDATE",
    "F1_VRANK_REWARD_ADD",
    "F1_VRANK_REWARD_UPDATE",
    "F1_VRANK_REWARD_REMOVE",
    "F_TEAM_CONFIG_UPDATE",
  ]) {
    assert.match(teamService, new RegExp(`"${scope}"`));
  }
  assert.match(teamService, /MessageDigest\.getInstance\("SHA-256"\)/);
  assert.match(teamService, /idempotencyService\.execute\(/);
});

test("shared F config endpoint delegates F1 key authorization to exact service mappings", () => {
  const controller = read(
    BACKEND_ROOT,
    "src/main/java/ffdd/opsconsole/team/web/OpsTeamController.java",
  );
  const teamService = read(
    BACKEND_ROOT,
    "src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java",
  );

  assert.match(
    controller,
    /@PreAuthorize\("hasAnyAuthority\([^)]*'network_f1_write'[^)]*\)"\)\s*public ApiResult<Map<String, Object>> updateConfig/,
  );
  for (const key of [
    "F.vrank.leadership.unlockRank",
    "F.vrank.leadership.topN",
    "F.vrank.titles",
    "F.prize.name",
  ]) {
    assert.match(
      teamService,
      new RegExp(`Map\\.entry\\("${key.replaceAll(".", "\\.")}",\\s*"network_f1_write"\\)`),
    );
  }
  assert.match(
    teamService,
    /\^F\\\\\.fulfillment\\\\\.V\(\?:\[1-9\]\|1\[0-2\]\)\\\\\.queue\\\\\.status\$/,
  );
  assert.match(
    teamService,
    /if\s*\(!UI_CONFIG_KEYS\.contains\(key\)\)\s*\{\s*throw new IllegalArgumentException\("Unsupported F team UI config key"\)/,
  );
});

// ---------- ② polymorphic key→op 路由对齐后端 replay 4 case 分发 ----------

test("F domain polymorphic key→op routing mirrors backend replay switch (4 op)", () => {
  const view = read(OPS_ROOT, "app/components/domain-views/f-view.tsx");
  const registry = read(OPS_ROOT, "lib/admin/high-ops-registry.ts");
  const backend = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");

  // 4 op 全部在前端 HIGH_OPS 注册
  for (const op of ["f_config", "f_ui_config", "f_unilevel_rule", "f_commission_status"]) {
    assert.match(registry, new RegExp(`op:\\s*"${op}"`));
  }
  // 后端 replay 4 case 分发(对齐)
  for (const op of ["f_config", "f_ui_config", "f_unilevel_rule", "f_commission_status"]) {
    assert.match(backend, new RegExp(`case "${op}"`));
  }

  // resolveFOp 路由:4 分支都在(resolveFOp 为 F 域 polymorphic 真源)
  assert.match(view, /F\.commission\.[\s\S]*\.status/, "resolveFOp 缺 F.commission.{id}.status 分支");
  // unilevel 勹缀路由(读源文本判断,不过重转义)
  assert.ok(view.includes("unilevel"), "resolveFOp 缺 unilevel 分支");
  assert.ok(view.includes("L\\d+"), "resolveFOp 缺 unilevel L{n} 正则");
  // ACTIVE_KEYS 裸名 → f_config(对齐后端 ACTIVE_KEYS Set.of)
  assert.match(view, /directRoyaltyPct/);
  assert.match(view, /hardwareQuotaPerRank/);
});

// ---------- ③ HIGH_OP amplifies 默认 + UI key 脄金放大集对齐 ----------

test("F-domain HIGH_OP amplifies defaults match backend semantics", () => {
  const registry = read(OPS_ROOT, "lib/admin/high-ops-registry.ts");
  // f_config(资金政策)amplifies=true · type=fund(非贪婪限同块)
  assert.match(registry, /op:\s*"f_config"[\s\S]*?amplifies:\s*true[\s\S]*?type:\s*"fund"/);
  // f_ui_config(toggle/文案)amplifies=false · type=param
  assert.match(registry, /op:\s*"f_ui_config"[\s\S]*?amplifies:\s*false[\s\S]*?type:\s*"param"/);
  // f_unilevel_rule(费率)amplifies=true · type=fund
  assert.match(registry, /op:\s*"f_unilevel_rule"[\s\S]*?amplifies:\s*true[\s\S]*?type:\s*"fund"/);
  // f_commission_status(动资金)amplifies=true · type=fund
  assert.match(registry, /op:\s*"f_commission_status"[\s\S]*?amplifies:\s*true[\s\S]*?type:\s*"fund"/);
});

test("F_FUND_AMPLIFYING_UI_KEYS mirrors backend loosensPayoutControlUiKey whitelist", () => {
  const registry = read(OPS_ROOT, "lib/admin/high-ops-registry.ts");
  const backend = read(BACKEND_ROOT, "src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");

  // 抽 F_FUND_AMPLIFYING_UI_KEYS 集合体(从 Set([ 到 ]))
  const setMatch = registry.match(/F_FUND_AMPLIFYING_UI_KEYS[\s\S]*?\]/);
  assert.ok(setMatch, "未找到 F_FUND_AMPLIFYING_UI_KEYS 集合");
  const setBlock = setMatch[0];

  // 后端 loosensPayoutControlUiKey 的 7 个靕态 key 全部在前端集合,且后端确实判这些 key 为资金放大
  for (const k of BACKEND_LOOSENS_KEYS) {
    assert.ok(setBlock.includes(k), `前端资金放大集缺 ${k}`);
    // 后端 loosensPayoutControlUiKey switch 里必须出现该 key(switch 表达式形如 case "F.xxx" 或 "F.xxx" ->)
    assert.ok(backend.includes(k), `后端 loosensPayoutControlUiKey 未提及 ${k}`);
  }
  // unilevel 费由 isFFundAmplifyingKey 勹缀覆盖
  assert.match(registry, /isFFundAmplifyingKey/);
  assert.ok(registry.includes("unilevel"), "isFFundAmplifyingKey 缺 unilevel 勹缀分支");

  // toggle/文案 key 不应出现在资金放大集(只断显🔥 的放大动作)
  for (const toggle of ["F.binary.paused", "F.leaderboard.paused", "F.leaderboard.minUsd"]) {
    assert.ok(!setBlock.includes(toggle), `toggle key ${toggle} 不应在 F_FUND_AMPLIFYING_UI_KEYS:${setBlock.slice(0, 300)}`);
  }
});

// ---------- ④ F5 佣金事件行跨域 CTA ----------

test("F5 commission event rows carry D4/B1/L4 cross-domain CTA links", () => {
  const ui = read(OPS_ROOT, "app/components/domain-views/f-tabs/f5-audit.tsx");
  const nav = read(OPS_ROOT, "lib/nav/console-nav.ts");
  // 3 条跨域链接对齐 console-nav 真路由(D4=/finance/ledger, B1=/overview/dual-ledger, L4=/analytics/operations)
  assert.match(nav, /id:\s*"D4"[\s\S]*?path:\s*"\/finance\/ledger"/);
  assert.match(nav, /id:\s*"B1"[\s\S]*?path:\s*"\/overview\/dual-ledger"/);
  assert.match(nav, /id:\s*"L4"[\s\S]*?path:\s*"\/analytics\/operations"/);
  // f5-audit.tsx 实际使用 3 条路南
  assert.match(ui, /\/finance\/ledger\?bizNo=/);
  assert.match(ui, /\/overview\/dual-ledger/);
  assert.match(ui, /\/analytics\/operations/);
  // D4 必须使用后端返回的真实账本业务号,不能把 CM-* 佣金号伪装成账本号。
  assert.match(ui, /encodeURIComponent\(row\.ledgerBizNo\)/);
  assert.doesNotMatch(ui, /finance\/ledger\?bizNo=\$\{encodeURIComponent\(row\.id\)\}/);
  // Link 导入
  assert.match(ui, /from "next\/link"/);
});

// ---------- 缺口 ② proposeFConfig 资金放大 override ----------

test("proposeFConfig honors per-key fund-amplifies override (缺口 ②)", () => {
  const view = read(OPS_ROOT, "app/components/domain-views/f-view.tsx");
  // proposeFConfig 必须导入并调用 isFFundAmplifyingKey,使弹窗与 A2 队列一致显🔥
  assert.match(view, /isFFundAmplifyingKey/);
  // isFFundAmplifyingKey(key) || def.amplifies(JS 逻辑或双竖线)
  assert.match(view, /amplifies:\s*isFFundAmplifyingKey\(key\)\s*\|\|\s*def\.amplifies/);
});
