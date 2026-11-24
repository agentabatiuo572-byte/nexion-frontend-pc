/**
 * One sessionStorage journal per command family. Originals belong to their
 * authenticated submitter and survive logout, expiry and account switching.
 * Every store operation filters ownership before exposing or changing a row.
 */

export const PENDING_MUTATION_TTL_MS = 24 * 60 * 60 * 1000;
/** OP-96：过了接口的重试时限，原号不能再用，记录不删。解除只在后端明确拒绝后才有。 */
export const RETRY_EXPIRED_TEXT = "已超过 24 小时，不能再重试，请到操作记录与审批核对。";
export const isRetryExpired = (record: { expiresAt: number }) => Date.now() >= record.expiresAt;

export interface PendingMutationRecord {
  fingerprint: string;
  commandKey: string;
  createdAt: number;
  expiresAt: number;
  /** Authenticated submitter, stamped on every capture; page metadata cannot override it. */
  commandOwnerId?: number;
  /** A replay got a definitive refusal. Preserve this evidence until local release. */
  replayRejection?: string;
}

/** 记录里除四个公共字段之外的调用方自定义元数据(如 d-client 的 base/path/method/body)。 */
export type PendingMutationExtra<T extends PendingMutationRecord> = Omit<T, keyof PendingMutationRecord>;

export interface PendingMutationStore<T extends PendingMutationRecord> {
  /** 取该 fingerprint 上一次未收敛的命令号;没有则 undefined(调用方铸新号)。 */
  get(fingerprint: string): string | undefined;
  /**
   * 记住一次尝试。重复 remember 同一 commandKey 会保留原 createdAt,**且不延长 expiresAt**
   * —— 过期时刻恒为「首次尝试 + TTL」,对齐后端从首次请求起算的固定 24h 幂等窗。
   */
  remember(fingerprint: string, commandKey: string, extra?: PendingMutationExtra<T>): void;
  /** True only when the command can be recovered after a page refresh. */
  isDurablyStored(fingerprint: string, commandKey: string): boolean;
  /** 命令已收敛，丢弃该 fingerprint；迁移或独立回查可指定只删除原 commandKey。 */
  forget(fingerprint: string, commandKey?: string): void;
  /** Current submitter's usable records; unreadable/unattributed evidence stays stored. */
  list(): T[];
  markReplayRejected(fingerprint: string, commandKey: string, code: string): void;
}

function isBaseRecord(value: unknown, commandKey: string, now: number, retainExpiredRecords = false): value is PendingMutationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as PendingMutationRecord;
  return record.commandKey === commandKey
    && typeof record.fingerprint === "string"
    && record.fingerprint.length > 0
    && typeof record.commandKey === "string"
    && record.commandKey.length > 0
    && Number.isFinite(record.createdAt)
    && Number.isFinite(record.expiresAt)
    && (retainExpiredRecords
      ? Number.isSafeInteger(record.createdAt) && record.createdAt >= 0 && record.expiresAt > record.createdAt
      : record.expiresAt > now);
}

/** Last authenticated identity in this tab, never proof of a legacy row's maker. */
const COMMAND_OWNER_KEY = "nexion-admin-command-owner";
let currentCommandOwner: number | undefined;

function adminId(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9]\d*$/.test(value))) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** Only the journal's authenticated stamp proves ownership; unstamped evidence stays hidden. */
function commandOwner(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return adminId((value as PendingMutationRecord).commandOwnerId);
}

/** Page-owned actor fields remain request metadata, never journal visibility proof. */
export function isPendingCommandOwnedBy(value: unknown, ownerId: string | number | undefined = currentCommandOwner): boolean {
  const owner = adminId(ownerId);
  return owner !== undefined && owner === currentCommandOwner && commandOwner(value) === owner;
}

export function hasPersistedPendingCommandOwner(ownerId: string): boolean {
  try {
    return currentCommandOwner !== undefined && adminId(ownerId) === currentCommandOwner && typeof window !== "undefined"
      && window.sessionStorage.getItem(COMMAND_OWNER_KEY) === ownerId;
  } catch { return false; }
}

/** Set visibility from the authenticated session; never sweep or attribute stored evidence. */
export function claimPendingCommandOwner(ownerId: string): number {
  currentCommandOwner = adminId(ownerId);
  if (currentCommandOwner === undefined || typeof window === "undefined") return 0;
  try { window.sessionStorage.setItem(COMMAND_OWNER_KEY, ownerId); }
  catch { /* Identity still gates this page when the marker cannot be written. */ }
  return 0;
}

