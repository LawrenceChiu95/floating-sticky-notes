import { describe, expect, it, vi } from 'vitest';
import { createUpdateNetwork } from '../main/update-network';

describe('update network', () => {
  it('applies the requested proxy mode on the updater session', async () => {
    const setProxy = vi.fn(async () => undefined);
    const network = createUpdateNetwork({ setProxy });

    await network.setProxyMode('direct');

    expect(setProxy).toHaveBeenCalledWith({ mode: 'direct' });
  });
});
