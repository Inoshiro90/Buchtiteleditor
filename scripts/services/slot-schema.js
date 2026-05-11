/**
 * slot-schema.js — Slot-basiertes Validierungssystem für ART/PRO-Token
 *
 * Referenzarchitektur: ART_PRO_Refactoring_Zielmodell.md v2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WARUM DIESES SYSTEM (statt globalem Set-Validator):
 *
 * Der alte Validator prüfte jeden Flag-String gegen ein flaches Set aller
 * erlaubten Flags für einen Token-Typ. Beispiel:
 *
 *   TYPE_FLAGS.ART = { 'def','ind','neg','poss','dem','w','quant',
 *                      'sgl','plu','nom','gen','dat','akk',
 *                      'msk','fem','neu','p1','p2','p3','p2form',
 *                      'dieser','jener',... }
 *
 * Das führt zu mehreren strukturellen Fehlern:
 *
 * (1) Positionsblindheit: {ART:poss|p1|fem|sgl|nom|msk|sgl} wird akzeptiert,
 *     obwohl 'fem' (P3_GENUS) bei Person p1 semantisch unmöglich ist.
 *     Der Set-Validator sieht nur "fem ∈ F_GENUS" und ist zufrieden.
 *
 * (2) def:X / var:X invisible: Defektiva-Variablen (def:Gebirge1) und
 *     Genus-Variablen (var:Tier1) sind keine Literal-Mitglieder des Sets.
 *     Sie fallen durch und erzeugen "Ungültiger Flag"-Fehler.
 *
 * (3) Keine Cross-Slot-Semantik: "beide" ist immer Plural, "jeder" immer
 *     Singular, "ART:ind" hat kein Plural. Set-Validator kann das nicht
 *     ausdrücken.
 *
 * (4) Keine konditionale Validierung: P3_GENUS ist bei p3 Pflicht, bei p1/p2
 *     verboten. Das alte System kennt nur "erlaubt" oder "nicht erlaubt".
 *
 * Das neue System ist slot-basiert, positionsgebunden und schema-gesteuert:
 *
 *   Token → [Subtype, Flag0, Flag1, Flag2, ..., FlagN]
 *             ↓
 *   SchemaLookup(type, subtype) → TokenSchema mit SlotDefs
 *             ↓
 *   SlotBinder(rawFlags, slotDefs) → ResolvedSlots (oder BindError)
 *             ↓
 *   ConstraintChecker(resolvedSlots, constraints) → semantische Fehler
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── SlotType-Enum ─────────────────────────────────────────────────────────────
/**
 * Semantische Typen für einzelne Slots.
 * Jeder Typ hat einen eigenen Validator (SLOT_TYPE_VALIDATORS weiter unten).
 *
 * Der Typ bestimmt: welche String-Werte sind an dieser Position syntaktisch
 * gültig? Die Position selbst bestimmt: was bedeutet der Wert semantisch?
 */
export const SlotType = Object.freeze({
  KASUS:       'KASUS',        // nom | gen | dat | akk
  GENUS:       'GENUS',        // msk | fem | neu
  GENUS_EXT:   'GENUS_EXT',   // msk | fem | neu | var:<Variable>
  GENUS_ANT:   'GENUS_ANT',   // Antezedent-Genus: msk | fem | neu
  NUMERUS:     'NUMERUS',     // sgl | plu
  NUMERUS_EXT: 'NUMERUS_EXT', // sgl | plu | def:<Variable>
  NUMERUS_ANT: 'NUMERUS_ANT', // Antezedent-Numerus: sgl | plu
  PERSON:      'PERSON',      // p1 | p2 | p3 | p2form
  P3_GENUS:    'P3_GENUS',    // Possessor-Genus bei p3: msk | fem | neu | var:<Variable>
  DEM_STEM:    'DEM_STEM',    // dieser | jener | jeder | mancher | solcher | derjenige | derselbe
  QUANT_STEM:  'QUANT_STEM',  // alle | beide | einige | manche | viele | wenige
  INDEF_FORM:  'INDEF_FORM',  // man | jemand | niemand | irgendjemand
  INT_FORM:    'INT_FORM',    // wer | was | welch
  REZ_KASUS:   'REZ_KASUS',   // dat | akk (einander)
  POSS_MODE:   'POSS_MODE',   // attr | pron
});

// ── Variablen-Muster ──────────────────────────────────────────────────────────
/**
 * Muster für Variablen-Referenzen in Flags.
 *
 * VAR_PATTERN: var:Tier1, var:Held2 — für Genus-Variablen (GENUS_EXT, P3_GENUS)
 * DEF_PATTERN: def:Gebirge1, def:Ort3 — für Defektiva-Numerus (NUMERUS_EXT)
 *
 * Format: [Großbuchstabe][Buchstaben+][1-3stellige Ziffer]
 * Beispiel: Gebirge1, Tier2, Wetterphaenomen1
 *
 * Diese Variablen werden zur Laufzeit aus dem RuntimeContext aufgelöst.
 * Im Validator werden sie nur syntaktisch akzeptiert — semantische Auflösung
 * ist Runtime-Verantwortung (Trennung: Validator ≠ Runtime).
 */
