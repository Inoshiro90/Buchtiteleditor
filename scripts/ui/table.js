// editor/ui/table.js
//
// Änderung 3: Undo/Redo — pushUndo vor jeder Mutation, Handler für editor:undo / editor:redo
// Problem 6: TSV-Import sofort sichtbar — refreshCells() + applyTransaction statt setGridOption

import { AppStore } from '../store/AppStore.js';
import { db }       from '../db/db.js';
import { detectDuplicates, runCrossClassCheck, countCrossClassDuplicates } from '../services/duplicate-service.js';
import { touchModified, touchAccessed, setRowCount }                       from '../services/schema-meta-service.js';
import { DSLCellRenderer, DSLCellEditor, setActiveDSLEditor }              from './cell-dsl.js';
import { validateDSL, buildKnownLemmas }                                   from '../services/dsl-validator.js';
import {
  GenusCellEditor, GenusCellRenderer, NumerusCellEditor,
  DeclinationRuleCellEditor,
  DeclinationPatternCellEditor, PatternCellRenderer,
} from './cell-declension.js';
import { isRuleValid, isPatternValid } from '../services/declension-rules.js';
import { gridContext }                  from './grid-context.js';

let gridApi         = null;
let _currentSchema  = null;
let _rowIdCounter   = 0;
let _highlightRowId = null;   // Änderung 2: aktiv hervorgehobener Treffer (Find)
let _highlightField = null;
let _matchRowIds    = new Set(); // Änderung 2: alle Treffer-RowIds

function nextId() {
  return `row_${Date.now()}_${_rowIdCounter++}`;
}

