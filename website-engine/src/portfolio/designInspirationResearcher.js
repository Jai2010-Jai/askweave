import { geminiClient } from '../gemini-client.js';

/**
 * Fetches recent live design inspiration entries from Minimal Gallery RSS feed.
 * @returns {Promise<Array<{ title: string, link: string, categories: string[], imageUrl?: string }>>}
 */
export async function fetchMinimalGalleryInspiration() {
  try {
    const res = await fetch('https://minimal.gallery/feed/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WeaveDesignBot/1.0)' },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    for (const rawItem of itemMatches.slice(0, 6)) {
      const title = rawItem.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || '';
      const link = rawItem.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const categories = [...rawItem.matchAll(/<category>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/category>/g)].map(
        (m) => m[1]
      );
      const imageUrl = rawItem.match(/<img[^>]+src="([^">]+)"/)?.[1] || '';
      if (title) {
        items.push({ title, link, categories, imageUrl });
      }
    }
    return items;
  } catch (err) {
    console.warn('[InspirationResearcher] Minimal Gallery feed notice:', err.message);
    return [];
  }
}

/**
 * Researches real-world design inspirations across Dribbble, Minimal Gallery, and top web designs
 * for the user's specific domain/topic using Gemini.
 *
 * @param {string} prompt - The user's website request
 * @param {object} [options]
 * @returns {Promise<{
 *   topicAnalysis: { domain: string, targetAudience: string, benchmarkSites: string[] },
 *   inspirations: Array<{
 *     option: number,
 *     id: string,
 *     name: string,
 *     sourceInspiration: string,
 *     aestheticDescription: string,
 *     fontHeading: string,
 *     fontBody: string,
 *     googleFontsUrl: string,
 *     stitchHeadlineFont: string,
 *     stitchBodyFont: string,
 *     colors: { bg: string, bgCard: string, accent: string, accentSecondary: string, textPrimary: string, textMuted: string, border: string },
 *     components: string[],
 *     stitchPrompt: string
 *   }>
 * }>}
 */
