import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { dirname } from 'node:path';
import type { WebRequest } from 'electron';

const DEFAULT_MAX_LOG_BYTES = 1024 * 1024;
const DEFAULT_BACKUP_COUNT = 2;
const MAX_LOG_VALUE_LENGTH = 4_000;
const UPDATE_REQUEST_FILTER = {
  urls: [
    'https://github.com/*',
    'https://api.github.com/*',
    'https://*.githubusercontent.com/*'
  ]
};

type DiagnosticValue =
  | null
  | boolean
  | number
  | string
  | DiagnosticValue[]
  | { [key: string]: DiagnosticValue };

export type DiagnosticDetails = Record<string, unknown>;

export type DiagnosticRecorder = {
  record: (event: string, details?: DiagnosticDetails) => void;
};

export type DiagnosticLogger = DiagnosticRecorder & {
  filePath: string;
  debug: (message?: unknown) => void;
  info: (message?: unknown) => void;
  warn: (message?: unknown) => void;
  error: (message?: unknown) => void;
};

type DiagnosticLoggerOptions = {
  filePath: string;
  maxBytes?: number;
  backupCount?: number;
  homeDirectory?: string;
  now?: () => Date;
};

export function createDiagnosticLogger(
  options: DiagnosticLoggerOptions
): DiagnosticLogger {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_LOG_BYTES;
  const backupCount = options.backupCount ?? DEFAULT_BACKUP_COUNT;
  const now = options.now ?? (() => new Date());
  let isWritable = true;

  try {
    mkdirSync(dirname(options.filePath), { recursive: true });
  } catch {
    isWritable = false;
  }

  const write = (level: string, event: string, details?: DiagnosticDetails): void => {
    if (!isWritable) {
      return;
    }

    try {
      const line = `${JSON.stringify({
        timestamp: now().toISOString(),
        level,
        event,
        ...(details ? { details: sanitizeValue(details, options.homeDirectory) } : {})
      })}\n`;
      rotateLogsIfNeeded(options.filePath, Buffer.byteLength(line), maxBytes, backupCount);
      appendFileSync(options.filePath, line, 'utf8');
    } catch {
      // Diagnostics must never affect startup, note editing, or update behavior.
      isWritable = false;
    }
  };

  const writeUpdaterMessage = (level: string, message?: unknown): void => {
    write(level, 'electron_updater', { message });
  };

  return {
    filePath: options.filePath,
    record: (event, details) => write('info', event, details),
    debug: (message) => writeUpdaterMessage('debug', message),
    info: (message) => writeUpdaterMessage('info', message),
    warn: (message) => writeUpdaterMessage('warn', message),
    error: (message) => writeUpdaterMessage('error', message)
  };
}

export function createSafeDiagnosticRecorder(
  recorder?: DiagnosticRecorder
): DiagnosticRecorder {
  return {
    record(event, details): void {
      try {
        recorder?.record(event, details);
      } catch {
        // Diagnostics must never change application behavior.
      }
    }
  };
}

