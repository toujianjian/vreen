// PhysicsMaterial — 物理材质(摩擦 / 弹性 / 密度 / 断裂 / 塑性 / 自定义属性)。
//
// 设计:
//   * 纯数据类,不依赖渲染材质(BasicMaterial / StandardMaterial)与 ECS 组件,
//     由物理系统(CollisionSystem / DestructionSystem / ConstraintSolver)按需引用。
//   * 同时覆盖"接触力学"(摩擦 / 弹性 / 阻尼)与"连续介质力学"(杨氏模量 /
//     泊松比 / 屈服 / 抗拉 / 抗压 / 断裂韧性)两类参数,前者用于刚体碰撞响应,
//     后者用于破坏系统(VoronoiFracture / DestructionSystem)的应力判断。
//   * combine() 提供两材质接触时的合并策略(平均 / 最小 / 最大 / 乘积),
//     物理求解器据此取接触面等效摩擦 / 弹性。
//   * 预设工厂:createMetal / createWood / createRubber / createGlass /
//     createConcrete / createIce / createFlesh,参数取自常见工程手册近似值。
//
// 与 ECS Rigidbody 的关系:
//   * Rigidbody 持有质量 / 速度 / 角速度等运动学量;PhysicsMaterial 描述
//     "由什么构成",提供 computeMass(volume) 把密度 × 体积换算为质量。
//   * 物理系统在接触求解时,从两端 Rigidbody 引用的 PhysicsMaterial 调用
//     combine() 得到接触面等效参数,再计算冲量 / 摩擦 / 弹性恢复。
//
// 用法:
//   const mat = PhysicsMaterial.createMetal();
//   mat.setRestitution(0.3).setFriction(0.6, 0.5);
//   const mass = mat.computeMass(0.5);  // 0.5 m³ 钢材 → ~3950 kg

/** 材质合并策略(两材质接触时取等效值)。 */
export type PhysicsCombineMode = 'average' | 'min' | 'max' | 'multiply';

/** PhysicsMaterial 构造选项。所有字段可选,缺省值取自通用"硬塑料"。 */
export interface PhysicsMaterialOptions {
  /** 静摩擦系数(>=0)。 */
  friction?: number;
  /** 动摩擦系数(>=0,通常 <= friction)。 */
  dynamicFriction?: number;
  /** 弹性系数 [0,1],0 = 完全非弹性,1 = 完全弹性。 */
  restitution?: number;
  /** 密度 kg/m³(>0)。 */
  density?: number;
  /** 杨氏模量 Pa(>0,弹性变形刚度)。 */
  youngsModulus?: number;
  /** 泊松比 [-1, 0.5],横向 / 纵向应变比。 */
  poissonsRatio?: number;
  /** 屈服强度 Pa(>=0,开始塑性变形的应力)。 */
  yieldStrength?: number;
  /** 抗拉强度 Pa(>=0)。 */
  tensileStrength?: number;
  /** 抗压强度 Pa(>=0)。 */
  compressiveStrength?: number;
  /** 断裂韧性 Pa·√m(>=0,裂纹扩展临界应力强度因子)。 */
  fractureToughness?: number;
  /** 阻尼系数 [0,1] 或 >=0(运动能量耗散率)。 */
  damping?: number;
  /** 是否塑性(屈服后永久变形)。 */
  isPlastic?: boolean;
  /** 塑性阈值 Pa(>=0,超过此应力开始塑性流动)。 */
  plasticThreshold?: number;
  /** 热膨胀系数 1/K(>=0)。 */
  thermalExpansion?: number;
}

/** PhysicsMaterial 统计摘要。 */
export interface PhysicsMaterialStats {
  /** 摩擦系数(静)。 */
  friction: number;
  /** 弹性系数。 */
  restitution: number;
  /** 密度 kg/m³。 */
  density: number;
  /** 杨氏模量 Pa。 */
  youngsModulus: number;
  /** 是否塑性。 */
  isPlastic: number;
  /** 自定义属性数量。 */
  customPropertyCount: number;
  /** 估算"硬度等级"0..1(由杨氏模量归一化,咨询性)。 */
  hardness: number;
}

