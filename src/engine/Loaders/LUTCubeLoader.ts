// LUTCubeLoader — 解析 DaVinci Resolve / Photoshop / Adobe After Effects
// 导出的 .cube 3D LUT (Look-Up Table) 文件为 RGB Float32 数据。
//
// .cube 格式规范 (IRIDAS .cube, 由 Adobe/Blackmagic 等通用):
//   https://wwwimages2.adobe.com/content/dam/acom/en/products/speedgrade/cc/pdfs/cube-lut-specification-1.0.pdf
//
// 支持:
//   - 3D LUT:   LUT_3D_SIZE N (N^3 个 RGB 表项, 每轴 N 格点)
//   - 1D LUT:   LUT_1D_SIZE N (N 个 RGB 表项, identity ramp)
//   - 定义域:   DOMAIN_MIN / DOMAIN_MAX (-0.125 to 1.125 常见, HDR LUT)
//   - 标题/注释: TITLE "..." , # comment
//   - 浮点表项: 每行 "R G B" (0..1 或 -0.125..1.125 扩展色域)
//   - Baked: baked into N×N² strip layout 用于 WebGL2 3D纹理上传
//
// 用法:
//   const loader = new LUTCubeLoader();
//   const result = await loader.load('/luts/teal-orange.cube');
//   // 数据: result.data = Float32Array (RGB, N*N*N*3, 行优先: B 快轴, R 慢轴)
//   // 3D 纹理上传:
//   //   texImage3D(TEXTURE_3D, 0, RGB16F_EXT, N, N, N, 0, RGB, FLOAT, data);
//   // 2D strip 纹理上传 (N × N²):
//   //   texImage2D(TEXTURE_2D, 0, RGB16F_EXT, N, N*N, 0, RGB, FLOAT, data);
//   // Pass 中使用:
//   //   new LUTPass({ lutSize: result.size, is3D: true, lut: glTex, intensity: 1.0 });
//
// 参考:
//   - three.js examples/jsm/loaders/LUTCubeLoader.js
//   - Adobe Cube LUT 1.0 spec
//   - DaVinci Resolve .cube export format

import { Texture, TextureImage } from '../Core/Texture';
import { Data3DTexture } from '../Core/Data3DTexture';
import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
  toArrayBuffer,
} from './Loader';

/** 解析后的 .cube LUT 结果。 */
export interface LUTCubeResult {
  /** LUT 类型。 */
  type: '1D' | '3D';
  /**
   * 每轴格点数。
   *   - 3D LUT: R × G × B 三轴都是 size (N³ 表项)。
   *   - 1D LUT: 单轴 size (N 表项)。
   */
  size: number;
  /**
   * RGB 数据,行优先布局,每个表项 3 个 float (R, G, B)。
   *   - 3D LUT: 顺序: R 慢轴 → G 中轴 → B 快轴
   *     index = ((rIndex * size) + gIndex) * size + bIndex;
   *     data[index * 3 + 0] = R
   *     data[index * 3 + 1] = G
   *     data[index * 3 + 2] = B
   *   - 1D LUT: data[i * 3 + channel]
   */
  data: Float32Array;
  /** 输入定义域最小(通常 [0,0,0] 或 [-0.125,-0.125,-0.125])。 */
  domainMin: [number, number, number];
  /** 输入定义域最大(通常 [1,1,1] 或 [1.125,1.125,1.125])。 */
  domainMax: [number, number, number];
  /** 标题(TITLE 字段)。 */
  title: string;
  /**
   * VREEN Texture 包装(便于传给 LUTPass,但注意 3D LUT 需要 TEXTURE_3D,
   * 标准 Texture 默认是 2D)。需要 WebGL 端自行处理 3D 纹理上传。
   */
  texture: Texture;
}

