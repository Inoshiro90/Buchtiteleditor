// scripts/ui/sidebar.js
//
// Änderung 1: Virtuelle Klassen als Dialog-Button (Panel entfernt)
// Problem 3: Sidebar Rename — vollständige Neuimplementierung ohne blur-Hack
//
// Root Cause Problem 3:
//   render(container) wird durch AppStore.on('rows'/'schemas'/'activeSchema') getriggert.
//   Das zerstört das Input-Element mitten im Edit → blur feuert auf entferntem Element
//   → document.activeElement ist nicht mehr der Input → setTimeout-Prüfung schlägt fehl.
//
// Fix:
//   _renameActive-Flag: render() wird übersprungen solange ein Rename läuft.
//   Nach commit/cancel wird ein aufgeschobener Render nachgeholt.
//   Kein blur-basiertes Schließen mehr — stattdessen pointerdown auf document.

import { AppStore }    from '../store/AppStore.js';
import { db }          from '../db/db.js';
import { deleteClass } from './modals/new-class.js';
import { icon, icon14 } from './icons.js';
import { getAllMeta, setRowCount } from '../services/schema-meta-service.js';
import {
  SORT_MODES, getSortMode, setSortMode,
  sortSchemas, applyManualOrder, setManualOrder,
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

const ICON_X    = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_EDIT = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const ICON_SORT = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M7 12h10"/><path d="M10 18h4"/></svg>`;
const ICON_DRAG = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>`;

// ── State ──────────────────────────────────────────────────────────────────
let _metaMap        = {};
let _activeDropdown = null;

// Problem 3 Fix: verhindert render() während ein Rename-Edit aktiv ist
let _renameActive   = false;
let _pendingRender  = false;
let _sidebarContainer = null;

// ── Init ───────────────────────────────────────────────────────────────────
export async function initSidebar(container) {
  _sidebarContainer = container;
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

  // Alle Store-Listener — werden durch _renameActive geblockt
  AppStore.on('schemas',        () => { getAllMeta().then(m => { _metaMap = m; scheduleRender(container); }); });
  AppStore.on('activeSchema',   () => scheduleRender(container));
  AppStore.on('rows',           () => { getAllMeta().then(m => { _metaMap = m; scheduleRender(container); }); });
  AppStore.on('virtualClasses', () => scheduleRender(container));
}

/** Rendert sofort oder merkt sich einen ausstehenden Render für nach dem Rename. */
function scheduleRender(container) {
  if (_renameActive) {
    _pendingRender = true;
  } else {
    render(container);
  }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render(container) {
  const nav         = container.querySelector('.sidebar-nav');
  const savedScroll = nav ? nav.scrollTop : 0;

  const schemas = AppStore.get('schemas') ?? [];
  const active  = AppStore.get('activeSchema');

  const groups = {};
  schemas.forEach(s => {
    const g = s.group ?? 'nomen';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  const orderedGroups = GROUP_ORDER
    .filter(g => groups[g])
    .map(g => [g, groups[g]])
    .concat(Object.entries(groups).filter(([g]) => !GROUP_ORDER.includes(g)));

  container.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">${icon('square-library', 14)}</div>
      <span class="sidebar-title">Buchtiteleditor</span>
      <button class="theme-toggle" id="btn-theme-toggle" aria-label="Theme umschalten"></button>
    </div>
    <div class="sidebar-nav">
      ${orderedGroups.map(([group, items]) => {
        const sortMode  = SORTABLE_GROUPS.has(group) ? getSortMode(group) : 'default';
        const baseOrder = SORTABLE_GROUPS.has(group) ? applyManualOrder(items, group) : items;
        const sorted    = sortMode === 'default' ? baseOrder : sortSchemas(baseOrder, sortMode, _metaMap);

        return `
        <div class="sidebar-group" data-group="${group}">
          <div class="sidebar-group-label">
            <span class="sidebar-group-label-text">${GROUP_LABELS[group] ?? group}</span>
            ${SORTABLE_GROUPS.has(group) ? `
              <button class="sidebar-sort-btn" data-group="${group}"
                title="Sortierung: ${SORT_MODES.find(m => m.id === sortMode)?.label ?? sortMode}">
                ${ICON_SORT}
                <span class="sidebar-sort-label">${shortSortLabel(sortMode)}</span>
              </button>
            ` : ''}
          </div>
          <div class="sidebar-items-list" data-group="${group}">
            ${sorted.map(s => {
              const badge    = getSortBadgeValue(s.id, sortMode, _metaMap);
              const isActive = active?.id === s.id;
              return `
              <div class="sidebar-item-row ${isActive ? 'active' : ''}" data-schema-id="${s.id}">
                <span class="sidebar-drag-handle" data-drag="${s.id}" title="Verschieben" aria-label="Verschieben">
                  ${ICON_DRAG}
                </span>
                <button class="sidebar-item-nav" data-nav-id="${s.id}" title="${s.label}">
                  <span class="sidebar-item-icon">${getIcon(s.type)}</span>
                  <span class="sidebar-item-label" data-label-id="${s.id}">${s.label}</span>
                  ${badge ? `<span class="sidebar-item-badge">${badge}</span>` : ''}
                </button>
                ${s.type !== 'genre' ? `
                  <span class="sidebar-item-actions">
                    <button class="sidebar-action-btn sidebar-rename-btn"
                      data-rename-id="${s.id}" title="Umbenennen" aria-label="Umbenennen">
                      ${ICON_EDIT}
                    </button>
                    <button class="sidebar-action-btn sidebar-delete-btn"
                      data-delete-id="${s.id}" title="Löschen" aria-label="Löschen">
                      ${ICON_X}
                    </button>
                  </span>
                ` : ''}
              </div>`;
            }).join('')}
          </div>
        </div>`;
      }).join('')}
    </div>
    <div class="sidebar-footer">
      <button class="sidebar-new-class-btn" id="btn-new-class">${icon14('list-plus')} Neue Klasse</button>
      <!-- Änderung 1: Virtuelle Klassen als Dialog-Button -->
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-virtual-classes" title="Virtuelle Klassen verwalten">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>
        </svg>
        Virtuelle Klassen
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-database">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M3 5V19A9 3 0 0 0 21 19V5"/>
          <path d="M3 12A9 3 0 0 0 21 12"/>
        </svg>
        Datenbank
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-class-map" title="Klassen-Map für Buchtitelgenerator">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        Klassen-Map
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-batch">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Batch
      </button>
    </div>
  `;

  const newNav = container.querySelector('.sidebar-nav');
  if (newNav && savedScroll > 0) newNav.scrollTop = savedScroll;

  bindEvents(container, schemas);
}

