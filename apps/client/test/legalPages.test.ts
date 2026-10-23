import { describe, expect, it } from 'vitest';
import { LEGAL_PAGES, fillFacts, legalPageHtml, readLegal } from '../build/legalPages.ts';
import { inline, renderMarkdown } from '../build/markdown.ts';

describe('legal pages', () => {
  it('renders the markdown subset and escapes any HTML in the source', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and *soft* with `code` and [a link](https://qwakk.fun).\n\n<!-- hidden -->\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| x | y |\n\n<script>alert(1)</script>');
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>soft</em>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<a href="https://qwakk.fun">a link</a>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<td>x</td><td>y</td>');
    expect(html).not.toContain('hidden');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps unsafe links as text and marks placeholders', () => {
    expect(inline('[x](javascript:alert(1))')).not.toContain('href');
    expect(inline('[[OPERATOR_NAME]]')).toBe('<span class="ph">[[OPERATOR_NAME]]</span>');
  });

  it('fills the facts the code owns and builds every page with no script', () => {
    expect(fillFacts('v[[LEGAL_VERSION]] [[SESSION_LIFETIME]] [[ACCOUNT_SESSION_KEY]]')).toBe('v2026-10-23 30 days, renewed while you play `qwakk.account`');
    for (const page of LEGAL_PAGES) {
      const html = legalPageHtml(page, readLegal(page), '/');
      expect(html.startsWith('<!doctype html>')).toBe(true);
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toContain('—');
      expect(html).not.toContain('[[LEGAL_VERSION]]');
      expect(html).toContain('href="/terms"');
    }
  });
});
