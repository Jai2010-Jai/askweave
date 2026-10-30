// Weave's design system: the professional foundations every generated website is built on.
//
// AI-made sites look AI-made because the model invents everything at once: random font pairs, purple gradients,
// glass cards, emoji icons, "Elevate your..." copy and stock-photo-shaped holes. Here the model only makes the
// decisions a designer makes for a brief (which type pairing, which palette, which layout, what to say), and every
// choice comes from a hand-tuned set. The page then sits on a fixed, well-crafted base: type scale, spacing,
// buttons, rules, image treatments, mobile navigation and motion. A clean-up pass removes the usual AI tells.

import fs from 'node:fs';

// ---------- typography: proven Google Fonts pairings ----------
export const TYPE_PAIRS = {
  'fraunces-instrument': {
    heading: 'Fraunces', body: 'Instrument Sans', headingWeight: 500, tracking: '-0.02em', italic: true,
    families: 'family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Instrument+Sans:wght@400;500;600',
    mood: 'warm, crafted, editorial: bakeries, cafes, restaurants, handmade goods, food brands',
  },
  'instrument-serif-inter': {
    heading: 'Instrument Serif', body: 'Inter Tight', headingWeight: 400, tracking: '-0.01em', italic: true,
    families: 'family=Instrument+Serif:ital@0;1&family=Inter+Tight:wght@400;500;600',
    mood: 'quiet luxury, modern: architecture, interiors, real estate, studios, boutiques, hotels',
  },
  'dmserif-dmsans': {
    heading: 'DM Serif Display', body: 'DM Sans', headingWeight: 400, tracking: '-0.01em', italic: true,
    families: 'family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600',
    mood: 'classic and confident: restaurants, hotels, events, weddings, florists',
  },
  'cormorant-karla': {
    heading: 'Cormorant Garamond', body: 'Karla', headingWeight: 500, tracking: '-0.01em', italic: true,
    families: 'family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Karla:wght@400;500;600',
    mood: 'elegant, romantic: salons, spas, jewellery, weddings, fashion, beauty',
  },
  'newsreader-public': {
    heading: 'Newsreader', body: 'Public Sans', headingWeight: 500, tracking: '-0.015em', italic: true,
    families: 'family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400&family=Public+Sans:wght@400;500;600',
    mood: 'trustworthy, considered: law, finance, consulting, clinics, schools, nonprofits, writers',
  },
  'young-manrope': {
    heading: 'Young Serif', body: 'Manrope', headingWeight: 400, tracking: '-0.01em', italic: false,
    families: 'family=Young+Serif&family=Manrope:wght@400;500;600;700',
    mood: 'friendly, neighbourhood: local shops, grocery and kirana stores, tea shops, home cooks, pets',
  },
  'bricolage': {
    heading: 'Bricolage Grotesque', body: 'Bricolage Grotesque', headingWeight: 700, tracking: '-0.035em', italic: false,
    families: 'family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,500;12..96,600;12..96,700;12..96,800',
    mood: 'bold, playful, characterful: kids, education, events, creative studios, street food, youth brands',
  },
  'bigshoulders-barlow': {
    heading: 'Big Shoulders Display', body: 'Barlow', headingWeight: 800, tracking: '0em', italic: false, upper: true,
    families: 'family=Big+Shoulders+Display:wght@700;800;900&family=Barlow:wght@400;500;600',
    mood: 'strong, physical: gyms, sports, construction, automotive, workshops, barbers',
  },
  'geist': {
    heading: 'Geist', body: 'Geist', headingWeight: 600, tracking: '-0.04em', italic: false, mono: 'Geist Mono',
    families: 'family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500',
    mood: 'precise, modern: software, startups, agencies, tech services, product launches',
  },
};

