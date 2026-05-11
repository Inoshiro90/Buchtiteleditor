/**
 * flex-tables.js — Morphologische Flexionstabellen für ART/PRO
 *
 * Referenzarchitektur: Zielmodell Abschnitt 5–6
 *
 * Architektur-Entscheidungen:
 *
 * 1. Jede Tabelle hat einen compose()-Aufruf, der aus einem ResolvedMFB
 *    einen Lookup-Key konstruiert. Die Engine ruft:
 *      table.entries[table.compose(mfb)] ?? table.fallback
 *
 * 2. Plural-Genus-Normalisierung: Im Deutschen haben alle Genera im Plural
 *    dieselben Artikelformen. Statt alle drei Genera auszuschreiben,
 *    normalisieren wir Plural-Keys auf 'plu' ohne Genus-Präfix.
 *
 * 3. Sonderformen: Relativpronomen (dessen/deren/denen) und derjenige/derselbe
 *    werden als separate Tabellen verwaltet, da sie nicht aus ART:def ableitbar
 *    sind.
 *
 * 4. Possessiv-Stammermittlung: Separate Tabelle für Possessiv-Stämme
 *    (person × p3genus × poss_num → Stamm). Endungen werden separat addiert.
 */

// ── Typ-Definitionen (JSDoc) ──────────────────────────────────────────────────
/**
 * @typedef {Object} ResolvedMFB  Aufgelöstes Morphologisches Merkmal-Bündel
 * @property {string} type        'ART' | 'PRO'
 * @property {string} subtype     z.B. 'def', 'poss', 'pers'
 * @property {string} [numerus]   'sgl' | 'plu'
 * @property {string} [kasus]     'nom' | 'gen' | 'dat' | 'akk'
 * @property {string} [genus]     'msk' | 'fem' | 'neu'
 * @property {string} [person]    'p1' | 'p2' | 'p3' | 'p2form'
 * @property {string} [p3genus]   'msk' | 'fem' | 'neu'
 * @property {string} [poss_num]  'sgl' | 'plu'
 * @property {string} [ziel_genus] 'msk' | 'fem' | 'neu'
 * @property {string} [ziel_num]   'sgl' | 'plu'
 * @property {string} [mode]       'attr' | 'pron'
 * @property {string} [stem]       DEM_STEM oder QUANT_STEM
 * @property {string} [ant_genus]  Antezedent-Genus für genposs
 * @property {string} [ant_num]    Antezedent-Numerus für genposs
 * @property {string} [indef_form] 'man' | 'jemand' | 'niemand'
 * @property {string} [int_form]   'wer' | 'was' | 'welch'
 */

// ── Hilfsfunktionen für Key-Normalisierung ────────────────────────────────────

/**
 * Normalisiert Plural-Genus: Im Deutschen sind Pluralformen genusneutral.
 * 'fem|plu' → 'plu', 'msk|plu' → 'plu', 'neu|plu' → 'plu'
 * 'msk|sgl' → 'msk|sgl' (unverändert)
 */
function normGenus(genus, numerus) {
  return numerus === 'plu' ? 'plu' : genus;
}

/** Standardkey: genus|numerus|kasus (normalisiert) */
function gnk(genus, numerus, kasus) {
  return `${normGenus(genus, numerus)}|${numerus}|${kasus}`;
}

// ── ART:def — Bestimmter Artikel ──────────────────────────────────────────────
export const ART_DEF_TABLE = {
  name: 'ART:def',
  compose: mfb => gnk(mfb.genus, mfb.numerus, mfb.kasus),
  entries: {
    'msk|sgl|nom': 'der',  'msk|sgl|gen': 'des',  'msk|sgl|dat': 'dem',  'msk|sgl|akk': 'den',
    'fem|sgl|nom': 'die',  'fem|sgl|gen': 'der',  'fem|sgl|dat': 'der',  'fem|sgl|akk': 'die',
    'neu|sgl|nom': 'das',  'neu|sgl|gen': 'des',  'neu|sgl|dat': 'dem',  'neu|sgl|akk': 'das',
    'plu|plu|nom': 'die',  'plu|plu|gen': 'der',  'plu|plu|dat': 'den',  'plu|plu|akk': 'die',
  },
};

