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

/* ──────────── Block Definitions ──────────── */

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
}

let _pushLog: ((level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string) => void) | null = null;

/** Set the log callback so VREEN API can push to the UI log. */
export function setLogCallback(cb: (level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string) => void) {
  _pushLog = cb;
}

function push(level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string) {
  _pushLog?.(level, text);
}

/** Create the VREEN runtime API object. */
export function createVREENAPI(): VREENAPI {
  return {
    // ── Camera ──
    setCameraPreset(preset: string) {
      useViewerStore.getState().setCameraPreset(preset as any);
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
  };
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
