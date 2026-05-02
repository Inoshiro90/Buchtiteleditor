// editor/services/duplicate-service.js

function n(v) {
  return String(v ?? '').trim().normalize('NFC').toLowerCase();
}

// Fields that constitute "same entry" per schema type
const NOMEN_KEY_FIELDS = ['singular', 'plural', 'adjective', 'prefix', 'suffix'];
const ADJ_KEY_FIELDS   = ['positive', 'comparative', 'superlative', 'prefix', 'suffix'];
const GENRE_KEY_FIELDS = ['title'];

function compositeKey(row, fields) {
  return fields.map(f => n(row[f])).join('\x00');
}

/**
 * Mark duplicates in a row array.
 *
 * Nomen    → composite: singular + plural + adjective + prefix + suffix
 * Adjektiv → composite: positive + comparative + superlative + prefix + suffix
 * Genre    → title only
 *
 * Two rows are duplicates ONLY when ALL relevant fields are identical.
 */
export function detectDuplicates(rows, schemaType) {
  const fields =
    schemaType === 'genre'    ? GENRE_KEY_FIELDS :
    schemaType === 'adjektiv' ? ADJ_KEY_FIELDS   :
                                NOMEN_KEY_FIELDS;

  const allEmpty = fields.map(() => '').join('\x00');
  const seen = new Map();

  return rows.map((row) => {
    const key = compositeKey(row, fields);
    if (key === allEmpty) return { ...row, _isDuplicate: false };

    if (seen.has(key)) {
      return { ...row, _isDuplicate: true };
    }
    seen.set(key, true);
    return { ...row, _isDuplicate: false };
  });
}

/** Remove all rows marked as duplicate (keep first occurrence). */
export function removeDuplicates(rows) {
  return rows.filter(r => !r._isDuplicate);
}

/** Count duplicate rows. */
export function countDuplicates(rows) {
  return rows.filter(r => r._isDuplicate).length;
}
