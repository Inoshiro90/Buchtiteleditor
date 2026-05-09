// editor/ui/toolbar.js
// Änderung 2: Find & Replace Bar integriert in toolbar-right
// Undo/Redo-Buttons + Inline-Rename bleiben erhalten

import { AppStore } from '../store/AppStore.js';
import { db }       from '../db/db.js';
import { removeDuplicates, countDuplicates } from '../services/duplicate-service.js';
import { rowsToCsv, downloadCsv }            from '../services/csv-service.js';
import { icon, icon14 }                      from './icons.js';
import { initFindReplaceBar }                from './find-replace-bar.js';

let _frBarContainer = null; // behält die Find-Replace-Bar-Instanz über Re-Renders

export function initToolbar(container) {
  render(container);
  AppStore.on('activeSchema', () => render(container));
  AppStore.on('rows',         () => updateCounts(container));
  AppStore.on('duplicates',   () => updateCounts(container));
  AppStore.on('errors',       () => updateCounts(container));
  AppStore.on('undoStack',    () => updateUndoRedo(container));
  AppStore.on('redoStack',    () => updateUndoRedo(container));
}

function render(container) {
  const schema = AppStore.get('activeSchema');

  container.innerHTML = `
    <div class="toolbar-inner">
    <div class="toolbar-left">
      <div class="toolbar-schema-name-wrap">
        ${schema ? `
          <span class="toolbar-schema-name" id="toolbar-schema-name-label"
            title="${schema.label}">${schema.label}</span>
          ${schema.type !== 'genre' ? `
            <button class="toolbar-rename-btn" id="btn-toolbar-rename"
              title="Tabelle umbenennen" aria-label="Umbenennen">
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
              </svg>
            </button>
          ` : ''}
        ` : `<span class="toolbar-schema-name">— Keine Tabelle gewählt —</span>`}
      </div>

      ${schema ? `
        <div class="toolbar-actions">
          <button class="toolbar-btn" id="btn-undo" title="Rückgängig (Strg+Z)" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7v6h6"/><path d="M3 13C5.33 7.27 11 3 18 3a9 9 0 0 1 9 9"/>
            </svg>
          </button>
          <button class="toolbar-btn" id="btn-redo" title="Wiederholen (Strg+Y)" disabled>
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 7v6h-6"/><path d="M21 13C18.67 7.27 13 3 6 3a9 9 0 0 0-9 9"/>
            </svg>
          </button>
          <div class="toolbar-separator"></div>
          <button class="toolbar-btn primary" id="btn-add-row" title="Zeile hinzufügen">
            ${icon14('plus')} Zeile
          </button>
          <button class="toolbar-btn danger" id="btn-delete-rows" title="Ausgewählte Zeilen löschen">
            ${icon14('trash-2')} Löschen
          </button>
          <div class="toolbar-separator"></div>
          ${schema.type === 'genre' ? `
            <button class="toolbar-btn" id="btn-token-nom">${icon14('plus')} NOM</button>
            <button class="toolbar-btn" id="btn-token-def">${icon14('plus')} DEF</button>
            <button class="toolbar-btn" id="btn-token-adj">${icon14('plus')} ADJ</button>
            <button class="toolbar-btn" id="btn-token-pro">${icon14('plus')} PRO</button>
            <button class="toolbar-btn" id="btn-token-art">${icon14('plus')} ART</button>
            <button class="toolbar-btn" id="btn-token-nam">${icon14('plus')} NAM</button>
            <button class="toolbar-btn" id="btn-token-com">${icon14('plus')} COM</button>
            <button class="toolbar-btn" id="btn-token-fun">${icon14('plus')} FUN</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn accent" id="btn-auto-tags">${icon14('tags')} Auto-Tags</button>
            <div class="toolbar-separator"></div>
          ` : ''}
          <button class="toolbar-btn" id="btn-import">${icon14('file-up')} Import</button>
          <button class="toolbar-btn" id="btn-export">${icon14('file-down')} Export</button>
        </div>
      ` : ''}
    </div>
    <div class="toolbar-right">
      ${schema ? `
        <!-- Änderung 2: Find & Replace Bar Container -->
        <div id="toolbar-fr-bar" class="toolbar-fr-bar"></div>
        <div class="toolbar-stats">
          <span class="stat-item" id="stat-rows">0 Zeilen</span>
          <span class="stat-sep">·</span>
          <span class="stat-item stat-dup" id="stat-dups">0 Duplikate</span>
          <span class="stat-sep">·</span>
          <span class="stat-item stat-err" id="stat-errs">0 Fehler</span>
        </div>
      ` : ''}
    </div>
    </div>
  `;

  if (!schema) return;

  // Änderung 2: Find & Replace Bar initialisieren
  const frContainer = container.querySelector('#toolbar-fr-bar');
  if (frContainer) {
    _frBarContainer = frContainer;
    initFindReplaceBar(frContainer);
  }

  bindEvents(container, schema);
  updateCounts(container);
  updateUndoRedo(container);
}