// ── Events ─────────────────────────────────────────────────────────────────
function bindEvents(container, schemas) {

  container.querySelectorAll('.sidebar-item-nav').forEach(btn => {
    let _touchHandled = false;

    btn.addEventListener('touchend', e => {
      _touchHandled = true;
      e.preventDefault();
      e.stopPropagation();
      const schema = schemas.find(s => s.id === btn.dataset.navId);
      if (schema) AppStore.set('activeSchema', schema);
    }, { passive: false });

    btn.addEventListener('click', e => {
      if (_touchHandled) { _touchHandled = false; return; }
      const schema = schemas.find(s => s.id === btn.dataset.navId);
      if (schema) AppStore.set('activeSchema', schema);
    });

    btn.querySelector('.sidebar-item-label')?.addEventListener('dblclick', e => {
      e.stopPropagation();
      startRename(btn.dataset.navId, container, schemas);
    });
  });

  container.querySelectorAll('.sidebar-rename-btn').forEach(btn => {
    let _touchHandled = false;

    btn.addEventListener('touchend', e => {
      _touchHandled = true;
      e.preventDefault();
      e.stopPropagation();
      startRename(btn.dataset.renameId, container, schemas);
    }, { passive: false });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_touchHandled) { _touchHandled = false; return; }
      startRename(btn.dataset.renameId, container, schemas);
    });
  });

  container.querySelectorAll('.sidebar-delete-btn').forEach(btn => {
    let _touchHandled = false;

    btn.addEventListener('touchend', e => {
      _touchHandled = true;
      e.preventDefault();
      e.stopPropagation();
      deleteClass(btn.dataset.deleteId);
    }, { passive: false });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (_touchHandled) { _touchHandled = false; return; }
      deleteClass(btn.dataset.deleteId);
    });
  });

  container.querySelectorAll('.sidebar-sort-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openSortDropdown(btn, btn.dataset.group, container);
    });
  });

  container.querySelectorAll('.sidebar-items-list').forEach(list => {
    bindDragDrop(list, list.dataset.group, container);
  });

  // Footer buttons
  container.querySelector('#btn-new-class')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-new-class')));

  // Änderung 1: Virtuelle Klassen Dialog
  container.querySelector('#btn-virtual-classes')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-virtual-classes')));
  container.querySelector('#btn-class-map')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-class-map')));

  container.querySelector('#btn-database')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-database')));

  container.querySelector('#btn-batch')?.addEventListener('click', () =>
    document.dispatchEvent(new CustomEvent('editor:open-batch')));

  const toggleBtn = container.querySelector('#btn-theme-toggle');
  if (toggleBtn) {
    updateThemeIcon(toggleBtn);
    toggleBtn.addEventListener('click', () => {
      setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
      updateThemeIcon(toggleBtn);
    });
  }
}

