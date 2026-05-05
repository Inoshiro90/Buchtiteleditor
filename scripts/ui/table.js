// editor/ui/table.js
import { AppStore } from '../store/AppStore.js';
import { db } from '../db/db.js';
import { detectDuplicates, runCrossClassCheck, countCrossClassDuplicates } from '../services/duplicate-service.js';
import { touchModified, touchAccessed, setRowCount } from '../services/schema-meta-service.js';
import { DSLCellRenderer, DSLCellEditor, setActiveDSLEditor } from './cell-dsl.js';
import { validateDSL, buildKnownLemmas } from '../services/dsl-validator.js';
import {
  GenusCellEditor, GenusCellRenderer, NumerusCellEditor,
  DeclinationRuleCellEditor,
  DeclinationPatternCellEditor, PatternCellRenderer,
} from './cell-declension.js';
import { isRuleValid, isPatternValid } from '../services/declension-rules.js';

let gridApi = null;
let _currentSchema = null;
let _rowIdCounter = 0;

function nextId() {
  return `row_${Date.now()}_${_rowIdCounter++}`;
}

export async function initTable(container) {
  // Listen for schema changes → reload data
  AppStore.on('activeSchema', async (schema) => {
    _currentSchema = schema;
    if (schema) {
      await loadSchemaData(schema);
    }
  });

  AppStore.on('filterText', (text) => {
    gridApi?.setGridOption('quickFilterText', text ?? '');
  });

  // Listen for external row operations
  document.addEventListener('editor:add-row', () => addRow());
  document.addEventListener('editor:delete-rows', () => deleteSelectedRows());
  document.addEventListener('editor:rows-changed', (e) => {
    if (e.detail?.rows) {
      const withDups = detectDuplicates(e.detail.rows, _currentSchema?.type);
      AppStore.set('rows', withDups);
      gridApi?.setGridOption('rowData', withDups);
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

  // Load rows from IndexedDB
  let rows = (await db.get('tables', schema.id)) ?? [];

  // Assign internal IDs if missing
  rows = rows.map((r) => ({ ...r, _id: r._id ?? nextId() }));

  // Within-class duplicate detection
  const withDups = detectDuplicates(rows, schema.type);

  // Cross-class duplicate detection (compares against all sibling tables)
  const allSchemas = AppStore.get('schemas') ?? [];
  const withCross  = await runCrossClassCheck(withDups, schema, db, allSchemas);

  AppStore.set('rows', withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));

  // Track access and row count in metadata
  touchAccessed(schema.id);
  setRowCount(schema.id, withCross.length);

  // Build AG Grid
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
    onCellValueChanged: async (params) => {
      // Cascade: gender change → clear incompatible rule + pattern
      if (params.colDef.field === 'gender' && (_currentSchema?.type === 'nomen' || _currentSchema?.type === 'defektivum')) {
        const genus = params.newValue ?? '';
        const rule  = params.data?.declinationRule ?? '';
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

      // Cascade: rule change → clear incompatible pattern
      if (params.colDef.field === 'declinationRule' && (_currentSchema?.type === 'nomen' || _currentSchema?.type === 'defektivum')) {
        const genus = params.data?.gender ?? '';
        const rule  = params.newValue ?? '';
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
    onCellEditingStarted: (params) => {
      if (params.colDef.cellEditor === DSLCellEditor) {
        // Give the editor a tick to initialise, then register it
        setTimeout(() => {
          const instances = params.api.getCellEditorInstances({ rowIndex: params.rowIndex, column: params.column });
          if (instances.length > 0) setActiveDSLEditor(instances[0]);
        }, 50);
      }
    },
    onCellEditingStopped: () => {
      setActiveDSLEditor(null);
    },
    onSelectionChanged: (params) => {
      const selected = params.api.getSelectedRows();
      AppStore.set('selectedRows', selected);
    },
    onGridReady: (params) => {
      gridApi = params.api;
      const filterText = AppStore.get('filterText');
      if (filterText) params.api.setGridOption('quickFilterText', filterText);

      // TSV paste: intercept Ctrl+V / Cmd+V on the grid container
      const gridEl = params.api.getGridElement?.() ?? container;
      gridEl.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
          // Only intercept if no cell is currently being edited
          const editingCells = params.api.getEditingCells();
          if (editingCells.length === 0) {
            e.preventDefault();
            handleTSVPaste(params.api);
          }
        }
      });
    },
    rowClassRules: {
      'row-duplicate':             (params) => params.data?._isDuplicate === true,
      'row-cross-class-duplicate': (params) => params.data?._isCrossClassDuplicate === true && !params.data?._isDuplicate,
    },
    context: { schema },
  };

  // eslint-disable-next-line no-undef
  agGrid.createGrid(gridDiv, gridOptions);
}

function buildColDefs(schema) {
  // Checkbox column
  const checkboxCol = {
    headerCheckboxSelection: true,
    checkboxSelection: true,
    width: 48,
    minWidth: 48,
    maxWidth: 48,
    pinned: 'left',
    field: '_check',
    headerName: '',
    editable: false,
    resizable: false,
    sortable: false,
    filter: false,
  };

  // Row number
  const rowNumCol = {
    headerName: '#',
    valueGetter: (p) => p.node.rowIndex + 1,
    width: 56,
    minWidth: 56,
    maxWidth: 56,
    pinned: 'left',
    editable: false,
    resizable: false,
    sortable: false,
    filter: false,
    cellClass: 'row-num-cell',
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
    };

    // DSL columns (genre templates)
    if (col.dsl) {
      return { ...base, cellClass: 'cell-dsl', cellRenderer: DSLCellRenderer, cellEditor: DSLCellEditor };
    }

    // Defektivum: numerus selector + shared declension columns
    if (schema.type === 'defektivum') {
      if (col.field === 'gender') {
        return { ...base, cellEditor: GenusCellEditor, cellRenderer: GenusCellRenderer };
      }
      if (col.field === 'numerus') {
        return { ...base, cellEditor: NumerusCellEditor };
      }
      if (col.field === 'declinationRule') {
        return { ...base, cellEditor: DeclinationRuleCellEditor };
      }
      if (col.field === 'declinationPattern') {
        return {
          ...base,
          cellEditor: DeclinationPatternCellEditor,
          cellRenderer: PatternCellRenderer,
          valueFormatter: () => undefined,
        };
      }
    }

    // Nomen: cascading declension columns
    if (schema.type === 'nomen') {
      if (col.field === 'gender') {
        return { ...base, cellEditor: GenusCellEditor, cellRenderer: GenusCellRenderer };
      }
      if (col.field === 'declinationRule') {
        return { ...base, cellEditor: DeclinationRuleCellEditor };
      }
      if (col.field === 'declinationPattern') {
        return {
          ...base,
          cellEditor: DeclinationPatternCellEditor,
          cellRenderer: PatternCellRenderer,
          // Store the pattern code (e.g. "S1"), display the label via renderer
          valueFormatter: () => undefined, // renderer handles display
        };
      }
    }

    return base;
  });

  return [checkboxCol, rowNumCol, ...dataCols];
}

