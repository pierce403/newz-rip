import { parseHTML } from 'linkedom';
import { extractArticle } from './extract';
import { AppError, assertPublicDns, normalizeUrl, validateTarget } from './url';
import type { Attempt, CaptureResult, Env } from './types';

const MAX_HTML_BYTES = 6 * 1024 * 1024;
const GOOGLEBOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const MOBILE = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
export interface FetchOptions { fetcher?: typeof fetch; verifyDns?: boolean; timeoutMs?: number; }
interface Fetched { html: string; url: string; status: number; }

export async function readBounded(response: Response, max = MAX_HTML_BYTES): Promise<string> {
  if (Number(response.headers.get('content-length') ?? 0) > max) { await response.body?.cancel(); throw new AppError('The page is too large to process.', 413, 'too_large'); }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder(); let bytes = 0; let result = '';
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > max) throw new AppError('The page is too large to process.', 413, 'too_large');
      result += decoder.decode(value, { stream: true });
    }
    return result + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
}

/** Redirects are manual so every destination receives the same URL and DNS checks. */
export async function fetchPublicPage(input: string, userAgent: string, options: FetchOptions = {}, signal?: AbortSignal): Promise<Fetched> {
  const fetcher = options.fetcher ?? fetch;
  let url = validateTarget(input);
  for (let hop = 0; hop <= 4; hop++) {
    if (options.verifyDns !== false) await assertPublicDns(url, fetcher, signal);
    const response = await fetcher(url.href, {
      redirect: 'manual', signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,application/xhtml+xml;q=0.9', 'Accept-Language': 'en-US,en;q=0.8' }
    });
    if ([301,302,303,307,308].includes(response.status)) {
      const location = response.headers.get('location'); await response.body?.cancel();
      if (!location || hop === 4) throw new AppError('The page redirected too many times.', 502, 'redirect_failed');
      url = validateTarget(new URL(location, url).href); continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new AppError(`The publisher returned HTTP ${response.status}.`, response.status === 429 ? 429 : 502, `upstream_${response.status}`); }
    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) { await response.body?.cancel(); throw new AppError('This link did not return an HTML article.', 422, 'not_html'); }
    return { html: await readBounded(response), url: url.href, status: response.status };
  }
  throw new AppError('Unable to follow the page redirects.', 502);
}

export class CaptureError extends AppError {
  constructor(message: string, public attempts: Attempt[], code = 'article_unavailable') { super(message, 422, code); }
}

export async function fetchArticle(input: string, env: Partial<Env> = {}, options: FetchOptions = {}): Promise<CaptureResult> {
  const original = normalizeUrl(input);
  const deadline = Date.now() + Math.min(options.timeoutMs ?? 28000, 45000);
  const attempts: Attempt[] = [];
  let best: CaptureResult | null = null;
  let firstHtml: string | null = null;
  const attempt = async (strategy: string, target: string, ua: string): Promise<boolean> => {
    if (Date.now() >= deadline - 500) return false;
    const started = Date.now();
    const signal = AbortSignal.timeout(Math.min(7000, deadline - started));
    try {
      const fetched = await fetchPublicPage(target, ua, options, signal);
      if (!firstHtml && target === original) firstHtml = fetched.html;
      const article = extractArticle(fetched.html, fetched.url);
      if (!article) throw new AppError('The page contains no readable article, or returned a bot challenge.', 422, 'empty_article');
      // Preserve the actual source URL; history groups snapshots by the requested publisher URL.
      article.url = original;
      if (strategy === 'wayback') {
        article.canonicalUrl = original;
        article.warnings.push('This content came from an earlier Internet Archive capture. Check the capture details for its source date.');
      }
      const status = article.quality === 'full' ? 'success' : 'partial';
      attempts.push({ strategy, url: fetched.url, status, httpStatus: fetched.status, message: status === 'success' ? 'Readable article found.' : 'Only a partial article was available.', durationMs: Date.now() - started });
      const result = { article, attempts, rawHtml: fetched.html };
      if (!best || (article.quality === 'full' && best.article.quality !== 'full') || (article.quality === best.article.quality && article.wordCount > best.article.wordCount)) best = result;
      return article.quality === 'full';
    } catch (error) {
      attempts.push({ strategy, url: target, status: 'failed', message: error instanceof AppError ? error.message : 'The request timed out or could not reach the publisher.', durationMs: Date.now() - started });
      return false;
    }
  };
  if (await attempt('googlebot', original, GOOGLEBOT)) return best!;
  if (await attempt('standard', original, DESKTOP)) return best!;
  // Only use AMP URLs advertised by the publisher, never guessed URL mutations.
  if (firstHtml) {
    const { document } = parseHTML(firstHtml);
    const amp = document.querySelector('link[rel="amphtml"]')?.getAttribute('href');
    if (amp) {
      try {
        const target = validateTarget(new URL(amp, original).href);
        const rootHost = new URL(original).hostname.replace(/^www\./, '');
        if ((target.hostname === rootHost || target.hostname.endsWith('.' + rootHost)) && await attempt('amp', target.href, GOOGLEBOT)) return best!;
      } catch { /* unsafe or malformed AMP link is ignored */ }
    }
  }
  if (await attempt('mobile', original, MOBILE)) return best!;
  if (env.ALLOW_WAYBACK !== 'false' && Date.now() < deadline - 1500) {
    const started = Date.now();
    try {
      const available = new URL('https://archive.org/wayback/available'); available.searchParams.set('url', original);
      const response = await (options.fetcher ?? fetch)(available, { redirect: 'error', signal: AbortSignal.timeout(Math.min(5000, deadline - Date.now())) });
      if (!response.ok) throw new Error('No snapshot metadata');
      const data = JSON.parse(await readBounded(response, 65536)) as { archived_snapshots?: { closest?: { available: boolean; url: string; timestamp: string } } };
      const closest = data.archived_snapshots?.closest;
      if (closest?.available && /^\d{14}$/.test(closest.timestamp)) {
        const replay = new URL(closest.url);
        if (replay.hostname !== 'web.archive.org' || !/^\/web\/\d{14}\//.test(replay.pathname)) throw new Error('Invalid archive replay');
        // Build the replay URL ourselves from trusted metadata timestamp + validated source URL.
        if (await attempt('wayback', `https://web.archive.org/web/${closest.timestamp}id_/${original}`, DESKTOP)) return best!;
      } else attempts.push({ strategy: 'wayback', url: available.href, status: 'failed', message: 'No Internet Archive snapshot was found.', durationMs: Date.now() - started });
    } catch { attempts.push({ strategy: 'wayback', url: original, status: 'failed', message: 'Internet Archive lookup was unavailable.', durationMs: Date.now() - started }); }
  }
  if (best) return best;
  throw new CaptureError('The publisher did not provide a readable article. Try an existing archive or import a saved HTML page.', attempts);
}
