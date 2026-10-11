# Compatibility evidence

Compatibility depends on the article, publisher configuration, capture date, and request environment. A supported DOM layout is not evidence of full access to a publisher's subscription articles.

## Reproduce the matrix

The checked-in [corpus](../scripts/news-sites.json) contains 31 exact article URLs from major US, international, technology, science, and local publishers. URLs were discovered on publisher pages, in indexed search results, in publisher homepage HTML, in a cited bibliography, or from a supplied article link on 2026-10-11 UTC. They were not fabricated from URL templates. The `discovery`, `sourceUrl`, and `notes` fields distinguish an independently fetched article from a cited or advertised link that the research environment could not open.

```sh
npm run compat
npm run compat -- --publisher Guardian --limit 1
npm run compat -- --publisher CNN --merge
npm run compat -- --base https://your-worker.example --output docs/deployed-results.json
```

Direct mode invokes the production `fetchArticle` pipeline with URL and DNS validation enabled. It uses existing Wayback captures by default; `--no-wayback` disables this fallback only in direct mode. API mode uses the deployment's configuration and saves real snapshots through `POST /api/capture`. Set `CAPTURE_TOKEN` in the environment if the endpoint requires authorization; tokens are not written to results. `--timeout-ms` controls the request budget, and `--strict` returns a failing exit status unless all attempts produce `full_candidate`.

The runner processes requests serially, writes results after each article, and records attempt details, duration, title match, article word count, paragraph count, and extraction method. It does not store article body text in the matrix. The default result file is [compatibility-results.json](compatibility-results.json). `--merge` replaces selected entries in an existing report with matching mode, origin, and Wayback settings; each entry retains its own evaluation time.

| Outcome | Meaning |
| --- | --- |
| `full_candidate` | The extractor returned its `full` quality classification and the title matches the requested story. This is a candidate for manual completeness review. |
| `partial` | A matching article was recovered, but the extractor found indications of limited content. |
| `wrong_article` | Extracted headline fails the corpus match, suggesting a homepage, unrelated result, or bad redirect. |
| `blocked` | Capture failed because no usable body was provided, access was denied, or a challenge/rate limit was encountered. |
| `network_error` | DNS validation, transport, or timeout failed; this alone cannot distinguish publisher failure from test-environment restrictions. |
| `error` | Another API/configuration/runtime failure prevented evaluation. |

An HTTP 200 is insufficient: subscription prompts, CAPTCHA pages, and homepages can all return 200. Likewise, a long body can still contain a preview, recommendations, or missing paragraphs. No corpus entry has a licensed full-text reference to verify absolute completeness automatically. A `full_candidate` must not be advertised as a proven paywall bypass.

## Verified scope

The direct Node matrix completed on 2026-10-11 UTC with DNS validation and Wayback enabled, browser rendering disabled. All 31 attempts are recorded in the JSON report, including individual evaluation times and fallback details.

| Live outcome | Count | Publishers |
| --- | ---: | --- |
| Full candidate | 26 | Guardian, AP, Reuters, Washington Post, CBS, ABC, Axios, Al Jazeera, Ars Technica, The Verge, Wired, TechCrunch, The Register, 404 Media, ProPublica, Engadget, Independent, Atlantic, New Yorker, Vox, Business Insider, Scientific American, BBC, CNN, NPR, OregonLive |
| Partial | 2 | Financial Times (372 words), Wall Street Journal (197 words) |
| Blocked | 3 | Bloomberg, New York Times, The Economist |

OregonLive's sample succeeded through the mobile strategy after crawler and desktop requests returned HTTP 403. New York Times returned no readable body and its existing Wayback replay returned HTTP 429. The Economist returned HTTP 402; its archive lookup was unavailable. Wall Street Journal exposed encrypted content in structured data; this was rejected, leaving a readable preview. Counts describe these particular articles and requests, with no independent proof of completeness or publisher-wide support.

Direct Node results do not establish Cloudflare-origin success; run the same matrix with `--base` against the deployed Worker to evaluate that environment.

A minimal local `workerd` probe also exercised the production fetcher at compatibility date `2026-08-06`. It exposed an unsupported `redirect: 'error'` option in DNS/archive lookups, prompting a runtime fix. Raw outbound publisher HTTP then failed with local DNS-resolution errors in this environment. Local Workers integration tests cover archive storage and routes; live Cloudflare edge retrieval remains unverified until the deployed `--base` matrix runs. Local workerd does not use a Cloudflare edge IP.

Extractor tests cover synthetic publisher DOM, structured article bodies, embedded application state, sanitation, and quality/challenge decisions. Synthetic fixtures validate behavior against those layouts. They do not establish that a real publisher serves that layout or grants full article access today.

## Known boundaries

- Server-side hard walls may return only a preview. Newz.rip cannot reconstruct text the publisher did not send.
- Bot/WAF challenges may reject all user agents, including requests from Cloudflare. Optional browser rendering executes scripts but remains identifiable as automation.
- Existing Wayback captures may be missing, incomplete, or older than the live article. Their source is disclosed in attempt details and warnings; the local capture time must not be confused with the original archive time.
- Publisher-advertised AMP pages can help only when available and within the validated publisher host family. Arbitrary guessed AMP mutations are not attempted.
- BBC, CNN, and NPR were inaccessible through the research search service's robots policy but were reachable with direct HTTP in this session. Search-service restrictions are not app compatibility results.
- CNN's sampled desktop page was approximately 4.6 MB. Response-size bounds are deliberate; oversized pages are failures, not quietly truncated articles.
- New York Times and The Economist article URLs were confirmed through bibliography citations because their publisher entry points and RSS/sitemaps were unavailable. Their sampled captures failed; this does not establish that all their articles fail.
- Archive snapshots are reader captures, not full-page forensic/WARC captures. Remote images and linked documents can still change or disappear.

Inspect attempts and headline/content before using a capture as evidence. Re-run after fetcher/extractor changes; a successful old result is not a permanent promise of publisher support.
