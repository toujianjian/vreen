# Gameplay Module

> Path: `src/engine/Gameplay/`
>
> The role-playing gameplay subsystem of the `@vreen/engine` kernel.
> Provides dialogue trees with branching options and runtime conditions,
> a dialogue state machine with typed event payloads, a quest system
> with objectives / prerequisites / state machine, and an inventory
> system with stackable items, slot caps, and currency. All systems are
> ECS-free, emit events through the shared `EventBus`, and round-trip
> through JSON for save files.

---

## Overview

```
         ┌────────────────────────────────────────────────────────┐
         │                  Dialogue subsystem                    │
         │                                                          │
   registerTree ───► DialogueTree ◀── addNode ◀── JSON load        │
   registerParticipant ► DialogueParticipant                       │
                          │                                          │
                          ▼                                          │
                  DialogueSystem                                     │
                  state: IDLE ↔ ACTIVE → IDLE                       │
                  currentTree / currentNode / dialogueHistory       │
                          │                                          │
                          ▼ emits                                    │
        dialogue:start / dialogue:advance / dialogue:choose /       │
        dialogue:end   (EventBus)                                   │
         └────────────────────────────────────────────────────────┘

         ┌────────────────────────────────────────────────────────┐
         │                   Quest subsystem                      │
         │                                                          │
   registerQuest ──► Quest { objectives, prerequisites, rewards }  │
                          │                                          │
                          ▼                                          │
                   QuestSystem                                       │
   state: inactive → active → completed                              │
                     ↓                                                │
                  abandoned  (re-startable)                          │
                          │                                          │
                          ▼ emits                                    │
   quest:started / quest:objective / quest:completed /               │
   quest:abandoned   (EventBus)                                      │
         └────────────────────────────────────────────────────────┘

         ┌────────────────────────────────────────────────────────┐
         │                Inventory subsystem                     │
         │                                                          │
   InventorySystem                                                  │
     items: Map<id, InventoryItem>    stackable merges count        │
     currency: number                 independent of slots          │
     maxSlots: number                 hard cap (≤0 = unlimited)     │
         └────────────────────────────────────────────────────────┘
```

The three subsystems are independent — none references the others —
but are designed to compose: a dialogue option's `action` can call
`questSystem.startQuest`, a quest's completion reward can call
`inventory.addItem`, and a quest objective of type `'collect'` can be
advanced by `inventorySystem` hooks.

---

## Core Classes

### Dialogue

| Export | Role |
|--------|------|
| `DialogueTree` | Directed graph of `DialogueNode`s + `DialogueOption`s. Supports branching, loops, runtime `condition` predicates, and `action` callbacks. JSON round-trip via `saveToJSON` / `loadFromJSON`. |
| `DialogueNode` | Single dialogue beat: `id`, `speaker`, `text`, `options[]`, optional `nextId` (linear default), optional `condition` / `action`. |
| `DialogueOption` | A player-selectable response: `text`, `nextId` (empty = end), optional `condition` / `action`. |
| `DialogueParticipant` | Speaker descriptor: `id`, `name`, `portrait`, `mood`, `voice`. Pure data + chainable setters. |
| `DialogueSystem` | State machine over `DialogueTree`s. `registerTree` / `registerParticipant` / `start` / `advance` / `chooseOption` / `end`. Emits events via optional `EventBus`. |
| `DIALOGUE_EVENTS` | Constant map of event names: `START` / `ADVANCE` / `CHOOSE` / `END`. |
| `DialogueStartPayload` / `DialogueAdvancePayload` / `DialogueChoosePayload` / `DialogueEndPayload` | Typed event payloads. |

```ts
export interface DialogueNode {
  id: string;
  speaker: string;            // DialogueParticipant.id
  text: string;               // localizable
  options: DialogueOption[];  // empty → use nextId
  condition?: () => boolean;  // runtime, not serialized
  action?: () => void;        // runtime, not serialized
  nextId?: string;            // empty/undefined = end dialogue
}

export interface DialogueOption {
  text: string;
  nextId: string;             // empty = end dialogue
  condition?: () => boolean;
  action?: () => void;
}

export interface DialogueTreeJSON {
  rootId: string;
  entryId: string;
  nodes: Array<{
    id: string;
    speaker: string;
    text: string;
    options: Array<{ text: string; nextId: string }>;
    nextId?: string;
  }>;
}
```

`DialogueSystem` state machine:

