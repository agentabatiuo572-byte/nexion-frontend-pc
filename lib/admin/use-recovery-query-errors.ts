import { useState } from "react";
import { displayAdminError } from "./error-messages";

/** Keep the latest failed by-key observation beside the original command. */
export function useRecoveryQueryErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fail = (key: string, error: unknown) => setErrors(previous => ({ ...previous, [key]: displayAdminError(error) }));
  const clear = (key: string) => setErrors(previous => {
    if (!(key in previous)) return previous;
    const next = { ...previous };
    delete next[key];
    return next;
  });
  const read = async <T,>(key: string, query: () => Promise<T>): Promise<T> => {
    try {
      const result = await query();
      if (result !== undefined) clear(key);
      return result;
    } catch (error) {
      fail(key, error);
      throw error;
    }
  };
  return { errors, fail, clear, read };
}