// ---------- colour: hand-tuned palettes (text contrast checked) ----------
// bg page, surface raised areas, ink text, muted secondary text, line hairlines, accent the ONE brand colour,
// onAccent text on the accent, deep a dark band colour for contrast sections, onDeep text on it.
export const PALETTES = {
  'paper-terracotta': { dark: false, bg: '#F6F3EE', surface: '#FFFFFF', ink: '#1A1714', muted: '#665F57', line: '#E3DCD2', accent: '#B4532A', onAccent: '#FFFFFF', deep: '#1F1B17', onDeep: '#F3EDE4', mood: 'warm paper and terracotta' },
  'espresso': { dark: true, bg: '#16100D', surface: '#211814', ink: '#F3EAE0', muted: '#B3A393', line: '#3A2D25', accent: '#D9A066', onAccent: '#16100D', deep: '#F3EAE0', onDeep: '#16100D', mood: 'dark roast and caramel' },
  'sage': { dark: false, bg: '#F0F2EB', surface: '#FAFBF7', ink: '#1C2420', muted: '#58645B', line: '#D8DDD1', accent: '#3E6A4E', onAccent: '#FFFFFF', deep: '#1E2B23', onDeep: '#EEF2EA', mood: 'calm sage and leaf green' },
  'forest-brass': { dark: true, bg: '#0E1913', surface: '#15231B', ink: '#ECF1EA', muted: '#9DAFA2', line: '#26392D', accent: '#CDB57F', onAccent: '#0E1913', deep: '#ECF1EA', onDeep: '#0E1913', mood: 'deep forest and brass' },
  'saffron': { dark: false, bg: '#FBF5EA', surface: '#FFFDF8', ink: '#2A1D12', muted: '#725E48', line: '#EADBC2', accent: '#C9661E', onAccent: '#FFFFFF', deep: '#2F4F45', onDeep: '#FBF5EA', mood: 'saffron, turmeric and leaf: Indian markets and kitchens' },
  'navy-ink': { dark: false, bg: '#F4F5F7', surface: '#FFFFFF', ink: '#111A2C', muted: '#555F73', line: '#DDE1E8', accent: '#1E3A8A', onAccent: '#FFFFFF', deep: '#111A2C', onDeep: '#EEF1F6', mood: 'navy ink on cool paper: dependable' },
  'noir-gold': { dark: true, bg: '#111110', surface: '#1A1A18', ink: '#F2EEE6', muted: '#A39E94', line: '#2D2C29', accent: '#C9A55F', onAccent: '#111110', deep: '#F2EEE6', onDeep: '#111110', mood: 'black and soft gold: luxury, evening' },
  'blush': { dark: false, bg: '#FAF3F0', surface: '#FFFFFF', ink: '#2B1E1E', muted: '#776262', line: '#EEDFD9', accent: '#A04659', onAccent: '#FFFFFF', deep: '#2B1E1E', onDeep: '#FAF3F0', mood: 'blush and rosewood' },
  'clay': { dark: false, bg: '#EFE7DC', surface: '#F8F3EC', ink: '#2B231F', muted: '#6F6258', line: '#DACDBD', accent: '#8B4A2E', onAccent: '#FFFFFF', deep: '#2B231F', onDeep: '#EFE7DC', mood: 'raw clay and fired earth' },
  'tide': { dark: false, bg: '#F1F6F7', surface: '#FFFFFF', ink: '#0F252D', muted: '#516C75', line: '#D6E2E5', accent: '#0E6B77', onAccent: '#FFFFFF', deep: '#0F252D', onDeep: '#EAF2F3', mood: 'clean water and teal: clinics, travel, wellness' },
  'concrete-signal': { dark: false, bg: '#ECECE8', surface: '#F7F7F4', ink: '#111111', muted: '#5A5A55', line: '#D2D2CC', accent: '#FF4A1C', onAccent: '#111111', deep: '#111111', onDeep: '#ECECE8', mood: 'concrete grey with a signal orange' },
  'night-lime': { dark: true, bg: '#0E0E0C', surface: '#181816', ink: '#F2F2EC', muted: '#A1A199', line: '#2A2A26', accent: '#D4F24A', onAccent: '#0E0E0C', deep: '#D4F24A', onDeep: '#0E0E0C', mood: 'black with electric lime: energy, nightlife' },
  'graphite-blue': { dark: false, bg: '#FAFAFA', surface: '#FFFFFF', ink: '#0B0B0C', muted: '#5B5B60', line: '#E6E6E8', accent: '#2742E8', onAccent: '#FFFFFF', deep: '#0B0B0C', onDeep: '#F4F4F5', mood: 'white, graphite and one sharp blue' },
  'plum': { dark: false, bg: '#F6F1F4', surface: '#FFFFFF', ink: '#25131F', muted: '#6C5767', line: '#E6D9E1', accent: '#6E2C5D', onAccent: '#FFFFFF', deep: '#25131F', onDeep: '#F6F1F4', mood: 'plum and soft lilac paper' },
  'sunny': { dark: false, bg: '#FFF8EC', surface: '#FFFFFF', ink: '#1C2933', muted: '#56656F', line: '#F0E2C8', accent: '#E0503A', onAccent: '#FFFFFF', deep: '#21695C', onDeep: '#FFF8EC', mood: 'sunny cream, tomato red and teal: cheerful' },
};

