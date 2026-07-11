import type { UpdateProgressSnapshot } from '../../shared/update-progress';

export {};

declare global {
  interface Window {
    updateProgress: {
      onSnapshot: (listener: (snapshot: UpdateProgressSnapshot) => void) => () => void;
    };
  }
}
