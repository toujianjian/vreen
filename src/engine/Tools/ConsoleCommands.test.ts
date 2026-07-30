// ConsoleCommands 单元测试。
//
// 验证:
//   • registerCommand / unregisterCommand / getCommand / getCommands / getCommandsByCategory / getCategories
//   • registerAlias / getAlias / 别名解析 (execute / getAutoComplete / getHelp)
//   • execute (成功 / 未知命令 / 参数缺失 / 参数类型错误 / handler 抛错)
//   • parseArgs (string / number / boolean / vector3)
//   • addToHistory / getHistory / clearHistory / maxHistory 裁剪
//   • getAutoComplete (前缀匹配 + 别名)
//   • getHelp (单命令 + 分组)
//   • registerAllDefaultCommands (幂等 + 全套预置命令)
//   • 预置命令: help / clear / scene.* / entity.* / physics.* / render.* / audio.* / debug.*
//   • 依赖注入: setWorld / setScene / setFrameProfiler / setSystemProfiler / setMemoryTracker
//   • getStats / clear
//   • 全局单例 getDefaultConsoleCommands / resetDefaultConsoleCommands

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ConsoleCommands,
  getDefaultConsoleCommands,
  resetDefaultConsoleCommands,
  type ConsoleCommand,
} from './ConsoleCommands';
import { World } from '../ECS/World';
import { Scene } from '../Core/Scene';
import { Object3D } from '../Core/Object3D';
import { SceneSerializer } from '../Serialization';
import { FrameProfiler } from './FrameProfiler';
import { SystemProfiler } from './SystemProfiler';
import { MemoryTracker } from './MemoryTracker';

/** 构造一个简单自定义命令。 */
function makeEchoCommand(): ConsoleCommand {
  return {
    name: 'echo',
    description: '回显参数',
    usage: 'echo <text>',
    args: [{ name: 'text', type: 'string', required: true, description: '要回显的文本' }],
    handler: (args) => args.join(' '),
    category: 'General',
  };
}

describe('ConsoleCommands — 注册/查询', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
  });

  it('registerCommand + getCommand + getCommands', () => {
    const cmd = makeEchoCommand();
    expect(cc.registerCommand(cmd)).toBe(false); // 首次注册返回 false
    expect(cc.getCommand('echo')).toBe(cmd);
    expect(cc.getCommand('nope')).toBeUndefined();
    expect(cc.getCommands()).toHaveLength(1);
  });

  it('registerCommand 同名覆盖返回 true', () => {
    cc.registerCommand(makeEchoCommand());
    const cmd2 = makeEchoCommand();
    cmd2.description = '新描述';
    expect(cc.registerCommand(cmd2)).toBe(true);
    expect(cc.getCommand('echo')?.description).toBe('新描述');
    // 覆盖后总数仍是 1
    expect(cc.getCommands()).toHaveLength(1);
  });

  it('unregisterCommand', () => {
    cc.registerCommand(makeEchoCommand());
    expect(cc.unregisterCommand('echo')).toBe(true);
    expect(cc.getCommand('echo')).toBeUndefined();
    expect(cc.unregisterCommand('echo')).toBe(false);
  });

  it('unregisterCommand 同时清理指向它的别名', () => {
    cc.registerCommand(makeEchoCommand());
    cc.registerAlias('say', 'echo');
    expect(cc.getAlias('say')).toBe('echo');
    cc.unregisterCommand('echo');
    expect(cc.getAlias('say')).toBeUndefined();
  });

  it('getCommands 返回排序快照', () => {
    cc.registerCommand({ ...makeEchoCommand(), name: 'zeta' });
    cc.registerCommand({ ...makeEchoCommand(), name: 'alpha' });
    cc.registerCommand({ ...makeEchoCommand(), name: 'mid' });
    const names = cc.getCommands().map((c) => c.name);
    expect(names).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('getCommandsByCategory + getCategories', () => {
    cc.registerCommand({ ...makeEchoCommand(), name: 'a', category: 'General' });
    cc.registerCommand({ ...makeEchoCommand(), name: 'b', category: 'Debug' });
    cc.registerCommand({ ...makeEchoCommand(), name: 'c', category: 'General' });
    expect(cc.getCommandsByCategory('General').map((c) => c.name)).toEqual(['a', 'c']);
    expect(cc.getCommandsByCategory('Debug').map((c) => c.name)).toEqual(['b']);
    expect(cc.getCategories()).toEqual(['Debug', 'General']);
  });
});

