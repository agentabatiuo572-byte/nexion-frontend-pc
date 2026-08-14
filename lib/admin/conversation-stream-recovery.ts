/**
 * Orders an authoritative reconnect snapshot before any live events observed by
 * the new transport. The token prevents a late snapshot from a closed page or
 * superseded connection from becoming authoritative again.
 */
export class ConversationReconnectGate<T> {
  private generation = 0;
  private pendingGeneration: number | null = null;
  private queued: T[] = [];
  private readonly maxQueuedEvents: number;
  private activeDelivery: Promise<void> = Promise.resolve();
  private activePending = 0;

  constructor(maxQueuedEvents = 10_000) {
    this.maxQueuedEvents = maxQueuedEvents;
  }

  begin(): number {
    const generation = ++this.generation;
    this.pendingGeneration = generation;
    this.queued = [];
    return generation;
  }

  async accept(event: T, deliver: (event: T) => void | Promise<void>): Promise<boolean> {
    if (this.pendingGeneration !== null) {
      if (this.queued.length >= this.maxQueuedEvents) return false;
      this.queued.push(event);
      return true;
    }
    if (this.activePending >= this.maxQueuedEvents) return false;
    this.activePending += 1;
    const delivery = this.activeDelivery.then(() => deliver(event));
    this.activeDelivery = delivery.catch(() => undefined);
    try {
      await delivery;
      return true;
    } finally {
      this.activePending -= 1;
    }
  }

  async complete(generation: number, deliver: (event: T) => void | Promise<void>): Promise<boolean> {
    if (this.pendingGeneration !== generation || this.generation !== generation) return false;
    let index = 0;
    while (index < this.queued.length) {
      await deliver(this.queued[index++]);
      if (this.pendingGeneration !== generation || this.generation !== generation) return false;
    }
    this.queued = [];
    this.pendingGeneration = null;
    return true;
  }

  cancel(): void {
    this.generation += 1;
    this.pendingGeneration = null;
    this.queued = [];
  }
}

export function isTerminalConversationStreamStatus(status: number): boolean {
  return status === 401 || status === 403;
}