// ── TSV Paste Handler ──────────────────────────────────────────────────────
/**
 * Read clipboard text, parse as TSV (Tab = column, newline = row),
 * and apply starting from the currently focused/selected cell.
 * If no cell is selected, starts at row 0, col 0 (first data column).
 */
async function handleTSVPaste(api) {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (_) {
    // Clipboard API blocked — fall through to browser default
    return;
  }
  if (!text?.trim()) return;

  const schema = _currentSchema;
  if (!schema) return;

  // Parse TSV
  // Normalize line endings (mobile uses \r\n, \r, or \n)
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n').filter(l => l.trim().length > 0);

  // Detect delimiter: tab-separated or comma/semicolon fallback
  const firstLine = lines[0] ?? '';
  const hasTabs   = firstLine.includes('\t');
  const splitLine = hasTabs
    ? l => l.split('\t')
    : l => l.split(/[;,]/);       // CSV fallback

  const pastedRows = lines.map(l => splitLine(l));

  if (!pastedRows.length) return;

  // Determine start cell
  const focusedCell = api.getFocusedCell();
  const dataColIds  = schema.columns.map(c => c.field); // skip checkbox + rowNum cols

  // rowIndex of first target row
  let startRow = focusedCell?.rowIndex ?? 0;
  // colIndex within dataColIds (0-based)
  const focusedField = focusedCell?.column?.getColId?.();
  let startCol = focusedField ? Math.max(0, dataColIds.indexOf(focusedField)) : 0;

  // Collect all current rows
  const allRows = [];
  api.forEachNodeAfterFilterAndSort(node => allRows.push({ ...node.data }));

  // Extend rows array if paste would go beyond current row count
  const totalRowsNeeded = startRow + pastedRows.length;
  while (allRows.length < totalRowsNeeded) {
    const emptyRow = { _id: `paste_${Date.now()}_${allRows.length}`, _isDuplicate: false };
    schema.columns.forEach(col => { emptyRow[col.field] = ''; });
    allRows.push(emptyRow);
  }

  // Apply pasted values
  pastedRows.forEach((cols, ri) => {
    const targetRow = allRows[startRow + ri];
    if (!targetRow) return;
    cols.forEach((val, ci) => {
      const field = dataColIds[startCol + ci];
      if (field) targetRow[field] = val.trim();
    });
  });

  // Run duplicate detection and persist
  const { detectDuplicates, runCrossClassCheck } = await import('../services/duplicate-service.js');
  const withDups  = detectDuplicates(allRows, schema.type);
  const schemas   = AppStore.get('schemas') ?? [];
  const withCross = await runCrossClassCheck(withDups, schema, db, schemas);

  AppStore.set('rows', withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));

  api.setGridOption('rowData', withCross);
  await db.set('tables', schema.id, withCross);
  touchModified(schema.id, withCross.length);

  // Move focus to cell after paste region
  const lastPasteRow = startRow + pastedRows.length - 1;
  api.setFocusedCell(lastPasteRow, dataColIds[startCol] ?? dataColIds[0]);
}


