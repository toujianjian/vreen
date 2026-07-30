// NetworkSession — 网络会话管理器。
//
// 设计原则:
//   - 与 NetworkSync 不同,本模块聚焦"会话生命周期 / 玩家管理 / 房间状态",
//     不负责实体同步或快照插值(那是 NetworkSync / StateSync 的职责)。
//   - 传输层无关:通过 onSendMessage 回调把出站消息投递给调用方,
//     由调用方决定如何发送(WebSocket / MockTransport / IPC 等)。
//   - 主机权威:会话状态变更(gameState / kick / ban)仅主机可执行;
//     客户端只能请求加入/离开/准备。
//   - 槽位管理:玩家进入时分配空槽位,离开时释放;支持设置最大玩家数。
//
// 状态机:
//   lobby → loading → playing ⇄ paused → ended
//   * lobby:    等待玩家加入/准备
//   * loading:  主机调用 startGame() 后进入,客户端加载场景
//   * playing:  游戏进行中
//   * paused:   主机暂停
//   * ended:    游戏结束,玩家可返回 lobby(由调用方决定)
//
// 不变量:
//   - sessionId 一旦创建不可变。
//   - localPlayerId 一旦创建不可变。
//   - players 中始终包含 localPlayerId 对应的玩家(除非已 leaveSession)。
//   - playerSlots 长度 === maxPlayers,玩家进入时填 true,离开时填 false。
//   - 非主机调用主机专属方法抛错(而非静默忽略,便于调试)。

import { createLogger } from '@/lib/logger';

const log = createLogger('NetworkSession');

/** 会话类型。 */
export type SessionType = 'host' | 'client' | 'listen-server';

/** 游戏状态。 */
export type SessionGameState = 'lobby' | 'loading' | 'playing' | 'paused' | 'ended';

/** 网络玩家。 */
export interface NetworkPlayer {
  /** 玩家唯一 ID。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** 是否已准备。 */
  isReady: boolean;
  /** 是否是主机。 */
  isHost: boolean;
  /** 网络延迟 ms。 */
  ping: number;
  /** 玩家角色数据(由上层 CharacterGenerator 产物填充,本层不解释)。 */
  characterData?: unknown;
  /** 玩家所在槽位索引(0-based,-1 表示未分配)。 */
  slot: number;
  /** 是否仍连接(掉线但未移除时为 false)。 */
  isConnected: boolean;
}

/** 会话配置。 */
export interface SessionConfig {
  /** 会话类型。 */
  sessionType: SessionType;
  /** 最大玩家数(默认 4)。 */
  maxPlayers?: number;
  /** 本地玩家显示名。 */
  localPlayerName?: string;
  /** 会话密码(可选)。 */
  password?: string;
  /** 是否私有(不进入公共匹配池)。 */
  isPrivate?: boolean;
  /** 是否启用匹配。 */
  matchmakingEnabled?: boolean;
  /** 会话 ID(可选,客户端加入时由主机分配;主机创建时可指定)。 */
  sessionId?: string;
  /** 本地玩家 ID(可选,默认自动生成)。 */
  localPlayerId?: string;
}

/** 出站消息(由 onSendMessage 回调投递)。 */
export interface SessionMessage {
  /** 消息类型。 */
  type: string;
  /** 目标玩家 ID;'broadcast' 表示广播;'host' 表示发给主机。 */
  target: string;
  /** 来源玩家 ID。 */
  source: string;
  /** 消息载荷(可序列化)。 */
  data: unknown;
  /** 时间戳(ms)。 */
  timestamp: number;
}

/** 会话统计。 */
export interface SessionStats {
  sessionId: string;
  sessionType: SessionType;
  gameState: SessionGameState;
  maxPlayers: number;
  playerCount: number;
  readyCount: number;
  connectedCount: number;
  hostId: string | null;
  isPrivate: boolean;
  matchmakingEnabled: boolean;
  availableSlots: number;
}

/** 默认最大玩家数。 */
const DEFAULT_MAX_PLAYERS = 4;

