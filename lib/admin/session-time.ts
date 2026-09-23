type SessionTimes = { issuedAt?: string | null; lastActiveAt?: string | null; revokedAt?: string | null };

export function sessionTimeAnomaly(session: SessionTimes): boolean {
  const issued = Date.parse(session.issuedAt ?? "");
  const active = Date.parse(session.lastActiveAt ?? "");
  const revoked = Date.parse(session.revokedAt ?? "");
  return Number.isFinite(issued) && (
    (Number.isFinite(active) && active < issued) ||
    (Number.isFinite(revoked) && (revoked < issued || (Number.isFinite(active) && active > revoked)))
  );
}
