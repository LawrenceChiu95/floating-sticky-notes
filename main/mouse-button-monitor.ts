// 鼠标左键物理状态监视器（仅 macOS）：spawn 一次性常驻 helper
// （native/mouse-state.c → bin/mouse-state-darwin-arm64），从 stdout 流式接收
// down/up 翻转。用途：原生 app-region 拖动没有结束事件，轮询窗口 bounds/光标
// 在原理上区分不了「按住不动」和「松手不动」（真机实锤：move 事件被合并时
// bounds 冻结、光标判据同构）；物理按键状态是唯一确定性信号。
// helper 缺失/启动失败/非 macOS 时返回 null，调用方退回 settle watch 启发式
// （Windows 的 move 投递可靠，启发式够用；Mac 上 helper 随仓库提交、随包分发，
// 正常不会缺席）。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type MouseButtonMonitor = {
  // 左键当前是否按住（最近一次翻转的状态；启动时以 helper 首行为准）。
  isDown: () => boolean;
  // helper 是否还活着。死亡（spawn error/进程退出）后 isDown 恒为 false，
  // 调用方必须把本监视器视为缺席、退回纯光标启发式——否则「按住不动」会
  // 在死亡后的假阴性下被误判成松手（.helper 是 8ms 轮询循环，死亡即环境异常，
  // 不自动复活，记日志降级）。
  isActive: () => boolean;
  onPress: (listener: () => void) => () => void;
  onRelease: (listener: () => void) => () => void;
  dispose: () => void;
};

export function createMouseButtonMonitor(options: {
  isPackaged: boolean;
  resourcesPath: string;
  // dev 下的项目根（bin/ 所在）；打包后从 resourcesPath 取。
  devRoot: string;
  log?: (event: string, details?: Record<string, unknown>) => void;
}): MouseButtonMonitor | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  const binaryPath = options.isPackaged
    ? join(options.resourcesPath, 'mouse-state-darwin-arm64')
    : join(options.devRoot, 'bin', 'mouse-state-darwin-arm64');
  if (!existsSync(binaryPath)) {
    options.log?.('mouse_button_monitor_missing', { binaryPath });
    return null;
  }

  let down = false;
  let alive = true;
  const pressListeners = new Set<() => void>();
  const releaseListeners = new Set<() => void>();

  let child;
  try {
    child = spawn(binaryPath, [], { stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (error) {
    options.log?.('mouse_button_monitor_spawn_failed', { error: String(error) });
    return null;
  }
  // helper 死亡 = 监视器整体降级：状态清零（避免冻结在 down=true 把所有
  // settle 永久挡在按键护栏外），调用方经 isActive() 退回启发式。
  const markDead = (event: string, details?: Record<string, unknown>): void => {
    if (!alive) {
      return;
    }
    alive = false;
    down = false;
    options.log?.(event, details);
  };
  child.on('error', (error) => {
    markDead('mouse_button_monitor_error', { error: String(error) });
  });
  child.on('exit', (code, signal) => {
    markDead('mouse_button_monitor_exit', { code, signal });
  });

  let buffered = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let newlineIndex = buffered.indexOf('\n');
    while (newlineIndex !== -1) {
      const line = buffered.slice(0, newlineIndex).trim();
      buffered = buffered.slice(newlineIndex + 1);
      newlineIndex = buffered.indexOf('\n');
      if (line === 'down') {
        down = true;
        for (const listener of pressListeners) {
          listener();
        }
      } else if (line === 'up') {
        down = false;
        for (const listener of releaseListeners) {
          listener();
        }
      }
    }
  });

  const subscribe =
    (listeners: Set<() => void>) =>
    (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    };

  return {
    isDown: () => down,
    isActive: () => alive,
    onPress: subscribe(pressListeners),
    onRelease: subscribe(releaseListeners),
    dispose: () => {
      alive = false;
      down = false;
      child.kill();
    }
  };
}
