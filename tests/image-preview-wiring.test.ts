import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mainSource = readFileSync(resolve(__dirname, '../main/main.ts'), 'utf8');
const preloadSource = readFileSync(
  resolve(__dirname, '../preload/image-preview-preload.ts'),
  'utf8'
);
const notePreloadSource = readFileSync(resolve(__dirname, '../preload/preload.ts'), 'utf8');
const rendererSource = readFileSync(
  resolve(__dirname, '../renderer/src/image-preview.tsx'),
  'utf8'
);
const styles = readFileSync(
  resolve(__dirname, '../renderer/src/image-preview.css'),
  'utf8'
);

describe('image preview wiring', () => {
  it('constructs the controller and routes lifecycle events to it', () => {
    expect(mainSource).toContain('imagePreviewController = new ImagePreviewController');
    expect(mainSource).toContain('handleSourceClosed(noteWebContentsId)');
    expect(mainSource).toContain('handleNoteDeleted(sourceNote.id)');
    expect(mainSource).toContain('imagePreviewController?.dispose()');
    expect(mainSource).toContain('ipcMain.handle(IMAGE_PREVIEW_CHANNELS.open');
  });

  it('uses shared channels and validates snapshots in the preload boundary', () => {
    expect(notePreloadSource).toContain('IMAGE_PREVIEW_CHANNELS.open');
    expect(preloadSource).toContain('isImagePreviewSnapshot(snapshot)');
    expect(preloadSource).not.toContain('snapshot as ImagePreviewSnapshot');
  });

  it('routes window move deltas through the shared channel end to end', () => {
    expect(mainSource).toContain('ipcMain.handle(IMAGE_PREVIEW_CHANNELS.move');
    expect(mainSource).toContain('imagePreviewController?.move(event.sender.id, dx, dy)');
    expect(preloadSource).toContain('IMAGE_PREVIEW_CHANNELS.move');
  });

  it('flushes the pending window-drag delta before clearing drag state', () => {
    expect(rendererSource).toMatch(
      /cancelAnimationFrame\(windowDrag\.frame\);[\s\S]*flushWindowDrag\(\);[\s\S]*windowDragRef\.current = undefined;/
    );
  });

  it('uses the preview current display as the resize limit', () => {
    expect(mainSource).toContain('screen.getDisplayMatching(bounds).workArea');
    expect(mainSource).not.toContain('{ width: workArea.width, height: workArea.height }');
  });

  it('keeps preview controls visible over both light and dark images', () => {
    expect(styles).toMatch(
      /\.image-preview-close,\s*\.image-preview-nav\s*{[^}]*background:\s*rgba\(22, 22, 22, 0\.68\);/s
    );
    expect(styles).toMatch(
      /\.image-preview-close,\s*\.image-preview-nav\s*{[^}]*border:\s*1px solid rgba\(255, 255, 255, 0\.42\);/s
    );
    expect(styles).toMatch(
      /\.image-preview-close,\s*\.image-preview-nav\s*{[^}]*box-shadow:/s
    );
    expect(styles).toMatch(/\.image-preview-nav:disabled\s*{[^}]*opacity:\s*0\.28;/s);
    expect(styles).toContain('.image-preview-nav:not(:disabled):focus-visible');
  });
});
