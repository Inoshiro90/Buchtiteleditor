// scripts/ui/modals/database-modal.js
// Datenbank-Verwaltung: JSON-Export, JSON-Import, Komplett-Reset

import { openModal, showToast } from './modal-base.js';
import {
  exportDatabaseAsJSON,
  importDatabaseFromJSON,
  resetDatabase,
} from '../../services/backup-service.js';
import { AppStore } from '../../store/AppStore.js';

// ── SVG-Icons (inline, kein externer Import nötig) ─────────────────────────
const ICON = {
  download: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`,
  upload:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`,
  trash:    `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
};

// ── Hilfsfunktion: Tabellenzählung ─────────────────────────────────────────
function getStats() {
  const schemas = AppStore.get('schemas') ?? [];
  const rows    = AppStore.get('rows') ?? [];
  const total   = schemas.reduce((n, s) => n + ((AppStore.get('rows_' + s.id)) ?? 0), 0);
  return {
    nomen:    schemas.filter(s => s.type === 'nomen').length,
    adjektiv: schemas.filter(s => s.type === 'adjektiv').length,
    genre:    schemas.filter(s => s.type === 'genre').length,
  };
}

// ── Haupt-Dialog ───────────────────────────────────────────────────────────
export function openDatabaseModal() {
  const schemas = AppStore.get('schemas') ?? [];
  const nomenCount    = schemas.filter(s => s.type === 'nomen').length;
  const adjektivCount = schemas.filter(s => s.type === 'adjektiv').length;

  const bodyHTML = `
    <!-- ── Export ── -->
    <div class="db-section">
      <div class="db-section-header">
        ${ICON.download}
        <div>
          <div class="db-section-title">Datenbank exportieren</div>
          <div class="db-section-sub">Alle Einträge (Genre, ${nomenCount} Nomen-Klassen, ${adjektivCount} Adjektiv-Klassen) als JSON-Datei speichern.</div>
        </div>
      </div>
      <button class="btn btn-secondary db-action-btn" id="db-btn-export">
        ${ICON.download} Jetzt exportieren
      </button>
    </div>

    <div class="db-divider"></div>

    <!-- ── Import ── -->
    <div class="db-section">
      <div class="db-section-header">
        ${ICON.upload}
        <div>
          <div class="db-section-title">Datenbank importieren</div>
          <div class="db-section-sub">Zuvor exportiertes JSON-Backup wiederherstellen. Bestehende Einträge werden überschrieben.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label class="btn btn-secondary db-action-btn" style="cursor:pointer">
          ${ICON.upload} Backup-Datei wählen
          <input type="file" id="db-import-file" accept=".json" style="display:none" />
        </label>
        <span id="db-import-filename" style="font-size:12px;color:var(--text-muted)"></span>
      </div>
      <div id="db-import-result" style="margin-top:8px;font-size:12px;display:none"></div>
    </div>

    <div class="db-divider"></div>

    <!-- ── Reset ── -->
    <div class="db-section">
      <div class="db-section-header">
        ${ICON.trash}
        <div>
          <div class="db-section-title" style="color:var(--color-danger)">Datenbank zurücksetzen</div>
          <div class="db-section-sub">
            Löscht <strong>alle</strong> Einträge aus Nomen, Adjektiven und Genre sowie alle benutzerdefinierten Klassen.
            Standard-Klassen bleiben als leere Strukturen erhalten.
            <br><strong style="color:var(--color-danger)">Dieser Vorgang kann nicht rückgängig gemacht werden.</strong>
          </div>
        </div>
      </div>
      <div class="db-reset-confirm" id="db-reset-section">
        <label class="form-label" style="color:var(--color-danger)">
          Gib <strong>DELETE</strong> ein, um den Vorgang zu bestätigen:
        </label>
        <div style="display:flex;gap:8px;margin-top:6px">
          <input
            type="text"
            class="form-input"
            id="db-reset-input"
            placeholder="DELETE"
            autocomplete="off"
            style="font-family:var(--font-mono);letter-spacing:.05em;max-width:180px"
          />
          <button class="btn btn-danger db-action-btn" id="db-btn-reset" disabled>
            ${ICON.trash} Alles löschen
          </button>
        </div>
      </div>
    </div>
  `;

  openModal({
    id:       'modal-database',
    title:    'Datenbank verwalten',
    bodyHTML,
    width:    '540px',
    buttons:  [{ label: 'Schließen', cls: 'btn-secondary', action: 'close' }],
    onOpen:   (_dialog, body) => bindEvents(body),
  });
}

function bindEvents(body) {
  // ── Export ────────────────────────────────────────────────────────────────
  body.querySelector('#db-btn-export')?.addEventListener('click', async () => {
    try {
      await exportDatabaseAsJSON();
      showToast('JSON-Export erfolgreich heruntergeladen', 'success');
    } catch (e) {
      showToast('Export fehlgeschlagen: ' + e.message, 'error');
    }
  });

  // ── Import ────────────────────────────────────────────────────────────────
  body.querySelector('#db-import-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const nameEl   = body.querySelector('#db-import-filename');
    const resultEl = body.querySelector('#db-import-result');

    if (nameEl) nameEl.textContent = file.name;
    if (resultEl) { resultEl.style.display = 'none'; resultEl.textContent = ''; }

    try {
      const { imported, errors } = await importDatabaseFromJSON(file);
      if (resultEl) {
        resultEl.style.display = '';
        resultEl.style.color   = errors.length ? 'var(--color-warn)' : 'var(--color-green)';
        resultEl.textContent   = errors.length
          ? `${imported} Tabellen importiert · ${errors.length} Fehler: ${errors.join(', ')}`
          : `${imported} Tabellen erfolgreich importiert.`;
      }
      showToast(`Backup wiederhergestellt (${imported} Tabellen)`, 'success');
    } catch (err) {
      if (resultEl) {
        resultEl.style.display = '';
        resultEl.style.color   = 'var(--color-danger)';
        resultEl.textContent   = 'Fehler: ' + err.message;
      }
      showToast('Import fehlgeschlagen', 'error');
    }
  });

  // ── Reset: aktiviere Button erst bei korrekter Eingabe ───────────────────
  const resetInput = body.querySelector('#db-reset-input');
  const resetBtn   = body.querySelector('#db-btn-reset');

  resetInput?.addEventListener('input', () => {
    const ok = resetInput.value.trim() === 'DELETE';
    if (resetBtn) resetBtn.disabled = !ok;
  });

  resetBtn?.addEventListener('click', async () => {
    if (resetInput?.value.trim() !== 'DELETE') return;
    try {
      await resetDatabase();
      // Close the modal after reset
      document.getElementById('modal-database')?.querySelector('[data-action="close"]')?.click();
      showToast('Datenbank wurde vollständig zurückgesetzt', 'success');
    } catch (err) {
      showToast('Reset fehlgeschlagen: ' + err.message, 'error');
    }
  });
}

// ── Globaler Event-Listener ────────────────────────────────────────────────
document.addEventListener('editor:open-database', () => openDatabaseModal());
