// editor/ui/sidebar.js
import { AppStore } from '../store/AppStore.js';
import { deleteClass } from './modals/new-class.js';
import { icon, icon14 } from './icons.js';

const GROUP_LABELS = {
  genre:    `${icon14('drama')} Genre`,
  nomen:    `${icon14('boxes')} Nomen`,
  adjektiv: `${icon14('shapes')} Adjektive`,
};

export function initSidebar(container) {
  render(container);
  AppStore.on('schemas', () => render(container));
  AppStore.on('activeSchema', () => render(container));
}

function render(container) {
  const schemas = AppStore.get('schemas') ?? [];
  const active  = AppStore.get('activeSchema');

  const groups = {};
  schemas.forEach((s) => {
    const g = s.group ?? 'custom';
    if (!groups[g]) groups[g] = [];
    groups[g].push(s);
  });

  container.innerHTML = `
    <div class="sidebar-header">
      <div class="sidebar-logo">${icon('square-library', 14)}</div>
      <span class="sidebar-title">Buchtiteleditor</span>
      <button class="theme-toggle" id="btn-theme-toggle" title="Theme umschalten" aria-label="Theme umschalten"></button>
    </div>
    <div class="sidebar-nav">
      ${Object.entries(groups).map(([group, items]) => `
        <div class="sidebar-group">
          <div class="sidebar-group-label">${GROUP_LABELS[group] ?? group}</div>
          ${items.map((s) => `
            <button
              class="sidebar-item ${active?.id === s.id ? 'active' : ''}"
              data-schema-id="${s.id}"
              title="${s.label}"
            >
              <span class="sidebar-item-icon">${getIcon(s.type, s.group)}</span>
              <span class="sidebar-item-label">${s.label}</span>
              ${s.type !== 'genre' ? `
                <span class="sidebar-item-delete" data-delete-id="${s.id}" title="Klasse löschen">
                  ${icon12('x')}
                </span>` : ''}
            </button>
          `).join('')}
        </div>
      `).join('')}
    </div>
    <div class="sidebar-footer">
      <button class="sidebar-new-class-btn" id="btn-new-class" title="Neue Klasse hinzufügen">
        ${icon14('list-plus')} Neue Klasse
      </button>
      <button class="sidebar-new-class-btn sidebar-db-btn" id="btn-database" title="Datenbank verwalten (Export / Import / Reset)">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/></svg>
        Datenbank
      </button>
    </div>
  `;

  // Nav items
  container.querySelectorAll('.sidebar-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      if (e.target.closest('.sidebar-item-delete')) {
        e.stopPropagation();
        const id = e.target.closest('.sidebar-item-delete').dataset.deleteId;
        deleteClass(id);
        return;
      }
      const id = btn.dataset.schemaId;
      const schema = schemas.find((s) => s.id === id);
      if (schema) AppStore.set('activeSchema', schema);
    });
  });

  container.querySelector('#btn-new-class')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:open-new-class'));
  });

  container.querySelector('#btn-database')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('editor:open-database'));
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

function icon12(name) {
  // local shorthand (avoids circular import confusion)
  const { icon: ic } = { icon: (n, s) => {
    const el = document.createElement('span');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${({
      x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    })[n] ?? ''}</svg>`;
  }};
  return ic(name, 12);
}

function getIcon(type, _group) {
  switch (type) {
    case 'genre':    return icon14('table-properties');
    case 'nomen':    return icon14('box');
    case 'adjektiv': return icon14('triangle');
    default:         return icon14('box');
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
