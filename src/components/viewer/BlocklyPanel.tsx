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
import { Play, Square, AlertTriangle, Bug } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { useUIStore } from '@/stores/uiStore';
import {
  defineVreenBlocks,
  VREEN_TOOLBOX,
  createVREENAPI,
  executeVreenScript,
  setLogCallback,
} from '@/lib/vreenBlockly';

// Load Blockly default messages (required for aria labels, tooltips, etc.)
Blockly.setLocale(En as unknown as Record<string, string>);

let blocksDefined = false;

export function BlocklyPanel() {
  const { t } = useTranslation();
  const blocklyRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<Blockly.WorkspaceSvg | null>(null);
  const apiRef = useRef(createVREENAPI());
  const [running, setRunning] = useState(false);
  const [code, setCode] = useState('');
  const pushLog = useUIStore((s) => s.pushLog);

  // Register log callback
  useEffect(() => {
    setLogCallback((level, text) => pushLog(level, text));
  }, [pushLog]);

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
    setRunning(true);
    await executeVreenScript(code, apiRef.current);
    setRunning(false);
  }, [code]);

  const handleStop = useCallback(() => {
    // For now, stop just clears the running state.
    // Long-running scripts can be aborted via Workspace cleanup.
    setRunning(false);
  }, []);

  const handleClearWorkspace = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws) return;
    ws.clear();
  }, []);

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
