import { gt, gte, lte, prerelease, valid } from 'semver';
import type {
  ReleaseFeedbackPresentationResult,
  ReleaseFeedbackSnapshot
} from '../shared/release-feedback-window';
import type { ReleaseNotes, ReleaseNotesArchive } from '../shared/release-notes';
import type { ReleaseFeedbackStateStore } from './release-feedback-state';

export type ReleaseFeedbackPresenter = {
  show: (snapshot: ReleaseFeedbackSnapshot) => Promise<ReleaseFeedbackPresentationResult>;
  dispose: () => void;
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
  releaseNotes?: ReleaseNotesArchive;
  stateStore: ReleaseFeedbackStateStore;
  presenter: ReleaseFeedbackPresenter;
  logWarning?: (message: string, error: unknown) => void;
};

const FIRST_AUTOMATIC_RELEASE_FEEDBACK_VERSION = '0.1.14';

export function createReleaseFeedbackController(
  options: ReleaseFeedbackControllerOptions
): ReleaseFeedbackController {
  const logWarning = options.logWarning ?? ((message, error) => console.warn(message, error));
  let initialized = false;
  let automaticShowPending = false;
  let lastShownReleaseVersion: string | undefined;
  let quitting = false;
  let presentation: Promise<ReleaseFeedbackPresentationResult> | undefined;

  const normalizedCurrentVersion = valid(options.currentVersion) ?? undefined;
  const stableCoreVersion = normalizedCurrentVersion
    ? normalizedCurrentVersion.replace(/-.+$/, '')
    : undefined;
  const automaticVersion =
    normalizedCurrentVersion &&
    prerelease(normalizedCurrentVersion) === null &&
    gte(normalizedCurrentVersion, FIRST_AUTOMATIC_RELEASE_FEEDBACK_VERSION)
      ? normalizedCurrentVersion
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

      lastShownReleaseVersion = state.lastShownReleaseVersion;
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
      const releases = getAutomaticReleases(
        options.releaseNotes,
        lastShownReleaseVersion,
        automaticVersion
      );
      if (releases.length === 0) {
        await saveVersion(options.stateStore, automaticVersion, logWarning);
        return;
      }

      const result = await present({
        initiatedBy: 'automatic',
        version: options.currentVersion,
        releases
      });
      if (result.source === 'automatic' && result.shown) {
        await saveVersion(options.stateStore, automaticVersion, logWarning);
      }
    },

    async showCurrentRelease(): Promise<void> {
      if (quitting) {
        return;
      }

      const releases = stableCoreVersion
        ? (options.releaseNotes?.releases.filter(
            (release) => release.version === stableCoreVersion
          ) ?? [])
        : [];
      await present({
        initiatedBy: 'manual',
        version: options.currentVersion,
        releases
      });
    },

    beginQuit(): void {
      if (quitting) {
        return;
      }

      quitting = true;
      options.presenter.dispose();
    }
  };

  function present(
    snapshot: ReleaseFeedbackSnapshot
  ): Promise<ReleaseFeedbackPresentationResult> {
    if (presentation) {
      return presentation;
    }

    const promise = options.presenter.show(snapshot).finally(() => {
      if (presentation === promise) {
        presentation = undefined;
      }
    });
    presentation = promise;
    return promise;
  }
}

function getAutomaticReleases(
  archive: ReleaseNotesArchive | undefined,
  lastShownReleaseVersion: string | undefined,
  currentVersion: string
): ReleaseNotes[] {
  return (
    archive?.releases.filter(
      (release) =>
        lte(release.version, currentVersion) &&
        (!lastShownReleaseVersion || gt(release.version, lastShownReleaseVersion))
    ) ?? []
  );
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
