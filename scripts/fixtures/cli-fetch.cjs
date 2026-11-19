const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const fromCli = createRequire(process.argv[1]);
if (process.env.PHAROL_TEST_ISOLATED === '1') {
  for (const name of ['next', 'react', 'react-dom']) {
    assert.throws(() => fromCli.resolve(name), { code: 'MODULE_NOT_FOUND' });
  }
}

globalThis.fetch = async (input, init) => {
  const url = new URL(input);
  if (url.href === 'https://example.org/reader-fixture') {
    const opening = 'The reading preview should show the article itself, rather than showing a summary from a search-results page. ';
    const closing = 'The shared reader preserves the order of the text and produces structured blocks that both the application and CLI can display. ';
    return new Response(`<article><h1>Fixture article</h1><p>${opening.repeat(3)}</p><p>${closing.repeat(3)}</p></article>`, {
      headers: { 'Content-Type': 'text/html' },
    });
  }
  if (url.href === 'https://api.firecrawl.dev/v2/scrape') {
    if (new Headers(init?.headers).get('authorization') !== 'Bearer fake-firecrawl-key' ||
        JSON.parse(init.body).url !== 'https://example.org/reader-fallback') {
      return new Response(null, { status: 401 });
    }
    const md = 'This article came from the configured fallback provider, using the same extraction chain as the web preview. '.repeat(4);
    return Response.json({ data: { markdown: md, metadata: { title: 'Fixture fallback article' } } });
  }
  if (url.href !== 'https://api.tavily.com/search') return new Response(null, { status: 503 });
  if (new Headers(init?.headers).get('authorization') !== 'Bearer fake-fixture-key') {
    return new Response(null, { status: 401 });
  }
  const { query } = JSON.parse(init.body);
  return Response.json({ results: [{ title: query, url: 'https://example.org/fixture', content: 'Fixture result.' }] });
};
