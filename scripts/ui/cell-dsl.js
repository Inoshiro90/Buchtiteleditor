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

  // WARUM tooltipParent = document.body:
  //   CodeMirror rendert Lint-Tooltips standardmäßig in den .cm-editor-Container,
  //   der innerhalb der AG-Grid-Zelle liegt. AG Grid setzt overflow:hidden auf
  //   Zellen und Rows → Tooltip wird abgeschnitten.
  //   Mit tooltipParent = document.body wird der Tooltip außerhalb des Zell-Containers
  //   an <body> angehängt und per position:fixed positioniert → kein Clipping möglich.
  //
  //   Zusätzlich: Das DSL-Diagnostic-Panel (unten) rendert Fehler in einem globalen
  //   Portal-Element (#dsl-diagnostic-portal) klar unterhalb der aktiven Zelle.
  let tooltipParentExt = [];
  try {
    tooltipParentExt = [EditorView.tooltipParent.of(document.body)];
  } catch (_) {
    // tooltipParent-Facet nicht verfügbar in dieser CM-Version → ignorieren
  }

  // Keymap: Enter = commit, Escape = cancel, Tab = insert spaces
  const dslKeymap = keymap.of([
    { key: 'Enter', run: () => { onCommit(); return true; } },
    { key: 'Escape', run: () => { onCancel(); return true; } },
    ...defaultKeymap,
  ]);

  // Diagnostic-Portal-Listener:
  // Hält den globalen #dsl-diagnostic-portal synchron mit dem aktuellen Lint-Status.
  // Wird bei jeder Doc-Änderung neu evaluiert (via updateListener).
  const diagnosticPortalListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onUpdate(update.state.doc.toString());
  });

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onUpdate(update.state.doc.toString());
  });

  return [DSL_THEME, ...tooltipParentExt, dslLinter, lintGutter(), dslKeymap, highlightActiveLine(), updateListener];
}

// ── Diagnostic Portal ─────────────────────────────────────────────────────
// Ein globales floating <div> außerhalb jeder Tabellenzelle.
// Rendert Fehlermeldungen unterhalb der aktiven Zelle — kein overflow:hidden-Clip.
//
// ARCHITEKTUR:
//   Das Portal-Element wird einmalig an <body> angehängt (z-index: --z-overlay+1).
//   DSLCellEditor.afterGuiAttached() richtet einen ResizeObserver auf die Zelle ein,
//   der die Portal-Position synchron hält (scrollt/resized der User → Portal folgt).
//   DSLCellEditor.destroy() blendet das Portal aus und disconnected den Observer.
//
// WARUM NICHT CSS-ONLY:
//   overflow:hidden auf .ag-root-wrapper, .ag-body-viewport, .ag-cell → keine Chance
//   für position:absolute-Kinder zu "escapen". Nur position:fixed an <body> löst das.

let _portal = null;
function getDiagnosticPortal() {
  if (_portal) return _portal;
  _portal = document.createElement('div');
  _portal.id = 'dsl-diagnostic-portal';
  _portal.setAttribute('aria-live', 'polite');
  _portal.setAttribute('role', 'status');
  document.body.appendChild(_portal);
  return _portal;
}

function showDiagnosticPortal(cellEl, diagnostics) {
  const portal = getDiagnosticPortal();
  if (!diagnostics || diagnostics.length === 0) {
    portal.classList.remove('visible');
    portal.innerHTML = '';
    return;
  }
  const rect = cellEl.getBoundingClientRect();
  portal.style.left  = `${rect.left}px`;
  portal.style.top   = `${rect.bottom + 4}px`;
  portal.style.width = `${Math.max(rect.width, 300)}px`;
  portal.innerHTML = diagnostics.map(d =>
    `<div class="dsl-diag-item dsl-diag-${d.severity}">${escDiag(d.message)}</div>`
  ).join('');
  portal.classList.add('visible');
}

function hideDiagnosticPortal() {
  const portal = getDiagnosticPortal();
  portal.classList.remove('visible');
  portal.innerHTML = '';
}

function escDiag(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
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

    // Diagnostic-Portal: Lint-Ergebnisse unterhalb der Zelle schweben lassen.
    // ResizeObserver hält Position synchron wenn die Zelle sich bewegt/skaliert.
    const cellEl = this._wrapper?.closest?.('.ag-cell') ?? this._wrapper;
    if (cellEl) {
      this._diagObserver = new ResizeObserver(() => {
        const { errors, warnings } = this._currentDiagnostics ?? { errors: [], warnings: [] };
        if (errors.length + warnings.length > 0) showDiagnosticPortal(cellEl, [...errors, ...warnings]);
      });
      this._diagObserver.observe(cellEl);
      this._diagCellEl = cellEl;

      // Laufende Synchronisation: Lint-Ergebnisse bei jeder View-Änderung prüfen.
      // Wir pollen den Lint-State via MutationObserver auf .cm-lintRange-error-Elemente.
      this._diagMutation = new MutationObserver(() => {
        const schemas  = AppStore.get('schemas') ?? [];
        const knownLemmas = buildKnownLemmas(schemas);
        const raw      = this._value;
        const diags    = validateDSL(raw, knownLemmas);
        const errors   = diags.filter(d => d.severity === 'error').map(d => ({ severity: 'error',   message: d.message }));
        const warnings = diags.filter(d => d.severity === 'warning').map(d => ({ severity: 'warning', message: d.message }));
        this._currentDiagnostics = { errors, warnings };
        if (errors.length + warnings.length > 0) showDiagnosticPortal(cellEl, [...errors, ...warnings]);
        else hideDiagnosticPortal();
      });
      // Observe the editor wrapper for lint-mark changes
      if (this._wrapper) {
        this._diagMutation.observe(this._wrapper, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
      }
    }
  }

  destroy() {
    hideDiagnosticPortal();
    this._diagObserver?.disconnect();
    this._diagMutation?.disconnect();
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
