/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        space: {
          950: '#03050b',
          900: '#05070d',
          800: '#0a0f1a',
          700: '#101828',
          600: '#1a2235',
        },
        neon: {
          cyan: '#00f0ff',
          magenta: '#ff2bd6',
          amber: '#ffb648',
        },
        glass: {
          DEFAULT: 'rgba(10, 15, 26, 0.62)',
          strong: 'rgba(10, 15, 26, 0.86)',
          soft: 'rgba(232, 244, 255, 0.04)',
        },
        mist: {
          DEFAULT: '#5a6478',
          dim: '#2c3344',
        },
        haze: '#e8f4ff',
      },
      fontFamily: {
        display: ['Orbitron', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
        sans: ['"Noto Sans SC"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(0, 240, 255, 0.45), 0 0 48px rgba(0, 240, 255, 0.18)',
        'glow-magenta': '0 0 24px rgba(255, 43, 214, 0.45), 0 0 48px rgba(255, 43, 214, 0.18)',
        'glow-amber': '0 0 18px rgba(255, 182, 72, 0.45)',
        panel: 'inset 0 0 0 1px rgba(0, 240, 255, 0.18), 0 8px 24px rgba(0, 0, 0, 0.4)',
      },
      backgroundImage: {
        'radial-fade': 'radial-gradient(ellipse at center, rgba(0,240,255,0.10) 0%, rgba(0,240,255,0) 65%)',
        'grid-lines': 'linear-gradient(rgba(0,240,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(0,240,255,0.06) 1px, transparent 1px)',
        'scanlines': 'repeating-linear-gradient(0deg, rgba(0,240,255,0.04) 0px, rgba(0,240,255,0.04) 1px, transparent 1px, transparent 3px)',
      },
      backgroundSize: {
        'grid-32': '32px 32px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scan-x': 'scan-x 6s linear infinite',
        'scan-y': 'scan-y 4s linear infinite',
        'blink': 'blink 1.2s steps(2, start) infinite',
        'marquee': 'marquee 30s linear infinite',
        'fade-up': 'fadeUp 0.6s ease-out both',
        'rotate-slow': 'rotate 22s linear infinite',
        'float': 'float 6s ease-in-out infinite',
        'hud-flicker': 'hudFlicker 8s linear infinite',
      },
      keyframes: {
        'scan-x': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'scan-y': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        hudFlicker: {
          '0%, 96%, 100%': { opacity: '1' },
          '97%': { opacity: '0.85' },
          '98%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
