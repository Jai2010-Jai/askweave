import { geminiClient } from '../gemini-client.js';

/**
 * Generates a completely bespoke, award-winning single-page HTML website via Gemini
 * inspired directly by researched Dribbble & Minimal Gallery design patterns.
 *
 * @param {object} params
 * @param {string} params.prompt
 * @param {object} params.topicAnalysis
 * @param {object} params.inspiration
 * @returns {Promise<string>} Full HTML document string
 */
export async function generateBespokeHtml({ prompt, topicAnalysis, inspiration }) {
  const brandName = topicAnalysis?.brandName || 'Signature';
  const headline = topicAnalysis?.headline || prompt;
  const tagline = topicAnalysis?.tagline || '';
  const features = topicAnalysis?.keyFeatures || [];
  const colors = inspiration.colors || {};
  const fontHeading = inspiration.fontHeading || 'Space Grotesk';
  const fontBody = inspiration.fontBody || 'Plus Jakarta Sans';
  const googleFontsUrl = inspiration.googleFontsUrl || 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap';

  const systemPrompt = `You are a Legendary Creative Technologist & Senior Frontend Architect known for crafting award-winning sites featured on Awwwards, Dribbble, Minimal Gallery (minimal.gallery), and Godly.website.

Your task is to write a COMPLETE, BEAUTIFUL, PRODUCTION-GRADE single-file HTML website for:
Brand Name: "${brandName}"
Topic/Purpose: "${prompt}"
Headline: "${headline}"
Tagline: "${tagline}"

Aesthetic & Inspiration Specification:
- Design Source: ${inspiration.sourceInspiration}
- Aesthetic Direction: ${inspiration.name} - ${inspiration.aestheticDescription}
- Primary Background: ${colors.bg || '#0B0F17'}
- Card Background: ${colors.bgCard || 'rgba(15, 23, 42, 0.8)'}
- Brand Accent: ${colors.accent || '#10B981'}
- Secondary Accent: ${colors.accentSecondary || '#06B6D4'}
- Text Primary: ${colors.textPrimary || '#F8FAFC'}
- Text Muted: ${colors.textMuted || '#94A3B8'}
- Border Color: ${colors.border || 'rgba(255, 255, 255, 0.1)'}
- Heading Font: "${fontHeading}"
- Body Font: "${fontBody}"
- Google Fonts Link: "${googleFontsUrl}"
- Core Domain Components to construct: ${inspiration.components ? inspiration.components.join(', ') : 'Hero viewport, feature telemetry, interactive matrix'}

Key Domain Features & Metrics to represent:
${features.map((f) => `- ${f.title} (${f.metric || 'Real-time'}): ${f.description}`).join('\n')}

STRICT DESIGN RULES:
1. NO COOKIE-CUTTER AI SLOP: This is NOT a generic developer portfolio. It is an authentic, domain-tailored website reflecting the exact craft, tool, or business requested.
2. Embed Tailwind CSS via CDN: <script src="https://cdn.tailwindcss.com"></script>
3. Configure Tailwind inline in <script> tailwind.config = { ... } to define custom font families and colors matching the tokens above.
4. Include rich, realistic UI elements (e.g. live interactive spreadsheet formula bar, data variance reconciliation tables, status badges, SVG iconography, smooth pill tags).
5. Add interactive micro-interactions (e.g. tabs that switch views, interactive calculation toggles, copy-to-clipboard, or hover scale effects).
6. Fully responsive across mobile and desktop.
7. Return ONLY valid HTML starting with <!DOCTYPE html> and closing with </html>. Do not include markdown code fences or conversational text.`;

  try {
    console.log(`[BespokeHtmlGenerator] Generating bespoke HTML for "${inspiration.name}" via Gemini...`);
    const res = await geminiClient.generateContent(
      `Generate the complete bespoke HTML website for "${brandName}" based on "${inspiration.sourceInspiration}". Return ONLY the raw HTML code.`,
      systemPrompt
    );

    let html = res.text.trim();
    if (html.includes('```html')) {
      html = html.replace(/^[\s\S]*?```html\s*/i, '').replace(/\s*```[\s\S]*$/i, '');
    } else if (html.startsWith('```')) {
      html = html.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '');
    }

    if (html.includes('<html') && html.includes('</html>')) {
      console.log(`[BespokeHtmlGenerator] Successfully generated ${html.length} bytes of bespoke HTML.`);
      return html;
    }
  } catch (err) {
    console.warn(`[BespokeHtmlGenerator] Gemini generation notice: ${err.message}. Building dynamic fallback.`);
  }

  // Robust dynamic fallback incorporating the exact researched tokens
  return buildDynamicBespokeFallback({ brandName, headline, tagline, features, inspiration, colors, fontHeading, fontBody, googleFontsUrl });
}

