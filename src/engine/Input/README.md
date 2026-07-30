# Input Module

> Path: `src/engine/Input/`
>
> The input subsystem of the `@vreen/engine` kernel. Provides unified
> keyboard, mouse, touch, and gamepad state tracking with per-frame
> `pressed` / `released` edge detection, a DOM-attaching
> `InputManager` that drives all four state objects from native events,
> a logical action mapping layer (`InputAction` + `InputMap`) that
> aggregates physical inputs into named gameplay actions, and JSON
> round-trip for binding configurations.

---

## Overview

```
   DOM events ─────► InputManager ─────► per-frame state objects
   (keydown,          (attach/detach,      keyboard: KeyboardState
   keyup,              update, enabled)    mouse:    MouseState
   mousedown,...)                            touch:    TouchState
                                              gamepad:  GamepadState (poll)
                                                       │
                                                       │ satisfies
                                                       ▼
                                          InputStateProvider interface
                                                       │
                                          ┌────────────┴────────────┐
                                          │                         │
                                          ▼                         ▼
                                    InputAction                InputMap
                                  (1+ InputBindings)       (name → InputAction)
                                  evaluate(provider)        update(provider)
                                  → value + pressed         → ticks all actions
                                                                  │
                                                                  ▼
                                                          saveToJSON / loadFromJSON
                                                          (config hot-reload / save)
```

`InputManager` does not own an `InputMap` — the user constructs one
separately and calls `map.update(inputManager)` each frame. The two are
decoupled through the `InputStateProvider` interface to avoid circular
references and to make `InputMap` testable with a stub provider.

---

## Core Classes

### `InputManager`

| Export | Role |
|--------|------|
| `InputManager` | Top-level controller. `attach(domElement)` / `detach()` / `update()` / `setEnabled(bool)`. Owns `keyboard`, `mouse`, `touch`, `gamepad` state instances. |
| `InputManagerOptions` | `{ maxTouches?, gamepadDeadzone?, preventDefaultTouch?, preventDefaultWheel? }`. |

```ts
export interface InputManagerOptions {
  maxTouches?: number;           // default 5
  gamepadDeadzone?: number;      // default 0.1
  preventDefaultTouch?: boolean; // default true (avoid page scroll on touchmove)
  preventDefaultWheel?: boolean; // default true (avoid page zoom on wheel)
}
```

`attach(domElement)` registers DOM listeners for `keydown`, `keyup`,
`mousedown`, `mouseup`, `mousemove`, `wheel`, `touchstart`,
`touchmove`, `touchend`, and `touchcancel`. Re-attaching to a different
element first detaches the previous one. Mouse and touch positions are
translated from `clientX/Y` to element-relative coordinates via
`getBoundingClientRect`. `detach()` removes every listener and resets
all state objects.

`update()` is called every frame by the host loop. It:
1. Polls the gamepad via `navigator.getGamepads()` (skipped when
   `enabled === false`).
2. Calls `update()` on each state object — clears per-frame `pressed` /
   `released` sets, `delta` vectors, and `wheelDelta`, and finalizes
   touch lifecycle transitions.

`setEnabled(false)` short-circuits every event handler and resets all
state objects (so a re-enable does not see stale "still pressed"
flags). `update()` still runs while disabled to drain any per-frame
buffers.

### `KeyboardState`

| Export | Role |
|--------|------|
| `KeyboardState` | Three `Set<string>`s tracking `keysDown`, `keysPressed` (this frame), `keysReleased` (this frame). |

```ts
class KeyboardState {
  readonly keysDown: Set<string>;
  readonly keysPressed: Set<string>;     // cleared at end of frame
  readonly keysReleased: Set<string>;    // cleared at end of frame

  press(code: string): void;             // InputManager keydown handler
  release(code: string): void;           // InputManager keyup handler
  isDown(code: string): boolean;         // currently held
  isPressed(code: string): boolean;      // transitioned up→down this frame
  isReleased(code: string): boolean;     // transitioned down→up this frame
  anyDown(...codes: string[]): boolean;  // any of the codes currently held
  allDown(...codes: string[]): boolean;  // all of the codes currently held
  update(): void;                        // clears pressed/released
  reset(): void;                         // clears everything (lost focus)
}
```

