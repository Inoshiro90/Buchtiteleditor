// scripts/ui/find-replace-bar.js
// Find & Replace Bar — VSCode-ähnliches UI
//
// Problem 1 Fix: renderBar() wird NIE aus input-Handlers aufgerufen.
//   Stattdessen aktualisiert _patchBar() gezielt nur Badge + Button-States.
//   Dadurch bleibt das <input>-Element erhalten, der Cursor nie zurückgesetzt.
//
// Änderung 2: Alle Treffer = row-has-match (grün), aktiver = row-find-match (orange)
// Änderung 3: Kein Chevron mehr — beide Felder permanent nebeneinander

import { AppStore }   from '../store/AppStore.js';
import { buildPattern, findAllMatches, applyReplacement } from '../services/find-replace-service.js';
import { gridContext } from './grid-context.js';

// ── Modulzustand ───────────────────────────────────────────────────────────
const _state = {
  matchCase:    false,
  matchWord:    false,
  useRegex:     false,
  preserveCase: false,
  matches:      [],
  currentIndex: -1,
  term:         '',
  replacement:  '',
};

// ── Public ─────────────────────────────────────────────────────────────────
export function initFindReplaceBar(container) {
  renderBar(container);
  bindGlobalKeys(container);

  AppStore.on('activeSchema', () => {
    _state.matches      = [];
    _state.currentIndex = -1;
    _notifyHighlights();
    renderBar(container);
  });

  let _searchDebounce = null;
  AppStore.on('rows', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => {
      if (_state.term) runSearch(container, /* restoreFocus */ false);
    }, 120);
  });
}

