/** Explicitly match only the exception operations implemented by the backend. */
export function cregisExceptionRoute(parts: string[]): { path: string; methods: string[] } | null {
  const route = parts.join("/");
  const id = "[1-9][0-9]{0,18}";
  const definitions: Array<[RegExp, string[]]> = [
    [/^cregis\/exception-ownership\/challenges$/, ["POST"]],
    [/^cregis\/exception-claims$/, ["GET", "HEAD", "POST"]],
    [/^cregis\/exception-claims\/preview$/, ["POST"]],
    [new RegExp(`^cregis/exception-claims/${id}/decision$`), ["POST"]],
    [/^cregis\/refunds\/fee-policy$/, ["GET", "HEAD"]],
    [/^cregis\/refunds\/fee-policy\/cases$/, ["GET", "HEAD", "POST"]],
    [new RegExp(`^cregis/refunds/fee-policy/cases/${id}/decision$`), ["POST"]],
    [/^cregis\/refunds\/preview$/, ["POST"]],
    [/^cregis\/refunds\/cases$/, ["GET", "HEAD", "POST"]],
    [new RegExp(`^cregis/refunds/cases/${id}$`), ["GET", "HEAD"]],
    [new RegExp(`^cregis/refunds/cases/${id}/(decision|recover|retry)$`), ["POST"]],
    [/^cregis\/reorg\/(incidents|proposals)$/, ["GET", "HEAD"]],
    [new RegExp(`^cregis/reorg/incidents/${id}/evidence$`), ["GET", "HEAD"]],
    [new RegExp(`^cregis/reorg/incidents/${id}/proposals$`), ["POST"]],
    [new RegExp(`^cregis/reorg/proposals/${id}/decision$`), ["POST"]],
  ];
  const match = definitions.find(([pattern]) => pattern.test(route));
  return match ? { path: `/api/admin/finance/${route}`, methods: match[1] } : null;
}
