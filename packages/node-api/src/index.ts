/** Versioned, browser-free authoring boundary. No AE-specific contracts. */
export {
  createProject,
  createComposition,
  createAsset,
  createFieldDefinition,
  createKeyframe,
  createLayerKeyframe,
  createLayerPropertyKeyframe,
  createLayerOfKind,
  createTransition,
  computeKeyframeFrames,
  parseEditablePath,
  serializeEditablePath,
  resolveWorldTransforms,
  migrateProject,
} from '@ograf-editor/scene-model';
export { validateProject } from '../../validation/src/validateProject';
export { renderCompositionFrameSvg } from '../../authoring-core/src/renderFrame';
export { compileDescriptor } from '../../codegen/src/compileDescriptor';
export type { Project, Composition, Layer } from '@ograf-editor/scene-model';

export const studioNodeApi = Object.freeze({
  version: 1,
  capabilities: Object.freeze({
    compositionScripts: true,
    transformHierarchy2D: true,
    frameSampling: true,
    editablePaths: true,
    descriptorCompilation: true,
  }),
});
export type StudioNodeCapability = keyof typeof studioNodeApi.capabilities;
export function assertStudioCapabilities(required: readonly StudioNodeCapability[]): void {
  const missing = required.filter((key) => studioNodeApi.capabilities[key] !== true);
  if (missing.length) throw new Error('Unsupported Studio capabilities: ' + missing.join(', '));
}
