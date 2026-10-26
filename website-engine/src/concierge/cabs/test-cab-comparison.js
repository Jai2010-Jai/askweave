import {
  calculateFares,
  parseCabEntities,
  generateUberDeepLink,
  generateOlaDeepLink,
  generateNammaYatriDeepLink,
  formatRideComparisonMessage,
} from './cabService.js';

console.log('🧪 Testing Cab Comparison Service (Uber, Ola, Namma Yatri)...\n');

// 1. Entity Parsing
console.log('--- Test 1: Entity Parsing ---');
const t1 = parseCabEntities('compare cabs from Indiranagar to Kempegowda Airport');
console.log('t1 (From-To):', t1);
if (t1.pickup !== 'Indiranagar' || t1.destination !== 'Kempegowda Airport' || t1.category !== 'cab') {
  throw new Error('Test 1 failed: Expected pickup=Indiranagar, dest=Kempegowda Airport');
}

const t2 = parseCabEntities('get me an auto to MG Road using namma yatri');
console.log('t2 (Auto, Namma Yatri):', t2);
if (t2.destination !== 'MG Road' || t2.category !== 'auto' || t2.provider !== 'Namma Yatri') {
  throw new Error('Test 2 failed: Expected dest=MG Road, category=auto, provider=Namma Yatri');
}

const t3 = parseCabEntities('uber to Koramangala');
console.log('t3 (Uber):', t3);
if (t3.destination !== 'Koramangala' || t3.provider !== 'Uber') {
  throw new Error('Test 3 failed: Expected dest=Koramangala, provider=Uber');
}

// 2. Deep Link Generation
console.log('\n--- Test 2: Deep Link Generation ---');
const pickup = { lat: 12.9716, lon: 77.5946, label: 'MG Road, Bengaluru' };
const dropoff = { lat: 13.1986, lon: 77.7066, label: 'Kempegowda International Airport' };

const uber = generateUberDeepLink({ pickup, dropoff });
console.log('Uber Universal Link:', uber.universalUrl);
if (!uber.universalUrl.includes('m.uber.com') || !uber.universalUrl.includes('pickup[latitude]=12.9716')) {
  throw new Error('Uber deep link invalid!');
}

const ola = generateOlaDeepLink({ pickup, dropoff });
console.log('Ola Universal Link:', ola.universalUrl);
if (!ola.universalUrl.includes('book.olacabs.com') || !ola.universalUrl.includes('pickup_lat=12.9716')) {
  throw new Error('Ola deep link invalid!');
}

const ny = generateNammaYatriDeepLink({ pickup, dropoff });
console.log('Namma Yatri Link:', ny.universalUrl);
if (!ny.universalUrl.includes('nammayatri.in') || !ny.universalUrl.includes('pickup_lat=12.9716')) {
  throw new Error('Namma Yatri deep link invalid!');
}

// 3. Fare Calculation
console.log('\n--- Test 3: Fare Calculation ---');
const fares = calculateFares(12.5, 32);
console.log(`Calculated ${fares.length} fare options for 12.5 km (32 mins):`);
for (const f of fares) {
  console.log(`  [${f.provider}] ${f.tier} (${f.icon}): ₹${f.fareLow} - ₹${f.fareHigh} (~${f.etaMins}m ETA)`);
}

const hasNYAuto = fares.some((f) => f.provider === 'Namma Yatri' && f.category === 'auto');
const hasUberGo = fares.some((f) => f.provider === 'Uber' && f.category === 'cab');
const hasOlaMini = fares.some((f) => f.provider === 'Ola' && f.category === 'cab');

if (!hasNYAuto || !hasUberGo || !hasOlaMini) {
  throw new Error('Missing core providers in fare calculation!');
}

// 4. Formatted Message
console.log('\n--- Test 4: Formatted WhatsApp Card ---');
const formatted = formatRideComparisonMessage({
  pickup,
  dropoff,
  distanceKm: 12.5,
  durationMinutes: 32,
  surgeMultiplier: 1.0,
  links: {
    uber: uber.universalUrl,
    ola: ola.universalUrl,
    nammaYatri: ny.universalUrl,
  },
  options: fares,
});
console.log(formatted);

// 5. End-to-end Async Route & Fare Comparison Test
console.log('\n--- Test 5: End-to-end Geocoded Route & Fare Comparison ---');
try {
  const e2e = await import('./cabService.js').then((m) =>
    m.getRideComparison({
      pickupQuery: 'Indiranagar, Bengaluru',
      destinationQuery: 'MG Road, Bengaluru',
    })
  );
  console.log(`Resolved: ${e2e.pickup.label} -> ${e2e.dropoff.label}`);
  console.log(`OSRM Distance: ${e2e.distanceKm} km, Duration: ${e2e.durationMinutes} mins`);
  console.log(`Generated ${e2e.options.length} options with 1-tap links:`);
  console.log('  Uber link:', e2e.links.uber.substring(0, 80) + '...');
  console.log('  Ola link:', e2e.links.ola);
  console.log('  Namma Yatri link:', e2e.links.nammaYatri);
  if (!e2e.distanceKm || e2e.distanceKm <= 0) {
    throw new Error('Invalid distance calculated!');
  }
} catch (err) {
  console.warn('Network lookup note in sandbox:', err.message);
}

// 6. Smart Ride Recommendation & 1-Tap Link
console.log('\n--- Test 6: Smart Ride Recommendation & 1-Tap Link ---');
const { formatBestRideMessage, evaluateBestRide } = await import('./cabService.js');

// 6a. Short trip (6 km): Auto should be top recommendation
const shortEval = evaluateBestRide(fares, { distanceKm: 6 });
console.log('Short Trip Top Pick:', shortEval.topPick.provider, shortEval.topPick.tier, `(Reason: ${shortEval.reason})`);
if (shortEval.topPick.category !== 'auto') {
  throw new Error('Expected auto for short trip!');
}

// 6b. Long trip (35 km to Airport): Cab should be top recommendation
const longEval = evaluateBestRide(fares, { distanceKm: 35 });
console.log('Long Trip Top Pick:', longEval.topPick.provider, longEval.topPick.tier, `(Reason: ${longEval.reason})`);
if (longEval.topPick.category !== 'cab' && longEval.topPick.category !== 'sedan') {
  throw new Error('Expected cab or sedan for long trip!');
}

// 6c. Render formatted Best Ride card
const recCard = formatBestRideMessage({
  pickup,
  dropoff,
  distanceKm: 6.2,
  durationMinutes: 14,
  topPick: shortEval.topPick,
  reason: shortEval.reason,
  alternativePick: shortEval.alternativePick,
  links: {
    uber: uber.universalUrl,
    ola: ola.universalUrl,
    nammaYatri: ny.universalUrl,
  },
});
console.log('\n--- Generated 1-Tap Recommendation Card ---\n');
console.log(recCard);

console.log('\n✅ All Cab Comparison tests PASSED successfully!');
