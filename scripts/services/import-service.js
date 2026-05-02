// editor/services/import-service.js
// Handles CSV (PapaParse) and XLSX/XLS/ODS (SheetJS) imports
// Falls back to built-in parser when PapaParse is unavailable.

import { parseCsv } from './csv-service.js';

// ── CSV ────────────────────────────────────────────────────────────────────
/**
 * Parse a CSV File object.
 * Tries PapaParse first (auto-detects delimiter); falls back to built-in
 * semicolon parser so genre.csv with BOM + semicolons always works.
 */
export async function parseCSVFile(file) {
  const text = await readFileAsText(file);
  const Papa = window.Papa;

  if (Papa) {
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        delimiter: detectDelimiter(text),
        skipEmptyLines: true,
        complete: (result) => {
          // PapaParse may leave BOM in the first field name — strip it
          const fields = (result.meta.fields ?? []).map(f =>
            f.charCodeAt(0) === 0xFEFF ? f.slice(1) : f.trim()
          );
          // Re-key rows with cleaned field names
          const rows = result.data.map(row => {
            const cleaned = {};
            result.meta.fields.forEach((orig, i) => {
              cleaned[fields[i]] = row[orig] ?? '';
            });
            return cleaned;
          });
          resolve({ fields, rows });
        },
        error: (err) => reject(err),
      });
    });
  }

  // Fallback: built-in parser
  const { fields, rows } = parseCsv(text);
  return { fields, rows };
}

// ── XLSX / XLS / ODS ───────────────────────────────────────────────────────
/**
 * Parse a spreadsheet File object via SheetJS.
 */
export async function parseXLSXFile(file) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('SheetJS nicht geladen');

  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(ws, { defval: '' });
  const fields = data.length > 0 ? Object.keys(data[0]) : [];
  return { fields, rows: data };
}

// ── Auto-detect ────────────────────────────────────────────────────────────
export async function parseFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.ods')) {
    return parseXLSXFile(file);
  }
  return parseCSVFile(file);
}

// ── Merge strategies ───────────────────────────────────────────────────────
/**
 * Merge imported rows into existing rows.
 * mode: 'replace' | 'append' | 'merge'
 * mergeKey: field to match on (e.g. 'singular' or 'title')
 */
export function mergeRows(existing, imported, mode, mergeKey) {
  if (mode === 'replace') return imported;
  if (mode === 'append')  return [...existing, ...imported];

  // merge: update by key, append new
  const keyOf = r => String(r[mergeKey] ?? '').trim().toLowerCase();
  const map = new Map(existing.map((r, i) => [keyOf(r), i]));
  const result = [...existing];

  imported.forEach(r => {
    const k = keyOf(r);
    if (k && map.has(k)) {
      result[map.get(k)] = { ...result[map.get(k)], ...r };
    } else {
      result.push(r);
    }
  });
  return result;
}

/**
 * Remap imported row keys according to a { srcField: dstField } mapping.
 * Fields mapped to '' (skip) are dropped.
 */
export function applyColumnMapping(rows, mapping) {
  return rows.map(row => {
    const out = {};
    Object.entries(mapping).forEach(([src, dst]) => {
      if (dst) out[dst] = row[src] ?? '';
    });
    return out;
  });
}

// ── Helpers ────────────────────────────────────────────────────────────────
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsText(file, 'utf-8');
  });
}

/**
 * Detect whether a CSV text uses semicolons or commas as the delimiter.
 * Counts occurrences in the first line (after BOM strip).
 */
function detectDelimiter(text) {
  let firstLine = text;
  if (firstLine.charCodeAt(0) === 0xFEFF) firstLine = firstLine.slice(1);
  const nl = firstLine.indexOf('\n');
  if (nl !== -1) firstLine = firstLine.slice(0, nl);

  const semis  = (firstLine.match(/;/g)  ?? []).length;
  const commas = (firstLine.match(/,/g)  ?? []).length;
  return semis >= commas ? ';' : ',';
}