// ---------- layout: how professional sites in each category are composed ----------
export const LAYOUTS = {
  'photo-hero': {
    fit: 'restaurants, cafes, hotels, salons, venues: places people visit',
    grammar: [
      'HERO: full-bleed photo (min-h-[88svh]) with the .scrim overlay; headline in the bottom-left in .display, one line of supporting text, two buttons (.btn-primary, .btn-quiet on dark). No centred text.',
      'INFO STRIP right under the hero: 3 or 4 facts in a row separated by vertical .rule lines (opening hours, area, phone, price range), small .eyebrow labels above each value.',
      'STORY: 12-column grid; a short paragraph in col-span-5 next to a tall photo in col-span-6 offset by one column.',
      'OFFER: the menu or services as a list with name, one-line description and price aligned right (.price-row); grouped under small headings. Real items with real prices for this business.',
      'MOMENT: a full-width photo band (.band-photo) with one short quote over it.',
      'VISIT: address, opening hours table (.hours), phone and a "Get directions" link to Google Maps, in two columns.',
    ],
  },
  'editorial': {
    fit: 'bakeries, food brands, makers, writers, florists, studios with a story',
    grammar: [
      'HERO: no full photo. A very large headline in .display spanning 9 of 12 columns, left-aligned, with one italic word (.italic-accent); a short intro paragraph aligned to the right columns below it; then a wide photo (aspect-[16/7]) under the text.',
      'NUMBERED SECTIONS: each section opens with a .section-head: a number (01, 02...) and a label on a hairline rule. Asymmetric two-column content under it.',
      'PRODUCTS or WORK: a 3-column grid of photo cards (.card-photo) with name and price/meta as plain text under the image, no boxes or shadows.',
      'PULL QUOTE: one large quote in the heading font, with the person\'s name and role.',
      'CLOSING: a big sentence with a link-style call to action (.link-arrow), then the footer with the brand name set very large (.wordmark).',
    ],
  },
  'storefront': {
    fit: 'local shops, kirana and grocery stores, pharmacies, bakeries with delivery, pet shops, repair shops',
    grammar: [
      'UTILITY BAR above the header: opening hours on the left, phone and WhatsApp on the right, small text on the .deep colour.',
      'HERO: split 7/5 columns: headline, one sentence and buttons ("Order on WhatsApp", "See what\'s in stock") on the left; a collage of two or three photos on the right (one tall, two small, rounded-[var(--radius)]).',
      'CATEGORIES: a grid of 4-6 tiles, each a photo with the category name and a short line ("Fresh every morning"). Real categories for this shop.',
      'HOW IT WORKS: three numbered steps in a row (.step) for ordering, pickup or delivery, with the delivery area named.',
      'TRUST: a short owner note or "since 1998" story with a photo, and two or three real-sounding reviews with first name and neighbourhood.',
      'VISIT: address, hours table (.hours), phone, Google Maps link, and a big WhatsApp button.',
    ],
  },
  'split': {
    fit: 'consultants, agencies, coaches, freelancers, single-product brands',
    grammar: [
      'HERO: 50/50 split: left column has an .eyebrow, the headline and a paragraph and buttons; right column is one tall photo with rounded-[var(--radius)].',
      'PROOF ROW: three plain facts in a row (years, clients served, cities) as big numbers in the heading font with small labels. Only plausible, modest numbers.',
      'SERVICES: a two-column list, each service with a title, two sentences and a .link-arrow. Separated by hairline rules, no boxes.',
      'PROCESS: 3 or 4 numbered steps (.step) in a horizontal row on desktop, stacked on mobile.',
      'FAQ: 4-6 real questions with <details> and <summary> (.faq).',
      'CTA BAND: a .band-deep section with one sentence and a button.',
    ],
  },
  'manifesto': {
    fit: 'creative studios, architects, photographers, artists, bold brands',
    grammar: [
      'HERO: type only. The headline set enormous (.display-xl) across the full width, 2-4 lines; a small paragraph in the bottom-right corner.',
      'INDEX: the work or services as a list of large rows (.index-row): number, name in the heading font, category, year. Each row has a photo shown beside or under it on mobile.',
      'FEATURE: two big photos side by side with captions.',
      'ABOUT: a short statement in large text (text-2xl/3xl), then a few plain facts.',
      'CONTACT: an email address set very large as a link, and the social links in small caps.',
    ],
  },
  'catalog': {
    fit: 'fashion, jewellery, ceramics, products, menus with many items',
    grammar: [
      'HERO: a wide photo (aspect-[21/9] on desktop, 4/5 on mobile) with the headline set beside or under it, not centred over it.',
      'FEATURED: one featured item large (photo left 7 cols, details right: name, short story, price, button).',
      'GRID: 6-8 items in a 2-col (mobile) / 4-col grid, each .card-photo with name and price below the image. Real names and prices.',
      'MATERIALS or STORY: a two-column section with a photo and a paragraph about how things are made or sourced.',
      'NOTES: care, shipping or ordering details in three short columns.',
    ],
  },
  'trust': {
    fit: 'clinics, dentists, lawyers, accountants, schools, tutors, nonprofits',
    grammar: [
      'HERO: left-aligned headline and a reassuring sentence, buttons ("Book an appointment", "Call us"), and a calm photo on the right; under the text a credentials line (registrations, years, affiliations) in small text.',
      'SERVICES: a grid of 4-6 services as bordered panels (.panel), each with a title, two sentences and what to expect. No icons unless simple inline SVG line icons.',
      'PEOPLE: two or three people with name, role and qualifications (photos optional: use initials monograms if no photo).',
      'PROCESS: what happens on a first visit, in 3 numbered steps.',
      'FAQ: 4-6 real questions with <details>/<summary> (.faq).',
      'CONTACT: address, hours table, phone, and a simple enquiry form (name, phone, message) with action="#".',
    ],
  },
};

