// scripts/services/schema-meta-service.js
// Tracks per-schema metadata: createdAt, modifiedAt, lastAccessedAt, rowCount.
// Stored in IndexedDB under 'meta' / 'schemaMeta'.

import { db } from '../db/db.js';

// ── Load / Save ────────────────────────────────────────────────────────────
async function loadMeta() {
  return (await db.get('meta', 'schemaMeta')) ?? {};
}

async function saveMeta(meta) {
  await db.set('meta', 'schemaMeta', meta);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Called when a schema is first registered (either built-in on first boot,
 * or when a new class is created). Only writes createdAt if not already set.
 */
export async function touchCreated(schemaId) {
  const meta = await loadMeta();
  if (!meta[schemaId]) meta[schemaId] = {};
  if (!meta[schemaId].createdAt) {
    meta[schemaId].createdAt = Date.now();
  }
  await saveMeta(meta);
}

/**
 * Called whenever rows in a schema are written to IndexedDB.
 * Updates modifiedAt and rowCount.
 */
export async function touchModified(schemaId, rowCount) {
  const meta = await loadMeta();
  if (!meta[schemaId]) meta[schemaId] = {};
  meta[schemaId].modifiedAt = Date.now();
  if (typeof rowCount === 'number') meta[schemaId].rowCount = rowCount;
  // Ensure createdAt exists (for schemas that predate this feature)
  if (!meta[schemaId].createdAt) meta[schemaId].createdAt = meta[schemaId].modifiedAt;
  await saveMeta(meta);
}

/**
 * Called whenever a schema is selected / opened in the sidebar.
 */
export async function touchAccessed(schemaId) {
  const meta = await loadMeta();
  if (!meta[schemaId]) meta[schemaId] = {};
  meta[schemaId].lastAccessedAt = Date.now();
  if (!meta[schemaId].createdAt) meta[schemaId].createdAt = Date.now();
  await saveMeta(meta);
}

/**
 * Returns a snapshot of all metadata.
 * Shape: { [schemaId]: { createdAt, modifiedAt, lastAccessedAt, rowCount } }
 */
export async function getAllMeta() {
  return loadMeta();
}

/**
 * Updates rowCount for a schema without bumping modifiedAt.
 * Used after loading rows from DB on startup.
 */
export async function setRowCount(schemaId, rowCount) {
  const meta = await loadMeta();
  if (!meta[schemaId]) meta[schemaId] = {};
  meta[schemaId].rowCount = rowCount;
  await saveMeta(meta);
}
