import { ALL_FIELDS, ASSET_TYPE_IDS } from "./field-config.js";
import { allocateId, parseId } from "./ids.js";

export const SCHEMA_VERSION = 1;

export const OWNER_ENTITIES = ["AV business", "428 Projects", "Personal"];
export const ASSET_STATUSES = ["in service", "down", "rebuild", "disposed", "needs_review"];
export const METER_UNITS = ["miles", "hours"];
export const PURCHASE_STATUSES = ["ordered", "received", "installed", "returned"];

export const ASSET_FIELDS = [
  "id",
  "name",
  "asset_type",
  "status",
  "location",
  "vin_serial",
  "year",
  "make",
  "model",
  "engine",
  "drive",
  "mileage",
  "oil_type",
  "tires",
  "plate",
  "hin",
  "engine_make_model_serial",
  "hours",
  "brand",
  "serial",
  "fuel",
  "btu",
  "install_date",
  "os",
  "purchase_date",
  "price",
  "value",
  "photo_ids",
  "notes",
  "updated_at",
  "owner_entity",
  "category",
  "parent_id",
  "model_code",
  "engine_code",
  "trans_code",
  "paint_code",
  "meter_value",
  "meter_unit",
  "meter_date",
  "mods",
  "cost",
  "vendor",
  "receipt_url",
];

export const MAINTENANCE_FIELDS = [
  "id",
  "asset_id",
  "date",
  "meter",
  "work",
  "parts",
  "fluids",
  "who",
  "cost",
  "notes",
  "photo_ids",
  "receipt_url",
];

export const PURCHASE_FIELDS = [
  "id",
  "date",
  "vendor",
  "order_number",
  "part_number",
  "description",
  "qty",
  "unit_price",
  "shipping",
  "receipt_url",
  "asset_id",
  "status",
];

const KINDS = {
  assets: { key: "assets", prefix: "A", fields: ASSET_FIELDS },
  maintenance: { key: "entries", prefix: "M", fields: MAINTENANCE_FIELDS },
  purchases: { key: "lines", prefix: "P", fields: PURCHASE_FIELDS },
};

export function collectionKey(kind) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`Unknown collection: ${kind}`);
  return spec.key;
}

export function emptyDoc(kind) {
  return {
    schema_version: SCHEMA_VERSION,
    next_id: 1,
    [collectionKey(kind)]: [],
  };
}

export function orderRecord(record, fields) {
  const out = {};
  for (const key of fields) {
    if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
  }
  for (const key of Object.keys(record)) {
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = record[key];
  }
  return out;
}

