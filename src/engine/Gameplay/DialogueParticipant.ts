// DialogueParticipant — 对话参与者(NPC / 玩家 / 旁白)。
//
// 设计:
//   * 纯数据 + setter 的轻量类,不依赖 ECS / World
//   * portrait / mood / voice 都是字符串 ID,由调用方解析为资源(纹理 / 表情 / 音频)
//   * 一个 DialogueParticipant 可被多个 DialogueTree 引用(通过 id)
//
// 不变量:
//   - id 唯一,在同一 DialogueSystem 实例下不能重复注册
//   - mood / voice 为空字符串表示「未设置」,由 UI 决定默认值

/** 对话参与者构造参数。 */
export interface DialogueParticipantOptions {
  id: string;
  name: string;
  portrait?: string;
  mood?: string;
  voice?: string;
}

/**
 * 对话参与者 — 对话中的发言方(NPC、玩家、旁白等)。
 *
 * 持有 id / name / portrait / mood / voice 五个字段:
 *   - id: 在 DialogueSystem.participants 中的唯一键
 *   - name: 显示名(可本地化)
 *   - portrait: 头像资源 ID(由 UI 解析为纹理)
 *   - mood: 当前表情(如 "happy" / "angry" / "neutral"),由 UI 解析
 *   - voice: 音色 ID(由 Audio 系统解析为 AudioClip)
 */
export class DialogueParticipant {
  /** 参与者唯一 ID。 */
  readonly id: string;
  /** 显示名。 */
  name: string;
  /** 头像资源 ID(可选)。 */
  portrait: string;
  /** 当前表情(可选)。 */
  mood: string;
  /** 音色 ID(可选)。 */
  voice: string;

  constructor(options: DialogueParticipantOptions) {
    this.id = options.id;
    this.name = options.name;
    this.portrait = options.portrait ?? '';
    this.mood = options.mood ?? 'neutral';
    this.voice = options.voice ?? '';
  }

  /** 设置当前表情。返回 this 以便链式调用。 */
  setMood(mood: string): this {
    this.mood = mood;
    return this;
  }

  /** 设置音色 ID。返回 this 以便链式调用。 */
  setVoice(voiceId: string): this {
    this.voice = voiceId;
    return this;
  }

  /** 设置头像资源 ID。返回 this 以便链式调用。 */
  setPortrait(portrait: string): this {
    this.portrait = portrait;
    return this;
  }

  /** 序列化为 JSON(用于存档)。 */
  toJSON(): DialogueParticipantOptions {
    return {
      id: this.id,
      name: this.name,
      portrait: this.portrait,
      mood: this.mood,
      voice: this.voice,
    };
  }

  /** 从 JSON 反序列化。 */
  static fromJSON(json: DialogueParticipantOptions): DialogueParticipant {
    return new DialogueParticipant(json);
  }
}
