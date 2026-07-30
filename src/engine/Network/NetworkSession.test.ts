// NetworkSession 单元测试。
//
// 测试策略:
//   - createSession / joinSession / leaveSession 生命周期。
//   - 游戏状态机:lobby → loading → playing ⇄ paused → ended。
//   - 玩家管理:addRemotePlayer / kickPlayer / banPlayer / setPlayerReady / setPlayerSlot。
//   - 主机权限:非主机调用主机专属方法抛错。
//   - 槽位管理:分配/释放/越界。
//   - 消息发送:broadcast / sendTo / sendToHost 通过 onSendMessage 回调验证。
//   - 会话配置:setMaxPlayers / setPassword / setPrivate / enableMatchmaking。
//   - 密码校验:addRemotePlayer 拒绝错误密码。
//   - 封禁:banned 玩家无法加入。

import { describe, it, expect, vi } from 'vitest';
import { NetworkSession, type SessionMessage } from './NetworkSession';

describe('NetworkSession', () => {
  describe('createSession', () => {
    it('主机创建会话,本地玩家注册为主机', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4, localPlayerName: 'Alice' });
      expect(s.sessionId).toBeTruthy();
      expect(s.sessionType).toBe('host');
      expect(s.maxPlayers).toBe(4);
      expect(s.gameState).toBe('lobby');
      expect(s.hostId).toBe(s.localPlayerId);
      expect(s.isHost()).toBe(true);
      expect(s.getPlayerCount()).toBe(1);
      const host = s.getPlayer(s.localPlayerId)!;
      expect(host.name).toBe('Alice');
      expect(host.isHost).toBe(true);
      expect(host.isReady).toBe(true);
      expect(host.slot).toBe(0);
    });

    it('指定 sessionId 与 localPlayerId', () => {
      const s = new NetworkSession();
      s.createSession({
        sessionType: 'host',
        sessionId: 'room-xyz',
        localPlayerId: 'p-001',
        localPlayerName: 'Bob',
      });
      expect(s.sessionId).toBe('room-xyz');
      expect(s.localPlayerId).toBe('p-001');
    });

    it('maxPlayers < 1 抛错', () => {
      const s = new NetworkSession();
      expect(() => s.createSession({ sessionType: 'host', maxPlayers: 0 })).toThrow();
    });

    it('客户端不能用 createSession', () => {
      const s = new NetworkSession();
      expect(() => s.createSession({ sessionType: 'client' })).toThrow();
    });

    it('已有活动会话时重复创建抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(() => s.createSession({ sessionType: 'host' })).toThrow();
    });

    it('listen-server 类型可创建', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'listen-server' });
      expect(s.sessionType).toBe('listen-server');
      expect(s.isHost()).toBe(true);
    });
  });

  describe('joinSession', () => {
    it('客户端加入会话,本地玩家注册为客户端', () => {
      const s = new NetworkSession();
      const ok = s.joinSession('room-123');
      expect(ok).toBe(true);
      expect(s.sessionId).toBe('room-123');
      expect(s.sessionType).toBe('client');
      expect(s.isHost()).toBe(false);
      expect(s.getPlayerCount()).toBe(1);
      const p = s.getPlayer(s.localPlayerId)!;
      expect(p.isHost).toBe(false);
      expect(p.isReady).toBe(false);
    });

    it('空 sessionId 抛错', () => {
      const s = new NetworkSession();
      expect(() => s.joinSession('')).toThrow();
    });

    it('已有活动会话时重复加入抛错', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.joinSession('room-2')).toThrow();
    });

    it('带密码参数正常加入(密码由调用方后续转发给主机)', () => {
      const s = new NetworkSession();
      const ok = s.joinSession('room-1', 'secret');
      expect(ok).toBe(true);
      expect(s.sessionId).toBe('room-1');
    });
  });

  describe('leaveSession', () => {
    it('主机离开后会话结束', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.leaveSession();
      expect(s.gameState).toBe('ended');
      expect(s.isActive()).toBe(false);
    });

    it('客户端离开后不活动', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      s.leaveSession();
      expect(s.isActive()).toBe(false);
    });

    it('无活动会话时 leaveSession 是 no-op', () => {
      const s = new NetworkSession();
      expect(() => s.leaveSession()).not.toThrow();
    });
  });

  describe('游戏状态机', () => {
    it('lobby → playing(startGame)', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      expect(s.getGameState()).toBe('playing');
    });

    it('playing → paused(pauseGame)', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      s.pauseGame();
      expect(s.getGameState()).toBe('paused');
    });

    it('paused → playing(resumeGame)', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      s.pauseGame();
      s.resumeGame();
      expect(s.getGameState()).toBe('playing');
    });

    it('任意状态 → ended(endGame)', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      s.endGame();
      expect(s.getGameState()).toBe('ended');
    });

    it('非 lobby 状态调用 startGame 抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      expect(() => s.startGame()).toThrow();
    });

    it('非 playing 状态调用 pauseGame 抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(() => s.pauseGame()).toThrow();
    });

    it('非 paused 状态调用 resumeGame 抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      expect(() => s.resumeGame()).toThrow();
    });

    it('ended 状态调用 endGame 是 no-op', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.endGame();
      s.endGame();
      expect(s.getGameState()).toBe('ended');
    });

    it('客户端不能调用 startGame', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.startGame()).toThrow();
    });

    it('客户端不能调用 endGame', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.endGame()).toThrow();
    });
  });

  describe('玩家管理', () => {
    it('addRemotePlayer 添加远程玩家并分配槽位', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      const p = s.addRemotePlayer('remote-1', 'Charlie');
      expect(p).not.toBeNull();
      expect(p!.slot).toBe(1); // 0 是主机
      expect(s.getPlayerCount()).toBe(2);
    });

    it('addRemotePlayer 重复 ID 返回 null', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('remote-1');
      const dup = s.addRemotePlayer('remote-1');
      expect(dup).toBeNull();
    });

    it('addRemotePlayer 会话满返回 null', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 2 });
      s.addRemotePlayer('r1');
      const full = s.addRemotePlayer('r2');
      expect(full).toBeNull(); // 2 人满(主机 + r1)
    });

    it('kickPlayer 移除玩家并释放槽位', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      s.addRemotePlayer('r1');
      expect(s.getPlayerCount()).toBe(2);
      s.kickPlayer('r1');
      expect(s.getPlayerCount()).toBe(1);
      expect(s.getPlayer('r1')).toBeUndefined();
      // 槽位释放
      expect(s.getAvailableSlots()).toBe(3);
    });

    it('kickPlayer 踢自己抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(() => s.kickPlayer(s.localPlayerId)).toThrow();
    });

    it('kickPlayer 不存在的玩家是 no-op', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(() => s.kickPlayer('ghost')).not.toThrow();
    });

    it('banPlayer 移除玩家并加入封禁列表', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.banPlayer('r1');
      expect(s.isBanned('r1')).toBe(true);
      expect(s.getPlayer('r1')).toBeUndefined();
    });

    it('banPlayer 后 addRemotePlayer 拒绝', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.banPlayer('r1');
      const again = s.addRemotePlayer('r1');
      expect(again).toBeNull();
    });

    it('banPlayer 封禁自己抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(() => s.banPlayer(s.localPlayerId)).toThrow();
    });

    it('setPlayerReady 主机可设置任意玩家', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.setPlayerReady('r1', true);
      expect(s.getPlayer('r1')!.isReady).toBe(true);
    });

    it('setPlayerReady 客户端只能设置自己', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      s.setPlayerReady(s.localPlayerId, true);
      expect(s.getPlayer(s.localPlayerId)!.isReady).toBe(true);
    });

    it('setPlayerReady 客户端设置他人抛错', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.setPlayerReady('other', true)).toThrow();
    });

    it('setPlayerReady 不存在的玩家抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(() => s.setPlayerReady('ghost', true)).toThrow();
    });

    it('setPlayerSlot 设置玩家槽位', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      s.addRemotePlayer('r1');
      s.setPlayerSlot('r1', 3);
      expect(s.getPlayer('r1')!.slot).toBe(3);
    });

    it('setPlayerSlot 占用槽位抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      s.addRemotePlayer('r1'); // slot 1
      s.addRemotePlayer('r2'); // slot 2
      expect(() => s.setPlayerSlot('r2', 1)).toThrow();
    });

    it('setPlayerSlot 越界抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      expect(() => s.setPlayerSlot(s.localPlayerId, 99)).toThrow();
      expect(() => s.setPlayerSlot(s.localPlayerId, -1)).toThrow();
    });
  });

  describe('会话配置', () => {
    it('setMaxPlayers 调整最大玩家数', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      s.setMaxPlayers(8);
      expect(s.maxPlayers).toBe(8);
      expect(s.playerSlots.length).toBe(8);
    });

    it('setMaxPlayers 仅 lobby 状态可调用', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.startGame();
      expect(() => s.setMaxPlayers(8)).toThrow();
    });

    it('setMaxPlayers 小于当前玩家数抛错', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      s.addRemotePlayer('r1');
      expect(() => s.setMaxPlayers(1)).toThrow();
    });

    it('setPassword 设置密码', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.setPassword('newpass');
      expect(s.password).toBe('newpass');
      s.setPassword(null);
      expect(s.password).toBeNull();
    });

    it('setPrivate 设置私有标志', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.setPrivate(true);
      expect(s.isPrivate).toBe(true);
    });

    it('enableMatchmaking 切换匹配', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.enableMatchmaking(false);
      expect(s.matchmakingEnabled).toBe(false);
      s.enableMatchmaking(true);
      expect(s.matchmakingEnabled).toBe(true);
    });

    it('客户端不能调用 setMaxPlayers', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.setMaxPlayers(8)).toThrow();
    });
  });

  describe('密码校验', () => {
    it('正确密码可加入', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', password: 'secret' });
      const p = s.addRemotePlayer('r1', 'Charlie', 'secret');
      expect(p).not.toBeNull();
    });

    it('错误密码被拒绝', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', password: 'secret' });
      const p = s.addRemotePlayer('r1', 'Charlie', 'wrong');
      expect(p).toBeNull();
    });

    it('无密码会话不校验', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      const p = s.addRemotePlayer('r1', 'Charlie');
      expect(p).not.toBeNull();
    });
  });

  describe('查询方法', () => {
    it('getPlayer 返回玩家', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(s.getPlayer(s.localPlayerId)).toBeDefined();
      expect(s.getPlayer('nonexistent')).toBeUndefined();
    });

    it('getPlayers 返回数组', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      const arr = s.getPlayers();
      expect(arr.length).toBe(2);
    });

    it('getPlayerCount 返回玩家数', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(s.getPlayerCount()).toBe(1);
      s.addRemotePlayer('r1');
      expect(s.getPlayerCount()).toBe(2);
    });

    it('getAvailableSlots 返回可用槽位', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4 });
      expect(s.getAvailableSlots()).toBe(3); // 4 - 1 host
      s.addRemotePlayer('r1');
      expect(s.getAvailableSlots()).toBe(2);
    });

    it('isLocalPlayer 判断本地玩家', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      expect(s.isLocalPlayer(s.localPlayerId)).toBe(true);
      expect(s.isLocalPlayer('other')).toBe(false);
    });
  });

  describe('消息发送', () => {
    it('broadcast 触发 onSendMessage 回调', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      const cb = vi.fn();
      s.onSendMessage(cb);
      s.broadcast({ text: 'hello' });
      expect(cb).toHaveBeenCalledTimes(1);
      const msg = cb.mock.calls[0][0] as SessionMessage;
      expect(msg.type).toBe('broadcast');
      expect(msg.target).toBe('broadcast');
      expect(msg.source).toBe(s.localPlayerId);
      expect(msg.data).toEqual({ text: 'hello' });
    });

    it('sendTo 发给指定玩家', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      const cb = vi.fn();
      s.onSendMessage(cb);
      s.sendTo('r1', { cmd: 'move' });
      expect(cb).toHaveBeenCalledTimes(1);
      const msg = cb.mock.calls[0][0] as SessionMessage;
      expect(msg.type).toBe('direct');
      expect(msg.target).toBe('r1');
      expect(msg.data).toEqual({ cmd: 'move' });
    });

    it('sendTo 不存在的玩家不触发回调', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      const cb = vi.fn();
      s.onSendMessage(cb);
      s.sendTo('ghost', 'data');
      expect(cb).not.toHaveBeenCalled();
    });

    it('sendToHost 发给主机', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      const cb = vi.fn();
      s.onSendMessage(cb);
      s.sendToHost({ request: 'pause' });
      expect(cb).toHaveBeenCalledTimes(1);
      const msg = cb.mock.calls[0][0] as SessionMessage;
      expect(msg.type).toBe('toHost');
      expect(msg.target).toBe(s.hostId);
    });

    it('无活动会话时 broadcast 不发送', () => {
      const s = new NetworkSession();
      const cb = vi.fn();
      s.onSendMessage(cb);
      s.broadcast('hello');
      expect(cb).not.toHaveBeenCalled();
    });

    it('消息包含时间戳', () => {
      let clock = 5000;
      const s = new NetworkSession(() => clock);
      s.createSession({ sessionType: 'host' });
      const cb = vi.fn();
      s.onSendMessage(cb);
      s.broadcast('test');
      const msg = cb.mock.calls[0][0] as SessionMessage;
      expect(msg.timestamp).toBe(5000);
    });

    it('后注册的 onSendMessage 覆盖先注册的', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      const cb1 = vi.fn();
      const cb2 = vi.fn();
      s.onSendMessage(cb1);
      s.onSendMessage(cb2);
      s.broadcast('test');
      expect(cb1).not.toHaveBeenCalled();
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });

  describe('远程玩家管理', () => {
    it('removeRemotePlayer 移除远程玩家', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.removeRemotePlayer('r1');
      expect(s.getPlayer('r1')).toBeUndefined();
    });

    it('setPlayerConnected 切换连接状态', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.setPlayerConnected('r1', false);
      expect(s.getPlayer('r1')!.isConnected).toBe(false);
      s.setPlayerConnected('r1', true);
      expect(s.getPlayer('r1')!.isConnected).toBe(true);
    });

    it('setPlayerPing 更新延迟', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.setPlayerPing('r1', 42);
      expect(s.getPlayer('r1')!.ping).toBe(42);
    });

    it('setPlayerCharacterData 设置角色数据', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      const data = { name: 'Hero', level: 5 };
      s.setPlayerCharacterData('r1', data);
      expect(s.getPlayer('r1')!.characterData).toEqual(data);
    });

    it('客户端不能调用 addRemotePlayer', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.addRemotePlayer('r1')).toThrow();
    });

    it('客户端不能调用 removeRemotePlayer', () => {
      const s = new NetworkSession();
      s.joinSession('room-1');
      expect(() => s.removeRemotePlayer('r1')).toThrow();
    });
  });

  describe('getStats', () => {
    it('返回完整统计信息', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host', maxPlayers: 4, isPrivate: true });
      s.addRemotePlayer('r1');
      s.setPlayerReady('r1', true);
      const stats = s.getStats();
      expect(stats.sessionId).toBe(s.sessionId);
      expect(stats.sessionType).toBe('host');
      expect(stats.gameState).toBe('lobby');
      expect(stats.maxPlayers).toBe(4);
      expect(stats.playerCount).toBe(2);
      expect(stats.readyCount).toBe(2); // host + r1
      expect(stats.connectedCount).toBe(2);
      expect(stats.hostId).toBe(s.localPlayerId);
      expect(stats.isPrivate).toBe(true);
      expect(stats.availableSlots).toBe(2);
    });
  });

  describe('dispose', () => {
    it('dispose 清理所有状态', () => {
      const s = new NetworkSession();
      s.createSession({ sessionType: 'host' });
      s.addRemotePlayer('r1');
      s.banPlayer('r1');
      s.dispose();
      expect(s.getPlayerCount()).toBe(0);
      expect(s.playerSlots.length).toBe(0);
      expect(s.isBanned('r1')).toBe(false);
      expect(s.isActive()).toBe(false);
      expect(s.gameState).toBe('ended');
    });
  });

  describe('完整主机-客户端流程', () => {
    it('主机创建 → 客户端加入 → 开始游戏 → 结束', () => {
      // 主机
      const host = new NetworkSession();
      host.createSession({ sessionType: 'host', maxPlayers: 4, sessionId: 'room-1' });
      // 模拟客户端通过网络请求加入(主机端 addRemotePlayer)
      const clientPlayer = host.addRemotePlayer('client-1', 'Dave');
      expect(clientPlayer).not.toBeNull();
      // 客户端准备
      host.setPlayerReady('client-1', true);
      // 所有玩家准备后开始游戏
      host.startGame();
      expect(host.getGameState()).toBe('playing');
      // 暂停
      host.pauseGame();
      expect(host.getGameState()).toBe('paused');
      // 恢复
      host.resumeGame();
      expect(host.getGameState()).toBe('playing');
      // 结束
      host.endGame();
      expect(host.getGameState()).toBe('ended');
    });
  });
});
