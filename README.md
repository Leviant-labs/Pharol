# Pharol

A privacy-focused metasearch engine: fan out one query to ~40 independent
sources, fuse the results with reciprocal-rank fusion, and render them without
any server-side persistence of what you searched.

Pharol is a Next.js App Router application with its own ranking layer and a
self-hosted MCP server. Its Google, Bing and DuckDuckGo web adapters adapt
SearXNG request and parsing logic directly into TypeScript. No separate
SearXNG service, Python runtime or `engines.yml` is required.

## What it does

- **Unified web search** across keyless providers (Tavily, Firecrawl, FreeSerp,
  TinyFish, Marginalia, Wikipedia), HTML SERPs (Google, Bing, DuckDuckGo),
  and optional keyed providers.
- **Vertical modes**: web, images, videos, news, code, science. Each vertical
  pulls from sources that actually have that kind of data (GitHub/npm/crates/PyPI
  for code; arXiv/OpenAlex/CrossRef/Europe PMC/PubMed for papers).
- **Result fusion**: RRF over per-engine rank positions, with a consensus bonus
  when independent engines return the same normalized URL, plus recency, lexical,
  regional-TLD, citation and repository-star boosts. Duplicate hosts are damped
  so one site cannot flood the top of the page.
- **Query syntax**: `site:`, `filetype:`, `"exact phrases"`, `-exclusions`,
  `intitle:`, time ranges, and bangs (`!gh`, `!docs`, `!paper`, `!arxiv`,
  `!dataset`, `!news`, `!img`, `!vid`, `!wiki`, `!pkg`, `!so`, `!hn`,
  `!deepwiki`).
- **Instant answers** computed locally: arithmetic, unit conversion, time zones,
  color conversion, developer utilities, without a search request.
- **Reader mode**: server-side extraction with per-source handlers (Wikipedia,
  arXiv, GitHub, DeepWiki) and fallbacks for the rest.
- **Local-first state**: history, bookmarks, theme, region and engine preferences
  live in `localStorage`. Optional provider keys use an authenticated encrypted,
  HttpOnly cookie with an eight-hour expiry. No database is required.
- **MCP server** at `/api/mcp` exposing `web_search`, `news_search`,
  `academic_search`, `read_webpage`, `suggest_queries`, `get_weather`, plus six
  Paper Search/OpenAlex tools described below.
- **OpenSearch** descriptor at `/opensearch.xml` for browser search-bar
  integration.

## Architecture

```
app/page.tsx                  single-page shell, vertical routing
components/                   one view per vertical + reader/privacy modals
app/api/search/route.ts       entry point; parses params, extracts user keys
app/api/search/stream/route.ts incremental result batches
lib/server-search.ts          runMetasearch(): engine fan-out, health, fusion
lib/web-engines.ts            SearXNG-derived Google/Bing/DDG web adapters
lib/browser-transport.ts      in-process TLS/HTTP browser impersonation
lib/search-engine.ts          query parsing, ranking, HTML/markdown extraction
lib/server-cache.ts           in-process LRU + per-engine cooldown
lib/local-storage.ts          browser persistence (history and preferences)
lib/provider-credentials.ts   encrypted per-user provider cookies
lib/openalex.ts               scoped OpenAlex cache, quotas and metadata
lib/paper-tools.ts            integrated Paper Search workflows
lib/instant-tools.ts          deterministic instant answers
app/api/answer/route.ts       optional Gemini synthesis over retrieved sources
```

Every engine is wrapped by `trackEngine()`, which records status, item count and
latency into an `engineHealth` array that the UI renders as a per-engine strip.
Timeouts are 3.5–4s per engine; a `429`/`402` puts that engine into a
three-minute cooldown instead of retrying it for every query.

Search responses are cached in process memory (3 min, 100 entries) and that
cache is bypassed entirely when the caller supplies their own API keys, so
key-scoped results are never served to another caller.

## AI answers (optional)

`/api/answer` is **prompt-grounded, not tool-grounded**: the browser posts the
top 8 results it already retrieved, the server assigns them citation slots
`[1]…[n]`, enriches the top two non-Wikipedia URLs with `r.jina.ai` inside a
1.4 s budget, and asks the model to return JSON
`{ summary, keyPoints, citedIndices }` constrained by `responseSchema`. Gemini's
own search/grounding tool is never called, so "grounded" here means *constrained
to the supplied snippets and excerpts*, not *verified against Google*.

```ts
model: 'gemini-4-hydrogen'                 // hardcoded, no env override
thinkingConfig: { thinkingLevel: LOW }
responseMimeType: 'application/json'       // schema-enforced
```

- With no `GEMINI_API_KEY`, answers degrade to a deterministic
  `instant-synthesis` path: lead sentence from the top snippet plus up to three
  cited key points, assembled in code. The UI labels which one it got.
