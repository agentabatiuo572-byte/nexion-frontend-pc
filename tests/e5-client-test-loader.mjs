import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  if (!specifier.startsWith("@/")) return nextResolve(specifier, context);
  const relative = specifier.slice(2);
  const direct = new URL(relative, root);
  const withTs = new URL(`${relative}.ts`, root);
  const target = existsSync(fileURLToPath(direct)) ? direct : withTs;
  return { url: pathToFileURL(fileURLToPath(target)).href, shortCircuit: true };
}