const VAR_PATTERN = /^var:[A-ZÄÖÜ]\p{L}+[0-9]+$/u;
const DEF_PATTERN = /^def:[A-ZÄÖÜ]\p{L}+[0-9]+$/u;

// ── SlotType-Validatoren ──────────────────────────────────────────────────────
/**
 * Für jeden SlotType eine test()-Funktion und ein label für Fehlermeldungen.
 *
 * test() prüft: "Ist dieser String-Wert syntaktisch korrekt für diesen Typ?"
 * Keine semantische Prüfung (z.B. ob var:Tier1 tatsächlich definiert ist).
 * Das ist Runtime-Verantwortung.
 *
 * Kritische Eigenschaft: Die Werte-Mengen verschiedener SlotTypes sind
 * weitgehend DISJUNKT. Das ermöglicht dem SlotBinder, verbotene Flags an
 * falschen Positionen zu erkennen:
 *   - GENUS_EXT: { msk, fem, neu, var:X }
 *   - NUMERUS_EXT: { sgl, plu, def:X }
 *   Diese überschneiden sich nicht → P3_GENUS-Erkennung bei forbidden-Slots
 *   ist eindeutig möglich.
 */
export const SLOT_TYPE_VALIDATORS = new Map([

  [SlotType.KASUS, {
    test:  v => ['nom','gen','dat','akk'].includes(v),
    label: 'nom | gen | dat | akk',
  }],

  [SlotType.GENUS, {
    test:  v => ['msk','fem','neu'].includes(v),
    label: 'msk | fem | neu',
  }],

  [SlotType.GENUS_EXT, {
    // Genus + Variablenreferenz.
    // var:Tier1 → Genus wird zur Laufzeit aus Tier1-Kontext aufgelöst.
    test:  v => ['msk','fem','neu'].includes(v) || VAR_PATTERN.test(v),
    label: 'msk | fem | neu | var:<Variable>',
  }],

  [SlotType.GENUS_ANT, {
    // Antezedent-Genus für genposs (dessen/deren).
    // Kein var: hier — Antezedent muss zur Validator-Zeit bekannt sein.
    test:  v => ['msk','fem','neu'].includes(v),
    label: 'msk | fem | neu',
  }],

  [SlotType.NUMERUS, {
    test:  v => ['sgl','plu'].includes(v),
    label: 'sgl | plu',
  }],

  [SlotType.NUMERUS_EXT, {
    // Numerus + Defektiva-Variablenreferenz.
    // def:Gebirge1 → Numerus wird zur Laufzeit aus Gebirge1-Kontext aufgelöst.
    // Defektiva haben keinen inhärenten Numerus (nur als Plural oder nur als
    // Singular verwendbar) — daher die Variable.
    test:  v => ['sgl','plu'].includes(v) || DEF_PATTERN.test(v),
    label: 'sgl | plu | def:<Variable>',
  }],

  [SlotType.NUMERUS_ANT, {
    test:  v => ['sgl','plu'].includes(v),
    label: 'sgl | plu',
  }],

  [SlotType.PERSON, {
    test:  v => ['p1','p2','p3','p2form'].includes(v),
    label: 'p1 | p2 | p3 | p2form',
  }],

  [SlotType.P3_GENUS, {
    /**
     * WARUM P3_GENUS POSITIONAL IST (und nicht im globalen GENUS-Set):
     *
     * Beim Possessiv der 3. Person unterscheidet das Deutsche:
     *   - p3 + msk/neu → Stamm "sein-" (sein Schwert, sein Held)
     *   - p3 + fem     → Stamm "ihr-"  (ihr Schwert, ihr Held)
     *   - p3 + plu     → Stamm "ihr-"  (ihr Schwert, ihre Helden)
     *
     * Dieser Genus-Flag beschreibt den POSSESSOR (nicht das Ziel-Nomen).
     * Er steht an einer festen Position: NACH person, VOR poss_num.
     * Das Ziel-Genus steht NACH kasus.
     *
     * Ein Set-basierter Validator hätte keine Möglichkeit, diese beiden
     * Genus-Vorkommen semantisch zu unterscheiden. Die Positionierung im
     * Schema ist daher zwingend notwendig, nicht nur sauber.
     */
    test:  v => ['msk','fem','neu'].includes(v) || VAR_PATTERN.test(v),
    label: 'msk | fem | neu | var:<Variable>',
  }],

  [SlotType.DEM_STEM, {
    test:  v => ['dieser','jener','jeder','mancher','solcher','derjenige','derselbe'].includes(v),
    label: 'dieser | jener | jeder | mancher | solcher | derjenige | derselbe',
  }],

  [SlotType.QUANT_STEM, {
    test:  v => ['alle','beide','einige','manche','viele','wenige'].includes(v),
    label: 'alle | beide | einige | manche | viele | wenige',
  }],

  [SlotType.INDEF_FORM, {
    test:  v => ['man','jemand','niemand','irgendjemand'].includes(v),
    label: 'man | jemand | niemand | irgendjemand',
  }],

  [SlotType.INT_FORM, {
    test:  v => ['wer','was','welch'].includes(v),
    label: 'wer | was | welch',
  }],

  [SlotType.REZ_KASUS, {
    // "einander" existiert nur in Dativ und Akkusativ.
    // Nominativ (*einander kam) und Genitiv (*einanders) sind unmöglich.
    test:  v => ['dat','akk'].includes(v),
    label: 'dat | akk',
  }],

  [SlotType.POSS_MODE, {
    /**
     * WARUM POSS_MODE NOTWENDIG IST:
     *
     * Attributives Possessiv (ART-Modus): "mein Schwert" → Stamm "mein"
     * Pronominales Possessiv (PRO-Modus): "das Schwert ist meins" → "meiner/meins/meine"
     *
     * Die Flexionsendungen unterscheiden sich beim Maskulinum/Neutrum im Nominativ:
     *   attr: mein (∅-Endung)
     *   pron: meiner (stark, m), meins/meines (stark, n)
     *
     * ART:poss ist immer attributiv (kein POSS_MODE-Slot).
     * PRO:poss ohne |pron → attr (default, rückwärtskompatibel).
     * PRO:poss|...|pron   → pronominale Flexion.
     */
    test:  v => ['attr','pron'].includes(v),
    label: 'attr | pron',
  }],

]);

