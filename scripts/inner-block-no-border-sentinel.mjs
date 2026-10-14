#!/usr/bin/env node
/**
 * 卡内嵌套铁律哨兵 —— inner-block-no-border-sentinel
 *
 * 铁律(主人 2026-06-23 指令):卡片套卡片的设计里,**非按钮类、带背景填充的内嵌元素禁止再加 border 描边**。
 * 正确范式 = soft bg tint + 内容色(参照 globals .badge-s:只有 background + color,无 border)。
 *
 * 为什么要这道机器门:这条规则此前只活在 memory/skill 文本里(feedback_inner_block_no_border),
 * port 设计稿时极易把设计稿自带的「bg + border」chip 原样照搬而漏掉本平台的「单一视觉差异」准则,
 * 反复复犯。把语义规则下沉成 grep 机器门后,任何新引入的「filled chip + border」会被 verify 拦下,
 * 不再依赖人/agent 记得这条铁律。(进化闭环:语义规则 → 机器门)
 *
 * 判定:一条 CSS 规则若同时满足
 *   (1) 有「填充背景」:background 命中 *-soft / surface-2 / surface-3 / 彩色 rgba(...) tint
 *   (2) 有「四边描边」:border: 1|2px solid ...(非 dashed/0/none),或 border-color 指向真实颜色
 *   (3) 选择器不在豁免名单(按钮/输入/callout/流程图节点/内联 code/外层卡 等)
 * → 判违规,verify 失败。
 *
 * 仅作 border-top/right/bottom/left 的(行/段分隔线、accent 左条)不计;dashed(空态占位)不计;
 * 透明背景的描边 chip 不计(单一视觉差异的合法选项)。
 *
 * --support-profile:客服资料 CSS + 页面 JSX + 共享 StatusPill 的严格门，接入 verify。
 * 无参数:递归扫描域 CSS 的审计模式；历史命中须核对真实控件角色，不自动豁免。
 * shortcut: CSS 只匹配同一规则的填充和描边，跨规则继承与运行时计算值交给实景验收；需要全站强制时升级为 computed-style 检查。
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

// ── 扫描目标 CSS ──
export function cssFilesUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? cssFilesUnder(file) : entry.name.endsWith(".css") ? [file] : [];
  });
}
const cssFiles = [];
const dvDir = join(ROOT, "app/components/domain-views");
if (existsSync(dvDir)) {
  cssFiles.push(...cssFilesUnder(dvDir));
}
cssFiles.push(join(ROOT, "app/globals.css"));
const ovDir = join(ROOT, "app/(console)/overview");
if (existsSync(ovDir)) {
  cssFiles.push(...cssFilesUnder(ovDir));
}
cssFiles.push(...cssFilesUnder(join(ROOT, "app/_console/users/search/[id]")));

// ── 豁免选择器(这些类「filled + border」是合法的,不算违规)──
// 角色:按钮/交互控件 · 输入框 · callout/通知 · 流程图/状态机/时间线节点 · 聊天气泡 · 内联 code/kbd · 外层卡 · meter/track/cell 等图元
// 注:用「角色名」而非穷举每个类名;真正的展示 chip(tag/pill/cur/badge 等)刻意不豁免,保持被拦。
const EXEMPT = /(button|btn|\bcta\b|f-cta|\bfchip\b|\bchip\b|\btab\b|\bstep\b|\badj\b|toggle|\bsw\b|\bfld\b|\binp\b|input|textarea|\bta\b|select|search|drop|pager|pageno|\bseg\b|\bacts?\b|cvp|composer|\btool\b|\badd\b|\brwd\b|icon-btn|tint|alertbar|\bnote\b|lead|callout|guard|warn|sm-node|sm-branch|sm-connect|\bbox\b|branch|connect|\bphase\b|\bdot\b|curve|bubble|\bmsg\b|handler|\bcode\b|kbd|\bph\b|meter|spark|\bring\b|cell|track|scrim|modal|drawer|\bcard\b|rail|\bpod\b|band|\bhelp\b|\bitem\b|kind(?!-))/i;
// 跳过的伪类状态(hover/active/focus 的 border 变化是交互反馈,非静态 chip 描边)
const PSEUDO_STATE = /:(hover|active|focus|focus-within|focus-visible|disabled|checked|not\()/i;

// ── 颜色判定 ──
const FILL_RE = /background(?:-color)?\s*:\s*[^;]*?(--[a-z0-9-]*-soft|--(?:v5-)?surface(?:-[23])?\b|color-mix\(|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+)/i;
// 四边 border(非 dashed / 非 0 / 非 none / 非 transparent)
const BORDER_FULL_RE = /(?:^|;|\{)\s*border\s*:\s*(?!0(?:\.0+)?px\b)[0-9.]+px\s+solid\s+(?!transparent)[^;]+/i;
// border-color 指向真实颜色(排除 transparent / currentColor)
const BORDER_COLOR_RE = /border-color\s*:\s*(?!transparent|currentcolor)(var\(--[a-z0-9-]*(?:border|brand|cyan|warning|success|danger)[a-z0-9-]*\)|rgba\(\s*\d+|color-mix\()/i;

function flattenMedia(css) {
  // 去掉 @media (...) { 包裹层,使内层规则可被 } 切分(简单展平)
  return css.replace(/@media[^{]*\{/gi, " ").replace(/@supports[^{]*\{/gi, " ").replace(/@keyframes[^{]*\{[\s\S]*?\}\s*\}/gi, " ");
}

function splitRules(css) {
  // 朴素切分:按 '}' 分段,每段取最后一个 '{' 前为选择器、后为 body
  const rules = [];
  for (const chunk of css.split("}")) {
    const i = chunk.lastIndexOf("{");
    if (i < 0) continue;
    const selector = chunk.slice(0, i).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const body = chunk.slice(i + 1);
    if (selector && body) rules.push({ selector, body });
  }
  return rules;
}

export function scanCss(raw, strict = false) {
  const hits = [];
  const css = flattenMedia(raw.replace(/\/\*[\s\S]*?\*\//g, "")); // 去注释再展平
  for (const { selector, body } of splitRules(css)) {
    // strict 仅豁免实际控件选择器和 M3 中已核对的按钮类，不沿用 card/note/item 等语义猜测。
    const controls = /(?:^|[\s>+~,])(?:button|input|select|textarea|a)(?=[.#:[\s>+~,]|$)|\.m3-profile-(?:open|link)\b/i;
    const selectors = selector.split(/,(?![^()]*\))/);
    if (strict ? selectors.every((part) => controls.test(part) || /:(hover|active|focus|focus-within|focus-visible|disabled|checked)\b/i.test(part)) : PSEUDO_STATE.test(selector) || selectors.every((part) => EXEMPT.test(part))) continue;
    const hasFill = FILL_RE.test(body);
    if (!hasFill) continue;
    const hasBorder = BORDER_FULL_RE.test(body) || BORDER_COLOR_RE.test(body);
    if (!hasBorder) continue;
    hits.push({ selector, body: body.replace(/\s+/g, " ").trim().slice(0, 120) });
  }
  return hits;
}

export function scanProfileTsx(content) {
  const source = ts.createSourceFile("profile.tsx", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const control = /^(button|a|input|select|textarea)$/.test(tag) || attrs.some((a) => /^(onClick|onKeyDown)$/.test(a.name.getText(source)) || a.name.getText(source) === "role" && /["'](button|link|checkbox|switch|tab)["']/.test(a.initializer?.getText(source) ?? ""));
      const style = attrs.find((a) => a.name.getText(source) === "style");
      const obj = style?.initializer && ts.isJsxExpression(style.initializer) ? style.initializer.expression : null;
      if (!control && obj && ts.isObjectLiteralExpression(obj)) {
        const properties = obj.properties.filter(ts.isPropertyAssignment);
        const fill = properties.find((p) => /^(background|backgroundColor)$/.test(p.name.getText(source)));
        const border = properties.find((p) => /^(border|borderColor)$/.test(p.name.getText(source)));
        if (fill && border && FILL_RE.test(`background:${fill.initializer.getText(source)}`) && /["'`]\s*(?:(?!0(?:\.0+)?px\b)[0-9.]+px\s+solid\s+(?!transparent|none)|(?:var\(|color-mix\(|#|rgba?\())/.test(border.initializer.getText(source))) {
          hits.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: obj.getText(source).replace(/\s+/g, " ").slice(0, 140) });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const supportProfileOnly = process.argv.includes("--support-profile");
const violations = [];
for (const file of cssFiles) {
  if (!existsSync(file)) continue;
  const strict = /(?:m3-customer-profile|customer-panorama)\.css$/.test(file);
  if (supportProfileOnly && !strict) continue;
  violations.push(...scanCss(readFileSync(file, "utf8"), strict).map((hit) => ({ file: file.replace(ROOT + "/", "").replace(ROOT + "\\", ""), ...hit })));
}

// ── best-effort inline 单行检测(domain-views + overview 的 tsx)──
const inlineHits = [];
const tsxDirs = [join(ROOT, "app/components/domain-views"), join(ROOT, "app/(console)/overview")];
function walkTsx(dir) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkTsx(p);
    else if (e.name.endsWith(".tsx")) {
      const content = readFileSync(p, "utf8");
      // 逐个 inline style 对象判定(必须在同一个 style={{ ... }} 块内既有填充背景又有四边描边;
      // 不跨块匹配 —— 否则一行里两个不同 span 的 bg/border 会被误判)
      const styleRe = /style=\{\{([^{}]*)\}\}/g;
      let m;
      while ((m = styleRe.exec(content)) !== null) {
        const obj = m[1];
        // inline 无 class/role 上下文,无法区分 input/dot/chip → 只认「accent -soft / 彩色 rgba 填充 + 描边」
        // 这个组合几乎必是 chip/badge/icon-容器(如 T 档位 pill);中性 surface-2/3 填充(输入框/状态点)不计,交给 CSS gate + 审计层。
        const hasFill = /background(?:-color)?\s*:\s*["'`]?[^,}]*(-soft|rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+)/.test(obj);
        const hasBorder = /\bborder\s*:\s*["'`]?[0-9.]+px\s+solid\s+(?!transparent|none)/.test(obj) && !/border\s*:\s*["'`]?[^,}]*dashed/.test(obj);
        if (hasFill && hasBorder) {
          const line = content.slice(0, m.index).split("\n").length;
          inlineHits.push({ file: p.replace(ROOT + "/", "").replace(ROOT + "\\", ""), line, text: obj.replace(/\s+/g, " ").trim().slice(0, 140) });
        }
      }
    }
  }
}
if (!supportProfileOnly) tsxDirs.forEach(walkTsx);
const profileFile = join(ROOT, "app/_console/users/search/[id]/page.tsx");
if (existsSync(profileFile)) inlineHits.push(...scanProfileTsx(readFileSync(profileFile, "utf8")).map((hit) => ({ file: "app/_console/users/search/[id]/page.tsx", ...hit })));
const pillFile = join(ROOT, "app/components/kit/status-pill.tsx");
if (existsSync(pillFile)) inlineHits.push(...scanProfileTsx(readFileSync(pillFile, "utf8")).map((hit) => ({ file: "app/components/kit/status-pill.tsx", ...hit })));

const total = violations.length + inlineHits.length;
if (total === 0) {
  console.log(`  ✓ inner-block-no-border: ${supportProfileOnly ? "客服资料 strict CSS + page JSX + StatusPill（全仓历史规则未验）" : `${cssFiles.length} CSS 文件`} 0 处「非按钮 filled chip + border」违规`);
  process.exit(0);
}

console.error(`  ✗ inner-block-no-border: 发现 ${total} 处「非按钮 filled chip/icon/badge + border」违规(卡内嵌套铁律)`);
for (const v of violations) console.error(`    [css] ${v.file}  «${v.selector}»  → ${v.body}`);
for (const h of inlineHits) console.error(`    [inline] ${h.file}:${h.line}  → ${h.text}`);
console.error(`  修法:删掉这些规则的 border/border-color,保留 background + color(参照 .badge-s)。`);
console.error(`  客服资料 strict 仅豁免真实控件；其它区域的合法角色须先核对 DOM，勿按类名扩大豁免。`);
process.exit(1);
}
