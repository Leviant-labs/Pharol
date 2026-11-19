'use strict';
/**
 * Pharol load test (Node 24, no external deps).
 *
 * Usage:
 *   node stress/run-load.cjs [--cli <path>] [--mcp-url <url>]
 *     [--ops <n>] [--hold-ms <ms>] [--skip-mcp] [--server-pid <pid>]
 *
 * Ramp: 1 -> 5 -> 20 concurrent, repeated vs distinct queries, then hold
 * at highest stable level (20 if stable else 5) for --hold-ms (default 5 min).
 *
 * Stop ramping when unexpected failure rate >1% or server RSS growing >20%
 * across levels. Output: console table + JSON to stress/results.json
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');

const MOCK = require('node:path').join(__dirname, 'mock.cjs');
const DEFAULT_CLI = '/tmp/pharol-cli-test/node_modules/.bin/pharol';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const CLI = arg('--cli', DEFAULT_CLI);
const MCP_URL = arg('--mcp-url', 'http://127.0.0.1:3105/api/mcp');
const OPS_PER_LEVEL = Number(arg('--ops', '30'));
const HOLD_MS = Number(arg('--hold-ms', String(5 * 60 * 1000)));
const SKIP_MCP = argv.includes('--skip-mcp');
const SERVER_PID = arg('--server-pid', '');
// Fresh inputs: every (kind,concurrency,phase,level) gets a unique prefix so the
// 100-entry / 3-min search cache cannot serve stale hits across levels.
const RUN_ID = arg('--run-id', `run-${Date.now()}`);

const TAVILY = process.env.TAVILY_API_KEY || 'fake-tavily-key-TEST0001';
const FIRECRAWL = process.env.FIRECRAWL_API_KEY || 'fake-firecrawl-key-TEST0002';
const LOG = process.env.PHAROL_MOCK_LOG || '/tmp/pharol-mock-shared.jsonl';
const OUT = arg('--out', require('node:path').join(__dirname, 'results.json'));

function percentiles(sorted) {
  if (!sorted.length) return { p50: 0, p95: 0 };
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { p50: at(0.5), p95: at(0.95) };
}

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

// Validate MCP tool payloads (not just HTTP 200 / id echo).
function validateMcpSearch(body, expectedId, query) {
  if (!body || body.id !== expectedId) return false;
  if (!body.result || !Array.isArray(body.result.content) || !body.result.content[0]) return false;
  const c = body.result.content[0];
  if (c.type !== 'text' || typeof c.text !== 'string') return false;
  try {
    const p = JSON.parse(c.text);
    if (p.query !== query) return false;
    if (!Array.isArray(p.results) || p.results.length === 0) return false;
    const r0 = p.results[0];
    if (typeof r0.title !== 'string' || typeof r0.url !== 'string') return false;
    if (!/example\.org/.test(r0.url) && !r0.url.startsWith('https://')) return false;
    if (typeof p.totalResults !== 'number') return false;
    if (!Array.isArray(p.enginesUsed)) return false;
    return true;
  } catch { return false; }
}
function validateMcpRead(body, expectedId) {
  if (!body || body.id !== expectedId) return false;
  try {
    const text = body.result?.content?.[0]?.text || '';
    const p = JSON.parse(text);
    return p.title === 'Fixture article' && Array.isArray(p.paragraphs) && p.paragraphs.length >= 2 && p.extractor === 'direct';
  } catch { return false; }
}
function validateCliSearch(stdout, stderr, code, query) {
  if (code !== 0 || stderr !== '') return false;
  try {
    const p = JSON.parse(stdout);
    if (p.query !== query) return false;
    if (!Array.isArray(p.results) || p.results.length === 0) return false;
    const r0 = p.results[0];
    if (r0.title !== query && !String(r0.title).includes(query)) return false;
    if (!r0.url) return false;
    return true;
  } catch { return false; }
}
function validateCliRead(stdout, code) {
  if (code !== 0) return false;
  try {
    const p = JSON.parse(stdout);
    return p.title === 'Fixture article' && p.extractor === 'direct' && Array.isArray(p.paragraphs) && p.paragraphs.length >= 2;
  } catch { return false; }
}

function runCliOnce(args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(process.execPath, ['--require', MOCK, CLI, ...args], {
      env: { ...process.env, TAVILY_API_KEY: TAVILY, FIRECRAWL_API_KEY: FIRECRAWL, PHAROL_WEB_TRANSPORT: 'fetch', PHAROL_MOCK_LOG: LOG },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    let done = false;
    const finish = (code, signal) => {
      if (done) return; done = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout: out, stderr: err, ms: performance.now() - start });
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(null, 'TIMED_OUT'); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', () => finish(null, 'SPAWN_ERROR'));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

async function runLevel({ label, concurrency, kind, repeated, ops }) {
  const startUpstream = logCount('api.tavily.com') + logCount('api.firecrawl.dev') + logCount('example.org');
  const latencies = [];
  let unexpectedFails = 0;
  const windowStart = performance.now();
  let completed = 0;
  let next = 0;
  // Fresh prefix per level: RUN_ID/kind/concurrency/repeated — no cache reuse.
  const levelPrefix = `${RUN_ID}-${kind}-c${concurrency}-${repeated ? 'rep' : 'dis'}`;

  async function worker() {
    while (next < ops) {
      const i = next++;
      const t0 = performance.now();
      if (kind === 'cli-search') {
        const q = repeated ? `${levelPrefix}-rep` : `${levelPrefix}-dis-${i}`;
        const r = await runCliOnce(['search', '--json', '--engines', 'tavily', q]);
        if (!validateCliSearch(r.stdout, r.stderr, r.code, q)) unexpectedFails++;
      } else if (kind === 'cli-read') {
        const r = await runCliOnce(['read', '--json', 'https://example.org/reader-fixture']);
        if (!validateCliRead(r.stdout, r.code)) unexpectedFails++;
      } else if (kind === 'mcp-search') {
        const q = repeated ? `${levelPrefix}-rep` : `${levelPrefix}-dis-${i}`;
        try {
          const res = await fetch(MCP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1000 + i, method: 'tools/call', params: { name: 'web_search', arguments: { query: q, engines: ['tavily'] } } }),
          });
          const body = JSON.parse(await res.text());
          if (res.status !== 200 || !validateMcpSearch(body, 1000 + i, q)) unexpectedFails++;
        } catch { unexpectedFails++; }
      } else { // mcp-read
        try {
          const res = await fetch(MCP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 2000 + i, method: 'tools/call', params: { name: 'read_webpage', arguments: { url: 'https://example.org/reader-fixture' } } }),
          });
          const body = JSON.parse(await res.text());
          if (res.status !== 200 || !validateMcpRead(body, 2000 + i)) unexpectedFails++;
        } catch { unexpectedFails++; }
      }
      latencies.push(performance.now() - t0);
      completed++;
    }
  }

  const rssSamples = [];
  const rssTimer = SERVER_PID ? setInterval(() => rssSamples.push(rssKb(SERVER_PID)), 200) : null;
  await Promise.all(Array.from({ length: Math.min(concurrency, ops) }, worker));
  if (rssTimer) clearInterval(rssTimer);

  const windowMs = performance.now() - windowStart;
  const endUpstream = logCount('api.tavily.com') + logCount('api.firecrawl.dev') + logCount('example.org');
  const sorted = latencies.slice().sort((a, b) => a - b);
  const { p50, p95 } = percentiles(sorted);
  const row = {
    label, kind, concurrency, repeated, ops: completed,
    p50Ms: Math.round(p50), p95Ms: Math.round(p95),
    throughputOpsPerSec: Math.round((completed / (windowMs / 1000)) * 10) / 10,
    expectedFailures: 0, unexpectedFailures: unexpectedFails,
    upstreamDelta: endUpstream - startUpstream,
    peakServerRssKb: rssSamples.length ? Math.max(...rssSamples) : 0,
    windowMs: Math.round(windowMs),
  };
  console.log(
    `${label.padEnd(28)} c=${String(concurrency).padStart(2)} ops=${completed} ` +
    `p50=${row.p50Ms}ms p95=${row.p95Ms}ms tput=${row.throughputOpsPerSec}/s ` +
    `unexpected=${unexpectedFails} upstreamDelta=${row.upstreamDelta} peakRSS=${row.peakServerRssKb}kB`
  );
  return row;
}

async function holdPhase(concurrency, kind, serverPid) {
  console.log(`\n== Hold: ${kind} @ concurrency ${concurrency} for ${Math.round(HOLD_MS / 1000)}s ==`);
  const samples = [];
  const start = Date.now();
  const interval = setInterval(() => {
    if (serverPid) samples.push({ ts: Date.now(), rssKb: rssKb(serverPid) });
  }, 5000);
  let ops = 0, fails = 0;
  async function worker() {
    while (Date.now() - start < HOLD_MS) {
      const i = ops++;
      try {
        if (kind === 'mcp-search') {
          const res = await fetch(MCP_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 3000 + i, method: 'tools/call', params: { name: 'web_search', arguments: { query: 'repeated-fixture', engines: ['tavily'] } } }),
          });
          const body = JSON.parse(await res.text());
          if (!(res.status === 200 && body.id === 3000 + i)) fails++;
        } else {
          const r = await runCliOnce(['search', '--json', '--engines', 'tavily', 'repeated-fixture']);
          let ok = false;
          try { JSON.parse(r.stdout); ok = r.code === 0; } catch { ok = false; }
          if (!ok) fails++;
        }
      } catch { fails++; }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  clearInterval(interval);
  const rssVals = samples.map((s) => s.rssKb).filter(Boolean);
  const peak = rssVals.length ? Math.max(...rssVals) : 0;
  const growth = rssVals.length > 1 && rssVals[0] ? (rssVals[rssVals.length - 1] - rssVals[0]) / rssVals[0] : 0;
  console.log(`  hold done: ops=${ops} fails=${fails} samples=${samples.length} peakRSS=${peak}kB growth=${(growth * 100).toFixed(1)}%`);
  return { kind, concurrency, holdMs: HOLD_MS, ops, fails, peakServerRssKb: peak, growthRatio: Math.round(growth * 1000) / 1000, samples };
}

(async () => {
  try { fs.writeFileSync(LOG, ''); } catch { /* ignore */ }
  const results = { startedAt: new Date().toISOString(), cli: CLI, mcpUrl: MCP_URL, opsPerLevel: OPS_PER_LEVEL, levels: [], hold: null };

  if (!fs.existsSync(CLI)) {
    console.log(`CLI not found at ${CLI} — install per README step 1 and re-run. MCP-only load will still run.`);
  }

  const kinds = [];
  if (fs.existsSync(CLI)) kinds.push('cli-search', 'cli-read');
  if (!SKIP_MCP) kinds.push('mcp-search', 'mcp-read');

  let highestStable = 5;
  let prevRss = 0;

  for (const kind of kinds) {
    let stable = true;
    for (const c of [1, 5, 20]) {
      for (const repeated of [true, false]) {
        const row = await runLevel({ label: `${kind}:${repeated ? 'repeated' : 'distinct'}`, concurrency: c, kind, repeated, ops: OPS_PER_LEVEL });
        results.levels.push(row);
        const failRate = row.ops ? row.unexpectedFailures / row.ops : 0;
        const rss = row.peakServerRssKb || 0;
        const memGrowth = prevRss && rss ? (rss - prevRss) / prevRss : 0;
        if (rss) prevRss = rss;
        if (failRate > 0.01) {
          console.log(`  ** STOP: unexpected failure rate ${(failRate * 100).toFixed(1)}% > 1% at c=${c} — not ramping further`);
          stable = false;
          break;
        }
        if (memGrowth > 0.2) {
          console.log(`  ** STOP: memory growth ${(memGrowth * 100).toFixed(1)}% > 20% at c=${c} — not ramping further`);
          stable = false;
          break;
        }
        if (c === 20 && stable) highestStable = 20;
        else if (c === 5) highestStable = Math.max(highestStable, 5);
      }
      if (!stable) break;
    }
  }

  const holdKind = !SKIP_MCP ? 'mcp-search' : 'cli-search';
  results.hold = await holdPhase(highestStable, holdKind, SERVER_PID || '');
  results.completedAt = new Date().toISOString();
  fs.writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`\nWrote ${OUT}`);
  console.log('\n== Summary table ==');
  for (const row of results.levels) {
    console.log(`${row.label.padEnd(28)} c=${row.concurrency} p50=${row.p50Ms}ms p95=${row.p95Ms}ms tput=${row.throughputOpsPerSec}/s upstream=${row.upstreamDelta} unexpected=${row.unexpectedFailures}`);
  }
  console.log(`Hold: ${results.hold.kind} @ c=${results.hold.concurrency} ops=${results.hold.ops} peakRSS=${results.hold.peakServerRssKb}kB growth=${(results.hold.growthRatio * 100).toFixed(1)}%`);
})();
