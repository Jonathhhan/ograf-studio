# JavaScript expressions and scripts

[Using Studio](USER_GUIDE.md)

The Scripts tab provides JavaScript syntax highlighting, line numbers, indentation, and bracket
matching. Edits stay local until leaving the code field; the previously committed
code stays active while typing. Undo/Redo edits the pending draft, then Studio's history after commit. Expression checkboxes toggle only when
the checkbox itself is activated; clicking the property name does not toggle it.

Press **Ctrl+Space** for completion. Expressions and composition scripts suggest layer names/IDs,
data fields, API members and statically declared helper exports. Direct layer references and
unambiguous top-level `const title = layer('Title')` aliases provide type-specific members.
Suggestions also cover scalar and vector names inside `property("...")`, its `valueAtTime` member, and
`left`, `top`, `width`, `height` after direct `sourceRectAtTime(...)` calls with simple arguments.
Suggestions show types, read-only access and enum choices. Helper modules retain ordinary local
JavaScript completion; scene objects must be passed as arguments. Completion never executes
module code and is not a full JavaScript type checker (dynamic exports and arbitrary aliasing
are not inferred). Errors from actual script evaluation appear below the editor. There is no separate syntax check while typing.

## Property expressions

Open **Scripts > Layer expressions** for a selected layer. The five transform fields are **Position**,
**Size**, **Transform Origin**, **Rotation**, and **Opacity**. Position returns `[x, y]`, Size returns
`[width, height]`, and Transform Origin returns normalized `[x, y]` values from `0` to `1`. Rotation returns degrees;
Opacity returns a number from 0 to 1. Every result component must be finite. Use a formula or an
explicit `return` in a JavaScript statement body. Empty fields use sampled animation values.
All five editors can be collapsed or expanded. For example, a Position expression:

```js
[layer('Background').position[0] + 20, value[1]];
```

```js
const target = layer('Background');
return [Math.max(target.size[0] - size[0], 0) / 2, value[1]];
```

Empty or disabled expressions retain the sampled animation value. Errors appear beside the
field and retain that property's sampled value; unrelated properties still evaluate.
Layer dependencies resolve lazily, independently of layer order. Circular dependencies are errors.

The scripting aliases `position`, `size`, and `transformOrigin` are two-component arrays. Index 0 is
horizontal and index 1 is vertical. They work on `thisLayer`, `layer('Name')`, and `layerById(id)`;
bare aliases in a property expression refer to the current layer's sampled transform:

```js
// A Position expression that follows another layer's right edge.
[layer('Background').position[0] + layer('Background').size[0] + 20, value[1]];
```

`position` aliases `[x, y]`; `size` aliases `[width, height]`. `transformOrigin` is the normalized
rendering pivot. For a centered
layer it reads `[0.5, 0.5]`. Property expressions read these arrays and return a new pair;
direct layer assignments belong in Composition code.

Text layers also have a **Text** expression. It receives a detached `text` object and applies
the complete text and style only when evaluation succeeds. Read fields use the existing OGraf
names and units; setters return the same object for chaining. `content`, `fontFamily`, `fontSize`,
`fontWeight`, `lineHeight`, `letterSpacing`, `direction`, `color`, `fill`, `strokeColor`,
`strokePaint`, `strokeWidth`, alignment, transform, fitting and overflow fields are validated by
the same text-property catalog used by composition scripts:

```js
text
  .setText(data.headline)
  .setFontFamily('Inter')
  .setFontSize(64)
  .setLineHeight(1.1)
  .setLetterSpacing(1)
  .setDirection('rtl')
  .setColor('#ffffff')
  .setFill({
    type: 'linear',
    angle: 0,
    stops: [
      { offset: 0, opacity: 1, color: '#ffffff' },
      { offset: 1, opacity: 1, color: '#66ccff' },
    ],
  });
```

`text.fontSize` and `text.direction` (and the other fields) read the current detached value.
`text.setText()` changes the text content together with the style. The runtime text object is never
saved as a scene field; only the expression source is stored. Text expressions are available from
the current expression API and are valid only on text layers.

Like an AE Source Text expression, a text expression may also return a string directly:

```js
return data.headline;
```

Style mutations are retained when the final result is a string, so this is also valid:

```js
text.setFontFamily('Inter');
return 'rerer';
```

Saved scalar geometry and scalar API access (`x`, `y`, `width`, `height`) remain supported for
OGraf Studio compatibility. Existing scalar expression records still evaluate. The editor shows
Position, Size, Transform Origin, Rotation, and Opacity, plus Text for text layers. Populated legacy
scalar fields appear below these controls, expanded so their source, enable switches, and errors
remain accessible. Rewrite scalar expressions manually into one array expression per field;
the editor never converts or removes expression code. A non-empty vector expression controls both
axes and takes precedence over its scalar component records. Use `value` or `thisLayer` for the
sampled current pair; referencing the same computed vector through `layer(...)` creates a dependency
cycle.

