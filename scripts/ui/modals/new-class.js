// editor/ui/modals/new-class.js
import { openModal, confirmModal, showToast } from './modal-base.js';
import { AppStore } from '../../store/AppStore.js';
import { db } from '../../db/db.js';
import { NOMEN_COLUMNS, ADJ_COLUMNS, DEFEKTIV_COLUMNS } from '../../db/schemas.js';

// ── Create ─────────────────────────────────────────────────────────────────
export function openNewClassDialog() {
  const bodyHTML = `
    <div class="form-group">
      <label class="form-label">Klassen-Name (= Lemma-Name im DSL)</label>
      <input class="form-input" id="nc-name" placeholder="z.B. Götter, Zauber, Artefakt …" />
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
        Wird als Lemma-Referenz in DSL-Templates verwendet. Variablen (Name1, Name2, Name3) werden automatisch erzeugt.
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">Typ</label>
      <div style="display:flex;gap:14px">
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--text-secondary)">
          <input type="radio" name="nc-type" value="nomen" checked style="accent-color:var(--color-accent)">
          <span>Nomen</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--text-secondary)">
          <input type="radio" name="nc-type" value="adjektiv" style="accent-color:var(--color-accent)">
          <span>Adjektiv</span>
        </label>
        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;color:var(--text-secondary)">
          <input type="radio" name="nc-type" value="defektivum" style="accent-color:var(--color-accent)">
          <span>Defektivum</span>
        </label>
      </div>
    </div>

    <div class="form-group">
      <label class="form-label">CSV-Dateiname</label>
      <input class="form-input" id="nc-file" placeholder="MeineKlasse.csv" />
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px">
        Relativ zu <code style="font-family:var(--font-mono)">../data/nomen/</code> oder <code style="font-family:var(--font-mono)">../data/adjektive/</code>
      </div>
    </div>

    <div style="background:var(--bg-warm);border:var(--border-whisper);border-radius:var(--radius-micro);padding:12px;margin-top:4px">
      <div class="form-label" style="margin-bottom:6px">Automatisch erzeugte Variablen</div>
      <div id="nc-vars-preview" style="font-family:var(--font-mono);font-size:12px;color:var(--text-secondary)"></div>
      <div class="form-label" style="margin-top:10px;margin-bottom:4px">Spalten</div>
      <div id="nc-columns-preview" style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);line-height:1.8"></div>
    </div>
  `;

  openModal({
    id: 'modal-new-class',
    title: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 5H3"/><path d="M11 12H3"/><path d="M16 19H3"/><path d="M18 9v6"/><path d="M21 12h-6"/></svg> Neue Klasse anlegen',
    bodyHTML,
    width: '480px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Klasse anlegen', cls: 'btn-primary', action: (close) => createClass(close) },
    ],
    onOpen: () => {
      updatePreview();
      document.getElementById('nc-name')?.addEventListener('input', updatePreview);
      document.querySelectorAll('input[name="nc-type"]').forEach(r => r.addEventListener('change', updatePreview));
    },
  });
}

function getType() {
  return document.querySelector('input[name="nc-type"]:checked')?.value ?? 'nomen';
}

function updatePreview() {
  const name = document.getElementById('nc-name')?.value?.trim() ?? '';
  const type = getType();

  // Auto-suggest filename
  const fileEl = document.getElementById('nc-file');
  if (fileEl && name) {
    fileEl.value = name.replace(/[^a-zA-ZäöüÄÖÜß0-9]/g, '') + '.csv';
  }

  // Columns
  const cols = type === 'adjektiv' ? ADJ_COLUMNS : type === 'defektivum' ? DEFEKTIV_COLUMNS : NOMEN_COLUMNS;
  const colEl = document.getElementById('nc-columns-preview');
  if (colEl) colEl.textContent = cols.map(c => c.field).join(' · ');

  // Variables preview
  const varEl = document.getElementById('nc-vars-preview');
  if (varEl) {
    varEl.textContent = name
      ? `${name}1, ${name}2, ${name}3`
      : '(nach Namenseingabe sichtbar)';
  }
}

