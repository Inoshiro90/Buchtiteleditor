// scripts/ui/grid-context.js
// Gemeinsamer Kontext-Container für AG Grid API und aktives Schema.
// Wird von table.js befüllt und von find-replace-bar.js gelesen.
// Verhindert zirkuläre Abhängigkeiten zwischen table.js und find-replace-bar.js.

export const gridContext = {
  /** @returns {import('ag-grid-community').GridApi | null} */
  getApi:    () => null,
  /** @returns {object | null} aktuelles Schema */
  getSchema: () => null,
};
