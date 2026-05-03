// scripts/services/schema-sort-service.js
// Sort comparators for Nomen / Adjektiv class lists in the sidebar.
// Sort preferences are persisted per group in localStorage.

// ── Sort modes ─────────────────────────────────────────────────────────────
export const SORT_MODES = [
  { id: 'default',       label: 'Standard (Originalreihenfolge)' },
  { id: 'alpha-asc',     label: 'A → Z' },
  { id: 'alpha-desc',    label: 'Z → A' },
  { id: 'count-desc',    label: 'Meiste Einträge' },
  { id: 'count-asc',     label: 'Wenigste Einträge' },
  { id: 'modified-desc', label: 'Zuletzt geändert' },
  { id: 'modified-asc',  label: 'Älteste Änderung' },
  { id: 'created-desc',  label: 'Zuletzt erstellt' },
  { id: 'created-asc',   label: 'Älteste zuerst' },
  { id: 'accessed-desc', label: 'Zuletzt geöffnet' },
];

const STORAGE_KEY = 'btg-editor-sort';

// ── Persistence ────────────────────────────────────────────────────────────
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
}

function savePrefs(prefs) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch {}
}

/**
 * Get the saved sort mode for a group (e.g. 'nomen', 'adjektiv').
 */
export function getSortMode(group) {
  return loadPrefs()[group] ?? 'default';
}

/**
 * Persist a sort mode for a group.
 */
export function setSortMode(group, mode) {
  const prefs = loadPrefs();
  prefs[group] = mode;
  savePrefs(prefs);
}

// ── Sorting ────────────────────────────────────────────────────────────────
/**
 * Sort a list of schemas using the given mode and metadata map.
 *
 * @param {object[]} schemas
 * @param {string}   mode         — one of SORT_MODES[*].id
 * @param {object}   metaMap      — { [schemaId]: { rowCount, modifiedAt, createdAt, lastAccessedAt } }
 * @param {number[]} defaultOrder — original indices (for stable 'default' sort)
 * @returns {object[]}
 */
export function sortSchemas(schemas, mode, metaMap, defaultOrder) {
  if (mode === 'default') return schemas; // preserve original order

  const meta = (id) => metaMap[id] ?? {};

  const copy = [...schemas];

  const comparators = {
    'alpha-asc':     (a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }),
    'alpha-desc':    (a, b) => b.label.localeCompare(a.label, 'de', { sensitivity: 'base' }),
    'count-desc':    (a, b) => (meta(b.id).rowCount ?? 0) - (meta(a.id).rowCount ?? 0),
    'count-asc':     (a, b) => (meta(a.id).rowCount ?? 0) - (meta(b.id).rowCount ?? 0),
    'modified-desc': (a, b) => (meta(b.id).modifiedAt ?? 0) - (meta(a.id).modifiedAt ?? 0),
    'modified-asc':  (a, b) => (meta(a.id).modifiedAt ?? 0) - (meta(b.id).modifiedAt ?? 0),
    'created-desc':  (a, b) => (meta(b.id).createdAt ?? 0) - (meta(a.id).createdAt ?? 0),
    'created-asc':   (a, b) => (meta(a.id).createdAt ?? 0) - (meta(b.id).createdAt ?? 0),
    'accessed-desc': (a, b) => (meta(b.id).lastAccessedAt ?? 0) - (meta(a.id).lastAccessedAt ?? 0),
  };

  const cmp = comparators[mode];
  if (!cmp) return copy;

  // Secondary sort: alpha-asc for stable ties
  return copy.sort((a, b) => {
    const primary = cmp(a, b);
    if (primary !== 0) return primary;
    return a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
  });
}

/**
 * Formatted value for a sort mode badge (shown next to count in sidebar).
 * Returns a short human-readable value or '' if not available.
 */
export function getSortBadgeValue(schemaId, mode, metaMap) {
  const meta = metaMap[schemaId] ?? {};
  switch (mode) {
    case 'count-desc':
    case 'count-asc':
      return meta.rowCount != null ? `${meta.rowCount}` : '';
    case 'modified-desc':
    case 'modified-asc':
      return meta.modifiedAt ? relativeTime(meta.modifiedAt) : '';
    case 'created-desc':
    case 'created-asc':
      return meta.createdAt ? formatDate(meta.createdAt) : '';
    case 'accessed-desc':
      return meta.lastAccessedAt ? relativeTime(meta.lastAccessedAt) : '';
    default:
      return meta.rowCount != null ? `${meta.rowCount}` : '';
  }
}

// ── Time helpers ───────────────────────────────────────────────────────────
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  const d = Math.floor(diff / 86400000);
  if (m < 1)   return 'gerade eben';
  if (m < 60)  return `vor ${m} Min.`;
  if (h < 24)  return `vor ${h} Std.`;
  if (d < 7)   return `vor ${d} Tag${d !== 1 ? 'en' : ''}`;
  return formatDate(ts);
}

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
