import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DocumentationArticle } from '../../../components/patterns/DocumentationArticle';
import { loadDocument } from '../../../server/documentation/documents';
import { DOCUMENTS } from '../../../utils/documentation';

interface DocumentationRouteProps {
  readonly params: Promise<{ slug?: string[] }>;
}

export const dynamicParams = false;

export function generateStaticParams(): { slug: string[] }[] {
  return Object.keys(DOCUMENTS).map((slug) => ({ slug: slug === 'index' ? [] : [slug] }));
}

async function documentKey(
  params: DocumentationRouteProps['params']
): Promise<keyof typeof DOCUMENTS> {
  const { slug = [] } = await params;
  const key = slug.length === 0 ? 'index' : slug.join('/');
  if (!Object.hasOwn(DOCUMENTS, key)) notFound();
  return key as keyof typeof DOCUMENTS;
}

export async function generateMetadata({ params }: DocumentationRouteProps): Promise<Metadata> {
  const key = await documentKey(params);
  return { title: `${DOCUMENTS[key].title} | Krypton Security` };
}

export default async function DocumentationPage({
  params,
}: DocumentationRouteProps): Promise<React.JSX.Element> {
  const key = await documentKey(params);
  const markdown = await loadDocument(key);
  const basePath =
    process.env.NEXT_PUBLIC_KRYPTON_STATIC_EXPORT === 'true' ? '/krypton-security' : '';
  return (
    <main className="mx-auto max-w-5xl space-y-krypton-space-6 p-krypton-space-5 sm:p-krypton-space-6">
      <nav
        aria-label="Documentation navigation"
        className="flex flex-wrap gap-krypton-space-4 text-krypton-accent-cyan"
      >
        <Link href="/">Dashboard</Link>
        <Link href="/docs/" aria-current={key === 'index' ? 'page' : undefined}>
          Documentation
        </Link>
        <Link
          href="/docs/testing-guide/"
          aria-current={key === 'testing-guide' ? 'page' : undefined}
        >
          Testing guide
        </Link>
        <Link
          href="/docs/release-v1.0.3-validation-report/"
          aria-current={key === 'release-v1.0.3-validation-report' ? 'page' : undefined}
        >
          Validation report
        </Link>
      </nav>
      <DocumentationArticle markdown={markdown} basePath={basePath} />
    </main>
  );
}
