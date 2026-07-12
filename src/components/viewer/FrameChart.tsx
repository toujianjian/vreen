// FrameChart — 极简 mini canvas 折线图,展示最近 N 帧的耗时历史。
//
// 设计目标:
//   - 零依赖:手画 Canvas2D,不引 chart.js / d3
//   - 双系列:CPU ms(青色)+ GPU ms(品红)
//   - 自适应尺寸:父容器给多大画多大
//   - 16ms (60fps) 参考线 + 33ms (30fps) 参考线
//
// 用法:
//   <FrameChart data={history} width={240} height={60} />

import { useEffect, useRef } from 'react';
import type { FrameSample } from '@/engine';

interface FrameChartProps {
  /** 帧样本数组(老→新),来自 profiler.history() */
  data: FrameSample[];
  width?: number;
  height?: number;
  /** 是否同时画 GPU 折线(无 GPU 数据时自动隐藏) */
  showGpu?: boolean;
}

const PAD_X = 2;
const PAD_Y = 4;

export function FrameChart({ data, width = 240, height = 60, showGpu = true }: FrameChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, width * dpr);
    canvas.height = Math.max(1, height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (data.length < 2) {
      ctx.fillStyle = 'rgba(120, 180, 220, 0.4)';
      ctx.font = '10px monospace';
      ctx.fillText('—', 4, height / 2 + 3);
      return;
    }

    // 计算 Y 轴上限:取 max(33ms, samples 中最大的 cpuMs/gpuMs * 1.2)
    let maxMs = 33;
    for (const s of data) {
      if (s.cpuMs > maxMs) maxMs = s.cpuMs;
      if (s.gpuMs != null && s.gpuMs > maxMs) maxMs = s.gpuMs;
    }
    maxMs = Math.max(33, maxMs * 1.2);

    const innerW = width - PAD_X * 2;
    const innerH = height - PAD_Y * 2;

    // 参考线
    ctx.strokeStyle = 'rgba(0, 220, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    // 16.67ms (60fps)
    const y60 = PAD_Y + innerH - (16.67 / maxMs) * innerH;
    ctx.beginPath();
    ctx.moveTo(PAD_X, y60);
    ctx.lineTo(PAD_X + innerW, y60);
    ctx.stroke();
    // 33.33ms (30fps)
    const y30 = PAD_Y + innerH - (33.33 / maxMs) * innerH;
    ctx.beginPath();
    ctx.moveTo(PAD_X, y30);
    ctx.lineTo(PAD_X + innerW, y30);
    ctx.stroke();
    ctx.setLineDash([]);

    // CPU 折线
    const drawLine = (key: 'cpuMs' | 'gpuMs', color: string, fill: string) => {
      ctx.strokeStyle = color;
      ctx.fillStyle = fill;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < data.length; i++) {
        const s = data[i];
        const v = s[key];
        if (v == null) continue;
        const x = PAD_X + (i / (data.length - 1)) * innerW;
        const y = PAD_Y + innerH - (v / maxMs) * innerH;
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      if (started) ctx.stroke();
    };

    drawLine('cpuMs', 'rgba(0, 220, 255, 0.95)', 'rgba(0, 220, 255, 0.18)');
    if (showGpu && data.some((s) => s.gpuMs != null)) {
      drawLine('gpuMs', 'rgba(255, 64, 200, 0.95)', 'rgba(255, 64, 200, 0.12)');
    }

    // 标签:左上 FPS,右上 ms
    const last = data[data.length - 1];
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(220, 240, 255, 0.75)';
    ctx.fillText(`${last.fps.toFixed(0)} fps`, 4, 10);
    ctx.textAlign = 'right';
    ctx.fillText(`${last.cpuMs.toFixed(1)}ms`, width - 4, 10);
    if (last.gpuMs != null) {
      ctx.fillStyle = 'rgba(255, 130, 220, 0.9)';
      ctx.fillText(`${last.gpuMs.toFixed(1)}ms`, width - 4, height - 2);
    }
    ctx.textAlign = 'left';
  }, [data, width, height, showGpu]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: `${width}px`, height: `${height}px`, display: 'block' }}
      aria-label="frame timing chart"
    />
  );
}