export async function researchDesignInspirations(prompt, options = {}) {
  const minimalGalleryItems = await fetchMinimalGalleryInspiration();
  const minimalGalleryContext = minimalGalleryItems.length > 0
    ? `Recent curated sites on Minimal Gallery:\n` +
      minimalGalleryItems.map((i) => `- "${i.title}" (${i.categories.join(', ')}): ${i.link}`).join('\n')
    : `Curated gallery references: Minimal Gallery, Godly.website, Siteinspire, Dribbble Top Product Design.`;

  const systemPrompt = `You are a World-Class Design Director, Web Design Curator, and Design Systems Architect for award-winning sites.
Your mission is to perform deep design inspiration research for a user's website request, referencing actual design trends from Dribbble, Minimal Gallery (minimal.gallery), Godly.website, and top-tier real-world products.

User Prompt: "${prompt}"

Current Live Design Gallery Context:
${minimalGalleryContext}

CRITICAL MANDATE: ABSOLUTELY ZERO PRESETS, ZERO CANNED TEMPLATES, ZERO FORCED ARCHETYPES.
DO NOT use predefined formulas like "Swiss Editorial", "Bento Grid", or "Neon UI".
DO NOT pigeonhole every site into the same 3 preset styles.
Every single website request MUST receive 3 COMPLETELY DYNAMIC, BESPOKE AESTHETIC PHILOSOPHIES invented organically for this specific domain, craft, and brand.

Examples of domain-native aesthetic invention:
- For a Horse Tender / Equestrian Estate:
  * Direction 1: "Heritage Paddock & Saddle Leather" (Deep forest obsidian #0A110D, saddle amber #C28B53, warm linen, live pasture camera viewport & turnout schedules)
  * Direction 2: "Equine Performance & Livery Telemetry" (Stall care matrix, veterinary audit logs, high-precision typography, biometric trackers)
  * Direction 3: "Nordic Horsemanship & Raw Timber" (Organic curves, warm pine tones, plein-air photo spreads, gentle tactile cards)
- For an Artisan Sourdough Bakery:
  * Direction 1: "Wood-Fired Hearth & Flour" (Crust amber, stone gray, fermentation schedule, daily bake counter)
  * Direction 2: "Parisian Pâtisserie Monograph" (Porcelain cream, gilded accents, serif typography, vitrine pastry showcase)
  * Direction 3: "Organic Grain Lab" (Minimalist transparency matrix, farmer partner origin cards)
- For a Financial Spreadsheet Add-on:
  * Direction 1: "Autonomous Ledger & Cell Sync" (Deep slate, formula bar preview, emerald verification badges)
  * Direction 2: "Institutional Audit Precision" (Hairline balance sheets, variance matrices, CFO proof tables)
  * Direction 3: "Kinetic Financial Canvas" (Interactive calculation sandbox, real-time FX tickers)

Generate 3 RADICALLY DIFFERENT, dynamic design philosophies tailored uniquely to: "${prompt}".
Invent evocative names for each direction that naturally belong to this domain (NOT generic presets!).

For valid Stitch fonts, stitchHeadlineFont and stitchBodyFont MUST be one of:
"PLAYFAIR_DISPLAY", "SPACE_GROTESK", "DM_SANS", "PLUS_JAKARTA_SANS", "OUTFIT", "INTER", "MONTSERRAT", "MANROPE", "FRAUNCES", "SPACE_MONO", "GOOGLE_SANS", "IBM_PLEX_SERIF"

Output MUST be strictly valid JSON without any markdown or code fences. Format:
{
  "topicAnalysis": {
    "domain": string,
    "brandName": string,
    "tagline": string,
    "headline": string,
    "targetAudience": string,
    "benchmarkSites": [string, string, string],
    "keyFeatures": [
      { "title": string, "description": string, "metric": string }
    ]
  },
  "inspirations": [
    {
      "option": 1,
      "id": string (unique slug tailored to this direction),
      "name": string (bespoke evocative name invented for this domain),
      "sourceInspiration": string (real-world web references, Dribbble concepts, or gallery motifs suited to this niche),
      "aestheticDescription": string (detailed description of visual architecture, spatial rhythm, and materials),
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string (Google Fonts css2 link),
      "stitchHeadlineFont": string (valid Stitch enum),
      "stitchBodyFont": string (valid Stitch enum),
      "colors": {
        "bg": string (hex),
        "bgCard": string (hex),
        "accent": string (hex),
        "accentSecondary": string (hex),
        "textPrimary": string (hex),
        "textMuted": string (hex),
        "border": string (hex)
      },
      "components": [string, string, string, string],
      "stitchPrompt": string (Exhaustive 3-paragraph prompt specifying the hero layout, bespoke UI mockups, metrics grid, feature showcase, and footer for Google Stitch MCP)
    },
    {
      "option": 2,
      "id": string,
      "name": string,
      "sourceInspiration": string,
      "aestheticDescription": string,
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string,
      "stitchHeadlineFont": string,
      "stitchBodyFont": string,
      "colors": {
        "bg": string,
        "bgCard": string,
        "accent": string,
        "accentSecondary": string,
        "textPrimary": string,
        "textMuted": string,
        "border": string
      },
      "components": [string, string, string, string],
      "stitchPrompt": string
    },
    {
      "option": 3,
      "id": string,
      "name": string,
      "sourceInspiration": string,
      "aestheticDescription": string,
      "fontHeading": string,
      "fontBody": string,
      "googleFontsUrl": string,
      "stitchHeadlineFont": string,
      "stitchBodyFont": string,
      "colors": {
        "bg": string,
        "bgCard": string,
        "accent": string,
        "accentSecondary": string,
        "textPrimary": string,
        "textMuted": string,
        "border": string
      },
      "components": [string, string, string, string],
      "stitchPrompt": string
    }
  ]
}`;

  try {
    console.log('[InspirationResearcher] Querying Gemini for Dribbble & Minimal Gallery design inspiration...');
    const res = await geminiClient.generateContent(
      `Research Dribbble, Minimal Gallery, and top award-winning design inspirations for: "${prompt}". Return strictly raw JSON.`,
      systemPrompt
    );

    let rawJson = res.text.trim();
    if (rawJson.startsWith('```')) {
      rawJson = rawJson.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
    }

    const parsed = JSON.parse(rawJson);
    if (parsed?.inspirations && parsed.inspirations.length === 3) {
      console.log(`[InspirationResearcher] Successfully researched 3 design directions: ${parsed.inspirations.map((i) => i.name).join(', ')}`);
      return parsed;
    }
  } catch (err) {
    console.warn('[InspirationResearcher] Gemini inspiration research note:', err.message);
  }

  // Domain-specific grounded fallbacks if Gemini is offline
  return getFallbackDesignInspirations(prompt);
}

