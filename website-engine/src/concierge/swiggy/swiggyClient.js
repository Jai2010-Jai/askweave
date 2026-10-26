import { getSwiggyToken } from './swiggyAuth.js';

export const SWIGGY_ENDPOINTS = {
  food: process.env.SWIGGY_FOOD_MCP_URL || 'https://mcp.swiggy.com/food',
  instamart: process.env.SWIGGY_IM_MCP_URL || 'https://mcp.swiggy.com/im',
};

// Realistic mock dataset for development and offline testing
const MOCK_DATA = {
  addresses: [
    {
      id: 'addr_home',
      name: 'Home',
      addressLine: '12th Main Road, HAL 2nd Stage, Indiranagar',
      city: 'Bengaluru',
      lat: 12.9716,
      lon: 77.6412,
      isDefault: true,
    },
    {
      id: 'addr_office',
      name: 'Office',
      addressLine: 'Sony World Signal, 100ft Road, Koramangala 4th Block',
      city: 'Bengaluru',
      lat: 12.9352,
      lon: 77.6245,
      isDefault: false,
    },
  ],
  restaurants: [
    {
      id: '121603',
      name: 'Meghana Foods',
      cuisine: 'Biryani, Andhra, South Indian',
      rating: 4.5,
      deliveryTimeMins: 28,
      priceForTwo: 500,
      area: 'Indiranagar',
      imageUrl: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_660/xqwpuhgnsaf18nxdgahm',
    },
    {
      id: '10575',
      name: "Domino's Pizza",
      cuisine: 'Pizzas, Italian, Pastas, Desserts',
      rating: 4.4,
      deliveryTimeMins: 25,
      priceForTwo: 400,
      area: 'HAL 2nd Stage',
      imageUrl: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_660/d206f0e4b85098ffb4f4c9c1c4e97d1e',
    },
    {
      id: '428',
      name: 'Truffles',
      cuisine: 'Burgers, American, Continental, Desserts',
      rating: 4.6,
      deliveryTimeMins: 32,
      priceForTwo: 450,
      area: 'Koramangala 5th Block',
      imageUrl: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_660/cd832d61721be0e37a23b6e39544e269',
    },
    {
      id: '5032',
      name: 'Hotel Empire',
      cuisine: 'North Indian, Kebabs, Biryani, Mughlai',
      rating: 4.2,
      deliveryTimeMins: 30,
      priceForTwo: 450,
      area: 'Indiranagar',
      imageUrl: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_660/weuqb2wew6y2zffehsbb',
    },
    {
      id: '23678',
      name: 'Corner House Ice Creams',
      cuisine: 'Desserts, Ice Creams, Sundaes, Cakes',
      rating: 4.8,
      deliveryTimeMins: 20,
      priceForTwo: 300,
      area: 'Indiranagar',
      imageUrl: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_660/j0wwh99d6g9m67l8e7j6',
    },
    {
      id: '18973',
      name: 'Warm Oven Cakes & Desserts',
      cuisine: 'Cakes, Pastries, Bakery, Desserts',
      rating: 4.5,
      deliveryTimeMins: 24,
      priceForTwo: 350,
      area: 'Indiranagar',
      imageUrl: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_660/e0839ff574213e6f35b3899ebf1fc597',
    },
  ],
  menus: {
    '121603': [
      { id: 'item_m1', name: 'Meghana Special Chicken Biryani', price: 340, veg: false, bestseller: true },
      { id: 'item_m2', name: 'Paneer Biryani', price: 290, veg: true, bestseller: true },
      { id: 'item_m3', name: 'Boneless Chicken 65', price: 310, veg: false, bestseller: false },
      { id: 'item_m4', name: 'Guntur Chicken Dry', price: 320, veg: false, bestseller: true },
    ],
    rest_meghana: [
      { id: 'item_m1', name: 'Meghana Special Chicken Biryani', price: 340, veg: false, bestseller: true },
      { id: 'item_m2', name: 'Paneer Biryani', price: 290, veg: true, bestseller: true },
    ],
    '10575': [
      { id: 'item_d1', name: 'Margherita Pizza (Regular)', price: 159, veg: true, bestseller: true },
      { id: 'item_d2', name: 'Farmhouse Pizza (Medium)', price: 399, veg: true, bestseller: true },
      { id: 'item_d3', name: 'Pepper Barbecue Chicken Pizza (Medium)', price: 449, veg: false, bestseller: true },
      { id: 'item_d4', name: 'Garlic Breadsticks with Dip', price: 139, veg: true, bestseller: true },
      { id: 'item_d5', name: 'Choco Lava Cake', price: 109, veg: true, bestseller: true },
    ],
    rest_dominos: [
      { id: 'item_d1', name: 'Margherita Pizza (Regular)', price: 159, veg: true, bestseller: true },
    ],
    '428': [
      { id: 'item_t1', name: 'All American Cheese Burger', price: 220, veg: false, bestseller: true },
      { id: 'item_t2', name: 'Crispy Veg Burger', price: 180, veg: true, bestseller: true },
      { id: 'item_t3', name: 'Peri Peri French Fries', price: 140, veg: true, bestseller: true },
      { id: 'item_t4', name: 'Ferrero Rocher Shake', price: 210, veg: true, bestseller: true },
    ],
    rest_truffles: [
      { id: 'item_t1', name: 'All American Cheese Burger', price: 220, veg: false, bestseller: true },
    ],
    '5032': [
      { id: 'item_e1', name: 'Empire Special Chicken Kebab (Quarter)', price: 175, veg: false, bestseller: true },
      { id: 'item_e2', name: 'Butter Chicken Masala', price: 280, veg: false, bestseller: true },
      { id: 'item_e3', name: 'Paneer Butter Masala', price: 240, veg: true, bestseller: true },
      { id: 'item_e4', name: 'Butter Naan', price: 50, veg: true, bestseller: true },
      { id: 'item_e5', name: 'Coin Parotta (2 pcs)', price: 60, veg: true, bestseller: true },
    ],
    rest_empire: [
      { id: 'item_e1', name: 'Empire Special Chicken Kebab (Quarter)', price: 175, veg: false, bestseller: true },
    ],
    '23678': [
      { id: 'item_ch1', name: 'Death By Chocolate (DBC)', price: 260, veg: true, bestseller: true },
      { id: 'item_ch2', name: 'Hot Caramello Sundae', price: 210, veg: true, bestseller: true },
      { id: 'item_ch3', name: 'Trilogy Sundae', price: 230, veg: true, bestseller: false },
    ],
    rest_corner_house: [
      { id: 'item_ch1', name: 'Death By Chocolate (DBC)', price: 260, veg: true, bestseller: true },
    ],
    '18973': [
      { id: 'item_wo1', name: 'German Chocolate Cake (500g)', price: 499, veg: true, bestseller: true },
      { id: 'item_wo2', name: 'Red Velvet Pastry', price: 129, veg: true, bestseller: true },
      { id: 'item_wo3', name: 'Death By Chocolate Jar Cake', price: 169, veg: true, bestseller: true },
      { id: 'item_wo4', name: 'Black Forest Cake (500g)', price: 449, veg: true, bestseller: false },
    ],
    rest_warm_oven: [
      { id: 'item_wo1', name: 'German Chocolate Cake (500g)', price: 499, veg: true, bestseller: true },
    ],
  },
  instamartItems: [
    { id: 'im_milk_1', name: 'Nandini Toned Fresh Milk', pack: '500 ml', price: 24, category: 'Dairy & Bread' },
    { id: 'im_milk_2', name: 'Amul Taaza Homogenised Toned Milk', pack: '1 L', price: 74, category: 'Dairy & Bread' },
    { id: 'im_eggs_1', name: 'Farm Fresh White Eggs (Pack of 6)', pack: '6 pcs', price: 54, category: 'Dairy & Bread' },
    { id: 'im_bread_1', name: 'Britannia 100% Whole Wheat Bread', pack: '400 g', price: 45, category: 'Dairy & Bread' },
    { id: 'im_curd_1', name: 'Milky Mist Farm Fresh Curd Pouch', pack: '500 g', price: 40, category: 'Dairy & Bread' },
    { id: 'im_chips_1', name: "Lay's India's Magic Masala Potato Chips", pack: '50 g', price: 20, category: 'Snacks & Munchies' },
    { id: 'im_coke_1', name: 'Coca-Cola Soft Drink Bottle', pack: '750 ml', price: 40, category: 'Cold Drinks' },
    { id: 'im_onion_1', name: 'Fresh Onion (Pyaz)', pack: '1 kg', price: 38, category: 'Fruits & Vegetables' },
    { id: 'im_tomato_1', name: 'Fresh Hybrid Tomato (Tamatar)', pack: '1 kg', price: 32, category: 'Fruits & Vegetables' },
    { id: 'im_potato_1', name: 'Fresh Potato (Aloo)', pack: '1 kg', price: 35, category: 'Fruits & Vegetables' },
  ],
  coupons: [
    { code: 'WELCOME50', description: '50% off up to ₹100 on orders above ₹199', discountPercent: 50, maxDiscount: 100, minOrder: 199 },
    { code: 'SWIGGYIT', description: 'Flat ₹50 off on orders above ₹249', flatDiscount: 50, minOrder: 249 },
    { code: 'FEAST100', description: '₹100 off on party orders above ₹599', flatDiscount: 100, minOrder: 599 },
  ],
};