describe('ConsoleCommands — 别名', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
    cc.registerCommand(makeEchoCommand());
  });

  it('registerAlias + getAlias', () => {
    expect(cc.registerAlias('say', 'echo')).toBe(false);
    expect(cc.getAlias('say')).toBe('echo');
    expect(cc.getAlias('nope')).toBeUndefined();
  });

  it('registerAlias 同名覆盖返回 true', () => {
    cc.registerAlias('say', 'echo');
    expect(cc.registerAlias('say', 'other')).toBe(true);
    expect(cc.getAlias('say')).toBe('other');
  });

  it('别名可在 execute 中解析到目标命令', () => {
    cc.registerAlias('say', 'echo');
    const r = cc.execute('say hello');
    expect(r.success).toBe(true);
    expect(r.output).toBe('hello');
  });

  it('别名指向不存在命令时 execute 失败', () => {
    cc.registerAlias('ghost', 'nonexistent');
    const r = cc.execute('ghost x');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Unknown command');
  });
});

describe('ConsoleCommands — execute', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
    cc.registerCommand(makeEchoCommand());
  });

  it('成功执行', () => {
    const r = cc.execute('echo hello world');
    expect(r.success).toBe(true);
    expect(r.output).toBe('hello world');
  });

  it('空输入返回空输出', () => {
    const r = cc.execute('   ');
    expect(r.success).toBe(false);
    expect(r.output).toBe('');
  });

  it('未知命令失败', () => {
    const r = cc.execute('nope');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Unknown command');
    expect(r.output).toContain('nope');
  });

  it('缺少必需参数失败', () => {
    const r = cc.execute('echo');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Missing arguments');
    expect(r.output).toContain('echo <text>');
  });

  it('handler 抛错被捕获', () => {
    cc.registerCommand({
      name: 'boom',
      description: '总是抛错',
      usage: 'boom',
      args: [],
      handler: () => {
        throw new Error('boom!');
      },
      category: 'General',
    });
    const r = cc.execute('boom');
    expect(r.success).toBe(false);
    expect(r.output).toBe('Error: boom!');
  });

  it('handler 返回 undefined 视为空字符串', () => {
    cc.registerCommand({
      name: 'noop',
      description: '返回 undefined',
      usage: 'noop',
      args: [],
      // 类型签名要求返回 string,这里用 as unknown as 模拟 JS 调用方返回 undefined 的运行时场景
      handler: (() => undefined) as unknown as (args: string[]) => string,
      category: 'General',
    });
    const r = cc.execute('noop');
    expect(r.success).toBe(true);
    expect(r.output).toBe('');
  });

  it('execute 记录到历史', () => {
    cc.execute('echo a');
    cc.execute('echo b');
    expect(cc.getHistory()).toEqual(['echo a', 'echo b']);
  });

  it('执行失败也记录到历史', () => {
    cc.execute('unknown');
    expect(cc.getHistory()).toEqual(['unknown']);
  });

  it('双引号包裹含空格的参数', () => {
    const r = cc.execute('echo "hello world" foo');
    expect(r.success).toBe(true);
    expect(r.output).toBe('hello world foo');
  });
});

