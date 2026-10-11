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
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="description" content="${htmlEscape(options.description || 'A quieter place to read the news. Clean article pages and saved editions, together.')}">
<meta name="theme-color" content="#f5f2e9"><title>${htmlEscape(title)} · ${htmlEscape(appName)}</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="manifest" href="/manifest.webmanifest"><link rel="stylesheet" href="/styles.css"><script type="module" src="/app.js"></script></head>
<body${options.reader ? ' class="reader-page"' : ''}><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="header-inner"><a class="wordmark" href="/" aria-label="${htmlEscape(appName)} home">${htmlEscape(appName)}</a>
<nav aria-label="Main navigation"><a href="/archive">The archive</a><button type="button" class="theme-toggle icon-button" data-theme-toggle aria-label="Switch color theme" title="Switch color theme"><span aria-hidden="true">◐</span></button></nav></div></header>
${body}
<footer class="site-footer"><a class="wordmark small" href="/">${htmlEscape(appName)}</a><p>A good story deserves a quiet page.</p><a href="/archive">Browse saved editions <span aria-hidden="true">↗</span></a></footer>
<div class="toast" role="status" aria-live="polite" data-toast hidden></div></body></html>`;
}

function tokenField(): string {
  return '<details class="access-key" data-token-details><summary>Have an access key?</summary><label>Access key<input type="password" data-token-input autocomplete="off" placeholder="Only needed when saving is protected"></label><p class="field-hint">Kept in this browser tab until you close it.</p></details>';
}

function alternatives(url: string): string {
  const source = safeHttpUrl(url);
  if (source === '#') return '';
  return `<div class="alternative-links"><a href="${htmlEscape(source)}" target="_blank" rel="noopener noreferrer">Open the original <span aria-hidden="true">↗</span></a><a href="https://web.archive.org/web/*/${htmlEscape(source)}" target="_blank" rel="noopener noreferrer">Look in the Wayback Machine <span aria-hidden="true">↗</span></a><a href="https://archive.today/${htmlEscape(source)}" target="_blank" rel="noopener noreferrer">Look on archive.today <span aria-hidden="true">↗</span></a></div>`;
}

export function renderHome(appName = 'newz.rip'): string {
  return layout('Read. Keep. Revisit.', `<main id="main" class="home-main"><div class="edition-line"><span>Read. Keep. Revisit.</span><span>Independent of the noise.</span></div>
<section class="hero"><div class="hero-copy"><p class="eyebrow">The reading room</p><h1>The story,<br>minus the noise.</h1><p class="hero-description">A clean page for the news you want to read. Save an edition, keep the link, and come back whenever you like.</p></div><div class="hero-note"><span class="note-number" aria-hidden="true">01</span><p>Less clutter.<br>More context.<br>Your own archive.</p><div class="note-rule"></div><span>Make room for the story.</span></div></section>
<section class="capture-section" aria-labelledby="capture-title"><h2 id="capture-title">Start with a link.</h2><form action="/read" method="get" class="capture-form" data-capture-form><label class="sr-only" for="article-url">News article URL</label><div class="url-row"><input id="article-url" name="url" type="url" required placeholder="https://… / a story worth keeping" autocomplete="url" inputmode="url"><button class="button primary" type="submit">Read &amp; save <span aria-hidden="true">→</span></button></div>${tokenField()}<p class="capture-hint">News articles work best. Available content varies by publisher.</p></form>
<details class="import-section"><summary>Have a saved HTML page? Add it to your archive.</summary><form class="import-form" data-import-form><label>Original article URL<input name="url" type="url" required placeholder="https://example.com/article" autocomplete="url"></label><label>Saved page<input name="file" type="file" accept=".html,.htm,text/html,text/plain" required></label><p class="field-hint">Choose an HTML file up to 2 MB. Scripts and other active content are removed.</p><button class="button secondary" type="submit">Save this page <span aria-hidden="true">→</span></button><p class="form-error" role="alert" data-import-error hidden></p></form></details></section>
<section class="feature-grid" aria-label="How it works"><div><span class="eyebrow">Read</span><h2>Just the article.</h2><p>Comfortable type, a little breathing room, and controls to make the page feel like yours.</p></div><div><span class="eyebrow">Keep</span><h2>An edition to return to.</h2><p>Every saved version has its own link. Download a copy, or see how a story changes over time.</p></div><div><span class="eyebrow">Revisit</span><h2>A growing reading room.</h2><p>Find a story in your archive, follow its original source, and save a fresh edition when it changes.</p></div></section>
<section class="quick-tip"><span class="eyebrow">A small shortcut</span><p>Put <code>${htmlEscape(appName)}/</code> in front of an article’s full URL to open it here.</p><code class="shortcut-example">${htmlEscape(appName)}/https://example.com/article</code><p class="field-hint">Or drag <a href="#" data-bookmarklet title="Drag to your bookmarks bar">Read with ${htmlEscape(appName)}</a> to your bookmarks bar.</p></section></main>`, appName);
}

