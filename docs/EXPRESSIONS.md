# JavaScript expressions and scripts

[Using Studio](USER_GUIDE.md)

## Property expressions

Open **Scripts > Layer expressions** for a selected layer. An expression controls `x`, `y`,
`width`, `height`, `rotation`, or `opacity` (0 to 1). Return a finite number, either as a
formula or from a JavaScript statement body:

```js
layer('Background').x + 20;
```

```js
const target = layer('Background');
return Math.max(target.width - thisLayer.width, 0) / 2;
```

Empty or disabled expressions retain the sampled animation value. Errors appear beside the
field and retain that property's sampled value; unrelated properties still evaluate.
Layer dependencies resolve lazily, independently of layer order. Circular dependencies are errors.

## Composition script and shared files

Open **Scripts**, select **Composition (each frame)**, and enable **Run composition script**.
**Apply** commits the draft; **Revert** restores the applied code. Scripts run after property
expressions, so their assignments win for that frame:

```js
const title = layer('Title');
title.x += 20;
layer('Background').width = title.width + 40;
```

The same six properties are writable. Reads observe earlier script assignments; property
expressions are not rerun after writes. Each evaluation starts from a fresh animation pose,
so assignments do not edit keyframes or accumulate between frames. If the script throws or
writes an invalid value, all of its layer writes are discarded. Errors appear in Scripts.

Use **Import .js files** or **New module** for reusable functions. For example, `helpers.js`:

```js
export function spacing(index, gap) {
  return index * gap;
}
```

Both property expressions and the composition script can call `helpers.spacing(3, 100)`.
Included files can import and re-export each other with explicit relative paths:

```js
import { spacing } from './helpers.js';
export const offset = (index) => spacing(index, 40);
```

The filename's basename is its namespace, also available as `modules.helpers`. Filenames must
use a JavaScript identifier followed by `.js` or `.mjs`, and cannot conflict with API/global
names. The file list is flat; directory, npm and network imports, import cycles, and top-level
await are unsupported. `import` statements belong in module files; script bodies use namespaces.
Modules initialize on first use and retain state until the applied scripting configuration
changes or the project reloads. Prefer pure functions so seeking remains repeatable.

## API

| Value                                               | Meaning                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `thisLayer`                                         | Sampled transform before expressions; property expressions only.                 |
| `x`, `y`, `width`, `height`, `rotation`, `opacity`  | Shorthand for the sampled transform in a property expression.                    |
| `layer("Name")`                                     | Computed transform of a uniquely named layer. Read-only in property expressions. |
| `layerById("id")`                                   | Same lookup by stable ID; use the Scripts reference selector to obtain the code. |
| `frame`, `time`                                     | Composition playhead in frames and seconds.                                      |
| `comp.width`, `comp.height`                         | Composition dimensions.                                                          |
| `data.key`                                          | Scalar input field; booleans are exposed as 0/1.                                 |
| `timeline.startFrame`, `timeline.endFrame`          | Authored start and end boundaries.                                               |
| `timeline.firstStepFrame`, `timeline.lastStepFrame` | First and last Step boundaries, when present.                                    |
| `timeline.exitProgress`                             | Exit progress, including a direct Stop transition.                               |
| `lerp(a, b, t)`, `clamp(value, min, max)`           | Numeric interpolation and bounds.                                                |
| `ease(a, b, t, preset)`                             | Interpolation using an existing Studio easing preset.                            |

Layer names do not become JavaScript globals: use `layer("Title").x`, not `Title.x`.
`Object.keys`, object spread, and JSON serialization work on the supplied objects. Listing a
layer's keys does not evaluate its properties; copying values does create dependencies.

Within collection property expressions, name and prototype-ID lookups prefer siblings in the
same item, then global layers. Composition scripts require unique evaluated names or exact
runtime IDs; duplicated collection names are ambiguous. `data` contains top-level scalar fields.

The playhead follows OGraf Steps, holds, and Stop transitions; it is not wall-clock elapsed time.
Scripts do not schedule actions. Existing OGraf lifecycle behavior remains unchanged.

## Execution and portability

Expressions and scripts are trusted JavaScript executed synchronously by the host engine,
without a sandbox or timeout. `console.log` uses the native console. Infinite loops can block
the host, and async work is unsupported for frame calculations. Use current frame/data values
rather than persistent counters or external side effects for deterministic playback.

Source, enable flags, and modules survive `.ogs` reload and compiled `.ograf` export/import.
The exported descriptor embeds module source; the original files are not needed at playback.
[Sucrase](https://github.com/alangpierce/sucrase) handles module import/export syntax.
The composition's `expressionApiVersion` defaults to v1; unsupported versions report errors
and retain sampled values. This is Studio's API version, not a JavaScript language version.

The shared evaluator is used by Studio, SVG snapshots, and exported graphics. References use
the renderer's sampled layer boxes; scripting does not change text auto-sizing behavior.
Tests cover dependencies, errors, module loading, seeking, lifecycle timing, and export/import.
