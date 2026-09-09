export type DockExpandAck = 'received' | 'timeout' | 'aborted';

export type DockExpandTransactionResult =
  | 'committed'
  | 'rolled-back'
  | 'persist-failed'
  | 'aborted'
  | 'destroyed';

export type DockExpandTransactionPort = {
  isDestroyed: () => boolean;
  isEpochCurrent: () => boolean;
  prepareNative: () => void;
  waitForReady: () => Promise<DockExpandAck>;
  sendPrepare: () => void;
  showMain: () => void;
  undock: () => Promise<boolean>;
  getPresentation: () => 'docked' | 'expanded' | 'collapsed';
  hideMain: () => void;
  destroyTab: () => void;
  sendRollback: () => void;
  sendCommitted: () => void;
  recordStage: (stage: string, result?: string, error?: unknown) => void;
};

export async function runDockExpandTransaction(
  port: DockExpandTransactionPort
): Promise<DockExpandTransactionResult> {
  try {
    port.prepareNative();
    const readyPromise = port.waitForReady();
    port.sendPrepare();
    const ready = await readyPromise;

    if (port.isDestroyed()) {
      return 'destroyed';
    }
    port.recordStage('prepare-ack', ready);
    if (ready !== 'received' || !port.isEpochCurrent()) {
      if (!port.isEpochCurrent()) {
        port.recordStage('prepare-abort', 'aborted');
      } else {
        port.recordStage('prepare-abort', ready);
      }
      return rollbackDockExpand(port, ready);
    }

    port.showMain();
    port.recordStage('shown', 'received');
    let didUndock: boolean;
    try {
      didUndock = await port.undock();
    } catch (error) {
      if (port.isDestroyed()) {
        return 'destroyed';
      }
      if (!port.isEpochCurrent()) {
        port.recordStage('abort', 'aborted', error);
        return finishSupersededExpand(port);
      }
      if (port.getPresentation() === 'expanded') {
        // The controller has already committed the visual undock; only the
        // persistence side failed. Keep the expanded surface usable and do
        // not claim a dock rollback that cannot be performed safely.
        port.destroyTab();
        port.sendCommitted();
        port.recordStage('commit-persist-error', 'error', error);
        return 'persist-failed';
      }
      return rollbackDockExpand(port, 'error', error);
    }

    if (port.isDestroyed()) {
      return 'destroyed';
    }
    if (!port.isEpochCurrent()) {
      port.recordStage('abort', 'aborted');
      return finishSupersededExpand(port);
    }
    if (!didUndock) {
      return rollbackDockExpand(port, 'undock-failed');
    }

    port.destroyTab();
    port.sendCommitted();
    port.recordStage('commit', 'received');
    return 'committed';
  } catch (error) {
    if (port.isDestroyed()) {
      return 'destroyed';
    }
    if (!port.isEpochCurrent()) {
      port.recordStage('abort', 'aborted', error);
      return finishSupersededExpand(port);
    }
    if (port.getPresentation() === 'expanded') {
      port.destroyTab();
      port.sendCommitted();
      port.recordStage('commit-runtime-error', 'error', error);
      return 'persist-failed';
    }
    return rollbackDockExpand(port, 'error', error);
  }
}

function rollbackDockExpand(
  port: DockExpandTransactionPort,
  result: string,
  error?: unknown
): DockExpandTransactionResult {
  if (!port.isEpochCurrent()) {
    port.recordStage('rollback-skipped', 'aborted', error);
    return finishSupersededExpand(port);
  }
  port.hideMain();
  port.sendRollback();
  port.recordStage('rollback', result, error);
  return 'rolled-back';
}

// A new drag invalidates native geometry work, but the renderer still needs
// a terminal message for the old prepare. Its transition-id guard rejects
// these messages if a newer transaction has already started.
function finishSupersededExpand(port: DockExpandTransactionPort): DockExpandTransactionResult {
  if (port.isDestroyed()) return 'destroyed';
  if (port.getPresentation() === 'docked') {
    port.sendRollback();
  } else if (port.getPresentation() === 'expanded') {
    port.destroyTab();
    port.sendCommitted();
  }
  return 'aborted';
}