```
IDLE  ──start(treeId, participantId)──►  ACTIVE  ──end()──►  IDLE
                                          │
                                          ├──advance()──► (next node or end)
                                          ├──chooseOption(i)──► (next node or end)
                                          └──(node has no nextId)──► IDLE
```

Invariants:
- Only one dialogue is active at a time. `start()` while active first
  calls `end()` on the previous dialogue.
- `advance()` on a node with visible options takes the first option
  (linear default). Use `chooseOption(idx)` for explicit branching.
- `chooseOption(idx)` returns `false` on out-of-range index without
  throwing.
- `condition` and `action` callbacks are runtime-only — they do not
  appear in `saveToJSON` output. The caller must re-inject them after
  `loadFromJSON`.
- `dialogueHistory` records every node visited during the active
  dialogue, in order, for journaling or save archiving.

### Quests

| Export | Role |
|--------|------|
| `QuestSystem` | Quest registry + state machine + objective progressor. Emits via `EventBus`. |
| `Quest` | Quest template: `id`, `title`, `description`, `objectives[]`, `rewards`, `state`, `prerequisites[]`. |
| `QuestObjective` | Single objective: `id`, `description`, `type`, `target`, `count`, `current`, `completed`. |
| `QuestObjectiveType` | `'kill' \| 'collect' \| 'talk' \| 'reach' \| 'custom'` — semantics interpreted by the caller. |
| `QuestState` | `'inactive' \| 'active' \| 'completed' \| 'abandoned'`. |
| `QUEST_EVENTS` | Constant map: `STARTED` / `COMPLETED` / `OBJECTIVE` / `ABANDONED`. |
| `QuestStartedPayload` / `QuestCompletedPayload` / `QuestObjectivePayload` / `QuestAbandonedPayload` | Typed event payloads. |

```ts
export interface QuestObjective {
  id: string;
  description: string;
  type: QuestObjectiveType;
  target: string;        // enemy type / item id / npc id / location id
  count: number;         // required amount
  current: number;       // progress (0 → count)
  completed: boolean;    // current >= count
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  objectives: QuestObjective[];
  rewards: unknown;      // caller-defined shape (items, currency, xp)
  state: QuestState;
  prerequisites: string[]; // quest ids that must be COMPLETED first
}
```

`QuestSystem` state machine:

```
           registerQuest
                │
                ▼
            INACTIVE ──startQuest()──► ACTIVE ──(all objectives completed)──► COMPLETED
                ▲                        │                                       │
                │                        └──abandonQuest()──► ABANDONED           │
                │                        │                  (re-startable)        │
                └────────────────────────┘                                       │
                                                                           (terminal)
```

Invariants:
- `registerQuest` resets every objective's `current` to 0 and `state` to
  `'inactive'`.
- `canStartQuest` returns `false` for quests in `'completed'` or
  `'active'` state, or when any prerequisite is not in
  `completedQuests`.
- `progressObjective` clamps to `count`; once `current >= count` the
  objective is marked `completed` and `quest:objective` is emitted.
- When the last outstanding objective completes, the quest auto-flips to
  `'completed'` and `quest:completed` is emitted on the same call.
- `abandonQuest` resets all objective progress so the quest can be
  re-started later.
- Completed quests are terminal — they cannot be re-started.

### Inventory

| Export | Role |
|--------|------|
| `InventorySystem` | Item map + slot cap + currency. `addItem` / `removeItem` / `hasItem` / `swap` + `addCurrency` / `spendCurrency`. |
| `InventoryItem` | Single item entry: `id`, `name`, `count`, `type`, `data`, `stackable`. |
| `ItemType` | `'weapon' \| 'armor' \| 'consumable' \| 'material' \| 'quest' \| 'misc'`. |
| `InventorySystemOptions` | `{ maxSlots?: number; initialCurrency?: number }`. |

```ts
export interface InventoryItem {
  id: string;            // stackable items share id; non-stackable ids must be unique
  name: string;          // localizable
  count: number;
  type: ItemType;
  data: unknown;         // caller-defined (weapon stats, consumable effect)
  stackable: boolean;
}
```

Invariants:
- `items.size <= maxSlots` when `maxSlots > 0`; `≤ 0` means unlimited.
- `addItem` on an existing stackable id merges counts; on a non-stackable
  id with a free slot it overwrites (caller is expected to use unique
  ids like `'sword-1'`, `'sword-2'` for non-stackable duplicates).
- `addItem` returns `false` when slots are full or `count <= 0`.
- `removeItem(id, count)` returns the actual removed amount (≤ current
  count); the entry is deleted when count drops to 0.