// ── Render (nur bei Optionsänderungen / Schema-Wechsel) ────────────────────
// Problem 1: Wird NICHT bei input-Events aufgerufen.
function renderBar(container) {
  const noSchema = !AppStore.get('activeSchema');

  container.innerHTML = `
    <div class="fr-bar${noSchema ? ' fr-bar--disabled' : ''}">

      <!-- Suchfeld + Optionen + Navigation -->
      <div class="fr-col fr-search-col">
        <div class="fr-input-wrap">
          <input
            type="text"
            id="fr-search-input"
            class="fr-input${_isPatternInvalid() ? ' fr-input--error' : ''}"
            placeholder="Suchen …"
            value="${escHtml(_state.term)}"
            aria-label="Suchen"
            autocomplete="off"
            spellcheck="false"
            ${noSchema ? 'disabled' : ''}
          />
          <span class="fr-match-count" id="fr-match-count">${_matchCountLabel()}</span>
        </div>
        <div class="fr-opts">
          ${optBtn('fr-opt-case',  _state.matchCase, 'Groß-/Kleinschreibung (Alt+C)',
            `<path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M22 9v7"/><path d="M3.304 13h6.392"/><circle cx="18.5" cy="12.5" r="3.5"/>`)}
          ${optBtn('fr-opt-word',  _state.matchWord, 'Ganzes Wort (Alt+W)',
            `<circle cx="7" cy="12" r="3"/><path d="M10 9v6"/><circle cx="17" cy="12" r="3"/><path d="M14 7v8"/><path d="M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1"/>`)}
          ${optBtn('fr-opt-regex', _state.useRegex,  'Regulärer Ausdruck (Alt+R)',
            `<path d="M17 3v10"/><path d="m12.67 5.5 8.66 5"/><path d="m12.67 10.5 8.66-5"/><path d="M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z"/>`)}
        </div>
        <div class="fr-nav">
          <button class="fr-nav-btn" id="fr-btn-prev" title="Vorheriger Treffer (Shift+Enter)" ${_noMatches() ? 'disabled' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 6L12 2L16 6"/><path d="M12 2V22"/>
            </svg>
          </button>
          <button class="fr-nav-btn" id="fr-btn-next" title="Nächster Treffer (Enter)" ${_noMatches() ? 'disabled' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M8 18L12 22L16 18"/><path d="M12 2V22"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Trennlinie -->
      <div class="fr-divider"></div>

      <!-- Ersetzfeld + Optionen + Buttons -->
      <div class="fr-col fr-replace-col">
        <div class="fr-input-wrap">
          <input
            type="text"
            id="fr-replace-input"
            class="fr-input"
            placeholder="Ersetzen …"
            value="${escHtml(_state.replacement)}"
            aria-label="Ersetzen"
            autocomplete="off"
            spellcheck="false"
            ${noSchema ? 'disabled' : ''}
          />
        </div>
        <div class="fr-opts">
          ${optBtn('fr-opt-preserve', _state.preserveCase, 'Groß-/Kleinschreibung beibehalten (Alt+P)',
            `<path d="M15 11h4.5a1 1 0 0 1 0 5h-4a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h3a1 1 0 0 1 0 5"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/>`)}
        </div>
        <div class="fr-nav">
          <button class="fr-nav-btn fr-replace-btn" id="fr-btn-replace"
            title="Ersetzen (Enter im Ersetzfeld)" ${_noReplaceReady() ? 'disabled' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/>
              <path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/>
              <path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
          <button class="fr-nav-btn fr-replace-btn" id="fr-btn-replace-all"
            title="Alle ersetzen (Strg+Alt+Enter)" ${_noReplaceReady() ? 'disabled' : ''}>
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/>
              <path d="M14 4a1 1 0 0 1 1-1"/><path d="M15 10a1 1 0 0 1-1-1"/>
              <path d="M19 14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1"/>
              <path d="M21 4a1 1 0 0 0-1-1"/><path d="M21 9a1 1 0 0 1-1 1"/>
              <path d="m3 7 3 3 3-3"/><path d="M6 10V5a2 2 0 0 1 2-2h2"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  `;

  bindBarEvents(container);
}

// ── Problem 1 Fix: Gezielter DOM-Patch ohne HTML-Rebuild ──────────────────
// Wird nach runSearch() aufgerufen um Badge + Buttons zu aktualisieren,
// OHNE das <input>-Element zu ersetzen.
function _patchBar(container) {
  // Match-Count Badge
  const badge = container.querySelector('#fr-match-count');
  if (badge) badge.textContent = _matchCountLabel();

  // Navigation Buttons
  const noMatches = _noMatches();
  container.querySelector('#fr-btn-prev')?.toggleAttribute('disabled', noMatches);
  container.querySelector('#fr-btn-next')?.toggleAttribute('disabled', noMatches);

  // Replace Buttons
  const noRepl = _noReplaceReady();
  container.querySelector('#fr-btn-replace')?.toggleAttribute('disabled', noRepl);
  container.querySelector('#fr-btn-replace-all')?.toggleAttribute('disabled', noRepl);

  // Error-State auf Search Input (RegEx ungültig)
  const searchEl = container.querySelector('#fr-search-input');
  if (searchEl) searchEl.classList.toggle('fr-input--error', _isPatternInvalid());
}

// ── Events ─────────────────────────────────────────────────────────────────
function bindBarEvents(container) {
  const $ = id => container.querySelector(`#${id}`);

  // ── Search Input ─────────────────────────────────────────────────────────
  // Problem 1: input-Handler ruft NICHT renderBar() auf — nur runSearch() + _patchBar()
  const searchInput = $('fr-search-input');
  searchInput?.addEventListener('input', (e) => {
    _state.term         = e.target.value;
    _state.currentIndex = -1;
    runSearch(container, /* restoreFocus */ false);
    // Kein renderBar() hier!
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey) {
      e.preventDefault();
      if (e.shiftKey) navigatePrev(container);
      else            navigateNext(container);
    }
    if (e.key === 'Escape') clearSearch(container);
  });

  // ── Replace Input ─────────────────────────────────────────────────────────
  // Problem 1: Gleiches Muster — input-Handler ruft NICHT renderBar() auf
  const replInput = $('fr-replace-input');
  replInput?.addEventListener('input', (e) => {
    _state.replacement = e.target.value;
    _patchBar(container); // Buttons aktivieren/deaktivieren
    // Kein renderBar() hier!
  });

  replInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      doReplaceOne(container);
    }
    if (e.ctrlKey && e.altKey && e.key === 'Enter') {
      e.preventDefault();
      doReplaceAll(container);
    }
    if (e.key === 'Escape') clearSearch(container);
  });

  // ── Option Toggles ────────────────────────────────────────────────────────
  // Hier darf renderBar() aufgerufen werden — kein Input ist aktiv
  $('fr-opt-case')?.addEventListener('click', () => {
    _state.matchCase    = !_state.matchCase;
    _state.currentIndex = -1;
    renderBar(container);
    runSearch(container, true);
  });
  $('fr-opt-word')?.addEventListener('click', () => {
    _state.matchWord    = !_state.matchWord;
    _state.currentIndex = -1;
    renderBar(container);
    runSearch(container, true);
  });
  $('fr-opt-regex')?.addEventListener('click', () => {
    _state.useRegex     = !_state.useRegex;
    _state.currentIndex = -1;
    renderBar(container);
    runSearch(container, true);
  });
  $('fr-opt-preserve')?.addEventListener('click', () => {
    _state.preserveCase = !_state.preserveCase;
    renderBar(container);
    container.querySelector('#fr-replace-input')?.focus();
  });

  // Navigation
  $('fr-btn-prev')?.addEventListener('click', () => navigatePrev(container));
  $('fr-btn-next')?.addEventListener('click', () => navigateNext(container));

  // Replace
  $('fr-btn-replace')?.addEventListener('click',     () => doReplaceOne(container));
  $('fr-btn-replace-all')?.addEventListener('click', () => doReplaceAll(container));
}

