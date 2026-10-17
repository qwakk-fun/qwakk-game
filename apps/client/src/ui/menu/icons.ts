/**
 * The menu's line icons: 24 px grid, round 2 px strokes in currentColor,
 * built with DOM calls (no innerHTML). Decorative: hidden from screen readers.
 */
type Shape = ['path', string] | ['circle', number, number, number] | ['rect', number, number, number, number, number];

const ICONS = {
  play: [['path', 'M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.2-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z']],
  trophy: [['path', 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5.5h2.5v1.5a3 3 0 0 1-3 3M7 5.5H4.5v1.5a3 3 0 0 0 3 3']],
  sliders: [
    ['path', 'M4 7h9M17 7h3M4 17h3M11 17h9'],
    ['circle', 15, 7, 2],
    ['circle', 9, 17, 2],
  ],
  help: [
    ['circle', 12, 12, 9],
    ['path', 'M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.1-2.4 3.6M12 17.2h.01'],
  ],
  users: [
    ['circle', 9, 8, 3.5],
    ['path', 'M3 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6M16 4.6a3.5 3.5 0 0 1 0 6.8M17.6 14.6c2 .7 3.4 2.6 3.4 5.4'],
  ],
  link: [['path', 'M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1']],
  check: [['path', 'M5 12.5l4.5 4.5L19 7.5']],
  arrow: [['path', 'M5 12h14M13 6l6 6-6 6']],
  plus: [['path', 'M12 5v14M5 12h14']],
  phone: [
    ['rect', 2.5, 7, 19, 10, 2.5],
    ['path', 'M18 11v2'],
  ],
  crown: [['path', 'M3.5 8.5l4.2 3.8L12 5.5l4.3 6.8 4.2-3.8-1.8 10H5.3z']],
  target: [
    ['circle', 12, 12, 7.5],
    ['circle', 12, 12, 2.5],
    ['path', 'M12 1.8v4M12 18.2v4M1.8 12h4M18.2 12h4'],
  ],
  bolt: [['path', 'M13.5 2.5L4.5 14h7l-1 7.5 9-11.5h-7z']],
  leave: [['path', 'M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5M10 16.5L5.5 12 10 7.5M5.5 12H16']],
  radio: [
    ['circle', 12, 12, 2],
    ['path', 'M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 19.1a10 10 0 0 1 0-14.2M19.1 4.9a10 10 0 0 1 0 14.2'],
  ],
} satisfies Record<string, Shape[]>;

export type IconName = keyof typeof ICONS;

const NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, cls = ''): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', `qm-icon${cls ? ` ${cls}` : ''}`);
  for (const shape of ICONS[name] as Shape[]) {
    const el = document.createElementNS(NS, shape[0]);
    if (shape[0] === 'path') el.setAttribute('d', shape[1]);
    else if (shape[0] === 'circle') {
      el.setAttribute('cx', String(shape[1]));
      el.setAttribute('cy', String(shape[2]));
      el.setAttribute('r', String(shape[3]));
    } else {
      el.setAttribute('x', String(shape[1]));
      el.setAttribute('y', String(shape[2]));
      el.setAttribute('width', String(shape[3]));
      el.setAttribute('height', String(shape[4]));
      el.setAttribute('rx', String(shape[5]));
    }
    svg.append(el);
  }
  return svg;
}
