import {
  isReleaseFeedbackSnapshot,
  type ReleaseFeedbackSnapshot
} from '../../shared/release-feedback-window';

export { isReleaseFeedbackSnapshot };

export type ReleaseFeedbackView = {
  eyebrow: string;
  versionLabel: string;
  summary: string;
  metadata: string;
  status: string;
  releases: ReleaseFeedbackSnapshot['releases'];
  singleRelease: boolean;
  emptyMessage: string | undefined;
};

export function createReleaseFeedbackView(
  snapshot: ReleaseFeedbackSnapshot
): ReleaseFeedbackView {
  const automatic = snapshot.initiatedBy === 'automatic';
  const itemCount = snapshot.releases.reduce(
    (releaseTotal, release) =>
      releaseTotal +
      release.sections.reduce(
        (sectionTotal, section) => sectionTotal + section.items.length,
        0
      ),
    0
  );
  const singleRelease = snapshot.releases.length === 1;

  return {
    eyebrow: automatic ? '版本更新' : '当前版本',
    versionLabel: `v${snapshot.version}`,
    summary: automatic
      ? '悬浮便签已更新，以下是本次变化。'
      : '以下是当前版本的新增与修复。',
    metadata: singleRelease
      ? `${formatReleaseDate(snapshot.releases[0].date)} · ${itemCount} 项`
      : snapshot.releases.length > 1
        ? `${snapshot.releases.length} 个版本 · ${itemCount} 项`
        : '0 项',
    status: automatic ? '已更新完成' : '当前已安装',
    releases: snapshot.releases,
    singleRelease,
    emptyMessage: snapshot.releases.length === 0 ? '本版本暂无更新说明' : undefined
  };
}

function formatReleaseDate(date: string): string {
  return date.replaceAll('-', '.');
}

type ReleaseFeedbackElements = {
  main: HTMLElement;
  eyebrow: HTMLElement;
  metadata: HTMLElement;
  version: HTMLElement;
  summary: HTMLElement;
  releases: HTMLElement;
  status: HTMLElement;
};

function renderReleaseFeedback(
  snapshot: ReleaseFeedbackSnapshot,
  elements: ReleaseFeedbackElements
): void {
  const view = createReleaseFeedbackView(snapshot);
  elements.eyebrow.textContent = view.eyebrow;
  elements.metadata.textContent = view.metadata;
  elements.version.textContent = view.versionLabel;
  elements.summary.textContent = view.summary;
  elements.status.textContent = view.status;
  elements.releases.replaceChildren();

  if (view.emptyMessage) {
    const empty = document.createElement('p');
    empty.className = 'release-feedback__empty';
    empty.textContent = view.emptyMessage;
    elements.releases.append(empty);
  } else {
    for (const release of view.releases) {
      const releaseElement = document.createElement('section');
      releaseElement.className = 'release-feedback__release';
      if (view.singleRelease) {
        releaseElement.classList.add('release-feedback__release--single');
      }

      const releaseHeader = document.createElement('header');
      releaseHeader.className = 'release-feedback__release-header';
      const versionHeading = document.createElement('h2');
      versionHeading.textContent = `v${release.version}`;
      const releaseDate = document.createElement('time');
      releaseDate.dateTime = release.date;
      releaseDate.textContent = formatReleaseDate(release.date);
      releaseHeader.append(versionHeading, releaseDate);
      releaseElement.append(releaseHeader);

      for (const section of release.sections) {
        const sectionElement = document.createElement('section');
        sectionElement.className = 'release-feedback__section';
        const sectionHeading = document.createElement('h3');
        sectionHeading.textContent = section.title;
        const list = document.createElement('ul');
        for (const item of section.items) {
          const listItem = document.createElement('li');
          listItem.textContent = item;
          list.append(listItem);
        }
        sectionElement.append(sectionHeading, list);
        releaseElement.append(sectionElement);
      }

      elements.releases.append(releaseElement);
    }
  }

  void reportWhenMeasured(elements.main);
}

async function reportWhenMeasured(main: HTMLElement): Promise<void> {
  await document.fonts.ready.catch(() => undefined);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const contentHeight = document.documentElement.scrollHeight;
  main.classList.add('release-feedback--bounded');
  window.releaseFeedback.reportRendered({ contentHeight });
  main.focus();
}

function bindReleaseFeedback(): void {
  const main = document.getElementById('release-feedback-main');
  const eyebrow = document.getElementById('release-feedback-eyebrow');
  const metadata = document.getElementById('release-feedback-metadata');
  const version = document.getElementById('release-feedback-version');
  const summary = document.getElementById('release-feedback-summary');
  const releases = document.getElementById('release-feedback-releases');
  const status = document.getElementById('release-feedback-status-label');
  const dismiss = document.getElementById('release-feedback-dismiss');
  if (
    !main ||
    !eyebrow ||
    !metadata ||
    !version ||
    !summary ||
    !releases ||
    !status ||
    !(dismiss instanceof HTMLButtonElement)
  ) {
    return;
  }

  const unsubscribe = window.releaseFeedback.onSnapshot((value) => {
    if (isReleaseFeedbackSnapshot(value)) {
      renderReleaseFeedback(value, {
        main,
        eyebrow,
        metadata,
        version,
        summary,
        releases,
        status
      });
    }
  });
  dismiss.addEventListener('click', () => window.releaseFeedback.dismiss());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.releaseFeedback.dismiss();
    }
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
}

if (typeof document !== 'undefined') {
  bindReleaseFeedback();
}