`value` is the current field's sampled value before its expression: a read-only pair for vector
fields, or a number for Rotation and Opacity. The equivalent
`thisProperty.value` is accompanied by `thisProperty.name` and `thisProperty.layerId`:

```js
[value[0] + data.layout.padding, value[1]];
```

`thisLayer.id/name` identify the expression's layer. `layer("Title").id/name` and
`layerById(id).id/name` identify a referenced layer without evaluating its transforms.
Metadata is read-only and non-enumerable on layer objects, so spreading a layer still copies
only transform values in property expressions. Composition-script references also expose visual
properties. Collection references report the evaluated item's runtime ID.

## Composition script and shared files

Open **Scripts > Composition & modules** and select **Composition (each frame)**.
Code edits save directly to the project, like layer expressions. **Composition script enabled**
turns the composition script on or off immediately. Syntax errors appear below the editor and
do not prevent toggling execution. Use the normal project Undo/Redo to undo code edits.
Scripts run after property
expressions, so their assignments win for that frame:

```js
const title = layer('Title');
title.x += 20;
layer('Background').width = title.width + 40;
```

The same fields can be read or written through the vector aliases, by index or as a whole pair:

```js
const title = layer('Title');
title.position[0] += 20;
title.size = [400, 120];
title.transformOrigin = [0.5, 0.5];
```

Aliases remain live when scalar fields change. `position` is Studio's top-left layout position and
`transformOrigin` is a normalized rendering pivot. Whole pairs must contain exactly two finite
numbers; transform-origin components must be in the `0..1` range. `size` changes the layout box,
including text wrapping.

Composition scripts can write transforms and rendered visual properties, including text,
paint, effects and media settings. See the [complete property reference](SCRIPT_PROPERTIES.md). Reads observe earlier script assignments; property
expressions are not rerun after writes. Each evaluation starts from a fresh animation pose,
so assignments do not edit keyframes or accumulate between frames. If the script throws or
writes an invalid value, all of its layer writes are discarded. Errors appear in Scripts.

Use **Import .js / .json** or **New module** for reusable functions. For example, `helpers.js`:

```js
export function spacing(index, gap) {
  return index * gap;
}
```

JSON files live in the same Scripts list. Read them with `json('settings.json')` from expressions
or composition code, or `require('./settings.json')` from a JavaScript module. Loaded JSON values
are read-only.

JSON imports are embedded snapshots saved with the composition. They replace the earlier Data
panel's **Link JSON** / **Reload** workflow: changes to the original file are not reloaded, and saved
browser file links are no longer restored. Existing object-field default values remain in the
project. To refresh an embedded resource, edit its JSON source, or remove it and import the updated
file with the same filename. To switch existing expressions from a data field to an embedded
resource, import the file in Scripts and replace the corresponding `data` access with
`json('settings.json')` access.

Both property expressions and the composition script can call `helpers.spacing(3, 100)`.
Module functions receive frame data and layer references through arguments; they do not inherit
`layer`, `frame`, or `data` from their caller. For example:

```js
// helpers.js
export function move(target, offset) {
  target.x += offset;
}
// Composition script
helpers.move(layer('Title'), data.offset);
```

References passed by property expressions remain read-only. Use pure functions for expressions;
perform layer assignments from the composition script.
Included files can import and re-export each other with explicit relative paths:

```js
import { spacing } from './helpers.js';
export const offset = (index) => spacing(index, 40);
```

The filename's basename is its namespace, also available as `modules.helpers`. Filenames must
use a JavaScript identifier followed by `.js`, `.mjs`, or `.json`, and cannot conflict with API names or
the fixed reserved list of standard JavaScript globals and `console`. Host-specific globals
such as `window` and `process` do not affect filename validity; a matching module alias shadows
that host global in expressions and composition scripts. The file list is flat; directory,
npm and network imports, import cycles, and top-level
await are unsupported. `import` statements belong in module files; script bodies use namespaces.
Modules initialize on first use. Playback instances keep their own module state until the next
dispose/reload; SVG snapshots start with fresh modules. Editing scripting settings also resets state.
Prefer pure functions so seeking remains repeatable. Variables declared inside an expression or
composition script are local to that evaluation; share constants and functions through module exports.

Project recovery preserves incomplete or duplicate module filenames so interrupted edits can be
corrected. The Scripts tab reports these errors, and export requires valid, unique module names.

## API

