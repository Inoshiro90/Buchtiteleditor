// scripts/services/backup-service.js
// JSON-Export, -Import und Datenbank-Reset

import { db }              from '../db/db.js';
import { AppStore }        from '../store/AppStore.js';
import { DEFAULT_SCHEMAS, NOMEN_COLUMNS, ADJ_COLUMNS, DEFEKTIV_COLUMNS, GENRE_COLUMNS } from '../db/schemas.js';

// ── Typ → Exportgruppe ─────────────────────────────────────────────────────
function typeToGroup(type) {
  switch (type) {
    case 'genre':      return 'genre';
    case 'nomen':      return 'nomen';
    case 'defektivum': return 'defektiva';
    case 'adjektiv':   return 'adjektive';
    default:           return 'nomen';
  }
}

// Umgekehrt: Exportgruppe → Typ
function groupToType(group) {
  switch (group) {
    case 'genre':    return 'genre';
    case 'nomen':    return 'nomen';
    case 'defektiva':return 'defektivum';
    case 'adjektive':return 'adjektiv';
    default:         return 'nomen';
  }
}

// ── Dateiname ──────────────────────────────────────────────────────────────
function buildFilename() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `Buchtiteleditor_${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
       + `_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}.json`;
}

// ── Interne Felder entfernen ───────────────────────────────────────────────
function stripMeta(row) {
  const r = { ...row };
  delete r._isDuplicate;
  delete r._isCrossClassDuplicate;
  delete r._crossClassDuplicateOf;
  delete r._id;
  return r;
}

// ── Export ─────────────────────────────────────────────────────────────────
/**
 * Exportiert alle Tabellen als JSON mit der Struktur:
 * {
 *   version, exportedAt, customSchemas,
 *   tables: {
 *     genre:    { "genre": [{...}] },
 *     nomen:    { "Waffe": [{...}], "Tier": [{...}], ... },
 *     defektiva:{ "Gebirge": [{...}], ... },
 *     adjektive:{ "PersonAussehen": [{...}], ... }
 *   }
 * }
 */
export async function exportDatabaseAsJSON() {
  const schemas    = AppStore.get('schemas') ?? [];
  const storedKeys = await db.keys('tables');

  // Build a lookup: schemaId → type
  const schemaTypeMap = new Map(schemas.map(s => [s.id, s.type ?? 'nomen']));

  // Initialize grouped structure
  const tables = {
    genre:     {},
    nomen:     {},
    defektiva: {},
    adjektive: {},
  };

  for (const key of storedKeys) {
    const rows     = await db.get('tables', key);
    const cleaned  = (rows ?? []).map(stripMeta);
    const schemaType = schemaTypeMap.get(key) ?? 'nomen';
    const group      = typeToGroup(schemaType);
    tables[group][key] = cleaned;
  }

  const customSchemas = schemas.filter(s => s.custom === true);

  const payload = {
    version:      2,
    exportedAt:   new Date().toISOString(),
    customSchemas,
    tables,
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
 * Akzeptiert sowohl v1- (flaches tables-Objekt) als auch v2-Format (gruppiert).
 * Fehlende Klassen werden automatisch angelegt.
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

  const errors  = [];
  let imported  = 0;

  // ── Normalize to flat { schemaId: { rows, type } } ──────────────────────
  const flatTables = {};

  if (payload.version >= 2 || isGroupedFormat(payload.tables)) {
    // v2: grouped format
    for (const [group, classMap] of Object.entries(payload.tables)) {
      const type = groupToType(group);
      if (typeof classMap !== 'object' || Array.isArray(classMap)) continue;
      for (const [schemaId, rows] of Object.entries(classMap)) {
        flatTables[schemaId] = { rows, type };
      }
    }
  } else {
    // v1: flat format — type unknown, attempt detection from existing schemas
    const existingSchemas = AppStore.get('schemas') ?? [];
    const schemaTypeMap   = new Map(existingSchemas.map(s => [s.id, s.type ?? 'nomen']));
    for (const [schemaId, rows] of Object.entries(payload.tables)) {
      flatTables[schemaId] = {
        rows,
        type: schemaTypeMap.get(schemaId) ?? 'nomen',
      };
    }
  }

  // ── Write each table, creating missing classes as needed ─────────────────
  const existingSchemas = AppStore.get('schemas') ?? [];
  const existingIds     = new Set(existingSchemas.map(s => s.id));
  const schemasToAdd    = [];

  for (const [schemaId, { rows, type }] of Object.entries(flatTables)) {
    if (!Array.isArray(rows)) {
      errors.push(`Tabelle „${schemaId}": kein Array`);
      continue;
    }

    // Add internal IDs if missing
    const withIds = rows.map((r, i) => ({
      ...r,
      _id: r._id ?? `import_${schemaId}_${i}_${Date.now()}`,
    }));

    await db.set('tables', schemaId, withIds);
    imported++;

    // Create missing class schema
    if (!existingIds.has(schemaId)) {
      const newSchema = buildSchemaForImport(schemaId, type);
      schemasToAdd.push(newSchema);
      existingIds.add(schemaId); // prevent duplicates in this loop
    }
  }

  // ── Register new schemas ─────────────────────────────────────────────────
  if (schemasToAdd.length > 0) {
    const updated = [...existingSchemas, ...schemasToAdd];
    AppStore.set('schemas', updated);
    const custom = updated.filter(s => s.custom === true);
    await db.set('schemas', 'custom', custom);
  }

  // ── Restore custom schemas from backup (e.g. after a reset) ─────────────
  if (Array.isArray(payload.customSchemas) && payload.customSchemas.length > 0) {
    const currentSchemas  = AppStore.get('schemas') ?? [];
    const currentIds      = new Set(currentSchemas.map(s => s.id));
    const missingCustom   = payload.customSchemas.filter(s => !currentIds.has(s.id));
    if (missingCustom.length > 0) {
      const updated = [...currentSchemas, ...missingCustom];
      AppStore.set('schemas', updated);
      await db.set('schemas', 'custom', updated.filter(s => s.custom === true));
    }
  }

  // ── Reload active table ───────────────────────────────────────────────────
  const active = AppStore.get('activeSchema');
  if (active) {
    const freshRows = (await db.get('tables', active.id)) ?? [];
    AppStore.set('rows', freshRows);
    document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: freshRows } }));
  }

  return { imported, errors, newClasses: schemasToAdd.length };
}

