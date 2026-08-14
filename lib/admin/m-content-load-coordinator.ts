export interface MConversationSnapshotGeneration {
  fullLoadGeneration: number;
  conversationSnapshotGeneration: number;
}

/**
 * Keeps the full M-domain load and the M3-only reconciliation in separate
 * generation lanes. A snapshot may never supersede M1's authority read, while
 * a newer full load must invalidate every snapshot based on the older page.
 */
export class MDomainLoadCoordinator {
  private fullLoadGeneration = 0;
  private conversationSnapshotGeneration = 0;
  private conversationStreamController = new AbortController();

  get conversationStreamSignal(): AbortSignal {
    return this.conversationStreamController.signal;
  }

  beginFullLoad(): number {
    this.conversationStreamController.abort();
    this.conversationStreamController = new AbortController();
    this.fullLoadGeneration += 1;
    this.conversationSnapshotGeneration += 1;
    return this.fullLoadGeneration;
  }

  isFullLoadCurrent(generation: number): boolean {
    return generation === this.fullLoadGeneration;
  }

  beginConversationSnapshot(): MConversationSnapshotGeneration {
    this.conversationSnapshotGeneration += 1;
    return {
      fullLoadGeneration: this.fullLoadGeneration,
      conversationSnapshotGeneration: this.conversationSnapshotGeneration,
    };
  }

  isConversationSnapshotCurrent(generation: MConversationSnapshotGeneration): boolean {
    return generation.fullLoadGeneration === this.fullLoadGeneration
      && generation.conversationSnapshotGeneration === this.conversationSnapshotGeneration;
  }
}