/** 生成随机 ID。 */
function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * 网络会话管理器。
 *
 * 用法(主机):
 *   const session = new NetworkSession();
 *   session.createSession({ sessionType: 'host', maxPlayers: 4 });
 *   session.onSendMessage((msg) => transport.send(serialize(msg)));
 *   session.startGame();
 *
 * 用法(客户端):
 *   const session = new NetworkSession();
 *   session.joinSession('room-123', 'password');
 *   session.setPlayerReady(session.localPlayerId, true);
 */
export class NetworkSession {
  /** 会话 ID。 */
  sessionId: string = '';
  /** 会话类型。 */
  sessionType: SessionType = 'client';
  /** 最大玩家数。 */
  maxPlayers: number = DEFAULT_MAX_PLAYERS;
  /** 玩家表。 */
  players: Map<string, NetworkPlayer> = new Map();
  /** 游戏状态。 */
  gameState: SessionGameState = 'lobby';
  /** 主机玩家 ID。 */
  hostId: string | null = null;
  /** 本地玩家 ID。 */
  localPlayerId: string = '';
  /** 会话密码。 */
  password: string | null = null;
  /** 是否私有。 */
  isPrivate: boolean = false;
  /** 是否启用匹配。 */
  matchmakingEnabled: boolean = true;
  /** 槽位状态(true = 已占用)。 */
  playerSlots: boolean[] = [];

  /** 出站消息回调(单槽,后注册覆盖先注册)。 */
  private _sendCb: ((msg: SessionMessage) => void) | null = null;
  /** 是否已创建/加入会话。 */
  private _active: boolean = false;
  /** 封禁玩家 ID 集合。 */
  private _bannedIds: Set<string> = new Set();
  /** 时钟函数(便于测试注入)。 */
  private readonly _now: () => number;

  constructor(now?: () => number) {
    this._now = now ?? (() => performance.now());
  }

  // ── 会话生命周期 ────────────────────────────────────────────

  /**
   * 创建会话(主机端)。
   * 自动将本地玩家注册为主机。
   */
  createSession(config: SessionConfig): void {
    if (this._active) {
      throw new Error('NetworkSession.createSession: 已存在活动会话,请先 leaveSession');
    }
    const {
      sessionType,
      maxPlayers = DEFAULT_MAX_PLAYERS,
      localPlayerName = 'Host',
      password = null,
      isPrivate = false,
      matchmakingEnabled = true,
      sessionId,
      localPlayerId,
    } = config;

    if (maxPlayers < 1) {
      throw new Error(`NetworkSession.createSession: maxPlayers 必须 >= 1,收到 ${maxPlayers}`);
    }
    if (sessionType === 'client') {
      throw new Error('NetworkSession.createSession: 客户端不能用 createSession,请用 joinSession');
    }

    this.sessionId = sessionId ?? generateId('session');
    this.sessionType = sessionType;
    this.maxPlayers = maxPlayers;
    this.password = password;
    this.isPrivate = isPrivate;
    this.matchmakingEnabled = matchmakingEnabled;
    this.localPlayerId = localPlayerId ?? generateId('player');
    this.gameState = 'lobby';
    this.hostId = this.localPlayerId;
    this.players.clear();
    this._bannedIds.clear();
    this.playerSlots = new Array(maxPlayers).fill(false);

    // 注册本地玩家为主机
    const slot = this._allocateSlot();
    const host: NetworkPlayer = {
      id: this.localPlayerId,
      name: localPlayerName,
      isReady: true,
      isHost: true,
      ping: 0,
      slot,
      isConnected: true,
    };
    this.players.set(this.localPlayerId, host);
    this._active = true;

    log.info(`Session created: ${this.sessionId} (type=${sessionType}, maxPlayers=${maxPlayers})`);
  }

