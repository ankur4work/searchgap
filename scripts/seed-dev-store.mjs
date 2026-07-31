/**
 * Seed a Shopify dev store with realistic products and orders.
 *
 * Usage:
 *   node scripts/seed-dev-store.mjs \
 *     --store your-dev-store.myshopify.com \
 *     --token shpat_xxx \
 *     --products 500 \
 *     --orders 400
 *
 * Requires Node 18+ (built-in fetch). No npm install needed.
 * Only works on dev/partner stores — real stores will reject backdated orders.
 */

// ─── CLI args / env (no secrets in source) ────────────────────────────────────
function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const STORE      = arg('--store', process.env.SEED_STORE);
const TOKEN      = arg('--token', process.env.SEED_TOKEN);
const N_PRODUCTS = parseInt(arg('--products', '500'), 10);
const N_ORDERS   = parseInt(arg('--orders', '400'), 10);
const API_VER    = '2025-04';

if (!STORE || !TOKEN) {
  console.error('Missing --store and/or --token (or SEED_STORE / SEED_TOKEN env). See header for usage.');
  process.exit(1);
}
const BASE    = `https://${STORE}/admin/api/${API_VER}`;

// ─── product catalogue ────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    name: 'Clothing',
    products: [
      ['Slim Fit Chinos', ['Navy', 'Khaki', 'Olive', 'Black']],
      ['Classic Oxford Shirt', ['White', 'Blue', 'Pink', 'Grey']],
      ['Merino Wool Sweater', ['Charcoal', 'Cream', 'Forest Green']],
      ['Relaxed Linen Trousers', ['Sand', 'White', 'Navy']],
      ['Graphic Tee', ['Black', 'White', 'Grey', 'Red']],
      ['Denim Jacket', ['Light Wash', 'Dark Wash', 'Black']],
      ['Puffer Vest', ['Black', 'Navy', 'Olive']],
      ['Fleece Hoodie', ['Grey', 'Navy', 'Burgundy']],
      ['Cargo Shorts', ['Khaki', 'Black', 'Olive']],
      ['Polo Shirt', ['White', 'Navy', 'Red', 'Green']],
      ['Thermal Base Layer', ['Black', 'Grey']],
      ['Rain Jacket', ['Blue', 'Black', 'Red']],
      ['Leather Belt', ['Brown', 'Black']],
      ['Swim Shorts', ['Blue', 'Green', 'Black', 'Patterned']],
      ['Bomber Jacket', ['Black', 'Olive', 'Navy']],
      ['Corduroy Trousers', ['Brown', 'Navy', 'Green']],
      ['Knitted Cardigan', ['Oatmeal', 'Grey', 'Blue']],
      ['Track Pants', ['Black', 'Navy', 'Grey']],
      ['Windbreaker Jacket', ['Yellow', 'Black', 'Blue']],
      ['Compression Socks', ['Black', 'White', 'Grey']],
    ],
  },
  {
    name: 'Footwear',
    products: [
      ['Running Shoes', ['Black/White', 'Grey/Blue', 'All Black']],
      ['Leather Chelsea Boots', ['Black', 'Tan', 'Dark Brown']],
      ['Canvas Sneakers', ['White', 'Black', 'Navy', 'Red']],
      ['Hiking Boots', ['Brown', 'Grey/Orange', 'Black']],
      ['Loafers', ['Brown', 'Black', 'Tan']],
      ['Sandals', ['Black', 'Brown', 'Tan']],
      ['Slip-On Shoes', ['Black', 'White', 'Grey']],
      ['Ankle Boots', ['Black', 'Tan']],
      ['Trail Running Shoes', ['Blue/Orange', 'Green/Black', 'Grey']],
      ['Oxford Dress Shoes', ['Black', 'Dark Brown']],
      ['Waterproof Boots', ['Black', 'Dark Brown']],
      ['Gym Trainers', ['White', 'Black', 'Grey/Neon']],
    ],
  },
  {
    name: 'Accessories',
    products: [
      ['Leather Wallet', ['Black', 'Brown', 'Tan']],
      ['Canvas Backpack', ['Black', 'Navy', 'Olive', 'Grey']],
      ['Wool Beanie', ['Grey', 'Black', 'Navy', 'Red']],
      ['Aviator Sunglasses', ['Gold/Brown', 'Silver/Grey', 'Black']],
      ['Leather Watch Strap', ['Brown', 'Black', 'Tan']],
      ['Laptop Sleeve 13"', ['Grey', 'Black', 'Navy']],
      ['Travel Duffel Bag', ['Black', 'Navy', 'Grey']],
      ['Baseball Cap', ['Black', 'Navy', 'White', 'Grey']],
      ['Scarf', ['Grey', 'Navy', 'Burgundy', 'Plaid']],
      ['Gloves', ['Black', 'Brown', 'Grey']],
      ['Tote Bag', ['Canvas', 'Black', 'Navy']],
      ['Money Clip', ['Silver', 'Gold', 'Black']],
      ['Keychain', ['Leather', 'Metal', 'Carabiner']],
    ],
  },
  {
    name: 'Home & Living',
    products: [
      ['Linen Bedsheet Set', ['White', 'Cream', 'Grey', 'Blue']],
      ['Ceramic Mug Set', ['White', 'Black', 'Speckled']],
      ['Bamboo Cutting Board', ['Natural', 'Dark']],
      ['Scented Candle', ['Cedarwood', 'Vanilla', 'Eucalyptus', 'Lavender']],
      ['Throw Blanket', ['Grey', 'Cream', 'Navy', 'Sage']],
      ['Essential Oil Diffuser', ['White', 'Black', 'Wood']],
      ['Reusable Water Bottle', ['Black', 'White', 'Blue', 'Green']],
      ['French Press', ['Chrome', 'Black', 'Copper']],
      ['Desk Organiser', ['Bamboo', 'Black Metal', 'White']],
      ['Picture Frame Set', ['Black', 'White', 'Wood']],
      ['Woven Cushion Cover', ['Terracotta', 'Sage', 'Cream']],
      ['Kitchen Knife Set', ['Classic', 'Damascus', 'Ceramic']],
      ['Herb Garden Kit', ['Basil Set', 'Mixed Herbs', 'Succulents']],
      ['Soap Dispenser Set', ['White', 'Black', 'Brushed Gold']],
      ['Storage Basket', ['Wicker', 'Cotton', 'Seagrass']],
    ],
  },
  {
    name: 'Sports & Outdoors',
    products: [
      ['Yoga Mat', ['Purple', 'Black', 'Blue', 'Pink']],
      ['Resistance Bands Set', ['Light', 'Medium', 'Heavy', 'Full Set']],
      ['Foam Roller', ['Black', 'Blue', 'Textured']],
      ['Pull-Up Bar', ['Black', 'Chrome']],
      ['Adjustable Dumbbells', ['5kg Set', '10kg Set', '20kg Set']],
      ['Camping Tent 2-Person', ['Green', 'Orange', 'Grey']],
      ['Sleeping Bag', ['-5°C Rating', '-10°C Rating', 'Summer']],
      ['Trekking Poles', ['Aluminium', 'Carbon Fibre']],
      ['Hydration Pack', ['10L Blue', '15L Black', '20L Grey']],
      ['Bike Helmet', ['Black', 'White', 'Red', 'Blue']],
      ['Knee Pads', ['Black', 'Grey']],
      ['Jump Rope', ['Speed', 'Weighted', 'Beginner']],
      ['Tennis Racket', ['Beginner', 'Intermediate', 'Pro']],
      ['Swim Goggles', ['Clear', 'Tinted', 'Polarised']],
      ['Running Belt', ['Black', 'Blue', 'Grey']],
    ],
  },
  {
    name: 'Electronics',
    products: [
      ['Wireless Earbuds', ['Black', 'White', 'Grey']],
      ['Portable Bluetooth Speaker', ['Black', 'Blue', 'Red']],
      ['USB-C Hub 7-in-1', ['Silver', 'Space Grey']],
      ['Mechanical Keyboard', ['Full Size Black', 'TKL White', 'Compact Grey']],
      ['Webcam 1080p', ['Black', 'White']],
      ['Desk Lamp LED', ['Black', 'White', 'Silver']],
      ['Phone Stand', ['Aluminium', 'Plastic Black', 'Wooden']],
      ['Screen Cleaning Kit', ['Standard', 'Travel Size']],
      ['Cable Management Kit', ['Black', 'White']],
      ['Laptop Stand', ['Aluminium', 'Adjustable Black']],
      ['Wireless Charging Pad', ['Black', 'White']],
      ['Smart Plug', ['Single', '4-Pack']],
    ],
  },
];

