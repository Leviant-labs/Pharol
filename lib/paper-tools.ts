import * as cheerio from 'cheerio';
import { runMetasearch } from './server-search';
import { lookupOpenAlexPaper, mapOpenAlexWork, openAlexGet } from './openalex';
import { resolveProviderConfig } from './provider-config';
import type { UserProviderConfig } from './search-types';

export const PAPER_SOURCES = ['openalex', 'crossref', 'arxiv', 'pubmed', 'europepmc', 'semanticscholar', 'openaire', 'hal', 'datacite', 'inspire', 'core'];
export const PAPER_TOOL_NAMES = ['search_papers', 'get_paper', 'get_citing_papers', 'get_referenced_papers', 'get_paper_fulltext', 'openalex_status'];

function integer(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Expected an integer from 1 to ${maximum}`);
  return value;
}

export async function runPaperTool(
  name: string,
  args: Record<string, unknown>,
  userConfig: UserProviderConfig = {},
  providerDefaults?: UserProviderConfig,
) {
  const key = resolveProviderConfig({ userConfig, providerDefaults }).openAlexApiKey;
  if (name === 'openalex_status') {
    if (!key) return { keyConfigured: false, message: 'Add your free OpenAlex key to view account usage.' };
    const data = await openAlexGet('rate-limit', {}, key);
    const usage: Record<string, number> = {};
    const metrics = (value: any, prefix = '') => {
      for (const [field, item] of Object.entries(value)) {
        if (/key|token|secret|authorization|email/i.test(field)) continue;
        const path = prefix ? `${prefix}.${field}` : field;
        if (typeof item === 'number' && Number.isFinite(item) && /budget|remaining|limit|used|reset|credit|request/i.test(path)) usage[path] = item;
        else if (item && typeof item === 'object' && !Array.isArray(item)) metrics(item, path);
      }
    };
    metrics(data);
    return { keyConfigured: true, usage };
  }
  if (name === 'search_papers') {
    if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 1000) throw new Error('A query of 1–1,000 characters is required');
    let sources = args.sources ?? 'fast';
    if (sources === 'fast') sources = ['openalex', 'crossref', 'arxiv', 'pubmed', 'europepmc'];
    else if (sources === 'fastest') sources = ['openalex', 'crossref'];
    else if (sources === 'all') sources = PAPER_SOURCES;
    if (!Array.isArray(sources) || !sources.length || sources.some((source) => !PAPER_SOURCES.includes(source))) throw new Error('Choose supported paper sources, fast, fastest or all');
    const response = await runMetasearch({
      rawQuery: args.query, category: 'science', enginesParam: sources.join(','),
      page: integer(args.page, 1, 5), userConfig, providerDefaults, includeConceptOverview: false,
      ignoreBangRouting: true,
    });
    const seen = new Set<string>();
    const papers = response.results.filter((paper) => {
      const identity = (paper.doi || paper.url).toLowerCase().replace(/^https?:\/\/doi.org\//, '').replace(/\/$/, '');
      if (seen.has(identity)) return false;
      seen.add(identity); return true;
    });
    return { query: response.query, papers: papers.slice(0, integer(args.max_results, 10, 50)),
      total_found: papers.length, sources, engineHealth: response.engineHealth,
      partial: response.engineHealth?.some((engine) => ['error', 'timeout', 'cooldown'].includes(engine.status)) || false };
  }
  if (name === 'get_paper') return (await lookupOpenAlexPaper(args.identifier, key)).paper;
  if (name === 'get_paper_fulltext') return paperFulltext(args.identifier, key);
  if (!['get_citing_papers', 'get_referenced_papers'].includes(name)) throw new Error('Unknown paper tool');

  // Paper Search's bounded one-hop relationship workflow, adapted to TypeScript.
  const maximum = integer(args.max_results, 10, 100);
  const maxPages = integer(args.max_pages, 3, 5);
  const { paper } = await lookupOpenAlexPaper(args.identifier, key);
  const edge = name === 'get_citing_papers' ? 'cites' : 'cited_by';
  const deadline = Date.now() + 20_000;
  const papers = [];
  const seen = new Set<string>();
  let total = 0, scanned = 0, pages = 0, skipped = 0;
  let stop = 'complete';
  for (let page = 1; page <= maxPages; page++) {
    if (Date.now() >= deadline) throw new Error('Paper lookup exceeded its time budget');
    const data = await openAlexGet('works', {
      filter: `${edge}:${paper.openalexId}`, sort: 'cited_by_count:desc',
      per_page: String(Math.min(maximum, 100)), page: String(page),
    }, key, Math.min(5000, deadline - Date.now()));
    if (!Array.isArray(data.results) || !Number.isInteger(data.meta?.count) || data.meta.count < 0) throw new Error('Invalid OpenAlex relationship page');
    pages++; total = data.meta.count; scanned += data.results.length;
    for (const raw of data.results) {
      const candidate = mapOpenAlexWork(raw, papers.length);
      if (!candidate || seen.has(candidate.id)) { skipped++; continue; }
      seen.add(candidate.id); papers.push(candidate);
      if (papers.length >= maximum) break;
    }
    if (!data.results.length || scanned >= total) break;
    if (papers.length >= maximum) { stop = 'max_results'; break; }
    if (page === maxPages) stop = 'page_budget';
  }
  return { work_id: paper.openalexId, direction: edge === 'cites' ? 'citing' : 'referenced', papers,
    total: papers.length, total_available: total, truncated: stop !== 'complete', stop_reason: stop,
    pages_fetched: pages, max_network_requests: pages + 1, skipped_results: skipped };
}

async function paperFulltext(identifier: unknown, key?: string) {
  const { raw, paper } = await lookupOpenAlexPaper(identifier, key);
  const links = [raw.ids?.pmcid, paper.pdfUrl, paper.openAccessUrl,
    ...(Array.isArray(raw.locations) ? raw.locations.flatMap((location: any) => [location?.landing_page_url, location?.pdf_url]) : [])];
  // Fetch only canonical public repositories, never an arbitrary metadata URL.
  let target: string | undefined;
  let xml = false;
  for (const link of links) {
    if (typeof link !== 'string') continue;
    let url: URL;
    try { url = new URL(link); } catch { continue; }
    if (url.username || url.password || url.port || url.protocol !== 'https:') continue;
    const pmc = ['pmc.ncbi.nlm.nih.gov', 'europepmc.org'].includes(url.hostname) && url.pathname.match(/\/(?:articles|article\/PMC)\/(PMC\d+|\d+)(?:\/|$)/i);
    if (pmc) { target = `https://www.ebi.ac.uk/europepmc/webservices/rest/PMC${pmc[1].replace(/^PMC/i, '')}/fullTextXML`; xml = true; break; }
    const arxiv = url.hostname === 'arxiv.org' && url.pathname.match(/^\/(?:abs|pdf|html)\/(\d{4}\.\d{4,5}(?:v\d+)?)(?:\.pdf)?$/);
    if (arxiv && !target) target = `https://arxiv.org/html/${arxiv[1]}`;
  }
  if (!target) return { available: false, paper, reason: 'No supported repository full text found; use the indexed open-access links.', abstract: paper.snippet };
  let response: Response;
  try { response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(6000), cache: 'no-store' }); }
  catch { return { available: false, paper, reason: 'The repository request failed or timed out', source_url: target }; }
  if (!response.ok) return { available: false, paper, reason: `Repository returned HTTP ${response.status}`, source_url: target };
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Repository returned no content');
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 4_000_000) { await reader.cancel(); throw new Error('Paper text exceeds the 4 MB retrieval limit'); }
    chunks.push(value);
  }
  const $ = cheerio.load(Buffer.concat(chunks).toString(), { xmlMode: xml });
  $('script, style, nav, ref-list').remove();
  const container = xml ? $('body').first() : $('article.ltx_document, article').first();
  const text = container.find('h1, h2, h3, title, p').map((_, node) => $(node).text().replace(/\s+/g, ' ').trim()).get().filter(Boolean).join('\n\n');
  return { available: Boolean(text), paper, source_url: target, text: text.slice(0, 50_000), truncated: text.length > 50_000,
    ...(text ? {} : { reason: 'No repository article text was found' }) };
}
