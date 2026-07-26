import { describe, expect, it } from 'vitest';
import {
  calculateInitialScale,
  clampPan,
  clampScale,
  getZoomedPan,
  reconcileViewportTransform
} from '../renderer/src/image-preview-zoom';
import {
  isImagePreviewSnapshot,
  resolvePreviewActiveImageId
} from '../shared/image-preview';

describe('image preview zoom math', () => {
  it('fits without upscaling small images', () => {
    expect(calculateInitialScale({ width: 800, height: 600 }, { width: 200, height: 100 })).toBe(1);
    expect(calculateInitialScale({ width: 800, height: 600 }, { width: 1600, height: 600 })).toBe(0.5);
  });

  it('keeps zoom scale within its bounds', () => {
    expect(clampScale(0.25, 0.5, 8)).toBe(0.5);
    expect(clampScale(10, 0.5, 8)).toBe(8);
  });

  it('keeps the image point beneath the cursor stable while zooming', () => {
    expect(
      getZoomedPan({
        pan: { x: 0, y: 0 },
        cursor: { x: 100, y: 40 },
        previousScale: 1,
        nextScale: 2
      })
    ).toEqual({ x: -100, y: -40 });
  });

  it('clamps panning to the rendered image edges', () => {
    expect(
      clampPan(
        { x: 500, y: -500 },
        { width: 800, height: 600 },
        { width: 1000, height: 800 },
        1
      )
    ).toEqual({ x: 100, y: -100 });
  });

  it('re-clamps an existing zoomed pan when the viewport changes', () => {
    expect(
      reconcileViewportTransform({
        viewport: { width: 1200, height: 900 },
        image: { width: 1000, height: 800 },
        pan: { x: 500, y: -500 },
        scale: 2,
        initialScale: 1
      })
    ).toEqual({
      pan: { x: 400, y: -350 },
      scale: 2,
      initialScale: 1
    });
  });

  it('re-fits an untouched image when the viewport changes', () => {
    expect(
      reconcileViewportTransform({
        viewport: { width: 800, height: 600 },
        image: { width: 1600, height: 1200 },
        pan: { x: 0, y: 0 },
        scale: 0.25,
        initialScale: 0.25
      })
    ).toEqual({
      pan: { x: 0, y: 0 },
      scale: 0.5,
      initialScale: 0.5
    });
  });
});

describe('image preview selection', () => {
  const snapshot = {
    noteId: 'note-1',
    activeImageId: 'image-2',
    images: [
      { id: 'image-1', src: 'one', width: 100, height: 100 },
      { id: 'image-2', src: 'two', width: 100, height: 100 }
    ]
  };

  it('honors an explicit image open request', () => {
    expect(
      resolvePreviewActiveImageId('image-1', {
        ...snapshot,
        requestedActiveImageId: 'image-2'
      })
    ).toBe('image-2');
  });

  it('preserves the displayed image during a list-only refresh', () => {
    expect(resolvePreviewActiveImageId('image-1', snapshot)).toBe('image-1');
  });

  it('falls back to the snapshot active image when the current image disappeared', () => {
    expect(resolvePreviewActiveImageId('deleted-image', snapshot)).toBe('image-2');
  });

  it('rejects an explicit open request for an image outside the snapshot', () => {
    expect(
      isImagePreviewSnapshot({
        ...snapshot,
        requestedActiveImageId: 'missing-image'
      })
    ).toBe(false);
  });
});
