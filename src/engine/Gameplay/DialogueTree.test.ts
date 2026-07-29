import { describe, it, expect } from 'vitest';
import { DialogueTree, type DialogueNode } from './DialogueTree';

describe('DialogueTree', () => {
  function makeLinearTree(): DialogueTree {
    const tree = new DialogueTree();
    tree.addNode({
      id: 'n1',
      speaker: 'npc',
      text: 'Hello',
      options: [],
      nextId: 'n2',
    });
    tree.addNode({
      id: 'n2',
      speaker: 'npc',
      text: 'How are you?',
      options: [],
      nextId: 'n3',
    });
    tree.addNode({
      id: 'n3',
      speaker: 'npc',
      text: 'Goodbye',
      options: [],
      nextId: '',
    });
    return tree;
  }

  it('addNode sets rootId and entryId on first add', () => {
    const tree = new DialogueTree();
    expect(tree.rootId).toBe('');
    expect(tree.entryId).toBe('');
    tree.addNode({ id: 'root', speaker: 'npc', text: 'hi', options: [] });
    expect(tree.rootId).toBe('root');
    expect(tree.entryId).toBe('root');
  });

  it('getNode returns undefined for missing id', () => {
    const tree = makeLinearTree();
    expect(tree.getNode('missing')).toBeUndefined();
  });

  it('getRoot returns the root node', () => {
    const tree = makeLinearTree();
    expect(tree.getRoot()?.id).toBe('n1');
  });

  it('getEntry returns the entry node (defaults to rootId)', () => {
    const tree = makeLinearTree();
    expect(tree.getEntry()?.id).toBe('n1');
  });

  it('getEntry respects custom entryId', () => {
    const tree = makeLinearTree();
    tree.entryId = 'n2';
    expect(tree.getEntry()?.id).toBe('n2');
  });

  it('size returns node count', () => {
    const tree = makeLinearTree();
    expect(tree.size).toBe(3);
  });

  it('hasNode returns true for existing nodes', () => {
    const tree = makeLinearTree();
    expect(tree.hasNode('n1')).toBe(true);
    expect(tree.hasNode('missing')).toBe(false);
  });

  it('removeNode removes and returns true; false for missing', () => {
    const tree = makeLinearTree();
    expect(tree.removeNode('n2')).toBe(true);
    expect(tree.size).toBe(2);
    expect(tree.removeNode('missing')).toBe(false);
  });

  it('clear resets nodes and ids', () => {
    const tree = makeLinearTree();
    tree.clear();
    expect(tree.size).toBe(0);
    expect(tree.rootId).toBe('');
    expect(tree.entryId).toBe('');
  });

  it('getOptions filters options by condition', () => {
    const tree = new DialogueTree();
    tree.addNode({
      id: 'n1',
      speaker: 'npc',
      text: 'choice?',
      options: [
        { text: 'A', nextId: 'n2' },
        { text: 'B', nextId: 'n3', condition: () => false },
        { text: 'C', nextId: 'n4', condition: () => true },
      ],
    });
    const opts = tree.getOptions('n1');
    expect(opts).toHaveLength(2);
    expect(opts.map((o) => o.text).sort()).toEqual(['A', 'C']);
  });

  it('getOptions returns empty for missing node', () => {
    const tree = new DialogueTree();
    expect(tree.getOptions('missing')).toEqual([]);
  });

  it('saveToJSON / loadFromJSON round-trip preserves structure', () => {
    const tree = new DialogueTree();
    tree.addNode({
      id: 'root',
      speaker: 'npc',
      text: 'hi',
      options: [
        { text: 'A', nextId: 'b' },
        { text: 'B', nextId: '' },
      ],
      nextId: 'b',
    });
    tree.addNode({ id: 'b', speaker: 'npc', text: 'bye', options: [] });
    const json = tree.saveToJSON();
    const restored = new DialogueTree().loadFromJSON(json);
    expect(restored.rootId).toBe('root');
    expect(restored.size).toBe(2);
    expect(restored.getNode('root')?.options).toHaveLength(2);
    expect(restored.getNode('root')?.options[0].text).toBe('A');
    expect(restored.getNode('root')?.nextId).toBe('b');
  });

  it('loadFromJSON strips condition/action (not serializable)', () => {
    const tree = new DialogueTree();
    const node: DialogueNode = {
      id: 'n1',
      speaker: 'npc',
      text: 'hi',
      options: [{ text: 'A', nextId: '', condition: () => true, action: () => {} }],
      condition: () => true,
      action: () => {},
    };
    tree.addNode(node);
    const json = tree.saveToJSON();
    const restored = new DialogueTree().loadFromJSON(json);
    const restoredNode = restored.getNode('n1');
    expect(restoredNode?.condition).toBeUndefined();
    expect(restoredNode?.action).toBeUndefined();
    expect(restoredNode?.options[0].condition).toBeUndefined();
    expect(restoredNode?.options[0].action).toBeUndefined();
  });
});
