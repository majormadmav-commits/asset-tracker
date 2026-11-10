import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const seed = JSON.parse(readFileSync(new URL("../site/seed/seed-data.json", import.meta.url), "utf8"));

test("seed file carries only the known vehicle facts", () => {
  assert.equal(seed.schema_version, 1);
  assert.equal(seed.assets.schema_version, 1);
  assert.equal(seed.assets.next_id, 4);
  assert.equal(seed.maintenance.entries.length, 0);
  assert.equal(seed.maintenance.next_id, 1);
  assert.equal(seed.purchases.next_id, 2);
  assert.equal(seed.purchases.lines.length, 1);

  const [runner, s10, ram] = seed.assets.assets;
  assert.deepEqual(runner, {
    id: "A0001",
    name: "2017 Toyota 4Runner",
    year: 2017,
    make: "Toyota",
    model: "4Runner",
    model_code: "GRN285L-GKAGKA",
    vin_serial: "JTEBU5JR6H5470907",
    engine_code: "1GR-FE",
    paint_code: "1G3",
  });
  assert.deepEqual(s10, {
    id: "A0002",
    name: "1998 Chevrolet S10",
    year: 1998,
    make: "Chevrolet",
    model: "S10",
    vin_serial: "1GCCS14X1WK105227",
    engine_code: "4.3L LF6",
    mods: "MerCruiser 4.3 Gen+ engine (serial 0L057753) on LF6 donor, marine 4.3L oil pan",
    notes: "2WD",
  });
  assert.deepEqual(ram, {
    id: "A0003",
    name: "Truckasaurus",
    year: 2011,
    make: "Ram",
    vin_serial: "3D7LT2ET4BG551507",
    location: "Island",
    purchase_date: "2021-06-15",
    cost: 18500,
    notes: "estimated value $7,500",
  });
  assert.deepEqual(seed.purchases.lines[0], {
    id: "P0001",
    vendor: "RockAuto",
    order_number: "364948524",
    unit_price: 147.21,
    asset_id: "A0002",
    status: "ordered",
  });

  const blob = JSON.stringify(seed);
  for (const absent of ["AV business", "428 Projects", "Personal", "owner_entity", "category"]) {
    assert.equal(blob.includes(absent), false, absent);
  }
});