/** End access to originals, retaining both durable evidence and the memory fallback. */
export function clearPendingCommandRecords(): number {
  currentCommandOwner = undefined;
  return 0;
}

export function createPendingMutationStore<T extends PendingMutationRecord = PendingMutationRecord>(options: {
  /** sessionStorage 键名。同一动作族共用一个键,靠 fingerprint 前缀分命名空间。 */
  storageKey: string;
  ttlMs?: number;
  /** Keep valid expired evidence for query-only recovery; never authorizes replay. */
  retainExpiredRecords?: boolean | ((record: T) => boolean);
  /** Validate metadata before use; rejected rows stay stored as unreadable evidence. */
  isValidRecord?: (value: T) => boolean;
}): PendingMutationStore<T> {
  const { storageKey, ttlMs = PENDING_MUTATION_TTL_MS, isValidRecord, retainExpiredRecords = false } = options;
  // 空 storageKey 会静默退化成「只有内存、刷新即丢」—— 正是本模块要根治的缺陷。
  // 类型层挡不住 .mjs 调用方,所以在运行时也焊一道。
  if (typeof storageKey !== "string" || !storageKey) {
    throw new Error("PENDING_MUTATION_STORE_REQUIRES_STORAGE_KEY");
  }
  /**
   * 内存镜像**不是读缓存,是降级兜底**(2026-08-06 修正)。
   *
   * 上一版把它当缓存(只存 fingerprint→commandKey),而 `list()` 直接读 sessionStorage 绕过它。
   * 于是隐私模式 / 配额满 —— `writeAll` 静默吞异常、`readAll` 恒返回 {} —— 槽位式调用方
   * (`SlotAttemptStore.resolve` 走的正是 `list()`)**同一会话连续重试也每次铸新号**,
   * 防重复整体失效,而且一声不吭。现在存整条记录,并让 readAll 以它打底。
   */
  const memory = new Map<string, T>();
  let degradedNotified = false;
  function noteDegraded(action: string) {
    // 只喊一次:提交路径上每次读写都喊会把 console 淹掉,反而盖住问题。
    // ponytail: 只到 console —— 把降级态透到每个调用方的 UI 要改 30 个消费面,越出本包;
    //           真正的止血是下面的内存兜底,告警只是让排查时有迹可循。
    if (degradedNotified) return;
    degradedNotified = true;
    console.warn(
      `[pending-mutation-store] sessionStorage ${action}失败(${storageKey}):命令号降级为「仅本页内存」`
      + " —— 刷新页面即丢失,刷新后重试会铸新命令号,后端无法去重。常见于隐私模式 / 存储配额已满。",
    );
  }

  function usable(value: unknown, commandKey: string, now: number): value is T {
    return isBaseRecord(value, commandKey, now, !!retainExpiredRecords) && (!isValidRecord || isValidRecord(value as T))
      && (typeof retainExpiredRecords !== "function" || (value as T).expiresAt > now || retainExpiredRecords(value as T));
  }

  /** 旧版本这几张表不限期，到期时间超出安全整数。记录要留着核对，重试时限收回到首次尝试 + TTL（OP-96）。 */
  function capped(record: T): T {
    const retain = typeof retainExpiredRecords === "function" ? retainExpiredRecords(record) : retainExpiredRecords;
    return retain && record.expiresAt > record.createdAt + ttlMs ? { ...record, expiresAt: record.createdAt + ttlMs } : record;
  }

  function syncMemory(value: Record<string, T>) {
    memory.clear();
    for (const [commandKey, record] of Object.entries(value)) memory.set(commandKey, record);
  }

  function readAll(): Record<string, T> {
    // 内存打底、存储覆盖:存储可用时两者本就一致;存储不可用时内存是唯一真源。
    const current: Record<string, T> = {};
    for (const [commandKey, record] of memory) {
      current[commandKey] = record;
    }
    if (typeof window !== "undefined") {
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}") as Record<string, T>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [commandKey, record] of Object.entries(parsed)) {
            current[commandKey] = record;
          }
        }
      } catch {
        noteDegraded("读取");
      }
    }
    syncMemory(current);
    // Preserve every raw row, including foreign, expired and unattributed legacy
    // evidence. Parsing a journal never settles a command or rewrites its bytes.
    return current;
  }

  function writeAll(value: Record<string, T>) {
    syncMemory(value);
    if (typeof window === "undefined") return;
    try {
      if (Object.keys(value).length === 0) window.sessionStorage.removeItem(storageKey);
      else window.sessionStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      noteDegraded("写入");
    }
  }

  function visible(record: T, commandKey: string): boolean {
    return isPendingCommandOwnedBy(record) && usable(record, commandKey, Date.now());
  }

  return {
    get(fingerprint) {
      return Object.entries(readAll()).find(([key, value]) => visible(value, key) && value.fingerprint === fingerprint)?.[0];
    },
    remember(fingerprint, commandKey, extra) {
      const persisted = readAll();
      const previous = persisted[commandKey];
      if (currentCommandOwner === undefined) throw new Error("ADMIN_AUTH_REQUIRED");
      // A later session cannot rewrite a saved original, including through a stale callback.
      if (previous && !isPendingCommandOwnedBy(previous)) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
      if (extra && "commandOwnerId" in extra && adminId(extra.commandOwnerId) !== currentCommandOwner) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
      // 🔴 TTL 是**从首次尝试起的硬上限,不滑动续期**(2026-08-06 修正)。
      //    后端幂等窗固定 24h 且从第一次请求起算(开发落地规格 §0.4,运营不可调)。
      //    上一版每次 remember 都 `Date.now() + ttl`,连续重试能让客户端记录活过后端窗口 ——
      //    窗外再复用同一个号,后端早已不认,却给了操作员「这次会被去重」的虚假信心。
      const createdAt = previous?.createdAt ?? Date.now();
      // 🔴 四个公共字段全部排在 extra 之后(2026-08-06 独立验收 P2-1):
      //   原顺序里 extra 展开在 fingerprint / commandKey 之后,调用方元数据一旦撞名就能覆盖它们;
      //   commandKey 与行键一旦不符,isBaseRecord 判非法直接丢弃 = 命令号静默丢失。
      //   类型层今天挡得住 TS 调用方,但探针实测确实能覆盖 —— 顺序本身就该免疫。
      persisted[commandKey] = {
        ...(extra as object | undefined),
        commandOwnerId: currentCommandOwner,
        fingerprint,
        commandKey,
        createdAt,
        expiresAt: createdAt + ttlMs,
        ...(previous?.replayRejection ? { replayRejection: previous.replayRejection } : {}),
      } as T;
      writeAll(persisted);
    },
    forget(fingerprint, onlyCommandKey) {
      const persisted = readAll();
      let changed = false;
      Object.entries(persisted).forEach(([commandKey, value]) => {
        if (visible(value, commandKey) && value.fingerprint === fingerprint && (onlyCommandKey === undefined || commandKey === onlyCommandKey)) {
          delete persisted[commandKey];
          changed = true;
        }
      });
      if (changed) writeAll(persisted);
    },
    isDurablyStored(fingerprint, commandKey) {
      if (typeof window === "undefined") return false;
      try {
        const record = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "{}")[commandKey] as T | undefined;
        return !!record && record.fingerprint === fingerprint && visible(record, commandKey);
      } catch { return false; }
    },
    list() {
      return Object.entries(readAll()).filter(([key, record]) => visible(record, key)).map(([, record]) => capped(record));
    },
    markReplayRejected(fingerprint, commandKey, code) {
      const persisted = readAll();
      const record = persisted[commandKey];
      if (!record || !visible(record, commandKey) || record.fingerprint !== fingerprint) return;
      persisted[commandKey] = { ...record, replayRejection: code };
      writeAll(persisted);
    },
  };
}

