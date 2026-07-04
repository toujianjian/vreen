// Reusable HUD frame: a panel with corner accents and optional title bar.
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface HudPanelProps {
  title?: string;
  tag?: string;
  variant?: 'default' | 'magenta';
  className?: string;
  bodyClassName?: string;
  headerExtra?: ReactNode;
  children: ReactNode;
  noHeader?: boolean;
}

export function HudPanel({
  title,
  tag,
  variant = 'default',
  className,
  bodyClassName,
  headerExtra,
  children,
  noHeader,
}: HudPanelProps) {
  return (
    <section
      className={cn(
        'hud-panel relative',
        variant === 'magenta' && 'hud-panel-magenta',
        className,
      )}
    >
      {/* Corner accents */}
      <span className={cn('hud-corner hud-corner-tl', variant === 'magenta' && '!border-neon-magenta')} />
      <span className={cn('hud-corner hud-corner-tr', variant === 'magenta' && '!border-neon-magenta')} />
      <span className={cn('hud-corner hud-corner-bl', variant === 'magenta' && '!border-neon-magenta')} />
      <span className={cn('hud-corner hud-corner-br', variant === 'magenta' && '!border-neon-magenta')} />

      {!noHeader && (title || tag) && (
        <header className="relative flex items-center justify-between px-3 py-2 border-b border-neon-cyan/10 bg-space-800/40">
          <div className="flex items-center gap-2">
            {tag && <span className={cn('hud-tag', variant === 'magenta' && 'hud-tag-magenta')}>{tag}</span>}
            {title && <h2 className="font-display text-[12px] tracking-[0.24em] text-haze uppercase">{title}</h2>}
          </div>
          {headerExtra}
        </header>
      )}

      <div className={cn('relative', bodyClassName)}>{children}</div>
    </section>
  );
}
