import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { resolveDocumentationLink } from '../../../utils/documentation';
import { KryptonTypography } from '../../primitives';

interface DocumentationArticleProps {
  /** Repository Markdown, read during static generation. */
  readonly markdown: string;
  /** Deployment prefix supplied by the route shell. */
  readonly basePath: string;
}

/** Render repository documentation without interpreting embedded HTML. */
export function DocumentationArticle({
  markdown,
  basePath,
}: DocumentationArticleProps): React.JSX.Element {
  return (
    <article className="space-y-krypton-space-4 break-words text-sm leading-6 text-krypton-fg-secondary">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        urlTransform={(url) => resolveDocumentationLink(url, basePath)}
        components={{
          h1: ({ children }) => <KryptonTypography variant="h1">{children}</KryptonTypography>,
          h2: ({ children }) => <KryptonTypography variant="h2">{children}</KryptonTypography>,
          h3: ({ children }) => (
            <h3 className="text-lg font-bold text-krypton-fg-primary">{children}</h3>
          ),
          a: ({ href, children }) => (
            <a
              className="text-krypton-accent-cyan underline focus-visible:outline focus-visible:outline-krypton-focus-ring"
              href={href}
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-krypton-space-2 pl-krypton-space-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-krypton-space-2 pl-krypton-space-5">{children}</ol>
          ),
          li: ({ children }) => <li className="space-y-krypton-space-2">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l border-krypton-accent-cyan bg-krypton-bg-surface p-krypton-space-4">
              {children}
            </blockquote>
          ),
          pre: ({ children }) => (
            <pre className="overflow-x-auto rounded-krypton-radius-control bg-krypton-bg-surface p-krypton-space-4">
              {children}
            </pre>
          ),
          code: ({ children }) => (
            <code className="font-mono text-krypton-accent-cyan">{children}</code>
          ),
          table: ({ children }) => (
            <div
              className="overflow-x-auto"
              role="region"
              aria-label="Documentation table"
              tabIndex={0}
            >
              <table className="w-full border-collapse text-left">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th
              scope="col"
              className="border border-krypton-border-muted bg-krypton-bg-surface p-krypton-space-3 font-bold"
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-krypton-border-muted p-krypton-space-3 align-top">
              {children}
            </td>
          ),
        }}
      >
        {markdown}
      </Markdown>
    </article>
  );
}
