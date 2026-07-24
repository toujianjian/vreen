// MTLLoader — 解析 Wavefront MTL 材质文件 (.mtl)。
//
// 参考: https://en.wikipedia.org/wiki/Wavefront_.obj_file#Material_template_library
// 支持:
//   - newmtl <name>            开始新材质
//   - Ka/Kd/Ks/Ke r g b        颜色 (0..1 或 0..255)
//   - Tf r g b                 透射滤镜
//   - Ns <float>               高光指数 (shininess)
//   - Ni <float>               光学密度 (refractive index)
//   - d <float>                不透明度 (1=完全不透明)
//   - Tr <float>               透明度 (旧式,= 1 - d)
//   - illum <n>                光照模型编号
//   - map_Kd / map_Ka / map_Ks / map_Ke / map_Ns / map_d / map_bump / bump / disp / refl
//     <options> <path>         纹理贴图引用
//   贴图选项: -s su sv sw (scale), -o ou ov ow (offset), -bm (bump multiplier),
//             -blendu/-blendv on|off, -cc on|off, -clamp on|off,
//             -texres <res>, -mm <base> <gain>, -imfchan r|g|b|m|l|z
//
// 输出: MaterialDescription[] (按 newmtl 出现顺序)。
//
// API:
//   const mats = parseMTL(text);

import {
  AssetSource,
  Loader,
  LoaderContext,
  fetchAsArrayBuffer,
} from './Loader';

/** 单个材质的纹理贴图引用。 */
export interface TextureMapRef {
  /** 文件路径 (相对于 MTL 文件所在目录)。 */
  path: string;
  /** UV scale [su, sv, sw] (默认 [1,1,1])。 */
  scale: [number, number, number];
  /** UV offset [ou, ov, ow] (默认 [0,0,0])。 */
  offset: [number, number, number];
  /** bump multiplier (map_bump 用,默认 1)。 */
  bumpMultiplier: number;
  /** imfchan (scalar 贴图读取通道,默认 'm')。 */
  imfchan?: 'r' | 'g' | 'b' | 'm' | 'l' | 'z';
  /** 颜色校正标志 (-cc)。 */
  colorCorrection?: boolean;
  /** clamp 标志 (-clamp)。 */
  clamp?: boolean;
}

/** MTL 中单个材质的描述 (解析阶段不构造 StandardMaterial,留待调用者转换)。 */
export interface MaterialDescription {
  name: string;
  /** 环境色 (ambient)。 */
  Ka?: [number, number, number];
  /** 漫反射色 (diffuse)。 */
  Kd?: [number, number, number];
  /** 高光色 (specular)。 */
  Ks?: [number, number, number];
  /** 自发光色 (emissive)。 */
  Ke?: [number, number, number];
  /** 透射滤镜。 */
  Tf?: [number, number, number];
  /** 高光指数 (shininess)。 */
  Ns?: number;
  /** 光学密度 (refractive index)。 */
  Ni?: number;
  /** 不透明度 (1=完全不透明,0=完全透明)。 */
  d?: number;
  /** 光照模型编号 (0..10)。 */
  illum?: number;
  /** 漫反射贴图。 */
  mapKd?: TextureMapRef;
  /** 环境贴图。 */
  mapKa?: TextureMapRef;
  /** 高光贴图。 */
  mapKs?: TextureMapRef;
  /** 自发光贴图。 */
  mapKe?: TextureMapRef;
  /** 高光指数贴图。 */
  mapNs?: TextureMapRef;
  /** 不透明度贴图 (scalar)。 */
  mapD?: TextureMapRef;
  /** 凹凸贴图。 */
  mapBump?: TextureMapRef;
  /** 凹凸贴图 (别名)。 */
  bump?: TextureMapRef;
  /** 置换贴图 (scalar)。 */
  disp?: TextureMapRef;
  /** 反射贴图。 */
  refl?: TextureMapRef;
  /** 未知属性 (保留原值,大小写归一为小写键)。 */
  extras: Record<string, string>;
}

/** 解析结果。 */
export interface MTLParseResult {
  /** 材质描述数组 (按出现顺序)。 */
  materials: MaterialDescription[];
  /** 注释行。 */
  comments: string[];
}

export class MTLLoader implements Loader<MaterialDescription[]> {
  readonly format = 'mtl';

