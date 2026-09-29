import type { Project } from '@ograf-editor/scene-model';
import { loadAutosave } from './fileIO';
import { useProjectStore } from './projectStore';
import { useTimelineStore } from './timelineStore';
import { loadLatestAutosave, useAutosaveStatus } from './autosaveStorage';
import { scriptsDisabledAtStartup, withoutProjectScripts } from './safeStart';

/** Initializes project and transport state before React mounts the editor UI. */
export function initializeEditorSession(autosavedProject: Project | null = loadAutosave()): void {
  if (autosavedProject) {
    useProjectStore
      .getState()
      .loadProject(
        scriptsDisabledAtStartup() ? withoutProjectScripts(autosavedProject) : autosavedProject,
      );
    return;
  }
  useTimelineStore.getState().resetForProjectLoad();
}

/** Prefer durable snapshots; the synchronous initializer remains usable by embedded clients. */
export async function restoreEditorSession(): Promise<void> {
  try {
    initializeEditorSession(await loadLatestAutosave());
  } catch (error) {
    useTimelineStore.getState().resetForProjectLoad();
    useAutosaveStatus.setState({
      state: 'error',
      message: `Could not restore the latest autosave. Use Recover to select an earlier snapshot. ${error instanceof Error ? error.message : ''}`,
    });
  }
}