// ── ART:ind — Unbestimmter Artikel ────────────────────────────────────────────
export const ART_IND_TABLE = {
  name: 'ART:ind',
  compose: mfb => gnk(mfb.genus, mfb.numerus, mfb.kasus),
  entries: {
    'msk|sgl|nom': 'ein',   'msk|sgl|gen': 'eines', 'msk|sgl|dat': 'einem', 'msk|sgl|akk': 'einen',
    'fem|sgl|nom': 'eine',  'fem|sgl|gen': 'einer',  'fem|sgl|dat': 'einer', 'fem|sgl|akk': 'eine',
    'neu|sgl|nom': 'ein',   'neu|sgl|gen': 'eines',  'neu|sgl|dat': 'einem', 'neu|sgl|akk': 'ein',
    // plu → ART:zero (ART:ind|plu ist vom Constraint verboten)
  },
  fallback: '',
};

// ── ART:zero — Null-Artikel ───────────────────────────────────────────────────
export const ART_ZERO_TABLE = {
  name: 'ART:zero',
  compose: () => '',
  entries: { '': '' }, // Null-Artikel hat keine Oberflächenform
  fallback: '',
};

// ── ART:neg — Negativartikel (kein-/keine-) ───────────────────────────────────
export const ART_NEG_TABLE = {
  name: 'ART:neg',
  compose: mfb => gnk(mfb.genus, mfb.numerus, mfb.kasus),
  entries: {
    'msk|sgl|nom': 'kein',   'msk|sgl|gen': 'keines', 'msk|sgl|dat': 'keinem', 'msk|sgl|akk': 'keinen',
    'fem|sgl|nom': 'keine',  'fem|sgl|gen': 'keiner',  'fem|sgl|dat': 'keiner', 'fem|sgl|akk': 'keine',
    'neu|sgl|nom': 'kein',   'neu|sgl|gen': 'keines',  'neu|sgl|dat': 'keinem', 'neu|sgl|akk': 'kein',
    'plu|plu|nom': 'keine',  'plu|plu|gen': 'keiner',  'plu|plu|dat': 'keinen', 'plu|plu|akk': 'keine',
  },
};

// ── ART:poss / PRO:poss attr — Possessiv-Stämme und Endungen ─────────────────
/**
 * Schritt 1: Stamm-Ermittlung aus (person × p3genus × poss_num)
 *
 * Beispiel:
 *   p3 + fem + sgl → 'ihr'
 *   p3 + msk + sgl → 'sein'
 *   p3 + neu + sgl → 'sein'
 *   p3 + *   + plu → 'ihr'  (Possessum ist Plural)
 *   p1 + _   + sgl → 'mein'
 */
export const POSS_STEM_TABLE = {
  'p1|sgl':     'mein',
  'p1|plu':     'unser',
  'p2|sgl':     'dein',
  'p2|plu':     'euer',
  'p3|msk|sgl': 'sein',
  'p3|fem|sgl': 'ihr',
  'p3|neu|sgl': 'sein',
  'p3|msk|plu': 'ihr',
  'p3|fem|plu': 'ihr',
  'p3|neu|plu': 'ihr',
  'p2form|sgl': 'Ihr',
  'p2form|plu': 'Ihr',
};

/**
 * Schritt 2: Attributive Endungen (nach Ziel-Genus, Ziel-Numerus, Kasus)
 * Identisch mit kein--Paradigma (Zielmodell Abschnitt 6.2)
 */
export const POSS_ATTR_ENDINGS = {
  'msk|sgl|nom': '',    'msk|sgl|gen': 'es',  'msk|sgl|dat': 'em',  'msk|sgl|akk': 'en',
  'fem|sgl|nom': 'e',   'fem|sgl|gen': 'er',  'fem|sgl|dat': 'er',  'fem|sgl|akk': 'e',
  'neu|sgl|nom': '',    'neu|sgl|gen': 'es',  'neu|sgl|dat': 'em',  'neu|sgl|akk': '',
  'plu|plu|nom': 'e',   'plu|plu|gen': 'er',  'plu|plu|dat': 'en',  'plu|plu|akk': 'e',
};

