import { createLogger } from '@/lib/logger';
const log = createLogger('NetworkTime');

/**
 * Network time authority. Provides a monotonically-increasing frame counter
 * and a synced wall clock. The server is authoritative; clients reconcile
 * their local time to the server's via the most recent snapshot.
 */
export class NetworkTime {
  /** Local frame counter (increments every tick). */
  private frame = 0;
  /** Local wall clock in ms (drifts; corrected by server). */
  private localMs = 0;
  /** Estimated server wall clock in ms (lerped toward server snapshots). */
  private serverMs = 0;
  /** Round-trip time in ms (set from ping/pong). */
  rttMs = 0;
  /** True once we've received at least one server time update. */
  private synced = false;

  /** Advance the clock by dt seconds. Called once per local tick. */
  tick(dt: number): void {
    this.frame++;
    this.localMs += dt * 1000;
    this.serverMs += dt * 1000;
  }

  /** Apply a server time update (e.g. from a snapshot header). */
  applyServerUpdate(serverFrame: number, serverMs: number, measuredRttMs: number): void {
    this.rttMs = measuredRttMs;
    if (!this.synced) {
      this.serverMs = serverMs;
      this.frame = serverFrame;
      this.synced = true;
      log.info(`Network time synced: frame=${serverFrame}, rtt=${measuredRttMs}ms`);
    } else {
      // Lerp server time toward the authoritative value, but snap if drift is large (> 250ms)
      const drift = serverMs - this.serverMs;
      if (Math.abs(drift) > 250) {
        this.serverMs = serverMs;
        this.frame = serverFrame;
        log.warn(`Network time snap: drift=${drift}ms`);
      } else {
        this.serverMs += drift * 0.1; // gentle converge
      }
    }
  }

  getFrame(): number { return this.frame; }
  getServerMs(): number { return this.serverMs; }
  getLocalMs(): number { return this.localMs; }
  isSynced(): boolean { return this.synced; }
  /** Reset to unsynced state (e.g. on reconnect). */
  reset(): void { this.frame = 0; this.localMs = 0; this.serverMs = 0; this.rttMs = 0; this.synced = false; }
}

export const defaultNetworkTime = new NetworkTime();
