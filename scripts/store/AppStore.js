// editor/store/AppStore.js
const _state = {
  activeSchema: null,
  rows: [],
  errors: [],
  duplicates: [],
  schemas: [],
  loading: false,
  loadingMessage: '',
  loadingProgress: 0,
  filterText: '',
  selectedRows: [],
};

const _bus = new EventTarget();

export const AppStore = {
  get: (key) => _state[key],

  set(key, value) {
    _state[key] = value;
    _bus.dispatchEvent(new CustomEvent('change', { detail: { key, value } }));
  },

  on(key, fn) {
    _bus.addEventListener('change', (e) => {
      if (e.detail.key === key) fn(e.detail.value);
    });
  },

  getState: () => ({ ..._state }),
};
