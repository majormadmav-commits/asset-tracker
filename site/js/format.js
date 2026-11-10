export function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function todayISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function formatMoney(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatNumber(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("en-US");
}

export function formatMeter(asset) {
  if (asset.meter_value == null || asset.meter_value === "") return "";
  const unit = asset.meter_unit ? ` ${asset.meter_unit}` : "";
  const when = asset.meter_date ? ` on ${asset.meter_date}` : "";
  return `${formatNumber(asset.meter_value)}${unit}${when}`;
}

export function formatWhen(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export const ASSET_LABELS = {
  owner_entity: "Owner",
  category: "Category",
  status: "Status",
  location: "Location",
  year: "Year",
  make: "Make",
  model: "Model",
  model_code: "Model code",
  vin_serial: "VIN / serial",
  engine_code: "Engine",
  trans_code: "Transmission",
  paint_code: "Paint",
  mods: "Mods",
  purchase_date: "Purchase date",
  cost: "Cost",
  vendor: "Vendor",
  receipt_url: "Receipt",
  notes: "Notes",
};

export function displayAssetValue(key, value) {
  if (key === "cost") return formatMoney(value);
  if (key === "receipt_url") return value;
  return value == null ? "" : String(value);
}
