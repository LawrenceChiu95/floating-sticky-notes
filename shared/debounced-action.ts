type TimerId = ReturnType<typeof setTimeout>;

export type DebouncedValueAction<T> = {
  schedule: (value: T) => void;
  flush: () => Promise<void>;
  cancel: () => void;
};

export function createDebouncedValueAction<T>(
  action: (value: T) => void | Promise<void>,
  delayMs: number
): DebouncedValueAction<T> {
  let timer: TimerId | undefined;
  let latestValue: T | undefined;
  let hasValue = false;
  let pendingAction: Promise<void> = Promise.resolve();

  const clearPendingTimer = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  const run = (): Promise<void> => {
    if (!hasValue) {
      return pendingAction;
    }

    const value = latestValue as T;
    latestValue = undefined;
    hasValue = false;
    const actionPromise = Promise.resolve(action(value));
    pendingAction = actionPromise.catch(() => undefined);
    return actionPromise;
  };

  return {
    schedule(value) {
      latestValue = value;
      hasValue = true;
      clearPendingTimer();
      timer = setTimeout(() => {
        timer = undefined;
        void run().catch(() => undefined);
      }, delayMs);
    },
    flush() {
      clearPendingTimer();
      return run();
    },
    cancel() {
      clearPendingTimer();
      latestValue = undefined;
      hasValue = false;
    }
  };
}
