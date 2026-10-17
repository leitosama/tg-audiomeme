// PROTOTYPE, wipe me: builds the Converter measurement page into dist/.
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'prototype-converter',
  build: { outDir: '../dist', emptyOutDir: true },
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'] },
});
