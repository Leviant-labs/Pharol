import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import type { SearchMode } from '../lib/search-types';

const QUERIES = [
  'how rainbows form',
  'public library history',
  'sourdough bread recipes',
  'urban community gardens',
  'museum architecture in Lisbon',
  'migratory birds of North America',
] as const;
const MODES = ['fast', 'full'] as const;
const DEFAULT_QUERIES = 4;
const MAX_RUNS = 10;

interface Sample {
  mode: SearchMode;
  firstUsefulMs: number | undefined;
  completionMs: number;
  sourcedResults: number;
}

function positiveCount(value: string, option: string, max: number): number {
  const count = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(count) || count < 1 || count > max) {
    throw new Error(`${option} must be an integer from 1 to ${max}`);
  }
  return count;
}

function percentiles(values: number[]): string {
  if (values.length === 0) return 'n/a';
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.ceil(p * sorted.length) - 1].toFixed(1);
  return `${at(0.50)} / ${at(0.95)}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    help: { type: 'boolean', short: 'h' },
    queries: { type: 'string', default: String(DEFAULT_QUERIES) },
    runs: { type: 'string', default: '1' },
  } });
  if (values.help) {
    console.log([
      'Usage: node --import tsx scripts/bench-search.ts [--queries N] [--runs N]',
      'Direct Node metasearch engine benchmark; not browser rendering or AI answer latency.',
      'Runs live upstream searches using public queries and no provider credentials.',
      `  --queries N  Number of fixed public queries (1-${QUERIES.length}, default ${DEFAULT_QUERIES})`,
      `  --runs N     Paired fast/full repetitions per query (1-${MAX_RUNS}, default 1)`,
    ].join('\n'));
    return;
  }

  const queryCount = positiveCount(values.queries, '--queries', QUERIES.length);
  const runs = positiveCount(values.runs, '--runs', MAX_RUNS);
  const [{ runMetasearch }, { clearSearchCache }] = await Promise.all([
    import('../lib/server-search.ts'),
    import('../lib/server-cache.ts'),
  ]);
  const queries = QUERIES.slice(0, queryCount);
  const samples: Sample[] = [];

  console.log('Direct Node metasearch engine benchmark (not browser rendering or AI answer latency).');
  console.log(`${2 * queries.length * runs} sequential live searches (each may contact multiple providers).`);
  console.log('Category=all, region=en-US, page=1, no provider credentials.');
  console.log('Before each sample, clearSearchCache() resets the local result cache and engine cooldown.');
  console.log('Network connections and upstream state are not reset.');

  for (let run = 0; run < runs; run++) {
    for (const [index, rawQuery] of queries.entries()) {
      // Pair identical queries and alternate which mode goes first to reduce order bias.
      const order = (run + index) % 2 === 0 ? MODES : ['full', 'fast'] as const;
      const pair: string[] = [];
      for (const mode of order) {
        clearSearchCache();
        let firstUsefulMs: number | undefined;
        const started = performance.now();
        const final = await runMetasearch({
          rawQuery, mode, category: 'all', region: 'en-US', page: 1,
          onBatch(partial) {
            if (firstUsefulMs === undefined && partial.results.length > 0) {
              firstUsefulMs = performance.now() - started;
            }
          },
        });
        const completionMs = performance.now() - started;
        if (final.cacheHit) throw new Error('Unexpected cache hit after clearSearchCache()');
        const results = final.results.length;
        // The all-category response can contain synthetic fallback links even with no sourced hits.
        const sourcedResults = final.results.filter(({ id }) => id !== 'fallback-1' && id !== 'fallback-2').length;
        samples.push({ mode, firstUsefulMs, completionMs, sourcedResults });
        pair.push(
          `${mode}: first ${firstUsefulMs?.toFixed(1) ?? 'n/a'}, done ${completionMs.toFixed(1)} ms; ` +
          `${sourcedResults}/${results} sourced/total`,
        );
      }
      console.log(`Run ${run + 1}, ${JSON.stringify(rawQuery)} | ${pair.join(' | ')}`);
    }
  }

  console.log('\nLatency in ms, nearest-rank p50 / p95 (small samples are noisy).');
  console.log('First useful batch = first onBatch with results; samples without one are excluded from those percentiles only.');
  for (const mode of MODES) {
    const group = samples.filter((sample) => sample.mode === mode);
    const first = group.flatMap(({ firstUsefulMs }) => firstUsefulMs === undefined ? [] : [firstUsefulMs]);
    const noHits = group.filter(({ sourcedResults }) => sourcedResults === 0).length;
    console.log(`${mode} (n=${group.length}): first ${percentiles(first)} (${group.length - first.length} without a useful batch); completion ${percentiles(group.map(({ completionMs }) => completionMs))}; ${noHits} no-hit samples.`);
  }
}

main().catch((error: unknown) => {
  console.error(`Benchmark failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