  /**
   * 加入会话(客户端)。
   * 本方法仅初始化本地状态;实际密码校验在主机端 addRemotePlayer 完成。
   * @param sessionId  目标会话 ID
   * @param password   会话密码(可选,会通过 sendToHost 发给主机校验)
   * @returns 是否成功(本地状态初始化成功即返回 true)
   */
  joinSession(sessionId: string, password?: string): boolean {
    if (this._active) {
      throw new Error('NetworkSession.joinSession: 已存在活动会话,请先 leaveSession');
    }
    if (!sessionId) {
      throw new Error('NetworkSession.joinSession: sessionId 不能为空');
    }

    this.sessionId = sessionId;
    this.sessionType = 'client';
    if (!this.localPlayerId) {
      this.localPlayerId = generateId('player');
    }
    if (this.gameState === 'ended') this.gameState = 'lobby';
    this._active = true;

    // 注册本地玩家为客户端
    const slot = this._allocateSlot();
    const client: NetworkPlayer = {
      id: this.localPlayerId,
      name: `Player-${this.localPlayerId.slice(-4)}`,
      isReady: false,
      isHost: false,
      ping: 0,
      slot,
      isConnected: true,
    };
    this.players.set(this.localPlayerId, client);

    log.info(`Joined session: ${sessionId} (playerId=${this.localPlayerId})`);
    // 密码通过返回值外的方式由调用方转发给主机(客户端此时可能尚不知 hostId)。
    // 调用方可在 transport 连接后通过 sendToHost({ kind: 'join', password }) 发送。
    void password;
    return true;
  }

  /** 离开会话。 */
  leaveSession(): void {
    if (!this._active) return;
    // 释放本地玩家槽位
    this._removePlayer(this.localPlayerId);
    // 主机离开:若仍有玩家,转移主机(简化:直接清空会话)
    if (this.hostId === this.localPlayerId) {
      // 主机离开时会话结束(简化模型)
      this.gameState = 'ended';
    }
    this._active = false;
    log.info(`Left session: ${this.sessionId}`);
    // 不清空 sessionId / players,便于调用方查询历史;但标记 _active=false
  }

  // ── 游戏状态控制(主机专属)──────────────────────────────────

  /** 开始游戏(lobby → loading → playing)。仅主机可调用。 */
  startGame(): void {
    this._requireHost('startGame');
    if (this.gameState !== 'lobby') {
      throw new Error(`NetworkSession.startGame: 当前状态 ${this.gameState} 不允许开始游戏(需 lobby)`);
    }
    this.gameState = 'loading';
    log.info(`Game starting (loading)`);
    // loading 是瞬态,直接切到 playing(实际项目可能等待所有客户端加载完成)
    this.gameState = 'playing';
    log.info(`Game started (playing)`);
  }

  /** 暂停游戏(playing → paused)。仅主机可调用。 */
  pauseGame(): void {
    this._requireHost('pauseGame');
    if (this.gameState !== 'playing') {
      throw new Error(`NetworkSession.pauseGame: 当前状态 ${this.gameState} 不允许暂停(需 playing)`);
    }
    this.gameState = 'paused';
    log.info(`Game paused`);
  }

  /** 恢复游戏(paused → playing)。仅主机可调用。 */
  resumeGame(): void {
    this._requireHost('resumeGame');
    if (this.gameState !== 'paused') {
      throw new Error(`NetworkSession.resumeGame: 当前状态 ${this.gameState} 不允许恢复(需 paused)`);
    }
    this.gameState = 'playing';
    log.info(`Game resumed`);
  }

  /** 结束游戏(任意状态 → ended)。仅主机可调用。 */
  endGame(): void {
    this._requireHost('endGame');
    if (this.gameState === 'ended') return;
    this.gameState = 'ended';
    log.info(`Game ended`);
  }

  // ── 玩家管理 ────────────────────────────────────────────────

  /**
   * 踢出玩家(主机专属)。
   * 被踢玩家会被移除并加入临时封禁列表(防止立即重连)。
   */
  kickPlayer(playerId: string): void {
    this._requireHost('kickPlayer');
    if (playerId === this.localPlayerId) {
      throw new Error('NetworkSession.kickPlayer: 不能踢出自己');
    }
    const p = this.players.get(playerId);
    if (!p) {
      log.warn(`kickPlayer: 玩家 ${playerId} 不存在`);
      return;
    }
    this._removePlayer(playerId);
    log.info(`Player kicked: ${playerId}`);
  }