describe('ConsoleCommands — parseArgs', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
  });

  it('string 类型', () => {
    cc.registerCommand({
      name: 's',
      description: '',
      usage: 's <v>',
      args: [{ name: 'v', type: 'string', required: true }],
      handler: () => '',
      category: 'General',
    });
    const r = cc.parseArgs('s hello');
    expect(r.error).toBeUndefined();
    expect(r.values).toEqual(['hello']);
  });

  it('number 类型 (合法)', () => {
    cc.registerCommand({
      name: 'n',
      description: '',
      usage: 'n <v>',
      args: [{ name: 'v', type: 'number', required: true }],
      handler: () => '',
      category: 'General',
    });
    expect(cc.parseArgs('n 42').values).toEqual([42]);
    expect(cc.parseArgs('n -3.14').values).toEqual([-3.14]);
  });

  it('number 类型 (非法)', () => {
    cc.registerCommand({
      name: 'n',
      description: '',
      usage: 'n <v>',
      args: [{ name: 'v', type: 'number', required: true }],
      handler: () => '',
      category: 'General',
    });
    const r = cc.parseArgs('n abc');
    expect(r.error).toContain('not a finite number');
  });

  it('boolean 类型 (合法变体)', () => {
    cc.registerCommand({
      name: 'b',
      description: '',
      usage: 'b <v>',
      args: [{ name: 'v', type: 'boolean', required: true }],
      handler: () => '',
      category: 'General',
    });
    expect(cc.parseArgs('b true').values).toEqual([true]);
    expect(cc.parseArgs('b 1').values).toEqual([true]);
    expect(cc.parseArgs('b yes').values).toEqual([true]);
    expect(cc.parseArgs('b on').values).toEqual([true]);
    expect(cc.parseArgs('b false').values).toEqual([false]);
    expect(cc.parseArgs('b 0').values).toEqual([false]);
    expect(cc.parseArgs('b no').values).toEqual([false]);
    expect(cc.parseArgs('b off').values).toEqual([false]);
  });

  it('boolean 类型 (非法)', () => {
    cc.registerCommand({
      name: 'b',
      description: '',
      usage: 'b <v>',
      args: [{ name: 'v', type: 'boolean', required: true }],
      handler: () => '',
      category: 'General',
    });
    const r = cc.parseArgs('b maybe');
    expect(r.error).toContain('not a boolean');
  });

  it('vector3 类型 (引号包裹空格分隔)', () => {
    cc.registerCommand({
      name: 'v',
      description: '',
      usage: 'v <vec>',
      args: [{ name: 'vec', type: 'vector3', required: true }],
      handler: () => '',
      category: 'General',
    });
    // vector3 作为单个参数,需用引号包裹空格分隔的形式,或用逗号分隔
    expect(cc.parseArgs('v "1 2 3"').values).toEqual([[1, 2, 3]]);
  });

  it('vector3 类型 (逗号分隔)', () => {
    cc.registerCommand({
      name: 'v',
      description: '',
      usage: 'v <vec>',
      args: [{ name: 'vec', type: 'vector3', required: true }],
      handler: () => '',
      category: 'General',
    });
    expect(cc.parseArgs('v 1,2,3').values).toEqual([[1, 2, 3]]);
  });

  it('vector3 类型 (分量不足失败)', () => {
    cc.registerCommand({
      name: 'v',
      description: '',
      usage: 'v <vec>',
      args: [{ name: 'vec', type: 'vector3', required: true }],
      handler: () => '',
      category: 'General',
    });
    const r = cc.parseArgs('v 1 2');
    expect(r.error).toContain('not a vector3');
  });

  it('可选参数缺失不报错', () => {
    cc.registerCommand({
      name: 'opt',
      description: '',
      usage: 'opt [v]',
      args: [{ name: 'v', type: 'string', required: false }],
      handler: () => '',
      category: 'General',
    });
    const r = cc.parseArgs('opt');
    expect(r.error).toBeUndefined();
    expect(r.values).toEqual([]);
  });

  it('空输入返回错误', () => {
    const r = cc.parseArgs('   ');
    expect(r.error).toBe('Empty input');
  });

  it('未知命令返回错误', () => {
    const r = cc.parseArgs('nope x');
    expect(r.error).toContain('Unknown command');
  });
});

