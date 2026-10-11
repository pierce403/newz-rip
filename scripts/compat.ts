import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticle } from '../src/fetcher';
import type { Article, Attempt, CaptureResult, Env } from '../src/types';

interface Site {
  publisher: string;
  url: string;
  expectedTitleTokens: string[];
  category: string;
  discoveredAt: string;
  discovery: 'publisher-article' | 'publisher-link' | 'search-result' | 'user-link' | 'cited-article';
  sourceUrl?: string;
  notes?: string;
}
interface Options {
  base?: string;
  output: string;
  limit: number;
  publisher?: string;
  timeoutMs: number;
  wayback: boolean;
  strict: boolean;
  merge: boolean;
}
type Outcome = 'full_candidate' | 'partial' | 'wrong_article' | 'blocked' | 'network_error' | 'error';
interface Result {
  publisher: string;
  url: string;
  category: string;
  evaluatedAt: string;
  durationMs: number;
  outcome: Outcome;
  title?: string;
  titleMatch?: number;
  wordCount?: number;
  paragraphCount?: number;
  extractionMethod?: string;
  quality?: string;
  canonicalUrl?: string;
  warnings?: string[];
  errorCode?: string;
  error?: string;
  attempts: Attempt[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
function parseArgs(args: string[]): Options {
  const options: Options = { output: resolve(root, 'docs/compatibility-results.json'), limit: Infinity, timeoutMs: 45000, wayback: true, strict: false, merge: false };
  for (let i = 0; i < args.length; i++) {
    const argument = args[i];
    if (argument === '--help') {
      console.log('Usage: npm run compat -- [--base https://your-worker] [--output path] [--limit N] [--publisher name] [--timeout-ms N] [--no-wayback] [--merge] [--strict]\n\nCAPTURE_TOKEN authenticates --base requests if capture is protected. Direct mode retains production URL and DNS checks. Outcomes are extraction candidates, not guarantees of full article access. --merge replaces only selected articles in an existing report with the same environment/configuration.');
      process.exit(0);
    }
    if (argument === '--no-wayback') { options.wayback = false; continue; }
    if (argument === '--strict') { options.strict = true; continue; }
    if (argument === '--merge') { options.merge = true; continue; }
    if (!['--base', '--output', '--limit', '--publisher', '--timeout-ms'].includes(argument)) throw new Error(`Unknown option: ${argument}`);
    const value = args[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    if (argument === '--base') {
      const base = new URL(value);
      if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('--base must be an HTTP(S) origin without credentials, query, or fragment.');
      options.base = base.href.replace(/\/$/, '');
    } else if (argument === '--output') options.output = resolve(value);
    else if (argument === '--publisher') options.publisher = value.toLowerCase();
    else {
      const number = Number(value);
      if (!Number.isSafeInteger(number) || number < 1) throw new Error(`${argument} must be a positive integer.`);
      if (argument === '--limit') options.limit = number;
      else options.timeoutMs = number;
    }
  }
  return options;
}

function titleMatch(title: string, expected: string[]): number {
  const normalized = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ');
  return expected.filter(token => normalized.includes(token.toLowerCase())).length / Math.max(1, expected.length);
}

async function capture(site: Site, options: Options): Promise<CaptureResult> {
  if (!options.base) {
    const env: Partial<Env> = { ALLOW_WAYBACK: options.wayback ? 'true' : 'false' };
    return fetchArticle(site.url, env, { verifyDns: true, timeoutMs: options.timeoutMs });
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.CAPTURE_TOKEN) headers.Authorization = `Bearer ${process.env.CAPTURE_TOKEN}`;
  const response = await fetch(`${options.base}/api/capture`, {
    method: 'POST', headers, body: JSON.stringify({ url: site.url }),
    redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs),
  });
  const payload = await response.json() as Partial<CaptureResult> & { error?: string; code?: string; message?: string };
  if (!response.ok || !payload.article) {
    throw Object.assign(new Error(payload.error || payload.message || `Capture API returned HTTP ${response.status}.`), {
      code: payload.code || `api_${response.status}`, attempts: payload.attempts || [],
    });
  }
  return payload as CaptureResult;
}

async function evaluate(site: Site, options: Options): Promise<Result> {
  const started = Date.now();
  const result: Result = {
    publisher: site.publisher, url: site.url, category: site.category,
    evaluatedAt: new Date(started).toISOString(), durationMs: 0, outcome: 'error', attempts: [],
  };
  try {
    const captureResult = await capture(site, options);
    const article: Article = captureResult.article;
    const match = titleMatch(article.title, site.expectedTitleTokens);
    Object.assign(result, {
      title: article.title, titleMatch: match, wordCount: article.wordCount,
      paragraphCount: (article.content.match(/<p\b/gi) || []).length,
      extractionMethod: article.extractionMethod, quality: article.quality,
      canonicalUrl: article.canonicalUrl, warnings: article.warnings, attempts: captureResult.attempts,
    });
    result.outcome = match < 0.5 ? 'wrong_article' : article.quality === 'full' ? 'full_candidate' : 'partial';
  } catch (error) {
    const details = error as Error & { code?: string; attempts?: Attempt[]; cause?: Error };
    result.error = details.message || String(error);
    result.errorCode = details.code;
    result.attempts = details.attempts || [];
    const messages = [result.error, details.cause?.message, ...result.attempts.map(attempt => attempt.message)].join(' ');
    if (/DNS|could not reach|timed out|timeout|fetch failed|ENOTFOUND|ECONN|EAI_AGAIN|network/i.test(messages)) result.outcome = 'network_error';
    else if (/401|403|407|429|bot|challenge|not provide a readable article|unavailable|blocked|access denied/i.test(messages)) result.outcome = 'blocked';
  }
  result.durationMs = Date.now() - started;
  return result;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const corpus = JSON.parse(await readFile(resolve(root, 'scripts/news-sites.json'), 'utf8')) as Site[];
  const sites = corpus.filter(site => !options.publisher || site.publisher.toLowerCase().includes(options.publisher)).slice(0, options.limit);
  if (!sites.length) throw new Error('No corpus entries match the requested publishers.');
  const results: Result[] = [];
  let firstEvaluation = new Date().toISOString();
  if (options.merge) {
    const previous = JSON.parse(await readFile(options.output, 'utf8')) as { evaluatedAt?: string; mode?: string; base?: string | null; wayback?: boolean | string; results?: Result[] };
    if (previous.mode !== (options.base ? 'capture-api' : 'direct-fetcher') || (previous.base || null) !== (options.base || null)
      || previous.wayback !== (options.base ? 'server configuration' : options.wayback) || !Array.isArray(previous.results)) {
      throw new Error('--merge requires an existing report from the same mode, origin, and Wayback configuration.');
    }
    results.push(...previous.results.filter(result => corpus.some(site => site.url === result.url && site.publisher === result.publisher)));
    if (previous.evaluatedAt) firstEvaluation = previous.evaluatedAt;
  }
  const metadata = {
    evaluatedAt: firstEvaluation, mode: options.base ? 'capture-api' : 'direct-fetcher',
    base: options.base || null, nodeVersion: process.version, dnsValidation: true,
    wayback: options.base ? 'server configuration' : options.wayback,
    completenessVerified: false,
    limitations: [
      'A full_candidate is an extraction heuristic with a matching headline, not a proven complete or unlocked article.',
      'One article per publisher does not establish publisher-wide support.',
      'Direct Node results do not establish Cloudflare deployment compatibility; repeat with --base on the deployed Worker.',
      'Network errors may originate from the test environment, DNS validation, publisher, or archive provider.',
      'Capture API mode creates real saved snapshots and uses the server fallback configuration.',
    ],
  };
  async function save(): Promise<void> {
    const summary = Object.fromEntries(['full_candidate', 'partial', 'wrong_article', 'blocked', 'network_error', 'error'].map(outcome => [outcome, results.filter(result => result.outcome === outcome).length]));
    await mkdir(dirname(options.output), { recursive: true });
    await writeFile(options.output, JSON.stringify({ ...metadata, updatedAt: new Date().toISOString(), attempted: results.length, planned: options.merge ? corpus.length : sites.length, summary, results }, null, 2) + '\n');
  }
  // Serial requests avoid causing a burst against publishers or a protected capture endpoint.
  let completed = 0;
  for (const site of sites) {
    const result = await evaluate(site, options);
    const index = results.findIndex(existing => existing.publisher === site.publisher && existing.url === site.url);
    if (index >= 0) results[index] = result;
    else results.push(result);
    console.log(`${++completed}/${sites.length} ${site.publisher}: ${result.outcome}${result.wordCount ? ` (${result.wordCount} words)` : ''}`);
    await save(); // A long matrix leaves reviewable progress even if a later request is interrupted.
  }
  console.log(`Saved ${results.length} results to ${options.output}`);
  if (options.strict && results.filter(result => sites.some(site => site.url === result.url)).some(result => result.outcome !== 'full_candidate')) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
