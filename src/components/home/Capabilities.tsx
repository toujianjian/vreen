// Capabilities — 渲染能力展示区(赛博朋克风格 + i18n)。
// 把 VREEN 旗舰渲染特性与 soup3D 对比亮出来,直接服务"比 soup3D 更有优势"。
import { useTranslation } from 'react-i18next';
import { Sparkles, Sun, Scan, Aperture, Droplets, Waves, FastForward, Box, Cloud, CloudSun, CloudOff, Mountain, Lightbulb, Moon, Palette, Sticker, Smile, Focus, Maximize, Gem, Layers, Globe, Sailboat, Anchor, Sunrise, Star, Flame, Contrast, Camera, GlassWater, Wind, Hourglass, Filter, SprayCan, Boxes, Eye, ScanLine, Umbrella, Map, Trees, Grid3x3, SlidersHorizontal, Atom, Brain, Move, Expand, Brush, Frame, Orbit, Film, Blend, BarChart3, ThermometerSun, Monitor, Zap, Haze, Sparkle, Waypoints, EyeOff, SquareDashed, Network } from 'lucide-react';

interface Cap {
  key: string;        // i18n key suffix under capabilities.items
  icon: typeof Sparkles;
  accent: string;     // tailwind text color class
}

const CAPS: Cap[] = [
  { key: 'bloom', icon: Sparkles, accent: 'text-neon-cyan' },
  { key: 'sky', icon: Sun, accent: 'text-neon-amber' },
  { key: 'smaa', icon: Scan, accent: 'text-neon-cyan' },
  { key: 'gtao', icon: Aperture, accent: 'text-neon-magenta' },
  { key: 'sss', icon: Droplets, accent: 'text-neon-cyan' },
  { key: 'hairMarschner', icon: Wind, accent: 'text-neon-amber' },
  { key: 'taa', icon: Waves, accent: 'text-neon-amber' },
  { key: 'motionBlurEnhanced', icon: FastForward, accent: 'text-neon-cyan' },
  { key: 'ssr', icon: Box, accent: 'text-neon-magenta' },
  { key: 'sssr', icon: Layers, accent: 'text-neon-magenta' },
  { key: 'volfog', icon: Cloud, accent: 'text-neon-cyan' },
  { key: 'volcloud', icon: CloudSun, accent: 'text-neon-amber' },
  { key: 'cloudShadow', icon: CloudOff, accent: 'text-neon-magenta' },
  { key: 'caustics', icon: Sailboat, accent: 'text-neon-cyan' },
  { key: 'waterSurface', icon: Anchor, accent: 'text-neon-magenta' },
  { key: 'godRays', icon: Sunrise, accent: 'text-neon-amber' },
  { key: 'lensFlare', icon: Star, accent: 'text-neon-cyan' },
  { key: 'gpuParticles', icon: Flame, accent: 'text-neon-amber' },
  { key: 'localExposure', icon: Contrast, accent: 'text-neon-cyan' },
  { key: 'lensDistortion', icon: Camera, accent: 'text-neon-magenta' },
  { key: 'screenSpaceRefraction', icon: GlassWater, accent: 'text-neon-cyan' },
  { key: 'heightFog', icon: Mountain, accent: 'text-neon-amber' },
  { key: 'ssgi', icon: Lightbulb, accent: 'text-neon-amber' },
  { key: 'ddgi', icon: Globe, accent: 'text-neon-cyan' },
  { key: 'pcss', icon: Moon, accent: 'text-neon-magenta' },
  { key: 'csm', icon: Boxes, accent: 'text-neon-cyan' },
  { key: 'lut', icon: Palette, accent: 'text-neon-cyan' },
  { key: 'decal', icon: Sticker, accent: 'text-neon-amber' },
  { key: 'skin', icon: Smile, accent: 'text-neon-magenta' },
  { key: 'sharpen', icon: Focus, accent: 'text-neon-cyan' },
  { key: 'fsr', icon: Maximize, accent: 'text-neon-magenta' },
  { key: 'tsr', icon: Hourglass, accent: 'text-neon-amber' },
  { key: 'specularAA', icon: Gem, accent: 'text-neon-cyan' },
  { key: 'svgf', icon: Filter, accent: 'text-neon-magenta' },
  { key: 'screenSpaceDecal', icon: SprayCan, accent: 'text-neon-cyan' },
  { key: 'autoExposure', icon: Eye, accent: 'text-neon-amber' },
  { key: 'dof', icon: ScanLine, accent: 'text-neon-magenta' },
  { key: 'contactShadows', icon: Umbrella, accent: 'text-neon-cyan' },
  { key: 'tonemapping', icon: SlidersHorizontal, accent: 'text-neon-amber' },
  { key: 'terrain', icon: Map, accent: 'text-neon-cyan' },
  { key: 'vegetation', icon: Trees, accent: 'text-neon-amber' },
  { key: 'voxel', icon: Grid3x3, accent: 'text-neon-magenta' },
  { key: 'physics', icon: Atom, accent: 'text-neon-magenta' },
  { key: 'ai', icon: Brain, accent: 'text-neon-cyan' },
  { key: 'ik', icon: Move, accent: 'text-neon-amber' },
  { key: 'paniniProjection', icon: Expand, accent: 'text-neon-cyan' },
  { key: 'colorGrading', icon: Brush, accent: 'text-neon-magenta' },
  { key: 'outline', icon: Frame, accent: 'text-neon-amber' },
  { key: 'reflectionProbe', icon: Orbit, accent: 'text-neon-cyan' },
  { key: 'lookModification', icon: Film, accent: 'text-neon-magenta' },
  { key: 'lutBlender', icon: Blend, accent: 'text-neon-cyan' },
  { key: 'luminanceHistogram', icon: BarChart3, accent: 'text-neon-magenta' },
  { key: 'whiteBalance', icon: ThermometerSun, accent: 'text-neon-amber' },
  { key: 'outputTransform', icon: Monitor, accent: 'text-neon-cyan' },
  { key: 'sao', icon: Aperture, accent: 'text-neon-magenta' },
  { key: 'fxaa', icon: Zap, accent: 'text-neon-cyan' },
  { key: 'fastDepthAwareBlur', icon: Haze, accent: 'text-neon-magenta' },
  { key: 'bloomEnhanced', icon: Sparkle, accent: 'text-neon-cyan' },
  { key: 'lightingChannel', icon: Waypoints, accent: 'text-neon-magenta' },
  { key: 'hzbOcclusion', icon: EyeOff, accent: 'text-neon-cyan' },
  { key: 'areaLightLTC', icon: SquareDashed, accent: 'text-neon-magenta' },
  { key: 'meshletRenderer', icon: Network, accent: 'text-neon-cyan' },
];