/**
 * Schritt 2b: Pronominale Endungen (starke Adjektivflexion, PRO:poss|pron)
 * Unterschied zum attributiven: msk/nom → -er (nicht ∅), neu/nom/akk → -es/-s
 */
export const POSS_PRON_ENDINGS = {
  'msk|sgl|nom': 'er',  'msk|sgl|gen': 'es',  'msk|sgl|dat': 'em',  'msk|sgl|akk': 'en',
  'fem|sgl|nom': 'e',   'fem|sgl|gen': 'er',  'fem|sgl|dat': 'er',  'fem|sgl|akk': 'e',
  'neu|sgl|nom': 'es',  'neu|sgl|gen': 'es',  'neu|sgl|dat': 'em',  'neu|sgl|akk': 'es',
  'plu|plu|nom': 'e',   'plu|plu|gen': 'er',  'plu|plu|dat': 'en',  'plu|plu|akk': 'e',
};

/**
 * Sonderfall 'euer': Bei Endungs-Hinzufügung wird 'euer' zu 'eur' (Elision).
 * 'euer' + 'e' → 'eure' (nicht 'euere')
 */
function applyEuerElision(stem, ending) {
  if (stem === 'euer' && ending.length > 0) return 'eur' + ending;
  return stem + ending;
}

/**
 * Possessiv-Oberflächenform generieren.
 * @param {ResolvedMFB} mfb
 * @returns {string}
 */
export function generatePossForm(mfb) {
  // Stamm-Key: person|[p3genus|]poss_num
  const stemKey = mfb.person === 'p3'
    ? `p3|${mfb.p3genus}|${mfb.poss_num}`
    : `${mfb.person}|${mfb.poss_num}`;

  const stem = POSS_STEM_TABLE[stemKey];
  if (!stem) return `??poss(${stemKey})`;

  // Endungs-Key: ziel_genus|ziel_num|kasus (normalisiert)
  const endKey = gnk(mfb.ziel_genus, mfb.ziel_num, mfb.kasus);
  const endTable = (mfb.mode === 'pron') ? POSS_PRON_ENDINGS : POSS_ATTR_ENDINGS;
  const ending = endTable[endKey];
  if (ending === undefined) return `??possEnd(${endKey})`;

  return applyEuerElision(stem, ending);
}

// ── ART:genposs / PRO:genposs — Genitivischer Possessiv ──────────────────────
/**
 * dessen/deren aus Antezedent-Genus und Antezedent-Numerus.
 *
 * Sonderfall Dativ-Plural: 'denen' (nur als PRO:rel|plu|dat|* — nicht genposs).
 * genposs produziert nur dessen/deren als Possessivdeterminator.
 */
export const GENPOSS_TABLE = {
  'msk|sgl': 'dessen',
  'fem|sgl': 'deren',
  'neu|sgl': 'dessen',
  'msk|plu': 'deren',
  'fem|plu': 'deren',
  'neu|plu': 'deren',
};

export function generateGenPossForm(mfb) {
  const key = `${mfb.ant_genus}|${mfb.ant_num}`;
  return GENPOSS_TABLE[key] ?? `??genposs(${key})`;
}

// ── ART:dem / PRO:dem — Demonstrativartikel/-pronomen ────────────────────────
/**
 * Reguläre Stämme flektieren wie der bestimmte Artikel mit -es-/-em- Endungen.
 * 'dieser' + 'es' → 'dieses', 'jener' + 'em' → 'jenem'
 *
 * Komposita (derjenige/derselbe): Sondertabellen nötig.
 */

// Reguläre dem-Endungen (identisch mit def für sgl, stark für plu)
const DEM_REG_ENDINGS = {
  'msk|sgl|nom': 'er',  'msk|sgl|gen': 'es',  'msk|sgl|dat': 'em',  'msk|sgl|akk': 'en',
  'fem|sgl|nom': 'e',   'fem|sgl|gen': 'er',  'fem|sgl|dat': 'er',  'fem|sgl|akk': 'e',
  'neu|sgl|nom': 'es',  'neu|sgl|gen': 'es',  'neu|sgl|dat': 'em',  'neu|sgl|akk': 'es',
  'plu|plu|nom': 'e',   'plu|plu|gen': 'er',  'plu|plu|dat': 'en',  'plu|plu|akk': 'e',
};