// ── Hilfsfunktion ─────────────────────────────────────────────────────────────
/**
 * Prüft ob ein Flagwert syntaktisch zum angegebenen SlotType passt.
 * Intern für SlotBinder verwendet (forbidden-Erkennung).
 */
function matchesSlotType(value, slotType) {
  const validator = SLOT_TYPE_VALIDATORS.get(slotType);
  return validator ? validator.test(value) : false;
}

// ── SlotBinder ────────────────────────────────────────────────────────────────
/**
 * Bindet eine positionelle Folge von rawFlags an die SlotDefs eines Schemas.
 *
 * Algorithmus (nach Zielmodell Abschnitt 2.6):
 *
 * Für jeden SlotDef in Reihenfolge:
 *   1. Evaluiere required(context) und forbidden(context).
 *   2. Wenn FORBIDDEN:
 *      - Peek auf rawFlags[rawIdx] (NICHT konsumieren).
 *      - Wenn der Wert zum verbotenen Slot-Typ passt → Fehler.
 *      - Slot überspringen (rawIdx unverändert).
 *   3. Wenn REQUIRED:
 *      - rawFlags[rawIdx] muss matchesSlotType() bestehen → konsumieren.
 *      - Falls fehlend oder Typ-Mismatch → Fehler.
 *   4. Wenn OPTIONAL:
 *      - rawFlags[rawIdx] testen. Wenn Typ-Match → konsumieren.
 *      - Wenn kein Match → überspringen.
 *
 * Kontext: byName enthält alle bereits aufgelösten Slots. Damit können
 * spätere Slots ihre required/forbidden-Entscheidung auf früheren Slots
 * aufbauen (z.B. P3_GENUS: required wenn byName.get('person') === 'p3').
 *
 * @param {string[]} rawFlags   - Flags nach dem Subtype (positional)
 * @param {object[]} slotDefs   - Schema-Slot-Definitionen
 * @returns {{ resolved: Map<string,string>, errors: string[], warnings: string[] }}
 */
export function bindSlots(rawFlags, slotDefs) {
  let rawIdx = 0;
  const resolved = new Map(); // slot.name → gebundener Wert
  const errors   = [];
  const warnings = [];

  for (const slot of slotDefs) {
    // Kontext für konditionale Slots: enthält bereits aufgelöste Slots
    const context = { byName: resolved, rawRemaining: rawFlags.slice(rawIdx) };

    const isRequired = typeof slot.required === 'function'
      ? slot.required(context)
      : (slot.required ?? false);

    const isForbidden = typeof slot.forbidden === 'function'
      ? slot.forbidden(context)
      : (slot.forbidden ?? false);

    if (isForbidden) {
      // Slot ist verboten: nicht konsumieren, aber auf Fehlplatzierung prüfen.
      // Beispiel: P3_GENUS bei person=p1 — wenn 'fem' als nächster Flag kommt,
      // ist das ein klarer Fehler (Genus an verbotener Position).
      const candidate = rawFlags[rawIdx];
      if (candidate !== undefined && slot.type && matchesSlotType(candidate, slot.type)) {
        const msg = slot.forbiddenMessage
          ? slot.forbiddenMessage(context)
          : `Slot "${slot.name}" ist bei dieser Konfiguration verboten.`;
        errors.push(`Flag "${candidate}" an Position ${rawIdx + 1}: ${msg}`);
        // rawIdx NICHT erhöhen — Flag bleibt "unkonsumed", weitere Parse wird
        // wahrscheinlich fehlschlagen aber gibt Folgefehler aus.
      }
      continue; // Slot-Definition überspringen
    }

    if (rawIdx >= rawFlags.length) {
      if (isRequired) {
        const typeLabel = SLOT_TYPE_VALIDATORS.get(slot.type)?.label ?? slot.type;
        errors.push(
          `Pflicht-Slot "${slot.name}" fehlt (erwartet an Position ${rawIdx + 1}). ` +
          `Erwartet: ${typeLabel}`
        );
      }
      continue;
    }

    const value = rawFlags[rawIdx];

    if (!matchesSlotType(value, slot.type)) {
      if (isRequired) {
        const typeLabel = SLOT_TYPE_VALIDATORS.get(slot.type)?.label ?? slot.type;
        errors.push(
          `Slot "${slot.name}" (Position ${rawIdx + 1}): ` +
          `Ungültiger Wert "${value}". Erwartet: ${typeLabel}`
        );
        rawIdx++; // Fehler-Flag konsumieren, um Parse fortzusetzen
      }
      // Optionaler Slot: Typ-Mismatch → nicht konsumieren, weiter zum nächsten
      continue;
    }

    resolved.set(slot.name, value);
    rawIdx++;
  }

  // Prüfe übrig gebliebene Flags (mehr Flags als Slots)
  if (rawIdx < rawFlags.length) {
    const extra = rawFlags.slice(rawIdx);
    warnings.push(
      `${extra.length} unerwartete Flag(s) nach vollständiger Slot-Bindung: ` +
      extra.map(f => `"${f}"`).join(', ')
    );
  }

  return { resolved, errors, warnings };
}

