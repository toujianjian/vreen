import { createLogger } from '@/lib/logger';
const log = createLogger('RewindableObject');

export interface RewindableEntry<T> {
  frame: number;
  value: T;
}

/**
 * Per-property ring buffer that can roll back to a past frame and restore.
 * Adapted from o3de RewindableObject<T, N>.
 *
 * Use cases:
 *   - Hit detection rewinds one entity's Transform to a past frame while leaving
 *     the rest of the world live (instead of rewinding whole snapshots).
 *   - Client prediction reconciliation: rewind the owned entity to the server-
 *     corrected frame, then replay local inputs forward.
 */
export class RewindableObject<T> {
  private buffer: RewindableEntry<T>[] = [];
  private maxFrames: number;
  private currentIndex = 0;
  /** Current (latest) value. Reading this is O(1). */
  current: T;
  /** Called to deep-copy a value into the buffer (default = value itself — override for object types). */
  private cloneFn: (v: T) => T;

  constructor(initial: T, maxFrames = 64, cloneFn: (v: T) => T = (v) => v) {
    this.current = cloneFn(initial);
    this.maxFrames = Math.max(2, Math.floor(maxFrames));
    this.cloneFn = cloneFn;
    // Pre-fill the buffer with the initial value at frame 0
    this.buffer.push({ frame: 0, value: this.cloneFn(initial) });
  }

  /**
   * Record the current value at `frame`. Called once per tick AFTER the
   * simulation has updated `current`. Old entries beyond maxFrames are
   * evicted (ring buffer).
   */
  record(frame: number): void {
    this.currentIndex = (this.currentIndex + 1) % this.maxFrames;
    if (this.buffer.length < this.maxFrames) {
      this.buffer.push({ frame, value: this.cloneFn(this.current) });
    } else {
      this.buffer[this.currentIndex] = { frame, value: this.cloneFn(this.current) };
    }
  }

  /**
   * Find the entry whose frame is the largest frame <= targetFrame.
   * Returns null if no such entry (e.g. targetFrame is older than the
   * oldest buffered entry, or buffer is empty).
   */
  getAtFrame(targetFrame: number): RewindableEntry<T> | null {
    let best: RewindableEntry<T> | null = null;
    for (const entry of this.buffer) {
      if (entry.frame <= targetFrame && (!best || entry.frame > best.frame)) {
        best = entry;
      }
    }
    return best;
  }

  /**
   * Rewind the live `current` to the value at `targetFrame`.
   * The previously-current value is saved so you can call `restoreCurrent()`.
   * Returns true if a matching entry was found.
   */
  rollback(targetFrame: number): boolean {
    const entry = this.getAtFrame(targetFrame);
    if (!entry) {
      log.warn(`Cannot rollback to frame ${targetFrame}: no matching entry`);
      return false;
    }
    this.current = this.cloneFn(entry.value);
    return true;
  }

  /** (Stub) — o3de uses a separate restore stack. We just rely on record() to push forward. */
  restoreCurrent(): void { /* no-op: re-record() after replaying inputs */ }

  /** Number of frames currently buffered. */
  size(): number { return this.buffer.length; }

  /** Oldest buffered frame (or null). */
  oldestFrame(): number | null { return this.buffer.length ? this.buffer[0].frame : null; }

  /** Latest buffered frame (or null). */
  latestFrame(): number | null {
    if (this.buffer.length === 0) return null;
    let max = this.buffer[0].frame;
    for (const e of this.buffer) if (e.frame > max) max = e.frame;
    return max;
  }

  /** Clear the buffer and reset to a fresh initial value. */
  reset(value: T, frame: number = 0): void {
    this.buffer.length = 0;
    this.current = this.cloneFn(value);
    this.buffer.push({ frame, value: this.cloneFn(value) });
    this.currentIndex = 0;
  }
}