// ---------- photos: hand-checked Unsplash photos, tagged by subject ----------
let library = null;
export function photoLibrary() {
  if (!library) {
    try {
      library = JSON.parse(fs.readFileSync(new URL('./photoLibrary.json', import.meta.url), 'utf8'));
    } catch {
      library = [];
    }
  }
  return library;
}

export const PHOTO_TAGS = [...new Set(photoLibrary().flatMap((p) => p.tags))].sort();

export function photoUrl(id, w = 1600) {
  return `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&q=80`;
}

function hash(s) {
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

/** Up to `n` photos for these subject tags, best matches first; the same brand always gets the same photos. */
export function pickPhotos(tags = [], n = 6, seed = '') {
  const want = (Array.isArray(tags) ? tags : [tags]).map((t) => String(t).toLowerCase().trim()).filter(Boolean);
  const scored = photoLibrary().map((p) => {
    const score = want.reduce((s, t, i) => s + (p.tags.includes(t) ? (want.length - i) * 2 + (p.tags[0] === t ? 1 : 0) : 0), 0);
    return { p, score, tie: hash(seed + p.id) };
  }).filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.tie - b.tie);
  return scored.slice(0, n).map(({ p }) => ({ id: p.id, url: photoUrl(p.id), alt: p.alt }));
}

// ---------- the page head: fonts, tokens and the base CSS ----------
export function resolveSystem(choice = {}) {
  const typeId = TYPE_PAIRS[choice.typePair] ? choice.typePair : 'fraunces-instrument';
  const paletteId = PALETTES[choice.palette] ? choice.palette : 'paper-terracotta';
  const layoutId = LAYOUTS[choice.layout] ? choice.layout : 'editorial';
  return { typeId, paletteId, layoutId, type: TYPE_PAIRS[typeId], palette: PALETTES[paletteId], layout: LAYOUTS[layoutId] };
}

