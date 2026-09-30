# Visual rules

`set_layer_visual_rules` replaces one layer's ordered rules. Each rule has a trigger, optional
conditions, and ordered actions.

## Conditions

A data rule (default `trigger`) needs an existing `fieldId` in MCP. `sourcePath` is an optional
segment array into an object field. `operator` tests the value against `value` or, with
`compareFieldId`/`compareSourcePath`, against another field.

| Operator                                                         | Value                                          |
| ---------------------------------------------------------------- | ---------------------------------------------- |
| `equals`, `not-equals`                                           | Any; numbers and booleans coerce (`5` = `"5"`) |
| `greater-than`, `greater-or-equal`, `less-than`, `less-or-equal` | Number                                         |
| `between`                                                        | `[min, max]`, inclusive                        |
| `contains`, `not-contains`, `starts-with`, `ends-with`           | Text; `contains` on an array tests membership  |
| `one-of`, `not-one-of`                                           | List, or comma-separated text                  |
| `empty`, `not-empty`                                             | None                                           |
| `changed`, `increased`, `decreased`                              | None; need previous data                       |

`ignoreCase: true` makes text comparisons ignore letter case. `between` and the list operators
compare with a literal, not another field.

`conditions[]` adds comparisons with the same keys, combined with the primary condition by `match`
(`all` by default, or `any`). On non-data triggers they are a guard that must hold when the event
fires. Inside a runtime collection prototype, a condition on the collection's field reads the
current row item, so each row can style itself.

## Triggers

- `data` and `hover` are **states**: show/hide and property results hold while the conditions (or
  the pointer) hold and revert afterwards. One `hover` rule makes a hover highlight.
- `click`, `double-click`, `pointer-enter`, `pointer-leave` are pointer **events** on the owning
  layer. They run only in interactive real-time HTML, not on the Studio editing canvas or in
  non-real-time replay.
- `play` fires when the first step is reached, `step` when a step keyframe is reached (`eventId` is
  the step keyframe id; omit it for any step), `stop` when the graphic starts leaving, and
  `custom-action` when the custom action whose public `actionId` is in `eventId` runs.
- Data rules that use `changed`, `increased`, or `decreased` are events too.

Event results persist until a later rule replaces them. When a state rule starts matching, it takes
back the properties and visibility an earlier event set on the same targets. `delayFrames` delays
an event rule's actions. Playout triggers, delays and transitions replay deterministically in
non-real-time schedules; use a custom action for a remote or deterministic trigger instead of
pointer input.

## Actions

- `visibility` (`visible`), `toggle-visibility` (events only), and `property` (`targetProperty`,
  `value`) change the owning layer, or `targetLayerId`. A target inside the same collection
  prototype resolves to the same row; a target that is a prototype layer, set from outside the
  collection, drives every row. `transitionFrames` fades visibility, or animates numeric and colour
  property values; other values switch.
- `custom-action`, `shader-animation`, `play-sound`, and `take-media` trigger a custom action,
  shader animation, Sound Event, or Media Cue. A custom action started by a rule can fire
  `custom-action` rules again, up to a fixed depth.

Rules run after ordinary bindings, in layer order then rule order; when two matching state rules
set the same property on one target, the later one wins. Removing a layer, field, custom action,
media cue or step prunes the rule parts that referenced it; `remove_data_field` treats rules that
read the field as consumers and needs `force`.

## Example: tabs

```json
{
  "type": "set_layer_visual_rules",
  "layerName": "Tab A",
  "rules": [
    {
      "id": "tab-a-open",
      "name": "Open panel A",
      "enabled": true,
      "trigger": "click",
      "actions": [
        {
          "type": "visibility",
          "visible": true,
          "targetLayerId": "<Panel A id>",
          "transitionFrames": 8
        },
        { "type": "visibility", "visible": false, "targetLayerId": "<Panel B id>" }
      ]
    }
  ]
}
```

## Example: winner highlight

```json
{
  "id": "home-leads",
  "name": "Home leads",
  "enabled": true,
  "trigger": "data",
  "fieldId": "<home score field id>",
  "sourcePath": [],
  "operator": "greater-than",
  "compareFieldId": "<away score field id>",
  "actions": [
    { "type": "property", "targetProperty": "fill", "value": "#f5c542", "transitionFrames": 12 }
  ]
}
```
