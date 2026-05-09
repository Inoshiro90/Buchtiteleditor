// scripts/ui/combobox.js
// Wiederverwendbare Combobox-Komponente (Ä6 — Autocomplete/Filterbare Dropdown-Auswahl)
//
// Verwendung:
//   createCombobox({ container, items, value, onChange, placeholder, id })
//
// items: string[]  – alle Optionen
// value: string    – aktueller Wert (kann auch außerhalb der Liste liegen)
// onChange(value)  – Callback wenn Wert geändert

export function createCombobox({ container, items, value = '', onChange, placeholder = 'Suchen…', id = 'cb-' + Math.random().toString(36).slice(2) }) {
  container.innerHTML = `
    <div class="cb-wrap" id="${id}-wrap">
      <input
        type="text"
        class="form-input cb-input"
        id="${id}-input"
        value="${escHtml(value)}"
        placeholder="${escHtml(placeholder)}"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-expanded="false"
        aria-haspopup="listbox"
        role="combobox"
      />
      <div class="cb-dropdown" id="${id}-dropdown" role="listbox" style="display:none"></div>
    </div>
  `;

  const input    = container.querySelector(`#${id}-input`);
  const dropdown = container.querySelector(`#${id}-dropdown`);
  let _activeIdx = -1;

  function getFiltered(term) {
    const t = term.trim().toLowerCase();
    if (!t) return items;
    return items.filter(i => i.toLowerCase().includes(t));
  }

  function renderDropdown(filtered, term) {
    if (filtered.length === 0) {
      dropdown.innerHTML = `<div class="cb-empty">Keine Treffer</div>`;
    } else {
      const t = term.trim().toLowerCase();
      dropdown.innerHTML = filtered.map((item, idx) => {
        const hl = t ? item.replace(new RegExp(`(${escRegex(t)})`, 'gi'),
          '<mark class="cb-hl">$1</mark>') : escHtml(item);
        return `<div class="cb-option" data-value="${escHtml(item)}" data-idx="${idx}" role="option">${hl}</div>`;
      }).join('');
    }
    _activeIdx = -1;
    dropdown.style.display = '';
    input.setAttribute('aria-expanded', 'true');
    updateActive();
  }

  function closeDropdown() {
    dropdown.style.display = 'none';
    input.setAttribute('aria-expanded', 'false');
    _activeIdx = -1;
  }

  function openDropdown() {
    const filtered = getFiltered(input.value);
    renderDropdown(filtered, input.value);
  }

  function updateActive() {
    dropdown.querySelectorAll('.cb-option').forEach((el, i) => {
      el.classList.toggle('cb-option--active', i === _activeIdx);
      if (i === _activeIdx) el.scrollIntoView({ block: 'nearest' });
    });
  }

  function commitValue(val) {
    input.value = val;
    closeDropdown();
    onChange(val);
  }

  input.addEventListener('focus', () => openDropdown());

  input.addEventListener('input', () => {
    const filtered = getFiltered(input.value);
    renderDropdown(filtered, input.value);
    onChange(input.value); // Live-Update auch bei freier Eingabe
  });

  input.addEventListener('keydown', (e) => {
    const options = dropdown.querySelectorAll('.cb-option');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _activeIdx = Math.min(_activeIdx + 1, options.length - 1);
      updateActive();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _activeIdx = Math.max(_activeIdx - 1, 0);
      updateActive();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (_activeIdx >= 0 && options[_activeIdx]) {
        commitValue(options[_activeIdx].dataset.value);
      } else {
        closeDropdown();
        onChange(input.value);
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
    }
  });

  // Klick auf Option
  dropdown.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('.cb-option');
    if (opt) {
      e.preventDefault(); // blur verhindern
      commitValue(opt.dataset.value);
    }
  });

  // Outside click
  document.addEventListener('pointerdown', (e) => {
    const wrap = container.querySelector(`#${id}-wrap`);
    if (wrap && !wrap.contains(e.target)) closeDropdown();
  }, { capture: true });

  // Öffentliche API
  return {
    getValue: () => input.value,
    setValue: (v) => { input.value = v; },
    refresh: (newItems) => {
      items = newItems;
      if (dropdown.style.display !== 'none') openDropdown();
    },
  };
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
