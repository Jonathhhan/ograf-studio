# Property expressions

[Using Studio](USER_GUIDE.md) · [Development](DEVELOPMENT.md)

Select a layer and open **Properties → Expressions**. Each expression controls one numeric
property: **X**, **Y**, **W** (width), **H** (height), **Rotation**, or **Opacity**. Use the checkbox
beside a property to disable its expression without deleting it. An empty expression uses the
normal sampled value from the layer and its animation.

Expressions run in the editor's browser preview and in exported OGraf graphics. They use a
real JavaScript. Expressions are trusted project code and can access the host environment.
Use expressions only from projects you trust. They run synchronously; an infinite loop can
block rendering. Return a finite number for the property value.

## API compatibility and stable references

Expression API **v1** defines the values and helpers documented here. Each composition stores one
`expressionApiVersion`, which is preserved by project migration and compiled export/import.
Existing compositions without a version use v1. All their expressions share that API version. Unsupported versions produce an error and retain
the sampled property; they are never silently executed with another API version.
The export embeds its runtime, so later Studio updates do not replace the evaluator in an
already exported graphic. This versions Studio's API, not the host's JavaScript engine.

Use `layerById("layer-id").width` when a reference must survive a layer rename. Choose a layer
under **Stable layer reference**, then copy the displayed code into an expression and append
the property. Name-based `layer("Name")` remains supported. IDs refer to the current composition.
Within runtime collections, authored prototype IDs resolve within the current item first,
then to global layers; they cannot address another item. Duplicating a layer does not rewrite
references in JavaScript source: an ID reference continues to address its original target.

### Debugging in Studio

`console.log`, `info`, `warn`, `error` and `debug` use the host's normal console.
In Studio, open the browser developer console to view these messages. Properties shows
expression errors inline, without a separate log panel. Console output may repeat on each
frame or evaluation. Exported graphics use the player environment's console.

```js
console.log('position', frame, thisLayer.x);
return thisLayer.x;
```

Local variables and helper context are recreated for every evaluation. The API is synchronous:
return a finite number, never a Promise. External side effects are possible but are not part of
the playback contract. Use pure calculations from supplied values for repeatable seeking.

## Start with a formula

In a text layer's X expression:

```js
layer('Rectangle').x + layer('Rectangle').width + 100;
```

This puts the text's X coordinate 100 pixels beyond the rectangle's right edge when both layers
use the same parent coordinate system and are unrotated. References do not convert between
different parent coordinate systems or calculate rotated visual bounds.

For longer expressions, use constants and an explicit return:

```js
const rect = layer('Rectangle');
return rect.x + rect.width + 100;
```

Use the layer's exact, unique name. Spaces, Unicode characters and quoted names are supported;
escape a quote inside a string, for example `layer("Headline \"Arabic\"").width`.
Renaming a layer does not rewrite references in expressions.
Guide layers are omitted from exports, so use ordinary layers for runtime references.

## Available values

| Value                                               | Meaning                                                                                                                       |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `x`, `y`, `width`, `height`, `rotation`, `opacity`  | This layer's sampled values before its expressions run.                                                                       |
| `thisLayer.x`, `thisLayer.width`, etc.              | Explicit access to those same pre-expression values, even if a local constant has the same name.                              |
| `layer("Name").x`, etc.                             | The named layer's final expression result for that property, or its sampled value when that expression is empty or disabled.  |
| `frame`                                             | Current composition timeline position in frames. Browser playback may supply fractional frames.                               |
| `time`                                              | The same timeline position in seconds: frame divided by composition frame rate.                                               |
| `comp.width`, `comp.height`                         | Composition dimensions in pixels.                                                                                             |
| `data.fieldKey`                                     | A scalar data field addressed by its key, not its display label.                                                              |
| `timeline.startFrame`, `timeline.endFrame`          | Authored Start and End positions.                                                                                             |
| `timeline.firstStepFrame`, `timeline.lastStepFrame` | Authored first and last Step positions; available only when at least one Step exists.                                         |
| `timeline.exitProgress`                             | Linear exit progress, 0–1. Uses the existing exit transition during playout and the last Step-to-End interval when scrubbing. |

Position and dimensions are in pixels, rotation is in degrees, and opacity is **0–1** (the UI
displays it as a percentage). Apply `clamp()` if you need to constrain a result.

The current layer's bare properties and `thisLayer` retain the sampled values, so `x + 100` adds
an offset to existing keyframe animation. `layer("This layer's name").x` instead requests the
computed X value and creates a circular dependency if used to compute that same X property.

Dependencies resolve per property, independently of layer ordering. A rectangle's width can
depend on a text layer's width while the text's X depends on the rectangle's computed width.
This is not a cycle unless a property eventually depends on itself.

