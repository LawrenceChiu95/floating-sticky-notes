import type { UpdateProgressSnapshot } from '../../shared/update-progress';

export type UpdateProgressElements = {
  status: { textContent: string | null };
  percentage: { textContent: string | null };
  progress: {
    value: number;
    removeAttribute: (name: string) => void;
  };
};

export function isUpdateProgressSnapshot(value: unknown): value is UpdateProgressSnapshot {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const snapshot = value as Partial<UpdateProgressSnapshot>;
  if (snapshot.state !== 'preparing' && snapshot.state !== 'downloading') {
    return false;
  }
  if (snapshot.version !== undefined && typeof snapshot.version !== 'string') {
    return false;
  }
  if (
    snapshot.percent !== undefined &&
    (typeof snapshot.percent !== 'number' ||
      !Number.isFinite(snapshot.percent) ||
      snapshot.percent < 0 ||
      snapshot.percent > 100)
  ) {
    return false;
  }

  return true;
}

export function renderUpdateProgress(
  snapshot: UpdateProgressSnapshot,
  elements: UpdateProgressElements
): void {
  const versionLabel = snapshot.version ? `版本 ${snapshot.version}` : '更新';
  const hasPercent = snapshot.state === 'downloading' && snapshot.percent !== undefined;

  elements.status.textContent =
    snapshot.state === 'preparing'
      ? `正在准备下载${snapshot.version ? versionLabel : ''}…`
      : `正在下载${versionLabel}`;

  if (hasPercent) {
    elements.progress.value = snapshot.percent ?? 0;
    elements.percentage.textContent = `${snapshot.percent}%`;
    reportRendered(elements);
    return;
  }

  elements.progress.removeAttribute('value');
  elements.percentage.textContent =
    snapshot.state === 'preparing' ? '正在连接更新服务' : '正在下载更新';
  reportRendered(elements);
}

function reportRendered(elements: UpdateProgressElements): void {
  const detail = {
    status: elements.status.textContent,
    percentage: elements.percentage.textContent,
    progressValue: elements.progress.value
  };
  if (typeof document === 'undefined') {
    return;
  }

  console.info('[update-progress-debug] renderer.rendered', detail);
}

function bindUpdateProgress(): void {
  const status = document.getElementById('update-status');
  const percentage = document.getElementById('update-percentage');
  const progress = document.getElementById('update-progress-bar');
  if (!status || !percentage || !(progress instanceof HTMLProgressElement)) {
    return;
  }

  const unsubscribe = window.updateProgress.onSnapshot((snapshot) => {
    if (isUpdateProgressSnapshot(snapshot)) {
      renderUpdateProgress(snapshot, { status, percentage, progress });
    }
  });
  window.addEventListener('beforeunload', unsubscribe, { once: true });
}

if (typeof document !== 'undefined') {
  bindUpdateProgress();
}
