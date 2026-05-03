// scripts/ui/modals/batch-modal.js
// Batch-Export (ZIP) und Batch-Import (mehrere Dateien)

import { openModal, showToast } from './modal-base.js';
import { exportAllAsZip, batchImportFiles } from '../../services/batch-service.js';
import { AppStore } from '../../store/AppStore.js';

// ── Icons ──────────────────────────────────────────────────────────────────
const IC = {
  zip:    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  upload: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  check:  `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`,
  warn:   `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>`,
};

export function openBatchModal() {
  const schemas    = AppStore.get('schemas') ?? [];
  const nomenCount = schemas.filter(s => s.type === 'nomen').length;
  const adjCount   = schemas.filter(s => s.type === 'adjektiv').length;
  const genreCount = schemas.filter(s => s.type === 'genre').length;

  const bodyHTML = `
    <!-- ── Batch-Export ── -->
    <div class="db-section">
      <div class="db-section-header">
        ${IC.zip}
        <div>
          <div class="db-section-title">Batch-Export als ZIP</div>
          <div class="db-section-sub">
            Exportiert alle Klassen als einzelne CSV-Dateien in einem ZIP-Archiv.<br>
            Ordnerstruktur: <code style="font-family:var(--font-mono)">genre/ · nomen/ · adjektive/</code><br>
            Aktuell: ${genreCount} Genre-Tabellen · ${nomenCount} Nomen-Klassen · ${adjCount} Adjektiv-Klassen
          </div>
        </div>
      </div>
      <button class="btn btn-secondary db-action-btn" id="batch-btn-export">
        ${IC.zip} ZIP herunterladen
      </button>
    </div>

    <div class="db-divider"></div>

    <!-- ── Batch-Import ── -->
    <div class="db-section">
      <div class="db-section-header">
        ${IC.upload}
        <div>
          <div class="db-section-title">Batch-Import</div>
          <div class="db-section-sub">
            Mehrere Dateien gleichzeitig importieren (CSV, TSV, XLSX, XLS, ODS).<br>
            Typ wird automatisch erkannt (Nomen / Adjektiv / Genre).<br>
            Nicht erkannte Dateien werden übersprungen und gemeldet.
          </div>
        </div>
      </div>

      <div style="margin-bottom:12px">
        <label class="form-label">Import-Modus</label>
        <select class="form-select" id="batch-mode" style="max-width:280px">
          <option value="append">Hinzufügen (bestehende Einträge behalten)</option>
          <option value="replace">Ersetzen (alle bisherigen Einträge löschen)</option>
          <option value="merge">Merge (nach Schlüsselfeld zusammenführen)</option>
        </select>
      </div>

      <!-- Drop-Zone -->
      <div id="batch-drop-zone" class="import-drop-zone" style="padding:24px">
        <div class="import-drop-icon" style="font-size:28px">${IC.zip}</div>
        <div class="import-drop-label">CSV / XLSX / ODS Dateien hierher ziehen</div>
        <div class="import-drop-sub">Mehrere Dateien gleichzeitig möglich</div>
        <label class="btn btn-secondary import-file-btn" style="margin-top:4px">
          Dateien wählen
          <input type="file" id="batch-import-files"
            accept=".csv,.xlsx,.xls,.ods,.tsv"
            multiple
            style="display:none" />
        </label>
      </div>

      <!-- Dateiliste -->
      <div id="batch-file-list" style="margin-top:10px;display:none">
        <div class="form-label" style="margin-bottom:6px">Ausgewählte Dateien</div>
        <div id="batch-file-items" style="
          max-height:140px;overflow-y:auto;
          border:var(--border-whisper);border-radius:var(--radius-micro);
          font-size:12px;font-family:var(--font-mono);
          background:var(--bg-warm);padding:8px 10px;
        "></div>
        <button class="btn btn-primary" id="batch-btn-import" style="margin-top:10px">
          ${IC.upload} Jetzt importieren
        </button>
      </div>

      <!-- Ergebnisse -->
      <div id="batch-results" style="display:none;margin-top:12px"></div>
    </div>
  `;

  openModal({
    id:      'modal-batch',
    title:   'Batch-Export / Batch-Import',
    bodyHTML,
    width:   '580px',
    buttons: [{ label: 'Schließen', cls: 'btn-secondary', action: 'close' }],
    onOpen:  (_dialog, body) => bindEvents(body),
  });
}

