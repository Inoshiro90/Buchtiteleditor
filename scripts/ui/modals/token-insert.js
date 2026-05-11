// editor/ui/modals/token-insert.js
// Token-Einfügedialog — NOM / ADJ / PRO / ART / NAM / COM / FUN / DEF
//
// Änderung 1: Virtuelle Klassen in Variablenliste eingebunden
// Änderung 2: Nur Variablen (Klasse1…3) in Lemma-Selects — keine reinen Klassennamen mehr

import { openModal } from './modal-base.js';
import { createCombobox } from '../combobox.js';
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

// ── Stem-Konstanten (Zielmodell SlotType-Definitionen) ────────────────────
//
// WARUM ZWEI GETRENNTE SETS:
//   DEM_STEM und QUANT_STEM sind laut Zielmodell strikt disjunkte SlotTypes.
//   Der Validator (slot-schema.js) lehnt DEM_STEM-Werte im QUANT_STEM-Slot ab
//   und umgekehrt. Das UI muss dasselbe Constraint durchsetzen, indem es
//   je nach Subtyp exklusiv die korrekte Optionsliste anzeigt.
//
//   Falsch (alt): Ein gemeinsames <select> mit optgroup Demonstrativ/Quantor
//   → User kann "dieser" für PRO:quant wählen → Validator-Fehler
//
//   Richtig (neu): Optionen werden per rebuildStemSelect() dynamisch ersetzt
//   → nur valide Werte für den jeweiligen Subtyp sind wählbar.

const DEM_STEM_OPTIONS = [
  ['dieser',    'dieser'],
  ['jener',     'jener'],
  ['jeder',     'jeder'],
  ['mancher',   'mancher'],
  ['solcher',   'solcher'],
  ['derjenige', 'derjenige'],
  ['derselbe',  'derselbe'],
];

const QUANT_STEM_OPTIONS = [
  ['alle',   'alle'],
  ['beide',  'beide'],
  ['einige', 'einige'],
  ['manche', 'manche'],
  ['viele',  'viele'],
  ['wenige', 'wenige'],
];

/**
 * Ersetzt die <option>-Elemente eines Stem-<select> strikt anhand des Subtyps.
 *
 * @param {HTMLSelectElement} selectEl  Das <select id="pro-stem"> oder <select id="art-stem">
 * @param {'dem'|'quant'} subtype
 *
 * WARUM NICHT NUR AUSBLENDEN:
 *   Wenn der User "dieser" selektiert hat und dann zu quant wechselt, bleibt
 *   der value="dieser" im DOM. buildPROToken() liest diesen Wert und produziert
 *   {PRO:quant|...|dieser}. Der Validator verwirft das Token.
 *   Durch echtes Ersetzen der Optionen wird der value automatisch auf den
 *   ersten validen Wert zurückgesetzt (Browser-Verhalten bei unbekanntem value).
 */
function rebuildStemSelect(selectEl, subtype) {
  if (!selectEl) return;
  const opts   = subtype === 'quant' ? QUANT_STEM_OPTIONS : DEM_STEM_OPTIONS;
  const prev   = selectEl.value;
  selectEl.innerHTML =
    `<option value="">— kein Stamm —</option>` +
    opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
  // Vorherigen Wert wiederherstellen wenn er noch valide ist, sonst Reset.
  const stillValid = opts.some(([v]) => v === prev);
  selectEl.value = stillValid ? prev : '';
}

// ── Variable list ──────────────────────────────────────────────────────────
/**
 * Änderung 2: Gibt ausschließlich Variablen (Base1, Base2, Base3) zurück —
 * keine reinen Klassennamen. Schließt sowohl Schema-Lemmas als auch
 * virtuelle Klassen (Änderung 1) ein.
 */
function getAllNomenVariables() {
  const schemas   = AppStore.get('schemas') ?? [];
  const vcRaw     = AppStore.get('virtualClassesNomen') ?? '';
  const vcNames   = vcRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const existing  = new Set(schemas.filter(s => s.type === 'nomen').map(s => s.lemma ?? s.id));
  const bases     = [
    ...schemas.filter(s => s.type === 'nomen').map(s => s.lemma ?? s.id),
    ...vcNames.filter(n => !existing.has(n)),
  ];
  return bases.flatMap(base => [1, 2, 3].map(n => `${base}${n}`));
}

function getAllAdjVariables() {
  const schemas  = AppStore.get('schemas') ?? [];
  const vcRaw    = AppStore.get('virtualClassesAdjektive') ?? '';
  const vcNames  = vcRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const existing = new Set(schemas.filter(s => s.type === 'adjektiv').map(s => s.lemma ?? s.id));
  const bases    = [
    ...schemas.filter(s => s.type === 'adjektiv').map(s => s.lemma ?? s.id),
    ...vcNames.filter(n => !existing.has(n)),
  ];
  return bases.flatMap(base => [1, 2, 3].map(n => `${base}${n}`));
}

function getAllDefVariables() {
  const schemas  = AppStore.get('schemas') ?? [];
  const vcRaw    = AppStore.get('virtualClassesDefektiva') ?? '';
  const vcNames  = vcRaw.split('\n').map(s => s.trim()).filter(Boolean);
  const existing = new Set(schemas.filter(s => s.type === 'defektivum').map(s => s.lemma ?? s.id));
  const bases    = [
    ...schemas.filter(s => s.type === 'defektivum').map(s => s.lemma ?? s.id),
    ...vcNames.filter(n => !existing.has(n)),
  ];
  return bases.flatMap(base => [1, 2, 3].map(n => `${base}${n}`));
}

// ── Live preview updater ───────────────────────────────────────────────────
function updatePreview(previewId, getToken) {
  const el = document.getElementById(previewId);
  if (el) el.textContent = getToken();
}

// ── NOM Dialog ─────────────────────────────────────────────────────────────
// Ä2: Numerus kann 'def' sein → Defektiva-Variable bestimmt Numerus
// Ä6: Combobox statt Select für Variable

function buildNOMToken() {
  const lemma     = sel('nom-lemma-hidden')?.value ?? '';
  const numerus   = sel('nom-numerus')?.value ?? 'sgl';
  const kasus     = sel('nom-kasus')?.value ?? 'nom';
  const art       = sel('nom-art')?.value ?? '-';
  const renderArt = sel('nom-render-art')?.checked;

  if (!lemma) return `{NOM:?}`;
  let flags = `|${numerus}|${kasus}`;
  if (art !== '-') flags += `|${art}`;
  if (renderArt) flags += `|art`;
  return `{NOM:${lemma}${flags}}`;
}

