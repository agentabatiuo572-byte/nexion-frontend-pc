"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayAdminError } from "@/lib/admin/error-messages";

export type Block<T> = { data: T | null; error: string | null; loading: boolean; reload: () => void };

/**
 * 一块数据的读取。每块各自加载、各自报错，一块失败不挡别的块（5.6）。
 * enabled 为 false 时不发请求。刷新时保留旧内容，失败才清掉（T09）。
 * load 要稳定：传模块级函数。refreshKey 变了就重读。
 */
export function useBlock<T>(load: () => Promise<T>, enabled: boolean, refreshKey = 0): Block<T> {
  const [state, setState] = useState<Omit<Block<T>, "reload">>({ data: null, error: null, loading: enabled });
  const latest = useRef(0);
  const reload = useCallback(() => {
    const id = ++latest.current;
    setState((current) => ({ ...current, error: null, loading: true }));
    load().then(
      (data) => { if (id === latest.current) setState({ data, error: null, loading: false }); },
      (cause: unknown) => { if (id === latest.current) setState({ data: null, error: displayAdminError(cause), loading: false }); },
    );
  }, [load]);
  useEffect(() => {
    if (!enabled) {
      latest.current += 1;
      setState({ data: null, error: null, loading: false });
      return undefined;
    }
    reload();
    return () => { latest.current += 1; };
  }, [enabled, refreshKey, reload]);
  return { ...state, reload };
}
