/** Font stack for text drawn on canvases (3D labels, maps): the page's UI font first. */
export function uiFontFamily(): string {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim();
  return `${v ? v + ", " : ""}system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
}
