# Editor Module

> Path: `src/engine/Editor/`
>
> The editor-side subsystem of the `@vreen/engine` kernel. Provides
> selection and ray-pick management (`SelectionSystem`), a 3-axis
> transform gizmo with snap-aware dragging (`TransformGizmo`), an undo/redo
> command stack with batch grouping (`UndoRedoSystem`), a set of pre-defined
> `HistoryAction` factories (`EditorCommands`), and a three-mode snap system
> (`SnapSystem`). Every component is zero-coupled: the caller (editor UI
> layer) is responsible for sequencing them.

---

## Overview

```
  Mouse click ─► SelectionSystem.pick(raycaster, scene)
                       │  selected: Set<Object3D>  (multiSelect / additive / toggle)
                       │  hover:    Object3D | null
                       │  emit ──► SelectionChangeEvent ──► UI (outliner / inspector)
                       ▼
                 target = selected (primary)
                       │
                       ▼
            TransformGizmo.setTarget(target)
                       │  hitTest(rayOrigin, rayDir) ─► GizmoAxis ('x'|'y'|'z'|'xyz'|null)
                       │  startDrag(axis, rayOrigin, rayDir)
                       │  updateDrag(rayOrigin, rayDir) ─► writes target.position/rotation/scale
                       │  endDrag() / cancelDrag()
                       ▼
            SnapSystem.snapPosition / snapRotation / snapScale
                       │  (returns new Vector3, never mutates input)
                       ▼
            EditorCommands.createMoveCommand(obj, oldPos, newPos) ─► UndoCommand
                       │
                       ▼
            UndoRedoSystem.execute(cmd)
                       │  undoStack: UndoCommand[]   (push on execute, clear redoStack)
                       │  redoStack: UndoCommand[]   (push on undo, push back on redo)
                       │  beginBatch('Transform') / endBatch() ─► BatchCommand (atomic)
                       ▼
            UI history list (getUndoDescriptions / getRedoDescriptions)
```

The five components are deliberately independent: `SelectionSystem` does not
depend on `TransformGizmo`, `TransformGizmo` does not depend on
`UndoRedoSystem`, and `SnapSystem` is a pure function-family over `Vector3`.
This lets unit tests exercise each in isolation and lets the editor UI layer
swap any component (e.g. a different gizmo renderer) without touching the
others.

---

## Core Classes

### SelectionSystem (`SelectionSystem.ts`)

Manages the current `selected: Set<Object3D>` and a single `hover` object.
Ray-pick entry point delegates to `Raycaster.intersectObject(scene, true)`
and applies multi-select / additive / toggle semantics.

| Export | Role |
|--------|------|
| `SelectionSystem` | `select(obj, additive?)` / `deselect(obj)` / `deselectAll()` / `clear()` / `isSelected(obj)` / `getSelected()` / `setHover(obj \| null)` / `pick(raycaster, scene)` / `on(listener)`. |
| `SelectionChangeEvent` | `{ selected: Object3D[], primary: Object3D \| null, kind: 'select' \| 'deselect' \| 'deselectAll' \| 'clear' \| 'hover' }`. |

```ts
class SelectionSystem {
  readonly selected: Set<Object3D>;
  hover: Object3D | null;
  multiSelect: boolean;             // set true while Shift/Ctrl is held
  get count(): number;
}
```

`pick` returns the underlying `Intersection` (so the caller can read the hit
point) and applies the following policy: no hit + non-multi-select clears the
selection; no hit + multi-select leaves the selection intact; hit + multi +
already-selected → deselect (toggle); hit + multi + not selected → append;
hit + non-multi → replace. Listeners are notified via `SelectionChangeEvent`
after every mutation. Listener exceptions are swallowed so one bad listener
cannot break others.

### TransformGizmo (`TransformGizmo.ts`)

3-axis translate/rotate/scale gizmo. Does not draw WebGL itself — `render()`
emits a `GizmoRenderData` struct that the caller (debug overlay or UI layer)
turns into geometry. This keeps the gizmo testable without a WebGL context.

| Export | Role |
|--------|------|
| `TransformGizmo` | `setMode(mode)` / `setTarget(obj)` / `setSnap(enabled, t?, r?, s?)` / `hitTest(rayOrigin, rayDir)` / `startDrag(axis, rayOrigin, rayDir)` / `updateDrag(rayOrigin, rayDir)` / `endDrag()` / `cancelDrag()` / `applyTranslation(delta)` / `applyRotation(delta)` / `applyScale(delta)` / `render()` / `getGizmoTransform()`. |
| `GizmoMode` | `'translate' \| 'rotate' \| 'scale'`. |
| `GizmoAxis` | `'x' \| 'y' \| 'z' \| 'xyz' \| null`. `'xyz'` is the center sphere (whole-object op). |
| `GizmoColor` | `{ r, g, b }` (0..1) for axis coloring. |
| `GizmoDragStart` | Snapshot of `position` / `rotation` / `scale` captured at `startDrag`. |
| `GizmoRenderData` | `{ origin, axes: {x,y,z}, size, mode, activeAxis, isDragging, colors }`. |

