import type { Project } from '@ograf-editor/scene-model';

export function scriptsDisabledAtStartup(): boolean {
  return (
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location?.search).get('scripts') === 'off'
  );
}

/** Work on a detached recovery copy; original autosaves remain untouched. */
export function withoutProjectScripts(project: Project): Project {
  const copy = JSON.parse(JSON.stringify(project)) as Project;
  const disable = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.scripting && typeof record.scripting === 'object')
      (record.scripting as { enabled: boolean }).enabled = false;
    if (record.expressions && typeof record.expressions === 'object')
      record.expressionsEnabled = Object.fromEntries(
        Object.keys(record.expressions).map((key) => [key, false]),
      );
    for (const nested of Object.values(record)) disable(nested);
  };
  disable(copy);
  return copy;
}
