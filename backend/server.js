require('dotenv').config();

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const db = require('./db');
const { findMatchingSellers } = require('./matching');
const { sendMail } = require('./mailer');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const SITE_URL = process.env.SITE_URL || 'https://thokbazaar.store';

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be set in Render and contain at least 32 characters.');
}

const allowedOrigins = (process.env.CORS_ORIGIN ||
  'https://thokbazaar.store,https://www.thokbazaar.store')
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.set('trust proxy', 1);

const corsOptions = {
  origin(origin, callback) {
    // Requests without Origin include health checks and server-to-server calls.
    if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ''))) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

const CATEGORIES = [
  'Sports', 'Toys', 'Cosmetics', 'Electronics', 'Gadgets',
  'Clothing', 'Home & Kitchen', 'Stationery', 'Other'
];

const STORE_CATEGORIES = [
  ['textiles', 'Textiles & Fabrics'], ['apparel', 'Apparel & Garments'],
  ['packaging', 'Packaging'], ['food', 'Food & Staples'],
  ['building', 'Building Materials'], ['machinery', 'Industrial Machinery'],
  ['electronics', 'Electronics & Electricals'], ['chemicals', 'Chemicals & Plastics'],
  ['sports', 'Sports & Fitness'], ['toys', 'Toys & Games'],
  ['cosmetics', 'Cosmetics & Beauty'], ['gadgets', 'Mobile & Gadgets'],
  ['home', 'Home & Kitchen'], ['stationery', 'Stationery & Office'],
  ['footwear', 'Footwear & Bags'], ['jewellery', 'Jewellery & Accessories'],
  ['furniture', 'Furniture'], ['auto', 'Auto Parts'],
  ['health', 'Health & Medical'], ['farm', 'Agriculture & Farm'],
  ['gifts', 'Gifts & Handicrafts'], ['pets', 'Pet Supplies']
];

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    businessName: user.business_name || '',
    city: user.city || '',
    phone: user.phone || ''
  };
}

function makeToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function setLogin(res, user) {
  res.cookie('token', makeToken(user), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7)
    : req.cookies.token;

  if (!token) return res.status(401).json({ error: 'Please log in' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Session expired. Please log in again.' });
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function productOutput(product, seller) {
  return {
    id: product.id,
    name: product.name,
    cat: product.category,
    categoryId: product.category,
    price: product.price,
    unit: product.unit || 'pc',
    moq: product.moq || product.min_qty || 1,
    supplier: product.supplier || seller?.business_name || seller?.name || 'Seller',
    city: product.city || seller?.city || '',
    tag: product.tag || '',
    desc: product.description || product.keywords || '',
    by: product.seller_id,
    ts: product.created_at,
    sample: false
  };
}

async function getUserById(id) {
  const { data, error } = await db.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function register(req, res, next, storefrontFormat = false) {
  const body = req.body || {};
  const name = String(body.name || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const businessName = String(body.businessName || body.business_name || '').trim();
  const city = String(body.city || '').trim();
  const phone = String(body.phone || '').trim();

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (storefrontFormat && (!businessName || !city)) {
    return res.status(400).json({ error: 'Business name and city are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const { data: existing, error: lookupError } = await db
    .from('users').select('id').eq('email', email).maybeSingle();
  if (lookupError) throw lookupError;
  if (existing) return res.status(409).json({ error: 'This email is already registered' });

  const password_hash = await bcrypt.hash(password, 12);
  const { data: user, error } = await db
    .from('users')
    .insert({
      name, email, password_hash, phone,
      city, business_name: businessName
    })
    .select('*')
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'This email is already registered' });
    }
    throw error;
  }

  setLogin(res, user);
  const safeUser = publicUser(user);
  return res.status(201).json(storefrontFormat ? { token: makeToken(user), user: safeUser } : safeUser);
}

async function login(req, res) {
  const email = normalizeEmail((req.body || {}).email);
  const password = String((req.body || {}).password || '');

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const { data: user, error } = await db
    .from('users').select('*').eq('email', email).maybeSingle();
  if (error) throw error;

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }

  setLogin(res, user);
  const safeUser = publicUser(user);
  return res.json({ token: makeToken(user), user: safeUser, ...safeUser });
}

app.get('/health', (req, res) => res.json({ ok: true, service: 'thokbazaar-api' }));
app.get('/api/health', (req, res) => res.json({ ok: true, service: 'thokbazaar-api' }));

// Both older and newer frontend authentication endpoint names are supported.
app.post('/api/auth/register', asyncRoute((req, res, next) => register(req, res, next, true)));
app.post('/api/register', asyncRoute((req, res, next) => register(req, res, next, false)));
app.post('/api/auth/login', asyncRoute(login));
app.post('/api/login', asyncRoute(login));

app.get('/api/auth/me', auth, asyncRoute(async (req, res) => {
  const user = await getUserById(req.user.id);
  if (!user) return res.status(401).json({ error: 'Account not found' });
  res.json({ user: publicUser(user) });
}));

app.get('/api/me', asyncRoute(async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.cookies.token;
  if (!token) return res.json(null);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await getUserById(payload.id);
    return res.json(user ? publicUser(user) : null);
  } catch {
    return res.json(null);
  }
}));

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => {
  res.clearCookie('token', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/'
  });
  res.json({ ok: true });
});

