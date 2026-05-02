// editor/ui/modals/auto-tags-dialog.js
import { openModal, showToast } from './modal-base.js';
import { previewAutoTags, applyAutoTags } from '../../services/tag-service.js';
import { AppStore } from '../../store/AppStore.js';
import { db } from '../../db/db.js';

export function openAutoTagsDialog() {
  const schema = AppStore.get('activeSchema');
  const rows   = AppStore.get('rows') ?? [];

  if (schema?.type !== 'genre') {
    showToast('Auto-Tags nur für Genre-Tabelle verfügbar', 'warn');
    return;
  }

  const changes = previewAutoTags(rows);

  if (changes.length === 0) {
    showToast('Keine Tag-Änderungen nötig — alles aktuell', 'success');
    return;
  }

  const bodyHTML = `
    <div style="margin-bottom:12px;color:var(--c-text-muted);font-size:13px">
      ${changes.length} Zeile(n) würden aktualisiert:
    </div>
    <div style="max-height:360px;overflow-y:auto;border:1px solid var(--c-border);border-radius:var(--radius)">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead>
          <tr>
            <th style="padding:7px 10px;background:var(--c-surface-2);color:var(--c-text-muted);text-align:left;border-bottom:1px solid var(--c-border);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Titel</th>
            <th style="padding:7px 10px;background:var(--c-surface-2);color:var(--c-text-muted);text-align:left;border-bottom:1px solid var(--c-border);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Alt</th>
            <th style="padding:7px 10px;background:var(--c-surface-2);color:var(--c-text-muted);text-align:left;border-bottom:1px solid var(--c-border);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Neu</th>
          </tr>
        </thead>
        <tbody>
          ${changes.map(({ row, oldTags, newTags }) => `
            <tr>
              <td style="padding:5px 10px;border-bottom:1px solid var(--c-border-muted);font-family:var(--font-mono);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--c-text-muted)">${escHtml(row.title ?? '')}</td>
              <td style="padding:5px 10px;border-bottom:1px solid var(--c-border-muted);color:var(--c-danger);font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(oldTags)}</td>
              <td style="padding:5px 10px;border-bottom:1px solid var(--c-border-muted);color:var(--c-success);font-size:11px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(newTags)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  openModal({
    id: 'modal-auto-tags',
    title: 'Auto-Tags — Vorschau',
    bodyHTML,
    width: '680px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: `${changes.length} Zeilen aktualisieren`, cls: 'btn-primary', action: async (close) => {
        const updated = applyAutoTags(rows);
        AppStore.set('rows', updated);
        await db.set('tables', schema.id, updated);
        document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: updated } }));
        close();
        showToast(`${changes.length} Zeilen mit Auto-Tags versehen`, 'success');
      }},
    ],
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Global event listener ──────────────────────────────────────────────────
document.addEventListener('editor:auto-tags', () => openAutoTagsDialog());
