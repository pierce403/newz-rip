# Security boundaries

## Public article fetching

The URL validator permits HTTP and HTTPS on standard web ports and rejects
credentials, IP literals, single-label names, and local/reserved hostname suffixes.
WHATWG URL parsing normalizes alternate numeric IP spellings before validation.
Redirects are followed manually; every new destination receives the same URL and
DNS checks. Both A and AAAA answers must contain public addresses, and an answer
containing any private or reserved address fails closed. Fetches receive an abort
deadline and HTML is read incrementally with a 6 MiB limit.

**DNS validation does not pin the connection.** The DNS-over-HTTPS lookup and the
subsequent Worker fetch are separate operations. An attacker-controlled DNS name
can change answers between them, and the browser may resolve from a different
location. This is a DNS rebinding / time-of-check-to-time-of-use limitation, not a
guarantee that every network connection reaches the checked IP. For deployments
that need a strict SSRF boundary, accept only controlled publisher origins and
use infrastructure that enforces private-address rejection at connection time.
Do not attach private network/service routes to the rendering browser.

## Optional browser rendering

Browser rendering requires a Cloudflare `BROWSER` binding and
`ALLOW_BROWSER_RENDERING="true"`. It is disabled by default. The Workers binding
is used directly with `@cloudflare/puppeteer`; no browser REST API token is passed
to the page or required in application configuration.

Each capture launches a new disposable browser without saved login state or
publisher cookies. Publisher JavaScript executes in that remote browser so it can
hydrate an article. It receives no application bindings, admin/capture tokens,
R2/D1 credentials, or user-supplied JavaScript evaluation interface. The renderer
only reads the resulting page HTML. It does not solve CAPTCHAs, sign in, forge
subscription state, or automate consent/access-control interaction.

There are two layers of network controls:

- Cloudflare session guardrails allow only the original hostname, its exact
  `www`/apex aliases, and Cloudflare's `common-cdns` set. The guardrails apply to
  the session's HTTP/HTTPS traffic, including targets outside the main page.
- Main-page request interception validates every continued document, script,
  XHR, and fetch URL and its A/AAAA answers. DNS results are cached per hostname
  only for the duration of that capture. All redirect destinations are checked.
  Only GET/HEAD requests are continued. Nested documents, CSS, fonts, images,
  media, beacons, and other resource types are blocked. Service-worker caching is
  bypassed; dialogs are dismissed and popups are closed.

The capture has a 20-second deadline, at most 48 continued intercepted requests,
and a 6 MiB UTF-8 limit on the returned DOM HTML. An advertised oversized HTML
response is rejected as well. Interceptors check closure/deadline again after
async DNS validation before continuing a request. Pending DNS operations are
aborted and the browser is closed on success, failure, and timeout; a browser
launch completing after timeout is also closed.

These are application-level bounds, not a complete browser-wide byte or request
quota: a streamed browser response may be downloaded before its DOM size is
checked, and page request interception does not individually account for every
background target or protocol. Session guardrails restrict HTTP/HTTPS hostnames,
not IPs, methods, byte counts, or every possible browser protocol. Fresh sessions,
short lifetimes, and no private bindings reduce the impact, but do not replace
connection-level network isolation. DNS checks have the same non-pinning
limitation described above.

If a publisher needs a custom CDN or public API outside the default policy, add
its exact hostname to the comma-separated `BROWSER_ALLOWED_HOSTS` deployment
variable. Entries are public hostnames, not URLs or wildcard patterns; at most
45 additional hostnames are accepted. Allow only dependencies you have inspected.
Missing dependencies can produce a partial article or a failed browser attempt;
the pipeline can still use its non-browser strategies. Cloudflare maintains the
`common-cdns` set and can change it; deployments requiring a fixed policy should
replace that set with a reviewed explicit list in `src/browser.ts`.

## Archived article HTML

Extraction serializes HTML into a fresh element/attribute allowlist. Scripts,
inline event handlers, forms, frames, SVG, embedded objects, styles, and active URL
schemes are removed. Links and image references are resolved against the source
URL and common local/private literal targets are rejected. Publisher markup is
never trusted just because it came from a known domain.

Up to four raster article images are preserved in private R2 storage after public URL/DNS, MIME, signature and bounded-size checks. Unpreserved article images remain external references. Viewing them can contact the original
image/CDN host and disclose the reader's IP; `referrerpolicy="no-referrer"` avoids
sending the archive URL. Image hostname resolution in the reader's browser is not
covered by server-side DNS validation. A strict privacy or network-isolation
deployment should remove images or use a separately hardened image proxy.

## Authorization and provenance

Private archive mode requires the archive's master bearer token for reads,
captures and imports. Capture requests can return existing editions, so they
cannot use a weaker write-only token in private mode. Public mode may separately
restrict captures using CAPTURE_TOKEN. Administrator deletion always requires
ADMIN_TOKEN. Cross-origin writes are rejected; secrets never appear in URLs.

Imported snapshots have distinct provenance and do not satisfy the live-fetch
cache. Cross-origin canonical metadata is ignored for storage/cache identity;
only the requested hostname's exact www/apex alias is accepted. Imports are
explicitly disclosed to readers, rather than asserting direct publisher origin.

Original source HTML is retained only as data inside the private R2 snapshot.
Public API responses and JSON/HTML/text/Markdown exports omit raw source HTML,
which can contain publisher script state or account/session details in imported
pages. Keep the bucket private. Rendered reader content is always sanitized.

Deletion removes the searchable edition and retains a durable list of R2 objects
until deletion succeeds. Repeating the same authorized DELETE finishes a failed
cleanup. Capture storage failures also clean up already-preserved media.

## Dependency advisories

The October 11, 2026 `npm audit` reports seven high-severity package findings.
These are dependency-chain findings, not seven distinct vulnerabilities. The
development-only Miniflare dependency now matches Wrangler's
`5.20261006.1-alpha`, with patched `sharp` 0.35.5 and `undici` 7.29.1.

The remaining findings come through `@cloudflare/puppeteer` 1.4.0's Node browser
downloader dependencies: `@puppeteer/browsers`, `extract-zip`, and the
`proxy-agent` → `pac-proxy-agent` → `get-uri` → `basic-ftp` chain. They include
[ZIP symlink arbitrary-file writes](https://github.com/advisories/GHSA-7pqw-9j4j-h8q3)
and [FTP directory-listing CPU denial of service](https://github.com/advisories/GHSA-c475-qrg2-pj4r).

Inspection of the generated `dist/index.js` found none of those downloader
module paths or their ZIP extraction/FTP implementation identifiers. The
application uses Cloudflare's remote browser binding and accepts neither ZIP
archives nor FTP listings. This limits the observed runtime exposure; it does
not make the installed dependency tree vulnerability-free. Keep monitoring
upstream releases and run `npm audit` when updating dependencies. Do not apply
`npm audit fix --force` blindly: its proposed SDK downgrade changes compatibility
and has not been validated for this application.

## References

- [Cloudflare Browser Run Workers setup](https://developers.cloudflare.com/browser-run/get-started/)
- [Cloudflare session hostname guardrails](https://developers.cloudflare.com/browser-run/features/guardrails/)
- [Puppeteer request interception and asynchronous resolution](https://pptr.dev/guides/network-interception)
- [Cloudflare outbound Worker routing constraints](https://developers.cloudflare.com/browser-run/features/outbound-workers/)

The browser tests mock the binding and verify the interception, limits, cleanup,
and opt-in logic. They do not claim live browser compatibility or independent
validation of Cloudflare's network isolation.
