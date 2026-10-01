import { create } from 'zustand';

// The renderer's read-only mirror of browsie-data.json. Main owns the file; change it with
// window.browsie.data.update(), and this store follows along via data:changed.
// `loaded` is false only until main's first answer arrives.
type DataState = AppData & { loaded: boolean };

export const useDataStore = create<DataState>()(() => ({ loaded: false, userMode: null, settings: {} }));

const data = window.browsie?.data;

if (data) {
  data.onChanged((appData) => useDataStore.setState({ ...appData, loaded: true }, true));
  void data.get().then((appData) => useDataStore.setState({ ...appData, loaded: true }, true));
} else {
  useDataStore.setState({ loaded: true });
}