describe('ConsoleCommands — 历史', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
  });

  it('addToHistory + getHistory', () => {
    cc.addToHistory('a');
    cc.addToHistory('b');
    expect(cc.getHistory()).toEqual(['a', 'b']);
  });

  it('空字符串不入历史', () => {
    cc.addToHistory('  ');
    expect(cc.getHistory()).toEqual([]);
  });

  it('clearHistory', () => {
    cc.addToHistory('a');
    cc.addToHistory('b');
    cc.clearHistory();
    expect(cc.getHistory()).toEqual([]);
  });

  it('maxHistory 裁剪最旧', () => {
    cc.maxHistory = 3;
    cc.addToHistory('a');
    cc.addToHistory('b');
    cc.addToHistory('c');
    cc.addToHistory('d');
    expect(cc.getHistory()).toEqual(['b', 'c', 'd']);
  });

  it('getHistory 返回快照 (修改不影响内部)', () => {
    cc.addToHistory('a');
    const snap = cc.getHistory();
    snap.push('b');
    expect(cc.getHistory()).toEqual(['a']);
  });
});

describe('ConsoleCommands — 自动补全', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
    cc.registerCommand({ ...makeEchoCommand(), name: 'scene.load', description: 'load scene' });
    cc.registerCommand({ ...makeEchoCommand(), name: 'scene.save', description: 'save scene' });
    cc.registerCommand({ ...makeEchoCommand(), name: 'entity.create', description: 'create entity' });
    cc.registerAlias('ls', 'scene.list');
  });

  it('空输入返回全部', () => {
    const all = cc.getAutoComplete('');
    expect(all.length).toBe(4); // 3 命令 + 1 别名
    expect(all.map((s) => s.name).sort()).toEqual(['entity.create', 'ls', 'scene.load', 'scene.save']);
  });

  it('前缀匹配', () => {
    const r = cc.getAutoComplete('scene.');
    expect(r.map((s) => s.name).sort()).toEqual(['scene.load', 'scene.save']);
  });

  it('别名前缀匹配', () => {
    const r = cc.getAutoComplete('l');
    expect(r.map((s) => s.name)).toEqual(['ls']);
    expect(r[0].isAlias).toBe(true);
  });

  it('无匹配返回空数组', () => {
    expect(cc.getAutoComplete('zzz')).toEqual([]);
  });

  it('完整命令名也匹配 (前缀包含自身)', () => {
    const r = cc.getAutoComplete('scene.load');
    expect(r.map((s) => s.name)).toEqual(['scene.load']);
  });

  it('建议带描述', () => {
    const r = cc.getAutoComplete('scene.load');
    expect(r[0].description).toBe('load scene');
  });
});

describe('ConsoleCommands — 帮助', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
    cc.registerCommand(makeEchoCommand());
    cc.registerCommand({ ...makeEchoCommand(), name: 'boom', category: 'Debug' });
  });

  it('getHelp() 无参数返回分组帮助', () => {
    const help = cc.getHelp() as any[];
    // 多分类 → GroupedHelp[]
    expect(help.length).toBeGreaterThanOrEqual(1);
    expect(help[0].category).toBeDefined();
    expect(help[0].entries).toBeDefined();
  });

  it('getHelp(name) 返回单命令帮助', () => {
    const help = cc.getHelp('echo') as any[];
    expect(help).toHaveLength(1);
    expect(help[0].name).toBe('echo');
    expect(help[0].usage).toBe('echo <text>');
    expect(help[0].args).toHaveLength(1);
  });

  it('getHelp(未知) 返回空数组', () => {
    expect(cc.getHelp('nope')).toEqual([]);
  });

  it('getHelp 解析别名', () => {
    cc.registerAlias('say', 'echo');
    const help = cc.getHelp('say') as any[];
    expect(help).toHaveLength(1);
    expect(help[0].name).toBe('echo');
  });

  it('help 命令 (无参数) 输出包含全部命令', () => {
    cc.registerGeneralCommands();
    const r = cc.execute('help');
    expect(r.success).toBe(true);
    // help 输出按 usage 展示,echo 与 boom 都继承自 makeEchoCommand 的 usage 'echo <text>'
    expect(r.output).toContain('echo <text>');
    expect(r.output).toContain('[Debug]');
    expect(r.output).toContain('[General]');
  });

  it('help 命令 (带参数) 输出单命令详情', () => {
    cc.registerGeneralCommands();
    const r = cc.execute('help echo');
    expect(r.success).toBe(true);
    expect(r.output).toContain('echo');
    expect(r.output).toContain('Usage: echo <text>');
    expect(r.output).toContain('Arguments:');
  });

  it('help 命令 (未知命令) 输出提示', () => {
    cc.registerGeneralCommands();
    const r = cc.execute('help nope');
    expect(r.success).toBe(true);
    expect(r.output).toContain('No help for');
  });
});

