// editor/ui/modals/import-dialog.js
import { openModal, showToast } from './modal-base.js';
import { parseFile, mergeRows, applyColumnMapping } from '../../services/import-service.js';
import { parseCsv } from '../../services/csv-service.js';
import { detectDuplicates } from '../../services/duplicate-service.js';
import { AppStore } from '../../store/AppStore.js';
import { db } from '../../db/db.js';

function sel(id) { return document.getElementById(id); }

// ── Paste-format parsers ───────────────────────────────────────────────────

/** Detect and parse pasted text: Markdown table, TSV, or CSV */
function parsePastedText(text) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('Kein Text eingegeben');

  // Markdown table: lines start with |
  if (trimmed.startsWith('|')) return parseMarkdownTable(trimmed);

  // TSV: header line contains tabs
  const firstLine = trimmed.split('\n')[0];
  if (firstLine.includes('\t')) return parseTSV(trimmed);

  // CSV fallback (semicolon or comma)
  return parseCsv(trimmed);
}

function parseMarkdownTable(text) {
  const lines = text.split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('|'));

  if (lines.length < 2) throw new Error('Ungültige Markdown-Tabelle (mind. Header + Trennzeile)');

  // Parse a row: | a | b | c | → ['a', 'b', 'c']
  const parseRow = line =>
    line.split('|').slice(1, -1).map(c => c.trim());

  const fields = parseRow(lines[0]);
  // skip separator line (contains ---)
  const dataLines = lines.slice(2).filter(l => !/^[|\s-]+$/.test(l));

  const rows = dataLines.map(line => {
    const vals = parseRow(line);
    const row = {};
    fields.forEach((f, i) => { row[f] = vals[i] ?? ''; });
    return row;
  });

  return { fields, rows };
}

function parseTSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) throw new Error('Kein Inhalt');
  const fields = lines[0].split('\t').map(f => f.trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split('\t');
    const row = {};
    fields.forEach((f, i) => { row[f] = (vals[i] ?? '').trim(); });
    return row;
  });
  return { fields, rows };
}

// ── Main dialog ────────────────────────────────────────────────────────────

