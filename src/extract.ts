import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { publisherForUrl, publisherSelectors } from './publishers';
import { escapeHtml, publicUrl, sanitizeHtml } from './sanitize';
import type { Article, ExtractionMethod } from './types';

interface Candidate {
  content: string;
  method: ExtractionMethod;
  title?: string;
  byline?: string | null;
  excerpt?: string;
  publishedAt?: string | null;
  image?: string | null;
}
type JsonObject = Record<string, unknown>;

const ARTICLE_TYPES = /(?:^|\b)(?:NewsArticle|Article|BlogPosting|ReportageNewsArticle|AnalysisNewsArticle|OpinionNewsArticle|ReviewNewsArticle|ScholarlyArticle|SocialMediaPosting)(?:$|\b)/;
const REMOVE_SELECTORS = ['script', 'style', 'noscript', 'template', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'iframe', '[role="navigation"]', '[role="banner"]', '[role="dialog"]', '[aria-label="Advertisement"]', '[data-component="advertisement"]', '.advertisement', '.ad-container', '.ad-slot', '.share-tools', '.social-share', '.related-articles', '.related-content', '.recommended-content', '.newsletter-signup', '.subscription-overlay', '.paywall-overlay', '.cookie-banner', '.cookie-consent', '.comments', '#comments', '[id^="google_ads_"]'];
const NOISE_TEXT = /^(?:advertisement|advertising|read more|related(?: articles| stories)?|share (?:this|on)|sign up for (?:our|the)|subscribe to (?:our|the)|follow us on|click here to|continue reading|all rights reserved|accept (?:all )?cookies|skip to (?:main )?content)\b/i;
const BODY_KEYS = new Set(['articleBody', 'article_body', 'bodyHtml', 'bodyHTML', 'body_html', 'htmlBody', 'contentHtml', 'contentHTML', 'content_html', 'bodyText', 'body_text', 'fullText', 'full_text', 'articleContent', 'article_content']);
const ENTITY_KEYS = /^(?:article|story|post|entry|document|content|page|articleData|storyData|postData|data|props|pageProps)$/i;

