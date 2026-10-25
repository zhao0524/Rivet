/** Longest side of a stored project picture, in px. Small enough to keep many in localStorage. */
const MAX_SIDE = 480;

/**
 * Shrinks a picked picture to a JPEG data URL for the project's gallery card. It lives with the
 * project, so the card keeps its picture even when the uploaded asset is gone. Null when the
 * browser can't decode it (the card then falls back to the uploaded preview or a stock picture).
 */
export async function pictureThumbnail(file: File): Promise<string | null> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL('image/jpeg', 0.8);
  } catch {
    return null;
  }
}
