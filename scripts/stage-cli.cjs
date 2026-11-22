const { copyFileSync, mkdirSync } = require('node:fs');
const { resolve, dirname } = require('node:path');

const root = resolve(__dirname, '..');
const packageDir = resolve(root, 'packages/cli');
const sources = [
  'browser-transport', 'cli', 'instant-tools', 'openalex', 'provider-config', 'reader-service',
  'search-engine', 'search-types', 'server-cache', 'server-search', 'url-guard', 'web-engines',
];

function copy(source, destination) {
  const target = resolve(packageDir, destination);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(resolve(root, source), target);
}

// Stage the TypeScript used to build the binary, without copying tests or UI files.
for (const name of sources) copy(`lib/${name}.ts`, `source/lib/${name}.ts`);
for (const project of ['searxng', 'paper-search']) {
  for (const name of ['LICENSE', 'NOTICE.md']) {
    const file = `third_party/${project}/${name}`;
    copy(file, file);
  }
}
