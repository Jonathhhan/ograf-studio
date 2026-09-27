import { useRef, useState } from 'react';
import {
  compositionScriptSyntaxError,
  scriptModuleName,
  scriptModuleSyntaxError,
  type Composition,
  type CompositionScripting,
} from '@ograf-editor/scene-model';
import { useActiveComposition, useProjectStore } from '../state/projectStore';
import { useExpressionDiagnosticsStore } from '../state/expressionDiagnosticsStore';
import { LayerExpressionsEditor } from './LayerExpressionsEditor';
import './ScriptsPanel.css';

const EMPTY: CompositionScripting = { source: '', enabled: false, modules: [] };

export function ScriptsPanel() {
  const composition = useActiveComposition();
  const [view, setView] = useState('expressions');
  return (
    <div className="scripts-panel">
      <label className="scripts-file-select">
        Edit
        <select
          aria-label="Scripting view"
          value={view}
          onChange={(event) => setView(event.target.value)}
        >
          <option value="expressions">Layer expressions</option>
          <option value="scripts">Composition &amp; modules</option>
        </select>
      </label>
      <div hidden={view !== 'expressions'}>
        <LayerExpressionsEditor key={composition.id} />
      </div>
      <div className="scripts-editor-view" hidden={view !== 'scripts'}>
        <ScriptEditor key={composition.id} composition={composition} />
      </div>
    </div>
  );
}

function ScriptEditor({ composition }: { composition: Composition }) {
  const saved = composition.scripting ?? EMPTY;
  const [baseline, setBaseline] = useState(saved);
  const [draft, setDraft] = useState(saved);
  const [selected, setSelected] = useState(-1);
  const [importError, setImportError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const update = useProjectStore((state) => state.updateCompositionSettings);
  const diagnostics = useExpressionDiagnosticsStore();
  // External edits and undo/redo replace the immutable settings object.
  if (baseline !== saved) {
    setBaseline(saved);
    if (baseline.source === saved.source && baseline.modules === saved.modules) {
      setDraft({ ...draft, enabled: saved.enabled });
    } else {
      setDraft(saved);
      setSelected(-1);
    }
  }
  const hasCodeChanges = draft.source !== saved.source || draft.modules !== saved.modules;
  const file = draft.modules[selected];
  let syntaxError = compositionScriptSyntaxError(draft.source);
  const names = new Set<string>();
  for (const module of draft.modules) {
    try {
      const name = scriptModuleName(module.fileName);
      if (names.has(name)) throw new Error('Duplicate module name: ' + name);
      names.add(name);
      const error = scriptModuleSyntaxError(module.source);
      if (error) throw new Error(error);
    } catch (error) {
      syntaxError ??=
        module.fileName + ': ' + (error instanceof Error ? error.message : String(error));
    }
  }
  const runtimeErrors =
    diagnostics.compositionId === composition.id
      ? [
          ...new Set(
            diagnostics.diagnostics
              .filter((entry) => entry.property === 'script')
              .map((entry) => entry.message),
          ),
        ]
      : [];
  const editFile = (patch: Partial<{ fileName: string; source: string }>) =>
    setDraft((current) => ({
      ...current,
      modules: current.modules.map((module, index) =>
        index === selected ? { ...module, ...patch } : module,
      ),
    }));
  const importFiles = async (files: File[]) => {
    setImportError('');
    try {
      const imported = await Promise.all(
        files.map(async (file) => {
          scriptModuleName(file.name);
          if (file.size > 1024 * 1024) throw new Error(file.name + ' exceeds 1 MB.');
          return { fileName: file.name, source: await file.text() };
        }),
      );
      setDraft((current) => ({ ...current, modules: [...current.modules, ...imported] }));
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <div className="scripts-editor">
      <div className="scripts-toolbar">
        <button
          type="button"
          disabled={!hasCodeChanges || !!syntaxError}
          onClick={() => update({ scripting: { ...draft, enabled: saved.enabled } })}
        >
          Apply
        </button>
        <button
          type="button"
          disabled={!hasCodeChanges}
          onClick={() => {
            setDraft(saved);
            setSelected(-1);
            setImportError('');
          }}
        >
          Revert
        </button>
        <label>
          <input
            type="checkbox"
            checked={saved.enabled}
            onChange={(event) => update({ scripting: { ...saved, enabled: event.target.checked } })}
          />
          Composition script enabled
        </label>
      </div>
      <label className="scripts-file-select">
        Script
        <select
          value={file ? selected : -1}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          <option value={-1}>Composition (each frame)</option>
          {draft.modules.map((module, index) => (
            <option key={index} value={index}>
              {module.fileName}
            </option>
          ))}
        </select>
      </label>
      <div className="scripts-toolbar">
        <button type="button" onClick={() => fileInput.current?.click()}>
          Import .js files
        </button>
        <button
          type="button"
          onClick={() => {
            let index = 1;
            while (draft.modules.some((module) => module.fileName === `helpers${index}.js`))
              index++;
            setSelected(draft.modules.length);
            setDraft({
              ...draft,
              modules: [...draft.modules, { fileName: `helpers${index}.js`, source: '' }],
            });
          }}
        >
          New module
        </button>
        {file && (
          <button
            type="button"
            onClick={() => {
              setDraft({
                ...draft,
                modules: draft.modules.filter((_, index) => index !== selected),
              });
              setSelected(-1);
            }}
          >
            Remove module
          </button>
        )}
        <input
          ref={fileInput}
          hidden
          type="file"
          multiple
          accept=".js,.mjs"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void importFiles(files);
          }}
        />
      </div>
      {file && (
        <label className="scripts-file-select">
          Filename
          <input
            value={file.fileName}
            onChange={(event) => editFile({ fileName: event.target.value })}
          />
        </label>
      )}
      <textarea
        aria-label={file ? 'Module source' : 'Composition script'}
        spellCheck={false}
        value={file?.source ?? draft.source}
        onChange={(event) => {
          const source = event.target.value;
          if (file) editFile({ source });
          else setDraft({ ...draft, source });
        }}
      />
      {importError && (
        <p role="alert" className="inspector-error">
          {importError}
        </p>
      )}
      {syntaxError && (
        <p role="alert" className="inspector-error">
          {syntaxError}
        </p>
      )}
      {!hasCodeChanges &&
        runtimeErrors.map((message) => (
          <p role="alert" className="inspector-error" key={message}>
            {message}
          </p>
        ))}
    </div>
  );
}
