import fs from "node:fs";
import path from "node:path";

function resolveCheckoutRoot({ adminRoot, env, exists, envKey, candidates, label }) {
  if (!adminRoot) throw new Error(`resolveNexion${label}Root: adminRoot 必填`);

  const configured = env[envKey]?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    if (!exists(resolved)) {
      throw new Error(`${envKey} 配置的 ${label} 路径不存在: ${resolved}`);
    }
    return resolved;
  }

  const matched = candidates.map((candidate) => path.resolve(adminRoot, candidate)).find((candidate) => exists(candidate));
  if (matched) return matched;

  const checked = candidates.map((candidate) => path.resolve(adminRoot, candidate));
  throw new Error(`未找到 Nexion ${label} 项目。已检查: ${checked.join(", ")}。可通过 ${envKey} 显式指定。`);
}

/**
 * Supports both the real PC checkout (`workspace/nexion-ops-console`) and the
 * nested high-fidelity checkout (`workspace/nexion-高保真/nexion-ops-console`).
 */
export function resolveNexionAppRoot({
  adminRoot,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  return resolveCheckoutRoot({
    adminRoot,
    env,
    exists,
    envKey: "NEXION_APP_ROOT",
    label: "App",
    candidates: ["../NX1.0-UniApp", "../../NX1.0-UniApp", "../NX1.0", "../../NX1.0", "../Nexion-uniapp", "../../Nexion-uniapp"],
  });
}

export function resolveNexionBackendRoot({
  adminRoot,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  return resolveCheckoutRoot({
    adminRoot,
    env,
    exists,
    envKey: "NEXION_BACKEND_ROOT",
    label: "Backend",
    candidates: ["../nexion-backend", "../../nexion-backend"],
  });
}

/**
 * 工作区文档面(PRD/)。它不是 git 仓而是工作区根下的目录,但对 admin-ops 而言同样是
 * 「可能不在这台机器上」的外部依赖 —— 走同一个解析器,免得探测方与齿轮各抄一份候选路径后分叉。
 */
export function resolveNexionPrdRoot({
  adminRoot,
  env = process.env,
  exists = fs.existsSync,
} = {}) {
  return resolveCheckoutRoot({
    adminRoot,
    env,
    exists,
    envKey: "NEXION_PRD_ROOT",
    label: "PRD 文档面",
    candidates: ["../PRD", "../../PRD"],
  });
}

/**
 * 缺仓时返回 null 而不是抛错。
 *
 * why(2026-08-07):契约测试在**模块顶层**解析后端仓并读文件,缺仓即整文件加载失败 ——
 * 于是那些只读本仓文件、跟后端毫无关系的断言也一条都跑不了。实测 J2 有 20 条断言,
 * 只有 1 条真用到后端文件,另外 19 条纯属连坐;J1 是 3 连坐 12。而这恰好是**开发机的常态**,
 * 等于日常唯一会跑门的那台机器上,这些门长期是黑的。
 * 用法:根拿不到时,跨仓那几条断言自己 skip,本地断言照跑。
 */
export function optionalNexionBackendRoot(options = {}) {
  try { return resolveNexionBackendRoot(options); } catch { return null; }
}

/** 跨仓文件:根为 null 或文件不存在时返回 null,交由调用方 skip 对应断言。 */
export function optionalWorkspaceFile(root, relative) {
  if (!root) return null;
  try { return fs.readFileSync(path.join(root, ...relative.split("/")), "utf8"); } catch { return null; }
}
