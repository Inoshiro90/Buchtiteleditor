// scripts/ui/sidebar.js
import { AppStore }    from '../store/AppStore.js';
import { db }          from '../db/db.js';
import { deleteClass } from './modals/new-class.js';
import { icon, icon14 } from './icons.js';
import { getAllMeta, touchModified, setRowCount } from '../services/schema-meta-service.js';
import {
  SORT_MODES, getSortMode, setSortMode,
  sortSchemas, applyManualOrder, getManualOrder, setManualOrder,
  getSortBadgeValue,
} from '../services/schema-sort-service.js';

// ── Constants ──────────────────────────────────────────────────────────────
const SORTABLE_GROUPS = new Set(['nomen', 'adjektiv', 'defektiv']);
const GROUP_ORDER     = ['genre', 'nomen', 'defektiv', 'adjektiv'];

const GROUP_LABELS = {
  genre:    `${icon14('drama')} Genre`,
  nomen:    `${icon14('boxes')} Nomen`,
  defektiv: `${icon14('hash')} Defektiva`,
  adjektiv: `${icon14('shapes')} Adjektive`,
};

const ICON_X = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_SORT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>`;
const ICON_EDIT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;

// ── State ──────────────────────────────────────────────────────────────────
let _metaMap = {};
let _container = null;
let _activeDropdown = null;
let _dragState = null; // { group, dragId, items }

// ── Init ───────────────────────────────────────────────────────────────────
export async function initSidebar(container) {
  _container = container;

  // Pre-load row counts for ALL schemas from DB — fixes sort before first open
  _metaMap = await getAllMeta();
  const schemas = AppStore.get('schemas') ?? [];
  for (const schema of schemas) {
    if (_metaMap[schema.id]?.rowCount == null) {
      const rows = await db.get('tables', schema.id);
      if (rows != null) {
        await setRowCount(schema.id, rows.length);
        if (!_metaMap[schema.id]) _metaMap[schema.id] = {};
        _metaMap[schema.id].rowCount = rows.length;
      }
    }
  }

  render(container);

  AppStore.on('schemas',      () => { getAllMeta().then(m => { _metaMap = m; render(container); }); });
  AppStore.on('activeSchema', () => render(container));
  AppStore.on('rows',         () => {
    getAllMeta().then(m => { _metaMap = m; render(container); });
  });
}

// ── Render ─────────────────────────────────────────────────────────────────
function render(container) {
  const schemas = AppStore.get('schemas') ?? [];
  const active  = AppStore.get('activeSchema');

  // Group schemas
  const groups = {};
  schemas.forEach(s => {
    const g = s.group ?? 'nomen';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  // Enforce group order
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
        const sortMode = SORTABLE_GROUPS.has(group) ? getSortMode(group) : 'default';
        const sorted   = SORTABLE_GROUPS.has(group)
          ? (sortMode === 'manual' ? applyManualOrder(items, group) : sortSchemas(items, sortMode, _metaMap))
          : items;
        const isDraggable = SORTABLE_GROUPS.has(group) && sortMode === 'manual';

        return `
        <div class="sidebar-group" data-group="${group}">
          <div class="sidebar-group-label">
            <span class="sidebar-group-label-text">${GROUP_LABELS[group] ?? group}</span>
            ${SORTABLE_GROUPS.has(group) ? `
              <div class="sidebar-sort-wrap">
                <button class="sidebar-sort-btn" data-group="${group}"
                  title="Sortierung: ${SORT_MODES.find(m => m.id === sortMode)?.label ?? sortMode}">
                  ${ICON_SORT}
                  <span class="sidebar-sort-label">${shortSortLabel(sortMode)}</span>
                </button>
              </div>
            ` : ''}
          </div>
          <div class="sidebar-items-list" data-group="${group}" data-draggable="${isDraggable}">
            ${sorted.map(s => {
              const badge = getSortBadgeValue(s.id, sortMode, _metaMap);
              return `
              <button
                class="sidebar-item ${active?.id === s.id ? 'active' : ''}"
                data-schema-id="${s.id}"
                draggable="${isDraggable}"
                title="${s.label}${badge ? ` (${badge})` : ''}"
              >
                <span class="sidebar-drag-handle ${isDraggable ? '' : 'hidden'}" aria-hidden="true">⠿</span>
                <span class="sidebar-item-icon">${getIcon(s.type)}</span>
                <span class="sidebar-item-label" data-label-id="${s.id}">${s.label}</span>
                ${badge ? `<span class="sidebar-item-badge">${badge}</span>` : ''}
                ${s.type !== 'genre' ? `
                  <span class="sidebar-item-rename" data-rename-id="${s.id}" title="Umbenennen">${ICON_EDIT}</span>
                  <span class="sidebar-item-delete" data-delete-id="${s.id}" title="Klasse löschen">${ICON_X}</span>
                ` : ''}
              </button>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="sidebar-footer">
      <button class="sidebar-new-class-btn" id="btn-new-class">
        ${icon14('list-plus')} Neue Klasse
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-database">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
        Datenbank
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-batch">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Batch
      </button>
    </div>
  `;

  bindEvents(container, schemas);
}

// ── Event Binding ──────────────────────────────────────────────────────────
function bindEvents(container, schemas) {
  // Schema item clicks
  container.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.addEventListener('click', e => {
      if (e.target.closest('.sidebar-item-delete')) {
        e.stopPropagation();
        deleteClass(e.target.closest('.sidebar-item-delete').dataset.deleteId);
        return;
      }
      if (e.target.closest('.sidebar-item-rename')) {
        e.stopPropagation();
        startRename(e.target.closest('.sidebar-item-rename').dataset.renameId, container);
        return;
      }
      const id = btn.dataset.schemaId;
      const schema = schemas.find(s => s.id === id);
      if (schema) AppStore.set('activeSchema', schema);
    });

    // Double-click label → rename
    btn.querySelector('.sidebar-item-label')?.addEventListener('dblclick', e => {
      e.stopPropagation();
      startRename(btn.dataset.schemaId, container);
    });
  });

  // Sort buttons
  container.querySelectorAll('.sidebar-sort-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openSortDropdown(btn, btn.dataset.group, container);
    });
  });

  // Drag-and-drop on manual-sort lists
  container.querySelectorAll('.sidebar-items-list[data-draggable="true"]').forEach(list => {
    bindDragDrop(list, list.dataset.group);
  });

  // Footer
  container.querySelector('#btn-new-class')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-new-class')));
  container.querySelector('#btn-database')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-database')));
  container.querySelector('#btn-batch')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-batch')));

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

