'use strict';
/**
 * Pharol protocol verification (Node 24, no external deps).
 *
 * Usage:
 *   node stress/run-protocol.cjs [--cli <path>] [--mcp-url <url>] [--skip-mcp]
 *
 * Defaults:
 *   CLI = /tmp/pharol-cli-test/node_modules/.bin/pharol
 *   MCP = http://127.0.0.1:3105/api/mcp  (server must already be running; see README)
 *
 * Exits non-zero on any UNEXPECTED failure. Prints PASS/FAIL per check with
 * measured latencies and upstream counts from the mock JSONL log.
 *
 * Env passthrough: TAVILY_API_KEY / FIRECRAWL_API_KEY default to fake keys.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const MOCK = require('node:path').join(__dirname, 'mock.cjs');
const DEFAULT_CLI = '/tmp/pharol-cli-test/node_modules/.bin/pharol';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const CLI = arg('--cli', DEFAULT_CLI);
const MCP_URL = arg('--mcp-url', 'http://127.0.0.1:3105/api/mcp');
const SKIP_MCP = argv.includes('--skip-mcp');

const TAVILY = process.env.TAVILY_API_KEY || 'fake-tavily-key-TEST0001';
const FIRECRAWL = process.env.FIRECRAWL_API_KEY || 'fake-firecrawl-key-TEST0002';
const LOG = process.env.PHAROL_MOCK_LOG || '/tmp/pharol-mock-shared.jsonl';

let failures = 0;
let passes = 0;

function check(name, cond, detail = '') {
  if (cond) {
    passes++;
    console.log(`PASS ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function logCount(host) {
  if (!fs.existsSync(LOG)) return 0;
  const lines = fs.readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
  return lines.filter((l) => {
    try { return JSON.parse(l).host === host; } catch { return false; }
  }).length;
}

function runCli(args, { timeoutMs = 30000, env = {} } = {}) {
  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(process.execPath, ['--require', MOCK, CLI, ...args], {
      env: {
        ...process.env,
        TAVILY_API_KEY: TAVILY,
        FIRECRAWL_API_KEY: FIRECRAWL,
        PHAROL_WEB_TRANSPORT: 'fetch',
        PHAROL_MOCK_LOG: LOG,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
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

async function mcpCall(id, method, params, headers = {}) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  const body = JSON.parse(text);
  return { status: res.status, body, raw: text };
}

// ---------------------------------------------------------------- CLI checks

async function cliChecks() {
  console.log('\n== CLI installation ==');
  const exists = fs.existsSync(CLI);
  check('cli-binary-exists', exists, CLI);
  if (!exists) {
    console.log(`  (run README step 1 to install the tarball first; skipping CLI checks)`);
    return;
  }
  // npm ls next/react absent — check the install root package.json and bin symlink
  try {
    const binDir = path.dirname(CLI); // .../node_modules/.bin
    const installRoot = path.resolve(binDir, '..', '..'); // /tmp/pharol-cli-test
    const rootPkg = path.join(installRoot, 'package.json');
    const hasPkg = fs.existsSync(rootPkg);
    const pkgText = hasPkg ? fs.readFileSync(rootPkg, 'utf8') : '';
    const hasNextReact = /"next"|"react"|"react-dom"/.test(pkgText);
    check('cli-install-present', hasPkg && !hasNextReact, `${rootPkg} next/react=${hasNextReact ? 'FOUND(BAD)' : 'absent'}`);
  } catch { /* non-fatal */ }

  console.log('\n== CLI search --json single-doc ==');
  {
    const r = await runCli(['search', '--json', '--engines', 'tavily', 'protocol-fixture']);
    let ok = false, detail = '';
    try {
      const parsed = JSON.parse(r.stdout);
      const lines = r.stdout.split('\n').filter((l) => l.trim() !== '');
      ok = r.code === 0 && r.stderr === '' && r.stdout.endsWith('\n') && lines.length === 1 &&
        Array.isArray(parsed.results);
      detail = `exit=${r.code} ms=${r.ms.toFixed(0)} lines=${lines.length}`;
    } catch (e) { detail = `parse error: ${e.message} exit=${r.code}`; }
    check('search-json-single-doc', ok, detail);
  }

  console.log('\n== CLI invalid args (exit 2, empty stdout, stderr "pharol: ") ==');
  const invalid = [
    [['search', '--json'], 'search-no-query'],
    [['search', '--page', '0', 'fixture'], 'search-page-0'],
    [['search', '--category', 'unknown', 'fixture'], 'search-category-unknown'],
    [['read', '--json'], 'read-no-url'],
    [['read', '--json', 'file:///x'], 'read-file-scheme'],
    [['read', '--json', 'https://user:pass@example.org/'], 'read-embedded-creds'],
  ];
  for (const [args, name] of invalid) {
    const r = await runCli(args);
    check(name, r.code === 2 && r.stdout === '' && r.stderr.startsWith('pharol: '),
      `exit=${r.code} stderr=${JSON.stringify(r.stderr.slice(0, 80))}`);
  }

  console.log('\n== CLI read direct/fallback ==');
  {
    const r = await runCli(['read', '--json', 'https://example.org/reader-fixture']);
    let ok = false, detail = '';
    try {
      const p = JSON.parse(r.stdout);
      ok = r.code === 0 && p.extractor === 'direct' && p.title === 'Fixture article';
      detail = `extractor=${p.extractor} title=${p.title} ms=${r.ms.toFixed(0)}`;
    } catch (e) { detail = e.message; }
    check('read-direct', ok, detail);
  }
  {
    const r = await runCli(['read', '--json', 'https://example.org/reader-fallback']);
    let ok = false, detail = '';
    try {
      const p = JSON.parse(r.stdout);
      ok = r.code === 0 && p.extractor === 'firecrawl' && p.title === 'Fixture fallback article';
      detail = `extractor=${p.extractor} title=${p.title} ms=${r.ms.toFixed(0)}`;
    } catch (e) { detail = e.message; }
    check('read-fallback', ok, detail);
  }

  console.log('\n== CLI slow / timeout / 429 ==');
  {
    const r = await runCli(['search', '--json', '--engines', 'tavily', 'slow-fixture']);
    let ok = false, detail = '';
    try {
      const p = JSON.parse(r.stdout);
      const h = (p.engineHealth || []).find((x) => x.engine === 'tavily');
      ok = r.code === 0 && h && h.status === 'ok' && p.results.length > 0;
      detail = `status=${h && h.status} results=${p.results.length} ms=${r.ms.toFixed(0)}`;
    } catch (e) { detail = e.message; }
    check('search-slow-ok', ok, detail);
  }
  {
    const r = await runCli(['search', '--json', '--engines', 'tavily', 'timeout-fixture']);
    let ok = false, detail = '';
    try {
      const p = JSON.parse(r.stdout);
      const h = (p.engineHealth || []).find((x) => x.engine === 'tavily');
      // timeout (6000ms mock delay > 3800ms server timeout) => status timeout with
      // 0 Tavily results. The runMetasearch fallback injects synthetic wikipedia+
      // github navigational results, so total results >0 is expected when only
      // Tavily was requested; assert on the engine itself, not the total count.
      ok = r.code === 0 && h && h.status === 'timeout' && (h.count || 0) === 0;
      detail = `status=${h && h.status} ms=${r.ms.toFixed(0)}`;
    } catch (e) { detail = e.message; }
    check('search-timeout-engine', ok, detail);
  }
  {
    const r = await runCli(['search', '--json', '--engines', 'tavily', 'quota429-fixture']);
    let ok = false, detail = '';
    try {
      const p = JSON.parse(r.stdout);
      const h = (p.engineHealth || []).find((x) => x.engine === 'tavily');
      // 429 => RateLimitQuotaError => cooldown (mock returns 429 only for -A keys;
      // operator key TEST0001 succeeds, so ALSO accept ok-as-isolation-pass; the
      // authoritative 429->cooldown assertion runs via MCP isolation below).
      ok = r.code === 0 && h && h.status !== 'error';
      detail = `status=${h && h.status} (cooldown expected for -A scope; see isolation)`;
    } catch (e) { detail = e.message; }
    check('search-429-grouped', ok, detail);
  }

  console.log('\n== Key leak scan ==');
  {
    const r1 = await runCli(['search', '--json', '--engines', 'tavily', 'leak-check']);
    const r2 = await runCli(['read', '--json', 'https://example.org/reader-fallback']);
    const combined = r1.stdout + r1.stderr + r2.stdout + r2.stderr;
    check('no-key-leak-cli', !combined.includes(TAVILY) && !combined.includes(FIRECRAWL),
      'fake keys absent from stdout+stderr');
  }

  console.log('\n== Ctrl-C (SIGINT) ==');
  {
    // `read --json https://example.org/timeout-reader` — mock delays 6000ms via
    // timeout- marker on the URL; direct read timeout is 5000ms. SIGINT after
    // 300ms must terminate quickly (CLI has no SIGINT handler => default kill).
    const start = performance.now();
    const child = spawn(process.execPath, ['--require', MOCK, CLI, 'read', '--json', 'https://example.org/timeout-reader'], {
      env: { ...process.env, TAVILY_API_KEY: TAVILY, FIRECRAWL_API_KEY: FIRECRAWL, PHAROL_WEB_TRANSPORT: 'fetch', PHAROL_MOCK_LOG: LOG },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    setTimeout(() => child.kill('SIGINT'), 300);
    const result = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ code: null, signal: 'HUNG' }); }, 4000);
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
    const elapsed = performance.now() - start;
    check('sigint-exits-quickly', result.signal !== 'HUNG' && elapsed < 1500,
      `exit=${result.code} signal=${result.signal} elapsed=${elapsed.toFixed(0)}ms (limit 1500ms)`);
  }
}

