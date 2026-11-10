import assert from "node:assert/strict";
import test from "node:test";
import { createDriveStore } from "../site/js/drive-store.js";
import { DRIVE_IDS_STORAGE_KEY, memoryStorage } from "../site/js/storage-keys.js";

const TOKEN = "ya29.test-token";
const NOW = "2026-11-10T15:00:00.000Z";

function decodeUrl(url) {
  return decodeURIComponent(url.replace(/\+/g, " "));
}

function bodyText(body) {
  if (typeof body === "string") return body;
  return new TextDecoder().decode(body);
}

function includesBytes(haystack, needle) {
  const bytes = haystack instanceof Uint8Array ? haystack : new Uint8Array(haystack);
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const call = {
      url: String(url),
      method: (options.method || "GET").toUpperCase(),
      headers: { ...(options.headers || {}) },
      body: options.body,
    };
    calls.push(call);
    for (const route of routes) {
      if (route.method && route.method !== call.method) continue;
      if (!route.match(call)) continue;
      const result = typeof route.reply === "function" ? route.reply(call) : route.reply;
      let payload;
      if (result.body instanceof Uint8Array || typeof result.body === "string") payload = result.body;
      else payload = JSON.stringify(result.json ?? {});
      return new Response(payload, {
        status: result.status || 200,
        headers: result.headers || { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ error: "unmocked", url: call.url, method: call.method }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

function assertAuthorized(calls) {
  for (const call of calls) {
    assert.equal(call.headers.Authorization, `Bearer ${TOKEN}`);
    assert.ok(call.url.startsWith("https://www.googleapis.com/"), call.url);
  }
}

function storeWith(fetchImpl, storage = memoryStorage()) {
  return createDriveStore({
    fetch: fetchImpl,
    storage,
    getAccessToken: async () => TOKEN,
    now: () => NOW,
  });
}

function existsRoute(ids) {
  return {
    method: "GET",
    match: (call) => !call.url.includes("q=") && !call.url.includes("alt=media") && ids.some((id) => call.url.includes(`/files/${id}`)),
    reply: (call) => {
      const id = ids.find((item) => call.url.includes(`/files/${item}`));
      return { json: { id, name: id, trashed: false } };
    },
  };
}

test("cold start finds nothing and creates the folder, three JSON files, and Photos", async () => {
  const created = [];
  const { fetchImpl, calls } = mockFetch([
    {
      method: "GET",
      match: (call) => call.url.includes("q="),
      reply: { json: { files: [] } },
    },
    {
      method: "POST",
      match: (call) => call.url === "https://www.googleapis.com/drive/v3/files",
      reply: (call) => {
        const meta = JSON.parse(call.body);
        created.push(meta);
        return { json: { id: meta.name === "Asset Tracker" ? "folder1" : "photos1" } };
      },
    },
    {
      method: "POST",
      match: (call) => call.url.includes("uploadType=multipart"),
      reply: (call) => {
        const text = bodyText(call.body);
        created.push(text);
        assert.match(call.headers["Content-Type"], /^multipart\/related; boundary=/);
        const name = text.includes("assets.json") ? "assets1" : text.includes("maintenance.json") ? "maint1" : "purch1";
        return { json: { id: name } };
      },
    },
  ]);
  const storage = memoryStorage();
  const store = storeWith(fetchImpl, storage);
  await store.init();
  assertAuthorized(calls);

  const lists = calls.filter((call) => call.method === "GET");
  assert.equal(lists.length, 5);
  assert.match(decodeUrl(lists[0].url), /name = 'Asset Tracker'/);
  assert.match(decodeUrl(lists[0].url), /application\/vnd\.google-apps\.folder/);
  assert.match(decodeUrl(lists[1].url), /name = 'assets.json'/);
  assert.match(decodeUrl(lists[1].url), /'folder1' in parents/);
  assert.match(decodeUrl(lists[4].url), /name = 'Photos'/);
  assert.match(decodeUrl(lists[4].url), /'folder1' in parents/);

  assert.equal(calls.filter((call) => call.method === "POST").length, 5);
  assert.deepEqual(created[0], { name: "Asset Tracker", mimeType: "application/vnd.google-apps.folder" });
  assert.match(created[1], /"name":"assets.json"/);
  assert.match(created[1], /"parents":\["folder1"\]/);
  assert.match(created[1], /"schema_version": 1/);
  assert.match(created[1], /"assets": \[\]/);
  assert.match(created[2], /maintenance\.json/);
  assert.match(created[3], /purchases\.json/);
  assert.deepEqual(created[4], {
    name: "Photos",
    mimeType: "application/vnd.google-apps.folder",
    parents: ["folder1"],
  });

  assert.deepEqual(JSON.parse(storage.getItem(DRIVE_IDS_STORAGE_KEY)), {
    folderId: "folder1",
    assetsFileId: "assets1",
    maintenanceFileId: "maint1",
    purchasesFileId: "purch1",
    photosFolderId: "photos1",
  });
});

test("an existing folder and files are reused without creating new ones", async () => {
  const { fetchImpl, calls } = mockFetch([
    {
      method: "GET",
      match: (call) => call.url.includes("q="),
      reply: (call) => {
        const q = decodeUrl(call.url);
        const id = q.includes("Asset Tracker")
          ? "folder1"
          : q.includes("assets.json")
            ? "assets1"
            : q.includes("maintenance.json")
              ? "maint1"
              : q.includes("purchases.json")
                ? "purch1"
                : "photos1";
        return { json: { files: [{ id, name: id, trashed: false }] } };
      },
    },
  ]);
  const store = storeWith(fetchImpl);
  await store.init();
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.method === "GET"));
  assertAuthorized(calls);
});

test("cached file ids are checked and skip the search", async () => {
  const storage = memoryStorage({
    [DRIVE_IDS_STORAGE_KEY]: JSON.stringify({
      folderId: "folder1",
      photosFolderId: "photos1",
      assetsFileId: "assets1",
      maintenanceFileId: "maint1",
      purchasesFileId: "purch1",
    }),
  });
  const { fetchImpl, calls } = mockFetch([
    existsRoute(["folder1", "photos1", "assets1", "maint1", "purch1"]),
  ]);
  const store = storeWith(fetchImpl, storage);
  await store.init();
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => call.method === "GET" && !call.url.includes("q=")));
  assertAuthorized(calls);
});

