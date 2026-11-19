'use strict';
/**
 * MCP soak: separate warm-cache vs cold-query phases, fresh inputs per phase,
 * payload validation, RSS + post-GC heap tracking, lightweight-route control.
 *
 *   node soak.cjs --server-pid <pid> [--mcp-url <url>] [--caps-url <url>]
 *     [--warm-ms 180000] [--cold-ms 180000] [--control-ms 120000]
 *     [--fresh-prefix <p>] [--rate-per-sec <n>]
 *
 * Phases (sequential, each fresh prefix so cache cannot bleed across):
 *   1. warm-cache: one query repeated, cache warm after first call.
 *   2. cold-query: every op a fresh query (cache miss every time).
 *   3. control: GET /api/capabilities (lightweight, no search engine) at same
 *      request rate — isolates Next/HTTP overhead from runMetasearch cost.
 * Server must run with --expose-gc (/__metrics endpoint returns rss, heapUsed
 * after global.gc()). If endpoint missing, post-GC heap reported as null and
 * decision falls back to RSS trend alone.
 */

const fs = require('node:fs');

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const SERVER_PID = arg('--server-pid', '');
const MCP_URL = arg('--mcp-url', 'http://127.0.0.1:3105/api/mcp');
const CAPS_URL = arg('--caps-url', 'http://127.0.0.1:3105/api/capabilities');
const METRICS_URL = arg('--metrics-url', 'http://127.0.0.1:3106/__metrics');
const WARM_MS = Number(arg('--warm-ms', String(3 * 60 * 1000)));
const COLD_MS = Number(arg('--cold-ms', String(3 * 60 * 1000)));
const CONTROL_MS = Number(arg('--control-ms', String(2 * 60 * 1000)));
const FRESH_PREFIX = arg('--fresh-prefix', `soak-${Date.now()}`);
const RATE_PER_SEC = Number(arg('--rate-per-sec', '40')); // paced: avoid mock-floor distortion
const CONCURRENCY = Number(arg('--concurrency', '20'));

const LOG = process.env.PHAROL_MOCK_LOG || '/tmp/pharol-mock-shared.jsonl';
const OUT = arg('--out', require('node:path').join(__dirname, 'soak-results.json'));

function logCount(host) {
  if (!fs.existsSync(LOG)) return 0;
  return fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean).filter((l) => {
    try { return JSON.parse(l).host === host; } catch { return false; }
  }).length;
}
function rssKb(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = s.match(/VmRSS:\s+(\d+)\s+kB/);
    return m ? Number(m[1]) : 0;
  } catch { return 0; }
}
function percentiles(sorted) {
  if (!sorted.length) return { p50: 0, p95: 0 };
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { p50: at(0.5), p95: at(0.95) };
}
function validateMcpSearch(body, expectedId, query) {
  if (!body || body.id !== expectedId) return false;
  try {
    const text = body.result?.content?.[0]?.text || '';
    const p = JSON.parse(text);
    return p.query === query && Array.isArray(p.results) && p.results.length > 0;
  } catch { return false; }
}

async function metrics() {
  try {
    const r = await fetch(METRICS_URL);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function phase({ name, durationMs, queryFn }) {
  console.log(`\n== Phase: ${name} (${Math.round(durationMs / 1000)}s, rate=${RATE_PER_SEC}/s, c=${CONCURRENCY}) ==`);
  const startUpstream = logCount('api.tavily.com');
  const samples = [];
  const start = Date.now();
  const interval = setInterval(async () => {
    const m = await metrics();
    samples.push({ ts: Date.now(), rssKb: rssKb(SERVER_PID), heapUsedKb: m ? Math.round(m.heapUsedBytes / 1024) : null, rssBytes: m ? m.rssBytes : null });
  }, 5000);
  const latencies = [];
  let ops = 0, fails = 0, nextId = 1;
  // Simple token bucket: target RATE_PER_SEC across all workers.
  const perOpMs = 1000 / Math.max(1, RATE_PER_SEC);
  async function worker() {
    let nextStart = Date.now();
    while (Date.now() - start < durationMs) {
      const i = nextId++;
      const q = queryFn(i);
      const t0 = performance.now();
      try {
        const res = await fetch(MCP_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 9000 + i, method: 'tools/call', params: { name: 'web_search', arguments: { query: q, engines: ['tavily'] } } }),
        });
        const body = JSON.parse(await res.text());
        if (res.status !== 200 || !validateMcpSearch(body, 9000 + i, q)) fails++;
      } catch { fails++; }
      latencies.push(performance.now() - t0);
      ops++;
      nextStart += perOpMs * CONCURRENCY;
      const wait = nextStart - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 500)));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  clearInterval(interval);
  const sorted = latencies.slice().sort((a, b) => a - b);
  const { p50, p95 } = percentiles(sorted);
  const endUpstream = logCount('api.tavily.com');
  const heapVals = samples.map((s) => s.heapUsedKb).filter((v) => v != null);
  const heapBaseline = heapVals.length ? heapVals[0] : null;
  const heapLast = heapVals.length ? heapVals[heapVals.length - 1] : null;
  const heapGrowth = heapBaseline ? Math.round((heapLast - heapBaseline) / heapBaseline * 1000) / 10 : null;
  console.log(`  ops=${ops} fails=${fails} p50=${Math.round(p50)}ms p95=${Math.round(p95)}ms upstreamDelta=${endUpstream - startUpstream} heapPostGc=${heapBaseline}→${heapLast}kB (${heapGrowth}% ) peakRSS=${Math.max(...samples.map((s) => s.rssKb), 0)}kB`);
  return { name, durationMs, ops, fails, p50Ms: Math.round(p50), p95Ms: Math.round(p95), upstreamDelta: endUpstream - startUpstream, samples, heapBaselineKb: heapBaseline, heapLastKb: heapLast, heapGrowthPct: heapGrowth };
}

