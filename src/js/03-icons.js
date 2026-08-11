// ─────────────────────────────────────────────────────────────────────────────
// TripleCrown icon set — inline SVG, currentColor-driven so a single CSS rule tints
// them to the brand light-blue (var(--accent)). Replaces the emoji that were scattered
// through the UI; each returns a self-contained <svg> string sized 1em so it flows inline
// with text. Pass a class for sizing/color overrides.
//
// Design language: 1.6px strokes, round caps/joins, no fills except where a solid mark
// reads better at small sizes (trophy, star). Minimal and geometric to match the logo.
// ─────────────────────────────────────────────────────────────────────────────
const TC_ICON = (() => {
  const wrap = (body, cls) =>
    `<svg viewBox="0 0 24 24" class="tc-ico${cls?' '+cls:''}" fill="none" ` +
    `stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ` +
    `stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

  const paths = {
    // Champion trophy — solid cup so it reads at 14px, with base.
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" fill="currentColor" stroke="none"/>' +
            '<path d="M8 5H5.5A2.5 2.5 0 0 0 8 8.5M16 5h2.5A2.5 2.5 0 0 1 16 8.5"/>' +
            '<path d="M12 13v3M9 20h6M10 20v-1.5a2 2 0 0 1 4 0V20"/>',
    star:   '<path d="m12 3 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.2l5.9-.9L12 3Z" fill="currentColor" stroke="none"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    menu:   '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close:  '<path d="M6 6l12 12M18 6 6 18"/>',
    box:    '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5v-9Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    chart:  '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6"/>',
    clipboard:'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h4"/>',
    refresh:'<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8M20 3v5h-5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16M4 21v-5h5"/>',
    calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M4 9h16M8 3v4M16 3v4"/>',
    link:   '<path d="M9 15l6-6M10.5 6.5 12 5a4 4 0 0 1 6 6l-1.5 1.5M13.5 17.5 12 19a4 4 0 0 1-6-6l1.5-1.5"/>',
    shield: '<path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3Z"/>',
    football:'<path d="M4 12c0-4 4-8 8-8s8 4 8 8-4 8-8 8-8-4-8-8Z"/><path d="M8 8s2 4 2 8M16 8s-2 4-2 8M9 12h6"/>',
    export: '<path d="M12 15V4M8 8l4-4 4 4M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3"/>',
    download:'<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',
    globe:  '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4a12 12 0 0 1 0 16 12 12 0 0 1 0-16Z"/>',
    signal: '<path d="M5 18a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
    headphones:'<path d="M5 15v-3a7 7 0 0 1 14 0v3"/><rect x="3.5" y="14" width="4" height="6" rx="1.5"/><rect x="16.5" y="14" width="4" height="6" rx="1.5"/>',
    warning:'<path d="M12 4 2.5 20h19L12 4Z"/><path d="M12 10v4M12 17h.01"/>',
    check:  '<path d="M5 12.5 10 17 19 7"/>',
    stadium:'<rect x="2.5" y="6" width="19" height="12" rx="6"/><ellipse cx="12" cy="12" rx="5.5" ry="3"/>',
    arrowRight:'<path d="M5 12h14M13 6l6 6-6 6"/>',
    arrowLeft:'<path d="M19 12H5M11 18l-6-6 6-6"/>',
    arrowUp:'<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown:'<path d="M12 5v14M6 13l6 6 6-6"/>',
    swap:   '<path d="M7 4 3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8"/>',
    undo:   '<path d="M9 7 4 12l5 5M4 12h11a5 5 0 0 1 0 10"/>',
    user:   '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    save:   '<path d="M5 4h10l4 4v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M15 4v5H7V4M12 11v7M9 15l3 3 3-3"/>',
  };
  const fn = (name, cls) => wrap(paths[name] || '', cls);
  fn.has = name => Object.prototype.hasOwnProperty.call(paths, name);
  return fn;
})();
