// editor/store/AppStore.js
// Erweitert um:
//   – virtualClasses   (Änderung 1)
//   – undoStack / redoStack  (Änderung 3)

const UNDO_LIMIT = 50;

const _state = {
  activeSchema:           null,
  rows:                   [],
  errors:                 [],
  duplicates:             [],
  schemas:                [],
  loading:                false,
  loadingMessage:         '',
  loadingProgress:        0,
  filterText:             '',
  selectedRows:           [],
  virtualClassesNomen:     '',   // Ä1 — virtuelle Nomen-Klassen (zeilenweise)
  virtualClassesDefektiva: '',   // Ä1 — virtuelle Defektiva-Klassen (zeilenweise)
  virtualClassesAdjektive: '',   // Ä1 — virtuelle Adjektiv-Klassen (zeilenweise)
  undoStack:              [],   // Änderung 3 — [{schemaId, rows}]
  redoStack:              [],   // Änderung 3
};

const _bus = new EventTarget();

function _emit(key, value) {
  _bus.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
}

export const AppStore = {
  get: (key) => _state[key],

  set(key, value) {
    _state[key] = value;
    _emit(key, value);
  },

  on(key, fn) {
    _bus.addEventListener('change', (e) => {
      if (e.detail.key === key) fn(e.detail.value);
    });
  },

  getState: () => ({ ..._state }),

  // ── Undo / Redo (Änderung 3) ───────────────────────────────────────────
  /**
   * Aktuellen Zustand (rows) für schemaId auf den Undo-Stack legen.
   * Wird vor jeder mutativen Operation aufgerufen.
   */
  pushUndo(schemaId, rows) {
    const snapshot = JSON.parse(JSON.stringify(rows)); // Deep Copy
    const stack    = _state.undoStack.slice(-(UNDO_LIMIT - 1));
    _state.undoStack = [...stack, { schemaId, rows: snapshot }];
    _state.redoStack = [];   // Neue Änderung löscht Redo-History
    _emit('undoStack', _state.undoStack);
    _emit('redoStack', _state.redoStack);
  },

  /**
   * Letzten Zustand wiederherstellen.
   * Gibt das wiederhergestellte {schemaId, rows} zurück oder null.
   */
  undo(currentSchemaId, currentRows) {
    if (_state.undoStack.length === 0) return null;

    const entry      = _state.undoStack[_state.undoStack.length - 1];
    _state.undoStack = _state.undoStack.slice(0, -1);

    // Aktuellen Zustand auf Redo-Stack
    const snapshot   = JSON.parse(JSON.stringify(currentRows));
    _state.redoStack = [..._state.redoStack, { schemaId: currentSchemaId, rows: snapshot }];

    _emit('undoStack', _state.undoStack);
    _emit('redoStack', _state.redoStack);
    return entry;
  },

  /**
   * Zuletzt rückgängig gemachten Zustand wiederherstellen.
   */
  redo(currentSchemaId, currentRows) {
    if (_state.redoStack.length === 0) return null;

    const entry      = _state.redoStack[_state.redoStack.length - 1];
    _state.redoStack = _state.redoStack.slice(0, -1);

    const snapshot   = JSON.parse(JSON.stringify(currentRows));
    _state.undoStack = [..._state.undoStack, { schemaId: currentSchemaId, rows: snapshot }];

    _emit('undoStack', _state.undoStack);
    _emit('redoStack', _state.redoStack);
    return entry;
  },

  /** Stack beim Schema-Wechsel leeren */
  clearUndoRedo() {
    _state.undoStack = [];
    _state.redoStack = [];
    _emit('undoStack', _state.undoStack);
    _emit('redoStack', _state.redoStack);
  },
};
