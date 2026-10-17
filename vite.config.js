// Builds the Converter (converter/) into dist/, which tgcloud.jsonc deploys as the
// bot's Mini App. Tests use vitest.config.js, not this file.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'converter',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    // mediabunny's demuxers for every input format make one ~570 kB (145 kB gzipped)
    // chunk; the admin opens the Converter rarely, so it isn't split.
    chunkSizeWarningLimit: 700,
  },
});