/**
 * 物理材质 — 描述刚体 / 可破坏物体的接触与连续介质力学参数。
 *
 * 不持有 GPU 资源,无副作用;可被多个 Rigidbody / Destructible 共享引用。
 */
export class PhysicsMaterial {
  /** 类型标志(用于序列化与运行时判别)。 */
  readonly type: string = 'PhysicsMaterial';
  /** instanceof 替代检测标志。 */
  readonly isPhysicsMaterial: boolean = true;

  /** 静摩擦系数(>=0)。 */
  friction: number = 0.5;
  /** 动摩擦系数(>=0,通常 <= friction)。 */
  dynamicFriction: number = 0.4;
  /** 弹性系数 [0,1]。 */
  restitution: number = 0.3;
  /** 密度 kg/m³(>0)。 */
  density: number = 1000;
  /** 杨氏模量 Pa(>0)。 */
  youngsModulus: number = 2e9;
  /** 泊松比 [-1, 0.5]。 */
  poissonsRatio: number = 0.3;
  /** 屈服强度 Pa(>=0)。 */
  yieldStrength: number = 2e7;
  /** 抗拉强度 Pa(>=0)。 */
  tensileStrength: number = 3e7;
  /** 抗压强度 Pa(>=0)。 */
  compressiveStrength: number = 4e7;
  /** 断裂韧性 Pa·√m(>=0)。 */
  fractureToughness: number = 1e6;
  /** 阻尼系数(>=0)。 */
  damping: number = 0.05;
  /** 是否塑性。 */
  isPlastic: boolean = false;
  /** 塑性阈值 Pa(>=0)。 */
  plasticThreshold: number = 2e7;
  /** 热膨胀系数 1/K(>=0)。 */
  thermalExpansion: number = 5e-6;

  /** 自定义物理属性表(名称 → 数值),供扩展(如声速、孔隙率)。 */
  customProperties: Map<string, number> = new Map();

  constructor(opts: PhysicsMaterialOptions = {}) {
    if (opts.friction !== undefined) this.friction = Math.max(0, opts.friction);
    if (opts.dynamicFriction !== undefined) this.dynamicFriction = Math.max(0, opts.dynamicFriction);
    if (opts.restitution !== undefined) this.restitution = clamp01(opts.restitution);
    if (opts.density !== undefined) this.density = Math.max(0, opts.density);
    if (opts.youngsModulus !== undefined) this.youngsModulus = Math.max(0, opts.youngsModulus);
    if (opts.poissonsRatio !== undefined) this.poissonsRatio = clamp(opts.poissonsRatio, -1, 0.5);
    if (opts.yieldStrength !== undefined) this.yieldStrength = Math.max(0, opts.yieldStrength);
    if (opts.tensileStrength !== undefined) this.tensileStrength = Math.max(0, opts.tensileStrength);
    if (opts.compressiveStrength !== undefined) this.compressiveStrength = Math.max(0, opts.compressiveStrength);
    if (opts.fractureToughness !== undefined) this.fractureToughness = Math.max(0, opts.fractureToughness);
    if (opts.damping !== undefined) this.damping = Math.max(0, opts.damping);
    if (opts.isPlastic !== undefined) this.isPlastic = opts.isPlastic;
    if (opts.plasticThreshold !== undefined) this.plasticThreshold = Math.max(0, opts.plasticThreshold);
    if (opts.thermalExpansion !== undefined) this.thermalExpansion = Math.max(0, opts.thermalExpansion);
  }

  // ── setter(链式) ───────────────────────────────────────────────

  /**
   * 设置摩擦系数。
   * @param s 静摩擦(>=0)
   * @param d 动摩擦(>=0,缺省 = 静摩擦 * 0.8)
   */
  setFriction(s: number, d?: number): this {
    this.friction = Math.max(0, s);
    this.dynamicFriction = Math.max(0, d ?? s * 0.8);
    return this;
  }