export function Capabilities() {
  const { t } = useTranslation();

  return (
    <section id="capabilities" className="relative max-w-[1600px] mx-auto px-5 py-20">
      <header className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <div className="font-mono text-[11px] tracking-[0.32em] text-neon-cyan mb-2">
            <span className="inline-block w-8 h-px bg-neon-cyan align-middle mr-2" />
            {t('capabilities.section')}
          </div>
          <h2 className="font-display font-black text-[clamp(1.8rem,3.6vw,3rem)] tracking-[0.04em] text-haze leading-tight">
            {t('capabilities.title')}
          </h2>
          <p className="mt-2 text-mist text-sm max-w-2xl">
            {t('capabilities.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.22em] text-mist">
          <span className="px-2 py-1 border border-neon-magenta/30 text-neon-magenta">
            {t('capabilities.vsSoup3D')}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {CAPS.map((cap, i) => {
          const Icon = cap.icon;
          return (
            <div
              key={cap.key}
              className="group relative animate-fade-up"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div className="relative h-full border border-neon-cyan/15 bg-space-900/40 backdrop-blur-sm p-5 transition-all duration-300 hover:border-neon-cyan/50 hover:bg-space-800/50 hover:shadow-glow">
                {/* corner accents */}
                <span className="absolute top-0 left-0 w-3 h-3 border-t border-l border-neon-cyan/50" />
                <span className="absolute top-0 right-0 w-3 h-3 border-t border-r border-neon-cyan/50" />
                <span className="absolute bottom-0 left-0 w-3 h-3 border-b border-l border-neon-cyan/50" />
                <span className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-neon-cyan/50" />

                <div className="flex items-center justify-between mb-3">
                  <Icon className={`w-5 h-5 ${cap.accent}`} />
                  <span className="font-mono text-[9px] tracking-[0.2em] text-mist/70">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                </div>

                <h3 className="font-display font-bold text-[13px] tracking-[0.16em] text-haze mb-1.5">
                  {t(`capabilities.items.${cap.key}.title`)}
                </h3>
                <p className="text-mist text-[11px] leading-relaxed mb-3 min-h-[3em]">
                  {t(`capabilities.items.${cap.key}.desc`)}
                </p>

                <div className="flex items-center gap-1.5 pt-2 border-t border-neon-cyan/10">
                  <span className="font-mono text-[9px] tracking-[0.18em] text-neon-magenta/80">
                    {t('capabilities.advantageLabel')}
                  </span>
                  <span className="font-mono text-[9px] tracking-[0.16em] text-neon-cyan/90">
                    {t(`capabilities.items.${cap.key}.advantage`)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
