#!/usr/bin/env node
import { parseArgs } from 'node:util';
import type { SearchCategory, SearchMode, SearchRegion, TimeRange } from './search-types';

const modes = ['fast', 'full'] as const satisfies readonly SearchMode[];

const categories = ['all', 'images', 'videos', 'news', 'code', 'science'] as const satisfies readonly SearchCategory[];
const regions = ['auto', 'global', 'pt-PT', 'pt-BR', 'en-US', 'en-GB', 'es-ES', 'fr-FR', 'de-DE'] as const satisfies readonly SearchRegion[];
const timeRanges = ['all', 'day', 'week', 'month', 'year'] as const satisfies readonly TimeRange[];

const help = `Usage: pharol search [options] <query>
       pharol read [--json] <url>

Common options:
  --json                 Print one JSON response
  -h, --help             Show this help

Search options:
  --category <name>      ${categories.join(', ')} (default: all)
  --region <name>        ${regions.join(', ')} (default: auto)
  --time-range <range>   ${timeRanges.join(', ')} (default: all)
  --engines <ids>        Comma-separated engine IDs, e.g. bing,duckduckgo
  --mode <fast|full>     General web search breadth (default: fast unless --engines is set)
  --page <number>        Result page from 1 to 10 (default: 1)

Read extracts a public webpage using the same reader as the web app.
Provider keys are read from environment variables. No web server is required.
`;

function choice<T extends string>(name: string, value: string, choices: readonly T[]): T {
  const match = choices.find((item) => item === value);
  if (match === undefined) throw new Error(`${name} must be one of: ${choices.join(', ')}`);
  return match;
}

function parseSearch(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    json: { type: 'boolean' },
    category: { type: 'string', default: 'all' },
    region: { type: 'string', default: 'auto' },
    'time-range': { type: 'string', default: 'all' },
    engines: { type: 'string' },
    mode: { type: 'string' },
    page: { type: 'string', default: '1' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return;

  const rawQuery = positionals.join(' ').trim();
  if (!rawQuery) throw new Error('a search query is required');
  if (!/^(?:[1-9]|10)$/.test(values.page)) throw new Error('--page must be an integer from 1 to 10');
  const engines = values.engines?.split(',').map((engine) => engine.trim());
  if (engines?.some((engine) => !/^[a-z\d][a-z\d-]*$/i.test(engine))) {
    throw new Error('--engines must be a comma-separated list of engine IDs');
  }
  return {
    json: values.json,
    search: {
      rawQuery,
      category: choice('--category', values.category, categories),
      region: choice('--region', values.region, regions),
      timeRange: choice('--time-range', values['time-range'], timeRanges),
      enginesParam: engines?.join(','),
      mode: values.mode === undefined ? undefined : choice('--mode', values.mode, modes),
      page: Number(values.page),
    },
  };
}

function parseRead(args: string[]) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    json: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) return;
  if (positionals.length !== 1) throw new Error('read requires exactly one URL');

  const url = positionals[0].trim();
  const message = 'read requires an HTTP(S) URL without embedded credentials';
  if (!/^https?:\/\//i.test(url) || !URL.canParse(url)) throw new Error(message);
  const { username, password } = new URL(url);
  if (username || password) throw new Error(message);
  return { url, json: values.json };
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(help);
    return 0;
  }

  let options;
  try {
    if (command === 'search') {
      const parsed = parseSearch(rest);
      if (parsed) options = { command, ...parsed } as const;
    } else if (command === 'read') {
      const parsed = parseRead(rest);
      if (parsed) options = { command, ...parsed } as const;
    } else {
      throw new Error('expected the search or read command');
    }
  } catch (error) {
    process.stderr.write(`pharol: ${error instanceof Error ? error.message : 'invalid arguments'}\nSee pharol --help.\n`);
    return 2;
  }
  if (!options) {
    process.stdout.write(help);
    return 0;
  }

  const { readOperatorProviders } = await import('./provider-config.js');
  const providerDefaults = readOperatorProviders(process.env);
  if (options.command === 'read') {
    const { readWebpage } = await import('./reader-service.js');
    const content = await readWebpage(options.url, { providerDefaults });
    if (options.json) {
      process.stdout.write(`${JSON.stringify(content)}\n`);
    } else {
      process.stdout.write(`${[content.title, ...content.paragraphs].join('\n\n')}\n`);
    }
    return 0;
  }

  const { runMetasearch } = await import('./server-search.js');
  const result = await runMetasearch({ ...options.search, providerDefaults });
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else if (result.results.length) {
    process.stdout.write(`${result.results.map((item) => `${item.title}\n${item.url}`).join('\n\n')}\n`);
  } else {
    process.stdout.write('No results.\n');
  }
  return 0;
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

void main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch(() => {
  const command = process.argv[2] === 'read' ? 'read' : 'search';
  process.stderr.write(`pharol: ${command} failed\n`);
  process.exitCode = 1;
});
