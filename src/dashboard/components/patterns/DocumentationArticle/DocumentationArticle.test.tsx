import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DocumentationArticle } from './DocumentationArticle';

describe('DocumentationArticle', () => {
  it('renders accessible Markdown tables, prompts, code, and site links', () => {
    const html = renderToStaticMarkup(
      <DocumentationArticle
        markdown={
          '# Test guide\n\n> Harmless prompt\n\n```json\n{"action":"denied"}\n```\n\n| Result |\n| --- |\n| PASS |\n\n[Report](RELEASE_v1.0.3_VALIDATION_REPORT.md)'
        }
        basePath="/krypton-security"
      />
    );
    expect(html).toContain('<h1');
    expect(html).toContain('<blockquote');
    expect(html).toContain('<pre');
    expect(html).toContain('<th');
    expect(html).toContain('href="/krypton-security/docs/release-v1.0.3-validation-report/"');
  });

  it('does not render executable HTML or unsafe link protocols', () => {
    const html = renderToStaticMarkup(
      <DocumentationArticle
        markdown={'<script>alert(1)</script>\n\n[unsafe](javascript:alert%281%29)'}
        basePath=""
      />
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript:');
  });
});