  /**
   * 设置弹性系数。
   * @param r [0,1],0 = 完全非弹性碰撞,1 = 完全弹性
   */
  setRestitution(r: number): this {
    this.restitution = clamp01(r);
    return this;
  }

  /**
   * 设置密度。
   * @param d kg/m³(>0)
   */
  setDensity(d: number): this {
    this.density = Math.max(0, d);
    return this;
  }

  /**
   * 设置弹性(连续介质力学)。
   * @param youngs   杨氏模量 Pa(>0,刚度)
   * @param poissons 泊松比 [-1, 0.5]
   */
  setElasticity(youngs: number, poissons: number): this {
    this.youngsModulus = Math.max(0, youngs);
    this.poissonsRatio = clamp(poissons, -1, 0.5);
    return this;
  }

  /**
   * 设置强度参数。
   * @param yieldStrength   屈服强度 Pa
   * @param tensileStrength 抗拉强度 Pa
   * @param compressive     抗压强度 Pa
   */
  setStrength(yieldStrength: number, tensileStrength: number, compressive: number): this {
    this.yieldStrength = Math.max(0, yieldStrength);
    this.tensileStrength = Math.max(0, tensileStrength);
    this.compressiveStrength = Math.max(0, compressive);
    return this;
  }

  /**
   * 设置断裂韧性。
   * @param toughness Pa·√m(>=0)
   */
  setFracture(toughness: number): this {
    this.fractureToughness = Math.max(0, toughness);
    return this;
  }

  /**
   * 设置阻尼系数。
   * @param d >=0(0 = 无阻尼)
   */
  setDamping(d: number): this {
    this.damping = Math.max(0, d);
    return this;
  }

  /**
   * 设置塑性。
   * @param enabled  是否启用塑性变形
   * @param threshold 塑性阈值 Pa(>=0)
   */
  setPlastic(enabled: boolean, threshold: number): this {
    this.isPlastic = enabled;
    this.plasticThreshold = Math.max(0, threshold);
    return this;
  }

  /**
   * 设置热膨胀系数。
   * @param coeff 1/K(>=0)
   */
  setThermalExpansion(coeff: number): this {
    this.thermalExpansion = Math.max(0, coeff);
    return this;
  }

  /**
   * 设置自定义物理属性。
   * @param name  属性名(如 "porosity" / "acousticVelocity")
   * @param value 数值
   */
  setCustom(name: string, value: number): this {
    this.customProperties.set(name, value);
    return this;
  }

  /**
   * 获取自定义物理属性。
   * @param name 属性名
   * @returns 数值;不存在返回 undefined
   */
  getCustom(name: string): number | undefined {
    return this.customProperties.get(name);
  }

  // ── 力学计算 ─────────────────────────────────────────────────────

  /**
   * 计算质量(密度 × 体积)。
   * @param volume m³(>=0)
   * @returns kg
   */
  computeMass(volume: number): number {
    return Math.max(0, volume) * this.density;
  }

  /**
   * 计算应力(力 / 截面积)。
   * @param force N(>=0,轴向力大小)
   * @param area  m²(>0)
   * @returns Pa
   */
  computeStress(force: number, area: number): number {
    if (area <= 0) return 0;
    return Math.max(0, force) / area;
  }

  /**
   * 计算应变(胡克定律:σ = E·ε → ε = σ / E)。
   * @param stress Pa
   * @returns 无量纲应变(杨氏模量为 0 时返回 0)
   */
  computeStrain(stress: number): number {
    if (this.youngsModulus <= 0) return 0;
    return stress / this.youngsModulus;
  }

  /**
   * 是否屈服(应力超过屈服强度,且材质为塑性或强度有效)。
   * @param stress Pa
   * @returns true 表示进入塑性区
   */
  isYield(stress: number): boolean {
    if (this.yieldStrength <= 0) return false;
    return stress > this.yieldStrength;
  }

