import {
  assertParentOk,
  assignNewId,
  cleanAsset,
  cleanMaintenance,
  cleanMeter,
  cleanPurchase,
  collectionKey,
  emptyDoc,
  normalizeDoc,
  serializeDoc,
  utcNow,
} from "./schema.js";
import { LOCAL_STORAGE_KEYS } from "./storage-keys.js";

async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const type = blob.type || "application/octet-stream";
  return `data:${type};base64,${btoa(binary)}`;
}

function randomPhotoId() {
  if (globalThis.crypto?.randomUUID) return `local-${crypto.randomUUID()}`;
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createLocalStore({ storage, now = utcNow } = {}) {
  if (!storage) throw new Error("LocalStore needs a storage object.");

  function read(kind) {
    const raw = storage.getItem(LOCAL_STORAGE_KEYS[kind]);
    try {
      return normalizeDoc(raw, kind);
    } catch (error) {
      const message = error?.message || String(error);
      throw new Error(`Could not read ${kind}.json: ${message}`);
    }
  }

  function write(kind, doc) {
    storage.setItem(LOCAL_STORAGE_KEYS[kind], serializeDoc(doc, kind));
  }

  function mutate(kind, mutator) {
    const doc = read(kind);
    const next = mutator(doc);
    write(kind, next);
    return next;
  }

  function requireAsset(assetsDoc, assetId) {
    const asset = assetsDoc.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Asset ${assetId} was not found. Reload and try again.`);
    return asset;
  }

  return {
    kind: "local",

    async init() {},

    async loadAll() {
      return {
        assets: read("assets"),
        maintenance: read("maintenance"),
        purchases: read("purchases"),
      };
    },

    async saveAsset(input) {
      const cleaned = cleanAsset(input);
      let saved;
      mutate("assets", (doc) => {
        assertParentOk(doc.assets, cleaned.id, cleaned.parent_id);
        if (cleaned.id) {
          const index = doc.assets.findIndex((asset) => asset.id === cleaned.id);
          if (index === -1) {
            throw new Error(`Asset ${cleaned.id} was not found. Reload and try again.`);
          }
          const previous = doc.assets[index];
          saved = {
            ...cleaned,
            id: previous.id,
            photo_ids: cleaned.photo_ids || previous.photo_ids,
            updated_at: now(),
          };
          if (!saved.photo_ids) delete saved.photo_ids;
          doc.assets[index] = saved;
          return doc;
        }
        const id = assignNewId(doc, "assets");
        saved = { ...cleaned, id, updated_at: now() };
        doc.assets.push(saved);
        return doc;
      });
      return saved;
    },

    async updateMeter(assetId, input) {
      const meter = cleanMeter(input);
      let saved;
      mutate("assets", (doc) => {
        const asset = requireAsset(doc, assetId);
        applyMeter(asset, meter, now());
        saved = asset;
        return doc;
      });
      return saved;
    },

    async addMaintenance(input) {
      const cleaned = cleanMaintenance(input);
      if (!cleaned.asset_id) throw new Error("Choose an asset for this maintenance entry.");
      let saved;
      const assets = read("assets");
      requireAsset(assets, cleaned.asset_id);
      mutate("maintenance", (doc) => {
        const id = assignNewId(doc, "maintenance");
        saved = { ...cleaned, id };
        doc[collectionKey("maintenance")].push(saved);
        return doc;
      });
      return saved;
    },

    async addPurchase(input) {
      const cleaned = cleanPurchase(input);
      if (cleaned.asset_id) requireAsset(read("assets"), cleaned.asset_id);
      let saved;
      mutate("purchases", (doc) => {
        const id = assignNewId(doc, "purchases");
        saved = { ...cleaned, id };
        doc[collectionKey("purchases")].push(saved);
        return doc;
      });
      return saved;
    },

    async uploadPhoto(blob, filename) {
      if (!blob) throw new Error("Choose a photo first.");
      const id = randomPhotoId();
      const dataUrl = await blobToDataUrl(blob);
      const raw = storage.getItem(LOCAL_STORAGE_KEYS.photos);
      const photos = raw ? JSON.parse(raw) : {};
      photos[id] = { dataUrl, name: filename || `${id}.jpg`, type: blob.type || "image/jpeg" };
      storage.setItem(LOCAL_STORAGE_KEYS.photos, JSON.stringify(photos));
      return id;
    },

    async photoUrl(photoId) {
      const raw = storage.getItem(LOCAL_STORAGE_KEYS.photos);
      if (!raw) return null;
      const photos = JSON.parse(raw);
      return photos[photoId]?.dataUrl || null;
    },

    async importSeed(seed) {
      const current = read("assets");
      if (current.assets.length > 0) {
        throw new Error("Import refused: assets.json is not empty.");
      }
      const assets = normalizeDoc(seed.assets, "assets");
      const maintenance = normalizeDoc(seed.maintenance, "maintenance");
      const purchases = normalizeDoc(seed.purchases, "purchases");
      const assetIds = new Set(assets.assets.map((asset) => asset.id));
      for (const line of purchases.lines) {
        if (line.asset_id && !assetIds.has(line.asset_id)) {
          throw new Error(`Seed purchase ${line.id || ""} points at unknown asset ${line.asset_id}.`);
        }
      }
      const stamped = now();
      assets.assets = assets.assets.map((asset) => ({ ...asset, updated_at: asset.updated_at || stamped }));

      mutate("purchases", (doc) => mergeById(doc, purchases, "purchases"));
      mutate("maintenance", (doc) => mergeById(doc, maintenance, "maintenance"));
      mutate("assets", (doc) => {
        if (doc.assets.length > 0) throw new Error("Import refused: assets.json is not empty.");
        return assets;
      });
    },
  };
}

function applyMeter(asset, meter, updatedAt) {
  for (const key of ["meter_value", "meter_unit", "meter_date"]) {
    if (meter[key] == null) delete asset[key];
    else asset[key] = meter[key];
  }
  asset.updated_at = updatedAt;
}

function mergeById(target, incoming, kind) {
  const key = collectionKey(kind);
  const have = new Set((target[key] || []).map((item) => item.id));
  for (const item of incoming[key] || []) {
    if (!have.has(item.id)) target[key].push(item);
  }
  target.next_id = Math.max(target.next_id, incoming.next_id);
  return normalizeDoc(target, kind);
}
