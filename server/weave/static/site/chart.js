// Small SVG charts for the dashboard. The page allows no CDN and no inline script, so these are drawn by
// hand rather than pulled from a charting library. Note that site.js's el() uses createElement, which makes
// HTML nodes: SVG needs createElementNS or the shapes render as nothing.
window.weaveChart = (() => {
  const NS = "http://www.w3.org/2000/svg";

  function node(tag, attrs, ...children) {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c);
    return n;
  }

  // One bar per day. Days with no visits still get a baseline, so a quiet week reads as quiet rather than broken.
  function bars(items, { width = 520, height = 96, gap = 3, label = (d) => d } = {}) {
    const top = Math.max(1, ...items.map((d) => d.value));
    const slot = width / Math.max(items.length, 1);
    const w = Math.max(2, slot - gap);
    const svg = node("svg", {
      class: "chart bars", viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: "none",
      role: "img", "aria-label": `${items.length} days of visits, highest ${top}`,
    });
    items.forEach((d, i) => {
      const h = d.value ? Math.max(2, Math.round((d.value / top) * (height - 4))) : 1;
      const rect = node("rect", {
        x: Math.round(i * slot + gap / 2), y: height - h, width: Math.round(w), height: h,
        rx: 2, class: d.value ? "bar" : "bar empty",
      });
      rect.append(node("title", {}, `${label(d.key)}: ${d.value} ${d.value === 1 ? "visit" : "visits"}`));
      svg.append(rect);
    });
    return svg;
  }

  return { node, bars };
})();