export async function initTable(container) {
  AppStore.on('activeSchema', async (schema) => {
    _currentSchema = schema;
    gridContext.getSchema = () => _currentSchema; // Änderung 2: sofort aktualisieren
    _highlightRowId = null;
    _highlightField = null;
    AppStore.clearUndoRedo();
    if (schema) await loadSchemaData(schema);
  });

  AppStore.on('filterText', (text) => {
    gridApi?.setGridOption('quickFilterText', text ?? '');
  });

  // ── Änderung 2: Find & Replace Event Handler ──────────────────────────
  // Änderung 2 + Problem 1 Fix:
  // - setFocusedCell() ENTFERNT → kein Fokus-Transfer ins Grid beim Suchen
  // - Highlight läuft ausschließlich über cellStyle (buildColDefs)
  // - refreshCells() mit force:true damit cellStyle neu ausgewertet wird

  document.addEventListener('editor:find-highlight', (e) => {
    const { activeMatch, allRowIds } = e.detail ?? {};
    const prevActive  = _highlightRowId;
    const prevAllSize = _matchRowIds.size;

    _highlightRowId = activeMatch?.rowId ?? null;
    _highlightField = activeMatch?.field ?? null;
    _matchRowIds    = allRowIds ?? new Set();

    if (!gridApi) return;

    // Nur scrollen — kein setFocusedCell (Problem 1 Fix)
    if (activeMatch) {
      gridApi.ensureIndexVisible(activeMatch.rowIndex, 'middle');
    }

    // Betroffene Rows gezielt refreshen (Performance)
    const affected = new Set([..._matchRowIds]);
    if (_highlightRowId) affected.add(_highlightRowId);
    if (prevActive)      affected.add(prevActive);
    const nodes = [...affected]
      .map(id => gridApi.getRowNode(id))
      .filter(Boolean);
    if (nodes.length > 0) {
      gridApi.refreshCells({ rowNodes: nodes, force: true });
    }
  });

  document.addEventListener('editor:find-clear', () => {
    const prev = new Set([..._matchRowIds]);
    if (_highlightRowId) prev.add(_highlightRowId);
    _highlightRowId = null;
    _highlightField = null;
    _matchRowIds    = new Set();
    if (gridApi) {
      const nodes = [...prev].map(id => gridApi.getRowNode(id)).filter(Boolean);
      if (nodes.length > 0) gridApi.refreshCells({ rowNodes: nodes, force: true });
    }
  });

  document.addEventListener('editor:replace-one', async (e) => {
    const { match, newValue } = e.detail ?? {};
    if (!match || !gridApi || !_currentSchema) return;

    const currentRows = [];
    gridApi.forEachNode(n => currentRows.push({ ...n.data }));
    AppStore.pushUndo(_currentSchema.id, currentRows);

    const updated = currentRows.map(r =>
      r._id === match.rowId ? { ...r, [match.field]: newValue } : r
    );
    await _applyRows(updated);
  });

  document.addEventListener('editor:replace-all', async (e) => {
    const { replacements, count } = e.detail ?? {};
    if (!replacements?.length || !gridApi || !_currentSchema) return;

    const currentRows = [];
    gridApi.forEachNode(n => currentRows.push({ ...n.data }));
    AppStore.pushUndo(_currentSchema.id, currentRows);

    const repMap = new Map(replacements.map(r => [r.rowId + '|' + r.field, r.newValue]));
    const updated = currentRows.map(row => {
      const patched = { ...row };
      for (const field of (_currentSchema.columns.map(c => c.field) ?? [])) {
        const key = row._id + '|' + field;
        if (repMap.has(key)) patched[field] = repMap.get(key);
      }
      return patched;
    });
    await _applyRows(updated);
    // Toast via showToast — import dynamisch vermeiden, nutze CustomEvent
    document.dispatchEvent(new CustomEvent('editor:toast', { detail: { message: `${count} Treffer ersetzt`, type: 'success' } }));
  });

  // Problem 6: editor:rows-changed — setGridOption + sofortiges Refresh
  document.addEventListener('editor:rows-changed', async (e) => {
    if (!e.detail?.rows) return;
    const rows = detectDuplicates(e.detail.rows, _currentSchema?.type);
    AppStore.set('rows', rows);
    if (gridApi) {
      gridApi.setGridOption('rowData', rows);
      // Explizites Refresh aller Zellen garantiert sofortige Sichtbarkeit (Problem 6)
      gridApi.refreshCells({ force: true });
    }
  });

  // Änderung 3: Undo
  document.addEventListener('editor:undo', async () => {
    const schema = _currentSchema;
    if (!schema || !gridApi) return;
    const current = AppStore.get('rows') ?? [];
    const entry   = AppStore.undo(schema.id, current);
    if (!entry) return;
    const restored = detectDuplicates(entry.rows, schema.type);
    AppStore.set('rows', restored);
    gridApi.setGridOption('rowData', restored);
    gridApi.refreshCells({ force: true });
    await db.set('tables', schema.id, restored);
    touchModified(schema.id, restored.length);
  });

  // Änderung 3: Redo
  document.addEventListener('editor:redo', async () => {
    const schema = _currentSchema;
    if (!schema || !gridApi) return;
    const current = AppStore.get('rows') ?? [];
    const entry   = AppStore.redo(schema.id, current);
    if (!entry) return;
    const restored = detectDuplicates(entry.rows, schema.type);
    AppStore.set('rows', restored);
    gridApi.setGridOption('rowData', restored);
    gridApi.refreshCells({ force: true });
    await db.set('tables', schema.id, restored);
    touchModified(schema.id, restored.length);
  });

  document.addEventListener('editor:add-row',     () => addRow());
  document.addEventListener('editor:delete-rows', () => deleteSelectedRows());

  // Tastaturkürzel Undo/Redo
  document.addEventListener('keydown', (e) => {
    const inInput = ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);
    if (inInput) return;
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('editor:undo'));
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
      e.preventDefault();
      document.dispatchEvent(new CustomEvent('editor:redo'));
    }
  });

  renderPlaceholder(container);
}

function renderPlaceholder(container) {
  container.innerHTML = `
    <div class="table-placeholder">
      <div class="table-placeholder-icon" id="tbl-placeholder-icon"></div>
      <div class="table-placeholder-text">Wähle eine Tabelle aus der Seitenleiste</div>
    </div>
  `;
}

