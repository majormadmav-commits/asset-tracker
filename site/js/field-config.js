/** One list of asset types and the fields each type shows. The form is built from this file. */

const text = (key, label) => ({ key, label, input: "text" });
const number = (key, label) => ({ key, label, input: "number" });
const date = (key, label) => ({ key, label, input: "date" });
const area = (key, label) => ({ key, label, input: "textarea" });

export const ASSET_TYPES = [
  { id: "car", label: "Car/Truck" },
  { id: "boat", label: "Boat" },
  { id: "camper", label: "Camper" },
  { id: "house", label: "House" },
  { id: "tractor", label: "Tractor/Small engine" },
  { id: "computer", label: "Computer" },
  { id: "appliance", label: "Appliance/Furnace/Water heater" },
  { id: "other", label: "Other" },
];

export const SHARED_FIELDS = [
  text("name", "Name"),
  text("location", "Location"),
  date("purchase_date", "Purchase date"),
  number("price", "Price"),
  number("value", "Value"),
  area("notes", "Notes"),
];

export const TYPE_FIELDS = {
  car: [
    text("vin_serial", "VIN"),
    number("year", "Year"),
    text("make", "Make"),
    text("model", "Model"),
    text("engine", "Engine"),
    text("drive", "Drive"),
    number("mileage", "Mileage"),
    text("oil_type", "Oil type"),
    text("tires", "Tires"),
    text("plate", "Plate"),
  ],
  boat: [
    text("hin", "HIN"),
    text("engine_make_model_serial", "Engine make/model/serial"),
    number("hours", "Hours"),
  ],
  appliance: [
    text("brand", "Brand"),
    text("model", "Model"),
    text("serial", "Serial"),
    text("fuel", "Fuel"),
    text("btu", "BTU"),
    date("install_date", "Install date"),
  ],
  computer: [
    text("brand", "Brand"),
    text("model", "Model"),
    text("serial", "Serial"),
    text("os", "OS"),
  ],
};

export const EXTRA_FIELDS = [
  text("owner_entity", "Owner"),
  text("category", "Category"),
  text("model_code", "Model code"),
  text("engine_code", "Engine code"),
  text("trans_code", "Transmission"),
  text("paint_code", "Paint"),
  number("meter_value", "Meter"),
  text("meter_unit", "Meter unit"),
  date("meter_date", "Meter date"),
  area("mods", "Mods"),
  number("cost", "Cost"),
  text("vendor", "Vendor"),
  text("receipt_url", "Receipt"),
];

function unique(fields) {
  const seen = new Set();
  const out = [];
  for (const field of fields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    out.push(field);
  }
  return out;
}

export const ALL_FIELDS = unique([...Object.values(TYPE_FIELDS).flat(), ...SHARED_FIELDS, ...EXTRA_FIELDS]);

export const ASSET_TYPE_IDS = ASSET_TYPES.map((type) => type.id);

export function fieldsForType(typeId) {
  return [...(TYPE_FIELDS[typeId] || []), ...SHARED_FIELDS];
}

export function typeLabel(typeId) {
  return ASSET_TYPES.find((type) => type.id === typeId)?.label || "";
}

export function fieldByKey(key) {
  return ALL_FIELDS.find((field) => field.key === key) || null;
}

/** Photos the page could not read stay on the asset and flag it for a later pass. */
export function reviewStatus(files) {
  if (!files?.length) return undefined;
  if (files.some((file) => !file.decoded)) return "needs_review";
  return undefined;
}

const MONEY_KEYS = new Set(["price", "value", "cost"]);

export function isMoneyKey(key) {
  return MONEY_KEYS.has(key);
}
