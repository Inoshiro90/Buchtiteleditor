// editor/ui/modals/token-insert.js
// Token-Einfügedialog — NOM / ADJ / PRO / ART / NAM

import { openModal } from './modal-base.js';
import { insertTokenAtCursor } from '../cell-dsl.js';
import { AppStore } from '../../store/AppStore.js';

// ── Helpers ────────────────────────────────────────────────────────────────
function sel(id) { return document.getElementById(id); }

function buildOptions(values, labels) {
  return values.map((v, i) =>
    `<option value="${v}">${labels?.[i] ?? v}</option>`
  ).join('');
}

function makeSelect(id, values, labels, includeEmpty = false) {
  const emptyOpt = includeEmpty ? `<option value="">—</option>` : '';
  return `<select class="form-select" id="${id}">${emptyOpt}${buildOptions(values, labels)}</select>`;
}

function row(label, control) {
  return `<div class="form-group"><label class="form-label">${label}</label>${control}</div>`;
}

// ── Lemma list ─────────────────────────────────────────────────────────────
function getNomenLemmas() {
  const schemas = AppStore.get('schemas') ?? [];
  return schemas.filter(s => s.type === 'nomen').map(s => s.lemma ?? s.id);
}
function getAdjLemmas() {
  const schemas = AppStore.get('schemas') ?? [];
  return schemas.filter(s => s.type === 'adjektiv').map(s => s.lemma ?? s.id);
}

// Variable names Volk1…Ort3
const VARIABLE_BASES = [
  'Volk','Klasse','Kreaturtyp','Beruf','Waffe','Rüstung','Tier',
  'Gebäude','Ereignis','Metall','Terrain','Religioeses','Ort',
];
function getVariables(base) {
  return [1,2,3].map(n => `${base}${n}`);
}
function getAllVariables() {
  return VARIABLE_BASES.flatMap(b => getVariables(b));
}

// ── Live preview updater ───────────────────────────────────────────────────
function updatePreview(previewId, getToken) {
  const el = document.getElementById(previewId);
  if (el) el.textContent = getToken();
}

// ── NOM Dialog ────────────────────────────────────────────────────────────
function buildNOMToken() {
  const lemma   = sel('nom-lemma')?.value ?? '';
  const numerus = sel('nom-numerus')?.value ?? 'sgl';
  const kasus   = sel('nom-kasus')?.value ?? 'nom';
  const art     = sel('nom-art')?.value ?? '-';
  const renderArt = sel('nom-render-art')?.checked;

  if (!lemma) return `{NOM:?}`;
  let flags = `|${numerus}|${kasus}`;
  if (art !== '-') flags += `|${art}`;
  if (renderArt) flags += `|art`;
  return `{NOM:${lemma}${flags}}`;
}

export function openNOMDialog() {
  const nomenLemmas = [...getNomenLemmas(), ...getAllVariables()];
  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Lemma / Variable', `<select class="form-select" id="nom-lemma">
          <optgroup label="Klassen">${nomenLemmas.filter(l => !/[0-9]$/.test(l)).map(l => `<option value="${l}">${l}</option>`).join('')}</optgroup>
          <optgroup label="Variablen">${nomenLemmas.filter(l => /[0-9]$/.test(l)).map(l => `<option value="${l}">${l}</option>`).join('')}</optgroup>
        </select>`)}
      </div>
      <div>${row('Numerus', makeSelect('nom-numerus', ['sgl','plu'], ['Singular','Plural']))}</div>
      <div>${row('Kasus',   makeSelect('nom-kasus',   ['nom','gen','dat','akk'], ['Nominativ','Genitiv','Dativ','Akkusativ']))}</div>
      <div>${row('Artikel', makeSelect('nom-art',     ['-','def','ind','neg'], ['keiner','bestimmt','unbestimmt','negativ']))}</div>
      <div style="display:flex;align-items:center;gap:8px;padding-top:22px;">
        <input type="checkbox" id="nom-render-art" style="accent-color:var(--c-accent)">
        <label for="nom-render-art" style="color:var(--c-text-muted);font-size:12px">Artikel rendern (|art)</label>
      </div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-accent)" id="nom-preview"></div>
  `;

  openModal({
    id: 'modal-nom',
    title: 'NOM-Token einfügen',
    bodyHTML,
    width: '480px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => {
        insertTokenAtCursor(buildNOMToken());
        close();
      }},
    ],
    onOpen: () => {
      updatePreview('nom-preview', buildNOMToken);
      ['nom-lemma','nom-numerus','nom-kasus','nom-art','nom-render-art'].forEach(id => {
        sel(id)?.addEventListener('change', () => updatePreview('nom-preview', buildNOMToken));
        sel(id)?.addEventListener('input',  () => updatePreview('nom-preview', buildNOMToken));
      });
    },
  });
}

