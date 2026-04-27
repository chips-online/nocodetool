export function clampCanvasHeightValue(value, currentHeight, minHeight, maxHeight) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return currentHeight;
  return Math.min(maxHeight, Math.max(minHeight, n));
}

export function clampCanvasWidthValue(value, currentWidth, minWidth, maxWidth) {
  const n = parseInt(value, 10);
  if (isNaN(n)) return currentWidth;
  return Math.min(maxWidth, Math.max(minWidth, n));
}

export function applyCanvasWorkWidthStyle(widthPx) {
  document.documentElement.style.setProperty("--canvas-width", widthPx + "px");
}
