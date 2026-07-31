export interface InputHistoryEntry<TInput> {
  frame: number;
  input: TInput;
}

/**
 * Stores the local player's input per frame, for client-side prediction:
 *   1. Each tick, record(input).
 *   2. When the server corrects the state at frame `f`, rollback the local
 *      entity to `f`, then replay inputs from `f+1` to `now` against the
 *      corrected state.
 *
 * Adapted from o3de NetworkInputHistory.
 */
export class InputHistory<TInput> {
  private entries: InputHistoryEntry<TInput>[] = [];
  private maxFrames: number;
  private cloneFn: (i: TInput) => TInput;

  constructor(maxFrames = 128, cloneFn: (i: TInput) => TInput = (i) => i) {
    this.maxFrames = Math.max(8, Math.floor(maxFrames));
    this.cloneFn = cloneFn;
  }

  /** Record the input applied at `frame`. Evicts entries older than (frame - maxFrames). */
  record(frame: number, input: TInput): void {
    this.entries.push({ frame, input: this.cloneFn(input) });
    // Evict old entries
    const cutoff = frame - this.maxFrames;
    while (this.entries.length > 0 && this.entries[0].frame < cutoff) {
      this.entries.shift();
    }
    // Hard cap
    if (this.entries.length > this.maxFrames) {
      this.entries.splice(0, this.entries.length - this.maxFrames);
    }
  }

  /** Get all inputs with frame > startFrame, in order. Empty if none. */
  replayFrom(startFrame: number): InputHistoryEntry<TInput>[] {
    return this.entries.filter(e => e.frame > startFrame);
  }

  /** Get the input at exactly `frame`, or null. */
  getAt(frame: number): TInput | null {
    for (const e of this.entries) if (e.frame === frame) return this.cloneFn(e.input);
    return null;
  }

  /** Drop all entries with frame <= ackFrame (server has acknowledged them). */
  ack(ackFrame: number): void {
    this.entries = this.entries.filter(e => e.frame > ackFrame);
  }

  /** Number of stored entries. */
  size(): number { return this.entries.length; }

  /** Clear all entries. */
  clear(): void { this.entries.length = 0; }
}
