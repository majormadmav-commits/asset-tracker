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
import { DRIVE_IDS_STORAGE_KEY } from "./storage-keys.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const JSON_MIME = "application/json";

const FILES = [
  { kind: "assets", idKey: "assetsFileId", name: "assets.json" },
  { kind: "maintenance", idKey: "maintenanceFileId", name: "maintenance.json" },
  { kind: "purchases", idKey: "purchasesFileId", name: "purchases.json" },
];

export class DriveRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "DriveRequestError";
    this.status = status;
  }
}

export function encodeMultipart(metadata, content, contentType) {
  const boundary = `asset_tracker_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const payload = typeof content === "string" ? encoder.encode(content) : content;
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + payload.length + tail.length);
  body.set(head, 0);
  body.set(payload, head.length);
  body.set(tail, head.length + payload.length);
  return {
    contentType: `multipart/related; boundary=${boundary}`,
    body,
  };
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function clip(text, max = 1800) {
  const value = text == null ? "" : String(text);
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export function createDriveStore({
  fetch: fetchImpl = globalThis.fetch,
  getAccessToken,
  storage,
  now = utcNow,
} = {}) {
  if (!fetchImpl) throw new Error("DriveStore needs fetch.");
  if (!getAccessToken) throw new Error("DriveStore needs getAccessToken.");
  if (!storage) throw new Error("DriveStore needs storage for file ids.");

  let ids = null;
  let ready = null;

  function remember(next) {
    ids = next;
    storage.setItem(DRIVE_IDS_STORAGE_KEY, JSON.stringify(next));
  }

  function cachedIds() {
    const raw = storage.getItem(DRIVE_IDS_STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const keys = ["folderId", "photosFolderId", "assetsFileId", "maintenanceFileId", "purchasesFileId"];
      if (keys.every((key) => typeof parsed[key] === "string" && parsed[key])) return parsed;
      return null;
    } catch {
      return null;
    }
  }

  async function api(url, options = {}) {
    const token = await getAccessToken();
    if (!token) throw new DriveRequestError("Google sign-in did not return an access token.", 401);
    let response;
    try {
      response = await fetchImpl(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
    } catch (error) {
      throw new DriveRequestError(`Drive request failed: ${error?.message || error}`);
    }
    if (!response.ok) {
      let detail = "";
      try {
        detail = await response.text();
      } catch {
        detail = response.statusText || "";
      }
      throw new DriveRequestError(`Drive API ${response.status}: ${clip(detail)}`, response.status);
    }
    return response;
  }

  async function listFiles(query) {
    const url =
      `${DRIVE_API}/files?` +
      new URLSearchParams({
        q: query,
        fields: "files(id,name,mimeType,trashed)",
        pageSize: "20",
        spaces: "drive",
      });
    const response = await api(url);
    const data = await response.json();
    return (data.files || []).filter((file) => !file.trashed);
  }

  async function fileExists(fileId) {
    try {
      const response = await api(
        `${DRIVE_API}/files/${encodeURIComponent(fileId)}?` +
          new URLSearchParams({ fields: "id,name,trashed" }),
      );
      const data = await response.json();
      return Boolean(data?.id) && !data.trashed;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  }

  async function createFolder(name, parentId) {
    const response = await api(`${DRIVE_API}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    });
    const data = await response.json();
    if (!data.id) throw new DriveRequestError(`Drive did not return an id for folder ${name}.`);
    return data.id;
  }

  async function findOrCreateFolder(name, parentId) {
    let query = `name = '${escapeQuery(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
    if (parentId) query += ` and '${escapeQuery(parentId)}' in parents`;
    const found = await listFiles(query);
    if (found.length) return found[0].id;
    return createFolder(name, parentId);
  }

  async function createJsonFile(name, parentId, kind) {
    const payload = encodeMultipart(
      { name, mimeType: JSON_MIME, parents: [parentId] },
      serializeDoc(emptyDoc(kind), kind),
      "application/json; charset=UTF-8",
    );
    const response = await api(`${UPLOAD_API}/files?uploadType=multipart`, {
      method: "POST",
      headers: { "Content-Type": payload.contentType },
      body: payload.body,
    });
    const data = await response.json();
    if (!data.id) throw new DriveRequestError(`Drive did not return an id for ${name}.`);
    return data.id;
  }

  async function findOrCreateJson(name, parentId, kind) {
    const query =
      `name = '${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed = false`;
    const found = await listFiles(query);
    if (found.length) return found[0].id;
    return createJsonFile(name, parentId, kind);
  }

  async function ensureReady() {
    if (ids) return ids;
    if (!ready) {
      ready = discover().finally(() => {
        ready = null;
      });
    }
    return ready;
  }

  async function discover() {
    const cached = cachedIds();
    if (cached) {
      const checks = await Promise.all([
        fileExists(cached.folderId),
        fileExists(cached.photosFolderId),
        fileExists(cached.assetsFileId),
        fileExists(cached.maintenanceFileId),
        fileExists(cached.purchasesFileId),
      ]);
      if (checks.every(Boolean)) {
        ids = cached;
        return ids;
      }
      storage.removeItem(DRIVE_IDS_STORAGE_KEY);
    }

    const folderId = await findOrCreateFolder("Asset Tracker");
    const next = { folderId };
    for (const file of FILES) {
      next[file.idKey] = await findOrCreateJson(file.name, folderId, file.kind);
    }
    next.photosFolderId = await findOrCreateFolder("Photos", folderId);
    remember(next);
    return next;
  }

  async function readFile(kind) {
    const layout = await ensureReady();
    const file = FILES.find((item) => item.kind === kind);
    const response = await api(`${DRIVE_API}/files/${layout[file.idKey]}?alt=media`);
    const etag = response.headers.get("etag");
    const text = await response.text();
    let doc;
    try {
      doc = normalizeDoc(text.trim() ? text : null, kind);
    } catch (error) {
      throw new DriveRequestError(`Could not read ${file.name}: ${error?.message || error}`);
    }
    return { doc, etag, fileId: layout[file.idKey], name: file.name };
  }

  async function writeFile(fileId, kind, doc, etag) {
    const payload = encodeMultipart({}, serializeDoc(doc, kind), "application/json; charset=UTF-8");
    const headers = { "Content-Type": payload.contentType };
    if (etag) headers["If-Match"] = etag;
    await api(`${UPLOAD_API}/files/${fileId}?uploadType=multipart`, {
      method: "PATCH",
      headers,
      body: payload.body,
    });
  }

  async function mutate(kind, mutator) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { doc, etag, fileId, name } = await readFile(kind);
      let next;
      try {
        next = mutator(doc);
      } catch (error) {
        throw new DriveRequestError(error?.message || String(error));
      }
      try {
        await writeFile(fileId, kind, next, etag);
        return next;
      } catch (error) {
        lastError = error;
        if (error.status === 412 && attempt < 2) continue;
        throw new DriveRequestError(`Could not save ${name}: ${error.message}`, error.status);
      }
    }
    throw lastError;
  }

  function requireAsset(doc, assetId) {
    const asset = doc.assets.find((item) => item.id === assetId);
    if (!asset) throw new Error(`Asset ${assetId} was not found. Reload and try again.`);
    return asset;
  }

  return {
    kind: "drive",

    async init() {
      await ensureReady();
    },

    async loadAll() {
      const [assets, maintenance, purchases] = await Promise.all([
        readFile("assets"),
        readFile("maintenance"),
        readFile("purchases"),
      ]);
      return { assets: assets.doc, maintenance: maintenance.doc, purchases: purchases.doc };
    },

    async saveAsset(input) {
      const cleaned = cleanAsset(input);
      let saved;
      await mutate("assets", (doc) => {
        assertParentOk(doc.assets, cleaned.id, cleaned.parent_id);
        if (cleaned.id) {
          const index = doc.assets.findIndex((asset) => asset.id === cleaned.id);
          if (index === -1) throw new Error(`Asset ${cleaned.id} was not found. Reload and try again.`);
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
      await mutate("assets", (doc) => {
        const asset = requireAsset(doc, assetId);
        applyMeter(asset, meter, now());
        saved = { ...asset };
        return doc;
      });
      return saved;
    },

    async addMaintenance(input) {
      const cleaned = cleanMaintenance(input);
      if (!cleaned.asset_id) throw new Error("Choose an asset for this maintenance entry.");
      const assets = await readFile("assets");
      requireAsset(assets.doc, cleaned.asset_id);
      let saved;
      await mutate("maintenance", (doc) => {
        const id = assignNewId(doc, "maintenance");
        saved = { ...cleaned, id };
        doc[collectionKey("maintenance")].push(saved);
        return doc;
      });
      return saved;
    },

    async addPurchase(input) {
      const cleaned = cleanPurchase(input);
      if (cleaned.asset_id) {
        const assets = await readFile("assets");
        requireAsset(assets.doc, cleaned.asset_id);
      }
      let saved;
      await mutate("purchases", (doc) => {
        const id = assignNewId(doc, "purchases");
        saved = { ...cleaned, id };
        doc[collectionKey("purchases")].push(saved);
        return doc;
      });
      return saved;
    },

    async uploadPhoto(blob, filename) {
      if (!blob) throw new Error("Choose a photo first.");
      const layout = await ensureReady();
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const payload = encodeMultipart(
        {
          name: filename || `photo-${Date.now()}.jpg`,
          mimeType: blob.type || "image/jpeg",
          parents: [layout.photosFolderId],
        },
        bytes,
        blob.type || "image/jpeg",
      );
      const response = await api(`${UPLOAD_API}/files?uploadType=multipart`, {
        method: "POST",
        headers: { "Content-Type": payload.contentType },
        body: payload.body,
      });
      const data = await response.json();
      if (!data.id) throw new DriveRequestError("Drive did not return a file id for the photo.");
      return data.id;
    },

    async photoUrl(photoId) {
      const response = await api(`${DRIVE_API}/files/${encodeURIComponent(photoId)}?alt=media`);
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    },

    async importSeed(seed) {
      const current = await readFile("assets");
      if (current.doc.assets.length > 0) throw new Error("Import refused: assets.json is not empty.");
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

      await mutate("purchases", (doc) => mergeById(doc, purchases, "purchases"));
      await mutate("maintenance", (doc) => mergeById(doc, maintenance, "maintenance"));
      await mutate("assets", (doc) => {
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