| Value                                               | Meaning                                                                          |
| --------------------------------------------------- | -------------------------------------------------------------------------------- |
| `value`, `thisProperty.value`                       | Sampled value of the current property before its expression.                     |
| `thisProperty.name`, `thisProperty.layerId`         | Current property name and runtime layer ID; property expressions only.           |
| `thisLayer`                                         | Sampled transform before expressions; property expressions only.                 |
| `x`, `y`, `width`, `height`, `rotation`, `opacity`  | Shorthand for the sampled transform in a property expression.                    |
| `layer("Name")`                                     | Computed transform of a uniquely named layer. Read-only in property expressions. |
| `layerById("id")`                                   | Same lookup by stable layer ID.                                                  |
| `frame`, `time`                                     | Composition playhead in frames and seconds.                                      |
| `comp.width`, `comp.height`                         | Composition dimensions.                                                          |
| `data.key`                                          | Read-only input data, including objects, arrays, booleans and null.              |
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
runtime IDs; duplicated collection names are ambiguous. `data` preserves nested fields and arrays.

Data is a detached, deeply frozen snapshot shared by the frame's expressions and composition
script. Use `data.scoreboard.home.name`, `data.rows[0].score`, or bracket notation for literal
field names such as `data["home.score"]`. Helper functions receive the same read-only data.

Booleans now remain JavaScript `true`/`false`, replacing the earlier draft's numeric flags.
Use `data.visible === true` or `data.visible ? 1 : 0`; use `Number(data.visible)` when a numeric
flag is needed. Expressions must return the number or pair expected by their field. Existing
strict checks against `1` or `0` should be updated. Array/object data remains available.

The playhead follows OGraf Steps, holds, and Stop transitions; it is not wall-clock elapsed time.
Scripts do not schedule actions. Existing OGraf lifecycle behavior remains unchanged.

## Sampling time and content bounds

Times are composition seconds, including fractional frames, clamped to the authored timeline.
`valueAtTime(seconds)` and `thisProperty.valueAtTime(seconds)` sample the current property's
authored animation before expressions and composition-script writes. This supports a delay
without recursively evaluating the expression:

```js
valueAtTime(time - 0.2);
```

Use `layer("Title").property("x").valueAtTime(time - 0.2)` for another property.
`property(name).value` reads that reference's current value. In expressions, `valueAtTime` reads the
authored value for the property hosting the expression; another property is evaluated including
its expression and dependencies at the requested time. This also applies to another property on
the same layer. Scalar components of the hosting vector count as that same property. Comp-script
time queries continue to read authored
animation. The six scalar transform properties and the three vector aliases are available.
For example, `layer("Title").property("position").valueAtTime(time - 0.2)[0]` samples X.
Sampling `transformOrigin` returns the normalized origin from the requested time. Sampling does not
seek the
playhead or replay OGraf lifecycle actions, held loops, or previous data updates.

`layer("Title").sourceRectAtTime(seconds = time, includeExtents = false)` returns a read-only
`{ left, top, width, height }` in local layer pixels at the requested time, before position,
rotation, masks and effects. Text expressions are evaluated at the requested time before measuring
the bounds. In a composition script, the call also sees visual and layout writes that occurred
earlier in that same script; later writes do not change an already returned rectangle. In a property
expression, `sourceRectAtTime()` and
`thisLayer.sourceRectAtTime()` address the current layer.
Within a Text expression, measuring that same layer returns its authored source bounds before
the Text expression, avoiding a self-dependency. Bounds of other text layers include their Text
expressions; circular dependencies report an error.

```js
[layer('Title').sourceRectAtTime(time).width + 40, value[1]];
```

Text uses the bound content and browser font/wrapping/fitting code, including the evaluated text
expression, with the authored box at the requested time. Empty text has zero bounds. Editable paths use their path bounds;
other sources use their authored source box, not a pixel-alpha scan. `includeExtents` includes
stroke expansion; it does not include shadows, filters or masks. These semantics are not a
complete clone of AE's method.

Measurements are cached by text layout and authored box, invalidated when fonts change, and
never alter live layers. The lightweight
SVG overview lacks browser font metrics and uses the authored text box; Studio and exported
browser graphics measure text. Use browser capture for accurate text-dependent output.

## Evaluation order and state

Each evaluation starts from the current animation and bound data, resolves property expressions,
then runs the composition script, and finally renders the result. Composition-script writes take
precedence over expression results for the same property. They do not change authored project values.

| Read                                                    | State returned                                                                               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Expression `value`, `thisProperty.value`, `thisLayer.x` | Current sampled value before expressions.                                                    |
| Expression `layer('Title').x`                           | Referenced layer's expression result, resolved as a dependency.                              |
| Composition-script `layer('Title').x`                   | Expression result plus earlier writes in this script.                                        |
| Expression `property('x').valueAtTime(t)`               | Own property: authored animation. Other property: its expression result at `t`, before Comp. |
| Comp `property('x').valueAtTime(t)`                     | Authored animation at `t`, before expressions and Comp writes.                               |
| `sourceRectAtTime(t)`                                   | Source geometry at `t` after text expressions and earlier writes in the current script.      |

