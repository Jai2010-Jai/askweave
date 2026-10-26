import { execFile } from 'child_process';
import util from 'util';
import { geminiClient } from '../gemini-client.js';
import { buildPortfolioData } from './portfolioTemplates.js';

const execFileAsync = util.promisify(execFile);

/**
 * Builds domain-specific fallback website content based on prompt keywords.
 * Guarantees that even if all LLM endpoints are unreachable, the user NEVER gets
 * cookie-cutter developer portfolio copy ("Alex Chen") for business, craft, or spreadsheet prompts.
 */
export function buildDomainPortfolioData(cleanPrompt, custom = {}) {
  const lower = (cleanPrompt || '').toLowerCase();

  // 1. Google Sheets / Spreadsheets / Financial Reconciliation / FinTech / Invoicing
  if (lower.match(/(sheet|sheets|google\s*sheet|spreadsheet|excel|reconcil|bookkeep|invoic|ledger|finance|fintech|accounting|cfo|payroll)/i)) {
    return {
      name: custom.name || 'LedgerSync',
      role: 'Autonomous Financial Reconciliation for Google Sheets',
      headline: 'Reconcile thousands of transactions in Google Sheets in seconds.',
      tagline: 'Connect bank feeds directly to your spreadsheets, eliminate manual data entry, and close your books 10x faster with AI-matched entries and formula-free reconciliation.',
      statusBadge: '📊 Google Workspace Verified // SOC2 Compliant',
      categoryBadge: 'FINANCIAL PRODUCTIVITY & SHEETS ADD-ON',
      ctaPrimary: 'Install Sheets Add-on',
      ctaSecondary: 'View Live Demo Sheet',
      manifestoTitle: 'Spreadsheet Precision, Zero Busywork',
      philosophy: 'Financial teams should not spend weekends doing manual VLOOKUPs across banking statements. We transform Google Sheets into an autonomous, audit-ready reconciliation engine.',
      headerTag: 'GOOGLE WORKSPACE // SOC2 TYPE II',
      stats: [
        { label: 'Auto-Match Rate', value: '99.4%' },
        { label: 'Hours Saved Monthly', value: '24 hrs' },
        { label: 'Volume Reconciled', value: '$2.8B+' },
        { label: 'Active Finance Teams', value: '3,400+' },
      ],
      projects: [
        {
          title: 'Automated 3-Way Bank Reconciliation',
          category: 'Core Automation',
          description: 'Instantly cross-matches bank feeds, stripe payouts, and internal invoices with fuzzy date and reference tolerance.',
          tags: ['Zero Formulas', 'Audit Log', 'Stripe & Plaid'],
        },
        {
          title: 'Multi-Currency Real-Time Exchange',
          category: 'Currency Engine',
          description: 'Pulls live ECB & central bank spot rates into Sheets to automatically adjust FX gains and losses.',
          tags: ['160+ Currencies', 'Historical Rates', 'GAAP Compliant'],
        },
        {
          title: 'One-Click Month-End Close Package',
          category: 'Audit & Reporting',
          description: 'Generates locked trial balance tabs, variance summaries, and CFO-ready executive presentation sheets.',
          tags: ['Variance Analysis', 'Version Snapshot', 'ERP Export'],
        },
      ],
      skills: [
        'Google Workspace Add-on',
        'Plaid Bank Feeds',
        'Stripe & PayPal Sync',
        'QuickBooks & Xero Export',
        'SOC2 Type II Certified',
        '256-bit AES Encryption',
      ],
      email: 'team@ledgersync.app',
      github: 'https://github.com/ledgersync',
      twitter: 'https://twitter.com/ledgersync',
      prompt: cleanPrompt,
    };
  }

  // 2. Pottery / Ceramics / Craft Atelier / Japanese Art / Handmade
  if (lower.match(/(potter|ceramic|clay|kiln|glaze|stoneware|vase|atelier|handmade|craft|wabi|artisan|japan|kyoto)/i)) {
    return {
      name: custom.name || 'Komorebi Clay Atelier',
      role: 'Hand-Thrown Functional Stoneware & Ceramic Artistry',
      headline: 'Formed by Earth, Fire, and Generational Craft.',
      tagline: 'Small-batch reduction-fired ceramics crafted in Kyoto. Every cup, vase, and vessel celebrates natural imperfections, tactile minerals, and mindful everyday rituals.',
      statusBadge: '🏺 Kiln Fired Daily // Batch #48 Available',
      categoryBadge: 'CERAMIC ATELIER & POTTERY STUDIO',
      ctaPrimary: 'Explore Vessels',
      ctaSecondary: 'Book Wheel Workshop',
      manifestoTitle: 'The Beauty of Imperfection',
      philosophy: 'We harvest local clays and hand-mix wood-ash glazes. Every piece undergoes a 36-hour wood kiln firing, resulting in unique scorched blush and atmospheric glaze textures.',
      headerTag: 'KYOTO ATELIER // EST. 1984',
      stats: [
        { label: 'Wood-Kiln Temperature', value: '1,280°C' },
        { label: 'Handmade Batches', value: '48 Lots' },
        { label: 'Permanent Collections', value: '14 Galleries' },
        { label: 'Workshop Alumni', value: '1,200+' },
      ],
      projects: [
        {
          title: 'Tenmoku Tea Bowl (Chawan)',
          category: 'Ceremonial Vessels',
          description: 'Iron-rich stoneware featuring natural oil-spot iridescent glaze, balanced for formal matcha tea ceremonies.',
          tags: ['Wood-Fired', 'Iron Glaze', 'Unique One-Off'],
        },
        {
          title: 'Asuka Minimalist Pour-Over Dripper',
          category: 'Functional Tableware',
          description: 'Slow-draining fluted ceramic coffee dripper engineered for thermal retention and clean extraction.',
          tags: ['Food-Safe Glaze', 'Daily Craft', 'Dishwasher Safe'],
        },
        {
          title: 'Moon Jar Sculptural Vessel',
          category: 'Monograph Collection',
          description: 'Voluminous thrown white porcelain jar, unglazed matte exterior with gentle wood-smoke blushing.',
          tags: ['Gallery Monograph', 'Sculptural', 'Signed & Boxed'],
        },
      ],
      skills: [
        'Wheel Throwing',
        'Wood Kiln Reduction',
        'Natural Ash Glazes',
        'Kintsugi Repair',
        'Custom Restaurant Commissions',
        'Private Studio Workshops',
      ],
      email: 'studio@komorebiclay.jp',
      github: 'https://instagram.com/komorebiclay',
      twitter: 'https://twitter.com/komorebiclay',
      prompt: cleanPrompt,
    };
  }

  // 3. Animals / Dog Shelter / Pet Rescue / Sanctuary
  if (lower.match(/(dog|shelter|rescue|animal|cat|pet|pup|puppy|adopt|canine|sanctuary)/i)) {
    return {
      name: custom.name || 'Paws & Hope Sanctuary',
      role: 'Rescue, Rehabilitation & Forever Adoptions',
      headline: 'Giving Every Rescued Dog A Loving Second Chance.',
      tagline: 'Dedicated to rescuing abandoned pups, providing compassionate veterinary care, and connecting loving families with their new best friends.',
      statusBadge: '🐾 14 Dogs Ready For Adoption',
      categoryBadge: 'ANIMAL RESCUE & NO-KILL SANCTUARY',
      ctaPrimary: 'Meet Adoptable Dogs',
      ctaSecondary: 'Donate & Foster',
      manifestoTitle: 'Compassion In Action',
      philosophy: 'Every rescue deserves safety, medical care, and unconditional love. We operate as a 100% no-kill rescue dedicated to ensuring no animal is left behind.',
      headerTag: 'NO-KILL SANCTUARY // 2026',
      stats: [
        { label: 'Dogs Rescued', value: '520+' },
        { label: 'Happy Adoptions', value: '470+' },
        { label: 'No-Kill Rate', value: '100%' },
        { label: 'Active Fosters', value: '65+' },
      ],
      projects: [
        {
          title: 'Milo (Golden Retriever Mix)',
          category: 'Ready For Adoption',
          description: 'Energetic 2-year-old cuddle bug who loves outdoor fetch, leash-trained and fully vaccinated.',
          tags: ['Friendly', 'House-Trained', 'Vaccinated'],
        },
        {
          title: 'Bella (Gentle Shepherd)',
          category: 'Ready For Adoption',
          description: 'Calm and affectionate 3-year-old companion, wonderful with young children and other household pets.',
          tags: ['Family-Friendly', 'Gentle', 'Spayed'],
        },
        {
          title: 'Rocky & Luna (Bonded Pair)',
          category: 'Foster or Adopt',
          description: 'Sweet, inseparable sibling pair looking for a cozy home with a warm yard to explore together.',
          tags: ['Bonded Pair', 'Quiet', 'Loving'],
        },
      ],
      skills: [
        'Pet Adoption',
        'Foster Network',
        'Emergency Vet Care',
        'Weekend Adoption Drives',
        'Puppy Socialization',
        'Community Outreach',
      ],
      email: 'adopt@pawsandhope.org',
      github: 'https://instagram.com/pawsandhope',
      twitter: 'https://twitter.com/pawsandhope',
      prompt: cleanPrompt,
    };
  }

  // 4. Coffee / Roastery / Cafe / Bakery / Dining
  if (lower.match(/(cafe|coffee|bakery|bake|restaurant|bistro|dining|roaster|espresso|pastry)/i)) {
    return {
      name: custom.name || 'Komorebi Coffee Roasters',
      role: 'Specialty Direct-Trade Roastery & Artisanal Bakery',
      headline: 'Mindful Sourcing. Precision Roasting. Neighborhood Gathering.',
      tagline: 'Single-origin specialty coffees roasted in small drum batches, paired with slow-fermented organic pastries baked fresh each morning.',
      statusBadge: '☕ Fresh Roast Batch #114 // Open Today',
      categoryBadge: 'SPECIALTY ROASTERY & BAKERY',
      ctaPrimary: 'Explore Menu & Origins',
      ctaSecondary: 'Join Roaster\'s Club',
      manifestoTitle: 'The Craft of the Bean',
      philosophy: 'We pay above Fair Trade minimums directly to smallholder cooperatives in Ethiopia, Colombia, and Guatemala, highlighting micro-lot terroir with clean profiles.',
      headerTag: 'OPEN DAILY 7AM - 6PM // ARTS DISTRICT',
      stats: [
        { label: 'Direct Origins', value: '18 Farms' },
        { label: 'SCA Cupping Score', value: '88.5+' },
        { label: 'Daily Fresh Loaves', value: '120+' },
        { label: 'Customer Rating', value: '4.95★' },
      ],
      projects: [
        {
          title: 'Yirgacheffe Gedeb (Natural)',
          category: 'Single-Origin Pour Over',
          description: 'Notes of wild blueberry, bergamot, and raw honey. Sun-dried on raised African beds for 21 days.',
          tags: ['Ethiopia', 'Light Roast', 'Floral & Berry'],
        },
        {
          title: 'Huila Supremo Geisha',
          category: 'Competition Micro-Lot',
          description: 'Silky jasmine floral aroma with crisp green apple acidity and a lingering caramel finish.',
          tags: ['Colombia', 'Washed', 'Rare Lot'],
        },
        {
          title: 'Cardamom Sourdough Morning Bun',
          category: 'Artisanal Bakery',
          description: 'Flaky lamination made with French cultured butter, freshly ground organic cardamom, and vanilla sugar crust.',
          tags: ['Baked 6 AM', 'Wild Yeast', 'Pastry'],
        },
      ],
      skills: [
        'Single-Origin Sourcing',
        'Micro-Batch Drum Roasting',
        'Barista Cupping Labs',
        'Cold Brew Slow Drip',
        'Sourdough Viennoiserie',
        'Wholesale Cafe Supply',
      ],
      email: 'roasters@komorebicoffee.com',
      github: 'https://instagram.com/komorebicoffee',
      twitter: 'https://twitter.com/komorebicoffee',
      prompt: cleanPrompt,
    };
  }

  // 5. Default high-converting domain fallback
  const base = buildPortfolioData(custom);
  base.name = custom.name || 'Atelier & Frontier Lab';
  base.role = custom.role || 'Design Engineering, Strategy & Digital Systems';
  base.headline = custom.headline || 'Crafting Digital Products With Clarity and Purpose.';
  base.tagline = custom.tagline || 'We bridge design, strategy, and engineering to build modern web experiences that captivate audiences and drive measurable results.';
  base.statusBadge = '⚡ Commissioning Projects for 2026';
  base.categoryBadge = 'DIGITAL ATELIER & STUDIO';
  base.prompt = cleanPrompt;
  return base;
}

