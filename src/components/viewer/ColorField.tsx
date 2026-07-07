// ColorField — a HUD-styled color input that does NOT use the native
// <input type="color"> (whose system popover ignores overflow:hidden and
// "breaks out" of the panel). Instead we show:
//   • a 32×32 swatch filled with the current color
//   • a hex text input next to it
//   • clicking the swatch opens an in-panel popover with a fine-tunable
//     HSL/RGB picker + 12 quick-palette swatches
//
// The popover is a regular absolute element inside the panel, so it
// respects the panel's overflow:hidden and never "punches through" the
// HUD frame.

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** Convert a hex string (#rrggbb) to {r,g,b} in 0..255. */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 128, g: 128, b: 128 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function isValidHex(s: string): boolean {
  return /^#?[0-9a-f]{6}$/i.test(s.trim());
}

const QUICK_PALETTE: string[] = [
  '#ff2bd6', '#00f0ff', '#ffb648', '#34d399',
  '#f87171', '#a78bfa', '#fbbf24', '#22d3ee',
  '#ffffff', '#94a3b8', '#475569', '#000000',
];

interface ColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  className?: string;
}

export function ColorField({ value, onChange, className }: ColorFieldProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Keep the draft in sync when the parent value changes from outside
  // (e.g. another component reset the material).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  // Click-outside to dismiss the popover.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const commit = (hex: string) => {
    if (isValidHex(hex)) {
      const normalized = hex.startsWith('#') ? hex : `#${hex}`;
      setDraft(normalized);
      onChange(normalized);
    }
  };

  const { r, g, b } = hexToRgb(draft);

  return (
    <div ref={wrapRef} className={cn('relative', className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Color swatch"
          onClick={() => setOpen((o) => !o)}
          className="hud-swatch"
        >
          <span
            className="hud-swatch-fill"
            style={{ backgroundColor: draft }}
          />
        </button>
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (isValidHex(e.target.value)) {
              onChange(e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`);
            }
          }}
          onBlur={() => commit(draft)}
          className="hud-input font-mono"
          spellCheck={false}
          maxLength={7}
        />
      </div>

      {open && (
        <div
          className="absolute z-50 left-0 top-[36px] w-[224px] p-3 bg-space-900/95 border border-neon-cyan/30 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-md space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* RGB sliders — 3 slim ranges, all use .hud-range for consistent style. */}
          <div>
            <div className="hud-label mb-1">R · {r}</div>
            <input
              type="range"
              min={0}
              max={255}
              value={r}
              className="hud-range"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const next = rgbToHex(v, g, b);
                setDraft(next);
                onChange(next);
              }}
            />
          </div>
          <div>
            <div className="hud-label mb-1">G · {g}</div>
            <input
              type="range"
              min={0}
              max={255}
              value={g}
              className="hud-range"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const next = rgbToHex(r, v, b);
                setDraft(next);
                onChange(next);
              }}
            />
          </div>
          <div>
            <div className="hud-label mb-1">B · {b}</div>
            <input
              type="range"
              min={0}
              max={255}
              value={b}
              className="hud-range"
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                const next = rgbToHex(r, g, v);
                setDraft(next);
                onChange(next);
              }}
            />
          </div>

          {/* Quick palette */}
          <div>
            <div className="hud-label mb-1.5">PRESET</div>
            <div className="grid grid-cols-6 gap-1.5">
              {QUICK_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  onClick={() => commit(c)}
                  className="w-full aspect-square border border-neon-cyan/20 hover:border-neon-cyan transition-colors"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