- `spendCurrency(amount)` is atomic — it returns `false` without
  modifying `currency` when funds are insufficient.
- `clear()` resets both items and currency; `clearItems()` keeps
  currency.

---

## Usage

### Dialogue tree with branching

```ts
import {
  DialogueSystem, DialogueTree, DialogueParticipant,
} from '@vreen/engine/gameplay';
import { EventBus } from '@vreen/engine/events';

const bus = new EventBus();
const sys = new DialogueSystem(bus);

const tree = new DialogueTree({ rootId: 'greet' });
tree.addNode({
  id: 'greet', speaker: 'npc1',
  text: 'Need help with the goblins?',
  options: [
    { text: 'Yes', nextId: 'accept' },
    { text: 'No',  nextId: 'bye', action: () => console.log('player refused') },
  ],
});
tree.addNode({ id: 'accept', speaker: 'npc1', text: 'Good luck.', nextId: '' });
tree.addNode({ id: 'bye',    speaker: 'npc1', text: 'Suit yourself.', nextId: '' });

sys.registerTree(tree);
sys.registerParticipant(new DialogueParticipant({
  id: 'npc1', name: 'Innkeeper', portrait: 'innkeeper.png',
}));

sys.start('greet', 'npc1');
while (sys.isActive()) {
  const node = sys.getCurrentNode()!;
  renderText(node.text);
  for (const opt of sys.getOptions()) renderOption(opt.text);
  await playerSelectsOption(sys);  // calls sys.chooseOption(idx) or sys.advance()
}
// sys.end() was called automatically when the last node had no nextId.
```

### Quest with prerequisites and progress

```ts
import { QuestSystem, QUEST_EVENTS } from '@vreen/engine/gameplay';

const quests = new QuestSystem(bus);

quests.registerQuest({
  id: 'q_goblins',
  title: 'Goblin Trouble',
  description: 'Clear the goblins from the cellar.',
  state: 'inactive',
  prerequisites: [],                  // no前置
  rewards: { currency: 50, items: [] },
  objectives: [
    { id: 'kill',  description: 'Kill cellar goblins', type: 'kill',
      target: 'goblin', count: 5, current: 0, completed: false },
    { id: 'report', description: 'Report to innkeeper', type: 'talk',
      target: 'npc1',   count: 1, current: 0, completed: false },
  ],
});

quests.registerQuest({
  id: 'q_reward',
  title: 'The Reward',
  description: 'Collect your pay.',
  state: 'inactive',
  prerequisites: ['q_goblins'],
  rewards: { currency: 100 },
  objectives: [
    { id: 'talk', description: 'Talk to innkeeper', type: 'talk',
      target: 'npc1', count: 1, current: 0, completed: false },
  ],
});

bus.on(QUEST_EVENTS.OBJECTIVE, ({ questId, objective, delta }) => {
  updateQuestTracker(questId, objective);
});
bus.on(QUEST_EVENTS.COMPLETED, ({ questId }) => {
  grantRewards(quests.getQuest(questId)!.rewards);
});

quests.startQuest('q_goblins');            // true
quests.canStartQuest('q_reward');          // false (prerequisite not done)
quests.progressObjective('q_goblins', 'kill', 5);   // completes objective + quest
quests.canStartQuest('q_reward');          // true now
```

### Inventory with buy / sell

```ts
import { InventorySystem } from '@vreen/engine/gameplay';

const inv = new InventorySystem({ maxSlots: 30, initialCurrency: 100 });

inv.addItem({
  id: 'potion', name: 'HP Potion', count: 5,
  type: 'consumable', data: { heal: 50 }, stackable: true,
});

// Buying: spend currency then receive item
function buy(item, price) {
  if (!inv.spendCurrency(price)) return false;
  if (!inv.addItem(item)) {
    inv.addCurrency(price);              // refund if no slot
    return false;
  }
  return true;
}

// Using a potion
inv.removeItem('potion', 1);             // → 1 (removed)
inv.hasItem('potion');                    // true (4 left)
inv.removeItem('potion', 4);             // → 4 (entry deleted)
inv.hasItem('potion');                    // false
```

### Dialogue → Quest → Inventory composition

```ts
// In a dialogue option's action callback:
tree.addNode({
  id: 'accept',
  speaker: 'npc1',
  text: 'I knew you would help.',
  options: [{ text: '(leave)', nextId: '' }],
  action: () => {
    quests.startQuest('q_goblins');
    inv.addItem({ id: 'torch', name: 'Torch', count: 1,
                  type: 'misc', data: null, stackable: false });
  },
});

// In a quest:completed handler:
bus.on(QUEST_EVENTS.COMPLETED, ({ quest }) => {
  const r = quest.rewards as { currency: number; items: InventoryItem[] };
  inv.addCurrency(r.currency);
  for (const it of r.items) inv.addItem(it);
});
```

