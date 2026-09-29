# Composition script properties

Property expressions expose Position, Size, and Transform Origin as array fields, with numeric
Rotation and Opacity. Composition scripts can read
and assign the rendered properties below using `layer('Name')` or `layerById('id')`.
The Scripts tab's **Composition & modules → Script properties** list follows the selected layer.
The shared property catalog drives this list, editor completion, writable element members and
their type/enum validation. The reference shows read-only members explicitly; a read-only
`element` reference still permits writes to its supported properties. Nested paint and effect
structures retain their specialized validation.

```js
const title = layer('Title');
title.content = data.headline;
title.fontFamily = data.language === 'Arabic' ? 'Noto Sans Arabic' : 'Arial';
title.textAlign = data.language === 'Arabic' ? 'right' : 'left';
title.fontSize = 64;
title.effects.blur = 2;
title.opacity = 0.8;
console.log(title.properties());
```

Scripts run after data bindings, animation sampling and property expressions. Reads see earlier
assignments in the same script. Each frame starts from authored/data-bound values; writes do not
accumulate, change keyframes, or modify the saved project. Disabling the script restores authored
rendering. Invalid writes or thrown errors roll back the entire script for that frame.

## Common properties

| Properties                                         | Value                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x`, `y`, `width`, `height`, `rotation`, `opacity` | Finite number; pixels, degrees, and 0–1 opacity                                                                                                    |
| `transformOriginX`, `transformOriginY`             | Finite number; normalized origin                                                                                                                   |
| `position`                                         | `[x, y]` in pixels; a live alias for the existing scalar fields.                                                                                   |
| `size`                                             | `[width, height]` in pixels; changes the layout box, not visual scale.                                                                             |
| `transformOrigin`                                  | Normalized pivot `[x, y]`, each component in the `0..1` range.                                                                                     |
| `isVisible`                                        | Boolean                                                                                                                                            |
| `blendMode`                                        | `normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion` |
| `effects`                                          | Effect settings described below                                                                                                                    |
| `element`                                          | Readable object with writable members for the current element type                                                                                 |
| `id`, `name`, `type`                               | Read-only layer identity and element type                                                                                                          |

Vector aliases support whole-pair assignments and indexed writes such as `title.position[0] = 100`.
They accept finite numbers, retain two components, and are read-only in property expressions.
`transformOrigin` writes require components in the `0..1` range. These aliases do not alter
the saved scene format; scalar access remains supported. `properties()` lists the aliases while
ordinary object enumeration keeps its existing scalar fields.

Element properties have direct aliases: `title.fontSize` and `title.element.fontSize` refer
to the same value. A legacy shader's resource name uses `element.name`; `name` always identifies
the layer. Layer type, IDs and pattern resource IDs are read-only. Project structure, parent/group
links, masks, bindings, keyframes, constraints and editor flags are outside this per-frame API.

## Text

| Properties                                                                                             | Value                                                            |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `content`, `color`, `strokeColor`, `fontFamily`                                                        | String                                                           |
| `fontSize`, `fontWeight`, `strokeWidth`, `lineHeight`, `letterSpacing`, `baselineShift`, `minFontSize` | Finite number                                                    |
| `textAlign`                                                                                            | `left`, `center`, `right`                                        |
| `verticalAlign`                                                                                        | `top`, `middle`, `bottom`                                        |
| `textTransform`                                                                                        | `none`, `uppercase`, `lowercase`, `capitalize`                   |
| `overflowPolicy`                                                                                       | `visible`, `clip`, `ellipsis`                                    |
| `autoFit`                                                                                              | `auto-size`, `shrink-to-fit`, `fit-to-width`, `squeeze`, `fixed` |
| `fill`                                                                                                 | Colour string, gradient or shader paint                          |
| `strokePaint`                                                                                          | Shader paint                                                     |

## Shapes and paths

| Layer type | Properties                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------- |
| Rectangle  | `fill`, `strokeColor`, `strokeWidth`, `borderRadius`                                               |
| Ellipse    | `fill`, `strokeColor`, `strokeWidth`                                                               |
| Path       | `d`, `fill`, `fillRule`, `strokeColor`, `strokeWidth`, `viewBoxWidth`, `viewBoxHeight`, `overflow` |
| Pattern    | `fill`, `strokeColor`, `strokeWidth`, `definition`                                                 |

`borderRadius` contains numeric `topLeft`, `topRight`, `bottomRight`, `bottomLeft` members.
`fillRule` is `nonzero` or `evenodd`; `overflow`, when present, is `visible`.
Pattern `definition` is the compiled pattern object: existing layout, timing, symbol, sequence,
row override and lighting members can be edited. Resource identity remains unchanged.

## Paint

A gradient contains `type` (`linear`, `radial`, `conic`), numeric `angle`, and at least two
`stops`. Each stop has `offset`, `color`, and `opacity`.

```js
const background = layer('Background');
background.fill = {
  type: 'linear',
  angle: 90,
  stops: [
    { offset: 0, color: '#003366', opacity: 1 },
    { offset: 1, color: '#00aaff', opacity: 1 },
  ],
};
background.fill.stops[0].color = '#ff8800';
```

A shader paint contains `type: 'shader'`, `fragmentSource`, `speed`, `resolutionScale`,
`parameters`, and optional `inputImage`. Parameters use numbers, booleans or number arrays.
An image input contains `source`, optional `name`, `wrap` and `filter`.
Use existing shader parameter names, for example `layer('Background').fill.parameters.amount = 0.5`.
Changing shader source or media data can rebuild the renderer; prefer changing parameters.

## Effects

`effects` exposes `blur`, `dropShadowEnabled`, `dropShadowColor`, `dropShadowOpacity`,
`dropShadowOffsetX`, `dropShadowOffsetY`, `dropShadowBlur`, and optional ordered `stack`.

Each stack entry contains `id`, `name`, `type`, `enabled`, `params`, optional `blendMode`,
`blendOpacity`, and `shader`. Existing entry IDs and types cannot be assigned through nested setters.
Replace a complete, valid stack to change its structure. Legacy-linked entries also retain `legacy`.

| Effect type                    | `params` members                                       |
| ------------------------------ | ------------------------------------------------------ |
| Blur                           | `radius`                                               |
| Drop shadow                    | `offsetX`, `offsetY`, `radius`, `color`, `opacity`     |
| Glow                           | `radius`, `color`, `opacity`                           |
| Brightness, contrast, saturate | `amount`                                               |
| Hue rotate                     | `angle`                                                |
| Shader                         | Shader-specific settings in the entry's `shader` paint |

```js
const title = layer('Title');
const glow = title.effects.stack?.find((effect) => effect.type === 'glow');
if (glow) {
  glow.enabled = true;
  glow.params.color = '#ffcc00';
  glow.params.radius = 16;
}
```

## Images and animation

| Layer type          | Properties                                                                               |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Image               | `src` (URL string or null), optional shader `fill`                                       |
| Image sequence      | `frames` (URL strings), `fps`, `loop`, optional shader `fill`                            |
| Lottie              | `animationData` (embedded Lottie object or null), `speed`, optional shader `fill`        |
| Legacy shader layer | `element.name`, `fragmentSource`, `speed`, `resolutionScale`, `parameters`, `inputImage` |

Use runtime-ready URLs for media, including embedded data URLs. Per-frame scripts cannot import
files or resolve Studio asset IDs. Arrays and objects must contain finite, acyclic JSON data;
replace arrays to remove entries. Values assigned from another object are copied.

## Sampling

`property('x').valueAtTime(seconds)` and the other five expression properties retain their
existing sampling API. `sourceRectAtTime(seconds, includeExtents)` measures after text expressions
and after any earlier visual or layout writes in the current composition script. Visual assignments
do not recursively run scripts or alter historical samples.
SVG diagnostic captures retain their existing shader/Lottie rendering limitations; browser
preview and exported graphics use the shared media renderer.