export type PendingRecoveryCapability = "receipt" | "replay" | "readback";
export type PendingRecoveryConclusion = "succeeded" | "not-executed" | "rejected" | "unknown" | "not-found";
export type PendingReplayBlock = "missing" | "readback-only" | "replay-rejected" | "expired" | "busy" | "unavailable" | "needs-not-found";

export type PendingRecoveryState = {
  capability: PendingRecoveryCapability;
  conclusion: PendingRecoveryConclusion;
  busy: "query" | "replay" | undefined;
  expiresAt: number;
  expired: boolean;
  replayBlock?: PendingReplayBlock;
  replayRejection?: string;
};

/** Opt in per command family. The caller interprets its endpoint and proves business facts. */
export function createPendingRecovery<T extends PendingMutationRecord>(
  store: Pick<PendingMutationStore<T>, "list" | "isDurablyStored" | "forget" | "markReplayRejected">,
  options: {
    capability: (record: T) => PendingRecoveryCapability;
    canReplay: (record: T) => boolean;
    explicitRejectionCode: (error: unknown) => string | undefined;
  },
) {
  const observations = new Map<string, { conclusion: PendingRecoveryConclusion; busy?: "query" | "replay" }>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const recordKey = (record: T) => JSON.stringify([record.commandOwnerId, record.fingerprint, record.commandKey, record.createdAt]);
  const current = (record: T) => store.list().find(row => recordKey(row) === recordKey(record));
  const notify = () => {
    revision++;
    listeners.forEach(listener => listener());
  };
  const publish = (key: string, observation: { conclusion: PendingRecoveryConclusion; busy?: "query" | "replay" }) => {
    observations.set(key, observation);
    notify();
  };
  const settle = (record: T) => {
    store.forget(record.fingerprint, record.commandKey);
    observations.delete(recordKey(record));
    notify();
  };
  const state = (original: T): PendingRecoveryState => {
    const record = current(original);
    const capability = options.capability(record ?? original);
    const observation = observations.get(recordKey(original));
    const conclusion = observation?.conclusion ?? "unknown";
    const busy = observation?.busy;
    const expiresAt = record?.expiresAt ?? original.expiresAt;
    const expired = isRetryExpired({ expiresAt });
    const replayRejection = record?.replayRejection;
    const replayBlock = !record ? "missing"
      : replayRejection ? "replay-rejected"
        : expired ? "expired"
          : capability === "readback" ? "readback-only"
            : busy ? "busy"
              : !options.canReplay(record) || !store.isDurablyStored(record.fingerprint, record.commandKey) ? "unavailable"
                : capability === "receipt" && conclusion !== "not-found" ? "needs-not-found"
                  : undefined;
    return { capability, conclusion, busy, expiresAt, expired, replayBlock, replayRejection };
  };
  return {
    state,
    getRevision: () => revision,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async query<R extends { conclusion: PendingRecoveryConclusion }>(original: T, read: (record: T) => Promise<R>): Promise<R | undefined> {
      const record = current(original);
      if (!record) return;
      const key = recordKey(record);
      if (observations.get(key)?.busy === "replay") return;
      const reading = { conclusion: "unknown", busy: "query" } as const;
      publish(key, reading);
      try {
        const result = await read(record);
        if (!current(record) || observations.get(key) !== reading) return;
        if (result.conclusion === "not-found" && options.capability(record) !== "receipt") {
          publish(key, { conclusion: "unknown" });
          return;
        }
        publish(key, { conclusion: result.conclusion });
        return result;
      } catch (error) {
        if (observations.get(key) !== reading) return;
        publish(key, { conclusion: "unknown" });
        throw error;
      }
    },
    async replay<R>(original: T, send: (record: T) => Promise<R>): Promise<R> {
      const record = current(original);
      if (!record || state(record).replayBlock) throw new Error("PENDING_REPLAY_BLOCKED");
      const key = recordKey(record);
      publish(key, { conclusion: "unknown", busy: "replay" });
      try {
        return await send(record);
      } catch (error) {
        const code = options.explicitRejectionCode(error);
        if (code) store.markReplayRejected(record.fingerprint, record.commandKey, code);
        throw error;
      } finally {
        publish(key, { conclusion: "unknown" });
      }
    },
    /** Only exact success or terminal nonexecution from the latest query can settle. */
    settleFromQuery(original: T, expected: PendingRecoveryConclusion) {
      const record = current(original);
      if (!record) return false;
      const conclusion = observations.get(recordKey(record))?.conclusion;
      if (conclusion !== expected || (conclusion !== "succeeded" && conclusion !== "not-executed" && conclusion !== "rejected")) return false;
      settle(record);
      return true;
    },
    /** An acknowledged write can be settled after the caller checks its result. */
    settleAcknowledged(original: T) {
      const record = current(original);
      if (record) settle(record);
    },
    /** OP-93(8): call only after the operator has manually checked the original result. */
    releaseRejectedReplay(original: T) {
      const record = current(original);
      if (!record?.replayRejection || observations.get(recordKey(record))?.busy) return false;
      settle(record);
      return true;
    },
  };
}

