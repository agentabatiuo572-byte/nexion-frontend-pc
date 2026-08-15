/**
 * 红测：证明提现主键 parity 门既会抓漂移，也不会误伤合法例外。
 * PRD 与代码注入都只发生在一次性临时副本，真实工作树始终只读。
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionPrdRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GATE = ["scripts/withdrawal-key-parity.mjs"];
const SOURCE_D_CLIENT = path.join(ROOT, "lib/admin/d-client.ts");
const SANDBOX_ROOT = mkdtempSync(path.join(os.tmpdir(), "nexion-wdkey-"));
const SANDBOX_D_CLIENT = path.join(SANDBOX_ROOT, "client", "d-client.ts");
let copied = 0;

function copyMd(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name.startsWith("_bak") || entry.name === "node_modules") continue;
    if (entry.isDirectory() && /snapshot/i.test(entry.name)) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyMd(source, target);
    else if (entry.name.endsWith(".md")) { copyFileSync(source, target); copied += 1; }
  }
  return to;
}

const SANDBOX = copyMd(resolveNexionPrdRoot({ adminRoot: ROOT }), path.join(SANDBOX_ROOT, "PRD"));
const P_V1 = path.join(SANDBOX, "Nexion_运营控制后台PRD_v1.md");
const P_SPEC = path.join(SANDBOX, "Nexion_运营后台_交互与确认机制改写SPEC.md");
mkdirSync(path.dirname(SANDBOX_D_CLIENT), { recursive: true });
copyFileSync(SOURCE_D_CLIENT, SANDBOX_D_CLIENT);

function gate() {
  const env = {
    ...process.env,
    NEXION_PRD_ROOT: SANDBOX,
    NEXION_ADMIN_DOCS_ROOT: SANDBOX_ROOT,
    NEXION_D2_CLIENT_PATH: SANDBOX_D_CLIENT,
  };
  try {
    return { red: false, output: execFileSync("node", GATE, { cwd: ROOT, env, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" }) ?? "" };
  } catch (error) {
    return { red: true, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

function inject({ file, from, to }, run = gate) {
  const backup = `${file}.redtest-bak`;
  copyFileSync(file, backup);
  try {
    const original = readFileSync(file, "utf8");
    if (!original.includes(from)) throw new Error(`注入锚点不存在：${path.basename(file)} ← ${from}`);
    const changed = original.replace(from, () => to);
    if (changed === original) throw new Error(`空注入：${path.basename(file)}`);
    writeFileSync(file, changed);
    return run();
  } finally {
    copyFileSync(backup, file);
    unlinkSync(backup);
  }
}

const cases = [
  ["T1 单笔主键漂回 withdrawalId", "red",
    () => inject({ file: P_SPEC, from: "withdrawalNo 链接", to: "withdrawalId 链接" }), "指代提现单主键"],
  ["T1b 伪否定句没给出线上真名", "red",
    () => inject({ file: P_SPEC, from: "withdrawalNo 链接", to: "withdrawalId 不是可选字段" }), "指代提现单主键"],
  ["T2a 批量入参误改为 withdrawalNos", "red",
    () => inject({ file: P_V1, from: "withdrawalIds:[]", to: "withdrawalNos:[]" }), "指代提现单主键"],
  ["T2b 批量入参数组误用单笔主键", "red",
    () => inject({ file: P_V1, from: "withdrawalIds:[]", to: "withdrawalNo:[]" }), "批量入参数组写成"],
  ["T3a conflicts 成员误改为 withdrawalNo", "red",
    () => inject({ file: P_V1, from: "conflicts[].withdrawalId", to: "conflicts[].withdrawalNo" }), "冲突回传项写成"],
  ["T3b conflicts 声明被整体删除", "red",
    () => inject({ file: P_V1, from: "conflicts[].withdrawalId", to: "端点自有冲突项" }), "冲突回传项真名的声明被删了"],
  ["T4a 删除主键点会跌破基数", "red",
    () => inject({ file: P_V1, from: "withdrawalNo / userId(链 C1)", to: "userId(链 C1)" }), "低于台账基数"],
  ["T4b 删除规格中的主键点会跌破基数", "red",
    () => inject({ file: P_SPEC, from: "withdrawalNo 链接", to: "提现单链接" }), "低于台账基数"],
  ["T5a 删除主键声明锚", "red",
    () => inject({ file: P_V1, from: "单笔主键线上真名", to: "单据主键线上真名" }), "找不到主键宣告行"],
  ["T5b 代码寻址参数单边改名", "red",
    () => inject({ file: SANDBOX_D_CLIENT, from: "fetchD2WithdrawalDetail(withdrawalNo: string)", to: "fetchD2WithdrawalDetail(withdrawalRef: string)" }), "探针失效"],
  ["T6a 代码载荷主键单边改名", "red",
    () => inject({ file: SANDBOX_D_CLIENT, from: "  withdrawalNo: string;", to: "  withdrawalRef: string;" }), "探针失效"],
  ["T6b 权威 PRD 的另一个主键点漂移", "red",
    () => inject({ file: P_V1, from: "withdrawalNo(server mint)", to: "withdrawalId(server mint)" }), "指代提现单主键"],
  ["G1 新增合法 withdrawalNo 说明", "green",
    () => inject({ file: P_SPEC, from: "withdrawalNo 链接", to: "withdrawalNo 链接（单笔主键 withdrawalNo）" })],
  ["G2 旧名的明确否定说明", "green",
    () => inject({ file: P_SPEC, from: "withdrawalNo 链接", to: "withdrawalNo 链接（旧名 withdrawalId 已废弃）" })],
  ["G3 其他 withdrawal 字段不误伤", "green",
    () => inject({ file: P_SPEC, from: "withdrawalNo 链接", to: "withdrawalNo 链接（另见 withdrawalIntentId）" })],
  ["G4 增加一处合法单笔主键", "green",
    () => inject({ file: P_SPEC, from: "跳转单笔详情面板", to: "跳转单笔详情面板（主键 withdrawalNo）" })],
];

let failed = 0;
try {
  const baseline = gate();
  if (baseline.red) {
    console.error(`✗ 基线不绿（沙箱 ${copied} 份文档）：\n${baseline.output.trim()}`);
    process.exit(1);
  }
  console.log(`基线：沙箱 ${copied} 份文档，门为绿 ✅\n`);

  const touched = [SANDBOX_D_CLIENT, P_V1, P_SPEC];
  const digest = () => touched.map((file) => createHash("sha1").update(readFileSync(file)).digest("hex")).join(" ");
  const before = digest();

  for (const [name, expected, run, expectedText] of cases) {
    const { red, output } = run();
    let ok = expected === "red" ? red : !red;
    // expectText 是失败关键词护栏：红了但理由不对，同样不能算通过。
    if (ok && expected === "red" && expectedText && !output.includes(expectedText)) ok = false;
    if (!ok) failed += 1;
    console.log(`${ok ? "✓" : "✗"} [期望${expected === "red" ? "红" : "绿"}] ${name}`);
  }

  if (digest() !== before) {
    console.error("✗ 注入文件没有逐字节还原");
    failed += 1;
  }
} finally {
  rmSync(SANDBOX_ROOT, { recursive: true, force: true });
}

console.log(failed ? `\n红测未通过：${failed} 项` : `\n红测全部按预期（${cases.length} 项）`);
process.exit(failed ? 1 : 0);