/**
 * Redesigns and rethinks an existing website HTML page based on user conversational feedback.
 *
 * @param {object} params
 * @param {string} params.currentHtml - The current website HTML
 * @param {string} params.feedbackText - The user's feedback/request
 * @param {string} params.brandName
 * @returns {Promise<string>} The updated bespoke HTML
 */
export async function redesignBespokeHtml({ currentHtml, feedbackText, brandName = 'Website' }) {
  const systemPrompt = `You are a World-Class Creative Technologist.
The user provided the following design critique and request to rethink and redesign their website:
"${feedbackText}"

Your task is to take the existing HTML code, rethink the design architecture, and rewrite/modify it to directly satisfy the user's request.
- If the user asked for darker, minimal, Dribbble, or Minimal Gallery style, radically transform the palette, layout, and typography accordingly.
- If the user requested new sections (e.g. pricing, live demo, testimonials, formula bar), build high-craft interactive components for them.
- Preserve Tailwind CSS, responsive structure, and functional interactive JavaScript.
- Return ONLY the updated raw HTML document starting with <!DOCTYPE html> and ending with </html>. Do not include markdown code fences or explanatory text.`;

  try {
    console.log(`[BespokeHtmlGenerator] Redesigning website via Gemini based on feedback: "${feedbackText.slice(0, 40)}..."`);
    const res = await geminiClient.generateContent(
      `Here is the current HTML code:\n\n${currentHtml.slice(0, 8000)}\n\nUSER REQUEST: "${feedbackText}". Rewrite the entire HTML page to execute this redesign. Return ONLY the HTML code.`,
      systemPrompt
    );

    let html = res.text.trim();
    if (html.includes('```html')) {
      html = html.replace(/^[\s\S]*?```html\s*/i, '').replace(/\s*```[\s\S]*$/i, '');
    } else if (html.startsWith('```')) {
      html = html.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '');
    }

    if (html.includes('<html') && html.includes('</html>')) {
      console.log(`[BespokeHtmlGenerator] Redesign succeeded (${html.length} bytes).`);
      return html;
    }
  } catch (err) {
    console.warn('[BespokeHtmlGenerator] Redesign fallback notice:', err.message);
  }

  return currentHtml;
}

/**
 * Dynamic fallback constructor that assembles real domain components using researched tokens.
 */