export class LUTCubeLoader implements Loader<LUTCubeResult> {
  readonly format = 'cube-lut';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'text/x-cube' || hints?.['mime'] === 'application/x-cube') return true;
    if (hints?.['cubeLut']) return true;
    if (source instanceof File) return /\.cube$/i.test(source.name);
    if (typeof source === 'string') return /\.cube(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<LUTCubeResult> {
    let buf: ArrayBuffer;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
    } else {
      buf = await toArrayBuffer(source);
    }
    const text = new TextDecoder('utf-8').decode(new Uint8Array(buf));
    if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const parsed = parseCube(text); // type: Omit<LUTCubeResult, 'texture'>

    // 2D strip 布局: R slow → G mid → B fast (size × size² for 3D; size × 1 for 1D)
    // Texture 需要 RGBA32F → 把 RGB 填到 RGBA(alpha=1)
    const stripW = parsed.size;
    const stripH = parsed.type === '3D' ? parsed.size * parsed.size : 1;
    const rgbaCount = stripW * stripH;
    const rgbaData = new Float32Array(rgbaCount * 4);
    const src = parsed.data;
    for (let i = 0, si = 0; i < rgbaCount; i++, si += 3) {
      rgbaData[i * 4]     = src[si];
      rgbaData[i * 4 + 1] = src[si + 1];
      rgbaData[i * 4 + 2] = src[si + 2];
      rgbaData[i * 4 + 3] = 1;
    }
    const image: TextureImage = {
      data: rgbaData,
      width: stripW,
      height: stripH,
      format: 'rgba32f',
    };
    const t = new Texture(typeof source === 'string' ? source : 'cube-lut', {
      generateMipmaps: false,
      colorSpace: 'linear',
      wrapS: 'clamp',
      wrapT: 'clamp',
      minFilter: 'linear',
      magFilter: 'linear',
    });
    t.setImage(image);

    const result: LUTCubeResult = {
      type: parsed.type,
      size: parsed.size,
      data: parsed.data,
      domainMin: parsed.domainMin,
      domainMax: parsed.domainMax,
      title: parsed.title,
      texture: t,
    };
    return result;
  }
}

// ── 解析 ────────────────────────────────────────────────────────────
/** @internal Exported for testing */
export function parseCube(text: string): Omit<LUTCubeResult, 'texture'> {
  // 规范化换行,去除 BOM
  text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');

  let type: '1D' | '3D' = '3D'; // 默认 3D
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let title = '';

  // 第一阶段:读头部直到第一个纯数字行
  const dataLines: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line.length === 0) continue;

    // 注释行
    if (line.startsWith('#')) continue;

    // 标题: TITLE "..."
    const titleMatch = line.match(/^TITLE\s+"(.*)"\s*$/i);
    if (titleMatch) {
      title = titleMatch[1];
      continue;
    }
    // 兼容 TITLE 无引号: TITLE xxx
    const titleMatch2 = line.match(/^TITLE\s+(.*)$/i);
    if (titleMatch2 && !/^[-\d.]/.test(titleMatch2[1])) {
      title = titleMatch2[1].trim().replace(/^"|"$/g, '');
      continue;
    }

    // LUT_3D_SIZE N
    const size3DMatch = line.match(/^LUT_3D_SIZE\s+(\d+)\s*$/i);
    if (size3DMatch) {
      type = '3D';
      size = parseInt(size3DMatch[1], 10);
      continue;
    }

    // LUT_1D_SIZE N
    const size1DMatch = line.match(/^LUT_1D_SIZE\s+(\d+)\s*$/i);
    if (size1DMatch) {
      type = '1D';
      size = parseInt(size1DMatch[1], 10);
      continue;
    }

    // DOMAIN_MIN r g b
    const dMinMatch = line.match(/^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i);
    if (dMinMatch) {
      domainMin = [parseFloat(dMinMatch[1]), parseFloat(dMinMatch[2]), parseFloat(dMinMatch[3])];
      continue;
    }

    // DOMAIN_MAX r g b
    const dMaxMatch = line.match(/^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)\s*$/i);
    if (dMaxMatch) {
      domainMax = [parseFloat(dMaxMatch[1]), parseFloat(dMaxMatch[2]), parseFloat(dMaxMatch[3])];
      continue;
    }

    // LUT_1D_INPUT_RANGE / LUT_3D_INPUT_RANGE (可选, 格式: min max)
    if (/^LUT_\dD_INPUT_RANGE\s+/i.test(line)) continue;

    // 数字行 → 数据 (允许浮点格式 ±digits, .eE, 以及 NaN/Infinity)
    if (/^[-+\d.eE]|^(NaN|Infinity|-Infinity)/i.test(line)) {
      dataLines.push(line);
      continue;
    }

    // 其他:跳过 (未知元数据)
  }

  if (size <= 0) {
    // 尝试从数据行数推断(3D LUT 常见 16,32,64;1D LUT 常见 1024/4096)
    const N = dataLines.length;
    if (N <= 0) throw new Error('LUTCubeLoader: no data found, missing LUT_3D_SIZE or LUT_1D_SIZE');
    // 16³ = 4096, 32³ = 32768, 64³ = 262144
    // 1D 通常 1024, 2048, 4096
    let s = 0;
    let t: '1D' | '3D' = '3D';
    for (const cand of [16, 32, 64, 128]) {
      if (cand * cand * cand === N) {
        s = cand; t = '3D'; break;
      }
    }
    if (s === 0) {
      for (const cand of [256, 512, 1024, 2048, 4096, 8192]) {
        if (cand === N) { s = cand; t = '1D'; break; }
      }
    }
    if (s === 0) throw new Error(`LUTCubeLoader: cannot infer LUT size from ${N} data rows`);
    size = s;
    type = t;
  }

  // 解析数据
  const expectedRows = type === '3D' ? size * size * size : size;
  if (dataLines.length < expectedRows) {
    throw new Error(`LUTCubeLoader: too few data rows (${dataLines.length} < ${expectedRows})`);
  }

  const data = new Float32Array(expectedRows * 3);
  let di = 0;
  for (let i = 0; i < expectedRows; i++) {
    const parts = dataLines[i].split(/[\s,;\t]+/).filter(Boolean);
    if (parts.length < 3) {
      throw new Error(`LUTCubeLoader: row ${i} has ${parts.length} components (need 3)`);
    }
    const r = parseFloat(parts[0]);
    const g = parseFloat(parts[1]);
    const b = parseFloat(parts[2]);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) {
      throw new Error(`LUTCubeLoader: row ${i} has non-finite values: [${r}, ${g}, ${b}]`);
    }
    data[di++] = r;
    data[di++] = g;
    data[di++] = b;
  }

  return { type, size, data, domainMin, domainMax, title };
}

