import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolveNexionAppRoot, resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";

const isWindows = process.platform === "win32";
const npmCmd = isWindows ? "npm.cmd" : "npm";
const npxCmd = isWindows ? "npx.cmd" : "npx";

// 🔴 退出码哨兵文件:进程无论从哪条路径退出,都把真实退出码原子落盘到 .verify-exit.code。
//   why:调用侧 `npm run verify | tail` 这类管道会吞掉退出码(拿到的是 tail 的 0),
//   「verify 绿」由此被误报过两次(EVOLUTION-LEDGER WF-7/WF-10)——外部判定一律读本文件,
//   不读管道退出码。'exit' 回调里只允许同步写。
process.on("exit", (code) => {
  try { writeFileSync(".verify-exit.code", String(code)); } catch { /* 落盘失败不改变退出语义 */ }
});
// 启动即写占位:防「进程没跑起来/中途被杀,调用侧读到上一轮的 0」——读到 "running" 一律按未完成处理。
try { writeFileSync(".verify-exit.code", "running"); } catch { /* 同上 */ }

/**
 * 🔴 「环境缺件」与「真发现缺陷」必须分开处理(2026-08-05)。
 *
 * 本机没有兄弟仓 `nexion-backend` 时,依赖它的齿轮在 **import 期**就抛错;而 `run()`
 * 一遇非零退出码就 `process.exit`,于是整条链在第 14 齿断掉 —— **后面 19 个齿一次都没跑过**,
 * 而输出看起来只是「某个齿失败了」。实测:改后台代码后想验证,拿不到 15-33 齿的任何信号。
 *
 * 处置:开跑前先探仓;缺仓就把依赖它的齿**显式标记为跳过并继续**,收尾大声列出跳了哪些。
 * 🔴 **不是放宽判据**:跳过的齿会被逐条打印,且「跳过」与「通过」在收尾里分开计数 ——
 * 谁都不该把「verify 绿」误读成「33 个齿全跑了」。仓在的机器上行为完全不变。
 */
// 🔴 探仓走**现成的解析器**,不在这里另抄一份候选路径(2026-08-05 独立验收 P2-18):
//   抄一份的话今天两边一致、将来解析规则一改就静默分叉 —— 探测说「有」而齿轮说「没有」,
//   或者反过来跳过了本该跑的齿。解析器缺仓时是**抛错**(那是它对调用方的正确契约),
//   所以这里用 try/catch 把「抛错」翻译成「不存在」,而不是复制它的路径列表。
const present = (resolve) => {
  try { resolve({ adminRoot: process.cwd() }); return true; } catch { return false; }
};
/**
 * 🔴 依赖的兄弟仓**不止一个**,而且**不能靠手写齿名清单**(2026-08-05 独立验收 P0 + 红测)。
 *
 *   上一版是「手写 NEEDS_BACKEND 齿名集合」。两处都塌了:
 *   ① 新加的跨仓齿改读 Nexion-uniapp,清单里没有它 → 缺仓机器上整链在该齿断掉;
 *   ② 红测把 uniapp 仓指向不存在的路径后,链其实断在**更早**的第 15 齿
 *      `App storage-key parity` —— 那是**早就存在**的齿,同样读 uniapp 仓,
 *      而手写清单从来没收录过它。后面 20 个齿一次都没跑。
 *
 *   实测 ground truth:提到 nexion-backend 的脚本/测试有 30+ 个,而本机实际只有 7 个
 *   真的因缺仓而炸 —— 所以**「按提及派生清单」会过度跳过**,比漏跳更糟(静默少跑 20 多个齿)。
 *
 *   故改成**检测而非预测**:照常跑,齿真的非零退出时,再看它的输出是不是
 *   「缺兄弟仓」的特征错误(解析器的两句报错,或 ENOENT 命中该仓目录名)。
 *   是 → 记进跳过台账并继续;不是 → 照旧 exit。这条判据没有清单可漂移,
 *   也不会把真缺陷误判成环境问题(真缺陷不会报「找不到那个仓」)。
 */
