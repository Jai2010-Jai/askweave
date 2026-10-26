import { swiggyMcpClient } from './swiggyClient.js';
import { getSwiggyAuthStatus } from './swiggyAuth.js';
import {
  generateFoodCartDeepLink,
  generateInstamartCartDeepLink,
  generateRestaurantDeepLink,
  generateOrderTrackingDeepLink,
} from './deepLinks.js';
import { extractLocationFromMessage } from '../location.js';
import { naturalizeWithCustomModel, stripEmojis } from '../../nlp/fast-router.js';

// In-memory session store mapped by WhatsApp JID
const userSessions = new Map();

function getOrCreateSession(jid) {
  if (!userSessions.has(jid)) {
    userSessions.set(jid, {
      service: 'food',
      restaurantId: null,
      restaurantName: null,
      cart: [],
      selectedCoupon: null,
      address: null,
      lastOrder: null,
      updatedAt: Date.now(),
    });
  }
  const session = userSessions.get(jid);
  session.updatedAt = Date.now();
  return session;
}

/**
 * Natural Language and Regex Entity Parser for Swiggy food and Instamart requests.
 */
export function parseSwiggyEntities(rawText) {
  const text = (rawText || '').trim();
  const lower = text.toLowerCase();

  // 0. Auth Status / Connect
  if (/\b(?:swiggy\s+auth|swiggy\s+login|connect\s+swiggy|swiggy\s+status|login\s+to\s+swiggy)\b/i.test(lower)) {
    return { action: 'auth_status' };
  }

  // 1. Order Tracking
  if (/\b(?:track(?:ing)?|where\s+is\s+my|status\s+of)\b/i.test(lower) && /\b(?:order|food|grocer(?:y|ies)|swiggy|delivery)\b/i.test(lower)) {
    const orderMatch = text.match(/#?([a-zA-Z0-9_-]{5,20})/);
    return {
      action: 'track',
      service: lower.includes('instamart') || lower.includes('grocery') ? 'instamart' : 'food',
      orderId: orderMatch ? orderMatch[1] : null,
    };
  }

  // 2. Cart Operations: Clear
  if (/\b(?:clear|empty|flush|delete|reset)\s+(?:my\s+)?(?:food\s+)?cart\b/i.test(lower)) {
    return { action: 'cart_clear' };
  }

  // 3. Cart Operations: View
  if (/^(?:view|show|check|what(?:'s|\s+is)\s+in)\s+(?:my\s+)?(?:food\s+)?cart\b/i.test(lower) || lower === 'cart' || lower === 'my cart') {
    return { action: 'cart_view' };
  }

  // 4. Cart Operations: Checkout
  if (/\b(?:checkout|place\s+order|proceed\s+to\s+pay|pay\s+now|finish\s+order|done\s+ordering)\b/i.test(lower)) {
    return { action: 'checkout' };
  }

  // 5. Coupon Application
  if (/\b(?:apply|add)\s+coupon\b/i.test(lower) || /\bcoupons?\b/i.test(lower)) {
    const codeMatch = text.match(/\bcoupon\s+([A-Za-z0-9]+)\b/i);
    return {
      action: 'apply_coupon',
      couponCode: codeMatch ? codeMatch[1].toUpperCase() : null,
    };
  }

  // 6. Menu Inquiry
  if (/\b(?:menu|dishes|catalog)\b/i.test(lower)) {
    const restMatch = text.match(/(?:menu\s+(?:for|of|from)|show\s+menu\s+(?:for|from)?)\s+([a-zA-Z0-9\s'’]+)/i);
    return {
      action: 'menu',
      service: 'food',
      restaurantQuery: restMatch ? restMatch[1].trim() : null,
    };
  }

  // 7. Generic Swiggy Invocation (e.g. "swiggy?", "order from swiggy please", "swiggy")
  if (/^(?:swiggy\??|order\s+(?:from\s+)?swiggy(?:\s+please)?|open\s+swiggy|swiggy\s+food)$/i.test(lower)) {
    return { action: 'welcome', service: 'food' };
  }

  // 8. Instamart Grocery Search or Addition
  const isInstamart =
    lower.includes('instamart') ||
    lower.includes('grocery') ||
    lower.includes('groceries') ||
    /\b(?:buy|get|need)\s+(?:amul|nandini|milk|eggs|bread|curd|chips|potatoes?|onions?|tomatoes?|coke|soft\s+drink)\b/i.test(lower);

  // 9. Item Addition (e.g. "Add 2 Margherita pizzas", "Order 1 chicken biryani from meghana")
  const addMatch = text.match(/(?:add|order|get|buy)\s+(?:me\s+)?(\d+)?\s*(.+?)(?:\s+from\s+([a-zA-Z0-9\s'’]+))?$/i);
  if (addMatch && !/\b(?:cabs?|taxis?|rides?|ubers?|olas?)\b/i.test(lower)) {
    const quantity = parseInt(addMatch[1], 10) || 1;
    let itemName = (addMatch[2] || '').trim();
    const restaurant = addMatch[3] ? addMatch[3].trim() : null;

    // Filter out common filler words and prefixes
    itemName = itemName
      .replace(/^(?:an?|the|some)\s+/i, '')
      .replace(/\s+(?:to\s+cart|please)$/i, '')
      .replace(/^(?:from\s+swiggy|swiggy)\b/i, '')
      .trim();

    const ignoredWords = ['order', 'food', 'swiggy', 'swiggy order', 'groceries', 'something', 'anything', 'item', 'items'];
    if (itemName && !ignoredWords.includes(itemName.toLowerCase())) {
      return {
        action: 'cart_add',
        service: isInstamart ? 'instamart' : 'food',
        quantity,
        itemQuery: itemName,
        restaurantQuery: restaurant,
      };
    }
  }

  // 10. General Search (Restaurants, Food items, Cakes, Groceries)
  let cleanSearch = text;
  cleanSearch = cleanSearch.replace(/^(?:yo|hey|hi|hello|please|can you|could you|would you)\s+/i, '');
  cleanSearch = cleanSearch.replace(/^(?:find|search|show|get|suggest|look\s*up|order)\s+(?:for\s+)?(?:me\s+)?(?:some\s+)?(?:good\s+)?(?:food|dishes?|restaurants?)?\s*/i, '');
  cleanSearch = cleanSearch.replace(/\b(?:on|from|in)\s+swiggy\b/gi, '');
  cleanSearch = cleanSearch.replace(/\b(?:that\s+i\s+can\s+order|available\s+to\s+order|to\s+order|online|near\s+me|around\s+here|nearby|please)\b/gi, '');
  cleanSearch = cleanSearch.replace(/^[,\s?.-]+|[,\s?.-]+$/g, '').trim();

  if (!cleanSearch || /^(?:swiggy|food|groceries|something)$/i.test(cleanSearch)) {
    return {
      action: 'welcome',
      service: isInstamart ? 'instamart' : 'food',
    };
  }

  return {
    action: isInstamart ? 'search_instamart' : 'search',
    service: isInstamart ? 'instamart' : 'food',
    query: cleanSearch,
  };
}

/**
 * Calculates current bill details for active cart.
 */
function calculateCartTotals(cart, coupon = null) {
  const subtotal = cart.reduce((sum, item) => sum + item.price * (item.qty || 1), 0);
  const deliveryFee = subtotal > 0 ? (subtotal > 300 ? 0 : 35) : 0;
  const platformFee = subtotal > 0 ? 6 : 0;

  let discount = 0;
  if (coupon && subtotal >= (coupon.minOrder || 0)) {
    if (coupon.discountPercent) {
      discount = Math.min((subtotal * coupon.discountPercent) / 100, coupon.maxDiscount || Infinity);
    } else if (coupon.flatDiscount) {
      discount = Math.min(coupon.flatDiscount, subtotal);
    }
  }

  const taxes = Math.round(subtotal * 0.05); // 5% GST
  const grandTotal = Math.max(0, Math.round(subtotal - discount + deliveryFee + platformFee + taxes));

  return {
    subtotal,
    deliveryFee,
    platformFee,
    discount: Math.round(discount),
    taxes,
    grandTotal,
  };
}

/**
 * Formats restaurant search results as an engaging WhatsApp card.
 */
export function formatRestaurantListCard(restaurants, query) {
  let card = `*Swiggy Food Search:* "${query || 'Nearby'}"\n`;
  card += `Found ${restaurants.length} top-rated restaurants near you:\n\n`;

  restaurants.forEach((r, idx) => {
    const deepLink = generateRestaurantDeepLink({ restaurantId: r.id, slug: r.name });
    card += `*${idx + 1}. ${r.name}* (${r.area || 'Nearby'})\n`;
    card += `   Rating: ${r.rating} • ${r.deliveryTimeMins} mins • ₹${r.priceForTwo} for two\n`;
    card += `   Cuisine: _${r.cuisine}_\n`;
    card += `   Menu & Order: ${deepLink.universalUrl}\n\n`;
  });

  card += `Reply with "menu <restaurant>" to see items, or "order 1 <dish> from <restaurant>" to add to cart.`;
  return card;
}

/**
 * Formats restaurant menu as a WhatsApp card.
 */
export function formatMenuCard(menuData) {
  const rest = menuData.restaurant || { name: 'Restaurant Menu' };
  let card = `*${rest.name} — Menu*\n`;
  if (rest.rating) card += `Rating: ${rest.rating} • ${rest.deliveryTimeMins || 30} mins delivery\n\n`;

  for (const cat of (menuData.categories || []).slice(0, 2)) {
    card += `*${cat.name}:*\n`;
    for (const item of (cat.items || []).slice(0, 5)) {
      const typeTag = item.veg ? '[Veg]' : '[Non-Veg]';
      const best = item.bestseller ? ' (Bestseller)' : '';
      card += `  ${typeTag} *${item.name}*${best} — ₹${item.price}\n`;
    }
    card += `\n`;
  }

  card += `Reply "add 1 <item>" to add to cart, or "checkout" to pay.`;
  return card;
}

/**
 * Formats Instamart grocery catalog as a WhatsApp card.
 */
export function formatInstamartListCard(items, query) {
  let card = `*Swiggy Instamart Grocery Search:* "${query || 'Instant Essentials'}"\n`;
  card += `Delivering in 10 minutes\n\n`;

  items.slice(0, 6).forEach((item, idx) => {
    card += `*${idx + 1}. ${item.name}*\n`;
    card += `   Pack: ${item.pack || 'Standard'} • ₹${item.price}\n`;
    card += `   Category: _${item.category || 'Pantry'}_\n\n`;
  });

  card += `Reply "add <qty> <item>" to add to cart (e.g. "add 2 ${items[0]?.name || 'Milk'}").`;
  return card;
}

/**
 * Formats shopping cart review as a WhatsApp card.
 */
export function formatCartSummaryCard(session) {
  const { cart, service, restaurantName, selectedCoupon } = session;
  if (!cart || cart.length === 0) {
    return `Your Swiggy Cart is empty.\n\nReply with a dish or grocery to add items:\n• "Order 1 Margherita Pizza from Domino's"\n• "Add 2 Amul Milk from Instamart"`;
  }

  const totals = calculateCartTotals(cart, selectedCoupon);
  const heading = service === 'instamart' ? 'Swiggy Instamart Grocery Cart' : `Swiggy Cart: ${restaurantName || 'Food Delivery'}`;

  let card = `*${heading}*\n`;
  card += `──────────────────────\n`;

  cart.forEach((item) => {
    const itemTotal = item.price * (item.qty || 1);
    const typeIndicator = item.veg !== undefined ? (item.veg ? '[Veg]' : '[Non-Veg]') : '[Item]';
    card += `${typeIndicator} *${item.name}* x ${item.qty || 1} = ₹${itemTotal}\n`;
  });

  card += `──────────────────────\n`;
  card += `Subtotal: ₹${totals.subtotal}\n`;
  if (selectedCoupon) {
    if (totals.discount > 0) {
      card += `Coupon (${selectedCoupon.code}): -₹${totals.discount}\n`;
    } else if (selectedCoupon.minOrder && totals.subtotal < selectedCoupon.minOrder) {
      card += `Coupon (${selectedCoupon.code}): Add ₹${selectedCoupon.minOrder - totals.subtotal} more to unlock discount (Min ₹${selectedCoupon.minOrder})\n`;
    } else {
      card += `Coupon (${selectedCoupon.code}) applied\n`;
    }
  }
  card += `Delivery Fee: ${totals.deliveryFee === 0 ? 'FREE' : `₹${totals.deliveryFee}`}\n`;
  card += `Taxes & Platform: ₹${totals.taxes + totals.platformFee}\n`;
  card += `Grand Total: ₹${totals.grandTotal}\n\n`;

  card += `Reply "checkout" to receive your 1-tap payment link, or "clear cart" to remove all items.`;
  return card;
}

/**
 * Formats final 1-tap checkout handover card with deep links.
 */
export function formatCheckoutHandoverCard(session) {
  const { cart, service, restaurantName, restaurantId, selectedCoupon, address } = session;
  if (!cart || cart.length === 0) {
    return `Cannot checkout: Your cart is currently empty.`;
  }

  const totals = calculateCartTotals(cart, selectedCoupon);
  const deepLink =
    service === 'instamart'
      ? generateInstamartCartDeepLink({ items: cart })
      : generateFoodCartDeepLink({ restaurantId, items: cart });

  const addrLabel = address?.name || address?.addressLine || 'Home (Indiranagar)';
  const serviceLabel = service === 'instamart' ? 'Swiggy Instamart' : (restaurantName || 'Swiggy Food');

  let card = `*Swiggy Order Checkout Summary*\n`;
  card += `Store: *${serviceLabel}*\n`;
  card += `Deliver to: ${addrLabel}\n`;
  card += `──────────────────────\n`;

  cart.forEach((item) => {
    card += `• ${item.name} (${item.qty || 1}x) — ₹${item.price * (item.qty || 1)}\n`;
  });

  card += `──────────────────────\n`;
  card += `Final Payable: ₹${totals.grandTotal}\n`;
  if (totals.discount > 0) {
    card += `Saved ₹${totals.discount} with ${selectedCoupon?.code}!\n`;
  }
  card += `\n`;
  card += `Tap the link below to open your pre-filled cart in the Swiggy mobile app or web and complete payment via UPI, GPay, or Card:\n\n`;
  card += `${deepLink.checkoutUrl}\n\n`;
  card += `App Scheme: \`${deepLink.appScheme}\`\n\n`;
  card += `Items remain in your cart for the next 15 minutes.`;

  return card;
}

/**
 * Formats real-time delivery tracking card.
 */
export function formatTrackingCard(trackData) {
  const deepLink = generateOrderTrackingDeepLink({ orderId: trackData.orderId, service: trackData.service });

  let card = `*Swiggy Live Order Tracking*\n`;
  card += `Order ID: *${trackData.orderId}*\n`;
  card += `Status: *${trackData.statusDescription || trackData.status}*\n`;
  card += `Estimated Delivery: ~${trackData.etaMins} mins\n\n`;

  if (trackData.deliveryPartner) {
    card += `Delivery Partner: ${trackData.deliveryPartner.name}\n`;
    card += `Contact: ${trackData.deliveryPartner.phone}\n`;
    if (trackData.deliveryPartner.vehicle) {
      card += `Vehicle: ${trackData.deliveryPartner.vehicle}\n`;
    }
    card += `\n`;
  }

  card += `Store: ${trackData.restaurantOrStore || 'Swiggy Partner'}\n\n`;
  card += `Live Tracker: ${deepLink.universalUrl}`;
  return card;
}

/**
 * Generates raw factual fallback reply for Swiggy Food & Instamart.
 */
export async function _generateRawSwiggyReply({ text, msg, intentResult, jid }) {
  const session = getOrCreateSession(jid || 'default_user');

  // Check if user shared or quoted a location pin
  const locationPin = extractLocationFromMessage(msg);
  if (locationPin) {
    session.address = {
      name: locationPin.label || 'Pinned Location',
      addressLine: locationPin.label || 'Pinned Location',
      lat: locationPin.lat,
      lon: locationPin.lon,
    };
  }

  const entities = parseSwiggyEntities(text);

  // 0. Auth Status / Connect
  if (entities.action === 'auth_status') {
    const status = getSwiggyAuthStatus();
    if (status.authenticated) {
      return `Swiggy Cloud Connected!\n• Account: Verified\n• Live Addresses & Cart Sync: Active\n\nReady to search and order. Try:\n• "Find biryani near me"\n• "Show menu for Domino's"`;
    }
    return `No Swiggy Login Needed!\n\nYou don't need to sign in to use Weave with Swiggy. Just text what you want:\n• "Order 1 Margherita Pizza from Domino's"\n• "Buy 2 milk from Instamart"\n\nWeave builds your cart, applies discounts, and gives you a 1-Tap Swiggy App Link. When you tap it, your phone's Swiggy app opens directly with your existing login and saved addresses ready for UPI payment!`;
  }

  // Welcome / Generic Swiggy Prompt
  if (entities.action === 'welcome') {
    return `Welcome to Swiggy on Weave!\n\nTell me what you want or pick an option:\n• Cakes & Desserts (e.g. Warm Oven, Corner House)\n• Pizza (e.g. Domino's)\n• Biryani (e.g. Meghana Foods, Empire)\n• Burgers (e.g. Truffles)\n• Instamart Groceries (Milk, bread, eggs, snacks)\n\nExamples:\n• "Find cakes near me"\n• "Order 1 Margherita Pizza from Domino's"\n• "Buy 2 milk from Instamart"`;
  }

  // 1. Order Tracking
  if (entities.action === 'track') {
    const trackResult = await swiggyMcpClient.callTool(entities.service, 'track_food_order', {
      orderId: entities.orderId || '#SWG-94812',
    });
    return formatTrackingCard(trackResult);
  }

  // 2. Clear Cart
  if (entities.action === 'cart_clear') {
    session.cart = [];
    session.selectedCoupon = null;
    await swiggyMcpClient.callTool(session.service, 'flush_food_cart', {}).catch(() => {});
    return `Your Swiggy cart has been cleared.`;
  }

  // 3. View Cart
  if (entities.action === 'cart_view') {
    return formatCartSummaryCard(session);
  }

  // 4. Checkout Handover
  if (entities.action === 'checkout') {
    return formatCheckoutHandoverCard(session);
  }

  // 5. Apply Coupon
  if (entities.action === 'apply_coupon') {
    const couponResult = await swiggyMcpClient.callTool(session.service, 'fetch_food_coupons', {});
    const coupons = couponResult?.coupons || [];

    if (entities.couponCode) {
      const match = coupons.find((c) => c.code.toLowerCase() === entities.couponCode.toLowerCase());
      session.selectedCoupon = match || { code: entities.couponCode, flatDiscount: 50, minOrder: 199 };
    } else if (coupons.length > 0) {
      session.selectedCoupon = coupons[0]; // Auto-apply best coupon
    }

    return formatCartSummaryCard(session);
  }

  // 6. View Restaurant Menu
  if (entities.action === 'menu') {
    let targetRestId = session.restaurantId;

    if (entities.restaurantQuery) {
      const searchRes = await swiggyMcpClient.callTool('food', 'search_restaurants', { query: entities.restaurantQuery });
      const found = searchRes?.restaurants?.[0];
      if (found) {
        targetRestId = found.id;
        session.restaurantId = found.id;
        session.restaurantName = found.name;
      }
    }

    const menuRes = await swiggyMcpClient.callTool('food', 'get_restaurant_menu', {
      restaurantId: targetRestId || 'rest_meghana',
    });
    return formatMenuCard(menuRes);
  }

  // 7. Add to Cart (Food or Instamart)
  if (entities.action === 'cart_add') {
    session.service = entities.service;

    if (entities.service === 'instamart') {
      const imRes = await swiggyMcpClient.callTool('instamart', 'search_instamart', { query: entities.itemQuery });
      const matched = imRes?.items?.[0] || {
        id: `im_custom_${Date.now()}`,
        name: entities.itemQuery,
        price: 50,
        pack: 'Standard',
      };

      const existingIndex = session.cart.findIndex((i) => i.name.toLowerCase() === matched.name.toLowerCase());
      if (existingIndex >= 0) {
        session.cart[existingIndex].qty = (session.cart[existingIndex].qty || 1) + entities.quantity;
      } else {
        session.cart.push({ ...matched, qty: entities.quantity });
      }

      await swiggyMcpClient.callTool('instamart', 'update_im_cart', { cart: session.cart }).catch(() => {});
      return formatCartSummaryCard(session);
    }

    // Food addition
    if (entities.restaurantQuery) {
      const searchRes = await swiggyMcpClient.callTool('food', 'search_restaurants', { query: entities.restaurantQuery });
      const found = searchRes?.restaurants?.[0];
      if (found) {
        session.restaurantId = found.id;
        session.restaurantName = found.name;
      }
    }

    const menuRes = await swiggyMcpClient.callTool('food', 'get_restaurant_menu', {
      restaurantId: session.restaurantId || 'rest_meghana',
    });

    let matchedItem = null;
    const qLower = entities.itemQuery.toLowerCase();
    for (const cat of menuRes?.categories || []) {
      for (const itm of cat.items || []) {
        if (itm.name.toLowerCase().includes(qLower) || qLower.includes(itm.name.toLowerCase())) {
          matchedItem = itm;
          break;
        }
      }
      if (matchedItem) break;
    }

    if (!matchedItem) {
      matchedItem = {
        id: `item_custom_${Date.now()}`,
        name: entities.itemQuery,
        price: 250,
        veg: !qLower.includes('chicken') && !qLower.includes('meat') && !qLower.includes('fish'),
      };
    }

    const existingIndex = session.cart.findIndex((i) => i.name.toLowerCase() === matchedItem.name.toLowerCase());
    if (existingIndex >= 0) {
      session.cart[existingIndex].qty = (session.cart[existingIndex].qty || 1) + entities.quantity;
    } else {
      session.cart.push({ ...matchedItem, qty: entities.quantity });
    }

    await swiggyMcpClient.callTool('food', 'update_food_cart', { cart: session.cart }).catch(() => {});
    return formatCartSummaryCard(session);
  }

  // 8. Instamart Grocery Search
  if (entities.action === 'search_instamart') {
    session.service = 'instamart';
    const imRes = await swiggyMcpClient.callTool('instamart', 'search_instamart', { query: entities.query });
    return formatInstamartListCard(imRes?.items || [], entities.query);
  }

  // 9. Food / Restaurant Search (Default)
  session.service = 'food';
  const foodRes = await swiggyMcpClient.callTool('food', 'search_restaurants', { query: entities.query });
  return formatRestaurantListCard(foodRes?.restaurants || [], entities.query);
}

/**
 * Main Concierge Request Handler for Swiggy Food & Instamart.
 * Takes the raw fallback card and runs it through the custom model (Tier 1 Fast Router / OpenRouter / Gemini)
 * to deliver a natural, chill dev response with zero emojis and pristine deep links.
 */
export async function handleSwiggyRequest({ text, msg, intentResult, jid, naturalize = true }) {
  const rawReply = await _generateRawSwiggyReply({ text, msg, intentResult, jid });

  if (!naturalize) {
    return rawReply;
  }

  return await naturalizeWithCustomModel({ userText: text, rawReply });
}
