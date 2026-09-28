import { useLayoutEffect, useMemo, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from '@codemirror/view';
import {
  defaultKeymap,
  indentWithTab,
  history,
  undo as undoDraft,
  redo as redoDraft,
} from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { javascript, localCompletionSource } from '@codemirror/lang-javascript';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { createScriptCompletionSource, type ScriptEditorContext } from './scriptCompletions';
import { oneDark } from '@codemirror/theme-one-dark';
import { undo, redo } from '../state/historyStore';

export function JavaScriptEditor({
  value,
  onChange,
  label,
  readOnly = false,
  invalid = false,
  describedBy,
  placeholder: hint = '',
  context,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  readOnly?: boolean;
  invalid?: boolean;
  describedBy?: string | undefined;
  placeholder?: string;
  context?: ScriptEditorContext;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const callback = useRef(onChange);
  const configuration = useRef(new Compartment());
  const assistance = useRef(new Compartment());
  const draftHistory = useRef(new Compartment());
  const committed = useRef(value);
  const completion = useMemo(
    () => (context ? createScriptCompletionSource(context) : null),
    [context?.composition, context?.mode, context?.layer],
  );
  useLayoutEffect(() => {
    callback.current = onChange;
  });

  useLayoutEffect(() => {
    const commit = (view: EditorView) => {
      const source = view.state.doc.toString();
      if (source === committed.current) return;
      committed.current = source;
      callback.current(source);
      view.dispatch({ effects: draftHistory.current.reconfigure([]) });
      view.dispatch({ effects: draftHistory.current.reconfigure(history()) });
    };
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: committed.current,
        extensions: [
          javascript(),
          oneDark,
          lineNumbers(),
          highlightActiveLine(),
          bracketMatching(),
          indentOnInput(),
          indentUnit.of('  '),
          configuration.current.of([]),
          assistance.current.of([]),
          draftHistory.current.of(history()),
          EditorView.domEventHandlers({
            blur: (_event, view) => {
              commit(view);
            },
          }),
          keymap.of([
            ...completionKeymap,
            {
              key: 'Mod-z',
              run: (view) => {
                if (undoDraft(view)) return true;
                undo();
                return true;
              },
            },
            {
              key: 'Mod-Shift-z',
              run: (view) => {
                if (redoDraft(view)) return true;
                redo();
                return true;
              },
            },
            {
              key: 'Mod-y',
              run: (view) => {
                if (redoDraft(view)) return true;
                redo();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
    editor.current = view;
    return () => {
      commit(view);
      editor.current = null;
      view.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    editor.current!.dispatch({
      effects: assistance.current.reconfigure([
        autocompletion({
          override: completion ? [completion, localCompletionSource] : [localCompletionSource],
        }),
      ]),
    });
  }, [completion, context?.mode]);

  useLayoutEffect(() => {
    const view = editor.current!;
    committed.current = value;
    if (view.state.doc.toString() !== value) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        effects: draftHistory.current.reconfigure([]),
      });
      view.dispatch({ effects: draftHistory.current.reconfigure(history()) });
    }
  }, [value]);

  useLayoutEffect(() => {
    editor.current!.dispatch({
      effects: configuration.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
        placeholder(hint),
        EditorView.contentAttributes.of({
          'aria-label': label,
          'aria-invalid': String(invalid),
          'aria-readonly': String(readOnly),
          ...(describedBy ? { 'aria-describedby': describedBy } : {}),
          spellcheck: 'false',
        }),
      ]),
    });
  }, [readOnly, label, invalid, describedBy, hint]);

  return <div ref={host} className="javascript-editor" data-invalid={invalid} />;
}
