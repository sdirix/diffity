import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SANITIZED_HTML_PLUGINS } from '../src/lib/markdown';

function render(markdown: string): string {
  return renderToStaticMarkup(createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: SANITIZED_HTML_PLUGINS }, markdown));
}

describe('sanitized HTML', () => {
  it('keeps the HTML GitHub renders', () => {
    const html = render('<details><summary>2 warnings</summary>\n\n- `a`\n\n</details>\n\n<img src="https://example.com/x.png" width="32" alt="x">');
    expect(html).toContain('<details><summary>2 warnings</summary>');
    expect(html).toContain('<code>a</code>');
    expect(html).toContain('<img src="https://example.com/x.png" width="32" alt="x"/>');
  });

  it('strips scripts, handlers and script links', () => {
    const html = render('<script>alert(1)</script><p onclick="alert(2)">hi</p>\n\n[x](javascript:alert(3)) <a href="javascript:alert(4)">y</a>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('<p>hi</p>');
  });
});
