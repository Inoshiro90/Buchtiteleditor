// editor/ui/toolbar.js
import { AppStore } from '../store/AppStore.js';
import { removeDuplicates, countDuplicates } from '../services/duplicate-service.js';
import { rowsToCsv, downloadCsv } from '../services/csv-service.js';
import { icon, icon14 } from './icons.js';

export function initToolbar(container) {
  render(container);
  AppStore.on('activeSchema', () => render(container));
  AppStore.on('rows',         () => updateCounts(container));
  AppStore.on('duplicates',   () => updateCounts(container));
  AppStore.on('errors',       () => updateCounts(container));
}

function render(container) {
  const schema = AppStore.get('activeSchema');

  container.innerHTML = `
    <div class="toolbar-left">
      <div class="toolbar-schema-name">${schema ? schema.label : '— Keine Tabelle gewählt —'}</div>
      ${schema ? `
        <div class="toolbar-actions">
          <button class="toolbar-btn primary" id="btn-add-row" title="Zeile hinzufügen">
            ${icon14('plus')} Zeile
          </button>
          <button class="toolbar-btn danger" id="btn-delete-rows" title="Ausgewählte Zeilen löschen">
            ${icon14('trash-2')} Löschen
          </button>
          <div class="toolbar-separator"></div>
          ${schema.type === 'genre' ? `
            <button class="toolbar-btn" id="btn-token-nom" title="NOM-Token einfügen">${icon14('plus')} NOM</button>
            <button class="toolbar-btn" id="btn-token-def" title="DEF-Token einfügen">${icon14('plus')} DEF</button>
            <button class="toolbar-btn" id="btn-token-adj" title="ADJ-Token einfügen">${icon14('plus')} ADJ</button>
            <button class="toolbar-btn" id="btn-token-pro" title="PRO-Token einfügen">${icon14('plus')} PRO</button>
            <button class="toolbar-btn" id="btn-token-art" title="ART-Token einfügen">${icon14('plus')} ART</button>
            <button class="toolbar-btn" id="btn-token-nam" title="NAM-Token einfügen">${icon14('plus')} NAM</button>
            <button class="toolbar-btn" id="btn-token-com" title="COM-Token einfügen">${icon14('plus')} COM</button>
            <button class="toolbar-btn" id="btn-token-fun" title="FUN-Token einfügen">${icon14('plus')} FUN</button>
            <div class="toolbar-separator"></div>
            <button class="toolbar-btn accent" id="btn-auto-tags" title="Auto-Tags generieren">
              ${icon14('tags')} Auto-Tags
            </button>
            <div class="toolbar-separator"></div>
          ` : ''}
          <button class="toolbar-btn" id="btn-import" title="Importieren">
            ${icon14('file-up')} Import
          </button>
          <button class="toolbar-btn" id="btn-export" title="Exportieren">
            ${icon14('file-down')} Export
          </button>
        </div>
      ` : ''}
    </div>
    <div class="toolbar-right">
      ${schema ? `
        <div class="toolbar-filter-wrap">
          <span class="toolbar-filter-icon">${icon12('search')}</span>
          <input
            type="text"
            class="toolbar-filter"
            id="toolbar-filter"
            placeholder="Suchen …"
            value="${AppStore.get('filterText') ?? ''}"
          />
        </div>
        <div class="toolbar-stats">
          <span class="stat-item" id="stat-rows">0 Zeilen</span>
          <span class="stat-sep">·</span>
          <span class="stat-item stat-dup" id="stat-dups">0 Duplikate</span>
          <span class="stat-sep">·</span>
          <span class="stat-item stat-err" id="stat-errs">0 Fehler</span>
        </div>
      ` : ''}
    </div>
  `;

  if (!schema) return;
  bindEvents(container, schema);
  updateCounts(container);
}

function icon12(name) {
  const paths = { search: '<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>' };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
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

function bindEvents(container, schema) {
  container.querySelector('#toolbar-filter')?.addEventListener('input', (e) => {
    AppStore.set('filterText', e.target.value);
  });

  container.querySelector('#btn-add-row')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:add-row'));
  });

  container.querySelector('#btn-delete-rows')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:delete-rows'));
  });

  ['nom','def','adj','pro','art','nam','com','fun'].forEach((type) => {
    container.querySelector(`#btn-token-${type}`)?.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('editor:open-token-dialog', { detail: { type: type.toUpperCase() } }));
    });
  });

  container.querySelector('#btn-auto-tags')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:auto-tags'));
  });

  container.querySelector('#btn-import')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:open-import'));
  });

  container.querySelector('#btn-export')?.addEventListener('click', () => {
    handleExport(schema);
  });
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
