import { build, defineConfig, normalizePath, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const rootPackage = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
) as { version: string };
const sourceDateEpoch = Number(process.env.SOURCE_DATE_EPOCH);
const buildDate = new Date(
  Number.isFinite(sourceDateEpoch) && sourceDateEpoch > 0 ? sourceDateEpoch * 1000 : Date.now(),
)
  .toISOString()
  .slice(0, 10);

function keepExportRuntimeFresh(): Plugin {
  const runtimeRoot = fileURLToPath(new URL('../../packages/ograf-runtime', import.meta.url));
  const runtimeSource = normalizePath(
    fileURLToPath(new URL('../../packages/ograf-runtime/src', import.meta.url)),
  );
  let rebuilding = false;
  let pending = false;
  const rebuild = async () => {
    if (rebuilding) {
      pending = true;
      return;
    }
    rebuilding = true;
    try {
      await build({ root: runtimeRoot, logLevel: 'warn' });
    } finally {
      rebuilding = false;
      if (pending) {
        pending = false;
        void rebuild();
      }
    }
  };

  return {
    name: 'keep-export-runtime-fresh',
    configureServer(server) {
      server.watcher.add(runtimeSource);
      server.watcher.on('change', (file) => {
        if (normalizePath(file).startsWith(`${runtimeSource}/`)) void rebuild();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  define: {
    __OGRAF_STUDIO_VERSION__: JSON.stringify(rootPackage.version),
    __OGRAF_STUDIO_BUILD_DATE__: JSON.stringify(buildDate),
  },
  // Export embeds the runtime distribution as raw source. Rebuild it whenever its source changes
  // so a long-running editor dev session cannot preview newer code than it packages.
  plugins: [react(), keepExportRuntimeFresh()],
});
