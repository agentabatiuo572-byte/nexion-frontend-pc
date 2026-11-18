import { useCallback, useMemo } from "react";
import { requiredReadAuthority } from "@/lib/admin/cross-domain-authority";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "./console-nav";

/**
 * 跨页链接能不能显示（X03、ST-58）：目标页在这个账号的可见菜单里，并且有目标内容的读权限。
 * read 写这条链接要看的内容，几个码有一个就行；不写时按目标页查 requiredReadAuthority。
 * 判断前去掉查询串。只改显示，不改权限。
 */
export function useReach() {
  const session = useAdminAuth((state) => state.session);
  const domains = useMemo(() => (session ? resolveVisibleDomains(session) : []), [session]);
  return useCallback((href: string, read?: string | readonly string[]) => {
    const path = href.split(/[?#]/, 1)[0];
    const need = read ?? requiredReadAuthority(path);
    const codes = need === null ? [] : typeof need === "string" ? [need] : need;
    return canAccessResolvedPath(domains, path) && (codes.length === 0 || codes.some((code) => session?.authorities.includes(code)));
  }, [domains, session?.authorities]);
}