function updateCounts(container) {
  const rows   = AppStore.get('rows') ?? [];
  const dups   = countDuplicates(rows);
  const errors = (AppStore.get('errors') ?? []).length;

  const elRows = container.querySelector('#stat-rows');
  const elDups = container.querySelector('#stat-dups');
  const elErrs = container.querySelector('#stat-errs');

  if (elRows) elRows.textContent = `${rows.length} Zeilen`;
  if (elDups) {
    elDups.textContent = `${dups} Duplikate`;
    elDups.classList.toggle('has-count', dups > 0);
  }
  if (elErrs) {
    elErrs.textContent = `${errors} Fehler`;
    elErrs.classList.toggle('has-count', errors > 0);
  }
}

function updateUndoRedo(container) {
  const undoBtn = container.querySelector('#btn-undo');
  const redoBtn = container.querySelector('#btn-redo');
  if (undoBtn) undoBtn.disabled = (AppStore.get('undoStack') ?? []).length === 0;
  if (redoBtn) redoBtn.disabled = (AppStore.get('redoStack') ?? []).length === 0;
}

function bindEvents(container, schema) {
  container.querySelector('#btn-add-row')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:add-row')));
  container.querySelector('#btn-delete-rows')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:delete-rows')));
  container.querySelector('#btn-undo')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:undo')));
  container.querySelector('#btn-redo')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:redo')));

  ['nom','def','adj','pro','art','nam','com','fun'].forEach(type => {
    container.querySelector(`#btn-token-${type}`)?.addEventListener('click', () =>
      document.dispatchEvent(new CustomEvent('editor:open-token-dialog', { detail: { type: type.toUpperCase() } })));
  });

  container.querySelector('#btn-auto-tags')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:auto-tags')));
  container.querySelector('#btn-import')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-import')));
  container.querySelector('#btn-export')?.addEventListener('click', () =>
    handleExport(schema));
  container.querySelector('#btn-toolbar-rename')?.addEventListener('click', () =>
    startToolbarRename(container, schema));
}

// ── Toolbar Inline Rename (identischer Fix wie Problem 3) ─────────────────
function startToolbarRename(container, schema) {
  const labelEl = container.querySelector('#toolbar-schema-name-label');
  if (!labelEl) return;

  const currentLabel = schema.label;
  const renameBtn    = container.querySelector('#btn-toolbar-rename');

  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = currentLabel;
  input.className = 'toolbar-rename-input';
  labelEl.replaceWith(input);
  input.focus();
  input.select();
  if (renameBtn) renameBtn.style.visibility = 'hidden';

  let _done = false;

  const commit = async () => {
    if (_done) return;
    _done = true;
    cleanup();
    const newLabel = input.value.trim() || currentLabel;
    restoreLabel(newLabel);
    if (newLabel !== currentLabel) {
      const schemas = AppStore.get('schemas') ?? [];
      const updated = schemas.map(s => s.id === schema.id ? { ...s, label: newLabel } : s);
      AppStore.set('schemas', updated);
      await db.set('schemas', 'custom', updated.filter(s => s.custom === true));
      const active = AppStore.get('activeSchema');
      if (active?.id === schema.id) AppStore.set('activeSchema', { ...active, label: newLabel });
    }
  };

  const cancel = () => {
    if (_done) return;
    _done = true;
    cleanup();
    restoreLabel(currentLabel);
  };

  function restoreLabel(text) {
    const span = document.createElement('span');
    span.className = 'toolbar-schema-name';
    span.id        = 'toolbar-schema-name-label';
    span.title     = text;
    span.textContent = text;
    if (input.parentNode) input.replaceWith(span);
    if (renameBtn) renameBtn.style.visibility = '';
  }

  const onKey = e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  const onOutside = e => {
    if (e.target === input || input.contains(e.target)) return;
    commit();
  };

  function cleanup() {
    input.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onOutside, { capture: true });
  }

  input.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onOutside, { capture: true });
}

async function handleExport(schema) {
  const rows   = AppStore.get('rows') ?? [];
  const errors = AppStore.get('errors') ?? [];
  if (errors.length > 0) {
    document.dispatchEvent(new CustomEvent('editor:export-warning', { detail: { schema, rows, errors } }));
    return;
  }
  doExport(schema, rows);
}

export function doExport(schema, rows) {
  const fields = schema.columns.map(c => c.field);
  const csv    = rowsToCsv(fields, rows);
  downloadCsv(schema.csvFile, csv);
}
