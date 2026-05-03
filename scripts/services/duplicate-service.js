// scripts/services/duplicate-service.js

function n(v) {
  return String(v ?? '').trim().normalize('NFC').toLowerCase();
}

// ── Within-class key fields ────────────────────────────────────────────────
// These are used for the within-table duplicate check (existing behaviour).
const WITHIN_KEY = {
  nomen:    ['singular', 'plural', 'adjective', 'prefix', 'suffix'],
  adjektiv: ['positive', 'comparative', 'superlative', 'prefix', 'suffix'],
  genre:    ['title'],
};

// ── Cross-class key fields ─────────────────────────────────────────────────
// Rationale:
//
// Nomen: singular + adjective + prefix + suffix
//   - singular alone is too strict (e.g. "Schwert" could legitimately appear
//     in Waffen AND as a metaphor in a different context-class).
//   - plural intentionally excluded: the same base word with the same modifiers
//     is a duplicate regardless of minor plural variants.
//   - gender excluded: same reasoning — same word should not exist twice
//     regardless of gender assignment.
//
// Adjektiv: positive only
//   - If the same base form ("schnell") appears in two different adjective
//     classes, that is always a duplicate — the comparative/superlative are
//     derived and not an independent distinguishing factor.
//
// Genre: cross-class check not applicable (only one genre table exists).
const CROSS_KEY = {
  nomen:    ['singular', 'adjective', 'prefix', 'suffix'],
  adjektiv: ['positive'],
};

function compositeKey(row, fields) {
  return fields.map(f => n(row[f])).join('\x00');
}

function allEmpty(fields) {
  return fields.map(() => '').join('\x00');
}

// ── Within-class detection (unchanged existing behaviour) ─────────────────
/**
 * Mark duplicates within a single row array.
 * Used when loading or editing a single table.
 */
export function detectDuplicates(rows, schemaType) {
  const fields = WITHIN_KEY[schemaType] ?? WITHIN_KEY.nomen;
  const empty  = allEmpty(fields);
  const seen   = new Map();

  return rows.map((row) => {
    const key = compositeKey(row, fields);
    if (key === empty) return { ...row, _isDuplicate: false };
    if (seen.has(key)) return { ...row, _isDuplicate: true };
    seen.set(key, true);
    return { ...row, _isDuplicate: false };
  });
}

// ── Cross-class detection ──────────────────────────────────────────────────
/**
 * Mark rows in `currentRows` that are cross-class duplicates.
 *
 * `otherRowsBySchema` is a Map<schemaId, row[]> of all OTHER tables of the
 * same type (the current table is excluded — within-class duplication is
 * handled by detectDuplicates above).
 *
 * Returns a new array where each row has `_isCrossClassDuplicate: boolean`
 * and `_crossClassDuplicateOf: string[]` (list of schema IDs where the
 * duplicate was found).
 *
 * @param {object[]}            currentRows
 * @param {string}              schemaType  — 'nomen' | 'adjektiv'
 * @param {Map<string,object[]>} otherRowsBySchema
 * @returns {object[]}
 */
export function detectCrossClassDuplicates(currentRows, schemaType, otherRowsBySchema) {
  const fields = CROSS_KEY[schemaType];
  if (!fields) {
    // Genre: no cross-class check — return rows unchanged
    return currentRows.map(r => ({ ...r, _isCrossClassDuplicate: false, _crossClassDuplicateOf: [] }));
  }

  const empty = allEmpty(fields);

  // Build lookup: key → [schemaId, …] from all other tables
  const crossIndex = new Map(); // key → Set<schemaId>
  for (const [schemaId, rows] of otherRowsBySchema) {
    for (const row of rows) {
      const key = compositeKey(row, fields);
      if (key === empty) continue;
      if (!crossIndex.has(key)) crossIndex.set(key, new Set());
      crossIndex.get(key).add(schemaId);
    }
  }

  return currentRows.map((row) => {
    const key    = compositeKey(row, fields);
    const others = key !== empty ? crossIndex.get(key) : null;
    if (others && others.size > 0) {
      return {
        ...row,
        _isCrossClassDuplicate: true,
        _crossClassDuplicateOf: [...others],
      };
    }
    return { ...row, _isCrossClassDuplicate: false, _crossClassDuplicateOf: [] };
  });
}

/**
 * Convenience: run the full cross-class check for a given table.
 * Loads all sibling tables of the same type from `db` and compares.
 *
 * @param {object[]} currentRows   — rows of the currently active table
 * @param {object}   currentSchema — the active schema object
 * @param {object}   db            — db module (db.get)
 * @param {object[]} allSchemas    — full schemas list from AppStore
 * @returns {Promise<object[]>}    — currentRows with cross-class flags set
 */
export async function runCrossClassCheck(currentRows, currentSchema, db, allSchemas) {
  if (currentSchema.type === 'genre') {
    return currentRows.map(r => ({
      ...r, _isCrossClassDuplicate: false, _crossClassDuplicateOf: [],
    }));
  }

  const siblings = allSchemas.filter(
    s => s.type === currentSchema.type && s.id !== currentSchema.id
  );

  const otherRowsBySchema = new Map();
  for (const sibling of siblings) {
    const rows = (await db.get('tables', sibling.id)) ?? [];
    otherRowsBySchema.set(sibling.id, rows);
  }

  return detectCrossClassDuplicates(currentRows, currentSchema.type, otherRowsBySchema);
}

// ── Cross-class summary ────────────────────────────────────────────────────
/** Count cross-class duplicates in a row array. */
export function countCrossClassDuplicates(rows) {
  return rows.filter(r => r._isCrossClassDuplicate).length;
}

// ── Within-class helpers ───────────────────────────────────────────────────
/** Remove all rows marked as within-class duplicate (keep first occurrence). */
export function removeDuplicates(rows) {
  return rows.filter(r => !r._isDuplicate);
}

/** Count within-class duplicates. */
export function countDuplicates(rows) {
  return rows.filter(r => r._isDuplicate).length;
}

/** Exposed key definitions (used by statusbar tooltip). */
export { CROSS_KEY, WITHIN_KEY };
