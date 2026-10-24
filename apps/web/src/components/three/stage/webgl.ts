let cachedSupport: boolean | null = null;

/**
 * Probes for WebGL2/WebGL once per page and releases the probe context right
 * away so it does not count against the browser's live-context limit.
 */
export function detectWebGLSupport(): boolean {
  if (cachedSupport !== null) return cachedSupport;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    cachedSupport = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    cachedSupport = false;
  }
  return cachedSupport;
}

export function resetWebGLSupportCache(): void {
  cachedSupport = null;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}
