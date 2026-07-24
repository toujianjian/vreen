// EcsScriptAPI 动画状态机测试 — Phase 3.4
//
// 验证:
//   • initAnimStateMachine 从 SkinnedMeshRef 创建 SM
//   • addAnimState / addAnimTransition / enterAnimState
//   • getCurrentAnimState / listAnimStates / listAnimClips
//   • registerAnimClip
//   • 边界:无 SkinnedMeshRef / 无 SM / 未知 clip / 未知 state

import { describe, it, expect, beforeEach } from 'vitest';
import { World, SkinnedMeshRef, SkinnedMeshRefC, AnimStateC } from '@/engine/ECS';
import { EcsScriptAPI } from '@/lib/ecsScriptApi';
import { AnimationMixer } from '@/engine/Animation/AnimationMixer';
import { AnimationClip } from '@/engine/Animation/AnimationClip';
import { SkinnedMesh } from '@/engine/Core/SkinnedMesh';
import { Object3D } from '@/engine/Core/Object3D';
import { BufferGeometry } from '@/engine/Core/BufferGeometry';
import { StandardMaterial } from '@/engine/Materials/StandardMaterial';

describe('EcsScriptAPI — Animation State Machine (Phase 3.4)', () => {
  let world: World;
  let api: EcsScriptAPI;

  beforeEach(() => {
    world = new World({ name: 'AnimSMTestWorld' });
    api = new EcsScriptAPI(world);
  });

  /** 创建带 SkinnedMeshRef 的 entity,并返回 mixer 引用。 */
  function makeSkinnedEntity(): { id: number; mixer: AnimationMixer } {
    const id = world.createEntity('Skinned');
    const mesh = new SkinnedMesh(new BufferGeometry(), new StandardMaterial());
    const mixer = new AnimationMixer(mesh as unknown as Object3D);
    world.setComponent(id, SkinnedMeshRefC, new SkinnedMeshRef(mesh, mixer));
    return { id, mixer };
  }

  /** 创建一个简单的 AnimationClip。 */
  function makeClip(name: string): AnimationClip {
    return new AnimationClip(name, 1.0, []);
  }

  // ── initAnimStateMachine ────────────────────────────────────
  describe('initAnimStateMachine', () => {
    it('creates SM from SkinnedMeshRef', () => {
      const { id } = makeSkinnedEntity();
      expect(api.initAnimStateMachine(id)).toBe(true);
      const anim = world.getComponent(id, AnimStateC);
      expect(anim).toBeDefined();
      expect(anim!.stateMachine).not.toBeNull();
    });

    it('returns false for entity without SkinnedMeshRef', () => {
      const id = world.createEntity('NoSkin');
      expect(api.initAnimStateMachine(id)).toBe(false);
    });

    it('returns false if SM already exists', () => {
      const { id } = makeSkinnedEntity();
      expect(api.initAnimStateMachine(id)).toBe(true);
      expect(api.initAnimStateMachine(id)).toBe(false);
    });
  });

  // ── registerAnimClip ────────────────────────────────────────
  describe('registerAnimClip', () => {
    it('registers a clip by name', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      const clip = makeClip('idle');
      expect(api.registerAnimClip(id, 'idle', clip)).toBe(true);
      expect(api.listAnimClips(id)).toContain('idle');
    });

    it('auto-creates AnimState from SkinnedMeshRef if missing', () => {
      const { id } = makeSkinnedEntity();
      // 不先调 initAnimStateMachine,直接 registerAnimClip
      expect(api.registerAnimClip(id, 'walk', makeClip('walk'))).toBe(true);
      expect(api.listAnimClips(id)).toContain('walk');
    });

    it('returns false for entity without SkinnedMeshRef', () => {
      const id = world.createEntity('NoSkin');
      expect(api.registerAnimClip(id, 'idle', makeClip('idle'))).toBe(false);
    });
  });

  // ── addAnimState ────────────────────────────────────────────
  describe('addAnimState', () => {
    it('adds a state referencing a registered clip', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      api.registerAnimClip(id, 'idle', makeClip('idle'));
      expect(api.addAnimState(id, 'Idle', 'idle', 'repeat', 1)).toBe(true);
      expect(api.listAnimStates(id)).toContain('Idle');
    });

    it('returns false for unknown clip name', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      expect(api.addAnimState(id, 'Idle', 'unknown_clip', 'repeat', 1)).toBe(false);
    });

    it('returns false for entity without SM', () => {
      const id = world.createEntity('NoSkin');
      expect(api.addAnimState(id, 'Idle', 'idle', 'repeat', 1)).toBe(false);
    });
  });

  // ── addAnimTransition ───────────────────────────────────────
  describe('addAnimTransition', () => {
    it('adds a transition between states', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      api.registerAnimClip(id, 'idle', makeClip('idle'));
      api.registerAnimClip(id, 'walk', makeClip('walk'));
      api.addAnimState(id, 'Idle', 'idle', 'repeat');
      api.addAnimState(id, 'Walk', 'walk', 'repeat');
      expect(api.addAnimTransition(id, 'Idle', 'Walk', 0.2)).toBe(true);
    });

    it('returns false for entity without SM', () => {
      const id = world.createEntity('NoSkin');
      expect(api.addAnimTransition(id, 'Idle', 'Walk', 0.2)).toBe(false);
    });
  });

  // ── enterAnimState ──────────────────────────────────────────
  describe('enterAnimState', () => {
    it('enters the named state', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      api.registerAnimClip(id, 'idle', makeClip('idle'));
      api.addAnimState(id, 'Idle', 'idle', 'repeat');
      expect(api.enterAnimState(id, 'Idle')).toBe(true);
      expect(api.getCurrentAnimState(id)).toBe('Idle');
    });

    it('returns false for unknown state name', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      expect(api.enterAnimState(id, 'NonExistent')).toBe(false);
    });

    it('returns false for entity without SM', () => {
      const id = world.createEntity('NoSkin');
      expect(api.enterAnimState(id, 'Idle')).toBe(false);
    });
  });

  // ── getCurrentAnimState ─────────────────────────────────────
  describe('getCurrentAnimState', () => {
    it('returns empty string for entity without SM', () => {
      const id = world.createEntity('NoSkin');
      expect(api.getCurrentAnimState(id)).toBe('');
    });

    it('returns empty string when no state is current', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      expect(api.getCurrentAnimState(id)).toBe('');
    });

    it('returns current state name after enter', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      api.registerAnimClip(id, 'run', makeClip('run'));
      api.addAnimState(id, 'Run', 'run', 'repeat');
      api.enterAnimState(id, 'Run');
      expect(api.getCurrentAnimState(id)).toBe('Run');
    });
  });

  // ── listAnimStates / listAnimClips ──────────────────────────
  describe('listAnimStates / listAnimClips', () => {
    it('lists all state names', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      api.registerAnimClip(id, 'idle', makeClip('idle'));
      api.registerAnimClip(id, 'walk', makeClip('walk'));
      api.registerAnimClip(id, 'run', makeClip('run'));
      api.addAnimState(id, 'Idle', 'idle', 'repeat');
      api.addAnimState(id, 'Walk', 'walk', 'repeat');
      api.addAnimState(id, 'Run', 'run', 'repeat');
      const states = api.listAnimStates(id);
      expect(states).toHaveLength(3);
      expect(states).toContain('Idle');
      expect(states).toContain('Walk');
      expect(states).toContain('Run');
    });

    it('lists all clip names', () => {
      const { id } = makeSkinnedEntity();
      api.initAnimStateMachine(id);
      api.registerAnimClip(id, 'idle', makeClip('idle'));
      api.registerAnimClip(id, 'walk', makeClip('walk'));
      const clips = api.listAnimClips(id);
      expect(clips).toHaveLength(2);
      expect(clips).toContain('idle');
      expect(clips).toContain('walk');
    });

    it('returns empty array for entity without SM', () => {
      const id = world.createEntity('NoSkin');
      expect(api.listAnimStates(id)).toEqual([]);
      expect(api.listAnimClips(id)).toEqual([]);
    });
  });

  // ── 完整状态机搭建 ──────────────────────────────────────────
  describe('full state machine setup', () => {
    it('builds Idle→Walk→Run state machine and enters states', () => {
      const { id } = makeSkinnedEntity();
      // 初始化 SM
      expect(api.initAnimStateMachine(id)).toBe(true);
      // 注册 clips
      api.registerAnimClip(id, 'idle', makeClip('idle'));
      api.registerAnimClip(id, 'walk', makeClip('walk'));
      api.registerAnimClip(id, 'run', makeClip('run'));
      // 添加状态
      api.addAnimState(id, 'Idle', 'idle', 'repeat', 1);
      api.addAnimState(id, 'Walk', 'walk', 'repeat', 1);
      api.addAnimState(id, 'Run', 'run', 'repeat', 1);
      // 添加过渡
      api.addAnimTransition(id, 'Idle', 'Walk', 0.2);
      api.addAnimTransition(id, 'Walk', 'Run', 0.3);
      api.addAnimTransition(id, 'Run', 'Walk', 0.3);
      api.addAnimTransition(id, 'Walk', 'Idle', 0.2);
      // 进入 Idle
      expect(api.enterAnimState(id, 'Idle')).toBe(true);
      expect(api.getCurrentAnimState(id)).toBe('Idle');
      // 切到 Walk
      expect(api.enterAnimState(id, 'Walk')).toBe(true);
      expect(api.getCurrentAnimState(id)).toBe('Walk');
      // 验证状态列表
      expect(api.listAnimStates(id)).toHaveLength(3);
      expect(api.listAnimClips(id)).toHaveLength(3);
    });
  });
});