// ── Global Keyboard Shortcuts ──────────────────────────────────────────────
function bindGlobalKeys(container) {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      if (!AppStore.get('activeSchema')) return;
      e.preventDefault();
      const inp = container.querySelector('#fr-search-input');
      inp?.focus();
      inp?.select();
      return;
    }
    const bar = container.querySelector('.fr-bar');
    if (!bar?.contains(document.activeElement)) return;

    if (e.altKey && !e.ctrlKey && !e.shiftKey) {
      if (e.key === 'c' || e.key === 'C') { e.preventDefault(); container.querySelector('#fr-opt-case')?.click(); }
      if (e.key === 'w' || e.key === 'W') { e.preventDefault(); container.querySelector('#fr-opt-word')?.click(); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); container.querySelector('#fr-opt-regex')?.click(); }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); container.querySelector('#fr-opt-preserve')?.click(); }
    }
  });
}

// ── Search ─────────────────────────────────────────────────────────────────
function runSearch(container, restoreFocus = false) {
  const gridApi = gridContext.getApi();
  const schema  = gridContext.getSchema();

  if (!gridApi || !schema || !_state.term) {
    _state.matches      = [];
    _state.currentIndex = -1;
    _notifyHighlights();
    _patchBar(container);
    return;
  }

  const opts    = { matchCase: _state.matchCase, matchWholeWord: _state.matchWord, useRegex: _state.useRegex };
  const pattern = buildPattern(_state.term, opts);

  if (!pattern) {
    _state.matches      = [];
    _state.currentIndex = -1;
    _notifyHighlights();
    _patchBar(container);
    return;
  }

  const fields = schema.columns.map(c => c.field);
  _state.matches = findAllMatches(gridApi, fields, pattern);

  if (_state.matches.length > 0) {
    if (_state.currentIndex < 0 || _state.currentIndex >= _state.matches.length) {
      _state.currentIndex = 0;
    }
    navigateTo(_state.currentIndex);
  } else {
    _state.currentIndex = -1;
    _notifyHighlights();
  }

  _patchBar(container);
  if (restoreFocus) container.querySelector('#fr-search-input')?.focus();
}

