import { describe, expect, it, vi } from 'vitest';
import { createDebouncedValueAction } from '../shared/debounced-action';

describe('createDebouncedValueAction', () => {
  it('runs once with the latest scheduled value after the delay', async () => {
    vi.useFakeTimers();
    const savedValues: string[] = [];
    const scheduler = createDebouncedValueAction<string>((value) => {
      savedValues.push(value);
    }, 300);

    scheduler.schedule('first');
    scheduler.schedule('second');
    await vi.advanceTimersByTimeAsync(299);

    expect(savedValues).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);

    expect(savedValues).toEqual(['second']);
    vi.useRealTimers();
  });

  it('flushes the latest scheduled value immediately', () => {
    vi.useFakeTimers();
    const savedValues: string[] = [];
    const scheduler = createDebouncedValueAction<string>((value) => {
      savedValues.push(value);
    }, 300);

    scheduler.schedule('draft');
    scheduler.flush();
    vi.advanceTimersByTime(300);

    expect(savedValues).toEqual(['draft']);
    vi.useRealTimers();
  });

  it('waits for an asynchronous action when flushing', async () => {
    vi.useFakeTimers();
    const savedValues: string[] = [];
    let finishSave: (() => void) | undefined;
    const saveCanFinish = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const scheduler = createDebouncedValueAction<string>(async (value) => {
      await saveCanFinish;
      savedValues.push(value);
    }, 300);

    scheduler.schedule('draft');
    const flush = scheduler.flush();
    expect(flush).toBeInstanceOf(Promise);
    await Promise.resolve();

    expect(savedValues).toEqual([]);

    finishSave?.();
    await flush;

    expect(savedValues).toEqual(['draft']);
    vi.useRealTimers();
  });
});
