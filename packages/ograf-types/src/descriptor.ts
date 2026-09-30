// The runtime-facing "compiled" contract between packages/codegen (producer: Project ->
// CompiledGraphicDescriptor) and packages/ograf-runtime (consumer: GraphicElement interprets
// one). Lives here, not in either of those packages, specifically to avoid a dependency cycle —
// codegen depends on ograf-runtime (to bundle its built output into an exported main.js), so
// ograf-runtime can't depend back on codegen just to import this type.
//
// Element/LayerTransform/EasingPreset are the editor's own authoring types (from scene-model) —
// reused here as-is rather than duplicated, since a compiled layer's element/pose shape is
// identical to an authored one, just flattened out of the Project/Composition tree.
import type {
  AnimatableLayerProperty,
  EasingPreset,
  CubicBezierCurve,
  Element,
  KeyframeRole,
  LayerEffects,
  BlendMode,
  LayerTransform,
  LayerLoopClip,
  GradientPaint,
  MediaCue,
} from '@ograf-editor/scene-model';

export interface CompiledLayerBinding {
  dataKey: string;
  targetProperty: string;
  sourcePath?: string[];
  /** Runtime-expanded collection item index; absent for ordinary/object bindings. */
  itemIndex?: number;
  valueMap?: Record<string, string | number | boolean | GradientPaint>;
}

/** A data comparison with field ids resolved to the runtime data keys. */
export interface CompiledVisualRuleCondition {
  dataKey: string;
  sourcePath: string[];
  operator: import('@ograf-editor/scene-model').VisualRuleOperator;
  value?: unknown;
  compareDataKey?: string;
  compareSourcePath?: string[];
  ignoreCase?: boolean;
}

export interface CompiledLayerVisualRule extends CompiledVisualRuleCondition {
  id: string;
  name: string;
  enabled: boolean;
  trigger?: import('@ograf-editor/scene-model').VisualRuleTrigger;
  conditions?: CompiledVisualRuleCondition[];
  match?: import('@ograf-editor/scene-model').VisualRuleMatch;
  eventId?: string;
  delayFrames?: number;
  /** Action targets are compiled layer ids; guide and other omitted targets are dropped. */
  actions: import('@ograf-editor/scene-model').VisualRuleAction[];
}

export interface CompiledFontResource {
  family: string;
  source: string;
  mimeType: string;
  weight?: string;
  style?: 'normal' | 'italic' | 'oblique';
}

export interface CompiledLayer {
  id: string;
  isVisible: boolean;
  blendMode?: BlendMode;
  element: Element;
  effects: LayerEffects;
  /** Independently timed transform keys on the shared composition frame ruler. */
  keyframes: CompiledLayerKeyframe[];
  animationTracks: Partial<Record<AnimatableLayerProperty, CompiledLayerPropertyKeyframe[]>>;
  /** Deterministic local property clip; authoring IDs are retained only for source correlation. */
  loop?: LayerLoopClip | null;
  /** Resolved shared controller; source curves and paint remain independent. */
  lighting?:
    | (import('@ograf-editor/scene-model').PatternLightingLink & {
        definition: import('@ograf-editor/scene-model').TilingPattern;
      })
    | null;
  /** Ordered bindings; each target property may appear at most once. */
  bindings: CompiledLayerBinding[];
  /** Legacy editor-generated descriptors before document v11. */
  binding?: CompiledLayerBinding | null;
  visualRules?: CompiledLayerVisualRule[];
  /** Runtime-only clipping relation; general authoring parent metadata remains compiled away. */
  clipParentId?: string | null;
  /** Runtime flow relation retained only when the parent owns Auto layout. */
  layoutParentId?: string | null;
  autoLayout?: import('@ograf-editor/scene-model').LayerAutoLayout;
  updateTransition?: import('@ograf-editor/scene-model').LayerUpdateTransition;
  motionPath?: import('@ograf-editor/scene-model').LayerMotionPath | null;
  isMaskOnly?: boolean;
  mask?: import('@ograf-editor/scene-model').LayerMask | null;
  /** Runtime-only visibility/data identity for one bounded collection slot. */
  collectionItem?: {
    collectionId: string;
    dataKey: string;
    slot: number;
    capacity: number;
    itemKeyPath: string[];
    sortPath: string[];
    sortDirection: 'none' | 'ascending' | 'descending';
    pageSize: number;
    page: number;
    offsetPerItem: { x: number; y: number };
    /** Authored layer this row copies; rules aimed at the prototype drive every row. */
    prototypeLayerId?: string;
  };
}

export interface CompiledRuntimeCollection {
  id: string;
  name: string;
  dataKey: string;
  prototypeGroupId?: string | null;
  prototypeLayers: CompiledLayer[];
  offsetPerItem: { x: number; y: number };
  capacity: number;
  overflow: 'truncate';
  itemKeyPath: string[];
  sortPath: string[];
  sortDirection: 'none' | 'ascending' | 'descending';
  pageSize: number;
  page: number;
}

export type CompiledPaintOrderEntry =
  { type: 'layer'; id: string } | { type: 'collection'; id: string };

export interface CompiledLayerPropertyKeyframe {
  id: string;
  frame: number;
  value: number;
  easing: EasingPreset;
  curve?: CubicBezierCurve;
}

export interface CompiledLayerKeyframe {
  id: string;
  frame: number;
  transform: LayerTransform;
  easing: EasingPreset;
}

export interface CompiledKeyframe {
  id: string;
  /** Precomputed cumulative frame position — the runtime never re-derives this. */
  frame: number;
  role: KeyframeRole;
}

export interface CompiledTransition {
  fromKeyframeId: string;
  toKeyframeId: string;
  durationFrames: number;
  easing: EasingPreset;
}

export interface CompiledCustomActionRef {
  /** The OGraf customAction id (FieldDefinition/CustomActionDefinition's `actionId`, resolved). */
  id: string;
  name: string;
  /** Longest authored custom-action clip, used for manifest scheduling metadata. */
  durationFrames: number;
}

/** A flattened, runtime-ready representation of a Composition — what `GraphicElement` interprets. */
export interface CompiledGraphicDescriptor {
  width: number;
  height: number;
  backgroundColor: string;
  frameRate: number;
  updateTransitionFrames?: number;
  updateInterruption?: 'queue' | 'replace';
  fonts?: CompiledFontResource[];
  mediaCues?: MediaCue[];
  layers: CompiledLayer[];
  /** Bounded array-driven prototypes expanded by the packaged runtime. */
  collections?: CompiledRuntimeCollection[];
  /** Stable interleaving of ordinary layers and runtime collections. */
  paintOrder?: CompiledPaintOrderEntry[];
  keyframes: CompiledKeyframe[];
  transitions: CompiledTransition[];
  /** The pausable states `playAction` navigates, in order. */
  stepKeyframeIds: string[];
  /** `stepKeyframeIds.length` — mirrored here because it is what the manifest publishes. */
  stepCount: number;
  startKeyframeId: string;
  endKeyframeId: string;
  /** Valid `customAction(id)` targets — GraphicElement rejects anything not in this list. */
  customActions: CompiledCustomActionRef[];
}