Data keys must be valid identifiers, such as `xPos` or `Alphabet`. Numbers remain numbers,
select/text values are strings, and boolean fields are exposed as **1** or **0**. Object/array
fields and nested data paths are not exposed. Examples:

```js
return data.Alphabet == 'Arabic' ? 200 : 100;
```

```js
if (data.fade == 0) return 1;
return clamp(frame / 10, 0, 1);
```

`frame` and `time` follow the composition playhead, not elapsed wall-clock time. They hold when
playback pauses at a Step. Changing transition durations changes the timeline boundary values;
expressions do not move Steps or redefine their durations. With one Step, first and last are
the same position. With multiple Steps, the interval between them can be used as a hold.

### Integration with OGraf playback

Studio's existing OGraf lifecycle is the timing authority. `playAction()` advances to a Step,
`stopAction()` exits, and scheduled actions plus `goToTime()` reproduce that lifecycle when
seeking. Expressions read the resulting composition playhead and the existing compiled Step
positions. They do not create Steps, change transition durations or start another clock.

OGraf action-schedule timestamps are milliseconds and may include an arbitrarily long hold.
Expression `time` is the composition playhead in seconds. For example, if an entrance reaches
the first Step after one second and holds there, a schedule timestamp of 2,500 ms still produces
`time = 1`. The next action resumes movement from that Step.

Use `time` when seconds are convenient, and `frame` with `timeline.*Frame` for frame-based
calculations. The latter values remain frames; do not subtract them directly from `time`.
There are no `timeline.*Time` aliases or separate expression-driven timing settings.

On a multi-Step graphic, `stopAction()` can exit from an earlier Step directly to End.
The composition playhead then traverses that earlier position to End over the exit duration.
A formula anchored to `timeline.lastStepFrame` therefore does not necessarily animate for the
whole exit: it can hold until that boundary is crossed. For an exit from any Step, use
`timeline.exitProgress` instead. It reads the existing direct lifecycle transition during
playout and scheduled seeking, without changing `frame` or `time`. It is linear; apply easing
explicitly. While scrubbing, it follows the last Step-to-End interval. With no Steps it follows
Start-to-End. A zero-duration interval switches to 1 at End.

For example, fade out across the full exit, even when stopped at an earlier Step:

```js
return ease(1, 0, timeline.exitProgress, 'quad-in');
```

## Interpolation and easing

| Function                               | Behavior                                                                          |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `lerp(start, end, progress)`           | Linear interpolation. Progress is not clamped, so values outside 0–1 extrapolate. |
| `clamp(value, minimum, maximum)`       | Constrains a number to a range. Supply minimum ≤ maximum.                         |
| `ease(start, end, progress, "preset")` | Uses the same easing sampler as the keyframe preset.                              |

`ease()` requires an explicit preset and clamps input progress to 0–1. Back and elastic presets
can still produce output overshoot; that is part of their curve.

Preset names:

- `linear`
- `ease-in`, `ease-out`, `ease-in-out` (aliases for the corresponding quadratic curves)
- Each of `quad`, `cubic`, `quart`, `quint`, `sine`, `expo`, `circ`, `back`, `bounce`, `elastic`
  with `-in`, `-out` or `-in-out`, for example `quad-out` or `elastic-in-out`.

Preset names are case-sensitive strings. A string data field can also supply the preset:

```js
return ease(0, 300, frame / 20, data.easing);
```

Expressions do not automatically inherit the easing dropdown selection. Choose the preset in
the expression. To keep easing already applied to the underlying keyframes, use a sampled value
such as `thisLayer.x` instead of rebuilding that animation from `frame`.

## Enter with Quad Out, exit with Quad In

Put this in X to slide a text layer in from beyond the rectangle's right edge, stop 100 pixels
inside its left edge, and exit to the right. The durations follow the first and last timeline
Steps. Zero-duration transitions are handled without division by zero.

```js
const rect = layer('Rectangle');
const inFrames = timeline.firstStepFrame - timeline.startFrame;
const outFrames = timeline.endFrame - timeline.lastStepFrame;
const enter = inFrames > 0 ? ease(0, 1, (frame - timeline.startFrame) / inFrames, 'quad-out') : 1;
const exit =
  outFrames > 0
    ? ease(1, 0, (frame - timeline.lastStepFrame) / outFrames, 'quad-in')
    : frame < timeline.endFrame
      ? 1
      : 0;
return rect.x + 100 + rect.width * (1 - enter * exit);
```

For opacity, use the same timing constants and return `enter * exit`. If a boolean `fade` data
field controls the fade, put `if (data.fade == 0) return 1;` first.