describe('ConsoleCommands — 预置命令注册', () => {
  it('registerAllDefaultCommands 幂等', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    const n1 = cc.getCommands().length;
    cc.registerAllDefaultCommands();
    const n2 = cc.getCommands().length;
    expect(n2).toBe(n1);
    expect(cc.isInitialized).toBe(true);
  });

  it('registerAllDefaultCommands 注册全部预置命令', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    const names = cc.getCommands().map((c) => c.name);
    // 通用
    expect(names).toContain('help');
    expect(names).toContain('clear');
    expect(names).toContain('history');
    // 引擎
    expect(names).toContain('engine.info');
    expect(names).toContain('engine.commands');
    expect(names).toContain('engine.categories');
    // 场景
    expect(names).toContain('scene.load');
    expect(names).toContain('scene.save');
    expect(names).toContain('scene.list');
    // 实体
    expect(names).toContain('entity.create');
    expect(names).toContain('entity.delete');
    expect(names).toContain('entity.list');
    expect(names).toContain('entity.count');
    // 物理
    expect(names).toContain('physics.gravity');
    expect(names).toContain('physics.pause');
    expect(names).toContain('physics.resume');
    // 渲染
    expect(names).toContain('render.pipeline');
    expect(names).toContain('render.quality');
    expect(names).toContain('render.screenshot');
    // 音频
    expect(names).toContain('audio.volume');
    expect(names).toContain('audio.play');
    expect(names).toContain('audio.stop');
    // 调试
    expect(names).toContain('debug.stats');
    expect(names).toContain('debug.fps');
    expect(names).toContain('debug.profile');
    expect(names).toContain('debug.systems');
    expect(names).toContain('debug.memory');
  });

  it('注册预置别名', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    expect(cc.getAlias('?')).toBe('help');
    expect(cc.getAlias('cls')).toBe('clear');
    expect(cc.getAlias('h')).toBe('history');
    expect(cc.getAlias('ls')).toBe('scene.list');
    expect(cc.getAlias('pause')).toBe('physics.pause');
    expect(cc.getAlias('resume')).toBe('physics.resume');
    expect(cc.getAlias('ss')).toBe('render.screenshot');
    expect(cc.getAlias('stats')).toBe('debug.stats');
    expect(cc.getAlias('fps')).toBe('debug.fps');
  });

  it('分类齐全', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    const cats = cc.getCategories();
    expect(cats).toContain('General');
    expect(cats).toContain('Engine');
    expect(cats).toContain('Scene');
    expect(cats).toContain('Entity');
    expect(cats).toContain('Physics');
    expect(cats).toContain('Rendering');
    expect(cats).toContain('Audio');
    expect(cats).toContain('Debug');
  });
});

