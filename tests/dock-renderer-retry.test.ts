import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { runDockExpandTransaction, type DockExpandAck } from '../main/dock-expand-transaction';

// Execute the actual App callback rather than reproducing its state machine.
function renderer() {
  const source = readFileSync(resolve(__dirname, '../renderer/src/App.tsx'), 'utf8');
  const start = source.indexOf('window.stickyNotes.onDockApplied((payload) => {');
  const end = source.indexOf('    const unsubscribeDockPreview', start);
  const handlerSource = source.slice(start, end).trim();
  let receive!: (payload: unknown) => void;
  const prepare = vi.fn();
  const commit = vi.fn();
  const context = {
    window: { stickyNotes: { onDockApplied: (fn: typeof receive) => { receive = fn; } } },
    document: { activeElement: null }, HTMLButtonElement: class {},
    dockTransitionIdRef: { current: 0 }, dockRef: { current: { side: 'right' } as unknown },
    dockRevealGenerationRef: { current: 0 }, activeDockShrinkTransactionRef: { current: null },
    dockShrinkRef: { current: null },
    flushSync: (fn: () => void) => fn(), prepareDockExpandReveal: prepare,
    runPendingDockExpandReveal: commit,
    ...Object.fromEntries(['setDockPreview', 'setStatusMessage', 'setDockExpandHold', 'setDockShrink',
      'setDockShrinkLanding', 'setDock', 'setIsCollapsed', 'setShouldRenderContent'].map(k => [k, vi.fn()]))
  };
  runInNewContext(ts.transpileModule(handlerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { receive: (payload: unknown) => receive(payload), context, prepare, commit };
}

describe('superseded expansion renderer recovery', () => {
  it('allows retry after re-grab during prepare and rejects an older rollback after a newer prepare', async () => {
    const ui = renderer();
    let epochCurrent = true;
    let ready!: (ack: DockExpandAck) => void;
    let id = 1;
    let presentation: 'docked' | 'expanded' = 'docked';
    const hide = vi.fn();
    const port = {
      isDestroyed: () => false, isEpochCurrent: () => epochCurrent,
      prepareNative: vi.fn(), waitForReady: () => new Promise<DockExpandAck>(r => { ready = r; }),
      sendPrepare: () => ui.receive({ dock: null, transitionId: id, expandFrom: { x: 0, y: 0, width: 96, height: 32 } }),
      showMain: vi.fn(), undock: async () => { presentation = 'expanded'; return true; },
      getPresentation: () => presentation, hideMain: hide, destroyTab: vi.fn(),
      sendRollback: () => ui.receive({ dock: { side: 'right' }, transitionId: id }),
      sendCommitted: () => ui.receive({ dock: null, transitionId: id, committed: true }), recordStage: vi.fn()
    };
    const first = runDockExpandTransaction(port);
    expect(ui.prepare).toHaveBeenCalledTimes(1);
    epochCurrent = false;
    ready('aborted');
    await expect(first).resolves.toBe('aborted');
    expect(hide).not.toHaveBeenCalled();
    expect(ui.context.dockRef.current).toEqual({ side: 'right' });
    id = 2; epochCurrent = true;
    const second = runDockExpandTransaction(port);
    expect(ui.prepare).toHaveBeenCalledTimes(2);
    ui.receive({ dock: { side: 'right' }, transitionId: 1 });
    expect(ui.context.dockRef.current).toBeNull();
    ready('received');
    await expect(second).resolves.toBe('committed');
    expect(ui.commit).toHaveBeenCalledWith(2);
  });
});