// Categories: one route implementation, compatible with both frontend formats.
app.get('/api/categories', asyncRoute(async (req, res) => {
  const { data, error } = await db.from('custom_categories').select('id,name,hue').order('name');
  if (error) throw error;
  res.json({ categories: data || [], defaults: CATEGORIES, storeCategories: STORE_CATEGORIES });
}));

app.post('/api/categories', auth, asyncRoute(async (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'Category name must be 1–40 characters' });

  const { data: existing, error: findError } = await db
    .from('custom_categories').select('*').ilike('name', name).maybeSingle();
  if (findError) throw findError;
  if (existing) return res.json({ category: existing });

  const id = `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32)}`;
  const hue = Number((req.body || {}).hue) || 200;
  const { data, error } = await db
    .from('custom_categories').insert({ id, name, hue }).select('*').single();
  if (error) throw error;
  res.status(201).json({ category: data });
}));

// Products: one GET/POST/PATCH/DELETE implementation for both storefront formats.
app.get('/api/products', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
  const { data: products, error } = await db
    .from('products').select('*').order('id', { ascending: false }).limit(limit);
  if (error) throw error;

  const sellerIds = [...new Set((products || []).map(p => p.seller_id))];
  let sellers = [];
  if (sellerIds.length) {
    const result = await db.from('users').select('id,name,business_name,city').in('id', sellerIds);
    if (result.error) throw result.error;
    sellers = result.data || [];
  }
  const sellerMap = new Map(sellers.map(s => [s.id, s]));
  res.json({ products: (products || []).map(p => productOutput(p, sellerMap.get(p.seller_id))) });
}));

app.get('/api/products/mine', auth, asyncRoute(async (req, res) => {
  const { data, error } = await db.from('products').select('*')
    .eq('seller_id', req.user.id).order('id', { ascending: false });
  if (error) throw error;
  res.json(data || []);
}));

app.post('/api/products', auth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim();
  const category = String(b.cat || b.category || '').trim();
  const price = Number(b.price);
  const moq = Number(b.moq || b.min_qty || 1);

  if (!name || !category) return res.status(400).json({ error: 'Product name and category are required' });
  if (b.price != null && b.price !== '' && !(price > 0)) return res.status(400).json({ error: 'Enter a valid product price' });
  if (!(moq >= 1)) return res.status(400).json({ error: 'Minimum order quantity must be at least 1' });

  const user = await getUserById(req.user.id);
  const row = {
    seller_id: req.user.id,
    name,
    category,
    keywords: String(b.keywords || b.desc || ''),
    price: price > 0 ? price : null,
    min_qty: moq,
    unit: String(b.unit || 'pc'),
    moq,
    supplier: String(b.supplier || user?.business_name || user?.name || ''),
    city: String(b.city || user?.city || ''),
    tag: String(b.tag || ''),
    description: String(b.desc || b.description || '')
  };

  const { data, error } = await db.from('products').insert(row).select('*').single();
  if (error) throw error;
  res.status(201).json({
    product: productOutput(data, user),
    id: data.id
  });
}));