// ── ConstraintChecker ─────────────────────────────────────────────────────────
/**
 * Wertet Cross-Slot-Constraints auf einem aufgelösten Slot-Set aus.
 *
 * WARUM CONSTRAINTS GETRENNT VON SLOT-VALIDIERUNG:
 *
 * SlotType-Validierung → "Ist dieser Wert syntaktisch korrekt für den Typ?"
 * ConstraintChecker    → "Sind die Werte semantisch miteinander kompatibel?"
 *
 * Beispiel: ART:quant|sgl|nom|msk|beide
 *   - SlotBinder: 'sgl' ist NUMERUS_EXT ✓, 'beide' ist QUANT_STEM ✓
 *   - ConstraintChecker: 'beide' + 'sgl' → FEHLER (beide ist immer Plural)
 *
 * Constraints operieren auf dem aufgelösten Map<slotName, value>,
 * haben daher volle Sicht auf alle Slot-Werte gleichzeitig.
 *
 * @param {Map<string,string>} resolved
 * @param {ConstraintRule[]} constraints
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function runConstraints(resolved, constraints) {
  const errors   = [];
  const warnings = [];

  for (const rule of constraints) {
    let result;
    try {
      result = rule.check(resolved);
    } catch (e) {
      warnings.push(`Constraint "${rule.name}" Ausführungsfehler: ${e.message}`);
      continue;
    }
    if (result == null) continue; // null/undefined = Constraint nicht anwendbar
    if (!result.ok) {
      const msg = rule.message(resolved);
      if (rule.severity === 'error')   errors.push(msg);
      if (rule.severity === 'warning') warnings.push(msg);
    }
  }

  return { errors, warnings };
}

// ── Numerus-Klassifikations-Helpers ──────────────────────────────────────────
/**
 * Unterscheidet drei Klassen von NUMERUS_EXT-Werten:
 *
 * isGuaranteedSingular('sgl')          → true  (sicher Singular → Plural-Only-Constraint greift)
 * isGuaranteedPlural('plu')            → true  (sicher Plural   → OK für Plural-Only-Constraint)
 * isDeferredNumerus('def:Gebirge1')    → true  (Runtime-abhängig → KEIN Fehler, Prüfung zurückgestellt)
 *
 * WARUM DIESE TRENNUNG NOTWENDIG IST:
 *   Der alte Constraint prüfte `num !== 'plu'` — das schlägt bei `def:Gebirge1` fehl,
 *   obwohl `def:Gebirge1` zur Runtime `plu` sein KANN. Defektiva sind oft Pluraliatantum
 *   (nur Plural: "die Alpen", "die Gebirge") oder Singulariatantum. Der Numerus ist
 *   erst zur Runtime auflösbar. Ein Validator-Error wäre hier ein False Positive.
 *
 *   Lösung: Constraints dürfen nur bei `isGuaranteedSingular()` hart fehlschlagen.
 *   Bei `isDeferredNumerus()` wird `null` zurückgegeben (Constraint nicht anwendbar).
 */
const isGuaranteedSingular = v => v === 'sgl';
const isGuaranteedPlural   = v => v === 'plu';
const isDeferredNumerus    = v => typeof v === 'string' && v.startsWith('def:');

// ── Wiederverwendbare Constraint-Definitionen ─────────────────────────────────

/**
 * Quantor-Plural-Constraint:
 * 'beide', 'einige', 'viele', 'wenige', 'manche' → immer Plural.
 * {ART:quant|sgl|nom|msk|beide} → FEHLER
 */
