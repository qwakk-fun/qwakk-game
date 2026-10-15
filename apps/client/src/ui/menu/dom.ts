/** Tiny DOM builder: h('div', { class: 'x' }, child, 'text'). Text is always set as text, never HTML. */
type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') el.addEventListener(k.replace(/^on/, '').toLowerCase(), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, ...children);
  return el;
}

export function append(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'object' ? c : String(c));
  }
}

/** Asset URL under Vite's base (/game/). */
export function asset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