Time arguments are seconds. An expression's `valueAtTime` on another property evaluates that
property with the sampled time, animation and timeline scope. Successful expression results are
shared per property and requested time within one evaluation. Cyclic time dependencies are errors;
chains deeper than 128 property evaluations are rejected. Time queries never replay Comp or
retrieve historical operator data; they use the data supplied to the current evaluation.
Bounds queries can evaluate text expressions at the requested time, including helpers they call;
neither query reruns the composition script. Repeated successful queries share samples within one evaluation; the next
evaluation starts fresh, including when the timestamp is unchanged but data or fonts have changed.
Changing text or its box in a composition script changes later `sourceRectAtTime()` calls in that
script. Time queries do not run the script again, so writes that occur later in the script are not
visible to an earlier measurement.

### Sequential text layout in one composition script

Keep the operations in the order in which you want them to take effect:

```js
const title = layer('Title');
const background = layer('Background');

title.content = data.headline ?? 'Headline';
title.fontSize = 64;
title.width = 600; // Layout box, not measured glyph width.

const bounds = title.sourceRectAtTime(); // Sees all three preceding writes.
background.x = title.x + bounds.left - 24;
background.y = title.y + bounds.top - 12;
background.width = bounds.width + 48;
background.height = bounds.height + 24;
```

This positioning example assumes unrotated layers in the same coordinate system. Each returned
rectangle is a detached, read-only snapshot: later writes cannot change it. Measure again after
changing text, font or box dimensions. Invalid text-layout values are rejected before measurement;
the existing composition-script transaction rolls back the frame's script writes on failure.

`title.property('width').value` observes earlier writes, while
`title.property('width').valueAtTime(t)` still samples authored animation, even if `t === time`.
`sourceRectAtTime(t)` samples text at `t` and then overlays earlier explicit writes from this script;
it does not replay the script at `t` or retrieve past input data.

Text measurement reuses geometry when only position, rotation, opacity, fill, text color or outline
color changes. Object-property ordering in imported text settings does not invalidate the cache.
Changes to layout or loaded fonts do invalidate it. Time-sampling caches retain at most 128 entries
per layer/cache in an evaluation; evicted samples are recomputed when requested again.

Module variables persist within a playback instance. Seeking, changing playback direction and
repeating the same timestamp do not reset them. A failed composition script rolls back its layer
writes, but does not roll back a module counter. There is no persistent-state or manual-reset API.
Use functions of time and data for repeatable seeking; classes may group those functions without
storing playback history:

```js
// motion.js
export class Motion {
  static x(seconds, speed, start = 0) {
    return start + seconds * speed;
  }
}
```

```js
// Composition script: identical time/data produce the same position.
layer('Title').x = motion.Motion.x(time, data.speed, 25);
```

## Execution and portability

Expressions and scripts are trusted JavaScript executed synchronously by the host engine,
without a sandbox or timeout. `console.log`, `info`, `warn`, `error`, and `debug` appear in the Scripts tab console and the native console. The Studio log shows the source and frame, groups consecutive repeats, and retains the latest 200 entries. Clear removes the history; Pause logs stops collection without pausing playback. Log history is not saved with the project. Infinite loops can block
the host, and async work is unsupported for frame calculations. Use current frame/data values
rather than persistent counters or external side effects for deterministic playback.

Returned promises are rejected with a synchronous-only diagnostic and their rejections are
consumed. This does not contain detached asynchronous work started by trusted JavaScript.
Failed composition scripts discard their layer writes; module state and external side effects
are not rolled back. Active layer expressions retain compiled code (or syntax errors) until
their source changes, independently of the bounded cache used for standalone evaluations.

Source, enable flags, and modules survive `.ogs` reload and compiled `.ograf` export/import.
The exported descriptor embeds module source; the original files are not needed at playback.
[Sucrase](https://github.com/alangpierce/sucrase) handles module import/export syntax.
The current expression API is v1 and includes scalar and vector transforms, text expressions and
JSON resources. Future incompatible expression changes will introduce a new API version.
Unsupported versions report errors and retain sampled values. This is Studio's API version, not a
JavaScript language version.

The shared evaluator is used by Studio, SVG snapshots, and exported graphics. References use
the renderer's sampled layer boxes; scripting does not change text auto-sizing behavior.
Tests cover dependencies, errors, module loading, seeking, lifecycle timing, and export/import.

## Earlier extended expressions

Projects from the experimental extended-expression build still open. Expressions for retired
targets (including transform origins, text stroke, gradient stops, shaders and effects) are
preserved in the saved project's `legacyExpressions` metadata, including their original code
and enable state. They do not run or appear in the Scripts tab.
