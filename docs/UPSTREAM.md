# Upstream behavior and Cloudflare portability

Research date: 2026-10-11 UTC.

## 13ft

[13ft](https://github.com/wasi-master/13ft) is an MIT-licensed Python/Flask application. Its current [fetch implementation](https://github.com/wasi-master/13ft/blob/main/app/portable.py) uses these paths:

1. Non-Medium URLs receive an HTTP request using a Googlebot user agent.
2. Medium URLs start with two Freedium mirrors. Error and empty-content markers reject misses.
3. Empty responses, bot challenges, and upstream HTTP 401/403/407/429/5xx trigger archive fallbacks.
4. Internet Archive's availability API locates an existing snapshot; `id_` replay returns the archived HTML.
5. If Wayback fails, archive.ph, archive.today, archive.is, and archive.li are tried using their `/newest/` routes.
6. The returned whole page is cleaned and displayed. A five-minute in-memory cache avoids repeated work; it is not a persistent archive.

Upstream also has background threads, server-sent progress events, localization, and a bookmarklet. Its cleanup removes much of the publisher JavaScript; its fallback decision checks challenge signatures, not whether a matching article's complete body was recovered. Changing a user-agent string does not make a request originate from Google or grant access to content the server does not return.

newz.rip is a TypeScript implementation of the reader/capture concept, with separate extraction, sanitization, fetch, and storage layers. Its pipeline attempts crawler, ordinary desktop, publisher-advertised AMP, and mobile views, then an existing Wayback capture when enabled. It assesses the returned text instead of accepting a successful HTTP status alone. D1 indexes snapshots and R2 stores captured article data. It does not depend on archive.today as its archive backend, and does not call Freedium mirrors.

See the upstream [README](https://github.com/wasi-master/13ft/blob/main/README.md) and [MIT license](https://github.com/wasi-master/13ft/blob/main/LICENSE). No upstream Python implementation or assets were copied into this repository.

## Cloudflare rendering

Cloudflare's documentation now calls the product **Browser Run**. Its [content guide](https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/) shows `/accounts/{account_id}/browser-run/content`, while the [API reference](https://developers.cloudflare.com/api/resources/browser_rendering/subresources/content/methods/create/) still documents `/accounts/{account_id}/browser-rendering/content`. Check the active account/API version before implementing REST calls.

`/content` runs page JavaScript and returns rendered HTML. Its options include `gotoOptions`, `waitForSelector`, `rejectResourceTypes`, `rejectRequestPattern`, `allowResourceTypes`, and `allowRequestPattern`. The request-pattern options use regular expressions; reject rules take precedence. The field is **`rejectRequestPattern`**, not `blockRequestPattern`.

The reference exposes the final URL, origin status, and HTTP redirect chain in response metadata. That is evidence for diagnosing a result after rendering; it is not preventive validation of every destination. The docs reviewed do not establish a guarantee that arbitrary destinations, private-IP resolutions, and DNS rebinding are blocked by the REST endpoint. URL-pattern rules cannot check the IP behind a hostname.

The optional newz.rip browser binding uses a disposable anonymous Puppeteer session with request interception, URL/DNS checks, hostname guardrails, bounded time and requests, and blocked non-read methods/resources. Keep it opt-in and verify it on the deployed account. DNS preflight is not atomic with Chrome's resolution; guardrails reduce destinations but are not proof against DNS rebinding. An outbound validation proxy is the stronger architecture if untrusted hosts must be rendered.

Cloudflare's [FAQ](https://developers.cloudflare.com/browser-run/faq/) says rendering traffic is always recognizable as bot traffic and offers no per-request IP rotation. Its [guardrails guide](https://developers.cloudflare.com/browser-run/features/guardrails/) documents session-level hostname allowlists, a maintained common-CDN set, and blocking all HTTP(S) traffic with an empty allowlist. Rendering may help client-side layouts, but it is not a general solution to publisher bot protection or server-side subscription walls.