export function openImportDialog() {
  const schema = AppStore.get('activeSchema');
  if (!schema) { showToast('Keine Tabelle ausgewählt', 'warn'); return; }

  const schemaFields = schema.columns.map(c => c.field);
  const mergeKey = schema.type === 'genre' ? 'title'
    : schema.type === 'adjektiv' ? 'positive' : 'singular';

  let parsedResult = null; // { fields, rows }

  const bodyHTML = `
    <!-- ── Tab bar ── -->
    <div style="display:flex;gap:0;border-bottom:var(--border-whisper);margin-bottom:16px">
      <button class="import-tab active" id="tab-file"  data-tab="file"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M12 12v6"/><path d="m15 15-3-3-3 3"/></svg> Datei</button>
      <button class="import-tab"        id="tab-paste" data-tab="paste"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg> Einfügen</button>
    </div>

    <!-- ── File tab ── -->
    <div id="import-tab-file">
      <div id="import-drop-zone" class="import-drop-zone">
        <div class="import-drop-icon"><svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg></div>
        <div class="import-drop-label">CSV, XLSX, XLS oder ODS hierher ziehen</div>
        <div class="import-drop-sub">oder</div>
        <label class="btn btn-secondary import-file-btn">
          Datei wählen
          <input type="file" id="import-file-input" accept=".csv,.xlsx,.xls,.ods" style="display:none" />
        </label>
      </div>
    </div>

    <!-- ── Paste tab ── -->
    <div id="import-tab-paste" style="display:none">
      <div class="form-group">
        <label class="form-label">Inhalt einfügen (CSV, TSV, Markdown-Tabelle)</label>
        <textarea
          id="import-paste-area"
          class="form-input"
          style="height:140px;resize:vertical;font-family:var(--font-mono);font-size:12px;padding:8px;white-space:pre"
          placeholder="Füge hier Tabellendaten ein …&#10;&#10;Beispiel CSV:&#10;singular;plural;gender&#10;Haus;Häuser;neu&#10;&#10;Beispiel Markdown:&#10;| singular | plural |&#10;|----------|--------|&#10;| Haus     | Häuser |"
        ></textarea>
      </div>
      <button class="btn btn-secondary" id="btn-parse-paste" style="margin-bottom:4px">
        Einfügen &amp; Analysieren
      </button>
      <div id="paste-error" style="color:var(--color-danger);font-size:12px;margin-top:4px;display:none"></div>
    </div>

    <!-- ── Mapping + preview (shared) ── -->
    <div id="import-mapping-section" style="display:none;margin-top:16px">
      <div style="margin-bottom:12px">
        <label class="form-label">Import-Modus</label>
        <select class="form-select" id="import-mode" style="max-width:280px">
          <option value="replace">Ersetzen (alle vorhandenen Zeilen löschen)</option>
          <option value="append">Hinzufügen (ans Ende anhängen)</option>
          <option value="merge">Merge (nach „${mergeKey}" zusammenführen)</option>
        </select>
      </div>
      <div id="import-mapping-table"></div>
      <div id="import-preview-wrap" style="margin-top:16px"></div>
    </div>
  `;

  openModal({
    id: 'modal-import',
    title: 'Daten importieren — ' + schema.label,
    bodyHTML,
    width: '640px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Importieren', cls: 'btn-primary', action: (closeFn) => doImport(closeFn) },
    ],
    onOpen: () => {
      bindTabs();
      bindDropZone();
      bindPasteTab();
    },
  });

  // ── Tabs ──────────────────────────────────────────────────────────────
  function bindTabs() {
    document.querySelectorAll('.import-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const name = tab.dataset.tab;
        sel('import-tab-file').style.display  = name === 'file'  ? '' : 'none';
        sel('import-tab-paste').style.display = name === 'paste' ? '' : 'none';
      });
    });
  }

  // ── File tab ──────────────────────────────────────────────────────────
  function bindDropZone() {
    const zone  = sel('import-drop-zone');
    const input = sel('import-file-input');
    if (!zone || !input) return;

    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault(); zone.classList.remove('drag-over');
      if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
    });
    input.addEventListener('change', () => { if (input.files[0]) loadFile(input.files[0]); });
  }

  async function loadFile(file) {
    try {
      parsedResult = await parseFile(file);
      showMappingSection(parsedResult);
    } catch (err) {
      showToast('Fehler beim Lesen: ' + err.message, 'error');
    }
  }

  // ── Paste tab ─────────────────────────────────────────────────────────
  function bindPasteTab() {
    sel('btn-parse-paste')?.addEventListener('click', () => {
      const text = sel('import-paste-area')?.value ?? '';
      const errEl = sel('paste-error');
      try {
        parsedResult = parsePastedText(text);
        if (errEl) errEl.style.display = 'none';
        showMappingSection(parsedResult);
      } catch (err) {
        if (errEl) { errEl.textContent = '⚠ ' + err.message; errEl.style.display = ''; }
      }
    });
  }

  // ── Shared: mapping + preview ─────────────────────────────────────────
  function showMappingSection({ fields, rows }) {
    const section = sel('import-mapping-section');
    section.style.display = 'block';

    const mappingTable = sel('import-mapping-table');
    mappingTable.innerHTML = `
      <div class="form-label" style="margin-bottom:8px">Spalten-Mapping (Import → Schema)</div>
      <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:6px;align-items:center">
        ${fields.map(f => `
          <span style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)">${f}</span>
          <span style="color:var(--text-muted)">→</span>
          <select class="form-select" id="map-${encodeField(f)}" style="font-size:12px">
            <option value="">— überspringen —</option>
            ${schemaFields.map(sf =>
              `<option value="${sf}" ${sf === f ? 'selected' : ''}>${sf}</option>`
            ).join('')}
          </select>
        `).join('')}
      </div>
    `;

    showPreview(fields, rows);
  }

  function encodeField(f) { return f.replace(/[^a-zA-Z0-9]/g, '_'); }

  function getMapping(fields) {
    const mapping = {};
    fields.forEach(f => {
      const el = sel(`map-${encodeField(f)}`);
      if (el) mapping[f] = el.value;
    });
    return mapping;
  }

  function showPreview(fields, rows) {
    const preview = sel('import-preview-wrap');
    const previewRows = rows.slice(0, 10);
    const styles = {
      th: 'padding:5px 8px;background:var(--bg-warm);color:var(--text-secondary);text-align:left;border-bottom:var(--border-whisper);white-space:nowrap;font-size:11px',
      td: 'padding:4px 8px;border-bottom:var(--border-whisper);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;font-size:11px',
    };
    preview.innerHTML = `
      <div class="form-label" style="margin-bottom:6px">Vorschau (erste ${previewRows.length} Zeilen)</div>
      <div style="overflow-x:auto;max-height:180px;overflow-y:auto;border:var(--border-whisper);border-radius:var(--radius-micro)">
        <table style="width:100%;border-collapse:collapse;font-family:var(--font-mono)">
          <thead><tr>${fields.map(f => `<th style="${styles.th}">${f}</th>`).join('')}</tr></thead>
          <tbody>${previewRows.map(row =>
            `<tr>${fields.map(f => `<td style="${styles.td}">${row[f] ?? ''}</td>`).join('')}</tr>`
          ).join('')}</tbody>
        </table>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">${rows.length} Zeilen gesamt</div>
    `;
  }

  // ── Execute import ────────────────────────────────────────────────────
  async function doImport(closeFn) {
    if (!parsedResult) { showToast('Keine Daten zum Importieren', 'warn'); return; }

    const { fields, rows: importedRaw } = parsedResult;
    const mapping = getMapping(fields);
    const mode = sel('import-mode')?.value ?? 'append';

    // Änderung 3: Snapshot vor Import auf Undo-Stack
    const existingRows = AppStore.get('rows') ?? [];
    AppStore.pushUndo(schema.id, existingRows);

    const imported = applyColumnMapping(importedRaw, mapping).map((r, i) => ({
      ...r, _id: `import_${Date.now()}_${i}`,
    }));

    const existing = AppStore.get('rows') ?? [];
    const merged   = mergeRows(existing, imported, mode, mergeKey);
    const withDups = detectDuplicates(merged, schema.type);
    const dupCount = withDups.filter(r => r._isDuplicate).length;

    // Problem 6: State korrekt setzen, dann Event dispatchen → table.js
    // führt setGridOption + refreshCells durch
    AppStore.set('rows', withDups);
    await db.set('tables', schema.id, withDups);
    document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: withDups } }));
    closeFn();
    showToast(
      `${imported.length} importiert · ${dupCount} Duplikate erkannt`,
      dupCount > 0 ? 'warn' : 'success'
    );
  }
}

document.addEventListener('editor:open-import', () => openImportDialog());
