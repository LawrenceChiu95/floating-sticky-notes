import { describe, expect, it, vi } from 'vitest';
import {
  isUpdateProgressSnapshot,
  renderUpdateProgress,
  type UpdateProgressElements
} from '../renderer/src/update-progress';

function createElements() {
  const progress = {
    value: 0,
    removeAttribute: vi.fn()
  };
  const elements = {
    status: { textContent: '' },
    percentage: { textContent: '' },
    progress
  } satisfies UpdateProgressElements;
  return { elements, progress };
}

describe('update progress renderer', () => {
  it('renders indeterminate progress without a numeric value', () => {
    const { elements, progress } = createElements();

    renderUpdateProgress({ state: 'preparing', version: '0.1.11' }, elements);

    expect(elements.status.textContent).toBe('正在准备下载版本 0.1.11…');
    expect(elements.percentage.textContent).toBe('正在连接更新服务');
    expect(progress.removeAttribute).toHaveBeenCalledWith('value');
  });

  it('renders a finite percentage', () => {
    const { elements, progress } = createElements();

    renderUpdateProgress(
      { state: 'downloading', version: '0.1.11', percent: 52 },
      elements
    );

    expect(elements.status.textContent).toBe('正在下载版本 0.1.11');
    expect(elements.percentage.textContent).toBe('52%');
    expect(progress.value).toBe(52);
  });

  it.each([
    undefined,
    null,
    {},
    { state: 'other' },
    { state: 'downloading', percent: Number.NaN },
    { state: 'downloading', percent: Infinity },
    { state: 'downloading', percent: '50' }
  ])('rejects invalid payload %#', (value) => {
    expect(isUpdateProgressSnapshot(value)).toBe(false);
  });
});
