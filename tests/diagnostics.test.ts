import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  attachUpdaterRequestDiagnostics,
  createDiagnosticLogger,
  sanitizeUpdateDiagnosticUrl
} from '../main/diagnostics';

describe('update diagnostics', () => {
  it('writes bounded JSONL and redacts credentials, IDs, and local paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sticky-update-log-'));
    const filePath = join(directory, 'updater-diagnostic.log');
    const logger = createDiagnosticLogger({
      filePath,
      homeDirectory: '/Users/Alice',
      now: () => new Date('2026-07-27T00:00:00.000Z')
    });

    logger.info(
      'Generated new staging user ID: 123e4567-e89b-12d3-a456-426614174000 ' +
        'Bearer secret-token C:\\Users\\Alice\\AppData\\Local\\file.exe ' +
        'https://example.com/latest.yml?token=secret ' +
        'https://example.com/latest.yml?channel=private-value ' +
        '/Users/Alice/Library/Application Support/floating-sticky-notes'
    );
    const shared = { state: 'same-value' };
    logger.record('failed', {
      authorization: 'secret',
      error: Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }),
      sharedA: shared,
      sharedB: shared
    });

    const lines = readFileSync(filePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const serialized = JSON.stringify(lines);
    expect(serialized).toContain('2026-07-27T00:00:00.000Z');
    expect(serialized).toContain('ETIMEDOUT');
    expect(serialized).toContain('<redacted>');
    expect(serialized).toContain('<local-path>');
    expect(serialized.match(/same-value/g)).toHaveLength(2);
    expect(serialized).not.toContain('123e4567-e89b-12d3-a456-426614174000');
    expect(serialized).not.toContain('secret-token');
    expect(serialized).not.toContain('private-value');
    expect(serialized).not.toContain('Alice');
    expect(serialized).not.toContain('/Users/Alice');
  });

  it('rotates logs without growing beyond finite backups', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sticky-update-rotate-'));
    const filePath = join(directory, 'updater-diagnostic.log');
    const logger = createDiagnosticLogger({ filePath, maxBytes: 220, backupCount: 2 });

    for (let index = 0; index < 12; index += 1) {
      logger.record('event', { index, padding: 'x'.repeat(60) });
    }

    expect(readFileSync(filePath, 'utf8')).toContain('event');
    expect(readFileSync(`${filePath}.1`, 'utf8')).toContain('event');
    expect(() => readFileSync(`${filePath}.2`, 'utf8')).not.toThrow();
    expect(() => readFileSync(`${filePath}.3`, 'utf8')).toThrow();
  });

  it('does not throw when the log target cannot be written', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sticky-update-fail-'));
    const filePath = join(directory, 'target');
    writeFileSync(filePath, 'not-a-directory');
    const logger = createDiagnosticLogger({ filePath: join(filePath, 'updater.log') });

    expect(() => logger.record('cannot-write')).not.toThrow();
    expect(() => logger.record('still-safe')).not.toThrow();
  });

  it('removes query and fragment data from diagnostic URLs', () => {
    expect(
      sanitizeUpdateDiagnosticUrl('https://github.com/owner/repo/releases/latest?token=secret#x')
    ).toBe('https://github.com/owner/repo/releases/latest');
  });

  it('records updater request timing without changing the request', () => {
    const listeners: Record<string, (...args: any[]) => void> = {};
    const webRequest = {
      onSendHeaders: vi.fn((_filter, listener) => {
        if (listener) listeners.started = listener;
      }),
      onBeforeRedirect: vi.fn((_filter, listener) => {
        if (listener) listeners.redirect = listener;
      }),
      onCompleted: vi.fn((_filter, listener) => {
        if (listener) listeners.completed = listener;
      }),
      onErrorOccurred: vi.fn((_filter, listener) => {
        if (listener) listeners.failed = listener;
      })
    };
    const record = vi.fn();
    const times = [100, 160];
    const dispose = attachUpdaterRequestDiagnostics(
      webRequest as never,
      { record },
      () => times.shift() ?? 160,
      '/Users/Alice'
    );
    listeners.started?.({
      id: 7,
      method: 'GET',
      url: 'https://github.com/owner/repo/releases/latest?token=secret'
    });
    listeners.completed?.({
      id: 7,
      method: 'GET',
      url: 'https://github.com/owner/repo/releases/tag/v1',
      statusCode: 200,
      fromCache: false
    });

    expect(record).toHaveBeenCalledWith(
      'updater_request_completed',
      expect.objectContaining({ statusCode: 200, durationMs: 60 })
    );
    expect(JSON.stringify(record.mock.calls)).not.toContain('secret');

    dispose();
    expect(webRequest.onSendHeaders).toHaveBeenLastCalledWith(null);
  });
});
