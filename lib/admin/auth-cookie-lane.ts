let cookieWrites: Promise<unknown> = Promise.resolve();

/** Serialize only credential writes, including their real HTTP/body settlement. */
export function withAdminAuthCookieWrite<T>(operation: () => Promise<T>): Promise<T> {
  const pending = cookieWrites.then(async () => {
    const locks = typeof window !== "undefined" && typeof navigator !== "undefined"
      ? navigator.locks
      : undefined;
    return locks
      ? await locks.request("nexion-admin-auth-cookie-write", { mode: "exclusive" }, operation)
      : await operation();
  });
  cookieWrites = pending.then(() => undefined, () => undefined);
  return pending;
}