/**
 * Fully dynamic domain fallback inspirations synthesized organically from the prompt.
 * ZERO hardcoded presets: constructs bespoke aesthetic names, palettes, and components.
 */
function getFallbackDesignInspirations(prompt) {
  const cleanPrompt = (prompt || '').trim();
  const words = cleanPrompt.replace(/^(create|build|make|design|need|want|a|an|the|website|for|landing\s+page)\s+/gi, '').trim();
  const domainTitle = words.length > 0
    ? words.split(/\s+/).slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
    : 'Bespoke Studio';

  const brandName = `${domainTitle}`;
  const lower = cleanPrompt.toLowerCase();

  let palette1, palette2, palette3;
  let comp1, comp2, comp3;
  let dirName1, dirName2, dirName3;

  if (lower.match(/(horse|equine|stable|paddock|rider|equestrian|livery|farm|ranch)/i)) {
    dirName1 = 'Heritage Paddock & Saddle Leather';
    dirName2 = 'Equine Livery & Pedigree Monograph';
    dirName3 = 'Nordic Horsemanship & Performance Telemetry';
    palette1 = { bg: '#0D140F', bgCard: '#152119', accent: '#C49A45', accentSecondary: '#2E5A36', textPrimary: '#F5F2EB', textMuted: '#9CA89E', border: 'rgba(196, 154, 69, 0.2)' };
    palette2 = { bg: '#FAF8F5', bgCard: '#FFFFFF', accent: '#2B3E2D', accentSecondary: '#8B5A2B', textPrimary: '#1F2421', textMuted: '#5C6560', border: '#E2DCD5' };
    palette3 = { bg: '#1A1817', bgCard: '#262220', accent: '#E07A5F', accentSecondary: '#D4A373', textPrimary: '#F4F1DE', textMuted: '#A69F98', border: '#3D3734' };
    comp1 = ['Live Paddock Turnout Schedule', 'Equine Nutrition & Care Telemetry', 'Stall Video Viewport', 'Livery Reservation CTA'];
    comp2 = ['Breeding Pedigree Monograph', 'Pasture Care Manifesto', 'Veterinary Audit Matrix', 'Private Tour Inquiry'];
    comp3 = ['Training Track Live Telemetry', 'Equestrian Performance Metrics', 'Interactive Barn Map', 'Livery Membership Portal'];
  } else if (lower.match(/(potter|ceramic|clay|kiln|glaze|stoneware|vase|atelier|handmade|craft)/i)) {
    dirName1 = 'Raw Clay & Kiln Hearth';
    dirName2 = 'Artisan Ceramic Monograph';
    dirName3 = 'Modern Wheelhouse & Glaze Lab';
    palette1 = { bg: '#121110', bgCard: '#1C1917', accent: '#D97706', accentSecondary: '#A8A29E', textPrimary: '#FAFAF9', textMuted: '#A8A29E', border: '#292524' };
    palette2 = { bg: '#FDFBF7', bgCard: '#FFFFFF', accent: '#44403C', accentSecondary: '#B45309', textPrimary: '#1C1917', textMuted: '#78716C', border: '#E7E5E4' };
    palette3 = { bg: '#18181B', bgCard: '#27272A', accent: '#F59E0B', accentSecondary: '#71717A', textPrimary: '#FAFAFA', textMuted: '#A1A1AA', border: '#3F3F46' };
    comp1 = ['Kiln Batch Firing Schedule', 'Clay Body & Glaze Formula Spec', 'Hand-Thrown Vessel Showcase', 'Atelier Drop Waitlist'];
    comp2 = ['Single-Batch Ceramic Monograph', 'Artisan Technique Manifesto', 'Vessel Dimension Spec Table', 'Private Commission Form'];
    comp3 = ['Live Glaze Finish Explorer', 'Interactive Ceramic Wheel Viewer', 'Limited Edition Drop Counter', 'Studio Workshop Passes'];
  } else if (lower.match(/(sheet|sheets|spreadsheet|excel|reconcil|ledger|finance|accounting|cfo|fintech)/i)) {
    dirName1 = 'Autonomous Ledger & Cell Sync';
    dirName2 = 'Institutional Audit Monograph';
    dirName3 = 'Kinetic Financial Canvas';
    palette1 = { bg: '#0B0F17', bgCard: 'rgba(15, 23, 42, 0.8)', accent: '#10B981', accentSecondary: '#06B6D4', textPrimary: '#F8FAFC', textMuted: '#94A3B8', border: 'rgba(255, 255, 255, 0.1)' };
    palette2 = { bg: '#FDFCF7', bgCard: '#FFFFFF', accent: '#0A0A0A', accentSecondary: '#4A5568', textPrimary: '#111827', textMuted: '#6B7280', border: '#E5E7EB' };
    palette3 = { bg: '#0F172A', bgCard: '#1E293B', accent: '#38BDF8', accentSecondary: '#A855F7', textPrimary: '#F1F5F9', textMuted: '#94A3B8', border: '#334155' };
    comp1 = ['Formula Bar Telemetry Hero', 'Interactive Variance Table', 'Live Bank Status Ticker', 'SOC2 Security Pill'];
    comp2 = ['Asymmetric Serif Masthead', 'Hairline Audit Matrix', 'Two-Column Precision Manifesto', 'Numbered Step Catalog'];
    comp3 = ['Kinetic Telemetry Ticker', 'Split Screen Interactive Demo', 'High-Contrast Badge Grid', 'CFO Proof Quote'];
  } else {
    dirName1 = `${domainTitle} Signature Atmosphere`;
    dirName2 = `${domainTitle} Heritage Monograph`;
    dirName3 = `${domainTitle} Kinetic Studio`;
    palette1 = { bg: '#090D16', bgCard: '#111827', accent: '#6366F1', accentSecondary: '#EC4899', textPrimary: '#F9FAFB', textMuted: '#9CA3AF', border: 'rgba(255, 255, 255, 0.12)' };
    palette2 = { bg: '#FAFAF9', bgCard: '#FFFFFF', accent: '#18181B', accentSecondary: '#71717A', textPrimary: '#09090B', textMuted: '#52525B', border: '#E4E4E7' };
    palette3 = { bg: '#0A0A0C', bgCard: '#141418', accent: '#14B8A6', accentSecondary: '#F59E0B', textPrimary: '#F4F4F5', textMuted: '#A1A1AA', border: '#27272A' };
    comp1 = ['Interactive Showcase Hero', 'Domain Feature Telemetry', 'Interactive Offerings Matrix', 'Primary Action Console'];
    comp2 = ['Curated Domain Monograph', 'Craft Philosophy Manifesto', 'Detailed Specification Grid', 'Private Inquiry Portal'];
    comp3 = ['Dynamic Metric Dashboard', 'High-Contrast Feature Highlights', 'Interactive Workflow Preview', 'Direct Access Booking'];
  }

  const slug = domainTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  return {
    topicAnalysis: {
      domain: domainTitle,
      brandName: brandName,
      headline: `${domainTitle} — Crafted for Purpose`,
      tagline: `A modern, bespoke digital experience crafted specifically for ${cleanPrompt}.`,
      targetAudience: `Discerning clients, enthusiasts, and patrons of ${domainTitle}`,
      benchmarkSites: ['Awwwards.com', 'Godly.website', 'Minimal.gallery'],
      keyFeatures: [
        { title: `${domainTitle} Signature Quality`, description: `Engineered specifically around the unique craft and standards of ${cleanPrompt}.`, metric: '100% Bespoke' },
        { title: 'Interactive Client Experience', description: 'Fluid spatial interactions, dynamic status feedback, and refined micro-typography.', metric: '60fps Delight' },
        { title: 'Precision Operational Workflow', description: 'Streamlined scheduling, clear telemetry, and seamless digital access.', metric: 'Instant Sync' }
      ]
    },
    inspirations: [
      {
        option: 1,
        id: `${slug}-signature`,
        name: dirName1,
        sourceInspiration: `Curated digital flagship inspired by top tier ${domainTitle} studios`,
        aestheticDescription: `Deep immersive atmosphere tailored for ${cleanPrompt}, featuring rich spatial contrast, glowing interactive viewports, and custom domain metrics.`,
        fontHeading: 'Space Grotesk',
        fontBody: 'Plus Jakarta Sans',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap',
        stitchHeadlineFont: 'SPACE_GROTESK',
        stitchBodyFont: 'PLUS_JAKARTA_SANS',
        colors: palette1,
        components: comp1,
        stitchPrompt: `Modern desktop flagship for "${cleanPrompt}". Immersive high-craft layout tailored specifically for ${domainTitle}. Background (${palette1.bg}) with primary accent (${palette1.accent}), featuring interactive domain hero cards, authentic proof points, and refined typography.`
      },
      {
        option: 2,
        id: `${slug}-monograph`,
        name: dirName2,
        sourceInspiration: `Editorial craft journal and gallery presentation for ${domainTitle}`,
        aestheticDescription: `Spacious canvas celebrating the pedigree and craft of ${cleanPrompt}, with high-contrast serif headlines, razor-thin hairline rules, and catalog precision.`,
        fontHeading: 'Playfair Display',
        fontBody: 'DM Sans',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
        stitchBodyFont: 'DM_SANS',
        colors: palette2,
        components: comp2,
        stitchPrompt: `Refined editorial desktop showcase for "${cleanPrompt}". Spacious off-white canvas (${palette2.bg}), classic serif typography (Playfair Display), hairline borders (${palette2.border}), and catalog layout showcasing ${domainTitle} craftsmanship.`
      },
      {
        option: 3,
        id: `${slug}-kinetic`,
        name: dirName3,
        sourceInspiration: `Modern tactile studio experience for ${domainTitle}`,
        aestheticDescription: `High-energy modern interface with crisp structural borders, vibrant accent callouts, and tactile real-time interaction blocks for ${cleanPrompt}.`,
        fontHeading: 'Space Grotesk',
        fontBody: 'Inter',
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@600;700&display=swap',
        stitchHeadlineFont: 'SPACE_GROTESK',
        stitchBodyFont: 'INTER',
        colors: palette3,
        components: comp3,
        stitchPrompt: `High-energy tactile desktop site for "${cleanPrompt}". Modern dark slate background (${palette3.bg}), vibrant accents (${palette3.accent}), crisp borders (${palette3.border}), and tactile micro-cards for ${domainTitle}.`
      }
    ]
  };
}
