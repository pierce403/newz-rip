# newz.rip

A TypeScript news reader and versioned article archive for **Cloudflare Workers + D1 + R2**. Inspired by [13ft](https://github.com/wasi-master/13ft), independently implemented with persistent snapshots, an article reader, and layered extraction.

Paste an article URL, or visit `https://YOUR-HOST/https://publisher.example.com/article`. The app finds the readable content it can fetch, saves a sanitized edition, and gives it an immutable `/s/<id>` link. Older editions remain available when the article changes.

## Included

- Googlebot, standard-browser and mobile fetch profiles; publisher-advertised AMP discovery; Internet Archive fallback.
- Optional Cloudflare Browser Rendering for JavaScript pages, with session guardrails and public-destination validation.
- Mozilla Readability, JSON-LD article bodies, Next.js/Nuxt/Arc state, and **45 publisher layout profiles**.
- Clean responsive reader, light/dark themes, font controls, print layout, source links, partial-content warnings and a bookmarklet.
- D1 metadata/full-text search and R2 snapshot payloads. SHA-256 content identity and duplicate detection; refreshed content creates a new version.
- Capture source HTML preserved as data, never executed. HTML, JSON, Markdown and plain-text downloads. HTML downloads embed preserved images.
- Up to four raster images saved per capture, with MIME/signature validation and strict size/time limits. Remaining images retain publisher URLs and a warning.
- Saved HTML imports (2 MiB), browser share target, capture access token, administrator deletion, rate limiting, size limits and strict security headers.
- Reproducible news compatibility corpus, security/extraction fixtures, real Workers/D1/R2 integration tests and GitHub Actions.

This archives **article content**, not an executable replica of the original site. It does not possess a publisher's missing server-side article body. A crawler user agent does not defeat verified-bot checks, login requirements, strong paywalls, or CAPTCHAs. It does not use your subscription cookies. Encrypted article bodies are rejected; teasers are marked partial. See [measured compatibility](docs/COMPATIBILITY.md), [security boundaries](docs/SECURITY.md), and [upstream differences](docs/UPSTREAM.md).

## Run locally

Node.js 22 or newer is required.

```sh
npm ci
npm run db:local
npm run dev
```

Open the URL printed by Wrangler. Local D1 and R2 persist under `.wrangler/state`. The placeholder D1 UUID is intentional for local development; production deploy refuses it. Optional local secrets go in ignored `.dev.vars`.

```sh
npm run check
npm test
npm run build             # production bundle dry run; no publication
npm run compat -- --no-wayback
npm run compat -- --base https://YOUR-HOST
```

Compatibility `full_candidate` is an extraction heuristic, not proof that a subscription-only article is complete. Test the deployed hostname to measure Cloudflare edge behavior; local tests use this machine's network identity. The corpus includes wrong-page/title checks, word counts, strategies and failures without publishing article bodies.

## Deploy on Cloudflare

Create an account with Workers, D1 and R2 enabled. R2 may require account billing activation. Log in with `npx wrangler login` for Wrangler, or provide `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` through your shell's secret environment. The setup script uses these environment variables; it never saves the token.

The setup token needs account-level **D1 Edit** and **Workers R2 Storage Edit**. Wrangler deployment additionally needs **Workers Scripts Edit** and account read access. Add permissions for custom domains only if configuring one. Keep the account ID and token out of shell command arguments and Git.

```sh
npm run setup:cloudflare   # finds or creates named D1/R2; writes only non-secret IDs
npm run db:remote         # applies archive schema to the remote D1 database
npm run deploy            # builds browser assets and deploys the Worker
```

Alternatively create resources with `npx wrangler d1 create newz-rip` and `npx wrangler r2 bucket create newz-rip-archive`, then copy the database UUID into `wrangler.jsonc`. The setup command preserves existing resources and never deletes or replaces data. Resource provisioning is an explicit command, not an application startup side effect.

Check `https://YOUR-HOST/api/health`. Add a Cloudflare custom domain by appending this to `wrangler.jsonc` when the zone is in your account:

```json
"routes": [{ "pattern": "newz.rip", "custom_domain": true }]
```

The included **Deploy Cloudflare** workflow is manually triggered. Configure repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`; it validates the code, provisions existing/named resources, applies migrations and deploys. Ordinary pushes run validation only.

## Optional browser fallback

Add this binding to `wrangler.jsonc`:

```json
"browser": { "binding": "BROWSER" }
```

Set `vars.ALLOW_BROWSER_RENDERING` to `"true"`. No REST API token is needed. It uses `@cloudflare/puppeteer` and a disposable browser, bounded by 20 seconds, 48 intercepted requests and 6 MiB returned HTML. Browser Rendering has separate account availability/usage costs.

Session guardrails allow the article's exact hostname, its apex/`www` aliases, and Cloudflare's `common-cdns` domain set. If a publisher needs another API/CDN host, add exact comma-separated public hostnames to `BROWSER_ALLOWED_HOSTS`. Every intercepted destination gets URL and public DNS checks. Browser fallback is disabled by default; mocked tests verify its controls, but a real remote browser session was not available during development. Browser Rendering remains identifiable as a bot.

## Access and operations

`ARCHIVE_PUBLIC="true"` is the default: anyone with a snapshot link can read saved editions. Unauthenticated captures are permitted by default and limited to 10 attempts per minute per connecting IP. For a public deployment, add a `CAPTURE_TOKEN` secret to restrict saving. Enter it in the UI's access-key field; it stays in tab session storage and is sent as an Authorization header, never as a query parameter.

```sh
npx wrangler secret put CAPTURE_TOKEN
npx wrangler secret put ADMIN_TOKEN
```

`ADMIN_TOKEN` authorizes deletion. With `ARCHIVE_PUBLIC="false"`, archive reads also need `ADMIN_TOKEN` (or `CAPTURE_TOKEN` when no administrator token is set); the same private-archive token is required for captures and imports because they can return existing editions. This mode is suited to API use. For private **browser** access, keep `ARCHIVE_PUBLIC="true"` and protect the entire hostname with Cloudflare Access. The application does not implement user accounts or verify Access JWTs itself; require Access at the platform boundary.

`ARCHIVE_IMAGES="false"` disables image preservation. Some external images may still contact publishers when viewed; all use no-referrer. Content is not automatically submitted to third-party archives. `ALLOW_WAYBACK="false"` disables existing Internet Archive lookup. Failed captures offer external archive links for the reader to open.

Delete a snapshot using an authenticated `DELETE /api/snapshots/<id>` request. That removes its D1/FTS entries and R2 payload/media. Failed R2 deletions retain a retry record; repeat the same DELETE request to finish cleanup. Use Cloudflare dashboard rules for stronger rate limits and abuse controls. Do not apply lifecycle expiration to the R2 bucket if permanent links must remain valid. Back up/export both D1 and R2; JSON downloads contain sanitized article data and provenance; original source HTML stays in the private R2 bucket and is excluded from public exports. Embedded-image HTML is a portable reader copy. Keep the R2 bucket private.

A repeat capture is cached for one hour unless `refresh:true` is sent. Identical extracted content returns the existing edition and original capture timestamp. The hash covers capture provenance, title, author, publication date and sanitized article HTML; original JavaScript/layout-only changes do not create a new edition. Concurrent duplicate captures are reconciled through a D1 unique constraint. Imported editions never satisfy the live-fetch cache, and cross-origin canonical metadata cannot claim another publisher URL.

## API

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/capture` | `{ "url": "https://...", "refresh": false }`; fetch and save |
| POST | `/api/import` | `{ "url": "https://...", "html": "..." }`; sanitize and save uploaded HTML |
| GET | `/api/snapshots?q=term&page=1` | Search saved titles, publishers, URLs and article text |
| GET | `/api/snapshots?url=https%3A%2F%2F...` | URL history |
| GET | `/api/snapshots/<id>` | Snapshot metadata, article, attempt provenance |
| GET | `/s/<id>` | Reader and history |
| GET | `/s/<id>/download?format=html\|json\|md\|txt` | Portable export |
| DELETE | `/api/snapshots/<id>` | Administrator-only deletion |
| GET | `/api/health` | Database readiness and configured capability flags |

Capture/import responses contain `{ snapshot, article, attempts, cached }`. Errors contain `{ error, code, attempts? }`. Cross-origin writes, private/reserved URLs, unsupported ports, credentials, oversized inputs, unsafe redirects and non-HTML targets are rejected. Every fetch is anonymous and bounded. DNS rebinding remains a documented residual because Workers/Browser Rendering do not expose connection IP pinning.

## Architecture and verification

`src/fetcher.ts` handles bounded source attempts; `src/extract.ts` scores article candidates; `src/sanitize.ts` creates fresh allowlisted HTML; `src/browser.ts` is optional rendering. `src/storage.ts` owns immutable editions, D1 search and R2 records; `src/images.ts` captures bounded raster assets. `src/index.ts` routes the API and server-rendered reader, with security headers and authorization in `src/security.ts`. Browser enhancements are TypeScript in `web/app.ts`.

Tests include real workerd requests, D1 migrations/full-text search, R2 persistence, duplicate/version behavior, exports, token and deletion controls, rate limits and unsafe input rejection. No visual browser QA or live Cloudflare browser session was available. The bundled Worker is validated with Wrangler's production dry run. See the committed compatibility result JSON for dated evidence.

MIT licensed. 13ft is MIT licensed; this implementation uses independently authored code and does not copy its Python or visual assets. Mozilla Readability and linkedom retain their respective package licenses. Archived articles remain their publishers' content.
