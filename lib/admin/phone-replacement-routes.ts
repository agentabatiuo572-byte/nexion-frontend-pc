/** Exact PC proxy surface; authorization and account scope remain server-owned. */
export function phoneUserRoute(parts: string[]): {
    path: string;
    method: "GET" | "POST";
} | null {
    if (parts[0] !== "profiles" || !/^[1-9]\d*$/.test(parts[1] ?? ""))
        return null;
    const section = parts[2];
    let method: "GET" | "POST";
    if (parts.length === 3 && ["phone-binding", "phone-replacement-requests", "phone-replacements"].includes(section))
        method = "GET";
    else if (parts.length === 4 && section === "phone-replacement-verifications" && parts[3] === "by-idempotency-key")
        method = "GET";
    else if (parts.length === 3 && section === "phone-replacement-grants")
        method = "POST";
    else if (parts.length === 5 && /^[A-Za-z0-9_-]{1,64}$/.test(parts[3]) &&
        (section === "phone-replacement-requests" && ["verify", "close"].includes(parts[4]) || section === "phone-replacement-grants" && parts[4] === "revoke"))
        method = "POST";
    else
        return null;
    return { path: `/api/admin/users/${parts.map(encodeURIComponent).join("/")}`, method };
}
export function phoneOperationRoute(parts: string[]): string | null {
    if (parts.length !== 1 || !/^[A-Za-z0-9_-]{1,64}$/.test(parts[0]))
        return null;
    return `/api/admin/phone-replacement-operations/${encodeURIComponent(parts[0])}`;
}