const SIBLING_REPOS = [
  {
    name: "nexion-backend",
    envKey: "NEXION_BACKEND_ROOT",
    hint: "克隆该仓到 ../nexion-backend",
    ok: present(resolveNexionBackendRoot),
    // 解析器报错句 + 裸 readFileSync 的 ENOENT 都要认(不是所有齿都走解析器)
    signature: /未找到 Nexion Backend 项目|NEXION_BACKEND_ROOT 配置的.*不存在|ENOENT[^\n]*nexion-backend/i,
  },
  {
    name: "Nexion-uniapp",
    envKey: "NEXION_APP_ROOT",
    hint: "克隆该仓到 ../Nexion-uniapp",
    ok: present(resolveNexionAppRoot),
    signature: /未找到 Nexion App 项目|NEXION_APP_ROOT 配置的.*不存在|ENOENT[^\n]*(Nexion-uniapp|NX1\.0)/i,
  },
];
/** 所有兄弟仓都在时行为与从前**逐字节一致**(仍走 stdio:inherit 流式输出)。 */
const anyRepoMissing = SIBLING_REPOS.some((r) => !r.ok);
const skipped = [];

function run(label, command, args, gearName) {
  console.log(`== ${label} ==`);
  const executable = isWindows && command.endsWith(".cmd") ? "cmd.exe" : command;
  const finalArgs = isWindows && command.endsWith(".cmd") ? ["/d", "/s", "/c", command, ...args] : args;
  // 缺仓时才截流(需要读输出来分类);仓齐时保持 inherit,不改变既有观感与实时性。
  const result = spawnSync(executable, finalArgs, {
    cwd: process.cwd(),
    stdio: anyRepoMissing ? ["inherit", "pipe", "pipe"] : "inherit",
    shell: false,
    encoding: anyRepoMissing ? "utf8" : undefined,
  });
  if (anyRepoMissing) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
  }
  if (result.status === 0) return;
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const missing = SIBLING_REPOS.find((r) => !r.ok && r.signature.test(out));
  if (missing) {
    console.log(`   ⏭  SKIPPED — 本机无兄弟仓 ${missing.name}(设 ${missing.envKey} 可指定)`);
    skipped.push({ gear: gearName, repo: missing.name });
    return;
  }
  process.exit(result.status ?? 1);
}