- Answers are fetched automatically after every search that returns results,
  and again on follow-up questions (last 4 turns of history are included in the
  prompt).
- Follow-ups reuse the same model and a `{ answer, citedIndices }` schema.

## Running it

Requires Node 20+ (Node 22 or 24 recommended). Browser impersonation uses a
prebuilt native `impit` module; keep npm optional dependencies enabled. Linux
(glibc/musl), macOS and Windows x64/arm64 builds are supported. The Linux x64
binary adds approximately 11 MB; no browser installation or helper service is
required.

```bash
npm install
npm run dev      # http://localhost:3000
```

Use `npm ci` for subsequent installs from `package-lock.json`.

`GEMINI_API_KEY` is optional end-to-end. It enables `/api/answer` (synthesis
with inline citations); search, reader mode, verticals and MCP all work without
it.

### Optional provider keys

All of these are optional. Unset means the provider runs in its keyless public
mode where one exists.

```bash
EXA_API_KEY=          # Exa MCP: keyless baseline, key raises limits
PARALLEL_API_KEY=     # Parallel MCP
TAVILY_API_KEY=       # Tavily: keyless via X-Tavily-Access-Mode
FIRECRAWL_API_KEY=    # Firecrawl: /v2/search is keyless
KEENABLE_API_KEY=     # Keenable MCP
TINYFISH_API_KEY=     # TinyFish web search
CONTEXT7_API_KEY=
SEMANTIC_SCHOLAR_API_KEY=
CORE_API_KEY=
OPENALEX_API_KEY=
GITHUB_TOKEN=          # raises GitHub search rate limit
```

### Secure user-supplied keys

Users add their own keys in **Privacy & Preferences → Keys & Hosts**, including
an OpenAlex field with a link to its free-key settings page. Pharol does not
register accounts or request verification emails on their behalf. Empty fields
preserve saved keys; individual removal, replacement and removal of all keys
are available. Saved keys are never returned to the UI. Old plaintext
`pharol_user_provider_config` localStorage entries are deleted on app startup;
users must re-enter them.

The administrator configures one server-side encryption secret, shared across
all replicas, before enabling saves:

```bash
# Generate 32 random bytes and put the resulting hex value in the deployment's
# secret manager as PHAROL_CREDENTIAL_SECRET. Do not commit it.
openssl rand -hex 32
```

`PHAROL_CREDENTIAL_SECRET` must contain 64 hex characters. For local development,
save it in the gitignored `.env.local`. Deployments should provide their own
secret through runtime environment variables. The secure
settings endpoint refuses saves when the secret is absent. Set
`PHAROL_ORIGIN=https://your-pharol-host.example` when a reverse proxy exposes
HTTPS but forwards internal HTTP; it fixes the expected origin for CSRF checks.
Use HTTPS for hosted installations. Localhost HTTP is supported for development.

Keys are AES-256-GCM encrypted in a host-only, HttpOnly, SameSite=Strict cookie,
expiring after eight hours, and using the Secure, host-only `__Host-` cookie
prefix in production (Path=/, no Domain attribute).
Saves require same-origin JSON requests with bounded sizes. Status responses
contain booleans only and use `private, no-store`. Keys are decrypted server-side
for the requesting browser's provider calls. They are not stored in a database,
shared search cache or browser JavaScript storage. Rotating the encryption secret
invalidates existing saved cookies; removing a cookie does not rotate the upstream
provider's actual key. The deployment operator must be trusted with provider keys.

External MCP clients can use explicit `x-pharol-*-key` headers (see
`lib/user-provider-headers.ts`). They do not inherit another browser's cookies.

### Integrated Paper Search

The existing `/api/mcp` exposes these additional in-process TypeScript tools:

| Tool | Behavior |
| --- | --- |
| `search_papers` | Multi-source paper search and DOI/URL deduplication; `fast` default uses OpenAlex, Crossref, arXiv, PubMed, Europe PMC; `fastest` uses OpenAlex/Crossref; `all` uses Pharol's eleven supported academic sources. |
| `get_paper` | Exact DOI/OpenAlex-ID lookup, authors, abstract, references and separate OA landing/PDF links. |
| `get_citing_papers` | One-hop papers citing a work, sorted by citation count. |
| `get_referenced_papers` | One-hop references, sorted by citation count. |
| `get_paper_fulltext` | Text from indexed PMC XML or modern arXiv HTML, up to 4 MB retrieved and 50,000 characters returned. Explicitly reports unavailable text; does not download arbitrary publisher PDFs. |
| `openalex_status` | Credential configuration status and current OpenAlex quota without revealing keys. |

No additional MCP server, Python runtime, database or dependency is required.
This adapts Paper Search workflows rather than every upstream connector; see
`third_party/paper-search/NOTICE.md` for the pinned MIT-licensed sources and scope.

