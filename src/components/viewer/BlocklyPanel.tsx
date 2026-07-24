/**
 * BlocklyPanel — Visual scripting panel for VREEN scene control.
 *
 * Renders a Blockly workspace with custom VREEN blocks. The user drags
 * blocks to build a script, then clicks "Run" to execute it against the
 * live 3D scene via the VREEN runtime API.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import 'blockly/blocks';
import * as En from 'blockly/msg/en';
import { Play, Square, AlertTriangle, Bug, Save, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/uiStore';
import {
  defineVreenBlocks,
  VREEN_TOOLBOX,
  createVREENAPI,
  executeVreenScript,
  setLogCallback,
  driveVreenTick,
} from '@/lib/vreenBlockly';
import {
  serializeWorkspace,
  deserializeIntoWorkspace,
  listSavedScripts,
  saveScript,
} from '@/lib/blocklyScriptStore';
import type { VreenScriptEntry as ScriptEntry } from '@/lib/vreenManifest';

// Load Blockly default messages (required for aria labels, tooltips, etc.)
Blockly.setLocale(En as unknown as Record<string, string>);

let blocksDefined = false;

export function BlocklyPanel() {
  const blocklyRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const apiRef = useRef(createVREENAPI());
  const rafRef = useRef<number | null>(null);
  const lastTickTimeRef = useRef<number>(0);
  const [running, setRunning] = useState(false);
  const [code, setCode] = useState('');
  const pushLog = useUIStore((s) => s.pushLog);

  // Register log callback
  useEffect(() => {
    setLogCallback((level, text) => pushLog(level, text));
  }, [pushLog]);

  // Tick loop: drive EcsScriptAPI every frame while running
  const startTickLoop = useCallback(() => {
    if (rafRef.current !== null) return;
    lastTickTimeRef.current = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - lastTickTimeRef.current) / 1000);
      lastTickTimeRef.current = now;
      driveVreenTick(dt);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stopTickLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopTickLoop();
  }, [stopTickLoop]);

  // Initialize Blockly workspace
  useEffect(() => {
    if (!blocklyRef.current || workspaceRef.current) return;

    // Define custom blocks once
    if (!blocksDefined) {
      defineVreenBlocks();
      blocksDefined = true;
    }

    const ws = Blockly.inject(blocklyRef.current, {
      toolbox: VREEN_TOOLBOX,
      grid: {
        spacing: 20,
        length: 3,
        colour: '#1a2040',
        snap: true,
      },
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.9,
        maxScale: 3,
        minScale: 0.3,
        scaleSpeed: 1.2,
      },
      trashcan: true,
      move: {
        scrollbars: true,
        drag: true,
        wheel: true,
      },
      sounds: false,
      theme: Blockly.Theme.defineTheme('vreen-dark', {
        name: 'vreen-dark',
        base: Blockly.Themes.Classic,
        componentStyles: {
          workspaceBackgroundColour: '#0a0f1a',
          toolboxBackgroundColour: '#05070d',
          toolboxForegroundColour: '#e8f4ff',
          flyoutBackgroundColour: '#0a0f1a',
          flyoutForegroundColour: '#e8f4ff',
          flyoutOpacity: 0.9,
          scrollbarColour: '#1a2040',
          insertionMarkerColour: '#00f0ff',
          insertionMarkerOpacity: 0.3,
          markerColour: '#00f0ff',
          cursorColour: '#00f0ff',
        },
      }),
    });

    workspaceRef.current = ws;

    return () => {
      ws.dispose();
      workspaceRef.current = null;
    };
  }, []);

  // Regenerate code on workspace changes
  useEffect(() => {
    const ws = workspaceRef.current;
    if (!ws) return;

    const updateCode = () => {
      const genCode = javascriptGenerator.workspaceToCode(ws);
      setCode(genCode);
    };

    ws.addChangeListener(updateCode);
    return () => {
      ws.removeChangeListener(updateCode);
    };
  }, []);

  const handleRun = useCallback(async () => {
    if (!code.trim()) return;
    // Clear previous tick callbacks before re-running
    apiRef.current.__clearTickCallbacks();
    setRunning(true);
    startTickLoop();
    await executeVreenScript(code, apiRef.current);
    setRunning(false);
  }, [code, startTickLoop]);

  const handleStop = useCallback(() => {
    apiRef.current.__clearTickCallbacks();
    stopTickLoop();
    setRunning(false);
  }, [stopTickLoop]);

  const handleClearWorkspace = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    ws.clear();
  }, []);

  const handleSaveScript = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const name = window.prompt('Script name:', `script_${Date.now()}`);
    if (!name) return;
    const entry = serializeWorkspace(ws, name);
    saveScript(entry);
    pushLog('OK', `Script saved: "${name}"`);
  }, [pushLog]);

  const [savedScripts, setSavedScripts] = useState<ScriptEntry[]>([]);
  const [showLoadMenu, setShowLoadMenu] = useState(false);

  const refreshSavedScripts = useCallback(() => {
    setSavedScripts(listSavedScripts());
  }, []);

  const handleLoadScript = useCallback((entry: ScriptEntry) => {
    const ws = workspaceRef.current;
    if (!ws) return;
    const ok = deserializeIntoWorkspace(entry, ws);
    if (ok) {
      pushLog('OK', `Script loaded: "${entry.name}"`);
    } else {
      pushLog('ERR', `Failed to load script: "${entry.name}"`);
    }
    setShowLoadMenu(false);
  }, [pushLog]);

  const handleOpenLoadMenu = useCallback(() => {
    refreshSavedScripts();
    setShowLoadMenu((v) => !v);
  }, [refreshSavedScripts]);

  return (
    <div className="flex flex-col h-full bg-space-950">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neon-cyan/15 bg-space-900/80">
        <div className="flex items-center gap-2">
          <button
            onClick={running ? handleStop : handleRun}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1 font-mono text-[11px] tracking-wider transition-colors',
              running
                ? 'bg-neon-amber/20 text-neon-amber border border-neon-amber/30'
                : 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/30 hover:bg-neon-cyan/25',
            )}
            disabled={!code.trim() && !running}
          >
            {running ? (
              <>
                <Square className="w-3 h-3" />
                Stop
              </>
            ) : (
              <>
                <Play className="w-3 h-3" />
                Run
              </>
            )}
          </button>
          <button
            onClick={handleClearWorkspace}
            className="flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] text-mist hover:text-haze transition-colors"
          >
            <Bug className="w-3 h-3" />
            Clear
          </button>
          <button
            onClick={handleSaveScript}
            className="flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] text-mist hover:text-haze transition-colors"
          >
            <Save className="w-3 h-3" />
            Save
          </button>
          <div className="relative">
            <button
              onClick={handleOpenLoadMenu}
              className="flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] text-mist hover:text-haze transition-colors"
            >
              <FolderOpen className="w-3 h-3" />
              Load
            </button>
            {showLoadMenu && (
              <div className="absolute top-full left-0 mt-1 min-w-[160px] max-h-[200px] overflow-auto bg-space-900 border border-neon-cyan/30 shadow-lg z-50">
                {savedScripts.length === 0 ? (
                  <div className="px-3 py-2 font-mono text-[10px] text-mist">No saved scripts</div>
                ) : (
                  savedScripts.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => handleLoadScript(s)}
                      className="block w-full text-left px-3 py-1.5 font-mono text-[10px] text-haze hover:bg-neon-cyan/10 transition-colors truncate"
                    >
                      {s.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>
        <span className="font-mono text-[9px] tracking-[0.22em] text-mist">BLOCKLY SCRIPT</span>
      </div>

      {/* Blockly workspace */}
      <div ref={blocklyRef} className="flex-1 min-h-0" />

      {/* Generated code preview */}
      <div className="border-t border-neon-cyan/10 bg-space-900/60">
        <div className="flex items-center gap-1.5 px-3 py-1 border-b border-neon-cyan/10">
          <AlertTriangle className="w-2.5 h-2.5 text-mist" />
          <span className="font-mono text-[9px] tracking-[0.15em] text-mist">GENERATED JS</span>
        </div>
        <pre className="p-3 font-mono text-[10px] leading-relaxed text-haze/70 overflow-auto max-h-[120px] select-text">
          {code || '// Drag blocks to generate script...'}
        </pre>
      </div>
    </div>
  );
}
