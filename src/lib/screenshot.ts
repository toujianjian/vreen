// Capture the current WebGL canvas as a PNG and trigger a download.

/** Pick the main viewer canvas. We look for canvases that are NOT sized
 *  to the viewport (which would be the home-page background scene). */
function findViewerCanvas(): HTMLCanvasElement | null {
  const canvases = Array.from(document.querySelectorAll('canvas')) as HTMLCanvasElement[];
  if (canvases.length === 0) return null;
  // Prefer the largest canvas — the viewer Stage is fullscreen.
  return canvases.reduce<HTMLCanvasElement | null>((best, c) => {
    if (!best) return c;
    return c.clientWidth * c.clientHeight > best.clientWidth * best.clientHeight ? c : best;
  }, null);
}

export async function screenshotCanvas(filename = `vreen_capture_${Date.now()}.png`): Promise<void> {
  const canvas = findViewerCanvas();
  if (!canvas) {
    throw new Error('No active canvas found');
  }
  // The renderer must have been created with preserveDrawingBuffer: true (it is).
  // Force a fresh frame to ensure the buffer is current.
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const dataUrl = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
