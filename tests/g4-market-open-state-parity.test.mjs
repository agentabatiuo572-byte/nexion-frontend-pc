/**
 * G4 市场状态 —— **跨仓 parity**(admin ↔ uniapp)。规格 FEAT-GEN10b ③。
 *
 * 🔴 为什么从契约门里拆出来单独成齿(2026-08-05 独立验收 P0):
 *   本文件读兄弟仓 `Nexion-uniapp`。缺仓的机器(CI / 新 checkout)上它在 **import 期**
 *   就 ENOENT → `node --test` 非零 → verify 的 `run()` 直接 `process.exit`,
 *   **后面所有齿一个都不跑**,而输出只像「某个齿失败了」。
 *   `scripts/verify.mjs` 抬头那段注释正是为这件事写的(当时踩的是 nexion-backend);
 *   把跨仓断言留在后台侧契约文件里,等于换一个兄弟仓把同一个坑原样重犯。
 *   拆开之后:本齿进 `NEEDS_UNIAPP` 跳过台账**大声列出**,后台侧那 5 条照跑 —— 而
 *   那 5 条(理由必填 / 下拉不自由输入 / 两个独立动作 / 展示两件)恰恰是 CI 最该守的。
 *
 * 🔴 仓路径走**现成解析器** `resolveNexionAppRoot`,不在这里另抄候选路径:
 *   抄一份的话今天两边一致、将来解析规则一改就静默分叉 —— 探测说「有」而本齿说「没有」,
 *   或者反过来跳过了本该跑的齿(同 verify.mjs 里已记的那条)。
 *
 * 🔴 「仓不在」与「仓在但文件没了」是两回事:前者是环境缺件(由 verify 跳过),
 *   后者是**真缺陷**(前端 store 被删/改名),必须炸,不许混为一谈。
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const ADMIN_ROOT = fileURLToPath(new URL("../", import.meta.url));
const APP_ROOT = resolveNexionAppRoot({ adminRoot: ADMIN_ROOT });
const UNI_CONFIG = path.join(APP_ROOT, "src", "store", "genesis-config.ts");

const VIEW = path.join(ADMIN_ROOT, "app/components/domain-views/g-tabs/g4-genesis.tsx");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

test("③ 前端字段名与后台一致(marketOpenState)", () => {
  assert.ok(existsSync(UNI_CONFIG),
    `兄弟仓在(${APP_ROOT})但 src/store/genesis-config.ts 不存在 —— 前端 store 被删或改名,不是环境缺件`);
  const uni = readFileSync(UNI_CONFIG, "utf8");
  assert.match(uni, /marketOpenState\s*:\s*"open"\s*\|\s*"closed"/,
    "前端字段名与后台不一致 —— fail-open 会让『已关市场』表现成『照常可买』");
  // 🔴 「新名出现过」是**弱判据**:该文件里同形声明有三处(GenesisPurchaseInput /
  //   genesisSecondaryBlock 的 cfg / GenesisConfig),改回旧名一处、剩两处仍能哄绿
  //   —— 红测第一发即证实(2026-08-05)。强判据是验「**旧名还剩几处**」,必须是 0。
  //   注意只禁**声明形态**:hydrate 里的迁移读取 `{ marketStatus?: unknown }` 是
  //   刻意保留的旧行兼容,不在此列。
  assert.doesNotMatch(uni, /marketStatus\s*:\s*"open"\s*\|\s*"closed"/,
    "有声明改回了旧名 marketStatus —— 两端字段名分叉,接线时必串档");
});

test("② 后台下拉选项集与前端白名单逐项等价", () => {
  assert.ok(existsSync(UNI_CONFIG), `兄弟仓在但前端 store 文件不存在:${UNI_CONFIG}`);
  const uni = readFileSync(UNI_CONFIG, "utf8");
  const view = strip(readFileSync(VIEW, "utf8"));

  const a = view.indexOf("noticeKey");
  assert.ok(a >= 0, "后台动作里找不到 noticeKey 字段(实现被改名或删除?)");
  const b = view.indexOf("reasonMax", a);
  assert.ok(b > a, "noticeKey 之后找不到 reasonMax 锚点");
  const block = view.slice(a, b);

  const opts = [...(block.match(/options:\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const white = [...(uni.match(/GENESIS_CLOSED_NOTICE_KEYS\s*=\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  // 🔴 两边都不许是空集 —— 判据失效(正则没命中)会让 deepEqual([], []) 静默全过。
  assert.ok(opts.length >= 3, `后台选项集解析异常(实测 ${opts.length} 项)`);
  assert.ok(white.length >= 3, `前端白名单解析异常(实测 ${white.length} 项)`);
  assert.deepEqual(opts, white,
    `后台下拉与前端白名单不等价:admin=${opts.join("/")} vs uniapp=${white.join("/")} —— 前端不认的键会静默回退 default,运营看不出异常`);
});
