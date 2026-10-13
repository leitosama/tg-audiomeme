import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

// The test seams: `sdk`, the store and the generated config are swapped for fakes
// wherever the bot's modules import them.
/** @type {Record<string, string>} */
const fakes = {
  sdk: resolve(root, 'tests/fakes/sdk.js'),
  [resolve(root, 'tgcloud/lib/store.js')]: resolve(root, 'tests/fakes/store.js'),
  [resolve(root, 'tgcloud/lib/config.js')]: resolve(root, 'tests/fakes/config.js'),
};

export default defineConfig({
  plugins: [
    {
      name: 'tgcloud-fakes',
      enforce: 'pre',
      /** @param {string} source @param {string | undefined} importer */
      resolveId(source, importer) {
        if (source === 'sdk') return fakes.sdk;
        if (source.startsWith('.') && importer) {
          return fakes[resolve(dirname(importer), source)] ?? null;
        }
        return null;
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    coverage: {
      provider: 'v8',
      include: ['tgcloud/**/*.js'],
      exclude: ['tgcloud/lib/store.js', 'tgcloud/lib/config.js', 'tgcloud/schema.js'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