async function loadSchemaData(schema) {
  const container = document.getElementById('table-container');
  if (!container) return;

  let rows = (await db.get('tables', schema.id)) ?? [];
  rows = rows.map((r) => ({ ...r, _id: r._id ?? nextId() }));

  const withDups  = detectDuplicates(rows, schema.type);
  const allSchemas = AppStore.get('schemas') ?? [];
  const withCross  = await runCrossClassCheck(withDups, schema, db, allSchemas);

  AppStore.set('rows', withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));

  touchAccessed(schema.id);
  setRowCount(schema.id, withCross.length);

  buildGrid(container, schema, withCross);
}

function buildGrid(container, schema, rows) {
  container.innerHTML = '';

  const gridDiv = document.createElement('div');
  gridDiv.className = 'ag-theme-quartz';
  gridDiv.style.cssText = 'width:100%;height:100%;';
  container.appendChild(gridDiv);

  const colDefs = buildColDefs(schema);

  const gridOptions = {
    rowData: rows,
    columnDefs: colDefs,
    defaultColDef: {
      editable: true,
      resizable: true,
      sortable: true,
      filter: true,
      suppressMovable: true,
      cellStyle: (params) => {
        if (params.data?._isDuplicate) {
          return { backgroundColor: 'rgba(255, 165, 0, 0.12)', borderLeft: '3px solid #f59e0b' };
        }
        return null;
      },
    },
    rowSelection: 'multiple',
    suppressRowClickSelection: true,
    animateRows: true,
    getRowId: (params) => params.data._id,

    onCellEditingStarted: (params) => {
      // Änderung 3: Snapshot vor Bearbeitung
      const currentRows = [];
      params.api.forEachNode(n => currentRows.push({ ...n.data }));
      AppStore.pushUndo(_currentSchema?.id, currentRows);

      if (params.colDef.cellEditor === DSLCellEditor) {
        setTimeout(() => {
          const instances = params.api.getCellEditorInstances({
            rowIndex: params.rowIndex,
            column:   params.column,
          });
          if (instances.length > 0) setActiveDSLEditor(instances[0]);
        }, 50);
      }
    },

    onCellEditingStopped: () => {
      setActiveDSLEditor(null);
    },

    onCellValueChanged: async (params) => {
      // Cascading: gender → rule / pattern
      if (params.colDef.field === 'gender' &&
          (_currentSchema?.type === 'nomen' || _currentSchema?.type === 'defektivum')) {
        const genus = params.newValue ?? '';
        const rule  = params.data?.declinationRule    ?? '';
        const pat   = params.data?.declinationPattern ?? '';
        let changed = false;
        const update = { ...params.data };
        if (rule && !isRuleValid(genus, rule)) {
          update.declinationRule    = '';
          update.declinationPattern = '';
          changed = true;
        } else if (pat && !isPatternValid(genus, rule, pat)) {
          update.declinationPattern = '';
          changed = true;
        }
        if (changed) {
          params.api.applyTransaction({ update: [update] });
          params.node.setData(update);
        }
      }

      if (params.colDef.field === 'declinationRule' &&
          (_currentSchema?.type === 'nomen' || _currentSchema?.type === 'defektivum')) {
        const genus = params.data?.gender ?? '';
        const rule  = params.newValue    ?? '';
        const pat   = params.data?.declinationPattern ?? '';
        if (pat && !isPatternValid(genus, rule, pat)) {
          const update = { ...params.data, declinationPattern: '' };
          params.api.applyTransaction({ update: [update] });
          params.node.setData(update);
        }
      }

      await persistChange(params);
      if (_currentSchema?.type === 'genre') {
        revalidateErrors(params.api);
      }
    },

    onSelectionChanged: (params) => {
      AppStore.set('selectedRows', params.api.getSelectedRows());
    },

    onGridReady: (params) => {
      gridApi = params.api;
      // Änderung 2: gridContext aktualisieren
      gridContext.getApi    = () => gridApi;
      gridContext.getSchema = () => _currentSchema;
      const filterText = AppStore.get('filterText');
      if (filterText) params.api.setGridOption('quickFilterText', filterText);

      // TSV-Paste per Ctrl+V
      const gridEl = params.api.getGridElement?.() ?? container;
      gridEl.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
          const editingCells = params.api.getEditingCells();
          if (editingCells.length === 0) {
            e.preventDefault();
            handleTSVPaste(params.api);
          }
        }
      });
    },

    rowClassRules: {
      'row-duplicate':             (p) => p.data?._isDuplicate === true,
      'row-cross-class-duplicate': (p) => p.data?._isCrossClassDuplicate === true && !p.data?._isDuplicate,
      // Änderung 2: Highlight läuft über cellStyle — keine Row-Classes mehr nötig
    },

    context: { schema },
  };

  // eslint-disable-next-line no-undef
  agGrid.createGrid(gridDiv, gridOptions);
}

