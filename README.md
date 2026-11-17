# Pharol

A privacy-focused metasearch engine: fan out one query to ~40 independent
sources, fuse the results with reciprocal-rank fusion, and render them without
any server-side persistence of what you searched.

Pharol is **not** a SearXNG port. There is no Python and no `engines.yml`; it is a
Next.js App Router application with its own engine adapters, its own ranking
layer, and a self-hosted MCP server so agents can search through it.

## What it does

- **Unified web search** across keyless providers (Tavily, Firecrawl, FreeSerp,
  TinyFish, Marginalia, Wikipedia), scraped SERPs (DuckDuckGo HTML, Bing RSS),
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
- **Local-first state**: history, bookmarks, theme, region, engine preferences
  and user-supplied API keys live in `localStorage`. Nothing is written to a
  database.
- **MCP server** at `/api/mcp` exposing `web_search`, `news_search`,
  `academic_search`, `read_webpage`, `suggest_queries` and `get_weather`.
- **OpenSearch** descriptor at `/opensearch.xml` for browser search-bar
  integration.

## Architecture

```
app/page.tsx                  single-page shell, vertical routing
components/                   one view per vertical + reader/privacy modals
app/api/search/route.ts       entry point; parses params, extracts user keys
app/api/search/stream/route.ts incremental result batches
lib/server-search.ts          runMetasearch(): engine fan-out, health, fusion
lib/search-engine.ts          query parsing, ranking, HTML/markdown extraction
lib/server-cache.ts           in-process LRU + per-engine cooldown
lib/local-storage.ts          browser persistence (history, prefs, keys)
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

Requires Node 18.18+ (Node 20 or 22 recommended).

```bash
npm install
npm run dev      # http://localhost:3000
```

No lockfile is committed; the first `npm install` generates `package-lock.json`,
which should be committed afterwards to pin the tree.

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

Per-user keys can also be supplied at request time via `x-pharol-*-key` headers
(see `lib/user-provider-headers.ts`) so a deployment can serve users who bring
their own credentials without storing them.

## Tests

`lib/search-engine.test.ts` and `lib/mcp-tools.test.ts` use `node:test` and
import TypeScript directly, so they run through `tsx`:

```bash
npm test
```

The suites cover query syntax parsing, URL normalization, rank fusion and
deduplication, OpenAlex abstract reconstruction, markdown-to-reader conversion,
HTML entity decoding, access classification, MCP JSON-RPC framing, and the MCP
tool schema.

## Known limitations

- **Scraped SERPs are fragile.** DuckDuckGo's HTML endpoint answers datacenter
  IPs with an HTTP 202 anti-bot page, and Bing's `format=rss` frequently returns
  a single stale item. The engines report `empty` in the health strip rather
  than failing loudly. Keyless API providers carry most of the real web results.
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

No license file is included yet.
