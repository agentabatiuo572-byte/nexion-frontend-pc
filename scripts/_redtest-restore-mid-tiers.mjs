/**
 * 红测:恢复三条中间挡位的三道契约门(G4 tier-pricing / F5 commission-hold / K1 release-params)。
 * **按合取项逐个隔离** —— 每次注入只破坏一个断言,其余保持合法;一次注入打红多个条件时,
 * 那次红测只能算验了「最先失败的那一项」。
 * 还原走「工程内 .redtest-bak 副本 + finally」,禁 git checkout(会连带撤掉真改动)。
 *
 * 🔴 常驻,不是一次性脚本:**改动这三道门的判据后必须重跑**。不挂进 verify:它会临时改写
 *   源文件,并行跑会互相踩。手动跑:
 *     node scripts/_redtest-restore-mid-tiers.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const G4VIEW = path.join(ROOT, "app/components/domain-views/g-tabs/g4-genesis.tsx");
const G4CLIENT = path.join(ROOT, "lib/admin/g4-client.ts");
const MKTPROXY = path.join(ROOT, "app/api/admin/market/[...path]/route.ts");
const F5VIEW = path.join(ROOT, "app/components/domain-views/f-tabs/f5-audit.tsx");
const FSHELL = path.join(ROOT, "app/components/domain-views/f-view.tsx");
const KVIEW = path.join(ROOT, "app/components/domain-views/k-tabs/k1-multiaccount.tsx");
const KCLIENT = path.join(ROOT, "lib/admin/k-client.ts");
const MANIFEST = path.join(ROOT, "docs/ops-actions.manifest.json");

const TIER = ["--test", "tests/g4-tier-pricing-contract.test.mjs"];
const HOLD = ["--test", "tests/f5-commission-hold-contract.test.mjs"];
const REL = ["--test", "tests/k1-release-params-contract.test.mjs"];

function gateRed(args) {
  try {
    execFileSync("node", args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    return false; // 退出码 0 = 绿
  } catch { return true; }
}

/** 注入 → 跑门 → 无论如何还原。锚点不存在时 throw:红测本身失效必须暴露。 */
function inject(file, from, to, args) {
  const bak = `${file}.redtest-bak`;
  copyFileSync(file, bak);
  try {
    const src = readFileSync(file, "utf8");
    if (!src.includes(from)) throw new Error(`注入锚点不存在,红测本身失效:${path.basename(file)} ← ${from.slice(0, 60)}`);
    // 替换串用函数形式 —— 字符串形式里的 $& 会被当成整个匹配回填(踩过)。
    writeFileSync(file, src.replace(from, () => to));
    return gateRed(args);
  } finally {
    copyFileSync(bak, file);
    unlinkSync(bak);
  }
}

