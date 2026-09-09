import { describe, expect, it, vi } from 'vitest';
import { createDockWindowMoveHandler } from '../main/dock-window-move';

describe('dock tab move initialization guard', () => {
  it('ignores a synchronous restored setBounds move until state is ready', () => {
    let ready = false;
    let onMove!: () => void;
    const onSave = vi.fn();
    const handleMove = createDockWindowMoveHandler(
      () => ready,
      () => onMove(),
      onSave
    );

    // BrowserWindow.setBounds can synchronously emit this event during startup.
    handleMove();
    expect(onSave).not.toHaveBeenCalled();

    onMove = vi.fn();
    ready = true;
    handleMove();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onSave).toHaveBeenCalledOnce();
  });
});