export interface SlotAttemptRecord extends PendingMutationRecord {
  /** 本次尝试的输入指纹(值 / 版本 / 理由…)。与上次不同 = 新意图,换新命令号。 */
  inputFingerprint: string;
}

export interface SlotAttemptStore {
  /** 读取当前槽位的原命令号，供只读回执查询使用。 */
  peek(slot: string): string | undefined;
  /** 取该槽位可复用的命令号:输入指纹一致才复用,否则铸新号并丢弃旧号。 */
  resolve(slot: string, inputFingerprint: string, mint: () => string): string;
  /** 该命令号是否已经真正落入可跨刷新读取的 sessionStorage。 */
  isDurablyStored(slot: string, inputFingerprint: string, commandKey: string): boolean;
  /** 命令已收敛,丢弃该槽位。 */
  forget(slot: string, commandKey?: string): void;
  /** 当前仍未收敛的尝试,页面刷新后据此恢复「结果未知」提示。 */
  list(): SlotAttemptRecord[];
}

/**
 * 同一个 storageKey 只有一个实例。内存副本是实例级的：两页各建一份时，一边删了，
 * 另一边的 list() 会用内存副本把记录写回 sessionStorage（资金储备和旧可用资金页共用预测记录）。
 */
const slotStores = new Map<string, SlotAttemptStore>();

