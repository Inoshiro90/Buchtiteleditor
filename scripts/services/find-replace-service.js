// scripts/services/find-replace-service.js
// Änderung 2: Find & Replace Engine
//
// Architektur:
//   - rein funktional, kein State
//   - wird von find-replace-bar.js genutzt
//   - kein direkter Zugriff auf AppStore oder AG Grid

/**
 * @typedef {Object} SearchOptions
 * @property {boolean} matchCase
 * @property {boolean} matchWholeWord
 * @property {boolean} useRegex
 */

/**
 * @typedef {Object} Match
 * @property {string} rowId    – Row _id
 * @property {number} rowIndex – rowNode.rowIndex (für AG Grid Scroll)
 * @property {string} field    – Spaltenfeld
 * @property {string} value    – aktueller Zellwert
 */

/**
 * Baut ein RegExp-Objekt aus Suchterm + Optionen.
 * Gibt null zurück bei ungültigem RegExp.
 */
export function buildPattern(term, opts) {
  if (!term) return null;
  try {
    let src = opts.useRegex ? term : escapeRegex(term);
    if (opts.matchWholeWord) src = `\\b${src}\\b`;
    const flags = opts.matchCase ? 'g' : 'gi';
    return new RegExp(src, flags);
  } catch (_) {
    return null;
  }
}

/**
 * Durchsucht alle Zellen einer AG Grid Instanz.
 * Gibt eine geordnete Liste von Matches zurück.
 *
 * @param {object}        gridApi  – AG Grid API
 * @param {string[]}      fields   – zu durchsuchende Spaltenfelder
 * @param {RegExp|null}   pattern  – buildPattern Ergebnis
 * @returns {Match[]}
 */
export function findAllMatches(gridApi, fields, pattern) {
  if (!gridApi || !pattern) return [];
  const matches = [];
  gridApi.forEachNodeAfterFilterAndSort((node) => {
    for (const field of fields) {
      const value = String(node.data?.[field] ?? '');
      pattern.lastIndex = 0;
      if (pattern.test(value)) {
        matches.push({
          rowId:    node.data._id,
          rowIndex: node.rowIndex,
          field,
          value,
        });
      }
    }
  });
  return matches;
}

/**
 * Ersetzt im Wert eines Treffers gemäß Suchoptionen.
 *
 * @param {string}       value         – Original-Zellwert
 * @param {RegExp}       pattern       – buildPattern Ergebnis (mit /g flag)
 * @param {string}       replacement   – Ersatztext
 * @param {boolean}      preserveCase  – Groß-/Kleinschreibung beibehalten
 * @returns {string}
 */
export function applyReplacement(value, pattern, replacement, preserveCase) {
  pattern.lastIndex = 0;
  if (!preserveCase) return value.replace(pattern, replacement);
  return value.replace(pattern, (match) => matchCase(match, replacement));
}

/**
 * Preserve-Case-Algorithmus:
 *   UPPER → UPPER, lower → lower, Title → Title, mixed → unverändert
 */
export function matchCase(original, replacement) {
  if (!original) return replacement;
  if (original === original.toUpperCase()) return replacement.toUpperCase();
  if (original === original.toLowerCase()) return replacement.toLowerCase();
  if (original[0] === original[0].toUpperCase() && original.slice(1) === original.slice(1).toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1).toLowerCase();
  }
  return replacement;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
