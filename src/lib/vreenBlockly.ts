/**
 * VREEN Blockly — block definitions, JavaScript generators, and runtime API.
 *
 * Architecture:
 *   Block Definitions (JSON) → JS Generators (code output) → VREEN API (runtime)
 *
 * The generated JavaScript calls `VREEN.xxx()` methods which are defined
 * here and exposed globally when BlocklyPanel mounts.
 */

import * as Blockly from 'blockly/core';
import { javascriptGenerator, Order, type JavascriptGenerator } from 'blockly/javascript';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorldStore } from '@/stores/worldStore';
import type { CameraPreset } from '@/types';
import { EcsScriptAPI, type TickCallback } from '@/lib/ecsScriptApi';

/* ──────────── Block Definitions ──────────── */

// Blockly 的 createBlockDefinitionsFromJsonArray 自身签名即 (json: any[]),
// 此处 any[] 与库 API 保持一致,属库边界 any,非逃生口。
const blocksJson: any[] = [
  // ── Camera ──
  {
    type: 'vreen_camera_preset',
    message0: 'set camera preset %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'PRESET',
        options: [
          ['iso', 'iso'],
          ['front', 'front'],
          ['back', 'back'],
          ['side', 'side'],
          ['top', 'top'],
          ['free', 'free'],
          ['first-person', 'first-person'],
          ['third-person', 'third-person'],
          ['cinematic', 'cinematic'],
        ],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 230,
    tooltip: 'Switch camera to a preset viewpoint',
  },
  {
    type: 'vreen_camera_position',
    message0: 'set camera position x: %1 y: %2 z: %3',
    args0: [
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
      { type: 'input_value', name: 'Z', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 230,
    tooltip: 'Set camera distance, target height, and yaw',
  },
  {
    type: 'vreen_camera_log',
    message0: 'log camera state',
    previousStatement: null,
    nextStatement: null,
    colour: 230,
    tooltip: 'Print current camera state to console',
  },

  // ── Animation ──
  {
    type: 'vreen_anim_play',
    message0: 'play animation',
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Start animation playback',
  },
  {
    type: 'vreen_anim_pause',
    message0: 'pause animation',
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Pause animation playback',
  },
  {
    type: 'vreen_anim_speed',
    message0: 'set animation speed %1',
    args0: [
      { type: 'input_value', name: 'SPEED', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Set animation playback speed (0.25 – 2.0)',
  },
  {
    type: 'vreen_anim_goto',
    message0: 'go to animation time %1 s',
    args0: [
      { type: 'input_value', name: 'TIME', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 120,
    tooltip: 'Jump to a specific time in the animation',
  },

  // ── Scene ──
  {
    type: 'vreen_scene_wireframe',
    message0: 'toggle wireframe',
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Toggle wireframe overlay',
  },
  {
    type: 'vreen_scene_ground',
    message0: 'toggle ground plane',
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Show/hide the ground plane',
  },
  {
    type: 'vreen_scene_autorotate',
    message0: 'toggle auto-rotate',
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Enable/disable auto-rotation',
  },
  {
    type: 'vreen_scene_bgcolor',
    message0: 'set background color %1',
    args0: [
      { type: 'field_colour', name: 'COLOR', colour: '#000000' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 60,
    tooltip: 'Set scene background color',
  },

  // ── Renderer ──
  {
    type: 'vreen_renderer_switch',
    message0: 'toggle custom renderer',
    previousStatement: null,
    nextStatement: null,
    colour: 290,
    tooltip: 'Switch between custom WebGL2 and three.js renderer',
  },
  {
    type: 'vreen_renderer_profiler',
    message0: 'toggle profiler HUD',
    previousStatement: null,
    nextStatement: null,
    colour: 290,
    tooltip: 'Show/hide the performance profiler overlay',
  },

  // ── Physics ──
  {
    type: 'vreen_physics_demo',
    message0: 'toggle physics demo',
    previousStatement: null,
    nextStatement: null,
    colour: 330,
    tooltip: 'Start/stop the ECS physics demo',
  },
  {
    type: 'vreen_physics_debug',
    message0: 'toggle physics debug',
    previousStatement: null,
    nextStatement: null,
    colour: 330,
    tooltip: 'Show/hide physics debug visualization',
  },

  // ── Control ──
  {
    type: 'vreen_log',
    message0: 'log %1',
    args0: [
      { type: 'input_value', name: 'TEXT', check: 'String' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip: 'Print a message to the VREEN log',
  },
  {
    type: 'vreen_wait',
    message0: 'wait %1 ms',
    args0: [
      { type: 'input_value', name: 'MS', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 20,
    tooltip: 'Pause execution for N milliseconds',
  },

  // ── ECS (Phase 3.1) ──
  {
    type: 'vreen_ecs_create_entity',
    message0: 'create entity named %1',
    args0: [
      { type: 'input_value', name: 'NAME', check: 'String' },
    ],
    output: 'Number',
    colour: 0,
    tooltip: 'Create a new ECS entity and return its id',
  },
  {
    type: 'vreen_ecs_destroy_entity',
    message0: 'destroy entity %1',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Destroy an ECS entity by id',
  },
  {
    type: 'vreen_ecs_get_name',
    message0: 'name of entity %1',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'String',
    colour: 0,
    tooltip: 'Get the name of an entity',
  },
  {
    type: 'vreen_ecs_entity_count',
    message0: 'entity count',
    output: 'Number',
    colour: 0,
    tooltip: 'Get the number of alive entities',
  },
  {
    type: 'vreen_ecs_set_position',
    message0: 'set entity %1 position x: %2 y: %3 z: %4',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
      { type: 'input_value', name: 'Z', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Set entity world position',
  },
  {
    type: 'vreen_ecs_get_position',
    message0: 'entity %1 position %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      {
        type: 'field_dropdown',
        name: 'AXIS',
        options: [['x', '0'], ['y', '1'], ['z', '2']],
      },
    ],
    output: 'Number',
    colour: 0,
    tooltip: 'Get entity position component (x/y/z)',
  },
  {
    type: 'vreen_ecs_set_health',
    message0: 'set entity %1 health hp: %2 max: %3',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'HP', check: 'Number' },
      { type: 'input_value', name: 'MAX', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Set entity health values',
  },
  {
    type: 'vreen_ecs_get_health',
    message0: 'entity %1 %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      {
        type: 'field_dropdown',
        name: 'FIELD',
        options: [['hp', 'hp'], ['maxHp', 'maxHp']],
      },
    ],
    output: 'Number',
    colour: 0,
    tooltip: 'Get entity hp or maxHp',
  },
  {
    type: 'vreen_ecs_damage',
    message0: 'damage entity %1 by %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'AMOUNT', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Reduce entity hp by amount',
  },
  {
    type: 'vreen_ecs_set_tag',
    message0: 'set entity %1 tag to %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'TAG', check: 'String' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Set entity Tag value',
  },
  {
    type: 'vreen_ecs_set_velocity',
    message0: 'set entity %1 velocity x: %2 y: %3 z: %4',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'X', check: 'Number' },
      { type: 'input_value', name: 'Y', check: 'Number' },
      { type: 'input_value', name: 'Z', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Set entity linear velocity',
  },
  {
    type: 'vreen_ecs_query',
    message0: 'query entities with %1',
    args0: [
      {
        type: 'field_dropdown',
        name: 'COMP',
        options: [
          ['Transform', 'Transform'],
          ['Velocity', 'Velocity'],
          ['Health', 'Health'],
          ['Tag', 'Tag'],
          ['Lifetime', 'Lifetime'],
          ['PlayerInput', 'PlayerInput'],
        ],
      },
    ],
    output: 'Array',
    colour: 0,
    tooltip: 'Get all entity ids that have the specified component',
  },
  {
    type: 'vreen_ecs_query_by_tag',
    message0: 'query entities tagged %1',
    args0: [
      { type: 'input_value', name: 'TAG', check: 'String' },
    ],
    output: 'Array',
    colour: 0,
    tooltip: 'Get all entity ids with the given Tag value',
  },
  {
    type: 'vreen_ecs_set_component',
    message0: 'set component %1 on entity %2 data %3',
    args0: [
      {
        type: 'field_dropdown',
        name: 'COMP',
        options: [
          ['Transform', 'Transform'],
          ['Velocity', 'Velocity'],
          ['Health', 'Health'],
          ['Tag', 'Tag'],
          ['Lifetime', 'Lifetime'],
          ['PlayerInput', 'PlayerInput'],
        ],
      },
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'DATA', check: 'String' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Set a component from JSON data string',
  },
  {
    type: 'vreen_ecs_get_component',
    message0: 'get component %1 from entity %2',
    args0: [
      {
        type: 'field_dropdown',
        name: 'COMP',
        options: [
          ['Transform', 'Transform'],
          ['Velocity', 'Velocity'],
          ['Health', 'Health'],
          ['Tag', 'Tag'],
          ['Lifetime', 'Lifetime'],
          ['PlayerInput', 'PlayerInput'],
        ],
      },
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'String',
    colour: 0,
    tooltip: 'Get a component as JSON string',
  },
  // ── Tick event (Phase 3.2) ──
  {
    type: 'vreen_ecs_on_tick',
    message0: 'on tick %1 do %2',
    args0: [
      { type: 'input_dummy' },
      { type: 'input_statement', name: 'DO' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 0,
    tooltip: 'Run blocks every frame (dt seconds since last frame)',
  },
  {
    type: 'vreen_ecs_tick_dt',
    message0: 'tick delta time',
    output: 'Number',
    colour: 0,
    tooltip: 'Seconds since last tick (use inside on tick block)',
  },

  // ── Material (Phase 3.3) ──
  {
    type: 'vreen_mat_set_color',
    message0: 'set entity %1 color r: %2 g: %3 b: %4',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'R', check: 'Number' },
      { type: 'input_value', name: 'G', check: 'Number' },
      { type: 'input_value', name: 'B', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set entity material base color (rgb 0..1)',
  },
  {
    type: 'vreen_mat_set_color_hex',
    message0: 'set entity %1 color %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'field_colour', name: 'COLOR', colour: '#cccccc' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set entity material base color from color picker',
  },
  {
    type: 'vreen_mat_set_metallic',
    message0: 'set entity %1 metallic %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set entity material metallic (0..1)',
  },
  {
    type: 'vreen_mat_set_roughness',
    message0: 'set entity %1 roughness %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set entity material roughness (0..1)',
  },
  {
    type: 'vreen_mat_set_emissive',
    message0: 'set entity %1 emissive r: %2 g: %3 b: %4 intensity: %5',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'R', check: 'Number' },
      { type: 'input_value', name: 'G', check: 'Number' },
      { type: 'input_value', name: 'B', check: 'Number' },
      { type: 'input_value', name: 'INTENSITY', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set entity material emissive color + intensity',
  },
  {
    type: 'vreen_mat_set_opacity',
    message0: 'set entity %1 opacity %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'VALUE', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Set entity material opacity (0..1)',
  },
  {
    type: 'vreen_mat_toggle_wireframe',
    message0: 'set entity %1 wireframe %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      {
        type: 'field_dropdown',
        name: 'ON',
        options: [['on', 'true'], ['off', 'false']],
      },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Toggle entity material wireframe mode',
  },
  {
    type: 'vreen_mat_get_metallic',
    message0: 'entity %1 metallic',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'Number',
    colour: 200,
    tooltip: 'Get entity material metallic value',
  },
  {
    type: 'vreen_mat_get_roughness',
    message0: 'entity %1 roughness',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'Number',
    colour: 200,
    tooltip: 'Get entity material roughness value',
  },
  {
    type: 'vreen_mat_get_opacity',
    message0: 'entity %1 opacity',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'Number',
    colour: 200,
    tooltip: 'Get entity material opacity value',
  },
  {
    type: 'vreen_mat_assign_new',
    message0: 'assign new material to entity %1',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 200,
    tooltip: 'Replace entity material with a fresh StandardMaterial',
  },

  // ── Animation State Machine (Phase 3.4) ──
  {
    type: 'vreen_anim_sm_init',
    message0: 'init animation state machine on entity %1',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Create an AnimationStateMachine on the entity (requires SkinnedMeshRef)',
  },
  {
    type: 'vreen_anim_sm_add_state',
    message0: 'add state %1 clip %2 loop %3 speed %4 to entity %5',
    args0: [
      { type: 'input_value', name: 'STATE', check: 'String' },
      { type: 'input_value', name: 'CLIP', check: 'String' },
      {
        type: 'field_dropdown',
        name: 'LOOP',
        options: [['once', 'once'], ['repeat', 'repeat'], ['pingpong', 'pingpong']],
      },
      { type: 'input_value', name: 'SPEED', check: 'Number' },
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Add an animation state to the entity\'s state machine',
  },
  {
    type: 'vreen_anim_sm_add_transition',
    message0: 'add transition from %1 to %2 duration %3 on entity %4',
    args0: [
      { type: 'input_value', name: 'FROM', check: 'String' },
      { type: 'input_value', name: 'TO', check: 'String' },
      { type: 'input_value', name: 'DURATION', check: 'Number' },
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Add a transition between two states (duration 0 = instant)',
  },
  {
    type: 'vreen_anim_sm_enter',
    message0: 'entity %1 enter state %2',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
      { type: 'input_value', name: 'STATE', check: 'String' },
    ],
    previousStatement: null,
    nextStatement: null,
    colour: 160,
    tooltip: 'Switch entity to the named animation state',
  },
  {
    type: 'vreen_anim_sm_current',
    message0: 'entity %1 current state',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'String',
    colour: 160,
    tooltip: 'Get the name of the entity\'s current animation state',
  },
  {
    type: 'vreen_anim_sm_list_states',
    message0: 'entity %1 state list',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'Array',
    colour: 160,
    tooltip: 'List all animation state names on the entity',
  },
  {
    type: 'vreen_anim_sm_list_clips',
    message0: 'entity %1 clip list',
    args0: [
      { type: 'input_value', name: 'ID', check: 'Number' },
    ],
    output: 'Array',
    colour: 160,
    tooltip: 'List all registered animation clip names on the entity',
  },
];

/* ──────────── Register Blocks ──────────── */

export function defineVreenBlocks() {
  // Skip if already defined (HMR-safe)
  if (Blockly.Blocks['vreen_log']) return;
  Blockly.common.defineBlocks(Blockly.common.createBlockDefinitionsFromJsonArray(blocksJson));
}

/* ──────────── Toolbox ──────────── */

export const VREEN_TOOLBOX: Blockly.utils.toolbox.ToolboxDefinition = {
  kind: 'categoryToolbox',
  contents: [
    {
      kind: 'category',
      name: 'Camera',
      colour: '230',
      contents: [
        { kind: 'block', type: 'vreen_camera_preset' },
        { kind: 'block', type: 'vreen_camera_position' },
        { kind: 'block', type: 'vreen_camera_log' },
      ],
    },
    {
      kind: 'category',
      name: 'Animation',
      colour: '120',
      contents: [
        { kind: 'block', type: 'vreen_anim_play' },
        { kind: 'block', type: 'vreen_anim_pause' },
        { kind: 'block', type: 'vreen_anim_speed' },
        { kind: 'block', type: 'vreen_anim_goto' },
      ],
    },
    {
      kind: 'category',
      name: 'Scene',
      colour: '60',
      contents: [
        { kind: 'block', type: 'vreen_scene_wireframe' },
        { kind: 'block', type: 'vreen_scene_ground' },
        { kind: 'block', type: 'vreen_scene_autorotate' },
        { kind: 'block', type: 'vreen_scene_bgcolor' },
      ],
    },
    {
      kind: 'category',
      name: 'Renderer',
      colour: '290',
      contents: [
        { kind: 'block', type: 'vreen_renderer_switch' },
        { kind: 'block', type: 'vreen_renderer_profiler' },
      ],
    },
    {
      kind: 'category',
      name: 'Physics',
      colour: '330',
      contents: [
        { kind: 'block', type: 'vreen_physics_demo' },
        { kind: 'block', type: 'vreen_physics_debug' },
      ],
    },
    {
      kind: 'category',
      name: 'Control',
      colour: '20',
      contents: [
        { kind: 'block', type: 'vreen_log' },
        { kind: 'block', type: 'vreen_wait' },
      ],
    },
    {
      kind: 'category',
      name: 'ECS',
      colour: '0',
      contents: [
        { kind: 'block', type: 'vreen_ecs_create_entity' },
        { kind: 'block', type: 'vreen_ecs_destroy_entity' },
        { kind: 'block', type: 'vreen_ecs_get_name' },
        { kind: 'block', type: 'vreen_ecs_entity_count' },
        { kind: 'block', type: 'vreen_ecs_set_position' },
        { kind: 'block', type: 'vreen_ecs_get_position' },
        { kind: 'block', type: 'vreen_ecs_set_health' },
        { kind: 'block', type: 'vreen_ecs_get_health' },
        { kind: 'block', type: 'vreen_ecs_damage' },
        { kind: 'block', type: 'vreen_ecs_set_tag' },
        { kind: 'block', type: 'vreen_ecs_set_velocity' },
        { kind: 'block', type: 'vreen_ecs_query' },
        { kind: 'block', type: 'vreen_ecs_query_by_tag' },
        { kind: 'block', type: 'vreen_ecs_set_component' },
        { kind: 'block', type: 'vreen_ecs_get_component' },
        { kind: 'block', type: 'vreen_ecs_on_tick' },
        { kind: 'block', type: 'vreen_ecs_tick_dt' },
      ],
    },
    {
      kind: 'category',
      name: 'Material',
      colour: '200',
      contents: [
        { kind: 'block', type: 'vreen_mat_set_color' },
        { kind: 'block', type: 'vreen_mat_set_color_hex' },
        { kind: 'block', type: 'vreen_mat_set_metallic' },
        { kind: 'block', type: 'vreen_mat_set_roughness' },
        { kind: 'block', type: 'vreen_mat_set_emissive' },
        { kind: 'block', type: 'vreen_mat_set_opacity' },
        { kind: 'block', type: 'vreen_mat_toggle_wireframe' },
        { kind: 'block', type: 'vreen_mat_get_metallic' },
        { kind: 'block', type: 'vreen_mat_get_roughness' },
        { kind: 'block', type: 'vreen_mat_get_opacity' },
        { kind: 'block', type: 'vreen_mat_assign_new' },
      ],
    },
    {
      kind: 'category',
      name: 'AnimSM',
      colour: '160',
      contents: [
        { kind: 'block', type: 'vreen_anim_sm_init' },
        { kind: 'block', type: 'vreen_anim_sm_add_state' },
        { kind: 'block', type: 'vreen_anim_sm_add_transition' },
        { kind: 'block', type: 'vreen_anim_sm_enter' },
        { kind: 'block', type: 'vreen_anim_sm_current' },
        { kind: 'block', type: 'vreen_anim_sm_list_states' },
        { kind: 'block', type: 'vreen_anim_sm_list_clips' },
      ],
    },
  ],
};

/* ──────────── JavaScript Generators ──────────── */

javascriptGenerator.forBlock['vreen_camera_preset'] = (block: Blockly.Block) => {
  const preset = block.getFieldValue('PRESET');
  return `VREEN.setCameraPreset('${preset}');\n`;
};

javascriptGenerator.forBlock['vreen_camera_position'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const x = generator.valueToCode(block, 'X', Order.ATOMIC) || '0';
  const y = generator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
  const z = generator.valueToCode(block, 'Z', Order.ATOMIC) || '0';
  return `VREEN.setCameraPosition(${x}, ${y}, ${z});\n`;
};

javascriptGenerator.forBlock['vreen_camera_log'] = () => `VREEN.logCamera();\n`;

javascriptGenerator.forBlock['vreen_anim_play'] = () => `VREEN.playAnimation();\n`;

javascriptGenerator.forBlock['vreen_anim_pause'] = () => `VREEN.pauseAnimation();\n`;

javascriptGenerator.forBlock['vreen_anim_speed'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const speed = generator.valueToCode(block, 'SPEED', Order.ATOMIC) || '1';
  return `VREEN.setAnimSpeed(${speed});\n`;
};

javascriptGenerator.forBlock['vreen_anim_goto'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const time = generator.valueToCode(block, 'TIME', Order.ATOMIC) || '0';
  return `VREEN.setAnimTime(${time});\n`;
};

javascriptGenerator.forBlock['vreen_scene_wireframe'] = () => `VREEN.toggleWireframe();\n`;

javascriptGenerator.forBlock['vreen_scene_ground'] = () => `VREEN.toggleGround();\n`;

javascriptGenerator.forBlock['vreen_scene_autorotate'] = () => `VREEN.toggleAutoRotate();\n`;

javascriptGenerator.forBlock['vreen_scene_bgcolor'] = (block: Blockly.Block) => {
  const color = block.getFieldValue('COLOR');
  return `VREEN.setBgColor('${color}');\n`;
};

javascriptGenerator.forBlock['vreen_renderer_switch'] = () => `VREEN.toggleRenderer();\n`;

javascriptGenerator.forBlock['vreen_renderer_profiler'] = () => `VREEN.toggleProfiler();\n`;

javascriptGenerator.forBlock['vreen_physics_demo'] = () => `VREEN.togglePhysicsDemo();\n`;

javascriptGenerator.forBlock['vreen_physics_debug'] = () => `VREEN.togglePhysicsDebug();\n`;

javascriptGenerator.forBlock['vreen_log'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const text = generator.valueToCode(block, 'TEXT', Order.ATOMIC) || "''";
  return `VREEN.log(${text});\n`;
};

javascriptGenerator.forBlock['vreen_wait'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const ms = generator.valueToCode(block, 'MS', Order.ATOMIC) || '0';
  return `await VREEN.wait(${ms});\n`;
};

// ── ECS (Phase 3.1) ──
javascriptGenerator.forBlock['vreen_ecs_create_entity'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const name = generator.valueToCode(block, 'NAME', Order.ATOMIC) || "''";
  return [`VREEN.ecsCreateEntity(${name})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_ecs_destroy_entity'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return `VREEN.ecsDestroyEntity(${id});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_get_name'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.ecsGetName(${id})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_ecs_entity_count'] = () => [`VREEN.ecsEntityCount()`, Order.FUNCTION_CALL];

javascriptGenerator.forBlock['vreen_ecs_set_position'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const x = generator.valueToCode(block, 'X', Order.ATOMIC) || '0';
  const y = generator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
  const z = generator.valueToCode(block, 'Z', Order.ATOMIC) || '0';
  return `VREEN.ecsSetPosition(${id}, ${x}, ${y}, ${z});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_get_position'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const axis = block.getFieldValue('AXIS');
  return [`VREEN.ecsGetPosition(${id}, ${axis})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_ecs_set_health'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const hp = generator.valueToCode(block, 'HP', Order.ATOMIC) || '0';
  const max = generator.valueToCode(block, 'MAX', Order.ATOMIC) || '0';
  return `VREEN.ecsSetHealth(${id}, ${hp}, ${max});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_get_health'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const field = block.getFieldValue('FIELD');
  return [`VREEN.ecsGetHealth(${id}, '${field}')`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_ecs_damage'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const amount = generator.valueToCode(block, 'AMOUNT', Order.ATOMIC) || '0';
  return `VREEN.ecsDamage(${id}, ${amount});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_set_tag'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const tag = generator.valueToCode(block, 'TAG', Order.ATOMIC) || "''";
  return `VREEN.ecsSetTag(${id}, ${tag});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_set_velocity'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const x = generator.valueToCode(block, 'X', Order.ATOMIC) || '0';
  const y = generator.valueToCode(block, 'Y', Order.ATOMIC) || '0';
  const z = generator.valueToCode(block, 'Z', Order.ATOMIC) || '0';
  return `VREEN.ecsSetVelocity(${id}, ${x}, ${y}, ${z});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_query'] = (block: Blockly.Block) => {
  const comp = block.getFieldValue('COMP');
  return [`VREEN.ecsQuery('${comp}')`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_ecs_query_by_tag'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const tag = generator.valueToCode(block, 'TAG', Order.ATOMIC) || "''";
  return [`VREEN.ecsQueryByTag(${tag})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_ecs_set_component'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const comp = block.getFieldValue('COMP');
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const data = generator.valueToCode(block, 'DATA', Order.ATOMIC) || "''";
  return `VREEN.ecsSetComponent('${comp}', ${id}, ${data});\n`;
};

javascriptGenerator.forBlock['vreen_ecs_get_component'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const comp = block.getFieldValue('COMP');
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.ecsGetComponent('${comp}', ${id})`, Order.FUNCTION_CALL];
};

// ── Tick event (Phase 3.2) ──
javascriptGenerator.forBlock['vreen_ecs_on_tick'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const doCode = generator.statementToCode(block, 'DO') || '';
  // 注册一个 tick 回调,内部用 IIFE 闭包执行 DO 块
  const branch = doCode.replace(/\n$/, '');
  const code =
    `VREEN.ecsOnTick((dt) => {\n` +
    `  VREEN.__tickDt = dt;\n` +
    `${branch}\n` +
    `});\n`;
  return code;
};

javascriptGenerator.forBlock['vreen_ecs_tick_dt'] = () => [`VREEN.ecsTickDt()`, Order.FUNCTION_CALL];

// ── Material (Phase 3.3) ──
javascriptGenerator.forBlock['vreen_mat_set_color'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const r = generator.valueToCode(block, 'R', Order.ATOMIC) || '0';
  const g = generator.valueToCode(block, 'G', Order.ATOMIC) || '0';
  const b = generator.valueToCode(block, 'B', Order.ATOMIC) || '0';
  return `VREEN.matSetColor(${id}, ${r}, ${g}, ${b});\n`;
};

javascriptGenerator.forBlock['vreen_mat_set_color_hex'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const color = block.getFieldValue('COLOR');
  return `VREEN.matSetColorHex(${id}, '${color}');\n`;
};

javascriptGenerator.forBlock['vreen_mat_set_metallic'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const v = generator.valueToCode(block, 'VALUE', Order.ATOMIC) || '0';
  return `VREEN.matSetMetallic(${id}, ${v});\n`;
};

javascriptGenerator.forBlock['vreen_mat_set_roughness'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const v = generator.valueToCode(block, 'VALUE', Order.ATOMIC) || '0';
  return `VREEN.matSetRoughness(${id}, ${v});\n`;
};

javascriptGenerator.forBlock['vreen_mat_set_emissive'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const r = generator.valueToCode(block, 'R', Order.ATOMIC) || '0';
  const g = generator.valueToCode(block, 'G', Order.ATOMIC) || '0';
  const b = generator.valueToCode(block, 'B', Order.ATOMIC) || '0';
  const i = generator.valueToCode(block, 'INTENSITY', Order.ATOMIC) || '1';
  return `VREEN.matSetEmissive(${id}, ${r}, ${g}, ${b}, ${i});\n`;
};

javascriptGenerator.forBlock['vreen_mat_set_opacity'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const v = generator.valueToCode(block, 'VALUE', Order.ATOMIC) || '1';
  return `VREEN.matSetOpacity(${id}, ${v});\n`;
};

javascriptGenerator.forBlock['vreen_mat_toggle_wireframe'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const on = block.getFieldValue('ON') === 'true';
  return `VREEN.matSetWireframe(${id}, ${on});\n`;
};

javascriptGenerator.forBlock['vreen_mat_get_metallic'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.matGetMetallic(${id})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_mat_get_roughness'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.matGetRoughness(${id})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_mat_get_opacity'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.matGetOpacity(${id})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_mat_assign_new'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return `VREEN.matAssignNew(${id});\n`;
};

// ── Animation State Machine (Phase 3.4) ──
javascriptGenerator.forBlock['vreen_anim_sm_init'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return `VREEN.animSmInit(${id});\n`;
};

javascriptGenerator.forBlock['vreen_anim_sm_add_state'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const state = generator.valueToCode(block, 'STATE', Order.ATOMIC) || "''";
  const clip = generator.valueToCode(block, 'CLIP', Order.ATOMIC) || "''";
  const loop = block.getFieldValue('LOOP');
  const speed = generator.valueToCode(block, 'SPEED', Order.ATOMIC) || '1';
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return `VREEN.animSmAddState(${id}, ${state}, ${clip}, '${loop}', ${speed});\n`;
};

javascriptGenerator.forBlock['vreen_anim_sm_add_transition'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const from = generator.valueToCode(block, 'FROM', Order.ATOMIC) || "''";
  const to = generator.valueToCode(block, 'TO', Order.ATOMIC) || "''";
  const dur = generator.valueToCode(block, 'DURATION', Order.ATOMIC) || '0';
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return `VREEN.animSmAddTransition(${id}, ${from}, ${to}, ${dur});\n`;
};

javascriptGenerator.forBlock['vreen_anim_sm_enter'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  const state = generator.valueToCode(block, 'STATE', Order.ATOMIC) || "''";
  return `VREEN.animSmEnter(${id}, ${state});\n`;
};

javascriptGenerator.forBlock['vreen_anim_sm_current'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.animSmCurrent(${id})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_anim_sm_list_states'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.animSmListStates(${id})`, Order.FUNCTION_CALL];
};

javascriptGenerator.forBlock['vreen_anim_sm_list_clips'] = (block: Blockly.Block, generator: JavascriptGenerator) => {
  const id = generator.valueToCode(block, 'ID', Order.ATOMIC) || '0';
  return [`VREEN.animSmListClips(${id})`, Order.FUNCTION_CALL];
};

/* ──────────── VREEN Runtime API ──────────── */

export interface VREENAPI {
  // Camera
  setCameraPreset(preset: string): void;
  setCameraPosition(x: number, y: number, z: number): void;
  logCamera(): void;
  // Animation
  playAnimation(): void;
  pauseAnimation(): void;
  setAnimSpeed(speed: number): void;
  setAnimTime(time: number): void;
  // Scene
  toggleWireframe(): void;
  toggleGround(): void;
  toggleAutoRotate(): void;
  setBgColor(color: string): void;
  // Renderer
  toggleRenderer(): void;
  toggleProfiler(): void;
  // Physics
  togglePhysicsDemo(): void;
  togglePhysicsDebug(): void;
  // Control
  log(text: string): void;
  wait(ms: number): Promise<void>;
  // ECS (Phase 3.1)
  ecsCreateEntity(name?: string): number;
  ecsDestroyEntity(id: number): boolean;
  ecsGetName(id: number): string;
  ecsEntityCount(): number;
  ecsSetPosition(id: number, x: number, y: number, z: number): boolean;
  ecsGetPosition(id: number, axis: 0 | 1 | 2): number;
  ecsSetHealth(id: number, hp: number, maxHp: number): boolean;
  ecsGetHealth(id: number, field: 'hp' | 'maxHp'): number;
  ecsDamage(id: number, amount: number): boolean;
  ecsSetTag(id: number, tag: string): boolean;
  ecsSetVelocity(id: number, x: number, y: number, z: number): boolean;
  ecsQuery(compName: string): number[];
  ecsQueryByTag(tag: string): number[];
  ecsSetComponent(compName: string, id: number, dataJson: string): boolean;
  ecsGetComponent(compName: string, id: number): string;
  // Tick (Phase 3.2)
  ecsOnTick(cb: TickCallback): void;
  ecsTickDt(): number;
  /** Internal: clear all tick callbacks (called when script re-runs). */
  __clearTickCallbacks(): void;
  // Material (Phase 3.3)
  matSetColor(id: number, r: number, g: number, b: number): boolean;
  matSetColorHex(id: number, hex: string): boolean;
  matSetMetallic(id: number, value: number): boolean;
  matSetRoughness(id: number, value: number): boolean;
  matSetEmissive(id: number, r: number, g: number, b: number, intensity: number): boolean;
  matSetOpacity(id: number, value: number): boolean;
  matSetWireframe(id: number, on: boolean): boolean;
  matGetMetallic(id: number): number;
  matGetRoughness(id: number): number;
  matGetOpacity(id: number): number;
  matAssignNew(id: number): boolean;
  // Animation State Machine (Phase 3.4)
  animSmInit(id: number): boolean;
  animSmAddState(id: number, stateName: string, clipName: string, loop: 'once' | 'repeat' | 'pingpong', speed: number): boolean;
  animSmAddTransition(id: number, from: string, to: string, duration: number): boolean;
  animSmEnter(id: number, stateName: string): boolean;
  animSmCurrent(id: number): string;
  animSmListStates(id: number): string[];
  animSmListClips(id: number): string[];
}

let _pushLog: ((level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string) => void) | null = null;

/** Set the log callback so VREEN API can push to the UI log. */
export function setLogCallback(cb: (level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string) => void) {
  _pushLog = cb;
}

function push(level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string) {
  _pushLog?.(level, text);
}

/** Valid camera preset strings (mirrors CameraPreset union, for runtime validation
 *  of strings coming from Blockly block fields). */
const VALID_CAMERA_PRESETS: ReadonlySet<CameraPreset> = new Set<CameraPreset>([
  'iso', 'front', 'back', 'side', 'top', 'free', 'first-person', 'third-person', 'cinematic',
]);

// Internal: module-level cache of the current EcsScriptAPI instance.
// Shared between createVREENAPI() (for VREEN.ecsXxx calls) and
// driveVreenTick() (for per-frame tick driving). Invalidated when the
// bound World changes (e.g. new asset loaded → resetWorld).
let _ecsApiCache: EcsScriptAPI | null = null;

/** Create the VREEN runtime API object. */
export function createVREENAPI(): VREENAPI {
  // Tick dt 缓存,供 tick_dt 积木读取
  let tickDt = 0;
  // tick 回调 unsubscribe 列表,脚本重跑时清理
  let tickUnsubs: (() => void)[] = [];

  function getEcs(): EcsScriptAPI | null {
    const world = useWorldStore.getState().world;
    if (!world) {
      push('WARN', 'ECS World not initialized');
      return null;
    }
    if (_ecsApiCache?.getWorld() !== world) {
      _ecsApiCache = new EcsScriptAPI(world);
    }
    return _ecsApiCache;
  }

  const api: VREENAPI = {
    // ── Camera ──
    setCameraPreset(preset: string) {
      if (!VALID_CAMERA_PRESETS.has(preset as CameraPreset)) {
        push('WARN', `Unknown camera preset: ${preset}`);
        return;
      }
      useViewerStore.getState().setCameraPreset(preset as CameraPreset);
      push('INFO', `Camera → ${preset}`);
    },
    setCameraPosition(x: number, y: number, z: number) {
      useViewerStore.getState().setCamera({ distance: Math.max(0.4, x), targetHeight: y, yaw: z });
      push('OK', `Camera position: dist=${x}, height=${y}, yaw=${z}`);
    },
    logCamera() {
      const cam = useViewerStore.getState().camera;
      push('INFO', `Camera: preset=${cam.preset} fov=${cam.fov} dist=${cam.distance}`);
    },

    // ── Animation ──
    playAnimation() {
      useViewerStore.getState().setAnimation({ isPlaying: true });
      push('OK', 'Animation ▶ play');
    },
    pauseAnimation() {
      useViewerStore.getState().setAnimation({ isPlaying: false });
      push('OK', 'Animation ⏸ pause');
    },
    setAnimSpeed(speed: number) {
      useViewerStore.getState().setAnimation({ speed: Math.max(0.1, Math.min(10, speed)) });
      push('INFO', `Animation speed → ${speed}x`);
    },
    setAnimTime(time: number) {
      useViewerStore.getState().setAnimation({ currentTime: Math.max(0, time) });
      push('INFO', `Animation time → ${time}s`);
    },

    // ── Scene ──
    toggleWireframe() {
      useViewerStore.getState().toggleWireframe();
      push('INFO', 'Wireframe toggled');
    },
    toggleGround() {
      useViewerStore.getState().toggleGround();
      push('INFO', 'Ground plane toggled');
    },
    toggleAutoRotate() {
      useViewerStore.getState().toggleAutoRotate();
      push('INFO', 'Auto-rotate toggled');
    },
    setBgColor(color: string) {
      useUIStore.getState().setEnvironment({ backgroundColor: color, background: 'solid' });
      push('OK', `Background → ${color}`);
    },

    // ── Renderer ──
    toggleRenderer() {
      useViewerStore.getState().toggleCustomRenderer();
      push('INFO', 'Renderer switched');
    },
    toggleProfiler() {
      useViewerStore.getState().toggleProfiler();
      push('INFO', 'Profiler toggled');
    },

    // ── Physics ──
    togglePhysicsDemo() {
      useViewerStore.getState().togglePhysicsDemo();
      push('INFO', 'Physics demo toggled');
    },
    togglePhysicsDebug() {
      useViewerStore.getState().togglePhysicsDebug();
      push('INFO', 'Physics debug toggled');
    },

    // ── Control ──
    log(text: string) {
      push('INFO', `[Script] ${text}`);
    },
    wait(ms: number) {
      return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
    },

    // ── ECS (Phase 3.1) ──
    ecsCreateEntity(name?: string) {
      const ecs = getEcs();
      if (!ecs) return 0;
      const id = ecs.createEntity(name);
      push('OK', `Entity created: id=0x${id.toString(16)} name="${name ?? ''}"`);
      return id;
    },
    ecsDestroyEntity(id: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      const ok = ecs.destroyEntity(id);
      push(ok ? 'OK' : 'WARN', `Destroy entity 0x${id.toString(16)}: ${ok ? 'ok' : 'not alive'}`);
      return ok;
    },
    ecsGetName(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.getEntityName(id) : '';
    },
    ecsEntityCount() {
      const ecs = getEcs();
      return ecs ? ecs.entityCount() : 0;
    },
    ecsSetPosition(id: number, x: number, y: number, z: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityPosition(id, x, y, z);
    },
    ecsGetPosition(id: number, axis: 0 | 1 | 2) {
      const ecs = getEcs();
      if (!ecs) return 0;
      return ecs.getEntityPosition(id)[axis];
    },
    ecsSetHealth(id: number, hp: number, maxHp: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityHealth(id, hp, maxHp);
    },
    ecsGetHealth(id: number, field: 'hp' | 'maxHp') {
      const ecs = getEcs();
      if (!ecs) return 0;
      const h = ecs.getEntityHealth(id);
      return h ? h[field] : 0;
    },
    ecsDamage(id: number, amount: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      const ok = ecs.damageEntity(id, amount);
      if (ok) {
        const h = ecs.getEntityHealth(id);
        push('INFO', `Entity 0x${id.toString(16)} damaged by ${amount}, hp=${h?.hp ?? '?'}`);
      }
      return ok;
    },
    ecsSetTag(id: number, tag: string) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityTag(id, tag);
    },
    ecsSetVelocity(id: number, x: number, y: number, z: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityVelocity(id, x, y, z);
    },
    ecsQuery(compName: string) {
      const ecs = getEcs();
      return ecs ? ecs.queryEntities(compName) : [];
    },
    ecsQueryByTag(tag: string) {
      const ecs = getEcs();
      return ecs ? ecs.queryByTag(tag) : [];
    },
    ecsSetComponent(compName: string, id: number, dataJson: string) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setComponent(id, compName, dataJson);
    },
    ecsGetComponent(compName: string, id: number) {
      const ecs = getEcs();
      return ecs ? (ecs.getComponent(id, compName) ?? '') : '';
    },

    // ── Tick (Phase 3.2) ──
    ecsOnTick(cb: TickCallback) {
      const ecs = getEcs();
      if (!ecs) return;
      const unsub = ecs.onTick((dt) => {
        tickDt = dt;
        try {
          cb(dt);
        } catch (err) {
          push('ERR', `Tick callback error: ${err instanceof Error ? err.message : String(err)}`);
        }
      });
      tickUnsubs.push(unsub);
    },
    ecsTickDt() {
      return tickDt;
    },
    __clearTickCallbacks() {
      for (const unsub of tickUnsubs) {
        try { unsub(); } catch { /* noop */ }
      }
      tickUnsubs = [];
      tickDt = 0;
    },

    // ── Material (Phase 3.3) ──
    matSetColor(id: number, r: number, g: number, b: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityMaterialColor(id, r, g, b);
    },
    matSetColorHex(id: number, hex: string) {
      const ecs = getEcs();
      if (!ecs) return false;
      const { r, g, b } = hexToRgbFloat(hex);
      return ecs.setEntityMaterialColor(id, r, g, b);
    },
    matSetMetallic(id: number, value: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityMaterialMetallic(id, value);
    },
    matSetRoughness(id: number, value: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityMaterialRoughness(id, value);
    },
    matSetEmissive(id: number, r: number, g: number, b: number, intensity: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityMaterialEmissive(id, r, g, b, intensity);
    },
    matSetOpacity(id: number, value: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityMaterialOpacity(id, value);
    },
    matSetWireframe(id: number, on: boolean) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.setEntityMaterialWireframe(id, on);
    },
    matGetMetallic(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.getEntityMaterialMetallic(id) : 0;
    },
    matGetRoughness(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.getEntityMaterialRoughness(id) : 0;
    },
    matGetOpacity(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.getEntityMaterialOpacity(id) : 1;
    },
    matAssignNew(id: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.assignNewStandardMaterial(id);
    },

    // ── Animation State Machine (Phase 3.4) ──
    animSmInit(id: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.initAnimStateMachine(id);
    },
    animSmAddState(id: number, stateName: string, clipName: string, loop: 'once' | 'repeat' | 'pingpong', speed: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.addAnimState(id, stateName, clipName, loop, speed);
    },
    animSmAddTransition(id: number, from: string, to: string, duration: number) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.addAnimTransition(id, from, to, duration);
    },
    animSmEnter(id: number, stateName: string) {
      const ecs = getEcs();
      if (!ecs) return false;
      return ecs.enterAnimState(id, stateName);
    },
    animSmCurrent(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.getCurrentAnimState(id) : '';
    },
    animSmListStates(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.listAnimStates(id) : [];
    },
    animSmListClips(id: number) {
      const ecs = getEcs();
      return ecs ? ecs.listAnimClips(id) : [];
    },
  };

  return api;
}

/** Hex color string (#rgb or #rrggbb) → normalized 0..1 rgb. */
function hexToRgbFloat(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return {
    r: ((v >> 16) & 0xff) / 255,
    g: ((v >> 8) & 0xff) / 255,
    b: (v & 0xff) / 255,
  };
}

/**
 * Drive the EcsScriptAPI tick loop. Should be called every frame from the
 * React render loop (e.g. useFrame in CustomStage). No-op if no tick
 * callbacks are registered or no script has run yet.
 */
export function driveVreenTick(dt: number): void {
  _ecsApiCache?.tick(dt);
}

/** Execute generated Blockly code with the VREEN API. */
export async function executeVreenScript(code: string, api: VREENAPI) {
  const wrapped = `(async () => {\n${code}\n})()`;
  try {
    // Replace VREEN.xxx references with the real API object
    const fn = new Function('VREEN', wrapped);
    await fn(api);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    push('ERR', `Script error: ${msg}`);
    console.error('[VREEN Script]', err);
  }
}