// ── ADJ Dialog ────────────────────────────────────────────────────────────
function buildADJToken() {
  const lemma      = sel('adj-lemma')?.value ?? '';
  const numerus    = sel('adj-numerus')?.value ?? 'sgl';
  const kasus      = sel('adj-kasus')?.value ?? 'nom';
  const genus      = sel('adj-genus')?.value ?? 'msk';
  const art        = sel('adj-art')?.value ?? '-';
  const steigerung = sel('adj-steigerung')?.value ?? 'pos';
  if (!lemma) return `{ADJ:?}`;
  return `{ADJ:${lemma}|${numerus}|${kasus}|${genus}|${art}|${steigerung}}`;
}

export function openADJDialog() {
  const adjLemmas = [...getAdjLemmas()];
  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Lemma', `<select class="form-select" id="adj-lemma">
          ${adjLemmas.map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>`)}
      </div>
      <div>${row('Numerus',    makeSelect('adj-numerus',    ['sgl','plu'], ['Singular','Plural']))}</div>
      <div>${row('Kasus',      makeSelect('adj-kasus',      ['nom','gen','dat','akk']))}</div>
      <div>${row('Genus',      makeSelect('adj-genus',      ['msk','fem','neu'], ['Maskulinum','Femininum','Neutrum']))}</div>
      <div>${row('Artikel',    makeSelect('adj-art',        ['-','def','ind','neg'], ['keiner','bestimmt','unbestimmt','negativ']))}</div>
      <div style="grid-column:1/-1">${row('Steigerung', makeSelect('adj-steigerung', ['pos','kom','sup'], ['Positiv','Komparativ','Superlativ']))}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-adj)" id="adj-preview"></div>
  `;

  openModal({
    id: 'modal-adj', title: 'ADJ-Token einfügen', bodyHTML, width: '480px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildADJToken()); close(); }},
    ],
    onOpen: () => {
      updatePreview('adj-preview', buildADJToken);
      ['adj-lemma','adj-numerus','adj-kasus','adj-genus','adj-art','adj-steigerung'].forEach(id => {
        sel(id)?.addEventListener('change', () => updatePreview('adj-preview', buildADJToken));
      });
    },
  });
}

// ── PRO Dialog ────────────────────────────────────────────────────────────
function buildPROToken() {
  const subtype = sel('pro-subtype')?.value ?? 'pers';
  const person  = sel('pro-person')?.value ?? 'p1';
  const numerus = sel('pro-numerus')?.value ?? 'sgl';
  const kasus   = sel('pro-kasus')?.value ?? 'nom';
  const genus   = sel('pro-genus')?.value ?? 'msk';
  const stem    = sel('pro-stem')?.value ?? '';
  let flags = `|${numerus}|${kasus}`;
  if (['pers','refl','poss'].includes(subtype)) flags = `|${person}` + flags;
  if (['dem','quant'].includes(subtype) && stem) flags += `|${stem}`;
  else if (!['refl'].includes(subtype)) flags += `|${genus}`;
  return `{PRO:${subtype}${flags}}`;
}