const QUANT_PLURAL_ONLY = new Set(['beide', 'einige', 'viele', 'wenige', 'manche']);
const quantPluralConstraint = {
  name:     'quant-plural-only',
  check:    s => {
    const stem = s.get('stem');
    const num  = s.get('numerus');
    if (!stem || !num) return null;
    if (!QUANT_PLURAL_ONLY.has(stem)) return { ok: true };
    // def:X → Numerus wird zur Runtime aufgelöst; kann plu sein → kein Fehler
    if (isDeferredNumerus(num)) return null;
    // sgl → sicher Singular → Fehler
    if (isGuaranteedSingular(num)) return { ok: false };
    return { ok: true };
  },
  severity: 'error',
  message:  s =>
    `"${s.get('stem')}" ist grammatikalisch nur im Plural möglich. ` +
    `Verwende numerus=plu statt "${s.get('numerus')}".`,
};

/**
 * Jeder-Singular-Constraint:
 * 'jeder' ist distributiv-singular. Plural-Verwendung (*jede Bücher) ist falsch.
 */
const jederSingularConstraint = {
  name:     'jeder-singular-only',
  check:    s => {
    const stem = s.get('stem');
    const num  = s.get('numerus');
    if (stem !== 'jeder' || !num) return null;
    if (isDeferredNumerus(num)) return null; // Runtime-abhängig → kein Fehler
    return { ok: num === 'sgl' };
  },
  severity: 'error',
  message:  () =>
    '"jeder" ist ein distributiver Singular. ' +
    'Pluralbildung ("jede Bücher") ist grammatikalisch unmöglich. ' +
    'Für Plural: verwende "alle" oder "manche".',
};

/**
 * ART:ind-kein-Plural-Constraint:
 * "ein-" existiert nicht im Plural (Null-Artikel).
 * {ART:ind|plu|nom|msk} → FEHLER
 */
const indNoPluralConstraint = {
  name:     'ind-no-plural',
  check:    s => {
    const num = s.get('numerus');
    if (!num) return null;
    if (isDeferredNumerus(num)) return null; // def:X → Runtime-Entscheidung
    if (num === 'plu') return { ok: false };
    return { ok: true };
  },
  severity: 'error',
  message:  () =>
    'ART:ind (unbestimmter Artikel "ein-") existiert nicht im Plural. ' +
    'Im Plural gibt es den Null-Artikel. Verwende {ART:zero|plu|...}.',
};

/**
 * PRO:refl-kein-Nom/Gen-Constraint:
 * Reflexivpronomen existieren nur in Dativ und Akkusativ.
 * {PRO:refl|p1|sgl|nom} → FEHLER
 */
const reflNoNomGenConstraint = {
  name:     'refl-no-nom-gen',
  check:    s => {
    const kasus = s.get('kasus');
    if (!kasus) return null;
    return { ok: !['nom','gen'].includes(kasus) };
  },
  severity: 'error',
  message:  s => {
    const k = s.get('kasus');
    return `PRO:refl existiert nicht im ${k === 'nom' ? 'Nominativ' : 'Genitiv'}. ` +
           'Reflexivpronomen (mich, mir, sich, uns, euch) sind nur in Dativ und Akkusativ möglich.';
  },
};

/**
 * man-Nominativ-Constraint:
 * 'man' hat nur eine Nominativform. Andere Kasus sind nicht standardisiert.
 * {PRO:indef|man|dat} → FEHLER
 */
const manNomOnlyConstraint = {
  name:     'man-nom-only',
  check:    s => {
    const form  = s.get('indef_form');
    const kasus = s.get('kasus');
    if (form !== 'man' || !kasus) return null;
    return { ok: kasus === 'nom' };
  },
  severity: 'error',
  message:  () =>
    '"man" ist nur im Nominativ möglich (unvollständiges Paradigma). ' +
    'Für Dativ/Akkusativ-Äquivalente gibt es keine Standardform.',
};

/**
 * welch-Genus-Constraint:
 * 'welch' (Interrogativartikel) benötigt ein Genus-Flag.
 * {PRO:int|welch|nom} → FEHLER (Genus fehlt)
 */
const welchRequiresGenusConstraint = {
  name:     'welch-requires-genus',
  check:    s => {
    const form  = s.get('int_form');
    const genus = s.get('genus');
    if (form !== 'welch') return null;
    return { ok: !!genus };
  },
  severity: 'error',
  message:  () =>
    'PRO:int mit "welch" benötigt ein Genus-Flag für die Flexion ' +
    '(welcher/welche/welches). Beispiel: {PRO:int|welch|nom|msk}',
};

// ── Schema-Factories ──────────────────────────────────────────────────────────

/**
 * Gemeinsame Possessiv-Slots (ART:poss und PRO:poss).
 *
 * WARUM ART:poss UND PRO:poss DIESELBE SLOTLOGIK TEILEN:
 *
 * Beide modellieren Possessivität. Die Slot-Reihenfolge ist identisch:
 *   [person] [p3genus?] [poss_num] [kasus] [ziel_genus] [ziel_num] [mode?]
 *
 * Der Possessor-Block [person][p3genus][poss_num] beschreibt WER besitzt.
 * Der Einbettungs-Block [kasus] beschreibt die syntaktische Rolle im Satz.
 * Der Ziel-Block [ziel_genus][ziel_num] beschreibt WAS besessen wird.
 *
 * ART:poss ist immer attributiv (kein mode-Slot).
 * PRO:poss hat einen optionalen mode-Slot (attr|pron).
 *
 * Parser-Vorteil: Nur eine bindSlots()-Implementierung für beide.
 *
 * @param {boolean} withMode - true für PRO:poss (attr/pron), false für ART:poss
 */
