// editor/services/csv-service.js
// CSV export: semicolon-delimited, UTF-8 BOM — matches original files exactly

// ── Internal fields stripped on export ────────────────────────────────────
const INTERNAL_FIELDS = new Set(['_id', '_isDuplicate', '_errors', '_rowIndex']);

// ── CSV Parser (semicolon, RFC 4180 quoting, BOM-aware) ───────────────────
/**
 * Parse a semicolon-delimited CSV string.
 * Handles:
 *   - UTF-8 BOM (EF BB BF)
 *   - Semicolon delimiter
 *   - RFC 4180 double-quote escaping ("field with ""quotes""")
 *   - Trailing whitespace in headers stripped
 *   - CRLF and LF line endings
 */
export function parseCsv(text) {
  // Strip UTF-8 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const lines = splitCsvLines(text);
  if (lines.length === 0) return { fields: [], rows: [] };

  const fields = splitCsvRow(lines[0]).map(f => f.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const values = splitCsvRow(lines[i]);
    const row = {};
    fields.forEach((f, idx) => {
      row[f] = values[idx] !== undefined ? values[idx] : '';
    });
    rows.push(row);
  }

  return { fields, rows };
}

/**
 * Split a CSV text into logical lines (respecting quoted newlines).
 */
function splitCsvLines(text) {
  const lines = [];
  let current = '';
  let inQuote = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuote && text[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
        current += ch;
      }
    } else if ((ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) && !inQuote) {
      if (ch === '\r') i++; // skip \n of \r\n
      lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Split a single CSV line into fields (semicolon-separated, RFC 4180 quoting).
 */
function splitCsvRow(line) {
  const fields = [];
  let field = '';
  let inQuote = false;
  let i = 0;

  while (i < line.length) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      inQuote = !inQuote;
      i++;
      continue;
    }
    if (ch === ';' && !inQuote) {
      fields.push(field);
      field = '';
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  fields.push(field);
  return fields;
}

// ── CSV Exporter ───────────────────────────────────────────────────────────
/**
 * Convert rows to a semicolon-delimited CSV string with UTF-8 BOM.
 * Strips internal meta-fields (_id, _isDuplicate, etc.).
 */
export function rowsToCsv(fields, rows) {
  const exportFields = fields.filter(f => !INTERNAL_FIELDS.has(f));

  const header = exportFields.join(';');
  const dataLines = rows.map(row => {
    return exportFields.map(f => {
      const val = String(row[f] ?? '');
      // Quote if value contains semicolon, newline or double-quote
      if (val.includes(';') || val.includes('\n') || val.includes('"')) {
        return '"' + val.replace(/"/g, '""') + '"';
      }
      return val;
    }).join(';');
  });

  return '\uFEFF' + [header, ...dataLines].join('\n');
}

/**
 * Trigger a browser file download.
 */
export function downloadCsv(filename, csvString) {
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