export function googleFontsUrl(type) {
  return `https://fonts.googleapis.com/css2?${type.families}&display=swap`;
}

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function monogram(brand, palette) {
  const letter = (String(brand || 'W').trim()[0] || 'W').toUpperCase();
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><rect width='64' height='64' rx='14' fill='${palette.accent}'/>` +
    `<text x='50%' y='54%' dominant-baseline='middle' text-anchor='middle' font-family='Georgia,serif' font-size='38' fill='${palette.onAccent}'>${esc(letter)}</text></svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function buildHead({ system, brandName = '', title = '', description = '' }) {
  const { type: t, palette: p } = system;
  const headingStack = `"${t.heading}", ${/Serif|Fraunces|Cormorant|Newsreader|Young/.test(t.heading) ? 'Georgia, serif' : 'system-ui, sans-serif'}`;
  const bodyStack = `"${t.body}", system-ui, -apple-system, "Segoe UI", sans-serif`;
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title || brandName)}</title>
<meta name="description" content="${esc(description).slice(0, 300)}">
<meta name="theme-color" content="${p.bg}">
<meta name="weave-design" content="type=${system.typeId};palette=${system.paletteId};layout=${system.layoutId}">
<link rel="icon" href="${monogram(brandName, p)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${googleFontsUrl(t)}">
<script src="https://cdn.tailwindcss.com"></script>
<script>
tailwind.config = { theme: { extend: {
  colors: { bg: 'var(--bg)', surface: 'var(--surface)', ink: 'var(--ink)', muted: 'var(--muted)', line: 'var(--line)',
            accent: 'var(--accent)', 'on-accent': 'var(--on-accent)', deep: 'var(--deep)', 'on-deep': 'var(--on-deep)' },
  fontFamily: { heading: [${JSON.stringify(t.heading)}, 'serif'], body: [${JSON.stringify(t.body)}, 'sans-serif']${t.mono ? `, mono: [${JSON.stringify(t.mono)}, 'monospace']` : ''} },
  maxWidth: { page: '1240px' },
} } };
</script>
<style type="text/tailwindcss">
@layer base {
  :root { --bg: ${p.bg}; --surface: ${p.surface}; --ink: ${p.ink}; --muted: ${p.muted}; --line: ${p.line};
    --accent: ${p.accent}; --on-accent: ${p.onAccent}; --deep: ${p.deep}; --on-deep: ${p.onDeep};
    --radius: ${system.layoutId === 'manifesto' ? '0px' : system.typeId === 'bigshoulders-barlow' ? '4px' : '14px'};
    --heading: ${headingStack}; --body: ${bodyStack}; color-scheme: ${p.dark ? 'dark' : 'light'}; }
  html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
  body { background: var(--bg); color: var(--ink); font-family: var(--body); font-size: 1.0625rem; line-height: 1.65;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; font-feature-settings: "kern", "liga"; }
  h1, h2, h3, h4 { font-family: var(--heading); font-weight: ${t.headingWeight}; letter-spacing: ${t.tracking};
    line-height: 1.08; text-wrap: balance; color: var(--ink);${t.upper ? ' text-transform: uppercase;' : ''} }
  h2 { font-size: clamp(2rem, 1.4rem + 2.6vw, 3.5rem); }
  h3 { font-size: clamp(1.25rem, 1.1rem + 0.6vw, 1.6rem); line-height: 1.2; }
  p { text-wrap: pretty; }
  a { color: inherit; text-underline-offset: 0.2em; text-decoration-thickness: 1px; }
  img { display: block; max-width: 100%; height: auto; }
  ::selection { background: var(--accent); color: var(--on-accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 4px; }
  input, textarea, select { background: var(--surface); border: 1px solid var(--line); border-radius: calc(var(--radius) * 0.6);
    padding: 0.8rem 1rem; width: 100%; color: var(--ink); font: inherit; }
  input:focus, textarea:focus, select:focus { outline: none; border-color: var(--accent); }
  label { font-size: 0.875rem; color: var(--muted); }
}
@layer components {
  .container-page { width: 100%; max-width: 1240px; margin-inline: auto; padding-inline: clamp(1.25rem, 4vw, 3rem); }
  .section { padding-block: clamp(4.5rem, 9vw, 8.5rem); }
  .section-tight { padding-block: clamp(3rem, 6vw, 5rem); }
  .display { font-family: var(--heading); font-size: clamp(2.9rem, 1.6rem + 6vw, 6.25rem); line-height: 0.98; letter-spacing: ${t.tracking}; text-wrap: balance; }
  .display-xl { font-family: var(--heading); font-size: clamp(3.4rem, 1.2rem + 10vw, 10.5rem); line-height: 0.9; letter-spacing: ${t.upper ? '0' : '-0.045em'}; }
  .italic-accent { font-style: ${t.italic ? 'italic' : 'normal'}; color: var(--accent); }
  .lead { font-size: clamp(1.125rem, 1rem + 0.45vw, 1.35rem); line-height: 1.55; color: var(--muted); max-width: 38rem; }
  .eyebrow { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
  .rule { border-color: var(--line); }
  .section-head { display: flex; align-items: baseline; gap: 1.25rem; border-top: 1px solid var(--line); padding-top: 1.1rem; margin-bottom: clamp(2rem, 4vw, 3.5rem); }
  .section-head .num { font-family: var(--heading); color: var(--accent); font-size: 1rem; font-variant-numeric: tabular-nums; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; padding: 0.95rem 1.6rem; border-radius: 999px;
    font-weight: 600; font-size: 0.95rem; line-height: 1; text-decoration: none; white-space: nowrap; min-height: 44px; transition: transform .2s ease, background-color .2s ease, color .2s ease; }
  .btn:hover { transform: translateY(-1px); }
  .btn-primary { background: var(--accent); color: var(--on-accent); }
  .btn-primary:hover { filter: brightness(1.06); }
  .btn-ghost { border: 1px solid var(--ink); color: var(--ink); }
  .btn-ghost:hover { background: var(--ink); color: var(--bg); }
  .btn-quiet { border: 1px solid rgba(255,255,255,.55); color: #fff; }
  .btn-quiet:hover { background: #fff; color: #111; }
  .link-arrow { display: inline-flex; align-items: center; gap: .5rem; font-weight: 600; text-decoration: underline; text-decoration-color: var(--line); }
  .link-arrow::after { content: "\\2192"; transition: transform .2s ease; }
  .link-arrow:hover::after { transform: translateX(4px); }
  .link-arrow:hover { text-decoration-color: currentColor; }
  .card-photo img { aspect-ratio: 4 / 5; width: 100%; object-fit: cover; border-radius: var(--radius); }
  .panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: clamp(1.5rem, 3vw, 2.25rem); }
  .photo { width: 100%; height: 100%; object-fit: cover; border-radius: var(--radius); }
  .scrim { position: relative; isolation: isolate; color: #fff; }
  .scrim > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
  .scrim::before { content: ""; position: absolute; inset: 0; z-index: -1; background: linear-gradient(180deg, rgba(0,0,0,.18) 0%, rgba(0,0,0,.05) 40%, rgba(0,0,0,.62) 100%); }
  .scrim h1, .scrim h2, .scrim p { color: #fff; }
  .band-deep { background: var(--deep); color: var(--on-deep); }
  .band-deep h2, .band-deep h3, .band-deep p { color: var(--on-deep); }
  .band-photo { position: relative; isolation: isolate; min-height: 60svh; display: grid; place-items: end start; color: #fff; }
  .band-photo > img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: -2; }
  .band-photo::before { content: ""; position: absolute; inset: 0; z-index: -1; background: rgba(0,0,0,.38); }
  .price-row { display: flex; align-items: baseline; gap: 1rem; padding-block: 1rem; border-bottom: 1px solid var(--line); }
  .price-row .name { font-family: var(--heading); font-size: 1.25rem; }
  .price-row .desc { color: var(--muted); font-size: .95rem; }
  .price-row .price { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 600; white-space: nowrap; }
  .hours { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  .hours td { padding: .6rem 0; border-bottom: 1px solid var(--line); }
  .hours td:last-child { text-align: right; color: var(--muted); }
  .step .n { font-family: var(--heading); font-size: 2.5rem; color: var(--accent); line-height: 1; }
  .index-row { display: grid; grid-template-columns: 3rem 1fr auto; gap: 1rem; align-items: baseline; padding-block: 1.4rem; border-top: 1px solid var(--line); transition: color .2s ease, padding .2s ease; }
  .index-row:hover { color: var(--accent); padding-left: .5rem; }
  .faq details { border-top: 1px solid var(--line); padding-block: 1.25rem; }
  .faq summary { cursor: pointer; list-style: none; display: flex; justify-content: space-between; gap: 1rem; font-weight: 600; font-size: 1.1rem; }
  .faq summary::-webkit-details-marker { display: none; }
  .faq summary::after { content: "+"; color: var(--accent); font-size: 1.4rem; line-height: 1; transition: transform .2s ease; }
  .faq details[open] summary::after { transform: rotate(45deg); }
  .faq details p { color: var(--muted); margin-top: .75rem; max-width: 46rem; }
  .wordmark { font-family: var(--heading); font-size: clamp(3.5rem, 2rem + 12vw, 14rem); line-height: .85; letter-spacing: -0.04em; }
  .site-header { position: sticky; top: 0; z-index: 40; background: color-mix(in srgb, var(--bg) 92%, transparent); border-bottom: 1px solid transparent; transition: border-color .2s ease; }
  .site-header.scrolled { border-bottom-color: var(--line); }
  .site-header .nav-links a { text-decoration: none; font-size: .95rem; color: var(--muted); }
  .site-header .nav-links a:hover, .site-header .nav-links a[aria-current="page"] { color: var(--ink); }
  [data-reveal] { transition: opacity .8s cubic-bezier(.2,.7,.2,1), transform .8s cubic-bezier(.2,.7,.2,1); }
  .js [data-reveal]:not(.is-in) { opacity: 0; transform: translateY(18px); }
}
@media (max-width: 767px) {
  .site-header .nav-links { display: none; }
  .site-header.open .nav-links { display: flex; position: absolute; left: 0; right: 0; top: 100%; flex-direction: column; gap: 0;
    background: var(--bg); border-bottom: 1px solid var(--line); padding: .5rem clamp(1.25rem, 4vw, 3rem) 1.25rem; }
  .site-header.open .nav-links a { padding-block: .85rem; border-bottom: 1px solid var(--line); font-size: 1.1rem; color: var(--ink); }
}
@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } * { transition: none !important; animation: none !important; } .js [data-reveal]:not(.is-in) { opacity: 1; transform: none; } }
</style>`;
}

// Mobile menu, the header's hairline on scroll, and gentle reveal-on-scroll. Content stays visible without JS.
export const SITE_SCRIPT = `<script>
(function(){var d=document,h=d.documentElement;h.classList.add('js');
var hd=d.querySelector('.site-header'),bt=d.querySelector('[data-nav-toggle]');
if(hd&&bt){bt.addEventListener('click',function(){var o=hd.classList.toggle('open');bt.setAttribute('aria-expanded',o?'true':'false');});
hd.querySelectorAll('.nav-links a').forEach(function(a){a.addEventListener('click',function(){hd.classList.remove('open');bt.setAttribute('aria-expanded','false');});});}
if(hd){var f=function(){hd.classList.toggle('scrolled',window.scrollY>8)};f();window.addEventListener('scroll',f,{passive:true});}
var here=(location.pathname.split('/').pop()||'index.html');d.querySelectorAll('.nav-links a').forEach(function(a){if((a.getAttribute('href')||'').split('#')[0]===here)a.setAttribute('aria-current','page');});
var els=d.querySelectorAll('[data-reveal]');if(!('IntersectionObserver' in window)){els.forEach(function(e){e.classList.add('is-in')});}
else{var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('is-in');io.unobserve(e.target);}})},{rootMargin:'0px 0px -8% 0px'});els.forEach(function(e){io.observe(e)});}
setTimeout(function(){els.forEach(function(e){e.classList.add('is-in')})},2500);
d.querySelectorAll('[data-year]').forEach(function(e){e.textContent=new Date().getFullYear()});})();
</script>`;

// ---------- the brief the page writer works from ----------
export function componentGuide(system) {
  return `DESIGN SYSTEM (already loaded in <head>; use it, do not redefine it):