export function openNOMDialog() {
  const nomVars = getAllNomenVariables();

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Variable', `<div id="nom-cb-wrap"></div><input type="hidden" id="nom-lemma-hidden" />`)}
      </div>
      <div>${row('Numerus', makeSelect('nom-numerus', ['sgl','plu'], ['Singular','Plural']))}</div>
      <div>${row('Kasus', makeSelect('nom-kasus', ['nom','gen','dat','akk'], ['Nominativ','Genitiv','Dativ','Akkusativ']))}</div>
      <div>${row('Artikel', makeSelect('nom-art', ['-','def','ind','neg'], ['keiner','bestimmt','unbestimmt','negativ']))}</div>
      <div style="display:flex;align-items:center;gap:8px;padding-top:22px;">
        <input type="checkbox" id="nom-render-art" style="accent-color:var(--c-accent)">
        <label for="nom-render-art" style="color:var(--c-text-muted);font-size:12px">Artikel rendern (|art)</label>
      </div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-accent)" id="nom-preview"></div>
  `;

  openModal({
    id: 'modal-nom', title: 'NOM-Token einfügen', bodyHTML, width: '500px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => {
        insertTokenAtCursor(buildNOMToken()); close();
      }},
    ],
    onOpen: (dialog) => {
      const upd = () => updatePreview('nom-preview', buildNOMToken);
      const hidden = dialog.querySelector('#nom-lemma-hidden');
      createCombobox({
        container: dialog.querySelector('#nom-cb-wrap'), items: nomVars,
        value: nomVars[0] ?? '', placeholder: 'Variable suchen…', id: 'nom-cb',
        onChange: v => { hidden.value = v; upd(); },
      });
      hidden.value = nomVars[0] ?? '';
      ['nom-numerus','nom-kasus','nom-art','nom-render-art'].forEach(id => {
        sel(id)?.addEventListener('change', upd);
      });
      upd();
    },
  });
}

// ── ADJ Dialog ────────────────────────────────────────────────────────────
function buildADJToken() {
  const lemma      = sel('adj-lemma')?.value ?? '';
  const numerus    = sel('adj-numerus')?.value ?? 'sgl';
  const defNumVar  = sel('adj-def-num-hidden')?.value ?? '';
  const kasus      = sel('adj-kasus')?.value ?? 'nom';
  const genus      = sel('adj-genus')?.value ?? 'msk';
  const genusVar   = sel('adj-genus-var-hidden')?.value ?? '';
  const art        = sel('adj-art')?.value ?? '-';
  const steigerung = sel('adj-steigerung')?.value ?? 'pos';
  if (!lemma) return `{ADJ:?}`;
  const numPart    = (numerus === 'def' && defNumVar) ? `def:${defNumVar}` : numerus;
  const genusPart  = (genus === 'var' && genusVar)    ? genusVar           : genus;
  return `{ADJ:${lemma}|${numPart}|${kasus}|${genusPart}|${art}|${steigerung}}`;
}

export function openADJDialog() {
  const adjVarsAll = getAllAdjVariables();
  const defVars    = getAllDefVariables();
  // Ä5: Genus-Variablen = Nomen + Defektiva
  const genusVars  = [...getAllNomenVariables(), ...getAllDefVariables()];

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Variable', `<div id="adj-cb-wrap"></div><input type="hidden" id="adj-lemma" />`)}
      </div>

      <!-- P4: Numerus mit Defektivum-Option -->
      <div>${row('Numerus', makeSelect('adj-numerus', ['sgl','plu','def'], ['Singular','Plural','Defektivum (Variable)']))}</div>
      <div id="adj-def-num-wrap" style="display:none">
        ${row('Defektiva-Variable', `<div id="adj-def-num-cb-wrap"></div><input type="hidden" id="adj-def-num-hidden" />`)}
      </div>

      <div>${row('Kasus', makeSelect('adj-kasus', ['nom','gen','dat','akk']))}</div>

      <!-- Ä5: Genus mit Variablen-Option -->
      <div>${row('Genus', makeSelect('adj-genus', ['msk','fem','neu','var'], ['Maskulinum','Femininum','Neutrum','Variable (Nomen/Def)']))}</div>
      <div id="adj-genus-var-wrap" style="display:none">
        ${row('Genus-Variable', `<div id="adj-genus-var-cb-wrap"></div><input type="hidden" id="adj-genus-var-hidden" />`)}
      </div>

      <div>${row('Artikel', makeSelect('adj-art', ['-','def','ind','neg'], ['keiner','bestimmt','unbestimmt','negativ']))}</div>
      <div style="grid-column:1/-1">${row('Steigerung', makeSelect('adj-steigerung', ['pos','kom','sup'], ['Positiv','Komparativ','Superlativ']))}</div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-adj)" id="adj-preview"></div>
  `;

  openModal({
    id: 'modal-adj', title: 'ADJ-Token einfügen', bodyHTML, width: '500px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildADJToken()); close(); }},
    ],
    onOpen: (dialog) => {
      const upd = () => updatePreview('adj-preview', buildADJToken);

      // Variable (Lemma)
      const lemmaHidden = dialog.querySelector('#adj-lemma');
      createCombobox({
        container: dialog.querySelector('#adj-cb-wrap'), items: adjVarsAll,
        value: adjVarsAll[0] ?? '', placeholder: 'Adj-Variable suchen…', id: 'adj-cb',
        onChange: v => { lemmaHidden.value = v; upd(); },
      });
      lemmaHidden.value = adjVarsAll[0] ?? '';

      // P4: Def-Numerus Combobox + Toggle
      const defNumHidden = dialog.querySelector('#adj-def-num-hidden');
      const defNumWrap   = dialog.querySelector('#adj-def-num-wrap');
      createCombobox({
        container: dialog.querySelector('#adj-def-num-cb-wrap'), items: defVars,
        value: defVars[0] ?? '', placeholder: 'Defektiva-Variable…', id: 'adj-def-num-cb',
        onChange: v => { defNumHidden.value = v; upd(); },
      });
      defNumHidden.value = defVars[0] ?? '';

      const numSel = sel('adj-numerus');
      const toggleDefNum = () => {
        const isDef = numSel.value === 'def';
        defNumWrap.style.display    = isDef ? '' : 'none';
        defNumWrap.style.gridColumn = isDef ? '1/-1' : '';
        upd();
      };
      numSel.addEventListener('change', toggleDefNum);

      // Ä5: Genus-Variable Combobox + Toggle
      const genusVarHidden = dialog.querySelector('#adj-genus-var-hidden');
      const genusVarWrap   = dialog.querySelector('#adj-genus-var-wrap');
      createCombobox({
        container: dialog.querySelector('#adj-genus-var-cb-wrap'), items: genusVars,
        value: genusVars[0] ?? '', placeholder: 'Nomen-/Def-Variable…', id: 'adj-genus-var-cb',
        onChange: v => { genusVarHidden.value = v; upd(); },
      });
      genusVarHidden.value = genusVars[0] ?? '';

      const genusSel = sel('adj-genus');
      const toggleGenusVar = () => {
        const isVar = genusSel.value === 'var';
        genusVarWrap.style.display    = isVar ? '' : 'none';
        genusVarWrap.style.gridColumn = isVar ? '1/-1' : '';
        upd();
      };
      genusSel.addEventListener('change', toggleGenusVar);

      ['adj-kasus','adj-art','adj-steigerung'].forEach(id => {
        sel(id)?.addEventListener('change', upd);
      });
      upd();
    },
  });
}

// ── PRO Dialog ─────────────────────────────────────────────────────────────
//
// Erweiterungen:
//   • Numerus-Variable (Defektiva) — wie ADJ
//   • Genus-Variable (Nomen/Defektiva) — wie ADJ
//   • Ziel-Genus + Ziel-Numerus für Possessivpronomen (poss) und pers/p3
//     → beschreibt das Bezugsnomen (z.B. "mein Fahrrad" = Ziel: neu/sgl)
//
// Token-Beispiele:
//   {PRO:pers|p3|sgl|nom|msk}          — er
//   {PRO:poss|p1|sgl|nom|neu|sgl}      — mein (Fahrrad, Neutrum Sg)
//   {PRO:poss|p1|sgl|nom|fem|plu}      — meine (Häute, Femininum Pl)
//   {PRO:poss|p1|sgl|nom|Tier1|def:Gebirge1} — Variable Ziel-Genus + Def-Ziel-Num

