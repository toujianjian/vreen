// Terminal-style log footer for the home page.
import { useEffect, useRef } from 'react';
import { HudPanel } from '@/components/hud/HudPanel';
import { useUIStore } from '@/stores/uiStore';
import { cn } from '@/lib/cn';

const LEVEL_COLOR: Record<string, string> = {
  INFO: 'text-neon-cyan',
  OK: 'text-emerald-300',
  WARN: 'text-neon-amber',
  ERR: 'text-neon-magenta',
};

export function TerminalLog() {
  const logs = useUIStore((s) => s.logs);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <section className="relative max-w-[1600px] mx-auto px-5 py-8">
      <HudPanel title="KERNEL LOG" tag="STDOUT">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0">
          <div className="lg:col-span-2 border-r border-neon-cyan/10">
            <div
              ref={scrollRef}
              className="h-56 overflow-y-auto px-4 py-3 font-mono text-[11px] space-y-1 bg-space-950/40"
            >
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2.5">
                  <span className="text-mist/70 tabular-nums shrink-0">[{l.ts}]</span>
                  <span
                    className={cn(
                      'shrink-0 w-9 font-bold tracking-[0.16em]',
                      LEVEL_COLOR[l.level] ?? 'text-neon-cyan',
                    )}
                  >
                    {l.level}
                  </span>
                  <span className="text-haze/90">//</span>
                  <span className="text-haze/85 break-words">{l.text}</span>
                </div>
              ))}
              <BlinkingCursor />
            </div>
          </div>

          <div className="p-4 space-y-3 font-mono text-[11px]">
            <div className="hud-label">SYSTEM SPECS</div>
            <ul className="space-y-1.5 text-haze/85">
              <li className="flex justify-between">
                <span className="text-mist">Renderer</span>
                <span>WebGL2 / PBR</span>
              </li>
              <li className="flex justify-between">
                <span className="text-mist">Formats</span>
                <span className="text-neon-cyan">6 / 6 OK</span>
              </li>
              <li className="flex justify-between">
                <span className="text-mist">HDRI Presets</span>
                <span>studio · sunset · city</span>
              </li>
              <li className="flex justify-between">
                <span className="text-mist">PostFX</span>
                <span className="text-neon-amber">3 / 5 ON</span>
              </li>
              <li className="flex justify-between">
                <span className="text-mist">License</span>
                <span>MIT</span>
              </li>
            </ul>
            <div className="hud-divider" />
            <div className="text-mist/80 text-[10px] tracking-[0.2em]">
              // press <span className="text-neon-cyan">[ LAUNCH INSPECTOR ]</span> to enter runtime
            </div>
          </div>
        </div>
      </HudPanel>
    </section>
  );
}

function BlinkingCursor() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-mist/70 tabular-nums">[ -- ]</span>
      <span className="text-neon-cyan font-bold tracking-[0.16em]">READY</span>
      <span className="text-haze/90">//</span>
      <span className="inline-block w-2 h-3.5 bg-neon-cyan/90 animate-blink" />
    </div>
  );
}