describe('ConsoleCommands — 预置命令行为', () => {
  let cc: ConsoleCommands;
  beforeEach(() => {
    cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
  });

  it('clear 命令返回 __CLEAR__ 标记', () => {
    const r = cc.execute('clear');
    expect(r.success).toBe(true);
    expect(r.output).toBe('__CLEAR__');
  });

  it('history 命令输出历史', () => {
    cc.addToHistory('echo a');
    cc.addToHistory('echo b');
    const r = cc.execute('history');
    expect(r.success).toBe(true);
    expect(r.output).toContain('echo a');
    expect(r.output).toContain('echo b');
  });

  it('history 命令空历史输出提示', () => {
    // 新建 cc (无历史) 直接调用 handler (不经 execute,避免 execute 自身记录历史)
    const cc2 = new ConsoleCommands();
    cc2.registerAllDefaultCommands();
    const cmd = cc2.getCommand('history')!;
    const output = cmd.handler([]);
    expect(output).toContain('empty');
  });

  it('engine.info 命令', () => {
    const r = cc.execute('engine.info');
    expect(r.success).toBe(true);
    expect(r.output).toContain('VREEN Engine');
    expect(r.output).toContain('Commands:');
  });

  it('engine.commands 命令列出全部命令', () => {
    const r = cc.execute('engine.commands');
    expect(r.success).toBe(true);
    expect(r.output).toContain('help');
    expect(r.output).toContain('debug.fps');
  });

  it('engine.categories 命令', () => {
    const r = cc.execute('engine.categories');
    expect(r.success).toBe(true);
    expect(r.output).toContain('General');
    expect(r.output).toContain('Debug');
  });

  it('physics.gravity 合法输入', () => {
    const r = cc.execute('physics.gravity 0 -9.8 0');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Gravity set');
    expect(r.output).toContain('-9.8');
  });

  it('physics.gravity 非数字失败', () => {
    const r = cc.execute('physics.gravity 0 abc 0');
    expect(r.success).toBe(false);
    expect(r.output).toContain('not a finite number');
  });

  it('physics.gravity 分量不足失败', () => {
    const r = cc.execute('physics.gravity 0 -9.8');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Missing arguments');
  });

  it('physics.pause / physics.resume', () => {
    expect(cc.execute('physics.pause').output).toContain('paused');
    expect(cc.execute('physics.resume').output).toContain('resumed');
  });

  it('render.pipeline forward/deferred', () => {
    expect(cc.execute('render.pipeline forward').output).toContain('forward');
    expect(cc.execute('render.pipeline deferred').output).toContain('deferred');
  });

  it('render.pipeline 非法值失败', () => {
    const r = cc.execute('render.pipeline raytrace');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Unknown pipeline');
  });

  it('render.quality low/medium/high/ultra', () => {
    for (const q of ['low', 'medium', 'high', 'ultra']) {
      const r = cc.execute(`render.quality ${q}`);
      expect(r.success).toBe(true);
      expect(r.output).toContain(q);
    }
  });

  it('render.quality 非法值失败', () => {
    const r = cc.execute('render.quality epic');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Unknown quality');
  });

  it('render.screenshot', () => {
    const r = cc.execute('render.screenshot out.png');
    expect(r.success).toBe(true);
    expect(r.output).toContain('out.png');
  });

  it('audio.volume 合法', () => {
    const r = cc.execute('audio.volume 0.5');
    expect(r.success).toBe(true);
    expect(r.output).toContain('0.5');
  });

  it('audio.volume 超范围失败', () => {
    expect(cc.execute('audio.volume 2').success).toBe(false);
    expect(cc.execute('audio.volume -0.1').success).toBe(false);
  });

  it('audio.play / audio.stop', () => {
    expect(cc.execute('audio.play bgm').output).toContain('bgm');
    expect(cc.execute('audio.stop bgm').output).toContain('bgm');
  });

  it('debug.stats', () => {
    const r = cc.execute('debug.stats');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Console Stats');
    expect(r.output).toContain('Total commands');
  });

  it('debug.profile 合法', () => {
    const r = cc.execute('debug.profile 5');
    expect(r.success).toBe(true);
    expect(r.output).toContain('5s');
  });

  it('debug.profile 非法', () => {
    expect(cc.execute('debug.profile 0').success).toBe(false);
    expect(cc.execute('debug.profile -1').success).toBe(false);
    expect(cc.execute('debug.profile abc').success).toBe(false);
  });

  it('debug.fps 无 FrameProfiler 时提示', () => {
    const r = cc.execute('debug.fps');
    expect(r.success).toBe(true);
    expect(r.output).toContain('no FrameProfiler');
  });

  it('debug.systems 无 SystemProfiler 时提示', () => {
    const r = cc.execute('debug.systems');
    expect(r.success).toBe(true);
    expect(r.output).toContain('no SystemProfiler');
  });

  it('debug.memory 无 MemoryTracker 时提示', () => {
    const r = cc.execute('debug.memory');
    expect(r.success).toBe(true);
    expect(r.output).toContain('no MemoryTracker');
  });
});