function buildPROToken() {
  const subtype   = sel('pro-subtype')?.value ?? 'pers';
  const person    = sel('pro-person')?.value ?? 'p1';
  // Possessor-Numerus
  const numerus   = sel('pro-numerus')?.value ?? 'sgl';
  const defNumVar = sel('pro-def-num-hidden')?.value ?? '';
  const numPart   = (numerus === 'def' && defNumVar) ? `def:${defNumVar}` : numerus;
  const kasus     = sel('pro-kasus')?.value ?? 'nom';
  // Genus (für pers/p3, dem, rel, quant)
  const genus     = sel('pro-genus')?.value ?? 'msk';
  const genusVar  = sel('pro-genus-var-hidden')?.value ?? '';
  // FIX: var:Waffe1 statt Waffe1 — GENUS_EXT erwartet 'var:<Variable>'-Präfix
  const genusPart = (genus === 'var' && genusVar) ? `var:${genusVar}` : genus;
  const stem      = sel('pro-stem')?.value ?? '';
  // Ziel-Genus + Ziel-Numerus (für poss, optional für pers/p3)
  const zGenus    = sel('pro-ziel-genus')?.value ?? 'msk';
  const zGenusVar = sel('pro-ziel-genus-var-hidden')?.value ?? '';
  // FIX: var:-Präfix für Ziel-Genus
  const zGenusPart= (zGenus === 'var' && zGenusVar) ? `var:${zGenusVar}` : zGenus;
  const zNumerus  = sel('pro-ziel-numerus')?.value ?? 'sgl';
  const zDefVar   = sel('pro-ziel-def-hidden')?.value ?? '';
  const zNumPart  = (zNumerus === 'def' && zDefVar) ? `def:${zDefVar}` : zNumerus;

  let flags = `|${numPart}|${kasus}`;
  if (['pers','refl','poss'].includes(subtype)) flags = `|${person}` + flags;

  if (subtype === 'poss') {
    // Possessor-Genus (nur bei p3 relevant: sein- vs. ihr-)
    const possGenUS  = sel('pro-poss-genus')?.value ?? 'msk';
    const possGenVar = sel('pro-poss-genus-var-hidden')?.value ?? '';
    // FIX: var:-Präfix für Possessor-Genus (P3_GENUS erwartet 'var:<Variable>')
    const possGenusPart = (possGenUS === 'var' && possGenVar) ? `var:${possGenVar}` : possGenUS;
    const p3GenusFlag = person === 'p3' ? `|${possGenusPart}` : '';
    // Format: |person|[possessor-genus wenn p3]|possessor-num|kasus|ziel-genus|ziel-num
    flags = `|${person}${p3GenusFlag}|${numPart}|${kasus}|${zGenusPart}|${zNumPart}`;
  } else if (subtype === 'genposs') {
    // Schema: genposs | GENUS_ANT | NUMERUS_ANT — kein Person/Kasus/Genus nötig
    const antGenus = sel('pro-ant-genus')?.value ?? 'msk';
    const antNum   = sel('pro-ant-num')?.value ?? 'sgl';
    flags = `|${antGenus}|${antNum}`;
  } else if (subtype === 'indef') {
    // Schema: indef | INDEF_FORM | KASUS
    const indefForm = sel('pro-indef-form')?.value ?? 'man';
    flags = `|${indefForm}|${kasus}`;
  } else if (subtype === 'int') {
    // Schema: int | INT_FORM | KASUS | [GENUS_EXT wenn welch]
    const intForm = sel('pro-int-form')?.value ?? 'wer';
    flags = `|${intForm}|${kasus}`;
    if (intForm === 'welch') flags += `|${genusPart}`;
  } else if (subtype === 'rez') {
    // Schema: rez | REZ_KASUS (nur dat|akk)
    flags = `|${kasus}`;
  } else if (subtype === 'pers' && person === 'p3') {
    // 3. Person: Genus des Subjekts (nur bei sgl Pflicht, bei plu optional)
    flags = `|${person}|${numPart}|${kasus}|${genusPart}`;
  } else if (subtype === 'dem') {
    // Schema: dem | NUMERUS_EXT | KASUS | GENUS_EXT | DEM_STEM?
    flags = `|${numPart}|${kasus}|${genusPart}`;
    if (stem) flags += `|${stem}`;
  } else if (subtype === 'quant') {
    // Schema: quant | NUMERUS_EXT | KASUS | GENUS_EXT | QUANT_STEM
    // FIX: getrennt von 'dem' — nur QUANT_STEM-Werte sind im Stem-Select verfügbar
    flags = `|${numPart}|${kasus}|${genusPart}`;
    if (stem) flags += `|${stem}`;
  } else if (subtype === 'rel') {
    flags = `|${numPart}|${kasus}|${genusPart}`;
  } else if (subtype === 'refl') {
    flags = `|${person}|${numPart}|${kasus}`;
  } else {
    // pers p1/p2: kein Genus
    flags = `|${person}|${numPart}|${kasus}`;
  }

  return `{PRO:${subtype}${flags}}`;
}

