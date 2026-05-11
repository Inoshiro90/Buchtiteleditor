/**
 * token-migrator.js — Legacy-Token-Transformation
 *
 * Referenzarchitektur: Zielmodell Abschnitt 8 (Migrationsstrategie)
 *
 * ZWECK:
 *   Automatische Transformation bekannter Breaking Changes aus dem alten
 *   in das neue Slot-basierte Format. Nur sichere, strukturell eindeutige
 *   Transformationen werden automatisch durchgeführt.
 *
 * PHASENMODELL (nach Zielmodell 8.2):
 *   Phase 1 (jetzt): Transformer + @deprecated-Warnungen, altes Format weiter valide
 *   Phase 2: Automatische Migration gespeicherter Templates
 *   Phase 3: Legacy-Syntax entfernt (wird in separatem Breaking-Change-Release gemacht)
 *
 * WICHTIG:
 *   - Nur auto-migrierbare Changes werden transformiert (Zielmodell Tabelle 8.1)
 *   - ART:ind|plu → ART:zero|plu wird NICHT auto-migriert (semantische Prüfung nötig)
 *   - ART:poss: Reihenfolge-Transformation nur wenn Format eindeutig erkennbar
 */

import { tokenize } from './dsl-validator.js';
import { VALID_ART_SUBTYPES, VALID_PRO_SUBTYPES } from './slot-schema.js';

// ── Einzelne Token-Migratoren ──────────────────────────────────────────────────

/**
 * Bug 2 Fix: 'mas' → 'msk'
 *
 * Alter Zustand: F_GENUS = Set(['msk','fem','neu','mas'])
 * 'mas' war undokumentierter Alias für 'msk', historisches Artefakt.
 *
 * Auto-migrierbar: Ja, eindeutig.
 * Breaking: Tokens mit |mas| werden im neuen Validator abgelehnt.
 */
function migrateMasToMsk(raw) {
  if (!raw.includes('|mas|') && !raw.endsWith('|mas')) return null; // kein Match
  return raw.replace(/\|mas(\||$)/g, (_, after) => `|msk${after}`);
}

/**
 * Neues ART/PRO-Subtyp-Registrierung für neue Subtypen (zero, genposs, indef, int, rez).
 * Diese sind neu und bedürfen keiner Migration — aber wir warnen wenn jemand
 * einen alten Ersatz-Hack verwendet.
 *
 * Erkennungsheuristik: ART:def mit 0 Flags → könnte Null-Artikel-Intent gewesen sein.
 * (Wir warnen hier nur, transformieren nicht automatisch.)
 */

/**
 * Zusammenfassung aller auto-migrierbaren Transformationen.
 * Jeder Migrator gibt null zurück wenn nicht anwendbar, sonst den transformierten raw-String.
 */
const MIGRATORS = [
  {
    name:    'mas→msk',
    applies: raw => raw.includes('|mas|') || raw.endsWith('|mas'),
    migrate: migrateMasToMsk,
    breaking: true,
    note:    '"mas" war undokumentierter Alias für "msk".',
  },
];

// ── Template-level Migrator ───────────────────────────────────────────────────
/**
 * MigrationResult für ein einzelnes Template.
 * @typedef {{ migrated: string, changes: MigrationChange[], warnings: string[] }} MigrationResult
 * @typedef {{ position: number, original: string, transformed: string, migrator: string }} MigrationChange
 */

/**
 * Migriert ein vollständiges DSL-Template.
 *
 * Workflow:
 *   1. tokenize(template) → Token-Array
 *   2. Für jedes Token: alle Migratoren testen und anwenden
 *   3. Template mit transformierten Tokens zusammenbauen
 *
 * @param {string} template
 * @returns {MigrationResult}
 */
export function migrateTemplate(template) {
  if (!template || typeof template !== 'string') {
    return { migrated: template, changes: [], warnings: [] };
  }

  const tokens   = tokenize(template);
  const changes  = [];
  const warnings = [];

  // Wir bauen das Template zeichenweise neu auf
  let result = '';
  let pos    = 0;

  for (const tok of tokens) {
    // Literal: unverändert übernehmen
    if (tok.type === 'literal') {
      result += tok.text;
      pos = tok.end;
      continue;
    }

    if (tok.type === 'unclosed') {
      result += tok.text;
      pos = tok.end;
      continue;
    }

    // Token: Migratoren anwenden
    const raw          = tok.raw;
    let   transformedRaw = raw;
    let   wasTransformed = false;

    for (const migrator of MIGRATORS) {
      if (!migrator.applies(transformedRaw)) continue;

      const next = migrator.migrate(transformedRaw);
      if (next && next !== transformedRaw) {
        changes.push({
          position:    tok.start,
          original:    `{${raw}}`,
          transformed: `{${next}}`,
          migrator:    migrator.name,
          note:        migrator.note,
        });
        transformedRaw = next;
        wasTransformed = true;
      }
    }

    // Noch bestehende @deprecated-Checks (Warnungen ohne Transformation)
    _warnDeprecated(transformedRaw, tok.start, warnings);

    // Token mit ggf. Modifier neu einfügen
    result += `{${transformedRaw}}${tok.mod ?? ''}`;
    pos     = tok.end;
  }

  return {
    migrated: result,
    changes,
    warnings,
  };
}