function makePossSlots(withMode) {
  const slots = [
    {
      name:     'person',
      type:     SlotType.PERSON,
      required: true,
    },
    {
      /**
       * P3_GENUS: Konditionaler Slot.
       *
       * required = true  → wenn person = 'p3' (Possessor-Genus bestimmt Stamm)
       * forbidden = true → wenn person ≠ 'p3' (kein Possessor-Genus bei p1/p2)
       *
       * Die Kondition wird zum Binding-Zeitpunkt evaluiert, nachdem 'person'
       * bereits aufgelöst wurde (context.byName.get('person')).
       *
       * Disjunktheit sichert Eindeutigkeit: P3_GENUS-Werte {msk,fem,neu,var:X}
       * und NUMERUS_EXT-Werte {sgl,plu,def:X} überschneiden sich nicht.
       * Daher kann der Binder erkennen, ob ein 'verbotener' Genus-Wert an
       * dieser Position steht.
       */
      name:      'p3genus',
      type:      SlotType.P3_GENUS,
      required:  ctx => ctx.byName.get('person') === 'p3',
      forbidden: ctx => ctx.byName.get('person') !== 'p3',
      forbiddenMessage: ctx =>
        `Possessor-Genus (P3_GENUS) ist bei Person "${ctx.byName.get('person')}" verboten. ` +
        'P3_GENUS (msk | fem | neu) darf nur bei Person p3 angegeben werden, ' +
        'da nur die 3. Person zwischen "sein-" (msk/neu) und "ihr-" (fem) unterscheidet.',
    },
    {
      name:     'poss_num',
      type:     SlotType.NUMERUS_EXT,
      required: true,
    },
    {
      name:     'kasus',
      type:     SlotType.KASUS,
      required: true,
    },
    {
      name:     'ziel_genus',
      type:     SlotType.GENUS_EXT,
      required: true,
    },
    {
      name:     'ziel_num',
      type:     SlotType.NUMERUS_EXT,
      required: true,
    },
  ];

  if (withMode) {
    slots.push({
      name:     'mode',
      type:     SlotType.POSS_MODE,
      required: false, // default: attr (rückwärtskompatibel)
    });
  }

  return slots;
}

/**
 * Antezedent-Slots für genposs (dessen/deren).
 * Identisch für ART:genposs und PRO:genposs.
 */
function makeGenPossSlots() {
  return [
    {
      name:     'ant_genus',
      type:     SlotType.GENUS_ANT,
      required: true,
    },
    {
      name:     'ant_num',
      type:     SlotType.NUMERUS_ANT,
      required: true,
    },
  ];
}

// ── ART-Schemas ───────────────────────────────────────────────────────────────
/**
 * Vollständige Schema-Registry für alle ART-Subtypen.
 * Entspricht Zielmodell Abschnitt 1.3.
 *
 * Schlüssel = Subtyp-String (nach "ART:")
 */
export const ART_SCHEMAS = new Map([

  // ART:def — Bestimmter Artikel
  // Format: ART:def | NUMERUS_EXT | KASUS | GENUS_EXT
  ['def', {
    subtype:     'def',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
    ],
    constraints: [],
  }],

  // ART:ind — Unbestimmter Artikel
  // Format: ART:ind | NUMERUS_EXT(≠plu) | KASUS | GENUS_EXT
  // Constraint: kein Plural (grammatikalisch unmöglich)
  ['ind', {
    subtype:     'ind',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
    ],
    constraints: [indNoPluralConstraint],
  }],

  // ART:zero — Null-Artikel (∅) [NEU]
  // Format: ART:zero | NUMERUS_EXT | KASUS | GENUS_EXT
  // Repräsentiert fehlenden Artikel: "Schwerter glänzen", "Mut zeigen"
  ['zero', {
    subtype:     'zero',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
    ],
    constraints: [],
  }],

  // ART:neg — Negativartikel (kein-/keine-)
  // Format: ART:neg | NUMERUS_EXT | KASUS | GENUS_EXT
  ['neg', {
    subtype:     'neg',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
    ],
    constraints: [],
  }],

  // ART:poss — Possessivartikel (mein-/dein-/sein-/ihr-)
  // Format: ART:poss | PERSON | [P3_GENUS] | NUMERUS_EXT | KASUS | GENUS_EXT | NUMERUS_EXT
  // Conditional: P3_GENUS nur bei p3.
  ['poss', {
    subtype:     'poss',
    slots:       makePossSlots(false), // kein POSS_MODE (ART = immer attributiv)
    constraints: [],
  }],

  // ART:genposs — Genitivischer Possessivdeterminator [NEU]
  // Format: ART:genposs | GENUS_ANT | NUMERUS_ANT
  // Realisierung: msk|sgl → dessen, fem|sgl → deren, neu|sgl → dessen, *|plu → deren
  ['genposs', {
    subtype:     'genposs',
    slots:       makeGenPossSlots(),
    constraints: [],
  }],

  // ART:dem — Demonstrativartikel (dieser/jener/jeder/...)
  // Format: ART:dem | NUMERUS_EXT | KASUS | GENUS_EXT | DEM_STEM
  // Constraints: jeder → nur sgl
  ['dem', {
    subtype:     'dem',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
      { name: 'stem',    type: SlotType.DEM_STEM,      required: true },
    ],
    constraints: [jederSingularConstraint],
  }],

  // ART:w — Interrogativartikel (welch-)
  // Format: ART:w | NUMERUS_EXT | KASUS | GENUS_EXT
  ['w', {
    subtype:     'w',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
    ],
    constraints: [],
  }],

  // ART:quant — Quantifikationsartikel (alle/beide/einige/...)
  // Format: ART:quant | NUMERUS_EXT | KASUS | GENUS_EXT | QUANT_STEM
  // Constraints: beide/einige/viele/wenige/manche → nur plu
  ['quant', {
    subtype:     'quant',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
      { name: 'stem',    type: SlotType.QUANT_STEM,    required: true },
    ],
    constraints: [quantPluralConstraint],
  }],

]);

