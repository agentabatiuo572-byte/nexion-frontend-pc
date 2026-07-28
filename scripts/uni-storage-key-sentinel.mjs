import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveNexionAppRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UNI_SRC = path.join(resolveNexionAppRoot({ adminRoot: ROOT }), "src");
const SCRIPTS = path.join(ROOT, "scripts");
const KEY_RE = /(?:nexion|nexgrid)-[a-z0-9]+(?:-[a-z0-9]+)*/g;
const STORAGE_CALL_PREFIX_RE = /(?:StorageSync|localStorage\.(?:getItem|setItem|removeItem)|\bstore|\bacctRow)\s*\(\s*["']$/;
const STORAGE_KEY_PREFIX_RE = /\b[A-Z][A-Z0-9_]*(?:KEY|KEYS)\b[\s\S]{0,80}["']$/;
const SELF = path.basename(fileURLToPath(import.meta.url));

function stripComments(src, ext) {
  let result = src.replace(/\/\*[\s\S]*?\*\//g, "");
  result = result.replace(/(^|[^:])\/\/.*$/gm, "$1");
  if (ext === ".vue") result = result.replace(/<!--[\s\S]*?-->/g, "");
  return result;
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(target));
    else files.push(target);
  }
  return files;
}

function contextualKeyMatches(body) {
  const matches = [];
  for (const match of body.matchAll(KEY_RE)) {
    const start = Math.max(0, match.index - 180);
    const prefix = body.slice(start, match.index);
    if (STORAGE_CALL_PREFIX_RE.test(prefix) || STORAGE_KEY_PREFIX_RE.test(prefix)) matches.push(match);
  }
  return matches;
}

function collectAppKeys() {
  const keys = new Set();
  for (const file of walkFiles(UNI_SRC)) {
    const ext = path.extname(file);
    if (![".ts", ".vue", ".js", ".mjs"].includes(ext)) continue;
    const body = stripComments(fs.readFileSync(file, "utf8"), ext);
    for (const match of contextualKeyMatches(body)) keys.add(match[0]);
  }
  return keys;
}

function collectScriptRefs() {
  const refs = [];
  for (const file of walkFiles(SCRIPTS)) {
    if (!file.endsWith(".mjs") || path.basename(file) === SELF) continue;
    const body = stripComments(fs.readFileSync(file, "utf8"), ".mjs");
    for (const match of contextualKeyMatches(body)) {
      if (match[0].startsWith("nexion-admin-")) continue;
      const line = body.slice(0, match.index).split(/\r?\n/).length;
      refs.push({ key: match[0], file: path.relative(ROOT, file).replaceAll("\\", "/"), line });
    }
  }
  return refs;
}

if (!fs.existsSync(UNI_SRC)) {
  console.error(`✗ uni-storage-key-sentinel: Nexion App src 不存在: ${UNI_SRC}`);
  process.exit(1);
}

const appKeys = collectAppKeys();
const refs = collectScriptRefs();
const stale = refs.filter((ref) => !appKeys.has(ref.key));
if (stale.length) {
  console.error(`✗ uni-storage-key-sentinel: ${stale.length} 处脚本引用了 App 已不存在的 storage 键:`);
  stale.forEach((ref) => console.error(`  - ${ref.key} @ ${ref.file}:${ref.line}`));
  process.exit(1);
}

console.log(`✓ uni-storage-key-sentinel: ${refs.length} 处脚本引用全部匹配 App 现役键（${appKeys.size} 个）`);
