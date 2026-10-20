import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { DOCUMENTS } from '../../utils/documentation';

/** Unknown slugs never become filesystem paths; missing sources fail the build. */
export async function loadDocument(slug: string): Promise<string> {
  if (!Object.hasOwn(DOCUMENTS, slug)) throw new Error('Unknown documentation page');
  const document = DOCUMENTS[slug as keyof typeof DOCUMENTS];
  try {
    return await readFile(path.join(process.cwd(), 'docs', document.file), 'utf8');
  } catch (error: unknown) {
    throw new Error(
      error instanceof Error
        ? 'Documentation source unavailable'
        : 'Documentation source read failed'
    );
  }
}