The hit-test performs ray-sphere intersection against the center sphere plus
three axis-end spheres (radii are fractions of `size`). During `updateDrag`,
the mouse ray is projected onto the active axis (for translate/scale) or onto
the plane perpendicular to the axis (for single-axis rotate) and the delta is
written back to `target.position` / `target.rotation` / `target.scale`.
Snap is applied in-place when `snapEnabled` is true. `cancelDrag` restores
the target from the `dragStart` snapshot.

### UndoRedoSystem (`UndoRedoSystem.ts`)

Classic two-stack command history with re-entrancy guard and batch grouping.

| Export | Role |
|--------|------|
| `UndoRedoSystem` | `execute(cmd)` / `undo()` / `redo()` / `canUndo()` / `canRedo()` / `getUndoCount()` / `getRedoCount()` / `getUndoDescriptions()` / `getRedoDescriptions()` / `clear()` / `clearRedo()` / `setMaxStackSize(max)` / `beginBatch(description)` / `endBatch()` / `isBatching()` / `getStats()`. |
| `UndoCommand` | `{ id, description, execute(): void, undo(): void, data? }`. |
| `UndoRedoStats` | `{ undoCount, redoCount, maxStackSize, isExecuting, isBatching }`. |

```ts
sys.execute(cmd);              // calls cmd.execute(), pushes to undoStack, clears redoStack
sys.undo();                    // pops undoStack top, calls cmd.undo(), pushes to redoStack
sys.redo();                    // pops redoStack top, calls cmd.execute(), pushes to undoStack
sys.beginBatch('Transform');
sys.execute(cmdA);
sys.execute(cmdB);
const batch = sys.endBatch();  // BatchCommand: execute runs A,B in order; undo runs B,A in reverse
```

`isExecuting` is set during `execute` / `undo` / `redo` callbacks. Re-entrant
calls (a command callback that triggers another `execute`) only run the
side-effect without pushing onto the stack, preventing history pollution.
`endBatch` on an empty buffer returns `null` and pushes nothing. Nesting
`beginBatch` auto-closes the outer batch first so no commands are lost.

### EditorCommands (`EditorCommands.ts`)

Pre-defined `UndoCommand` factories for the common editor operations. Each
factory reads the `oldValue` snapshot at construction time and clones it
internally so later external mutations cannot corrupt the history entry.

| Export | Role |
|--------|------|
| `createMoveCommand(obj, oldPos, newPos)` | Position set / restore. |
| `createRotateCommand(obj, oldRot, newRot)` | Rotation set / restore (`Quaternion`). |
| `createScaleCommand(obj, oldScale, newScale)` | Scale set / restore. |
| `createAddCommand(scene, obj)` | `execute` re-parents `obj` to `scene`; `undo` removes from `scene` and restores the original parent. |
| `createRemoveCommand(scene, obj)` | `execute` removes `obj` from `scene`; `undo` re-adds it. (Parentage other than `scene` is lost on undo.) |
| `createPropertyCommand(obj, prop, oldVal, newVal)` | Generic `keyof` property set / restore. For reference-typed values the caller should pass `clone()` results. |

```ts
const cmd = createMoveCommand(mesh, mesh.position.clone(), new Vector3(1, 2, 3));
sys.execute(cmd);     // mesh.position → (1,2,3)
sys.undo();           // mesh.position → original
sys.redo();           // mesh.position → (1,2,3)
```

### SnapSystem (`SnapSystem.ts`)

Three independent snap toggles (grid / angle / scale) with per-axis step.
Pure-function style: `snap*` methods return new `Vector3` instances and never
mutate their input.

| Export | Role |
|--------|------|
| `SnapSystem` | `snapPosition(pos)` / `snapRotation(rot)` / `snapScale(scale)` / `setGridSize(s)` / `setAngleStep(s)` / `setScaleStep(s)` / `toggleGridSnap()` / `toggleAngleSnap()` / `toggleScaleSnap()`. |

| Field | Default | Notes |
|-------|---------|-------|
| `gridSnap` | `false` | When `true`, `snapPosition` rounds each component to `gridSize`. |
| `gridSize` | `0.25` | World units. |
| `angleSnap` | `false` | When `true`, `snapRotation` rounds each Euler component. |
| `angleStep` | `Math.PI / 12` | 15° in radians. |
| `scaleSnap` | `false` | When `true`, `snapScale` rounds each component. |
| `scaleStep` | `0.25` | Multiplier step. |

Snap uses `Math.round(value / step) * step` so negative values snap correctly
to the nearest grid point. When a snap is disabled, the corresponding method
returns `input.clone()` (still a fresh instance, never the original).

---

## Usage

### Full editor sequence: pick → drag → snap → commit to history