const CASES = [
  // ══ G4 tier-pricing 门 ══════════════════════════════════════════
  ["G4①a 档位 mutation 被削减(改名 = 底账「行级动作静默削减」同型)",
    () => inject(G4CLIENT, "export async function createG4GenesisTier(", "export async function createG4GenesisTierX(", TIER)],
  ["G4①b g4-client 引入一次性幂等前缀(破坏 stable-mutation 纪律)",
    () => inject(G4CLIENT, "export async function createG4GenesisTier(", 'const idempotencyPrefix = "g4";\nexport async function createG4GenesisTier(', TIER)],
  ["G4② 代理 allowlist 档位端点被移除",
    () => inject(MKTPROXY, 'parts.length === 3 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "tiers"', 'parts.length === 3 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "tiersx"', TIER)],
  ["G4③a fail-closed 泄漏:增开按钮脱离 tiers 真值条件",
    () => inject(G4VIEW, "{tiers && canPriceTiers && (", "{canPriceTiers && (", TIER)],
  ["G4③b 唯一档也渲染删档入口",
    // 锚必须单行:仓内文件是 CRLF 行尾,带 \n 的多行锚永远失配(本轮红测首跑抓出)。
    () => inject(G4VIEW, "tiers.length > 1", "tiers.length > 0", TIER)],
  ["G4④ 新 handler 侵入 GEN10b grabBetween 锚窗(前缀撞名探针)",
    () => inject(G4VIEW, "const runRerunBatch", "const editTierProbe = 1;\n  const runRerunBatch", TIER)],
  ["G4⑤ manifest OPS-G-13 锚漂移",
    () => inject(MANIFEST, '"createG4GenesisTier",', '"createG4GenesisTierRemoved",', TIER)],
  ["G4⑥ 「在锁购买按开锁档价」口径被削(文案钉扎回归)",
    () => inject(G4VIEW, "在锁购买按开锁档价结算不追溯", "购买结算不追溯", TIER)],
  ["G4⑦ 读侧整数校验退化成 isFinite(小数价三处契约打架形态)",
    () => inject(G4CLIENT, ".every(Number.isInteger)", ".every(Number.isFinite)", TIER)],
  ["G4⑧ 读侧连续性校验被弱化(乱序/重叠档放行)",
    () => inject(G4CLIENT, "from !== previousTo", "from < previousTo", TIER)],
  ["G4⑨ 档位 mutation 丢 CAS 版本参数(幂等键防不了并发)",
    () => inject(G4CLIENT, "{ to, priceUSDT, expectedTiersVersion, reason, operator },", "{ to, priceUSDT, reason, operator },", TIER)],
  ["G4⑪ 单价仲裁失守:tiers 在场时调整按钮回渗",
    () => inject(G4VIEW, "{!tiers && allowed(paramAuthority(priceParam.key))", "{allowed(paramAuthority(priceParam.key))", TIER)],
  ["G4⑩ 代理单档端点(len-4)被移除",
    () => inject(MKTPROXY, 'parts.length === 4 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "tiers" &&', 'parts.length === 4 && parts[0] === "nex" && parts[1] === "genesis" && parts[2] === "tiersx" &&', TIER)],

  // ══ F5 commission-hold 门 ═══════════════════════════════════════
  ["F5①a cooling 行丢「冻结」入口(换成别的动作)",
    () => inject(F5VIEW, 'dispose("freeze", row)}>冻结', 'dispose("unlock", row)}>冻结', HOLD)],
  ["F5①b frozen 行丢「解冻」出口(冻结变相终态)",
    () => inject(F5VIEW, 'row.status === "frozen" && <button className="fbtn" onClick={() => dispose("unfreeze", row)}', 'row.status === "reversed" && <button className="fbtn" onClick={() => dispose("unfreeze", row)}', HOLD)],
  ["F5②a 提前解锁不再标 amplify(放大流出方向失守)",
    () => inject(F5VIEW, "amplify: true, fixedVal: \"unlocked\", detail: `提前解锁", "amplify: false, fixedVal: \"unlocked\", detail: `提前解锁", HOLD)],
  ["F5②b paramKey 改成前端手拼(绕开服务端下发的 auditKey)",
    () => inject(F5VIEW, "paramKey: row.auditKey", "paramKey: `F.commission.${row.id}.status`", HOLD)],
  ["F5③ shell dispose 分支改形(F5 路由调用形状漂移)",
    () => inject(FSHELL, "await ctx.updateF5Config(mc.paramKey, mc.fixedVal, reason);", "await ctx.updateF5Config(String(mc.paramKey), String(mc.fixedVal), reason);", HOLD)],
  ["F5⑤ manifest OPS-F-10 口径回退成旧三词",
    () => inject(MANIFEST, '"action": "单笔冻结/提前解锁/解冻(dispose → f_commission_status A2 票)"', '"action": "冻结/解锁/驳回"', HOLD)],
  ["F5⑥ dispose toast 回退成「已生效」谎报(诚实性回归)",
    () => inject(FSHELL, 'setToast(mc.name + " 已提交 · A2 待执行队列");', 'setToast(mc.name + " 已生效");', HOLD)],

  // ══ K1 release-params 门 ════════════════════════════════════════
  ["K1①a 七参数键集换走一个(appAttestationReleaseHours 被顶掉)",
    // 单行锚(CRLF 教训同上);带引号形态只在键集数组出现,LIMITS 里是无引号键名,不撞。
    () => inject(KCLIENT, '"appAttestationReleaseHours",', '"appAttestationReleaseHoursX",', REL)],
  ["K1②a 缺席向后兼容写法漂移(== null 判据被改)",
    () => inject(KCLIENT, "const releaseParams = data.releaseParams == null ? []", "const releaseParams = data.releaseParams === undefined ? []", REL)],
  ["K1②b mutation 端点并进拦截参数端点",
    () => inject(KCLIENT, "apiRequest(`/multi-account/release-params/", "apiRequest(`/multi-account/params/", REL)],
  ["K1③a 下拉选项在组件里另抄一份(脱离 k-client 白名单单源)",
    () => inject(KVIEW, '{(isMode ? [...K1_RELEASE_MODE_VALUES] : ["true", "false"]).map', '{(isMode ? ["attest_or_manual", "manual_only"] : ["true", "false"]).map', REL)],
  ["K1③b 命令号 scope 丢参数键前缀(pending store 撞键形态)",
    () => inject(KVIEW, "const releaseScope = (key: string) => `release-param:${key}`;", "const releaseScope = (key: string) => `release-param-${key}`;", REL)],
  ["K1④ 簇详情收益影响锚被删",
    () => inject(KVIEW, 'data-proof="k1-cluster-earning-impact"', 'data-proof="k1-cluster-earning"', REL)],
  ["K1⑤ 组件出现 0.7 阈值硬编码",
    () => inject(KVIEW, "const RELEASE_MODE_LABELS", 'const LEGACY_BASELINE = "0.7 基线";\nconst RELEASE_MODE_LABELS', REL)],
  ["K1⑥ 「不随时间自动放行」口径被削(文案钉扎回归)",
    () => inject(KVIEW, "不随时间自动放行", "按窗口放行", REL)],
];

let bad = 0;
for (const [name, run] of CASES) {
  let red;
  try { red = run(); } catch (e) { console.log(`  ⚠️  ${name} —— 红测本身出错:${e.message}`); bad++; continue; }
  if (!red) bad++;
  console.log(`  ${red ? "✅" : "❌"} ${name}  →  ${red ? "红(判据有效)" : "绿(判据形同虚设)"}`);
}

// 还原后必须回到全绿 —— 否则说明某个 finally 没还干净。
const tierGreen = !gateRed(TIER);
const holdGreen = !gateRed(HOLD);
const relGreen = !gateRed(REL);
console.log(`\n还原后复跑:G4 门 ${tierGreen ? "绿" : "红 ❌"} · F5 门 ${holdGreen ? "绿" : "红 ❌"} · K1 门 ${relGreen ? "绿" : "红 ❌"}`);
if (!tierGreen || !holdGreen || !relGreen) bad++;
console.log(`红测:${CASES.length - bad}/${CASES.length} 通过${bad ? " —— 有判据抓不住对应形态" : ""}`);
process.exit(bad === 0 ? 0 : 1);
