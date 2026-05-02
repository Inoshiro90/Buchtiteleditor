// editor/services/tag-service.js
// Auto-Tag algorithm preserving manually-entered tags

// DSL tag expression pattern — e.g. {NOM:Volk1|tags}, {ADJ:Farbe1|tags}
const DSL_TAG_EXPR = /^\{(?:NOM|ADJ|COM):[^}]+\|tags\}$/;

/**
 * Parse a comma-separated tags string into an array of trimmed, non-empty strings.
 */
function parseTags(str) {
  return String(str ?? '').split(',').map(t => t.trim()).filter(Boolean);
}

/**
 * Compute merged auto-tags for a single genre row.
 *
 * Final order:
 *   1. genre value (always first)
 *   2. Existing manually-entered tags (non-DSL, non-genre)
 *   3. {NOM:Lemma|tags} generated from title tokens
 *   4. {ADJ:Lemma|tags} generated from title tokens
 *   5. {COM:Lemma|tags} generated from title tokens
 *
 * Duplicates removed. Returns null if the result is unchanged.
 *
 * @param {object} row
 * @returns {string|null}
 */
export function computeAutoTags(row) {
  const title = String(row.title ?? '');
  const genre = String(row.genre ?? '').trim();
  const existing = parseTags(row.tags);

  // 1. Genre tag — always first
  const genreTag = genre;

  // 2. Preserve manual tags: existing tags that are NOT a DSL expression and NOT the genre value
  const manualTags = existing.filter(t => !DSL_TAG_EXPR.test(t) && t !== genreTag);

  // 3. NOM tokens → {NOM:Lemma|tags}
  const nomTags = extractTokenTags(title, 'NOM');

  // 4. ADJ tokens → {ADJ:Lemma|tags}
  const adjTags = extractTokenTags(title, 'ADJ');

  // 5. COM tokens → {COM:Lemma|tags}
  const comTags = extractTokenTags(title, 'COM');

  // Assemble in order, deduplicate
  const ordered = [];
  const seen = new Set();

  const add = (t) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    ordered.push(t);
  };

  if (genreTag) add(genreTag);
  manualTags.forEach(add);
  nomTags.forEach(add);
  adjTags.forEach(add);
  comTags.forEach(add);

  const newTags = ordered.join(', ');
  const current = existing.join(', ');
  return newTags === current ? null : newTags;
}

/**
 * Extract unique {TYPE:Lemma|tags} expressions for all tokens of the given type in the title.
 */
function extractTokenTags(title, type) {
  const regex = new RegExp(`\\{${type}:([A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß0-9]*)[|][^}]*\\}`, 'g');
  const lemmas = [];
  for (const m of title.matchAll(regex)) {
    if (!lemmas.includes(m[1])) lemmas.push(m[1]);
  }
  return lemmas.map(l => `{${type}:${l}|tags}`);
}

/**
 * Preview which rows would change.
 * @returns {{ idx: number, row: object, oldTags: string, newTags: string }[]}
 */
export function previewAutoTags(rows) {
  return rows
    .map((row, idx) => {
      const newTags = computeAutoTags(row);
      if (newTags === null) return null;
      return { idx, row, oldTags: row.tags ?? '', newTags };
    })
    .filter(Boolean);
}

/** Apply auto-tags to all rows, returning a new array. */
export function applyAutoTags(rows) {
  return rows.map(row => {
    const newTags = computeAutoTags(row);
    return newTags === null ? row : { ...row, tags: newTags };
  });
}
