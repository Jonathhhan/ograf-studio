import {
  TEXT_ANIMATION_LABELS,
  textAnimationSplit,
  type CustomActionDefinition,
  type TextAnimation,
} from '@ograf-editor/scene-model';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { PropertyRow } from '../components/PropertyRow';

interface TextAnimationEditorProps {
  animation: TextAnimation;
  unitCount: number;
  frameRate: number;
  customActions: CustomActionDefinition[];
  onChange: (patch: Partial<TextAnimation>) => void;
}

export function TextAnimationEditor({
  animation,
  unitCount,
  frameRate,
  customActions,
  onChange,
}: TextAnimationEditorProps) {
  return (
    <CollapsibleSection
      sectionId="properties.text-animation"
      title={
        animation.type === 'none'
          ? 'Text animation'
          : `Text animation · ${TEXT_ANIMATION_LABELS[animation.type]}`
      }
      defaultOpen={false}
    >
      <PropertyRow
        help="Animate text segments from the lifecycle Start frame. The complete text stays measured while the animation plays."
        className="inspector-row"
      >
        <span>Effect</span>
        <select
          aria-label="Animation effect"
          value={animation.type}
          onChange={(event) => onChange({ type: event.target.value as TextAnimation['type'] })}
        >
          <option value="none">None</option>
          <option value="typewriter">Typewriter</option>
          <option value="fade">Fade in</option>
          <option value="rise">Rise in</option>
          <option value="pop">Pop in</option>
          <option value="word-reveal">Word reveal</option>
        </select>
      </PropertyRow>
      {animation.type !== 'none' ? (
        <>
          <PropertyRow
            help="Grapheme mode preserves emoji and combining marks. Word mode reveals complete words and punctuation tokens."
            className="inspector-row"
          >
            <span>Split by</span>
            <select
              aria-label="Text animation split unit"
              value={textAnimationSplit(animation)}
              disabled={animation.type === 'word-reveal'}
              onChange={(event) =>
                onChange({ split: event.target.value as TextAnimation['split'] })
              }
            >
              <option value="grapheme">Characters</option>
              <option value="word">Words</option>
            </select>
          </PropertyRow>
          <PropertyRow
            help="Animation duration in composition frames. Timeline scrubbing and exported playback sample this exact duration."
            className="inspector-row"
          >
            <span>Duration</span>
            <input
              aria-label="Text animation duration frames"
              type="number"
              min={1}
              step={1}
              value={animation.durationFrames}
              onChange={(event) =>
                onChange({
                  durationFrames: Math.max(1, Math.round(Number(event.target.value))),
                })
              }
            />
            <span>f</span>
          </PropertyRow>
          {animation.type === 'typewriter' ? (
            <PropertyRow
              help="Convert the current sample text's typing speed into a fixed frame duration."
              className="inspector-row"
            >
              <span>Typing speed</span>
              <input
                aria-label="Typewriter units per second"
                type="number"
                min={0.1}
                step={0.5}
                value={Number((unitCount / (animation.durationFrames / frameRate)).toFixed(2))}
                onChange={(event) => {
                  const unitsPerSecond = Math.max(0.1, Number(event.target.value));
                  onChange({
                    durationFrames: Math.max(
                      1,
                      Math.round((unitCount / unitsPerSecond) * frameRate),
                    ),
                  });
                }}
              />
              <span>/s</span>
            </PropertyRow>
          ) : null}
          {animation.type === 'typewriter' ? (
            <PropertyRow
              help="Optional deterministic cursor rendered by the graphic, separate from the editor's text caret."
              className="inspector-row"
            >
              <span>Cursor</span>
              <select
                aria-label="Typewriter cursor"
                value={animation.cursor}
                onChange={(event) =>
                  onChange({ cursor: event.target.value as TextAnimation['cursor'] })
                }
              >
                <option value="none">None</option>
                <option value="bar">Bar</option>
                <option value="block">Block</option>
              </select>
            </PropertyRow>
          ) : null}
          {animation.type === 'typewriter' && animation.cursor !== 'none' ? (
            <PropertyRow
              help="Cursor blink period in composition frames; it remains repeatable during backward seeking."
              className="inspector-row"
            >
              <span>Blink period</span>
              <input
                aria-label="Typewriter cursor blink frames"
                type="number"
                min={1}
                step={1}
                value={animation.cursorBlinkFrames}
                onChange={(event) =>
                  onChange({
                    cursorBlinkFrames: Math.max(1, Math.round(Number(event.target.value))),
                  })
                }
              />
              <span>f</span>
            </PropertyRow>
          ) : null}
          <PropertyRow
            help="Replay from the beginning when updateAction changes the data field bound to this text content."
            className="inspector-row"
          >
            <span>Replay on update</span>
            <input
              aria-label="Replay text animation on data update"
              type="checkbox"
              checked={animation.replayOnUpdate}
              onChange={(event) => onChange({ replayOnUpdate: event.target.checked })}
            />
          </PropertyRow>
          <PropertyRow
            help="An OGraf customAction can replay the effect without changing lifecycle state. Create and name actions in Data → Custom Actions."
            className="inspector-row"
          >
            <span>Replay action</span>
            <select
              aria-label="Text animation replay custom action"
              value={animation.customActionId ?? ''}
              onChange={(event) => onChange({ customActionId: event.target.value || null })}
            >
              <option value="">None</option>
              {customActions.map((action) => (
                <option key={action.id} value={action.actionId}>
                  {action.name} ({action.actionId})
                </option>
              ))}
            </select>
          </PropertyRow>
          <p className="inspector-hint">
            The initial reveal starts at frame 0. Keep its duration inside the IN transition if it
            should be complete at the first OGraf Step.
          </p>
        </>
      ) : null}
    </CollapsibleSection>
  );
}
