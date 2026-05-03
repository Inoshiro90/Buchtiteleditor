// scripts/services/backup-service.js
// JSON-Export, -Import und Datenbank-Reset

import { db } from '../db/db.js';
import { AppStore } from '../store/AppStore.js';
import { DEFAULT_SCHEMAS } from '../db/schemas.js';

// ── Dateiname ──────────────────────────────────────────────────────────────
/**
 * Generiert den Dateinamen:
 * Buchtiteleditor_YYYY-MM-DD_HH-MM-SS.json
 */
function buildFilename() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const year   = now.getFullYear();
  const month  = pad(now.getMonth() + 1);
  const day    = pad(now.getDate());
  const hour   = pad(now.getHours());
  const minute = pad(now.getMinutes());
  const second = pad(now.getSeconds());
  return `Buchtiteleditor_${year}-${month}-${day}_${hour}-${minute}-${second}.json`;
}

// ── Export ─────────────────────────────────────────────────────────────────
/**
 * Liest alle Schemas und ihre Tabellendaten aus der DB und lädt
 * eine JSON-Datei mit Zeitstempel-Namen herunter.
 */
export async function exportDatabaseAsJSON() {
  const schemas = AppStore.get('schemas') ?? [];

  // Für jedes Schema die Tabelleneinträge laden
  const tables = {};
  for (const schema of schemas) {
    const rows = (await db.get('tables', schema.id)) ?? [];
    tables[schema.id] = rows;
  }

  // Nur benutzerdefinierte (custom) Schemas für den Schema-Block mitexportieren
  const customSchemas = schemas.filter(s => s.custom === true);

  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    customSchemas,   // neu angelegte Klassen
    tables,          // alle Tabelleninhalte (auch Standard-Klassen)
  };

  const json   = JSON.stringify(payload, null, 2);
  const blob   = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url    = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href     = url;
  anchor.download = buildFilename();
  anchor.click();
  URL.revokeObjectURL(url);
}

// ── Import ─────────────────────────────────────────────────────────────────
/**
 * Liest eine JSON-Backup-Datei ein und stellt den Datenbankstand wieder her.
 * Gibt { imported: number, errors: string[] } zurück.
 */
export async function importDatabaseFromJSON(file) {
  const text = await readFileAsText(file);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (e) {
    throw new Error('Ungültige JSON-Datei: ' + e.message);
  }

  if (!payload.tables || typeof payload.tables !== 'object') {
    throw new Error('Kein gültiges Buchtiteleditor-Backup (Feld "tables" fehlt).');
  }

  const errors = [];
  let imported = 0;

  // Tabelleninhalte wiederherstellen
  for (const [schemaId, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows)) { errors.push(`Tabelle „${schemaId}": kein Array`); continue; }
    await db.set('tables', schemaId, rows);
    imported++;
  }

  // Benutzerdefinierte Schemas wiederherstellen (falls vorhanden)
  if (Array.isArray(payload.customSchemas) && payload.customSchemas.length > 0) {
    const existing = AppStore.get('schemas') ?? [];
    const existingIds = new Set(existing.map(s => s.id));
    const toAdd = payload.customSchemas.filter(s => !existingIds.has(s.id));
    if (toAdd.length > 0) {
      const updated = [...existing, ...toAdd];
      AppStore.set('schemas', updated);
      await db.set('schemas', 'custom', updated.filter(s => s.custom === true));
    }
  }

  // AppStore: aktive Tabelle neu laden
  const active = AppStore.get('activeSchema');
  if (active) {
    const freshRows = (await db.get('tables', active.id)) ?? [];
    AppStore.set('rows', freshRows);
    document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: freshRows } }));
  }

  return { imported, errors };
}

// ── Reset ──────────────────────────────────────────────────────────────────
/**
 * Löscht alle Tabelleninhalte (Nomen, Adjektive, Genre) und alle
 * benutzerdefinierten Klassen aus DB und AppStore.
 * Standard-Schemas bleiben als leere Strukturen erhalten.
 */
export async function resetDatabase() {
  // Alle Tabellen leeren
  const schemas = AppStore.get('schemas') ?? [];
  for (const schema of schemas) {
    await db.set('tables', schema.id, []);
  }

  // Benutzerdefinierte Klassen komplett entfernen
  await db.delete('schemas', 'custom');
  await db.delete('meta', 'customVariables');

  // Initialisierungsflag löschen → nächster Start lädt wieder CSVs
  await db.delete('meta', 'initialized');

  // AppStore: nur Standard-Schemas behalten, alle Zeilen leeren
  AppStore.set('schemas', DEFAULT_SCHEMAS);
  AppStore.set('rows', []);
  AppStore.set('errors', []);
  AppStore.set('activeSchema', DEFAULT_SCHEMAS[0] ?? null);

  document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: [] } }));
}

// ── Helper ─────────────────────────────────────────────────────────────────
function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = (e) => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsText(file, 'utf-8');
  });
}
