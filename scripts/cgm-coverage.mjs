// CGM 覆盖 gate — 字段级控制实现进度的硬门。
// 读 docs/cgm/cgm.manifest.json:对 batch≤$CGM_BATCH 的行,coverage∈{gap,spec_only} → FAIL(exit 1);
// waived 须带非空理由;built 反查 adminTarget 真存在(registry/nav grep)。
// 用法:CGM_BATCH=B1 node scripts/cgm-coverage.mjs   (不设默认 B9 = 全运营面 0 gap 常驻门;暂存新批次时临时降批)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'docs', 'cgm', 'cgm.manifest.json');
const BATCH_ORDER = ['B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B9'];
const cur = process.env.CGM_BATCH || 'B9';
const curIdx = BATCH_ORDER.indexOf(cur);
if (curIdx < 0) { console.error(`✗ CGM_BATCH=${cur} 非法(取 ${BATCH_ORDER.join('/')}）`); process.exit(2); }

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const rows = m.rows || [];

// built 行反查:adminTarget 指向的 registry path / hub section / page route 是否真存在
const registryDir = path.join(ROOT, 'lib', 'admin', 'registry');
let registryBlob = '';
try { for (const f of fs.readdirSync(registryDir)) if (f.endsWith('.ts')) registryBlob += fs.readFileSync(path.join(registryDir, f), 'utf8'); } catch {}
let appBlob = '';
const appDir = path.join(ROOT, 'app');
const walk = (d) => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const fp = path.join(d, e.name); if (e.isDirectory()) walk(fp); else if (/\.(tsx?|jsx?)$/.test(e.name)) appBlob += fp + '\n'; } } catch {} };
walk(appDir);
let navBlob = '';
try { navBlob = fs.readFileSync(path.join(ROOT, 'lib', 'nav', 'console-nav.ts'), 'utf8'); } catch {}
const adminTargetExists = (t) => {
  if (!t) return false;
  const v = String(t);
  if (v.startsWith('registry:')) { const r = v.slice(9); return registryBlob.includes(`"${r}"`) || registryBlob.includes(`'${r}'`) || navBlob.includes(`"${r}"`); }
  if (v.startsWith('page:')) { const r = v.slice(5).replace(/^\//, ''); return navBlob.includes(`"/${r}"`) || appBlob.includes(r.replace(/\//g, path.sep)) || appBlob.includes(r); }
  if (v.startsWith('hub:')) return appBlob.toLowerCase().includes('hub'); // 360 HUB 区块,粗校验
  return false;
};

let inScope = 0, fail = 0; const problems = [];
for (const r of rows) {
  const bi = BATCH_ORDER.indexOf(r.batch || 'B9');
  if (bi < 0 || bi > curIdx) continue; // 未到批次
  inScope++;
  const cov = String(r.coverage || 'gap');
  if (cov === 'gap' || cov === 'spec_only') { fail++; problems.push(`${r.id} [${cov}] ${r.frontendField}`); continue; }
  if (cov.startsWith('waived')) {
    const reason = cov.replace(/^waived[:·\s]*/, '').trim();
    if (!reason) { fail++; problems.push(`${r.id} [waived 无理由]`); }
    continue;
  }
  if (cov === 'built') {
    if (!adminTargetExists(r.adminTarget)) { fail++; problems.push(`${r.id} [built 但 adminTarget 不存在] ${r.adminTarget || '(空)'}`); }
    continue;
  }
  fail++; problems.push(`${r.id} [未知 coverage=${cov}]`);
}

// 中性运营语言门:CGM 数据文档(manifest + CGM-{域}.md)禁 meta/操纵市场俚语。
// README.md / 本脚本含规则说明与禁用表,故不在扫描范围(仅扫数据文档)。
const BANNED = /(庞氏|割韭菜|杀猪盘|操纵用户|收割用户|操纵骗局|拉盘|砸盘|跑路|\bponzi\b|\bscam\b|\bvictim\b)/gi;
const bannedHits = [];
for (const mt of JSON.stringify(rows).matchAll(BANNED)) bannedHits.push('manifest: ' + mt[0]);
try {
  const dir = path.dirname(MANIFEST);
  for (const f of fs.readdirSync(dir)) if (/^CGM-[A-Z]\.md$/.test(f)) for (const mt of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(BANNED)) bannedHits.push(f + ': ' + mt[0]);
} catch {}

console.log(`CGM coverage gate @ ${cur}: 范围内 ${inScope} 行 / 全量 ${rows.length} 行,未覆盖 ${fail}`);
if (bannedHits.length) console.log(`  ✗ 中性语言违例 ${bannedHits.length}: ${[...new Set(bannedHits)].slice(0, 8).join(' / ')}(改中性运营术语)`);
if (fail || bannedHits.length) {
  console.log(problems.slice(0, 50).map((p) => '  ✗ ' + p).join('\n'));
  if (problems.length > 50) console.log(`  … 另 ${problems.length - 50} 条`);
  process.exit(1);
}
console.log(`  ✓ batch≤${cur} 全部 built/waived(已实现或显式豁免) · 中性语言 0 违例`);
process.exit(0);
