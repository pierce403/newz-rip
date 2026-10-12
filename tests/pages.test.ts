import { describe, expect, it } from 'vitest';
import { htmlEscape, renderArchive, renderError, renderHome, renderLoading, renderNotFound, renderSnapshot } from '../src/pages';
import type { Snapshot, StoredCapture } from '../src/types';

const snapshot: Snapshot = {
  id: 'edition-123', url: 'https://example.com/story', canonicalUrl: 'https://example.com/story',
  title: 'A story worth keeping', siteName: 'The Example', byline: 'A. Writer', capturedAt: '2026-10-11T05:00:00Z',
  publishedAt: '2026-10-10T12:00:00Z', contentHash: 'hash', wordCount: 640, quality: 'full',
  extractionMethod: 'readability', objectKey: 'snapshots/edition-123.json',
};
const stored: StoredCapture = {
  snapshot, rawHtml: '', attempts: [], article: {
    url: snapshot.url, canonicalUrl: snapshot.canonicalUrl, title: snapshot.title, byline: snapshot.byline,
    siteName: snapshot.siteName, excerpt: 'A calm place for an interesting story.', publishedAt: snapshot.publishedAt,
    language: 'en', content: '<p>Sanitized article <strong>content</strong>.</p>', textContent: 'Sanitized article content.',
    wordCount: 640, readingMinutes: 3, image: null, extractionMethod: 'readability', quality: 'full', warnings: [],
  },
};

describe('reader pages', () => {
  it('escapes text and attribute metacharacters', () => {
    expect(htmlEscape('<script>"&\'</script>')).toBe('&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
    expect(htmlEscape(null)).toBe('');
  });
  it('keeps supplied URL text inert in the loading page', () => {
    const html = renderLoading('https://example.com/" onload="alert(1)"><script>alert(2)</script>');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain(' onload="alert');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('data-capture-status');
  });
  it('uses escaped metadata, safe source URLs, and sanitized article markup', () => {
    const html = renderSnapshot({ ...stored, article: {
      ...stored.article, title: '<img src=x onerror=alert(1)>', canonicalUrl: 'javascript:alert(1)',
      byline: '<script>alert(2)</script>', warnings: ['<script>alert(3)</script>'],
    } }, [snapshot]);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain('<script>alert');
    expect(html).not.toContain('href="javascript:alert');
    expect(html).toContain('<p>Sanitized article <strong>content</strong>.</p>');
    expect(html).toContain('format=html');
    expect(html).toContain('format=md');
    expect(html).toContain('format=txt');
    expect(html).toContain('format=json');
  });
  it('shows an honest warning for partial copies and preserves edition history', () => {
    const html = renderSnapshot({ ...stored, article: { ...stored.article, quality: 'partial', warnings: ['Only the opening paragraphs were available.'] } }, [snapshot, { ...snapshot, id: 'older', capturedAt: '2026-10-10T05:00:00Z' }]);
    expect(html).toContain('Partial copy');
    expect(html).toContain('Only the opening paragraphs were available.');
    expect(html).toContain('2 snapshots');
    expect(html).toContain('/s/older');
    expect(html).toContain('aria-current="page"');
  });
  it('escapes search state and provides pagination', () => {
    const html = renderArchive([{ ...snapshot, title: '<script>bad</script>', siteName: 'News & Notes' }], '"><script>bad</script>', 2, true);
    expect(html).not.toContain('<script>bad');
    expect(html).toContain('News &amp; Notes');
    expect(html).toContain('page=1');
    expect(html).toContain('page=3');
    expect(renderArchive([], '', 1, false)).toContain('No saved pages yet.');
  });
  it('renders errors without creating active supplied markup', () => {
    expect(renderError('<script>bad</script>')).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(renderNotFound()).toContain('Page not found');
  });
  it('uses external assets and includes an accessible capture and HTML import flow', () => {
    const html = renderHome();
    expect(html).toContain('src="/app.js"');
    expect(html).toContain('href="/styles.css"');
    expect(html).toContain('href="/manifest.webmanifest"');
    expect(html).not.toContain('<script>');
    expect(html).toContain('data-import-form');
    expect(html).toContain('action="/read" method="get"');
    expect(html).toContain('action="/archive" method="get"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('name="capture-token"');
    expect(html).toContain('Skip to content');
  });
});