### Save / load round-trip

```ts
// Dialogue tree (conditions/actions lost — re-inject after load)
const treeJSON = tree.saveToJSON();
// ... persist treeJSON ...
tree.loadFromJSON(treeJSON);
tree.getNode('accept')!.action = () => quests.startQuest('q_goblins');
```

```ts
// Quests are not JSON-serialized by the system itself; serialize the
// Quest + state via the caller's save layer:
const snapshot = Array.from(quests.quests.values())
  .map((q) => ({
    ...q,
    objectives: q.objectives.map(({ ...o }) => o),
  }));
// restore by re-registering each quest with its current state
```

```ts
// Inventory
const invSnapshot = {
  items: inv.getItems(),
  currency: inv.getCurrency(),
};
// restore: clear() then addItem each entry, addCurrency back.
```

---

## Invariants

- `DialogueSystem.isActive() === (currentTree !== null && currentNode !== null)`.
- `DialogueSystem.start` while active first calls `end()` on the
  previous dialogue, emitting `dialogue:end` before `dialogue:start`.
- `DialogueTree.getOptions(nodeId)` filters out options whose
  `condition` returns `false`.
- `QuestSystem.startQuest` is idempotent-false: calling it on an already
  active or already completed quest returns `false` without firing
  `quest:started`.
- `QuestObjective.current` is clamped to `[0, count]`; `completed` is
  derived (`current >= count`).
- A quest in state `'completed'` cannot be re-started; a quest in state
  `'abandoned'` can.
- `InventorySystem.hasFreeSlot()` always returns `true` when
  `maxSlots <= 0`.
- `InventorySystem.spendCurrency` is atomic — it never partially debits.
- All events are emitted through the `EventBus` passed at construction.
  `null` bus is valid: the systems run silently and rely on direct
  return values instead.

---

## Design Notes

**Why ECS-free?** Dialogue, quests, and inventory are *gameplay* state
machines with explicit serialization needs (save files, branching
narratives) — they don't fit the data-oriented ECS model used for
high-frequency simulation. Keeping them as standalone classes lets them
be unit-tested in isolation, scripted from `Scripting/` without
component lookups, and serialized without the ECS's component-type
registry.

**Why conditions and actions are not serialized.** `DialogueNode.condition`
and `action` are JavaScript functions; serializing them would require
either `eval` (security risk) or a bytecode format (over-engineering).
The caller is expected to re-inject runtime callbacks after
`loadFromJSON`. This mirrors how Unity's `MonoBehaviour` references are
relinked after scene loading.

**Why `QuestObjectiveType` is caller-interpreted.** The quest system
tracks only `current` vs `count` — it does not know what "kill" or
"collect" *means*. The caller (a `Scripting/` script or ECS system) is
responsible for calling `progressObjective` when the corresponding
gameplay event happens. This keeps the quest system small, deterministic,
and easy to serialize.

**Why non-stackable item ids must be unique.** `InventorySystem.items`
is keyed on `id`, so two non-stackable swords with the same `id` would
collide. The convention is for the caller to suffix non-stackable ids
(`'sword-1'`, `'sword-2'`) — this matches how most RPG inventories
handle "two of the same unique item" without forcing the inventory to
model slot indices.

**Why events instead of direct callbacks.** Decoupling via `EventBus`
lets multiple UI widgets (quest tracker, dialogue panel, currency
counter) react to the same gameplay event without the gameplay system
knowing about UI. It also makes save-system hooks trivial: a single
`bus.on(QUEST_EVENTS.COMPLETED, markDirty)` flags the save as needing a
write.

---

## References

- `src/engine/Gameplay/DialogueSystem.ts` — dialogue state machine.
- `src/engine/Gameplay/DialogueTree.ts` — node graph + JSON round-trip.
- `src/engine/Gameplay/DialogueParticipant.ts` — speaker descriptor.
- `src/engine/Gameplay/QuestSystem.ts` — quest state machine + events.
- `src/engine/Gameplay/InventorySystem.ts` — items + currency.
- `src/engine/Events/EventBus.ts` — shared pub/sub bus.
- `src/engine/SaveSystem/` — uses these systems' state for save slots.
- `src/engine/Scripting/` — runtime hooks that drive gameplay events.
