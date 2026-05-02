// editor/ui/statusbar.js
import { AppStore } from '../store/AppStore.js';
import { countDuplicates, removeDuplicates } from '../services/duplicate-service.js';
import { detectDuplicates } from '../services/duplicate-service.js';

export function initStatusbar(container) {
  render(container);
  AppStore.on('rows', () => render(container));
  AppStore.on('activeSchema', () => render(container));
  AppStore.on('loading', () => render(container));
  AppStore.on('loadingMessage', () => render(container));
  AppStore.on('loadingProgress', () => render(container));
}

function render(container) {
  const loading = AppStore.get('loading');
  const message = AppStore.get('loadingMessage') ?? '';
  const progress = AppStore.get('loadingProgress') ?? 0;
  const rows = AppStore.get('rows') ?? [];
  const schema = AppStore.get('activeSchema');
  const dups = countDuplicates(rows);

  if (loading) {
    container.innerHTML = `
      <div class="statusbar-loading">
        <div class="statusbar-progress-track">
          <div class="statusbar-progress-fill" style="width:${progress}%"></div>
        </div>
        <span class="statusbar-loading-text">${message}</span>
        <span class="statusbar-loading-pct">${Math.round(progress)}%</span>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div class="statusbar-info">
      ${schema ? `
        <span class="statusbar-schema">${schema.label}</span>
        <span class="statusbar-sep">›</span>
        <span class="statusbar-count">${rows.length} Einträge</span>
        ${dups > 0 ? `
          <span class="statusbar-sep">·</span>
          <span class="statusbar-dup-badge">${dups} Duplikate</span>
          <button class="statusbar-remove-dups" id="btn-remove-dups">
            Alle entfernen
          </button>
        ` : ''}
      ` : '<span class="statusbar-hint">← Tabelle aus der Seitenleiste wählen</span>'}
    </div>
  `;

  container.querySelector('#btn-remove-dups')?.addEventListener('click', () => {
    const currentRows = AppStore.get('rows') ?? [];
    const cleaned = removeDuplicates(currentRows);
    AppStore.set('rows', cleaned);
    document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: cleaned } }));
  });
}
