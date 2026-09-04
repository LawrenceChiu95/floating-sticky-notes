export type UpdateFailurePhase = 'check' | 'download' | 'install';
export type UpdateNetworkFailureKind = 'proxy' | 'timeout' | 'generic';
export type UpdateCheckRetryAction = 'none' | 'retry' | 'retry-direct';
export type UpdateProxyMode = 'system' | 'direct';

export type UpdateNetwork = {
  setProxyMode: (mode: UpdateProxyMode) => Promise<void>;
};

const PROXY_PATTERN =
  /PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_TUNNEL|\bproxy\b|\btunnel\b/i;
const TIMEOUT_PATTERN =
  /CONNECTION_TIMED_OUT|CONNECTION_RESET|TIMED_OUT|ETIMEDOUT|ECONNRESET|ERR_CONNECTION_TIMED_OUT|ERR_CONNECTION_RESET|ERR_CONNECTION_ABORTED/i;

export function classifyUpdateNetworkError(error: unknown): UpdateNetworkFailureKind {
  const text = collectErrorText(error);
  if (PROXY_PATTERN.test(text)) {
    return 'proxy';
  }
  if (TIMEOUT_PATTERN.test(text)) {
    return 'timeout';
  }
  return 'generic';
}

export function planUpdateCheckRetry(
  error: unknown,
  attempt: number
): UpdateCheckRetryAction {
  if (attempt > 0) {
    return 'none';
  }

  const kind = classifyUpdateNetworkError(error);
  if (kind === 'proxy') {
    return 'retry-direct';
  }
  if (kind === 'timeout') {
    return 'retry';
  }
  return 'none';
}

export function describeUpdateFailure(
  phase: UpdateFailurePhase,
  error: unknown,
  options: { includeDownloadDirectory?: boolean } = {}
): { title: string; content: string } {
  if (phase === 'install') {
    return {
      title: '安装更新失败',
      content: '便签暂时无法退出安装，请稍后再试。'
    };
  }

  const title = phase === 'download' ? '下载更新失败' : '检查更新失败';
  return {
    title,
    content: describeUpdateNetworkFailure(error, options)
  };
}

function describeUpdateNetworkFailure(
  error: unknown,
  options: { includeDownloadDirectory?: boolean }
): string {
  const kind = classifyUpdateNetworkError(error);
  if (kind === 'proxy') {
    return '当前网络代理或 VPN 连不上更新服务器。请关闭失效的代理/VPN，或换一个网络后再试。';
  }
  if (kind === 'timeout') {
    return '连接更新服务器超时或被中断，请稍后重试。';
  }
  return options.includeDownloadDirectory
    ? '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络和下载目录权限。'
    : '暂时无法完成更新，请稍后重试；如果仍失败，请检查网络。';
}

function collectErrorText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (!error || typeof error !== 'object') {
    return String(error);
  }

  const record = error as {
    message?: unknown;
    code?: unknown;
    name?: unknown;
    error?: unknown;
  };
  return [record.message, record.code, record.name, record.error]
    .filter((value) => value !== undefined && value !== null)
    .map((value) => (typeof value === 'string' ? value : String(value)))
    .join(' ');
}
