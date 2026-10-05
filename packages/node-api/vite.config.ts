import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    rolldownOptions: { output: { entryFileNames: 'index.mjs' } },
  },
});
