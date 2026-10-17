import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const root = dirname(fileURLToPath(import.meta.url));

// Modules kept outside the deployed tree but written to be copied into it (the legacy
// import, issue #21) mirror tgcloud/ under this folder; their relative imports resolve as
// if they sat in tgcloud/ (tsconfig.json does the same with `rootDirs`).
const mirror = resolve(root, 'scripts/tgcloud');
const tgcloud = resolve(root, 'tgcloud');

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
          let target = resolve(dirname(importer), source);
          const fromMirror = importer.startsWith(`${mirror}/`) && target.startsWith(`${mirror}/`);
          if (fromMirror) target = tgcloud + target.slice(mirror.length);
          return fakes[target] ?? (fromMirror ? target : null);
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
      include: ['tgcloud/**/*.js', 'scripts/tgcloud/**/*.js', 'converter/plan.js'],
      exclude: ['tgcloud/lib/store.js', 'tgcloud/lib/config.js', 'tgcloud/schema.js'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
