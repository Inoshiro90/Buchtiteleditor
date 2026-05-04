// editor/services/dsl-validator.js
// Tokenizer extracted from core/engine.js + strict per-type flag validation

// ── Per-type allowed flag sets ─────────────────────────────────────────────
const VALID_TYPES = new Set(['NOM', 'ADJ', 'ART', 'PRO', 'COM', 'NAM', 'FUN', 'DEF']);

// Shared building blocks
const F_NUMERUS   = new Set(['sgl', 'plu']);
const F_KASUS     = new Set(['nom', 'gen', 'dat', 'akk']);
const F_GENUS     = new Set(['msk', 'fem', 'neu', 'mas']);  // mas = alias for msk
const F_PERSON    = new Set(['p1', 'p2', 'p3', 'p2form']);
const F_ARTIKEL   = new Set(['def', 'ind', 'indef', 'neg', '-']);
const F_STEIGER   = new Set(['pos', 'kom', 'sup']);
const F_META      = new Set(['tags', 'genus', 'art', 'auto', 'rnd']);

const F_DEM_STEMS = new Set([
  'dieser','jener','jeder','mancher','solcher','derjenige','derselbe',
]);
const F_QUANT_STEMS = new Set([
  'alle','beide','einige','manche','viele','wenige','jemand','niemand',
]);
const F_NAM_VOLK = new Set([
  'Mensch','Elf','Zwerg','Halbling','Gnom','Halbelf','Halbork',
  'Drachenblütiger','Tiefling','rnd',
]);
const F_NAM_REGION = new Set([
  'germanisch','slawisch','romanisch','skandinavisch','keltisch','griechisch',
  'arabisch','persisch','bantuisch','ägyptisch','meso-amerikanisch',
  'polynesisch','indisch','chinesisch','japanisch','rnd',
]);
const F_DICE = new Set(['d4','d6','d8','d10','d12','d20']);
const F_PRO_SUB  = new Set(['pers','refl','poss','dem','rel','quant']);
const F_ART_SUB  = new Set(['def','ind','neg','poss','dem','w','quant']);

// Allowed flags per token type (union of all valid flag values for that type)
const TYPE_FLAGS = {
  NOM: new Set([...F_NUMERUS, ...F_KASUS, ...F_ARTIKEL, ...F_META]),
  ADJ: new Set([...F_NUMERUS, ...F_KASUS, ...F_GENUS, ...F_ARTIKEL, ...F_STEIGER, ...F_META]),
  ART: new Set([...F_ART_SUB, ...F_NUMERUS, ...F_KASUS, ...F_GENUS, ...F_PERSON, ...F_DEM_STEMS, ...F_QUANT_STEMS, ...F_META]),
  PRO: new Set([...F_PRO_SUB, ...F_PERSON, ...F_NUMERUS, ...F_KASUS, ...F_GENUS, ...F_DEM_STEMS, ...F_QUANT_STEMS, ...F_META]),
  COM: new Set([...F_NUMERUS, ...F_KASUS, ...F_META]),
  NAM: new Set([...F_GENUS, ...F_KASUS, ...F_META, ...F_NAM_VOLK, ...F_NAM_REGION]),
  FUN: new Set([...F_DICE, ...F_META]),  // die+modifier and counts validated separately
  DEF: new Set([...F_KASUS, ...F_ARTIKEL, ...F_META, ...F_NUMERUS]), // Defektivum
};

// Variable pattern: Uppercase start, letters, ends with digit(s) — e.g. "Volk1"
const VARIABLE_PATTERN = /^\p{Lu}\p{L}+[0-9]+$/u;
const isVariable  = s => VARIABLE_PATTERN.test(s);
const isRefFlag   = s => s.startsWith('ref:');
const isNumeric   = s => /^-?[0-9]+$/.test(s);
const isInlineART = s => s.startsWith('ART:') || s.startsWith('PRO:');
// FUN: die with optional modifier, e.g. "d6", "d20+1", "d8-2"
const isFUNDieFlag = s => /^d(4|6|8|10|12|20)([+-][0-9]+)?$/.test(s);
// FUN: count (positive integer), e.g. "1", "2", "4"
const isFUNCount   = s => /^[1-9][0-9]*$/.test(s);

/**
 * Änderung 6: Variables (e.g. Tier1, Beruf2) are valid wherever a genus flag
 * would appear — the engine resolves the actual genus at runtime from the data.
 * We allow isVariable() to pass through in flag validation for ALL token types.
 */

// ── Tokenizer ──────────────────────────────────────────────────────────────
export function tokenize(template) {
  const result = [];
  let i = 0;
  while (i < template.length) {
    if (template[i] === '{') {
      const start = i;
      const end = template.indexOf('}', i);
      if (end === -1) {
        result.push({ type: 'unclosed', text: template.slice(i), start: i, end: template.length });
        break;
      }
      const raw = template.slice(i + 1, end);
      let mod = null, next = end + 1;
      if (template[next] === '^' || template[next] === '_') { mod = template[next]; next++; }
      result.push({ type: 'token', raw, mod, start, end: next });
      i = next;
    } else {
      const nb = template.indexOf('{', i);
      const endPos = nb === -1 ? template.length : nb;
      result.push({ type: 'literal', text: template.slice(i, endPos), start: i, end: endPos });
      i = endPos;
    }
  }
  return result;
}

