import { describe, expect, it, vi } from 'vitest';
import {
  createClosePersistenceHandler,
  createQuitPersistenceHandler
} from '../main/persistence-lifecycle';

describe('persistence lifecycle handlers', () => {
  it('prevents quit until pending persistence has flushed', async () => {
    const events: string[] = [];
    let releaseFlush: (() => void) | undefined;
    const flushCanFinish = new Promise<void>((resolve) => {
      releaseFlush = resolve;
    });
    const handler = createQuitPersistenceHandler({
      flush: async () => {
        events.push('flush-start');
        await flushCanFinish;
        events.push('flush-finish');
      },
      quit: () => {
        events.push('quit');
      }
    });
    const event = createPreventableEvent();

    handler(event);
    await Promise.resolve();

    expect(event.preventDefaultCount).toBe(1);
    expect(events).toEqual(['flush-start']);

    releaseFlush?.();
    await flushCanFinish;
    await flushMicrotasks();

    expect(events).toEqual(['flush-start', 'flush-finish', 'quit']);
  });

  it('prevents a window close until pending persistence has flushed', async () => {
    const events: string[] = [];
    const handler = createClosePersistenceHandler({
      flush: async () => {
        events.push('flush');
      },
      close: () => {
        events.push('close');
      }
    });
    const firstClose = createPreventableEvent();
    const secondClose = createPreventableEvent();

    handler(firstClose);
    await flushMicrotasks();
    handler(secondClose);

    expect(firstClose.preventDefaultCount).toBe(1);
    expect(secondClose.preventDefaultCount).toBe(0);
    expect(events).toEqual(['flush', 'close']);
  });

  it('continues quitting when persistence flush does not settle before the timeout', async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const handler = createQuitPersistenceHandler({
      flush: async () => {
        events.push('flush-start');
        await new Promise(() => undefined);
      },
      quit: () => {
        events.push('quit');
      },
      timeoutMs: 100
    });
    const event = createPreventableEvent();

    handler(event);
    await vi.advanceTimersByTimeAsync(99);

    expect(events).toEqual(['flush-start']);

    await vi.advanceTimersByTimeAsync(1);

    expect(events).toEqual(['flush-start', 'quit']);
    vi.useRealTimers();
  });
});

function createPreventableEvent(): { preventDefault: () => void; preventDefaultCount: number } {
  return {
    preventDefaultCount: 0,
    preventDefault() {
      this.preventDefaultCount += 1;
    }
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
  }
}
