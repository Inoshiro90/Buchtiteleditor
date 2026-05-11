/**
 * runtime-resolver.js — Runtime-Auflösung von Variablen und MFB-Konstruktion
 *
 * Referenzarchitektur: Zielmodell Abschnitt 7
 *
 * VERANTWORTLICHKEITEN DIESER DATEI:
 *
 *   1. ResolvedSlots → ResolvedMFB: Konvertierung der Slot-Map (string→string)
 *      in ein typisiertes Morphologisches Merkmal-Bündel (MFB).
 *
 *   2. Variable-Auflösung: var:Tier1 → konkretes Genus, def:Gebirge1 → Numerus.
 *      Variablen werden aus dem RuntimeContext aufgelöst.
 *
 *   3. Dispatch zu generateSurface(): MFB → Oberflächenform (String).
 *
 * TRENNUNG VOM VALIDATOR:
 *   Der Validator prüft Syntax und statische Semantik zur Authoring-Zeit.
 *   Dieser Resolver arbeitet zur Render-Zeit mit konkreten Werten.
 *   Fehler hier sind RuntimeErrors (nicht ValidationErrors).
 *
 * FEHLERBEHANDLUNG:
 *   Laut Zielmodell 7.4: Variable-Auflösungsfehler → Token als "??" ausgeben.
 *   Fehlender Tabelleneintrag → RuntimeError mit Fallback-Form.
 */

import { generateSurface } from './flex-tables.js';

// ── RuntimeContext ────────────────────────────────────────────────────────────
/**
 * @typedef {Object} RuntimeContext
 * @property {Map<string,{lemma:string, genus:string, numerus:string, kasus?:string}>} vars
 *   Aufgelöste Token-Variablen (NOM:Held1 → { genus:'msk', numerus:'sgl', ... })
 * @property {Map<string,{genus:string, volk:string, region:string}>} refs
 *   NAM-Referenzen (Vorname1 → { genus:'msk', ... })
 */

/** Leerer RuntimeContext für Tests und einfache Auflösung ohne Variablen. */
export function emptyContext() {
  return { vars: new Map(), refs: new Map() };
}

// ── Variablen-Resolver ────────────────────────────────────────────────────────
/**
 * GENUS_EXT auflösen: 'msk'|'fem'|'neu' → direkt, 'var:Tier1' → aus Context.
 *
 * @param {string} value
 * @param {RuntimeContext} ctx
 * @returns {{ resolved: string|null, error: string|null }}
 */
export function resolveGenusExt(value, ctx) {
  if (value === 'msk' || value === 'fem' || value === 'neu') {
    return { resolved: value, error: null };
  }
  if (value.startsWith('var:')) {
    const varName  = value.slice(4);
    const varEntry = ctx.vars.get(varName);
    if (!varEntry) {
      return { resolved: null, error: `Genus-Variable "${varName}" nicht im Laufzeitkontext.` };
    }
    return { resolved: varEntry.genus, error: null };
  }
  return { resolved: null, error: `Unbekannter GENUS_EXT-Wert "${value}".` };
}

/**
 * NUMERUS_EXT auflösen: 'sgl'|'plu' → direkt, 'def:Gebirge1' → aus Context.
 *
 * @param {string} value
 * @param {RuntimeContext} ctx
 * @returns {{ resolved: string|null, error: string|null }}
 */
export function resolveNumerusExt(value, ctx) {
  if (value === 'sgl' || value === 'plu') {
    return { resolved: value, error: null };
  }
  if (value.startsWith('def:')) {
    const varName  = value.slice(4);
    const varEntry = ctx.vars.get(varName);
    if (!varEntry) {
      return { resolved: null, error: `Defektiva-Variable "${varName}" nicht im Laufzeitkontext.` };
    }
    return { resolved: varEntry.numerus, error: null };
  }
  return { resolved: null, error: `Unbekannter NUMERUS_EXT-Wert "${value}".` };
}

// ── MFB-Builder aus ResolvedSlots ────────────────────────────────────────────
/**
 * Baut ein vollständiges ResolvedMFB aus den Slot-Werten und dem RuntimeContext.
 *
 * Die ResolvedSlots (Map<string,string>) kommen aus dem SlotBinder im Validator.
 * Für den Runtime-Pfad werden dieselben Schemas verwendet — der Unterschied ist,
 * dass hier Variablen aufgelöst werden.
 *
 * @param {string} type          'ART' | 'PRO'
 * @param {string} subtype
 * @param {Map<string,string>} slots   Ergebnis von bindSlots()
 * @param {RuntimeContext} ctx
 * @returns {{ mfb: Object|null, errors: string[] }}
 */