Codes use `KeyboardEvent.code` (e.g. `'KeyW'`, `'ArrowUp'`, `'Space'`)
which is layout-independent — WASD controls work the same on QWERTY,
AZERTY, and Dvorak. Auto-repeat `keydown` events do not re-add to
`keysPressed`: only a true up→down transition counts.

### `MouseState`

| Export | Role |
|--------|------|
| `MouseState` | Tracks `position` / `delta` (Vector2), three button sets, and `wheelDelta`. |

```ts
class MouseState {
  readonly position: Vector2;            // element-relative px
  readonly delta: Vector2;               // this-frame movement, cleared on update
  readonly buttonsDown: Set<number>;
  readonly buttonsPressed: Set<number>;
  readonly buttonsReleased: Set<number>;
  wheelDelta: number;                    // this-frame wheel delta, up = positive

  press(button: number): void;
  release(button: number): void;
  move(x: number, y: number): void;      // updates position, accumulates delta
  scroll(deltaY: number): void;          // accumulates wheelDelta
  isButtonDown(button: number): boolean;
  isButtonPressed(button: number): boolean;
  isButtonReleased(button: number): boolean;
  getWheel(): number;
  update(): void;
  reset(): void;
}
```

Button numbering follows `MouseEvent.button`: `0` = left, `1` = middle,
`2` = right, `3` = back, `4` = forward. `delta` accumulates across
multiple `mousemove` events within a single frame and is zeroed by
`update()`.

### `TouchState`

| Export | Role |
|--------|------|
| `TouchState` | Multi-touch tracker. `touches: Map<id, Touch>` with `phase` lifecycle. |
| `Touch` | Single touch point: `id`, `position`, `delta`, `phase`. |
| `TouchPhase` | `'began' \| 'moved' \| 'ended' \| 'cancelled'`. |

```ts
interface Touch {
  id: number;
  position: Vector2;
  delta: Vector2;
  phase: TouchPhase;
}

class TouchState {
  readonly touches: Map<number, Touch>;
  maxTouches: number;                    // default 5; new touches beyond this are ignored

  begin(id: number, x: number, y: number): void;
  move(id: number, x: number, y: number): void;
  end(id: number): void;
  cancel(id: number): void;
  getTouch(id: number): Touch | undefined;
  getTouchCount(): number;               // includes touches that ended this frame
  isTouching(): boolean;
  getMultiTouchDistance(): number;       // distance between first two active touches (pinch)
  update(): void;                        // removes ended/cancelled, zeros surviving deltas
  reset(): void;
}
```

`update()` removes touches in `'ended'` / `'cancelled'` phase and
zeroes the `delta` of surviving touches. A `'began'` touch transitions
to `'moved'` on its first `update()` (so the same frame's code sees
`'began'`). `getMultiTouchDistance()` returns the Euclidean distance
between the first two *active* (non-ended) touches, or `0` when fewer
than two are active — used for pinch gestures.

### `GamepadState`

| Export | Role |
|--------|------|
| `GamepadState` | Wraps the Gamepad API with deadzone handling, button querying, and rumble. |
| `GamepadButtonState` | `{ pressed, touched, value }` — mirrors the browser's `GamepadButton`. |
| `GamepadConnectionListener` | `(connected: boolean) => void` — registered via `onConnectionChange`. |

```ts
class GamepadState {
  connected: boolean;
  axes: Float32Array;                    // normalized to [-1, 1]
  buttons: GamepadButtonState[];
  deadzone: number;                      // default 0.1; |axis| < deadzone → 0
  index: number | null;                  // null = first available gamepad

  onConnectionChange(listener: GamepadConnectionListener): () => void;
  isConnected(): boolean;
  getAxis(index: number): number;        // deadzone-applied
  isButtonDown(index: number): boolean;
  getTrigger(index: number): number;     // 0..1 (analog triggers)
  rumble(strong: number, weak: number, duration: number): Promise<boolean>;
  poll(): void;                          // called by InputManager.update
  update(): void;                        // no-op (poll overwrites)
  reset(): void;
}
```