// ── PRO-Schemas ───────────────────────────────────────────────────────────────
/**
 * Vollständige Schema-Registry für alle PRO-Subtypen.
 * Entspricht Zielmodell Abschnitt 1.4.
 */
export const PRO_SCHEMAS = new Map([

  // PRO:pers — Personalpronomen (ich/du/er/sie/es/wir/...)
  // Format: PRO:pers | PERSON | NUMERUS_EXT | KASUS | [GENUS_EXT bei p3]
  // Conditional: GENUS nur bei p3 (er/sie/es benötigt Genus für Flexion)
  ['pers', {
    subtype:     'pers',
    slots:       [
      { name: 'person',  type: SlotType.PERSON,      required: true },
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      {
        // Genus Pflicht bei p3+sgl (er/sie/es), optional/verboten sonst.
        // p3+plu: alle Genera haben dieselbe Pluralform ("sie") → kein Genus nötig.
        name:      'genus',
        type:      SlotType.GENUS_EXT,
        required:  ctx =>
          ctx.byName.get('person') === 'p3' && ctx.byName.get('numerus') === 'sgl',
        forbidden: ctx => {
          const p = ctx.byName.get('person');
          return p === 'p1' || p === 'p2' || p === 'p2form';
        },
        forbiddenMessage: ctx =>
          `Genus ist bei Person "${ctx.byName.get('person')}" verboten. ` +
          'Nur bei p3+sgl ist Genus relevant (er/sie/es-Unterscheidung).',
      },
    ],
    constraints: [],
  }],

  // PRO:refl — Reflexivpronomen (mich/mir/sich/uns/euch)
  // Format: PRO:refl | PERSON | NUMERUS_EXT | KASUS
  // Constraint: KASUS nur dat/akk (kein Nominativ/Genitiv)
  ['refl', {
    subtype:     'refl',
    slots:       [
      { name: 'person',  type: SlotType.PERSON,      required: true },
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
    ],
    // Constraint statt eingeschränkter SlotType, um präzisere Fehlermeldung
    // zu geben: "nicht im Nominativ" statt "ungültiger Kasus-Wert".
    constraints: [reflNoNomGenConstraint],
  }],

  // PRO:poss — Possessivpronomen (mein/dein/sein/ihr — attr oder pronominal)
  // Format: PRO:poss | PERSON | [P3_GENUS] | NUMERUS_EXT | KASUS | GENUS_EXT | NUMERUS_EXT | [POSS_MODE]
  // POSS_MODE: attr (default, rückwärtskompatibel) | pron (pronominale Form)
  ['poss', {
    subtype:     'poss',
    slots:       makePossSlots(true), // mit POSS_MODE
    constraints: [],
  }],

  // PRO:dem — Demonstrativpronomen (dieser/jener/... pronominal)
  // Format: PRO:dem | NUMERUS_EXT | KASUS | GENUS_EXT | [DEM_STEM]
  // Stem ist optional (bei PRO:dem kann der Stamm kontextuell klar sein)
  ['dem', {
    subtype:     'dem',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
      { name: 'stem',    type: SlotType.DEM_STEM,      required: false },
    ],
    constraints: [],
  }],

  // PRO:rel — Relativpronomen (der/die/das, dessen/deren, denen)
  // Format: PRO:rel | NUMERUS_EXT | KASUS | GENUS_EXT
  // Sonderformen (dessen/deren/denen) werden von der Runtime-Engine aus
  // Genus/Numerus/Kasus abgeleitet (via PRO:rel-Flexionstabelle).
  ['rel', {
    subtype:     'rel',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
    ],
    constraints: [],
  }],

  // PRO:quant — Quantorpronomen (alle/beide/einige/... pronominal)
  // Format: PRO:quant | NUMERUS_EXT | KASUS | GENUS_EXT | QUANT_STEM
  ['quant', {
    subtype:     'quant',
    slots:       [
      { name: 'numerus', type: SlotType.NUMERUS_EXT, required: true },
      { name: 'kasus',   type: SlotType.KASUS,        required: true },
      { name: 'genus',   type: SlotType.GENUS_EXT,    required: true },
      { name: 'stem',    type: SlotType.QUANT_STEM,    required: true },
    ],
    constraints: [quantPluralConstraint],
  }],

  // PRO:genposs — Genitivischer Possessiv pronominal (dessen/deren) [NEU]
  // Format: PRO:genposs | GENUS_ANT | NUMERUS_ANT
  // Identisch zu ART:genposs — Engine produziert dessen/deren
  ['genposs', {
    subtype:     'genposs',
    slots:       makeGenPossSlots(),
    constraints: [],
  }],

  // PRO:indef — Indefinitpronomen (man/jemand/niemand) [NEU]
  // Format: PRO:indef | INDEF_FORM | KASUS
  // Constraint: man → nur nom
  ['indef', {
    subtype:     'indef',
    slots:       [
      { name: 'indef_form', type: SlotType.INDEF_FORM, required: true },
      { name: 'kasus',      type: SlotType.KASUS,       required: true },
    ],
    constraints: [manNomOnlyConstraint],
  }],

  // PRO:int — Interrogativpronomen (wer/was/welch) [NEU]
  // Format: PRO:int | INT_FORM | KASUS | [GENUS_EXT bei welch]
  // Constraint: welch → Genus Pflicht
  ['int', {
    subtype:     'int',
    slots:       [
      { name: 'int_form', type: SlotType.INT_FORM,  required: true },
      { name: 'kasus',    type: SlotType.KASUS,      required: true },
      {
        // Genus nur bei 'welch' — welcher/welche/welches flektiert wie der bestimmte Artikel.
        // Bei wer/was ist Genus grammatikalisch nicht relevant.
        name:      'genus',
        type:      SlotType.GENUS_EXT,
        required:  ctx => ctx.byName.get('int_form') === 'welch',
        forbidden: ctx => {
          const f = ctx.byName.get('int_form');
          return f === 'wer' || f === 'was';
        },
        forbiddenMessage: ctx =>
          `Genus ist bei Interrogativform "${ctx.byName.get('int_form')}" verboten ` +
          '("wer" und "was" sind genuslos).',
      },
    ],
    constraints: [welchRequiresGenusConstraint],
  }],

  // PRO:rez — Reziprokes Pronomen (einander) [NEU]
  // Format: PRO:rez | REZ_KASUS (dat|akk)
  // "einander" ist uninflektiert und existiert nur in Dativ und Akkusativ.
  ['rez', {
    subtype:     'rez',
    slots:       [
      { name: 'kasus', type: SlotType.REZ_KASUS, required: true },
    ],
    constraints: [],
  }],

]);

