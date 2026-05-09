// editor/ui/cell-declension.js
// Custom AG Grid cell editors for the three cascading nomen columns:
//   gender → declinationRule → declinationPattern
//
// Approach: simple native <select> + free-text fallback,
// rendered as an inline cell editor (cellEditorPopup: false).

import {
  GENUS_OPTIONS, ALL_RULE_OPTIONS,
  getRulesForGenus, getPatternsFor,
  patternDisplayLabel, isRuleValid, isPatternValid,
} from '../services/declension-rules.js';

// ── Shared base ────────────────────────────────────────────────────────────
class SelectCellEditor {
  constructor() {
    this._value = '';
    this._el    = null;
    this._input = null;
  }

  /** Subclasses override to return [{ value, label }] */
  _getOptions(_params) { return []; }

  /** Subclasses return a warning string if the current value is invalid */
  _getWarning(_params) { return ''; }

  init(params) {
    this._value = params.value ?? '';
    this._params = params;

    this._el = document.createElement('div');
    this._el.style.cssText = 'width:100%;height:100%;position:relative;display:flex;align-items:center;';

    this._buildSelect(params);
  }

  _buildSelect(params) {
    const options = this._getOptions(params);
    const warning = this._getWarning(params);

    // Native select for known options for dropdown style
    const select = document.createElement('select');
    select.style.cssText = [
      'width:100%', 'height:100%', 'border:none', 'outline:none',
      'background:var(--bg-page)', 'font-family:var(--font-sans)',
      'font-size:13px', 'color:var(--text-primary)',
      'cursor:pointer', 'padding:0 4px',
    ].join(';');

    // Empty option
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    select.appendChild(empty);

    options.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      if (value === this._value) opt.selected = true;
      select.appendChild(opt);
    });

    // If current value is not in the list but non-empty → add it as-is
    const knownValues = options.map(o => o.value);
    if (this._value && !knownValues.includes(this._value)) {
      const opt = document.createElement('option');
      opt.value = this._value;
      opt.textContent = `${this._value} ⚠`;
      opt.selected = true;
      opt.style.color = 'var(--color-warn)';
      select.appendChild(opt);
    }

    select.value = this._value;

    select.addEventListener('change', () => {
      this._value = select.value;
      params.stopEditing(false);
    });

    // Keyboard: Enter = confirm, Escape = cancel
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this._value = select.value; params.stopEditing(false); }
      if (e.key === 'Escape') params.stopEditing(true);
    });

    this._el.innerHTML = '';
    this._el.appendChild(select);

    if (warning) {
      const badge = document.createElement('span');
      badge.title = warning;
      badge.style.cssText = 'position:absolute;right:22px;top:50%;transform:translateY(-50%);font-size:10px;color:var(--color-warn);pointer-events:none;';
      badge.textContent = '⚠';
      this._el.appendChild(badge);
    }

    this._select = select;
  }

  afterGuiAttached() {
    this._select?.focus();
  }

  getValue()           { return this._value; }
  getGui()             { return this._el; }
  isCancelAfterEnd()   { return false; }
  isCancelBeforeStart(){ return false; }
  destroy()            {}
}

// ── Genus editor ──────────────────────────────────────────────────────────
export class GenusCellEditor extends SelectCellEditor {
  _getOptions() {
    return [
      { value: 'maskulinum', label: 'maskulinum' },
      { value: 'femininum', label: 'femininum' },
      { value: 'neutrum', label: 'neutrum' },
    ];
  }
}

// ── DeclinationRule editor ─────────────────────────────────────────────────
export class DeclinationRuleCellEditor extends SelectCellEditor {
  _getOptions(params) {
    const genus = params.data?.gender ?? '';
    const allowed = getRulesForGenus(genus);
    const labels = {
      starkeDeklination:    'starkeDeklination (S1–S6)',
      schwacheDeklination:  'schwacheDeklination (W1, W2)',
      gemischteDeklination: 'gemischteDeklination (W3, W4)',
      fremdWort: 'Fremdwort',
      eigenName: 'EigenName',
      substantiviertesAdjektiv: 'Substantiviertes Adjektiv'
    };
    return allowed.map(r => ({ value: r, label: labels[r] ?? r }));
  }

  _getWarning(params) {
    const genus = params.data?.gender ?? '';
    const rule  = params.value ?? '';
    if (rule && !isRuleValid(genus, rule)) {
      return `„${rule}" ist für Genus „${genus}" nicht erlaubt`;
    }
    return '';
  }
}

// ── DeclinationPattern editor ──────────────────────────────────────────────
export class DeclinationPatternCellEditor extends SelectCellEditor {
  _getOptions(params) {
    const genus   = params.data?.gender ?? '';
    const rule    = params.data?.declinationRule ?? '';
    const allowed = getPatternsFor(genus, rule);
    // Display: "S1: -(e)s, -¨e"  — stored value: "S1"
    return allowed.map(code => ({
      value: code,
      label: patternDisplayLabel(code),
    }));
  }

  _getWarning(params) {
    const genus   = params.data?.gender ?? '';
    const rule    = params.data?.declinationRule ?? '';
    const pattern = params.value ?? '';
    if (pattern && !isPatternValid(genus, rule, pattern)) {
      return `„${pattern}" passt nicht zu Genus „${genus}" / Regel „${rule}"`;
    }
    return '';
  }
}

// ── Cell Renderer for pattern column (show "S1: -(e)s, -¨e" in read mode) ─
export class PatternCellRenderer {
  init(params) {
    this._el = document.createElement('span');
    this.refresh(params);
  }

  refresh(params) {
    const code = params.value ?? '';
    this._el.textContent = code ? patternDisplayLabel(code) : '';
    // Warn if incompatible with current row
    const genus = params.data?.gender ?? '';
    const rule  = params.data?.declinationRule ?? '';
    if (code && !isPatternValid(genus, rule, code)) {
      this._el.style.color = 'var(--color-warn)';
      this._el.title = `„${code}" passt nicht zu Genus „${genus}" / Regel „${rule}"`;
    } else {
      this._el.style.color = '';
      this._el.title = '';
    }
    return true;
  }

  getGui()  { return this._el; }
  destroy() {}
}

// ── Genus Cell Renderer (show full label) ──────────────────────────────────
export class GenusCellRenderer {
  init(params) {
    this._el = document.createElement('span');
    this.refresh(params);
  }

  refresh(params) {
    const labels = { maskulinum: 'maskulinum', femininum: 'femininum', neutrum: 'neutrum' };
    this._el.textContent = labels[params.value] ?? params.value ?? '';
    return true;
  }

  getGui()  { return this._el; }
  destroy() {}
}

// ── Numerus editor (Defektivum) ───────────────────────────────────────────
export class NumerusCellEditor extends SelectCellEditor {
  _getOptions() {
    return [
      { value: 'singular', label: 'sgl — Singulariatantum (nur Singular)' },
      { value: 'plural', label: 'plu — Pluraliatantum (nur Plural)' },
    ];
  }
}
