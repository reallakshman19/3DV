/**
 * Inline icon registry for the Stage JSON viewer shell.
 * Parameters: stable icon keys used by shell buttons.
 * Outputs: small SVG strings that match the existing viewer ribbon style.
 * Fallback: unknown keys return a compact square glyph so controls remain visible.
 */

const SVG = {
  open: '<path d="M4 19V5h7l2 2h7v12z"/><path d="M4 9h16"/>',
  sample: '<path d="M7 4h10v16H7z"/><path d="M10 8h4M10 12h4M10 16h3"/>',
  export: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
  converter: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M8 13h6"/><path d="m13 10 4 4-4 4"/><path d="M17 14H9"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-1"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h1"/>',
  select: '<path d="m4 3 7 17 2-7 7-2z"/><path d="m13 13 6 6"/>',
  boxSelect: '<rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8"/>',
  orbit: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/>',
  pan: '<path d="M12 3v18M3 12h18"/><path d="m8 7 4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4"/>',
  fit: '<path d="M5 9V5h4M19 9V5h-4M5 15v4h4M19 15v4h-4"/>',
  top: '<rect x="5" y="5" width="14" height="14" rx="2"/><path d="M9 9h6v6H9z"/>',
  hide: '<path d="M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z"/><path d="m4 4 16 16"/>',
  show: '<path d="M3 12s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6z"/><circle cx="12" cy="12" r="3"/>',
  isolate: '<path d="M5 5h14v14H5z"/><circle cx="12" cy="12" r="3"/>',
  clear: '<path d="M6 6l12 12M18 6 6 18"/>',
  box: '<path d="M6 8 12 4l6 4v8l-6 4-6-4z"/><path d="M12 12v8M6 8l6 4 6-4"/>',
  plane: '<path d="M4 15h16"/><path d="M12 4v9"/><path d="m8 8 4-4 4 4"/>',
  axis: '<path d="M4 20 20 4"/><path d="M14 4h6v6"/>',
  tag: '<path d="M20 12 12 20 4 12V4h8z"/><circle cx="9" cy="9" r="1.5"/>',
  enrich: '<path d="M4 7h16M4 12h10M4 17h7"/><path d="m16 15 2 2 4-5"/>',
  collapse: '<path d="m15 6-6 6 6 6"/>',
  snapshot: '<path d="M5 7h3l1-2h6l1 2h3v12H5z"/><circle cx="12" cy="13" r="3"/>',
  view: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  diagnostics: '<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 17h.01"/>',
};

export function iconSvg(key) {
  const body = SVG[key] || '<rect x="5" y="5" width="14" height="14" rx="2"/>';
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