function textOf(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const br of document.querySelectorAll('br')) br.replaceWith('\n');
  for (const block of document.querySelectorAll('p,li,h1,h2,h3,h4,h5,h6,blockquote,figcaption,tr,pre,div,section')) block.append('\n');
  return (document.body.textContent || '').replace(/[\t\r \u00a0]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function normalizeText(value: string): string { return value.replace(/\s+/g, ' ').trim(); }
function string(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined; }
function object(value: unknown): JsonObject | null { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null; }

function authorName(value: unknown): string | null {
  if (Array.isArray(value)) return value.map(authorName).filter(Boolean).join(', ') || null;
  if (typeof value === 'string') return value.trim() || null;
  const author = object(value);
  return author ? string(author.name) || string(author.byline) || null : null;
}

function imageUrl(value: unknown, url: string): string | null {
  if (Array.isArray(value)) return value.map(item => imageUrl(item, url)).find(Boolean) || null;
  if (typeof value === 'string') return publicUrl(value, url);
  const image = object(value);
  return image ? publicUrl(string(image.url) || string(image.contentUrl), url) : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function plainBody(value: string): string {
  return value.split(/\n\s*\n|\r?\n/).map(paragraph => paragraph.trim()).filter(Boolean).map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('\n');
}

function structuredNodes(document: Document): JsonObject[] {
  const results: JsonObject[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    const raw = script.textContent || '';
    if (raw.length > 3_000_000) continue;
    try {
      const root: unknown = JSON.parse(raw);
      const stack: unknown[] = [root];
      let visited = 0;
      while (stack.length && ++visited < 10_000) {
        const value = stack.pop();
        if (Array.isArray(value)) { stack.push(...value.slice(0, 500)); continue; }
        const node = object(value);
        if (!node) continue;
        const type = Array.isArray(node['@type']) ? node['@type'].join(' ') : node['@type'];
        if (typeof type === 'string' && ARTICLE_TYPES.test(type)) results.push(node);
        if (node['@graph']) stack.push(node['@graph']);
        if (node.mainEntity) stack.push(node.mainEntity);
        if (node.itemListElement) stack.push(node.itemListElement);
        if (node.item) stack.push(node.item);
      }
    } catch { /* Invalid publisher markup is not fatal. */ }
  }
  return results;
}

function jsonLdCandidate(node: JsonObject, url: string): Candidate | null {
  const body = string(node.articleBody) || string(node.text);
  if (!body || body.length < 100) return null;
  return {
    content: plainBody(body), method: 'json-ld', title: string(node.headline) || string(node.name),
    byline: authorName(node.author) || authorName(node.creator), excerpt: string(node.description),
    publishedAt: isoDate(node.datePublished), image: imageUrl(node.image, url),
  };
}

/** Convert common rich-text state formats without executing publisher JavaScript. */
function richText(value: unknown, depth = 0): string {
  if (depth > 16) return '';
  if (typeof value === 'string') return value.length > 30 ? (/<(?:p|div|section|h[1-6]|ul|blockquote)\b/i.test(value) ? value : plainBody(value)) : '';
  if (Array.isArray(value)) return value.slice(0, 2000).map(item => richText(item, depth + 1)).join('\n');
  const node = object(value);
  if (!node) return '';
  const type = String(node.type || node._type || node.nodeType || '').toLowerCase();
  if (/^(?:image|picture|photo|video|embed|ad|advertisement|promo|related|raw_html|rawhtml)$/.test(type)) return '';
  // Arc Publishing/Reuters text records and Lexical/Contentful text records.
  if (typeof node.content === 'string' && /^(?:text|paragraph|heading|header|blockquote|list_element)$/.test(type)) {
    const body = node.content;
    if (type === 'heading' || type === 'header') return `<h2>${escapeHtml(body)}</h2>`;
    return /<\w/.test(body) ? body : plainBody(body);
  }
  if (typeof node.text === 'string' && /^(?:text|paragraph|block|span)$/.test(type)) return `<p>${escapeHtml(node.text)}</p>`;
  if (typeof node.value === 'string' && type === 'text') return escapeHtml(node.value);
  // Portable Text blocks: only explicit child text is included.
  if (Array.isArray(node.children)) {
    const inline = node.children.map(child => {
      const item = object(child);
      return item && typeof item.text === 'string' ? escapeHtml(item.text) : richText(child, depth + 1);
    }).join('');
    if (inline) return `<${type === 'heading' ? 'h2' : 'p'}>${inline}</${type === 'heading' ? 'h2' : 'p'}>`;
  }
  if (Array.isArray(node.content)) return richText(node.content, depth + 1);
  if (Array.isArray(node.content_elements)) return richText(node.content_elements, depth + 1);
  if (Array.isArray(node.blocks)) return richText(node.blocks, depth + 1);
  return '';
}

function nuxtPayload(value: unknown): unknown {
  if (!Array.isArray(value) || !object(value[0])) return value;
  const records = value;
  let expansions = 0;
  function resolve(item: unknown, ancestors: Set<number>, depth: number): unknown {
    if (++expansions > 20_000 || depth > 24) return null;
    if (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < records.length) {
      if (ancestors.has(item)) return null;
      const next = new Set(ancestors); next.add(item);
      return resolve(records[item], next, depth + 1);
    }
    if (Array.isArray(item)) {
      if (typeof item[0] === 'string' && ['Reactive', 'ShallowReactive', 'Ref', 'ShallowRef'].includes(item[0]) && item.length === 2) return resolve(item[1], ancestors, depth + 1);
      return item.slice(0, 2000).map(child => resolve(child, ancestors, depth + 1));
    }
    const record = object(item);
    if (!record) return item;
    return Object.fromEntries(Object.entries(record).slice(0, 2000).map(([key, child]) => [key, resolve(child, ancestors, depth + 1)]));
  }
  return resolve(value[0], new Set([0]), 0);
}

function embeddedCandidates(document: Document): Candidate[] {
  const candidates: Candidate[] = [];
  for (const script of document.querySelectorAll('script')) {
    const raw = (script.textContent || '').trim();
    if (!raw || raw.length > 5_000_000) continue;
    const isJson = script.getAttribute('type') === 'application/json' || ['__NEXT_DATA__', '__NUXT_DATA__', '__APOLLO_STATE__'].includes(script.id);
    let payload: string | null = isJson ? raw : null;
    // JSON assignment only. Functions, eval, JS object literals and executable Nuxt state are never run.
    if (!payload) {
      const match = raw.match(/^(?:window\.)?(?:__INITIAL_STATE__|__PRELOADED_STATE__|__APOLLO_STATE__|__NUXT__|__data|Fusion\.globalContent)\s*=\s*([\s\S]*?);?\s*$/);
      if (match) payload = match[1].replace(/;\s*$/, '');
    }
    if (!payload) continue;
    try {
      const parsed: unknown = JSON.parse(payload);
      const root: unknown = script.id === '__NUXT_DATA__' ? nuxtPayload(parsed) : parsed;
      const stack: { value: unknown; context: boolean; depth: number }[] = [{ value: root, context: false, depth: 0 }];
      let visits = 0;
      while (stack.length && ++visits <= 20_000 && candidates.length < 80) {
        const entry = stack.pop()!;
        if (entry.depth > 24) continue;
        if (Array.isArray(entry.value)) {
          // Nuxt's flattened payload arrays still expose records with recognizable article fields.
          for (const child of entry.value.slice(0, 5000)) stack.push({ value: child, context: entry.context, depth: entry.depth + 1 });
          continue;
        }
        const node = object(entry.value);
        if (!node) continue;
        const entity = entry.context || typeof node.headline === 'string' || typeof node.articleId === 'string' || typeof node.slug === 'string' || node.type === 'story' || node.type === 'article';
        for (const [key, value] of Object.entries(node)) {
          const explicitBody = BODY_KEYS.has(key) || key === 'content_elements';
          const contextualBody = entity && /^(?:body|content|blocks|paragraphs)$/i.test(key);
          if (explicitBody || contextualBody) {
            const content = richText(value);
            if (textOf(content).length >= 100) candidates.push({ content, method: 'embedded-state', title: string(node.headline) || string(node.title) || string(object(node.headlines)?.basic), byline: authorName(node.author) || authorName(node.byline), excerpt: string(node.description), publishedAt: isoDate(node.datePublished || node.publishedAt || node.publish_date) });
          }
          if (value && typeof value === 'object') stack.push({ value, context: entity || ENTITY_KEYS.test(key), depth: entry.depth + 1 });
        }
      }
    } catch { /* Most state scripts are executable JS; ignore them. */ }
  }
  return candidates;
}

function cleanContent(html: string): string {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  for (const selector of REMOVE_SELECTORS) for (const node of document.querySelectorAll(selector)) node.remove();
  const seen = new Set<string>();
  for (const node of document.querySelectorAll('p,blockquote,li')) {
    const normalized = normalizeText(node.textContent || '');
    if (!normalized && !node.querySelector('img')) { node.remove(); continue; }
    if (NOISE_TEXT.test(normalized) && normalized.length < 240) { node.remove(); continue; }
    if (normalized.length >= 60) {
      const key = normalized.toLowerCase();
      if (seen.has(key)) node.remove(); else seen.add(key);
    }
  }
  return document.body.innerHTML;
}

function scoreCandidate(candidate: Candidate, url: string): { content: string; text: string; score: number } {
  const content = sanitizeHtml(cleanContent(candidate.content), url);
  const text = textOf(content);
  const { document } = parseHTML(`<html><body>${content}</body></html>`);
  const paragraphs = Array.from(document.querySelectorAll('p')).filter(node => normalizeText(node.textContent || '').length > 80).length;
  const linkText = Array.from(document.querySelectorAll('a')).reduce((sum, node) => sum + (node.textContent || '').length, 0);
  const linkDensity = linkText / Math.max(text.length, 1);
  const boost = candidate.method === 'publisher' ? 1.09 : candidate.method === 'readability' ? 1.07 : candidate.method === 'json-ld' ? 1.04 : 1;
  const score = (text.length + Math.min(paragraphs, 40) * 70) * boost * Math.max(0.05, 1 - linkDensity * 1.8);
  return { content, text, score };
}

export function detectChallenge(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  if (/^(?:\s*(?:just a moment|attention required|access denied|robot or human|are you a robot|verify you are human|pardon our interruption|security check|checking your browser|request blocked|temporarily unavailable))[.!\s-]*(?:\|.*)?$/i.test(title.trim())) return 'The publisher returned a bot or access challenge.';
  if (html.length < 70_000 && /(?:cf-chl-|challenge-platform|g-recaptcha|px-captcha|captcha-delivery\.com|verify (?:that )?you are human|enable javascript and cookies to continue)/i.test(html) && !/<(?:article|section)[^>]*(?:article-body|articleBody|name=["']articleBody)/i.test(html)) return 'The publisher returned a CAPTCHA or browser verification page.';
  return null;
}

/** Extract the strongest actual article body present in a publisher response. */
export function extractArticle(html: string, url: string): Article | null {
  if (!html || html.length > 12_000_000 || !publicUrl(url, url)) return null;
  const { document } = parseHTML(html);
  const metadata = new Map<string, string>();
  for (const element of document.querySelectorAll('meta[property],meta[name]')) {
    const name = element.getAttribute('property') || element.getAttribute('name');
    const content = string(element.getAttribute('content'));
    if (name && content && !metadata.has(name)) metadata.set(name, content);
  }
  const meta = (name: string): string | undefined => metadata.get(name);
  const pageTitle = string(document.title);
  const heading = string(document.querySelector('h1')?.textContent);
  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href');
  const pageAuthor = string(document.querySelector('[rel="author"], [itemprop="author"], .byline')?.textContent);
  const pageDate = document.querySelector('time[datetime]')?.getAttribute('datetime');
  const pageLanguage = document.documentElement?.getAttribute('lang');
  const structured = structuredNodes(document);
  const primary = structured.find(node => string(node.articleBody)) || structured[0];
  const candidates: Candidate[] = [];
  for (const node of structured) {
    const candidate = jsonLdCandidate(node, url);
    if (candidate) candidates.push(candidate);
  }
  candidates.push(...embeddedCandidates(document));
  const publisher = publisherForUrl(url);
  for (const selector of [...publisherSelectors(url), '[itemprop="articleBody"]']) {
    const nodes = Array.from(document.querySelectorAll(selector));
    const roots = nodes.filter(node => !nodes.some(other => other !== node && other.contains(node)));
    if (roots.length) candidates.push({ content: roots.map(node => node.outerHTML).join('\n'), method: 'publisher' });
  }
  for (const selector of ['article', '[role="main"]', 'main', '.entry-content', '.post-content', '.article-body', '.story-body', '.gh-content', '.wp-block-post-content', '#article-body', '#storytext']) {
    for (const node of Array.from(document.querySelectorAll(selector)).slice(0, 24)) candidates.push({ content: node.outerHTML, method: 'generic' });
  }
  for (const selector of REMOVE_SELECTORS) for (const node of document.querySelectorAll(selector)) node.remove();
  // Readability resolves relative URLs against document.baseURI. Our sanitizer always uses the actual fetched URL.
  for (const base of document.querySelectorAll('base')) base.remove();
  try {
    const parsed = new Readability(document, { charThreshold: 100, keepClasses: false }).parse();
    if (parsed?.content) candidates.push({ content: parsed.content, method: 'readability', title: parsed.title || undefined, byline: parsed.byline, excerpt: parsed.excerpt || undefined });
  } catch { /* Some malformed pages cannot be parsed by Readability. */ }
  // Pages without any article semantics can still have a useful single body; heavily penalized link lists are rejected.
  if (document.body && !candidates.some(candidate => textOf(candidate.content).length >= 140)) candidates.push({ content: document.body.innerHTML, method: 'generic' });
  // Bound both work and retained strings. The selected body is the only scored DOM serialization retained.
  const seenContent = new Set<string>();
  let scoredBytes = 0;
  let scoredCount = 0;
  let best: ({ candidate: Candidate } & ReturnType<typeof scoreCandidate>) | undefined;
  for (const candidate of candidates) {
    if (seenContent.has(candidate.content) || candidate.content.length > 3_000_000) continue;
    if (scoredCount >= 48 || scoredBytes + candidate.content.length > 12_000_000) break;
    seenContent.add(candidate.content);
    scoredCount++; scoredBytes += candidate.content.length;
    const item = scoreCandidate(candidate, url);
    if (item.text.length >= 140 && (!best || item.score > best.score)) best = { candidate, ...item };
  }
  if (!best || best.score < 100) return null;
  const challenge = detectChallenge(html);
  if (challenge && best.text.length < 1500) return null;
  const rawTitle = meta('og:title') || meta('twitter:title') || string(primary?.headline) || best.candidate.title || heading || pageTitle;
  const title = normalizeText(rawTitle || 'Untitled article').slice(0, 500);
  const canonicalUrl = publicUrl(canonical, url) || publicUrl(meta('og:url'), url) || url;
  const byline = authorName(primary?.author) || best.candidate.byline || meta('author') || meta('article:author') || pageAuthor || null;
  const excerpt = normalizeText(meta('description') || meta('og:description') || string(primary?.description) || best.candidate.excerpt || best.text.slice(0, 260)).slice(0, 500);
  const publishedAt = isoDate(primary?.datePublished) || best.candidate.publishedAt || isoDate(meta('article:published_time') || meta('date') || pageDate);
  const language = (pageLanguage || meta('og:locale') || 'en').replace('_', '-').slice(0, 40);
  const siteName = normalizeText(meta('og:site_name') || publisher?.name || authorName(primary?.publisher) || new URL(url).hostname.replace(/^www\./, '')).slice(0, 160);
  const words = best.text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
  const cjk = best.text.match(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/g)?.length || 0;
  const wordCount = Math.max(words.length, Math.ceil(cjk / 2));
  const warnings: string[] = [];
  const paywallPresent = /(?:paywall|subscription-wall|subscribe.{0,30}(?:continue|read)|subscriber.{0,20}only|you.{0,20}reached.{0,25}(?:limit|free articles))/i.test(html);
  const visibleStop = /(?:subscribe|sign in|log in|register|become a (?:member|subscriber)).{0,70}(?:continue reading|read (?:this|the full|more)|unlock)|(?:continue reading|read (?:the )?full (?:article|story)).{0,60}(?:subscribe|sign in|subscription)/i.test(best.text);
  const declaredWordCount = typeof primary?.wordCount === 'number' ? primary.wordCount : Number(primary?.wordCount);
  const declaredShortfall = Number.isFinite(declaredWordCount) && declaredWordCount > 100 && wordCount < declaredWordCount * 0.75;
  const shortArticle = wordCount < 180 && cjk < 300;
  const quality = visibleStop || declaredShortfall || (shortArticle && paywallPresent) || wordCount < 80 ? 'partial' : 'full';
  if (quality === 'partial') warnings.push('The publisher response appears to contain only part of the article. Missing text cannot be reconstructed.');
  if (paywallPresent && !declaredWordCount) warnings.push('The page includes subscription controls; completeness cannot be independently verified.');
  if (challenge) warnings.push(challenge);
  const image = best.candidate.image || imageUrl(primary?.image, url) || publicUrl(meta('og:image') || meta('twitter:image'), url) || publicUrl(parseHTML(`<html><body>${best.content}</body></html>`).document.querySelector('img')?.getAttribute('src'), url);
  return { url, canonicalUrl, title, byline: byline ? normalizeText(byline).slice(0, 300) : null, siteName, excerpt, publishedAt: publishedAt || null, language, content: best.content, textContent: best.text, wordCount, readingMinutes: Math.max(1, Math.ceil(wordCount / 220)), image, extractionMethod: best.candidate.method, quality, warnings };
}
