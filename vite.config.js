import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        slimelab: resolve(import.meta.dirname, 'projects/slimelab.html'),
        gooseWorld: resolve(import.meta.dirname, 'projects/goose-world.html'),
        auditor: resolve(import.meta.dirname, 'projects/shader-cost-auditor.html'),
      },
    },
  },
});