function buildColDefs(schema) {
  const checkboxCol = {
    headerCheckboxSelection: true,
    checkboxSelection: true,
    width: 48, minWidth: 48, maxWidth: 48,
    pinned: 'left',
    field: '_check',
    headerName: '',
    editable: false, resizable: false, sortable: false, filter: false,
  };

  const rowNumCol = {
    headerName: '#',
    valueGetter: (p) => p.node.rowIndex + 1,
    width: 56, minWidth: 56, maxWidth: 56,
    pinned: 'left',
    editable: false, resizable: false, sortable: false, filter: false,
    cellClass: 'row-num-cell',
  };

  // Änderung 2: cellStyle-Funktion liest _highlightRowId/_matchRowIds aus dem
  // Modulscope — kein setFocusedCell nötig, kein Fokus-Transfer ins Grid.
  // Ä4: Highlight nur für die tatsächlich treffende Zelle (field-spezifisch)
  const findCellStyle = (params) => {
    const rowId = params.data?._id;
    const field = params.colDef?.field;
    if (!rowId || !field) return null;

    // Aktiver Treffer — nur wenn rowId UND field übereinstimmen
    if (rowId === _highlightRowId && field === _highlightField) {
      return {
        backgroundColor: 'rgba(245, 158, 11, 0.30)',
        outline: '2px solid rgba(245, 158, 11, 0.85)',
        outlineOffset: '-2px',
        borderRadius: '2px',
      };
    }
    // Weitere Treffer — alle Felder der Zeile prüfen über _matchRowIds
    // Wir können nicht pro-Zelle tracken ohne Match-Struktur umzubauen — dezente Zeilenfärbung
    if (_matchRowIds.has(rowId)) {
      return {
        backgroundColor: 'rgba(34, 197, 94, 0.10)',
      };
    }
    return null;
  };

  const dataCols = schema.columns.map((col) => {
    const base = {
      field: col.field,
      headerName: col.headerName,
      flex: col.flex ?? 1,
      minWidth: 100,
      editable: true,
      cellEditorPopup: false,
      tooltipValueGetter: (p) => p.value,
      cellStyle: findCellStyle,   // Änderung 2: Find-Highlight per Zelle
    };

    if (col.dsl) {
      return { ...base, cellClass: 'cell-dsl', cellRenderer: DSLCellRenderer, cellEditor: DSLCellEditor };
    }

    if (schema.type === 'defektivum') {
      if (col.field === 'gender')            return { ...base, cellEditor: GenusCellEditor, cellRenderer: GenusCellRenderer };
      if (col.field === 'numerus')           return { ...base, cellEditor: NumerusCellEditor };
      if (col.field === 'declinationRule')   return { ...base, cellEditor: DeclinationRuleCellEditor };
      if (col.field === 'declinationPattern') return { ...base, cellEditor: DeclinationPatternCellEditor, cellRenderer: PatternCellRenderer, valueFormatter: () => undefined };
    }

    if (schema.type === 'nomen') {
      if (col.field === 'gender')            return { ...base, cellEditor: GenusCellEditor, cellRenderer: GenusCellRenderer };
      if (col.field === 'declinationRule')   return { ...base, cellEditor: DeclinationRuleCellEditor };
      if (col.field === 'declinationPattern') return { ...base, cellEditor: DeclinationPatternCellEditor, cellRenderer: PatternCellRenderer, valueFormatter: () => undefined };
    }

    return base;
  });

  return [checkboxCol, rowNumCol, ...dataCols];
}

