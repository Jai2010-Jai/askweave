import { geminiClient } from '../gemini-client.js';
import { googleFontsUrl, resolveSystem, systemSummary } from './designSystem.js';

/**
 * The creative brief for a website: who the business is, what it sells, what the site should say, and three
 * design directions. Each direction is a set of choices from Weave's design system (a type pairing, a palette, a
 * layout and photo subjects), the way a design director would pick them, rather than colours and fonts invented on
 * the spot (which is what makes generated sites look generated).
 *
 * @param {string} prompt - The user's website request
 * @returns {Promise<{ topicAnalysis: object, inspirations: object[] }>}
 */
export async function researchDesignInspirations(prompt) {
  const sys = systemSummary();
  const systemPrompt = `You are the creative director of a small, very good design studio. A client sent this request for a website:
"${prompt}"

Write the creative brief. Think like a professional who has designed hundreds of sites for real businesses: what would this business's best
possible website say, show and feel like? Be concrete and specific to THIS business, its customers and its place.

CONTENT (topicAnalysis):
- brandName: the business name they gave; if none, invent a short, believable real-world name (not "XYZ Hub", "Pro", "AI", "Solutions").
- headline: the hero headline, 3-9 words, specific and human, the way a great copywriter would put it (no "Welcome to", no slogans like
  "Elevate your..."). tagline: one supporting sentence.
- domain, targetAudience, location (city/area if given or implied, else ""), currency symbol for prices (₹ for India, $ US, £ UK, € Europe...).
- offerings: 6-10 real things they sell or do, each with a name, a one-line description and a realistic local price ("" if prices don't fit).
- keyFeatures: 3-4 genuine reasons to choose them (title, one-sentence description, metric = a short concrete fact like "Since 2009"
  or "Delivery within 3 km", never invented statistics).
- facts: 3-6 practical details a customer needs (hours, delivery area, how to order, booking, parking...). Plausible, modest.
- voice: two or three words for how the copy should sound (e.g. "warm, plain-spoken, local").
- benchmarkSites: 3 real, well-designed websites of businesses like this one.

DESIGN (inspirations): exactly 3 directions that are genuinely different from each other, each choosing ONE of each:
typePair (id):
${sys.typePairs}
palette (id):
${sys.palettes}
layout (id):
${sys.layouts}
photoTags: 2-4 subjects from this list, most important first: ${sys.photoTags}
Option 1 must be the best fit for the business and its customers (it is the one that gets built). Match the mood: a kirana store is
friendly and practical, a law firm calm and trustworthy, a salon elegant, a gym bold. Pick dark palettes only when the business suits it.
For each direction also give: id (slug), name (a short evocative name for the direction), sourceInspiration (the real-world references
it borrows from, e.g. "Aesop's restraint, Kinfolk's editorial pacing"), aestheticDescription (2-3 sentences: layout, imagery, typographic
character), components (4-6 section names in page order, using the business's real content).

Reply with JSON only, no markdown.`;

  try {
    console.log('[InspirationResearcher] Writing the creative brief...');
    const res = await geminiClient.generateContent(
      `Write the creative brief for: "${prompt}". Return strictly raw JSON.`,
      systemPrompt
    );
    let rawJson = res.text.trim();
    if (rawJson.startsWith('```')) rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(rawJson);
    if (parsed?.inspirations?.length >= 1 && parsed?.topicAnalysis) {
      parsed.inspirations = parsed.inspirations.slice(0, 3).map((d, i) => withTokens(d, i));
      console.log(`[InspirationResearcher] Directions: ${parsed.inspirations.map((d) => `${d.name} (${d.typePair}/${d.palette}/${d.layout})`).join(', ')}`);
      return parsed;
    }
  } catch (err) {
    console.warn('[InspirationResearcher] Brief notice:', err.message);
  }
  return getFallbackDesignInspirations(prompt);
}

/** A direction with the concrete tokens of its choices (fonts, colours) filled in from the design system. */
export function withTokens(direction = {}, i = 0) {
  const system = resolveSystem(direction);
  const p = system.palette;
  return {
    ...direction,
    option: direction.option || i + 1,
    typePair: system.typeId,
    palette: system.paletteId,
    layout: system.layoutId,
    photoTags: Array.isArray(direction.photoTags) ? direction.photoTags.slice(0, 4) : [],
    fontHeading: system.type.heading,
    fontBody: system.type.body,
    googleFontsUrl: googleFontsUrl(system.type),
    colors: { bg: p.bg, bgCard: p.surface, accent: p.accent, accentSecondary: p.deep, textPrimary: p.ink, textMuted: p.muted, border: p.line },
    components: Array.isArray(direction.components) ? direction.components : [],
  };
}

/** Used only when the AI can't be reached (the Weave bridge then reports a failure instead of building this). */
function getFallbackDesignInspirations(prompt) {
  const name = String(prompt || '').replace(/^(create|build|make|design|a|an|the|website|site|for|my)\s+/gi, '').trim()
    .split(/\s+/).slice(0, 3).join(' ') || 'Studio';
  const directions = [
    { id: 'editorial', name: 'Editorial', typePair: 'fraunces-instrument', palette: 'paper-terracotta', layout: 'editorial' },
    { id: 'split', name: 'Clear and direct', typePair: 'newsreader-public', palette: 'navy-ink', layout: 'split' },
    { id: 'bold', name: 'Bold', typePair: 'bricolage', palette: 'concrete-signal', layout: 'manifesto' },
  ];
  return {
    topicAnalysis: { domain: name, brandName: name, headline: name, tagline: '', targetAudience: '', benchmarkSites: [], keyFeatures: [] },
    inspirations: directions.map((d, i) => withTokens({ ...d, sourceInspiration: '', aestheticDescription: '' }, i)),
  };
}
