import { scriptModuleName, type CompositionScripting } from '@ograf-editor/scene-model';

/** JavaScript and JSON resources share one basename namespace. */
export function nextScriptResourceName(
  modules: CompositionScripting['modules'],
  prefix: string,
  extension: 'js' | 'json',
): string {
  const names = new Set(
    modules.map((module) => {
      try {
        return scriptModuleName(module.fileName);
      } catch {
        // A filename may be temporarily incomplete while the user edits it.
        return module.fileName.replace(/\.(?:m?js|json)$/, '');
      }
    }),
  );
  let index = 1;
  while (names.has(`${prefix}${index}`)) index++;
  return `${prefix}${index}.${extension}`;
}