// Stammteile für reguläre dem-Stämme (ohne -er/-es/-e/-em-Suffix)
const DEM_STEM_BASES = {
  'dieser': 'dies',
  'jener':  'jen',
  'jeder':  'jed',   // nur sgl (durch Constraint gesichert)
  'mancher':'manch',
  'solcher':'solch',
};

// Vollständige Tabellen für Komposita (nicht regelbasiert ableitbar)
export const DERJENIGE_TABLE = {
  'msk|sgl|nom': 'derjenige',  'msk|sgl|gen': 'desjenigen',
  'msk|sgl|dat': 'demjenigen', 'msk|sgl|akk': 'denjenigen',
  'fem|sgl|nom': 'diejenige',  'fem|sgl|gen': 'derjenigen',
  'fem|sgl|dat': 'derjenigen', 'fem|sgl|akk': 'diejenige',
  'neu|sgl|nom': 'dasjenige',  'neu|sgl|gen': 'desjenigen',
  'neu|sgl|dat': 'demjenigen', 'neu|sgl|akk': 'dasjenige',
  'plu|plu|nom': 'diejenigen', 'plu|plu|gen': 'derjenigen',
  'plu|plu|dat': 'denjenigen', 'plu|plu|akk': 'diejenigen',
};

export const DERSELBE_TABLE = {
  'msk|sgl|nom': 'derselbe',  'msk|sgl|gen': 'desselben',
  'msk|sgl|dat': 'demselben', 'msk|sgl|akk': 'denselben',
  'fem|sgl|nom': 'dieselbe',  'fem|sgl|gen': 'derselben',
  'fem|sgl|dat': 'derselben', 'fem|sgl|akk': 'dieselbe',
  'neu|sgl|nom': 'dasselbe',  'neu|sgl|gen': 'desselben',
  'neu|sgl|dat': 'demselben', 'neu|sgl|akk': 'dasselbe',
  'plu|plu|nom': 'dieselben', 'plu|plu|gen': 'derselben',
  'plu|plu|dat': 'denselben', 'plu|plu|akk': 'dieselben',
};

export function generateDemForm(mfb) {
  const key = gnk(mfb.genus, mfb.numerus, mfb.kasus);

  if (mfb.stem === 'derjenige') return DERJENIGE_TABLE[key] ?? `??derjenige(${key})`;
  if (mfb.stem === 'derselbe')  return DERSELBE_TABLE[key]  ?? `??derselbe(${key})`;

  const base = DEM_STEM_BASES[mfb.stem];
  if (!base) return `??demBase(${mfb.stem})`;

  const ending = DEM_REG_ENDINGS[key];
  if (ending === undefined) return `??demEnd(${key})`;

  return base + ending;
}

// ── ART:quant / PRO:quant — Quantifikationsartikel/-pronomen ─────────────────
/**
 * 'alle' und 'beide' flektieren wie starkes Adjektiv (ohne Stützartikel).
 * 'einige', 'manche', 'viele', 'wenige' — identisch.
 *
 * Basis: Plural-Formen (durch Constraint gesichert, außer 'alle' im sgl).
 */
const QUANT_ENDINGS = {
  'plu|plu|nom': 'e',   'plu|plu|gen': 'er',  'plu|plu|dat': 'en',  'plu|plu|akk': 'e',
  // Singular-Formen für 'alle' (substantiviert als 'alles'):
  'msk|sgl|nom': 'er',  'msk|sgl|gen': 'es',  'msk|sgl|dat': 'em',  'msk|sgl|akk': 'en',
  'fem|sgl|nom': 'e',   'fem|sgl|gen': 'er',  'fem|sgl|dat': 'er',  'fem|sgl|akk': 'e',
  'neu|sgl|nom': 'es',  'neu|sgl|gen': 'es',  'neu|sgl|dat': 'em',  'neu|sgl|akk': 'es',
};