const PRICE_RANGES = {
  Clothing:         [25, 120],
  Footwear:         [45, 180],
  Accessories:      [15, 95],
  'Home & Living':  [12, 85],
  'Sports & Outdoors': [20, 150],
  Electronics:      [18, 120],
};

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function sample(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Shopify REST helpers ─────────────────────────────────────────────────────

async function restPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (res.status === 429) {
    const wait = parseInt(res.headers.get('Retry-After') || '2', 10) * 1000;
    await sleep(wait);
    return restPost(path, body);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`POST ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function restGet(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'X-Shopify-Access-Token': TOKEN },
  });
  if (res.status === 429) {
    await sleep(2000);
    return restGet(path);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

// ─── Create products ──────────────────────────────────────────────────────────

async function createProducts(target) {
  console.log(`\n📦 Creating ${target} products...`);
  const allTemplates = CATEGORIES.flatMap(cat =>
    cat.products.map(([name, variants]) => ({ cat: cat.name, name, variants }))
  );

  let created = 0;
  let templateIdx = 0;

  while (created < target) {
    const { cat, name, variants } = allTemplates[templateIdx % allTemplates.length];
    templateIdx++;

    const suffix = templateIdx > allTemplates.length ? ` ${Math.ceil(templateIdx / allTemplates.length)}` : '';
    const [minP, maxP] = PRICE_RANGES[cat];
    const basePrice = (rand(minP * 100, maxP * 100) / 100).toFixed(2);

    const product = {
      title: name + suffix,
      vendor: `${cat} Co.`,
      product_type: cat,
      tags: [cat.toLowerCase(), name.toLowerCase().split(' ')[0]],
      variants: variants.map(v => ({
        option1: v,
        price: (parseFloat(basePrice) + rand(-500, 500) / 100).toFixed(2),
        inventory_management: null,
      })),
      options: [{ name: variants.length > 1 ? (cat === 'Footwear' ? 'Color' : 'Option') : 'Title' }],
    };

    try {
      await restPost('/products.json', { product });
      created++;
      if (created % 25 === 0) process.stdout.write(`  ${created}/${target}\n`);
      else process.stdout.write('.');
    } catch (e) {
      console.error('\n  Product create failed:', e.message);
    }

    // ~2 req/s to stay under the 40/s burst limit
    await sleep(500);
  }
  console.log(`\n✅ ${created} products created.`);
}

// ─── Fetch existing variants ──────────────────────────────────────────────────

async function fetchVariants() {
  console.log('\n🔍 Fetching product variants...');
  const variants = [];
  let url = '/products.json?limit=250&fields=id,variants,title';

  while (url) {
    const data = await restGet(url);
    for (const p of data.products) {
      for (const v of p.variants) {
        if (parseFloat(v.price) > 0) {
          variants.push({ id: v.id, price: parseFloat(v.price), title: p.title });
        }
      }
    }
    // Check for next page link (Shopify REST pagination)
    url = null; // simplified: fetch first 250 for seeding purposes
  }

  console.log(`  Found ${variants.length} variants.`);
  return variants;
}

// ─── Create orders ────────────────────────────────────────────────────────────

async function createOrders(target, variants) {
  if (variants.length === 0) {
    console.error('No variants found — create products first.');
    return;
  }

  console.log(`\n🛒 Creating ${target} orders spread over 90 days...`);
  const now = Date.now();
  const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
  let created = 0;

  for (let i = 0; i < target; i++) {
    // Random timestamp within last 90 days
    const ts = new Date(now - Math.random() * ninetyDaysMs).toISOString();

    // 1–4 line items
    const itemCount = rand(1, 4);
    const lineItems = [];
    for (let j = 0; j < itemCount; j++) {
      const v = sample(variants);
      lineItems.push({
        variant_id: v.id,
        quantity: rand(1, 3),
        price: v.price.toFixed(2),
      });
    }

    const totalPrice = lineItems.reduce((s, l) => s + parseFloat(l.price) * l.quantity, 0).toFixed(2);

    const order = {
      created_at: ts,
      financial_status: 'paid',
      fulfillment_status: sample([null, 'fulfilled', 'fulfilled']),
      line_items: lineItems,
      total_price: totalPrice,
      currency: 'USD',
      send_receipt: false,
      send_fulfillment_receipt: false,
    };

    try {
      await restPost('/orders.json', { order });
      created++;
      if (created % 25 === 0) process.stdout.write(`  ${created}/${target}\n`);
      else process.stdout.write('.');
    } catch (e) {
      console.error(`\n  Order ${i + 1} failed:`, e.message);
    }

    await sleep(500);
  }

  console.log(`\n✅ ${created} orders created.`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🚀 Seeding ${STORE}`);
  console.log(`   Products: ${N_PRODUCTS}  |  Orders: ${N_ORDERS}\n`);

  await createProducts(N_PRODUCTS);
  const variants = await fetchVariants();
  await createOrders(N_ORDERS, variants);

  console.log('\n🎉 Done! Install GapFinder on this store and trigger a sync.');
}

main().catch(err => { console.error(err); process.exit(1); });