function navigateNext(container) {
  if (_noMatches()) return;
  _state.currentIndex = (_state.currentIndex + 1) % _state.matches.length;
  navigateTo(_state.currentIndex);
  _patchBar(container);
}

function navigatePrev(container) {
  if (_noMatches()) return;
  _state.currentIndex = (_state.currentIndex - 1 + _state.matches.length) % _state.matches.length;
  navigateTo(_state.currentIndex);
  _patchBar(container);
}

function navigateTo(idx) {
  const match = _state.matches[idx];
  if (!match) return;
  _notifyHighlights();
  document.dispatchEvent(new CustomEvent('editor:find-navigate', { detail: { match } }));
}

function clearSearch(container) {
  _state.term         = '';
  _state.matches      = [];
  _state.currentIndex = -1;
  _notifyHighlights();
  // Hier darf renderBar() aufgerufen werden (kein Input aktiv nach Escape)
  renderBar(container);
  container.querySelector('#fr-search-input')?.focus();
}

// ── Änderung 2: Alle Match-RowIds an table.js senden ──────────────────────
function _notifyHighlights() {
  const activeMatch = _state.matches[_state.currentIndex] ?? null;
  const allRowIds   = new Set(_state.matches.map(m => m.rowId));
  document.dispatchEvent(new CustomEvent('editor:find-highlight', {
    detail: { activeMatch, allRowIds },
  }));
}

// ── Replace ────────────────────────────────────────────────────────────────
function doReplaceOne(container) {
  if (_noReplaceReady()) return;
  const match = _state.matches[_state.currentIndex];
  if (!match) return;

  const opts    = { matchCase: _state.matchCase, matchWholeWord: _state.matchWord, useRegex: _state.useRegex };
  const pattern = buildPattern(_state.term, opts);
  if (!pattern) return;

  const newValue = applyReplacement(match.value, pattern, _state.replacement, _state.preserveCase);
  document.dispatchEvent(new CustomEvent('editor:replace-one', { detail: { match, newValue } }));

  setTimeout(() => {
    runSearch(container, false);
    if (!_noMatches()) navigateNext(container);
  }, 60);
}

function doReplaceAll(container) {
  if (_noReplaceReady()) return;
  const opts    = { matchCase: _state.matchCase, matchWholeWord: _state.matchWord, useRegex: _state.useRegex };
  const pattern = buildPattern(_state.term, opts);
  if (!pattern) return;

  const replacements = _state.matches.map(match => ({
    rowId:    match.rowId,
    field:    match.field,
    newValue: applyReplacement(match.value, pattern, _state.replacement, _state.preserveCase),
  }));

  document.dispatchEvent(new CustomEvent('editor:replace-all', {
    detail: { replacements, count: replacements.length },
  }));

  setTimeout(() => runSearch(container, false), 120);
}

// ── Helpers ────────────────────────────────────────────────────────────────
function _noMatches()      { return _state.matches.length === 0; }
function _noReplaceReady() { return _noMatches() || _state.replacement.length === 0 && _state.replacement !== ''; }
function _isPatternInvalid() {
  if (!_state.term || !_state.useRegex) return false;
  try { new RegExp(_state.term); return false; } catch (_) { return true; }
}
function _matchCountLabel() {
  if (!_state.term) return '';
  if (_state.matches.length === 0) return 'Kein Treffer';
  return `${_state.currentIndex + 1}/${_state.matches.length}`;
}

function optBtn(id, active, title, svgPaths) {
  return `<button class="fr-opt-btn${active ? ' fr-opt-btn--active' : ''}"
    id="${id}" title="${title}" aria-pressed="${active}" aria-label="${title}">
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      ${svgPaths}
    </svg>
  </button>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
