import type { Snapshot, StoredCapture } from './types';

export function htmlEscape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]!));
}

function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : '#';
  } catch { return '#'; }
}

function formatDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(date);
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Date unavailable';
  return new Intl.DateTimeFormat('en', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(date) + ' UTC';
}

function layout(title: string, body: string, appName: string, options: { reader?: boolean; description?: string } = {}): string {
  const dot = appName.lastIndexOf('.');
  const brand = dot > 0
    ? `<span class="brand-prefix">${htmlEscape(appName.slice(0, dot))}</span><span class="brand-tld">${htmlEscape(appName.slice(dot))}</span>`
    : htmlEscape(appName);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="description" content="${htmlEscape(options.description || 'Save and search article snapshots.')}">
<meta name="theme-color" content="#ffffff"><title>${htmlEscape(title)} · ${htmlEscape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script></head>
<body${options.reader ? ' class="reader-page"' : ''}><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="header-inner"><div class="site-brand"><a class="wordmark" href="/" aria-label="${htmlEscape(appName)} home">${brand}</a><span class="brand-caption">article archive</span></div>
<nav aria-label="Main navigation"><a href="/archive">Archive</a><button type="button" class="theme-toggle icon-button" data-theme-toggle aria-label="Switch color theme" title="Switch color theme"><span aria-hidden="true">◐</span></button></nav></div></header>
${body}
<footer class="site-footer"><div class="shortcut-links"><a href="#" data-bookmarklet title="Drag to your bookmarks bar">Save with ${htmlEscape(appName)}</a><a href="https://github.com/pierce403/newz-rip" target="_blank" rel="noopener noreferrer">GitHub</a></div></footer>
<div class="toast" role="status" aria-live="polite" data-toast hidden></div></body></html>`;
}

function tokenField(): string {
  return '<details class="access-key" data-token-details><summary>Access key</summary><label>Key<input type="password" data-token-input autocomplete="off"></label><p class="field-hint">Stored in this tab.</p></details>';
}

function alternatives(url: string): string {
  const source = safeHttpUrl(url);
  if (source === '#') return '';
  return `<div class="alternative-links"><a href="${htmlEscape(source)}" target="_blank" rel="noopener noreferrer">Original</a><a href="https://web.archive.org/web/*/${htmlEscape(source)}" target="_blank" rel="noopener noreferrer">Wayback Machine</a><a href="https://archive.today/${htmlEscape(source)}" target="_blank" rel="noopener noreferrer">archive.today</a></div>`;
}

function searchPanel(q = ''): string {
  return `<section class="search-section search-box" aria-labelledby="search-title"><h2 id="search-title">Search saved pages</h2><form class="archive-search" action="/archive" method="get"><label class="sr-only" for="archive-query">Search snapshots</label><div class="url-row"><input id="archive-query" name="q" type="search" placeholder="URL, title, or publisher" value="${htmlEscape(q)}"><button class="button secondary" type="submit">Search</button></div></form></section>`;
}

export function renderHome(appName = 'newz.rip'): string {
  return layout('Article archive', `<main id="main" class="home-main"><h1 class="sr-only">Save and search pages</h1>
<section class="capture-section capture-box" aria-labelledby="capture-title"><h2 id="capture-title">Save a page</h2><form action="/read" method="get" class="capture-form" data-capture-form><label class="sr-only" for="article-url">Article URL</label><div class="url-row"><input id="article-url" name="url" type="url" required placeholder="https://example.com/article" autocomplete="url" inputmode="url" autocapitalize="off" spellcheck="false"><button class="button primary" type="submit">Save</button></div></form></section>
${searchPanel()}
<details class="home-options"><summary>Options</summary><div class="options-content">${tokenField()}<details class="import-section"><summary>Import HTML</summary><form class="import-form" data-import-form><label>Original URL<input name="url" type="url" required placeholder="https://example.com/article" autocomplete="url"></label><label>HTML file<input name="file" type="file" accept=".html,.htm,text/html,text/plain" required></label><p class="field-hint">2 MB maximum.</p><button class="button secondary" type="submit">Save</button><p class="form-error" role="alert" data-import-error hidden></p></form></details></div></details></main>`, appName);
}

export function renderLoading(url: string, appName = 'newz.rip'): string {
  return layout('Saving', `<main id="main" class="status-main"><section class="capture-status" data-capture-status data-url="${htmlEscape(url)}"><h1>Saving page</h1><p class="status-url">${htmlEscape(url)}</p><div class="loading-line" aria-hidden="true"><span></span></div><p class="loading-message" role="status" aria-live="polite" data-loading-message>Saving…</p>${tokenField()}<div class="capture-failure" data-capture-error hidden><h2>Couldn’t save this page</h2><p role="alert" data-error-message></p><button class="button primary" type="button" data-retry>Retry</button>${alternatives(url)}</div><noscript><p class="form-error">Enable JavaScript to save pages.</p>${alternatives(url)}</noscript></section></main>`, appName);
}

function snapshotCard(snapshot: Snapshot): string {
  return `<article class="archive-card"><div class="card-meta"><time datetime="${htmlEscape(snapshot.capturedAt)}">${htmlEscape(formatTime(snapshot.capturedAt))}</time><span>${htmlEscape(snapshot.siteName)}</span></div><h2><a href="/s/${encodeURIComponent(snapshot.id)}">${htmlEscape(snapshot.title)}</a></h2><div class="card-url">${htmlEscape(snapshot.url)}</div><div class="card-bottom"><span>${snapshot.wordCount.toLocaleString('en')} words${snapshot.quality === 'partial' ? ' · Partial copy' : ''}</span></div></article>`;
}

export function renderArchive(snapshots: Snapshot[], q: string, page: number, hasMore: boolean, appName = 'newz.rip'): string {
  const pageUrl = (value: number) => `/archive?q=${encodeURIComponent(q)}&page=${value}`;
  return layout('Archive', `<main id="main" class="archive-main"><h1 class="sr-only">Archive</h1>${searchPanel(q)}
<div class="search-caption"><p>${q ? `Results for <strong>${htmlEscape(q)}</strong>` : 'Recent snapshots'}</p>${q ? '<a href="/archive">Clear</a>' : ''}</div>
${snapshots.length ? `<div class="archive-list">${snapshots.map(snapshotCard).join('')}</div>` : `<p class="empty-state">${q ? 'No results.' : 'No saved pages yet.'}</p>`}
${page > 1 || hasMore ? `<nav class="pagination" aria-label="Archive pages">${page > 1 ? `<a class="button secondary" href="${htmlEscape(pageUrl(page - 1))}">Newer</a>` : '<span></span>'}<span>Page ${Math.max(1, Math.floor(page))}</span>${hasMore ? `<a class="button secondary" href="${htmlEscape(pageUrl(page + 1))}">Older</a>` : '<span></span>'}</nav>` : ''}</main>`, appName);
}

export function renderSnapshot(stored: StoredCapture, history: Snapshot[], appName = 'newz.rip'): string {
  const { snapshot, article } = stored;
  const downloadRoot = `/s/${encodeURIComponent(snapshot.id)}/download`;
  const warnings = [...new Set(article.warnings)].filter(Boolean);
  const editions = history.some((edition) => edition.id === snapshot.id) ? history : [snapshot, ...history];
  return layout(article.title, `<main id="main" class="reader-main"><section class="snapshot-bar" aria-label="Snapshot details"><div class="reader-toolbar" aria-label="Article tools"><form action="/read" method="get"><input type="hidden" name="url" value="${htmlEscape(article.url)}"><input type="hidden" name="refresh" value="1"><button class="button secondary" type="submit">Save again</button></form><div class="reader-tools"><div class="font-controls" aria-label="Reading text size"><button type="button" data-font-smaller aria-label="Decrease text size">A−</button><button type="button" data-font-larger aria-label="Increase text size">A+</button></div><button class="tool-button" type="button" data-copy-link>Copy link</button><details class="download-menu"><summary>Download</summary><div><a href="${downloadRoot}?format=html">HTML</a><a href="${downloadRoot}?format=md">Markdown</a><a href="${downloadRoot}?format=txt">Text</a><a href="${downloadRoot}?format=json">JSON</a></div></details></div></div>
<dl class="snapshot-meta"><div><dt>Saved</dt><dd><time datetime="${htmlEscape(snapshot.capturedAt)}">${htmlEscape(formatTime(snapshot.capturedAt))}</time></dd></div><div><dt>Original</dt><dd><a href="${htmlEscape(safeHttpUrl(article.canonicalUrl || article.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(article.canonicalUrl || article.url)}</a></dd></div><div><dt><label for="saved-link">Snapshot</label></dt><dd><input id="saved-link" data-snapshot-link readonly value="/s/${htmlEscape(snapshot.id)}"></dd></div></dl>
${editions.length > 1 ? `<details class="edition-history"><summary>${editions.length} snapshots</summary><ol>${editions.map((edition) => `<li>${edition.id === snapshot.id ? `<span aria-current="page">${htmlEscape(formatTime(edition.capturedAt))}<em>Current</em></span>` : `<a href="/s/${encodeURIComponent(edition.id)}">${htmlEscape(formatTime(edition.capturedAt))}</a>`}<span>${edition.wordCount.toLocaleString('en')} words${edition.quality === 'partial' ? ' · Partial' : ''}</span></li>`).join('')}</ol></details>` : ''}</section>
<article class="reading-article"><header class="article-header"><a class="publication" href="${htmlEscape(safeHttpUrl(article.canonicalUrl || article.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(article.siteName)}</a><h1>${htmlEscape(article.title)}</h1>${article.excerpt ? `<p class="article-deck">${htmlEscape(article.excerpt)}</p>` : ''}<div class="article-byline">${article.byline ? `<span>${htmlEscape(article.byline)}</span>` : ''}${article.publishedAt ? `<time datetime="${htmlEscape(article.publishedAt)}">${htmlEscape(formatDate(article.publishedAt))}</time>` : ''}<span>${article.readingMinutes} min read</span></div></header>
${article.quality === 'partial' || warnings.length ? `<aside class="article-warning" aria-label="About this copy"><strong>${article.quality === 'partial' ? 'Partial copy' : 'Capture notes'}</strong>${warnings.length ? `<ul>${warnings.map((warning) => `<li>${htmlEscape(warning)}</li>`).join('')}</ul>` : '<p>Some text may be missing.</p>'}</aside>` : ''}
<div class="article-content">${article.content}</div></article></main>`, appName, { reader: true, description: article.excerpt });
}

export function renderError(message: string, status = 500, url = '', appName = 'newz.rip'): string {
  return layout(status === 404 ? 'Page not found' : 'Error', `<main id="main" class="status-main"><section class="error-page"><h1>${status === 404 ? 'Page not found' : 'Couldn’t open this page'}</h1><p class="error-description">${htmlEscape(message)}</p><a class="button primary" href="/">Home</a>${alternatives(url)}</section></main>`, appName);
}

export function renderNotFound(appName = 'newz.rip'): string {
  return renderError('This page is unavailable.', 404, '', appName);
}