describe('ConsoleCommands — 实体命令 (依赖 World)', () => {
  let cc: ConsoleCommands;
  let world: World;
  beforeEach(() => {
    cc = new ConsoleCommands();
    world = new World();
    cc.registerAllDefaultCommands(world);
  });

  it('entity.create 创建实体', () => {
    const r = cc.execute('entity.create Player');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Entity created');
    expect(r.output).toContain('0x');
    expect(world.entityCount()).toBe(1);
  });

  it('entity.create 不带名', () => {
    const r = cc.execute('entity.create');
    expect(r.success).toBe(true);
    expect(world.entityCount()).toBe(1);
  });

  it('entity.list 列出实体', () => {
    cc.execute('entity.create Alice');
    cc.execute('entity.create Bob');
    const r = cc.execute('entity.list');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Alice');
    expect(r.output).toContain('Bob');
  });

  it('entity.list 空世界', () => {
    // clearHistory 后执行,避免历史干扰断言
    const r = cc.execute('entity.list');
    expect(r.success).toBe(true);
    expect(r.output).toContain('no entities');
  });

  it('entity.count', () => {
    cc.execute('entity.create A');
    cc.execute('entity.create B');
    const r = cc.execute('entity.count');
    expect(r.success).toBe(true);
    expect(r.output).toContain('2');
  });

  it('entity.delete 删除实体', () => {
    const createRes = cc.execute('entity.create Target');
    // 从 "Entity created: id=0x10" 提取 id
    const match = createRes.output.match(/0x([0-9a-f]+)/i);
    expect(match).not.toBeNull();
    const idHex = match![1];
    const r = cc.execute(`entity.delete ${idHex}`);
    expect(r.success).toBe(true);
    expect(r.output).toContain('destroyed');
    expect(world.entityCount()).toBe(0);
  });

  it('entity.delete 无效 id 失败', () => {
    const r = cc.execute('entity.delete zzz');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Invalid entity id');
  });

  it('未绑定 World 时 entity.* 报错', () => {
    const cc2 = new ConsoleCommands();
    cc2.registerAllDefaultCommands();
    const r = cc2.execute('entity.list');
    expect(r.success).toBe(true);
    expect(r.output).toContain('no world bound');
  });
});

describe('ConsoleCommands — 场景命令 (依赖 Scene)', () => {
  let cc: ConsoleCommands;
  let scene: Scene;
  beforeEach(() => {
    cc = new ConsoleCommands();
    scene = new Scene();
    cc.registerAllDefaultCommands(undefined, scene);
  });

  it('scene.list 空场景', () => {
    const r = cc.execute('scene.list');
    expect(r.success).toBe(true);
    expect(r.output).toContain('empty scene');
  });

  it('scene.list 有子对象', () => {
    const obj = new Object3D();
    obj.name = 'Cube';
    scene.add(obj);
    const r = cc.execute('scene.list');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Cube');
  });

  it('scene.save 输出 JSON', () => {
    const obj = new Object3D();
    obj.name = 'Node';
    scene.add(obj);
    const r = cc.execute('scene.save');
    expect(r.success).toBe(true);
    const parsed = JSON.parse(r.output);
    expect(parsed.version).toBeDefined();
    expect(parsed.objects).toHaveLength(1);
  });

  it('scene.load 从 JSON 加载替换内容', () => {
    // 先构造一个目标场景 JSON
    const src = new Scene();
    src.add(Object.assign(new Object3D(), { name: 'Loaded' }));
    const json = SceneSerializer.serialize(src);
    // JSON.stringify 两次: 第一次得到 JSON 字符串,第二次得到带引号且转义内部引号的字符串
    // 这样 tokenizer 的 \" 转义处理能正确解析
    const argStr = JSON.stringify(JSON.stringify(json));
    const r = cc.execute(`scene.load ${argStr}`);
    expect(r.success).toBe(true);
    expect(r.output).toContain('Scene loaded');
    expect(scene.children.length).toBe(1);
    expect(scene.children[0].name).toBe('Loaded');
  });

  it('scene.load 非法 JSON 失败', () => {
    const r = cc.execute('scene.load "not-a-json"');
    expect(r.success).toBe(false);
    expect(r.output).toContain('Error:');
  });

  it('未绑定 Scene 时 scene.* 报错', () => {
    const cc2 = new ConsoleCommands();
    cc2.registerAllDefaultCommands();
    const r = cc2.execute('scene.list');
    expect(r.success).toBe(true);
    expect(r.output).toContain('no scene bound');
  });
});

