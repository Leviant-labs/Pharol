import test from 'node:test';
import assert from 'node:assert/strict';
import { openAlexGet, normalizePaperIdentifier, mapOpenAlexWork } from './openalex';
import { runPaperTool } from './paper-tools';
import { POST as mcpPOST } from '../app/api/mcp/route';
import { NextRequest } from 'next/server';
import { PROVIDER_COOKIE, sealProviders } from './provider-credentials';
import { randomBytes } from 'node:crypto';

const work = (id = 'W100', extra = {}) => ({ id: `https://openalex.org/${id}`, title: 'Research paper', doi: 'https://doi.org/10.1234/paper', authorships: null, referenced_works: null, ...extra });

test('paper identifiers accept canonical DOI/IDs and reject ambiguous titles and foreign URLs', () => {
  assert.equal(normalizePaperIdentifier('https://doi.org/10.1234%2FPAPER'), 'doi:10.1234/paper');
  assert.equal(normalizePaperIdentifier('https://openalex.org/W100'), 'W100');
  for (const value of ['a paper title', 'https://evil.example/W100', 'https://openalex.org/W100?key=secret', 'https://user@openalex.org/W100']) assert.throws(() => normalizePaperIdentifier(value));
  const paper = mapOpenAlexWork(work('W100', { open_access: { is_oa: true, oa_url: 'https://repo.example/landing' } }))!;
  assert.equal(paper.pdfUrl, undefined); assert.equal(paper.openAccessUrl, 'https://repo.example/landing');
  assert.deepEqual(paper.references, []);
});

test('OpenAlex uses bearer headers, credential-scoped caching and identical in-flight request deduplication', async (t) => {
  const calls: { url: URL; key: string | null }[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL, init: RequestInit) => {
    const url = new URL(input); const key = new Headers(init.headers).get('authorization'); calls.push({ url, key });
    return Response.json({ resultFor: key });
  });
  const one = await Promise.all([openAlexGet('works', { search: 'cache-fixture' }, 'key-a'), openAlexGet('works', { search: 'cache-fixture' }, 'key-a')]);
  assert.equal(calls.length, 1); assert.equal(one[0].resultFor, 'Bearer key-a');
  await openAlexGet('works', { search: 'cache-fixture' }, 'key-a'); assert.equal(calls.length, 1);
  const two = await openAlexGet('works', { search: 'cache-fixture' }, 'key-b');
  assert.equal(two.resultFor, 'Bearer key-b'); assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !call.url.href.includes('key-a') && !call.url.searchParams.has('api_key')));
});

test('OpenAlex respects Retry-After per credential without blocking another user', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    calls++; return new Headers(init.headers).get('authorization') === 'Bearer limited'
      ? new Response('', { status: 429, headers: { 'Retry-After': '60' } }) : Response.json({ results: [] });
  });
  await assert.rejects(openAlexGet('works', { search: 'quota-fixture' }, 'limited'), /HTTP 429/);
  await assert.rejects(openAlexGet('works', { search: 'another-fixture' }, 'limited'), /cooling down/);
  assert.equal(calls, 1);
  await openAlexGet('works', { search: 'another-fixture' }, 'unlimited'); assert.equal(calls, 2);
});

test('one-hop relationships use correct directions, skip duplicates, and report bounded truncation', async (t) => {
  const filters: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname !== '/works') return Response.json(work('W200'));
    filters.push(url.searchParams.get('filter')!);
    return Response.json({ meta: { count: 50 }, results: [work('W201'), work('W201')] });
  });
  const cited: any = await runPaperTool('get_citing_papers', { identifier: 'W200', max_results: 3, max_pages: 1 }, { openAlexApiKey: 'relations' });
  assert.equal(filters[0], 'cites:W200'); assert.equal(cited.papers.length, 1);
  assert.equal(cited.truncated, true); assert.equal(cited.stop_reason, 'page_budget'); assert.equal(cited.skipped_results, 1);
  await runPaperTool('get_referenced_papers', { identifier: 'W200', max_pages: 1 }, { openAlexApiKey: 'relations' });
  assert.equal(filters[1], 'cited_by:W200');
});