  /**
   * 是否断裂(应力超过抗拉强度,或超过塑性阈值且为塑性材质)。
   * @param stress Pa
   * @returns true 表示发生断裂
   */
  isFracture(stress: number): boolean {
    if (this.tensileStrength > 0 && stress > this.tensileStrength) return true;
    if (this.isPlastic && this.plasticThreshold > 0 && stress > this.plasticThreshold) return true;
    return false;
  }

  /**
   * 合并两材质(接触面等效参数)。
   *
   * 仅合并"接触力学"字段(friction / dynamicFriction / restitution / damping);
   * 密度 / 强度 / 弹性等"本体属性"不参与合并(取 this 值)。
   *
   * @param other 另一材质
   * @param mode  合并策略
   * @returns 新 PhysicsMaterial(不修改 this / other)
   */
  combine(other: PhysicsMaterial, mode: PhysicsCombineMode = 'average'): PhysicsMaterial {
    const result = new PhysicsMaterial({
      friction: combineValues(this.friction, other.friction, mode),
      dynamicFriction: combineValues(this.dynamicFriction, other.dynamicFriction, mode),
      restitution: combineValues(this.restitution, other.restitution, mode),
      damping: combineValues(this.damping, other.damping, mode),
      // 本体属性沿用 this
      density: this.density,
      youngsModulus: this.youngsModulus,
      poissonsRatio: this.poissonsRatio,
      yieldStrength: this.yieldStrength,
      tensileStrength: this.tensileStrength,
      compressiveStrength: this.compressiveStrength,
      fractureToughness: this.fractureToughness,
      isPlastic: this.isPlastic,
      plasticThreshold: this.plasticThreshold,
      thermalExpansion: this.thermalExpansion,
    });
    // 合并自定义属性(this 优先,other 补充)
    for (const [k, v] of other.customProperties) {
      if (!result.customProperties.has(k)) result.customProperties.set(k, v);
    }
    for (const [k, v] of this.customProperties) {
      result.customProperties.set(k, v);
    }
    return result;
  }

  // ── 序列化 / 克隆 / 统计 ─────────────────────────────────────────

  /** 序列化为 JSON 对象。 */
  toJSON(): Record<string, unknown> {
    return {
      type: this.type,
      friction: this.friction,
      dynamicFriction: this.dynamicFriction,
      restitution: this.restitution,
      density: this.density,
      youngsModulus: this.youngsModulus,
      poissonsRatio: this.poissonsRatio,
      yieldStrength: this.yieldStrength,
      tensileStrength: this.tensileStrength,
      compressiveStrength: this.compressiveStrength,
      fractureToughness: this.fractureToughness,
      damping: this.damping,
      isPlastic: this.isPlastic,
      plasticThreshold: this.plasticThreshold,
      thermalExpansion: this.thermalExpansion,
      customProperties: Object.fromEntries(this.customProperties),
    };
  }