app.patch('/api/products/:id', auth, asyncRoute(async (req, res) => {
  const { data: old, error: findError } = await db.from('products').select('*')
    .eq('id', req.params.id).eq('seller_id', req.user.id).maybeSingle();
  if (findError) throw findError;
  if (!old) return res.status(404).json({ error: 'Product not found' });

  const b = req.body || {};
  const patch = {
    name: b.name ?? old.name,
    category: b.cat ?? b.category ?? old.category,
    price: b.price === undefined ? old.price : (Number(b.price) > 0 ? Number(b.price) : old.price),
    min_qty: Number(b.moq || b.min_qty || old.min_qty || 1),
    moq: Number(b.moq || b.min_qty || old.moq || 1),
    unit: b.unit || old.unit || 'pc',
    supplier: b.supplier ?? old.supplier,
    city: b.city ?? old.city,
    tag: b.tag ?? old.tag,
    keywords: b.keywords ?? b.desc ?? old.keywords,
    description: b.desc ?? b.description ?? old.description
  };

  const { error } = await db.from('products').update(patch)
    .eq('id', req.params.id).eq('seller_id', req.user.id);
  if (error) throw error;
  res.json({ ok: true });
}));

app.delete('/api/products/:id', auth, asyncRoute(async (req, res) => {
  const { data, error } = await db.from('products').delete()
    .eq('id', req.params.id).eq('seller_id', req.user.id).select('id');
  if (error) throw error;
  if (!data || !data.length) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
}));

// Public buyer requirements form used by the storefront.
app.get('/api/requirements', asyncRoute(async (req, res) => {
  // Customer phone numbers are private: require an admin key to list all submissions.
  const adminKey = process.env.ADMIN_API_KEY;
  if (!adminKey || req.get('x-admin-key') !== adminKey) {
    return res.status(401).json({ error: 'Administrator access required' });
  }
  const { data, error } = await db.from('requirements').select('*')
    .order('id', { ascending: false }).limit(500);
  if (error) throw error;
  res.json({
    requirements: (data || []).map(r => ({
      id: r.id, name: r.customer_name, firmName: r.firm_name,
      prod: r.product_name, qty: r.quantity, unit: r.unit,
      city: r.city, phone: r.phone, ts: r.created_at
    }))
  });
}));

app.post('/api/requirements', asyncRoute(async (req, res) => {
  const b = req.body || {};
  const phone = cleanPhone(b.phone);
  const quantity = Number(b.quantity);
  if (!b.customerName || !b.firmName || !b.productName || !(quantity >= 1) || phone.length !== 10) {
    return res.status(400).json({ error: 'Please complete all required fields and enter a valid 10-digit phone number' });
  }

  const { data, error } = await db.from('requirements').insert({
    customer_name: String(b.customerName).trim(),
    firm_name: String(b.firmName).trim(),
    product_name: String(b.productName).trim(),
    quantity,
    unit: String(b.unit || 'pc'),
    city: String(b.city || '').trim(),
    phone
  }).select('id').single();

  if (error) throw error;
  res.status(201).json({ id: data.id });
}));