// ── Validation ─────────────────────────────────────────────────────────────
export function validateDSL(template, knownLemmas = new Set()) {
  if (!template || typeof template !== 'string') return [];
  const errors = [];
  const tokens = tokenize(template);

  for (const tok of tokens) {
    if (tok.type === 'literal') continue;

    // Rule 1: Unclosed brace
    if (tok.type === 'unclosed') {
      errors.push({ severity: 'error', message: 'Nicht geschlossene Klammer „{"', start: tok.start, end: tok.end });
      continue;
    }

    const raw = tok.raw;
    const colonIdx = raw.indexOf(':');

    if (colonIdx === -1) {
      errors.push({ severity: 'error', message: `Ungültiges Token-Format (kein „:"): {${raw}}`, start: tok.start, end: tok.end });
      continue;
    }

    const typePart = raw.slice(0, colonIdx);
    const rest     = raw.slice(colonIdx + 1);
    const parts    = rest.split('|');
    const lemma    = parts[0];
    const flags    = parts.slice(1);

    // Rule 2: Unknown token type
    if (!VALID_TYPES.has(typePart)) {
      errors.push({ severity: 'error', message: `Unbekannter Token-Typ „${typePart}". Erlaubt: NOM, ADJ, ART, PRO, COM, NAM, FUN, DEF`, start: tok.start, end: tok.end });
      continue;
    }

    // Rule 3: Missing lemma
    if (!lemma || !lemma.trim()) {
      errors.push({ severity: 'error', message: `Fehlendes Lemma nach „${typePart}:"`, start: tok.start, end: tok.end });
      continue;
    }

    // Rule 4: Unknown lemma (NOM / ADJ / COM / DEF)
    if (typePart === 'NOM' || typePart === 'ADJ' || typePart === 'COM' || typePart === 'DEF') {
      const baseClass = lemma.replace(/[0-9]+$/, '');
      if (!isVariable(lemma) && !knownLemmas.has(baseClass) && !knownLemmas.has(lemma)) {
        errors.push({ severity: 'error', message: `Unbekanntes Lemma „${lemma}". Keine bekannte Klasse und kein gültiges Variablenmuster.`, start: tok.start, end: tok.end });
      }
    }

    // Rule 4b: NAM subtype
    if (typePart === 'NAM') {
      const base = lemma.replace(/[0-9]+$/, '');
      if (!['Vorname', 'Nachname'].includes(base)) {
        errors.push({ severity: 'error', message: `Ungültiger NAM-Subtyp „${lemma}". Erlaubt: Vorname1…9, Nachname1…9`, start: tok.start, end: tok.end });
      }
    }

    // Rule 5: Per-type strict flag validation
    const allowedFlags = TYPE_FLAGS[typePart];
    for (const flag of flags) {
      if (!flag || !flag.trim()) continue;
      if (isRefFlag(flag))   continue;  // ref:Volk1 — always ok
      if (isInlineART(flag)) continue;  // ART:/PRO: inline overrides
      // Änderung 6: Variables (e.g. Tier1, Beruf2) are valid as genus/lemma
      // references in flags for ALL token types — engine resolves at runtime.
      if (isVariable(flag))  continue;

      // FUN: die+modifier (e.g. d20+1, d6-2) and count (e.g. 1, 2) are valid
      if (typePart === 'FUN') {
        if (isFUNDieFlag(flag)) continue;
        if (isFUNCount(flag))   continue;
        if (isNumeric(flag))    continue;  // legacy plain offset
      }

      if (!allowedFlags.has(flag)) {
        errors.push({
          severity: 'error',
          message: `Ungültiger Flag „${flag}" für Token-Typ ${typePart}. {${raw}}`,
          start: tok.start,
          end: tok.end,
        });
      }
    }
  }

  return errors;
}

export function validateTags(value) {
  if (!value || !String(value).trim()) {
    return [{ severity: 'warning', message: 'Leeres tags-Feld', start: 0, end: 0 }];
  }
  return [];
}

// ── Syntax highlight (read-only renderer) ─────────────────────────────────
const TOKEN_CSS = {
  NOM: 'dsl-nom', ADJ: 'dsl-adj', ART: 'dsl-art', PRO: 'dsl-pro',
  COM: 'dsl-com', NAM: 'dsl-nam', FUN: 'dsl-fun',
};

export function highlightDSL(template) {
  if (!template || typeof template !== 'string') return '';
  const tokens = tokenize(template);
  let html = '';
  for (const tok of tokens) {
    if (tok.type === 'literal') { html += escHtml(tok.text); continue; }
    if (tok.type === 'unclosed') {
      html += `<span class="dsl-err" title="Nicht geschlossene Klammer">${escHtml(tok.text)}</span>`;
      continue;
    }
    const colonIdx = tok.raw.indexOf(':');
    const typePart = colonIdx !== -1 ? tok.raw.slice(0, colonIdx) : '';
    const cls = TOKEN_CSS[typePart] ?? 'dsl-err';
    html += `<span class="dsl-token ${cls}" title="${typePart}">${escHtml(`{${tok.raw}}${tok.mod ?? ''}`)}</span>`;
  }
  return html;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function buildKnownLemmas(schemas) {
  const known = new Set();
  for (const s of schemas) {
    if (s.lemma) known.add(s.lemma);
    if (s.id)    known.add(s.id);
  }
  return known;
}