/**
 * Generates 3 domain-tailored aesthetic design directions based on the prompt.
 * Ensures the options are genuinely different in typography, colors, layoutMode, and mood.
 */
export function buildDomainAesthetics(cleanPrompt, data = {}) {
  const lower = (cleanPrompt || '').toLowerCase();

  // 1. Google Sheets / Spreadsheets / FinTech / Financial / SaaS
  if (lower.match(/(sheet|sheets|google\s*sheet|spreadsheet|excel|reconcil|bookkeep|invoic|ledger|finance|fintech|accounting|cfo|payroll)/i)) {
    return [
      {
        option: 1,
        id: 'emerald-ledger',
        name: 'Emerald Ledger Modernism',
        archetype: 'High-Trust FinTech Dashboard',
        description: 'Deep forest emerald backgrounds, crisp data tables, mint accent badges, and clean tabular numeric typography.',
        fontHeading: "'Plus Jakarta Sans', sans-serif",
        fontBody: "'Inter', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&family=JetBrains+Mono:wght@500;600&display=swap',
        stitchHeadlineFont: 'PLUS_JAKARTA_SANS',
        stitchBodyFont: 'INTER',
        colors: {
          bg: '#0A1813',
          bgCard: '#11261F',
          accent: '#10B981',
          accentSecondary: '#34D399',
          textPrimary: '#F0FDF4',
          textMuted: '#86EFAC',
          border: '#1E3E33',
          heroGlow: 'radial-gradient(circle at 50% 15%, rgba(16, 185, 129, 0.18) 0%, transparent 65%)',
        },
        ui: {
          borderRadius: '0.75rem',
          borderWidth: '1px',
          shadow: '0 12px 32px -4px rgba(0, 0, 0, 0.5)',
          layoutMode: 'modular',
        },
      },
      {
        option: 2,
        id: 'audit-monograph',
        name: 'Institutional Audit Monograph',
        archetype: 'Financial Ledger Precision & Monograph Journal',
        description: 'Pristine warm ivory background, rich charcoal typography, sharp hairline borders, and serif balance.',
        fontHeading: "'Playfair Display', serif",
        fontBody: "'DM Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
        stitchBodyFont: 'DM_SANS',
        colors: {
          bg: '#FBF9F5',
          bgCard: '#FFFFFF',
          accent: '#1E3A2F',
          accentSecondary: '#D97706',
          textPrimary: '#141D18',
          textMuted: '#586A60',
          border: '#E2DCD1',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.375rem',
          borderWidth: '1px',
          shadow: '0 4px 16px -2px rgba(20, 29, 24, 0.06)',
          layoutMode: 'editorial',
        },
      },
      {
        option: 3,
        id: 'spreadsheet-terminal',
        name: 'Spreadsheet High-Density Grid',
        archetype: 'Formula Engine Telemetry',
        description: 'Monospaced cell coordinates, subtle formula gridlines, Google green highlights, and tactile formula cards.',
        fontHeading: "'Space Grotesk', sans-serif",
        fontBody: "'JetBrains Mono', monospace",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap',
        stitchHeadlineFont: 'SPACE_GROTESK',
        stitchBodyFont: 'JETBRAINS_MONO',
        colors: {
          bg: '#0F172A',
          bgCard: '#1E293B',
          accent: '#22C55E',
          accentSecondary: '#38BDF8',
          textPrimary: '#F8FAFC',
          textMuted: '#94A3B8',
          border: '#334155',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.5rem',
          borderWidth: '2px',
          shadow: '4px 4px 0px #22C55E',
          layoutMode: 'tactile',
        },
      },
    ];
  }

  // 2. Animals / Dog Shelter / Pets
  if (lower.match(/(dog|shelter|rescue|animal|cat|pet|pup|puppy|adopt|canine|sanctuary)/i)) {
    return [
      {
        option: 1,
        id: 'warm-meadow',
        name: 'Sunlit Meadow & Warm Fur',
        archetype: 'Warm Heartfelt Cuddle Cards',
        description: 'Warm honey cream, earthy terracotta, rounded cuddly cards, and compassionate adoption badges.',
        fontHeading: "'Outfit', sans-serif",
        fontBody: "'Plus Jakarta Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Outfit:wght@600;700;800&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap',
        stitchHeadlineFont: 'OUTFIT',
        stitchBodyFont: 'PLUS_JAKARTA_SANS',
        colors: {
          bg: '#FDFBF7',
          bgCard: '#FFFFFF',
          accent: '#D96B43',
          accentSecondary: '#F2A93B',
          textPrimary: '#2D231E',
          textMuted: '#7D7068',
          border: '#EFE7DC',
          heroGlow: 'radial-gradient(circle at 50% 20%, rgba(242, 169, 59, 0.15) 0%, transparent 70%)',
        },
        ui: {
          borderRadius: '1.5rem',
          borderWidth: '1px',
          shadow: '0 12px 32px -4px rgba(217, 107, 67, 0.08)',
          layoutMode: 'modular',
        },
      },
      {
        option: 2,
        id: 'sanctuary-trust',
        name: 'Sanctuary Trust Minimal',
        archetype: 'High-Trust Non-Profit Editorial',
        description: 'Clean ivory canvas, deep forest sage accents, and transparent donor impact metrics.',
        fontHeading: "'Fraunces', serif",
        fontBody: "'DM Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=DM+Sans:wght@400;500;700&display=swap',
        stitchHeadlineFont: 'FRAUNCES',
        stitchBodyFont: 'DM_SANS',
        colors: {
          bg: '#F7F6F2',
          bgCard: '#FFFFFF',
          accent: '#2C402E',
          accentSecondary: '#8B9D83',
          textPrimary: '#1E241F',
          textMuted: '#687269',
          border: '#E3E0D8',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.5rem',
          borderWidth: '1px',
          shadow: '0 4px 20px -2px rgba(44, 64, 46, 0.05)',
          layoutMode: 'editorial',
        },
      },
      {
        option: 3,
        id: 'playful-paws',
        name: 'Playful Rescue Club',
        archetype: 'Tactile Joyful Adoption Badges',
        description: 'High-contrast tactile cards, sky blue accents, sunny apricot stickers, and playful badges.',
        fontHeading: "'Space Grotesk', sans-serif",
        fontBody: "'Inter', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap',
        stitchHeadlineFont: 'SPACE_GROTESK',
        stitchBodyFont: 'INTER',
        colors: {
          bg: '#FFFDF0',
          bgCard: '#FFFFFF',
          accent: '#0284C7',
          accentSecondary: '#F97316',
          textPrimary: '#0F172A',
          textMuted: '#64748B',
          border: '#0F172A',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.75rem',
          borderWidth: '2px',
          shadow: '4px 4px 0px #0F172A',
          layoutMode: 'tactile',
        },
      },
    ];
  }

  // 3. Craft / Pottery / Bakery / Atelier / Kyoto
  if (lower.match(/(potter|ceramic|clay|kiln|glaze|bakery|bake|coffee|cafe|craft|atelier|handmade|artisan|japan|kyoto)/i)) {
    return [
      {
        option: 1,
        id: 'earth-clay',
        name: 'Wabi-Sabi Earth & Clay',
        archetype: 'Artisan Stoneware Tactile',
        description: 'Raw stoneware textures, warm ochre, tatami neutrals, and quiet serif elegance.',
        fontHeading: "'Playfair Display', serif",
        fontBody: "'DM Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
        stitchBodyFont: 'DM_SANS',
        colors: {
          bg: '#F5F2EB',
          bgCard: '#ECE7DD',
          accent: '#A85A32',
          accentSecondary: '#3D4A3E',
          textPrimary: '#2B2620',
          textMuted: '#6E655B',
          border: '#DDD6C8',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.5rem',
          borderWidth: '1px',
          shadow: '0 4px 20px -2px rgba(43, 38, 32, 0.06)',
          layoutMode: 'modular',
        },
      },
      {
        option: 2,
        id: 'kiln-charcoal',
        name: 'Charcoal Kiln & Iron Glaze',
        archetype: 'Smokey Kiln Minimalism',
        description: 'Deep smokey charcoal stoneware, glowing embers of terracotta, and modern artisan minimalism.',
        fontHeading: "'Playfair Display', serif",
        fontBody: "'Plus Jakarta Sans', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
        stitchBodyFont: 'PLUS_JAKARTA_SANS',
        colors: {
          bg: '#1A1715',
          bgCard: '#24201D',
          accent: '#E27238',
          accentSecondary: '#D4B483',
          textPrimary: '#F7F4EF',
          textMuted: '#A39B91',
          border: '#38322D',
          heroGlow: 'radial-gradient(circle at 50% 20%, rgba(226, 114, 56, 0.12) 0%, transparent 60%)',
        },
        ui: {
          borderRadius: '0.25rem',
          borderWidth: '1px',
          shadow: '0 10px 30px -5px rgba(0, 0, 0, 0.5)',
          layoutMode: 'editorial',
        },
      },
      {
        option: 3,
        id: 'kyoto-gallery',
        name: 'Kyoto Craft Studio Gallery',
        archetype: 'Clean Japanese Editorial',
        description: 'Crisp gallery white, matcha green accents, and clean contemporary Japanese editorial spacing.',
        fontHeading: "'Playfair Display', serif",
        fontBody: "'Inter', sans-serif",
        googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:ital,wght@0,600;0,700;1,400&display=swap',
        stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
        stitchBodyFont: 'INTER',
        colors: {
          bg: '#FAFAF9',
          bgCard: '#FFFFFF',
          accent: '#405B48',
          accentSecondary: '#B87333',
          textPrimary: '#1C1917',
          textMuted: '#78716C',
          border: '#E7E5E4',
          heroGlow: 'none',
        },
        ui: {
          borderRadius: '0.75rem',
          borderWidth: '1px',
          shadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
          layoutMode: 'tactile',
        },
      },
    ];
  }

  // Default Universal Archetypes (Modern Modular, Editorial Serif, Tactile Energy)
  return [
    {
      option: 1,
      id: 'modern-prime',
      name: 'Modern Precision Modular',
      archetype: 'Modern Modular Grid',
      description: 'Sophisticated dark slate canvas with glowing accent telemetry and polished modular cards.',
      fontHeading: "'Plus Jakarta Sans', sans-serif",
      fontBody: "'Inter', sans-serif",
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap',
      stitchHeadlineFont: 'PLUS_JAKARTA_SANS',
      stitchBodyFont: 'INTER',
      colors: {
        bg: '#090D16',
        bgCard: '#111827',
        accent: '#6366F1',
        accentSecondary: '#06B6D4',
        textPrimary: '#F9FAFB',
        textMuted: '#9CA3AF',
        border: 'rgba(255, 255, 255, 0.1)',
        heroGlow: 'radial-gradient(circle at 50% 10%, rgba(99, 102, 241, 0.15) 0%, transparent 60%)',
      },
      ui: {
        borderRadius: '1rem',
        borderWidth: '1px',
        shadow: '0 10px 30px -5px rgba(0, 0, 0, 0.4)',
        layoutMode: 'modular',
      },
    },
    {
      option: 2,
      id: 'editorial-serif',
      name: 'High-Impact Editorial Minimal',
      archetype: 'Editorial Monospace Serif',
      description: 'Serif headlines, generous editorial whitespace, and high-contrast timeless layout.',
      fontHeading: "'Playfair Display', serif",
      fontBody: "'Plus Jakarta Sans', sans-serif",
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,600;0,800;1,400&family=Plus+Jakarta+Sans:wght@400;500;600&display=swap',
      stitchHeadlineFont: 'PLAYFAIR_DISPLAY',
      stitchBodyFont: 'PLUS_JAKARTA_SANS',
      colors: {
        bg: '#FAF9F6',
        bgCard: '#FFFFFF',
        accent: '#18181B',
        accentSecondary: '#71717A',
        textPrimary: '#18181B',
        textMuted: '#52525B',
        border: '#E4E4E7',
        heroGlow: 'none',
      },
      ui: {
        borderRadius: '0.25rem',
        borderWidth: '1px',
        shadow: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        layoutMode: 'editorial',
      },
    },
    {
      option: 3,
      id: 'dynamic-tactile',
      name: 'Tactile Energy & Bold Badges',
      archetype: 'Neo-Tactile Badges',
      description: 'High-energy borders, tactile drop shadows, and vibrant highlighter badges.',
      fontHeading: "'Space Grotesk', sans-serif",
      fontBody: "'Inter', sans-serif",
      googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@600;700&display=swap',
      stitchHeadlineFont: 'SPACE_GROTESK',
      stitchBodyFont: 'INTER',
      colors: {
        bg: '#FDFDFD',
        bgCard: '#FFFFFF',
        accent: '#F59E0B',
        accentSecondary: '#EC4899',
        textPrimary: '#18181B',
        textMuted: '#52525B',
        border: '#18181B',
        heroGlow: 'none',
      },
      ui: {
        borderRadius: '0.5rem',
        borderWidth: '2px',
        shadow: '4px 4px 0px #18181B',
        layoutMode: 'tactile',
      },
    },
  ];
}

