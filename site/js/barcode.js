import { extractVin } from "./vin.js";

const WANTED_FORMATS = ["code_39", "code_128", "pdf417", "qr_code", "data_matrix", "itf"];

async function detectNative(file) {
  if (typeof BarcodeDetector === "undefined") return [];
  try {
    const supported = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : WANTED_FORMATS;
    const formats = WANTED_FORMATS.filter((format) => supported.includes(format));
    if (!formats.length) return [];
    const detector = new BarcodeDetector({ formats });
    const bitmap = await createImageBitmap(file);
    try {
      const found = await detector.detect(bitmap);
      return found.map((item) => item.rawValue || "");
    } finally {
      bitmap.close?.();
    }
  } catch {
    return [];
  }
}

async function detectZxing(file) {
  const { BrowserMultiFormatReader } = await import("https://esm.sh/@zxing/browser@0.1.5");
  const reader = new BrowserMultiFormatReader();
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const result = await reader.decodeFromImageElement(image);
    return [result.getText()];
  } catch (error) {
    const message = String(error?.message || error);
    if (/not found|no multiformat|no barcode/i.test(message)) return [];
    throw error;
  } finally {
    URL.revokeObjectURL(url);
    reader.reset?.();
  }
}

/**
 * Read a VIN from a photo. Uses the browser BarcodeDetector first, then ZXing.
 * `detect` replaces both when a test wants to supply codes.
 * Returns "" when no VIN is in the picture.
 */
function firstVin(codes) {
  for (const code of codes || []) {
    const vin = extractVin(code);
    if (vin) return vin;
  }
  return "";
}

export async function findVinInImage(file, { detect } = {}) {
  if (detect) return firstVin(await detect(file));
  if (typeof BarcodeDetector !== "undefined") return firstVin(await detectNative(file));
  try {
    return firstVin(await detectZxing(file));
  } catch (error) {
    throw new Error(`Could not read a barcode from that photo: ${error?.message || error}`);
  }
}
