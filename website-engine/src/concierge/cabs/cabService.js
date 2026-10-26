import { resolveLocation, getDistanceAndDuration } from '../location.js';
import { CONFIG } from '../../config.js';
import { geminiClient } from '../../gemini-client.js';
import { stripEmojis, queryCustomRouterChat } from '../../nlp/fast-router.js';

/**
 * Universal 1-Tap Deep Link Generators for ride providers.
 */
export function generateUberDeepLink({ pickup, dropoff }) {
  const pNick = encodeURIComponent(pickup.label || 'Pickup');
  const dNick = encodeURIComponent(dropoff.label || 'Destination');
  const universalUrl = `https://m.uber.com/ul/?action=setPickup&client_id=weave&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lon}&pickup[nickname]=${pNick}&dropoff[latitude]=${dropoff.lat}&dropoff[longitude]=${dropoff.lon}&dropoff[nickname]=${dNick}`;
  const appScheme = `uber://?action=setPickup&pickup[latitude]=${pickup.lat}&pickup[longitude]=${pickup.lon}&dropoff[latitude]=${dropoff.lat}&dropoff[longitude]=${dropoff.lon}`;
  return { universalUrl, appScheme };
}

export function generateOlaDeepLink({ pickup, dropoff }) {
  const universalUrl = `https://book.olacabs.com/?pickup_lat=${pickup.lat}&pickup_lng=${pickup.lon}&drop_lat=${dropoff.lat}&drop_lng=${dropoff.lon}`;
  const appScheme = `ola://ride?lat=${pickup.lat}&lng=${pickup.lon}&drop_lat=${dropoff.lat}&drop_lng=${dropoff.lon}`;
  return { universalUrl, appScheme };
}

export function generateNammaYatriDeepLink({ pickup, dropoff }) {
  // Namma Yatri / Open Mobility deep link
  const universalUrl = `https://nammayatri.in/open?pickup_lat=${pickup.lat}&pickup_lon=${pickup.lon}&drop_lat=${dropoff.lat}&drop_lon=${dropoff.lon}`;
  const appScheme = `nammayatri://ride?pickup_lat=${pickup.lat}&pickup_lon=${pickup.lon}&drop_lat=${dropoff.lat}&drop_lon=${dropoff.lon}`;
  return { universalUrl, appScheme };
}

/**
 * Computes dynamic surge multiplier based on local time.
 */
export function calculateSurgeFactor() {
  const currentHour = new Date().getHours();
  // Peak rush hours: 8am - 10am and 5pm - 8pm
  if ((currentHour >= 8 && currentHour <= 10) || (currentHour >= 17 && currentHour <= 20)) {
    return 1.25;
  }
  // Late night: 11pm - 4am
  if (currentHour >= 23 || currentHour <= 4) {
    return 1.15;
  }
  return 1.0;
}

/**
 * Computes estimated fares across Uber, Ola, and Namma Yatri based on distance & duration.
 */
