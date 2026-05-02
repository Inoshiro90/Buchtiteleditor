// editor/ui/modals/modal-base.js
// Lightweight <dialog>-based modal system

/**
 * Open a native <dialog> modal.
 *
 * @param {object} options
 * @param {string}   options.id         — unique element ID
 * @param {string}   options.title      — modal header title
 * @param {string}   options.bodyHTML   — inner HTML for the modal body
 * @param {Array}    options.buttons    — [{ label, cls, action }]  action = 'close' | fn
 * @param {string}   options.width      — CSS width (default '520px')
 * @param {Function} options.onOpen     — callback after dialog is shown
 * @param {Function} options.onClose    — callback when dialog closes
 * @returns {{ dialog, close }}
 */
export function openModal({ id, title, bodyHTML, buttons = [], width = '520px', onOpen, onClose }) {
  // Remove any existing instance
  document.getElementById(id)?.remove();

  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.style.cssText = `width:${width};`;

  const btnHTML = buttons.map((b, i) =>
    `<button class="btn ${b.cls ?? 'btn-secondary'}" data-action="${i}">${b.label}</button>`
  ).join('');

  dialog.innerHTML = `
    <div class="modal-header">
      <span class="modal-title">${title}</span>
      <button class="modal-close" data-action="close" aria-label="Schließen"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button>
    </div>
    <div class="modal-body" id="${id}-body">${bodyHTML}</div>
    ${buttons.length ? `<div class="modal-footer">${btnHTML}</div>` : ''}
  `;

  document.getElementById('dialog-host').appendChild(dialog);

  function close() {
    dialog.close();
    dialog.remove();
    onClose?.();
  }

  // Button event delegation
  dialog.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'close') { close(); return; }
    const idx = parseInt(action, 10);
    if (!isNaN(idx) && buttons[idx]) {
      if (buttons[idx].action === 'close') { close(); return; }
      if (typeof buttons[idx].action === 'function') buttons[idx].action(close);
    }
  });

  // Click outside to close
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) close();
  });

  dialog.showModal();
  onOpen?.(dialog, document.getElementById(`${id}-body`));

  return { dialog, close };
}

/**
 * Show a simple confirmation dialog.
 */
export function confirmModal({ title, message, confirmLabel = 'OK', cancelLabel = 'Abbrechen', onConfirm }) {
  openModal({
    id: 'modal-confirm',
    title,
    bodyHTML: `<p style="color:var(--c-text-muted);line-height:1.6">${message}</p>`,
    buttons: [
      { label: cancelLabel, cls: 'btn-secondary', action: 'close' },
      { label: confirmLabel, cls: 'btn-primary', action: (close) => { onConfirm?.(); close(); } },
    ],
    width: '420px',
  });
}

/**
 * Show a toast notification.
 */
export function showToast(message, type = 'info', duration = 3000) {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toast-host';
    document.body.appendChild(host);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity 0.3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 320);
  }, duration);
}
