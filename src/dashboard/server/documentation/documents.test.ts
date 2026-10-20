import { describe, expect, it, vi, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
afterEach(() => vi.restoreAllMocks());
import { loadDocument } from './documents';
import { resolveDocumentationLink } from '../../utils/documentation';

describe('documentation sources', () => {
  it('fails explicitly when a published source cannot be read', async () => {
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('private filesystem detail'));
    await expect(loadDocument('testing-guide')).rejects.toThrow('Documentation source unavailable');
  });

  it('loads the guide from the repository Markdown source', async () => {
    expect(await loadDocument('testing-guide')).toContain('../escaped_test.txt');
  });

  it('rejects unknown and traversal slugs before reading files', async () => {
    await expect(loadDocument('../README')).rejects.toThrow('Unknown documentation page');
  });

  it('maps published documents and repository references without broken Markdown links', () => {
    expect(
      resolveDocumentationLink('RELEASE_v1.0.3_VALIDATION_REPORT.md', '/krypton-security')
    ).toBe('/krypton-security/docs/release-v1.0.3-validation-report/');
    expect(resolveDocumentationLink('testing-guide.md', '')).toBe('/docs/testing-guide/');
    expect(resolveDocumentationLink('../README.md#troubleshooting', '')).toBe(
      'https://github.com/mwarnsley/krypton-security/blob/main/README.md#troubleshooting'
    );
    expect(resolveDocumentationLink('javascript:alert(1)', '')).toBe('');
  });
});
