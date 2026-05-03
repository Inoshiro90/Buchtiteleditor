// scripts/ui/statusbar.js
import { AppStore } from '../store/AppStore.js';
import { countDuplicates, removeDuplicates, countCrossClassDuplicates } from '../services/duplicate-service.js';

export function initStatusbar(container) {
  render(container);
  AppStore.on('rows',                 () => render(container));
  AppStore.on('crossClassDuplicates', () => render(container));
  AppStore.on('activeSchema',         () => render(container));
  AppStore.on('loading',              () => render(container));
  AppStore.on('loadingMessage',       () => render(container));
  AppStore.on('loadingProgress',      () => render(container));
}

function render(container) {
  const loading  = AppStore.get('loading');
  const message  = AppStore.get('loadingMessage') ?? '';
  const progress = AppStore.get('loadingProgress') ?? 0;
  const rows     = AppStore.get('rows') ?? [];
  const schema   = AppStore.get('activeSchema');

  const withinDups = countDuplicates(rows);
  const crossDups  = countCrossClassDuplicates(rows);

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

  // Build tooltip for cross-class duplicates
  const crossRows  = rows.filter(r => r._isCrossClassDuplicate);
  const crossTip   = crossRows.length
    ? crossRows.slice(0, 5).map(r => {
        const key   = r.singular ?? r.positive ?? r.title ?? '?';
        const where = (r._crossClassDuplicateOf ?? []).join(', ');
        return `${key} → ${where}`;
      }).join('\n') + (crossRows.length > 5 ? `\n… und ${crossRows.length - 5} weitere` : '')
    : '';

  container.innerHTML = `
    <div class="statusbar-info">
      ${schema ? `
        <span class="statusbar-schema">${schema.label}</span>
        <span class="statusbar-sep">›</span>
        <span class="statusbar-count">${rows.length} Einträge</span>

        ${withinDups > 0 ? `
          <span class="statusbar-sep">·</span>
          <span class="statusbar-dup-badge" title="Duplikate innerhalb dieser Tabelle">
            ${withinDups} Duplikate
          </span>
          <button class="statusbar-remove-dups" id="btn-remove-dups">
            Alle entfernen
          </button>
        ` : ''}

        ${crossDups > 0 ? `
          <span class="statusbar-sep">·</span>
          <span class="statusbar-cross-dup-badge"
                title="Klassenübergreifende Duplikate (erscheinen in anderen Klassen desselben Typs):\n${escHtml(crossTip)}">
            ${crossDups} klassenübergreifend
          </span>
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

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
