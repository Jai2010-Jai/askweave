/**
 * Universal & Native App Deep Link Generators for Swiggy Food & Instamart.
 */

export function generateFoodCartDeepLink({ restaurantId, items = [] } = {}) {
  const universalUrl = 'https://www.swiggy.com/cart';
  const appScheme = 'swiggy://cart';
  return {
    universalUrl,
    appScheme,
    checkoutUrl: universalUrl,
  };
}

export function generateRestaurantDeepLink({ restaurantId, slug = 'restaurant' }) {
  // Extract numeric digits; Swiggy requires restaurantId to be a positive integer > 0
  const digits = String(restaurantId || '').replace(/\D+/g, '');
  const numericId = digits && parseInt(digits, 10) > 0 ? digits : '18973';

  const safeSlug = (slug || 'restaurant')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'restaurant';

  const universalUrl = `https://www.swiggy.com/restaurants/${safeSlug}-${numericId}`;
  const appScheme = `swiggy://menu?restaurant_id=${numericId}`;
  return { universalUrl, appScheme, numericId };
}

export function generateInstamartCartDeepLink({ items = [] } = {}) {
  const universalUrl = 'https://www.swiggy.com/instamart/cart';
  const appScheme = 'swiggy://instamart/cart';
  return {
    universalUrl,
    appScheme,
    checkoutUrl: universalUrl,
  };
}

export function generateInstamartSearchDeepLink({ query = '' } = {}) {
  const q = encodeURIComponent(query.trim());
  const universalUrl = `https://www.swiggy.com/instamart/search?query=${q}`;
  const appScheme = `swiggy://instamart/search?query=${q}`;
  return { universalUrl, appScheme };
}

export function generateOrderTrackingDeepLink({ orderId, service = 'food' }) {
  const safeOrderId = encodeURIComponent(orderId);
  const universalUrl = `https://www.swiggy.com/orders/${safeOrderId}`;
  const appScheme = `swiggy://track/${safeOrderId}`;
  return { universalUrl, appScheme };
}
