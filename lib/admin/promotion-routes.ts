const heads = new Set(['promotions','promotion-catalog','promotion-policies','device-rights-profiles','promotion-commands','promotion-rewards','promotion-exports']);
export const isPromotionHead = (head: string) => heads.has(head);

/** Additional promotion routes are method-specific, never a free-form proxy prefix. */
export function allowedPromotionRoute(parts: string[], method: string): boolean {
  if (parts.some(p => !p || p.includes('..') || /[/\\]/.test(p))) return false;
  const [head,id,tail,last] = parts;
  const n = parts.length;
  if (head === 'promotion-catalog') return method === 'GET' && n === 1;
  if (head === 'promotion-commands') return method === 'GET' && n === 2 && !!id;
  if (head === 'promotion-exports') return method === 'GET' && (n === 2 || (n === 3 && tail === 'download'));
  if (head === 'device-rights-profiles') return method === 'GET' && (n === 1 || (n === 4 && tail === 'versions' && /^[1-9]\d*$/.test(last)));
  if (head === 'promotion-policies') {
    if (n === 1) return method === 'GET' || method === 'POST';
    if (n === 3 && tail === 'versions') return method === 'POST';
    if (tail === 'versions' && /^[1-9]\d*$/.test(last)) return n === 4 ? method === 'GET' : n === 5 && method === 'POST' && ['approve','revoke'].includes(parts[4]);
    return false;
  }
  if (head === 'promotion-rewards') return (method === 'GET' && (n === 1 || n === 2)) || (method === 'POST' && n === 3 && ['retry','reconcile','cancel','reverse','resolve'].includes(tail));
  if (head !== 'promotions') return false;
  if (n === 1) return method === 'GET' || method === 'POST';
  if (n === 2) return method === 'GET';
  if (n === 3) return method === 'GET' ? ['versions','metrics'].includes(tail) : method === 'PUT' ? tail === 'draft' : method === 'POST' && ['draft-versions','copies','simulate','audience-preview','submit','withdraw','approve','reject','publish','pause','resume','end','archive'].includes(tail);
  return n === 4 && ((method === 'GET' && tail === 'versions' && /^[1-9]\d*$/.test(last)) || (method === 'POST' && tail === 'metrics' && last === 'exports'));
}
