import { geminiClient } from '../gemini-client.js';
import {
  RULES, assemblePage, bodyOf, componentGuide, photosIn, pickPhotos, resolveSystem, stripFences, systemOf,
} from './designSystem.js';

// The model writes only the page's <body>; the head (fonts, colour tokens, base CSS) and the script come from the
// design system, so every page starts from professional foundations and keeps them through changes.

function briefText(topicAnalysis = {}, prompt = '') {
  const t = topicAnalysis;
  const list = (xs, f) => (Array.isArray(xs) ? xs : []).map(f).filter(Boolean).join('\n');
  return [
    `Request: ${prompt}`,
    `Brand: ${t.brandName || ''}`,
    t.headline && `Hero headline (use it, or improve it if you can say it better): ${t.headline}`,
    t.tagline && `Supporting line: ${t.tagline}`,
    t.domain && `Business: ${t.domain}`,
    t.targetAudience && `Customers: ${t.targetAudience}`,
    t.location && `Location: ${t.location}`,
    t.currency && `Currency: ${t.currency}`,
    t.voice && `Voice: ${t.voice}`,
    Array.isArray(t.offerings) && t.offerings.length && `What they offer:\n${list(t.offerings, (o) => o && `- ${o.name}${o.price ? ` (${o.price})` : ''}: ${o.description || ''}`)}`,
    Array.isArray(t.keyFeatures) && t.keyFeatures.length && `Why choose them:\n${list(t.keyFeatures, (f) => f && `- ${f.title}: ${f.description}${f.metric ? ` [${f.metric}]` : ''}`)}`,
    Array.isArray(t.facts) && t.facts.length && `Practical details:\n${list(t.facts, (f) => f && `- ${typeof f === 'string' ? f : JSON.stringify(f)}`)}`,
  ].filter(Boolean).join('\n');
}

function photoText(photos) {
  if (!photos.length) return 'PHOTOS: none for this business. Design with typography, rules and colour; no <img> tags.';
  return 'PHOTOS (the only images you may use; the first is the hero):\n' +
    photos.map((p, i) => `${i + 1}. <img src="${p.url}" alt="${p.alt}">`).join('\n');
}

const OUTPUT = 'Return ONLY the HTML that goes inside <body>: start with the <header class="site-header"> and end with the closing ' +
  '</footer>. No <html>, <head>, <style> or <script> tags, no markdown fences, no explanations.';

/**
 * The home page for one design direction.
 * @returns {Promise<string>} Full HTML document string
 */
export async function generateBespokeHtml({ prompt, topicAnalysis, inspiration }) {
  const brandName = topicAnalysis?.brandName || 'Studio';
  const system = resolveSystem(inspiration || {});
  const photos = pickPhotos(inspiration?.photoTags || [], 6, brandName);
  const pages = Array.isArray(inspiration?.navPages) ? inspiration.navPages : [];
  const systemPrompt = `You are a senior web designer at an independent studio known for sites that look hand-made by people with taste:
think Pentagram, Collins, Locomotive, the best small-business sites on Siteinspire and Minimal Gallery. You are building the home page.

THE BRIEF
${briefText(topicAnalysis, prompt)}

DESIGN DIRECTION: "${inspiration?.name || ''}". ${inspiration?.aestheticDescription || ''}
References: ${inspiration?.sourceInspiration || ''}
Type: ${system.type.heading} for headings, ${system.type.body} for text. Palette: ${system.palette.mood}${system.palette.dark ? ' (dark)' : ''}.

LAYOUT "${system.layoutId}", section by section (adapt the details to the business, keep the structure):
${system.layout.grammar.map((g) => `- ${g}`).join('\n')}
${pages.length ? `Navigation links: ${pages.map((p) => `${p.title} -> ${p.file}`).join(', ')}.` : 'Navigation links: anchors to the sections on this page (#about, #menu ...), 3-5 of them.'}

${componentGuide(system)}

${RULES}

${photoText(photos)}

${OUTPUT}`;

  try {
    console.log(`[BespokeHtmlGenerator] Designing "${brandName}" (${system.typeId}/${system.paletteId}/${system.layoutId})...`);
    const res = await geminiClient.generateContent(
      `Design and write the complete home page for "${brandName}". ${OUTPUT}`,
      systemPrompt,
      { temperature: 0.7 }
    );
    const body = bodyOf(stripFences(res.text));
    if (/<header\b/i.test(body) && body.length > 1500) {
      const html = assemblePage({ body, system, brandName, title: `${brandName}${topicAnalysis?.tagline ? ` | ${topicAnalysis.tagline}` : ''}`,
        description: topicAnalysis?.tagline || topicAnalysis?.headline || '', photos });
      console.log(`[BespokeHtmlGenerator] Home page ready (${html.length} bytes).`);
      return html;
    }
    console.warn('[BespokeHtmlGenerator] The reply was not a page body.');
  } catch (err) {
    console.warn(`[BespokeHtmlGenerator] Generation notice: ${err.message}.`);
  }
  return '';
}

/**
 * Another page of a site this system built, in the same design (same head, header, footer and photos).
 * @returns {Promise<string>} Full HTML document string, or '' when the reply wasn't a page
 */
