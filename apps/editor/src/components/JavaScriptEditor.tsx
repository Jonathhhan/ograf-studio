import { useLayoutEffect, useMemo, useRef } from 'react';
import { Annotation, Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  placeholder,
} from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language';
import { javascript, localCompletionSource } from '@codemirror/lang-javascript';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { linter } from '@codemirror/lint';
import { syntaxTree } from '@codemirror/language';
import {
  expressionSyntaxError,
  compositionScriptSyntaxError,
  scriptModuleSyntaxError,
} from '@ograf-editor/scene-model';
import { createScriptCompletionSource, type ScriptEditorContext } from './scriptCompletions';
import { oneDark } from '@codemirror/theme-one-dark';
import { undo, redo } from '../state/historyStore';

const externalChange = Annotation.define<boolean>();

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
  const completion = useMemo(
    () => (context ? createScriptCompletionSource(context) : null),
    [context?.composition, context?.mode, context?.layer],
  );
  useLayoutEffect(() => {
    callback.current = onChange;
  });

  useLayoutEffect(() => {
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
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
          keymap.of([
            ...completionKeymap,
            {
              key: 'Mod-z',
              run: () => {
                undo();
                return true;
              },
            },
            {
              key: 'Mod-Shift-z',
              run: () => {
                redo();
                return true;
              },
            },
            {
              key: 'Mod-y',
              run: () => {
                redo();
                return true;
              },
            },
            indentWithTab,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(externalChange))
            )
              callback.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
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
        ...(context
          ? [
              linter((view) => {
                const source = view.state.doc.toString();
                const validate =
                  context.mode === 'module'
                    ? scriptModuleSyntaxError
                    : context.mode === 'expression'
                      ? expressionSyntaxError
                      : compositionScriptSyntaxError;
                const message = validate(source);
                if (!message) return [];
                let from = 0,
                  to = Math.min(1, source.length);
                // Use parser positions when available; host-engine validation remains authoritative.
                syntaxTree(view.state).iterate({
                  enter(node) {
                    if (node.type.isError) {
                      from = node.from;
                      to = Math.min(source.length, Math.max(node.to, node.from + 1));
                      return false;
                    }
                  },
                });
                return [{ from, to, severity: 'error' as const, message }];
              }),
            ]
          : []),
      ]),
    });
  }, [completion, context?.mode]);

  useLayoutEffect(() => {
    const view = editor.current!;
    if (view.state.doc.toString() !== value)
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: externalChange.of(true),
      });
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
