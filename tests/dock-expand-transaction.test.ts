import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { waitForDockRendererAck } from '../main/dock-renderer-ack';
import {
  runDockExpandTransaction,
  type DockExpandAck,
  type DockExpandTransactionPort
} from '../main/dock-expand-transaction';

function createPort(overrides: Partial<DockExpandTransactionPort> = {}): {
  port: DockExpandTransactionPort;
  state: {
    destroyed: boolean;
    epochCurrent: boolean;
    presentation: 'docked' | 'expanded';
    prepareNative: number;
    show: number;
    hide: number;
    destroyTab: number;
    rollback: number;
    committed: number;
    stages: Array<{ stage: string; result?: string }>;
  };
  resolveReady: (ack: DockExpandAck) => void;
} {
  const state = {
    destroyed: false,
    epochCurrent: true,
    presentation: 'docked' as 'docked' | 'expanded',
    prepareNative: 0,
    show: 0,
    hide: 0,
    destroyTab: 0,
    rollback: 0,
    committed: 0,
    stages: [] as Array<{ stage: string; result?: string }>
  };
  let resolveReady!: (ack: DockExpandAck) => void;
  const port: DockExpandTransactionPort = {
    isDestroyed: () => state.destroyed,
    isEpochCurrent: () => state.epochCurrent,
    prepareNative: () => {
      state.prepareNative += 1;
    },
    waitForReady: () => new Promise<DockExpandAck>((resolve) => {
      resolveReady = resolve;
    }),
    sendPrepare: () => undefined,
    showMain: () => {
      state.show += 1;
    },
    undock: async () => {
      state.presentation = 'expanded';
      return true;
    },
    getPresentation: () => state.presentation,
    hideMain: () => {
      state.hide += 1;
    },
    destroyTab: () => {
      state.destroyTab += 1;
    },
    sendRollback: () => {
      state.rollback += 1;
    },
    sendCommitted: () => {
      state.committed += 1;
    },
    recordStage: (stage, result) => {
      state.stages.push({ stage, result });
    },
    ...overrides
  };
  return { port, state, resolveReady };
}

describe('dock expand transaction', () => {
  it('times out without showing or moving the visible surface', async () => {
    const harness = createPort({
      waitForReady: async () => 'timeout'
    });

    await expect(runDockExpandTransaction(harness.port)).resolves.toBe('rolled-back');
    expect(harness.state.prepareNative).toBe(1);
    expect(harness.state.show).toBe(0);
    expect(harness.state.hide).toBe(1);
    expect(harness.state.rollback).toBe(1);
    expect(harness.state.committed).toBe(0);
  });

  it('ignores a timed-out ACK while a retry on the same window succeeds', async () => {
    vi.useFakeTimers();
    try {
      const emitter = new EventEmitter();
      const source = Object.assign(emitter, { isDestroyed: () => false });
      const lateAck = vi.fn();
      let id = 1;
      const harness = createPort({
        waitForReady: () => waitForDockRendererAck(source, 'ready', id, () => true, 600, lateAck)
      });
      const first = runDockExpandTransaction(harness.port);
      await vi.advanceTimersByTimeAsync(600);
      await expect(first).resolves.toBe('rolled-back');
      id = 2;
      const retry = runDockExpandTransaction(harness.port);
      emitter.emit('ipc-message', undefined, 'ready', 1);
      await Promise.resolve();
      expect(lateAck).toHaveBeenCalledOnce();
      expect(harness.state.show).toBe(0);
      emitter.emit('ipc-message', undefined, 'ready', 2);
      await expect(retry).resolves.toBe('committed');
      expect(harness.state.show).toBe(1);
      expect(harness.state.committed).toBe(1);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(emitter.listenerCount('ipc-message')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records an aborted old epoch with renderer cleanup but no native window mutation', async () => {
    const harness = createPort({
      waitForReady: async () => 'aborted'
    });
    harness.state.epochCurrent = false;

    await expect(runDockExpandTransaction(harness.port)).resolves.toBe('aborted');
    expect(harness.state.show).toBe(0);
    expect(harness.state.hide).toBe(0);
    expect(harness.state.rollback).toBe(1);
    expect(harness.state.stages).toContainEqual({ stage: 'prepare-abort', result: 'aborted' });
  });

  it('allows a new attempt to succeed after a failed attempt', async () => {
    const first = createPort({ waitForReady: async () => 'timeout' });
    await expect(runDockExpandTransaction(first.port)).resolves.toBe('rolled-back');

    const second = createPort({ waitForReady: async () => 'received' });
    await expect(runDockExpandTransaction(second.port)).resolves.toBe('committed');
    expect(second.state.show).toBe(1);
    expect(second.state.hide).toBe(0);
    expect(second.state.destroyTab).toBe(1);
    expect(second.state.committed).toBe(1);
  });

  it('keeps the expanded surface usable when persistence rejects after undock', async () => {
    const harness = createPort({
      waitForReady: async () => 'received',
      undock: async () => {
        harness.state.presentation = 'expanded';
        throw new Error('persist rejected');
      }
    });

    await expect(runDockExpandTransaction(harness.port)).resolves.toBe('persist-failed');
    expect(harness.state.show).toBe(1);
    expect(harness.state.hide).toBe(0);
    expect(harness.state.rollback).toBe(0);
    expect(harness.state.destroyTab).toBe(1);
    expect(harness.state.committed).toBe(1);
    expect(harness.state.stages).toContainEqual({
      stage: 'commit-persist-error',
      result: 'error'
    });
  });

  it('does not touch windows after the renderer/window closes', async () => {
    const harness = createPort({
      waitForReady: async () => {
        harness.state.destroyed = true;
        return 'aborted';
      }
    });

    await expect(runDockExpandTransaction(harness.port)).resolves.toBe('destroyed');
    expect(harness.state.show).toBe(0);
    expect(harness.state.hide).toBe(0);
    expect(harness.state.rollback).toBe(0);
  });
});