- Tailwind CSS is loaded. Colour utilities use the brand tokens ONLY: bg-bg, bg-surface, bg-deep, bg-accent, text-ink, text-muted, text-accent,
  text-on-accent, text-on-deep, border-line, border-ink. Never use Tailwind's stock colours (no slate-, gray-, indigo-, purple-, blue-, emerald- ...),
  never hex colours, never gradients.
- Fonts: font-heading for headings and big numbers, font-body for everything else (default).
- Classes: .container-page (page width + side padding), .section / .section-tight (vertical rhythm), .display / .display-xl (hero headline),
  .italic-accent (one emphasised word in a headline), .lead (intro paragraph), .eyebrow (small caps label), .section-head with <span class="num">01</span>,
  .btn + .btn-primary / .btn-ghost / .btn-quiet (on photos), .link-arrow, .card-photo (wrap an <img>), .panel (bordered box), .photo (img filling its box),
  .scrim (wrapper with an <img> first child: photo hero with readable text), .band-photo (photo band), .band-deep (dark contrast band),
  .price-row with .name .desc .price, table.hours, .step with .n, .index-row, .faq (wrapping <details><summary>...</summary><p>...</p></details>), .wordmark.
- Header contract (required): <header class="site-header"><div class="container-page flex items-center justify-between h-16 md:h-20 relative">
  brand name as a text link to index.html (font-heading text-xl, no logo image) · <nav class="nav-links md:flex items-center gap-8">links</nav> ·
  one .btn .btn-primary on desktop (hidden md:inline-flex) · <button data-nav-toggle aria-label="Menu" aria-expanded="false" class="md:hidden">
  with a simple two-line SVG icon</button></div></header>. The mobile menu is already scripted; do not write any JavaScript.
