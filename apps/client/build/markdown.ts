/**
 * A small Markdown to HTML renderer for the legal pages (docs/legal/*.md),
 * run at build time only. It covers what those files use: headings,
 * paragraphs, bullet and numbered lists, tables, block quotes, fenced code,
 * bold, italics, inline code and links. Everything is HTML-escaped first, so
 * no raw HTML from the source reaches the page (HTML comments are dropped).
 * `[[PLACEHOLDERS]]` stay visible, marked for review.
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Only links that cannot run script: http(s), mailto and same-site paths or anchors. */
function safeHref(raw: string): string | null {
  const url = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(url) || /^\/(?!\/)/.test(url) || url.startsWith('#')) return url;
  return null;
}

export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Inline markup on one line of source text. */
export function inline(src: string): string {
  const codes: string[] = [];
  // Inline code first, so nothing inside it is touched.
  let s = esc(src).replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[\[([^\]]+)\]\]/g, '<span class="ph">[[$1]]</span>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text: string, href: string) => {
    const h = safeHref(href.replace(/&amp;/g, '&'));
    return h ? `<a href="${esc(h)}">${text}</a>` : m;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s.,;:)!?]|$)/g, '$1<em>$2</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '');
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/** Render a Markdown document. */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').replace(/<!--[\s\S]*?-->/g, '').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = (): void => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (t === '') {
      flush();
      continue;
    }
    if (t.startsWith('```')) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trim().startsWith('```'); i++) body.push(lines[i]!);
      out.push(`<pre><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) {
      flush();
      const level = Math.min(heading[1]!.length, 4);
      const html = inline(heading[2]!);
      out.push(`<h${level} id="${slug(html)}">${html}</h${level}>`);
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && /^\|?\s*:?-{3,}/.test(lines[i + 1]!.trim())) {
      flush();
      const head = cells(t);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i]!.trim().startsWith('|'); i++) rows.push(cells(lines[i]!));
      i--;
      out.push(
        `<div class="table"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${rows
          .map((r) => `<tr>${head.map((_h, k) => `<td>${inline(r[k] ?? '')}</td>`).join('')}</tr>`)
          .join('')}</tbody></table></div>`,
      );
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(t);
    const numbered = /^\d+\.\s+(.*)$/.exec(t);
    if (bullet || numbered) {
      flush();
      const tag = bullet ? 'ul' : 'ol';
      const re = bullet ? /^[-*]\s+(.*)$/ : /^\d+\.\s+(.*)$/;
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const l = lines[i]!;
        const m = re.exec(l.trim());
        if (m) items.push(m[1]!);
        else if (l.trim() !== '' && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += ` ${l.trim()}`;
        else break;
      }
      i--;
      out.push(`<${tag}>${items.map((x) => `<li>${inline(x)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (t.startsWith('>')) {
      flush();
      const quote: string[] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith('>'); i++) quote.push(lines[i]!.trim().replace(/^>\s?/, ''));
      i--;
      out.push(`<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`);
      continue;
    }
    para.push(t);
  }
  flush();
  return out.join('\n');
}