export async function generateExtraPage({ indexHtml, page, navList, prompt, topicAnalysis = {} }) {
  const system = systemOf(indexHtml) || resolveSystem({});
  const photos = photosIn(indexHtml);
  const home = bodyOf(indexHtml).replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const header = (home.match(/<header\b[\s\S]*?<\/header>/i) || [''])[0];
  const footer = (home.match(/<footer\b[\s\S]*?<\/footer>/i) || [''])[0];
  const brandName = topicAnalysis.brandName || '';
  const systemPrompt = `You are the senior web designer who designed this website's home page, now designing its "${page.title}" page.
Purpose of the page: ${page.purpose}

THE BRIEF
${briefText(topicAnalysis, prompt)}

The site's pages (link to them with exactly these file names):
${navList}

Reuse the header and footer below exactly, only updating the nav links to list every page above. Between them, design this page with
real, specific content for its purpose: a page title section (an .eyebrow, an h1 and a short .lead, left-aligned), then 3-5 sections
in the same visual language as the home page (the same classes, spacing and rhythm), and a closing call to action.

HEADER:
${header}

FOOTER:
${footer}

HOME PAGE BODY, for visual reference (do not copy its sections):
${home.slice(0, 9000)}

${componentGuide(system)}

${RULES}

${photoText(photos)}

${OUTPUT}`;
  const res = await geminiClient.generateContent(
    `Design and write the "${page.title}" page (${page.file}). ${OUTPUT}`, systemPrompt, { temperature: 0.7 });
  const body = bodyOf(stripFences(res.text));
  if (!/<header\b/i.test(body) || body.length < 800) return '';
  return assemblePage({ body, system, brandName, title: `${page.title} | ${brandName}`, description: page.purpose, photos });
}

/**
 * A requested change to the home page. Pages this system built keep their design system (the model may switch
 * the palette, type or photos on request); older pages are rewritten whole, as before.
 * @returns {Promise<string>} The updated HTML (the current HTML if the change failed)
 */
export async function redesignBespokeHtml({ currentHtml, feedbackText, brandName = 'Website' }) {
  const current = systemOf(currentHtml);
  if (!current) return legacyRedesign({ currentHtml, feedbackText });
  const { PALETTES, TYPE_PAIRS, PHOTO_TAGS } = await import('./designSystem.js');
  const body = bodyOf(currentHtml).replace(/<script\b[\s\S]*?<\/script>/gi, '');
  const systemPrompt = `You are the senior web designer of this website. The owner asked for this change:
"${feedbackText}"

Apply exactly what they asked, keep everything else as it is, and keep the quality bar of a professional studio.
If (and only if) the change needs a different colour scheme, typography or photos, put ONE line before the HTML:
<!-- design: palette=<id> type=<id> photos=<tag>,<tag> --> (include only the parts that change)
Palettes: ${Object.entries(PALETTES).map(([id, p]) => `${id} (${p.mood}${p.dark ? ', dark' : ''})`).join('; ')}
Type pairs: ${Object.entries(TYPE_PAIRS).map(([id, t]) => `${id} (${t.heading} + ${t.body})`).join('; ')}
Photo subjects: ${PHOTO_TAGS.join(', ')}
Current design: palette=${current.paletteId}, type=${current.typeId}.

${componentGuide(current)}

${RULES}

${OUTPUT} (The design comment line, if any, comes first.)`;
  try {
    const res = await geminiClient.generateContent(
      `Current page body:\n\n${body.slice(0, 60000)}\n\nChange requested: "${feedbackText}". Return the full updated body.`,
      systemPrompt, { temperature: 0.4 });
    const text = stripFences(res.text);
    const directive = (text.match(/<!--\s*design:([^>]*)-->/i) || [])[1] || '';
    const get = (k) => (directive.match(new RegExp(`${k}=([\\w,-]+)`)) || [])[1];
    const system = resolveSystem({ typePair: get('type') || current.typeId, palette: get('palette') || current.paletteId, layout: current.layoutId });
    const tags = get('photos');
    const photos = tags ? pickPhotos(tags.split(','), 6, brandName) : photosIn(currentHtml);
    const newBody = bodyOf(text.replace(/<!--\s*design:[^>]*-->/i, ''));
    if (!/<header\b/i.test(newBody) || newBody.length < 1000) return currentHtml;
    const title = (currentHtml.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || brandName;
    const description = (currentHtml.match(/<meta name="description" content="([^"]*)"/i) || [])[1] || '';
    return assemblePage({ body: newBody, system, brandName, title: title.replace(/&amp;/g, '&'), description, photos });
  } catch (err) {
    console.warn('[BespokeHtmlGenerator] Redesign notice:', err.message);
    return currentHtml;
  }
}

async function legacyRedesign({ currentHtml, feedbackText }) {
  const systemPrompt = `You are a senior web designer. The owner of this website asked for this change:
"${feedbackText}"
Apply it to the page, keep everything else, keep Tailwind CSS and the responsive structure.

${RULES}

Return ONLY the updated HTML document from <!DOCTYPE html> to </html>, no markdown fences.`;
  try {
    const res = await geminiClient.generateContent(
      `Current HTML:\n\n${currentHtml.slice(0, 60000)}\n\nChange requested: "${feedbackText}". Return the full updated HTML.`, systemPrompt);
    const html = stripFences(res.text);
    if (html.includes('<html') && html.includes('</html>')) return html;
  } catch (err) {
    console.warn('[BespokeHtmlGenerator] Redesign notice:', err.message);
  }
  return currentHtml;
}
