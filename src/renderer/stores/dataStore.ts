import { create } from 'zustand';

// The renderer's read-only mirror of browsie-data.json. Main owns the file; change it with
// window.browsie.data.update(), and this store follows along via data:changed.
// `loaded` is false only until main's first answer arrives. syncStatus is the Drive backup state.
type DataState = AppData & { loaded: boolean; syncStatus: SyncStatus };

export const useDataStore = create<DataState>()(() => ({
  loaded: false,
  userMode: null,
  settings: {},
  syncStatus: { state: 'disabled', lastSyncedAt: null },
}));

const data = window.browsie?.data;

if (data) {
  // Merge (not replace) so data updates and sync-status updates don't wipe each other.
  data.onChanged((appData) => useDataStore.setState({ ...appData, loaded: true }));
  void data.get().then((appData) => useDataStore.setState({ ...appData, loaded: true }));
  data.onSyncStatusChanged((syncStatus) => useDataStore.setState({ syncStatus }));
  void data.getSyncStatus().then((syncStatus) => useDataStore.setState({ syncStatus }));
} else {
  useDataStore.setState({ loaded: true });
}