app.post('/api/enquiries', auth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const phone = cleanPhone(b.phone);
  const quantity = Number(b.quantity);

  const { data: product, error: productError } = await db.from('products')
    .select('*').eq('id', b.productId).maybeSingle();
  if (productError) throw productError;
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.seller_id === req.user.id) {
    return res.status(400).json({ error: 'You cannot enquire about your own product' });
  }
  if (!(quantity >= 1) || phone.length !== 10) {
    return res.status(400).json({ error: 'Enter a valid quantity and 10-digit phone number' });
  }

  const { data, error } = await db.from('enquiries').insert({
    product_id: product.id,
    seller_id: product.seller_id,
    quantity,
    unit: product.unit || 'pc',
    buyer_name: String(b.name || req.user.name),
    phone
  }).select('id').single();

  if (error) throw error;
  res.status(201).json({ id: data.id });
}));

app.get('/api/seller/enquiries', auth, asyncRoute(async (req, res) => {
  const { data: rows, error } = await db.from('enquiries').select('*')
    .eq('seller_id', req.user.id).order('id', { ascending: false }).limit(200);
  if (error) throw error;

  const productIds = [...new Set((rows || []).map(row => row.product_id))];
  let products = [];
  if (productIds.length) {
    const result = await db.from('products').select('id,name').in('id', productIds);
    if (result.error) throw result.error;
    products = result.data || [];
  }
  const productMap = new Map(products.map(p => [p.id, p.name]));
  res.json({
    enquiries: (rows || []).map(e => ({
      id: e.id, pid: e.product_id, pname: productMap.get(e.product_id) || '',
      seller: String(e.seller_id), qty: e.quantity, unit: e.unit,
      name: e.buyer_name, phone: e.phone, ts: e.created_at
    }))
  });
}));

// Authenticated buyer request / seller notification workflow.
app.post('/api/requests', auth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || '').trim();
  const category = String(b.category || '').trim();
  if (!title || !category) return res.status(400).json({ error: 'Item name and category are required' });

  const { data: request, error } = await db.from('requests').insert({
    buyer_id: req.user.id,
    title,
    category,
    quantity: b.quantity ? Number(b.quantity) : null,
    city: String(b.city || ''),
    budget: b.budget ? Number(b.budget) : null,
    details: String(b.details || '')
  }).select('*').single();
  if (error) throw error;

  let sellers = [];
  try {
    sellers = await findMatchingSellers(request);
    if (sellers.length) {
      const notificationRows = sellers.map(s => ({ user_id: s.seller_id, request_id: request.id }));
      const { error: notificationError } = await db.from('notifications')
        .upsert(notificationRows, { onConflict: 'user_id,request_id', ignoreDuplicates: true });
      if (notificationError) throw notificationError;

      await Promise.all(sellers.map(s => sendMail(
        s.email,
        `New buyer request: ${request.title}`,
        `Hello ${s.seller_name},\n\nA buyer is looking for: ${request.title}\n` +
        `Category: ${request.category}\n` +
        (request.quantity ? `Quantity: ${request.quantity}\n` : '') +
        (request.city ? `City: ${request.city}\n` : '') +
        (request.budget ? `Budget: Rs ${request.budget}\n` : '') +
        (request.details ? `Details: ${request.details}\n` : '') +
        `\nLog in to send your quote: ${SITE_URL}\n`
      )));
    }
  } catch (error) {
    console.error('Seller matching/notification failed:', error.message);
  }

  res.status(201).json({ id: request.id, sellers_notified: sellers.length });
}));

app.get('/api/requests/mine', auth, asyncRoute(async (req, res) => {
  const { data: requests, error } = await db.from('requests').select('*')
    .eq('buyer_id', req.user.id).order('id', { ascending: false });
  if (error) throw error;

  const result = [];
  for (const request of requests || []) {
    const { data: quotes, error: quoteError } = await db.from('quotes').select('*')
      .eq('request_id', request.id).order('price', { ascending: true });
    if (quoteError) throw quoteError;

    const sellerIds = [...new Set((quotes || []).map(q => q.seller_id))];
    let sellers = [];
    if (sellerIds.length) {
      const sellerResult = await db.from('users').select('id,name,phone,email,city').in('id', sellerIds);
      if (sellerResult.error) throw sellerResult.error;
      sellers = sellerResult.data || [];
    }
    const sellerMap = new Map(sellers.map(s => [s.id, s]));
    result.push({
      ...request,
      quotes: (quotes || []).map(q => ({
        ...q,
        seller_name: sellerMap.get(q.seller_id)?.name || '',
        seller_phone: sellerMap.get(q.seller_id)?.phone || '',
        seller_email: sellerMap.get(q.seller_id)?.email || '',
        seller_city: sellerMap.get(q.seller_id)?.city || ''
      }))
    });
  }
  res.json(result);
}));

