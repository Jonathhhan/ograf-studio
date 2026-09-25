import type { Composition, Project } from './types';

export type PlayoutCompatibilityWarningId =
  'davinci-resolve-non-realtime' | 'opaque-composition-background';

export interface PlayoutCompatibilityWarning {
  id: PlayoutCompatibilityWarningId;
  message: string;
}

/**
 * Legal OGraf configurations that are known to be unsuitable for common overlay/editing workflows.
 * These are advisory by design and must remain separate from validation and certification errors.
 */
export function getPlayoutCompatibilityWarnings(
  project: Pick<Project, 'supportsNonRealTime'>,
  composition: Pick<Composition, 'backgroundColor'>,
): PlayoutCompatibilityWarning[] {
  const warnings: PlayoutCompatibilityWarning[] = [];
  if (!project.supportsNonRealTime) {
    warnings.push({
      id: 'davinci-resolve-non-realtime',
      message:
        'DaVinci Resolve loads OGraf graphics in non-real-time mode and cannot render a real-time-only package. Choose Non-real-time or Dual for Resolve.',
    });
  }
  if (composition.backgroundColor.trim().toLowerCase() !== 'transparent') {
    warnings.push({
      id: 'opaque-composition-background',
      message:
        'An opaque composition background covers the entire frame in a playout chain. Enable Transparent output when the graphic should overlay video.',
    });
  }
  return warnings;
}
