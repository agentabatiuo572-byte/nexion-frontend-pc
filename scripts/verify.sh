#!/usr/bin/env bash
# Nexion 运营后台 — 回测 tripwire。
# tsc + nav 全路由 HTTP200 + 脚手架 needle(规格就绪) + 旗舰 needle。
# 路由清单由 nav-routes.mjs 从 console-nav.ts 自动生成(单一真源)。
# 用法:bash scripts/verify.sh [all]   dev server 须在 :3002。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BASE="${ADMIN_BASE:-http://localhost:3002}"
pass=0; fail=0; fails=""

# Windows npm 会命中 System32\bash.exe(WSL bash):非 login shell 可能找不到 node,
# 且 WSL curl 访问 Windows localhost 会返回 000。这里显式补齐工具路径。
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
NODE_BIN="${NODE_BIN:-node}"
if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "  ✗ node not found in bash PATH"; exit 1
fi
CURL_BIN="${CURL_BIN:-curl}"
if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v curl.exe >/dev/null 2>&1; then
  CURL_BIN="curl.exe"
fi
WALKTHROUGH_TIMEOUT="${VERIFY_WALKTHROUGH_TIMEOUT:-180}"

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${seconds}s" "$@"
  else
    "$@"
  fi
}

check_http() {
  local code
  code=$("$CURL_BIN" -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE$1")
  if [ "$code" = "200" ]; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [http $code] $1"; fi
}
check_html() {
  if "$CURL_BIN" -s --max-time 10 "$BASE$1" | grep -qF "$2"; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [needle] $1 :: $2"; fi
}
# 负向探针:断言某串「已不在」页面(删卡后防回归);命中 = FAIL。
check_absent() {
  if "$CURL_BIN" -s --max-time 10 "$BASE$1" | grep -qF "$2"; then fail=$((fail+1)); fails="$fails\n  [should-be-absent] $1 :: $2"; else pass=$((pass+1)); fi
}
check_gone() {
  local code
  code=$("$CURL_BIN" -s -o /dev/null -w "%{http_code}" --max-time 10 "$BASE$1")
  if [ "$code" = "404" ]; then pass=$((pass+1)); else fail=$((fail+1)); fails="$fails\n  [should-be-404 $code] $1"; fi
}

echo "== [1/4] tsc =="
# 注:不能用 `tsc | tail`,管道退出码是 tail 的(0)会吞掉 tsc 失败。捕获输出 + 退出码。
tsc_out=$(cd "$ROOT" && npx --no-install tsc --noEmit 2>&1)
tsc_code=$?
if [ "$tsc_code" -eq 0 ]; then
  echo "  tsc 0 errors"
else
  echo "  TSC FAILED:"; echo "$tsc_out" | tail -12; exit 1
fi

echo "== [1.5/4] E6 SPEC-2 source contract =="
if (cd "$ROOT" && "$NODE_BIN" - <<'NODE'
const fs = require("fs");
const design = fs.readFileSync("app/components/domain-views/design-kit.tsx", "utf8");
const e6 = fs.readFileSync("app/components/domain-views/e-tabs/e6-compute-config.tsx", "utf8");
const eView = fs.readFileSync("app/components/domain-views/e-view.tsx", "utf8");
const cfg = fs.readFileSync("lib/mock/admin/compute-config.ts", "utf8");
const css = fs.readFileSync("app/components/domain-views/e-domain.css", "utf8");
const reg = fs.readFileSync("lib/admin/registry/e.ts", "utf8");
const fail = [];
const source = [design, e6, eView, cfg, css].join("\n");
const must = [
  ["gpu tier table rendered", /data-proof="e6-gpu-tier-table"/],
  ["download config rendered", /data-proof="e6-download-config"/],
  ["tier edit uses multi-field", /name: `\$\{view\.label\}档位设置`[\s\S]*op: "param-multi"/],
  ["download copy uses multi-field", /name: "编辑下载页双语文案"[\s\S]*op: "param-multi"/],
  ["keyword add/edit is single-field", /const editKeyword[\s\S]*op: "param"[\s\S]*单个显卡型号关键词/],
  ["keyword delete fixed empty", /const deleteKeyword[\s\S]*op: "param-fixed"[\s\S]*fixedVal: ""/],
  ["gpu keyword slots are independent", /keyword1[\s\S]*keyword2[\s\S]*keyword3[\s\S]*keyword4[\s\S]*keyword5[\s\S]*keyword6/],
  ["E6 coefficient edit has numeric bounds", /edit: \{ kind: "number"[\s\S]*min: isRatio \? 0 : undefined[\s\S]*gt: isRatio \? undefined : 0[\s\S]*max: isRatio \? 1 : undefined/],
  ["E6 tier TOPS has neighbor monotonic bounds", /tierTopsBounds[\s\S]*gt: bounds\.gt, lt: bounds\.lt/],
  ["E6 keyword edit rejects duplicates and multi-value text", /pattern: "single-keyword"[\s\S]*disallowValues: blocked/],
  ["E6 download URL edit validates URL", /pattern: "url"[\s\S]*maxLength: 300/],
  ["E6 save path validates business constraints", /validateE6ComputeWrite[\s\S]*六档显卡算力 TOPS 保存后必须严格递增/],
  ["E6 keyword duplicate fallback keeps original slot index", /sameTierKeywords[\s\S]*COMPUTE_GPU_KEYWORD_SLOTS\.indexOf\(slot\)[\s\S]*tier\.keywords\[originalIndex\]/],
  ["modal disables invalid edit values", /editValueProblems[\s\S]*editProblems\.length === 0/],
  ["multi-field supports dynamic numeric bounds", /f\.gt != null[\s\S]*f\.lt != null[\s\S]*f\.min != null[\s\S]*f\.max != null/],
  ["responsive E6 rows styled", /\.edom \.e6-gpu-row[\s\S]*@media \(max-width: 1180px\)/],
];
for (const [label, re] of must) if (!re.test(source)) fail.push(label);
const bannedVisible = /待 SPEC|待开发|SPEC2_ITEMS|computeShareEnabled|E\.compute|h5BaseFactor|continuityFullHours|ENV_FILTERED|MANUAL_HOLD|运营后台|内部开关|工程字段/;
if (bannedVisible.test(e6)) fail.push("E6 visible component leaks placeholder or engineering field text");
const e6RegistryBlock = reg.match(/path: "\/devices\/compute-config"[\s\S]*?(?=\n  \},\n\];|\n  \},\n  \{)/)?.[0] ?? "";
const bannedOperatorCopy = /三端改造配置面/;
if (bannedOperatorCopy.test(e6 + "\n" + cfg + "\n" + e6RegistryBlock)) fail.push("E6 operator-facing copy leaks implementation phrasing");
if (/label:\s*"English title"|label:\s*"English guide"/.test(cfg) || /English title|English guide/.test(e6)) {
  fail.push("E6 download copy labels must use operator-facing Chinese text");
}
if (!/英文标题[\s\S]*英文说明/.test(e6 + "\n" + cfg)) {
  fail.push("E6 download copy labels must include Chinese operator labels");
}
if (!/allowEmpty\?: boolean/.test(design) || !/if \(!f\.allowEmpty\) needs\(f\.key, f\.label\)/.test(design)) {
  fail.push("multi-field must support explicit empty values");
}
for (const field of ["zhTitle", "zhGuide", "enTitle", "enGuide"]) {
  const re = new RegExp(`key: "${field}"[\\s\\S]*?allowEmpty: true`);
  if (!re.test(e6)) fail.push(`download copy field ${field} must be clearable`);
}
const e6SetParamActorChecks = [
  /setParam\(mc\.paramKey, v, \{ action: mc\.name, reason, actor: operator \}\)/,
  /setParam\(paramKey, next, \{ action: mc\.name, reason, actor: operator \}\)/,
  /setParam\(mc\.paramKey, mc\.fixedVal, \{ action: mc\.name, reason, actor: operator \}\)/,
];
for (const re of e6SetParamActorChecks) if (!re.test(eView)) fail.push("E config setParam must preserve logged-in operator");
if (/keywords\.join/.test(e6)) fail.push("GPU keywords may be edited as one multi-value field");
const tiers = [...cfg.matchAll(/id:\s*"(G[1-6])"[\s\S]*?defaultTops:\s*(\d+)/g)].map((m) => ({ id: m[1], tops: Number(m[2]) }));
const order = ["G1", "G2", "G3", "G4", "G5", "G6"];
if (tiers.length !== 6) fail.push(`expected 6 GPU tiers, got ${tiers.length}`);
const by = new Map(tiers.map((tier) => [tier.id, tier.tops]));
for (let i = 1; i < order.length; i++) {
  if (!(by.get(order[i]) > by.get(order[i - 1]))) fail.push(`GPU TOPS not monotonic at ${order[i]}`);
}
if (!/url:[\s\S]*defaultVal:\s*""/.test(cfg)) fail.push("download URL must default to empty");
if (fail.length) {
  console.error(fail.map((x) => `  - ${x}`).join("\n"));
  process.exit(1);
}
console.log("  E6 SPEC-2 source contract OK");
NODE
); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [e6-spec2-source] E6 SPEC-2 源码契约失败"
fi