describe('ConsoleCommands — 依赖注入 (debug.* 命令)', () => {
  it('setFrameProfiler → debug.fps 输出指标', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    const fp = new FrameProfiler();
    // 注入几个帧样本以产生非零 FPS
    fp.beginFrame();
    fp.endFrame({ drawCalls: 1, triangles: 10, vertices: 30, memoryMB: 0 });
    cc.setFrameProfiler(fp);
    const r = cc.execute('debug.fps');
    expect(r.success).toBe(true);
    expect(r.output).toContain('FPS:');
    expect(r.output).toContain('current=');
  });

  it('setSystemProfiler → debug.systems 输出耗时', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    const sp = new SystemProfiler();
    sp.begin('TestSystem');
    sp.end('TestSystem');
    cc.setSystemProfiler(sp);
    const r = cc.execute('debug.systems');
    expect(r.success).toBe(true);
    expect(r.output).toContain('TestSystem');
    expect(r.output).toContain('calls=');
  });

  it('setMemoryTracker → debug.memory 输出分配', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    const mt = new MemoryTracker();
    mt.track('Texture', 1024);
    mt.track('Buffer', 512);
    cc.setMemoryTracker(mt);
    const r = cc.execute('debug.memory');
    expect(r.success).toBe(true);
    expect(r.output).toContain('Memory Tracker');
    expect(r.output).toContain('Texture');
    expect(r.output).toContain('Buffer');
    expect(r.output).toContain('Active allocations: 2');
  });

  it('setWorld 后可执行 entity 命令', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    expect(cc.execute('entity.list').output).toContain('no world bound');
    cc.setWorld(new World());
    expect(cc.execute('entity.list').output).toContain('no entities');
  });

  it('setScene(null) 后 scene 命令报错', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    cc.setScene(new Scene());
    expect(cc.execute('scene.list').output).toContain('empty scene');
    cc.setScene(null);
    expect(cc.execute('scene.list').output).toContain('no scene bound');
  });
});

describe('ConsoleCommands — 统计与清理', () => {
  it('getStats 反映命令/别名/历史数', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    cc.addToHistory('a');
    cc.addToHistory('b');
    const s = cc.getStats();
    expect(s.total).toBeGreaterThan(0);
    expect(s.aliasCount).toBeGreaterThan(0);
    expect(s.historyCount).toBe(2);
    expect(s.isInitialized).toBe(true);
    expect(s.byCategory['General']).toBeGreaterThan(0);
    expect(s.byCategory['Debug']).toBeGreaterThan(0);
  });

  it('clear 清空所有状态', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    cc.addToHistory('a');
    cc.clear();
    expect(cc.getCommands()).toHaveLength(0);
    expect(cc.getHistory()).toHaveLength(0);
    expect(cc.aliases.size).toBe(0);
    expect(cc.isInitialized).toBe(false);
    const s = cc.getStats();
    expect(s.total).toBe(0);
    expect(s.isInitialized).toBe(false);
  });

  it('clear 后可重新注册', () => {
    const cc = new ConsoleCommands();
    cc.registerAllDefaultCommands();
    cc.clear();
    cc.registerAllDefaultCommands();
    expect(cc.isInitialized).toBe(true);
    expect(cc.getCommands().length).toBeGreaterThan(0);
  });
});

describe('ConsoleCommands — 全局单例', () => {
  beforeEach(() => {
    resetDefaultConsoleCommands();
  });

  it('getDefaultConsoleCommands 返回同一实例', () => {
    const a = getDefaultConsoleCommands();
    const b = getDefaultConsoleCommands();
    expect(a).toBe(b);
  });

  it('resetDefaultConsoleCommands 重置单例', () => {
    const a = getDefaultConsoleCommands();
    a.registerCommand(makeEchoCommand());
    expect(a.getCommands().length).toBe(1);
    resetDefaultConsoleCommands();
    const b = getDefaultConsoleCommands();
    expect(b).not.toBe(a);
    expect(b.getCommands().length).toBe(0);
  });
});
