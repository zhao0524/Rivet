/**
 * A picture picked in the landing page's PromptBox, held in memory until the app's prompt screen
 * picks it up under the same draft id. Navigation between them is client-side, so the File survives;
 * a full reload drops it (files can't go in localStorage), and the text draft still carries over.
 */

let pending: { draftId: string; file: File } | null = null;

export function setPendingImage(draftId: string, file: File | null) {
  pending = file ? { draftId, file } : null;
}

/** Returns and clears the picture for this draft, if there is one. */
export function takePendingImage(draftId: string | null | undefined): File | null {
  if (!pending || !draftId || pending.draftId !== draftId) return null;
  const { file } = pending;
  pending = null;
  return file;
}