// ── Deprecation-Warnungen ─────────────────────────────────────────────────────
/**
 * Gibt Warnungen aus für Legacy-Konstrukte, die nicht auto-migrierbar sind.
 * Diese erfordern manuelle Überprüfung.
 */
function _warnDeprecated(raw, position, warnings) {
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return;

  const type = raw.slice(0, colonIdx);
  const rest = raw.slice(colonIdx + 1);

  // ART:ind|plu → Warning: semantische Entscheidung erforderlich
  if (type === 'ART' && rest.startsWith('ind|')) {
    const parts = rest.split('|');
    if (parts[1] === 'plu') {
      warnings.push(
        `[Position ${position}] {${raw}}: ART:ind|plu ist grammatikalisch unmöglich ` +
        `(kein unbestimmter Artikel im Plural). ` +
        `Manuell prüfen: Ersetze durch {ART:zero|plu|${parts.slice(2).join('|')}} ` +
        `wenn ein Null-Artikel gemeint ist.`
      );
    }
  }

  // Alte ART:poss-Reihenfolge — heuristische Erkennung
  // Altes Format: {ART:poss|sgl|nom|neu|p1} (Num zuerst, Person zuletzt)
  // Neues Format: {ART:poss|p1|sgl|nom|neu|sgl} (Person zuerst)
  if (type === 'ART' && rest.startsWith('poss|')) {
    const parts   = rest.split('|').slice(1); // Flags nach 'poss'
    const persons = new Set(['p1','p2','p3','p2form']);
    if (parts.length > 0 && !persons.has(parts[0])) {
      warnings.push(
        `[Position ${position}] {${raw}}: ART:poss scheint altes Format zu verwenden ` +
        `(Person nicht an erster Stelle). ` +
        `Neues Format: {ART:poss|<person>|[p3genus]|<poss-num>|<kasus>|<ziel-genus>|<ziel-num>}. ` +
        `Bitte manuell prüfen und anpassen.`
      );
    }
  }
}

// ── Batch-Migration ───────────────────────────────────────────────────────────
/**
 * Migriert eine Sammlung von Template-Strings.
 * Geeignet für Bulk-Migration aller gespeicherten DSL-Templates.
 *
 * @param {Array<{id: string, template: string}>} entries
 * @returns {Array<{id: string, original: string, migrated: string, changes: MigrationChange[], warnings: string[], changed: boolean}>}
 */
export function batchMigrate(entries) {
  return entries.map(({ id, template }) => {
    const result = migrateTemplate(template);
    return {
      id,
      original:  template,
      migrated:  result.migrated,
      changes:   result.changes,
      warnings:  result.warnings,
      changed:   result.migrated !== template,
    };
  });
}

// ── Migrations-Report ─────────────────────────────────────────────────────────
/**
 * Erstellt einen lesbaren Report für eine Batch-Migration.
 *
 * @param {ReturnType<typeof batchMigrate>} results
 * @returns {string}
 */
export function formatMigrationReport(results) {
  const changed  = results.filter(r => r.changed);
  const warnings = results.filter(r => r.warnings.length > 0);

  const lines = [
    `=== Migrations-Report ===`,
    `Gesamt: ${results.length} Templates`,
    `Geändert: ${changed.length}`,
    `Warnungen: ${warnings.reduce((n, r) => n + r.warnings.length, 0)}`,
    '',
  ];

  if (changed.length > 0) {
    lines.push('── Automatische Änderungen ──────────────────────────');
    for (const r of changed) {
      lines.push(`\n[${r.id}]`);
      for (const c of r.changes) {
        lines.push(`  Pos ${c.position}: ${c.original} → ${c.transformed}`);
        lines.push(`    Grund: ${c.note}`);
      }
    }
  }

  if (warnings.length > 0) {
    lines.push('\n── Manuelle Prüfung erforderlich ─────────────────────');
    for (const r of warnings) {
      lines.push(`\n[${r.id}]`);
      for (const w of r.warnings) {
        lines.push(`  ⚠ ${w}`);
      }
    }
  }

  return lines.join('\n');
}
