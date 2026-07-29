import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../Events/EventBus';
import { DialogueSystem, DIALOGUE_EVENTS } from './DialogueSystem';
import { DialogueTree } from './DialogueTree';
import { DialogueParticipant } from './DialogueParticipant';

describe('DialogueSystem', () => {
  function makeTree(): DialogueTree {
    const tree = new DialogueTree();
    tree.addNode({
      id: 'start',
      speaker: 'npc1',
      text: 'Hello traveler',
      options: [
        { text: 'Who are you?', nextId: 'intro' },
        { text: 'Bye', nextId: '' },
      ],
    });
    tree.addNode({
      id: 'intro',
      speaker: 'npc1',
      text: 'I am the blacksmith',
      options: [],
      nextId: '',
    });
    return tree;
  }

  describe('registration', () => {
    it('registerTree and getTree', () => {
      const sys = new DialogueSystem();
      const tree = makeTree();
      sys.registerTree(tree);
      expect(sys.getTree('start')).toBe(tree);
    });

    it('registerParticipant and getParticipant', () => {
      const sys = new DialogueSystem();
      const npc = new DialogueParticipant({ id: 'npc1', name: 'Blacksmith' });
      sys.registerParticipant(npc);
      expect(sys.getParticipant('npc1')).toBe(npc);
    });

    it('registerTree throws if rootId is empty', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree(); // no nodes added
      expect(() => sys.registerTree(tree)).toThrow();
    });
  });

  describe('isActive', () => {
    it('returns false initially', () => {
      const sys = new DialogueSystem();
      expect(sys.isActive()).toBe(false);
    });
    it('returns true after start', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(sys.isActive()).toBe(true);
    });
    it('returns false after end', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      sys.end();
      expect(sys.isActive()).toBe(false);
    });
  });

  describe('start', () => {
    it('returns false for missing tree', () => {
      const sys = new DialogueSystem();
      expect(sys.start('missing', 'npc1')).toBe(false);
    });
    it('sets currentNode to entry', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      expect(sys.start('start', 'npc1')).toBe(true);
      expect(sys.getCurrentNode()?.id).toBe('start');
    });
    it('records history with entry node', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(sys.getHistory()).toHaveLength(1);
      expect(sys.getHistory()[0].id).toBe('start');
    });
    it('triggers node action on start', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree();
      const action = vi.fn();
      tree.addNode({ id: 'start', speaker: 'npc1', text: 'hi', options: [], action });
      sys.registerTree(tree);
      sys.start('start', 'npc1');
      expect(action).toHaveBeenCalledTimes(1);
    });
    it('ends previous dialogue if active', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      sys.start('start', 'npc1');
      // history should be reset to just the entry node
      expect(sys.getHistory()).toHaveLength(1);
    });
  });

  describe('advance', () => {
    it('returns null when not active', () => {
      const sys = new DialogueSystem();
      expect(sys.advance()).toBeNull();
    });
    it('with options, advances via first visible option', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      const next = sys.advance();
      expect(next?.id).toBe('intro');
    });
    it('with no options, uses nextId', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree();
      tree.addNode({ id: 'a', speaker: 'npc', text: 'a', options: [], nextId: 'b' });
      tree.addNode({ id: 'b', speaker: 'npc', text: 'b', options: [], nextId: '' });
      sys.registerTree(tree);
      sys.start('a', 'npc');
      const next = sys.advance();
      expect(next?.id).toBe('b');
    });
    it('returns null and ends when nextId is empty', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree();
      tree.addNode({ id: 'end', speaker: 'npc', text: 'bye', options: [], nextId: '' });
      sys.registerTree(tree);
      sys.start('end', 'npc');
      const next = sys.advance();
      expect(next).toBeNull();
      expect(sys.isActive()).toBe(false);
    });
    it('triggers option action when advancing via option', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree();
      const action = vi.fn();
      tree.addNode({
        id: 'start',
        speaker: 'npc',
        text: 'go',
        options: [{ text: 'A', nextId: 'b', action }],
      });
      tree.addNode({ id: 'b', speaker: 'npc', text: 'b', options: [] });
      sys.registerTree(tree);
      sys.start('start', 'npc');
      sys.advance();
      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  describe('chooseOption', () => {
    it('returns false when not active', () => {
      const sys = new DialogueSystem();
      expect(sys.chooseOption(0)).toBe(false);
    });
    it('returns false for out-of-range index', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(sys.chooseOption(99)).toBe(false);
      expect(sys.chooseOption(-1)).toBe(false);
    });
    it('jumps to option nextId', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(sys.chooseOption(0)).toBe(true);
      expect(sys.getCurrentNode()?.id).toBe('intro');
    });
    it('ends dialogue when option nextId is empty', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(sys.chooseOption(1)).toBe(true); // "Bye" option
      expect(sys.isActive()).toBe(false);
    });
    it('triggers option action', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree();
      const action = vi.fn();
      tree.addNode({
        id: 'start',
        speaker: 'npc',
        text: 'go',
        options: [{ text: 'A', nextId: 'b', action }],
      });
      tree.addNode({ id: 'b', speaker: 'npc', text: 'b', options: [] });
      sys.registerTree(tree);
      sys.start('start', 'npc');
      sys.chooseOption(0);
      expect(action).toHaveBeenCalledTimes(1);
    });
    it('triggers target node action', () => {
      const sys = new DialogueSystem();
      const tree = new DialogueTree();
      const targetAction = vi.fn();
      tree.addNode({
        id: 'start',
        speaker: 'npc',
        text: 'go',
        options: [{ text: 'A', nextId: 'b' }],
      });
      tree.addNode({ id: 'b', speaker: 'npc', text: 'b', options: [], action: targetAction });
      sys.registerTree(tree);
      sys.start('start', 'npc');
      sys.chooseOption(0);
      expect(targetAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('getOptions', () => {
    it('returns empty when not active', () => {
      const sys = new DialogueSystem();
      expect(sys.getOptions()).toEqual([]);
    });
    it('returns visible options for current node', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(sys.getOptions()).toHaveLength(2);
    });
  });

  describe('events', () => {
    it('emits start event', () => {
      const bus = new EventBus();
      const sys = new DialogueSystem(bus);
      const fn = vi.fn();
      bus.on(DIALOGUE_EVENTS.START, fn);
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ treeId: 'start', participantId: 'npc1' }),
      );
    });
    it('emits advance event', () => {
      const bus = new EventBus();
      const sys = new DialogueSystem(bus);
      const fn = vi.fn();
      bus.on(DIALOGUE_EVENTS.ADVANCE, fn);
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      sys.advance();
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('emits choose event', () => {
      const bus = new EventBus();
      const sys = new DialogueSystem(bus);
      const fn = vi.fn();
      bus.on(DIALOGUE_EVENTS.CHOOSE, fn);
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      sys.chooseOption(0);
      expect(fn).toHaveBeenCalledTimes(1);
    });
    it('emits end event', () => {
      const bus = new EventBus();
      const sys = new DialogueSystem(bus);
      const fn = vi.fn();
      bus.on(DIALOGUE_EVENTS.END, fn);
      sys.registerTree(makeTree());
      sys.start('start', 'npc1');
      sys.end();
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith(
        expect.objectContaining({ treeId: 'start', participantId: 'npc1' }),
      );
    });
  });

  describe('clear', () => {
    it('clears registered trees and participants', () => {
      const sys = new DialogueSystem();
      sys.registerTree(makeTree());
      sys.registerParticipant(new DialogueParticipant({ id: 'npc1', name: 'B' }));
      sys.clear();
      expect(sys.getTree('start')).toBeUndefined();
      expect(sys.getParticipant('npc1')).toBeUndefined();
    });
  });
});