// ── Rename ─────────────────────────────────────────────────────────────────
function startRename(schemaId, container) {
  const schemas = AppStore.get('schemas') ?? [];
  const schema  = schemas.find(s => s.id === schemaId);
  if (!schema) return;

  const labelEl = container.querySelector(`[data-label-id="${schemaId}"]`);
  if (!labelEl) return;

  const currentLabel = schema.label;
  const parentBtn    = labelEl.closest('.sidebar-item');

  // Replace label span with an input
  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = currentLabel;
  input.className = 'sidebar-rename-input';
  input.style.cssText = [
    'flex:1', 'min-width:0', 'border:none', 'outline:none',
    'background:var(--color-accent)', 'color:#fff', 'border-radius:3px',
    'padding:0 4px', 'font-size:12px', 'font-family:var(--font-sans)',
    'font-weight:600', 'height:20px',
  ].join(';');

  labelEl.replaceWith(input);
  parentBtn?.classList.add('renaming');
  input.focus();
  input.select();

  const commit = async () => {
    const newLabel = input.value.trim();
    input.removeEventListener('blur', commit);
    input.removeEventListener('keydown', onKey);

    // Restore label span (with new or old value)
    const span = document.createElement('span');
    span.className = 'sidebar-item-label';
    span.dataset.labelId = schemaId;
    span.textContent = newLabel || currentLabel;
    input.replaceWith(span);
    parentBtn?.classList.remove('renaming');

    if (!newLabel || newLabel === currentLabel) return;

    // Update schema label in AppStore and DB
    const updated = schemas.map(s =>
      s.id === schemaId ? { ...s, label: newLabel } : s
    );
    AppStore.set('schemas', updated);

    // Persist: update custom schemas in DB
    const custom = updated.filter(s => s.custom === true);
    await db.set('schemas', 'custom', custom);

    // Update toolbar if this is the active schema
    const active = AppStore.get('activeSchema');
    if (active?.id === schemaId) {
      AppStore.set('activeSchema', { ...active, label: newLabel });
    }

    // Re-render sidebar with updated label
    render(container);
  };

  const cancel = () => {
    input.removeEventListener('blur', commit);
    input.removeEventListener('keydown', onKey);
    const span = document.createElement('span');
    span.className = 'sidebar-item-label';
    span.dataset.labelId = schemaId;
    span.textContent = currentLabel;
    input.replaceWith(span);
    parentBtn?.classList.remove('renaming');
  };

  const onKey = (e) => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', onKey);
}

