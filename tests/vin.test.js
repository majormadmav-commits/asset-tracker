import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { reviewStatus } from "../site/js/field-config.js";
import { findVinInImage } from "../site/js/barcode.js";
import { applyVin, decodeVin, extractVin, mapVpic, vpicUrl } from "../site/js/vin.js";

const VIN = "JTEBU5JR6H5470907";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/vpic-JTEBU5JR6H5470907.json", import.meta.url), "utf8"));

test("extracts a VIN and ignores letters a VIN cannot contain", () => {
  assert.equal(extractVin(` vin ${VIN.toLowerCase()} `), VIN);
  assert.equal(extractVin("JTEBU5JR6H547090"), "");
  assert.equal(extractVin("JTEBU5IR6H5470907"), "");
});

test("maps the real vPIC row for the 4Runner and forces Car/Truck", () => {
  const fields = mapVpic(fixture.Results[0]);
  assert.deepEqual(fields, {
    asset_type: "car",
    vin_serial: VIN,
    year: 2017,
    make: "TOYOTA",
    model: "4Runner",
    engine: "1GR-FE",
    drive: "4WD/4-Wheel Drive/4x4",
  });
  assert.equal(applyVin({ asset_type: "boat", hin: "ABC" }, fields, VIN).asset_type, "car");
});

test("decodeVin calls the free vPIC endpoint and returns those fields", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return new Response(JSON.stringify(fixture), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const decoded = await decodeVin(VIN, fetchImpl);
  assert.equal(calls[0], vpicUrl(VIN));
  assert.equal(decoded.fields.make, "TOYOTA");
  assert.equal(decoded.fields.engine, "1GR-FE");
  await assert.rejects(() => decodeVin("TOO-SHORT", fetchImpl), /17 letters/);
  assert.equal(calls.length, 1);
});

test("a barcode result becomes a VIN, and unread files need review", async () => {
  const vin = await findVinInImage(new Blob(["x"]), { detect: async () => [`*${VIN}*`] });
  assert.equal(vin, VIN);
  assert.equal(await findVinInImage(new Blob(["x"]), { detect: async () => ["not a vin"] }), "");
  assert.equal(reviewStatus([]), undefined);
  assert.equal(reviewStatus([{ decoded: true }]), undefined);
  assert.equal(reviewStatus([{ decoded: false }]), "needs_review");
  assert.equal(reviewStatus([{ decoded: true }, { decoded: false }]), "needs_review");
});