`poll()` reads from `navigator.getGamepads()`; if the API is missing
(Node, headless test) or no gamepad is connected, `connected = false`
and `axes` / `buttons` are emptied — no errors thrown. Connection state
changes fire registered listeners. `rumble()` requires
`GamepadHapticActuator` and resolves to `false` when unsupported
(Safari, Firefox on macOS). Axis deadzone is linear: `|v| < deadzone → 0`,
otherwise the raw value is returned (no rescale, so callers can apply
their own response curves).

### Action Mapping

| Export | Role |
|--------|------|
| `InputAction` | Named action with one or more `InputBinding`s. `evaluate(provider)` aggregates value + pressed. |
| `InputBinding` | Single physical input descriptor: `type` + (`code` | `button` | `axis`). |
| `InputBindingType` | `'keyboard' \| 'mouse' \| 'gamepad'`. |
| `InputStateProvider` | `{ keyboard, mouse, touch, gamepad }` — the contract `InputManager` satisfies. |
| `InputMap` | `Map<name, InputAction>` with `update(provider)` and JSON round-trip. |
| `InputMapJSON` | Serializable shape: `{ actions: { name, bindings }[] }`. |

```ts
export interface InputBinding {
  type: InputBindingType;
  code?: string;            // keyboard: KeyboardEvent.code
  button?: number;          // mouse: MouseEvent.button | gamepad: button index
  axis?: number;            // gamepad: axis index (mutually exclusive with button)
  axisThreshold?: number;   // default 0.5; |axis| > threshold counts as "pressed"
}

class InputAction {
  readonly name: string;
  readonly bindings: InputBinding[];
  value: number;            // 0..1 (buttons) or -1..1 (axes), updated by evaluate
  pressed: boolean;         // any binding transitioned to pressed this frame

  addBinding(binding: InputBinding): this;
  clearBindings(): void;
  evaluate(input: InputStateProvider): void;
  isPressed(): boolean;
  getValue(): number;
}

class InputMap {
  readonly actions: Map<string, InputAction>;

  addAction(name: string, action: InputAction): this;
  getAction(name: string): InputAction | undefined;
  removeAction(name: string): boolean;
  get size(): number;
  update(input: InputStateProvider): void;     // evaluates all actions
  clear(): void;
  saveToJSON(): InputMapJSON;
  loadFromJSON(json: InputMapJSON): void;
}
```

Aggregation rules per `InputAction.evaluate`:
- `pressed = true` if **any** binding reports a press this frame.
- `value` is the binding value with the **largest absolute magnitude**
  (preserving sign), so the strongest input wins. For keyboard and
  mouse buttons, value is `0` or `1`. For gamepad axes, value is the
  raw axis reading (post-deadzone). For gamepad triggers, value is the
  analog `0..1` reading.

---

## Usage

### Basic input loop

```ts
import { InputManager } from '@vreen/engine/input';

const input = new InputManager({
  maxTouches: 5,
  gamepadDeadzone: 0.15,
  preventDefaultTouch: true,
  preventDefaultWheel: true,
});
input.attach(canvas);

function frame(dt: number) {
  input.update();   // poll gamepad + clear per-frame buffers

  if (input.keyboard.isPressed('Space'))   player.jump();
  if (input.keyboard.isDown('KeyW'))       player.moveForward(dt);
  if (input.mouse.isButtonPressed(0))      player.shoot();
  if (input.mouse.getWheel() > 0)          camera.zoomIn();
  if (input.touch.isTouching()) {
    const dist = input.touch.getMultiTouchDistance();
    if (dist > 0) camera.pinch(dist);
  }
  if (input.gamepad.isConnected()) {
    const lx = input.gamepad.getAxis(0);   // left stick X
    const ly = input.gamepad.getAxis(1);   // left stick Y
    player.move(lx, ly, dt);
    if (input.gamepad.isButtonDown(0))     player.jump();   // A on Xbox
  }
}
```

