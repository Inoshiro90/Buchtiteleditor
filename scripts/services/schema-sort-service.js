// scripts/services/schema-sort-service.js
// Sort comparators + manual drag-and-drop order for Nomen/Adjektiv/Defektiv class lists.

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

const SORT_KEY  = 'btg-editor-sort';
const ORDER_KEY = 'btg-editor-order'; // manual drag-and-drop order per group

// ── Persistence ────────────────────────────────────────────────────────────
function loadPrefs(key) {
  try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; }
}
function savePrefs(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

export function getSortMode(group)        { return loadPrefs(SORT_KEY)[group]  ?? 'default'; }
export function setSortMode(group, mode)  {
  const p = loadPrefs(SORT_KEY); p[group] = mode; savePrefs(SORT_KEY, p);
}

export function getManualOrder(group)         { return loadPrefs(ORDER_KEY)[group] ?? []; }
export function setManualOrder(group, idList) {
  const p = loadPrefs(ORDER_KEY); p[group] = idList; savePrefs(ORDER_KEY, p);
}

// ── Sorting ────────────────────────────────────────────────────────────────
export function sortSchemas(schemas, mode, metaMap) {
  const meta = id => metaMap[id] ?? {};

  if (mode === 'default') return schemas;

  if (mode === 'manual') {
    // Not handled here — caller uses applyManualOrder
    return schemas;
  }

  const copy = [...schemas];
  const cmp = {
    'alpha-asc':     (a, b) => a.label.localeCompare(b.label, 'de', { sensitivity: 'base' }),
    'alpha-desc':    (a, b) => b.label.localeCompare(a.label, 'de', { sensitivity: 'base' }),
    'count-desc':    (a, b) => (meta(b.id).rowCount ?? 0) - (meta(a.id).rowCount ?? 0),
    'count-asc':     (a, b) => (meta(a.id).rowCount ?? 0) - (meta(b.id).rowCount ?? 0),
    'modified-desc': (a, b) => (meta(b.id).modifiedAt ?? 0) - (meta(a.id).modifiedAt ?? 0),
    'modified-asc':  (a, b) => (meta(a.id).modifiedAt ?? 0) - (meta(b.id).modifiedAt ?? 0),
    'created-desc':  (a, b) => (meta(b.id).createdAt ?? 0) - (meta(a.id).createdAt ?? 0),
    'created-asc':   (a, b) => (meta(a.id).createdAt ?? 0) - (meta(b.id).createdAt ?? 0),
    'accessed-desc': (a, b) => (meta(b.id).lastAccessedAt ?? 0) - (meta(a.id).lastAccessedAt ?? 0),
  }[mode];

  if (!cmp) return copy;
  return copy.sort((a, b) => {
    const p = cmp(a, b);
    return p !== 0 ? p : a.label.localeCompare(b.label, 'de', { sensitivity: 'base' });
  });
}

/**
 * Apply saved manual order to a schema list.
 * Schemas not in the saved order are appended at the end.
 */
export function applyManualOrder(schemas, group) {
  const order = getManualOrder(group);
  if (!order.length) return schemas;
  const orderMap = new Map(order.map((id, i) => [id, i]));
  const inOrder  = [...schemas].sort((a, b) => {
    const ai = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
    const bi = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
    return ai - bi;
  });
  return inOrder;
}

// ── Badge value ────────────────────────────────────────────────────────────
export function getSortBadgeValue(schemaId, mode, metaMap) {
  const m = metaMap[schemaId] ?? {};
  switch (mode) {
    case 'count-desc':
    case 'count-asc':
      return m.rowCount != null ? String(m.rowCount) : '';
    case 'modified-desc':
    case 'modified-asc':
      return m.modifiedAt ? relativeTime(m.modifiedAt) : '';
    case 'created-desc':
    case 'created-asc':
      return m.createdAt ? formatDate(m.createdAt) : '';
    case 'accessed-desc':
      return m.lastAccessedAt ? relativeTime(m.lastAccessedAt) : '';
    default:
      return m.rowCount != null ? String(m.rowCount) : '';
  }
}

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
  return new Date(ts).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}
