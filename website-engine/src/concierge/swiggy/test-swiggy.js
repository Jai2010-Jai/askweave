import assert from 'assert';
import {
  generateFoodCartDeepLink,
  generateInstamartCartDeepLink,
  generateRestaurantDeepLink,
  generateOrderTrackingDeepLink,
} from './deepLinks.js';
import { getSwiggyAuthStatus, getSwiggyToken } from './swiggyAuth.js';
import { swiggyMcpClient } from './swiggyClient.js';
import {
  parseSwiggyEntities,
  handleSwiggyRequest,
  formatCartSummaryCard,
} from './swiggyService.js';

console.log('🧪 Starting Swiggy MCP & Concierge Integration Tests...\n');

// 1. Deep Links Generation
console.log('--- 1. Testing Deep Link Generators ---');
const foodCartLink = generateFoodCartDeepLink();
assert.strictEqual(foodCartLink.universalUrl, 'https://www.swiggy.com/cart');
assert.strictEqual(foodCartLink.appScheme, 'swiggy://cart');

const imCartLink = generateInstamartCartDeepLink();
assert.strictEqual(imCartLink.universalUrl, 'https://www.swiggy.com/instamart/cart');
assert.strictEqual(imCartLink.appScheme, 'swiggy://instamart/cart');

const restLink = generateRestaurantDeepLink({ restaurantId: '12345', slug: 'meghana' });
assert.ok(restLink.universalUrl.includes('restaurants/meghana-12345'));
assert.strictEqual(restLink.appScheme, 'swiggy://menu?restaurant_id=12345');

const trackLink = generateOrderTrackingDeepLink({ orderId: 'SWG-9988' });
assert.strictEqual(trackLink.universalUrl, 'https://www.swiggy.com/orders/SWG-9988');
console.log('✅ Deep link tests passed.');

// 2. Authentication Status
console.log('\n--- 2. Testing Swiggy Auth Manager ---');
const authStatus = getSwiggyAuthStatus();
assert.ok(typeof authStatus.authenticated === 'boolean');
console.log(`✅ Auth status retrieved: authenticated=${authStatus.authenticated}`);

// 3. MCP Client Tool Execution (Mock / Offline fallback)
console.log('\n--- 3. Testing Swiggy MCP Client Tools ---');
async function testMcpClient() {
  const rests = await swiggyMcpClient.callTool('food', 'search_restaurants', { query: 'pizza' });
  assert.ok(Array.isArray(rests.restaurants), 'Restaurants must be an array');
  assert.ok(rests.restaurants.length > 0, 'Should find at least 1 restaurant');
  assert.ok(rests.restaurants[0].name.toLowerCase().includes('domino'), 'First result should be Domino');

  const menu = await swiggyMcpClient.callTool('food', 'get_restaurant_menu', { restaurantId: 'rest_dominos' });
  assert.ok(menu.categories.length > 0, 'Menu must have categories');

  const imItems = await swiggyMcpClient.callTool('instamart', 'search_instamart', { query: 'milk' });
  assert.ok(imItems.items.length > 0, 'Instamart must return milk items');
  assert.ok(imItems.items[0].name.toLowerCase().includes('milk'), 'First item should be milk');

  const coupons = await swiggyMcpClient.callTool('food', 'fetch_food_coupons', {});
  assert.ok(coupons.coupons.length > 0, 'Should fetch active coupons');

  const track = await swiggyMcpClient.callTool('food', 'track_food_order', { orderId: 'SWG-10293' });
  assert.strictEqual(track.status, 'OUT_FOR_DELIVERY');
  assert.ok(track.deliveryPartner.name, 'Tracking should include partner name');
  console.log('✅ Swiggy MCP client tool calls passed.');
}

// 4. Entity Extraction
console.log('\n--- 4. Testing Entity Extraction ---');
const e1 = parseSwiggyEntities("Order 2 Margherita Pizza from Domino's");
assert.strictEqual(e1.action, 'cart_add');
assert.strictEqual(e1.quantity, 2);
assert.strictEqual(e1.restaurantQuery, "Domino's");

const e2 = parseSwiggyEntities('Buy 3 Nandini milk from instamart');
assert.strictEqual(e2.action, 'cart_add');
assert.strictEqual(e2.service, 'instamart');
assert.strictEqual(e2.quantity, 3);

const e3 = parseSwiggyEntities('show menu for Empire');
assert.strictEqual(e3.action, 'menu');
assert.strictEqual(e3.restaurantQuery, 'Empire');