function buildDynamicBespokeFallback({ brandName, headline, tagline, features, inspiration, colors, fontHeading, fontBody, googleFontsUrl }) {
  const isDark = (colors.bg || '').startsWith('#0') || (colors.bg || '').startsWith('#1');

  return `<!DOCTYPE html>
<html lang="en" class="${isDark ? 'dark' : ''}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${brandName} — ${headline}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${googleFontsUrl}" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            heading: ['"${fontHeading}"', 'sans-serif'],
            body: ['"${fontBody}"', 'sans-serif'],
          },
          colors: {
            brand: {
              bg: '${colors.bg || '#0B0F17'}',
              card: '${colors.bgCard || '#1E293B'}',
              accent: '${colors.accent || '#10B981'}',
              secondary: '${colors.accentSecondary || '#06B6D4'}',
              primaryText: '${colors.textPrimary || '#F8FAFC'}',
              mutedText: '${colors.textMuted || '#94A3B8'}',
              border: '${colors.border || 'rgba(255, 255, 255, 0.1)'}',
            }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: "${fontBody}", sans-serif; background-color: ${colors.bg}; color: ${colors.textPrimary}; }
    h1, h2, h3, h4 { font-family: "${fontHeading}", sans-serif; }
    .glass-card { background: ${colors.bgCard}; border: 1px solid ${colors.border}; backdrop-filter: blur(12px); }
  </style>
</head>
<body class="min-h-screen antialiased selection:bg-brand-accent selection:text-black">
  <!-- Nav -->
  <header class="sticky top-0 z-50 glass-card border-b border-brand-border">
    <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-black" style="background: ${colors.accent};">⚡</span>
        <span class="font-heading font-bold text-lg tracking-tight" style="color: ${colors.textPrimary};">${brandName}</span>
      </div>
      <div class="flex items-center gap-4">
        <span class="text-xs px-2.5 py-1 rounded-full font-semibold" style="background: rgba(255,255,255,0.08); color: ${colors.accent}; border: 1px solid ${colors.border};">
          ${inspiration.sourceInspiration || 'Award-Winning UI'}
        </span>
        <a href="#demo" class="px-4 py-2 rounded-lg text-sm font-semibold transition hover:opacity-90" style="background: ${colors.accent}; color: ${isDark ? '#000' : '#fff'};">
          Get Started
        </a>
      </div>
    </div>
  </header>

  <!-- Hero Section -->
  <main class="max-w-6xl mx-auto px-6 pt-20 pb-24">
    <div class="text-center max-w-3xl mx-auto mb-16">
      <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-6" style="background: rgba(255,255,255,0.06); border: 1px solid ${colors.border}; color: ${colors.accent};">
        <span>●</span> ${inspiration.name}
      </div>
      <h1 class="font-heading text-4xl sm:text-6xl font-bold tracking-tight leading-tight mb-6" style="color: ${colors.textPrimary};">
        ${headline}
      </h1>
      <p class="text-lg sm:text-xl leading-relaxed mb-8" style="color: ${colors.textMuted};">
        ${tagline}
      </p>
      <div class="flex flex-wrap items-center justify-center gap-4">
        <button class="px-6 py-3.5 rounded-xl font-bold transition-all shadow-lg hover:scale-105" style="background: ${colors.accent}; color: ${isDark ? '#000' : '#fff'};">
          Explore Platform
        </button>
        <button class="px-6 py-3.5 rounded-xl font-bold transition glass-card hover:bg-white/10" style="color: ${colors.textPrimary};">
          View Interactive Demo
        </button>
      </div>
    </div>

    <!-- Interactive Component Hero Viewport -->
    <div id="demo" class="glass-card rounded-2xl p-6 sm:p-8 mb-20 shadow-2xl relative overflow-hidden" style="border: 1px solid ${colors.border};">
      <div class="flex items-center justify-between pb-6 mb-6 border-b border-brand-border">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-red-500/80"></div>
          <div class="w-3 h-3 rounded-full bg-yellow-500/80"></div>
          <div class="w-3 h-3 rounded-full bg-green-500/80"></div>
          <span class="text-xs font-mono ml-2" style="color: ${colors.textMuted};">${brandName} // Interactive Workspace</span>
        </div>
        <div class="flex items-center gap-2 text-xs font-mono px-3 py-1 rounded-md" style="background: rgba(255,255,255,0.05); color: ${colors.accent};">
          <span>LIVE ENGINE</span>
        </div>
      </div>

      <!-- Feature Grid -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        ${features.map((f, i) => `
        <div class="p-5 rounded-xl transition hover:border-brand-accent/50" style="background: rgba(255,255,255,0.02); border: 1px solid ${colors.border};">
          <div class="text-xs font-mono font-bold mb-2 uppercase" style="color: ${colors.accent};">
            ${f.metric || `0${i + 1} // REAL-TIME`}
          </div>
          <h3 class="font-heading text-lg font-bold mb-2" style="color: ${colors.textPrimary};">${f.title}</h3>
          <p class="text-sm leading-relaxed" style="color: ${colors.textMuted};">${f.description}</p>
        </div>`).join('')}
      </div>
    </div>

    <!-- Craft Pillars -->
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-20">
      ${(inspiration.components || ['Telemetry Matrix', 'Sub-second Sync', 'SOC2 Certified', 'Live Engine']).map((comp, i) => `
      <div class="p-4 rounded-xl flex items-center gap-3 glass-card">
        <span class="w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold font-mono" style="background: ${colors.accent}; color: ${isDark ? '#000' : '#fff'};">${i + 1}</span>
        <span class="text-sm font-semibold" style="color: ${colors.textPrimary};">${comp}</span>
      </div>`).join('')}
    </div>
  </main>

  <!-- Footer -->
  <footer class="border-t border-brand-border py-12 glass-card">
    <div class="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
      <div class="flex items-center gap-2">
        <span class="font-heading font-bold" style="color: ${colors.textPrimary};">${brandName}</span>
        <span class="text-xs" style="color: ${colors.textMuted};">— Designed with Google Stitch MCP & Gemini</span>
      </div>
      <div class="text-xs" style="color: ${colors.textMuted};">
        Inspired by ${inspiration.sourceInspiration}
      </div>
    </div>
  </footer>
</body>
</html>`;
}