// ── Öffentliche API ───────────────────────────────────────────────────────────

/** Schema-Lookup für ART-Subtypen. Gibt null zurück wenn Subtyp unbekannt. */
export function lookupArtSchema(subtype) {
  return ART_SCHEMAS.get(subtype) ?? null;
}

/** Schema-Lookup für PRO-Subtypen. Gibt null zurück wenn Subtyp unbekannt. */
export function lookupProSchema(subtype) {
  return PRO_SCHEMAS.get(subtype) ?? null;
}

/** Set aller validen ART-Subtypen (für Subtyp-Validierung in validateDSL). */
export const VALID_ART_SUBTYPES = new Set(ART_SCHEMAS.keys());

/** Set aller validen PRO-Subtypen (für Subtyp-Validierung in validateDSL). */
export const VALID_PRO_SUBTYPES = new Set(PRO_SCHEMAS.keys());

/**
 * Vollständige Slot-Validierung für ein einzelnes Token.
 *
 * Kombiniert: SchemaLookup → SlotBinder → ConstraintChecker
 *
 * @param {'ART'|'PRO'} type
 * @param {string}       subtype
 * @param {string[]}     rawFlags  - Flags nach dem Subtype (positional)
 * @returns {{ errors: string[], warnings: string[], resolvedSlots: Map|null }}
 */
export function validateTokenSlots(type, subtype, rawFlags) {
  const schema = type === 'ART'
    ? lookupArtSchema(subtype)
    : lookupProSchema(subtype);

  if (!schema) {
    return {
      errors:        [`Unbekannter ${type}-Subtyp "${subtype}".`],
      warnings:      [],
      resolvedSlots: null,
    };
  }

  const bindResult       = bindSlots(rawFlags, schema.slots);
  const constraintResult = runConstraints(bindResult.resolved, schema.constraints);

  return {
    errors:        [...bindResult.errors, ...constraintResult.errors],
    warnings:      [...bindResult.warnings, ...constraintResult.warnings],
    resolvedSlots: bindResult.resolved,
  };
}