export function calculateFares(distanceKm, durationMinutes) {
  const surge = calculateSurgeFactor();
  const currentHour = new Date().getHours();
  const isNightMeter = currentHour >= 22 || currentHour <= 5; // 1.5x govt night meter rule

  // 1. Namma Yatri (Govt Meter Auto: ₹30 first 2km, ₹15/km, ₹10 pickup fee, 0% commission)
  const nyAutoRate = distanceKm <= 2 ? 30 : 30 + (distanceKm - 2) * 15;
  const nyAutoFare = Math.round((nyAutoRate * (isNightMeter ? 1.5 : 1.0) + 10) / 5) * 5;

  // Namma Yatri Cab (Zero commission ~₹18/km, base ₹100 for 4km)
  const nyCabRate = distanceKm <= 4 ? 100 : 100 + (distanceKm - 4) * 18;
  const nyCabFare = Math.round((nyCabRate * (isNightMeter ? 1.2 : 1.0)) / 10) * 10;

  // 2. Ola Tariffs
  // Ola Auto: Base ₹35 + ₹16/km + platform fee
  const olaAuto = Math.round(((35 + distanceKm * 16) * surge) / 5) * 5;
  // Ola Mini: Base ₹80 + ₹19/km + duration charge
  const olaMini = Math.round(((80 + distanceKm * 19 + durationMinutes * 1.5) * surge) / 10) * 10;
  // Ola Prime Sedan: Base ₹110 + ₹23/km
  const olaPrime = Math.round(((110 + distanceKm * 23 + durationMinutes * 2) * surge) / 10) * 10;
  // Ola Bike: Base ₹25 + ₹8/km
  const olaBike = Math.round(((25 + distanceKm * 8.5) * surge) / 5) * 5;

  // 3. Uber Tariffs
  // Uber Auto: Base ₹35 + ₹15.5/km
  const uberAuto = Math.round(((35 + distanceKm * 15.5) * surge) / 5) * 5;
  // Uber Go: Base ₹75 + ₹18.5/km + duration charge
  const uberGo = Math.round(((75 + distanceKm * 18.5 + durationMinutes * 1.5) * surge) / 10) * 10;
  // Uber Premier: Base ₹120 + ₹24/km
  const uberPremier = Math.round(((120 + distanceKm * 24 + durationMinutes * 2.2) * surge) / 10) * 10;
  // Uber Moto: Base ₹25 + ₹8/km
  const uberMoto = Math.round(((25 + distanceKm * 8) * surge) / 5) * 5;

  return [
    // Autos
    {
      provider: 'Namma Yatri',
      tier: 'Auto (Metered)',
      category: 'auto',
      icon: '🛺',
      fareLow: nyAutoFare,
      fareHigh: nyAutoFare + 15,
      etaMins: 3,
      note: 'Zero Commission / Govt Meter',
    },
    {
      provider: 'Uber',
      tier: 'Uber Auto',
      category: 'auto',
      icon: '🛺',
      fareLow: uberAuto,
      fareHigh: uberAuto + 20,
      etaMins: 4,
      note: 'Direct booking',
    },
    {
      provider: 'Ola',
      tier: 'Ola Auto',
      category: 'auto',
      icon: '🛺',
      fareLow: olaAuto,
      fareHigh: olaAuto + 25,
      etaMins: 4,
      note: 'Direct booking',
    },

    // Cabs (Hatchback / Sedan)
    {
      provider: 'Namma Yatri',
      tier: 'NY Cab (Non-AC/AC)',
      category: 'cab',
      icon: '🚗',
      fareLow: nyCabFare,
      fareHigh: nyCabFare + 30,
      etaMins: 5,
      note: 'Zero Commission Cab',
    },
    {
      provider: 'Uber',
      tier: 'Uber Go (Hatchback)',
      category: 'cab',
      icon: '🚗',
      fareLow: uberGo,
      fareHigh: uberGo + 40,
      etaMins: 3,
      note: 'Popular & Fast',
    },
    {
      provider: 'Ola',
      tier: 'Ola Mini (Compact)',
      category: 'cab',
      icon: '🚗',
      fareLow: olaMini,
      fareHigh: olaMini + 45,
      etaMins: 5,
      note: 'AC Hatchback',
    },
    {
      provider: 'Uber',
      tier: 'Uber Premier (Sedan)',
      category: 'sedan',
      icon: '🚘',
      fareLow: uberPremier,
      fareHigh: uberPremier + 50,
      etaMins: 6,
      note: 'Top rated drivers',
    },
    {
      provider: 'Ola',
      tier: 'Ola Prime (Sedan)',
      category: 'sedan',
      icon: '🚘',
      fareLow: olaPrime,
      fareHigh: olaPrime + 55,
      etaMins: 6,
      note: 'Spacious Sedan',
    },

    // Bikes (2-Wheelers)
    {
      provider: 'Uber',
      tier: 'Uber Moto',
      category: 'bike',
      icon: '🏍️',
      fareLow: uberMoto,
      fareHigh: uberMoto + 10,
      etaMins: 2,
      note: 'Quickest in traffic',
    },
    {
      provider: 'Ola',
      tier: 'Ola Bike',
      category: 'bike',
      icon: '🏍️',
      fareLow: olaBike,
      fareHigh: olaBike + 15,
      etaMins: 3,
      note: 'Budget 2-wheeler',
    },
  ];
}

/**
 * Generates ride estimates and comparison across Uber, Ola, and Namma Yatri.
 */