### Action-mapped input

```ts
import { InputMap, InputAction } from '@vreen/engine/input';

const map = new InputMap();
map.addAction('jump',    new InputAction('jump',    [
  { type: 'keyboard', code: 'Space' },
  { type: 'gamepad',  button: 0 },           // A
]));
map.addAction('forward', new InputAction('forward', [
  { type: 'keyboard', code: 'KeyW' },
  { type: 'keyboard', code: 'ArrowUp' },
  { type: 'gamepad',  axis: 1, axisThreshold: 0.5 },
]));
map.addAction('fire',    new InputAction('fire',    [
  { type: 'mouse',   button: 0 },
  { type: 'gamepad', button: 7 },            // RT trigger
]));

function frame(dt: number) {
  input.update();
  map.update(input);

  if (map.getAction('jump')!.isPressed())   player.jump();
  const fwd = map.getAction('forward')!.getValue();
  player.moveForward(fwd * dt);
  if (map.getAction('fire')!.getValue() > 0.1) player.fire();
}
```

### Save / load bindings

```ts
// Persist player's keybindings:
const json = map.saveToJSON();
localStorage.setItem('keybindings', JSON.stringify(json));

// Restore on next session:
const saved = JSON.parse(localStorage.getItem('keybindings')!);
map.loadFromJSON(saved);
```

### Gamepad connection lifecycle

```ts
const unsubscribe = input.gamepad.onConnectionChange((connected) => {
  showToast(connected ? 'Gamepad connected' : 'Gamepad disconnected');
});

// On shutdown:
unsubscribe();
```

### Pinch-to-zoom with touch

```ts
let lastPinchDistance = 0;

function frame(dt: number) {
  input.update();
  if (input.touch.getTouchCount() >= 2) {
    const dist = input.touch.getMultiTouchDistance();
    if (lastPinchDistance > 0) {
      const ratio = dist / lastPinchDistance;
      camera.zoomBy(1 / ratio);
    }
    lastPinchDistance = dist;
  } else {
    lastPinchDistance = 0;
  }
}
```

### Pause / resume input

```ts
// When the player opens a menu that shouldn't receive game input:
input.setEnabled(false);
// ... menu open ...
input.setEnabled(true);    // state was reset, no stale "pressed" flags
```

---

## Invariants

- `InputManager.attach` is idempotent for the same element and
  re-attaches (detaching the old element first) for a different one.
- `InputManager.detach` always removes every registered listener — even
  if `attach` was called multiple times — and resets all state objects.
- `InputManager.update` is called every frame even when `enabled === false`,
  so per-frame buffers (`keysPressed`, `delta`, `wheelDelta`) do not
  accumulate stale values across a disabled period.
- `KeyboardState.press` is idempotent against auto-repeat: a held key
  fires `keydown` repeatedly in the browser, but `keysPressed` only
  records the initial up→down transition.
- `MouseState.delta` accumulates across multiple `mousemove` events in
  the same frame and is zeroed by `update()` — it is never negative of
  the previous frame's value.
- `TouchState.begin` ignores new touches once `maxTouches` is reached
  (the touch is silently dropped, not queued).
- `TouchState.update` deletes touches in `'ended'` / `'cancelled'`
  phase; callers reading `getTouchCount()` during the same frame will
  still see the just-ended touch until the next `update`.
- `GamepadState.poll` never throws: missing `navigator.getGamepads`,
  disconnected gamepad, and missing actuators all degrade to safe
  defaults (`connected = false`, `axes`/`buttons` empty, `rumble`
  resolves to `false`).
- `GamepadState.getAxis` applies the deadzone but does **not** rescale
  the remaining range — callers can apply their own response curves.
- `InputAction.evaluate` must be called once per frame (typically via
  `InputMap.update`); `value` and `pressed` reflect the most recent
  evaluation.
