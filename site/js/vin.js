/** Pull a VIN out of barcode text and map a vPIC DecodeVinValues row. */

const VIN_BODY = /[A-HJ-NPR-Z0-9]{17}/;

export function extractVin(raw) {
  if (raw == null) return "";
  const upper = String(raw).toUpperCase();
  const compact = upper.replace(/[^A-Z0-9]/g, "");
  if (compact.length === 17 && VIN_BODY.test(compact)) return compact;
  const runs = upper.match(/[A-HJ-NPR-Z0-9]{17}/g);
  return runs ? runs[0] : "";
}

function text(value) {
  if (value == null) return "";
  const trimmed = String(value).trim();
  return trimmed;
}

export function mapVpic(row) {
  if (!row || typeof row !== "object") throw new Error("vPIC returned no result.");
  const errorCode = String(row.ErrorCode ?? "");
  const make = text(row.Make);
  if (!make && errorCode !== "0") {
    throw new Error(text(row.ErrorText) || `vPIC could not decode that VIN (${errorCode}).`);
  }
  const year = Number(row.ModelYear);
  const engineModel = text(row.EngineModel);
  const engine =
    engineModel ||
    [text(row.EngineConfiguration), text(row.EngineCylinders) ? `${text(row.EngineCylinders)}-cyl` : "", text(row.DisplacementL) ? `${text(row.DisplacementL)}L` : ""]
      .filter(Boolean)
      .join(" ");
  const fields = {
    asset_type: "car",
    vin_serial: extractVin(row.VIN) || undefined,
    year: Number.isInteger(year) && year > 0 ? year : undefined,
    make: make || undefined,
    model: text(row.Model) || undefined,
    engine: engine || undefined,
    drive: text(row.DriveType) || undefined,
  };
  for (const key of Object.keys(fields)) {
    if (fields[key] == null || fields[key] === "") delete fields[key];
  }
  fields.asset_type = "car";
  return fields;
}

export function vpicUrl(vin) {
  return `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`;
}

export function applyVin(draft, fields, vin) {
  return { ...(draft || {}), ...fields, vin_serial: vin, asset_type: "car" };
}

export async function decodeVin(vin, fetchImpl = globalThis.fetch) {
  const clean = extractVin(vin);
  if (!clean) throw new Error("VIN must be 17 letters and numbers, without I, O, or Q.");
  const url = vpicUrl(clean);
  let response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new Error(`vPIC request failed: ${error?.message || error}`);
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = await response.text();
    } catch {
      detail = response.statusText || "";
    }
    throw new Error(`vPIC ${response.status}: ${String(detail).slice(0, 500)}`);
  }
  const body = await response.json();
  return { url, fields: mapVpic(body?.Results?.[0]) };
}