function stripUrlQueryAndFragment(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export function sanitizeUpdateDiagnosticUrl(value: string, homeDirectory?: string): string {
  try {
    return stripUrlQueryAndFragment(value);
  } catch {
    return sanitizeText(value, homeDirectory);
  }
}

export function attachUpdaterRequestDiagnostics(
  webRequest: WebRequest,
  recorder: DiagnosticRecorder,
  now: () => number = () => Date.now(),
  homeDirectory?: string
): () => void {
  const requestStartedAt = new Map<number, number>();

  try {
    webRequest.onSendHeaders(UPDATE_REQUEST_FILTER, (details) => {
      requestStartedAt.set(details.id, now());
      recorder.record('updater_request_started', {
        requestId: details.id,
        method: details.method,
        url: sanitizeUpdateDiagnosticUrl(details.url, homeDirectory)
      });
    });
    webRequest.onBeforeRedirect(UPDATE_REQUEST_FILTER, (details) => {
      recorder.record('updater_request_redirected', {
        requestId: details.id,
        statusCode: details.statusCode,
        from: sanitizeUpdateDiagnosticUrl(details.url, homeDirectory),
        to: sanitizeUpdateDiagnosticUrl(details.redirectURL, homeDirectory)
      });
    });
    webRequest.onCompleted(UPDATE_REQUEST_FILTER, (details) => {
      recorder.record('updater_request_completed', {
        requestId: details.id,
        method: details.method,
        url: sanitizeUpdateDiagnosticUrl(details.url, homeDirectory),
        statusCode: details.statusCode,
        fromCache: details.fromCache,
        durationMs: getRequestDuration(requestStartedAt, details.id, now())
      });
    });
    webRequest.onErrorOccurred(UPDATE_REQUEST_FILTER, (details) => {
      recorder.record('updater_request_failed', {
        requestId: details.id,
        method: details.method,
        url: sanitizeUpdateDiagnosticUrl(details.url, homeDirectory),
        error: details.error,
        durationMs: getRequestDuration(requestStartedAt, details.id, now())
      });
    });
  } catch (error) {
    recorder.record('updater_request_observer_failed', { error });
  }

  return () => {
    requestStartedAt.clear();
    try {
      webRequest.onSendHeaders(null);
      webRequest.onBeforeRedirect(null);
      webRequest.onCompleted(null);
      webRequest.onErrorOccurred(null);
    } catch (error) {
      recorder.record('updater_request_observer_dispose_failed', { error });
    }
  };
}

function getRequestDuration(
  requestStartedAt: Map<number, number>,
  requestId: number,
  completedAt: number
): number | undefined {
  const startedAt = requestStartedAt.get(requestId);
  requestStartedAt.delete(requestId);
  return startedAt === undefined ? undefined : Math.max(0, completedAt - startedAt);
}

function rotateLogsIfNeeded(
  filePath: string,
  incomingBytes: number,
  maxBytes: number,
  backupCount: number
): void {
  if (!existsSync(filePath) || statSync(filePath).size + incomingBytes <= maxBytes) {
    return;
  }

  if (backupCount <= 0) {
    rmSync(filePath, { force: true });
    return;
  }

  rmSync(`${filePath}.${backupCount}`, { force: true });
  for (let index = backupCount - 1; index >= 1; index -= 1) {
    const source = `${filePath}.${index}`;
    if (existsSync(source)) {
      renameSync(source, `${filePath}.${index + 1}`);
    }
  }
  renameSync(filePath, `${filePath}.1`);
}

function sanitizeValue(
  value: unknown,
  homeDirectory?: string
): DiagnosticValue {
  return sanitizeValueInternal(value, new WeakSet<object>(), homeDirectory);
}

function sanitizeValueInternal(
  value: unknown,
  ancestors: WeakSet<object>,
  homeDirectory?: string
): DiagnosticValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return sanitizeText(value, homeDirectory);
  }
  if (value instanceof Error) {
    const error = value as Error & { code?: unknown; statusCode?: unknown };
    return {
      name: sanitizeText(error.name, homeDirectory),
      message: sanitizeText(error.message, homeDirectory),
      ...(error.code === undefined
        ? {}
        : { code: sanitizeValueInternal(error.code, ancestors, homeDirectory) }),
      ...(error.statusCode === undefined
        ? {}
        : { statusCode: sanitizeValueInternal(error.statusCode, ancestors, homeDirectory) })
    };
  }
  if (typeof value === 'object') {
    if (ancestors.has(value)) {
      return '<circular>';
    }
    ancestors.add(value);
    try {
      if (Array.isArray(value)) {
        return value.map((item) => sanitizeValueInternal(item, ancestors, homeDirectory));
      }
      const result: Record<string, DiagnosticValue> = {};
      for (const [key, item] of Object.entries(value)) {
        if (/authorization|cookie|token|password|secret/i.test(key)) {
          result[key] = '<redacted>';
        } else {
          result[key] = sanitizeValueInternal(item, ancestors, homeDirectory);
        }
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  return sanitizeText(String(value), homeDirectory);
}

function sanitizeText(value: string, homeDirectory?: string): string {
  const withoutHomeDirectory = homeDirectory
    ? value.replaceAll(homeDirectory, '<local-path>')
    : value;

  return withoutHomeDirectory
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
      try {
        return stripUrlQueryAndFragment(url);
      } catch {
        return url;
      }
    })
    .replace(/([?&](?:access_?token|auth|authorization|token)=)[^&#\s]+/gi, '$1<redacted>')
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 <redacted>')
    .replace(/((?:staging\s+)?user\s+id\s*[:=]\s*)[0-9a-f-]{16,}/gi, '$1<redacted>')
    .replace(/(Generated new staging user ID:\s*)[0-9a-f-]{16,}/gi, '$1<redacted>')
    .replace(/file:\/\/\/[A-Za-z]:\/[^\s"']+/gi, '<local-path>')
    .replace(/(?<![A-Za-z])[A-Za-z]:[\\/](?:[^\s"']+[\\/])*[^\s"']*/g, '<local-path>')
    .slice(0, MAX_LOG_VALUE_LENGTH);
}