// 齿轮表:序号自动派生(新增/重排齿轮不再手工改 [x/N])。本机注意:channel-parity 起的后端依赖齿轮
// 硬读兄弟仓 nexion-backend,缺仓环境链在该齿断(memory: nexion-backend-not-in-workspace)。
const GEARS = [
  ["typecheck", npxCmd, ["--no-install", "tsc", "--noEmit"]],
  ["runtime mock import guard", "node", ["scripts/check-runtime-mock-imports.mjs"]],
  ["admin auth gate sentinel", "node", ["scripts/admin-auth-gate-sentinel.mjs"]],
  ["admin auth gate contract", "node", ["--test", "tests/admin-auth-password-change-gate.test.mjs"]],
  ["workspace path resolver", "node", ["--test", "scripts/nexion-workspace-paths.test.mjs"]],
  ["canon sentinel", "node", ["scripts/canon-sentinel.mjs"]],
  ["interaction audit", "node", ["scripts/admin-interaction-audit.mjs"]],
  ["M support surface audit", "node", ["scripts/admin-support-surface-audit.mjs"]],
  ["M1 pending/failure state contract", "node", ["--test", "tests/m1-acceptance-contract.test.mjs"]],
  ["M3 App support authority contract", "node", ["--test", "tests/m3-acceptance-contract.test.mjs"]],
  ["CGM field coverage", "node", ["scripts/cgm-coverage.mjs"]],
  ["no-double-sign residue", "node", ["scripts/no-double-sign-terms.mjs"]],
  ["ops-actions integrity", "node", ["scripts/ops-actions-audit.mjs"]],
  ["PC remaining-development status contract", "node", ["--test", "tests/pc-remaining-development-status-contract.test.mjs"]],
  ["modal contract", "node", ["scripts/admin-modal-contract-audit.mjs"]],
  ["list capability", "node", ["scripts/admin-list-capability-audit.mjs"]],
  ["App storage-key parity", "node", ["scripts/uni-storage-key-sentinel.mjs"]],
  // H9 对外公布数据:同一份配置散在「规格 ③ / 前端 PublicStatsConfig / 后台 H9_FIELDS」三处,
  // 键少一个 = 运营改不到的死配置,值域抄错 = 前端收到自己判非法的值。tsc 一处都拦不住。
  // (硬读兄弟仓 Nexion-uniapp —— 该仓在本机存在,故留在前段;缺 nexion-backend 的齿见文件末尾。)
  ["H9 public-stats cross-repo parity", "node", ["scripts/h9-public-stats-parity.mjs"]],
  // H9 分位表值域**行为级**等价(真跑前端 network-rank + 后台 h9-validation,非子串):
  // 删任何一条校验(cumPct≤100 / 单调不减 / 严格升序)即红,自造更严限制同样红;
  // 附带钉 growth 代理错误文案与占位卡句号拼接。与上一齿同级硬读兄弟仓 Nexion-uniapp。
  ["H9 percentile-table behavior contract", "node", ["--test", "tests/h9-public-stats-contract.test.mjs"]],
  ["kill-switch sentinel", "node", ["scripts/kill-switch-count-sentinel.mjs"]],
  ["rhythm sentinel", "node", ["scripts/rhythm-single-source-sentinel.mjs"]],
  ["K3 contract", "node", ["--test", "tests/k3-withdraw-rules-contract.test.mjs"]],
  ["K4 contract", "node", ["--test", "tests/k4-scoring-contract.test.mjs"]],
  ["PC full-menu health gate contract", "node", ["--experimental-strip-types", "--test", "tests/pc-all-modules-health-gate-contract.test.mjs"]],
  ["KYC removal contract", "node", ["--test", "tests/kyc-removal-contract.test.mjs"]],
  ["A2 coverage sentinel", "node", ["scripts/a2-audit-coverage-sentinel.mjs"]],
  ["A2 outcome-uncertain contract", "node", ["--test", "tests/a2-outcome-uncertain-contract.test.mjs"]],
  ["E1 acceptance contract", "node", ["--test", "tests/e1-acceptance-contract.test.mjs"]],
  ["E4 commerce acceptance sandbox contract", "node", ["--test", "tests/commerce-acceptance-sandbox-contract.test.mjs"]],
  ["operation-confirm error copy", "node", ["--test", "tests/operation-confirm-error-message.test.mjs"]],
  ["G4 invite-code registry contract", "node", ["--test", "tests/g4-invite-registry-contract.test.mjs"]],
  // GEN10b 市场状态开关:此前后台侧一道专属门都没有,前一版的自由输入违规就是这么溜过去的。
  ["G4 market-open-state contract", "node", ["--test", "tests/g4-market-open-state-contract.test.mjs"]],
  // 跨仓 parity 单独成齿 —— 缺 Nexion-uniapp 的机器上它整齿跳过并进台账,
  // 而上面那道后台侧契约照跑(拆分理由见该测试文件抬头)。
  ["G4 market-open-state cross-repo parity", "node", ["--test", "tests/g4-market-open-state-parity.test.mjs"]],
  // 恢复三条中间挡位(合并底账 §二 1/4/5,主人 2026-08-06 拍板):三道门全部只读本仓、任何机器真跑。
  // 底账 §四教训 =「tab 在、行级动作被静默削减」逐文件核对测不出,故逐动作钉死成机器判据。
  ["G4 tier-pricing contract", "node", ["--test", "tests/g4-tier-pricing-contract.test.mjs"]],
  ["F5 commission-hold contract", "node", ["--test", "tests/f5-commission-hold-contract.test.mjs"]],
  // F 域稳定命令号:静态半钉咽喉表达式级接线 + 运行时半跑真 store 语义(只读本仓,任何机器真跑)。
  ["F pending-store contract", "node", ["--experimental-strip-types", "--test", "tests/f-pending-store-contract.test.mjs"]],
  ["K1 release-params contract", "node", ["--test", "tests/k1-release-params-contract.test.mjs"]],
  // D7 法币提现参数(FEAT-VND01b 方案 B 假数据面):行为级校验(倒挂/冲突/CAS)+ 真假边界形态锚。
  // strip-types flag 照 F pending-store 先例:node 24 默认剥离,node 22 LTS 需显式 flag 才能 import .ts。
  ["D7 payout-vnd local contract", "node", ["--experimental-strip-types", "--test", "tests/d7-payout-vnd-contract.test.mjs"]],
  // 释放参数调参是钱路径(管收益放行):命令号必须带输入指纹(改值再提交不被幂等窗静默吞掉)+
  // 放宽方向必须告知会核验 B1 覆盖率。两条都被独立审计抓到过,焊成门防复发。
  ["K1 release-guard contract", "node", ["--test", "tests/k1-release-guard-contract.test.mjs"]],
  // K6 接管执行可观测性:相位完整性 / 目标与版本对账 / 可重试性按分类 / 动作相位约束 + 禁用原因。
  // 只读本仓、任何机器真跑;红队口径——「下发成功 ≠ 执行成功」与「期望目标 ≠ 实际目标」两条不许再塌回黑盒。
  ["K6 takeover observability contract", "node", ["--experimental-strip-types", "--test", "tests/k6-takeover-observability-contract.test.mjs"]],
  ["in-memory idempotency-key sentinel", "node", ["scripts/pending-idempotency-key-sentinel.mjs"]],
  ["pending mutation store contract", "node", ["--test", "tests/pending-mutation-store-contract.test.mjs"]],
  // 全家族失败归类口径:5xx / 传输层失败必须归「结果未知」保住命令号,只有 4xx 与
  // 2xx 业务码非 0 才算确定性拒绝。散一处口径 = 那个域重复入账 / 重复打款。
  ["outcome classification contract", "node", ["--experimental-strip-types", "--test", "tests/outcome-classification-contract.test.mjs"]],
  // 同族「结果未知」契约:先前手跑绿但没有门守(2026-08-06 独立验收 P2-6)。
  ["a2 outcome-uncertain contract", "node", ["--test", "tests/a2-outcome-uncertain-contract.test.mjs"]],
  ["b2/b3 outcome-unknown contract", "node", ["--test", "tests/b23-outcome-unknown-contract.test.mjs"]],
  ["i4 A2 pending visibility contract", "node", ["--test", "tests/i4-a2-pending-visibility-contract.test.mjs"]],
  // 红测脚本自身的守门人:它是唯一验证「这些门有判别力」的东西,却一度语法错误跑不起来而
  // verify 全绿。这里只做静态自检(不跑红测本体 —— 它会改写源文件,并行跑互相踩)。
  ["redtest harness self-check", "node", ["--test", "tests/redtest-harness-selfcheck.test.mjs"]],
  ["pending mutation migration contract", "node", ["--test", "tests/pending-mutation-migration-contract.test.mjs"]],
  ["F1 direct-write pending-store contract", "node", ["--test", "tests/f1-direct-pending-store-contract.test.mjs"]],
  ["E domain pending-store contract", "node", ["--test", "tests/e-pending-store-contract.test.mjs"]],
  ["H8 pending-store contract", "node", ["--test", "tests/h8-pending-store-contract.test.mjs"]],
  ["L6 acceptance sandbox observability contract", "node", ["--test", "tests/l6-acceptance-sandbox-observability-contract.test.mjs"]],
  ["endpoint citation ledger", "node", ["scripts/endpoint-citation-sentinel.mjs"]],
  ["error-copy throat sentinel", "node", ["--experimental-strip-types", "scripts/error-copy-throat-sentinel.mjs"]],
  ["error-copy throat contract", "node", ["--experimental-strip-types", "--test", "tests/error-messages-backend-unavailable.test.mjs", "tests/fetch-guard.test.mjs"]],
  // 生产构建必须排在依赖兄弟仓 nexion-backend 的齿**之前**:它是最贵也最有价值的本地齿,
  // 排在后面等于在缺仓机器上永远跑不到,完成门要求的「verify 全绿(含 production build)」会结构性不可达。
  ["production build", npmCmd, ["run", "build"]],
  // ↓↓↓ 以下齿轮硬读兄弟仓 nexion-backend。缺仓的机器(本机即是)会在第一条硬崩,
  //     而 run() 是 fail-fast —— 所以它们必须集中排在**最后**,否则其后的本地齿全部执行不到。
  //     2026-08-06 前它们散在中段,导致其后 21 道本可运行的门在本机从未跑过。
  ["real recharge-channel parity", "node", ["scripts/channel-parity-sentinel.mjs"]],
  ["D1 channel contract", "node", ["--test", "tests/d1-channel-parity-contract.test.mjs"]],
  ["B4 cross-repository contract", "node", ["--test", "tests/b4-cross-repo-sentinel-contract.test.mjs"]],
  ["FE/BE mapping closure ratchet", "node", ["scripts/fe-be-mapping-coverage.mjs"]],
  ["J1 contract", "node", ["--test", "tests/j1-killswitch-contract.test.mjs"]],
  ["J2 contract", "node", ["--test", "tests/j2-geoblock-contract.test.mjs"]],
  ["K2 contract", "node", ["--test", "tests/k2-arbitrage-contract.test.mjs"]],
  // 2026-08-07 补挂:这个文件写于 2026-07-28(退役 PCFULL-035「已退役控制项仍被 PC 宣称影响真实报价」
  // 那一轮),但既不在 GEARS 也不在任何 npm script —— 一道从没跑过的门。结果 08-06 的原型对齐批
  // 原样把那三个控件加了回来,机器门一声没吭。孤儿门 = 没有门。
  ["E3 acceptance contract", "node", ["--test", "tests/e3-acceptance-contract.test.mjs"]],
];
GEARS.forEach(([label, cmd, args], index) => run(`[${index + 1}/${GEARS.length}] ${label}`, cmd, args, label));

