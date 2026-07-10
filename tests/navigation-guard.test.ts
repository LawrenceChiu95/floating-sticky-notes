import { describe, expect, it } from 'vitest';
import { preventNoteWindowNavigation } from '../main/navigation-guard';

describe('preventNoteWindowNavigation', () => {
  it('prevents top-level and frame navigation inside a note window', () => {
    const window = createNavigationTestWindow();

    preventNoteWindowNavigation({
      onWillNavigate: (listener) => {
        window.on('will-navigate', listener);
      },
      onWillFrameNavigate: (listener) => {
        window.on('will-frame-navigate', listener);
      }
    });
    window.emit('will-navigate');
    window.emit('will-frame-navigate');

    expect(window.preventedEvents).toEqual(['will-navigate', 'will-frame-navigate']);
  });
});

type NavigationEventName = 'will-navigate' | 'will-frame-navigate';

type NavigationTestWindow = {
  on: (eventName: NavigationEventName, listener: (event: { preventDefault: () => void }) => void) => void;
  preventedEvents: NavigationEventName[];
  emit: (eventName: NavigationEventName) => void;
};

function createNavigationTestWindow(): NavigationTestWindow {
  const listeners = new Map<NavigationEventName, (event: { preventDefault: () => void }) => void>();
  const window: NavigationTestWindow = {
    on: (eventName, listener) => {
      listeners.set(eventName, listener);
    },
    preventedEvents: [],
    emit: (eventName) => {
      listeners.get(eventName)?.({
        preventDefault: () => {
          window.preventedEvents.push(eventName);
        }
      });
    }
  };

  return window;
}
