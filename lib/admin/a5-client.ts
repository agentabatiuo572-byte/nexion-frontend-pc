import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { normalizeA5Overview, type A5RegistryOverview } from "@/lib/admin/a5-contract";
import { guardedFetch } from "@/lib/admin/error-messages";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

const A5_REQUEST_TIMEOUT_MS = 10_000;

export type A5LoadErrorKind = "auth" | "forbidden" | "integrity" | "server" | "unavailable";

export class A5LoadError extends Error {
  constructor(public readonly kind: A5LoadErrorKind, message: string) {
    super(message);
    this.name = "A5LoadError";
  }
}

export async function fetchA5Registry(): Promise<A5RegistryOverview> {
  let response: Response;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), A5_REQUEST_TIMEOUT_MS);
  try {
    response = await guardedFetch("/api/admin/platform/params-registry", {
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new A5LoadError("unavailable", "平台参数服务暂时不可用");
  } finally {
    window.clearTimeout(timeout);
  }

  const payload = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
  if (isAdminAuthFailure(response.status, payload?.message)) {
    resetAdminSession();
    throw new A5LoadError("auth", "登录已失效，请重新登录");
  }
  if (response.status === 403 || payload?.code === 403) {
    throw new A5LoadError("forbidden", "没有查看平台参数寄存器的权限");
  }
  if (response.status === 503) {
    throw new A5LoadError("unavailable", "平台参数服务暂时不可用");
  }
  if (!response.ok || (payload && payload.code !== 0)) {
    throw new A5LoadError("server", "平台参数服务返回异常");
  }
  if (!payload || payload.data === undefined) {
    throw new A5LoadError("integrity", "数据一致性校验未通过");
  }

  try {
    return normalizeA5Overview(payload.data);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("A5_DATA_INTEGRITY_ERROR:")) {
      throw new A5LoadError("integrity", "数据一致性校验未通过");
    }
    throw error;
  }
}
