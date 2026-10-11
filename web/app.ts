const query = <T extends Element>(selector: string, root: Pick<ParentNode, 'querySelector'> = document): T | null => root.querySelector<T>(selector);
const all = <T extends Element>(selector: string): T[] => [...document.querySelectorAll<T>(selector)];

const memory = {
  read(storage: Storage, key: string): string | null { try { return storage.getItem(key); } catch { return null; } },
  write(storage: Storage, key: string, value: string): void { try { storage.setItem(key, value); } catch { /* Reading still works when storage is unavailable. */ } },
};
const storage = (kind: 'localStorage' | 'sessionStorage'): Storage | null => { try { return window[kind]; } catch { return null; } };
const local = storage('localStorage');
const session = storage('sessionStorage');
const savedTheme = local && memory.read(local, 'newz-theme');
if (savedTheme === 'dark' || savedTheme === 'light') document.documentElement.dataset.theme = savedTheme;
const themeIsDark = (): boolean => document.documentElement.dataset.theme ? document.documentElement.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
function updateThemeLabel(): void {
  all<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => {
    const label = `Switch to ${themeIsDark() ? 'light' : 'dark'} theme`;
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
all<HTMLButtonElement>('[data-theme-toggle]').forEach((button) => button.addEventListener('click', () => {
  const theme = themeIsDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  if (local) memory.write(local, 'newz-theme', theme);
  updateThemeLabel();
}));
updateThemeLabel();

let readingSize = Number(local && memory.read(local, 'newz-reading-size')) || 20;
function setReadingSize(value: number): void {
  readingSize = Math.max(16, Math.min(28, value));
  document.documentElement.style.setProperty('--reader-size', `${readingSize}px`);
  if (local) memory.write(local, 'newz-reading-size', String(readingSize));
  const smaller = query<HTMLButtonElement>('[data-font-smaller]');
  const larger = query<HTMLButtonElement>('[data-font-larger]');
  if (smaller) smaller.disabled = readingSize <= 16;
  if (larger) larger.disabled = readingSize >= 28;
}
setReadingSize(readingSize);
query('[data-font-smaller]')?.addEventListener('click', () => setReadingSize(readingSize - 1));
query('[data-font-larger]')?.addEventListener('click', () => setReadingSize(readingSize + 1));

let toastTimeout: ReturnType<typeof setTimeout>;
function toast(message: string): void {
  const element = query<HTMLElement>('[data-toast]');
  if (!element) return;
  clearTimeout(toastTimeout);
  element.textContent = message;
  element.hidden = false;
  toastTimeout = setTimeout(() => { element.hidden = true; }, 3500);
}
const snapshotLink = query<HTMLInputElement>('[data-snapshot-link]');
if (snapshotLink) snapshotLink.value = location.origin + location.pathname;
all<HTMLButtonElement>('[data-copy-link]').forEach((button) => button.addEventListener('click', async () => {
  const url = location.origin + location.pathname;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link to this edition copied.');
  } catch {
    if (snapshotLink) { snapshotLink.focus(); snapshotLink.select(); toast('Select and copy the edition link below.'); }
    else toast('Copy the link from your address bar.');
  }
}));

const tokenInputs = all<HTMLInputElement>('[data-token-input]');
let captureToken = (session && memory.read(session, 'newz-capture-token')) || '';
tokenInputs.forEach((input) => {
  input.value = captureToken;
  input.addEventListener('input', () => {
    captureToken = input.value.trim();
    if (session) memory.write(session, 'newz-capture-token', captureToken);
    tokenInputs.forEach((other) => { if (other !== input) other.value = captureToken; });
  });
});
function revealToken(): void {
  const details = query<HTMLDetailsElement>('[data-token-details]');
  if (details) details.open = true;
  tokenInputs[0]?.focus();
}

// Build this on the client so a custom hostname always gets its own shortcut.
const bookmarklet = query<HTMLAnchorElement>('[data-bookmarklet]');
if (bookmarklet) bookmarklet.href = `javascript:location.href=${JSON.stringify(location.origin + '/read?url=')}+encodeURIComponent(location.href)`;

type CaptureResponse = { snapshot?: { id?: string }; error?: string | { message?: string }; message?: string };
class CaptureError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
async function requestCapture(path: string, body: Record<string, unknown>): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 150_000);
  try {
    const response = await fetch(path, {
      method: 'POST', headers: {
        'Content-Type': 'application/json', ...(captureToken ? { Authorization: `Bearer ${captureToken}` } : {}),
      }, body: JSON.stringify(body), signal: controller.signal,
    });
    let result: CaptureResponse;
    try { result = await response.json() as CaptureResponse; }
    catch { throw new CaptureError('The reading room returned an unexpected response. Please try again in a moment.', response.status); }
    if (!response.ok) {
      const reason = typeof result.error === 'string' ? result.error : result.error?.message;
      throw new CaptureError(reason || result.message || (response.status === 401 ? 'This archive needs an access key. Add it below, then try again.' : 'The article could not be saved. Please try again.'), response.status);
    }
    if (!result.snapshot?.id) throw new CaptureError('The page was processed, but no saved edition was returned. Please try again.', 500);
    return result.snapshot.id;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new CaptureError('This article is taking longer than expected. Try again, or look for an archived copy below.', 408);
    if (error instanceof TypeError) throw new CaptureError('The connection was interrupted. Check your connection and try again.', 0);
    throw error;
  } finally { clearTimeout(timeout); }
}

