// scripts/ui/modals/virtual-classes-dialog.js
// Ä1: 3 getrennte Textfelder (Nomen / Defektiva / Adjektive)

import { openModal, showToast } from './modal-base.js';
import { AppStore }             from '../../store/AppStore.js';
import { db }                   from '../../db/db.js';

const VALID_RE = /^[\p{L}\p{N}äöüÄÖÜß_-]+$/u;

function parseNames(raw) {
  return [...new Set(
    raw.split('\n').map(l => l.trim()).filter(l => l.length > 0 && VALID_RE.test(l))
  )];
}

function findConflicts(names, schemas, type) {
  const realNames = new Set(
    schemas.filter(s => s.type === type || (type === 'nomen' && s.type === 'defektivum')).map(s => s.lemma ?? s.id)
  );
  // Also check cross-type conflicts
  const allReal = new Set(schemas.map(s => s.lemma ?? s.id));
  return names.filter(n => allReal.has(n));
}

function makeTextarea(id, label, value, placeholder) {
  return `
    <div>
      <label class="form-label" style="display:flex;align-items:center;justify-content:space-between">
        <span>${label}</span>
        <span id="${id}-count" style="font-size:11px;color:var(--c-text-dim);font-weight:400">0</span>
      </label>
      <textarea
        id="${id}"
        class="form-input vc-ta"
        style="width:100%;height:120px;resize:vertical;font-family:var(--font-mono);font-size:12px;line-height:1.7;box-sizing:border-box;margin-top:4px"
        placeholder="${placeholder}"
        spellcheck="false"
      >${escHtml(value)}</textarea>
      <div id="${id}-warn" style="display:none;margin-top:4px;padding:5px 10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:var(--radius-micro);font-size:11px;color:var(--c-warning)"></div>
    </div>
  `;
}

export function openVirtualClassesDialog() {
  const schemas = AppStore.get('schemas') ?? [];
  const vcN = AppStore.get('virtualClassesNomen')     ?? '';
  const vcD = AppStore.get('virtualClassesDefektiva') ?? '';
  const vcA = AppStore.get('virtualClassesAdjektive') ?? '';

  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <p style="color:var(--c-text-muted);font-size:13px;line-height:1.6;margin:0">
        Klassen <strong>ohne eigene Tabelle</strong> — erzeugen automatisch Variablen
        <code style="color:var(--c-accent)">Klasse1</code>, <code style="color:var(--c-accent)">Klasse2</code>, <code style="color:var(--c-accent)">Klasse3</code>
      </p>
      ${makeTextarea('vc-nomen',     '📦 Nomen',     vcN, 'Waffe\nTier\nOrt')}
      ${makeTextarea('vc-defektiva', '# Defektiva',  vcD, 'Wasser\nFeuer\nEis')}
      ${makeTextarea('vc-adjektive', '△ Adjektive',  vcA, 'Magisch\nDunkel')}
      <div style="padding:8px 12px;background:var(--c-surface-3);border-radius:var(--radius-micro);font-size:11px;color:var(--c-text-dim)">
        <strong style="color:var(--c-text-muted)">Gültige Zeichen:</strong> Buchstaben, Ziffern, Bindestrich, Unterstrich — ein Klassenname pro Zeile.
      </div>
    </div>
  `;

  openModal({
    id:       'modal-virtual-classes',
    title:    'Virtuelle Klassen verwalten',
    bodyHTML,
    width:    '520px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Speichern',  cls: 'btn-primary',  action: (close) => saveAndClose(close) },
    ],
    onOpen: (dialog) => {
      [
        ['vc-nomen',     'nomen'],
        ['vc-defektiva', 'defektivum'],
        ['vc-adjektive', 'adjektiv'],
      ].forEach(([id, type]) => {
        const ta   = dialog.querySelector(`#${id}`);
        const cnt  = dialog.querySelector(`#${id}-count`);
        const warn = dialog.querySelector(`#${id}-warn`);

        const refresh = () => {
          const names     = parseNames(ta.value);
          const conflicts = findConflicts(names, schemas, type);
          cnt.textContent = `${names.length}`;
          if (conflicts.length > 0) {
            warn.style.display = '';
            warn.textContent   = `⚠ Konflikt: ${conflicts.join(', ')}`;
          } else {
            warn.style.display = 'none';
          }
        };
        ta.addEventListener('input', refresh);
        refresh();
      });
    },
  });

  async function saveAndClose(close) {
    const results = {};
    let totalConflicts = 0;
    for (const [id, key] of [
      ['vc-nomen',     'virtualClassesNomen'],
      ['vc-defektiva', 'virtualClassesDefektiva'],
      ['vc-adjektive', 'virtualClassesAdjektive'],
    ]) {
      const ta     = document.querySelector(`#${id}`);
      if (!ta) { results[key] = ''; continue; }
      const names  = parseNames(ta.value);
      const allReal = new Set(schemas.map(s => s.lemma ?? s.id));
      const clean  = names.filter(n => !allReal.has(n));
      totalConflicts += names.length - clean.length;
      // Preserve original line order, deduplicate
      results[key] = ta.value.split('\n')
        .map(l => l.trim())
        .filter(l => clean.includes(l))
        .filter((l, i, arr) => arr.indexOf(l) === i)
        .join('\n');
    }

    for (const [key, val] of Object.entries(results)) {
      AppStore.set(key, val);
      try { await db.set('meta', key, val); } catch (_) {}
    }

    const totalClasses = Object.values(results)
      .flatMap(v => v.split('\n').filter(Boolean)).length;
    showToast(
      totalConflicts > 0
        ? `Gespeichert. ${totalConflicts} Konflikt(e) entfernt.`
        : `${totalClasses} virtuelle Klasse(n) gespeichert.`,
      'success'
    );
    close();
  }
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('editor:open-virtual-classes', () => openVirtualClassesDialog());
