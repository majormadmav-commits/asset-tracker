import assert from "node:assert/strict";
import test from "node:test";
import { allocateId, formatId, parseId } from "../site/js/ids.js";

test("ids are prefixed and padded to at least four digits", () => {
  assert.equal(formatId("A", 1), "A0001");
  assert.equal(formatId("M", 42), "M0042");
  assert.equal(formatId("P", 10000), "P10000");
  assert.equal(parseId("A0001", "A"), 1);
  assert.equal(parseId("A0001", "M"), null);
  assert.equal(parseId("A12", "A"), 12);
  assert.equal(parseId("A", "A"), null);
  assert.equal(parseId("ABC", "A"), null);
});

test("next id respects next_id so deleted high ids are not reused", () => {
  const doc = { next_id: 8, assets: [{ id: "A0001" }, { id: "A0003" }] };
  const assigned = allocateId(doc, "A", "assets");
  assert.equal(assigned.id, "A0008");
  assert.equal(assigned.next_id, 9);
});

test("next id skips past an existing row when next_id is stale", () => {
  const doc = { next_id: 2, entries: [{ id: "M0005" }] };
  const assigned = allocateId(doc, "M", "entries");
  assert.equal(assigned.id, "M0006");
  assert.equal(assigned.next_id, 7);
});