export function openPRODialog() {
  const defVars   = getAllDefVariables();
  const genusVars = [...getAllNomenVariables(), ...getAllDefVariables()];

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Subtyp', makeSelect('pro-subtype',
          ['pers','refl','poss','genposs','dem','rel','quant','indef','int','rez'],
          ['Personalpronomen','Reflexivpronomen','Possessivpronomen','Genitivischer Possessiv (dessen/deren)',
           'Demonstrativpronomen','Relativpronomen','Quantorpronomen',
           'Indefinitpronomen (man/jemand/niemand)','Interrogativpronomen (wer/was/welch)','Reziprokes Pronomen (einander)']
        ))}
      </div>

      <!-- Person (für pers/refl/poss) -->
      <div id="pro-person-wrap">
        ${row('Person', makeSelect('pro-person', ['p1','p2','p3','p2form'], ['1. Person','2. Person','3. Person','Formell (Sie)']))}
      </div>

      <!-- Possessor-Numerus + Variable -->
      <div>${row('Numerus (Possessor)', makeSelect('pro-numerus', ['sgl','plu','def'], ['Singular','Plural','Defektiva (Variable)']))}</div>
      <div id="pro-def-num-wrap" style="display:none">
        ${row('Defektiva-Variable', `<div id="pro-def-num-cb-wrap"></div><input type="hidden" id="pro-def-num-hidden" />`)}
      </div>

      <div>${row('Kasus', makeSelect('pro-kasus', ['nom','gen','dat','akk']))}</div>

      <!-- Genus (für pers/p3, dem, rel) + Variable -->
      <div id="pro-genus-wrap">
        ${row('Genus', makeSelect('pro-genus', ['msk','fem','neu','var'], ['Maskulinum','Femininum','Neutrum','Variable']))}
      </div>
      <div id="pro-genus-var-wrap" style="display:none">
        ${row('Genus-Variable', `<div id="pro-genus-var-cb-wrap"></div><input type="hidden" id="pro-genus-var-hidden" />`)}
      </div>

      <!-- Stem (für dem/quant) -->
      <div id="pro-stem-wrap" style="grid-column:1/-1;display:none">
        ${row('Stamm', `<select class="form-select" id="pro-stem">
          <option value="">— kein Stamm —</option>
        </select>`)}
      </div>

      <!-- Possessor-Genus + Ziel-Genus/Ziel-Numerus (für poss) -->
      <div id="pro-ziel-section" style="grid-column:1/-1;display:none;padding:10px 0 0 0;border-top:1px solid var(--c-border)">
        <!-- Possessor-Genus: nur bei p3 (sein- vs. ihr-) -->
        <div id="pro-poss-genus-section" style="display:none;margin-bottom:10px;padding:8px 12px;
          background:color-mix(in srgb,var(--c-accent) 6%,transparent);
          border:1px solid color-mix(in srgb,var(--c-accent) 20%,transparent);
          border-radius:var(--radius-micro)">
          <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">
            Genus der 3. Person (sein- / ihr-)
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              ${row('Possessor-Genus', makeSelect('pro-poss-genus',
                ['msk','fem','neu','var'],
                ['Maskulinum (sein-)', 'Femininum (ihr-)', 'Neutrum (sein-)', 'Variable']
              ))}
            </div>
            <div id="pro-poss-genus-var-wrap" style="display:none">
              ${row('Genus-Variable', `<div id="pro-poss-genus-var-cb-wrap"></div><input type="hidden" id="pro-poss-genus-var-hidden" />`)}
            </div>
          </div>
        </div>
        <div style="font-size:11px;font-weight:600;color:var(--c-text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Bezugsnomen (das Besessene)</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
          <div>
            ${row('Ziel-Genus', makeSelect('pro-ziel-genus', ['msk','fem','neu','var'], ['Maskulinum','Femininum','Neutrum','Variable']))}
          </div>
          <div id="pro-ziel-genus-var-wrap" style="display:none">
            ${row('Genus-Variable', `<div id="pro-ziel-genus-var-cb-wrap"></div><input type="hidden" id="pro-ziel-genus-var-hidden" />`)}
          </div>
          <div>
            ${row('Ziel-Numerus', makeSelect('pro-ziel-numerus', ['sgl','plu','def'], ['Singular','Plural','Defektiva (Variable)']))}
          </div>
          <div id="pro-ziel-def-wrap" style="display:none">
            ${row('Defektiva-Variable', `<div id="pro-ziel-def-cb-wrap"></div><input type="hidden" id="pro-ziel-def-hidden" />`)}
          </div>
        </div>
      </div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-pro)" id="pro-preview"></div>
  `;

  openModal({
    id: 'modal-pro', title: 'PRO-Token einfügen', bodyHTML, width: '520px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildPROToken()); close(); }},
    ],
    onOpen: (dialog) => {
      const upd = () => updatePreview('pro-preview', buildPROToken);

      // Possessor-Numerus Combobox
      const defNumHidden = dialog.querySelector('#pro-def-num-hidden');
      const defNumWrap   = dialog.querySelector('#pro-def-num-wrap');
      createCombobox({ container: dialog.querySelector('#pro-def-num-cb-wrap'), items: defVars,
        value: defVars[0]??'', placeholder:'Defektiva-Variable…', id:'pro-def-num-cb',
        onChange: v => { defNumHidden.value=v; upd(); } });
      defNumHidden.value = defVars[0] ?? '';

      // Genus-Variable Combobox
      const genusVarHidden = dialog.querySelector('#pro-genus-var-hidden');
      const genusVarWrap   = dialog.querySelector('#pro-genus-var-wrap');
      createCombobox({ container: dialog.querySelector('#pro-genus-var-cb-wrap'), items: genusVars,
        value: genusVars[0]??'', placeholder:'Genus-Variable…', id:'pro-genus-var-cb',
        onChange: v => { genusVarHidden.value=v; upd(); } });
      genusVarHidden.value = genusVars[0] ?? '';

      // Ziel-Genus Combobox
      const zGenusVarHidden = dialog.querySelector('#pro-ziel-genus-var-hidden');
      const zGenusVarWrap   = dialog.querySelector('#pro-ziel-genus-var-wrap');
      createCombobox({ container: dialog.querySelector('#pro-ziel-genus-var-cb-wrap'), items: genusVars,
        value: genusVars[0]??'', placeholder:'Genus-Variable…', id:'pro-ziel-genus-var-cb',
        onChange: v => { zGenusVarHidden.value=v; upd(); } });
      zGenusVarHidden.value = genusVars[0] ?? '';

      // Ziel-Numerus Combobox
      const zDefHidden = dialog.querySelector('#pro-ziel-def-hidden');
      const zDefWrap   = dialog.querySelector('#pro-ziel-def-wrap');
      createCombobox({ container: dialog.querySelector('#pro-ziel-def-cb-wrap'), items: defVars,
        value: defVars[0]??'', placeholder:'Defektiva-Variable…', id:'pro-ziel-def-cb',
        onChange: v => { zDefHidden.value=v; upd(); } });
      zDefHidden.value = defVars[0] ?? '';

      // Possessor-Genus Combobox (für PRO:poss + p3)
      const possGenusVarHidden = dialog.querySelector('#pro-poss-genus-var-hidden');
      const possGenusVarWrap   = dialog.querySelector('#pro-poss-genus-var-wrap');
      createCombobox({ container: dialog.querySelector('#pro-poss-genus-var-cb-wrap'), items: genusVars,
        value: genusVars[0]??'', placeholder:'Genus-Variable…', id:'pro-poss-genus-var-cb',
        onChange: v => { possGenusVarHidden.value=v; upd(); } });
      possGenusVarHidden.value = genusVars[0] ?? '';

      sel('pro-poss-genus')?.addEventListener('change', () => {
        const isVar = sel('pro-poss-genus')?.value === 'var';
        possGenusVarWrap.style.display    = isVar ? '' : 'none';
        possGenusVarWrap.style.gridColumn = isVar ? '1/-1' : '';
        upd();
      });

      // Dynamisches Anzeigen/Verstecken je nach Subtyp + Person
      const adaptToSubtype = () => {
        const sub    = sel('pro-subtype')?.value ?? 'pers';
        const pers   = sel('pro-person')?.value  ?? 'p1';
        const isPoss = sub === 'poss';
        const isRefl = sub === 'refl';
        const needsGenus = !isPoss &&
          ((sub === 'pers' && pers === 'p3') || sub === 'dem' || sub === 'rel' || sub === 'quant');
        const needsStem  = sub === 'dem' || sub === 'quant';
        const isP3poss   = isPoss && pers === 'p3';

        dialog.querySelector('#pro-person-wrap').style.display       = ['pers','refl','poss'].includes(sub) ? '' : 'none';
        dialog.querySelector('#pro-genus-wrap').style.display        = needsGenus ? '' : 'none';
        dialog.querySelector('#pro-stem-wrap').style.display         = needsStem  ? '' : 'none';
        dialog.querySelector('#pro-ziel-section').style.display      = isPoss     ? '' : 'none';
        dialog.querySelector('#pro-poss-genus-section').style.display = isP3poss  ? '' : 'none';

        // Stem-Optionen strikt nach Subtyp neu aufbauen (FIX: verhindert DEM_STEM in quant)
        if (needsStem) {
          rebuildStemSelect(sel('pro-stem'), sub);
        }

        // Genus-Variable Toggle
        const showGenusVar = needsGenus && sel('pro-genus')?.value === 'var';
        genusVarWrap.style.display = showGenusVar ? '' : 'none';
        upd();
      };

      sel('pro-subtype')?.addEventListener('change', adaptToSubtype);
      sel('pro-person')?.addEventListener('change', adaptToSubtype);

      sel('pro-numerus')?.addEventListener('change', () => {
        defNumWrap.style.display = sel('pro-numerus')?.value === 'def' ? '' : 'none';
        defNumWrap.style.gridColumn = sel('pro-numerus')?.value === 'def' ? '1/-1' : '';
        upd();
      });
      sel('pro-genus')?.addEventListener('change', () => {
        genusVarWrap.style.display = sel('pro-genus')?.value === 'var' ? '' : 'none';
        genusVarWrap.style.gridColumn = sel('pro-genus')?.value === 'var' ? '1/-1' : '';
        upd();
      });
      sel('pro-ziel-genus')?.addEventListener('change', () => {
        zGenusVarWrap.style.display = sel('pro-ziel-genus')?.value === 'var' ? '' : 'none';
        upd();
      });
      sel('pro-ziel-numerus')?.addEventListener('change', () => {
        zDefWrap.style.display = sel('pro-ziel-numerus')?.value === 'def' ? '' : 'none';
        upd();
      });
      ['pro-kasus','pro-stem'].forEach(id => sel(id)?.addEventListener('change', upd));

      adaptToSubtype();
      upd();
    },
  });
}

// ── ART Dialog ─────────────────────────────────────────────────────────────
// Erweiterungen: Numerus-Variable (Defektiva) + Genus-Variable (Nomen/Defektiva)

// ── ART Dialog ─────────────────────────────────────────────────────────────
//
// Token-Format Possessivartikel:
//   {ART:poss|<Possessor-Num>|<Kasus>|<Ziel-Genus>|<Person>}
//
// Erklärung der Flags bei poss:
//   Possessor-Numerus: Numerus der Person, der etwas gehört (sg/pl/def)
//   Kasus:             Kasus des Artikels im Satz
//   Ziel-Genus:        Genus des besessenen Nomens (msk/fem/neu/Variable)
//   Person:            Wem gehört es (p1/p2/p3/p2form)
//
// Beispiele:
//   {ART:poss|sgl|nom|neu|p1}      → mein (Fahrrad, neu, Singular-Besitzer)
//   {ART:poss|sgl|nom|fem|p1}      → meine (Tasche, fem)
//   {ART:poss|sgl|nom|Tier1|p1}    → Ziel-Genus via Variable
//
// Für andere Subtypen (def/ind/neg/dem/w/quant):
//   {ART:def|sgl|nom|msk}
//   {ART:dem|sgl|nom|msk|dieser}

// ── ART Token-Builder ──────────────────────────────────────────────────────
//
// Für ALLE non-poss Subtypen:
//   {ART:def|<poss-num>|<kasus>|<ziel-genus>}
//   (numPart = Numerus des Nomens, genusPart = Genus des Nomens)
//
// Für POSS — vollständig parallel zu PRO:poss:
//   {ART:poss|<person>|[<poss-genus> wenn p3]|<poss-num>|<kasus>|<ziel-genus>|<ziel-num>}
//
// Beispiele:
//   mein Fahrrad (p1, sg, nom, Ziel=neu sg):
//     {ART:poss|p1|sgl|nom|neu|sgl}
//   ihr Buch (p3+fem, sg, nom, Ziel=neu sg):
//     {ART:poss|p3|fem|sgl|nom|neu|sgl}
//   ihre Häute (p3+fem, sg, nom, Ziel=fem pl):
//     {ART:poss|p3|fem|sgl|nom|fem|plu}

function buildARTToken() {
  const subtype = sel('art-subtype')?.value ?? 'def';
  const kasus   = sel('art-kasus')?.value ?? 'nom';

  // Ziel-Genus (gilt für alle non-poss non-genposs Subtypen)
  const genus    = sel('art-genus')?.value ?? 'msk';
  const genusVar = sel('art-genus-var-hidden')?.value ?? '';
  // FIX: var:-Präfix — GENUS_EXT erwartet 'var:<Variable>', nicht bare 'Waffe1'
  const genusPart = (genus === 'var' && genusVar) ? `var:${genusVar}` : genus;

  if (subtype === 'poss') {
    const person = sel('art-person')?.value ?? 'p1';
    const possGenUS  = sel('art-poss-genus')?.value ?? 'msk';
    const possGenVar = sel('art-poss-genus-var-hidden')?.value ?? '';
    // FIX: var:-Präfix für Possessor-Genus (P3_GENUS)
    const possPart   = (possGenUS === 'var' && possGenVar) ? `var:${possGenVar}` : possGenUS;
    const p3Flag     = (person === 'p3') ? `|${possPart}` : '';
    const possNum    = sel('art-poss-num')?.value ?? 'sgl';
    const possNumVar = sel('art-poss-num-var-hidden')?.value ?? '';
    const possNumPart = (possNum === 'def' && possNumVar) ? `def:${possNumVar}` : possNum;
    const zNum    = sel('art-ziel-num')?.value ?? 'sgl';
    const zNumVar = sel('art-ziel-num-var-hidden')?.value ?? '';
    const zNumPart = (zNum === 'def' && zNumVar) ? `def:${zNumVar}` : zNum;
    return `{ART:poss|${person}${p3Flag}|${possNumPart}|${kasus}|${genusPart}|${zNumPart}}`;
  }

  if (subtype === 'genposs') {
    // Schema: genposs | GENUS_ANT | NUMERUS_ANT
    const antGenus = sel('art-ant-genus')?.value ?? 'msk';
    const antNum   = sel('art-ant-num')?.value ?? 'sgl';
    return `{ART:genposs|${antGenus}|${antNum}}`;
  }

  // Non-poss/non-genposs: Numerus + Kasus + Genus des Nomens
  const numerus   = sel('art-numerus')?.value ?? 'sgl';
  const defNumVar = sel('art-def-num-hidden')?.value ?? '';
  const numPart   = (numerus === 'def' && defNumVar) ? `def:${defNumVar}` : numerus;
  const stem      = sel('art-stem')?.value ?? '';

  let flags = `|${numPart}|${kasus}|${genusPart}`;
  if ((subtype === 'dem' || subtype === 'quant') && stem) flags += `|${stem}`;
  return `{ART:${subtype}${flags}}`;
}

export function openARTDialog() {
  const defVars   = getAllDefVariables();
  const genusVars = [...getAllNomenVariables(), ...getAllDefVariables()];

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Subtyp', makeSelect('art-subtype',
          ['def','ind','zero','neg','poss','genposs','dem','w','quant'],
          ['bestimmter Artikel','unbestimmter Artikel','Null-Artikel (∅)','negativer Artikel',
           'Possessivartikel','Genitivischer Possessiv (dessen/deren)',
           'Demonstrativartikel','w-Artikel (welch-)','Quantorartikel']
        ))}
      </div>

      <!-- ─── Non-poss Felder (def/ind/neg/dem/w/quant) ─────────────────── -->
      <div id="art-nonpro-fields" style="display:contents">
        <div>${row('Numerus', makeSelect('art-numerus', ['sgl','plu','def'], ['Singular','Plural','Defektiva (Variable)']))}</div>
        <div id="art-def-num-wrap" style="display:none">
          ${row('Defektiva-Variable', `<div id="art-def-num-cb-wrap"></div><input type="hidden" id="art-def-num-hidden" />`)}
        </div>
        <div>${row('Kasus', makeSelect('art-kasus', ['nom','gen','dat','akk']))}</div>
        <div id="art-genus-wrap">
          ${row('Genus', makeSelect('art-genus', ['msk','fem','neu','var'], ['Maskulinum','Femininum','Neutrum','Variable']))}
        </div>
        <div id="art-genus-var-wrap" style="display:none">
          ${row('Genus-Variable', `<div id="art-genus-var-cb-wrap"></div><input type="hidden" id="art-genus-var-hidden" />`)}
        </div>
        <div id="art-stem-wrap" style="grid-column:1/-1;display:none">
          ${row('Stamm', `<select class="form-select" id="art-stem">
            <option value="">— kein Stamm —</option>
          </select>`)}
        </div>
      </div>

      <!-- ─── Poss-Felder (parallel zu PRO:poss) ─────────────────────────
           Format: person|[poss-genus wenn p3]|poss-num|kasus|ziel-genus|ziel-num
      ─────────────────────────────────────────────────────────────────────── -->
      <div id="art-poss-fields" style="display:none;grid-column:1/-1">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

          <!-- Possessor-Sektion -->
          <div style="grid-column:1/-1;font-size:11px;font-weight:600;color:var(--c-text-muted);
            text-transform:uppercase;letter-spacing:.06em;padding-top:2px">
            Possessor (wer besitzt)
          </div>
          <div>
            ${row('Person', makeSelect('art-person', ['p1','p2','p3','p2form'],
              ['1. Person (mein-)', '2. Person (dein-)', '3. Person (sein-/ihr-)', 'Formell (Ihr-)']))}
          </div>
          <div id="art-poss-genus-outer" style="display:none">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
              <div>
                ${row('Possessor-Genus', makeSelect('art-poss-genus',
                  ['msk','fem','neu','var'],
                  ['Maskulinum (sein-)', 'Femininum (ihr-)', 'Neutrum (sein-)', 'Variable']
                ))}
              </div>
              <div id="art-poss-genus-var-inner" style="display:none">
                ${row('Genus-Variable', `<div id="art-poss-genus-var-cb-wrap"></div><input type="hidden" id="art-poss-genus-var-hidden" />`)}
              </div>
            </div>
          </div>
          <div>
            ${row('Possessor-Numerus', makeSelect('art-poss-num', ['sgl','plu','def'], ['Singular','Plural','Defektiva (Variable)']))}
          </div>
          <div id="art-poss-num-var-wrap" style="display:none">
            ${row('Defektiva-Variable', `<div id="art-poss-num-var-cb-wrap"></div><input type="hidden" id="art-poss-num-var-hidden" />`)}
          </div>

          <!-- Ziel-Sektion -->
          <div style="grid-column:1/-1;font-size:11px;font-weight:600;color:var(--c-text-muted);
            text-transform:uppercase;letter-spacing:.06em;padding-top:8px;
            border-top:1px solid var(--c-border);margin-top:4px">
            Ziel-Nomen (was wird besessen)
          </div>
          <div>
            ${row('Kasus', makeSelect('art-kasus', ['nom','gen','dat','akk']))}
          </div>
          <div>
            ${row('Ziel-Genus', makeSelect('art-genus', ['msk','fem','neu','var'],
              ['Maskulinum', 'Femininum', 'Neutrum', 'Variable']))}
          </div>
          <div id="art-genus-var-wrap" style="display:none">
            ${row('Genus-Variable', `<div id="art-genus-var-cb-wrap"></div><input type="hidden" id="art-genus-var-hidden" />`)}
          </div>
          <div>
            ${row('Ziel-Numerus', makeSelect('art-ziel-num', ['sgl','plu','def'], ['Singular','Plural','Defektiva (Variable)']))}
          </div>
          <div id="art-ziel-num-var-wrap" style="display:none">
            ${row('Defektiva-Variable', `<div id="art-ziel-num-var-cb-wrap"></div><input type="hidden" id="art-ziel-num-var-hidden" />`)}
          </div>
        </div>
      </div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-art)" id="art-preview"></div>
  `;

  openModal({
    id: 'modal-art', title: 'ART-Token einfügen', bodyHTML, width: '500px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen',  cls: 'btn-primary',   action: (close) => { insertTokenAtCursor(buildARTToken()); close(); } },
    ],
    onOpen: (dialog) => {
      const upd = () => updatePreview('art-preview', buildARTToken);
      const q   = id => dialog.querySelector(`#${id}`);

      // ── Non-poss Comboboxen ──────────────────────────────────────────────

      // Defektiva-Numerus (non-poss)
      const defNumH = q('art-def-num-hidden');
      createCombobox({ container: q('art-def-num-cb-wrap'), items: defVars,
        value: defVars[0]??'', placeholder:'Defektiva-Variable…', id:'art-def-num-cb',
        onChange: v => { defNumH.value=v; upd(); } });
      defNumH.value = defVars[0] ?? '';

      // Genus-Variable (non-poss & poss Ziel-Genus)
      const genVarH = q('art-genus-var-hidden');
      createCombobox({ container: q('art-genus-var-cb-wrap'), items: genusVars,
        value: genusVars[0]??'', placeholder:'Genus-Variable…', id:'art-genus-var-cb',
        onChange: v => { genVarH.value=v; upd(); } });
      genVarH.value = genusVars[0] ?? '';

      // ── Poss-Comboboxen ──────────────────────────────────────────────────

      // Possessor-Genus (poss + p3)
      const possGenH = q('art-poss-genus-var-hidden');
      createCombobox({ container: q('art-poss-genus-var-cb-wrap'), items: genusVars,
        value: genusVars[0]??'', placeholder:'Genus-Variable…', id:'art-poss-genus-var-cb',
        onChange: v => { possGenH.value=v; upd(); } });
      possGenH.value = genusVars[0] ?? '';

      // Possessor-Numerus Variable
      const possNumVarH = q('art-poss-num-var-hidden');
      createCombobox({ container: q('art-poss-num-var-cb-wrap'), items: defVars,
        value: defVars[0]??'', placeholder:'Defektiva-Variable…', id:'art-poss-num-var-cb',
        onChange: v => { possNumVarH.value=v; upd(); } });
      possNumVarH.value = defVars[0] ?? '';

      // Ziel-Numerus Variable
      const zNumVarH = q('art-ziel-num-var-hidden');
      createCombobox({ container: q('art-ziel-num-var-cb-wrap'), items: defVars,
        value: defVars[0]??'', placeholder:'Defektiva-Variable…', id:'art-ziel-num-var-cb',
        onChange: v => { zNumVarH.value=v; upd(); } });
      zNumVarH.value = defVars[0] ?? '';

      // ── Toggle-Handler ────────────────────────────────────────────────────

      // Subtyp → poss vs. non-poss Felder
      const adaptToSubtype = () => {
        const sub      = sel('art-subtype')?.value ?? 'def';
        const isPoss   = sub === 'poss';
        const isGenPos = sub === 'genposs';
        const isStem   = sub === 'dem' || sub === 'quant';

        // genposs hat eigene Felder (ant_genus + ant_num), keine Standardfelder
        q('art-nonpro-fields').style.display  = (isPoss || isGenPos) ? 'none' : 'contents';
        q('art-poss-fields').style.display    = isPoss    ? ''   : 'none';
        q('art-genposs-fields') && (q('art-genposs-fields').style.display = isGenPos ? '' : 'none');
        if (!isPoss && !isGenPos) {
          q('art-stem-wrap').style.display = isStem ? '' : 'none';
          if (isStem) rebuildStemSelect(sel('art-stem'), sub);
        }
        upd();
      };

      // p3 → Possessor-Genus sichtbar
      const adaptPerson = () => {
        const isP3 = sel('art-person')?.value === 'p3';
        q('art-poss-genus-outer').style.display = isP3 ? '' : 'none';
        upd();
      };

      // Poss-Genus Variable Toggle
      sel('art-poss-genus')?.addEventListener('change', () => {
        q('art-poss-genus-var-inner').style.display =
          sel('art-poss-genus')?.value === 'var' ? '' : 'none';
        upd();
      });

      // Poss-Num Variable Toggle
      sel('art-poss-num')?.addEventListener('change', () => {
        q('art-poss-num-var-wrap').style.display =
          sel('art-poss-num')?.value === 'def' ? '' : 'none';
        upd();
      });

      // Ziel-Genus Variable Toggle
      sel('art-genus')?.addEventListener('change', () => {
        q('art-genus-var-wrap').style.display =
          sel('art-genus')?.value === 'var' ? '' : 'none';
        upd();
      });

      // Ziel-Num Variable Toggle
      sel('art-ziel-num')?.addEventListener('change', () => {
        q('art-ziel-num-var-wrap').style.display =
          sel('art-ziel-num')?.value === 'def' ? '' : 'none';
        upd();
      });

      // Non-poss Numerus Variable Toggle
      sel('art-numerus')?.addEventListener('change', () => {
        const isDef = sel('art-numerus')?.value === 'def';
        q('art-def-num-wrap').style.display    = isDef ? '' : 'none';
        q('art-def-num-wrap').style.gridColumn = isDef ? '1/-1' : '';
        upd();
      });

      sel('art-subtype')?.addEventListener('change', adaptToSubtype);
      sel('art-person')?.addEventListener('change',  adaptPerson);
      ['art-kasus','art-stem'].forEach(id => sel(id)?.addEventListener('change', upd));

      // Initial
      adaptToSubtype();
      adaptPerson();
      upd();
    },
  });
}

