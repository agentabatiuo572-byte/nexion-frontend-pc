// K1 收益释放参数的两道守护契约(2026-08-06 三路独立审查 → PM 拍板修复)
//   T-02 命令号必须带输入指纹:改了值再提交不得复用旧命令号(否则被后端 24h 幂等窗静默吞掉)
//   T-01 放宽方向必须告知:放大资金流出的改动要明示服务端会核验 B1 覆盖率
// 判据取「表达式级」而非关键词级 —— 关键词能被注释走私,表达式不能。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const VIEW = "app/components/domain-views/k-tabs/k1-multiaccount.tsx";

/** CRLF 归一 + 剥行注释:防「把字面量挪进注释」哄绿(注释里的 `.` 不匹配 \r,先归一) */
function stripComments(src) {
  return src
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const raw = readFileSync(VIEW, "utf8");
const code = stripComments(raw);

test("T-02 · 释放参数命令号走带输入指纹的 store,不走朴素 store", () => {
  assert.match(code, /createSlotAttemptStore\(\{\s*storageKey:\s*["'][^"']*release[^"']*["']/,
    "释放参数必须有自己的 SlotAttemptStore(按槽位+输入指纹解析命令号)");
  assert.match(code, /releaseAttempts\.resolve\(/,
    "提交时必须经 resolve 取命令号");
  assert.doesNotMatch(code, /commandAttempt\.(get|remember)\(\s*releaseScope/,
    "释放参数不得再走按槽位无条件复用的朴素 store");
});

test("T-02 · 指纹必须同时包含目标值与理由", () => {
  const fp = code.match(/releaseFingerprint\s*=\s*\(([^)]*)\)\s*=>\s*([^;]+);/);
  assert.ok(fp, "须有 releaseFingerprint 构造函数");
  const body = fp[2];
  assert.match(body, /value/, "指纹须含目标值——只按键复用会把改值当重试");
  assert.match(body, /reason/, "指纹须含理由——改理由也是新意图");
});

test("T-02 · 命令号在提交时解析,不在开弹窗时铸号", () => {
  const openFn = code.match(/const adjReleaseParam\s*=\s*\([^)]*\)\s*=>\s*\{[\s\S]*?\n  \};/);
  assert.ok(openFn, "须能定位 adjReleaseParam");
  assert.doesNotMatch(openFn[0], /newK1CommandKey\(\)/,
    "开弹窗时铸号 = 还不知道运营要填什么,就无法区分「原样重试」和「改值再提交」");
});

test("T-02 · 结果未知不得丢弃槽位(丢了就无法原样重试复用同号)", () => {
  const save = code.match(/const saveReleaseDraft[\s\S]*?\n  \};/);
  assert.ok(save, "须能定位 saveReleaseDraft");
  assert.match(save[0], /if\s*\(!\(error instanceof K1OutcomeUncertainError\)\)\s*releaseAttempts\.forget/,
    "只有确定性失败才丢弃槽位;结果未知必须保留");
});

test("T-01 · 放宽方向判定覆盖全部七个键,且两族数值方向相反", () => {
  const KEYS = ["freePhoneSlotsPerCluster", "duplicateAccountPendingFrom", "duplicateAccountFreezeFrom",
    "pendingReleaseHours", "appAttestationReleaseHours", "releaseMode", "freeSlotRequiresBinding"];
  for (const k of KEYS) {
    assert.match(code, new RegExp(k), `放宽判定须覆盖键 ${k}`);
  }
  assert.match(code, /RELEASE_LOOSEN_WHEN_LARGER[\s\S]{0,200}?Number\(next\)\s*>\s*Number\(current\)/,
    "槽位/起点族:调大才是放宽");
  assert.match(code, /RELEASE_LOOSEN_WHEN_SMALLER[\s\S]{0,200}?Number\(next\)\s*<\s*Number\(current\)/,
    "窗口/时长族:调小才是放宽(方向相反,写反等于门失效)");
});

test("T-01 · 放宽时弹窗必须渲染告知块", () => {
  assert.match(code, /isLooseningRelease\(\s*key\s*,[^)]*\)\s*&&/,
    "弹窗须按放宽判定条件渲染告知");
  assert.match(code, /data-proof="k1-release-loosen-warning"/,
    "告知块须带可被走查脚本抓取的证据锚");
  const warn = raw.slice(raw.indexOf("k1-release-loosen-warning"));
  assert.match(warn.slice(0, 400), /覆盖率/, "告知文案须点明会核验备付金覆盖率");
});

test("门自身有效性 · 判据锚点在源文件里真实存在(防空集假绿)", () => {
  assert.ok(raw.length > 1000, "源文件须非空");
  assert.ok(raw.includes("releaseAttempts"), "样本量自检:releaseAttempts 必须在源文件出现");
  assert.ok(raw.includes("isLooseningRelease"), "样本量自检:isLooseningRelease 必须在源文件出现");
});
