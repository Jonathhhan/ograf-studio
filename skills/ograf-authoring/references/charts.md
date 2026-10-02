# Chart.js layers

Choose **Chart** above the canvas, then choose one of nine types in the visual gallery: bar,
horizontal bar, stacked bar, line, area, pie, doughnut, radar, or polar area. Properties has the
same gallery for later type changes, plus direct editors for series, rows, values, colors, label
size, legend, and grid. Advanced JSON is for bulk data edits.

For MCP, read `elementSchemas.chart` from `ograf_get_capabilities sections:["elements","editor"]`.
Create a chart with `add_layer.kind:"chart"`. Its `element.data` is JSON-safe:

```json
{
  "labels": ["North", "South"],
  "datasets": [
    {
      "label": "Viewers",
      "data": [5.2, 4.7],
      "backgroundColor": ["#38bdf8", "#818cf8"],
      "borderColor": "#38bdf8"
    }
  ]
}
```

Each dataset needs one finite number per label. Colors use `#RRGGBB`; a single background color
or one color per label is accepted. A chart layer's default size is 640 × 360. `fontSize` controls
axis/legend text in authored composition pixels (8–96), so use larger sizes on a full-HD canvas.
`showLegend`, `showGrid`, and `textColor` are ordinary static properties.

Bind target property `data` to a `textarea` GDD field containing the JSON object as text when
playout should replace labels/values. Validate and capture changed data with `dataOverrides`.
Chart.js animation and tooltip interaction are disabled in the exported runtime; use OGraf
keyframes for layer motion. Its Canvas drawing is deterministic under `goToTime` and requires an
HTML Canvas-capable renderer. The approximate SVG diagnostic does not show chart pixels. Use
browser capture and certify both real-time and non-real-time profiles before saving/exporting.