export function serializeDoc(doc, kind) {
  const spec = KINDS[kind];
  const ordered = {
    schema_version: doc.schema_version,
    next_id: doc.next_id,
    [spec.key]: (doc[spec.key] || []).map((item) => orderRecord(item, spec.fields)),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function normalizeDoc(input, kind) {
  const spec = KINDS[kind];
  if (input == null || input === "") return emptyDoc(kind);
  const doc = typeof input === "string" ? JSON.parse(input) : input;
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error(`${kind} file is not a JSON object.`);
  }
  if (typeof doc.schema_version === "number" && doc.schema_version > SCHEMA_VERSION) {
    throw new Error(
      `Unsupported schema_version ${doc.schema_version} in ${kind}. This app reads version ${SCHEMA_VERSION}.`,
    );
  }
  const items = Array.isArray(doc[spec.key]) ? doc[spec.key] : [];
  let next = Number(doc.next_id);
  if (!Number.isInteger(next) || next < 1) next = 1;
  for (const item of items) {
    const n = parseId(item?.id, spec.prefix);
    if (n != null && n + 1 > next) next = n + 1;
  }
  return {
    schema_version: SCHEMA_VERSION,
    next_id: next,
    [spec.key]: items,
  };
}

function assertEnum(value, allowed, label) {
  if (value == null || value === "") return undefined;
  if (!allowed.includes(value)) {
    throw new Error(`${label} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

export function optionalNumber(value, label) {
  if (value == null || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new Error(`${label} must be a number.`);
  return n;
}

export function optionalInteger(value, label) {
  const n = optionalNumber(value, label);
  if (n == null) return undefined;
  if (!Number.isInteger(n)) throw new Error(`${label} must be a whole number.`);
  return n;
}

export function optionalText(value) {
  if (value == null) return undefined;
  const text = String(value).trim();
  return text === "" ? undefined : text;
}

export function optionalDate(value, label) {
  const text = optionalText(value);
  if (text == null) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${label} must be a YYYY-MM-DD date.`);
  return text;
}

function optionalStringList(value) {
  if (value == null || value === "") return undefined;
  const list = Array.isArray(value) ? value : [value];
  const cleaned = list.map((item) => String(item).trim()).filter(Boolean);
  return cleaned.length ? cleaned : undefined;
}

function dropEmpty(record) {
  const out = {};
  for (const [key, value] of Object.entries(record)) {
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[key] = value;
  }
  return out;
}

function coerceConfigured(field, value) {
  if (field.key === "year") return optionalInteger(value, field.label);
  if (field.input === "number") return optionalNumber(value, field.label);
  if (field.input === "date") return optionalDate(value, field.label);
  if (field.input === "textarea" || field.input === "text") return optionalText(value);
  return optionalText(value);
}

export function cleanAsset(input) {
  const configured = {};
  for (const field of ALL_FIELDS) configured[field.key] = coerceConfigured(field, input[field.key]);
  const assetType = optionalText(input.asset_type);
  if (assetType && !ASSET_TYPE_IDS.includes(assetType)) {
    throw new Error(`Type must be one of: ${ASSET_TYPE_IDS.join(", ")}.`);
  }
  const record = dropEmpty({
    ...configured,
    id: optionalText(input.id),
    asset_type: assetType,
    owner_entity: assertEnum(optionalText(input.owner_entity), OWNER_ENTITIES, "Owner"),
    parent_id: optionalText(input.parent_id),
    status: assertEnum(optionalText(input.status), ASSET_STATUSES, "Status"),
    meter_unit: assertEnum(optionalText(input.meter_unit), METER_UNITS, "Meter unit"),
    photo_ids: optionalStringList(input.photo_ids),
  });
  if (!record.name && !record.photo_ids?.length) throw new Error("Add a photo or a name.");
  return record;
}

export function cleanMeter(input) {
  const meter = dropEmpty({
    meter_value: optionalNumber(input.meter_value, "Meter"),
    meter_unit: assertEnum(optionalText(input.meter_unit), METER_UNITS, "Meter unit"),
    meter_date: optionalDate(input.meter_date, "Meter date"),
  });
  if (meter.meter_value == null) throw new Error("Meter value is required.");
  return meter;
}

export function cleanMaintenance(input) {
  return dropEmpty({
    asset_id: optionalText(input.asset_id),
    date: optionalDate(input.date, "Date"),
    meter: optionalNumber(input.meter, "Meter"),
    work: optionalText(input.work),
    parts: optionalText(input.parts),
    fluids: optionalText(input.fluids),
    who: optionalText(input.who),
    cost: optionalNumber(input.cost, "Cost"),
    notes: optionalText(input.notes),
    photo_ids: optionalStringList(input.photo_ids),
    receipt_url: optionalText(input.receipt_url),
  });
}

export function cleanPurchase(input) {
  return dropEmpty({
    date: optionalDate(input.date, "Date"),
    vendor: optionalText(input.vendor),
    order_number: optionalText(input.order_number),
    part_number: optionalText(input.part_number),
    description: optionalText(input.description),
    qty: optionalNumber(input.qty, "Qty"),
    unit_price: optionalNumber(input.unit_price, "Price"),
    shipping: optionalNumber(input.shipping, "Shipping"),
    receipt_url: optionalText(input.receipt_url),
    asset_id: optionalText(input.asset_id),
    status: assertEnum(optionalText(input.status), PURCHASE_STATUSES, "Status"),
  });
}

export function assertParentOk(assets, id, parentId) {
  if (!parentId) return;
  if (id && parentId === id) throw new Error("An asset cannot be its own parent.");
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  if (!byId.has(parentId)) throw new Error("Parent asset was not found. Reload and try again.");
  const seen = new Set();
  let current = parentId;
  while (current) {
    if (id && current === id) throw new Error("That parent would create a cycle.");
    if (seen.has(current)) throw new Error("Parent chain has a cycle. Fix that before saving.");
    seen.add(current);
    current = byId.get(current)?.parent_id;
  }
}

export function assignNewId(doc, kind) {
  const spec = KINDS[kind];
  const assigned = allocateId(doc, spec.prefix, spec.key);
  doc.next_id = assigned.next_id;
  return assigned.id;
}

export function utcNow(date = new Date()) {
  return date.toISOString();
}
