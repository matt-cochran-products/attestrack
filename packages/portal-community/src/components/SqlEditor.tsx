import { useEffect, useRef } from 'react';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';
import { EditorState, Prec } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { sql } from '@codemirror/lang-sql';
import { buildSqlAutocompleteSchema, SQL_DEFAULT_TABLE } from '../lib/explore/autocomplete';

/**
 * EXP.1/EXP.6 — CodeMirror 6 SQL editor with schema autocomplete sourced from
 * the `@attestrack/types` event schema + Explore table allowlist. Autocomplete
 * can only ever offer tables the server-side gate accepts.
 */
export interface SqlEditorProps {
  value: string;
  onChange: (sql: string) => void;
  /** Mod-Enter runs the query (EXP.1 editor ergonomics). */
  onRun?: () => void;
  ariaLabel?: string;
}

const editorTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'rgba(0,0,0,0.35)',
      border: '1px solid rgba(255,255,255,0.12)',
      fontSize: '12px',
      minHeight: '160px',
    },
    '.cm-content': {
      fontFamily: "'IBM Plex Mono', monospace",
      color: 'rgba(245,242,236,0.85)',
      caretColor: 'rgba(245,242,236,0.85)',
    },
    '.cm-gutters': {
      backgroundColor: 'rgba(0,0,0,0.25)',
      color: 'rgba(245,242,236,0.25)',
      border: 'none',
    },
    '&.cm-focused': { outline: '1px solid rgba(76,175,125,0.5)' },
    '.cm-tooltip': {
      backgroundColor: '#1c1c1c',
      color: 'rgba(245,242,236,0.85)',
      border: '1px solid rgba(255,255,255,0.12)',
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: '11px',
    },
  },
  { dark: true },
);

export default function SqlEditor({ value, onChange, onRun, ariaLabel }: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          sql({
            schema: buildSqlAutocompleteSchema(),
            defaultTable: SQL_DEFAULT_TABLE,
            upperCaseKeywords: true,
          }),
          autocompletion(),
          placeholder('SELECT eventName, count() AS c FROM events GROUP BY eventName'),
          Prec.highest(
            keymap.of([
              {
                key: 'Mod-Enter',
                run: () => {
                  onRunRef.current?.();
                  return true;
                },
              },
            ]),
          ),
          keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
          editorTheme,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once; external value changes are synced by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync external value changes (e.g. loading a saved query) into the editor.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} role="textbox" aria-label={ariaLabel ?? 'SQL editor'} />;
}
