import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../Events/EventBus';
import { QuestSystem, QUEST_EVENTS, type Quest } from './QuestSystem';

describe('QuestSystem', () => {
  function makeQuest(overrides: Partial<Quest> = {}): Quest {
    return {
      id: 'q1',
      title: 'Kill Goblins',
      description: 'Kill 5 goblins',
      objectives: [
        { id: 'kill', description: 'kill goblins', type: 'kill', target: 'goblin', count: 5, current: 0, completed: false },
      ],
      rewards: { xp: 100 },
      state: 'inactive',
      prerequisites: [],
      ...overrides,
    };
  }

  describe('registerQuest', () => {
    it('registers a quest template with reset progress', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest({
        objectives: [
          { id: 'o1', description: 'x', type: 'kill', target: 't', count: 3, current: 2, completed: true },
        ],
      }));
      const q = sys.getQuest('q1');
      expect(q).toBeDefined();
      expect(q?.objectives[0].current).toBe(0);
      expect(q?.objectives[0].completed).toBe(false);
      expect(q?.state).toBe('inactive');
    });
  });

  describe('canStartQuest', () => {
    it('returns true for registered quest with no prerequisites', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      expect(sys.canStartQuest('q1')).toBe(true);
    });
    it('returns false for missing quest', () => {
      const sys = new QuestSystem();
      expect(sys.canStartQuest('missing')).toBe(false);
    });
    it('returns false when prerequisites not met', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest({ id: 'q2', prerequisites: ['q1'] }));
      sys.registerQuest(makeQuest({ id: 'q1' }));
      expect(sys.canStartQuest('q2')).toBe(false);
    });
    it('returns true when prerequisites completed', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest({ id: 'q1' }));
      sys.registerQuest(makeQuest({ id: 'q2', prerequisites: ['q1'] }));
      sys.startQuest('q1');
      // Complete q1 by progressing its objective to the required count
      sys.progressObjective('q1', 'kill', 5);
      expect(sys.completedQuests.has('q1')).toBe(true);
      expect(sys.canStartQuest('q2')).toBe(true);
    });
    it('returns false when quest already active', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      expect(sys.canStartQuest('q1')).toBe(false);
    });
    it('returns false when quest already completed', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 5);
      expect(sys.canStartQuest('q1')).toBe(false);
    });
  });

  describe('startQuest', () => {
    it('returns true and sets state to active', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      expect(sys.startQuest('q1')).toBe(true);
      expect(sys.getQuest('q1')?.state).toBe('active');
      expect(sys.activeQuests.has('q1')).toBe(true);
    });
    it('returns false for missing quest', () => {
      const sys = new QuestSystem();
      expect(sys.startQuest('missing')).toBe(false);
    });
    it('emits quest:started event', () => {
      const bus = new EventBus();
      const sys = new QuestSystem(bus);
      const fn = vi.fn();
      bus.on(QUEST_EVENTS.STARTED, fn);
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ questId: 'q1' }));
    });
  });

  describe('progressObjective', () => {
    it('increments current and emits objective event', () => {
      const bus = new EventBus();
      const sys = new QuestSystem(bus);
      const fn = vi.fn();
      bus.on(QUEST_EVENTS.OBJECTIVE, fn);
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      const result = sys.progressObjective('q1', 'kill', 2);
      expect(result).toBe(2);
      expect(sys.getQuest('q1')?.objectives[0].current).toBe(2);
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('clamps current to count', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 100);
      expect(sys.getQuest('q1')?.objectives[0].current).toBe(5);
    });
    it('marks objective completed when current >= count', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 5);
      expect(sys.getQuest('q1')?.objectives[0].completed).toBe(true);
    });
    it('returns -1 for missing quest or inactive quest', () => {
      const sys = new QuestSystem();
      expect(sys.progressObjective('missing', 'o', 1)).toBe(-1);
      sys.registerQuest(makeQuest());
      expect(sys.progressObjective('q1', 'kill', 1)).toBe(-1); // not started
    });
    it('returns -1 for missing objective', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      expect(sys.progressObjective('q1', 'missing', 1)).toBe(-1);
    });
    it('does not progress already-completed objective', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 5);
      // Quest is now completed; further progress returns -1
      const result = sys.progressObjective('q1', 'kill', 1);
      expect(result).toBe(-1);
    });
    it('auto-completes quest when all objectives done', () => {
      const bus = new EventBus();
      const sys = new QuestSystem(bus);
      const fn = vi.fn();
      bus.on(QUEST_EVENTS.COMPLETED, fn);
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 5);
      expect(sys.getQuest('q1')?.state).toBe('completed');
      expect(sys.activeQuests.has('q1')).toBe(false);
      expect(sys.completedQuests.has('q1')).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('completeObjective', () => {
    it('directly completes an objective', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      expect(sys.completeObjective('q1', 'kill')).toBe(true);
      expect(sys.getQuest('q1')?.objectives[0].completed).toBe(true);
      expect(sys.getQuest('q1')?.objectives[0].current).toBe(5);
    });
    it('returns false for missing or already completed objective', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      expect(sys.completeObjective('q1', 'missing')).toBe(false);
      sys.completeObjective('q1', 'kill');
      expect(sys.completeObjective('q1', 'kill')).toBe(false);
    });
  });

  describe('abandonQuest', () => {
    it('sets state to abandoned and resets progress', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 2);
      expect(sys.abandonQuest('q1')).toBe(true);
      expect(sys.getQuest('q1')?.state).toBe('abandoned');
      expect(sys.activeQuests.has('q1')).toBe(false);
      expect(sys.getQuest('q1')?.objectives[0].current).toBe(0);
      expect(sys.getQuest('q1')?.objectives[0].completed).toBe(false);
    });
    it('returns false for non-active quest', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      expect(sys.abandonQuest('q1')).toBe(false);
    });
    it('emits abandoned event', () => {
      const bus = new EventBus();
      const sys = new QuestSystem(bus);
      const fn = vi.fn();
      bus.on(QUEST_EVENTS.ABANDONED, fn);
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.abandonQuest('q1');
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('allows restarting abandoned quest', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.abandonQuest('q1');
      expect(sys.canStartQuest('q1')).toBe(true);
      expect(sys.startQuest('q1')).toBe(true);
    });
  });

  describe('getActiveQuests / getCompletedQuests', () => {
    it('returns active and completed quest arrays', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest({ id: 'a' }));
      sys.registerQuest(makeQuest({ id: 'b' }));
      sys.startQuest('a');
      sys.startQuest('b');
      sys.progressObjective('b', 'kill', 5);
      expect(sys.getActiveQuests().map((q) => q.id)).toEqual(['a']);
      expect(sys.getCompletedQuests().map((q) => q.id)).toEqual(['b']);
    });
  });

  describe('multi-objective quest', () => {
    it('completes only when all objectives done', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest({
        objectives: [
          { id: 'kill', description: 'kill', type: 'kill', target: 'goblin', count: 3, current: 0, completed: false },
          { id: 'collect', description: 'collect', type: 'collect', target: 'ore', count: 2, current: 0, completed: false },
        ],
      }));
      sys.startQuest('q1');
      sys.progressObjective('q1', 'kill', 3);
      expect(sys.getQuest('q1')?.state).toBe('active');
      sys.progressObjective('q1', 'collect', 2);
      expect(sys.getQuest('q1')?.state).toBe('completed');
    });
  });

  describe('clear', () => {
    it('clears all quests and sets', () => {
      const sys = new QuestSystem();
      sys.registerQuest(makeQuest());
      sys.startQuest('q1');
      sys.clear();
      expect(sys.quests.size).toBe(0);
      expect(sys.activeQuests.size).toBe(0);
      expect(sys.completedQuests.size).toBe(0);
    });
  });
});