/**
 * Dynamically synthesizes 100% custom, domain-specific website content using Gemini.
 * Researches the niche domain, synthesizes authentic copy, AND produces:
 * 1. 3 bespoke aesthetic design directions (Option 1, Option 2, Option 3)
 * 2. An exhaustive, production-grade stitchPrompt designed specifically for Google Stitch MCP.
 *
 * @param {string} prompt - User's request text (e.g. "Google Sheets add-on for automated reconciliation")
 * @param {object} [custom={}]
 * @returns {Promise<object>}
 */
export async function synthesizePortfolioData(prompt, custom = {}) {
  const cleanPrompt = (prompt || '').trim();
  if (!cleanPrompt) {
    const base = buildDomainPortfolioData('general', custom);
    base.aesthetics = buildDomainAesthetics('general', base);
    return base;
  }

  const systemPrompt = `You are a world-class creative director, brand strategist, and principal web architect.
A user wants to create a website with the following prompt:
"${cleanPrompt}"

RESEARCH & SYNTHESIS REQUIREMENTS:
1. Conduct deep domain & industry research on this exact topic.
   - What is the real business model, customer persona, and value proposition?
   - What are 4 authentic, domain-specific key metrics / proof points?
   - What are 3-4 specific products, features, or offerings with realistic descriptions, specs, and badges?
2. Synthesize authentic, high-converting copy specifically for this domain (NEVER output generic tech architect/engineer copy unless specifically asked).
3. Formulate 3 COMPLETELY DYNAMIC, BESPOKE AESTHETIC DESIGN DIRECTIONS organically invented for this specific domain (ZERO PRESETS: absolutely NO canned "Swiss", "Bento", or "Neon" templates — invent evocative domain-native styles tailored to the user's specific craft, e.g. "Heritage Paddock & Saddle Leather", "Wood-Fired Hearth & Flour", "Cellular Matrix & Autonomous Ledger", etc.).
4. Craft an exhaustive, 3-paragraph "stitchPrompt" specifically engineered for Google Stitch MCP:
   - Paragraph 1: Brand positioning, visual mood, palette, and typography.
   - Paragraph 2: Section-by-section breakdown (Navbar, Hero with trust badges, Product/Feature comparison grid with realistic items, Craft/Mission pillar cards, Pricing or Booking CTA, Operating hours/location/contact, and Footer).
   - Paragraph 3: Component styling rules (borders, elevation, spacing, container queries).

Output ONLY a valid JSON object matching this exact schema:
{
  "name": string (authentic business, product, or studio name),
  "role": string (subheading or domain specialty, 4-8 words),
  "headline": string (punchy main hero headline, 5-10 words),
  "tagline": string (engaging 1-2 sentence description tailored to this niche),
  "statusBadge": string (relevant short status badge with an emoji, e.g. "📊 Google Workspace Verified" or "🏺 Kiln Fired Daily"),
  "categoryBadge": string (UPPERCASE category badge, e.g. "SPREADSHEET AUTOMATION" or "CERAMIC ATELIER"),
  "ctaPrimary": string (active button text, 2-3 words, e.g. "Install Add-on" or "Explore Vessels"),
  "ctaSecondary": string (secondary button text, e.g. "View Demo Sheet" or "Book Workshop"),
  "manifestoTitle": string (title for the mission / approach card, 2-4 words),
  "philosophy": string (passionate 1-2 sentence mission statement),
  "headerTag": string (short navbar tag, e.g. "GOOGLE WORKSPACE // SOC2"),
  "stats": [
    {"label": string, "value": string},
    {"label": string, "value": string},
    {"label": string, "value": string},
    {"label": string, "value": string}
  ],
  "projects": [
    {
      "title": string,
      "category": string,
      "description": string,
      "tags": [string, string, string]
    },
    {
      "title": string,
      "category": string,
      "description": string,
      "tags": [string, string, string]
    },
    {
      "title": string,
      "category": string,
      "description": string,
      "tags": [string, string, string]
    }
  ],
  "skills": [string, string, string, string, string, string],
  "email": string,
  "aesthetics": [
    {
      "option": 1,
      "id": string (short slug, e.g. "emerald-ledger"),
      "name": string (evocative aesthetic name),
      "archetype": string (short 2-4 word stylistic archetype),
      "description": string (1-2 sentences on visual mood, palette, and materials),
      "fontHeading": string (CSS font-family),
      "fontBody": string (CSS font-family),
      "googleFontsUrl": string (valid Google Fonts css2 link),
      "stitchHeadlineFont": string (One of: "PLAYFAIR_DISPLAY", "SPACE_GROTESK", "DM_SANS", "PLUS_JAKARTA_SANS", "OUTFIT", "INTER", "MONTSERRAT", "MANROPE", "FRAUNCES", "CINZEL"),
      "stitchBodyFont": string (One of: "DM_SANS", "INTER", "PLUS_JAKARTA_SANS", "SPACE_GROTESK", "JETBRAINS_MONO"),
      "colors": {
        "bg": string (Hex background color),
        "bgCard": string (Hex card background),
        "accent": string (Primary brand accent hex),
        "accentSecondary": string (Secondary accent / badge hex),
        "textPrimary": string (Main readable text hex),
        "textMuted": string (Subdued secondary text hex),
        "border": string (Border hex),
        "heroGlow": string (CSS gradient glow for hero or "none")
      },
      "ui": {
        "borderRadius": string (e.g. "0.75rem", "0.5rem", "0.25rem"),
        "borderWidth": string (e.g. "1px", "2px"),
        "shadow": string (e.g. "0 10px 30px -5px rgba(0,0,0,0.4)"),
        "layoutMode": "modular"
      }
    },
    {
      "option": 2,
      "id": string,
      "name": string,
      "archetype": string,
      "description": string,
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
        "border": string,
        "heroGlow": string
      },
      "ui": {
        "borderRadius": string,
        "borderWidth": string,
        "shadow": string,
        "layoutMode": "editorial"
      }
    },
    {
      "option": 3,
      "id": string,
      "name": string,
      "archetype": string,
      "description": string,
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
        "border": string,
        "heroGlow": string
      },
      "ui": {
        "borderRadius": string,
        "borderWidth": string,
        "shadow": string,
        "layoutMode": "tactile"
      }
    }
  ],
  "stitchPrompt": string (Exhaustive, 3-paragraph prompt to pass to Google Stitch MCP to generate a complete responsive desktop landing page with exact sections, components, color scheme, and typography)
}
Do not include markdown code fences, backticks, or commentary. Output raw JSON only.`;

  // 1. Try Gemini Client directly (Fastest & most accurate)
  try {
    const res = await geminiClient.generateContent(systemPrompt);
    const raw = (res.text || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && parsed.name && parsed.headline && Array.isArray(parsed.stats)) {
        if (!Array.isArray(parsed.aesthetics) || parsed.aesthetics.length < 3) {
          parsed.aesthetics = buildDomainAesthetics(cleanPrompt, parsed);
        }
        return {
          ...parsed,
          prompt: cleanPrompt,
          email: parsed.email || custom.email || 'hello@example.com',
          github: custom.github || 'https://github.com',
          twitter: custom.twitter || 'https://twitter.com',
          ...custom,
        };
      }
    }
  } catch (geminiErr) {
    console.warn('[PortfolioSynthesizer] Direct Gemini synthesis notice:', geminiErr.message);
  }

  // 2. Try local agy CLI if installed
  try {
    const agyBin = process.env.AGY_BIN || 'agy';
    const { stdout } = await execFileAsync(agyBin, ['-p', systemPrompt], {
      timeout: 30000,
      env: { ...process.env, PAGER: 'cat' },
    });
    const raw = (stdout || '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && parsed.name && parsed.headline && Array.isArray(parsed.stats)) {
        if (!Array.isArray(parsed.aesthetics) || parsed.aesthetics.length < 3) {
          parsed.aesthetics = buildDomainAesthetics(cleanPrompt, parsed);
        }
        return {
          ...parsed,
          prompt: cleanPrompt,
          ...custom,
        };
      }
    }
  } catch (agyErr) {
    console.warn('[PortfolioSynthesizer] agy CLI fallback notice:', agyErr.message);
  }

  // 3. Deterministic Domain-Specific Fallback (Zero AI slop, 100% matched to niche)
  const fallback = buildDomainPortfolioData(cleanPrompt, custom);
  fallback.aesthetics = buildDomainAesthetics(cleanPrompt, fallback);
  fallback.stitchPrompt = `Design a modern, high-converting desktop landing page for "${fallback.name}" (${fallback.role}). ${fallback.tagline} Feature key sections: 1. Hero with status badge ("${fallback.statusBadge}"), headline ("${fallback.headline}"), and call to actions ("${fallback.ctaPrimary}", "${fallback.ctaSecondary}"). 2. Key proof metrics (${fallback.stats.map(s => `${s.value} ${s.label}`).join(', ')}). 3. Offerings and features (${fallback.projects.map(p => `${p.title}: ${p.description}`).join('; ')}). 4. Mission and approach statement ("${fallback.philosophy}"). 5. Contact and footer. Style with a professional bespoke color palette and clean typography.`;

  return fallback;
}
