// scripts/services/batch-service.js
// Batch-Export (ZIP) und Batch-Import (mehrere Dateien gleichzeitig)

import { db }                            from '../db/db.js';
import { AppStore }                      from '../store/AppStore.js';
import { parseFile }                     from './import-service.js';
import { rowsToCsv }                     from './csv-service.js';
import { detectDuplicates }              from './duplicate-service.js';
import { NOMEN_COLUMNS, ADJ_COLUMNS, GENRE_COLUMNS } from '../db/schemas.js';

// ── Erwartete Spalten je Typ ───────────────────────────────────────────────
const EXPECTED_FIELDS = {
  nomen:    NOMEN_COLUMNS.map(c => c.field),
  adjektiv: ADJ_COLUMNS.map(c => c.field),
  genre:    GENRE_COLUMNS.map(c => c.field),
};

// Mindestfelder, die unbedingt vorhanden sein müssen (Pflichtfelder)
const REQUIRED_FIELDS = {
  nomen:    ['singular', 'plural', 'gender'],
  adjektiv: ['positive', 'comparative', 'superlative'],
  genre:    ['title', 'genre'],
};

// ── Export ─────────────────────────────────────────────────────────────────
/**
 * Exportiert alle Klassen als ZIP-Datei mit Ordnerstruktur:
 *   genre/genre.csv
 *   nomen/Waffe.csv
 *   nomen/Tier.csv
 *   adjektive/PersonAussehen.csv
 *   …
 */
export async function exportAllAsZip() {
  const JSZip = window.JSZip;
  if (!JSZip) throw new Error('JSZip nicht geladen. Bitte Seite neu laden.');

  const schemas = AppStore.get('schemas') ?? [];
  const zip = new JSZip();

  // Ordner anlegen
  const folderMap = {
    genre:    zip.folder('genre'),
    nomen:    zip.folder('nomen'),
    adjektiv: zip.folder('adjektive'),
  };

  for (const schema of schemas) {
    const rows   = (await db.get('tables', schema.id)) ?? [];
    const fields = schema.columns.map(c => c.field);
    const csv    = rowsToCsv(fields, rows);
    const folder = folderMap[schema.type];
    if (!folder) continue;  // unbekannter Typ → überspringen
    folder.file(schema.csvFile ?? `${schema.id}.csv`, csv);
  }

  // Zeitstempel für Dateinamen
  const now    = new Date();
  const pad    = n => String(n).padStart(2, '0');
  const stamp  = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}_`
               + `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const fname  = `Buchtiteleditor_Batch_${stamp}.zip`;

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = fname;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Schema-Typ erkennen ────────────────────────────────────────────────────
/**
 * Versucht anhand der vorhandenen Spalten zu ermitteln, ob eine Datei
 * Nomen-, Adjektiv- oder Genre-Daten enthält.
 *
 * Gibt { type, missing, unexpected } zurück.
 * type  = 'nomen' | 'adjektiv' | 'genre' | null
 * missing     = Felder, die erwartet aber nicht vorhanden sind
 * unexpected  = Felder in der Datei, die nicht zum erkannten Typ passen
 */
export function detectSchemaType(fields) {
  const fieldSet = new Set(fields.map(f => f.trim().toLowerCase()));

  // Score: wie viele Pflichtfelder sind vorhanden?
  const scores = Object.entries(REQUIRED_FIELDS).map(([type, required]) => {
    const hits = required.filter(f => fieldSet.has(f.toLowerCase())).length;
    return { type, hits, total: required.length };
  });

  // Besten Treffer wählen
  scores.sort((a, b) => b.hits - a.hits);
  const best = scores[0];

  if (best.hits === 0) {
    return { type: null, missing: [], unexpected: fields };
  }

  const expectedSet = new Set(EXPECTED_FIELDS[best.type].map(f => f.toLowerCase()));
  const missing     = EXPECTED_FIELDS[best.type].filter(f => !fieldSet.has(f.toLowerCase()));
  const unexpected  = fields.filter(f => !expectedSet.has(f.trim().toLowerCase()));

  // Nur als gültiger Typ akzeptieren, wenn ALLE Pflichtfelder vorhanden sind
  if (best.hits < best.total) {
    return { type: null, missing, unexpected };
  }

  return { type: best.type, missing, unexpected };
}

// ── Batch-Import ───────────────────────────────────────────────────────────
/**
 * @typedef {{ file: string, type: string|null, rows: number }} ImportedResult
 * @typedef {{ file: string, error: string, expected: string[], found: string[] }} ImportError
 *
 * Importiert mehrere Dateien auf einmal.
 * Für jede Datei:
 *   1. Parsen (CSV / TSV / XLSX / XLS / ODS)
 *   2. Typ erkennen (Nomen / Adjektiv / Genre)
 *   3. Bei erkanntem Typ: in passende Klasse importieren
 *      (neue Klasse anlegen falls noch nicht vorhanden)
 *   4. Bei unbekanntem Typ: zur Fehlerliste hinzufügen
 *
 * @returns {{ imported: ImportedResult[], errors: ImportError[] }}
 */
