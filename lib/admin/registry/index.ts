/**
 * 模块注册表聚合 — catch-all 按 path 命中后渲染对应 archetype(ModulePage),否则回退 ScaffoldPage。
 * 每域一个文件(a.ts … l.ts),在此汇总。12 域全量接入。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { DOMAIN_A } from "./a";
import { DOMAIN_B } from "./b";
import { DOMAIN_C } from "./c";
import { DOMAIN_D } from "./d";
import { DOMAIN_E } from "./e";
import { DOMAIN_F } from "./f";
import { DOMAIN_G } from "./g";
import { DOMAIN_H } from "./h";
import { DOMAIN_I } from "./i";
import { DOMAIN_J } from "./j";
import { DOMAIN_K } from "./k";
import { DOMAIN_L } from "./l";

const ALL: ModuleEntry[] = [
  ...DOMAIN_A,
  ...DOMAIN_B,
  ...DOMAIN_C,
  ...DOMAIN_D,
  ...DOMAIN_E,
  ...DOMAIN_F,
  ...DOMAIN_G,
  ...DOMAIN_H,
  ...DOMAIN_I,
  ...DOMAIN_J,
  ...DOMAIN_K,
  ...DOMAIN_L,
];

const BY_PATH = new Map<string, ModuleEntry>(ALL.map((e) => [e.path.replace(/\/+$/, ""), e]));

export function findModuleEntry(path: string): ModuleEntry | undefined {
  return BY_PATH.get(path.replace(/\/+$/, ""));
}

export const REGISTERED_PATHS: string[] = ALL.map((e) => e.path);
