import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('renderer Content Security Policy', () => {
  it('allows local blob images for drag image decoding without loosening scripts', async () => {
    const html = await readFile(join(process.cwd(), 'renderer/index.html'), 'utf8');
    const csp = html.match(/Content-Security-Policy"\s+content="([^"]+)"/)?.[1] ?? '';

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("img-src 'self' data: blob: sticky-notes-image:");
    expect(csp).not.toContain("script-src 'self' blob:");
    expect(csp).not.toContain("default-src 'self' blob:");
  });
});
