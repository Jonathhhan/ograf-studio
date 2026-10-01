# Animate In / Out

Use `set_layer_motion` for Studio's Fade, Slide, Fly, and Focus entrance/exit presets. The operation
bakes ordinary x/y/opacity/blur keys; the exported OGraf graphic needs no preset runtime. At least
one Step is required. `side: "in"` writes between Start and the first Step; `side: "out"` writes
between the last Step and End. `durationFrames` must fit that window. The first/last Step's on-air
pose is retained. Reapplying replaces the selected side's keys; inspect for hand-authored motion
before doing so. `spec: null` clears that side to a cut/hold.

```json
{
  "type": "set_layer_motion",
  "layerName": "Headline",
  "side": "in",
  "spec": {
    "style": "slide",
    "direction": "left",
    "distance": 80,
    "durationFrames": 12,
    "easing": "cubic-out"
  }
}
```

`direction` is left/right/up/down for Slide and Fly; `distance` is pixels for Slide. Fade needs
neither. Focus needs the layer's built-in blur effect. Incoming easing applies to the end key for
In; outgoing easing applies to the End key for Out. The editor's feels are Smooth, Gentle,
Snappy, Overshoot, and Linear; MCP accepts the corresponding easing preset directly. Use
`ograf_get_capabilities sections:["easing"]` for the current catalog and
`ograf_get_timeline`/`ograf_render_strip` to review the baked keys and motion.