OpenAlex uses bearer headers, a three-minute credential-scoped metadata cache,
in-flight deduplication, bounded concurrency and conservative 10/s anonymous or
30/s keyed rate caps. HTTP 429 cooldowns honor Retry-After and quota-reset headers
per credential. Search avoids extra concept-overview requests. Relationship tools
accept only DOI/OpenAlex IDs, fetch at most five pages/one graph hop, and report
truncation and skipped records. Provider failures remain explicit. Cached metadata
and limit state are per-process; multiple replicas still share upstream quotas.


## Tests

`lib/search-engine.test.ts`, `lib/mcp-tools.test.ts` and
`lib/web-engines.test.ts`, `lib/browser-transport.test.ts`,
`lib/provider-credentials.test.ts` and `lib/paper-tools.test.ts` use `node:test` and
import TypeScript directly, so they run through `tsx`:

```bash
npm test
```

The suites cover query syntax parsing, URL normalization, rank fusion and
deduplication, OpenAlex abstract reconstruction, markdown-to-reader conversion,
HTML entity decoding, access classification, MCP JSON-RPC framing, and the MCP
tool schema.

## Known limitations

- **HTML SERPs remain subject to upstream blocking.** Native adapters now use
  SearXNG-derived Google request parameters and selectors, Bing HTML instead of
  RSS, and DuckDuckGo form POSTs with cached VQD pagination tokens. CAPTCHA
  pages and HTTP 403/429 responses are reported as cooldowns rather than empty
  successes. This is a pinned adaptation, not an automatically updated copy.
  Google and Bing now use Chrome 142 TLS/HTTP impersonation and DDG uses
  Firefox 144 through an in-process native `impit` client. User-Agent headers
  match their selected fingerprint. Certificate verification stays enabled;
  connections are pooled but cookies are not stored across requests. This
  does not execute JavaScript or solve CAPTCHAs. Controlled live checks with
  the same query and egress returned Bing/DDG results with both transports;
  Google returned HTTP 403 with both. See `third_party/searxng/NOTICE.md`.
- **Bing Web has no paging or time filter** in the referenced SearXNG adapter;
  Pharol skips it for later pages and time-filtered requests rather than
  returning repeated or unfiltered results. Google uses `start`/`tbs`; DDG
  uses time filters and a query-scoped pagination token. Tokens are stored only
  in bounded process memory for up to one hour. A direct page-2 request first
  fetches page 1 when its token is absent.
- **Hosts requiring an outbound proxy** should configure their runtime's proxy
  transport. With Node 24, `NODE_USE_ENV_PROXY=1 npm run dev` enables the
  standard `HTTP_PROXY`/`HTTPS_PROXY` environment variables for native fetch.
  The impersonating transport uses its native client's environment proxy
  support, including `NO_PROXY`. It adds no proxy provider or IP rotation.
- **Ordinary-fetch comparison:** set `PHAROL_WEB_TRANSPORT=fetch` before starting
  the app to disable impersonation explicitly. The default is `impersonate`.
  There is no silent fallback when the native client fails. The browser
  transport currently serves Google/Bing/DDG; other adapters and reader mode
  keep their existing transport. Next.js standalone output includes the native
  dependency; it requires a Node server, not an Edge runtime.
- **Pagination is partial.** Exa, Parallel, Tavily, Firecrawl and Keenable emit
  nothing past page 1, as does the science concept-overview task, so later pages
  are thinner than the first.
- **OpenAlex without a key is budget-shared.** The API serves keyless requests
  from one free daily allowance tied to the caller's IP ("$0.10 with everyone on
  your network's IP address"), so a busy host or shared NAT will start getting
  throttled. Set `OPENALEX_API_KEY` for anything beyond light use.
- **Zero-result fallback is synthetic.** When a first-page web query returns
  nothing, Pharol injects two hand-built entries pointing at Wikipedia and
  GitHub search. They are navigational aids, not search hits, and are labeled
  with their engine.
- **`/api/reader` and `/api/mcp` are unauthenticated.** The reader fetches a
  caller-supplied URL. Before exposing this deployment publicly, add a host
  allowlist / private-range block to `app/api/reader/route.ts` and put auth or
  rate limiting in front of `/api/mcp`.
- **`/api/answer` sends the query, snippets and page excerpts to Gemini** when a
  key is configured, and fetches the top two result URLs through `r.jina.ai`
  first. Search itself does not require it.
- The in-memory result cache is per-process; multiple instances do not share it.

## License

The SearXNG-derived adapters are AGPL-3.0-or-later; attribution, pinned source
links and the license text are in `third_party/searxng/`. The Paper Search adaptations include their MIT attribution in
`third_party/paper-search/`. No project-wide license for the remaining code has
been declared.