app.get('/api/notifications', auth, asyncRoute(async (req, res) => {
  const { data: notifications, error } = await db.from('notifications').select('*')
    .eq('user_id', req.user.id).order('id', { ascending: false });
  if (error) throw error;

  const requestIds = [...new Set((notifications || []).map(n => n.request_id))];
  let requests = [];
  if (requestIds.length) {
    const result = await db.from('requests').select('*').in('id', requestIds);
    if (result.error) throw result.error;
    requests = result.data || [];
  }
  const requestMap = new Map(requests.map(r => [r.id, r]));
  const quoteResult = await db.from('quotes').select('request_id,price')
    .eq('seller_id', req.user.id);
  if (quoteResult.error) throw quoteResult.error;
  const quoteMap = new Map((quoteResult.data || []).map(q => [q.request_id, q.price]));

  const items = (notifications || []).map(n => {
    const r = requestMap.get(n.request_id) || {};
    return {
      notification_id: n.id, is_read: n.is_read, notified_at: n.created_at,
      request_id: n.request_id, title: r.title, category: r.category,
      quantity: r.quantity, city: r.city, budget: r.budget, details: r.details,
      status: r.status, my_quote: quoteMap.get(n.request_id) ?? null
    };
  });
  res.json({ unread: items.filter(item => !item.is_read).length, items });
}));

app.post('/api/notifications/read', auth, asyncRoute(async (req, res) => {
  const { error } = await db.from('notifications').update({ is_read: true })
    .eq('user_id', req.user.id);
  if (error) throw error;
  res.json({ ok: true });
}));

app.post('/api/requests/:id/quotes', auth, asyncRoute(async (req, res) => {
  const b = req.body || {};
  const price = Number(b.price);
  if (!(price > 0)) return res.status(400).json({ error: 'Please enter a valid price' });

  const { data: allowed, error: allowedError } = await db.from('notifications')
    .select('id').eq('user_id', req.user.id).eq('request_id', req.params.id).maybeSingle();
  if (allowedError) throw allowedError;
  if (!allowed) return res.status(403).json({ error: 'You can only quote on requests sent to you' });

  const { error } = await db.from('quotes').upsert({
    request_id: Number(req.params.id),
    seller_id: req.user.id,
    price,
    message: String(b.message || '')
  }, { onConflict: 'request_id,seller_id' });
  if (error) throw error;

  const { data: request, error: requestError } = await db.from('requests')
    .select('title,buyer_id').eq('id', req.params.id).single();
  if (requestError) throw requestError;

  const buyer = await getUserById(request.buyer_id);
  if (buyer) {
    await sendMail(
      buyer.email,
      `New quote for: ${request.title}`,
      `Hello ${buyer.name},\n\n${req.user.name} sent a quote of Rs ${price} for "${request.title}".\n\nSee all quotes: ${SITE_URL}\n`
    );
  }
  res.json({ ok: true });
}));

// Consistent JSON errors, including CORS errors.
app.use((err, req, res, next) => {
  console.error('API error:', err.message || err);
  if (res.headersSent) return next(err);
  if (String(err.message || '').startsWith('CORS blocked origin:')) {
    return res.status(403).json({ error: 'This website origin is not allowed by the API.' });
  }
  res.status(500).json({
    error: 'Server error. Please try again later.',
    ...(process.env.NODE_ENV !== 'production' ? { detail: err.message } : {})
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Thokbazaar API listening on port ${PORT}`);
});