const captureStatus = query<HTMLElement>('[data-capture-status]');
let captureRunning = false;
async function captureArticle(): Promise<void> {
  if (!captureStatus || captureRunning) return;
  const url = captureStatus.dataset.url;
  if (!url) return;
  captureRunning = true;
  const failure = query<HTMLElement>('[data-capture-error]');
  const message = query<HTMLElement>('[data-loading-message]');
  const progress = query<HTMLElement>('.loading-line');
  const retry = query<HTMLButtonElement>('[data-retry]');
  if (failure) failure.hidden = true;
  if (progress) progress.hidden = false;
  if (retry) retry.disabled = true;
  if (message) message.textContent = 'Opening the article and checking for a readable copy…';
  const slowMessage = setTimeout(() => { if (message) message.textContent = 'Still working on this story. Some publishers need a few extra moments…'; }, 18_000);
  const longerMessage = setTimeout(() => { if (message) message.textContent = 'This publisher is taking a little longer. We’re still looking for a readable edition…'; }, 55_000);
  try {
    const refresh = new URLSearchParams(location.search).get('refresh') === '1';
    const id = await requestCapture('/api/capture', { url, ...(refresh ? { refresh: true } : {}) });
    if (message) message.textContent = 'Your edition is ready. Opening it now…';
    location.replace(`/s/${encodeURIComponent(id)}`);
  } catch (error) {
    const errorMessage = query<HTMLElement>('[data-error-message]');
    if (errorMessage) errorMessage.textContent = error instanceof Error ? error.message : 'An unexpected error interrupted this article. Please try again.';
    if (message) message.textContent = 'The article isn’t ready yet.';
    if (progress) progress.hidden = true;
    if (failure) failure.hidden = false;
    if (error instanceof CaptureError && (error.status === 401 || error.status === 403)) revealToken();
  } finally {
    clearTimeout(slowMessage); clearTimeout(longerMessage);
    captureRunning = false;
    if (retry) retry.disabled = false;
  }
}
query('[data-retry]')?.addEventListener('click', () => { void captureArticle(); });
if (captureStatus) void captureArticle();

query<HTMLFormElement>('[data-capture-form]')?.addEventListener('submit', (event) => {
  const form = event.currentTarget as HTMLFormElement;
  const button = query<HTMLButtonElement>('button[type="submit"]', form);
  if (button) { button.disabled = true; button.textContent = 'Opening…'; }
});

query<HTMLFormElement>('[data-import-form]')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const errorElement = query<HTMLElement>('[data-import-error]', form);
  const button = query<HTMLButtonElement>('button[type="submit"]', form);
  const file = query<HTMLInputElement>('[name="file"]', form)?.files?.[0];
  const url = query<HTMLInputElement>('[name="url"]', form)?.value.trim();
  if (errorElement) errorElement.hidden = true;
  if (!file || !url) return;
  if (file.size > 2 * 1024 * 1024) {
    if (errorElement) { errorElement.textContent = 'Choose an HTML file no larger than 2 MB.'; errorElement.hidden = false; }
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Saving your page…'; }
  try {
    const html = await file.text();
    if (!html.trim()) throw new Error('This file is empty. Choose a saved HTML page.');
    const id = await requestCapture('/api/import', { url, html });
    location.assign(`/s/${encodeURIComponent(id)}`);
  } catch (error) {
    if (errorElement) { errorElement.textContent = error instanceof Error ? error.message : 'This page could not be saved.'; errorElement.hidden = false; }
    if (error instanceof CaptureError && (error.status === 401 || error.status === 403)) revealToken();
    if (button) { button.disabled = false; button.textContent = 'Save this page →'; }
  }
});

document.addEventListener('click', (event) => {
  all<HTMLDetailsElement>('.download-menu[open]').forEach((menu) => {
    if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') all<HTMLDetailsElement>('.download-menu[open]').forEach((menu) => { menu.open = false; }); });

export {};