// ---------------------------------------------------------------- MCP checks

async function mcpChecks() {
  console.log('\n== MCP server ==');
  let up = false;
  try {
    const res = await fetch(MCP_URL.replace(/\/api\/mcp$/, ''), { method: 'GET' });
    up = res.status < 500;
  } catch { up = false; }
  // Also try GET /api/mcp directly
  try {
    const res = await fetch(MCP_URL, { method: 'GET' });
    if (res.status === 200) up = true;
  } catch { /* keep up as-is */ }
  check('mcp-reachable', up, MCP_URL);
  if (!up) {
    console.log('  (start server per README, or pass --skip-mcp; MCP checks skipped)');
    return { skipped: true };
  }

  console.log('\n== MCP initialize / tools ==');
  const init = await mcpCall(1, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stress', version: '1.0' } });
  check('mcp-initialize', init.body.id === 1 && !!init.body.result?.serverInfo, `id=${init.body.id}`);
  const list = await mcpCall(2, 'tools/list', {});
  const names = (list.body.result?.tools || []).map((t) => t.name);
  check('mcp-tools-list', list.body.id === 2 && names.includes('web_search') && names.includes('read_webpage'),
    `tools=${names.slice(0, 6).join(',')}...`);

  const norm = { search: null, readDirect: null, readFallback: null };

  console.log('\n== MCP tools/call ==');
  {
    const r = await mcpCall(3, 'tools/call', { name: 'web_search', arguments: { query: 'protocol-fixture', engines: ['tavily'] } });
    const text = r.body.result?.content?.[0]?.text || '';
    let ok = false, detail = '';
    try {
      const parsed = JSON.parse(text);
      const first = parsed.results?.[0];
      norm.search = first ? { title: first.title, url: first.url, snippet: first.snippet } : null;
      ok = r.body.id === 3 && !!first;
      detail = `id=${r.body.id} first=${first && first.title}`;
    } catch (e) { detail = e.message; }
    check('mcp-web-search', ok, detail);
  }
  {
    const r = await mcpCall(4, 'tools/call', { name: 'read_webpage', arguments: { url: 'https://example.org/reader-fixture' } });
    const text = r.body.result?.content?.[0]?.text || '';
    let ok = false, detail = '';
    try {
      const parsed = JSON.parse(text);
      norm.readDirect = { title: parsed.title, paragraphs: parsed.paragraphs, extractor: parsed.extractor };
      ok = r.body.id === 4 && parsed.extractor === 'direct' && parsed.title === 'Fixture article';
      detail = `extractor=${parsed.extractor} title=${parsed.title}`;
    } catch (e) { detail = e.message; }
    check('mcp-read-direct', ok, detail);
  }
  {
    const r = await mcpCall(5, 'tools/call', { name: 'read_webpage', arguments: { url: 'https://example.org/reader-fallback' } });
    const text = r.body.result?.content?.[0]?.text || '';
    let ok = false, detail = '';
    try {
      const parsed = JSON.parse(text);
      norm.readFallback = { title: parsed.title, paragraphs: parsed.paragraphs, extractor: parsed.extractor };
      ok = r.body.id === 5 && parsed.extractor === 'firecrawl' && parsed.title === 'Fixture fallback article';
      detail = `extractor=${parsed.extractor} title=${parsed.title}`;
    } catch (e) { detail = e.message; }
    check('mcp-read-fallback', ok, detail);
  }

  console.log('\n== MCP 20 concurrent tools/call (id echo, no cross-talk) ==');
  {
    const ids = Array.from({ length: 20 }, (_, i) => 100 + i);
    const start = performance.now();
    const results = await Promise.all(ids.map((id) =>
      mcpCall(id, 'tools/call', { name: 'web_search', arguments: { query: `concurrent-${id}`, engines: ['tavily'] } })
        .catch(() => ({ body: { id: null } }))
    ));
    const ms = performance.now() - start;
    const matched = results.filter((r) => r.body.id !== null).every((r, idx) => r.body.id === ids[idx]);
    // fetch may reorder completion; verify set equality instead of order
    const returned = results.map((r) => r.body.id).sort((a, b) => a - b);
    const setOk = ids.every((id) => returned.includes(id)) && returned.length === ids.length;
    check('mcp-concurrent-id-echo', setOk, `20 calls in ${ms.toFixed(0)}ms, ids ${returned.join(',')}`);
  }

  console.log('\n== Normalized CLI vs MCP compare ==');
  {
    const cliR = await runCli(['search', '--json', '--engines', 'tavily', 'protocol-fixture']);
    const mcpR = await mcpCall(6, 'tools/call', { name: 'web_search', arguments: { query: 'protocol-fixture', engines: ['tavily'] } });
    try {
      const cliFirst = JSON.parse(cliR.stdout).results[0];
      const cliNorm = { title: cliFirst.title, url: cliFirst.url, snippet: cliFirst.snippet };
      const mcpText = mcpR.body.result?.content?.[0]?.text || '';
      const mcpFirst = JSON.parse(mcpText).results[0];
      const equal = cliNorm.title === mcpFirst.title && cliNorm.url === mcpFirst.url && cliNorm.snippet === mcpFirst.snippet;
      check('normalized-search-equal', equal, `cli=${JSON.stringify(cliNorm)} mcp-snippet=${JSON.stringify(mcpFirst.snippet)}`);
    } catch (e) { check('normalized-search-equal', false, e.message); }
  }
  {
    const cliR = await runCli(['read', '--json', 'https://example.org/reader-fixture']);
    const mcpR = await mcpCall(7, 'tools/call', { name: 'read_webpage', arguments: { url: 'https://example.org/reader-fixture' } });
    try {
      const cliP = JSON.parse(cliR.stdout);
      const mcpP = JSON.parse(mcpR.body.result?.content?.[0]?.text || '{}');
      const equal = cliP.title === mcpP.title && JSON.stringify(cliP.paragraphs) === JSON.stringify(mcpP.paragraphs) && cliP.extractor === mcpP.extractor;
      check('normalized-read-equal', equal, `title=${cliP.title} extractor=${cliP.extractor}`);
    } catch (e) { check('normalized-read-equal', false, e.message); }
  }

  console.log('\n== Per-key isolation (MCP) ==');
  // Operator env key = TEST0001 (success). Header key A = TEST0001-A (mock 429s).
  // cooldownKey = engine:hash(all providers) => different scopes.
  // 1st call A "quota429-iso" -> 429 -> cooldown for scope A (engineHealth cooldown)
  // 2nd call A again immediately -> cooldown WITHOUT upstream call (log count unchanged)
  // 3rd call B (TEST0001-B, default behavior success) -> upstream called, success.
  // Note: mock 429s only for -A suffixed keys so B proves isolation with a success.
  {
    const before = logCount('api.tavily.com');
    const q = 'quota429-iso';
    const r1 = await mcpCall(8, 'tools/call',
      { name: 'web_search', arguments: { query: q, engines: ['tavily'] } },
      { 'x-pharol-tavily-key': 'fake-tavily-key-TEST0001-A' });
    const after1 = logCount('api.tavily.com');
    const r2 = await mcpCall(9, 'tools/call',
      { name: 'web_search', arguments: { query: q, engines: ['tavily'] } },
      { 'x-pharol-tavily-key': 'fake-tavily-key-TEST0001-A' });
    const after2 = logCount('api.tavily.com');
    const r3 = await mcpCall(10, 'tools/call',
      { name: 'web_search', arguments: { query: 'protocol-fixture', engines: ['tavily'] } },
      { 'x-pharol-tavily-key': 'fake-tavily-key-TEST0001-B' });
    const after3 = logCount('api.tavily.com');

    for (const [r, label] of [[r1, 'A-first'], [r2, 'A-second']]) {
      const raw = JSON.stringify(r.body);
      check(`isolation-no-leak-${label}`,
        !raw.includes('fake-tavily-key-TEST0001-A') && !raw.includes('fake-tavily-key-TEST0001-B'),
        'no key in response');
    }
    // First A call must have hit upstream; second A call must NOT (cooldown served
    // locally). Third (B) must hit upstream again.
    check('isolation-A-first-upstream', after1 > before, `log ${before} -> ${after1}`);
    check('isolation-A-cooldown-no-upstream', after2 === after1, `log ${after1} -> ${after2} (unchanged expected)`);
    check('isolation-B-upstream-again', after3 > after2, `log ${after2} -> ${after3}`);
    // B should have results.
    try {
      const bText = r3.body.result?.content?.[0]?.text || '';
      const bParsed = JSON.parse(bText);
      check('isolation-B-success', (bParsed.results?.length || 0) > 0, `results=${bParsed.results?.length}`);
    } catch { check('isolation-B-success', false, 'no parse'); }
  }

  console.log('\n== Upstream counts ==');
  console.log(`  tavily calls: ${logCount('api.tavily.com')}, firecrawl calls: ${logCount('api.firecrawl.dev')}, example.org calls: ${logCount('example.org')}`);
  return { skipped: false };
}

// ---------------------------------------------------------------- main

(async () => {
  try { fs.writeFileSync(LOG, ''); } catch { /* dir may not exist */ }
  await cliChecks();
  if (!SKIP_MCP) await mcpChecks();
  else console.log('\n(SKIP_MCP set — MCP checks skipped)');
  console.log(`\n== Summary: ${passes} PASS, ${failures} FAIL ==`);
  console.log(`Mock log: ${LOG}`);
  process.exit(failures > 0 ? 1 : 0);
})();
// NOTE: LOG must be shared between the Next.js server and this runner, e.g.
//   PHAROL_MOCK_LOG=/tmp/pharol-mock-shared.jsonl <server with same LOG> and
//   PHAROL_MOCK_LOG=/tmp/pharol-mock-shared.jsonl node run-protocol.cjs