// 🔴 收尾必须把「跳过」单独说清楚,且不能只在中间刷屏一行就算 —— 这道汇总正是为了
//   防止「verify 绿」被误读成「33 个齿全跑了」。跳过数 > 0 时,这段是最后可见的输出。
if (skipped.length > 0) {
  console.log(`\n⚠️  verify 完成,但 ${skipped.length}/${GEARS.length} 个齿轮**未运行**(环境缺件,非缺陷):`);
  for (const s of skipped) console.log(`     ⏭  ${s.gear}  ←  缺 ${s.repo}`);
  // 原因按仓分组列 —— 上一版把原因写死成 nexion-backend 一行,第二个兄弟仓加进来时
  // 台账会指着错误的仓让人去克隆(2026-08-05 独立验收 P0 的同族)。
  for (const r of SIBLING_REPOS) {
    if (r.ok || !skipped.some((s) => s.repo === r.name)) continue;
    console.log(`   原因:本机无兄弟仓 ${r.name}。要跑齐,${r.hint} 或设 ${r.envKey}。`);
  }
  console.log(`   🔴 在这台机器上「verify 通过」只覆盖 ${GEARS.length - skipped.length} 个齿,涉及跨仓契约的结论不成立。`);
  // 🔴 结论必须落到**机器可读**的信号上(2026-08-05 独立验收 P1-11)。
  //   只改人读的告警行不够:CI / 脚本 / 另一个 agent 看的是 stdout 末行与退出码,
  //   它们照旧收到「verify OK」+ exit 0,于是「26/33」被当成「33/33」继续往下走。
  //   末行改成带跳过数的形态;退出码保持 0(缺仓是环境事实,不是本仓缺陷),
  //   但要求显式确认才安静 —— 没设 NEXION_VERIFY_ALLOW_SKIP 时把它标成 DEGRADED。
  const acknowledged = process.env.NEXION_VERIFY_ALLOW_SKIP === "1";
  console.log(acknowledged
    ? `verify OK (${skipped.length} skipped, acknowledged)`
    : `verify DEGRADED (${GEARS.length - skipped.length}/${GEARS.length} gears ran, ${skipped.length} skipped) — 设 NEXION_VERIFY_ALLOW_SKIP=1 表示已知悉`);
} else {
  console.log(`\n✅ verify 完成:${GEARS.length}/${GEARS.length} 个齿轮全部运行。`);
  console.log(`verify OK (${GEARS.length}/${GEARS.length} gears)`);
}

