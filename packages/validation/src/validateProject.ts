import {
  scriptingErrors,
  isGradientPaint,
  isMediaPaint,
  isShaderPaint,
  getElementFill,
  getElementShaderPaint,
  getElementShaderPaints,
  migrateShaderBindingTarget,
  parseShaderAnimationProperty,
  shaderAnimationPropertySpec,
  shaderAnimationValueErrors,
  normalizeTextAnimation,
  isVisualRuleEdgeDataRule,
  visualRuleRange,
  VISUAL_RULE_EVENT_OPERATORS,
  VISUAL_RULE_OPERATOR_VALUES,
  VISUAL_RULE_TRIGGER_VALUES,
  type VisualRuleOperator,
  type VisualRuleTrigger,
} from '@ograf-editor/scene-model';

const VISUAL_RULE_TRIGGERS: ReadonlySet<VisualRuleTrigger> = new Set(VISUAL_RULE_TRIGGER_VALUES);
const VISUAL_RULE_OPERATORS: ReadonlySet<VisualRuleOperator> = new Set(VISUAL_RULE_OPERATOR_VALUES);
import {
  effectStackErrors,
  parseEffectProperty,
  effectParameterSpec,
} from '@ograf-editor/scene-model';
import {
  layerMaskErrors,
  tilingPatternErrors,
  layerLightingErrors,
  stylePackColorLinkErrors,
  applyDesignTokenBinding,
  BLEND_MODES,
  inspectLottieAnimationData,
  parseChartData,
  chartAnimationErrors,
  inspectShaderElement,
  inspectShaderSource,
  normalizeShaderParameterValue,
  valueAtSourcePath,
  getLayerAnimatableProperties,
  gradientStopIndexForProperty,
  getResolvedLayerAnimationTracks,
  getTotalFrames,
  fieldDefinitionAtPath,
  validatePaint,
  mediaPaintAssetReferences,
  type Composition,
  type FieldDefinition,
  type Project,
} from '@ograf-editor/scene-model';

export interface ProjectValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicate = new Set<string>();
  for (const value of values) (seen.has(value) ? duplicate : seen).add(value);
  return [...duplicate];
}

