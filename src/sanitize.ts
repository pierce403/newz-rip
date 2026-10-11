import { parseHTML } from 'linkedom';
import { validateTarget } from './url';

const ALLOWED = new Set(['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section', 'article', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'sup', 'sub', 'blockquote', 'q', 'cite', 'code', 'pre', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'img', 'a', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'time']);
const OMIT = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'svg', 'math', 'canvas', 'template', 'noscript', 'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'audio', 'video', 'source']);
const VOID = new Set(['br', 'hr', 'img']);

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Resolve with the same public DNS-name/standard-port policy as the capture pipeline. */
export function publicUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
  try {
    return validateTarget(new URL(value.trim(), baseUrl).href).href;
  } catch { return null; }
}

function imageSource(element: Element, baseUrl: string): string | null {
  for (const attribute of ['data-src', 'data-lazy-src', 'data-original', 'data-url', 'src']) {
    const url = publicUrl(element.getAttribute(attribute), baseUrl);
    if (url) return url;
  }
  for (const attribute of ['data-srcset', 'srcset']) {
    for (const item of (element.getAttribute(attribute) || '').split(',')) {
      const url = publicUrl(item.trim().split(/\s+/)[0], baseUrl);
      if (url) return url;
    }
  }
  return null;
}

/** A fresh allowlisted serialization; no attributes are copied unless explicitly approved. */
export function sanitizeHtml(html: string, baseUrl: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  let visited = 0;
  function render(node: Node, depth = 0): string {
    if (depth > 100 || ++visited > 100_000) return '';
    if (node.nodeType === 3) return escapeHtml(node.textContent || '');
    if (node.nodeType !== 1) return '';
    const element = node as Element;
    const tag = element.localName.toLowerCase();
    if (OMIT.has(tag)) return '';
    if (!ALLOWED.has(tag)) return Array.from(element.childNodes).map(child => render(child, depth + 1)).join('');
    const attrs: string[] = [];
    if (tag === 'a') {
      const raw = element.getAttribute('href');
      const href = raw?.startsWith('#') && /^#[a-zA-Z0-9_-]+$/.test(raw) ? raw : publicUrl(raw, baseUrl);
      if (href) attrs.push(`href="${escapeHtml(href)}"`, 'rel="noopener noreferrer"');
    }
    if (tag === 'img') {
      const src = imageSource(element, baseUrl);
      if (!src) return '';
      attrs.push(`src="${escapeHtml(src)}"`, 'loading="lazy"', 'decoding="async"', 'referrerpolicy="no-referrer"');
      const alt = element.getAttribute('alt');
      if (alt) attrs.push(`alt="${escapeHtml(alt.slice(0, 1000))}"`);
      for (const dimension of ['width', 'height']) {
        const value = element.getAttribute(dimension);
        if (value && /^\d{1,5}$/.test(value) && Number(value) > 0) attrs.push(`${dimension}="${value}"`);
      }
    }
    const title = element.getAttribute('title');
    if (title) attrs.push(`title="${escapeHtml(title.slice(0, 1000))}"`);
    if (tag === 'th' || tag === 'td') {
      for (const attribute of ['colspan', 'rowspan']) {
        const value = element.getAttribute(attribute);
        if (value && /^[1-9]\d?$/.test(value)) attrs.push(`${attribute}="${value}"`);
      }
    }
    const opening = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
    return VOID.has(tag) ? opening : opening + Array.from(element.childNodes).map(child => render(child, depth + 1)).join('') + `</${tag}>`;
  }
  return Array.from(document.body.childNodes).map(node => render(node)).join('').trim();
}