// ── Event-Bindung ──────────────────────────────────────────────────────────
function bindEvents(body) {
  // ── Export ──────────────────────────────────────────────────────────────
  body.querySelector('#batch-btn-export')?.addEventListener('click', async () => {
    const btn = body.querySelector('#batch-btn-export');
    if (btn) { btn.disabled = true; btn.textContent = 'Wird erstellt …'; }
    try {
      await exportAllAsZip();
      showToast('ZIP-Export erfolgreich', 'success');
    } catch (e) {
      showToast('Export fehlgeschlagen: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = `${IC.zip} ZIP herunterladen`; }
    }
  });

  // ── Dateiauswahl ─────────────────────────────────────────────────────────
  let selectedFiles = [];

  function showFileList(files) {
    selectedFiles = Array.from(files);
    const listDiv  = body.querySelector('#batch-file-list');
    const itemsDiv = body.querySelector('#batch-file-items');
    if (!listDiv || !itemsDiv) return;

    listDiv.style.display = selectedFiles.length ? '' : 'none';
    itemsDiv.innerHTML = selectedFiles.map(f =>
      `<div style="padding:2px 0;display:flex;align-items:center;gap:6px">
        <span style="color:var(--text-muted)">·</span>
        <span>${escHtml(f.name)}</span>
        <span style="color:var(--text-muted);margin-left:auto">${formatSize(f.size)}</span>
      </div>`
    ).join('');

    // Clear previous results
    const res = body.querySelector('#batch-results');
    if (res) res.style.display = 'none';
  }

  body.querySelector('#batch-import-files')?.addEventListener('change', (e) => {
    showFileList(e.target.files ?? []);
  });

  // Drag & Drop
  const zone = body.querySelector('#batch-drop-zone');
  zone?.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone?.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    showFileList(e.dataTransfer.files);
  });

  // ── Import ausführen ─────────────────────────────────────────────────────
  body.querySelector('#batch-btn-import')?.addEventListener('click', async () => {
    if (!selectedFiles.length) return;

    const btn  = body.querySelector('#batch-btn-import');
    const mode = body.querySelector('#batch-mode')?.value ?? 'append';
    if (btn) { btn.disabled = true; btn.textContent = 'Wird importiert …'; }

    try {
      const { imported, errors } = await batchImportFiles(selectedFiles, mode);
      renderResults(body, imported, errors);
      showToast(
        `${imported.length} Dateien importiert${errors.length ? ` · ${errors.length} Fehler` : ''}`,
        errors.length ? 'warn' : 'success'
      );
    } catch (e) {
      showToast('Import fehlgeschlagen: ' + e.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = `${IC.upload} Jetzt importieren`; }
    }
  });
}

// ── Ergebnisdarstellung ────────────────────────────────────────────────────
function renderResults(body, imported, errors) {
  const res = body.querySelector('#batch-results');
  if (!res) return;

  const successHTML = imported.length ? `
    <div class="batch-result-section">
      <div class="batch-result-header batch-result-ok">
        ${IC.check} ${imported.length} Datei(en) erfolgreich importiert
      </div>
      <div class="batch-result-list">
        ${imported.map(r => `
          <div class="batch-result-row">
            <span class="batch-result-file">${escHtml(r.file)}</span>
            <span class="batch-result-meta">${typeLabel(r.type)} · ${r.rows} Zeilen → ${escHtml(r.schema)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  const errorHTML = errors.length ? `
    <div class="batch-result-section" style="margin-top:${imported.length ? 12 : 0}px">
      <div class="batch-result-header batch-result-err">
        ${IC.warn} ${errors.length} Datei(en) übersprungen
      </div>
      <div class="batch-result-list">
        ${errors.map(e => `
          <div class="batch-result-row batch-result-row-err">
            <div class="batch-result-file">${escHtml(e.file)}</div>
            <div class="batch-result-reason">${escHtml(e.error)}</div>
            ${e.expected?.length ? `
              <div class="batch-result-detail">
                <span class="batch-label">Erwartet:</span>
                ${e.expected.map(x => `<code>${escHtml(x)}</code>`).join(' ')}
              </div>
            ` : ''}
            ${e.found?.length ? `
              <div class="batch-result-detail">
                <span class="batch-label">Vorhanden:</span>
                ${e.found.map(x => `<code>${escHtml(x)}</code>`).join(' ')}
              </div>
            ` : ''}
            ${e.missing?.length ? `
              <div class="batch-result-detail">
                <span class="batch-label" style="color:var(--color-danger)">Fehlende Pflichtfelder:</span>
                ${e.missing.map(x => `<code style="color:var(--color-danger)">${escHtml(x)}</code>`).join(' ')}
              </div>
            ` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  ` : '';

  res.innerHTML = successHTML + errorHTML;
  res.style.display = '';
}

// ── Hilfsfunktionen ────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function typeLabel(type) {
  return type === 'nomen' ? 'Nomen' : type === 'adjektiv' ? 'Adjektiv' : 'Genre';
}

// ── Globaler Event-Listener ────────────────────────────────────────────────
document.addEventListener('editor:open-batch', () => openBatchModal());
