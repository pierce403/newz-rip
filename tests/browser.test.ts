import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPublicArticle } from '../src/browser';
import type { Env } from '../src/types';

const mocks = vi.hoisted(() => ({ launch: vi.fn() }));
vi.mock('@cloudflare/puppeteer', () => ({ default: { launch: mocks.launch } }));

const env: Partial<Env> = { BROWSER: {} as Env['BROWSER'], ALLOW_BROWSER_RENDERING: 'true' };
let dnsFetch: ReturnType<typeof vi.fn>;
let close: ReturnType<typeof vi.fn>;
let page: ReturnType<typeof makePage>;

function makePage() {
  const frame = {};
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    on: vi.fn((name: string, handler: (...args: any[]) => any) => { handlers.set(name, handler); }),
    emit: async (name: string, value: unknown) => handlers.get(name)?.(value),
    mainFrame: () => frame,
    setDefaultTimeout: vi.fn(), setDefaultNavigationTimeout: vi.fn(),
    setCacheEnabled: vi.fn(async () => {}), setBypassServiceWorker: vi.fn(async () => {}),
    setRequestInterception: vi.fn(async () => {}),
    waitForNetworkIdle: vi.fn(async () => {}),
    goto: vi.fn(async (_url: string) => {
      await page.emit('request', request('https://www.cnn.com/story', 'document', true));
      return { ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'text/html' }) };
    }),
    url: vi.fn(() => 'https://www.cnn.com/story'),
    content: vi.fn(async () => '<html><article>Public article</article></html>'),
  };
}

function request(url: string, type = 'script', navigation = false, method = 'GET') {
  let handled = false;
  return {
    url: () => url, resourceType: () => type, isNavigationRequest: () => navigation,
    frame: () => page.mainFrame(), method: () => method,
    isInterceptResolutionHandled: () => handled,
    continue: vi.fn(async () => { handled = true; }),
    abort: vi.fn(async () => { handled = true; }),
  };
}