export async function batchImportFiles(files, mode = 'append') {
  const schemas   = AppStore.get('schemas') ?? [];
  const imported  = [];
  const errors    = [];

  for (const file of files) {
    let parsed;
    try {
      parsed = await parseFile(file);
    } catch (e) {
      errors.push({
        file: file.name,
        error: `Datei konnte nicht geparst werden: ${e.message}`,
        expected: [],
        found: [],
      });
      continue;
    }

    const { fields, rows } = parsed;
    const { type, missing, unexpected } = detectSchemaType(fields);

    if (!type) {
      const requiredNomen    = REQUIRED_FIELDS.nomen.join(', ');
      const requiredAdjektiv = REQUIRED_FIELDS.adjektiv.join(', ');
      const requiredGenre    = REQUIRED_FIELDS.genre.join(', ');
      errors.push({
        file: file.name,
        error: 'Typ konnte nicht erkannt werden. Pflichtfelder fehlen.',
        expected: [
          `Nomen: [${requiredNomen}]`,
          `Adjektiv: [${requiredAdjektiv}]`,
          `Genre: [${requiredGenre}]`,
        ],
        found: fields,
        missing,
        unexpected,
      });
      continue;
    }

    // Klasse finden oder anlegen
    const baseName   = file.name.replace(/\.[^.]+$/, '');  // Dateiname ohne Endung
    let targetSchema = schemas.find(s => s.type === type && (
      s.id === baseName ||
      s.csvFile === file.name ||
      s.label.toLowerCase() === baseName.toLowerCase()
    ));

    if (!targetSchema) {
      // Neue Klasse auf Basis des Dateinamens anlegen
      targetSchema = await _createSchemaFromFile(file.name, type, schemas);
    }

    // Zeilen normalisieren auf Schema-Felder
    const schemaFields  = targetSchema.columns.map(c => c.field);
    const normalizedRows = rows.map((row, i) => {
      const out = { _id: `batch_${Date.now()}_${i}` };
      schemaFields.forEach(f => { out[f] = row[f] ?? ''; });
      return out;
    });

    // Vorhandene Daten mergen / ersetzen
    const existing     = (await db.get('tables', targetSchema.id)) ?? [];
    const mergeKey     = type === 'genre' ? 'title' : type === 'adjektiv' ? 'positive' : 'singular';
    const merged       = _mergeByMode(existing, normalizedRows, mode, mergeKey);
    const withDups     = detectDuplicates(merged, type);

    await db.set('tables', targetSchema.id, withDups);

    // AppStore synchronisieren wenn aktive Tabelle betroffen
    const active = AppStore.get('activeSchema');
    if (active?.id === targetSchema.id) {
      AppStore.set('rows', withDups);
      document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: withDups } }));
    }

    imported.push({
      file:   file.name,
      schema: targetSchema.id,
      type,
      rows:   normalizedRows.length,
    });
  }

  return { imported, errors };
}

// ── Interne Hilfsfunktionen ────────────────────────────────────────────────
async function _createSchemaFromFile(filename, type, existingSchemas) {
  const { NOMEN_COLUMNS, ADJ_COLUMNS, GENRE_COLUMNS } = await import('../db/schemas.js');
  const columns = type === 'adjektiv' ? ADJ_COLUMNS : type === 'genre' ? GENRE_COLUMNS : NOMEN_COLUMNS;
  const id      = filename.replace(/\.[^.]+$/, '');  // ohne Endung
  const group   = type === 'adjektiv' ? 'adjektiv' : type === 'genre' ? 'genre' : 'nomen';

  const newSchema = {
    id, label: id,
    file:    `./scripts/data/${group}/${filename}`,
    csvFile: filename,
    type, columns,
    lemma:    type !== 'genre' ? id : null,
    group,
    custom:   true,
    deletable:true,
  };

  const updatedSchemas = [...existingSchemas, newSchema];
  AppStore.set('schemas', updatedSchemas);
  await db.set('tables', id, []);
  const customSchemas = updatedSchemas.filter(s => s.custom === true);
  await db.set('schemas', 'custom', customSchemas);

  return newSchema;
}

function _mergeByMode(existing, incoming, mode, mergeKey) {
  if (mode === 'replace') return incoming;
  if (mode === 'append')  return [...existing, ...incoming];
  // merge
  const keyOf = r => String(r[mergeKey] ?? '').trim().toLowerCase();
  const map   = new Map(existing.map((r, i) => [keyOf(r), i]));
  const result = [...existing];
  incoming.forEach(r => {
    const k = keyOf(r);
    if (k && map.has(k)) result[map.get(k)] = { ...result[map.get(k)], ...r };
    else result.push(r);
  });
  return result;
}