- Groups of buttons: <div class="flex flex-wrap gap-3">. Images in grids: wrap in a box with an aspect ratio (aspect-[4/5], aspect-[3/2]) and use .photo.
- Add data-reveal to major blocks (section headings, grids, images) for a gentle entrance. No other animation.
- Footer: brand name, one line about the business, address/phone/email, small nav, and "© <span data-year></span>" followed by the brand name.`;
}

export const RULES = `WHAT MAKES IT LOOK PROFESSIONAL, NOT AI-MADE:
1. Real, specific content. Write like the business owner's best copywriter: concrete nouns, real item names, prices in the local currency,
   opening hours, the neighbourhood, how ordering works. Short sentences. No filler.
   Banned words: elevate, unleash, unlock, seamless, revolutionize, cutting-edge, empower, game-changer, next-level, world-class, synergy,
   journey, curated experience, "look no further", "in today's fast-paced world", telemetry, matrix, dashboard, real-time (unless literally true).
2. No invented statistics, awards, "trusted by 10,000+", star ratings, logos of other companies, or fake press. Reviews: at most three,
   plain first names, believable and specific.
3. Typography does the work: big confident headings, generous whitespace, left-aligned text (centre only short single lines), max ~65 characters
   per line for paragraphs, a clear hierarchy of 3-4 sizes. One accent colour used sparingly (buttons, a word, small details).
4. Never: emoji, icon-in-a-circle feature cards, three identical feature boxes with icons, gradient text, glows, glassmorphism/backdrop blur,
   neon, fake browser/window chrome or "traffic light" dots, fake app screenshots, floating blobs, pill badges saying "New" or "AI",
   lorem ipsum, "Get Started" (say what actually happens: "Book a table", "Order on WhatsApp", "See the menu").
5. Rhythm: vary the sections (a wide photo, then a text-heavy section, then a grid, then a dark band). Not every section is a centred title
   plus a row of cards. Use hairline rules and alignment instead of boxes and shadows.
6. Photos: use ONLY the photo URLs given, each at most twice, with object-fit cover and their alt text. No other image URLs, no placeholders.
   If a section has no fitting photo, design it with type, rules and colour instead.
7. Accessible: real <h1> once, logical h2/h3, buttons and links that say what they do, sufficient contrast (use text-on-accent on accent,
   text-on-deep on deep, white text only on .scrim/.band-photo).
