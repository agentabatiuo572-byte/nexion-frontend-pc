// 从 console-nav.ts 提取全部 L2 路由 → 打印 `path|id|status` 供 verify.sh 消费。
// 单一真源:nav 一改,verify 路由清单自动跟随。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "lib", "nav", "console-nav.ts"), "utf8");

const re =
  /\{\s*id:\s*"([^"]+)",\s*name:\s*"[^"]+",\s*path:\s*"([^"]+)",\s*prdAnchor:\s*"[^"]+",\s*batch:\s*"[^"]+",\s*status:\s*"([^"]+)"\s*\}/g;

let m;
const out = [];
while ((m = re.exec(src)) !== null) {
  out.push(`${m[2]}|${m[1]}|${m[3]}`);
}
process.stdout.write(out.join("\n") + "\n");