export async function getRideComparison({
  pickupQuery = '',
  destinationQuery = '',
  msg = null,
  preferredCategory = null,
  preferredProvider = null,
  excludeProvider = null,
}) {
  if (!destinationQuery || !destinationQuery.trim()) {
    throw new Error('Please specify a destination (e.g. "compare cabs to Indiranagar" or "book auto to Airport").');
  }

  // Resolve pickup & dropoff coordinates
  const pickup = await resolveLocation(pickupQuery, msg);
  const dropoff = await resolveLocation(destinationQuery, null);

  // Calculate real driving distance & duration
  const { distanceKm, durationMinutes } = await getDistanceAndDuration(pickup, dropoff);

  // Generate 1-tap deep links
  const uberLink = generateUberDeepLink({ pickup, dropoff });
  const olaLink = generateOlaDeepLink({ pickup, dropoff });
  const nyLink = generateNammaYatriDeepLink({ pickup, dropoff });

  // Get raw fare estimates
  let options = calculateFares(distanceKm, durationMinutes);

  // Filter by category if requested (auto, bike, cab, sedan)
  if (preferredCategory) {
    const cat = preferredCategory.toLowerCase();
    const filtered = options.filter((o) => o.category === cat || (cat === 'cab' && (o.category === 'cab' || o.category === 'sedan')));
    if (filtered.length > 0) options = filtered;
  }

  // Filter by provider if requested (uber, ola, namma yatri)
  if (preferredProvider) {
    const prov = preferredProvider.toLowerCase();
    const filtered = options.filter((o) => o.provider.toLowerCase().includes(prov));
    if (filtered.length > 0) options = filtered;
  }

  // Exclude provider if requested (e.g. user does not have Namma Yatri installed)
  if (excludeProvider) {
    const ex = excludeProvider.toLowerCase();
    const filtered = options.filter((o) => !o.provider.toLowerCase().includes(ex));
    if (filtered.length > 0) options = filtered;
  }

  // Sort by lowest fare
  options.sort((a, b) => a.fareLow - b.fareLow);

  // Intelligently evaluate the single best ride recommendation
  const evaluation = evaluateBestRide(options, {
    distanceKm,
    preferredCategory,
    preferredProvider,
  });

  return {
    pickup,
    dropoff,
    distanceKm,
    durationMinutes,
    surgeMultiplier: calculateSurgeFactor(),
    links: {
      uber: uberLink.universalUrl,
      ola: olaLink.universalUrl,
      nammaYatri: nyLink.universalUrl,
    },
    options,
    topPick: evaluation.topPick,
    reason: evaluation.reason,
    alternativePick: evaluation.alternativePick,
  };
}

/**
 * Resolves the corresponding provider deep link.
 */
export function getLinkForProvider(provider, links) {
  const p = (provider || '').toLowerCase();
  if (p.includes('namma')) return links.nammaYatri;
  if (p.includes('uber')) return links.uber;
  if (p.includes('ola')) return links.ola;
  return links.uber;
}

/**
 * Evaluates the optimal ride choice balancing price, ETA, distance, and context.
 */
