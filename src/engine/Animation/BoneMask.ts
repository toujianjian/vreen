// BoneMask — selects which bones a layer affects.
//
// 骨骼遮罩:决定动画层影响哪些骨骼。两种模式:
//   • inclusive=true (默认):遮罩"包含"集合中的骨骼 — 只有集合内的骨骼被影响。
//   • inclusive=false:遮罩"排除"集合中的骨骼 — 集合内的骨骼不被影响,其余被影响。
//
// 支持通配符模式(fromPattern):如 "LeftArm*" 匹配所有以 LeftArm 开头的骨骼。
// 模式与显式名称取并集;affects() 综合判断后按 inclusive 取反。

/** 将 glob 通配符转为正则。支持 * (任意字符序列) 和 ? (单字符)。 */
function globToRegex(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if ('.+^${}()|[]\\'.includes(c)) re += '\\' + c;
    else re += c;
  }
  return new RegExp('^' + re + '$');
}

export class BoneMask {
  /** 显式骨骼名集合。 */
  bones: Set<string> = new Set();
  /** true=集合内骨骼被影响;false=集合外骨骼被影响。 */
  inclusive: boolean;
  /** 通配符模式编译后的正则列表。 */
  private patterns: RegExp[] = [];

  constructor(bones: Iterable<string> = [], inclusive: boolean = true) {
    this.bones = new Set(bones);
    this.inclusive = inclusive;
  }

  /** 添加一个显式骨骼名。 */
  include(name: string): this {
    this.bones.add(name);
    return this;
  }

  /** 移除一个显式骨骼名。 */
  exclude(name: string): this {
    this.bones.delete(name);
    return this;
  }

  /** 添加通配符模式。支持 * 和 ?。
   *  如 "LeftArm*" 匹配 LeftArm, LeftForeArm, LeftHand 等。 */
  fromPattern(pattern: string): this {
    this.patterns.push(globToRegex(pattern));
    return this;
  }

  /** 判断此骨骼是否被遮罩影响。
   *  综合显式名称与通配符模式,再按 inclusive 取反。 */
  affects(name: string): boolean {
    let inSet = this.bones.has(name);
    if (!inSet) {
      for (const re of this.patterns) {
        if (re.test(name)) { inSet = true; break; }
      }
    }
    return this.inclusive ? inSet : !inSet;
  }

  /** 清空所有名称与模式。 */
  clear(): this {
    this.bones.clear();
    this.patterns = [];
    return this;
  }
}
