// 红测:逐条破坏 k1-release-guard 门的每个断言,证明它真会咬人;还原后必须复绿且字节一致。
// 备份用工程内相对路径(不同 shell 的 /tmp 不是同一个目录)。
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";

const VIEW = "app/components/domain-views/k-tabs/k1-multiaccount.tsx";
const BACKUP = "app/components/domain-views/k-tabs/.k1-multiaccount.redtest-backup";
const GATE = "tests/k1-release-guard-contract.test.mjs";

// 每条 = [编号, 说明, 破坏函数(源码 → 源码)]。破坏须**只动一处**,隔离验证单条判据。
const MUTATIONS = [
  ["M1", "把带指纹的 store 换回朴素 store",
    (s) => s.replace("const releaseAttempts = createSlotAttemptStore({",
      "const releaseAttempts = createPendingMutationStore({")],
  ["M2", "指纹里去掉理由(只按值算)",
    (s) => s.replace("JSON.stringify([value, reason.trim()])", "JSON.stringify([value])")],
  ["M3", "指纹里去掉目标值(只按理由算)",
    (s) => s.replace("JSON.stringify([value, reason.trim()])", "JSON.stringify([reason.trim()])")],
  ["M4", "改回开弹窗时铸命令号",
    (s) => s.replace('setReleaseDraft({ param: p, value: p.value, reason: "", commandKey: "" });',
      'setReleaseDraft({ param: p, value: p.value, reason: "", commandKey: newK1CommandKey() });')],
  ["M5", "结果未知时也丢弃槽位(原样重试会换号)",
    (s) => s.replace("if (!(error instanceof K1OutcomeUncertainError)) releaseAttempts.forget(scope);",
      "releaseAttempts.forget(scope);")],
  ["M6", "把「调小是放宽」写反成「调大是放宽」",
    (s) => s.replace("if (RELEASE_LOOSEN_WHEN_SMALLER.has(key)) return Number(next) < Number(current);",
      "if (RELEASE_LOOSEN_WHEN_SMALLER.has(key)) return Number(next) > Number(current);")],
  ["M7", "放宽判定漏掉一个键(观察窗口)",
    (s) => s.replace('"pendingReleaseHours", "appAttestationReleaseHours"', '"appAttestationReleaseHours"')],
  // 注:本仓源文件是 CRLF。按行切分处理,不要在整串上按 "\n" 找锚点(找不到会静默不注入,红测反而假绿)。
  ["M8", "删掉弹窗里的放宽告知块",
    (s) => {
      const eol = s.includes("\r\n") ? "\r\n" : "\n";
      const lines = s.split(eol);
      // 定位不要带前缀花括号:渲染条件前面可能还有别的前置判断(如 valueOk &&),带 `{` 会失配。
      const start = lines.findIndex((l) => l.includes("isLooseningRelease(key,"));
      if (start < 0) return s;
      const end = lines.findIndex((l, i) => i > start && l.trim() === ")}");
      if (end < 0) return s;
      lines.splice(start, end - start + 1);
      return lines.join(eol);
    }],
  ["M11", "去掉告知块的输入有效性前置(无效值会误报放大方向)",
    (s) => s.replace("{valueOk && isLooseningRelease(key,", "{isLooseningRelease(key,")],
  ["M9", "告知块留着但把证据锚删了(走查脚本抓不到)",
    (s) => s.replace('data-proof="k1-release-loosen-warning" ', "")],
  ["M10", "把判据字面量挪进注释走私(验证剥注释有效)",
    (s) => s.replace("const releaseAttempts = createSlotAttemptStore({",
      "// createSlotAttemptStore({ storageKey: \"release\" })\nconst releaseAttempts = createPendingMutationStore({")],
];

function gateResult() {
  try { execFileSync("node", ["--test", GATE], { stdio: "pipe" }); return "PASS"; }
  catch { return "FAIL"; }
}

copyFileSync(VIEW, BACKUP);
const original = readFileSync(VIEW, "utf8");
let bad = [];

if (gateResult() !== "PASS") { console.error("🔴 起点就不绿,红测无意义"); process.exit(1); }
console.log("起点:门 PASS ✓\n");

for (const [id, desc, mutate] of MUTATIONS) {
  const mutated = mutate(original);
  if (mutated === original) { bad.push(`${id} 注入无效(源码没变,判据可能已漂移)`); continue; }
  writeFileSync(VIEW, mutated, "utf8");
  const r = gateResult();
  console.log(`${id} ${desc} → 门 ${r} ${r === "FAIL" ? "✓ 会咬人" : "🔴 没咬住"}`);
  if (r !== "FAIL") bad.push(`${id} 破坏后门仍 PASS`);
  writeFileSync(VIEW, original, "utf8");
}

// 还原核验:字节一致 + 终态复绿
const restored = readFileSync(VIEW, "utf8");
if (restored !== original) bad.push("还原后字节不一致");
const finalR = gateResult();
if (finalR !== "PASS") bad.push("终态未复绿");
console.log(`\n还原字节一致: ${restored === original ? "✓" : "🔴"} | 终态: ${finalR}`);
unlinkSync(BACKUP);

if (bad.length) { console.error("\n🔴 红测未通过:\n" + bad.join("\n")); process.exit(1); }
console.log(`\n红测通过:${MUTATIONS.length}/${MUTATIONS.length} 条判据均会咬人,还原无痕`);