  /** 从 JSON 对象反序列化(返回 this)。 */
  fromJSON(data: Record<string, unknown>): this {
    if (typeof data.friction === 'number') this.friction = Math.max(0, data.friction);
    if (typeof data.dynamicFriction === 'number') this.dynamicFriction = Math.max(0, data.dynamicFriction);
    if (typeof data.restitution === 'number') this.restitution = clamp01(data.restitution);
    if (typeof data.density === 'number') this.density = Math.max(0, data.density);
    if (typeof data.youngsModulus === 'number') this.youngsModulus = Math.max(0, data.youngsModulus);
    if (typeof data.poissonsRatio === 'number') this.poissonsRatio = clamp(data.poissonsRatio, -1, 0.5);
    if (typeof data.yieldStrength === 'number') this.yieldStrength = Math.max(0, data.yieldStrength);
    if (typeof data.tensileStrength === 'number') this.tensileStrength = Math.max(0, data.tensileStrength);
    if (typeof data.compressiveStrength === 'number') this.compressiveStrength = Math.max(0, data.compressiveStrength);
    if (typeof data.fractureToughness === 'number') this.fractureToughness = Math.max(0, data.fractureToughness);
    if (typeof data.damping === 'number') this.damping = Math.max(0, data.damping);
    if (typeof data.isPlastic === 'boolean') this.isPlastic = data.isPlastic;
    if (typeof data.plasticThreshold === 'number') this.plasticThreshold = Math.max(0, data.plasticThreshold);
    if (typeof data.thermalExpansion === 'number') this.thermalExpansion = Math.max(0, data.thermalExpansion);
    if (data.customProperties && typeof data.customProperties === 'object') {
      const obj = data.customProperties as Record<string, unknown>;
      this.customProperties = new Map();
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        if (typeof v === 'number') this.customProperties.set(k, v);
      }
    }
    return this;
  }

  /** 从 source 复制所有字段到 this,返回 this。 */
  copy(source: PhysicsMaterial): this {
    this.friction = source.friction;
    this.dynamicFriction = source.dynamicFriction;
    this.restitution = source.restitution;
    this.density = source.density;
    this.youngsModulus = source.youngsModulus;
    this.poissonsRatio = source.poissonsRatio;
    this.yieldStrength = source.yieldStrength;
    this.tensileStrength = source.tensileStrength;
    this.compressiveStrength = source.compressiveStrength;
    this.fractureToughness = source.fractureToughness;
    this.damping = source.damping;
    this.isPlastic = source.isPlastic;
    this.plasticThreshold = source.plasticThreshold;
    this.thermalExpansion = source.thermalExpansion;
    this.customProperties = new Map(source.customProperties);
    return this;
  }

  /** 深拷贝:返回与 this 等价但独立的新实例。 */
  clone(): PhysicsMaterial {
    return new PhysicsMaterial().copy(this);
  }

  /** 获取统计摘要。 */
  getStats(): PhysicsMaterialStats {
    // 硬度归一化:杨氏模量 1e5(软橡胶)~ 1e12(钻石)映射到 0..1
    const logE = Math.log10(Math.max(this.youngsModulus, 1));
    const hardness = clamp01((logE - 5) / 7);
    return {
      friction: this.friction,
      restitution: this.restitution,
      density: this.density,
      youngsModulus: this.youngsModulus,
      isPlastic: this.isPlastic ? 1 : 0,
      customPropertyCount: this.customProperties.size,
      hardness,
    };
  }

  // ── 预设工厂 ─────────────────────────────────────────────────────

  /**
   * 金属(钢)预设:高密度 / 高弹性模量 / 高屈服 / 塑性。
   * 密度 7850 kg/m³,杨氏模量 200 GPa,屈服 250 MPa,断裂韧性 50 MPa·√m。
   */
  static createMetal(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.6,
      dynamicFriction: 0.4,
      restitution: 0.3,
      density: 7850,
      youngsModulus: 200e9,
      poissonsRatio: 0.3,
      yieldStrength: 250e6,
      tensileStrength: 400e6,
      compressiveStrength: 250e6,
      fractureToughness: 50e6,
      damping: 0.02,
      isPlastic: true,
      plasticThreshold: 250e6,
      thermalExpansion: 12e-6,
    });
  }

  /**
   * 木材(橡木)预设:中密度 / 各向异性近似 / 中等强度。
   * 密度 750 kg/m³,杨氏模量 11 GPa,屈服 50 MPa,断裂韧性 8 MPa·√m。
   */
  static createWood(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.5,
      dynamicFriction: 0.4,
      restitution: 0.2,
      density: 750,
      youngsModulus: 11e9,
      poissonsRatio: 0.4,
      yieldStrength: 50e6,
      tensileStrength: 90e6,
      compressiveStrength: 50e6,
      fractureToughness: 8e6,
      damping: 0.08,
      isPlastic: false,
      plasticThreshold: 50e6,
      thermalExpansion: 5e-6,
    });
  }

  /**
   * 橡胶预设:低密度 / 极低弹性模量 / 高弹性 / 高阻尼。
   * 密度 1100 kg/m³,杨氏模量 5 MPa,弹性 0.85,阻尼 0.3。
   */
  static createRubber(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.9,
      dynamicFriction: 0.8,
      restitution: 0.85,
      density: 1100,
      youngsModulus: 5e6,
      poissonsRatio: 0.49,
      yieldStrength: 20e6,
      tensileStrength: 25e6,
      compressiveStrength: 30e6,
      fractureToughness: 2e6,
      damping: 0.3,
      isPlastic: false,
      plasticThreshold: 20e6,
      thermalExpansion: 200e-6,
    });
  }

  /**
   * 玻璃预设:高密度 / 高弹性模量 / 脆性(低断裂韧性) / 无塑性。
   * 密度 2500 kg/m³,杨氏模量 70 GPa,断裂韧性 0.7 MPa·√m。
   */
  static createGlass(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.4,
      dynamicFriction: 0.3,
      restitution: 0.5,
      density: 2500,
      youngsModulus: 70e9,
      poissonsRatio: 0.22,
      yieldStrength: 50e6,
      tensileStrength: 50e6,
      compressiveStrength: 1000e6,
      fractureToughness: 0.7e6,
      damping: 0.01,
      isPlastic: false,
      plasticThreshold: 50e6,
      thermalExpansion: 9e-6,
    });
  }

  /**
   * 混凝土预设:中密度 / 高抗压 / 低抗拉 / 脆性。
   * 密度 2400 kg/m³,杨氏模量 30 GPa,抗压 30 MPa,抗拉 3 MPa。
   */
  static createConcrete(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.7,
      dynamicFriction: 0.6,
      restitution: 0.1,
      density: 2400,
      youngsModulus: 30e9,
      poissonsRatio: 0.2,
      yieldStrength: 30e6,
      tensileStrength: 3e6,
      compressiveStrength: 30e6,
      fractureToughness: 1e6,
      damping: 0.05,
      isPlastic: false,
      plasticThreshold: 30e6,
      thermalExpansion: 10e-6,
    });
  }

  /**
   * 冰预设:低密度 / 中等弹性 / 脆性 / 低摩擦。
   * 密度 917 kg/m³,杨氏模量 9 GPa,断裂韧性 0.1 MPa·√m,摩擦 0.05。
   */
  static createIce(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.05,
      dynamicFriction: 0.03,
      restitution: 0.4,
      density: 917,
      youngsModulus: 9e9,
      poissonsRatio: 0.33,
      yieldStrength: 5e6,
      tensileStrength: 1e6,
      compressiveStrength: 5e6,
      fractureToughness: 0.1e6,
      damping: 0.02,
      isPlastic: false,
      plasticThreshold: 5e6,
      thermalExpansion: 50e-6,
    });
  }

  /**
   * 血肉(软组织)预设:中密度 / 极低弹性模量 / 高塑性 / 高阻尼。
   * 密度 1060 kg/m³,杨氏模量 20 kPa,阻尼 0.4,塑性。
   */
  static createFlesh(): PhysicsMaterial {
    return new PhysicsMaterial({
      friction: 0.6,
      dynamicFriction: 0.5,
      restitution: 0.1,
      density: 1060,
      youngsModulus: 20e3,
      poissonsRatio: 0.49,
      yieldStrength: 0.1e6,
      tensileStrength: 0.2e6,
      compressiveStrength: 0.1e6,
      fractureToughness: 0.5e6,
      damping: 0.4,
      isPlastic: true,
      plasticThreshold: 0.1e6,
      thermalExpansion: 30e-6,
    });
  }

  /** 释放资源(本类无外部资源,no-op)。可重复调用。 */
  dispose(): void {
    this.customProperties.clear();
  }
}

// ── 工具函数 ─────────────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 按 mode 合并两个数值。 */
function combineValues(a: number, b: number, mode: PhysicsCombineMode): number {
  switch (mode) {
    case 'average':
      return (a + b) * 0.5;
    case 'min':
      return Math.min(a, b);
    case 'max':
      return Math.max(a, b);
    case 'multiply':
      return a * b;
    default:
      return (a + b) * 0.5;
  }
}
