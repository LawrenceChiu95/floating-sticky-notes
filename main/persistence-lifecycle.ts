export type PreventableLifecycleEvent = {
  preventDefault: () => void;
};

type PersistenceLifecycleOptions = {
  flush: () => Promise<void>;
  timeoutMs?: number;
};

type QuitPersistenceOptions = PersistenceLifecycleOptions & {
  quit: () => void;
};

type ClosePersistenceOptions = PersistenceLifecycleOptions & {
  close: () => void;
};

export function createQuitPersistenceHandler(options: QuitPersistenceOptions) {
  let canQuit = false;
  let pendingFlush: Promise<void> | undefined;

  return (event: PreventableLifecycleEvent): void => {
    if (canQuit) {
      return;
    }

    event.preventDefault();
    pendingFlush ??= waitForPersistenceFlush(options)
      .finally(() => {
        canQuit = true;
        options.quit();
      });
  };
}

export function createClosePersistenceHandler(options: ClosePersistenceOptions) {
  let canClose = false;
  let pendingFlush: Promise<void> | undefined;

  return (event: PreventableLifecycleEvent): void => {
    if (canClose) {
      return;
    }

    event.preventDefault();
    pendingFlush ??= waitForPersistenceFlush(options)
      .finally(() => {
        canClose = true;
        options.close();
      });
  };
}

function waitForPersistenceFlush(options: PersistenceLifecycleOptions): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutMs = options.timeoutMs ?? 5000;

  return Promise.race([
    options.flush().catch(() => undefined),
    new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, timeoutMs);
    })
  ]).finally(() => {
    if (timeout) {
      clearTimeout(timeout);
    }
  });
}