/**
 * 「一个槽位同时只有一次在途尝试」的命令号存储。
 *
 * 适用形态:`Map<槽位, { fingerprint, commandKey }>` —— 槽位是目标对象(用户号 / 档位 / 版块…),
 * 输入指纹是本次提交的值。i3 / i4 / j3 / k4 迁移前都是这个形态的组件 useRef。
 *
 * 为什么不直接把输入指纹拼进 fingerprint:那样旧尝试会留到 TTL 到期。运营改了值再改回来时会
 * 复用那个可能已被后端消费掉的命令号,让一次真实的新操作被当成重复提交静默吞掉。
 */
export function createSlotAttemptStore(options: { storageKey: string; ttlMs?: number; retainExpiredRecords?: boolean | ((record: SlotAttemptRecord) => boolean) }, pendingStore?: PendingMutationStore<SlotAttemptRecord>): SlotAttemptStore {
  const existing = slotStores.get(options.storageKey);
  if (existing) return existing;
  const store = pendingStore ?? createPendingMutationStore<SlotAttemptRecord>({
    ...options,
    isValidRecord: (record) => typeof record.inputFingerprint === "string" && record.inputFingerprint.length > 0,
  });
  // A shared legacy reader may retain more evidence than a writable slot accepts.
  const list = pendingStore ? () => store.list().filter(record => record.inputFingerprint.length > 0
    && (record.expiresAt > Date.now() || (typeof options.retainExpiredRecords === "function"
      ? options.retainExpiredRecords(record) : options.retainExpiredRecords === true))) : store.list;
  const slotStore: SlotAttemptStore = {
    peek: pendingStore ? slot => list().find(record => record.fingerprint === slot)?.commandKey : store.get,
    resolve(slot, inputFingerprint, mint) {
      const saved = list().find((record) => record.fingerprint === slot);
      if (saved?.inputFingerprint === inputFingerprint) {
        store.remember(slot, saved.commandKey, { inputFingerprint });
        return saved.commandKey;
      }
      if (saved) store.forget(slot);
      const commandKey = mint();
      store.remember(slot, commandKey, { inputFingerprint });
      return commandKey;
    },
    isDurablyStored(slot, inputFingerprint, commandKey) {
      if (typeof window === "undefined") return false;
      try {
        const parsed = JSON.parse(window.sessionStorage.getItem(options.storageKey) ?? "{}") as Record<string, unknown>;
        const record = parsed?.[commandKey] as Partial<SlotAttemptRecord> | undefined;
        return isPendingCommandOwnedBy(record) && !!record
          && record.commandKey === commandKey
          && record.fingerprint === slot
          && record.inputFingerprint === inputFingerprint
          && Number.isFinite(record.createdAt)
          && Number.isFinite(record.expiresAt)
          && Number(record.expiresAt) > Date.now();
      } catch {
        return false;
      }
    },
    forget: store.forget,
    list,
  };
  slotStores.set(options.storageKey, slotStore);
  return slotStore;
}
