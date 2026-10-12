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
const themeIsDark = (): boolean => document.documentElement.dataset.theme === 'dark';
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
    toast('Link copied');
  } catch {
    if (snapshotLink) { snapshotLink.focus(); snapshotLink.select(); toast('Copy the link below'); }
    else toast('Copy the address bar link');
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
  const ancestors: HTMLDetailsElement[] = [];
  for (let element = details?.parentElement; element; element = element.parentElement) {
    if (element instanceof HTMLDetailsElement) ancestors.unshift(element);
  }
  ancestors.forEach((ancestor) => { ancestor.open = true; });
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
    catch { throw new CaptureError('Unexpected response. Try again.', response.status); }
    if (!response.ok) {
      const reason = typeof result.error === 'string' ? result.error : result.error?.message;
      throw new CaptureError(reason || result.message || (response.status === 401 ? 'Access key required. Add it below and retry.' : 'Could not save. Try again.'), response.status);
    }
    if (!result.snapshot?.id) throw new CaptureError('No snapshot returned. Try again.', 500);
    return result.snapshot.id;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new CaptureError('Timed out. Retry or check existing snapshots below.', 408);
    if (error instanceof TypeError) throw new CaptureError('Connection lost. Check your connection and retry.', 0);
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
  if (message) message.textContent = 'Saving…';
  const slowMessage = setTimeout(() => { if (message) message.textContent = 'Still saving…'; }, 18_000);
  const longerMessage = setTimeout(() => { if (message) message.textContent = 'Taking longer than usual…'; }, 55_000);
  try {
    const refresh = new URLSearchParams(location.search).get('refresh') === '1';
    const id = await requestCapture('/api/capture', { url, ...(refresh ? { refresh: true } : {}) });
    if (message) message.textContent = 'Saved. Opening…';
    location.replace(`/s/${encodeURIComponent(id)}`);
  } catch (error) {
    const errorMessage = query<HTMLElement>('[data-error-message]');
    if (errorMessage) errorMessage.textContent = error instanceof Error ? error.message : 'Could not save. Try again.';
    if (message) message.textContent = 'Could not save.';
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
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
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
    if (errorElement) { errorElement.textContent = 'HTML file must be 2 MB or smaller.'; errorElement.hidden = false; }
    return;
  }
  if (button) { button.disabled = true; button.textContent = 'Saving…'; }
  try {
    const html = await file.text();
    if (!html.trim()) throw new Error('Empty file. Choose a saved HTML page.');
    const id = await requestCapture('/api/import', { url, html });
    location.assign(`/s/${encodeURIComponent(id)}`);
  } catch (error) {
    if (errorElement) { errorElement.textContent = error instanceof Error ? error.message : 'Could not save. Try again.'; errorElement.hidden = false; }
    if (error instanceof CaptureError && (error.status === 401 || error.status === 403)) revealToken();
    if (button) { button.disabled = false; button.textContent = 'Save'; }
  }
});

document.addEventListener('click', (event) => {
  all<HTMLDetailsElement>('.download-menu[open]').forEach((menu) => {
    if (event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') all<HTMLDetailsElement>('.download-menu[open]').forEach((menu) => { menu.open = false; }); });

export {};