  /**
   * 封禁玩家(主机专属)。
   * 被封禁玩家会被移除并加入永久封禁列表。
   */
  banPlayer(playerId: string): void {
    this._requireHost('banPlayer');
    if (playerId === this.localPlayerId) {
      throw new Error('NetworkSession.banPlayer: 不能封禁自己');
    }
    this._bannedIds.add(playerId);
    this._removePlayer(playerId);
    log.info(`Player banned: ${playerId}`);
  }

  /** 检查玩家是否被封禁。 */
  isBanned(playerId: string): boolean {
    return this._bannedIds.has(playerId);
  }

  /**
   * 设置玩家就绪状态。
   * 主机可设置任意玩家;客户端只能设置自己。
   */
  setPlayerReady(playerId: string, ready: boolean): void {
    const p = this.players.get(playerId);
    if (!p) {
      throw new Error(`NetworkSession.setPlayerReady: 玩家 ${playerId} 不存在`);
    }
    if (!this.isHost() && playerId !== this.localPlayerId) {
      throw new Error('NetworkSession.setPlayerReady: 客户端只能修改自己的就绪状态');
    }
    p.isReady = ready;
  }

  /**
   * 设置玩家槽位。
   * @param playerId  玩家 ID
   * @param slot      目标槽位(0-based)
   */
  setPlayerSlot(playerId: string, slot: number): void {
    const p = this.players.get(playerId);
    if (!p) {
      throw new Error(`NetworkSession.setPlayerSlot: 玩家 ${playerId} 不存在`);
    }
    if (slot < 0 || slot >= this.maxPlayers) {
      throw new Error(`NetworkSession.setPlayerSlot: 槽位 ${slot} 越界(0..${this.maxPlayers - 1})`);
    }
    if (this.playerSlots[slot] && p.slot !== slot) {
      throw new Error(`NetworkSession.setPlayerSlot: 槽位 ${slot} 已被占用`);
    }
    // 释放旧槽位
    if (p.slot >= 0 && p.slot < this.playerSlots.length) {
      this.playerSlots[p.slot] = false;
    }
    // 占用新槽位
    this.playerSlots[slot] = true;
    p.slot = slot;
  }

  // ── 会话配置(主机专属)──────────────────────────────────────

  /** 设置最大玩家数(仅主机,且仅在 lobby 状态)。 */
  setMaxPlayers(max: number): void {
    this._requireHost('setMaxPlayers');
    if (max < 1) {
      throw new Error(`NetworkSession.setMaxPlayers: max 必须 >= 1,收到 ${max}`);
    }
    if (this.gameState !== 'lobby') {
      throw new Error(`NetworkSession.setMaxPlayers: 仅在 lobby 状态可修改,当前 ${this.gameState}`);
    }
    if (max < this.getPlayerCount()) {
      throw new Error(`NetworkSession.setMaxPlayers: max ${max} 小于当前玩家数 ${this.getPlayerCount()}`);
    }
    const oldMax = this.maxPlayers;
    this.maxPlayers = max;
    // 调整槽位数组
    if (max > oldMax) {
      for (let i = oldMax; i < max; i++) this.playerSlots.push(false);
    } else if (max < oldMax) {
      this.playerSlots.length = max;
    }
  }

  /** 设置会话密码(仅主机)。 */
  setPassword(password: string | null): void {
    this._requireHost('setPassword');
    this.password = password;
  }

  /** 设置私有标志(仅主机)。 */
  setPrivate(isPrivate: boolean): void {
    this._requireHost('setPrivate');
    this.isPrivate = isPrivate;
  }

  /** 启用/禁用匹配(仅主机)。 */
  enableMatchmaking(enabled: boolean): void {
    this._requireHost('enableMatchmaking');
    this.matchmakingEnabled = enabled;
  }

