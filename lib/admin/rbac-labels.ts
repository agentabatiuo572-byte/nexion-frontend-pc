import type { A7MenuTreeNode } from "@/lib/admin/a7-client";
import type { A8Permission } from "@/lib/admin/a8-client";
import { F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/** Shared A6 catalogue labels; do not invent names for absent entries. */
export function permLabel(code: string, perm: A8Permission | undefined): string {
  const f4 = F4_MATERIAL_PERMISSIONS.find((item) => item.code === code)?.label;
  if (f4) return f4;
  return operatorCopyText(perm?.permissionName || code);
}

export function menuLabel(node: A7MenuTreeNode): string {
  return node.menuNameZh || node.menuName;
}
