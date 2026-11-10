import assert from "node:assert/strict";
import test from "node:test";
import { ALL_FIELDS, fieldsForType, typeLabel } from "../site/js/field-config.js";
import { cleanAsset } from "../site/js/schema.js";

test("each type shows its own fields plus the shared ones", () => {
  const keys = (type) => fieldsForType(type).map((field) => field.key);
  const car = keys("car");
  const boat = keys("boat");
  const appliance = keys("appliance");
  const computer = keys("computer");
  const house = keys("house");

  for (const key of ["vin_serial", "drive", "mileage", "oil_type", "tires", "plate", "engine"]) {
    assert.equal(car.includes(key), true, key);
    assert.equal(boat.includes(key), false, key);
  }
  assert.deepEqual(
    boat.filter((key) => !house.includes(key)),
    ["hin", "engine_make_model_serial", "hours"],
  );
  for (const key of ["brand", "serial", "fuel", "btu", "install_date"]) assert.ok(appliance.includes(key));
  assert.ok(computer.includes("os"));
  assert.equal(computer.includes("hin"), false);
  assert.equal(house.includes("vin_serial"), false);
  for (const key of ["name", "location", "purchase_date", "price", "value", "notes"]) {
    assert.ok(car.includes(key));
    assert.ok(house.includes(key));
  }
  assert.equal(typeLabel("car"), "Car/Truck");
  assert.equal(typeLabel("appliance"), "Appliance/Furnace/Water heater");
});

test("configured fields survive cleanAsset", () => {
  const input = { name: "Sample", asset_type: "car" };
  for (const field of ALL_FIELDS) {
    if (field.key === "name" || field.key === "meter_unit" || field.key === "owner_entity") continue;
    if (field.input === "number") input[field.key] = field.key === "year" ? 2017 : 3;
    else if (field.input === "date") input[field.key] = "2020-01-02";
    else input[field.key] = "ok";
  }
  const cleaned = cleanAsset(input);
  for (const field of fieldsForType("car")) assert.equal(cleaned[field.key] != null && cleaned[field.key] !== "", true, field.key);
  assert.equal(cleaned.asset_type, "car");
});
