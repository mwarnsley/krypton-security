import { defaultUrlTransform } from 'react-markdown';

/** Only these repository documents are published as static site pages. */
export const DOCUMENTS = {
  index: { file: 'index.md', title: 'Documentation' },
  'testing-guide': { file: 'testing-guide.md', title: 'End-user testing guide' },
  'release-v1.0.3-validation-report': {
    file: 'RELEASE_v1.0.3_VALIDATION_REPORT.md',
    title: 'Release v1.0.3 validation report',
  },
} as const;

/** Preserve the renderer's protocol safety while translating repository-relative links. */
export function resolveDocumentationLink(href: string, basePath: string): string {
  const safe = defaultUrlTransform(href);
  if (!safe) return '';
  const [file, fragment] = safe.split('#', 2);
  const suffix = fragment === undefined ? '' : `#${fragment}`;
  for (const [slug, document] of Object.entries(DOCUMENTS)) {
    if (file === document.file) {
      return `${basePath}/docs/${slug === 'index' ? '' : `${slug}/`}${suffix}`;
    }
  }
  if (file?.startsWith('../') && file.endsWith('.md')) {
    return `https://github.com/mwarnsley/krypton-security/blob/main/${file.slice(3)}${suffix}`;
  }
  return safe;
}
