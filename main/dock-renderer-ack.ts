export type DockRendererAck = 'received' | 'timeout' | 'aborted';

export type DockRendererAckSource = {
  isDestroyed: () => boolean;
  on: (event: 'ipc-message', listener: (_event: unknown, channel: string, id: unknown) => void) => void;
  off: (event: 'ipc-message', listener: (_event: unknown, channel: string, id: unknown) => void) => void;
};

export function waitForDockRendererAck(
  source: DockRendererAckSource,
  channel: string,
  transitionId: number,
  isEpochCurrent: () => boolean,
  timeoutMs = 600,
  onLateAck?: () => void
): Promise<DockRendererAck> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    let lateAckRecorded = false;
    let abortPoll: NodeJS.Timeout | undefined;
    let fallback: NodeJS.Timeout | undefined;
    let lateAckTimer: NodeJS.Timeout | undefined;
    const onMessage = (_event: unknown, incomingChannel: string, incomingId: unknown): void => {
      if (incomingChannel !== channel || incomingId !== transitionId) {
        return;
      }
      if (settled) {
        if (!lateAckRecorded) {
          lateAckRecorded = true;
          onLateAck?.();
        }
        return;
      }
      finish('received');
    };
    const cleanup = (): void => {
      if (lateAckTimer) {
        clearTimeout(lateAckTimer);
        lateAckTimer = undefined;
      }
      if (!source.isDestroyed()) {
        source.off('ipc-message', onMessage);
      }
    };
    const finish = (result: DockRendererAck): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (abortPoll) {
        clearInterval(abortPoll);
      }
      if (fallback) {
        clearTimeout(fallback);
      }
      if (onLateAck && result !== 'received' && !source.isDestroyed()) {
        lateAckTimer = setTimeout(cleanup, Math.max(0, timeoutMs - (Date.now() - startedAt)) + 1_000);
      } else {
        cleanup();
      }
      resolve(result);
    };

    source.on('ipc-message', onMessage);
    abortPoll = setInterval(() => {
      if (source.isDestroyed()) {
        finish('aborted');
      } else if (!isEpochCurrent()) {
        finish('aborted');
      }
    }, 50);
    fallback = setTimeout(() => finish('timeout'), timeoutMs);
  });
}
