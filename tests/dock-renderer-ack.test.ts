import { describe, expect, it, vi } from 'vitest';
import {
  waitForDockRendererAck,
  type DockRendererAckSource
} from '../main/dock-renderer-ack';

function createSource(): {
  source: DockRendererAckSource;
  emit: (channel: string, id: number) => void;
  listenerCount: () => number;
  offCalls: () => number;
  setDestroyed: () => void;
} {
  let listener: ((_event: unknown, channel: string, id: unknown) => void) | undefined;
  let destroyed = false;
  let offCallCount = 0;
  return {
    source: {
      isDestroyed: () => destroyed,
      on: (_event, next) => {
        listener = next;
      },
      off: (_event, next) => {
        offCallCount += 1;
        if (listener === next) {
          listener = undefined;
        }
      }
    },
    emit: (channel, id) => listener?.(undefined, channel, id),
    listenerCount: () => (listener ? 1 : 0),
    offCalls: () => offCallCount,
    setDestroyed: () => {
      destroyed = true;
    }
  };
}

describe('dock renderer ACK waiter', () => {
  it('cleans the listener and timers immediately after success', async () => {
    vi.useFakeTimers();
    const harness = createSource();
    const result = waitForDockRendererAck(harness.source, 'ready', 1, () => true, 600);
    expect(harness.listenerCount()).toBe(1);
    harness.emit('ready', 1);
    await expect(result).resolves.toBe('received');
    expect(harness.listenerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.listenerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('keeps only failed expand observation alive for a late ACK, then cleans up', async () => {
    vi.useFakeTimers();
    const harness = createSource();
    const lateAck = vi.fn();
    const result = waitForDockRendererAck(
      harness.source,
      'ready',
      2,
      () => true,
      100,
      lateAck
    );
    await vi.advanceTimersByTimeAsync(100);
    await expect(result).resolves.toBe('timeout');
    expect(harness.listenerCount()).toBe(1);
    harness.emit('ready', 2);
    expect(lateAck).toHaveBeenCalledOnce();
    harness.emit('ready', 2);
    expect(lateAck).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1_100);
    expect(harness.listenerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('cleans an aborted waiter when its source is destroyed', async () => {
    vi.useFakeTimers();
    const harness = createSource();
    const result = waitForDockRendererAck(harness.source, 'ready', 3, () => true, 600, vi.fn());
    harness.setDestroyed();
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toBe('aborted');
    // A destroyed WebContents needs no off() call and must not be touched again.
    expect(harness.offCalls()).toBe(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(harness.offCalls()).toBe(0);
    vi.useRealTimers();
  });
});
