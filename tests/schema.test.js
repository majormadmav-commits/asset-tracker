import assert from "node:assert/strict";
import test from "node:test";
import { cleanAsset, emptyDoc, normalizeDoc, serializeDoc } from "../site/js/schema.js";

test("normalize keeps a higher next_id and schema_version is written first", () => {
  const doc = normalizeDoc(
    { next_id: 6, schema_version: 1, assets: [{ id: "A0002", name: "Boat" }] },
    "assets",
  );
  assert.equal(doc.next_id, 6);
  assert.equal(doc.schema_version, 1);
  const text = serializeDoc(doc, "assets");
  assert.ok(text.startsWith('{\n  "schema_version": 1,\n  "next_id": 6,'));
  assert.ok(text.endsWith("\n"));
});

test("normalize raises next_id to one past the highest stored id", () => {
  const doc = normalizeDoc({ schema_version: 1, next_id: 1, entries: [{ id: "M0004" }] }, "maintenance");
  assert.equal(doc.next_id, 5);
});

test("a newer schema version is refused", () => {
  assert.throws(() => normalizeDoc({ schema_version: 2, assets: [] }, "assets"), /schema_version 2/);
});

test("blank optional fields are omitted and the name is required", () => {
  const asset = cleanAsset({
    name: "  Cabin  ",
    owner_entity: "",
    notes: "   ",
    category: " House ",
    cost: "",
    year: "1998",
  });
  assert.deepEqual(asset, { name: "Cabin", category: "House", year: 1998 });
  assert.throws(() => cleanAsset({ name: " " }), /Add a photo or a name/);
  assert.equal(cleanAsset({ photo_ids: ["ph-1"], status: "needs_review" }).status, "needs_review");
  assert.throws(() => cleanAsset({ name: "X", status: "maybe" }), /Status/);
  assert.throws(() => cleanAsset({ name: "X", owner_entity: "Other" }), /Owner/);
});

test("empty collections have schema_version and next_id", () => {
  assert.deepEqual(emptyDoc("purchases"), { schema_version: 1, next_id: 1, lines: [] });
});
