import { RewindableObject } from './RewindableObject';
import { InputHistory } from './InputHistory';
import { NetworkTime } from './NetworkTime';
import { createLogger } from '@/lib/logger';
const log = createLogger('ClientPrediction');

export interface ClientPredictionState<TState, TInput> {
  /** Authoritative state from the server (or predicted if no correction). */
  state: RewindableObject<TState>;
  /** Inputs awaiting server acknowledgment. */
  inputs: InputHistory<TInput>;
}

/**
 * Drives the client prediction + reconciliation loop for an owned entity.
 *
 * Adapted from o3de LocalPredictionPlayerInputComponent.
 *
 * Flow per tick:
 *   1. Sample local input.
 *   2. Call `step(state.current, input, dt)` to advance the predicted state.
 *   3. Call `predictor.recordInput(frame, input)` and `state.record(frame)`.
 *
 * On server correction:
 *   1. Call `predictor.applyCorrection(frame, serverState)`.
 *      - Rewinds state to `frame`.
 *      - Replaces state.current with serverState.
 *      - Replays inputs from frame+1 to now by calling `step` repeatedly.
 *   2. The next render shows the reconciled state.
 */
export class ClientPrediction<TState, TInput> {
  private stepFn: (state: TState, input: TInput, dt: number) => void;
  private cloneState: (s: TState) => TState;
  private cloneInput: (i: TInput) => TInput;
  /** Fixed dt per replay step (seconds). */
  private fixedDt: number;
  /** Max replay steps to prevent infinite loops on huge drift. */
  private maxReplaySteps: number;

  state: RewindableObject<TState>;
  inputs: InputHistory<TInput>;

  constructor(opts: {
    time: NetworkTime;
    initialState: TState;
    step: (state: TState, input: TInput, dt: number) => void;
    cloneState: (s: TState) => TState;
    cloneInput?: (i: TInput) => TInput;
    maxFrames?: number;
    fixedDt?: number;
    maxReplaySteps?: number;
  }) {
    this.stepFn = opts.step;
    this.cloneState = opts.cloneState;
    this.cloneInput = opts.cloneInput ?? ((i) => i);
    this.fixedDt = opts.fixedDt ?? 1 / 60;
    this.maxReplaySteps = opts.maxReplaySteps ?? 256;
    this.state = new RewindableObject(opts.initialState, opts.maxFrames ?? 64, this.cloneState);
    this.inputs = new InputHistory(opts.maxFrames ?? 128, this.cloneInput);
  }

  /**
   * Record a predicted step: advance the state with `input`, then record
   * both into the rewind buffers. Call once per local tick AFTER stepping.
   */
  recordPredictedStep(frame: number, input: TInput): void {
    this.inputs.record(frame, input);
    this.state.record(frame);
  }

  /**
   * Apply a server correction: rewind to `serverFrame`, replace the state
   * with `serverState`, then replay buffered inputs from serverFrame+1 to now.
   *
   * Returns the number of replay steps performed (0 if no inputs to replay).
   */
  applyCorrection(serverFrame: number, serverState: TState): number {
    // 1. Find the buffered state at serverFrame. If not found, snap (set current = serverState).
    const buffered = this.state.getAtFrame(serverFrame);
    if (!buffered) {
      log.warn(`Correction at frame ${serverFrame} outside rewind window; snapping`);
      this.state.current = this.cloneState(serverState);
      return 0;
    }
    // 2. Replace current with serverState
    this.state.current = this.cloneState(serverState);
    // 3. Replay inputs from serverFrame+1 forward
    const pending = this.inputs.replayFrom(serverFrame);
    let steps = 0;
    for (const entry of pending) {
      if (steps >= this.maxReplaySteps) {
        log.warn(`Replay hit maxReplaySteps=${this.maxReplaySteps}, truncating`);
        break;
      }
      this.stepFn(this.state.current, entry.input, this.fixedDt);
      steps++;
      // Re-record the corrected state at this frame
      this.state.record(entry.frame);
    }
    log.debug(`Correction at frame ${serverFrame}: replayed ${steps} inputs`);
    return steps;
  }

  /** Acknowledge that the server has processed inputs up to (and including) ackFrame. */
  ackInputs(ackFrame: number): void {
    this.inputs.ack(ackFrame);
  }

  /** Reset to a fresh state (e.g. on respawn). */
  reset(state: TState, frame: number = 0): void {
    this.state.reset(state, frame);
    this.inputs.clear();
  }

  /** Current predicted state. */
  getCurrent(): TState { return this.state.current; }
}