export function openPRODialog() {
  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Subtyp', makeSelect('pro-subtype',
          ['pers','refl','poss','dem','rel','quant'],
          ['Personalpronomen','Reflexivpronomen','Possessivpronomen','Demonstrativpronomen','Relativpronomen','Quantorpronomen']
        ))}
      </div>
      <div>${row('Person',  makeSelect('pro-person',  ['p1','p2','p3','p2form'], ['1. Person','2. Person','3. Person','Formell (Sie)']))}</div>
      <div>${row('Numerus', makeSelect('pro-numerus', ['sgl','plu'], ['Singular','Plural']))}</div>
      <div>${row('Kasus',   makeSelect('pro-kasus',   ['nom','gen','dat','akk']))}</div>
      <div>${row('Genus',   makeSelect('pro-genus',   ['msk','fem','neu'], ['Maskulinum','Femininum','Neutrum']))}</div>
      <div style="grid-column:1/-1">${row('Stem (für dem/quant)', `<select class="form-select" id="pro-stem">
        <option value="">—</option>
        <optgroup label="Demonstrativ">
          <option value="dieser">dieser</option><option value="jener">jener</option>
          <option value="derjenige">derjenige</option><option value="derselbe">derselbe</option>
        </optgroup>
        <optgroup label="Quantor">
          <option value="alle">alle</option><option value="beide">beide</option>
          <option value="einige">einige</option><option value="viele">viele</option>
          <option value="wenige">wenige</option><option value="jemand">jemand</option>
          <option value="niemand">niemand</option>
        </optgroup>
      </select>`)}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-pro)" id="pro-preview"></div>
  `;

  openModal({
    id: 'modal-pro', title: 'PRO-Token einfügen', bodyHTML, width: '480px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildPROToken()); close(); }},
    ],
    onOpen: () => {
      updatePreview('pro-preview', buildPROToken);
      ['pro-subtype','pro-person','pro-numerus','pro-kasus','pro-genus','pro-stem'].forEach(id => {
        sel(id)?.addEventListener('change', () => updatePreview('pro-preview', buildPROToken));
      });
    },
  });
}

// ── ART Dialog ────────────────────────────────────────────────────────────
function buildARTToken() {
  const subtype = sel('art-subtype')?.value ?? 'def';
  const numerus = sel('art-numerus')?.value ?? 'sgl';
  const kasus   = sel('art-kasus')?.value ?? 'nom';
  const genus   = sel('art-genus')?.value ?? 'msk';
  const person  = sel('art-person')?.value ?? 'p1';
  const stem    = sel('art-stem')?.value ?? '';
  let flags = `|${numerus}|${kasus}|${genus}`;
  if (subtype === 'poss') flags += `|${person}`;
  if (['dem','quant'].includes(subtype) && stem) flags += `|${stem}`;
  return `{ART:${subtype}${flags}}`;
}

export function openARTDialog() {
  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Subtyp', makeSelect('art-subtype',
          ['def','ind','neg','poss','dem','w','quant'],
          ['bestimmter Artikel','unbestimmter Artikel','negativer Artikel','Possessivartikel','Demonstrativartikel','w-Artikel (welch-)','Quantorartikel']
        ))}
      </div>
      <div>${row('Numerus', makeSelect('art-numerus', ['sgl','plu'], ['Singular','Plural']))}</div>
      <div>${row('Kasus',   makeSelect('art-kasus',   ['nom','gen','dat','akk']))}</div>
      <div>${row('Genus',   makeSelect('art-genus',   ['msk','fem','neu'], ['Maskulinum','Femininum','Neutrum']))}</div>
      <div>${row('Person (für poss)', makeSelect('art-person', ['p1','p2','p3','p2form'], ['p1','p2','p3','formell']))}</div>
      <div style="grid-column:1/-1">${row('Stem (für dem/quant)', `<select class="form-select" id="art-stem">
        <option value="">—</option>
        <optgroup label="Demonstrativ">
          <option value="dieser">dieser</option><option value="jener">jener</option>
          <option value="jeder">jeder</option><option value="mancher">mancher</option>
          <option value="solcher">solcher</option>
        </optgroup>
        <optgroup label="Quantor">
          <option value="alle">alle</option><option value="beide">beide</option>
          <option value="einige">einige</option><option value="viele">viele</option>
          <option value="wenige">wenige</option>
        </optgroup>
      </select>`)}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-art)" id="art-preview"></div>
  `;

  openModal({
    id: 'modal-art', title: 'ART-Token einfügen', bodyHTML, width: '480px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildARTToken()); close(); }},
    ],
    onOpen: () => {
      updatePreview('art-preview', buildARTToken);
      ['art-subtype','art-numerus','art-kasus','art-genus','art-person','art-stem'].forEach(id => {
        sel(id)?.addEventListener('change', () => updatePreview('art-preview', buildARTToken));
      });
    },
  });
}