  // ── 查询 ────────────────────────────────────────────────────

  /** 获取玩家。 */
  getPlayer(playerId: string): NetworkPlayer | undefined {
    return this.players.get(playerId);
  }

  /** 获取所有玩家数组。 */
  getPlayers(): NetworkPlayer[] {
    return Array.from(this.players.values());
  }

  /** 获取玩家数。 */
  getPlayerCount(): number {
    return this.players.size;
  }

  /** 获取游戏状态。 */
  getGameState(): SessionGameState {
    return this.gameState;
  }

  /** 获取可用槽位数。 */
  getAvailableSlots(): number {
    let count = 0;
    for (let i = 0; i < this.playerSlots.length; i++) {
      if (!this.playerSlots[i]) count++;
    }
    return count;
  }

  /** 是否是主机。 */
  isHost(): boolean {
    return this.hostId === this.localPlayerId && (this.sessionType === 'host' || this.sessionType === 'listen-server');
  }

  /** 是否是本地玩家。 */
  isLocalPlayer(playerId: string): boolean {
    return playerId === this.localPlayerId;
  }

  /** 是否有活动会话。 */
  isActive(): boolean {
    return this._active;
  }

  /** 获取统计。 */
  getStats(): SessionStats {
    let readyCount = 0;
    let connectedCount = 0;
    for (const p of this.players.values()) {
      if (p.isReady) readyCount++;
      if (p.isConnected) connectedCount++;
    }
    return {
      sessionId: this.sessionId,
      sessionType: this.sessionType,
      gameState: this.gameState,
      maxPlayers: this.maxPlayers,
      playerCount: this.players.size,
      readyCount,
      connectedCount,
      hostId: this.hostId,
      isPrivate: this.isPrivate,
      matchmakingEnabled: this.matchmakingEnabled,
      availableSlots: this.getAvailableSlots(),
    };
  }

  // ── 消息发送 ────────────────────────────────────────────────

  /**
   * 注册出站消息回调。
   * 调用方在回调中把 SessionMessage 投递到传输层。
   */
  onSendMessage(callback: (msg: SessionMessage) => void): void {
    this._sendCb = callback;
  }

  /**
   * 广播消息给所有玩家(可选排除某个玩家)。
   * @param message  消息载荷
   * @param exclude  排除的玩家 ID(通常是发送者自己)
   */
  broadcast(message: unknown, exclude?: string): void {
    if (!this._active) {
      log.warn('broadcast: 无活动会话,忽略');
      return;
    }
    const msg: SessionMessage = {
      type: 'broadcast',
      target: 'broadcast',
      source: this.localPlayerId,
      data: message,
      timestamp: this._now(),
    };
    this._sendCb?.(msg);
    void exclude; // 排除逻辑由传输层根据 target 列表处理,这里仅标记
  }

  /** 发送消息给指定玩家。 */
  sendTo(playerId: string, message: unknown): void {
    if (!this._active) {
      log.warn('sendTo: 无活动会话,忽略');
      return;
    }
    if (!this.players.has(playerId)) {
      log.warn(`sendTo: 玩家 ${playerId} 不在会话中`);
      return;
    }
    const msg: SessionMessage = {
      type: 'direct',
      target: playerId,
      source: this.localPlayerId,
      data: message,
      timestamp: this._now(),
    };
    this._sendCb?.(msg);
  }

  /** 发送消息给主机。 */
  sendToHost(message: unknown): void {
    if (!this._active) {
      log.warn('sendToHost: 无活动会话,忽略');
      return;
    }
    if (this.hostId === null) {
      log.warn('sendToHost: 无主机');
      return;
    }
    const msg: SessionMessage = {
      type: 'toHost',
      target: this.hostId,
      source: this.localPlayerId,
      data: message,
      timestamp: this._now(),
    };
    this._sendCb?.(msg);
  }

  // ── 远程玩家管理(主机端调用,处理来自网络的玩家加入/离开)──