/**
 * 把 3D LUT Float32Array (R-slow, G-mid, B-fast) 转成 2D strip 数据
 * (size × size²) 用于 WebGL2 TEXTURE_2D 上传。
 *
 * 输入布局: data[(rIndex*size + gIndex)*size + bIndex) * 3 + c]
 * 输出布局: 每行 g*size + b, 每列 r (R,G,B 交错)
 *   row = gIndex * size + bIndex, col = rIndex
 *   pixelIndex = (row * size + col) * 3 = ((gIndex*size + bIndex) * size + rIndex) * 3
 *
 * @param data 输入 3D LUT RGB 数据
 * @param size LUT 每轴格点数
 * @returns Float32Array 2D strip (size × size², RGB)
 */
export function cube3DToStrip(data: Float32Array, size: number): Float32Array {
  const total = size * size * size * 3;
  if (data.length < total) throw new Error('cube3DToStrip: data too small');
  const out = new Float32Array(total);
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const inIdx = ((r * size + g) * size + b) * 3;
        const row = g * size + b;
        const col = r;
        const outIdx = (row * size + col) * 3;
        out[outIdx]     = data[inIdx];
        out[outIdx + 1] = data[inIdx + 1];
        out[outIdx + 2] = data[inIdx + 2];
      }
    }
  }
  return out;
}

/**
 * 把 2D strip RGB 数据转成 3D LUT Float32Array (cube3DToStrip 的逆操作)。
 */
export function stripToCube3D(strip: Float32Array, size: number): Float32Array {
  const total = size * size * size * 3;
  if (strip.length < total) throw new Error('stripToCube3D: strip data too small');
  const out = new Float32Array(total);
  for (let r = 0; r < size; r++) {
    for (let g = 0; g < size; g++) {
      for (let b = 0; b < size; b++) {
        const row = g * size + b;
        const col = r;
        const stripIdx = (row * size + col) * 3;
        const outIdx = ((r * size + g) * size + b) * 3;
        out[outIdx]     = strip[stripIdx];
        out[outIdx + 1] = strip[stripIdx + 1];
        out[outIdx + 2] = strip[stripIdx + 2];
      }
    }
  }
  return out;
}

/**
 * 把 parseCube() 的 RGB Float32Array 结果转为 Data3DTexture (WebGL2 TEXTURE_3D)。
 *
 * 数据布局: R-slow → G-mid → B-fast (行优先),与 texImage3D 的 depth/height/width
 * 顺序一致。采样时 texture(sampler3D, vec3(r,g,b)) 直接返回 LUT 映射颜色。
 *
 * 仅适用于 3D LUT(type === '3D')。1D LUT 请使用 result.texture(2D strip)。
 *
 * @param parsed parseCube() 的返回值
 * @returns Data3DTexture,format='rgb',type='float',wrap=clamp,filter=linear
 */
export function toData3DTexture(
  parsed: Omit<LUTCubeResult, 'texture'>,
): Data3DTexture {
  if (parsed.type !== '3D') {
    throw new Error('toData3DTexture: only 3D LUTs can be converted to Data3DTexture');
  }
  const N = parsed.size;
  // Data3DTexture 期望 RGB float 数据: N×N×N×3
  // parseCube 已经按 R-slow → G-mid → B-fast 排列,直接使用
  const tex = new Data3DTexture(
    parsed.data,
    N, N, N,
    {
      format: 'rgb',
      type: 'float',
      wrapR: 'clamp',
      wrapS: 'clamp',
      wrapT: 'clamp',
      minFilter: 'linear',
      magFilter: 'linear',
      generateMipmaps: false,
      colorSpace: 'linear',
      flipY: false,
      unpackAlignment: 1,
    },
  );
  tex.name = parsed.title || `lut-3d-${N}`;
  return tex;
}
