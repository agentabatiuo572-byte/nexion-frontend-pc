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
    candidates: ["../NX1.0", "../../NX1.0", "../Nexion-uniapp", "../../Nexion-uniapp"],
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