async function createClass(close) {
  const name    = document.getElementById('nc-name')?.value?.trim();
  const type    = getType();
  const csvFile = document.getElementById('nc-file')?.value?.trim();

  if (!name)    { showToast('Bitte einen Klassen-Namen eingeben', 'warn'); return; }
  if (!csvFile) { showToast('Bitte einen Dateinamen eingeben', 'warn'); return; }

  const schemas = AppStore.get('schemas') ?? [];
  if (schemas.find(s => s.id === name)) {
    showToast(`Klasse „${name}" existiert bereits`, 'warn');
    return;
  }

  const dir     = type === 'adjektiv' ? '../data/adjektive/' : type === 'defektivum' ? '../data/defektiva/' : '../data/nomen/';
  const columns = type === 'adjektiv' ? ADJ_COLUMNS : type === 'defektivum' ? DEFEKTIV_COLUMNS : NOMEN_COLUMNS;

  const group = type === 'adjektiv' ? 'adjektiv' : type === 'defektivum' ? 'defektiv' : 'nomen';

  const newSchema = {
    id: name, label: name,
    file: `${dir}${csvFile}`, csvFile,
    type, columns, lemma: name,
    group,
    deletable: true,
    custom: true,   // marks it as user-created (for persistence), not used for display group
  };

  // Änderung 5: Auto-generate variables (Name1, Name2, Name3) as empty rows
  // Variables are stored in the token-insert module's VARIABLE_BASES list;
  // for the validator and token dialogs we persist variable metadata to db.
  const existingVars = (await db.get('meta', 'customVariables')) ?? {};
  existingVars[name] = [1, 2, 3].map(n => `${name}${n}`);
  await db.set('meta', 'customVariables', existingVars);

  const updatedSchemas = [...schemas, newSchema];
  AppStore.set('schemas', updatedSchemas);

  await db.set('tables', name, []);

  // Persist only user-created schemas (marked with custom: true)
  const customSchemas = updatedSchemas.filter(s => s.custom === true);
  await db.set('schemas', 'custom', customSchemas);

  AppStore.set('activeSchema', newSchema);
  close();
  showToast(`Klasse „${name}" angelegt · Variablen ${name}1–3 erzeugt`, 'success');
}

// ── Delete ─────────────────────────────────────────────────────────────────
/**
 * Delete a custom class after confirmation.
 * Cleans up: schemas list, IndexedDB table, custom variable metadata, activeSchema.
 */
export async function deleteClass(schemaId) {
  const schemas = AppStore.get('schemas') ?? [];
  const schema  = schemas.find(s => s.id === schemaId);

  if (!schema) return;

  confirmModal({
    title: 'Klasse löschen',
    message: `Klasse <strong>${schema.label}</strong> und alle ${
      (await db.get('tables', schemaId) ?? []).length
    } Einträge wirklich löschen?<br><br>
    Diese Aktion kann nicht rückgängig gemacht werden.`,
    confirmLabel: 'Ja, löschen',
    cancelLabel: 'Abbrechen',
    onConfirm: async () => {
      // Remove from schemas list
      const updated = schemas.filter(s => s.id !== schemaId);
      AppStore.set('schemas', updated);

      // Remove table data from DB
      await db.delete('tables', schemaId);

      // Remove custom variable entries
      const vars = (await db.get('meta', 'customVariables')) ?? {};
      delete vars[schemaId];
      await db.set('meta', 'customVariables', vars);

      // Persist updated custom schema list
      const customSchemas = updated.filter(s => s.custom === true);
      await db.set('schemas', 'custom', customSchemas);

      // If the deleted class was active, switch to first schema
      const active = AppStore.get('activeSchema');
      if (active?.id === schemaId) {
        AppStore.set('activeSchema', updated[0] ?? null);
        AppStore.set('rows', []);
      }

      showToast(`Klasse „${schema.label}" gelöscht`, 'success');
    },
  });
}

document.addEventListener('editor:open-new-class', () => openNewClassDialog());