echo "== [1.6/4] K6 SPEC-3 source contract =="
if (cd "$ROOT" && "$NODE_BIN" - <<'NODE'
const fs = require("fs");
const store = fs.readFileSync("lib/store/admin/janus-c2-store.ts", "utf8");
const strategy = fs.readFileSync("app/components/domain-views/k-tabs/k6/strategy-editor.tsx", "utf8");
const rules = fs.readFileSync("app/components/domain-views/k-tabs/k6/rule-tree-editor.tsx", "utf8");
const manual = fs.readFileSync("app/components/domain-views/k-tabs/k6/manual-override-modal.tsx", "utf8");
const center = fs.readFileSync("app/components/domain-views/k-tabs/k6/strategy-center.tsx", "utf8");
const labels = fs.readFileSync("lib/mock/admin/janus-c2/labels.ts", "utf8");
const evaluate = fs.readFileSync("lib/mock/admin/janus-c2/evaluate.ts", "utf8");
const detail = fs.readFileSync("app/components/domain-views/k-tabs/k6/device-detail.tsx", "utf8");
const dashboard = fs.readFileSync("app/components/domain-views/k-tabs/k6/dashboard.tsx", "utf8");
const auditLog = fs.readFileSync("app/components/domain-views/k-tabs/k6/audit-log.tsx", "utf8");
const fail = [];
if (!/REMOTE_URL_LABEL/.test(store) || !/default:\s*"正盘默认首页"/.test(labels)) fail.push("remote URL default label must point to the canonical H5 home in operator copy");
if (/默认真盘\(default\)|备用线路\(backup\)|活动专线\(promo\)/.test(store)) fail.push("remote URL labels leak key names");
if (!/新建策略/.test(center) || !/删除/.test(center) || !/编辑/.test(center)) fail.push("strategy center must expose create/edit/delete");
if (!/htmlFor="st-status"/.test(strategy) || !/STRATEGY_STATUS_LABEL/.test(strategy)) fail.push("strategy status must be editable with readable labels");
if (!/RuleTreeEditor/.test(strategy) || !/添加规则|规则组/.test(rules)) fail.push("rule tree editor must be wired");
const enumMultiBranch = rules.indexOf('def.type === "enum" && (rule.op === "in" || rule.op === "notIn")');
const textMultiBranch = rules.indexOf('def.type === "multi" || rule.op === "in" || rule.op === "notIn"');
if (!/function MultiEnumInput/.test(rules) || enumMultiBranch < 0 || textMultiBranch < 0 || enumMultiBranch > textMultiBranch || !/enumOptionLabel\(field, o\)/.test(rules)) {
  fail.push("rule editor status/channel in/notIn must use readable enum multi-select before generic text multi-value input");
}
if (/逗号分隔/.test(manual + "\n" + strategy + "\n" + rules)) fail.push("K6 dialogs must not use single-box multi-value input");
if (!/添加邀请码/.test(strategy) || !/添加取值/.test(rules)) fail.push("K6 multi-value fields must expose itemized add controls");
if (/<option[^>]*>\{a\}<\/option>/.test(strategy) || /:\s*"[^"]*(ENV_FILTERED|MANUAL_HOLD|REVERSAL_SESSION_EDGE|DRY_RUN_ONLY)[^"]*"/.test(labels + "\n" + store)) {
  fail.push("K6 visible labels leak engineering enum text");
}
if (!/strategyApplicability/.test(evaluate) || !/scope\.channels/.test(evaluate) || !/scope\.inviteCodes/.test(evaluate) || !/requireFreshReportMinutes/.test(evaluate) || !/rollout/.test(evaluate) || !/maxDailyRecommendations/.test(evaluate) || !/maxDailyHits/.test(evaluate)) {
  fail.push("K6 strategy scope/safeguards/rollout must participate in evaluation");
}
if (!/case "status":[\s\S]*STATUS_LABEL/.test(evaluate)) fail.push("K6 decision trace must translate status enum values");
if (!/remoteUrlLabel/.test(labels) || !/remoteUrlLabel\(d\.remoteUrlKey\)/.test(detail) || !/remoteUrlLabel\(strat\.action\.remoteUrlKey\)/.test(dashboard) || !/remoteUrlLabel\(String\(v\)\)/.test(auditLog) || !/JSON\.stringify\(exportRows\(filtered\)/.test(auditLog)) {
  fail.push("K6 remote URL keys must render/export as operator labels");
}
if (fail.length) {
  console.error(fail.map((x) => `  - ${x}`).join("\n"));
  process.exit(1);
}
console.log("  K6 SPEC-3 source contract OK");
NODE
); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [k6-spec3-source] K6 SPEC-3 源码契约失败"
fi

echo "== [1.7/4] SPEC-7 risk config source contract =="
if (cd "$ROOT" && "$NODE_BIN" - <<'NODE'
const fs = require("fs");
const cfg = fs.readFileSync("lib/mock/admin/compute-config.ts", "utf8");
const e6 = fs.readFileSync("app/components/domain-views/e-tabs/e6-compute-config.tsx", "utf8");
const eView = fs.readFileSync("app/components/domain-views/e-view.tsx", "utf8");
const k1 = fs.readFileSync("app/components/domain-views/k-tabs/k1-multiaccount.tsx", "utf8");
const k3 = fs.readFileSync("app/components/domain-views/k-tabs/k3-rules.tsx", "utf8");
const k2 = fs.readFileSync("app/components/domain-views/k-tabs/k2-arbitrage.tsx", "utf8");
const k4 = fs.readFileSync("app/components/domain-views/k-tabs/k4-scoring.tsx", "utf8");
const kData = fs.readFileSync("app/components/domain-views/k-tabs/data.ts", "utf8");
const d2 = fs.readFileSync("app/components/domain-views/d-tabs/d2-withdrawals.tsx", "utf8");
const dData = fs.readFileSync("app/components/domain-views/d-tabs/data.ts", "utf8");
const dRegistry = fs.readFileSync("lib/admin/registry/d.ts", "utf8");
const designData = fs.readFileSync("lib/mock/admin/design-data.ts", "utf8");
const commandCenter = fs.readFileSync("lib/mock/admin/command-center.ts", "utf8");
const withdrawalsSeed = designData.match(/export const WITHDRAWALS[\s\S]*?^];/m)?.[0] ?? "";
const fail = [];
const must = [
  ["risk cluster params are centralized", cfg, /RISK_CLUSTER_PARAMS[\s\S]*freePhoneSlotsPerCluster[\s\S]*duplicateAccountPendingFrom[\s\S]*appAttestationReleaseHours/],
  ["withdraw params are centralized", cfg, /WITHDRAW_RULE_PARAMS[\s\S]*minWithdrawableUsdt[\s\S]*sameAddressRoute/],
  ["withdraw review params are centralized", cfg, /WITHDRAW_REVIEW_PARAMS[\s\S]*largeConfirmUsdt/],
  ["yield estimate params are centralized", cfg, /COMPUTE_YIELD_ESTIMATE[\s\S]*topsBaseline[\s\S]*dailyUsdtPerBaseline[\s\S]*nexPerUsdt/],
  ["E6 renders H5/App impact without field names", e6, /data-proof="e6-h5-app-impact"[\s\S]*H5 基础托管[\s\S]*App 在线加成/],
  ["E6 renders yield estimate params", e6, /data-proof="e6-yield-estimate-params"[\s\S]*COMPUTE_YIELD_ESTIMATE\.map/],
  ["K1 renders risk release params", k1, /data-proof="k1-risk-release-params"[\s\S]*RISK_CLUSTER_PARAMS\.map/],
  ["K1 link weights use multi-field", k1, /title: "关联强度权重"[\s\S]*设备权重[\s\S]*支付工具权重[\s\S]*IP 权重/],
  ["K1 cluster detail shows earning impact", k1, /data-proof="k1-cluster-earning-impact"[\s\S]*收益影响/],
  ["welcome gift params are centralized", cfg, /REWARD_RISK_PARAMS[\s\S]*lockMode[\s\S]*usdtAmount[\s\S]*nexAmount/],
  ["otp gate params are centralized", cfg, /OTP_GATE_PARAMS[\s\S]*resendSeconds[\s\S]*captchaAfterSends[\s\S]*otpTtlSeconds[\s\S]*maxVerifyAttempts[\s\S]*captchaTicketTtlSeconds/],
  ["K2 renders otp gate params", k2, /data-proof="k2-otp-gate-params"[\s\S]*OTP_GATE_PARAMS\.map/],
  ["cluster dimension weights are centralized", cfg, /RISK_SCORE_WEIGHT_PARAMS[\s\S]*serverDeviceId[\s\S]*weakSignalClusterThreshold/],
  ["K2 renders welcome gift params", k2, /data-proof="k2-welcome-gift-params"[\s\S]*REWARD_RISK_PARAMS\.map/],
  ["K2 gift stats derive from configured NEX amount", k2, /giftBlockedCnt \* giftNex/],
  ["K4 renders cluster dimension weights", k4, /data-proof="k4-cluster-dimension-weights"[\s\S]*RISK_SCORE_WEIGHT_PARAMS\.map/],
  ["K gift sample rows use current 20-NEX math", kData, /\$45 \+ 180 NEX[\s\S]*\$20 \+ 80 NEX/],
  ["K3 renders withdraw rule params", k3, /data-proof="k3-withdraw-rule-params"[\s\S]*WITHDRAW_RULE_PARAMS\.map/],
  ["K3 same-address route uses select", k3, /p\.key === "sameAddressRoute"[\s\S]*edit: \{ kind: "select"[\s\S]*WITHDRAW_ROUTE_OPTIONS/],
  ["K3 new rule uses structured controls", k3, /action: "新建提现风控规则"[\s\S]*businessForm:[\s\S]*kind: "multi-field"[\s\S]*规则维度[\s\S]*判断方式[\s\S]*阈值[\s\S]*命中后处理/],
  ["K3 threshold adjustment uses structured controls", k3, /businessForm: adjustRuleForm\(d, cur\)[\s\S]*nextAdjustedRuleText\(d, businessValue\)/],
  ["D2 detail shows route cluster and score", d2, /data-proof="d2-withdraw-risk-summary"[\s\S]*处理结论:[\s\S]*K1 关联簇:[\s\S]*K4 风险分:/],
  ["D2 renders withdraw review params", d2, /data-proof="d2-withdraw-review-params"[\s\S]*WITHDRAW_REVIEW_PARAMS\.map/],
  ["D2 large confirm line reads config", d2, /const largeConfirmLine = \(\(\) => \{[\s\S]*reviewParamValue\(p\)[\s\S]*const isLarge = \(w: WithdrawalRow\) => w\.amount >= largeConfirmLine[\s\S]*wdStats\(effSt, largeConfirmLine\)/],
  ["D2 quick approve requires a reason", d2, /快速放行[\s\S]*chips:[\s\S]*reason: true[\s\S]*okLabel: "确认放行"/],
  ["D2 proposal statuses use operator labels", d2, /before: wdStatusLabel\(effSt\(w\.id\)\)[\s\S]*after: wdStatusLabel\("review-passed"\)[\s\S]*after: wdStatusLabel\("review-pending"\)[\s\S]*after: wdStatusLabel\("refunded"\)/],
];
for (const [label, src, re] of must) if (!re.test(src)) fail.push(label);
const visibleBans = [
  ["E6 must not embed backend coeff field names", e6, /h5BaseFactor|continuityFullHours/],
  ["E6 must not hardcode yield constants or internal tier copy", e6, /0\.06|166\.67|G1-G6|档位 \{tier\.id\}/],
  ["E view must not expose server-canonical in visible E flows", eView, /setToast\([^\n]*server-canonical|detail: `[^`\n]*server-canonical|sub=\{<AutoGloss>\{[^\n]*server-canonical/],
  ["K1 must not expose linkWeight or admin event names in operator copy", k1, /linkWeight 仅|linkWeight 例外|admin\.cluster|admin\.risk_threshold|detected 命中|flagged 可疑|frozen 已冻结|released 解除误判|cleared 判定正常/],
  ["K1/K2 must not carry stale 200-NEX gift copy", [k1, k2].join("\n"), /\$5 \+ 200 NEX|giftBlockedCnt \* 200/],
  ["K3 must not expose action enum labels or backend copy", k3, /命中动作:[^<]*(delay|freeze|manual)|>\{d\.act\}<|接口预留|本批不实现|admin\.withdraw_rule|服务器拒绝\(409\)|返回 409|draft 草拟|active 生效|paused 停用|archived 归档/],
  ["K3 rule dialogs must not use free-text multi-value input", k3, /新建提现风控规则[\s\S]{0,900}edit: \{ kind: "text"|规则阈值调整[\s\S]{0,900}edit: \{ kind: "text"|archived 终态 409/],
  ["D2 large confirm line must not be hardcoded", [d2, dData, dRegistry].join("\n"), /LARGE_LINE|静态参数|小额\(< \$1,000\)|大额\(≥ \$1,000\)|大额操作确认线\(\$1,000\)|小额\(<\$1,000\)/],
  ["D2 must not expose K5 hold copy", [d2, dData, withdrawalsSeed, commandCenter].join("\n"), /K5 hold|复审 hold|复审期间该单 hold|进入复审 hold/],
  ["D2 state flow must not expose server state codes or HTTP codes", d2, /submitted 已提交|review-pending 待人工|review-passed 已批|tx-failed|返回 409|\b409\b|before: "review-|after: "review-|before: "frozen"|after: "refunded"|before: effSt\(w\.id\)/],
];
for (const [label, src, re] of visibleBans) if (re.test(src)) fail.push(label);
if (fail.length) {
  console.error(fail.map((x) => `  - ${x}`).join("\n"));
  process.exit(1);
}
console.log("  SPEC-7 risk config source contract OK");
NODE
); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [spec7-risk-config-source] SPEC-7 风控配置源码契约失败"
fi

echo "== [2/4] nav routes (HTTP 200 + scaffold needle) =="
while IFS='|' read -r path id status; do
  [ -z "$path" ] && continue
  check_http "$path"
  if [ "$status" = "scaffold" ]; then check_html "$path" "规格就绪"; fi
done < <("$NODE_BIN" "$HERE/nav-routes.mjs" | tr -d '\r')
nav_count=$("$NODE_BIN" "$HERE/nav-routes.mjs" | grep -c '|')
if [ "$nav_count" -ne 72 ]; then
  echo "  ✗ nav-routes 仅提取 $nav_count 条(期望 72)— console-nav.ts 格式漂移致 verify 漏检"; fail=$((fail+1))
else
  echo "  nav-routes: $nav_count 条路由"
fi

echo "== [3/4] landing + flagship needles =="
check_http "/"
check_html "/" "运营总览"
check_html "/" "服务端权威"
# 指挥台首页各区(落地即态势)
check_html "/" "兑付覆盖率"
check_html "/" "高敏操作动态"
check_html "/" "风险雷达"
check_html "/" "转化漏斗"
check_html "/" "KPI 验收墙"
# B1 双账本驾驶舱(旗舰)
check_html "/overview/dual-ledger" "双账本总览"
check_html "/overview/dual-ledger" "兑付覆盖率"
check_html "/overview/dual-ledger" "应付负债结构"
# D2 提现审核队列(设计稿 D 域视图 · D2 标签,2026-06-10 D 域 port:队列单源 WD-904xx 与 K3_HITS 同体系)
check_html "/finance/withdrawals" "提现审核队列"
check_html "/finance/withdrawals" "WD-90412"
check_html "/finance/withdrawals" "资金与财务"
check_html "/finance/withdrawals" "正常 5 种状态 + 异常 6 种状态"   # D2 状态机条(server-canonical)
check_html "/finance/withdrawals" "K5 复审未决"             # 复审未过禁放(PRD D2⑦ 联动)
# C 域六页(design_handoff_c_domain port 2026-06-11:C1-C6 全设计稿视图)+ 用户详情(L3 深链页 · 保留)
check_http "/users/search/U-88421"
check_html "/users/search" "用户与账户"
check_html "/users/search" "Marcus Lee"
check_html "/users/search" "账户操作"
check_html "/users/search" "设备持有者(L4+)"          # C1 stats(C1_STATS 单源)
check_html "/users/search" "只能查看 · 要处置去对应页面"   # C1 f-ro(零写权不变量)
check_html "/users/actions" "账户处置"                   # C2 处置台(冻结台账权威)
check_html "/users/actions" "模拟登录控制台"             # C2 impersonate 三道锁
check_html "/users/actions" "信任 / 禁入名单"            # C2 账户级名单(与 K1 IP 白名单正交)
check_html "/users/assets" "发起调整"                    # C3 调整面(原因/凭证必填)
check_html "/users/assets" "挂起中的加钱申请"            # C3 挂起状态机(红线被拒转挂起)
check_html "/users/assets" "待确认队列"                  # C3 操作确认(C.adjust.* 真写)
check_html "/users/kyc" "触发条件与网络白名单"           # C4 阈值只读(归 K5/G2)
check_html "/users/kyc" "KYC 状态列表"                   # C4 唯一真相源台账
check_html "/users/security" "凭证与会话参数"            # C5 凭证参数(step-up V1 只读)
check_html "/users/security" "锁定状态与解除"            # C5 两档解锁(处置权归 C5)
check_html "/users/reg-risk" "验证码(OTP)"            # C6 OTP 参数面
check_html "/users/reg-risk" "防参数配两套打架"          # C6 与 K1 分工(422 拒收)
check_html "/users/search/U-88421" "风险画像"
check_html "/users/search/U-88421" "账户操作"
check_html "/users/search/U-88421" "审计时间线"
check_html "/users/search/U-88421" "投入卡"                  # C1·deepening deposit 投入卡(360 HUB 字段级)
check_html "/users/search/U-88421" "逐笔充值流水"            # 投入卡逐笔 topup 表(D4 账本切片)
check_html "/users/search/U-88421" "提现卡"                  # 360 HUB 提现卡
check_html "/users/search/U-88421" "设备卡"                  # 360 HUB 设备 CRUD
check_html "/users/search/U-88421" "收益台账"                # 360 HUB 收益台账 CRUD
check_html "/users/search/U-88421" "邀请卡"                  # 360 HUB 邀请卡(补 F 缺口)
check_html "/users/search/U-88421" "等级卡"                  # 360 HUB V 级卡
check_html "/users/search/U-88421" "财务持仓卡"              # 360 HUB staking/Genesis/兑换
check_html "/users/search/U-88421" "互动卡"                  # 360 HUB 任务/签到/抽奖/里程碑
check_html "/users/search/U-88421" "账户·安全·合规卡"        # 360 HUB auth/KYC/2FA/会话/档案/领导池
check_html "/users/search/U-88421" "订单·商城·收据·试用卡"   # 360 HUB orders/receipts/trial/cart
check_html "/users/search/U-88421" "通知·偏好卡"             # 360 HUB notif log/prefs/sound/haptics
# A 域四页(design_handoff_a_domain port 2026-06-12:A1-A4 平台基座;A5 独立旗舰页)
check_html "/platform/rbac" "运营账号"                       # A1 账号台账
check_html "/platform/rbac" "全域权限矩阵"                   # A1 RBAC 矩阵
check_html "/platform/rbac" "登录与安全基线"                 # A1 三铁律(强制 2FA / 零写权 / ≥2 超管)
check_html "/platform/rbac" "默认拒绝"                       # A1 新账号零写权 server-canonical
check_html "/platform/audit" "高敏操作动态"                  # A2 14 件 pending
check_html "/platform/audit" "审计日志"                      # A2 只追加
check_html "/platform/audit" "应急快速轨"                    # A2 SOS SLA 倒计时
check_html "/platform/audit" "操作确认适用动作清单"              # A2 9 大类机制参数
check_absent "/platform/config" "服务器时钟"                 # A3 (a) 服务器时钟·全平台时间单源卡已删(2026-06-24,含 KPI/NTP/漂移)
check_absent "/platform/config" "防重号策略"                 # A3 (b) 防重号策略卡已删(2026-06-24,含 KPI/去重窗口)
check_html "/platform/config" "熔断闸状态存储"               # A3 只读跳 J1/J2
check_html "/platform/config" "功能开关平台"                 # A3 灰度台(已本地化中文,旧英文串 feature flag 过时 2026-06-22)
check_html "/platform/events" "事件目录"                     # A4 6 family
check_html "/platform/events" "通用字段"                     # A4 字段固定
check_html "/platform/events" "八项 KPI"                     # A4 KPI 算式
check_html "/platform/events" "domain 扩展批次看板"          # A4 V4 内容批进行中
# I 域五页(design_handoff_i_domain port 2026-06-11:I1-I7 七子模块 / 5 页覆盖)
check_html "/content/copy-ab" "文案池"                       # I1 文案池
check_html "/content/copy-ab" "实验框架默认参数"             # I1 框架参数(普通确认带原因)
check_html "/content/copy-ab" "A/B 实验面板"                 # I1 实验台
check_html "/content/nova" "10 可调通道节奏表"               # I2 cadence
check_html "/content/nova" "这套开关不在熔断矩阵里"          # I2 kill 不入 J1/J2
check_html "/content/nova" "推送模板池"                      # I2 模板
check_html "/content/notifications" "优先级容量闸"           # I3 4 档 CAP
check_html "/content/notifications" "永不淘汰"               # I3 critical 锁定 ∞
check_html "/content/notifications" "合规通道特例"           # I3 critical 升合规 / J 域共用
check_html "/content/trust" "信任中心"                       # I4 6 版块
check_html "/content/trust" "披露矩阵"                       # I5 4 法域
check_html "/content/trust" "重确认覆盖监控"                 # I5 re-ack
check_html "/content/trust" "受限动作范围"                   # I5 gated (withdraw 已实装 / staking·nexv2 待接线)
check_html "/content/i18n" "命名空间矩阵"                    # I6 词条底座
check_html "/content/i18n" "完整性扫描"                      # I6 镜像 gate
check_html "/content/i18n" "教程中心"                        # I7 课程
check_html "/content/i18n" "涨奖励过 B1 红线"                # I7 唯一 amplifies(B1 红线核验,SSR 卡头副标)
# 域 M 客服中心(I8 工单 + I9 即时会话 迁出域 I 重组;真写键沿用 I.support.*/I.session.*)
check_html "/service/overview" "SLA 监控"                     # M1 客服总览 · SLA 监控
check_html "/service/overview" "坐席负载"                     # M1 坐席负载概览(派生,非真 presence)
check_html "/service/tickets" "工单详情与处理"                # M2 工单坐席台 desk
check_html "/service/tickets" "升级为即时会话"                # M2 工单→即时会话互转(新)
check_html "/service/sessions" "主动发起会话"                 # M3 顾问主动发起会话(新)
check_html "/service/sessions" "转工单"                       # M3 即时会话→工单互转(新)
check_html "/service/sessions" "转入待处理"                   # M3 跨坐席转交 → 转入待处理筛选档(新)
check_html "/service/kb-sla" "Help/FAQ 内容管理"              # M4 FAQ 内容池
check_html "/service/kb-sla" "Ticket 分类与 SLA"             # M4 分类 SLA 矩阵
check_html "/service/scripts" "顾问主动话术"                  # M5 AutoPushPolicy + 话术库
check_html "/service/scripts" "受众"                          # M5 受众圈定(新)
# A5 平台参数寄存器(平台运营面字段级控制索引 · 88 平台参数回源真值)
check_html "/platform/params-registry" "平台参数寄存器"
check_html "/platform/params-registry" "回源真值"
check_html "/platform/params-registry" "操作确认"
# D5 提现参数配置(设计稿 D 域视图 · D5 标签:owns 三参数 + H1 派发只读)
check_html "/finance/params" "提现参数"
check_html "/finance/params" "节奏派发 · 只读"             # H1 派发三项只读区(防双源)
check_html "/finance/params" "本页可调(操作确认)"        # D5 owns 三参数区
check_html "/finance/params" "红线核验"                    # 放松方向 B1 覆盖率核验说明
# 注:L 域(数据与分析 BI)主内容区为客户端渲染(SSR 仅侧栏 + 域名/summary),body needle curl 取不到,
# 故 L1–L6 与既有 L 页一致只走 nav 自动 HTTP200(check_http);L6 用户行为热力图运行时校验靠 Playwright 浏览器自检。

echo "== [4/4] 体验回归(运营者 / PM 视角 · 自动可检信号) =="
# 镜头 B 初次运营者:信息气味 / 状态信号 / 空态引导不退化
check_html "/" "模块"                                  # 域卡信息气味(域·N 模块)
check_html "/finance/recon" "充值对账"                  # D1 设计稿视图:充值对账标题在 SSR 渲染
check_html "/finance/recon" "资金与财务"                # D 域视图页头(子页统一布局信号)
check_html "/overview/dual-ledger" "健康"               # B1 覆盖率状态信号(运营者一眼可读;m7 基准 118.1%≥健康线110 → zoneLabel「健康」)
check_html "/finance/withdrawals" "提现状态"            # D2 设计稿视图:提现状态中文信号在 SSR 表渲染
check_html "/finance/withdrawals" "WD-90412"
# 镜头 C 顶级 PM:决策颗粒度 / 全局态势 / 红线 / 审计可信不退化
check_html "/overview/dual-ledger" "净敞口"             # 颗粒度:储备−负债敞口
check_html "/overview/dual-ledger" "红线"               # 兑付红线(放大流出防线)
check_html "/overview/dual-ledger" "环比"               # 趋势/基线对比
check_html "/" "服务端权威"                            # 全局态势/可信信号常驻
check_html "/finance/withdrawals" "提现审核队列"        # 决策颗粒度:提现确认队列在位
check_html "/finance/withdrawals" "风险"                # 风险维度在位
# 镜头 D 交互设计师:版面填充/洞察哨兵(防留白回潮 + 控件失数退化)
check_html "/" "最大流失"                               # 漏斗底部洞察带在位(flex 填充 + PM 价值)
check_html "/" "净敞口曲线"                             # B1 净敞口曲线卡在位(设计稿元素不被省略)
# 设计稿 restyle 保真哨兵(防风格回退到旧 shell / 黑话代号)
check_html "/platform/rbac" "搜索 userId"               # 顶栏全局搜索框(设计稿签名元素)在位
check_html "/overview/liquidity" "资金池水位"             # B 域 archetype 页正常渲染(模块口径副标在位)
# 设计稿内容视图铺满全域哨兵(防回退到旧 archetype 模板)
check_html "/network/royalty" "分销与团队"              # F 域视图:域整页骨架(标题 + Tab + 富内容)
check_html "/devices/pricing" "设备与商城"              # E 域视图:新增 SKU + 商品目录 Tab
check_html "/finance-products/staking" "金融产品"       # G 域视图:域名页头在位
check_html "/risk/multi-account" "三层去重命中列表"      # K1 设计稿 port:去重列表 + 拦截阈值在位
check_html "/risk/abuse" "闭环怎么判"                   # K2 设计稿 port:闭环分级判定卡在位
check_html "/risk/withdrawal-rules" "四道关"             # K3 设计稿 port:四维规则卡在位
check_html "/risk/scoring" "评分权重"                   # K4 设计稿 port:权重滑杆卡在位
check_html "/risk/kyc-review" "复审触发队列"             # K5 设计稿 port:SLA 队列在位
check_html "/risk/janus-c2" "命中漏斗"                   # K6 设计稿 port:看板命中漏斗在位
check_html "/finance/recon" "支付商报表 vs 平台入账"     # D1 设计稿 port:逐渠道对账面在位
check_html "/finance/recon" "拒付处置"                  # D1 chargeback 三连原子处置区在位
check_html "/finance/pool" "真实储备明细"                # D3 设计稿 port:储备底账(唯一源)在位
check_html "/finance/pool" "到期负债预测"                # D3 三类叠加预测在位
check_html "/finance/ledger" "滚动余额"                  # D4 设计稿 port:单用户 Running Balance 在位
check_html "/finance/ledger" "账实不符告警"              # D4 断点告警区在位
check_html "/finance-products/staking" "Position 状态机与监控"  # G1 设计稿 port:双池 4 档 + position 监控在位
check_html "/finance-products/staking" "保序校验"               # G1 三道硬门(B1 红线 + 跨档保序)在位
check_html "/finance-products/exchange" "三道额度线"            # G2 设计稿 port:caps 配置面在位
check_html "/finance-products/exchange" "拦截命中与队列"        # G2 三类拦截 + 次日队列在位
check_html "/finance-products/market" "行情走势"                # G3:kline 在位
check_html "/finance-products/market" "周曲线关键帧"            # G3 升级:周曲线排程器矩阵在位
check_html "/finance-products/market" "自动按日推进"            # G3 升级:排程控制(schedule/pin/loop)在位
check_html "/finance-products/genesis" "分红派发监控"           # G4 设计稿 port:双口径派发卡在位
check_html "/finance-products/genesis" "节点持有台账"           # G4 ownership 台账在位
check_html "/finance-products/repurchase" "复投激励配置"        # G7 复投独立页(Premium/NEX v2 已下线)在位
echo "  注:运营者/PM/交互设计师 的定性维度由审计 panel(docs/REVIEW-RUBRIC.md 镜头 B/C/D)覆盖,此处仅守信号退化。"

echo "== [+] CGM 字段级覆盖 gate(CGM_BATCH=${CGM_BATCH:-B9}) =="
# 默认 B9 = 全运营面 0 gap 常驻 tripwire(全 185 行须 built/waived)。
# 暂存未完成新批次时临时降批:CGM_BATCH=B2 bash scripts/verify.sh
if (cd "$ROOT" && CGM_BATCH="${CGM_BATCH:-B9}" "$NODE_BIN" scripts/cgm-coverage.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [cgm-coverage] batch ${CGM_BATCH:-B9} 有未覆盖行(跑 CGM_BATCH=${CGM_BATCH:-B9} node scripts/cgm-coverage.mjs 看明细)"
fi

echo "== [+] 交互完整性自查 gate(死控件/页头错配/详情链全局/persist水合/版本漂移/凭据反模式)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-interaction-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [interaction-audit] 有 HIGH 残留(跑 node scripts/admin-interaction-audit.mjs 看明细)"
fi

echo "== [+] 动作完整性 gate(防新增死控件 + built 不退化 + 欠账量化;OPS_BATCH 收紧批次)=="
# 默认不设 OPS_BATCH = 只锁死回归 + 计欠账(pending 不爆红,允许增量补齐);逐批收紧:OPS_BATCH=P0 bash scripts/verify.sh
if (cd "$ROOT" && OPS_BATCH="${OPS_BATCH:-}" "$NODE_BIN" scripts/ops-actions-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [ops-actions] 有违例(新增死控件/built退化/批次未达;跑 node scripts/ops-actions-audit.mjs 看明细)"
fi

echo "== [+] 旧确认机制残留 gate =="
if (cd "$ROOT" && "$NODE_BIN" scripts/no-double-sign-terms.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [no-double-sign-terms] 旧确认机制词面或旧符号残留"
fi

echo "== [+] 业务弹窗契约 gate(角色/权限/内容/设备必须有业务控件)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-modal-contract-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-modal-contract] 业务弹窗控件退化(reason-only/free-text-only/no-diff)"
fi

echo "== [+] 列表能力 gate(分页原语 + finance RT-014 接线 + 豁免注记)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-list-capability-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-list-capability] 分页原语/finance 接线/豁免注记退化"
fi

echo "== [+] 全域列表能力 runtime gate(64 路由表格分页/明确小表例外)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-list-capability-global-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-list-capability-global] runtime 表格分页/明确小表例外退化"
fi

echo "== [+] 客服中心 gate(域 M /service/* + ticket 字段镜像)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/admin-support-surface-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [admin-support-surface] 域 M /service/* 路由/业务控件/字段镜像退化"
fi

echo "== [+] UniApp 自一致性 gate(pages.json↔vue 文件/runtime/action sample;2026-06-26 H5 退役后从'Next 映射'重命题)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/uniapp-port-coverage-audit.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [uniapp-port-coverage] UniApp pages/runtime/action sample 有缺口"
fi

echo "== [+] UniApp persona walkthrough gate(提现/兑换回购/team finance 导航)=="
run_uniapp_persona_walkthrough() {
  if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    local win_root uni_base ps_script
    win_root="$(wslpath -w "$ROOT")"
    uni_base="${UNI_BASE_URL:-http://localhost:5173}"
    ps_script="Set-Location -LiteralPath '$win_root'; \$env:UNI_BASE_URL='$uni_base'; node scripts\\uniapp-persona-walkthrough-proof.mjs"
    run_with_timeout "$WALKTHROUGH_TIMEOUT" powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ps_script"
  else
    (cd "$ROOT" && run_with_timeout "$WALKTHROUGH_TIMEOUT" "$NODE_BIN" scripts/uniapp-persona-walkthrough-proof.mjs)
  fi
}
if run_uniapp_persona_walkthrough; then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [uniapp-persona-walkthrough] FT-013/014/015 persona 业务闭环失败"
fi

echo "== [+] Feature-mapping walkthrough gate(FM-004/005/008/013/016)=="
run_feature_mapping_walkthrough() {
  if [ -f /proc/version ] && grep -qi microsoft /proc/version && command -v powershell.exe >/dev/null 2>&1 && command -v wslpath >/dev/null 2>&1; then
    local win_root uni_base admin_base ps_script
    win_root="$(wslpath -w "$ROOT")"
    uni_base="${UNI_BASE_URL:-http://localhost:5173}"
    admin_base="${ADMIN_BASE_URL:-${ADMIN_BASE:-http://localhost:3002}}"
    ps_script="Set-Location -LiteralPath '$win_root'; \$env:UNI_BASE_URL='$uni_base'; \$env:ADMIN_BASE_URL='$admin_base'; node scripts\\feature-mapping-walkthrough-proof.mjs"
    run_with_timeout "$WALKTHROUGH_TIMEOUT" powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ps_script"
  else
    (cd "$ROOT" && run_with_timeout "$WALKTHROUGH_TIMEOUT" "$NODE_BIN" scripts/feature-mapping-walkthrough-proof.mjs)
  fi
}
if run_feature_mapping_walkthrough; then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [feature-mapping-walkthrough] FM-004/005/008/013/016 业务闭环失败"
fi

echo "== [+] 三端改造 FE-BE 映射覆盖 gate(SPEC-5 M1-M11)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/fe-be-mapping-coverage.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [fe-be-mapping-coverage] 三端改造 D 表与 admin FRONTEND-LEVER-MAP/PRD 未闭环"
fi

echo "== [+] SKU 字段镜像 gate(后台 OpsSku ⊇ 前端 Product;防前端加字段后台漏)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/sku-field-mirror.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [sku-field-mirror] 后台 OpsSku 未覆盖前端 Product 字段(跑 node scripts/sku-field-mirror.mjs 看明细)"
fi

echo "== [+] Canon 数字口径 gate(staking/genesis/device/product + 提现费三端同源 + 旧 2% 费指纹)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/canon-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [canon-sentinel] 核心业务数字跨端漂移 / 提现费模型不一致 / 旧 2% 费残留(跑 node scripts/canon-sentinel.mjs 看明细)"
fi

echo "== [+] 任务产能参数 gate(FEAT-DEV01:合法性 + data.ts/mock-backend 双副本一致 + 旧衰减键残留 0)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/capacity-ladder-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [capacity-ladder] 任务产能参数非法 / 双副本漂移 / 旧 E.device.degrade* 键残留(跑 node scripts/capacity-ladder-sentinel.mjs 看明细)"
fi

echo "== [+] 领导池 canon 双端单源 gate(池额/集中度/合格数/票权人头前后端一致 + 禁散落 80%/V8+/假池额/假门槛)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/leadership-pool-canon-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [leadership-pool-canon] 领导池模型前后端漂移 / 集中度非派生 / 散落硬编码 80%·V8+·假池额(跑 node scripts/leadership-pool-canon-sentinel.mjs 看明细)"
fi

echo "== [+] Kill-switch 计数一致 gate(防 premium/nexv2 下线后「N 闸」残留漂移)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/kill-switch-count-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [kill-switch-count] 功能闸集漂移 / 全仓「N 闸·N功能闸·N/N·中文N闸」计数 ≠ KILLSWITCH 真实闸数(跑 node scripts/kill-switch-count-sentinel.mjs 看明细)"
fi

echo "== [+] shadcn token 一致性 gate(app/components/ui/* 禁残留 shadcn 默认 token,必重皮 V5)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/check-shadcn-tokens.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [shadcn-tokens] ui 组件残留 shadcn 默认 token 未重皮 V5(跑 node scripts/check-shadcn-tokens.mjs 看明细)"
fi

echo "== [+] 排版 anti-orphan gate(禁止孤字断行 · globals.css 必声明 .dkpage text-wrap:pretty)=="
if grep -qE '\.dkpage *\{ *text-wrap: *pretty' "$ROOT/app/globals.css"; then
  pass=$((pass+1)); echo "  ✓ anti-orphan 规则在位(.dkpage text-wrap:pretty + .nowrap 原子保证 · nexion-design 排版铁律)"
else
  fail=$((fail+1)); fails="$fails\n  [anti-orphan] globals.css 缺 .dkpage{text-wrap:pretty} 禁止孤字断行规则(见 nexion-design 排版铁律;数字+单位原子另用 .nowrap)"
fi

echo "== [+] 卡内嵌套铁律 gate(非按钮 filled chip/icon/badge/pill 禁加 border 描边)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/inner-block-no-border-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [inner-block-no-border] 非按钮 filled chip/icon/badge + border 违规(跑 node scripts/inner-block-no-border-sentinel.mjs 看明细;合法 keep 加进哨兵 EXEMPT)"
fi

echo "== [+] A2 审计覆盖 gate(高敏操作必落 A2 审计 + A2 页订阅实时 store)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/a2-audit-coverage-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [a2-audit-coverage] A2 页脱离实时 audit / 高敏 gap 分支漏 logAudit / A1 runMutation 漏传审计(跑 node scripts/a2-audit-coverage-sentinel.mjs 看明细)"
fi

echo "== [+] 节奏单源 gate(活渲染面禁读 PHASE/CURRENT_PHASE 当前态,必走 rhythmState)=="
if (cd "$ROOT" && "$NODE_BIN" scripts/rhythm-single-source-sentinel.mjs); then
  pass=$((pass+1))
else
  fail=$((fail+1)); fails="$fails\n  [rhythm-single-source] 活渲染面直接读 PHASE.*/CURRENT_PHASE.* 显示当前节奏(应 rhythmState 单源;跑 node scripts/rhythm-single-source-sentinel.mjs 看明细)"
fi

echo "----------------------------------------"
if [ "$fail" -eq 0 ]; then
  echo "✓ verify PASS — $pass checks, 0 failed"
  exit 0
else
  echo "✗ verify FAIL — $pass passed, $fail failed"
  echo -e "$fails"
  exit 1
fi