export function renderLoading(url: string, appName = 'newz.rip'): string {
  return layout('Opening your article', `<main id="main" class="status-main"><section class="capture-status" data-capture-status data-url="${htmlEscape(url)}"><p class="eyebrow">A moment for the story</p><h1>Making room<br>for your article.</h1><p class="status-url">${htmlEscape(url)}</p><div class="loading-line" aria-hidden="true"><span></span></div><p class="loading-message" role="status" aria-live="polite" data-loading-message>Opening the article and checking for a readable copy…</p><p class="field-hint">Some publishers take a little longer. This page will open your saved edition when it’s ready.</p>${tokenField()}<div class="capture-failure" data-capture-error hidden><h2>We couldn’t save this article.</h2><p role="alert" data-error-message></p><button class="button primary" type="button" data-retry>Try again <span aria-hidden="true">→</span></button>${alternatives(url)}</div><noscript><p class="form-error">JavaScript is needed to save an article. Enable it, then reload this page.</p>${alternatives(url)}</noscript></section></main>`, appName);
}

function snapshotCard(snapshot: Snapshot): string {
  return `<article class="archive-card"><div class="card-meta"><span>${htmlEscape(snapshot.siteName)}</span><time datetime="${htmlEscape(snapshot.capturedAt)}">${htmlEscape(formatDate(snapshot.capturedAt))}</time></div><h2><a href="/s/${encodeURIComponent(snapshot.id)}">${htmlEscape(snapshot.title)}</a></h2><div class="card-bottom"><span>${snapshot.wordCount.toLocaleString('en')} words${snapshot.quality === 'partial' ? ' · Partial copy' : ''}</span><span aria-hidden="true">↗</span></div></article>`;
}

export function renderArchive(snapshots: Snapshot[], q: string, page: number, hasMore: boolean, appName = 'newz.rip'): string {
  const pageUrl = (value: number) => `/archive?q=${encodeURIComponent(q)}&page=${value}`;
  return layout('The archive', `<main id="main" class="archive-main"><div class="page-intro"><p class="eyebrow">The reading room</p><h1>The archive.</h1><p>Stories worth keeping. Editions worth revisiting.</p></div><form class="archive-search" action="/archive" method="get"><label class="sr-only" for="archive-query">Search saved articles</label><input id="archive-query" name="q" type="search" placeholder="Search a title, publisher, or URL" value="${htmlEscape(q)}"><button class="button secondary" type="submit">Search <span aria-hidden="true">→</span></button></form>
${q ? `<div class="search-caption"><p>Results for <strong>${htmlEscape(q)}</strong></p><a href="/archive">Clear search</a></div>` : ''}
${snapshots.length ? `<div class="archive-grid">${snapshots.map(snapshotCard).join('')}</div>` : `<section class="empty-state"><span aria-hidden="true">✳</span><h2>${q ? 'No matching stories yet.' : 'The first story is yours.'}</h2><p>${q ? 'Try another title, publisher, or a shorter URL.' : 'Save an article and its edition will appear here.'}</p><a class="button primary" href="/">${q ? 'Save a story' : 'Start with a link'} <span aria-hidden="true">→</span></a></section>`}
${page > 1 || hasMore ? `<nav class="pagination" aria-label="Archive pages">${page > 1 ? `<a class="button secondary" href="${htmlEscape(pageUrl(page - 1))}">← Newer editions</a>` : '<span></span>'}<span>Page ${Math.max(1, Math.floor(page))}</span>${hasMore ? `<a class="button secondary" href="${htmlEscape(pageUrl(page + 1))}">Older editions →</a>` : '<span></span>'}</nav>` : ''}</main>`, appName);
}

