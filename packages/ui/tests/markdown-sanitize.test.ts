import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RAW_HTML_REHYPE_PLUGINS, RAW_HTML_REMARK_REHYPE_OPTIONS } from '../src/lib/markdown-sanitize';

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm],
    rehypePlugins: RAW_HTML_REHYPE_PLUGINS,
    remarkRehypeOptions: RAW_HTML_REMARK_REHYPE_OPTIONS,
  }, markdown));
}

describe('Markdown preview sanitizing', () => {
  it('drops scripts, handlers and active elements', () => {
    const html = render([
      '<script>alert(1)</script>',
      '<img src="x.png" onerror="alert(2)">',
      '<a href="javascript:alert(3)">link</a>',
      '<iframe src="/api/tree/raw/a.html"></iframe>',
      '<svg><script>alert(4)</script></svg>',
      '<div style="position:fixed" onclick="alert(5)">box</div>',
    ].join('\n\n'));
    expect(html).not.toMatch(/<script|<iframe|<svg|onerror|onclick|javascript:|style=/i);
    expect(html).toContain('<img src="x.png"/>');
    expect(html).toContain('box');
  });

  it('keeps what GitHub keeps', () => {
    const html = render([
      '<details><summary>More</summary>\n\nHidden **text**\n\n</details>',
      '<p align="center"><img src="logo.png" width="80" alt="Logo"></p>',
      '| a | b |\n| - | - |\n| 1 | 2 |',
      '```ts\nconst a = 1;\n```',
      '```mermaid\ngraph TD; A-->B\n```',
      '- [x] done',
      '<kbd>Ctrl</kbd>',
    ].join('\n\n'));
    expect(html).toContain('<details><summary>More</summary>');
    expect(html).toContain('<strong>text</strong>');
    expect(html).toContain('<p align="center"><img src="logo.png" width="80" alt="Logo"/></p>');
    expect(html).toContain('<table>');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('<code class="language-mermaid">');
    expect(html).toContain('<input type="checkbox" disabled="" checked=""/>');
    expect(html).toContain('<kbd>Ctrl</kbd>');
  });

  it('prefixes ids and keeps in-page links pointing at them', () => {
    const html = render('Text[^1] and <a name="top"></a> <a href="#top">up</a>\n\n[^1]: Note');
    expect(html).toContain('href="#user-content-fn-1" id="user-content-fnref-1"');
    expect(html).toContain('id="user-content-fn-1"');
    expect(html).toContain('<a name="user-content-top"></a>');
    expect(html).toContain('href="#user-content-top"');
  });
});