// ── TSV Paste (Problem 6 Fix eingebaut) ───────────────────────────────────
async function handleTSVPaste(api) {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (_) { return; }
  if (!text?.trim()) return;

  const schema = _currentSchema;
  if (!schema) return;

  // Änderung 3: Snapshot vor Paste
  const beforePaste = [];
  api.forEachNode(n => beforePaste.push({ ...n.data }));
  AppStore.pushUndo(schema.id, beforePaste);

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines      = normalized.split('\n').filter(l => l.trim().length > 0);
  const firstLine  = lines[0] ?? '';
  const hasTabs    = firstLine.includes('\t');
  const splitLine  = hasTabs ? l => l.split('\t') : l => l.split(/[;,]/);

  const pastedRows = lines.map(l => splitLine(l));
  if (!pastedRows.length) return;

  const focusedCell = api.getFocusedCell();
  const dataColIds  = schema.columns.map(c => c.field);
  let startRow      = focusedCell?.rowIndex ?? 0;
  const focusedField = focusedCell?.column?.getColId?.();
  let startCol = focusedField ? Math.max(0, dataColIds.indexOf(focusedField)) : 0;

  const allRows = [];
  api.forEachNodeAfterFilterAndSort(node => allRows.push({ ...node.data }));

  const totalRowsNeeded = startRow + pastedRows.length;
  while (allRows.length < totalRowsNeeded) {
    const emptyRow = { _id: `paste_${Date.now()}_${allRows.length}`, _isDuplicate: false };
    schema.columns.forEach(col => { emptyRow[col.field] = ''; });
    allRows.push(emptyRow);
  }

  pastedRows.forEach((cols, ri) => {
    const targetRow = allRows[startRow + ri];
    if (!targetRow) return;
    cols.forEach((val, ci) => {
      const field = dataColIds[startCol + ci];
      if (field) targetRow[field] = val.trim();
    });
  });

  const withDups   = detectDuplicates(allRows, schema.type);
  const allSchemas = AppStore.get('schemas') ?? [];
  const withCross  = await runCrossClassCheck(withDups, schema, db, allSchemas);

  // Problem 6: explizites sofortiges Update ohne Tab-Wechsel
  AppStore.set('rows',               withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));

  // setGridOption + refreshCells stellt sofortige Sichtbarkeit sicher
  api.setGridOption('rowData', withCross);
  api.refreshCells({ force: true });

  await db.set('tables', schema.id, withCross);
  touchModified(schema.id, withCross.length);

  const lastPasteRow = startRow + pastedRows.length - 1;
  api.setFocusedCell(lastPasteRow, dataColIds[startCol] ?? dataColIds[0]);
}