export function renderSnapshot(stored: StoredCapture, history: Snapshot[], appName = 'newz.rip'): string {
  const { snapshot, article } = stored;
  const downloadRoot = `/s/${encodeURIComponent(snapshot.id)}/download`;
  const warnings = [...new Set(article.warnings)].filter(Boolean);
  const currentIsPresent = history.some((edition) => edition.id === snapshot.id);
  const editions = currentIsPresent ? history : [snapshot, ...history];
  return layout(article.title, `<main id="main" class="reader-main"><div class="reader-toolbar" aria-label="Article tools"><a class="source-link" href="${htmlEscape(safeHttpUrl(article.canonicalUrl || article.url))}" target="_blank" rel="noopener noreferrer">Original source <span aria-hidden="true">↗</span></a><div class="reader-tools"><div class="font-controls" aria-label="Reading text size"><button type="button" data-font-smaller aria-label="Decrease text size">A−</button><button type="button" data-font-larger aria-label="Increase text size">A+</button></div><button class="tool-button" type="button" data-copy-link>Copy link</button><details class="download-menu"><summary>Download <span aria-hidden="true">↓</span></summary><div><a href="${downloadRoot}?format=html">Web page (.html)</a><a href="${downloadRoot}?format=md">Markdown (.md)</a><a href="${downloadRoot}?format=txt">Plain text (.txt)</a><a href="${downloadRoot}?format=json">Article data (.json)</a></div></details></div></div>
<article class="reading-article"><header class="article-header"><a class="eyebrow publication" href="${htmlEscape(safeHttpUrl(article.canonicalUrl || article.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(article.siteName)}</a><h1>${htmlEscape(article.title)}</h1>${article.excerpt ? `<p class="article-deck">${htmlEscape(article.excerpt)}</p>` : ''}<div class="article-byline">${article.byline ? `<span>${htmlEscape(article.byline)}</span>` : ''}${article.publishedAt ? `<time datetime="${htmlEscape(article.publishedAt)}">${htmlEscape(formatDate(article.publishedAt))}</time>` : ''}<span>${article.readingMinutes} min read</span></div></header>
${article.quality === 'partial' || warnings.length ? `<aside class="article-warning" aria-label="About this copy"><strong>${article.quality === 'partial' ? 'This copy may be incomplete.' : 'A note about this copy.'}</strong>${warnings.length ? `<ul>${warnings.map((warning) => `<li>${htmlEscape(warning)}</li>`).join('')}</ul>` : '<p>Some of the article may not have been available. Check the original source for the complete story.</p>'}</aside>` : ''}
<div class="article-content">${article.content}</div></article>
<section class="edition-panel" aria-labelledby="edition-title"><div class="edition-heading"><div><p class="eyebrow">Filed for later</p><h2 id="edition-title">A saved edition.</h2></div><form action="/read" method="get"><input type="hidden" name="url" value="${htmlEscape(article.url)}"><input type="hidden" name="refresh" value="1"><button class="button secondary" type="submit">Save a fresh edition <span aria-hidden="true">↗</span></button></form></div><p>Saved <time datetime="${htmlEscape(snapshot.capturedAt)}">${htmlEscape(formatTime(snapshot.capturedAt))}</time>. This link will always show this edition.</p><div class="edition-link"><label class="sr-only" for="saved-link">Link to this edition</label><input id="saved-link" data-snapshot-link readonly value="/s/${htmlEscape(snapshot.id)}"><button class="tool-button" type="button" data-copy-link>Copy link</button></div>
${editions.length > 1 ? `<details class="edition-history"><summary>${editions.length} saved editions of this story</summary><ol>${editions.map((edition) => `<li>${edition.id === snapshot.id ? `<span aria-current="page">${htmlEscape(formatTime(edition.capturedAt))}<em>Reading this edition</em></span>` : `<a href="/s/${encodeURIComponent(edition.id)}">${htmlEscape(formatTime(edition.capturedAt))}</a>`}<span>${edition.wordCount.toLocaleString('en')} words${edition.quality === 'partial' ? ' · Partial' : ''}</span></li>`).join('')}</ol></details>` : ''}
<p class="edition-source">From <a href="${htmlEscape(safeHttpUrl(article.url))}" target="_blank" rel="noopener noreferrer">${htmlEscape(article.siteName)} <span aria-hidden="true">↗</span></a>. Reading copies may differ from the publisher’s current page.</p></section></main>`, appName, { reader: true, description: article.excerpt });
}

export function renderError(message: string, status = 500, url = '', appName = 'newz.rip'): string {
  return layout('A pause in the reading room', `<main id="main" class="status-main"><section class="error-page"><p class="eyebrow">${status === 404 ? 'Page not found' : 'A pause in the reading room'}</p><h1>${status === 404 ? 'This edition<br>isn’t here.' : 'Something got<br>in the way.'}</h1><p class="error-description">${htmlEscape(message)}</p><a class="button primary" href="/">Try another story <span aria-hidden="true">→</span></a>${alternatives(url)}</section></main>`, appName);
}

export function renderNotFound(appName = 'newz.rip'): string {
  return renderError('The saved article or page you’re looking for couldn’t be found. It may have been removed, or the link may be incomplete.', 404, '', appName);
}