// ── Reset ──────────────────────────────────────────────────────────────────
export async function resetDatabase() {
  const schemas = AppStore.get('schemas') ?? [];
  for (const schema of schemas) {
    await db.set('tables', schema.id, []);
  }

  await db.delete('schemas', 'custom');
  await db.delete('meta', 'customVariables');
  await db.delete('meta', 'initialized');
  await db.delete('meta', 'schemaMeta');
  await db.delete('meta', 'schemaOrder');

  AppStore.set('schemas', DEFAULT_SCHEMAS);
  AppStore.set('rows', []);
  AppStore.set('errors', []);
  AppStore.set('activeSchema', DEFAULT_SCHEMAS[0] ?? null);

  document.dispatchEvent(new CustomEvent('editor:rows-changed', { detail: { rows: [] } }));
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Detect if payload.tables is grouped (v2) by checking if any value is a
 * plain object (not an array) — i.e. { genre: {...}, nomen: {...} }
 */
function isGroupedFormat(tables) {
  return Object.values(tables).some(v => v !== null && typeof v === 'object' && !Array.isArray(v));
}

/**
 * Build a minimal schema object for a class that exists in the backup
 * but not in the current database.
 */
function buildSchemaForImport(id, type) {
  const columns = type === 'adjektiv'   ? ADJ_COLUMNS
                : type === 'defektivum' ? DEFEKTIV_COLUMNS
                : type === 'genre'      ? GENRE_COLUMNS
                :                        NOMEN_COLUMNS;

  const group   = type === 'adjektiv'   ? 'adjektiv'
                : type === 'defektivum' ? 'defektiv'
                : type === 'genre'      ? 'genre'
                :                        'nomen';

  const dir     = type === 'adjektiv'   ? './scripts/data/adjektive/'
                : type === 'defektivum' ? './scripts/data/defektiva/'
                : type === 'genre'      ? './scripts/data/genre/'
                :                        './scripts/data/nomen/';

  return {
    id,
    label:     id,
    file:      `${dir}${id}.csv`,
    csvFile:   `${id}.csv`,
    type,
    columns,
    lemma:     type !== 'genre' ? id : null,
    group,
    custom:    true,
    deletable: true,
  };
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden'));
    reader.readAsText(file, 'utf-8');
  });
}