// ── Rename ─────────────────────────────────────────────────────────────────
// Problem 3 Fix: Vollständige Neuimplementierung
//
// Strategie:
//   1. _renameActive = true → render() wird übersprungen (scheduleRender merkt Pending)
//   2. Kein blur-basiertes Schließen
//   3. pointerdown auf document erkennt "außerhalb" — aber NICHT wenn Target der Input selbst ist
//   4. Nach commit/cancel: _renameActive = false → ausstehende Renders nachholen
//
function startRename(schemaId, container, schemas) {
  const schema = schemas.find(s => s.id === schemaId);
  if (!schema) return;
  if (_renameActive) return; // Verhindert doppelten Start

  const labelEl = container.querySelector(`[data-label-id="${schemaId}"]`);
  if (!labelEl) return;

  const currentLabel = schema.label;

  // Phase 1: Input erstellen und einfügen
  const input = document.createElement('input');
  input.type      = 'text';
  input.value     = currentLabel;
  input.className = 'sidebar-rename-input';

  _renameActive  = true;
  _pendingRender = false;
  labelEl.replaceWith(input);
  input.focus();
  input.select();

  // Phase 2: Event-Handler
  const onKey = e => {
    if (e.key === 'Enter')  { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    // Alle anderen Keys (inkl. Pfeile, Pos1, Ende, Backspace) normal durchlassen
  };

  // pointerdown außerhalb des Inputs → commit
  // WICHTIG: mousedown/pointerdown auf dem Input selbst NICHT abfangen
  const onOutsidePointer = e => {
    if (e.target === input || input.contains(e.target)) return; // Klick IM Input → ignorieren
    commit();
  };

  input.addEventListener('keydown', onKey);
  // capture:true damit wir vor anderen Handlern laufen
  document.addEventListener('pointerdown', onOutsidePointer, { capture: true });

  function cleanup() {
    input.removeEventListener('keydown', onKey);
    document.removeEventListener('pointerdown', onOutsidePointer, { capture: true });
  }

  const commit = async () => {
    if (!_renameActive) return;
    cleanup();
    _renameActive = false;

    const newLabel = input.value.trim() || currentLabel;
    restoreLabel(newLabel);

    // Aufgeschobene Renders nachholen
    if (_pendingRender) {
      _pendingRender = false;
      render(container);
    }

    if (newLabel === currentLabel) return;

    const updated = schemas.map(s => s.id === schemaId ? { ...s, label: newLabel } : s);
    AppStore.set('schemas', updated);
    await db.set('schemas', 'custom', updated.filter(s => s.custom === true));
    const active = AppStore.get('activeSchema');
    if (active?.id === schemaId) AppStore.set('activeSchema', { ...active, label: newLabel });
  };

  const cancel = () => {
    if (!_renameActive) return;
    cleanup();
    _renameActive = false;
    restoreLabel(currentLabel);

    if (_pendingRender) {
      _pendingRender = false;
      render(container);
    }
  };

  function restoreLabel(text) {
    const span = document.createElement('span');
    span.className       = 'sidebar-item-label';
    span.dataset.labelId = schemaId;
    span.textContent     = text;
    if (input.parentNode) input.replaceWith(span);
  }
}

// ── Drag & Drop ────────────────────────────────────────────────────────────
function bindDragDrop(list, group, sidebarContainer) {
  if (!SORTABLE_GROUPS.has(group)) return;
  let dragRow = null;

  list.querySelectorAll('.sidebar-drag-handle').forEach(handle => {
    const row = handle.closest('.sidebar-item-row');
    if (!row) return;
    row.setAttribute('draggable', 'true');

    row.addEventListener('dragstart', e => {
      dragRow = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.sidebar-item-row').forEach(r => r.classList.remove('drag-over'));
      dragRow = null;
      saveOrder(list, group);
    });
  });

  list.addEventListener('dragover', e => {
    e.preventDefault();
    if (!dragRow) return;
    const target = e.target.closest('.sidebar-item-row');
    if (!target || target === dragRow) return;
    list.querySelectorAll('.sidebar-item-row').forEach(r => r.classList.remove('drag-over'));
    target.classList.add('drag-over');
    const rect = target.getBoundingClientRect();
    if (e.clientY < rect.top + rect.height / 2) list.insertBefore(dragRow, target);
    else list.insertBefore(dragRow, target.nextSibling);
  });

  list.addEventListener('dragleave', e => {
    if (!list.contains(e.relatedTarget)) {
      list.querySelectorAll('.sidebar-item-row').forEach(r => r.classList.remove('drag-over'));
    }
  });

  list.addEventListener('drop', e => {
    e.preventDefault();
    list.querySelectorAll('.sidebar-item-row').forEach(r => r.classList.remove('drag-over'));
    saveOrder(list, group);
  });
}

function saveOrder(list, group) {
  const ids = [...list.querySelectorAll('.sidebar-item-row')]
    .map(el => el.dataset.schemaId)
    .filter(Boolean);
  setManualOrder(group, ids);
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
  return { default:'Standard', 'alpha-asc':'A→Z', 'alpha-desc':'Z→A',
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
