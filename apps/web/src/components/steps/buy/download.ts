/** Client-side file download: a Blob URL on a temporary anchor, revoked after the click. */
export function downloadTextFile(filename: string, text: string, mime = 'text/plain'): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