- `InputAction.pressed` is `true` if *any* binding reports a press;
  `value` is the *strongest* binding's value (largest absolute
  magnitude, sign preserved).
- `InputMap.loadFromJSON` clears the existing actions before
  reconstructing — it does not merge.
- `InputStateProvider` is a structural interface: `InputManager`
  satisfies it, but tests can substitute a stub object with
  `keyboard` / `mouse` / `touch` / `gamepad` mocks.

---

## Design Notes

**Why `KeyboardEvent.code` instead of `.key`?** `key` is
layout-dependent — pressing the key labeled "W" on a French AZERTY
keyboard produces `key === 'z'`. `code` is the physical key position
(`'KeyW'`), so WASD movement works the same on every layout. This
matches what most game engines do.

**Why per-frame `pressed` / `released` edge sets?** A held key generates
continuous `keydown` events (auto-repeat), so checking
`keysDown.has(code)` answers "is the key currently held" but not "did
the press happen this frame". The separate `keysPressed` set captures
the up→down transition and is cleared at the end of the frame, so
`isPressed('Space')` is `true` for exactly one frame per jump — the
canonical way to detect discrete actions.

**Why `InputManager` does not own `InputMap`.** Two reasons: (1) a game
may have multiple maps (player vs UI vs vehicle) active simultaneously
or swapped at runtime; (2) `InputMap.update` reads from
`InputStateProvider`, an interface, so tests can drive an `InputMap`
with a stub provider without instantiating an `InputManager` or its DOM
listeners. This matches the structural-typing style used elsewhere in
the engine.

**Why linear deadzone without rescale.** Rescaling (mapping
`[deadzone, 1]` to `[0, 1]`) imposes a specific response curve. Many
games want a custom curve (exponential, sigmoid) for "feel"; baking in a
linear rescale would force callers to undo it. Returning the raw
post-deadzone value lets each caller apply its preferred curve.

**Why touch `phase` transitions on `update` instead of immediately.**
A touch that begins and ends in the same frame (a tap) should still be
visible to game logic. Deferring the `'began'` → `'moved'` transition
to `update()` ensures `phase === 'began'` is observable for one full
frame. Likewise, `'ended'` touches remain queryable until the next
`update`, so a tap can be detected by sampling `phase` after
`InputManager.update`.

**Why no `preventDefault` on keyboard.** Keyboard `preventDefault` is
reserved for the application's command-handling layer (e.g., to
override browser shortcuts). The input module does not assume which
keys should suppress default behavior; callers can register their own
capture-phase listeners for that. Touch and wheel defaults *are*
prevented by default because page scroll/zoom during gameplay is almost
never desired.

**Why `GamepadState` is polled, not event-driven.** The Gamepad API is
inherently poll-based — `navigator.getGamepads()` returns the latest
snapshot, and there are no per-frame button events. `poll()` runs once
per `InputManager.update` and overwrites the previous snapshot. The
`update()` method is a no-op for gamepads because there is no per-frame
buffer to clear (unlike keyboard/mouse pressed sets).

---

## References

- `src/engine/Input/InputManager.ts` — DOM-attaching controller.
- `src/engine/Input/KeyboardState.ts` — keyboard edge detection.
- `src/engine/Input/MouseState.ts` — mouse position / buttons / wheel.
- `src/engine/Input/TouchState.ts` — multi-touch lifecycle.
- `src/engine/Input/GamepadState.ts` — Gamepad API wrapper.
- `src/engine/Input/InputAction.ts` — action mapping + aggregation.
- `src/engine/Input/InputMap.ts` — action collection + JSON round-trip.
- `src/engine/Controls/OrbitControls.ts` — direct DOM consumer of
  pointer events (does not go through `InputManager`).
- `src/engine/Controls/PointerLockControls.ts` — first-person camera,
  also bypasses `InputManager` for pointer-lock-specific behavior.
- MDN Web Docs: *KeyboardEvent.code*, *Gamepad API*, *Touch events* —
  browser API references.