export function buildMFB(type, subtype, slots, ctx) {
  const errors = [];
  const mfb    = { type, subtype };

  /** Hilfsfunktion: Wert aus Slots holen, mit Fehler wenn fehlend */
  function req(name) {
    const v = slots.get(name);
    if (v === undefined) errors.push(`Pflicht-Slot "${name}" fehlt in Slots.`);
    return v;
  }

  /** Genus-Ext auflösen mit Fehler-Akkumulation */
  function resolveG(name) {
    const raw = slots.get(name);
    if (!raw) return undefined;
    const { resolved, error } = resolveGenusExt(raw, ctx);
    if (error) errors.push(error);
    return resolved;
  }

  /** Numerus-Ext auflösen mit Fehler-Akkumulation */
  function resolveN(name) {
    const raw = slots.get(name);
    if (!raw) return undefined;
    const { resolved, error } = resolveNumerusExt(raw, ctx);
    if (error) errors.push(error);
    return resolved;
  }

  // ── Gemeinsame Felder je nach Subtyp ──────────────────────────────────────
  switch (`${type}:${subtype}`) {

    case 'ART:def':
    case 'ART:ind':
    case 'ART:zero':
    case 'ART:neg':
    case 'ART:w':
      mfb.numerus = resolveN('numerus') ?? req('numerus');
      mfb.kasus   = req('kasus');
      mfb.genus   = resolveG('genus') ?? req('genus');
      break;

    case 'ART:poss':
    case 'PRO:poss':
      mfb.person    = req('person');
      mfb.p3genus   = slots.get('p3genus');  // optional (nur bei p3)
      mfb.poss_num  = resolveN('poss_num');
      mfb.kasus     = req('kasus');
      mfb.ziel_genus = resolveG('ziel_genus');
      mfb.ziel_num  = resolveN('ziel_num');
      mfb.mode      = slots.get('mode') ?? 'attr';  // default: attr
      break;

    case 'ART:genposs':
    case 'PRO:genposs':
      mfb.ant_genus = req('ant_genus');
      mfb.ant_num   = req('ant_num');
      break;

    case 'ART:dem':
    case 'PRO:dem':
      mfb.numerus = resolveN('numerus');
      mfb.kasus   = req('kasus');
      mfb.genus   = resolveG('genus');
      mfb.stem    = req('stem');
      break;

    case 'ART:quant':
    case 'PRO:quant':
      mfb.numerus = resolveN('numerus');
      mfb.kasus   = req('kasus');
      mfb.genus   = resolveG('genus');
      mfb.stem    = req('stem');
      break;

    case 'PRO:pers':
      mfb.person  = req('person');
      mfb.numerus = resolveN('numerus');
      mfb.kasus   = req('kasus');
      mfb.genus   = resolveG('genus');  // optional (nur bei p3)
      break;

    case 'PRO:refl':
      mfb.person  = req('person');
      mfb.numerus = resolveN('numerus');
      mfb.kasus   = req('kasus');
      break;

    case 'PRO:rel':
      mfb.numerus = resolveN('numerus');
      mfb.kasus   = req('kasus');
      mfb.genus   = resolveG('genus');
      break;

    case 'PRO:indef':
      mfb.indef_form = req('indef_form');
      mfb.kasus      = req('kasus');
      break;

    case 'PRO:int':
      mfb.int_form = req('int_form');
      mfb.kasus    = req('kasus');
      mfb.genus    = resolveG('genus');  // optional (nur bei welch)
      mfb.numerus  = slots.get('numerus') ?? 'sgl'; // Fallback für welch
      break;

    case 'PRO:rez':
      mfb.kasus = req('kasus');
      break;

    default:
      errors.push(`Unbekannter MFB-Typ "${type}:${subtype}".`);
  }

  return { mfb: errors.length === 0 ? mfb : null, errors };
}

// ── Vollständige Render-Pipeline ─────────────────────────────────────────────
/**
 * Rendert ein ART/PRO-Token zur Oberflächenform.
 *
 * Pipeline (nach Zielmodell 7.1):
 *   rawFlags → buildMFB() → generateSurface() → applyCaseModifier() → string
 *
 * @param {string} type          'ART' | 'PRO'
 * @param {string} subtype
 * @param {Map<string,string>} slots    Aus SlotBinder
 * @param {RuntimeContext} ctx
 * @param {string|null} mod      '^' (Großschreibung) | '_' (Kleinschreibung) | null
 * @returns {string}  Oberflächenform oder Fehlermarker '??'
 */
export function renderToken(type, subtype, slots, ctx = emptyContext(), mod = null) {
  const { mfb, errors } = buildMFB(type, subtype, slots, ctx);

  if (errors.length > 0 || !mfb) {
    console.warn(`[runtime-resolver] Render-Fehler für ${type}:${subtype}:`, errors);
    return '??';
  }

  let surface;
  try {
    surface = generateSurface(mfb);
  } catch (e) {
    console.warn(`[runtime-resolver] generateSurface Fehler:`, e);
    return '??';
  }

  return applyCaseModifier(surface, mod);
}

// ── Case-Modifier ─────────────────────────────────────────────────────────────
/**
 * Wendet den ^ oder _ Modifier auf die Oberflächenform an.
 * '^' → Ersten Buchstaben kapitalisieren (Satzanfang).
 * '_' → Alles klein (selten benötigt, für Sonderformen).
 */
export function applyCaseModifier(surface, mod) {
  if (!surface) return surface;
  if (mod === '^') return surface.charAt(0).toUpperCase() + surface.slice(1);
  if (mod === '_') return surface.toLowerCase();
  return surface;
}

// ── Kontext-Befüllungs-Helpers ───────────────────────────────────────────────
/**
 * Registriert eine aufgelöste NOM-Variable im RuntimeContext.
 * Wird aufgerufen, wenn ein NOM-Token verarbeitet wird.
 *
 * @param {RuntimeContext} ctx
 * @param {string} varName    z.B. 'Held1'
 * @param {Object} entry      { lemma, genus, numerus, kasus? }
 */
export function registerVar(ctx, varName, entry) {
  ctx.vars.set(varName, entry);
}

/**
 * Registriert eine NAM-Referenz im RuntimeContext.
 *
 * @param {RuntimeContext} ctx
 * @param {string} refName    z.B. 'Vorname1'
 * @param {Object} entry      { genus, volk, region }
 */
export function registerRef(ctx, refName, entry) {
  ctx.refs.set(refName, entry);
}
