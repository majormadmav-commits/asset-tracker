import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createLocalStore } from "../site/js/local-store.js";
import { LOCAL_STORAGE_KEYS, memoryStorage } from "../site/js/storage-keys.js";

const NOW = "2026-11-10T15:00:00.000Z";

function store(storage = memoryStorage()) {
  return { storage, api: createLocalStore({ storage, now: () => NOW }) };
}

test("two stores on one storage re-read before assigning the next id", async () => {
  const { storage, api: first } = store();
  const second = createLocalStore({ storage, now: () => NOW });
  const boat = await first.saveAsset({ name: "Boat", notes: "  ", owner_entity: "" });
  const camper = await second.saveAsset({ name: "Camper" });
  assert.equal(boat.id, "A0001");
  assert.equal(camper.id, "A0002");
  const saved = JSON.parse(storage.getItem(LOCAL_STORAGE_KEYS.assets));
  assert.deepEqual(
    saved.assets.map((asset) => asset.name),
    ["Boat", "Camper"],
  );
  assert.equal(saved.assets[0].notes, undefined);
  assert.equal(saved.assets[0].owner_entity, undefined);
  assert.equal(saved.next_id, 3);

  const edited = await first.saveAsset({ id: "A0001", name: "Boat 2" });
  assert.equal(edited.id, "A0001");
  const again = JSON.parse(storage.getItem(LOCAL_STORAGE_KEYS.assets));
  assert.deepEqual(
    again.assets.map((asset) => asset.id),
    ["A0001", "A0002"],
  );
});

test("a raised next_id is not reused, and meter clears blank units", async () => {
  const { storage, api } = store();
  storage.setItem(
    LOCAL_STORAGE_KEYS.assets,
    JSON.stringify({
      schema_version: 1,
      next_id: 8,
      assets: [{ id: "A0001", name: "Old", updated_at: "2020-01-01T00:00:00.000Z" }],
    }),
  );
  const created = await api.saveAsset({ name: "New" });
  assert.equal(created.id, "A0008");
  const metered = await api.updateMeter("A0001", {
    meter_value: "10",
    meter_unit: "hours",
    meter_date: "2026-02-01",
  });
  assert.equal(metered.meter_value, 10);
  assert.equal(metered.meter_unit, "hours");
  const cleared = await api.updateMeter("A0001", { meter_value: "11", meter_unit: "", meter_date: "" });
  assert.equal(cleared.meter_value, 11);
  assert.equal(cleared.meter_unit, undefined);
  assert.equal(cleared.meter_date, undefined);
  assert.equal(cleared.updated_at, NOW);
});

test("maintenance, purchase, and photo round-trip", async () => {
  const { api } = store();
  await api.saveAsset({ name: "Cabin" });
  const photoId = await api.uploadPhoto(new Blob([Uint8Array.from([1, 2, 3, 255])], { type: "image/jpeg" }), "a.jpg");
  const entry = await api.addMaintenance({
    asset_id: "A0001",
    work: "Oil",
    photo_ids: [photoId],
    date: "2026-03-01",
  });
  const line = await api.addPurchase({ asset_id: "A0001", vendor: "Napa", status: "ordered", unit_price: "4.5" });
  assert.equal(entry.id, "M0001");
  assert.equal(line.id, "P0001");
  assert.equal(line.unit_price, 4.5);
  const url = await api.photoUrl(photoId);
  assert.match(url, /^data:image\/jpeg;base64,/);
  const loaded = await api.loadAll();
  assert.equal(loaded.maintenance.entries[0].photo_ids[0], photoId);
  assert.equal(loaded.purchases.lines[0].vendor, "Napa");
});

test("a photo with nothing read is saved as needs_review without a made-up name", async () => {
  const { api } = store();
  const flagged = await api.saveAsset({ photo_ids: ["ph-1"], status: "needs_review", asset_type: "house" });
  assert.equal(flagged.id, "A0001");
  assert.equal(flagged.status, "needs_review");
  assert.equal(flagged.name, undefined);
  assert.equal(flagged.asset_type, "house");
  assert.deepEqual(flagged.photo_ids, ["ph-1"]);
  const loaded = await api.loadAll();
  assert.equal(loaded.assets.assets[0].status, "needs_review");
});

test("refuses a missing name, a bad parent, and a second seed import", async () => {
  const { api } = store();
  await assert.rejects(() => api.saveAsset({ name: " " }), /Add a photo or a name/);
  await api.saveAsset({ name: "Cabin" });
  await assert.rejects(() => api.saveAsset({ name: "Furnace", parent_id: "A0001" }).then(() => api.saveAsset({
    id: "A0001",
    name: "Cabin",
    parent_id: "A0002",
  })), /cycle/);
  const seed = JSON.parse(readFileSync(new URL("../site/seed/seed-data.json", import.meta.url), "utf8"));
  const empty = store();
  await empty.api.importSeed(seed);
  const loaded = await empty.api.loadAll();
  assert.equal(loaded.assets.assets.length, 3);
  assert.equal(loaded.assets.assets[1].notes, "2WD");
  assert.equal(loaded.purchases.lines[0].order_number, "364948524");
  assert.equal(loaded.assets.assets[0].updated_at, NOW);
  await assert.rejects(() => empty.api.importSeed(seed), /not empty/);
  const next = await empty.api.saveAsset({ name: "Laptop" });
  assert.equal(next.id, "A0004");
});

test("a corrupt file reports the parse error", async () => {
  const { storage, api } = store();
  storage.setItem(LOCAL_STORAGE_KEYS.assets, "{");
  await assert.rejects(() => api.loadAll(), /Could not read assets\.json:/);
});
