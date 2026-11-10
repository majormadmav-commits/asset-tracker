export const DRIVE_IDS_STORAGE_KEY = "asset-tracker-drive-ids";

export const LOCAL_STORAGE_KEYS = {
  assets: "asset-tracker-local-v1-assets",
  maintenance: "asset-tracker-local-v1-maintenance",
  purchases: "asset-tracker-local-v1-purchases",
  photos: "asset-tracker-local-v1-photos",
};

export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(String(key), String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}
