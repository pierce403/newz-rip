import puppeteer, { type Browser, type HTTPRequest, type Page } from '@cloudflare/puppeteer';
import type { Env } from './types';
import { AppError, assertPublicDns, validateTarget } from './url';

const MAX_REQUESTS = 48;
const MAX_HTML_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const ALLOWED_RESOURCES = new Set(['document', 'script', 'xhr', 'fetch']);

/**
 * Render an anonymous public page in a disposable Cloudflare browser. The browser
 * receives no application secrets, publisher credentials, or persistent cookies.
 */
export async function renderPublicArticle(input: string, env: Partial<Env>): Promise<{ html: string; url: string }> {
  const target = validateTarget(input);
  if (!env.BROWSER || env.ALLOW_BROWSER_RENDERING !== 'true') {
    throw new AppError('Browser rendering is not enabled for this deployment.', 503, 'browser_disabled');
  }

  const controller = new AbortController();
  const deadline = Date.now() + TIMEOUT_MS;
  const dns = new Map<string, Promise<void>>();
  let browser: Browser | undefined;
  let page: Page | undefined;
  let closed = false;
  let requests = 0;
  let navigationFailure: AppError | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  const timeoutError = () => new AppError('Browser rendering timed out.', 504, 'browser_timeout');
  const checkDns = async (url: URL): Promise<void> => {
    let checked = dns.get(url.hostname);
    if (!checked) {
      checked = assertPublicDns(url, fetch, controller.signal);
      dns.set(url.hostname, checked);
    }
    await checked;
  };
  const close = async (): Promise<void> => {
    closed = true;
    controller.abort();
    if (browser && !closing) closing = browser.close().catch(() => {});
    await closing;
  };
  const abortRequest = async (request: HTTPRequest): Promise<void> => {
    if (!request.isInterceptResolutionHandled()) await request.abort('blockedbyclient').catch(() => {});
  };
  const intercept = async (request: HTTPRequest): Promise<void> => {
    if (request.isInterceptResolutionHandled()) return;
    const mainNavigation = request.isNavigationRequest() && request.frame() === page?.mainFrame();
    try {
      if (closed || Date.now() >= deadline) throw timeoutError();
      // Nested documents, media, CSS, beacons, sockets, and non-read requests
      // do not contribute article text. Keep the browser a bounded reader.
      if (!ALLOWED_RESOURCES.has(request.resourceType())
        || (request.resourceType() === 'document' && !mainNavigation)
        || !['GET', 'HEAD'].includes(request.method())) {
        await abortRequest(request);
        return;
      }
      const destination = validateTarget(request.url());
      if (++requests > MAX_REQUESTS) throw new AppError('The page exceeded the browser request limit.', 422, 'browser_request_limit');
      await checkDns(destination);
      // Another listener or deadline cleanup can resolve the interception while
      // DNS is pending. Check again immediately before the synchronous action.
      if (closed || Date.now() >= deadline) throw timeoutError();
      if (!request.isInterceptResolutionHandled()) await request.continue();
    } catch (error) {
      if (mainNavigation) navigationFailure = error instanceof AppError ? error : new AppError('The page destination could not be validated.', 502, 'browser_target_failed');
      await abortRequest(request);
    }
  };

  const run = async (): Promise<{ html: string; url: string }> => {
    await checkDns(target);
    const rootHost = target.hostname.replace(/^www\./, '');
    const extraHosts = (env.BROWSER_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean);
    if (extraHosts.length > 45) throw new AppError('Too many browser dependency hosts are configured.', 503, 'browser_config');
    const checkedHosts = extraHosts.map(host => {
      if (host.includes('/') || host.includes(':') || host.includes('*') || host.includes('@')) {
        throw new AppError('Browser dependency hosts must be exact public hostnames.', 503, 'browser_config');
      }
      return validateTarget(`https://${host}/`).hostname;
    });
    // Session-wide hostname limits also cover targets outside the main page's
    // request interceptor. DNS/IP checks below still apply to intercepted URLs.
    const started = await puppeteer.launch(env.BROWSER!, {
      guardrails: {
        allowedDomains: [...new Set([target.hostname, rootHost, `www.${rootHost}`, ...checkedHosts])],
        allowedDomainSets: ['common-cdns'],
      },
    });
    browser = started;
    if (closed) { await started.close().catch(() => {}); throw timeoutError(); }
    page = await started.newPage();
    if (closed) throw timeoutError();
    page.setDefaultTimeout(Math.max(1, deadline - Date.now()));
    page.setDefaultNavigationTimeout(Math.max(1, deadline - Date.now()));
    await page.setCacheEnabled(false);
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', intercept);
    // No saved session is reused and interactive popups are not followed.
    page.on('popup', popup => { void popup?.close().catch(() => {}); });
    page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });

    try {
      const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: Math.max(1, deadline - Date.now()) });
      if (navigationFailure) throw navigationFailure;
      if (!response || !response.ok()) {
        throw new AppError(`The publisher returned HTTP ${response?.status() ?? 'unknown'} during browser rendering.`, 502, 'browser_upstream_failed');
      }
      const headers = response.headers();
      if (!/text\/html|application\/xhtml\+xml/i.test(headers['content-type'] ?? '')) {
        throw new AppError('The rendered link did not return an HTML article.', 422, 'not_html');
      }
      if (Number(headers['content-length'] ?? 0) > MAX_HTML_BYTES) {
        throw new AppError('The page is too large to process.', 413, 'too_large');
      }
      // Allow asynchronous article hydration briefly without extending the total
      // deadline. Tracking requests cannot keep the renderer alive indefinitely.
      await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(2_000, Math.max(1, deadline - Date.now())) }).catch(() => {});
      if (navigationFailure) throw navigationFailure;
      if (closed || Date.now() >= deadline) throw timeoutError();
      const finalUrl = validateTarget(page.url());
      await checkDns(finalUrl);
      const html = await page.content();
      if (new TextEncoder().encode(html).byteLength > MAX_HTML_BYTES) {
        throw new AppError('The rendered page is too large to process.', 413, 'too_large');
      }
      return { html, url: finalUrl.href };
    } catch (error) {
      if (navigationFailure) throw navigationFailure;
      throw error;
    }
  };

  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void close();
        reject(timeoutError());
      }, TIMEOUT_MS);
    });
    return await Promise.race([run(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    // Stop pending DNS checks before closing so they cannot continue requests.
    // Keep interception attached until the browser has closed.
    await close();
  }
}