8. Mobile first: every grid collapses to one column under md; nothing overflows horizontally; tap targets at least 44px tall.
9. Live data: the list of things the business sells or offers (products, menu items, services, rooms, courses) is the owner's live data,
   which they edit later from WhatsApp and their dashboard. Wrap that list in one element with data-weave-list="products" (or "menu" or
   "services"), give every card or row data-weave-item, and inside it mark the values with data-weave-field: "name", "price",
   "description", "category", "image" (on the <img>), and "stock" only if a quantity is shown. Write the real items as normal content;
   every item in a list uses the same markup. One list per kind of thing; nothing else on the page gets these attributes.`;

// ---------- clean-up of the model's HTML ----------
const SLOP_CLASSES = [
  /^bg-clip-text$/, /^text-transparent$/, /^backdrop-blur(-\w+)?$/, /^animate-(pulse|bounce|ping|spin)$/,
  /^bg-gradient-to-\w+$/, /^from-\S+$/, /^via-\S+$/, /^to-\S+$/, /^shadow-\[.*\]$/, /^blur-(2xl|3xl)$/,
  /^(?:bg|text|border|from|to|via|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}(?:\/\d+)?$/,
];
// Pictographic emoji, keeping ©, ® and ™, which are typography.
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}]️?(?:‍[\p{Extended_Pictographic}]️?)*/gu;

function cleanClasses(html) {
  return html.replace(/\sclass="([^"]*)"/g, (m, cls) => {
    const kept = cls.split(/\s+/).filter((c) => c && !SLOP_CLASSES.some((re) => re.test(c.replace(/^(?:[a-z]+:)+/, ''))));
    return kept.length ? ` class="${kept.join(' ')}"` : '';
  });
}

function stripEmojiFromText(html) {
  // Only text between tags, never attributes or scripts.
  return html.replace(/>([^<]+)</g, (m, text) => '>' + text.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ') + '<');
}

/** Pins every <img> to the photos chosen for this site, so no broken or invented image URLs survive. */
function pinImages(html, photos) {
  if (!photos?.length) return html.replace(/<img\b[^>]*>/gi, '');
  const allowed = new Map(photos.map((p) => [p.id, p]));
  let i = 0;
  return html.replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
    const src = (attrs.match(/\ssrc="([^"]*)"/i) || [])[1] || '';
    const id = (src.match(/images\.unsplash\.com\/(photo-[\w-]+)/) || [])[1];
    const photo = (id && allowed.get(id)) || photos[i++ % photos.length];
    let a = attrs.replace(/\s(?:src|srcset|sizes|loading|decoding)="[^"]*"/gi, '');
    if (!/\salt="/i.test(a)) a += ` alt="${esc(photo.alt)}"`;
    const eager = /fetchpriority="high"/i.test(a);
    return `<img src="${photoUrl(photo.id)}" srcset="${photoUrl(photo.id, 800)} 800w, ${photoUrl(photo.id, 1600)} 1600w, ${photoUrl(photo.id, 2400)} 2400w" ` +
      `sizes="100vw" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${a}>`;
  });
}

export function bodyOf(html) {
  const m = String(html || '').match(/<body\b[^>]*>([\s\S]*?)(?:<\/body>|$)/i);
  return (m ? m[1] : String(html || '')).trim();
}

export function stripFences(text) {
  const t = String(text || '').trim();
  const m = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  return (m ? m[1] : t).trim();
}

/** The finished page: our head, the model's body (cleaned), our script. */
export function assemblePage({ body, system, brandName, title, description, photos }) {
  let b = bodyOf(stripFences(body));
  b = b.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  b = b.replace(/<link\b[^>]*>/gi, '');
  b = cleanClasses(b);
  b = stripEmojiFromText(b);
  b = pinImages(b, photos);
  // The first image is the one people see first.
  b = b.replace(/<img\b([^>]*?)loading="lazy"/i, '<img$1loading="eager" fetchpriority="high"');
  return `<!DOCTYPE html>
<html lang="en">
<head>
${buildHead({ system, brandName, title, description })}
</head>
<body class="font-body bg-bg text-ink">
${b}
${SITE_SCRIPT}
</body>
</html>`;
}

/** The design choices recorded in a page this system built, so changes and extra pages keep them. */
export function systemOf(html) {
  const m = String(html || '').match(/<meta name="weave-design" content="type=([\w-]+);palette=([\w-]+);layout=([\w-]+)">/);
  return m ? resolveSystem({ typePair: m[1], palette: m[2], layout: m[3] }) : null;
}

export function photosIn(html) {
  const ids = [...String(html || '').matchAll(/images\.unsplash\.com\/(photo-[\w-]+)/g)].map((m) => m[1]);
  const lib = new Map(photoLibrary().map((p) => [p.id, p]));
  return [...new Set(ids)].map((id) => lib.get(id)).filter(Boolean).map((p) => ({ id: p.id, url: photoUrl(p.id), alt: p.alt }));
}

/** Small sentences the model can't get wrong about the tokens, for prompts. */
export function systemSummary() {
  return {
    typePairs: Object.entries(TYPE_PAIRS).map(([id, t]) => `${id}: ${t.heading} + ${t.body} (${t.mood})`).join('\n'),
    palettes: Object.entries(PALETTES).map(([id, p]) => `${id}: ${p.mood}${p.dark ? ' [dark]' : ''}`).join('\n'),
    layouts: Object.entries(LAYOUTS).map(([id, l]) => `${id}: ${l.fit}`).join('\n'),
    photoTags: PHOTO_TAGS.join(', '),
  };
}
