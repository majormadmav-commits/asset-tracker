/** Resize a camera photo to a JPEG whose longest side is about 1600px. */

export async function resizeToJpeg(file, { maxEdge = 1600, quality = 0.82 } = {}) {
  if (!file) throw new Error("Choose a photo first.");
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Photo must be an image.");
  }
  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This browser could not prepare the photo.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (result) => (result ? resolve(result) : reject(new Error("Could not encode the photo as JPEG."))),
        "image/jpeg",
        quality,
      );
    });
    return { blob, width, height };
  } finally {
    bitmap.close?.();
  }
}

export function photoFileName(assetId, date = new Date()) {
  const safe = String(assetId || "photo").replace(/[^A-Za-z0-9_-]/g, "") || "photo";
  return `${safe}-${date.getTime()}.jpg`;
}