// ── NAM Dialog ────────────────────────────────────────────────────────────
function buildNAMToken() {
  const subtype = sel('nam-subtype')?.value ?? 'Vorname';
  const idx     = sel('nam-idx')?.value ?? '1';
  const genus   = sel('nam-genus')?.value ?? 'rnd';
  const volk    = sel('nam-volk')?.value ?? 'rnd';
  const region  = sel('nam-region')?.value ?? 'rnd';
  const kasus   = sel('nam-kasus')?.value ?? 'nom';
  const ref     = sel('nam-ref')?.value?.trim() ?? '';
  let flags = `|${genus}|${volk}|${region}|${kasus}`;
  if (ref) flags += `|ref:${ref}`;
  return `{NAM:${subtype}${idx}${flags}}`;
}

export function openNAMDialog() {
  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>${row('Subtyp',  makeSelect('nam-subtype', ['Vorname','Nachname']))}</div>
      <div>${row('Index',   makeSelect('nam-idx',     ['1','2','3']))}</div>
      <div>${row('Genus',   makeSelect('nam-genus',   ['rnd','msk','fem','neu'], ['zufällig','männlich','weiblich','nicht-binär']))}</div>
      <div>${row('Kasus',   makeSelect('nam-kasus',   ['nom','gen','dat','akk']))}</div>
      <div style="grid-column:1/-1">${row('Volk', makeSelect('nam-volk',
        ['rnd','Mensch','Elf','Zwerg','Halbling','Gnom','Halbelf','Halbork','Drachenblütiger','Tiefling'],
        ['zufällig','Mensch','Elf','Zwerg','Halbling','Gnom','Halbelf','Halbork','Drachenblütiger','Tiefling']
      ))}</div>
      <div style="grid-column:1/-1">${row('Region', makeSelect('nam-region',
        ['rnd','germanisch','slawisch','romanisch','skandinavisch','keltisch','griechisch',
         'arabisch','persisch','bantuisch','ägyptisch','meso-amerikanisch','polynesisch','indisch','chinesisch','japanisch'],
        ['zufällig','Germanisch','Slawisch','Romanisch','Skandinavisch','Keltisch','Griechisch',
         'Arabisch','Persisch','Bantuisch','Ägyptisch','Meso-Amerikanisch','Polynesisch','Indisch','Chinesisch','Japanisch']
      ))}</div>
      <div style="grid-column:1/-1">${row('Referenz (ref:)', `<input class="form-input" id="nam-ref" placeholder="z.B. Volk1 — optional" />`)}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-nam)" id="nam-preview"></div>
  `;

  openModal({
    id: 'modal-nam', title: 'NAM-Token einfügen', bodyHTML, width: '520px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildNAMToken()); close(); }},
    ],
    onOpen: () => {
      updatePreview('nam-preview', buildNAMToken);
      ['nam-subtype','nam-idx','nam-genus','nam-volk','nam-region','nam-kasus'].forEach(id => {
        sel(id)?.addEventListener('change', () => updatePreview('nam-preview', buildNAMToken));
      });
      sel('nam-ref')?.addEventListener('input', () => updatePreview('nam-preview', buildNAMToken));
    },
  });
}

// ── COM Dialog ────────────────────────────────────────────────────────────
function buildCOMToken() {
  const lemma   = sel('com-lemma')?.value ?? '';
  const numerus = sel('com-numerus')?.value ?? 'sgl';
  const kasus   = sel('com-kasus')?.value ?? 'nom';
  if (!lemma) return `{COM:?}`;
  return `{COM:${lemma}|${numerus}|${kasus}}`;
}

export function openCOMDialog() {
  const nomenLemmas = [...getNomenLemmas(), ...getAllVariables()];
  const opts = [
    `<optgroup label="Klassen">${nomenLemmas.filter(l => !/[0-9]$/.test(l)).map(l => `<option value="${l}">${l}</option>`).join('')}</optgroup>`,
    `<optgroup label="Variablen">${nomenLemmas.filter(l => /[0-9]$/.test(l)).map(l => `<option value="${l}">${l}</option>`).join('')}</optgroup>`,
  ].join('');

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Lemma', `<select class="form-select" id="com-lemma">${opts}</select>`)}
      </div>
      <div>${row('Numerus', makeSelect('com-numerus', ['sgl','plu'], ['Singular','Plural']))}</div>
      <div>${row('Kasus',   makeSelect('com-kasus',   ['nom','gen','dat','akk']))}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-com)" id="com-preview"></div>
  `;

  openModal({
    id: 'modal-com', title: 'COM-Token einfügen', bodyHTML, width: '440px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildCOMToken()); close(); }},
    ],
    onOpen: () => {
      updatePreview('com-preview', buildCOMToken);
      ['com-lemma', 'com-numerus', 'com-kasus'].forEach(id => {
        sel(id)?.addEventListener('change', () => updatePreview('com-preview', buildCOMToken));
      });
    },
  });
}