// Stammteile für Quantoren (ohne Endung)
const QUANT_STEM_BASES = {
  'alle':   'all',
  'beide':  'beid',
  'einige': 'einig',
  'manche': 'manch',
  'viele':  'viel',
  'wenige': 'wenig',
};

export function generateQuantForm(mfb) {
  const key  = gnk(mfb.genus, mfb.numerus, mfb.kasus);
  const base = QUANT_STEM_BASES[mfb.stem];
  if (!base) return `??quantBase(${mfb.stem})`;
  const ending = QUANT_ENDINGS[key];
  if (ending === undefined) return `??quantEnd(${key})`;
  return base + ending;
}

// ── PRO:pers — Personalpronomen ───────────────────────────────────────────────
/**
 * Vollständiges Personalparadigma.
 * Key: person|numerus|kasus[|genus bei p3]
 */
export const PERS_TABLE = {
  // 1. Person Singular
  'p1|sgl|nom': 'ich',    'p1|sgl|gen': 'meiner', 'p1|sgl|dat': 'mir',  'p1|sgl|akk': 'mich',
  // 2. Person Singular
  'p2|sgl|nom': 'du',     'p2|sgl|gen': 'deiner', 'p2|sgl|dat': 'dir',  'p2|sgl|akk': 'dich',
  // 3. Person Singular — Genus unterscheidet
  'p3|sgl|nom|msk': 'er',   'p3|sgl|gen|msk': 'seiner', 'p3|sgl|dat|msk': 'ihm',  'p3|sgl|akk|msk': 'ihn',
  'p3|sgl|nom|fem': 'sie',  'p3|sgl|gen|fem': 'ihrer',  'p3|sgl|dat|fem': 'ihr',  'p3|sgl|akk|fem': 'sie',
  'p3|sgl|nom|neu': 'es',   'p3|sgl|gen|neu': 'seiner', 'p3|sgl|dat|neu': 'ihm',  'p3|sgl|akk|neu': 'es',
  // 1. Person Plural
  'p1|plu|nom': 'wir',   'p1|plu|gen': 'unser',  'p1|plu|dat': 'uns',   'p1|plu|akk': 'uns',
  // 2. Person Plural
  'p2|plu|nom': 'ihr',   'p2|plu|gen': 'euer',   'p2|plu|dat': 'euch',  'p2|plu|akk': 'euch',
  // 3. Person Plural — kein Genus
  'p3|plu|nom': 'sie',   'p3|plu|gen': 'ihrer',  'p3|plu|dat': 'ihnen', 'p3|plu|akk': 'sie',
  // Formelle Anrede
  'p2form|sgl|nom': 'Sie', 'p2form|sgl|gen': 'Ihrer', 'p2form|sgl|dat': 'Ihnen', 'p2form|sgl|akk': 'Sie',
  'p2form|plu|nom': 'Sie', 'p2form|plu|gen': 'Ihrer', 'p2form|plu|dat': 'Ihnen', 'p2form|plu|akk': 'Sie',
};

export function generatePersForm(mfb) {
  // p3 + sgl: Genus-Key verwenden
  const key = (mfb.person === 'p3' && mfb.numerus === 'sgl')
    ? `${mfb.person}|${mfb.numerus}|${mfb.kasus}|${mfb.genus}`
    : `${mfb.person}|${mfb.numerus}|${mfb.kasus}`;
  return PERS_TABLE[key] ?? `??pers(${key})`;
}

// ── PRO:refl — Reflexivpronomen ───────────────────────────────────────────────
export const REFL_TABLE = {
  'p1|sgl|dat': 'mir',   'p1|sgl|akk': 'mich',
  'p2|sgl|dat': 'dir',   'p2|sgl|akk': 'dich',
  'p3|sgl|dat': 'sich',  'p3|sgl|akk': 'sich',
  'p1|plu|dat': 'uns',   'p1|plu|akk': 'uns',
  'p2|plu|dat': 'euch',  'p2|plu|akk': 'euch',
  'p3|plu|dat': 'sich',  'p3|plu|akk': 'sich',
  'p2form|sgl|dat': 'sich', 'p2form|sgl|akk': 'sich',
};