let jsonRpcId = 1;

export class SwiggyMcpClient {
  constructor(options = {}) {
    this.mockMode = options.mockMode ?? (process.env.SWIGGY_MOCK === 'true' || !getSwiggyToken());
    this.endpoints = { ...SWIGGY_ENDPOINTS, ...options.endpoints };
    this.timeoutMs = options.timeoutMs || 15000;
  }

  isMock() {
    return this.mockMode || !getSwiggyToken();
  }

  /**
   * Executes a remote tool call via JSON-RPC 2.0 to the target Swiggy MCP server.
   */
  async callTool(service = 'food', toolName, args = {}) {
    const token = getSwiggyToken();

    // If in mock mode or token is missing, serve locally simulated responses
    if (this.mockMode || !token) {
      return this._executeMockTool(service, toolName, args);
    }

    const endpoint = this.endpoints[service] || this.endpoints.food;
    const payload = {
      jsonrpc: '2.0',
      id: jsonRpcId++,
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
      },
    };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        console.warn(`⚠️ [Swiggy MCP] Server error HTTP ${res.status}: ${errorText.slice(0, 150)}`);
        // Fall back gracefully to mock for dev resilience
        return this._executeMockTool(service, toolName, args);
      }

      const json = await res.json();
      if (json.error) {
        throw new Error(json.error.message || `Swiggy MCP error: ${JSON.stringify(json.error)}`);
      }

      return json.result || json;
    } catch (err) {
      console.warn(`⚠️ [Swiggy MCP] Request failed (${err.message}). Falling back to local catalog simulation.`);
      return this._executeMockTool(service, toolName, args);
    }
  }

  /**
   * Local deterministic simulator for all Swiggy Food and Instamart MCP tools.
   */
  _executeMockTool(service, toolName, args = {}) {
    switch (toolName) {
      case 'get_addresses': {
        return { addresses: MOCK_DATA.addresses };
      }

      case 'search_restaurants': {
        const rawQ = (args.query || '').toLowerCase().trim();
        const query = rawQ.replace(/s$/, ''); // e.g. "cakes" -> "cake", "pizzas" -> "pizza"
        let matches = MOCK_DATA.restaurants;
        if (query) {
          matches = matches.filter((r) => {
            const hasRestMatch =
              r.name.toLowerCase().includes(query) ||
              r.cuisine.toLowerCase().includes(query) ||
              r.area.toLowerCase().includes(query);
            if (hasRestMatch) return true;
            const menuItems = MOCK_DATA.menus[r.id] || [];
            return menuItems.some((item) => item.name.toLowerCase().includes(query));
          });
        }
        return {
          restaurants: matches.length > 0 ? matches : MOCK_DATA.restaurants.slice(0, 3),
          total: matches.length,
        };
      }

      case 'get_restaurant_menu': {
        const restId = String(args.restaurantId || '18973');
        const restaurant =
          MOCK_DATA.restaurants.find((r) => r.id === restId || r.id === `rest_${restId}` || `rest_${r.id}` === restId) ||
          MOCK_DATA.restaurants[0];
        const menuItems = MOCK_DATA.menus[restId] || MOCK_DATA.menus[restaurant.id] || MOCK_DATA.menus['18973'] || [];
        return {
          restaurant,
          categories: [
            {
              name: 'Recommended / Bestsellers',
              items: menuItems.filter((i) => i.bestseller),
            },
            {
              name: 'Main Menu',
              items: menuItems,
            },
          ],
        };
      }

      case 'search_menu': {
        const q = (args.query || '').toLowerCase();
        const results = [];
        for (const [restId, items] of Object.entries(MOCK_DATA.menus)) {
          const rest = MOCK_DATA.restaurants.find((r) => r.id === restId);
          const matchedItems = items.filter((i) => i.name.toLowerCase().includes(q));
          if (matchedItems.length > 0) {
            results.push({ restaurant: rest, items: matchedItems });
          }
        }
        return { results };
      }

      case 'search_instamart':
      case 'search_items': {
        const query = (args.query || '').toLowerCase().trim();
        let items = MOCK_DATA.instamartItems;
        if (query) {
          items = items.filter(
            (i) => i.name.toLowerCase().includes(query) || i.category.toLowerCase().includes(query)
          );
        }
        return {
          items: items.length > 0 ? items : MOCK_DATA.instamartItems.slice(0, 5),
          deliveryTimeMins: 10,
        };
      }

      case 'fetch_food_coupons':
      case 'fetch_im_coupons': {
        return { coupons: MOCK_DATA.coupons };
      }

      case 'track_food_order':
      case 'track_im_order': {
        const orderId = args.orderId || '#SWG-94812';
        return {
          orderId,
          service,
          status: 'OUT_FOR_DELIVERY',
          statusDescription: 'Delivery partner is on the way to your location',
          etaMins: service === 'instamart' ? 8 : 18,
          deliveryPartner: {
            name: 'Ramesh Kumar',
            phone: '+91 98451 23456',
            vehicle: 'Honda Activa (KA-04-EB-1234)',
          },
          restaurantOrStore: service === 'instamart' ? 'Swiggy Instamart Pod (Indiranagar)' : 'Meghana Foods',
        };
      }

      default:
        return { success: true, tool: toolName, args };
    }
  }
}

export const swiggyMcpClient = new SwiggyMcpClient();
