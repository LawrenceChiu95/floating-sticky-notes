import { gt, gte, prerelease, valid } from 'semver';
import {
  formatReleaseNotesDetail,
  type ReleaseNotes
} from '../shared/release-notes';
import type { ReleaseFeedbackStateStore } from './release-feedback-state';

export type ReleaseFeedbackDialog = {
  showMessageBox: (options: {
    type: 'info';
    title: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
    noLink?: boolean;
  }) => Promise<{ response: number }>;
};

export type ReleaseFeedbackController = {
  initialize: () => Promise<void>;
  showAutomaticallyIfNeeded: () => Promise<void>;
  showCurrentRelease: () => Promise<void>;
  beginQuit: () => void;
};

export type ReleaseFeedbackControllerOptions = {
  currentVersion: string;
  isPackaged: boolean;
  hadExistingInstallation: boolean;
  releaseNotes?: ReleaseNotes;
  stateStore: ReleaseFeedbackStateStore;
  dialog: ReleaseFeedbackDialog;
  logWarning?: (message: string, error: unknown) => void;
};

type PresentationResult = {
  initiatedBy: 'automatic' | 'manual';
  shown: boolean;
};

const FIRST_AUTOMATIC_RELEASE_FEEDBACK_VERSION = '0.1.14';

export function createReleaseFeedbackController(
  options: ReleaseFeedbackControllerOptions
): ReleaseFeedbackController {
  const logWarning = options.logWarning ?? ((message, error) => console.warn(message, error));
  let initialized = false;
  let automaticShowPending = false;
  let quitting = false;
  let presentation: Promise<PresentationResult> | undefined;

  const normalizedCurrentVersion = valid(options.currentVersion) ?? undefined;
  const stableVersion =
    normalizedCurrentVersion && prerelease(normalizedCurrentVersion) === null
      ? normalizedCurrentVersion
      : undefined;
  const automaticVersion =
    stableVersion && gte(stableVersion, FIRST_AUTOMATIC_RELEASE_FEEDBACK_VERSION)
      ? stableVersion
      : undefined;

  return {
    async initialize(): Promise<void> {
      if (initialized) {
        return;
      }

      initialized = true;
      if (!options.isPackaged || !automaticVersion) {
        return;
      }

      const state = await options.stateStore.load();
      if (state.kind === 'unavailable') {
        return;
      }

      const lastShownReleaseVersion = state.lastShownReleaseVersion;
      if (!options.hadExistingInstallation) {
        if (!lastShownReleaseVersion || gt(automaticVersion, lastShownReleaseVersion)) {
          await saveVersion(options.stateStore, automaticVersion, logWarning);
        }
        return;
      }

      automaticShowPending =
        !lastShownReleaseVersion || gt(automaticVersion, lastShownReleaseVersion);
    },

    async showAutomaticallyIfNeeded(): Promise<void> {
      if (!automaticShowPending || quitting || !automaticVersion) {
        return;
      }

      automaticShowPending = false;
      if (!options.releaseNotes || options.releaseNotes.sections.length === 0) {
        await saveVersion(options.stateStore, automaticVersion, logWarning);
        return;
      }

      const result = await present('automatic');
      if (result.initiatedBy === 'automatic' && result.shown) {
        await saveVersion(options.stateStore, automaticVersion, logWarning);
      }
    },

    async showCurrentRelease(): Promise<void> {
      if (quitting) {
        return;
      }

      await present('manual');
    },

    beginQuit(): void {
      quitting = true;
    }
  };

  function present(initiatedBy: PresentationResult['initiatedBy']): Promise<PresentationResult> {
    if (presentation) {
      return presentation;
    }

    const promise = presentReleaseNotes(initiatedBy).finally(() => {
      if (presentation === promise) {
        presentation = undefined;
      }
    });
    presentation = promise;
    return promise;
  }

  async function presentReleaseNotes(
    initiatedBy: PresentationResult['initiatedBy']
  ): Promise<PresentationResult> {
    try {
      await options.dialog.showMessageBox({
        type: 'info',
        title: '本版更新',
        message:
          initiatedBy === 'automatic'
            ? `悬浮便签已更新到 v${options.currentVersion}`
            : `当前版本 v${options.currentVersion}`,
        detail: formatReleaseNotesDetail(options.releaseNotes),
        buttons: ['知道了'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      });
      return { initiatedBy, shown: true };
    } catch (error) {
      logWarning('Unable to show release feedback', error);
      return { initiatedBy, shown: false };
    }
  }
}

async function saveVersion(
  stateStore: ReleaseFeedbackStateStore,
  version: string,
  logWarning: (message: string, error: unknown) => void
): Promise<void> {
  try {
    await stateStore.save(version);
  } catch (error) {
    logWarning('Unable to save release feedback state', error);
  }
}
