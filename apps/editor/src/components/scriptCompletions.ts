import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { javascriptLanguage } from '@codemirror/lang-javascript';
import {
  SCRIPT_ELEMENT_CATALOG,
  SCRIPT_EFFECT_CATALOG,
  scriptLayerPropertyCatalog,
  scriptModuleName,
  type Composition,
  type Layer,
  type ScriptPropertyDefinition,
} from '@ograf-editor/scene-model';

export interface ScriptEditorContext {
  composition: Composition;
  mode: 'expression' | 'composition' | 'module';
  layer?: Layer;
}

const identifier = /^[A-Za-z_$][\w$]*$/;
const stringPattern = `(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')`;
const callPattern = `(?:layer|layerById)\\(\\s*${stringPattern}\\s*\\)`;
const exportCache = new WeakMap<object, Completion[]>();

function quoted(value: string, quote: string): string {
  return quote === '"'
    ? JSON.stringify(value)
    : "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}

/** Inspect declarations only: completion must never instantiate user modules. */
export function moduleExportCompletions(source: string): Completion[] {
  const tree = javascriptLanguage.parser.parse(source);
  const result: Completion[] = [];
  for (const declaration of tree.topNode.getChildren('ExportDeclaration')) {
    if (declaration.getChild('default')) result.push({ label: 'default', type: 'variable' });
    else {
      const definition =
        declaration.getChild('FunctionDeclaration') ??
        declaration.getChild('ClassDeclaration') ??
        declaration.getChild('VariableDeclaration');
      if (definition)
        for (const name of definition.getChildren('VariableDefinition'))
          result.push({
            label: source.slice(name.from, name.to),
            type:
              definition.name === 'FunctionDeclaration'
                ? 'function'
                : definition.name === 'ClassDeclaration'
                  ? 'class'
                  : 'variable',
          });
      const group = declaration.getChild('ExportGroup');
      if (group)
        for (let node = group.firstChild; node; node = node.nextSibling) {
          if (node.name !== 'VariableName' || node.nextSibling?.name === 'as') continue;
          result.push({ label: source.slice(node.from, node.to), type: 'variable' });
        }
    }
  }
  return result;
}

function properties(catalog: Record<string, ScriptPropertyDefinition>): Completion[] {
  return Object.entries(catalog).map(([label, spec]) => ({
    label,
    type: spec.type === 'function' ? 'function' : 'property',
    detail: `${spec.type}${spec.nullable ? ' | null' : ''}${spec.readOnly ? ' · read-only' : ''}`,
    info: [spec.description, spec.values?.map((value) => JSON.stringify(value)).join(' | ')]
      .filter(Boolean)
      .join('\n'),
  }));
}

export function createScriptCompletionSource(config: ScriptEditorContext) {
  const modules = new Map<string, Completion[]>();
  for (const module of config.composition.scripting?.modules ?? []) {
    try {
      let exports = exportCache.get(module);
      if (!exports) {
        exports = moduleExportCompletions(module.source);
        exportCache.set(module, exports);
      }
      modules.set(scriptModuleName(module.fileName), exports);
    } catch {
      /* Incomplete filenames remain editable, but are not executable namespaces. */
    }
  }
  const resolveLayer = (source: string): Layer | undefined => {
    const call = /^(layer|layerById)\(\s*([\s\S]*?)\s*\)$/.exec(source);
    if (!call) return;
    const candidates = config.composition.layers.filter((layer) => {
      const value = call[1] === 'layer' ? layer.name : layer.id;
      return call[2] === quoted(value, '"') || call[2] === quoted(value, "'");
    });
    return candidates.length === 1 ? candidates[0] : undefined;
  };
  return (context: CompletionContext): CompletionResult | null => {
    if (config.mode === 'module') return null; // Helpers receive values explicitly; no injected scene globals.
    const prefix = context.state.sliceDoc(0, context.pos);
    const tree = syntaxTree(context.state);
    const bindings = new Map<string, number>();
    tree.iterate({
      enter(node) {
        if (node.name === 'VariableDefinition') {
          const name = context.state.sliceDoc(node.from, node.to);
          bindings.set(name, (bindings.get(name) ?? 0) + 1);
        }
      },
    });
    const node = tree.resolveInner(context.pos, -1);
    if (/Comment/.test(node.name)) return null;
    const nameMatch = /\b(layer|layerById)\(\s*(["'])([^"']*)$/.exec(prefix);
    if (nameMatch) {
      if (bindings.has(nameMatch[1]!)) return null;
      const quote = nameMatch[2]!;
      const byId = nameMatch[1] === 'layerById';
      const next = context.state.sliceDoc(context.pos, context.pos + 1);
      return {
        from: context.pos - nameMatch[3]!.length,
        options: config.composition.layers
          .filter(
            (layer, _, layers) =>
              byId || layers.filter((other) => other.name === layer.name).length === 1,
          )
          .map((layer) => ({
            label: byId ? layer.id : layer.name,
            detail: layer.element.type,
            apply:
              quoted(byId ? layer.id : layer.name, quote).slice(1, -1) +
              (next === quote ? '' : quote),
          })),
      };
    }
    if (/String|Template/.test(node.name)) return null;
    const member = new RegExp(
      `(${callPattern}|[A-Za-z_$][\\w$]*)((?:\\.[A-Za-z_$][\\w$]*)*)\\.([\\w$]*)$`,
    ).exec(prefix);
    if (member) {
      const base = member[1]!,
        path = member[2]!.split('.').filter(Boolean);
      const from = context.pos - member[3]!.length;
      let layer =
        base === 'thisLayer' && config.mode === 'expression' ? config.layer : resolveLayer(base);
      if (bindings.has(base.split('(')[0]!)) layer = undefined;
      // Only unambiguous top-level const aliases; arbitrary JS remains the editor's local completion domain.
      if (!layer && identifier.test(base)) {
        const definitions = tree.topNode
          .getChildren('VariableDeclaration')
          .flatMap((declaration) => {
            if (declaration.from >= context.pos || !declaration.getChild('const')) return [];
            const name = declaration.getChild('VariableDefinition'),
              call = declaration.getChild('CallExpression');
            return name && call && context.state.sliceDoc(name.from, name.to) === base
              ? [call]
              : [];
          });
        if (definitions.length === 1 && bindings.get(base) === 1) {
          const call = context.state.sliceDoc(definitions[0]!.from, definitions[0]!.to);
          if (!bindings.has(call.split('(')[0]!.trim())) layer = resolveLayer(call);
        }
      }
      if (!layer && bindings.has(base.split('(')[0]!)) return null;
      let options: Completion[] | undefined;
      if (layer) {
        if (!path.length)
          options = properties(scriptLayerPropertyCatalog(layer.element.type, config.mode));
        else if (config.mode === 'composition' && path.join('.') === 'element')
          options = properties({
            ...SCRIPT_ELEMENT_CATALOG[layer.element.type],
            type: { type: 'string', readOnly: true },
          });
        else if (config.mode === 'composition' && path.join('.') === 'effects')
          options = properties(SCRIPT_EFFECT_CATALOG);
      } else if (base === 'data') {
        let fields = config.composition.dataFields;
        for (const part of path)
          fields = fields.find((field) => field.key === part)?.properties ?? [];
        options = fields.map((field) => ({
          label: field.key,
          type: 'property',
          detail: `${field.type} · read-only`,
          info: field.description,
          ...(identifier.test(field.key)
            ? {}
            : {
                apply: (view, _completion, start, end) =>
                  view.dispatch({
                    changes: { from: start - 1, to: end, insert: `[${JSON.stringify(field.key)}]` },
                  }),
              }),
        }));
      } else if (!path.length) {
        const names: Record<string, string[]> = {
          comp: ['width', 'height'],
          timeline: ['startFrame', 'endFrame', 'firstStepFrame', 'lastStepFrame', 'exitProgress'],
          console: ['log', 'info', 'warn', 'error', 'debug'],
          ...(config.mode === 'expression'
            ? { thisProperty: ['name', 'value', 'layerId', 'valueAtTime'] }
            : {}),
        };
        options =
          modules.get(base) ??
          names[base]?.map((label) => ({
            label,
            type: base === 'console' || label === 'valueAtTime' ? 'function' : 'property',
          }));
        if (base === 'modules')
          options = [...modules.keys()].map((label) => ({ label, type: 'namespace' }));
      } else if (base === 'modules' && path.length === 1) options = modules.get(path[0]!);
      return options ? { from, options, validFor: /^[\w$]*$/ } : null;
    }
    const word = context.matchBefore(/[\w$]*/);
    if (!word || (!word.text && !context.explicit)) return null;
    const globals = [
      'layer',
      'layerById',
      'data',
      'comp',
      'timeline',
      'frame',
      'time',
      'console',
      'lerp',
      'clamp',
      'ease',
      'modules',
    ];
    if (config.mode === 'expression')
      globals.push('value', 'thisLayer', 'thisProperty', 'valueAtTime', 'sourceRectAtTime');
    return {
      from: word.from,
      options: [...globals, ...modules.keys()].map((label) => ({
        label,
        type: [
          'layer',
          'layerById',
          'lerp',
          'clamp',
          'ease',
          'valueAtTime',
          'sourceRectAtTime',
        ].includes(label)
          ? 'function'
          : 'variable',
      })),
      validFor: /^[\w$]*$/,
    };
  };
}
