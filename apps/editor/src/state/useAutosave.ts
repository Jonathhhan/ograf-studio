import { useEffect } from 'react';
import { useProjectStore } from './projectStore';
import { saveAutosave } from './fileIO';
import { useAutosaveStatus } from './autosaveStorage';
import { scriptsDisabledAtStartup } from './safeStart';

export function useAutosave(delayMs = 500): void {
  useEffect(() => {
    if (scriptsDisabledAtStartup()) {
      useAutosaveStatus.setState({
        state: 'paused',
        message:
          'Safe start: autosave paused to preserve originals. Save Project to keep recovery edits.',
      });
      return;
    }
    let timeout: number | undefined;
    let pending: ReturnType<typeof useProjectStore.getState>['project'] | undefined;
    const flush = () => {
      window.clearTimeout(timeout);
      if (pending) {
        void saveAutosave(pending);
        pending = undefined;
      }
    };
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.project === previous.project) return;
      // Preserve the last edit before switching to a different project.
      if (pending && pending.id !== state.project.id) flush();
      pending = state.project;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(flush, delayMs);
    });
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      flush();
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [delayMs]);
}
