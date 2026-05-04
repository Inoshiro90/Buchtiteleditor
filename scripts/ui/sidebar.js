// scripts/ui/sidebar.js
import { AppStore }    from '../store/AppStore.js';
import { deleteClass } from './modals/new-class.js';
import { icon, icon14 } from './icons.js';
import { getAllMeta }  from '../services/schema-meta-service.js';
import {
  SORT_MODES, getSortMode, setSortMode,
  sortSchemas, getSortBadgeValue,
} from '../services/schema-sort-service.js';

// ── Constants ──────────────────────────────────────────────────────────────
const SORTABLE_GROUPS = new Set(['nomen', 'adjektiv', 'defektiv']);

const GROUP_LABELS = {
  genre:    `${icon14('drama')} Genre`,
  nomen:    `${icon14('boxes')} Nomen`,
  defektiv: `${icon14('hash')} Defektiva`,
  adjektiv: `${icon14('shapes')} Adjektive`,
};

const ICON_X = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">
  <path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

const ICON_SORT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
  stroke-linejoin="round" aria-hidden="true">
  <path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>`;

// ── State ──────────────────────────────────────────────────────────────────
let _metaMap = {};  // { [schemaId]: { rowCount, modifiedAt, createdAt, lastAccessedAt } }

// ── Init ───────────────────────────────────────────────────────────────────
export async function initSidebar(container) {
  _metaMap = await getAllMeta();
  render(container);

  AppStore.on('schemas',      () => rerender(container));
  AppStore.on('activeSchema', () => rerender(container));
  // Refresh metadata badges when rows change (count updates)
  AppStore.on('rows', () => {
    getAllMeta().then(m => { _metaMap = m; rerender(container); });
  });
}

function rerender(container) {
  render(container);
}

// ── Render ─────────────────────────────────────────────────────────────────
function render(container) {
  const schemas = AppStore.get('schemas') ?? [];
  const active  = AppStore.get('activeSchema');

  // Group schemas
  const groups = {};
  schemas.forEach((s) => {
    const g = s.group ?? 'nomen';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  // Enforce sidebar group order
  const GROUP_ORDER = ['genre', 'nomen', 'defektiv', 'adjektiv'];
  const orderedGroups = GROUP_ORDER
    .filter(g => groups[g])
    .map(g => [g, groups[g]])
    .concat(Object.entries(groups).filter(([g]) => !GROUP_ORDER.includes(g)));

  container.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">${icon('square-library', 14)}</div>
      <span class="sidebar-title">Buchtiteleditor</span>
      <button class="theme-toggle" id="btn-theme-toggle" title="Theme umschalten" aria-label="Theme umschalten"></button>
    </div>
    <div class="sidebar-nav">
      ${orderedGroups.map(([group, items]) => {
        const sortMode    = SORTABLE_GROUPS.has(group) ? getSortMode(group) : 'default';
        const sorted      = SORTABLE_GROUPS.has(group)
          ? sortSchemas(items, sortMode, _metaMap)
          : items;
        const sortLabel   = SORT_MODES.find(m => m.id === sortMode)?.label ?? 'Standard';

        return `
        <div class="sidebar-group" data-group="${group}">
          <div class="sidebar-group-label">
            <span class="sidebar-group-label-text">${GROUP_LABELS[group] ?? group}</span>
            ${SORTABLE_GROUPS.has(group) ? `
              <div class="sidebar-sort-wrap">
                <button class="sidebar-sort-btn" data-group="${group}"
                  title="Sortierung: ${sortLabel}">
                  ${ICON_SORT}
                  <span class="sidebar-sort-label">${shortSortLabel(sortMode)}</span>
                </button>
              </div>
            ` : ''}
          </div>
          ${sorted.map((s) => {
            const badge = getSortBadgeValue(s.id, sortMode, _metaMap);
            return `
            <button
              class="sidebar-item ${active?.id === s.id ? 'active' : ''}"
              data-schema-id="${s.id}"
              title="${s.label}${badge ? ` (${badge})` : ''}"
            >
              <span class="sidebar-item-icon">${getIcon(s.type)}</span>
              <span class="sidebar-item-label">${s.label}</span>
              ${badge ? `<span class="sidebar-item-badge">${badge}</span>` : ''}
              ${s.type !== 'genre' ? `
                <span class="sidebar-item-delete" data-delete-id="${s.id}" title="Klasse löschen">
                  ${ICON_X}
                </span>` : ''}
            </button>`;
          }).join('')}
        </div>`;
      }).join('')}
    </div>
    <div class="sidebar-footer">
      <button class="sidebar-new-class-btn" id="btn-new-class" title="Neue Klasse hinzufügen">
        ${icon14('list-plus')} Neue Klasse
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-database" title="Datenbank verwalten">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
        Datenbank
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-batch" title="Batch-Export / Batch-Import">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Batch
      </button>
    </div>
  `;

  // ── Event listeners ──────────────────────────────────────────────────────
  // Schema items
  container.querySelectorAll('.sidebar-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-item-delete')) {
        e.stopPropagation();
        const id = e.target.closest('.sidebar-item-delete').dataset.deleteId;
        deleteClass(id);
        return;
      }
      const id     = btn.dataset.schemaId;
      const schema = schemas.find((s) => s.id === id);
      if (schema) AppStore.set('activeSchema', schema);
    });
  });

  // Sort buttons → open inline dropdown
  container.querySelectorAll('.sidebar-sort-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSortDropdown(btn, btn.dataset.group, container);
    });
  });

  // Footer buttons
  container.querySelector('#btn-new-class')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:open-new-class'));
  });
  container.querySelector('#btn-database')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:open-database'));
  });
  container.querySelector('#btn-batch')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:open-batch'));
  });

  // Theme toggle
  const toggleBtn = container.querySelector('#btn-theme-toggle');
  if (toggleBtn) {
    updateThemeIcon(toggleBtn);
    toggleBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      setTheme(isDark ? 'light' : 'dark');
      updateThemeIcon(toggleBtn);
    });
  }
}

