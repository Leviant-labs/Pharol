import { FlatCompat } from '@eslint/eslintrc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// eslint-config-next@15 still ships a legacy (eslintrc) config, so it has to be
// bridged into flat config. Pinned to the Next 15 major to match `next`.
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
  {
    ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'packages/cli/dist/**', 'packages/cli/source/**'],
  },
  ...compat.extends('next/core-web-vitals'),
];