const e4 = parseSwiggyEntities('view cart');
assert.strictEqual(e4.action, 'cart_view');

const e5 = parseSwiggyEntities('apply coupon WELCOME50');
assert.strictEqual(e5.action, 'apply_coupon');
assert.strictEqual(e5.couponCode, 'WELCOME50');

const e6 = parseSwiggyEntities('checkout');
assert.strictEqual(e6.action, 'checkout');

const e7 = parseSwiggyEntities('where is my order #SWG-5544');
assert.strictEqual(e7.action, 'track');
console.log('✅ Entity extraction tests passed.');

// 5. Full Concierge Request Flow (Search -> Add -> Coupon -> Checkout -> Track)
console.log('\n--- 5. Testing End-to-End Concierge Flow ---');
async function testFullFlow() {
  const testJid = 'test_user_swiggy@s.whatsapp.net';

  // Step A: Search Restaurants
  const searchCard = await handleSwiggyRequest({
    text: 'swiggy biryani',
    jid: testJid,
    naturalize: false,
  });
  assert.ok(searchCard.includes('Swiggy Food Search'), 'Should return search card');
  assert.ok(searchCard.includes('Meghana Foods'), 'Should list Meghana Foods');

  // Step B: View Menu
  const menuCard = await handleSwiggyRequest({
    text: "show menu for Domino's",
    jid: testJid,
    naturalize: false,
  });
  assert.ok(menuCard.includes("Domino's Pizza — Menu"), 'Should return menu card');

  // Step C: Add Items to Cart
  const cartCard1 = await handleSwiggyRequest({
    text: "Order 1 Margherita Pizza from Domino's",
    jid: testJid,
    naturalize: false,
  });
  assert.ok(cartCard1.includes('Swiggy Cart'), 'Should return cart summary');
  assert.ok(cartCard1.includes('Margherita Pizza'), 'Cart should contain Margherita Pizza');

  // Step D: Apply Coupon
  const couponCard = await handleSwiggyRequest({
    text: 'apply coupon WELCOME50',
    jid: testJid,
    naturalize: false,
  });
  assert.ok(couponCard.includes('WELCOME50'), 'Coupon should be applied');

  // Step E: Checkout Handover
  const checkoutCard = await handleSwiggyRequest({
    text: 'checkout',
    jid: testJid,
    naturalize: false,
  });
  assert.ok(checkoutCard.includes('Checkout Summary'), 'Should render checkout card');
  assert.ok(checkoutCard.includes('https://www.swiggy.com/cart'), 'Should include 1-tap checkout link');
  assert.ok(checkoutCard.includes('swiggy://cart'), 'Should include native app scheme');

  // Step F: Instamart Search & Add
  const imJid = 'test_im_user@s.whatsapp.net';
  const imCard = await handleSwiggyRequest({
    text: 'Buy 2 Nandini Toned Fresh Milk from instamart',
    jid: imJid,
    naturalize: false,
  });
  assert.ok(imCard.includes('Instamart Grocery Cart'), 'Should return Instamart cart');
  assert.ok(imCard.includes('Nandini Toned Fresh Milk'), 'Cart should contain Nandini Milk');

  // Step G: Track Order
  const trackCard = await handleSwiggyRequest({
    text: 'track my order #SWG-10293',
    jid: testJid,
    naturalize: false,
  });
  assert.ok(trackCard.includes('Live Order Tracking'), 'Should return tracking card');
  assert.ok(trackCard.includes('Ramesh Kumar'), 'Should include delivery partner');

  // Step H: Naturalize with Custom Model
  const naturalReply = await handleSwiggyRequest({
    text: 'swiggy biryani',
    jid: testJid,
    naturalize: true,
  });
  assert.ok(naturalReply && naturalReply.length > 0, 'Natural reply should not be empty');
  assert.ok(!/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}]/u.test(naturalReply), 'Natural reply must have zero emojis');
  assert.ok(naturalReply.includes('http') || naturalReply.includes('swiggy'), 'Natural reply should preserve Swiggy links');

  console.log('✅ End-to-end concierge flow tests passed.');
}

async function runAll() {
  await testMcpClient();
  await testFullFlow();
  console.log('\n🎉 ALL SWIGGY MCP & CONCIERGE TESTS PASSED SUCCESSFULLY!');
}

runAll().catch((err) => {
  console.error('\n❌ Test suite failed:', err);
  process.exit(1);
});