test('paper lookup surfaces failures; full text does not fetch arbitrary metadata hosts', async (t) => {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input); requests.push(url);
    return Response.json(work('W300', { best_oa_location: { pdf_url: 'https://127.0.0.1/private.pdf' } }));
  });
  const result: any = await runPaperTool('get_paper_fulltext', { identifier: 'W300' }, { openAlexApiKey: 'text-key' });
  assert.equal(result.available, false); assert.equal(requests.length, 1);
  assert.ok(requests.every((url) => url.host === 'api.openalex.org'));
  await assert.rejects(runPaperTool('get_citing_papers', { identifier: 'W300', max_results: 100000 }, {}), /integer/);
});

test('paper search presets reuse existing adapters and do not spend quota on concept overviews', async (t) => {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input); requests.push(url);
    if (url.host === 'api.openalex.org') return Response.json({ results: [work('W400')] });
    if (url.host === 'api.crossref.org') return Response.json({ message: { items: [] } });
    throw new Error('Unexpected provider');
  });
  const result: any = await runPaperTool('search_papers', { query: 'preset-fixture', sources: 'fastest' }, { openAlexApiKey: 'search-key' });
  assert.equal(result.papers.length, 1);
  assert.deepEqual(new Set(requests.map((url) => url.host)), new Set(['api.openalex.org', 'api.crossref.org']));
  assert.ok(!requests.some((url) => url.pathname === '/topics'));
});

test('paper full text prioritizes canonical PMC over an arXiv mirror and extracts bounded article text', async (t) => {
  const requests: URL[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL) => {
    const url = new URL(input); requests.push(url);
    if (url.host === 'api.openalex.org') return Response.json(work('W600', {
      best_oa_location: { landing_page_url: 'https://arxiv.org/abs/2401.12345' },
      locations: [{ landing_page_url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12345/' }],
    }));
    return new Response('<article><body><sec><title>Results</title><p>Open article content.</p></sec></body><back><ref-list><p>References excluded</p></ref-list></back></article>');
  });
  const result: any = await runPaperTool('get_paper_fulltext', { identifier: 'W600' }, { openAlexApiKey: 'pmc-fixture' });
  assert.equal(result.available, true); assert.match(result.text, /Open article content/);
  assert.ok(!result.text.includes('References excluded'));
  assert.equal(requests[1].host, 'www.ebi.ac.uk');
});

test('MCP paper tools use only the requesting browser credentials and never echo them', async (t) => {
  process.env.PHAROL_CREDENTIAL_SECRET = randomBytes(32).toString('hex');
  const received: string[] = [];
  t.mock.method(globalThis, 'fetch', async (_input: unknown, init: RequestInit) => {
    received.push(new Headers(init.headers).get('authorization')!);
    return Response.json(work('W700'));
  });
  for (const key of ['private-alice', 'private-bob']) {
    const request = new NextRequest('https://pharol.example/api/mcp', {
      method: 'POST', headers: { Origin: 'https://pharol.example', Cookie: `${PROVIDER_COOKIE}=${sealProviders({ openAlexApiKey: key })}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_paper', arguments: { identifier: 'W700' } } }),
    });
    const response = await mcpPOST(request);
    assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(key));
  }
  assert.deepEqual(received, ['Bearer private-alice', 'Bearer private-bob']);
});

test('OpenAlex status exposes only numeric quota metrics, not upstream identity or credential fields', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ api_key: 'never-echo', email: 'private@example.org', daily_budget: { remaining_usd: 0.75 }, message: 'private text' }));
  const result = await runPaperTool('openalex_status', {}, { openAlexApiKey: 'status-fixture' });
  assert.deepEqual(result, { keyConfigured: true, usage: { 'daily_budget.remaining_usd': 0.75 } });
});