  canLoad(source: AssetSource, hints?: Record<string, unknown>): boolean {
    if (hints?.['mime'] === 'text/plain' || hints?.['mime'] === 'chemical/x-mtl') {
      if (source instanceof File) return /\.mtl$/i.test(source.name);
      return true;
    }
    if (source instanceof File) return /\.mtl$/i.test(source.name);
    if (typeof source === 'string') return /\.mtl(\?|$|#)/i.test(source);
    return false;
  }

  async load(source: AssetSource, ctx?: LoaderContext): Promise<MaterialDescription[]> {
    let text: string;
    if (typeof source === 'string' || source instanceof URL) {
      const url = typeof source === 'string' ? source : source.toString();
      const buf = await fetchAsArrayBuffer(url, ctx?.onProgress, ctx?.signal);
      text = new TextDecoder('utf-8').decode(buf);
    } else if (source instanceof File || source instanceof Blob) {
      if (ctx?.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      text = await source.text();
    } else if (source instanceof ArrayBuffer || source instanceof Uint8Array) {
      const u8 = source instanceof Uint8Array ? source : new Uint8Array(source);
      text = new TextDecoder('utf-8').decode(u8);
    } else {
      throw new TypeError('MTLLoader: unsupported source type');
    }
    return parseMTL(text).materials;
  }
}

/**
 * 解析 MTL 文本,返回 { materials, comments }。
 */
export function parseMTL(text: string): MTLParseResult {
  const lines = text.split(/\r\n|\r|\n/);
  const materials: MaterialDescription[] = [];
  const comments: string[] = [];
  let cur: MaterialDescription | null = null;

  for (let raw of lines) {
    // 去掉行尾注释? MTL 不支持行内 #,但容忍性跳过整行注释
    const line = raw.trim();
    if (!line || line.charAt(0) === '#') {
      if (line.charAt(0) === '#') comments.push(line);
      continue;
    }
    const sp = line.indexOf(' ');
    const key = (sp >= 0 ? line.substring(0, sp) : line).toLowerCase();
    const value = (sp >= 0 ? line.substring(sp + 1) : '').trim();

    if (key === 'newmtl') {
      cur = { name: value, extras: {} };
      materials.push(cur);
      continue;
    }
    if (!cur) {
      // 在 newmtl 之前出现的属性:忽略
      continue;
    }

    switch (key) {
      case 'ka': case 'kd': case 'ks': case 'ke': case 'tf': {
        const arr = parseColor(value);
        if (key === 'ka') cur.Ka = arr;
        else if (key === 'kd') cur.Kd = arr;
        else if (key === 'ks') cur.Ks = arr;
        else if (key === 'ke') cur.Ke = arr;
        else cur.Tf = arr;
        break;
      }
      case 'ns': cur.Ns = parseFloat(value); break;
      case 'ni': cur.Ni = parseFloat(value); break;
      case 'd': {
        // d 可能带 -halo 选项
        const tokens = value.split(/\s+/);
        if (tokens[0] === '-halo') tokens.shift();
        cur.d = parseFloat(tokens[0] ?? '1');
        break;
      }
      case 'tr': {
        // Tr = 1 - d (旧式透明度)
        const tr = parseFloat(value);
        cur.d = 1 - tr;
        break;
      }
      case 'illum': cur.illum = parseInt(value, 10); break;
      case 'map_kd': cur.mapKd = parseTextureRef(value); break;
      case 'map_ka': cur.mapKa = parseTextureRef(value); break;
      case 'map_ks': cur.mapKs = parseTextureRef(value); break;
      case 'map_ke': cur.mapKe = parseTextureRef(value); break;
      case 'map_ns': cur.mapNs = parseTextureRef(value); break;
      case 'map_d': cur.mapD = parseTextureRef(value); break;
      case 'map_bump': cur.mapBump = parseTextureRef(value); break;
      case 'bump': cur.bump = parseTextureRef(value); break;
      case 'disp': cur.disp = parseTextureRef(value); break;
      case 'refl': cur.refl = parseTextureRef(value); break;
      default:
        // 其他属性存入 extras
        cur.extras[key] = value;
        break;
    }
  }
  return { materials, comments };
}

// ── 内部工具 ──────────────────────────────────────────────────────────

function parseColor(value: string): [number, number, number] {
  const parts = value.split(/\s+/).filter((s) => s.length > 0);
  const r = parseFloat(parts[0] ?? '0') || 0;
  const g = parseFloat(parts[1] ?? '0') || 0;
  const b = parseFloat(parts[2] ?? '0') || 0;
  // MTL 颜色通常已是 0..1,但部分导出器写 0..255 — 这里不做归一化,
  // 由调用者根据 normalizeRGB 选项决定 (与 three.js 行为一致)。
  return [r, g, b];
}

function parseTextureRef(value: string): TextureMapRef {
  const tokens = value.split(/\s+/);
  const ref: TextureMapRef = {
    path: '',
    scale: [1, 1, 1],
    offset: [0, 0, 0],
    bumpMultiplier: 1,
  };
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === '-s' && i + 3 < tokens.length) {
      ref.scale = [parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2]), parseFloat(tokens[i + 3])];
      i += 4;
    } else if (t === '-o' && i + 3 < tokens.length) {
      ref.offset = [parseFloat(tokens[i + 1]), parseFloat(tokens[i + 2]), parseFloat(tokens[i + 3])];
      i += 4;
    } else if (t === '-bm' && i + 1 < tokens.length) {
      ref.bumpMultiplier = parseFloat(tokens[i + 1]);
      i += 2;
    } else if (t === '-imfchan' && i + 1 < tokens.length) {
      const ch = tokens[i + 1] as TextureMapRef['imfchan'];
      ref.imfchan = ch;
      i += 2;
    } else if (t === '-cc' && i + 1 < tokens.length) {
      ref.colorCorrection = tokens[i + 1] === 'on';
      i += 2;
    } else if (t === '-clamp' && i + 1 < tokens.length) {
      ref.clamp = tokens[i + 1] === 'on';
      i += 2;
    } else if (t.startsWith('-')) {
      // 跳过其他未知选项 (带一个参数)
      i += 2;
    } else {
      // 第一个非选项 token 视为路径
      ref.path = tokens.slice(i).join(' ');
      break;
    }
  }
  return ref;
}
