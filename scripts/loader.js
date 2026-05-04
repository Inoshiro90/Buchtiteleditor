    import { AppStore } from './store/AppStore.js';
    import { db } from './db/db.js';
    import { DEFAULT_SCHEMAS } from './db/schemas.js';
    import { parseCsv } from './services/csv-service.js';
    import { detectDuplicates } from './services/duplicate-service.js';
    import { initSidebar, restoreTheme } from './ui/sidebar.js';
    import { touchCreated, touchModified } from './services/schema-meta-service.js';
    import { initToolbar } from './ui/toolbar.js';
    import { initTable } from './ui/table.js';
    import { initStatusbar } from './ui/statusbar.js';

    // Phase 2-5 — import to register global event listeners
    import './ui/modals/token-insert.js';
    import './ui/modals/import-dialog.js';
    import './ui/modals/export-warning.js';
    import './ui/modals/auto-tags-dialog.js';
    import './ui/modals/new-class.js';
    import './ui/modals/database-modal.js';
    import './ui/modals/batch-modal.js';

    // Restore theme before first paint
    restoreTheme();

    // ── Helpers ─────────────────────────────────────────────────────────
    function setProgress(pct, msg) {
      const bar = document.getElementById('loading-bar-fill');
      const txt = document.getElementById('loading-message');
      if (bar) bar.style.width = `${pct}%`;
      if (txt) txt.textContent = msg;
    }

    function hideOverlay() {
      const overlay = document.getElementById('loading-overlay');
      const app = document.getElementById('app');
      if (overlay) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.6s ease';
        setTimeout(() => overlay.remove(), 650);
      }
      if (app) app.classList.remove('hidden');
    }

    // ── Initial data migration ───────────────────────────────────────────
    async function migrateFromCSV() {
      const total = DEFAULT_SCHEMAS.length;
      let done = 0;

      for (const schema of DEFAULT_SCHEMAS) {
        setProgress(Math.round((done / total) * 90), `Lade ${schema.label} …`);
        try {
          const res = await fetch(schema.file);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const text = await res.text();
          const { rows } = parseCsv(text);
          // Assign internal IDs
          const withIds = rows.map((r, i) => ({
            ...r,
            _id: `${schema.id}_${i}_${Date.now()}`,
          }));
          const withDups = detectDuplicates(withIds, schema.type);
          await db.set('tables', schema.id, withDups);
        } catch (err) {
          console.warn(`[migration] Konnte ${schema.file} nicht laden:`, err.message);
          // Store empty array so schema is registered
          await db.set('tables', schema.id, []);
        }
        done++;
      }
      setProgress(95, 'Schemata speichern …');
    }

    // ── Boot sequence ────────────────────────────────────────────────────
    async function boot() {
      setProgress(0, 'IndexedDB öffnen …');

      const isInit = await db.isInitialized();

      if (!isInit) {
        setProgress(5, 'Erststart: CSVs werden geladen …');
        await migrateFromCSV();
        await db.setInitialized();
        setProgress(100, 'Bereit!');
      } else {
        setProgress(50, 'Daten laden …');
        // Quick validation pass
        await new Promise(r => setTimeout(r, 100));
        setProgress(100, 'Bereit!');
      }

      // Store schemas (including any custom ones saved in db)
      let schemas = [...DEFAULT_SCHEMAS];
      try {
        const customSchemas = (await db.get('schemas', 'custom')) ?? [];
        // Migrate: old schemas stored with group:'custom' → correct type-based group
        const migratedCustom = customSchemas.map(s => ({
          ...s,
          group: s.type === 'adjektiv' ? 'adjektiv' : s.type === 'defektivum' ? 'defektiv' : 'nomen',
          custom: true,
          deletable: true,
        }));
        schemas = [...schemas, ...migratedCustom];
      } catch (_) { }
      AppStore.set('schemas', schemas);

      // Seed createdAt metadata for all schemas (no-op if already set)
      for (const schema of schemas) {
        await touchCreated(schema.id);
      }

      // Init UI components
      await initSidebar(document.getElementById('sidebar'));
      initToolbar(document.getElementById('toolbar'));
      await initTable(document.getElementById('table-container'));
      initStatusbar(document.getElementById('statusbar'));

      // Select first schema
      if (schemas.length > 0) {
        AppStore.set('activeSchema', schemas[0]);
      }

      hideOverlay();
    }

    boot().catch((err) => {
      console.error('[boot] Fehler:', err);
      document.getElementById('loading-message').textContent =
        '⚠ Startfehler: ' + err.message;
    });