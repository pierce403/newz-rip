import { describe, expect, it } from 'vitest';
import { extractArticle, detectChallenge } from '../src/extract';
import { publicUrl, sanitizeHtml } from '../src/sanitize';
import { publisherForUrl } from '../src/publishers';

const paragraph = 'Researchers announced an important discovery after a long study of coastal wildlife. The team collected observations from many independent sources, then reviewed the evidence carefully before publishing its findings.';
const second = 'The results show how habitats change across the seasons, with an unusually clear signal in the new measurements. Community volunteers helped the scientists repeat their work and check that the conclusions were reliable.';
const third = 'The research group plans to share the underlying data and conduct additional fieldwork next year. Their report notes the limitations of this initial sample, and explains which questions require further investigation.';
const body = `<p>${paragraph}</p><p>${second}</p><p>${third}</p>`;
const page = (content: string, head = '<title>A coastal discovery</title>') => `<!doctype html><html lang="en"><head>${head}</head><body>${content}</body></html>`;

describe('strict content serialization', () => {
  it('removes active content and every unapproved attribute', () => {
    const html = `<p onclick="alert(1)" style="position:fixed" id="bad">Hello<script>alert(1)</script><svg><script>alert(2)</script></svg><iframe src="https://evil.example"></iframe><form><input value="secret"></form><a href="javascript:alert(1)" onmouseover="alert(1)">link</a><img src="data:image/svg+xml,bad" onerror="alert(1)"></p>`;
    const result = sanitizeHtml(html, 'https://news.example/story');
    expect(result).toContain('<p>Hello</p>');
    expect(result).toContain('<a>link</a>');
    expect(result).not.toMatch(/script|onclick|style=|iframe|svg|javascript|onerror|input/);
  });
  it('resolves lazy images, relative links and srcsets safely', () => {
    const result = sanitizeHtml('<a href="../other?q=a&b=c">Other</a><img src="data:image/gif;base64,empty" data-src="/photo.jpg" alt="&quot; &lt; >"><img srcset="/small.jpg 400w, /large.jpg 900w">', 'https://news.example/path/story');
    expect(result).toContain('href="https://news.example/other?q=a&amp;b=c"');
    expect(result).toContain('src="https://news.example/photo.jpg"');
    expect(result).toContain('src="https://news.example/small.jpg"');
    expect(result).toContain('alt="&quot; &lt; &gt;"');
    expect(result).toContain('referrerpolicy="no-referrer"');
    expect(result).not.toContain('srcset=');
  });
  it('blocks local literals, active URL schemes and credentials', () => {
    for (const value of ['http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'http://10.2.3.4/', 'http://[::1]/', 'http://[::ffff:7f00:1]/', 'http://[fe80::1]/', 'http://localhost/', 'http://router.local/', 'https://user:pass@news.example/', 'javascript:alert(1)', 'https:\n//news.example/']) {
      expect(publicUrl(value, 'https://news.example/story'), value).toBeNull();
    }
    expect(publicUrl('https://news.example/article', 'https://news.example/')).toBe('https://news.example/article');
  });
  it('does not allow malicious publisher base tags to rewrite image addresses', () => {
    const article = extractArticle(page(`<base href="https://attacker.example/"><article>${body}<img src="/picture.jpg"></article>`), 'https://news.example/story');
    expect(article?.content).toContain('src="https://news.example/picture.jpg"');
    expect(article?.content).not.toContain('attacker.example');
  });
});

describe('article extraction', () => {
  it('extracts article metadata and cleans navigation, overlays and repeated paragraphs', () => {
    const article = extractArticle(page(`<nav><a href="/">Navigation</a></nav><section name="articleBody">${body}<p>${paragraph}</p><div class="paywall-overlay">Subscribe for unlimited access</div><p>Advertisement</p><img data-src="/photo.jpg"></section>`, '<title>Fallback title</title><meta property="og:title" content="A much better title"><meta name="author" content="Ada Lovelace"><meta property="og:site_name" content="Newsroom"><meta property="article:published_time" content="2026-10-09T10:00:00Z"><link rel="canonical" href="/canonical">'), 'https://www.nytimes.com/story');
    expect(article).not.toBeNull();
    expect(article?.title).toBe('A much better title');
    expect(article?.byline).toBe('Ada Lovelace');
    expect(article?.canonicalUrl).toBe('https://www.nytimes.com/canonical');
    expect(article?.publishedAt).toBe('2026-10-09T10:00:00.000Z');
    expect(article?.content).not.toMatch(/Navigation|Advertisement|paywall-overlay/);
    expect(article?.textContent.match(/Researchers announced/g)).toHaveLength(1);
    expect(article?.image).toBe('https://www.nytimes.com/photo.jpg');
  });
  it('recovers articleBody from JSON-LD and reports declared truncation', () => {
    const node = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: 'Structured story', articleBody: paragraph + '\n\n' + second, author: [{ name: 'Reporter One' }, { name: 'Reporter Two' }], datePublished: '2026-10-08', image: { url: '/hero.jpg' }, wordCount: 1000 };
    const article = extractArticle(page(`<script type="application/ld+json">${JSON.stringify(node)}</script><main><p>Subscribe to read more.</p></main>`), 'https://www.ft.com/content/test');
    expect(article?.extractionMethod).toBe('json-ld');
    expect(article?.title).toBe('Structured story');
    expect(article?.byline).toBe('Reporter One, Reporter Two');
    expect(article?.quality).toBe('partial');
    expect(article?.warnings.join(' ')).toContain('only part');
    expect(article?.content).toContain('<p>Researchers');
  });
  it('finds nested JSON-LD article records and never interprets body text as markup', () => {
    const node = { '@graph': [{ '@type': 'WebSite', name: 'Not article' }, { '@type': ['Article', 'NewsArticle'], headline: 'Graph story', articleBody: `${paragraph}\n\nLiteral <script>alert(1)</script> & text. ${second}` }] };
    const article = extractArticle(page(`<script type="application/ld+json">${JSON.stringify(node).replace(/<\//g, '<\\/')}</script>`), 'https://news.example/story');
    expect(article?.extractionMethod).toBe('json-ld');
    expect(article?.content).toContain('&lt;script&gt;');
    expect(article?.content).not.toContain('<script>');
  });
  it('reads Next.js article state without executing scripts', () => {
    const state = { props: { pageProps: { article: { title: 'Next article', bodyHtml: body + '<script>globalThis.compromised=true</script>', author: { name: 'Next Reporter' } } } } };
    const article = extractArticle(page(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(state).replace(/<\//g, '<\\/')}</script><p>Loading</p>`), 'https://news.example/story');
    expect(article?.extractionMethod).toBe('embedded-state');
    expect(article?.title).toBe('Next article');
    expect(article?.byline).toBe('Next Reporter');
    expect(article?.content).not.toContain('compromised');
  });
  it('supports JSON Nuxt state assignments and flattened Nuxt payloads', () => {
    const state = { data: { article: { title: 'Nuxt article', body: body } } };
    const assigned = extractArticle(page(`<script>window.__NUXT__=${JSON.stringify(state)};</script>`), 'https://news.example/story');
    expect(assigned?.extractionMethod).toBe('embedded-state');
    const flat = [{ data: 1 }, { article: 2 }, { title: 3, body: 4 }, 'Flattened article', body];
    const flattened = extractArticle(page(`<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`), 'https://news.example/story');
    expect(flattened?.extractionMethod).toBe('embedded-state');
    expect(flattened?.title).toBe('Flattened article');
  });
  it('supports Arc rich text and skips non-article promotion elements', () => {
    const state = { headlines: { basic: 'Arc story' }, content_elements: [{ type: 'text', content: paragraph }, { type: 'text', content: second }, { type: 'text', content: third }, { type: 'promo', content: 'Buy this product' }] };
    const article = extractArticle(page(`<script>window.Fusion.globalContent = ${JSON.stringify(state)};</script>`), 'https://www.washingtonpost.com/story');
    expect(article?.extractionMethod).toBe('embedded-state');
    expect(article?.title).toBe('Arc story');
    expect(article?.textContent).toContain('collected observations');
    expect(article?.textContent).not.toContain('Buy this product');
  });
  it('combines BBC text blocks and preserves Unicode content', () => {
    const article = extractArticle(page(`<div data-component="text-block"><p>${paragraph}</p></div><div data-component="text-block"><p>${second} 科学研究与环境保护。 Café, naïve, Ελληνικά, العربية.</p></div><div data-component="text-block"><p>${third}</p></div>`), 'https://www.bbc.com/news/story');
    expect(article?.textContent).toContain('科学研究与环境保护');
    expect(article?.textContent).toContain('Café');
    expect(article?.wordCount).toBeGreaterThan(80);
  });
  it('prefers a full available body over a short JSON-LD summary', () => {
    const node = { '@type': 'NewsArticle', headline: 'Full story', articleBody: paragraph };
    const article = extractArticle(page(`<script type="application/ld+json">${JSON.stringify(node)}</script><article>${body}</article>`), 'https://news.example/story');
    expect(article?.textContent).toContain('additional fieldwork');
  });
  it('does not mistake large navigation lists for articles', () => {
    const links = Array.from({ length: 30 }, (_, i) => `<a href="/story-${i}">${paragraph}</a>`).join('');
    expect(extractArticle(page(`<nav>${links}</nav>`), 'https://news.example/')).toBeNull();
  });
  it('rejects short bot challenge pages and leaves articles discussing CAPTCHA readable', () => {
    const challenge = page('<p>Verify you are human to continue. Enable JavaScript and cookies to continue.</p>', '<title>Just a moment...</title>');
    expect(detectChallenge(challenge)).toContain('challenge');
    expect(extractArticle(challenge, 'https://news.example/story')).toBeNull();
    const article = extractArticle(page(`<article>${body}<p>CAPTCHA technology is discussed in this report.</p></article>`), 'https://news.example/story');
    expect(article).not.toBeNull();
  });
  it('marks subscription snippets as partial without inventing missing text', () => {
    const article = extractArticle(page(`<article><p>${paragraph}</p><p>Sign in to continue reading the full article.</p></article><div class="paywall-overlay">Subscriber only</div>`), 'https://www.wsj.com/story');
    expect(article?.quality).toBe('partial');
    expect(article?.textContent).not.toContain(second);
  });
  it('ignores malformed JSON and accepts an ordinary publisher article', () => {
    const article = extractArticle(page(`<script type="application/ld+json">{malformed}</script><div class="RichTextStoryBody">${body}</div>`), 'https://apnews.com/article/story');
    expect(article?.siteName).toBe('Associated Press');
    expect(article?.content).toContain('coastal wildlife');
  });
});

describe('publisher matching', () => {
  it('matches subdomains and does not match lookalike hosts', () => {
    expect(publisherForUrl('https://edition.cnn.com/story')?.name).toBe('CNN');
    expect(publisherForUrl('https://notcnn.com/story')).toBeNull();
    expect(publisherForUrl('https://cnn.com.attacker.example/story')).toBeNull();
  });
});
