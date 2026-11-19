const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { resolve } = require('node:path');
const test = require('node:test');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const cli = resolve(process.env.PHAROL_TEST_CLI || resolve(__dirname, '../packages/cli/dist/cli.js'));
const fixture = resolve(__dirname, 'fixtures/cli-fetch.cjs');

function run(...args) {
  return execute(process.execPath, ['--require', fixture, cli, ...args], {
    env: { ...process.env, TAVILY_API_KEY: 'fake-fixture-key', FIRECRAWL_API_KEY: 'fake-firecrawl-key', PHAROL_WEB_TRANSPORT: 'fetch' },
    timeout: 30_000,
  });
}

test('CLI help describes search and machine-readable output', async () => {
  const { stdout, stderr } = await run('--help');
  assert.match(stdout, /pharol search/);
  assert.match(stdout, /pharol read/);
  assert.match(stdout, /--json/);
  assert.equal(stderr, '');
});

test('CLI usage errors write only to stderr and exit 2', async () => {
  for (const args of [['search', '--json'], ['search', '--page', '0', 'fixture'], ['search', '--category', 'unknown', 'fixture']]) {
    await assert.rejects(run(...args), (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /^pharol: /);
      return true;
    });
  }
});

test('parallel CLI processes return one JSON document each', async () => {
  await Promise.all(Array.from({ length: 5 }, async (_, i) => {
    const query = `pharol fixture ${i}`;
    const { stdout, stderr } = await run('search', '--json', '--engines', 'tavily', '--region', 'global', query);
    const result = JSON.parse(stdout);
    assert.equal(result.query, query);
    assert.equal(result.results[0]?.url, 'https://example.org/fixture');
    assert.equal(result.engineHealth.find(({ engine }) => engine === 'tavily')?.status, 'ok');
    assert.equal(stderr, '');
    assert.doesNotMatch(stdout, /fake-fixture-key/);
  }));
});

test('read returns the structured preview and can print plain text', async () => {
  const url = 'https://example.org/reader-fixture';
  const json = await run('read', '--json', url);
  const preview = JSON.parse(json.stdout);
  assert.equal(preview.url, url);
  assert.equal(preview.title, 'Fixture article');
  assert.equal(preview.extractor, 'direct');
  assert.equal(preview.blocks.length, 2);
  assert.match(preview.paragraphs[0], /article itself/);
  assert.equal(json.stderr, '');
  const text = await run('read', url);
  assert.match(text.stdout, /^Fixture article\n\nThe reading preview/);
  assert.equal(text.stderr, '');
});

test('read uses configured fallback provider keys without printing them', async () => {
  const url = 'https://example.org/reader-fallback';
  const { stdout, stderr } = await run('read', '--json', url);
  const preview = JSON.parse(stdout);
  assert.equal(preview.title, 'Fixture fallback article');
  assert.equal(preview.extractor, 'firecrawl');
  assert.match(preview.paragraphs[0], /configured fallback provider/);
  assert.doesNotMatch(stdout, /fake-firecrawl-key/);
  assert.equal(stderr, '');
});

test('read rejects missing URLs, non-web schemes and embedded credentials', async () => {
  for (const args of [[], ['file:///article.html'], ['https://user:private-fixture@example.org/']]) {
    await assert.rejects(run('read', '--json', ...args), (error) => {
      assert.equal(error.code, 2);
      assert.equal(error.stdout, '');
      assert.match(error.stderr, /read requires/);
      assert.doesNotMatch(error.stderr, /private-fixture/);
      return true;
    });
  }
});
