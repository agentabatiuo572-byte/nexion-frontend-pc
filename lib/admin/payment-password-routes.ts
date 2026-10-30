/** Frontend BFF allowlist only. Business authorization belongs to the backend. */
export function paymentPasswordRoute(parts: string[]): { path: string; methods: string[] } | null {
  if (parts[0] === "security" && parts[1] === "payment-password-records") return paymentRecordRoute(parts.slice(2), "/api/admin/users/security/payment-password-records");
  if (parts.length === 2 && parts[0] === "security" && parts[1] === "payment-password-policy") return { path: "/api/admin/users/security/payment-password-policy", methods: ["GET", "POST"] };
  if (parts.length === 4 && parts[0] === "security" && parts[1] === "payment-password-policy" && parts[2] === "commands" && /^[A-Za-z0-9_-]{1,180}$/.test(parts[3])) return { path: `/api/admin/users/security/payment-password-policy/commands/${encodeURIComponent(parts[3])}`, methods: ["GET"] };
  if (parts[0] === "profiles" && /^[1-9]\d*$/.test(parts[1] ?? "") && parts[2] === "security" && parts[3] === "payment-password" && (parts.length === 4 || parts.length === 5 && ["attempts", "summary"].includes(parts[4]))) return { path: `/api/admin/users/profiles/${parts[1]}/security/payment-password${parts.length === 5 ? `/${parts[4]}` : ""}`, methods: ["GET"] };
  return null;
}
function paymentRecordRoute(tail: string[], base: string): { path: string; methods: string[] } | null {
  if (!tail.length) return { path: base, methods: ["GET"] };
  if (tail.length === 2 && tail[0] === "commands" && /^[A-Za-z0-9_-]{1,180}$/.test(tail[1])) return { path: `${base}/commands/${encodeURIComponent(tail[1])}`, methods: ["GET"] };
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(tail[0]) || tail[0] === "commands") return null;
  if (tail.length === 1) return { path: `${base}/${encodeURIComponent(tail[0])}`, methods: ["GET"] };
  if (tail.length === 2 && ["release", "attempts"].includes(tail[1])) return { path: `${base}/${encodeURIComponent(tail[0])}/${tail[1]}`, methods: [tail[1] === "release" ? "POST" : "GET"] };
  return null;
}
export function paymentPasswordSupportRoute(parts: string[]) {
  if (parts[0] !== "support-workbench" || parts[1] !== "customers" || !/^[1-9]\d*$/.test(parts[2] ?? "") || parts[3] !== "payment-password") return null;
  const base = `/api/admin/content/support-workbench/customers/${parts[2]}/payment-password`;
  if (parts.length === 5 && parts[4] === "summary") return { path: `${base}/summary`, methods: ["GET"] };
  return parts[4] === "records" ? paymentRecordRoute(parts.slice(5), `${base}/records`) : null;
}