// ── NAM Dialog ─────────────────────────────────────────────────────────────
//
// Erweiterungen:
//   • Genus-Variable: Statt festen Genus kann eine NAM-Variable referenziert
//     werden (ref:Vorname1) → Genus wird vom referenzierten Token geerbt
//   • Volk-Variable: ebenso per Combobox wählbar
//   • Region-Variable: ebenso per Combobox wählbar
//
// Wenn ein Feld auf "Variable (ref:)" gestellt ist, wird das Feld in der
// Flag-Liste durch "ref:VariablenName" ersetzt.
//
// Beispiele:
//   {NAM:Nachname1|rnd|rnd|rnd|nom|ref:Vorname1}
//   → Nachname erbt Genus, Volk, Region von Vorname1
//
//   Einzelne Felder per ref: sind aktuell nicht im DSL-Standard —
//   es wird die globale ref: Syntax (alle drei Felder) verwendet.

// NAM-Variablen für Referenz-Comboboxen
function getAllNAMVariables() {
  return ['Vorname1','Vorname2','Vorname3','Nachname1','Nachname2','Nachname3'];
}

function buildNAMToken() {
  const subtype = sel('nam-subtype')?.value ?? 'Vorname';
  const idx     = sel('nam-idx')?.value ?? '1';
  const kasus   = sel('nam-kasus')?.value ?? 'nom';

  // Genus
  const genusMode = sel('nam-genus-mode')?.value ?? 'fixed';
  const genusFix  = sel('nam-genus-fixed')?.value ?? 'rnd';
  const genusRef  = sel('nam-genus-ref-hidden')?.value ?? '';
  const genus     = genusMode === 'ref' && genusRef ? genusRef : genusFix;

  // Volk
  const volkMode  = sel('nam-volk-mode')?.value ?? 'fixed';
  const volkFix   = sel('nam-volk-fixed')?.value ?? 'rnd';
  const volkRef   = sel('nam-volk-ref-hidden')?.value ?? '';
  const volk      = volkMode === 'ref' && volkRef ? volkRef : volkFix;

  // Region
  const regionMode = sel('nam-region-mode')?.value ?? 'fixed';
  const regionFix  = sel('nam-region-fixed')?.value ?? 'rnd';
  const regionRef  = sel('nam-region-ref-hidden')?.value ?? '';
  const region     = regionMode === 'ref' && regionRef ? regionRef : regionFix;

  // Wenn alle drei auf dieselbe Referenz zeigen → kompakte ref:-Syntax
  const allSameRef = genusMode === 'ref' && volkMode === 'ref' && regionMode === 'ref'
    && genusRef === volkRef && genusRef === regionRef;

  let flags;
  if (allSameRef && genusRef) {
    // Kompakt: rnd|rnd|rnd|kasus|ref:Vorname1
    flags = `|rnd|rnd|rnd|${kasus}|ref:${genusRef}`;
  } else {
    // Einzelne Werte — ref: wird nur gesetzt wenn alle gleich (sonst feste Werte)
    const gPart = genusMode === 'ref' && genusRef ? `ref:${genusRef}` : genus;
    const vPart = volkMode  === 'ref' && volkRef  ? `ref:${volkRef}`  : volk;
    const rPart = regionMode=== 'ref' && regionRef? `ref:${regionRef}`: region;
    flags = `|${gPart}|${vPart}|${rPart}|${kasus}`;
  }

  return `{NAM:${subtype}${idx}${flags}}`;
}

