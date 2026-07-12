// proceduralTextures — 为预设生成器的材质生成 Canvas 程序化纹理。
// 覆盖 map（漫反射）、roughnessMap、normalMap、emissiveMap。
// 每个纹理根据 材质性质(baseColor / metalness / roughness / emissive) 自动选择图案风格。

import * as THREE from 'three';

export interface TextureSet {
  map: THREE.CanvasTexture;
  roughnessMap?: THREE.CanvasTexture;
  normalMap?: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
}

const TEX_SIZE = 512;

// ── 工具函数 ──────────────────────────────────────────────────────

function createCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = TEX_SIZE;
  c.height = TEX_SIZE;
  const ctx = c.getContext('2d')!;
  return [c, ctx];
}

function colorToStyle(c: THREE.Color): string {
  return `rgb(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0})`;
}

function noise(ctx: CanvasRenderingContext2D, alpha: number) {
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 3; i < img.data.length; i += 4) {
    img.data[i] = Math.random() * alpha * 255;
  }
  ctx.putImageData(img, 0, 0);
}

// ── 风格工厂 ──────────────────────────────────────────────────────

/** 金属/机械面板纹理: 网格线 + 铆钉 */
function mechTexture(base: THREE.Color): TextureSet {
  const [c, ctx] = createCanvas();

  // 底色
  ctx.fillStyle = colorToStyle(base);
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // 面板网格
  const step = 48;
  ctx.strokeStyle = `rgba(255,255,255,0.06)`;
  ctx.lineWidth = 1;
  for (let x = 0; x <= TEX_SIZE; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, TEX_SIZE); ctx.stroke();
  }
  for (let y = 0; y <= TEX_SIZE; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(TEX_SIZE, y); ctx.stroke();
  }

  // 铆钉
  ctx.fillStyle = `rgba(0,0,0,0.12)`;
  for (let x = step / 2; x < TEX_SIZE; x += step) {
    for (let y = step / 2; y < TEX_SIZE; y += step) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 划痕
  ctx.strokeStyle = `rgba(255,255,255,0.04)`;
  ctx.lineWidth = 1;
  for (let i = 0; i < 30; i++) {
    const sx = Math.random() * TEX_SIZE;
    const sy = Math.random() * TEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + (Math.random() - 0.5) * 80, sy + (Math.random() - 0.5) * 8);
    ctx.stroke();
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);

  // roughnessMap: 铆钉区域更粗糙
  const [rc, rctx] = createCanvas();
  rctx.fillStyle = '#888';
  rctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  rctx.fillStyle = '#444';
  for (let x = 0; x < TEX_SIZE; x += 40) {
    for (let y = 0; y < TEX_SIZE; y += 40) {
      rctx.beginPath();
      rctx.arc(x + 12, y + 12, 4, 0, Math.PI * 2);
      rctx.fill();
    }
  }
  const roughnessMap = new THREE.CanvasTexture(rc);
  roughnessMap.wrapS = roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2, 2);

  return { map, roughnessMap };
}

