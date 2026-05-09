// scripts/ui/modals/class-map-dialog.js
// Ä1/P2 Fix: Kein const, 3 getrennte Blöcke für Files und 3 für Keys
// P2 Fix: Immer 3 Keys pro Klasse (count wird als min:1 gewertet)

import { openModal, showToast } from './modal-base.js';
import { AppStore }             from '../../store/AppStore.js';
import { db }                   from '../../db/db.js';

async function buildMaps() {
  const schemas = AppStore.get('schemas') ?? [];

  const vcN = (AppStore.get('virtualClassesNomen')     ?? '').split('\n').map(s=>s.trim()).filter(Boolean);
  const vcD = (AppStore.get('virtualClassesDefektiva') ?? '').split('\n').map(s=>s.trim()).filter(Boolean);
  const vcA = (AppStore.get('virtualClassesAdjektive') ?? '').split('\n').map(s=>s.trim()).filter(Boolean);

  const buildEntries = async (filtered, folder, virtualList) => {
    const entries = [];
    for (const s of filtered) {
      const rows = (await db.get('tables', s.id)) ?? [];
      // P2 Fix: mind. 1 Key, max 3
      const count = Math.max(1, Math.min(rows.length, 3));
      entries.push({
        lemma: s.lemma ?? s.id,
        file:  `${folder}/${s.csvFile ?? s.id + '.csv'}`,
        count,
      });
    }
    const existing = new Set(entries.map(e => e.lemma));
    for (const vc of virtualList) {
      if (!existing.has(vc)) entries.push({ lemma: vc, file: null, count: 3, virtual: true });
    }
    return entries;
  };

  const nomEntries = await buildEntries(schemas.filter(s => s.type === 'nomen'),     'nomen',     vcN);
  const defEntries = await buildEntries(schemas.filter(s => s.type === 'defektivum'),'defektiva', vcD);
  const adjEntries = await buildEntries(schemas.filter(s => s.type === 'adjektiv'),  'adjektive', vcA);

  return { nomEntries, defEntries, adjEntries };
}

// Ä1: Kein "const X = " Präfix — nur das Array
function formatFileArray(entries) {
  const lines = entries
    .filter(e => !e.virtual)
    .map(e => `  { lemma: '${e.lemma}', file: '${e.file}' },`);
  if (lines.length === 0) return `[\n  // (nur virtuelle Klassen — keine CSV)\n]`;
  return `[\n${lines.join('\n')}\n]`;
}

// Ä1: Kein Kommentar-Header — nur das Array
function formatKeyMap(entries) {
  const lines = [];
  for (const e of entries) {
    for (let i = 1; i <= e.count; i++) {
      lines.push(`  {key: '${e.lemma}${i}', lemma: '${e.lemma}'},`);
    }
  }
  if (lines.length === 0) return `[\n  // (keine Einträge)\n]`;
  return `[\n${lines.join('\n')}\n]`;
}

function codeBlock(label, code, copyId) {
  return `
    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <span class="form-label" style="margin:0;font-size:12px">${label}</span>
        <button class="btn btn-secondary" data-copy="${copyId}" style="font-size:11px;padding:3px 10px">Kopieren</button>
      </div>
      <pre class="cm-code" data-block="${copyId}">${escHtml(code)}</pre>
    </div>
  `;
}

export async function openClassMapDialog() {
  const { nomEntries, defEntries, adjEntries } = await buildMaps();

  const nomFiles = formatFileArray(nomEntries);
  const defFiles = formatFileArray(defEntries);
  const adjFiles = formatFileArray(adjEntries);
  const nomKeys  = formatKeyMap(nomEntries);
  const defKeys  = formatKeyMap(defEntries);
  const adjKeys  = formatKeyMap(adjEntries);

  const blocks = { nomFiles, defFiles, adjFiles, nomKeys, defKeys, adjKeys };

  const bodyHTML = `
    <div style="display:flex;flex-direction:column;gap:16px">
      <p style="margin:0;color:var(--c-text-muted);font-size:13px">
        Generiertes Mapping — direkt in den Buchtitelgenerator einfügen.
      </p>

      <details open>
        <summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--c-text);padding:4px 0">
          📦 File-Arrays
        </summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          ${codeBlock('Nomen',     nomFiles, 'nomFiles')}
          ${codeBlock('Defektiva', defFiles, 'defFiles')}
          ${codeBlock('Adjektive', adjFiles, 'adjFiles')}
        </div>
      </details>

      <details open>
        <summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--c-text);padding:4px 0">
          🗝 Key-Maps (Variable → Lemma)
        </summary>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">
          ${codeBlock('Nomen Keys',     nomKeys, 'nomKeys')}
          ${codeBlock('Defektiva Keys', defKeys, 'defKeys')}
          ${codeBlock('Adjektive Keys', adjKeys, 'adjKeys')}
        </div>
      </details>

      <div style="font-size:11px;color:var(--c-text-dim)">
        Virtuelle Klassen erscheinen nur in Key-Maps. Key-Anzahl = Tabellenzeilen (mind. 1, max. 3).
      </div>
    </div>
  `;

  openModal({
    id: 'modal-class-map', title: 'Klassen-Map für Buchtitelgenerator',
    bodyHTML, width: '660px',
    buttons: [{ label: 'Schließen', cls: 'btn-secondary', action: 'close' }],
    onOpen: (dialog) => {
      dialog.querySelectorAll('[data-copy]').forEach(btn => {
        btn.addEventListener('click', () => {
          const key  = btn.dataset.copy;
          const text = blocks[key] ?? '';
          navigator.clipboard.writeText(text).then(() => showToast('Kopiert!', 'success'));
        });
      });
    },
  });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.addEventListener('editor:open-class-map', () => openClassMapDialog());