export function evaluateBestRide(options, { distanceKm = 5, preferredCategory = null, preferredProvider = null } = {}) {
  if (!options || options.length === 0) return { topPick: null, reason: '', alternativePick: null };

  let eligible = [...options];

  // 1. Filter by user preferred provider if specified
  if (preferredProvider) {
    const provLower = preferredProvider.toLowerCase();
    const filtered = eligible.filter((o) => o.provider.toLowerCase().includes(provLower));
    if (filtered.length > 0) eligible = filtered;
  }

  // 2. Filter by user preferred category if specified (e.g. auto, bike, cab)
  if (preferredCategory) {
    const catLower = preferredCategory.toLowerCase();
    const filtered = eligible.filter(
      (o) => o.category === catLower || (catLower === 'cab' && (o.category === 'cab' || o.category === 'sedan'))
    );
    if (filtered.length > 0) eligible = filtered;
  } else {
    // Unless user explicitly requested a bike, prioritize autos & cabs for general ride requests
    const nonBikes = eligible.filter((o) => o.category !== 'bike');
    if (nonBikes.length > 0) eligible = nonBikes;
  }

  // 3. Distance Heuristics: For long distance trips (> 15 km e.g. Airport), prioritize cabs over bikes/autos
  if (!preferredCategory && distanceKm > 15) {
    const cabOptions = eligible.filter((o) => o.category === 'cab' || o.category === 'sedan');
    if (cabOptions.length > 0) eligible = cabOptions;
  }

  // 4. Value Score = Fare (60%) + ETA (40%) + Open Mobility bonus
  const scored = eligible.map((opt) => {
    let score = opt.fareLow;
    // ETA weight: 1 min faster is worth ~₹10 in value
    score += opt.etaMins * 10;
    // Bias towards zero-commission open mobility (Namma Yatri) when prices are close
    if (opt.provider === 'Namma Yatri') score -= 15;
    return { opt, score };
  });

  scored.sort((a, b) => a.score - b.score);
  const topPick = scored[0].opt;

  // Generate justification reason
  let reason = 'Best balance of price and arrival ETA';
  if (topPick.provider === 'Namma Yatri' && topPick.category === 'auto') {
    reason = 'Lowest fare with zero driver commission (Govt meter rate)';
  } else if (topPick.category === 'cab') {
    reason = `Top value AC cab arriving in ~${topPick.etaMins} mins`;
  } else if (topPick.category === 'bike') {
    reason = `Fastest & lowest-cost ride to beat traffic (~${topPick.etaMins}m ETA)`;
  }

  // 5. Select a solid runner-up / alternative (e.g., if top is Auto, offer AC Cab; if top is Cab, offer budget Auto)
  let alternativePick = null;
  if (topPick.category === 'auto') {
    alternativePick = options.find((o) => o.category === 'cab');
  } else if (topPick.category === 'cab' || topPick.category === 'sedan') {
    alternativePick = options.find((o) => o.category === 'auto');
  } else if (topPick.category === 'bike') {
    alternativePick = options.find((o) => o.category === 'auto') || options.find((o) => o.category === 'cab');
  }

  return {
    topPick,
    reason,
    alternativePick,
  };
}

/**
 * Formats the ride comparison results into a clean WhatsApp Markdown card.
 */
export function formatRideComparisonMessage(comparison) {
  const { pickup, dropoff, distanceKm, durationMinutes, options, links } = comparison;

  const header = [
    `🚖 *RIDE FARE COMPARISON*`,
    `📍 *Pickup:* ${pickup.label}`,
    `🏁 *Dropoff:* ${dropoff.label}`,
    `📏 *Route:* ${distanceKm} km · ~${durationMinutes} mins drive`,
  ];

  // Group options by category
  const autos = options.filter((o) => o.category === 'auto');
  const cabs = options.filter((o) => o.category === 'cab' || o.category === 'sedan');
  const bikes = options.filter((o) => o.category === 'bike');

  const sections = [];

  if (autos.length > 0) {
    sections.push(`\n🛺 *AUTOS:*`);
    for (const opt of autos) {
      sections.push(
        `• *${opt.provider}* (${opt.tier}): *₹${opt.fareLow} - ₹${opt.fareHigh}* · ~${opt.etaMins}m ETA _(${opt.note})_`
      );
    }
  }

  if (cabs.length > 0) {
    sections.push(`\n🚗 *CABS & SEDANS:*`);
    for (const opt of cabs) {
      sections.push(
        `• *${opt.provider}* (${opt.tier}): *₹${opt.fareLow} - ₹${opt.fareHigh}* · ~${opt.etaMins}m ETA _(${opt.note})_`
      );
    }
  }

  if (bikes.length > 0) {
    sections.push(`\n🏍️ *BIKES (2-WHEELER):*`);
    for (const opt of bikes) {
      sections.push(
        `• *${opt.provider}* (${opt.tier}): *₹${opt.fareLow} - ₹${opt.fareHigh}* · ~${opt.etaMins}m ETA`
      );
    }
  }

  // 1-Tap Universal Deep Links
  const actionLinks = [
    `\n📲 *1-TAP PRE-FILLED BOOKING LINKS:*`,
    `⚡ *Uber:* ${links.uber}`,
    `⚡ *Ola:* ${links.ola}`,
    `⚡ *Namma Yatri:* ${links.nammaYatri}`,
    `\n_Tap any link above to open the app with pickup & destination already pinned!_`,
  ];

  return [...header, ...sections, ...actionLinks].join('\n');
}

