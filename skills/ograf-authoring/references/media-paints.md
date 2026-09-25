# Media paints

Media is a moving-image fill clipped by the object's native geometry or alpha. It is a paint, not a
new layer kind: apply a complete object through `update_element.patch.fill` on rectangles, ellipses,
paths, patterns, text, images, image sequences, or Lottie.

Packaged or remote clip:

```json
{
  "type": "media",
  "source": { "kind": "clip", "src": "asset:clip-id" },
  "fit": "cover",
  "positionX": 0.5,
  "positionY": 0.5,
  "loop": true,
  "speed": 1,
  "offsetMs": 0,
  "muted": true
}
```

Live renderer input:

```json
{
  "type": "media",
  "source": {
    "kind": "live",
    "tag": "camera.program",
    "fallback": "asset:poster-id"
  },
  "fit": "cover",
  "positionX": 0.5,
  "positionY": 0.5,
  "loop": true,
  "speed": 1,
  "offsetMs": 0,
  "muted": true
}
```

Import MP4/WebM through Resources → Media or `ograf_import_asset`, then use its `asset:<id>`.
Remote clips require renderer internet/CORS access. Live paints emit the `zd-ograf-media` version 1
hook with `data-source-tag`; exported manifests declare `ZeroDensityHTML >= 1.0`. Generic renderers
show the optional image fallback or transparency.

The initial implementation is visual-only, muted, fill-only, and realtime-only. Disable project
non-real-time support and choose the realtime export profile. Media-painted layers may receive masks
and provide geometric path masks, but cannot supply an alpha mask. Clip seeking for deterministic
`goToTime()` and Media outlines are deferred.
