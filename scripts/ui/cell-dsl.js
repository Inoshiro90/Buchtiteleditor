// editor/ui/cell-dsl.js
// AG Grid Custom Cell Editor + Cell Renderer for DSL fields
// Uses CodeMirror 6 loaded via ESM from CDN

import { highlightDSL, validateDSL, buildKnownLemmas } from '../services/dsl-validator.js';
import { AppStore } from '../store/AppStore.js';

// ── CodeMirror 6 lazy loader ───────────────────────────────────────────────
let _cm = null;

async function getCM() {
  if (_cm) return _cm;

  const [
    { EditorView, keymap, highlightActiveLine, drawSelection, placeholder },
    { EditorState, Compartment },
    { defaultKeymap, indentWithTab },
    { syntaxHighlighting, HighlightStyle },
    { tags },
    { linter, lintGutter },
  ] = await Promise.all([
    import('https://esm.sh/@codemirror/view@6'),
    import('https://esm.sh/@codemirror/state@6'),
    import('https://esm.sh/@codemirror/commands@6'),
    import('https://esm.sh/@codemirror/language@6'),
    import('https://esm.sh/@lezer/highlight@1'),
    import('https://esm.sh/@codemirror/lint@6'),
  ]);

  _cm = { EditorView, keymap, highlightActiveLine, drawSelection, placeholder,
          EditorState, Compartment, defaultKeymap, indentWithTab,
          syntaxHighlighting, HighlightStyle, tags, linter, lintGutter };
  return _cm;
}

// ── DSL CodeMirror language extension ─────────────────────────────────────
function buildDSLExtensions(cm, onUpdate, onCommit, onCancel) {
  const { EditorView, keymap, highlightActiveLine, drawSelection,
          defaultKeymap, syntaxHighlighting, HighlightStyle,
          tags, linter, lintGutter } = cm;

  // Custom DSL syntax highlighter using decorations
  const DSL_THEME = EditorView.theme({
    // Transparent — let the AG Grid cell provide all visual styling
    '&': {
      background: 'transparent',
      color: 'inherit',
      fontFamily: 'var(--font-sans)',
      fontSize: '13px',
      outline: 'none',
      width: '100%',
    },
    '.cm-content': {
      padding: '0',
      caretColor: 'var(--color-accent)',
      minHeight: 'unset',
    },
    '.cm-focused': { outline: 'none' },
    '.cm-line': { lineHeight: 'inherit', padding: '0' },
    '.cm-selectionBackground': { background: 'rgba(0,117,222,0.18)' },
    '&.cm-focused .cm-selectionBackground': { background: 'rgba(0,117,222,0.25)' },
    '.cm-cursor': { borderLeftColor: 'var(--color-accent)', borderLeftWidth: '2px' },
    '.cm-tooltip': {
      background: 'var(--bg-surface)',
      border: '1px solid var(--border-color)',
      borderRadius: '4px',
      fontSize: '11px',
      color: 'var(--text-primary)',
      boxShadow: 'var(--shadow-card)',
    },
    '.cm-lintRange-error':   { textDecoration: 'underline wavy var(--c-dsl-err)' },
    '.cm-lintRange-warning': { textDecoration: 'underline wavy var(--color-warn)' },
    '.cm-diagnostic-error':  { borderLeft: '3px solid var(--c-dsl-err)' },
    '.cm-diagnostic-warning':{ borderLeft: '3px solid var(--color-warn)' },
    '.cm-gutters': { display: 'none' },
  }, { dark: false });

  // DSL token decoration via ViewPlugin
  const dslTokenHighlighter = EditorView.decorations.compute(['doc'], (state) => {
    const { Decoration } = window.__cmDecoration ?? {};
    // Fallback to regex-based class injection via DOM (Phase-2 approach)
    return [];
  });

  // Linter
  const dslLinter = linter((view) => {
    const text = view.state.doc.toString();
    const schemas = AppStore.get('schemas') ?? [];
    const knownLemmas = buildKnownLemmas(schemas);
    const errors = validateDSL(text, knownLemmas);
    return errors.map(e => ({
      from: e.start,
      to: Math.max(e.end, e.start + 1),
      severity: e.severity,
      message: e.message,
    }));
  }, { delay: 300 });

  // Keymap: Enter = commit, Escape = cancel, Tab = insert spaces
  const dslKeymap = keymap.of([
    { key: 'Enter', run: () => { onCommit(); return true; } },
    { key: 'Escape', run: () => { onCancel(); return true; } },
    ...defaultKeymap,
  ]);

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onUpdate(update.state.doc.toString());
  });

  return [DSL_THEME, dslLinter, lintGutter(), dslKeymap, highlightActiveLine(), updateListener];
}

// ── Cell Renderer (read-only: coloured spans) ─────────────────────────────
export class DSLCellRenderer {
  init(params) {
    this.el = document.createElement('span');
    this.el.className = 'dsl-cell-content';
    this.refresh(params);
  }

  refresh(params) {
    const val = params.value ?? '';
    this.el.innerHTML = val ? highlightDSL(val) : '<span class="dsl-empty">—</span>';
    return true;
  }

  getGui() { return this.el; }
  destroy() {}
}

// ── Cell Editor (CodeMirror 6) ─────────────────────────────────────────────
export class DSLCellEditor {
  constructor() {
    this._view = null;
    this._value = '';
    this._committed = false;
    this._wrapper = null;
  }

  async init(params) {
    this._value = params.value ?? '';
    this._params = params;

    // Wrapper fills the cell exactly — AG Grid handles positioning when popup=false
    this._wrapper = document.createElement('div');
    this._wrapper.className = 'dsl-editor-wrapper';
    this._wrapper.style.cssText = 'width:100%;height:100%;';

    const cm = await getCM();
    const { EditorView, EditorState } = cm;

    this._view = new EditorView({
      state: EditorState.create({
        doc: this._value,
        extensions: buildDSLExtensions(
          cm,
          (val) => { this._value = val; },
          () => this._commit(),
          () => this._cancel(),
        ),
      }),
      parent: this._wrapper,
    });

    // Focus is handled in afterGuiAttached where cell dimensions are available
  }

  _commit() {
    this._committed = true;
    this._params?.stopEditing(false);
  }

  _cancel() {
    this._committed = false;
    this._params?.stopEditing(true);
  }

  /** Called by AG Grid to read the final value */
  getValue() { return this._value; }

  isCancelAfterEnd() { return false; }
  isCancelBeforeStart() { return false; }

  getGui() { return this._wrapper; }

  afterGuiAttached() {
    // Inline mode: AG Grid has already sized the cell container.
    // Just focus and move cursor to end.
    this._view?.focus();
    const len = this._value.length;
    this._view?.dispatch({ selection: { anchor: len, head: len } });
  }

  destroy() {
    this._view?.destroy();
    this._view = null;
  }

  /** Expose the CodeMirror view so token dialogs can insert at cursor */
  getView() { return this._view; }
}

// ── Active editor registry ─────────────────────────────────────────────────
// The token insert dialog needs to know which CM instance is active
let _activeEditor = null;

export function setActiveDSLEditor(editor) { _activeEditor = editor; }
export function getActiveDSLEditor() { return _activeEditor; }

/**
 * Insert a token string at the current cursor position in the active editor.
 */
export function insertTokenAtCursor(tokenString) {
  const editor = _activeEditor;
  if (!editor) return;
  const view = editor.getView?.();
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: tokenString },
    selection: { anchor: from + tokenString.length },
  });
  view.focus();
}