// ── Drag & Drop ────────────────────────────────────────────────────────────
function bindDragDrop(list, group) {
  let dragEl = null;

  list.querySelectorAll('.sidebar-item').forEach(item => {
    item.addEventListener('dragstart', e => {
      dragEl = item;
      item.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    item.addEventListener('dragend', () => {
      dragEl = null;
      item.classList.remove('dragging');
      list.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('drag-over'));

      // Save new order
      const newOrder = [...list.querySelectorAll('.sidebar-item')]
        .map(el => el.dataset.schemaId)
        .filter(Boolean);
      setManualOrder(group, newOrder);
    });

    item.addEventListener('dragover', e => {
      e.preventDefault();
      if (!dragEl || dragEl === item) return;
      e.dataTransfer.dropEffect = 'move';

      // Insert dragEl before or after this item based on pointer position
      const rect = item.getBoundingClientRect();
      const mid  = rect.top + rect.height / 2;
      list.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');

      if (e.clientY < mid) {
        list.insertBefore(dragEl, item);
      } else {
        list.insertBefore(dragEl, item.nextSibling);
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
  });
}

// ── Sort Dropdown ──────────────────────────────────────────────────────────
function openSortDropdown(anchorBtn, group, sidebarContainer) {
  _activeDropdown?.remove();
  _activeDropdown = null;

  const current  = getSortMode(group);
  const dropdown = document.createElement('div');
  dropdown.className = 'sidebar-sort-dropdown';
  dropdown.innerHTML = SORT_MODES.map(m => `
    <button class="sidebar-sort-option ${m.id === current ? 'active' : ''}" data-mode="${m.id}">
      ${m.id === current
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`
        : '<span style="width:12px;display:inline-block"></span>'}
      ${m.label}
    </button>
  `).join('');

  const rect = anchorBtn.getBoundingClientRect();
  dropdown.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left}px;z-index:9999;`;
  document.body.appendChild(dropdown);
  _activeDropdown = dropdown;

  dropdown.querySelectorAll('.sidebar-sort-option').forEach(opt => {
    opt.addEventListener('click', () => {
      setSortMode(group, opt.dataset.mode);
      dropdown.remove();
      _activeDropdown = null;
      render(sidebarContainer);
    });
  });

  const onOutside = e => {
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
  return { manual:'Manuell', default:'Standard', 'alpha-asc':'A→Z', 'alpha-desc':'Z→A',
    'count-desc':'Meiste', 'count-asc':'Wenigste', 'modified-desc':'Geändert',
    'modified-asc':'Älteste Änd.', 'created-desc':'Erstellt', 'created-asc':'Älteste',
    'accessed-desc':'Geöffnet' }[mode] ?? mode;
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

// ── Theme ──────────────────────────────────────────────────────────────────
export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem('btg-editor-theme', theme); } catch (_) {}
}

export function restoreTheme() {
  let saved = null;
  try { saved = localStorage.getItem('btg-editor-theme'); } catch (_) {}
  if (!saved) saved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  setTheme(saved);
}

function updateThemeIcon(btn) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  btn.innerHTML = isDark
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`;
  btn.title = isDark ? 'Zu Light Mode wechseln' : 'Zu Dark Mode wechseln';
}