For an animated rectangle width, use the same timing constants and replace the final return:

```js
const minimum = layer('Rectangle').height;
const fullWidth = clamp(layer('Text').width + 150, minimum, comp.width * 0.9);
return lerp(minimum, fullWidth, enter * exit);
```

Use `lerp()` for that final interpolation: the progress has already been eased.
This example assumes playback reaches the last Step before exiting; see the early-exit
limitation above.

## A rectangle that follows text dimensions

Enable **Auto size** on the text layer. The browser renderer exposes its measured box after text
and font data are applied. For a rectangle with 100 pixels left padding, 50 right, and 30 above
and below, use these separate expressions:

Width:

```js
return layer('Text').width + 150;
```

Height:

```js
return layer('Text').height + 60;
```

Text X and Y:

```js
return layer('Rectangle').x + 100;
```

```js
return layer('Rectangle').y + 30;
```

Use the browser preview or exported graphic to check measured typography. The server's SVG
diagnostic renderer shares expression semantics but has no browser text measurement: text
dimensions there come from its sampled layer geometry.

## JavaScript syntax

Use a single formula (with an optional trailing semicolon), or a JavaScript function body
with an explicit `return`. Standard JavaScript features work, including `Math`, `let`, loops,
functions, arrays, objects, template strings, logical operators and dynamic `layer(name)` calls.
Normal JavaScript truthiness, comparisons and type conversion apply. The final value must be
a finite number; boolean, string, object and Promise results are rejected.

Local variables start fresh on each evaluation. For repeatable playback and seeking, derive
results from the supplied `frame`, `time`, data and layer values. Avoid wall-clock time,
randomness and external state. Browser-only APIs are unavailable in the server SVG renderer.

## Errors and troubleshooting

The expression field displays grammar errors and runtime errors from the current Studio canvas
evaluation inline. A syntactically valid expression can still fail when a layer is missing, names
are duplicated, a data key is unavailable, types do not match, or the result is not finite.
Runtime messages clear after correction or disabling. They reflect the current frame and test
data, so they cannot certify all future data combinations. Exported graphics retain the same
fallback behavior without drawing editor diagnostics over the graphic.

On failure, the property retains its sampled pre-expression value. Dependent properties also
fall back; unrelated properties continue evaluating. Thrown errors and invalid results are caught; non-terminating code cannot be recovered this way. Disable the checkbox to compare against the sampled value.

If a formula appears to do nothing, check its checkbox, exact layer names, data **keys**, and
whether its result differs from the sampled value. Check references for cycles. Use a guard
before division by a potentially zero duration. Syntax success is not a guarantee that every
runtime data combination is valid.

### Collections and canvas editing

- In an expanded runtime collection, `layer("Name")` looks in the current item first, then
  among top-level layers. Other items and collections are not visible to that lookup. A duplicate
  name inside the same item is still an error; it does not fall through to a global layer.
  Top-level expressions cannot address collection instances by prototype name. Test expanded
  collections in Preview & Export; the authoring canvas edits prototypes.
- Bare properties and `thisLayer` use the current instance's sampled pose, including its item
  offset. Named references use the sibling's computed pose; do not add the item offset again.
  `data` still refers to top-level scalar data fields; there is no item data expression scope.
- Canvas snapping reads rendered positions and box sizes, including expression results and
  auto-sized text. It retains Studio's axis-aligned guide and pixel-rounding behavior.
  Dragging edits authored values; a formula that replaces X or Y without using those values
  will override that edit.

## Implementation and tests

The scene-model package owns the JavaScript expression compiler and the shared per-property dependency
resolver. SVG rendering and browser runtime rendering provide their own sampled geometry to
that resolver. Exported descriptors preserve expression source and individual enable flags.
Compiled-package import restores both even when no embedded Studio project is present.
These are Studio implementation details carried in the graphic's JavaScript module, not new
fields or methods required of an OGraf controller. The existing
[OGraf Step model and actions](https://ograf.ebu.io/v1/specification/docs/Specification.html#step-model)
remain in charge of playback.

Compilation is cached for up to 256 distinct expressions; evaluation has fresh local scope
on every call, including recursive references. Property dependency chains remain limited to
128 active evaluations. JavaScript executes directly in the host, without a sandbox or timeout.

Run the focused checks with:

```sh
npx vitest run expressions expressionTransforms easingOptions buildRuntimeTimeline renderFrame compileDescriptor
```

Coverage includes timeline changes, fractional and backward seeking, easing parity, independent
scopes, escaped names, duplicate names, disabled expressions, cycles, export preservation and
SVG/runtime semantics. Browser text metrics and target-player appearance still need visual QA.
