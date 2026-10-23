import { parse, HTMLElement, NodeType, type Node } from 'node-html-parser';

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'center', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p',
  'pre', 'section', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'ul', 'caption',
]);
const CELL = new Set(['td', 'th']);
const SKIP = new Set(['script', 'style', 'head', 'title', 'meta', 'link', 'noscript', 'template']);

export function parseHtml(html: string): HTMLElement {
  return parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
}

/** Renders HTML to text lines, keeping table rows on one line (cells separated by " | "). */
export function htmlToLines(root: HTMLElement): string[] {
  const lines: string[] = [];
  let cur = '';
  const flush = () => {
    const t = cur.replace(/[ \t ]+/g, ' ').replace(/(\s*\|\s*)+/g, ' | ').replace(/^\s*\|\s*|\s*\|\s*$/g, '').trim();
    if (t) lines.push(t);
    cur = '';
  };
  const walk = (n: Node) => {
    if (n.nodeType === NodeType.TEXT_NODE) {
      cur += (n as unknown as { text: string }).text.replace(/\s+/g, ' ');
      return;
    }
    if (n.nodeType !== NodeType.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    const tag = (el.rawTagName || '').toLowerCase();
    if (SKIP.has(tag)) return;
    if (el.getAttribute('style')?.replace(/\s/g, '').includes('display:none')) return;
    if (tag === 'img') {
      const alt = el.getAttribute('alt');
      if (alt && alt.length > 3) cur += ` ${alt} `;
      return;
    }
    const isBlock = BLOCK.has(tag);
    if (isBlock) flush();
    if (CELL.has(tag)) cur += ' | ';
    for (const c of el.childNodes) walk(c);
    if (CELL.has(tag)) cur += ' | ';
    if (isBlock) flush();
  };
  walk(root);
  flush();
  return lines;
}

export function textToLines(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/^>+\s?/, '').replace(/[ \t ]+/g, ' ').trim())
    .filter(Boolean);
}

export interface Link {
  href: string;
  text: string;
}

export function links(root: HTMLElement): Link[] {
  return root.querySelectorAll('a').map((a) => ({ href: a.getAttribute('href') ?? '', text: a.text.replace(/\s+/g, ' ').trim() }));
}

export function textOf(el: HTMLElement): string {
  return el.text.replace(/[\s ]+/g, ' ').trim();
}

/** Plain-text URLs in a text body. */
export function urlsInText(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"')\]]+/g)].map((m) => m[0]);
}

export { HTMLElement, NodeType };