export function generateReflForm(mfb) {
  const key = `${mfb.person}|${mfb.numerus}|${mfb.kasus}`;
  return REFL_TABLE[key] ?? `??refl(${key})`;
}

// ── PRO:rel — Relativpronomen ─────────────────────────────────────────────────
/**
 * Sonderformen: Genitiv und Dativ-Plural weichen vom bestimmten Artikel ab.
 *   msk|sgl|gen → 'dessen' (nicht 'des')
 *   fem|sgl|gen → 'deren'  (nicht 'der')
 *   plu|gen     → 'deren'  (nicht 'der')
 *   plu|dat     → 'denen'  (nicht 'den')
 */
export const REL_TABLE = {
  'msk|sgl|nom': 'der',    'msk|sgl|gen': 'dessen', 'msk|sgl|dat': 'dem',   'msk|sgl|akk': 'den',
  'fem|sgl|nom': 'die',    'fem|sgl|gen': 'deren',  'fem|sgl|dat': 'der',   'fem|sgl|akk': 'die',
  'neu|sgl|nom': 'das',    'neu|sgl|gen': 'dessen', 'neu|sgl|dat': 'dem',   'neu|sgl|akk': 'das',
  'plu|plu|nom': 'die',    'plu|plu|gen': 'deren',  'plu|plu|dat': 'denen', 'plu|plu|akk': 'die',
};

export function generateRelForm(mfb) {
  const key = gnk(mfb.genus, mfb.numerus, mfb.kasus);
  return REL_TABLE[key] ?? `??rel(${key})`;
}

// ── PRO:indef — Indefinitpronomen ─────────────────────────────────────────────
/**
 * Unvollständige Paradigmen (Defektiva). Nur modellierte Formen werden
 * produziert; fehlende Formen werden als Laufzeitfehler gemeldet.
 */
export const INDEF_TABLE = {
  'man|nom': 'man',
  'jemand|nom': 'jemand',   'jemand|gen': 'jemandes', 'jemand|dat': 'jemandem', 'jemand|akk': 'jemanden',
  'niemand|nom': 'niemand', 'niemand|gen': 'niemandes','niemand|dat': 'niemandem','niemand|akk': 'niemanden',
  'irgendjemand|nom': 'irgendjemand', 'irgendjemand|dat': 'irgendjemanden', 'irgendjemand|akk': 'irgendjemanden',
};

export function generateIndefForm(mfb) {
  const key = `${mfb.indef_form}|${mfb.kasus}`;
  return INDEF_TABLE[key] ?? `??indef(${key})`;
}

// ── PRO:int — Interrogativpronomen ────────────────────────────────────────────
/**
 * 'wer'/'was': Unvollständige Paradigmen, kein Genus.
 * 'welch': Flektiert wie bestimmter Artikel (mit DEM_REG_ENDINGS).
 */
export const INT_WER_TABLE = {
  'wer|nom': 'wer',  'wer|gen': 'wessen', 'wer|dat': 'wem',   'wer|akk': 'wen',
  'was|nom': 'was',  'was|gen': 'wessen', 'was|dat': 'wem',   'was|akk': 'was',
};

export function generateIntForm(mfb) {
  if (mfb.int_form === 'wer' || mfb.int_form === 'was') {
    return INT_WER_TABLE[`${mfb.int_form}|${mfb.kasus}`] ?? `??int(${mfb.int_form}|${mfb.kasus})`;
  }
  // 'welch': wie bestimmter Artikel + 'welch'-Basis
  const endings = {
    'msk|sgl|nom': 'er',  'msk|sgl|gen': 'es',  'msk|sgl|dat': 'em',  'msk|sgl|akk': 'en',
    'fem|sgl|nom': 'e',   'fem|sgl|gen': 'er',  'fem|sgl|dat': 'er',  'fem|sgl|akk': 'e',
    'neu|sgl|nom': 'es',  'neu|sgl|gen': 'es',  'neu|sgl|dat': 'em',  'neu|sgl|akk': 'es',
    'plu|plu|nom': 'e',   'plu|plu|gen': 'er',  'plu|plu|dat': 'en',  'plu|plu|akk': 'e',
  };
  const key    = gnk(mfb.genus, mfb.numerus, mfb.kasus);
  const ending = endings[key];
  return ending !== undefined ? `welch${ending}` : `??welch(${key})`;
}

