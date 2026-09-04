import type { UpdateNetwork, UpdateProxyMode } from '../shared/update-error';

type ProxySession = {
  setProxy: (config: { mode: UpdateProxyMode }) => Promise<void>;
};

export function createUpdateNetwork(targetSession: ProxySession): UpdateNetwork {
  return {
    setProxyMode: (mode) => targetSession.setProxy({ mode })
  };
}