// ── FUN Dialog ────────────────────────────────────────────────────────────
function buildFUNToken() {
  const fn       = sel('fun-fn')?.value ?? 'dice';
  const die      = sel('fun-die')?.value ?? 'd6';
  const modifier = (sel('fun-modifier')?.value ?? '').trim();
  const count    = (sel('fun-count')?.value ?? '1').trim();

  if (fn !== 'dice') return `{FUN:${fn}}`;

  // Build die spec: d6 / d20+1 / d8-2
  const dieSpec = modifier && modifier !== '0' && modifier !== '+0' && modifier !== '-0'
    ? `${die}${modifier.startsWith('+') || modifier.startsWith('-') ? modifier : '+' + modifier}`
    : die;

  const countNum = parseInt(count, 10) || 1;
  return countNum > 1 || modifier
    ? `{FUN:dice|${dieSpec}|${countNum}}`
    : `{FUN:dice|${dieSpec}}`;
}

function updateDiceRange() {
  const el = sel('fun-dice-range');
  if (!el) return;
  const die      = sel('fun-die')?.value ?? 'd6';
  const modStr   = (sel('fun-modifier')?.value ?? '').trim();
  const countNum = parseInt(sel('fun-count')?.value ?? '1', 10) || 1;
  const sides    = parseInt(die.slice(1), 10);
  const mod      = parseInt(modStr, 10) || 0;
  el.textContent = `Ergebnisbereich: ${countNum + mod} bis ${countNum * sides + mod}`;
}

export function openFUNDialog() {
  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Funktion', makeSelect('fun-fn',
          ['dice','year','season','month','weekday'],
          ['Würfelwurf (dice)','Jahr (year)','Jahreszeit (season)','Monat (month)','Wochentag (weekday)']
        ))}
      </div>
      <div id="fun-die-wrap">${row('Würfel', makeSelect('fun-die', ['d4','d6','d8','d10','d12','d20']))}</div>
      <div id="fun-modifier-wrap">
        ${row('Modifikator', `<input class="form-input" id="fun-modifier" type="text" placeholder="+1 / -2 / leer" />`)}
        <div style="font-size:10px;color:var(--c-text-dim);margin-top:2px">z.B. +1, -2 (leer = kein Modifikator)</div>
      </div>
      <div id="fun-count-wrap">${row('Anzahl Würfe', `<input class="form-input" id="fun-count" type="number" value="1" min="1" max="20" />`)}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-fun)" id="fun-preview"></div>
    <div id="fun-dice-range" style="margin-top:4px;font-size:11px;color:var(--c-text-dim)"></div>
  `;
  openModal({
    id: 'modal-fun', title: 'FUN-Token einfügen', bodyHTML, width: '440px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildFUNToken()); close(); }},
    ],
    onOpen: () => {
      const refresh = () => {
        updatePreview('fun-preview', buildFUNToken);
        updateDiceRange();
      };
      const toggleDice = () => {
        const isDice = sel('fun-fn')?.value === 'dice';
        ['fun-die-wrap','fun-modifier-wrap','fun-count-wrap','fun-dice-range'].forEach(id => {
          const el = sel(id);
          if (el) el.style.display = isDice ? '' : 'none';
        });
        refresh();
      };
      sel('fun-fn')?.addEventListener('change', toggleDice);
      sel('fun-die')?.addEventListener('change', refresh);
      sel('fun-modifier')?.addEventListener('input', refresh);
      sel('fun-count')?.addEventListener('input', refresh);
      refresh();
    },
  });
}

// ── Router ─────────────────────────────────────────────────────────────────
export function openTokenDialog(type) {
  switch (type) {
    case 'NOM': return openNOMDialog();
    case 'ADJ': return openADJDialog();
    case 'PRO': return openPRODialog();
    case 'ART': return openARTDialog();
    case 'NAM': return openNAMDialog();
    case 'COM': return openCOMDialog();
    case 'FUN': return openFUNDialog();
  }
}

// ── Wire up global event ───────────────────────────────────────────────────
document.addEventListener('editor:open-token-dialog', (e) => {
  openTokenDialog(e.detail?.type);
});
