import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const source = process.env.PROMOTION_OPENAPI || path.resolve('../growth-promotions-prd-20261007-backend/docs/specs/growth-promotions/openapi.json');
const raw = readFileSync(source, 'utf8');
const spec = JSON.parse(raw);
function type(s) {
  if (s.$ref) return s.$ref.split('/').at(-1);
  if ('const' in s) return JSON.stringify(s.const);
  if (s.enum) return s.enum.map(v => JSON.stringify(v)).join(' | ');
  if (s.oneOf || s.anyOf) return (s.oneOf || s.anyOf).map(v => `(${type(v)})`).join(' | ');
  if (Array.isArray(s.type)) return s.type.map(v => type({ ...s, type: v })).join(' | ');
  if (s.type === 'null') return 'null';
  if (s.type === 'string') return 'string';
  if (s.type === 'integer' || s.type === 'number') return 'number';
  if (s.type === 'boolean') return 'boolean';
  if (s.type === 'array') return `Array<${type(s.items || {})}>`;
  if (s.type === 'object' || s.properties) {
    const fields = Object.entries(s.properties || {}).map(([k,v]) => `${JSON.stringify(k)}${s.required?.includes(k) ? '' : '?'}: ${type(v)}`).join('; ');
    return `{ ${fields}${s.additionalProperties && typeof s.additionalProperties === 'object' ? `; [key: string]: ${type(s.additionalProperties)}` : ''} }`;
  }
  return 'unknown';
}
const hash = createHash('sha256').update(raw).digest('hex');
const output = `// Generated from the reviewed promotion OpenAPI; run scripts/generate-promotion-types.mjs.\n// Source SHA256: ${hash}\n` + Object.entries(spec.components.schemas).map(([name,s]) => `export type ${name} = ${type(s)};`).join('\n') + '\n';
const target = path.resolve('lib/admin/promotion-types.ts');
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== output) throw new Error('Promotion types differ from the approved OpenAPI; regenerate and review the contract change.');
} else writeFileSync(target, output);
console.log(`Promotion types ${process.argv.includes('--check') ? 'checked' : 'generated'}: ${hash}`);
