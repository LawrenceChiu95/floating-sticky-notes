import type { ReleaseFeedbackRenderedPayload } from '../../shared/release-feedback-window';

declare global {
  interface Window {
    releaseFeedback: {
      onSnapshot: (listener: (snapshot: unknown) => void) => () => void;
      reportRendered: (payload: ReleaseFeedbackRenderedPayload) => void;
      dismiss: () => void;
    };
  }
}

export {};