function validateFieldDefinition(field: FieldDefinition, owner: string, errors: string[]): void {
  for (const duplicate of duplicates(field.properties.map((property) => property.key))) {
    errors.push(`${owner}: repeats object property key "${duplicate}".`);
  }
  if (field.type === 'object') {
    if (field.items !== null) errors.push(`${owner}: object fields cannot declare array items.`);
    for (const property of field.properties) {
      if (!property.key.trim()) errors.push(`${owner}: object property keys cannot be empty.`);
      validateFieldDefinition(property, `${owner}.${property.key || '<empty>'}`, errors);
    }
  } else if (field.properties.length > 0) {
    errors.push(`${owner}: only object fields can declare properties.`);
  }
  if (field.type === 'array') {
    if (!field.items) errors.push(`${owner}: array fields require an item schema.`);
    else validateFieldDefinition(field.items, `${owner}[]`, errors);
  } else if (field.items !== null) {
    errors.push(`${owner}: only array fields can declare an item schema.`);
  }

  const optionValues = field.options.map((option) => option.value);
  for (const duplicate of duplicates(optionValues)) {
    errors.push(`${owner}: repeats select option value "${duplicate}".`);
  }
  if ((field.type === 'select' || field.type === 'select-multiple') && field.options.length === 0) {
    errors.push(`${owner}: select fields require at least one option.`);
  }
  if (field.options.some((option) => !option.value.trim() || !option.label.trim())) {
    errors.push(`${owner}: select option values and labels cannot be empty.`);
  }
  if (field.type === 'select' && !optionValues.includes(String(field.defaultValue))) {
    errors.push(`${owner}: select default must match one declared option.`);
  }
  if (
    field.type === 'select-multiple' &&
    (!Array.isArray(field.defaultValue) ||
      field.defaultValue.some(
        (value) => typeof value !== 'string' || !optionValues.includes(value),
      ))
  ) {
    errors.push(`${owner}: select-multiple defaults must be declared option values.`);
  }
  if (
    (field.type === 'integer' || field.type === 'duration-ms') &&
    (!Number.isInteger(field.defaultValue) ||
      (Number(field.defaultValue) < 0 && field.type === 'duration-ms'))
  ) {
    errors.push(
      `${owner}: ${field.type} default must be ${field.type === 'duration-ms' ? 'a non-negative ' : 'an '}integer.`,
    );
  }
  if (
    (field.type === 'number' || field.type === 'percentage') &&
    (typeof field.defaultValue !== 'number' || !Number.isFinite(field.defaultValue))
  ) {
    errors.push(`${owner}: numeric default must be finite.`);
  }
  const constraints = field.constraints;
  for (const key of ['minLength', 'maxLength'] as const) {
    const value = constraints[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${owner}: ${key} must be a non-negative integer.`);
    }
  }
  for (const key of ['minItems', 'maxItems'] as const) {
    const value = constraints[key];
    if (value !== undefined && (!Number.isInteger(value) || value < 0)) {
      errors.push(`${owner}: ${key} must be a non-negative integer.`);
    }
  }
  if (
    constraints.minLength !== undefined &&
    constraints.maxLength !== undefined &&
    constraints.minLength > constraints.maxLength
  ) {
    errors.push(`${owner}: minLength cannot exceed maxLength.`);
  }
  if (
    constraints.minimum !== undefined &&
    constraints.maximum !== undefined &&
    constraints.minimum > constraints.maximum
  ) {
    errors.push(`${owner}: minimum cannot exceed maximum.`);
  }
  if (
    constraints.minItems !== undefined &&
    constraints.maxItems !== undefined &&
    constraints.minItems > constraints.maxItems
  ) {
    errors.push(`${owner}: minItems cannot exceed maxItems.`);
  }
  if (
    constraints.step !== undefined &&
    (!Number.isFinite(constraints.step) || constraints.step <= 0)
  ) {
    errors.push(`${owner}: step must be a positive finite number.`);
  }
  if (constraints.pattern) {
    try {
      new RegExp(constraints.pattern);
    } catch {
      errors.push(`${owner}: pattern is not a valid regular expression.`);
    }
  }
  if (typeof field.defaultValue === 'string') {
    if (constraints.minLength !== undefined && field.defaultValue.length < constraints.minLength) {
      errors.push(`${owner}: default is shorter than minLength.`);
    }
    if (constraints.maxLength !== undefined && field.defaultValue.length > constraints.maxLength) {
      errors.push(`${owner}: default exceeds maxLength.`);
    }
    if (constraints.pattern) {
      try {
        if (!new RegExp(constraints.pattern).test(field.defaultValue)) {
          errors.push(`${owner}: default does not match pattern.`);
        }
      } catch {
        // The invalid pattern is reported above.
      }
    }
  }
  if (typeof field.defaultValue === 'number') {
    if (constraints.minimum !== undefined && field.defaultValue < constraints.minimum) {
      errors.push(`${owner}: default is below minimum.`);
    }
    if (constraints.maximum !== undefined && field.defaultValue > constraints.maximum) {
      errors.push(`${owner}: default exceeds maximum.`);
    }
  }
  if (field.type === 'boolean' && typeof field.defaultValue !== 'boolean') {
    errors.push(`${owner}: boolean default must be boolean.`);
  }
  const stringTypes = new Set(['text', 'textarea', 'color', 'image-url', 'file-path', 'select']);
  if (stringTypes.has(field.type) && typeof field.defaultValue !== 'string') {
    errors.push(`${owner}: ${field.type} default must be a string.`);
  }
  if (field.type === 'gradient') {
    if (
      !field.defaultValue ||
      typeof field.defaultValue !== 'object' ||
      Array.isArray(field.defaultValue) ||
      !('stops' in field.defaultValue)
    ) {
      errors.push(`${owner}: gradient default must be a gradient paint.`);
    } else {
      for (const problem of validatePaint(
        field.defaultValue as Parameters<typeof validatePaint>[0],
      )) {
        errors.push(`${owner}: gradient default ${problem}.`);
      }
    }
  }
  if (field.type === 'object') {
    if (
      !field.defaultValue ||
      typeof field.defaultValue !== 'object' ||
      Array.isArray(field.defaultValue)
    ) {
      errors.push(`${owner}: object default must be an object.`);
    } else {
      const value = field.defaultValue as Record<string, unknown>;
      for (const property of field.properties) {
        if (property.required && !Object.hasOwn(value, property.key)) {
          errors.push(`${owner}: default is missing required property "${property.key}".`);
          continue;
        }
        if (Object.hasOwn(value, property.key)) {
          validateFieldDefaultValue(
            property,
            value[property.key],
            `${owner} default.${property.key}`,
            errors,
          );
        }
      }
    }
  }
  if (field.type === 'array') {
    if (!Array.isArray(field.defaultValue)) {
      errors.push(`${owner}: array default must be an array.`);
    } else {
      if (constraints.minItems !== undefined && field.defaultValue.length < constraints.minItems) {
        errors.push(`${owner}: default has fewer than minItems.`);
      }
      if (constraints.maxItems !== undefined && field.defaultValue.length > constraints.maxItems) {
        errors.push(`${owner}: default exceeds maxItems.`);
      }
      if (field.items) {
        field.defaultValue.forEach((value, index) =>
          validateFieldDefaultValue(field.items!, value, `${owner} default[${index}]`, errors),
        );
      }
    }
  }
  for (const extension of field.fileExtensions) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(extension)) {
      errors.push(`${owner}: invalid file extension "${extension}".`);
    }
  }
}

function validateFieldDefaultValue(
  field: FieldDefinition,
  value: unknown,
  owner: string,
  errors: string[],
): void {
  validateFieldDefinition(
    { ...field, defaultValue: value as FieldDefinition['defaultValue'] },
    owner,
    errors,
  );
}

function validateComposition(composition: Composition, errors: string[], warnings: string[]): void {
  const prefix = `Composition "${composition.name}"`;
  for (const error of scriptingErrors(composition)) errors.push(`${prefix}: ${error}`);
  for (const error of stylePackColorLinkErrors(composition)) errors.push(`${prefix}: ${error}`);
  const patternIds = new Set<string>();
  for (const pattern of composition.patterns) {
    if (patternIds.has(pattern.id)) errors.push(`${prefix}: duplicate pattern ID ${pattern.id}.`);
    patternIds.add(pattern.id);
    for (const problem of tilingPatternErrors(pattern))
      errors.push(`${prefix}: pattern "${pattern.name}": ${problem}`);
  }
  for (const layer of [
    ...composition.layers,
    ...composition.components.flatMap((component) => component.layers),
  ]) {
    for (const problem of layerLightingErrors(layer, composition.patterns))
      errors.push(`${prefix}: ${problem}`);
    if (layer.element.type === 'pattern') {
      if (!patternIds.has(layer.element.patternId))
        errors.push(`${prefix}: layer "${layer.name}" references a missing pattern.`);
      if (layer.loop && layer.loop.activation.type !== 'lifecycle')
        errors.push(
          `${prefix}: pattern layer "${layer.name}" requires lifecycle loop activation to preserve the shared clock.`,
        );
    }
  }
  for (const problem of layerMaskErrors(composition)) errors.push(`${prefix}: ${problem}`);
  if (!finitePositive(composition.width) || !finitePositive(composition.height)) {
    errors.push(`${prefix}: width and height must be finite positive numbers.`);
  }
  if (!finitePositive(composition.frameRate))
    errors.push(`${prefix}: frame rate must be positive.`);
  if (
    !Number.isInteger(composition.updateTransitionFrames) ||
    composition.updateTransitionFrames < 0
  ) {
    errors.push(`${prefix}: update transition frames must be a non-negative integer.`);
  }

  const starts = composition.keyframes.filter((keyframe) => keyframe.role === 'start');
  const ends = composition.keyframes.filter((keyframe) => keyframe.role === 'end');
  if (starts.length !== 1 || composition.keyframes[0]?.role !== 'start') {
    errors.push(`${prefix}: requires exactly one Start state in the first position.`);
  }
  if (ends.length !== 1 || composition.keyframes.at(-1)?.role !== 'end') {
    errors.push(`${prefix}: requires exactly one End state in the final position.`);
  }
  if (composition.keyframes.slice(1, -1).some((keyframe) => keyframe.role !== 'step')) {
    errors.push(`${prefix}: only Step states may appear between Start and End.`);
  }

  for (const duplicate of duplicates(composition.keyframes.map((keyframe) => keyframe.id))) {
    errors.push(`${prefix}: duplicate keyframe id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.layers.map((layer) => layer.id))) {
    errors.push(`${prefix}: duplicate layer id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.assets.map((asset) => asset.id))) {
    errors.push(`${prefix}: duplicate asset id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.components.map((component) => component.id))) {
    errors.push(`${prefix}: duplicate component id "${duplicate}".`);
  }
  for (const duplicate of duplicates(
    composition.runtimeCollections.map((collection) => collection.id),
  )) {
    errors.push(`${prefix}: duplicate runtime collection id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.designSystem.tokens.map((token) => token.id))) {
    errors.push(`${prefix}: duplicate design-token id "${duplicate}".`);
  }
  for (const duplicate of duplicates(composition.designSystem.tokens.map((token) => token.key))) {
    errors.push(`${prefix}: duplicate design-token key "${duplicate}".`);
  }
  if (!composition.designSystem.name.trim()) {
    errors.push(`${prefix}: design-system name cannot be empty.`);
  }
  for (const token of composition.designSystem.tokens) {
    if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(token.key)) {
      errors.push(`${prefix}: design-token key "${token.key}" is invalid.`);
    }
    if (!token.name.trim()) errors.push(`${prefix}: design-token "${token.key}" has no name.`);
    if (typeof token.value === 'number' && !Number.isFinite(token.value)) {
      errors.push(`${prefix}: design-token "${token.key}" must be finite.`);
    }
  }
  for (const component of composition.components) {
    for (const problem of layerMaskErrors({
      ...composition,
      layers: component.layers,
      runtimeCollections: [],
    }))
      errors.push(`${prefix}: component "${component.name}": ${problem}`);
    if (!component.name.trim()) errors.push(`${prefix}: component names cannot be empty.`);
    if (component.layers.length === 0) {
      errors.push(`${prefix}: component "${component.name}" contains no layers.`);
    }
    for (const duplicate of duplicates(component.layers.map((layer) => layer.id))) {
      errors.push(`${prefix}: component "${component.name}" repeats layer id "${duplicate}".`);
    }
    for (const duplicate of duplicates(component.dataFields.map((field) => field.id))) {
      errors.push(`${prefix}: component "${component.name}" repeats field id "${duplicate}".`);
    }
    for (const duplicate of duplicates(component.dataFields.map((field) => field.key))) {
      errors.push(`${prefix}: component "${component.name}" repeats field key "${duplicate}".`);
    }
    for (const field of component.dataFields) {
      validateFieldDefinition(
        field,
        `${prefix}: component "${component.name}" field "${field.key}"`,
        errors,
      );
    }
    const componentFieldIds = new Set(component.dataFields.map((field) => field.id));
    for (const layer of component.layers) {
      const owner = `${prefix}: component "${component.name}" layer "${layer.name}"`;
      if (layer.element.type === 'text') {
        if (!Number.isFinite(layer.element.strokeWidth) || layer.element.strokeWidth < 0) {
          errors.push(`${owner} text stroke width must be finite and non-negative.`);
        }
      } else if (layer.animationTracks.strokeWidth?.length) {
        errors.push(
          `${owner} cannot animate text stroke width on a ${layer.element.type} element.`,
        );
      }
      for (const key of layer.animationTracks.strokeWidth ?? []) {
        if (!Number.isFinite(key.value) || key.value < 0) {
          errors.push(`${owner} stroke-width track values must be finite and non-negative.`);
        }
      }
      if (layer.element.type !== 'text' && layer.loop?.tracks.strokeWidth?.length) {
        errors.push(`${owner} cannot loop text stroke width on a ${layer.element.type} element.`);
      }
      for (const key of layer.loop?.tracks.strokeWidth ?? []) {
        if (!Number.isFinite(key.value) || key.value < 0) {
          errors.push(`${owner} loop stroke-width values must be finite and non-negative.`);
        }
      }
      for (const binding of layer.bindings) {
        if (!componentFieldIds.has(binding.fieldId)) {
          errors.push(
            `${prefix}: component "${component.name}" layer "${layer.name}" references a missing component field.`,
          );
        }
      }
    }
  }

  const expectedEdges = new Set(
    composition.keyframes
      .slice(1)
      .map((keyframe, index) => `${composition.keyframes[index]!.id}:${keyframe.id}`),
  );
  const actualEdges = new Set(
    composition.transitions.map(
      (transition) => `${transition.fromKeyframeId}:${transition.toKeyframeId}`,
    ),
  );
  for (const edge of expectedEdges) {
    if (!actualEdges.has(edge)) errors.push(`${prefix}: missing transition ${edge}.`);
  }
  for (const transition of composition.transitions) {
    const edge = `${transition.fromKeyframeId}:${transition.toKeyframeId}`;
    if (!expectedEdges.has(edge))
      errors.push(`${prefix}: transition ${edge} does not join adjacent states.`);
    if (!Number.isInteger(transition.durationFrames) || transition.durationFrames < 0) {
      errors.push(
        `${prefix}: transition ${edge} duration must be a non-negative integer frame count.`,
      );
    }
  }

  const durationFrames = getTotalFrames(composition);
  if (!Number.isFinite(composition.layout.gridSize) || composition.layout.gridSize <= 0) {
    errors.push(`${prefix}: layout grid size must be a finite positive number.`);
  }
  if (!Number.isFinite(composition.layout.snapThreshold) || composition.layout.snapThreshold < 0) {
    errors.push(`${prefix}: layout snap threshold must be a finite non-negative number.`);
  }
  for (const guide of composition.layout.guides) {
    if (!Number.isFinite(guide.position)) errors.push(`${prefix}: guide positions must be finite.`);
  }
  const layerIds = new Set(composition.layers.map((layer) => layer.id));
  for (const duplicate of duplicates(
    composition.layout.timelineFolders.map((folder) => folder.id),
  )) {
    errors.push(`${prefix}: duplicate timeline folder id "${duplicate}".`);
  }
  const folderMembership = new Map<string, string>();
  for (const folder of composition.layout.timelineFolders) {
    if (!folder.name.trim()) errors.push(`${prefix}: timeline folder names cannot be empty.`);
    for (const duplicate of duplicates(folder.layerIds)) {
      errors.push(`${prefix}: timeline folder "${folder.name}" repeats layer "${duplicate}".`);
    }
    for (const layerId of folder.layerIds) {
      if (!layerIds.has(layerId)) {
        errors.push(`${prefix}: timeline folder "${folder.name}" references a missing layer.`);
      }
      const existing = folderMembership.get(layerId);
      if (existing) {
        errors.push(
          `${prefix}: layer "${layerId}" belongs to both timeline folders "${existing}" and "${folder.name}".`,
        );
      } else {
        folderMembership.set(layerId, folder.name);
      }
    }
  }
  for (const layer of composition.layers) {
    if (!BLEND_MODES.includes(layer.blendMode)) {
      errors.push(
        `${prefix}: layer "${layer.name}" has unsupported blend mode "${layer.blendMode}".`,
      );
    }
    if (
      layer.element.type === 'rectangle' ||
      layer.element.type === 'ellipse' ||
      layer.element.type === 'path' ||
      layer.element.type === 'pattern' ||
      layer.element.type === 'text'
    ) {
      for (const problem of validatePaint(getElementFill(layer.element)!)) {
        errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
      }
    }
    if (layer.transformParentId) {
      const seen = new Set([layer.id]);
      let id: string | null | undefined = layer.transformParentId;
      while (id) {
        if (seen.has(id)) {
          errors.push(prefix + ': cyclic transformParentId chain for ' + layer.name);
          break;
        }
        seen.add(id);
        const parent = composition.layers.find((l) => l.id === id);
        if (!parent) {
          errors.push(prefix + ': missing transformParentId ' + id);
          break;
        }
        if (parent.isGuide && !layer.isGuide)
          errors.push(prefix + ': on-air transform parent cannot be a guide');
        id = parent.transformParentId;
      }
      if (
        composition.runtimeCollections.some(
          (c) =>
            c.prototypeLayerIds.includes(layer.id) ||
            c.prototypeLayerIds.includes(layer.transformParentId!),
        )
      )
        errors.push(prefix + ': transform parenting across collection prototypes is not supported');
      if (layer.parentId)
        errors.push(prefix + ': transform-parented layer cannot also have a layout parent');
    }
    if (layer.parentId && !layerIds.has(layer.parentId)) {
      errors.push(`${prefix}: layer "${layer.name}" references a missing transform parent.`);
    }
    if (layer.element.type === 'path' && !['nonzero', 'evenodd'].includes(layer.element.fillRule)) {
      errors.push(`${prefix}: layer "${layer.name}" has an invalid path fill rule.`);
    }
    if (layer.element.type === 'path' && layer.element.stretchInsets) {
      const { left, right, top, bottom } = layer.element.stretchInsets;
      if (
        [left, right, top, bottom].some((value) => !Number.isFinite(value) || value < 0) ||
        left + right > layer.element.viewBoxWidth ||
        top + bottom > layer.element.viewBoxHeight
      ) {
        errors.push(`${prefix}: layer "${layer.name}" has invalid path stretch insets.`);
      }
      if (typeof layer.element.fill !== 'string') {
        warnings.push(
          `${prefix}: layer "${layer.name}" path stretch regions currently preserve solid fills only; its complex paint uses ordinary scaling.`,
        );
      }
    }
    if (layer.parentId === layer.id) {
      errors.push(`${prefix}: layer "${layer.name}" cannot parent itself.`);
    }
    if (layer.motionPath) {
      const source = composition.layers.find(
        (candidate) => candidate.id === layer.motionPath!.sourceLayerId,
      );
      if (!source || source.element.type !== 'path') {
        errors.push(
          `${prefix}: layer "${layer.name}" motion path references a missing path layer.`,
        );
      }
      if (
        layer.motionPath.sourceLayerId === layer.id ||
        !Number.isFinite(layer.motionPath.progress) ||
        layer.motionPath.progress < 0 ||
        layer.motionPath.progress > 1 ||
        !Number.isFinite(layer.motionPath.offsetX) ||
        !Number.isFinite(layer.motionPath.offsetY)
      ) {
        errors.push(`${prefix}: layer "${layer.name}" has invalid motion-path settings.`);
      }
    }
    const visited = new Set<string>([layer.id]);
    let parentId = layer.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        errors.push(`${prefix}: layer "${layer.name}" has a cyclic transform parent chain.`);
        break;
      }
      visited.add(parentId);
      parentId =
        composition.layers.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
    if (layer.keyframes.length === 0) {
      errors.push(`${prefix}: layer "${layer.name}" has no animation keyframes.`);
    }
    for (const duplicate of duplicates(layer.keyframes.map((keyframe) => String(keyframe.frame)))) {
      errors.push(`${prefix}: layer "${layer.name}" has multiple keys at frame ${duplicate}.`);
    }
    for (const keyframe of layer.keyframes) {
      if (
        !Number.isInteger(keyframe.frame) ||
        keyframe.frame < 0 ||
        keyframe.frame > durationFrames
      ) {
        errors.push(
          `${prefix}: layer "${layer.name}" key frame must be an integer from 0 to ${durationFrames}.`,
        );
      }
      if (Object.values(keyframe.transform).some((value) => !Number.isFinite(value))) {
        errors.push(`${prefix}: layer "${layer.name}" has a non-finite transform value.`);
      }
    }
    const stackErrors = effectStackErrors(layer.effects);
    if (stackErrors.length) {
      errors.push(...stackErrors.map((error) => `${prefix}: layer "${layer.name}": ${error}`));
      continue;
    }
    for (const property of new Set([
      ...Object.keys(layer.animationTracks),
      ...Object.keys(layer.loop?.tracks ?? {}),
    ]))
      if (
        parseEffectProperty(property) &&
        typeof effectParameterSpec(layer.effects, property)?.default !== 'number'
      )
        errors.push(
          `${prefix}: layer "${layer.name}" references a missing numeric effect parameter ${property}.`,
        );
    const tracks = getResolvedLayerAnimationTracks(layer);
    for (const property of new Set([
      ...Object.keys(layer.animationTracks),
      ...Object.keys(layer.loop?.tracks ?? {}),
    ])) {
      if (
        parseShaderAnimationProperty(property) &&
        !shaderAnimationPropertySpec(layer.element, property)
      )
        errors.push(
          `${prefix}: layer "${layer.name}" references missing shader animation property "${property}".`,
        );
    }
    if (layer.element.type !== 'text' && layer.animationTracks.strokeWidth?.length) {
      errors.push(
        `${prefix}: layer "${layer.name}" cannot animate text stroke width on a ${layer.element.type} element.`,
      );
    }
    for (const property of getLayerAnimatableProperties(layer)) {
      const propertyKeys = tracks[property] ?? [];
      const stopIndex = gradientStopIndexForProperty(property);
      if (stopIndex !== null) {
        const fill =
          layer.element.type === 'rectangle' ||
          layer.element.type === 'ellipse' ||
          layer.element.type === 'path' ||
          layer.element.type === 'pattern' ||
          layer.element.type === 'text'
            ? layer.element.fill
            : null;
        if (!isGradientPaint(fill) || !fill.stops[stopIndex]) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" references a missing gradient stop.`,
          );
        }
      }
      if (propertyKeys.length === 0 && !parseShaderAnimationProperty(property)) {
        errors.push(`${prefix}: layer "${layer.name}" property "${property}" has no keys.`);
      }
      for (const duplicate of duplicates(propertyKeys.map((keyframe) => String(keyframe.frame)))) {
        errors.push(
          `${prefix}: layer "${layer.name}" property "${property}" has multiple keys at frame ${duplicate}.`,
        );
      }
      for (const keyframe of propertyKeys) {
        if (parseShaderAnimationProperty(property))
          errors.push(
            ...shaderAnimationValueErrors(layer.element, property, keyframe.value).map(
              (error) => `${prefix}: layer "${layer.name}": ${error}`,
            ),
          );
        const spec = effectParameterSpec(layer.effects, property);
        if (spec && (keyframe.value < spec.min! || keyframe.value > spec.max!))
          errors.push(
            `${prefix}: layer "${layer.name}" effect key ${property} must be ${spec.min}–${spec.max}.`,
          );
        if (
          !Number.isInteger(keyframe.frame) ||
          keyframe.frame < 0 ||
          keyframe.frame > durationFrames
        ) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" key frame must be an integer from 0 to ${durationFrames}.`,
          );
        }
        if (!Number.isFinite(keyframe.value)) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" has a non-finite value.`,
          );
        }
        if (property === 'strokeWidth' && keyframe.value < 0) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "strokeWidth" values must be non-negative.`,
          );
        }
        if (stopIndex !== null && (keyframe.value < 0 || keyframe.value > 1)) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" values must be from 0 to 1.`,
          );
        }
        if (
          keyframe.curve &&
          Object.values(keyframe.curve).some(
            (value) => !Number.isFinite(value) || value < 0 || value > 1,
          )
        ) {
          errors.push(
            `${prefix}: layer "${layer.name}" property "${property}" has an invalid cubic Bézier curve.`,
          );
        }
      }
    }
    if (layer.loop) {
      const loop = layer.loop;
      const activation = loop.activation;
      if (!Number.isInteger(loop.durationFrames) || loop.durationFrames < 1) {
        errors.push(`${prefix}: layer "${layer.name}" loop duration must be a positive integer.`);
      }
      if (
        loop.repeatCount !== null &&
        (!Number.isInteger(loop.repeatCount) || loop.repeatCount < 1)
      ) {
        errors.push(`${prefix}: layer "${layer.name}" loop repeat count must be positive or null.`);
      }
      if (
        activation.type === 'step' &&
        !composition.keyframes.some(
          (keyframe) => keyframe.id === activation.stepKeyframeId && keyframe.role === 'step',
        )
      ) {
        errors.push(`${prefix}: layer "${layer.name}" loop references a missing OGraf Step.`);
      }
      if (
        activation.type === 'customAction' &&
        !composition.customActions.some((action) => action.actionId === activation.customActionId)
      ) {
        errors.push(`${prefix}: layer "${layer.name}" loop references a missing custom action.`);
      }
      if (activation.type === 'customAction' && loop.repeatCount === null) {
        errors.push(
          `${prefix}: layer "${layer.name}" custom-action clip must use a finite repeat count.`,
        );
      }
      for (const [property, keys = []] of Object.entries(loop.tracks)) {
        if (property === 'strokeWidth' && layer.element.type !== 'text') {
          errors.push(
            `${prefix}: layer "${layer.name}" cannot loop text stroke width on a ${layer.element.type} element.`,
          );
        }
        if (keys.length === 0) {
          errors.push(`${prefix}: layer "${layer.name}" loop property "${property}" has no keys.`);
          continue;
        }
        for (const duplicate of duplicates(keys.map((key) => String(key.frame)))) {
          errors.push(
            `${prefix}: layer "${layer.name}" loop property "${property}" has multiple keys at local frame ${duplicate}.`,
          );
        }
        for (const key of keys) {
          if (parseShaderAnimationProperty(property))
            errors.push(
              ...shaderAnimationValueErrors(layer.element, property, key.value).map(
                (error) => `${prefix}: layer "${layer.name}" loop: ${error}`,
              ),
            );
          const spec = effectParameterSpec(layer.effects, property);
          if (spec && (key.value < spec.min! || key.value > spec.max!))
            errors.push(
              `${prefix}: layer "${layer.name}" loop effect ${property} must be ${spec.min}–${spec.max}.`,
            );
          if (!Number.isInteger(key.frame) || key.frame < 0 || key.frame > loop.durationFrames) {
            errors.push(
              `${prefix}: layer "${layer.name}" loop property "${property}" keys must stay inside 0..${loop.durationFrames}.`,
            );
          }
          if (!Number.isFinite(key.value)) {
            errors.push(
              `${prefix}: layer "${layer.name}" loop property "${property}" has a non-finite value.`,
            );
          }
          if (property === 'strokeWidth' && key.value < 0) {
            errors.push(
              `${prefix}: layer "${layer.name}" loop property "strokeWidth" values must be non-negative.`,
            );
          }
        }
        const ordered = [...keys].sort((a, b) => a.frame - b.frame);
        if (
          loop.repeatCount === null &&
          ordered[0]?.frame === 0 &&
          ordered.at(-1)?.frame === loop.durationFrames &&
          Math.abs(ordered[0]!.value - ordered.at(-1)!.value) > 0.0001
        ) {
          warnings.push(
            `${prefix}: layer "${layer.name}" loop property "${property}" has different values at its repeat seam.`,
          );
        }
      }
    }
  }

  for (const key of duplicates(composition.dataFields.map((field) => field.key))) {
    errors.push(`${prefix}: duplicate data field key "${key}".`);
  }
  const allFieldNodes: FieldDefinition[] = [];
  const collectFieldNodes = (field: FieldDefinition) => {
    allFieldNodes.push(field);
    field.properties.forEach(collectFieldNodes);
    if (field.items) collectFieldNodes(field.items);
  };
  composition.dataFields.forEach(collectFieldNodes);
  for (const id of duplicates(allFieldNodes.map((field) => field.id))) {
    errors.push(`${prefix}: duplicate data schema node id "${id}".`);
  }
  for (const field of composition.dataFields) {
    validateFieldDefinition(field, `${prefix}: data field "${field.key}"`, errors);
    if (field.defaultTokenId) {
      const token = composition.designSystem.tokens.find((t) => t.id === field.defaultTokenId);
      if (field.type !== 'color' || token?.type !== 'color')
        errors.push(`${prefix}: field "${field.key}" has an invalid Brand Kit default token.`);
      else if (field.defaultValue !== token.value)
        warnings.push(`${prefix}: field "${field.key}" Brand Kit default is out of sync.`);
    }
  }
  for (const actionId of duplicates(composition.customActions.map((action) => action.actionId))) {
    errors.push(`${prefix}: duplicate custom action id "${actionId}".`);
  }
  const fieldIds = new Set(composition.dataFields.map((field) => field.id));
  const customActionIds = new Set(composition.customActions.map((action) => action.actionId));
  const fieldById = new Map(composition.dataFields.map((field) => [field.id, field]));
  const collectionByPrototypeLayerId = new Map<string, Composition['runtimeCollections'][number]>();
  const collectionFieldIds = new Set<string>();
  for (const collection of composition.runtimeCollections) {
    if (!collection.name.trim())
      errors.push(`${prefix}: runtime collection names cannot be empty.`);
    if (
      !Number.isInteger(collection.capacity) ||
      collection.capacity < 1 ||
      collection.capacity > 100
    ) {
      errors.push(`${prefix}: runtime collection "${collection.name}" capacity must be 1..100.`);
    }
    if (
      !Number.isFinite(collection.offsetPerItem.x) ||
      !Number.isFinite(collection.offsetPerItem.y)
    ) {
      errors.push(`${prefix}: runtime collection "${collection.name}" offset must be finite.`);
    }
    if (collection.overflow !== 'truncate') {
      errors.push(`${prefix}: runtime collection "${collection.name}" has unsupported overflow.`);
    }
    if (
      !Number.isInteger(collection.pageSize ?? 0) ||
      (collection.pageSize ?? 0) < 0 ||
      (collection.pageSize ?? 0) > collection.capacity ||
      !Number.isInteger(collection.page ?? 0) ||
      (collection.page ?? 0) < 0
    ) {
      errors.push(`${prefix}: runtime collection "${collection.name}" has invalid pagination.`);
    }
    const field = fieldById.get(collection.fieldId);
    if (!field) {
      errors.push(`${prefix}: runtime collection "${collection.name}" references a missing field.`);
    } else {
      if (field.type !== 'array' || field.items?.type !== 'object') {
        errors.push(
          `${prefix}: runtime collection "${collection.name}" requires an array field with object items.`,
        );
      }
      if (collectionFieldIds.has(field.id)) {
        errors.push(
          `${prefix}: array field "${field.key}" drives more than one runtime collection.`,
        );
      }
      collectionFieldIds.add(field.id);
      if (field.constraints.maxItems !== collection.capacity) {
        errors.push(
          `${prefix}: runtime collection "${collection.name}" capacity must equal field maxItems.`,
        );
      }
      for (const [label, path] of [
        ['item key', collection.itemKeyPath ?? []],
        ['sort', collection.sortPath ?? []],
      ] as const) {
        if (path.length && !fieldDefinitionAtPath(field, path, { fromArrayItem: true })) {
          errors.push(
            `${prefix}: runtime collection "${collection.name}" ${label} path is missing.`,
          );
        }
      }
    }
    if (collection.prototypeLayerIds.length === 0) {
      errors.push(`${prefix}: runtime collection "${collection.name}" has no prototype layers.`);
      continue;
    }
    if (new Set(collection.prototypeLayerIds).size !== collection.prototypeLayerIds.length) {
      errors.push(`${prefix}: runtime collection "${collection.name}" repeats prototype layers.`);
    }
    const prototypeLayers = collection.prototypeLayerIds
      .map((id) => composition.layers.find((layer) => layer.id === id))
      .filter((layer): layer is NonNullable<typeof layer> => Boolean(layer));
    if (prototypeLayers.length !== collection.prototypeLayerIds.length) {
      errors.push(`${prefix}: runtime collection "${collection.name}" references missing layers.`);
    }
    if (!prototypeLayers.some((layer) => layer.isVisible && !layer.isGuide)) {
      errors.push(`${prefix}: runtime collection "${collection.name}" has no visible prototype.`);
    }
    if (prototypeLayers.some((layer) => layer.isGuide)) {
      errors.push(
        `${prefix}: runtime collection "${collection.name}" cannot contain guide layers.`,
      );
    }
    const groups = new Set(prototypeLayers.map((layer) => layer.groupId));
    if (groups.size !== 1 || groups.has(null)) {
      errors.push(
        `${prefix}: runtime collection "${collection.name}" prototype must use one persistent group.`,
      );
    }
    const indexes = prototypeLayers
      .map((layer) => composition.layers.findIndex((candidate) => candidate.id === layer.id))
      .sort((left, right) => left - right);
    if (indexes.some((index, position) => position > 0 && index !== indexes[position - 1]! + 1)) {
      errors.push(
        `${prefix}: runtime collection "${collection.name}" prototype layers must be contiguous.`,
      );
    }
    const prototypeIds = new Set(collection.prototypeLayerIds);
    for (const layer of prototypeLayers) {
      if (collectionByPrototypeLayerId.has(layer.id)) {
        errors.push(
          `${prefix}: layer "${layer.name}" belongs to more than one runtime collection.`,
        );
      }
      collectionByPrototypeLayerId.set(layer.id, collection);
      const parent = layer.parentId
        ? composition.layers.find((candidate) => candidate.id === layer.parentId)
        : undefined;
      if (parent?.clipChildren && !prototypeIds.has(parent.id)) {
        errors.push(
          `${prefix}: runtime collection "${collection.name}" clip parents must stay inside the prototype.`,
        );
      }
    }
  }
  const designTokenById = new Map(
    composition.designSystem.tokens.map((token) => [token.id, token]),
  );
  const componentById = new Map(
    composition.components.map((component) => [component.id, component]),
  );
  const assetIds = new Set(composition.assets.map((asset) => asset.id));
  const assetById = new Map(composition.assets.map((asset) => [asset.id, asset]));
  const validateAssetReference = (value: string, owner: string) => {
    if (value.startsWith('asset:') && !assetIds.has(value.slice('asset:'.length))) {
      errors.push(`${prefix}: ${owner} references a missing asset "${value}".`);
    }
  };
  for (const asset of composition.assets) {
    if (!asset.dataUri.startsWith('data:')) {
      errors.push(`${prefix}: asset "${asset.name}" must contain a data URI.`);
    }
    if (asset.kind === 'font' && !asset.fontFamily?.trim()) {
      errors.push(`${prefix}: font asset "${asset.name}" requires a font family name.`);
    }
    if (
      asset.packagePath &&
      (asset.packagePath.startsWith('/') ||
        asset.packagePath.startsWith('\\') ||
        asset.packagePath.includes('\\') ||
        asset.packagePath.split('/').includes('..') ||
        /^[a-z]:/i.test(asset.packagePath))
    ) {
      errors.push(`${prefix}: asset "${asset.name}" package path must be a safe relative URL.`);
    }
    if (
      asset.kind === 'font' &&
      asset.fontWeight &&
      !/^([1-9]00|[1-9]00 [1-9]00)$/.test(asset.fontWeight)
    ) {
      errors.push(
        `${prefix}: font asset "${asset.name}" weight must be a CSS weight such as 400 or a range such as 100 900.`,
      );
    }
  }
  for (const cueId of duplicates(composition.mediaCues.map((cue) => cue.id))) {
    errors.push(`${prefix}: duplicate media cue id "${cueId}".`);
  }
  const lifecycleIds = new Set(composition.keyframes.map((keyframe) => keyframe.id));
  for (const cue of composition.mediaCues) {
    const owner = `${prefix}: media cue "${cue.name || cue.id}"`;
    if (!cue.name.trim()) errors.push(`${owner} requires a name.`);
    if (cue.sources.length === 0) errors.push(`${owner} requires at least one source.`);
    for (const sourceId of duplicates(cue.sources.map((source) => source.id))) {
      errors.push(`${owner} repeats source id "${sourceId}".`);
    }
    if (!cue.sources.some((source) => source.id === cue.activeSourceId)) {
      errors.push(`${owner} active source does not exist.`);
    }
    const activeSource = cue.sources.find((source) => source.id === cue.activeSourceId);
    if (cue.visual.targetLayerId) {
      const target = composition.layers.find((layer) => layer.id === cue.visual.targetLayerId);
      if (!target || !('fill' in target.element)) {
        errors.push(`${owner} references an invalid video paint target.`);
      }
      if (activeSource?.kind === 'clip' && activeSource.mediaType === 'audio') {
        errors.push(`${owner} cannot paint an audio-only source onto a layer.`);
      }
    }
    if (
      !Number.isFinite(cue.visual.positionX) ||
      cue.visual.positionX < 0 ||
      cue.visual.positionX > 1 ||
      !Number.isFinite(cue.visual.positionY) ||
      cue.visual.positionY < 0 ||
      cue.visual.positionY > 1
    ) {
      errors.push(`${owner} video position must stay within 0..1.`);
    }
    for (const source of cue.sources) {
      if (!source.name.trim()) errors.push(`${owner} has an unnamed source.`);
      if (source.kind === 'clip') {
        if (!source.src.trim()) errors.push(`${owner} clip source is required.`);
        validateAssetReference(source.src, `media cue "${cue.name}"`);
        if (source.src.startsWith('asset:')) {
          const asset = assetById.get(source.src.slice('asset:'.length));
          const expectedKind = source.mediaType === 'audio' ? 'audio' : 'media';
          if (asset && asset.kind !== expectedKind) {
            errors.push(
              `${owner} ${source.mediaType} source "${source.name}" references a ${asset.kind} asset.`,
            );
          }
        }
      } else {
        if (!/^[A-Za-z0-9._:-]+$/.test(source.tag)) {
          errors.push(`${owner} live source "${source.name}" has an invalid renderer tag.`);
        }
        if (source.fallback) {
          validateAssetReference(source.fallback, `media cue "${cue.name}" live fallback`);
        }
      }
    }
    if (
      !Number.isFinite(cue.trimStartMs) ||
      cue.trimStartMs < 0 ||
      (cue.trimEndMs !== null &&
        (!Number.isFinite(cue.trimEndMs) || cue.trimEndMs <= cue.trimStartMs))
    ) {
      errors.push(`${owner} has an invalid trim range.`);
    }
    if (
      cue.durationFrames != null &&
      (!Number.isInteger(cue.durationFrames) || cue.durationFrames < 1)
    ) {
      errors.push(`${owner} Timeline duration must be a positive integer frame count.`);
    }
    if (!Number.isFinite(cue.speed) || cue.speed < 0.1 || cue.speed > 16) {
      errors.push(`${owner} speed must be from 0.1 to 16.`);
    }
    if (!Number.isFinite(cue.volume) || cue.volume < 0 || cue.volume > 1) {
      errors.push(`${owner} volume must be from 0 to 1.`);
    }
    if (cue.trigger.type === 'timeline') {
      if (
        !Number.isInteger(cue.trigger.startFrame) ||
        cue.trigger.startFrame < 0 ||
        cue.trigger.startFrame > durationFrames
      ) {
        errors.push(`${owner} timeline trigger must be inside the composition duration.`);
      }
    } else if (cue.trigger.type === 'lifecycle' && !lifecycleIds.has(cue.trigger.keyframeId)) {
      errors.push(`${owner} references a missing lifecycle state.`);
    } else if (cue.trigger.type === 'customAction' && !customActionIds.has(cue.trigger.actionId)) {
      errors.push(`${owner} references a missing custom action.`);
    }
    if (
      !Number.isInteger(cue.transition.durationFrames) ||
      cue.transition.durationFrames < 0 ||
      (cue.transition.type === 'crossfade' && cue.transition.durationFrames < 1)
    ) {
      errors.push(`${owner} source transition duration is invalid.`);
    }
    if (cue.sources.some((source) => source.kind === 'live')) {
      warnings.push(
        `${owner} uses renderer-provided live media; verify source readiness and fallback behavior on the target renderer.`,
      );
    }
  }
  for (const layer of composition.layers) {
    if (layer.componentLink) {
      const component = componentById.get(layer.componentLink.componentId);
      if (!component) {
        errors.push(`${prefix}: layer "${layer.name}" links to a missing component.`);
      } else if (
        !component.layers.some(
          (sourceLayer) => sourceLayer.id === layer.componentLink?.sourceLayerId,
        )
      ) {
        errors.push(`${prefix}: layer "${layer.name}" links to a missing component source layer.`);
      }
    }
    for (const targetProperty of duplicates(
      layer.designTokenBindings.map((binding) => binding.targetProperty),
    )) {
      errors.push(
        `${prefix}: layer "${layer.name}" links design-token target "${targetProperty}" more than once.`,
      );
    }
    for (const binding of layer.designTokenBindings) {
      const token = designTokenById.get(binding.tokenId);
      if (!token) {
        errors.push(`${prefix}: layer "${layer.name}" references a missing design token.`);
        continue;
      }
      const projected = structuredClone(layer);
      try {
        applyDesignTokenBinding(projected, binding, token);
        if (
          JSON.stringify(projected.element) !== JSON.stringify(layer.element) ||
          JSON.stringify(projected.effects) !== JSON.stringify(layer.effects)
        ) {
          warnings.push(
            `${prefix}: layer "${layer.name}" design-token link for "${binding.targetProperty}" is out of sync with its materialized value.`,
          );
        }
      } catch (error) {
        errors.push(
          `${prefix}: layer "${layer.name}" has an invalid design-token link: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    for (const binding of layer.bindings) {
      if (!fieldIds.has(binding.fieldId)) {
        errors.push(`${prefix}: layer "${layer.name}" references a missing data field.`);
        continue;
      }
      if (
        parseEffectProperty(binding.targetProperty) &&
        !effectParameterSpec(layer.effects, binding.targetProperty)
      )
        errors.push(`${prefix}: layer "${layer.name}" binds a missing effect parameter.`);
      const gradientColor = /^fill\.stops\[(0|[1-9]\d*)\]\.color$/.exec(binding.targetProperty);
      if (
        gradientColor &&
        (!('fill' in layer.element) ||
          !isGradientPaint(layer.element.fill) ||
          !layer.element.fill.stops[Number(gradientColor[1])])
      )
        errors.push(`${prefix}: layer "${layer.name}" binds a missing gradient color stop.`);
      const field = fieldById.get(binding.fieldId)!;
      const collection = collectionByPrototypeLayerId.get(layer.id);
      const fromArrayItem = field.type === 'array';
      if (fromArrayItem && collection?.fieldId !== field.id) {
        errors.push(
          `${prefix}: layer "${layer.name}" can bind array field "${field.key}" only inside its runtime collection prototype.`,
        );
        continue;
      }
      const resolved = fieldDefinitionAtPath(field, binding.sourcePath ?? [], { fromArrayItem });
      if (layer.element.type === 'chart' && binding.targetProperty === 'data') {
        if (resolved?.type !== 'text' && resolved?.type !== 'textarea')
          errors.push(
            `${prefix}: layer "${layer.name}" chart data binding needs a text or textarea field.`,
          );
        else {
          try {
            parseChartData(valueAtSourcePath(field.defaultValue, binding.sourcePath));
          } catch (error) {
            errors.push(
              `${prefix}: layer "${layer.name}" chart field default: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
      const shaderTarget = /^(fill|strokePaint)\.parameters\.(.+)$/.exec(
        migrateShaderBindingTarget(binding.targetProperty),
      );
      const boundShader = shaderTarget
        ? getElementShaderPaint(
            layer.element,
            shaderTarget[1] === 'strokePaint' ? 'stroke' : 'fill',
          )
        : undefined;
      const shaderParameter = boundShader
        ? inspectShaderSource(boundShader.fragmentSource).parameters.find(
            (parameter) => parameter.name === shaderTarget![2],
          )
        : undefined;
      if (shaderTarget && !shaderParameter) {
        errors.push(
          `${prefix}: layer "${layer.name}" binds an unmarked shader parameter "${binding.targetProperty}".`,
        );
      }
      const vectorObject =
        shaderParameter?.control === 'vector2' &&
        resolved?.type === 'object' &&
        ['x', 'y'].every((axis) =>
          resolved.properties.some(
            (child) => child.key === axis && (child.type === 'number' || child.type === 'integer'),
          ),
        );
      if (!resolved || (resolved.type === 'object' && !vectorObject) || resolved.type === 'array') {
        errors.push(
          `${prefix}: layer "${layer.name}" binding path for field "${field.key}" must resolve to a scalar leaf.`,
        );
      }
      if (shaderParameter && resolved) {
        const compatible =
          shaderParameter.control === 'vector2'
            ? vectorObject
            : shaderParameter.control === 'color'
              ? resolved.type === 'color'
              : shaderParameter.control === 'toggle'
                ? resolved.type === 'boolean'
                : shaderParameter.glslType === 'int'
                  ? resolved.type === 'integer'
                  : resolved.type === 'number' || resolved.type === 'integer';
        if (!compatible)
          errors.push(
            `${prefix}: layer "${layer.name}" shader parameter "${shaderParameter.name}" has an incompatible field type.`,
          );
        try {
          const rootValue =
            fromArrayItem && Array.isArray(field.defaultValue)
              ? field.defaultValue[0]
              : field.defaultValue;
          if (rootValue !== undefined)
            normalizeShaderParameterValue(
              shaderParameter,
              valueAtSourcePath(rootValue, binding.sourcePath),
            );
        } catch (error) {
          errors.push(
            `${prefix}: layer "${layer.name}" shader parameter "${shaderParameter.name}" field default: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
    for (const targetProperty of duplicates(
      layer.bindings.map((binding) => binding.targetProperty),
    )) {
      errors.push(
        `${prefix}: layer "${layer.name}" binds target property "${targetProperty}" more than once.`,
      );
    }
    for (const ruleId of duplicates((layer.visualRules ?? []).map((rule) => rule.id))) {
      errors.push(`${prefix}: layer "${layer.name}" repeats visual rule id "${ruleId}".`);
    }
    for (const rule of layer.visualRules ?? []) {
      const ruleLabel = `${prefix}: layer "${layer.name}" visual rule "${rule.name}"`;
      const trigger = rule.trigger ?? 'data';
      if (!VISUAL_RULE_TRIGGERS.has(trigger)) {
        errors.push(`${prefix}: layer "${layer.name}" visual rule has an unknown trigger.`);
      }
      const conditions = [...(trigger === 'data' ? [rule] : []), ...(rule.conditions ?? [])];
      if (trigger === 'data' && !fieldIds.has(rule.fieldId)) {
        errors.push(
          `${prefix}: layer "${layer.name}" visual rule references a missing data field.`,
        );
      }
      for (const condition of rule.conditions ?? []) {
        if (!fieldIds.has(condition.fieldId))
          errors.push(`${ruleLabel} has a condition on a missing data field.`);
      }
      for (const condition of conditions) {
        if (!VISUAL_RULE_OPERATORS.has(condition.operator))
          errors.push(`${ruleLabel} uses unknown operator "${condition.operator}".`);
        if (condition.compareFieldId && !fieldIds.has(condition.compareFieldId))
          errors.push(`${ruleLabel} compares with a missing data field.`);
        if (
          condition.operator === 'between' &&
          !condition.compareFieldId &&
          !visualRuleRange(condition.value)
        )
          errors.push(`${ruleLabel} needs a [min, max] pair for "between".`);
        if (
          condition.compareFieldId &&
          ['between', 'one-of', 'not-one-of'].includes(condition.operator)
        )
          errors.push(`${ruleLabel} cannot compare "${condition.operator}" with another field.`);
      }
      if (trigger !== 'data' && conditions.some((c) => VISUAL_RULE_EVENT_OPERATORS.has(c.operator)))
        errors.push(`${ruleLabel} can watch for changes only on a Data trigger.`);
      if (rule.match !== undefined && rule.match !== 'all' && rule.match !== 'any')
        errors.push(`${ruleLabel} has an unknown condition match "${String(rule.match)}".`);
      if (trigger === 'custom-action' && (!rule.eventId || !customActionIds.has(rule.eventId)))
        errors.push(`${ruleLabel} must name an existing custom action.`);
      if (
        trigger === 'step' &&
        rule.eventId &&
        !composition.keyframes.some((k) => k.id === rule.eventId && k.role === 'step')
      )
        errors.push(`${ruleLabel} references a missing step.`);
      const isState =
        trigger === 'hover' || (trigger === 'data' && !isVisualRuleEdgeDataRule(rule));
      if (rule.delayFrames !== undefined) {
        if (!Number.isFinite(rule.delayFrames) || rule.delayFrames < 0)
          errors.push(`${ruleLabel} delay must be zero or more frames.`);
        else if (isState && rule.delayFrames > 0)
          errors.push(`${ruleLabel} delay applies only to event triggers.`);
      }
      if (rule.actions.length === 0) {
        errors.push(`${prefix}: layer "${layer.name}" visual rule "${rule.name}" has no actions.`);
      }
      for (const action of rule.actions) {
        if (
          (action.type === 'custom-action' || action.type === 'shader-animation') &&
          !customActionIds.has(action.actionId)
        ) {
          errors.push(
            `${prefix}: layer "${layer.name}" visual rule references missing custom action "${action.actionId}".`,
          );
        }
        if (
          (action.type === 'play-sound' || action.type === 'take-media') &&
          !composition.mediaCues.some((cue) => cue.id === action.cueId)
        ) {
          errors.push(
            `${prefix}: layer "${layer.name}" visual rule references missing media cue "${action.cueId}".`,
          );
        }
        if (
          action.type === 'visibility' ||
          action.type === 'toggle-visibility' ||
          action.type === 'property'
        ) {
          if (
            action.targetLayerId &&
            !composition.layers.some((candidate) => candidate.id === action.targetLayerId)
          )
            errors.push(`${ruleLabel} targets a missing layer "${action.targetLayerId}".`);
          if (
            action.transitionFrames !== undefined &&
            (!Number.isFinite(action.transitionFrames) || action.transitionFrames < 0)
          )
            errors.push(`${ruleLabel} transition must be zero or more frames.`);
        }
        if (action.type === 'toggle-visibility' && isState)
          errors.push(`${ruleLabel} can toggle visibility only on an event trigger.`);
      }
    }
    for (const { slot, paint } of getElementShaderPaints(layer.element)) {
      errors.push(
        ...inspectShaderElement(paint).errors.map(
          (error) => `${prefix}: layer "${layer.name}" ${slot} paint: ${error}`,
        ),
      );
    }
    if (
      'strokePaint' in layer.element &&
      layer.element.strokePaint !== undefined &&
      (layer.element.type !== 'text' || !isShaderPaint(layer.element.strokePaint))
    ) {
      errors.push(
        `${prefix}: layer "${layer.name}" strokePaint must be a shader paint on a text layer, or omitted.`,
      );
    }
    if (
      ['image', 'image-sequence', 'lottie'].includes(layer.element.type) &&
      'fill' in layer.element &&
      layer.element.fill !== undefined &&
      !isShaderPaint(layer.element.fill) &&
      !isMediaPaint(layer.element.fill)
    ) {
      errors.push(
        `${prefix}: layer "${layer.name}" media fill must be a shader, media paint, or omitted.`,
      );
    }
    const mediaPaint = isMediaPaint(getElementFill(layer.element))
      ? getElementFill(layer.element)
      : undefined;
    if (mediaPaint && isMediaPaint(mediaPaint)) {
      if (['image', 'image-sequence', 'lottie'].includes(layer.element.type))
        for (const problem of validatePaint(mediaPaint))
          errors.push(`${prefix}: layer "${layer.name}" ${problem}.`);
      for (const reference of mediaPaintAssetReferences(mediaPaint))
        validateAssetReference(reference, `layer "${layer.name}" media paint`);
      if (mediaPaint.source.kind === 'clip' && mediaPaint.source.src.startsWith('asset:')) {
        const asset = assetById.get(mediaPaint.source.src.slice('asset:'.length));
        if (asset && (asset.kind !== 'media' || !asset.mimeType.startsWith('video/')))
          errors.push(
            `${prefix}: layer "${layer.name}" media clip must reference a video media asset.`,
          );
      }
      if (mediaPaint.source.kind === 'live' && mediaPaint.source.fallback?.startsWith('asset:')) {
        const asset = assetById.get(mediaPaint.source.fallback.slice('asset:'.length));
        if (asset && (asset.kind !== 'image' || !asset.mimeType.startsWith('image/')))
          errors.push(
            `${prefix}: layer "${layer.name}" live media fallback must reference an image asset.`,
          );
      }
    }
    if (layer.element.type === 'image' && layer.element.src) {
      validateAssetReference(layer.element.src, `layer "${layer.name}"`);
    } else if (layer.element.type === 'image-sequence') {
      for (const frame of layer.element.frames) {
        validateAssetReference(frame, `layer "${layer.name}"`);
      }
    } else if (layer.element.type === 'chart') {
      errors.push(
        ...chartAnimationErrors(layer.element.animation).map(
          (error) => `${prefix}: layer "${layer.name}": ${error}`,
        ),
      );
      if (
        ![
          'bar',
          'horizontal-bar',
          'stacked-bar',
          'line',
          'area',
          'pie',
          'doughnut',
          'radar',
          'polar-area',
        ].includes(layer.element.preset)
      )
        errors.push(`${prefix}: layer "${layer.name}" has an unknown Chart.js preset.`);
      try {
        parseChartData(layer.element.data);
      } catch (error) {
        errors.push(
          `${prefix}: layer "${layer.name}" chart data: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!/^#[\da-f]{6}$/i.test(layer.element.textColor))
        errors.push(`${prefix}: layer "${layer.name}" chart textColor must be #RRGGBB.`);
      if (
        !Number.isFinite(layer.element.fontSize) ||
        layer.element.fontSize < 8 ||
        layer.element.fontSize > 96
      )
        errors.push(`${prefix}: layer "${layer.name}" chart label size must be 8–96 px.`);
      if (
        typeof layer.element.showLegend !== 'boolean' ||
        typeof layer.element.showGrid !== 'boolean'
      )
        errors.push(
          `${prefix}: layer "${layer.name}" chart legend/grid settings must be booleans.`,
        );
    } else if (layer.element.type === 'shader') {
      const inspection = inspectShaderElement(layer.element);
      errors.push(
        ...inspection.errors.map((error) => `${prefix}: layer "${layer.name}": ${error}`),
      );
    } else if (layer.element.type === 'lottie') {
      if (!layer.element.animationData) {
        errors.push(`${prefix}: Lottie layer "${layer.name}" has no animation JSON.`);
      } else {
        const inspection = inspectLottieAnimationData(layer.element.animationData);
        errors.push(
          ...inspection.errors.map((error) => `${prefix}: layer "${layer.name}": ${error}`),
        );
        warnings.push(
          ...inspection.warnings.map((warning) => `${prefix}: layer "${layer.name}": ${warning}`),
        );
      }
      if (!Number.isFinite(layer.element.speed) || layer.element.speed < 0) {
        errors.push(
          `${prefix}: Lottie layer "${layer.name}" speed must be finite and non-negative.`,
        );
      }
    } else if (layer.element.type === 'audio') {
      if (!layer.element.src) errors.push(`${prefix}: audio layer "${layer.name}" has no source.`);
      else {
        validateAssetReference(layer.element.src, `audio layer "${layer.name}"`);
        if (layer.element.src.startsWith('asset:')) {
          const asset = assetById.get(layer.element.src.slice('asset:'.length));
          if (asset && (asset.kind !== 'audio' || !asset.mimeType.startsWith('audio/')))
            errors.push(`${prefix}: audio layer "${layer.name}" must reference an audio asset.`);
        }
      }
      if (
        !Number.isFinite(layer.element.volume) ||
        layer.element.volume < 0 ||
        layer.element.volume > 1
      )
        errors.push(`${prefix}: audio layer "${layer.name}" volume must be from 0 to 1.`);
      if (
        !Number.isFinite(layer.element.trimStartMs) ||
        layer.element.trimStartMs < 0 ||
        !Number.isFinite(layer.element.timelineStartMs) ||
        layer.element.timelineStartMs < 0 ||
        (layer.element.trimEndMs !== null && layer.element.trimEndMs <= layer.element.trimStartMs)
      )
        errors.push(`${prefix}: audio layer "${layer.name}" has invalid trim/timeline values.`);
    } else if (layer.element.type === 'text') {
      const textAnimation = normalizeTextAnimation(layer.element.textAnimation);
      if (
        layer.element.direction !== undefined &&
        !['auto', 'ltr', 'rtl'].includes(layer.element.direction)
      )
        errors.push(`${prefix}: text layer "${layer.name}" has an unsupported text direction.`);
      if (
        !(['auto-size', 'shrink-to-fit', 'fit-to-width', 'squeeze', 'fixed'] as const).includes(
          layer.element.autoFit,
        )
      ) {
        errors.push(`${prefix}: text layer "${layer.name}" has an unsupported text sizing mode.`);
      }
      if (!Number.isFinite(layer.element.strokeWidth) || layer.element.strokeWidth < 0) {
        errors.push(
          `${prefix}: text layer "${layer.name}" stroke width must be finite and non-negative.`,
        );
      }
      if (!Number.isFinite(layer.element.lineHeight) || layer.element.lineHeight < 0.5) {
        errors.push(`${prefix}: text layer "${layer.name}" line height must be at least 0.5.`);
      }
      if (!Number.isFinite(layer.element.letterSpacing)) {
        errors.push(`${prefix}: text layer "${layer.name}" letter spacing must be finite.`);
      }
      if (!Number.isFinite(layer.element.baselineShift)) {
        errors.push(`${prefix}: text layer "${layer.name}" baseline shift must be finite.`);
      }
      if (
        !Number.isFinite(layer.element.minFontSize) ||
        layer.element.minFontSize < 1 ||
        layer.element.minFontSize > layer.element.fontSize
      ) {
        errors.push(
          `${prefix}: text layer "${layer.name}" minimum font size must be between 1 and its authored font size.`,
        );
      }
      if (!['auto', 'ltr', 'rtl'].includes(layer.element.direction)) {
        errors.push(`${prefix}: text layer "${layer.name}" has an invalid text direction.`);
      }
      if (
        layer.element.language &&
        !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(layer.element.language)
      ) {
        errors.push(`${prefix}: text layer "${layer.name}" has an invalid language tag.`);
      }
      if (
        layer.element.runs.length > 0 &&
        layer.element.runs.map((run) => run.text).join('') !== layer.element.content
      ) {
        errors.push(
          `${prefix}: text layer "${layer.name}" styled runs must concatenate to content.`,
        );
      }
      for (const run of layer.element.runs) {
        if (
          run.fontWeight !== undefined &&
          (!Number.isFinite(run.fontWeight) || run.fontWeight < 1)
        )
          errors.push(`${prefix}: text layer "${layer.name}" has an invalid styled-run weight.`);
      }
      if (
        textAnimation.type !== 'none' &&
        (!Number.isInteger(textAnimation.durationFrames) || textAnimation.durationFrames < 1)
      ) {
        errors.push(
          `${prefix}: text layer "${layer.name}" animation duration must be a positive frame count.`,
        );
      }
      if (
        textAnimation.type === 'typewriter' &&
        (!Number.isInteger(textAnimation.cursorBlinkFrames) || textAnimation.cursorBlinkFrames < 1)
      ) {
        errors.push(
          `${prefix}: text layer "${layer.name}" cursor blink period must be a positive frame count.`,
        );
      }
      if (textAnimation.customActionId && !customActionIds.has(textAnimation.customActionId)) {
        errors.push(
          `${prefix}: text layer "${layer.name}" animation references missing custom action "${textAnimation.customActionId}".`,
        );
      }
    }
  }
  for (const field of composition.dataFields) {
    const visitFieldAssets = (
      node: FieldDefinition,
      value: FieldDefinition['defaultValue'],
      owner: string,
    ) => {
      if ((node.type === 'image-url' || node.type === 'file-path') && typeof value === 'string') {
        validateAssetReference(value, owner);
      } else if (
        node.type === 'object' &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        const record = value as Record<string, FieldDefinition['defaultValue']>;
        for (const property of node.properties) {
          if (record[property.key] !== undefined) {
            visitFieldAssets(property, record[property.key]!, `${owner}.${property.key}`);
          }
        }
      } else if (node.type === 'array' && node.items && Array.isArray(value)) {
        value.forEach((item, index) => visitFieldAssets(node.items!, item, `${owner}[${index}]`));
      }
    };
    visitFieldAssets(field, field.defaultValue, `data field "${field.key}"`);
  }

  if (composition.keyframes.every((keyframe) => keyframe.role !== 'step')) {
    warnings.push(
      `${prefix}: has zero pausable steps; playAction moves directly from Start to End.`,
    );
  }
}

/** Structural validation for the editor document, before compiling the OGraf manifest/runtime. */
export function validateProject(project: Project): ProjectValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Array.isArray(project.shaders)) {
    errors.push('Project shader library must be an array.');
  } else {
    const shaderIds: string[] = [];
    for (const [index, resource] of project.shaders.entries()) {
      if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
        errors.push(`Shader library entry ${index + 1} must be an object.`);
        continue;
      }
      if (typeof resource.id !== 'string' || !resource.id.trim())
        errors.push(`Shader library entry ${index + 1} requires a non-empty id.`);
      else shaderIds.push(resource.id);
      if (!isShaderPaint(resource.paint)) {
        errors.push(`Shader library entry "${resource.id || index + 1}" requires a shader paint.`);
        continue;
      }
      const inspection = inspectShaderElement(resource.paint);
      errors.push(
        ...inspection.errors.map(
          (error) => `Shader library entry "${resource.id || index + 1}": ${error}`,
        ),
      );
      warnings.push(
        ...inspection.warnings.map(
          (warning) => `Shader library entry "${resource.id || index + 1}": ${warning}`,
        ),
      );
    }
    for (const id of duplicates(shaderIds)) errors.push(`Duplicate shader resource id "${id}".`);
  }
  if (!project.id.trim()) errors.push('Project id is required.');
  if (!project.name.trim()) errors.push('Project name is required.');
  if (!project.supportsRealTime && !project.supportsNonRealTime) {
    errors.push('Project must support real-time, non-real-time, or both render modes.');
  }
  if (!project.compositions.some((composition) => composition.id === project.mainCompositionId)) {
    errors.push('Main composition id does not reference an existing composition.');
  }
  for (const duplicate of duplicates(project.compositions.map((composition) => composition.id))) {
    errors.push(`Duplicate composition id "${duplicate}".`);
  }
  for (const composition of project.compositions)
    validateComposition(composition, errors, warnings);
  if (project.supportsNonRealTime) {
    for (const composition of project.compositions) {
      if (composition.mediaCues.length > 0) {
        errors.push(
          `Composition "${composition.name}" uses Media Cues, whose initial runtime is real-time-only and cannot declare non-real-time support.`,
        );
      }
      for (const layer of composition.layers) {
        const paint = getElementFill(layer.element);
        if (isMediaPaint(paint))
          errors.push(
            `Composition "${composition.name}": layer "${layer.name}" uses media paint, whose initial runtime is real-time-only and cannot declare non-real-time support.`,
          );
        if (layer.element.type === 'audio')
          errors.push(
            `Composition "${composition.name}": layer "${layer.name}" uses audio, which is real-time-only and cannot declare non-real-time support.`,
          );
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings };
}