async function controlPhase(durationMs) {
  console.log(`\n== Phase: control-capabilities (${Math.round(durationMs / 1000)}s, rate=${RATE_PER_SEC}/s, c=${CONCURRENCY}) ==`);
  const samples = [];
  const start = Date.now();
  const interval = setInterval(async () => {
    const m = await metrics();
    samples.push({ ts: Date.now(), rssKb: rssKb(SERVER_PID), heapUsedKb: m ? Math.round(m.heapUsedBytes / 1024) : null });
  }, 5000);
  const latencies = [];
  let ops = 0, fails = 0;
  const perOpMs = 1000 / Math.max(1, RATE_PER_SEC);
  async function worker() {
    let nextStart = Date.now();
    while (Date.now() - start < durationMs) {
      const t0 = performance.now();
      try {
        const r = await fetch(CAPS_URL);
        const j = await r.json();
        if (r.status !== 200 || typeof j.mcpEndpoint !== 'string') fails++;
      } catch { fails++; }
      latencies.push(performance.now() - t0);
      ops++;
      nextStart += perOpMs * CONCURRENCY;
      const wait = nextStart - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, Math.min(wait, 500)));
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  clearInterval(interval);
  const sorted = latencies.slice().sort((a, b) => a - b);
  const { p50, p95 } = percentiles(sorted);
  const heapVals = samples.map((s) => s.heapUsedKb).filter((v) => v != null);
  const heapBaseline = heapVals.length ? heapVals[0] : null;
  const heapLast = heapVals.length ? heapVals[heapVals.length - 1] : null;
  const heapGrowth = heapBaseline ? Math.round((heapLast - heapBaseline) / heapBaseline * 1000) / 10 : null;
  console.log(`  ops=${ops} fails=${fails} p50=${Math.round(p50)}ms p95=${Math.round(p95)}ms heapPostGc=${heapBaseline}→${heapLast}kB (${heapGrowth}%) peakRSS=${Math.max(...samples.map((s) => s.rssKb), 0)}kB`);
  return { name: 'control-capabilities', durationMs, ops, fails, p50Ms: Math.round(p50), p95Ms: Math.round(p95), samples, heapBaselineKb: heapBaseline, heapLastKb: heapLast, heapGrowthPct: heapGrowth };
}

(async () => {
  console.log(`Fresh prefix: ${FRESH_PREFIX}`);
  console.log(`Metrics endpoint: ${METRICS_URL}`);
  const results = { startedAt: new Date().toISOString(), freshPrefix: FRESH_PREFIX, serverPid: SERVER_PID, phases: [] };

  const warm = await phase({ name: 'warm-cache', durationMs: WARM_MS, queryFn: () => `${FRESH_PREFIX}-warm` });
  results.phases.push(warm);

  const cold = await phase({ name: 'cold-query', durationMs: COLD_MS, queryFn: (i) => `${FRESH_PREFIX}-cold-${i}` });
  results.phases.push(cold);

  const ctrl = await controlPhase(CONTROL_MS);
  results.phases.push(ctrl);

  // Decision: only profile retained objects if post-GC baseline keeps rising.
  const warmHeapRise = warm.heapGrowthPct != null && warm.heapGrowthPct > 5;
  const coldHeapRise = cold.heapGrowthPct != null && cold.heapGrowthPct > 5;
  results.decision = warmHeapRise || coldHeapRise ? 'profile-retained-objects' : 'no-rise-no-profile';
  console.log(`\nDecision: ${results.decision} (warm ${warm.heapGrowthPct}% cold ${cold.heapGrowthPct}% control ${ctrl.heapGrowthPct}%)`);
  results.completedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`Wrote ${OUT}`);
})();
