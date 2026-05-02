// editor/ui/modals/export-warning.js
import { openModal } from './modal-base.js';
import { doExport } from '../toolbar.js';

export function openExportWarning({ schema, rows, errors }) {
  const errorList = errors.slice(0, 20).map(e =>
    `<li style="margin-bottom:4px">
      <span style="color:var(--c-dsl-err);font-family:var(--font-mono);font-size:11px">
        ${e.message ?? JSON.stringify(e)}
      </span>
    </li>`
  ).join('');

  const moreCount = errors.length > 20 ? errors.length - 20 : 0;

  const bodyHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:16px">
      <span class="export-warn-icon"></span>
      <div>
        <div style="font-weight:600;margin-bottom:4px">DSL-Fehler gefunden</div>
        <div style="color:var(--c-text-muted);font-size:13px">
          Die Tabelle enthält ${errors.length} DSL-Fehler. Der Export erzeugt möglicherweise ungültige Templates.
        </div>
      </div>
    </div>
    <div style="background:var(--c-surface-2);border:1px solid var(--c-border);border-radius:var(--radius);padding:10px 14px;max-height:200px;overflow-y:auto">
      <ul style="list-style:none;padding:0;margin:0">
        ${errorList}
        ${moreCount > 0 ? `<li style="color:var(--c-text-dim);font-size:11px">… und ${moreCount} weitere Fehler</li>` : ''}
      </ul>
    </div>
  `;

  openModal({
    id: 'modal-export-warning',
    title: 'Export mit Fehlern',
    bodyHTML,
    width: '520px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Trotzdem exportieren', cls: 'btn-danger', action: (close) => {
        doExport(schema, rows);
        close();
      }},
    ],
  });
}

// ── Global event listener ──────────────────────────────────────────────────
document.addEventListener('editor:export-warning', (e) => {
  openExportWarning(e.detail);
});