function revalidateErrors(api) {
  const schemas = AppStore.get('schemas') ?? [];
  const knownLemmas = buildKnownLemmas(schemas);
  const allErrors = [];
  api.forEachNode((node) => {
    const row = node.data;
    const title = row.title ?? '';
    const tags  = row.tags ?? '';
    const errs = [
      ...validateDSL(title, knownLemmas),
      ...validateDSL(tags,  knownLemmas),
    ];
    if (errs.length > 0) {
      allErrors.push(...errs.map(e => ({ ...e, rowId: row._id })));
    }
  });
  AppStore.set('errors', allErrors);
}

async function persistChange(params) {
  const schema = _currentSchema;
  if (!schema) return;

  // Get all rows from grid
  const allRows = [];
  params.api.forEachNode((node) => allRows.push(node.data));

  // Re-run duplicate detection
  const withDups = detectDuplicates(allRows, schema.type);

  // Cross-class check after every cell change
  const allSchemas = AppStore.get('schemas') ?? [];
  const withCross  = await runCrossClassCheck(withDups, schema, db, allSchemas);

  AppStore.set('rows', withCross);
  AppStore.set('crossClassDuplicates', withCross.filter(r => r._isCrossClassDuplicate));

  // Update grid rows
  params.api.setGridOption('rowData', withCross);

  // Persist to IndexedDB
  await db.set('tables', schema.id, withCross);
  touchModified(schema.id, withCross.length);
}

async function addRow() {
  const schema = _currentSchema;
  if (!schema || !gridApi) return;

  const emptyRow = { _id: nextId(), _isDuplicate: false };
  schema.columns.forEach((col) => {
    emptyRow[col.field] = '';
  });

  const allRows = [];
  gridApi.forEachNode((node) => allRows.push(node.data));
  allRows.push(emptyRow);

  const withDups = detectDuplicates(allRows, schema.type);
  AppStore.set('rows', withDups);
  gridApi.setGridOption('rowData', withDups);

  await db.set('tables', schema.id, withDups);

  // Scroll to and edit the new row
  setTimeout(() => {
    const lastRow = withDups.length - 1;
    gridApi.ensureIndexVisible(lastRow, 'bottom');
    const firstEditableField = schema.columns[0]?.field;
    if (firstEditableField) {
      gridApi.startEditingCell({ rowIndex: lastRow, colKey: firstEditableField });
    }
  }, 50);
}

async function deleteSelectedRows() {
  const schema = _currentSchema;
  if (!schema || !gridApi) return;

  const selected = gridApi.getSelectedRows();
  if (selected.length === 0) return;

  const selectedIds = new Set(selected.map((r) => r._id));
  const allRows = [];
  gridApi.forEachNode((node) => allRows.push(node.data));
  const remaining = allRows.filter((r) => !selectedIds.has(r._id));

  const withDups = detectDuplicates(remaining, schema.type);
  AppStore.set('rows', withDups);
  gridApi.setGridOption('rowData', withDups);

  await db.set('tables', schema.id, withDups);
}