// ── PRO:rez — Reziprokes Pronomen ────────────────────────────────────────────
export function generateRezForm(/* mfb */) {
  // 'einander' ist in Dativ und Akkusativ uninflektiert.
  // Präpositionaler Gebrauch (miteinander, füreinander) liegt außerhalb DSL-Scope.
  return 'einander';
}

// ── Flexionstabellen-Registry ─────────────────────────────────────────────────
/**
 * Zentrale Registry aller Flexionstabellen.
 * Schlüssel: 'TYPE:subtype'
 *
 * Für Typen mit programmatischer Generierung (poss, dem, quant, rel, pers,
 * refl, indef, int, rez, genposs) sind spezielle generateXxx()-Funktionen
 * zuständig — diese werden in runtime-resolver.js aufgerufen.
 */
export const FLEX_TABLE_REGISTRY = new Map([
  ['ART:def',     ART_DEF_TABLE],
  ['ART:ind',     ART_IND_TABLE],
  ['ART:zero',    ART_ZERO_TABLE],
  ['ART:neg',     ART_NEG_TABLE],
]);

// ── Generierungs-Dispatcher ───────────────────────────────────────────────────
/**
 * Zentrale generateSurface()-Funktion.
 * Entspricht Zielmodell Abschnitt 7.3.
 *
 * @param {ResolvedMFB} mfb
 * @returns {string} Oberflächenform
 */
export function generateSurface(mfb) {
  const key = `${mfb.type}:${mfb.subtype}`;

  switch (key) {
    // ART mit Lookup-Tabellen
    case 'ART:def': {
      const t = ART_DEF_TABLE;
      return t.entries[t.compose(mfb)] ?? t.fallback ?? `??${key}`;
    }
    case 'ART:ind': {
      const t = ART_IND_TABLE;
      return t.entries[t.compose(mfb)] ?? t.fallback ?? `??${key}`;
    }
    case 'ART:zero':
    case 'PRO:zero':
      return '';
    case 'ART:neg': {
      const t = ART_NEG_TABLE;
      return t.entries[t.compose(mfb)] ?? `??${key}`;
    }
    case 'ART:w': {
      // 'welch-' flektiert wie der bestimmte Artikel + starke Endung
      const endings = {
        'msk|sgl|nom': 'er', 'msk|sgl|gen': 'es', 'msk|sgl|dat': 'em', 'msk|sgl|akk': 'en',
        'fem|sgl|nom': 'e',  'fem|sgl|gen': 'er', 'fem|sgl|dat': 'er', 'fem|sgl|akk': 'e',
        'neu|sgl|nom': 'es', 'neu|sgl|gen': 'es', 'neu|sgl|dat': 'em', 'neu|sgl|akk': 'es',
        'plu|plu|nom': 'e',  'plu|plu|gen': 'er', 'plu|plu|dat': 'en', 'plu|plu|akk': 'e',
      };
      const k = gnk(mfb.genus, mfb.numerus, mfb.kasus);
      return `welch${endings[k] ?? ''}`;
    }

    // Programmatisch generiert
    case 'ART:poss':
    case 'PRO:poss':
      return generatePossForm(mfb);

    case 'ART:genposs':
    case 'PRO:genposs':
      return generateGenPossForm(mfb);

    case 'ART:dem':
    case 'PRO:dem':
      return generateDemForm(mfb);

    case 'ART:quant':
    case 'PRO:quant':
      return generateQuantForm(mfb);

    case 'PRO:pers':
      return generatePersForm(mfb);

    case 'PRO:refl':
      return generateReflForm(mfb);

    case 'PRO:rel':
      return generateRelForm(mfb);

    case 'PRO:indef':
      return generateIndefForm(mfb);

    case 'PRO:int':
      return generateIntForm(mfb);

    case 'PRO:rez':
      return generateRezForm(mfb);

    default:
      return `??surface(${key})`;
  }
}