// ── Änderung 1: virtualClasses in Fehlerprüfung ────────────────────────────
function revalidateErrors(api) {
  const schemas  = AppStore.get('schemas') ?? [];
  const vcN      = (AppStore.get('virtualClassesNomen')     ?? '').split('\n').map(s=>s.trim()).filter(Boolean);
  const vcD      = (AppStore.get('virtualClassesDefektiva') ?? '').split('\n').map(s=>s.trim()).filter(Boolean);
  const vcA      = (AppStore.get('virtualClassesAdjektive') ?? '').split('\n').map(s=>s.trim()).filter(Boolean);
  const knownLemmas = buildKnownLemmas(schemas, vcN, vcD, vcA);
  const allErrors    = [];

  api.forEachNode((node) => {
    const row   = node.data;
    const title = row.title ?? '';
    const tags  = row.tags  ?? '';
    const errs  = [
      ...validateDSL(title, knownLemmas),
      ...validateDSL(tags,  knownLemmas),
    ];
    if (errs.length > 0) {
      allErrors.push(...errs.map(e => ({ ...e, rowId: row._id })));
    }
  });
  AppStore.set('errors', allErrors);
}

// ── Änderung 2: _applyRows — zentraler Helfer für Replace + Undo ─────────────
async function _applyRows(rows) {
  const schema = _currentSchema;
  if (!schema || !gridApi) return;

  const withDups   = detectDuplicates(rows, schema.type);
  const allSchemas = AppStore.get('schemas') ?? [];
  const withCross  = await runCrossClassCheck(withDups, schema, db, allSchemas);

  AppStore.set('rows', withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));
  gridApi.setGridOption('rowData', withCross);
  gridApi.refreshCells({ force: true });

  await db.set('tables', schema.id, withCross);
  touchModified(schema.id, withCross.length);
}

// ── Persist + Undo ─────────────────────────────────────────────────────────
async function persistChange(params) {
  const schema = _currentSchema;
  if (!schema) return;

  const allRows = [];
  params.api.forEachNode((node) => allRows.push(node.data));

  const withDups   = detectDuplicates(allRows, schema.type);
  const allSchemas = AppStore.get('schemas') ?? [];
  const withCross  = await runCrossClassCheck(withDups, schema, db, allSchemas);

  AppStore.set('rows',               withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));

  // Problem 6: refreshCells explizit
  params.api.setGridOption('rowData', withCross);
  params.api.refreshCells({ force: true });

  await db.set('tables', schema.id, withCross);
  touchModified(schema.id, withCross.length);
}

// ── Add Row ────────────────────────────────────────────────────────────────
async function addRow() {
  const schema = _currentSchema;
  if (!schema || !gridApi) return;

  // Änderung 3: Snapshot vor addRow
  const current = [];
  gridApi.forEachNode(n => current.push({ ...n.data }));
  AppStore.pushUndo(schema.id, current);

  const emptyRow = { _id: nextId(), _isDuplicate: false };
  schema.columns.forEach((col) => { emptyRow[col.field] = ''; });

  const allRows = [...current, emptyRow];
  const withDups = detectDuplicates(allRows, schema.type);
  AppStore.set('rows', withDups);
  gridApi.setGridOption('rowData', withDups);
  gridApi.refreshCells({ force: true });

  await db.set('tables', schema.id, withDups);

  setTimeout(() => {
    const lastRow = withDups.length - 1;
    gridApi.ensureIndexVisible(lastRow, 'bottom');
    const firstEditableField = schema.columns[0]?.field;
    if (firstEditableField) {
      gridApi.startEditingCell({ rowIndex: lastRow, colKey: firstEditableField });
    }
  }, 50);
}

// ── Delete Rows ────────────────────────────────────────────────────────────
async function deleteSelectedRows() {
  const schema = _currentSchema;
  if (!schema || !gridApi) return;

  const selected = gridApi.getSelectedRows();
  if (selected.length === 0) return;

  // Änderung 3: Snapshot vor Delete
  const current = [];
  gridApi.forEachNode(n => current.push({ ...n.data }));
  AppStore.pushUndo(schema.id, current);

  const selectedIds = new Set(selected.map((r) => r._id));
  const remaining   = current.filter((r) => !selectedIds.has(r._id));

  const withDups = detectDuplicates(remaining, schema.type);
  AppStore.set('rows', withDups);
  gridApi.setGridOption('rowData', withDups);
  gridApi.refreshCells({ force: true });

  await db.set('tables', schema.id, withDups);
}