beforeEach(() => {
  vi.useRealTimers();
  mocks.launch.mockReset();
  dnsFetch = vi.fn(async () => Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] }));
  vi.stubGlobal('fetch', dnsFetch);
  page = makePage();
  close = vi.fn(async () => {});
  mocks.launch.mockResolvedValue({ newPage: async () => page, close });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('bounded optional browser rendering', () => {
  it('requires both an explicit opt-in and a browser binding', async () => {
    await expect(renderPublicArticle('https://cnn.com/story', {})).rejects.toMatchObject({ code: 'browser_disabled' });
    await expect(renderPublicArticle('https://cnn.com/story', { BROWSER: env.BROWSER })).rejects.toMatchObject({ code: 'browser_disabled' });
    expect(mocks.launch).not.toHaveBeenCalled();
  });

  it.each(['https://user:pass@cnn.com/', 'https://localhost/', 'http://169.254.169.254/'])('rejects unsafe initial URL %s before launching', async url => {
    await expect(renderPublicArticle(url, env)).rejects.toThrow();
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(dnsFetch).not.toHaveBeenCalled();
  });

  it('uses session hostname guardrails and caches DNS only within one capture', async () => {
    const script = request('https://www.cnn.com/main.js');
    page.goto.mockImplementation(async () => {
      await page.emit('request', request('https://www.cnn.com/story', 'document', true));
      await page.emit('request', script);
      return { ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'text/html' }) };
    });
    await expect(renderPublicArticle('https://www.cnn.com/story', { ...env, BROWSER_ALLOWED_HOSTS: 'api.cnn.com,cdn.example.net' })).resolves.toMatchObject({ url: 'https://www.cnn.com/story' });
    expect(mocks.launch).toHaveBeenCalledWith(env.BROWSER, { guardrails: { allowedDomains: ['www.cnn.com', 'cnn.com', 'api.cnn.com', 'cdn.example.net'], allowedDomainSets: ['common-cdns'] } });
    expect(dnsFetch).toHaveBeenCalledTimes(2);
    expect(script.continue).toHaveBeenCalledOnce();
    expect(page.setBypassServiceWorker).toHaveBeenCalledWith(true);
    expect(close).toHaveBeenCalledOnce();
    await renderPublicArticle('https://www.cnn.com/story', env);
    expect(dnsFetch).toHaveBeenCalledTimes(4);
  });

  it('checks redirect destinations and preserves a blocked navigation error', async () => {
    const redirect = request('http://169.254.169.254/', 'document', true);
    page.goto.mockImplementation(async () => {
      await page.emit('request', redirect);
      throw new Error('net::ERR_FAILED');
    });
    await expect(renderPublicArticle('https://www.cnn.com/story', env)).rejects.toThrow('IP address');
    expect(redirect.continue).not.toHaveBeenCalled();
    expect(redirect.abort).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('blocks a script dependency resolving to a private IP', async () => {
    dnsFetch.mockImplementation(async (url: URL) => Response.json({ Status: 0, Answer: [{ type: 1, data: url.searchParams.get('name') === 'cdn.example.net' ? '10.0.0.5' : '1.1.1.1' }] }));
    const script = request('https://cdn.example.net/main.js');
    page.waitForNetworkIdle.mockImplementation(async () => { await page.emit('request', script); });
    await renderPublicArticle('https://www.cnn.com/story', env);
    expect(script.abort).toHaveBeenCalledOnce();
    expect(script.continue).not.toHaveBeenCalled();
  });

  it.each(['image', 'media', 'font', 'stylesheet', 'websocket', 'eventsource', 'other'])('blocks unnecessary %s resources without DNS lookup', async type => {
    const asset = request('https://other.example.net/resource', type);
    page.waitForNetworkIdle.mockImplementation(async () => { await page.emit('request', asset); });
    await renderPublicArticle('https://www.cnn.com/story', env);
    expect(asset.abort).toHaveBeenCalledOnce();
    expect(asset.continue).not.toHaveBeenCalled();
    expect(dnsFetch).toHaveBeenCalledTimes(2);
  });

  it('blocks state-changing methods', async () => {
    const post = request('https://www.cnn.com/mutate', 'fetch', false, 'POST');
    page.waitForNetworkIdle.mockImplementation(async () => { await page.emit('request', post); });
    await renderPublicArticle('https://www.cnn.com/story', env);
    expect(post.abort).toHaveBeenCalledOnce();
    expect(post.continue).not.toHaveBeenCalled();
  });

  it('bounds continued network requests at 48 including the initial navigation', async () => {
    const dependencies = Array.from({ length: 48 }, (_, i) => request(`https://www.cnn.com/${i}.js`));
    page.waitForNetworkIdle.mockImplementation(async () => {
      await Promise.all(dependencies.map(dependency => page.emit('request', dependency)));
    });
    await renderPublicArticle('https://www.cnn.com/story', env);
    expect(dependencies.filter(dependency => dependency.continue.mock.calls.length)).toHaveLength(47);
    expect(dependencies[47].abort).toHaveBeenCalledOnce();
  });

  it('rejects returned DOM HTML above the byte limit and closes the session', async () => {
    page.content.mockResolvedValue('字'.repeat(2 * 1024 * 1024 + 1));
    await expect(renderPublicArticle('https://www.cnn.com/story', env)).rejects.toMatchObject({ code: 'too_large' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('rejects unsupported response content types', async () => {
    page.goto.mockResolvedValue({ ok: () => true, status: () => 200, headers: () => ({ 'content-type': 'application/pdf' }) });
    await expect(renderPublicArticle('https://www.cnn.com/story', env)).rejects.toMatchObject({ code: 'not_html' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('closes a late browser launch after the total deadline', async () => {
    vi.useFakeTimers();
    let finishLaunch!: (browser: unknown) => void;
    mocks.launch.mockReturnValue(new Promise(resolve => { finishLaunch = resolve; }));
    const pending = renderPublicArticle('https://www.cnn.com/story', env);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'browser_timeout' });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    finishLaunch({ newPage: async () => page, close });
    await vi.advanceTimersByTimeAsync(0);
    expect(close).toHaveBeenCalledOnce();
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('does not continue requests after DNS completes past the deadline', async () => {
    vi.useFakeTimers();
    const resolvers: Array<(response: Response) => void> = [];
    dnsFetch.mockImplementation(async (url: URL) => {
      if (url.searchParams.get('name') === 'cdn.example.net') return new Promise<Response>(resolve => resolvers.push(resolve));
      return Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] });
    });
    const dependency = request('https://cdn.example.net/main.js');
    page.waitForNetworkIdle.mockImplementation(async () => { await page.emit('request', dependency); });
    const pending = renderPublicArticle('https://www.cnn.com/story', env);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'browser_timeout' });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejected;
    resolvers.forEach(resolve => resolve(Response.json({ Status: 0, Answer: [{ type: 1, data: '1.1.1.1' }] })));
    await vi.advanceTimersByTimeAsync(0);
    expect(dependency.continue).not.toHaveBeenCalled();
    expect(dependency.abort).toHaveBeenCalledOnce();
  });

  it.each(['*.cnn.com', 'https://cnn.com', 'localhost', 'cnn.com:8080'])('rejects invalid configured dependency hostname %s', async hostname => {
    await expect(renderPublicArticle('https://www.cnn.com/story', { ...env, BROWSER_ALLOWED_HOSTS: hostname })).rejects.toThrow();
    expect(mocks.launch).not.toHaveBeenCalled();
  });
});