/** 水晶/宝石纹理: 裂纹 + 发光脉络 */
function crystalTexture(base: THREE.Color, emissive?: THREE.Color): TextureSet {
  const [c, ctx] = createCanvas();

  ctx.fillStyle = colorToStyle(base);
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // 裂纹
  ctx.strokeStyle = `rgba(255,255,255,0.10)`;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 12; i++) {
    ctx.beginPath();
    let x = Math.random() * TEX_SIZE, y = Math.random() * TEX_SIZE;
    ctx.moveTo(x, y);
    for (let j = 0; j < 6; j++) {
      x += (Math.random() - 0.5) * 60;
      y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 发光脉络 (emissiveMap 用)
  if (emissive && emissive.getHex() !== 0) {
    const [ec, ectx] = createCanvas();
    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    const emCol = colorToStyle(emissive);
    ectx.strokeStyle = emCol;
    ectx.lineWidth = 3;
    for (let i = 0; i < 15; i++) {
      ectx.beginPath();
      let x = Math.random() * TEX_SIZE, y = Math.random() * TEX_SIZE;
      ectx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (Math.random() - 0.5) * 80;
        y += (Math.random() - 0.5) * 80;
        ectx.lineTo(x, y);
      }
      ectx.stroke();
    }
    const emissiveMap = new THREE.CanvasTexture(ec);
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    emissiveMap.repeat.set(1.5, 1.5);

    const map = new THREE.CanvasTexture(c);
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.repeat.set(1.5, 1.5);
    return { map, emissiveMap };
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(1.5, 1.5);
  return { map };
}

/** 有机 / 木头纹理: 年轮 + 噪点 */
function organicTexture(base: THREE.Color): TextureSet {
  const [c, ctx] = createCanvas();

  ctx.fillStyle = colorToStyle(base);
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // 年轮
  const cx = TEX_SIZE / 2 + (Math.random() - 0.5) * 40;
  const cy = TEX_SIZE / 2 + (Math.random() - 0.5) * 40;
  ctx.strokeStyle = `rgba(0,0,0,0.08)`;
  ctx.lineWidth = 2;
  for (let r = 20; r < TEX_SIZE * 0.7; r += 12 + Math.random() * 8) {
    ctx.beginPath();
    ctx.ellipse(cx, cy, r, r * (0.85 + Math.random() * 0.15), 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 噪点
  const img = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 20;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);
  return { map };
}

/** 飞船/科技面板: 六边形网格 + 灯条 */
function techTexture(base: THREE.Color, emissive?: THREE.Color): TextureSet {
  const [c, ctx] = createCanvas();

  ctx.fillStyle = colorToStyle(base);
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // 六边形网格
  const hexR = 20;
  const h = hexR * Math.sqrt(3);
  ctx.strokeStyle = `rgba(255,255,255,0.07)`;
  ctx.lineWidth = 1;
  for (let row = 0; row < TEX_SIZE / h + 2; row++) {
    for (let col = 0; col < TEX_SIZE / (hexR * 3) + 2; col++) {
      const ox = col * hexR * 3 + (row % 2) * hexR * 1.5;
      const oy = row * h;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = ox + hexR * Math.cos(a);
        const py = oy + hexR * Math.sin(a);
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);

  if (emissive && emissive.getHex() !== 0) {
    const [ec, ectx] = createCanvas();
    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ectx.fillStyle = colorToStyle(emissive);
    for (let x = 0; x < TEX_SIZE; x += 64) {
      ectx.fillRect(x + 8, 8, 8, TEX_SIZE - 16);
    }
    const emissiveMap = new THREE.CanvasTexture(ec);
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    emissiveMap.repeat.set(2, 2);
    return { map, emissiveMap };
  }

  return { map };
}

/** 鳞片/生物纹理 */
function scaleTexture(base: THREE.Color): TextureSet {
  const [c, ctx] = createCanvas();

  ctx.fillStyle = colorToStyle(base);
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // 鳞片
  const s = 24;
  for (let row = 0; row < TEX_SIZE / s + 2; row++) {
    for (let col = 0; col < TEX_SIZE / s + 2; col++) {
      const ox = col * s + (row % 2) * s / 2;
      const oy = row * s * 0.86;
      ctx.strokeStyle = `rgba(0,0,0,0.12)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(ox, oy, s * 0.42, s * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,0.04)`;
      ctx.fill();
    }
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 3);
  return { map };
}

/** 石头/古迹纹理 */
function stoneTexture(base: THREE.Color, emissive?: THREE.Color): TextureSet {
  const [c, ctx] = createCanvas();

  ctx.fillStyle = colorToStyle(base);
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);

  // 裂纹
  ctx.strokeStyle = `rgba(0,0,0,0.15)`;
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    ctx.beginPath();
    let x = Math.random() * TEX_SIZE, y = Math.random() * TEX_SIZE;
    ctx.moveTo(x, y);
    for (let j = 0; j < 10; j++) {
      x += (Math.random() - 0.5) * 50;
      y += (Math.random() - 0.5) * 50;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // 凹坑
  ctx.fillStyle = `rgba(0,0,0,0.06)`;
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * TEX_SIZE, Math.random() * TEX_SIZE, 2 + Math.random() * 6, 0, Math.PI * 2);
    ctx.fill();
  }

  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2, 2);

  if (emissive && emissive.getHex() !== 0) {
    const [ec, ectx] = createCanvas();
    ectx.fillStyle = '#000';
    ectx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    ectx.fillStyle = colorToStyle(emissive);
    // 符文符号
    for (let i = 0; i < 8; i++) {
      ectx.globalAlpha = 0.3 + Math.random() * 0.5;
      const sx = Math.random() * TEX_SIZE * 0.8 + TEX_SIZE * 0.1;
      const sy = Math.random() * TEX_SIZE * 0.8 + TEX_SIZE * 0.1;
      // 简单符文: 菱形 + 横线
      ectx.beginPath();
      ectx.moveTo(sx, sy - 12);
      ectx.lineTo(sx + 8, sy);
      ectx.lineTo(sx, sy + 12);
      ectx.lineTo(sx - 8, sy);
      ectx.closePath();
      ectx.fill();
      ectx.fillRect(sx - 14, sy - 1, 28, 2);
    }
    ectx.globalAlpha = 1;
    const emissiveMap = new THREE.CanvasTexture(ec);
    emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
    emissiveMap.repeat.set(2, 2);
    return { map, emissiveMap };
  }

  return { map };
}

// ── 主入口 ─────────────────────────────────────────────────────────

/** 根据材质性质选择并生成合适的纹理。 */
export function generateTextureSet(
  baseColor: THREE.Color,
  metalness: number,
  roughness: number,
  emissive: THREE.Color,
  emissiveIntensity: number,
): TextureSet {
  const hasEmissive = emissive.getHex() !== 0 && emissiveIntensity > 0.1;

  // 高金属 + 光滑 → 机械
  if (metalness > 0.5 && roughness < 0.5) {
    return mechTexture(baseColor);
  }

  // 发光强 → 水晶/科技(根据金属度选择)
  if (hasEmissive && metalness < 0.3) {
    return crystalTexture(baseColor, emissive);
  }
  if (hasEmissive && metalness >= 0.3) {
    return techTexture(baseColor, emissive);
  }

  // 粗糙 + 暗 → 石头
  if (roughness > 0.6 && metalness < 0.3) {
    return stoneTexture(baseColor, hasEmissive ? emissive : undefined);
  }

  // 粗糙 + 中等明度 → 有机
  if (roughness > 0.5) {
    return organicTexture(baseColor);
  }

  // 中等金属 + 中等粗糙 → 科技
  if (metalness > 0.3) {
    return techTexture(baseColor, hasEmissive ? emissive : undefined);
  }

  // fallback: 鳞片
  return scaleTexture(baseColor);
}