// ── Sort dropdown ──────────────────────────────────────────────────────────
let _activeDropdown = null;

function openSortDropdown(anchorBtn, group, sidebarContainer) {
  // Close existing
  _activeDropdown?.remove();
  _activeDropdown = null;

  const current = getSortMode(group);
  const dropdown = document.createElement('div');
  dropdown.className = 'sidebar-sort-dropdown';
  dropdown.innerHTML = SORT_MODES.map(m => `
    <button class="sidebar-sort-option ${m.id === current ? 'active' : ''}"
            data-mode="${m.id}">
      ${m.id === current ? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>` : '<span style="width:12px;display:inline-block"></span>'}
      ${m.label}
    </button>
  `).join('');

  // Position relative to the anchor button
  const rect = anchorBtn.getBoundingClientRect();
  dropdown.style.cssText = `
    position: fixed;
    top: ${rect.bottom + 4}px;
    left: ${rect.left}px;
    z-index: 9999;
  `;

  document.body.appendChild(dropdown);
  _activeDropdown = dropdown;

  dropdown.querySelectorAll('.sidebar-sort-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const mode = opt.dataset.mode;
      setSortMode(group, mode);
      dropdown.remove();
      _activeDropdown = null;
      render(sidebarContainer); // re-render sidebar with new sort
    });
  });

  // Close on outside click
  const onOutside = (e) => {
    if (!dropdown.contains(e.target) && e.target !== anchorBtn) {
      dropdown.remove();
      _activeDropdown = null;
      document.removeEventListener('click', onOutside, true);
    }
  };
  setTimeout(() => document.addEventListener('click', onOutside, true), 0);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function shortSortLabel(mode) {
  const map = {
    'default':       'Standard',
    'alpha-asc':     'A→Z',
    'alpha-desc':    'Z→A',
    'count-desc':    'Meiste',
    'count-asc':     'Wenigste',
    'modified-desc': 'Geändert',
    'modified-asc':  'Älteste Änd.',
    'created-desc':  'Erstellt',
    'created-asc':   'Älteste',
    'accessed-desc': 'Geöffnet',
  };
  return map[mode] ?? mode;
}

function getIcon(type) {
  switch (type) {
    case 'genre':      return icon14('table-properties');
    case 'nomen':      return icon14('box');
    case 'adjektiv':   return icon14('triangle');
    case 'defektivum': return icon14('asterisk');
    default:           return icon14('box');
  }
}

// ── Theme helpers ──────────────────────────────────────────────────────────
export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('btg-editor-theme', theme); } catch (_) {}
}

export function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem('btg-editor-theme'); } catch (_) {}
  if (!saved) {
    saved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  setTheme(saved);
}

function updateThemeIcon(btn) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
  btn.title = isDark ? 'Zu Light Mode wechseln' : 'Zu Dark Mode wechseln';
}