function makeNAMFieldRow(label, modeId, fixedId, fixedOpts, fixedLabels, refWrapId, refCbId, refHiddenId) {
  return `
    <div style="grid-column:1/-1">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span class="form-label" style="margin:0;min-width:60px">${label}</span>
        ${makeSelect(modeId, ['fixed','ref'], ['Fester Wert','Variable (ref:)'])}
      </div>
      <div id="${refWrapId}-fixed">
        ${makeSelect(fixedId, fixedOpts, fixedLabels)}
      </div>
      <div id="${refWrapId}" style="display:none">
        <div id="${refCbId}-wrap"></div>
        <input type="hidden" id="${refHiddenId}" />
      </div>
    </div>
  `;
}

export function openNAMDialog() {
  const namVars = getAllNAMVariables();

  const VOLK_OPTS   = ['rnd','Mensch','Elf','Zwerg','Halbling','Gnom','Halbelf','Halbork','Drachenblütiger','Tiefling'];
  const VOLK_LABELS = ['zufällig','Mensch','Elf','Zwerg','Halbling','Gnom','Halbelf','Halbork','Drachenblütiger','Tiefling'];
  const REG_OPTS    = ['rnd','germanisch','slawisch','romanisch','skandinavisch','keltisch','griechisch',
                       'arabisch','persisch','bantuisch','ägyptisch','meso-amerikanisch','polynesisch','indisch','chinesisch','japanisch'];
  const REG_LABELS  = ['zufällig','Germanisch','Slawisch','Romanisch','Skandinavisch','Keltisch','Griechisch',
                       'Arabisch','Persisch','Bantuisch','Ägyptisch','Meso-Amerikanisch','Polynesisch','Indisch','Chinesisch','Japanisch'];

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div>${row('Subtyp', makeSelect('nam-subtype', ['Vorname','Nachname']))}</div>
      <div>${row('Index',  makeSelect('nam-idx', ['1','2','3']))}</div>
      <div>${row('Kasus',  makeSelect('nam-kasus', ['nom','gen','dat','akk']))}</div>
      <div></div>

      ${makeNAMFieldRow(
        'Genus',
        'nam-genus-mode',
        'nam-genus-fixed', ['rnd','msk','fem','neu'], ['zufällig','männlich','weiblich','nicht-binär'],
        'nam-genus-ref-section', 'nam-genus-ref-cb', 'nam-genus-ref-hidden'
      )}
      ${makeNAMFieldRow(
        'Volk',
        'nam-volk-mode',
        'nam-volk-fixed', VOLK_OPTS, VOLK_LABELS,
        'nam-volk-ref-section', 'nam-volk-ref-cb', 'nam-volk-ref-hidden'
      )}
      ${makeNAMFieldRow(
        'Region',
        'nam-region-mode',
        'nam-region-fixed', REG_OPTS, REG_LABELS,
        'nam-region-ref-section', 'nam-region-ref-cb', 'nam-region-ref-hidden'
      )}
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-dsl-nam)" id="nam-preview"></div>
  `;

  openModal({
    id: 'modal-nam', title: 'NAM-Token einfügen', bodyHTML, width: '520px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildNAMToken()); close(); }},
    ],
    onOpen: (dialog) => {
      const upd = () => updatePreview('nam-preview', buildNAMToken);

      // Comboboxen für Genus-Ref / Volk-Ref / Region-Ref
      const fields = [
        { modeId: 'nam-genus-mode',  fixedId: 'nam-genus-fixed',
          sectionId: 'nam-genus-ref-section',  cbWrapId: 'nam-genus-ref-cb-wrap',
          hiddenId: 'nam-genus-ref-hidden',     cbId: 'nam-genus-ref-cb' },
        { modeId: 'nam-volk-mode',   fixedId: 'nam-volk-fixed',
          sectionId: 'nam-volk-ref-section',   cbWrapId: 'nam-volk-ref-cb-wrap',
          hiddenId: 'nam-volk-ref-hidden',      cbId: 'nam-volk-ref-cb' },
        { modeId: 'nam-region-mode', fixedId: 'nam-region-fixed',
          sectionId: 'nam-region-ref-section', cbWrapId: 'nam-region-ref-cb-wrap',
          hiddenId: 'nam-region-ref-hidden',    cbId: 'nam-region-ref-cb' },
      ];

      for (const f of fields) {
        const hidden  = dialog.querySelector(`#${f.hiddenId}`);
        const section = dialog.querySelector(`#${f.sectionId}`);
        const fixedEl = dialog.querySelector(`#${f.sectionId}-fixed`);

        createCombobox({
          container: dialog.querySelector(`#${f.cbWrapId}`),
          items: namVars,
          value: namVars[0] ?? '',
          placeholder: 'NAM-Variable (z.B. Vorname1)…',
          id: f.cbId,
          onChange: v => { hidden.value = v; upd(); },
        });
        hidden.value = namVars[0] ?? '';

        const modeSel = dialog.querySelector(`#${f.modeId}`);
        modeSel?.addEventListener('change', () => {
          const isRef = modeSel.value === 'ref';
          section.style.display  = isRef ? '' : 'none';
          fixedEl.style.display  = isRef ? 'none' : '';
          upd();
        });
      }

      ['nam-subtype','nam-idx','nam-kasus',
       'nam-genus-fixed','nam-volk-fixed','nam-region-fixed'].forEach(id => {
        sel(id)?.addEventListener('change', upd);
      });
      upd();
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
  // Änderung 2: Nur Variablen
  const variables = getAllNomenVariables();

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Variable', `<div id="com-cb-wrap"></div><input type="hidden" id="com-lemma" />`)}
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
    onOpen: (dialog) => {
      const upd = () => updatePreview('com-preview', buildCOMToken);
      const comVariables = getAllNomenVariables();
      const hidden = dialog.querySelector('#com-lemma');
      createCombobox({
        container: dialog.querySelector('#com-cb-wrap'), items: comVariables,
        value: comVariables[0] ?? '', placeholder: 'Variable suchen…', id: 'com-cb',
        onChange: v => { hidden.value = v; upd(); },
      });
      hidden.value = comVariables[0] ?? '';
      ['com-numerus','com-kasus'].forEach(id => {
        sel(id)?.addEventListener('change', upd);
      });
      upd();
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

// ── DEF Dialog ────────────────────────────────────────────────────────────
function buildDEFToken() {
  const lemma     = sel('def-lemma')?.value ?? '';
  const kasus     = sel('def-kasus')?.value ?? 'nom';
  const art       = sel('def-art')?.value ?? '-';
  const renderArt = sel('def-render-art')?.checked;
  if (!lemma) return `{DEF:?}`;
  let flags = `|${kasus}`;
  if (art !== '-') flags += `|${art}`;
  if (renderArt) flags += `|art`;
  return `{DEF:${lemma}${flags}}`;
}

export function openDEFDialog() {
  // Änderung 2: Nur Variablen für DEF
  const variables = getAllDefVariables();

  const bodyHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
      <div style="grid-column:1/-1">
        ${row('Variable',
          `<div id="def-cb-wrap"></div><input type="hidden" id="def-lemma" />`
        )}
      </div>
      <div>${row('Kasus', makeSelect('def-kasus', ['nom','gen','dat','akk']))}</div>
      <div>${row('Artikel', makeSelect('def-art', ['-','def','ind','neg'], ['keiner','bestimmt','unbestimmt','negativ']))}</div>
      <div style="display:flex;align-items:center;gap:8px;padding-top:22px;">
        <input type="checkbox" id="def-render-art">
        <label for="def-render-art">Artikel rendern (|art)</label>
      </div>
    </div>
    <div style="margin-top:16px;padding:10px 14px;background:var(--c-surface-3);border-radius:var(--radius);font-family:var(--font-mono);font-size:13px;color:var(--c-accent)" id="def-preview"></div>
  `;

  openModal({
    id: 'modal-def', title: 'DEF-Token einfügen', bodyHTML, width: '480px',
    buttons: [
      { label: 'Abbrechen', cls: 'btn-secondary', action: 'close' },
      { label: 'Einfügen', cls: 'btn-primary', action: (close) => { insertTokenAtCursor(buildDEFToken()); close(); }},
    ],
    onOpen: (dialog) => {
      const upd = () => updatePreview('def-preview', buildDEFToken);
      const defVariables = getAllDefVariables();
      const hidden = dialog.querySelector('#def-lemma');
      createCombobox({
        container: dialog.querySelector('#def-cb-wrap'), items: defVariables,
        value: defVariables[0] ?? '', placeholder: 'Defektiva-Variable…', id: 'def-cb',
        onChange: v => { hidden.value = v; upd(); },
      });
      hidden.value = defVariables[0] ?? '';
      ['def-kasus','def-art','def-render-art'].forEach(id => {
        sel(id)?.addEventListener('change', upd);
      });
      upd();
    },
  });
}

// ── Router ─────────────────────────────────────────────────────────────────
export function openTokenDialog(type) {
  switch (type) {
    case 'NOM': return openNOMDialog();
    case 'DEF': return openDEFDialog();
    case 'ADJ': return openADJDialog();
    case 'PRO': return openPRODialog();
    case 'ART': return openARTDialog();
    case 'NAM': return openNAMDialog();
    case 'COM': return openCOMDialog();
    case 'FUN': return openFUNDialog();
  }
}

document.addEventListener('editor:open-token-dialog', (e) => {
  openTokenDialog(e.detail?.type);
});