```ts
import { SelectionSystem, TransformGizmo, UndoRedoSystem, SnapSystem, createMoveCommand } from '@vreen/engine/editor';

const selection = new SelectionSystem();
const gizmo = new TransformGizmo();
const undo = new UndoRedoSystem(100);
const snap = new SnapSystem();
snap.gridSnap = true;
snap.gridSize = 0.5;

// 1. Mouse click on the viewport → pick
selection.multiSelect = e.shiftKey;
const hit = selection.pick(raycaster, scene);
if (!hit) return;
const target = selection.getSelected()[0];
if (!target) return;
gizmo.setTarget(target);

// 2. Mouse down on a gizmo handle → start drag
const axis = gizmo.hitTest(rayOrigin, rayDirection);
if (axis === null) return;
gizmo.setSnap(snap.gridSnap, snap.gridSize, 15, 0.25);
gizmo.startDrag(axis, rayOrigin, rayDirection);

// 3. Mouse move → update drag (writes target.position in place)
gizmo.updateDrag(rayOrigin, rayDirection);

// 4. Mouse up → commit a move command for undo/redo
gizmo.endDrag();
const cmd = createMoveCommand(target, gizmo.dragStart!.position, target.position.clone());
undo.execute(cmd);

// 5. User hits Ctrl+Z / Ctrl+Y
undo.undo();
undo.redo();
```

### Batched atomic transform (translate + rotate as one history entry)

```ts
undo.beginBatch('Move + Rotate');
undo.execute(createMoveCommand(mesh, oldPos, newPos));
undo.execute(createRotateCommand(mesh, oldRot, newRot));
undo.endBatch();          // single BatchCommand on the undo stack

undo.undo();               // reverses rotation then translation (reverse order)
undo.redo();               // re-applies translation then rotation (forward order)
```

### Selection event wiring for the outliner

```ts
const off = selection.on((e) => {
  if (e.kind === 'select' || e.kind === 'deselect' || e.kind === 'deselectAll') {
    outliner.refresh(e.selected);
  } else if (e.kind === 'hover') {
    outliner.setHover(e.primary);
  }
});

// Later, on teardown:
off();
```

### Property change with reference-type snapshot

```ts
import { createPropertyCommand } from '@vreen/engine/editor';

// For Vector3-typed properties, pass clones so later mutations don't corrupt the snapshot:
const oldColor = mesh.material.baseColor.clone();
const newColor = new Color(0.9, 0.2, 0.2);
const cmd = createPropertyCommand(mesh.material, 'baseColor', oldColor, newColor);
undo.execute(cmd);
```

---

## Invariants

- **Components are zero-coupling.** `SelectionSystem` references no
  `TransformGizmo`; `TransformGizmo` references no `UndoRedoSystem`;
  `SnapSystem` has no dependencies on any of the above. The UI layer alone
  sequences them.
- **`SelectionSystem.pick` never throws on no-hit.** It returns `null` and
  (in non-multi mode) clears the selection. Listener exceptions are
  swallowed; one faulty listener cannot break others.
- **`TransformGizmo.render()` returns `null` when `target` is `null`.** The
  caller must skip drawing in that case.
- **`TransformGizmo.cancelDrag` restores the target exactly.** The
  `dragStart` snapshot holds clones of `position` / `rotation` / `scale`,
  so cancelling overwrites any in-progress mutation.
- **`UndoRedoSystem.execute` is re-entrancy-safe.** Re-entrant calls during
  a callback only run the side-effect; they never push onto the stack.
- **`UndoRedoSystem.endBatch` is empty-safe.** An empty batch returns `null`
  and pushes nothing, so `beginBatch` / `endBatch` around a no-op path is
  harmless.
- **`BatchCommand.undo` runs in reverse order.** Sub-commands are undone
  last-in-first-out so semantic state is correctly restored.
- **`EditorCommands` factories clone snapshots.** `oldPos` / `newPos` /
  `oldRot` / `newRot` / `oldScale` / `newScale` are `.clone()`-d at factory
  call time; the caller may mutate the originals afterward without
  affecting history. Reference-typed `createPropertyCommand` values are the
  caller's responsibility — pass clones.
- **`SnapSystem.snap*` never mutates the input.** When the corresponding
  snap is disabled they still return a fresh `input.clone()` so callers can
  chain without aliasing surprises.
- **`SnapSystem` step setters ignore non-positive values.** `setGridSize`,
  `setAngleStep`, `setScaleStep` keep the previous value when given `<= 0`,
  preventing divide-by-zero in `snapValue`.

---

## References

- Command pattern (GoF) — `UndoRedoSystem` + `EditorCommands` factories.
- Blender / Unity transform gizmo conventions — three orthogonal axis lines
  with end spheres plus a center sphere for whole-object ops; `TransformGizmo`
  follows this shape and adds axis-locked rotate via plane projection.
- Internal: `viewerStore` / `inspectorStore` consume `SelectionSystem` events
  to drive the outliner and inspector panels; the editor toolbar wires
  `TransformGizmo.setMode` to its translate/rotate/scale buttons.
- Internal: `Core/SelectionSystem` is intentionally separate from this
  module's `SelectionSystem` — the former is a renderer-side concept, the
  latter is the editor-side selection manager with ray-pick semantics.