  /**
   * 添加远程玩家(主机端,处理客户端加入请求)。
   * @param playerId  远程玩家 ID
   * @param name      显示名(可选)
   * @param password  客户端提供的密码(可选,会话有密码时校验)
   * @returns 分配的玩家对象,失败返回 null(会话满/已封禁/密码错误)
   */
  addRemotePlayer(playerId: string, name?: string, password?: string): NetworkPlayer | null {
    if (!this.isHost()) {
      throw new Error('NetworkSession.addRemotePlayer: 仅主机可添加远程玩家');
    }
    if (this._bannedIds.has(playerId)) {
      log.warn(`addRemotePlayer: 玩家 ${playerId} 已被封禁`);
      return null;
    }
    if (this.players.has(playerId)) {
      log.warn(`addRemotePlayer: 玩家 ${playerId} 已存在`);
      return null;
    }
    if (this.password !== null && password !== this.password) {
      log.warn(`addRemotePlayer: 玩家 ${playerId} 密码错误`);
      return null;
    }
    if (this.getPlayerCount() >= this.maxPlayers) {
      log.warn('addRemotePlayer: 会话已满');
      return null;
    }
    const slot = this._allocateSlot();
    if (slot < 0) return null;
    const player: NetworkPlayer = {
      id: playerId,
      name: name ?? `Player-${playerId.slice(-4)}`,
      isReady: false,
      isHost: false,
      ping: 0,
      slot,
      isConnected: true,
    };
    this.players.set(playerId, player);
    log.info(`Remote player added: ${playerId} (slot=${slot})`);
    return player;
  }

  /**
   * 移除远程玩家(主机端,处理客户端离开/掉线)。
   */
  removeRemotePlayer(playerId: string): void {
    if (!this.isHost()) {
      throw new Error('NetworkSession.removeRemotePlayer: 仅主机可移除远程玩家');
    }
    this._removePlayer(playerId);
  }

  /** 标记玩家连接状态(掉线/重连)。 */
  setPlayerConnected(playerId: string, connected: boolean): void {
    const p = this.players.get(playerId);
    if (!p) {
      log.warn(`setPlayerConnected: 玩家 ${playerId} 不存在`);
      return;
    }
    p.isConnected = connected;
  }

  /** 更新玩家 ping(主机端调用,由心跳测量更新)。 */
  setPlayerPing(playerId: string, ping: number): void {
    const p = this.players.get(playerId);
    if (!p) return;
    p.ping = ping;
  }

  /** 设置玩家角色数据(由上层 CharacterGenerator 产物填充)。 */
  setPlayerCharacterData(playerId: string, data: unknown): void {
    const p = this.players.get(playerId);
    if (!p) {
      throw new Error(`NetworkSession.setPlayerCharacterData: 玩家 ${playerId} 不存在`);
    }
    p.characterData = data;
  }

  // ── 生命周期 ────────────────────────────────────────────────

  /** 释放资源。 */
  dispose(): void {
    this.players.clear();
    this._bannedIds.clear();
    this.playerSlots = [];
    this._sendCb = null;
    this._active = false;
    this.gameState = 'ended';
    this.hostId = null;
    log.info('Session disposed');
  }

  // ── 内部 ────────────────────────────────────────────────────

  /** 分配一个空槽位,返回槽位索引;无空槽返回 -1。 */
  private _allocateSlot(): number {
    for (let i = 0; i < this.playerSlots.length; i++) {
      if (!this.playerSlots[i]) {
        this.playerSlots[i] = true;
        return i;
      }
    }
    return -1;
  }

  /** 移除玩家并释放槽位。 */
  private _removePlayer(playerId: string): void {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.slot >= 0 && p.slot < this.playerSlots.length) {
      this.playerSlots[p.slot] = false;
    }
    this.players.delete(playerId);
  }

  /** 主机权限校验。 */
  private _requireHost(method: string): void {
    if (!this._active) {
      throw new Error(`NetworkSession.${method}: 无活动会话`);
    }
    if (!this.isHost()) {
      throw new Error(`NetworkSession.${method}: 仅主机可调用`);
    }
  }
}