/**
 * Natural conversational phrasing of the ride recommendation using the custom model / LLM,
 * strictly maintaining all contextual facts (locations, km, duration, fares, ETA) and the 1-tap deep links.
 */
export async function naturalizeRideReply(comparison, userQuery = '') {
  const { pickup, dropoff, distanceKm, durationMinutes, topPick, reason, alternativePick, links } = comparison;
  if (!topPick) return formatRideComparisonMessage(comparison);

  const topLink = getLinkForProvider(topPick.provider, links);
  const altLink = alternativePick ? getLinkForProvider(alternativePick.provider, links) : null;

  const rideContext = {
    userQuery: userQuery || 'book a ride',
    route: `${pickup.label} to ${dropoff.label} (${distanceKm} km, ~${durationMinutes} mins drive)`,
    bestChoice: {
      provider: topPick.provider,
      tier: topPick.tier,
      fareRange: `₹${topPick.fareLow} - ₹${topPick.fareHigh}`,
      eta: `~${topPick.etaMins} mins away`,
      reason,
      oneTapBookingLink: topLink,
    },
    alternative: alternativePick
      ? {
          provider: alternativePick.provider,
          tier: alternativePick.tier,
          fareRange: `₹${alternativePick.fareLow} - ₹${alternativePick.fareHigh}`,
          eta: `~${alternativePick.etaMins} mins away`,
          oneTapBookingLink: altLink,
        }
      : null,
  };

  const systemPrompt =
    'You are Weave, a chill dev assistant on WhatsApp. Reply direct and lowkey with no emojis. Keep it super short like a real friend texting on WhatsApp.';

  const userContent = `User asked: ${userQuery || 'book a ride'}.
Facts: ${topPick.provider} ${topPick.tier} is ₹${topPick.fareLow}-${topPick.fareHigh}, ~${topPick.etaMins} mins away (${reason}). Link: ${topLink}.${
    alternativePick
      ? ` Alternative: ${alternativePick.provider} ${alternativePick.tier} is ₹${alternativePick.fareLow}-${alternativePick.fareHigh}. Link: ${altLink}.`
      : ''
  }

Tell them in 1-2 chill, natural lines with the link(s).`;

  // 1. Try Custom Router on OpenRouter
  const routerReply = await queryCustomRouterChat({
    systemPrompt,
    userMessage: userContent,
    temperature: 0.2,
  });

  if (routerReply && routerReply.includes(topLink.substring(0, 30))) {
    return routerReply;
  }

  // 2. Try Gemini Client
  try {
    const res = await geminiClient.generateContent(userContent, systemPrompt);
    const text = res.text?.trim();
    if (text && text.includes(topLink.substring(0, 30))) {
      return stripEmojis(text);
    }
  } catch (err) {
    console.warn('[Gemini] Ride naturalization note:', err.message);
  }

  // 3. Clean, natural deterministic fallback
  return formatNaturalRideFallback(comparison);
}

/**
 * Clean, normal deterministic conversational message without emojis or rigid bot templates.
 */
export function formatNaturalRideFallback(comparison) {
  const { topPick, alternativePick, links } = comparison;
  const topLink = getLinkForProvider(topPick.provider, links);

  let msg = `${topPick.provider} ${topPick.tier} is looking best, ₹${topPick.fareLow}–₹${topPick.fareHigh} and ~${topPick.etaMins} mins away.\n\nBook here: ${topLink}`;

  if (alternativePick) {
    const altLink = getLinkForProvider(alternativePick.provider, links);
    msg += `\n\nOr ${alternativePick.provider} ${alternativePick.tier} for ₹${alternativePick.fareLow}–₹${alternativePick.fareHigh}:\n${altLink}`;
  }

  return msg;
}

/**
 * Formats the single best chosen ride recommendation with its 1-tap deep link (card format).
 */
export function formatBestRideMessage(comparison) {
  return formatNaturalRideFallback(comparison);
}

