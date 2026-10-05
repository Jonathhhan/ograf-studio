# Studio Node API v1

Browser-free, generic authoring API for external exporters and tools. No AE imports,
DOM, running server or browser capture is required. Build once in Studio:

```sh
npm run build --workspace @ograf-editor/node-api
```

Import `@ograf-editor/node-api` from an installed workspace, or copy/import its
self-contained `dist/index.mjs` bundle. It exports named project/layer/asset factories,
path helpers, migration, validation, descriptor compilation, frame timing,
2D hierarchy resolution and SVG frame rendering. Type declarations use the workspace
source model. The compiled runtime bundle is independent of the source checkout.

Check `studioNodeApi.version === 1` and capabilities before authoring. API contract
versions change when the public interface changes incompatibly; capability flags
identify optional features independently of Studio's application version.
`assertStudioCapabilities(required)` rejects unsupported features. Call
`migrateProject` when importing saved projects, then validate before compiling.

Composition Scripts follow Expressions → Composition → Render. Sampling uses
explicit frame numbers and needs no clock. This API does not promise AE parity,
font-exact SVG/browser parity or server-side rendering of browser-only media/charts.
The editor/runtime implements chart playback; SVG checks only its model/compiler
integration. Unsupported source features remain the importer's responsibility.

Regression checks cover API capability rejection and Dev chart model integration;
the Studio suite covers scripting, hierarchy, clips and deterministic seeks.
