// editor/services/declension-rules.js
// German noun declension rules based on the Grimm grammar tradition
// declinationRule  = broad class (starkeDeklination / schwacheDeklination / gemischteDeklination)
// declinationPattern = specific schema (S1…S6, W1…W4)

// ── 1. Genus → allowed declinationRule values ──────────────────────────────
export const GENUS_TO_RULES = {
  maskulinum: ['starkeDeklination', 'schwacheDeklination', 'gemischteDeklination', 'fremdWort', 'eigenName'],
  neutrum: ['starkeDeklination', 'gemischteDeklination', 'fremdWort', 'eigenName'],
  femininum: ['starkeDeklination', 'schwacheDeklination', 'fremdWort', 'eigenName'],
  // catch-all for unknown / empty genus
  '': ['starkeDeklination', 'schwacheDeklination', 'gemischteDeklination', 'fremdWort', 'eigenName'],
};

// ── 2. declinationRule → candidate patterns (codes only, stored in cell) ───
export const RULE_TO_PATTERNS = {
  starkeDeklination:    ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'],
  schwacheDeklination:  ['W1', 'W2'],
  gemischteDeklination: ['W3', 'W4'],
  fremdWort:            ['fremdWort'],
  eigenName:            ['eigenName'],
};

// ── 3. Per-genus allowed pattern codes ────────────────────────────────────
// Intersect with RULE_TO_PATTERNS to get the final list.
const GENUS_PATTERNS = {
  maskulinum: ['S1', 'S2', 'S4', 'S5', 'S6', 'W1', 'W3', 'W4', 'fremdWort', 'eigenName'],
  neutrum: ['S1', 'S2', 'S4', 'S5', 'S6', 'W3', 'W4', 'fremdWort', 'eigenName'],
  femininum: ['S3', 'S5', 'S6', 'W2', 'fremdWort', 'eigenName'],
  '': ['S1','S2','S3','S4','S5','S6','W1','W2','W3','W4','fremdWort','eigenName'],
};

// ── 4. Pattern metadata (display label and plural suffix) ──────────────────
export const PATTERN_INFO = {
  S1: { label: 'S1: Umlaut + e (m./n.)',    suffix: '-(e)s, -¨e',    genus: ['maskulinum','neutrum'] },
  S2: { label: 'S2: Umlaut + er',           suffix: '-(e)s, -¨er',   genus: ['maskulinum','neutrum'] },
  S3: { label: 'S3: Umlaut + e (f.)',       suffix: '-, -¨e',        genus: ['femininum'] },
  S4: { label: 'S4: -e (ohne Umlaut)',      suffix: '-(e)s, -e',     genus: ['maskulinum','neutrum'] },
  S5: { label: 'S5: Umlaut ohne Endung',    suffix: '-s, -¨',        genus: ['maskulinum','neutrum','femininum'] },
  S6: { label: 'S6: unveränderter Plural',  suffix: '-s, -',         genus: ['maskulinum','neutrum','femininum'] },
  W1: { label: 'W1: -(e)n (m.)',            suffix: '-(e)n, -(e)n',  genus: ['maskulinum'] },
  W2: { label: 'W2: -(e)n (f.)',            suffix: '-, -(e)n',      genus: ['femininum'] },
  W3: { label: 'W3: gemischt -(e)s/-(e)n', suffix: '-(e)s, -(e)n',  genus: ['maskulinum','neutrum'] },
  W4: { label: 'W4: gemischt -(e)ns/-(e)n',suffix: '-(e)ns, -(e)n', genus: ['maskulinum','neutrum'] },
  fremdWort: { label: 'fremdWort',          suffix: '-, s',          genus: ['maskulinum','neutrum','femininum'] },
  eigenName: { label: 'Eigenname',          suffix: '-, s',          genus: ['maskulinum','neutrum','femininum'] },
};

// Dropdown label shown to user: "S1: -(e)s, -¨e"
export function patternDisplayLabel(code) {
  const info = PATTERN_INFO[code];
  if (!info) return code;
  return `${code}: ${info.suffix}`;
}

// ── Query helpers ──────────────────────────────────────────────────────────

/**
 * Return the allowed declinationRule values for a given genus.
 */
export function getRulesForGenus(genus) {
  return GENUS_TO_RULES[genus] ?? GENUS_TO_RULES[''];
}

/**
 * Return the allowed pattern codes for a given genus + rule combination.
 * If rule is empty, returns all patterns allowed for genus.
 */
export function getPatternsFor(genus, rule) {
  const genusAllowed = new Set(GENUS_PATTERNS[genus] ?? GENUS_PATTERNS['']);
  if (!rule || !RULE_TO_PATTERNS[rule]) {
    return [...genusAllowed];
  }
  return RULE_TO_PATTERNS[rule].filter(p => genusAllowed.has(p));
}

/**
 * Check if a pattern code is valid for the given genus + rule.
 */
export function isPatternValid(genus, rule, pattern) {
  if (!pattern) return true; // empty = always ok
  return getPatternsFor(genus, rule).includes(pattern);
}

/**
 * Check if a rule is valid for the given genus.
 */
export function isRuleValid(genus, rule) {
  if (!rule) return true;
  return getRulesForGenus(genus).includes(rule);
}

export const GENUS_OPTIONS    = ['maskulinum', 'femininum', 'neutrum'];
export const ALL_RULE_OPTIONS  = ['starkeDeklination', 'schwacheDeklination', 'gemischteDeklination', 'fremdWort', 'eigenName'];
export const ALL_PATTERN_CODES = Object.keys(PATTERN_INFO);