test("save re-reads assets and patches with a multipart body and If-Match", async () => {
  const storage = memoryStorage({
    [DRIVE_IDS_STORAGE_KEY]: JSON.stringify({
      folderId: "folder1",
      photosFolderId: "photos1",
      assetsFileId: "assets1",
      maintenanceFileId: "maint1",
      purchasesFileId: "purch1",
    }),
  });
  const remote = {
    schema_version: 1,
    next_id: 3,
    assets: [
      { id: "A0001", name: "Boat", updated_at: "2020-01-01T00:00:00.000Z" },
      { id: "A0002", name: "Camper", updated_at: "2020-01-01T00:00:00.000Z" },
    ],
  };
  const { fetchImpl, calls } = mockFetch([
    existsRoute(["folder1", "photos1", "assets1", "maint1", "purch1"]),
    {
      method: "GET",
      match: (call) => call.url.includes("/files/assets1?alt=media"),
      reply: {
        body: JSON.stringify(remote),
        headers: { "Content-Type": "application/json", ETag: '"v1"' },
      },
    },
    {
      method: "PATCH",
      match: (call) => call.url.includes("uploadType=multipart") && call.url.includes("/files/assets1"),
      reply: { json: { id: "assets1" } },
    },
  ]);
  const store = storeWith(fetchImpl, storage);
  const saved = await store.saveAsset({ id: "A0001", name: "Boat 2", notes: "slipped" });
  assert.equal(saved.id, "A0001");
  assert.equal(saved.updated_at, NOW);
  const patch = calls.find((call) => call.method === "PATCH");
  assert.ok(patch);
  assert.equal(patch.headers["If-Match"], '"v1"');
  assert.match(patch.headers["Content-Type"], /^multipart\/related; boundary=/);
  const text = bodyText(patch.body);
  assert.match(text, /"name": "Boat 2"/);
  assert.match(text, /"notes": "slipped"/);
  assert.match(text, /"name": "Camper"/);
  assert.match(text, /"updated_at": "2026-11-10T15:00:00.000Z"/);
  const ids = [...text.matchAll(/"id": "(A\d+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["A0001", "A0002"]);
  assertAuthorized(calls);
});

test("a 412 conflict re-reads and does not reuse an id added by the other writer", async () => {
  const storage = memoryStorage({
    [DRIVE_IDS_STORAGE_KEY]: JSON.stringify({
      folderId: "folder1",
      photosFolderId: "photos1",
      assetsFileId: "assets1",
      maintenanceFileId: "maint1",
      purchasesFileId: "purch1",
    }),
  });
  let reads = 0;
  let patches = 0;
  const first = { schema_version: 1, next_id: 2, assets: [{ id: "A0001", name: "Boat" }] };
  const second = {
    schema_version: 1,
    next_id: 3,
    assets: [
      { id: "A0001", name: "Boat" },
      { id: "A0002", name: "Shed" },
    ],
  };
  const { fetchImpl, calls } = mockFetch([
    existsRoute(["folder1", "photos1", "assets1", "maint1", "purch1"]),
    {
      method: "GET",
      match: (call) => call.url.includes("alt=media"),
      reply: () => {
        reads += 1;
        const doc = reads === 1 ? first : second;
        return {
          body: JSON.stringify(doc),
          headers: { "Content-Type": "application/json", ETag: reads === 1 ? '"v1"' : '"v2"' },
        };
      },
    },
    {
      method: "PATCH",
      match: (call) => call.method === "PATCH",
      reply: (call) => {
        patches += 1;
        if (patches === 1) {
          assert.equal(call.headers["If-Match"], '"v1"');
          return { status: 412, json: { error: { message: "precondition failed" } } };
        }
        assert.equal(call.headers["If-Match"], '"v2"');
        return { json: { id: "assets1" } };
      },
    },
  ]);
  const store = storeWith(fetchImpl, storage);
  const saved = await store.saveAsset({ name: "Camper" });
  assert.equal(saved.id, "A0003");
  assert.equal(reads, 2);
  assert.equal(patches, 2);
  const text = bodyText(calls.filter((call) => call.method === "PATCH")[1].body);
  const ids = [...text.matchAll(/"id": "(A\d+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["A0001", "A0002", "A0003"]);
  assert.match(text, /"name": "Shed"/);
  assert.match(text, /"name": "Camper"/);
  assert.match(text, /"next_id": 4/);
  assertAuthorized(calls);
});

test("photo upload is a multipart create in the Photos folder", async () => {
  const storage = memoryStorage({
    [DRIVE_IDS_STORAGE_KEY]: JSON.stringify({
      folderId: "folder1",
      photosFolderId: "photos1",
      assetsFileId: "assets1",
      maintenanceFileId: "maint1",
      purchasesFileId: "purch1",
    }),
  });
  const bytes = Uint8Array.from([9, 8, 7, 6, 255, 0, 1]);
  const { fetchImpl, calls } = mockFetch([
    existsRoute(["folder1", "photos1", "assets1", "maint1", "purch1"]),
    {
      method: "POST",
      match: (call) => call.url === "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      reply: (call) => {
        const text = bodyText(call.body);
        assert.match(call.headers["Content-Type"], /^multipart\/related; boundary=/);
        assert.match(text, /"parents":\["photos1"\]/);
        assert.match(text, /"name":"furnace.jpg"/);
        assert.match(text, /"mimeType":"image\/jpeg"/);
        assert.equal(includesBytes(call.body, bytes), true);
        return { json: { id: "photo-9" } };
      },
    },
  ]);
  const store = storeWith(fetchImpl, storage);
  const id = await store.uploadPhoto(new Blob([bytes], { type: "image/jpeg" }), "furnace.jpg");
  assert.equal(id, "photo-9");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assertAuthorized(calls);
});

test("a newer schema and a Drive error are shown, and nothing is written", async () => {
  const storage = memoryStorage({
    [DRIVE_IDS_STORAGE_KEY]: JSON.stringify({
      folderId: "folder1",
      photosFolderId: "photos1",
      assetsFileId: "assets1",
      maintenanceFileId: "maint1",
      purchasesFileId: "purch1",
    }),
  });
  const { fetchImpl, calls } = mockFetch([
    existsRoute(["folder1", "photos1", "assets1", "maint1", "purch1"]),
    {
      method: "GET",
      match: (call) => call.url.includes("alt=media"),
      reply: {
        body: JSON.stringify({ schema_version: 9, next_id: 1, assets: [] }),
        headers: { "Content-Type": "application/json", ETag: '"v9"' },
      },
    },
  ]);
  const store = storeWith(fetchImpl, storage);
  await assert.rejects(() => store.saveAsset({ name: "Nope" }), /schema_version 9/);
  assert.equal(calls.some((call) => call.method === "PATCH"), false);

  const denied = mockFetch([
    {
      method: "GET",
      match: () => true,
      reply: {
        status: 403,
        json: { error: { message: "accessNotConfigured: Drive API has not been used" } },
      },
    },
  ]);
  const failing = storeWith(denied.fetchImpl);
  await assert.rejects(() => failing.init(), /Drive API 403:.*accessNotConfigured/);
});