/**
 * End-to-end handler for cab / ride requests.
 */
export async function handleCabRequest({ text, msg = null, intentResult = {} }) {
  const extracted = intentResult.cabBooking || parseCabEntities(text);

  const comparison = await getRideComparison({
    pickupQuery: extracted.pickup || '',
    destinationQuery: extracted.destination || '',
    msg,
    preferredCategory: extracted.category || null,
    preferredProvider: extracted.provider || null,
    excludeProvider: extracted.excludeProvider || null,
  });

  // If user explicitly asks to compare fares, show full matrix. Otherwise deliver the natural conversational reply.
  if (extracted.action === 'compare') {
    return formatRideComparisonMessage(comparison);
  }

  return await naturalizeRideReply(comparison, text);
}

/**
 * Helper to parse destination, pickup, action, and ride preferences from plain text.
 */
export function parseCabEntities(rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  let action = 'book';
  if (/\b(?:compare|comparison|rates|list\s+all|show\s+all|check\s+all)\b/i.test(lower)) {
    action = 'compare';
  }

  let excludeProvider = null;
  if (/\b(?:no|without|dont\s+have|don't\s+have|skip|exclude|except)\s+(?:namma\s*yatri|ny)\b/i.test(lower)) {
    excludeProvider = 'Namma Yatri';
  } else if (/\b(?:no|without|dont\s+have|don't\s+have|skip|exclude|except)\s+uber\b/i.test(lower)) {
    excludeProvider = 'Uber';
  } else if (/\b(?:no|without|dont\s+have|don't\s+have|skip|exclude|except)\s+ola\b/i.test(lower)) {
    excludeProvider = 'Ola';
  }

  let provider = null;
  if (!excludeProvider || excludeProvider !== 'Namma Yatri') {
    if (lower.includes('namma yatri') || lower.includes('nammayatri')) provider = 'Namma Yatri';
  }
  if (!provider && (!excludeProvider || excludeProvider !== 'Uber')) {
    if (lower.includes('uber')) provider = 'Uber';
  }
  if (!provider && (!excludeProvider || excludeProvider !== 'Ola')) {
    if (lower.includes('ola')) provider = 'Ola';
  }

  let category = null;
  if (/\b(?:autos?|rickshaws?|tuk\s*tuks?)\b/i.test(lower)) category = 'auto';
  else if (/\b(?:bikes?|motos?|two\s*wheelers?)\b/i.test(lower)) category = 'bike';
  else if (/\b(?:sedans?|premiers?|primes?)\b/i.test(lower)) category = 'sedan';
  else if (/\b(?:cabs?|taxis?|cars?|rides?)\b/i.test(lower)) category = 'cab';

  // Clean excluded phrases from raw query for cleaner destination extraction
  const cleanedText = text
    .replace(/\b(?:without|dont\s+have|don't\s+have|skip|exclude|except|no)\s+(?:namma\s*yatri|uber|ola|ny)\b/gi, '')
    .trim();

  const cleanStr = (s) => (s || '').trim().replace(/^[,.\s-]+|[,.\s-]+$/g, '');

  // Pattern: "from X to Y"
  const fromToMatch = cleanedText.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:$|\s+via|\s+in\s+an?|\s+using)/i);
  if (fromToMatch) {
    return {
      action,
      pickup: cleanStr(fromToMatch[1]),
      destination: cleanStr(fromToMatch[2]),
      provider,
      excludeProvider,
      category,
    };
  }

  // Pattern: "to Y" or "cab to Y"
  const toMatch = cleanedText.match(/\bto\s+(.+?)(?:$|\s+via|\s+using|\s+in\s+an?)/i);
  if (toMatch) {
    return {
      action,
      pickup: '',
      destination: cleanStr(toMatch[1]),
      provider,
      excludeProvider,
      category,
    };
  }

  return {
    action,
    pickup: '',
    destination: cleanStr(cleanedText.replace(/^(?:book|get|find|compare|check)\s+(?:me\s+)?(?:an?|the\s+)?(?:cabs?|taxis?|rides?|autos?|bikes?|ubers?|olas?|namma\s+yatri)\s*/i, '')),
    provider,
    excludeProvider,
    category,
  };
}
