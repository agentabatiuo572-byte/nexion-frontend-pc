/**
 * 权限码 → 业务域/页面 映射(纯前端,零后端依赖)。
 *
 * 权限码格式统一为 `前缀_页面_动作`(如 finprod_g1_apy_write = G域/G1/HIGH写)。
 * - 第一段(前缀)13 个取值与业务域 A-M 1:1 对齐(全样本验证)。
 * - 第二段(页面)2 类无 console-nav L2 对应(c1hub/k6),显式 fallback 收纳,其余全覆盖。
 *
 * 数据源:CONSOLE_NAV(lib/nav/console-nav.ts)= 13 域元数据单源。
 * 不依赖后端 menuCodePath(seed 不保证 JOIN,可能"—"导致权限丢失)。
 */
import { CONSOLE_NAV, type NavDomain } from "@/lib/nav/console-nav";
import type { A8Permission } from "@/lib/admin/a8-client";
import { Shield } from "lucide-react";

/** 权限码第一段(前缀)→ 业务域 code(A-M)。 */
const PREFIX_TO_DOMAIN_CODE: Record<string, string> = {
  platform: "A",
  overview: "B",
  user: "C",
  finance: "D",
  device: "E",
  network: "F",
  finprod: "G",
  growth: "H",
  content: "I",
  emergency: "J",
  risk: "K",
  bi: "L",
  service: "M",
};

const DOMAIN_BY_CODE: Record<string, NavDomain> = Object.fromEntries(
  CONSOLE_NAV.map((d) => [d.code, d]),
);

/** 未识别前缀的兜底域(防御性,正常不应出现)。 */
const FALLBACK_DOMAIN: NavDomain = {
  code: "?",
  name: "其他",
  slug: "other",
  icon: Shield,
  accentVar: "--v5-ink-4",
  l2: [],
};

/** 第二段(页面)无 console-nav L2 对应的显式 fallback。 */
const PAGE_FALLBACK: Record<string, { id: string; name: string }> = {
  c1hub: { id: "C1HUB", name: "C1 用户 360 画像" },
  k6: { id: "K6", name: "K6 Janus C2(扩展)" },
};

/** 权限码 → 所属业务域(未识别返回兜底域)。 */
export function domainOfPermission(code: string): NavDomain {
  const prefix = code.split("_")[0]?.toLowerCase() ?? "";
  const dc = PREFIX_TO_DOMAIN_CODE[prefix];
  return dc ? DOMAIN_BY_CODE[dc] ?? FALLBACK_DOMAIN : FALLBACK_DOMAIN;
}

/** 权限码第二段 → L2 {id,name}(含 c1hub/i7/k6 fallback,大小写不敏感)。 */
export function pageLabelFromCode(code: string): { id: string; name: string } {
  const seg = code.split("_")[1];
  if (!seg) return { id: "—", name: "通用" };
  const fb = PAGE_FALLBACK[seg.toLowerCase()];
  if (fb) return fb;
  const up = seg.toUpperCase();
  for (const d of CONSOLE_NAV) {
    const l2 = d.l2.find((x) => x.id.toUpperCase() === up);
    if (l2) return { id: l2.id, name: l2.name };
  }
  return { id: up, name: `${up} (扩展)` };
}

export type PermDomainGroup = {
  domain: NavDomain;
  pages: Array<{ l2: { id: string; name: string }; perms: A8Permission[] }>;
};

/** 权限列表 → 按业务域(A-M)→ 页面(L2)三级分组;域按 A-M 顺序,域内页面按 id 排序。 */
export function groupPermissionsByDomain(perms: A8Permission[]): PermDomainGroup[] {
  const byDomain = new Map<string, PermDomainGroup>();
  for (const p of perms) {
    const domain = domainOfPermission(p.permissionCode);
    let grp = byDomain.get(domain.code);
    if (!grp) {
      grp = { domain, pages: [] };
      byDomain.set(domain.code, grp);
    }
    const pl = pageLabelFromCode(p.permissionCode);
    let pageGrp = grp.pages.find((pg) => pg.l2.id === pl.id);
    if (!pageGrp) {
      pageGrp = { l2: pl, perms: [] };
      grp.pages.push(pageGrp);
    }
    pageGrp.perms.push(p);
  }
  for (const grp of byDomain.values()) {
    grp.pages.sort((a, b) => a.l2.id.localeCompare(b.l2.id));
  }
  return [...byDomain.values()].sort((a, b) => {
    if (a.domain.code === "?") return 1;
    if (b.domain.code === "?") return -1;
    return a.domain.code.localeCompare(b.domain.code);
  });
}
