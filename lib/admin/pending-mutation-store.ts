/**
 * 幂等键(Idempotency-Key)待定命令的共享持久化存储。
 *
 * 背景:高敏动作提交后若网络结果未知(超时 / 上游 outcome=unknown),运营必须用**同一个**
 * 命令号重试,后端才能去重。命令号只存在内存(模块级 Map / useState / useRef)时,刷新页面即
 * 丢失,重试会铸新命令号 → 重复入账 / 重复操作。sessionStorage 让命令号跨刷新存活。
 *
 * 单源:d-client / user360-client / c3-adjust 三处共用本模块,禁止再复制第四份内存态实现。
 * 机器门:`scripts/pending-idempotency-key-sentinel.mjs`(全仓扫内存态幂等键 + 台账)。
 *
 * 作用域说明:
 * - sessionStorage 而非 localStorage —— 命令号是「本次会话本次操作」的凭据,跨标签页 / 跨天
 *   复用只会让过期命令号打到后端;24h TTL 是第二道保险。
 * - 一个 storageKey 可承载多个动作族,由调用方给 fingerprint 加命名空间前缀区分
 *   (见 c3-adjust:submit| / review| / reverse|),不要为每个动作族各建一个 storageKey。
 * - fingerprint 必须把「动作类型 + 目标对象 id」编码进去,否则不同目标会撞 key,把别人的
 *   操作误判成重复提交而吞掉。
 */

export const PENDING_MUTATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PendingMutationRecord {
  fingerprint: string;
  commandKey: string;
  createdAt: number;
  expiresAt: number;
}

/** 记录里除四个公共字段之外的调用方自定义元数据(如 d-client 的 base/path/method/body)。 */
export type PendingMutationExtra<T extends PendingMutationRecord> = Omit<T, keyof PendingMutationRecord>;

export interface PendingMutationStore<T extends PendingMutationRecord> {
  /** 取该 fingerprint 上一次未收敛的命令号;没有则 undefined(调用方铸新号)。 */
  get(fingerprint: string): string | undefined;
  /** 记住一次尝试。重复 remember 同一 commandKey 会保留原 createdAt、续期 expiresAt。 */
  remember(fingerprint: string, commandKey: string, extra?: PendingMutationExtra<T>): void;
  /** 命令已收敛(成功 / 确定性失败),丢弃该 fingerprint 的全部记录。 */
  forget(fingerprint: string): void;
  /** 当前仍有效的全部记录(已剔除过期 / 结构非法项)。 */
  list(): T[];
}

function isBaseRecord(value: unknown, commandKey: string, now: number): value is PendingMutationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as PendingMutationRecord;
  return record.commandKey === commandKey
    && typeof record.fingerprint === "string"
    && record.fingerprint.length > 0
    && typeof record.commandKey === "string"
    && record.commandKey.length > 0
    && Number.isFinite(record.createdAt)
    && Number.isFinite(record.expiresAt)
    && record.expiresAt > now;
}

export function createPendingMutationStore<T extends PendingMutationRecord = PendingMutationRecord>(options: {
  /** sessionStorage 键名。同一动作族共用一个键,靠 fingerprint 前缀分命名空间。 */
  storageKey: string;
  ttlMs?: number;
  /** 公共字段之外的结构校验(元数据字段)。返回 false 的记录读取时即被剔除。 */
  isValidRecord?: (value: T) => boolean;
}): PendingMutationStore<T> {
  const { storageKey, ttlMs = PENDING_MUTATION_TTL_MS, isValidRecord } = options;
  // ponytail: 内存 Map 只是 sessionStorage 的读缓存,不是真源;刷新后从 sessionStorage 重建。
  const memory = new Map<string, string>();

  function readAll(): Record<string, T> {
    if (typeof window === "undefined") return {};
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}") as Record<string, T>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      const now = Date.now();
      const current = Object.fromEntries(Object.entries(parsed).filter(([commandKey, value]) =>
        isBaseRecord(value, commandKey, now) && (!isValidRecord || isValidRecord(value))));
      if (Object.keys(current).length !== Object.keys(parsed).length) {
        writeAll(current as Record<string, T>);
      }
      return current as Record<string, T>;
    } catch {
      return {};
    }
  }

  function writeAll(value: Record<string, T>) {
    if (typeof window === "undefined") return;
    try {
      if (Object.keys(value).length === 0) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Memory fallback remains available when storage is blocked or exhausted.
    }
  }

  return {
    get(fingerprint) {
      const inMemory = memory.get(fingerprint);
      if (inMemory) return inMemory;
      const persisted = Object.values(readAll()).find((value) => value.fingerprint === fingerprint);
      if (persisted) memory.set(fingerprint, persisted.commandKey);
      return persisted?.commandKey;
    },
    remember(fingerprint, commandKey, extra) {
      memory.set(fingerprint, commandKey);
      const persisted = readAll();
      const previous = persisted[commandKey];
      persisted[commandKey] = {
        fingerprint,
        commandKey,
        ...(extra as object | undefined),
        createdAt: previous?.createdAt ?? Date.now(),
        expiresAt: Date.now() + ttlMs,
      } as T;
      writeAll(persisted);
    },
    forget(fingerprint) {
      memory.delete(fingerprint);
      const persisted = readAll();
      Object.entries(persisted).forEach(([commandKey, value]) => {
        if (value.fingerprint === fingerprint) delete persisted[commandKey];
      });
      writeAll(persisted);
    },
    list() {
      return Object.values(readAll());
    },
  };
}
