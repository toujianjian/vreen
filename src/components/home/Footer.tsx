// Page footer
import { Github, Cpu, Layers, Box } from 'lucide-react';

export function Footer() {
  return (
    <footer className="relative mt-8 border-t border-neon-cyan/10 bg-space-900/70 backdrop-blur-md">
      <div className="max-w-[1600px] mx-auto px-5 py-8 grid grid-cols-1 md:grid-cols-4 gap-8 text-[12px] font-mono">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <div className="relative w-6 h-6 flex items-center justify-center">
              <div className="absolute inset-0 border border-neon-cyan/60 rotate-45" />
              <span className="relative font-display font-black text-[10px] text-neon-cyan">V</span>
            </div>
            <span className="font-display font-bold tracking-[0.28em] text-haze">VREEN</span>
          </div>
          <p className="text-mist leading-relaxed">
            A holographic 3D display system for indie game developers and 3D artists. Pure-client. Open source.
          </p>
        </div>

        <div>
          <div className="hud-label mb-3">CAPABILITIES</div>
          <ul className="space-y-1.5 text-haze/85">
            <li className="flex items-center gap-2">
              <Layers className="w-3 h-3 text-neon-cyan" />
              Multi-format import
            </li>
            <li className="flex items-center gap-2">
              <Cpu className="w-3 h-3 text-neon-cyan" />
              Real-time PBR
            </li>
            <li className="flex items-center gap-2">
              <Box className="w-3 h-3 text-neon-cyan" />
              Inspector-grade UI
            </li>
          </ul>
        </div>

        <div>
          <div className="hud-label mb-3">SUPPORTED</div>
          <ul className="space-y-1.5 text-haze/85">
            <li>GLB · GLTF</li>
            <li>OBJ · FBX</li>
            <li>STL · PLY</li>
          </ul>
        </div>

        <div>
          <div className="hud-label mb-3">LINKS</div>
          <ul className="space-y-1.5 text-haze/85">
            <li>
              <a
                href="https://github.com/KhronosGroup/glTF-Sample-Models"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-neon-cyan transition-colors"
              >
                <Github className="w-3 h-3" />
                glTF Sample Models
              </a>
            </li>
            <li>
              <a
                href="https://threejs.org/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-neon-cyan transition-colors"
              >
                three.js
              </a>
            </li>
            <li>
              <a
                href="https://r3f.docs.pmnd.rs/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-neon-cyan transition-colors"
              >
                @react-three/fiber
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-neon-cyan/10">
        <div className="max-w-[1600px] mx-auto px-5 py-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono tracking-[0.2em] text-mist">
          <span>VREEN © 2026 // HOLOGRAPHIC 3D DISPLAY SYSTEM</span>
          <span className="text-neon-cyan">v0.1.0 // BUILD 2607-A1F3</span>
        </div>
      </div>
    </footer>
  );
}
