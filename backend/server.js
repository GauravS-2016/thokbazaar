require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');

const db = require('./db');
const { findMatchingSellers } = require('./matching');
const { sendMail } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

const CATEGORIES = ['Sports', 'Toys', 'Cosmetics', 'Electronics', 'Gadgets', 'Clothing', 'Home & Kitchen', 'Stationery', 'Other'];

app.set('trust proxy', 1); // Required when deployed behind Render's HTTPS proxy\napp.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- auth helpers ----------
function auth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Please log in' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Please log in again' });
  }
}

function setLogin(res, user) {
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 3600 * 1000,
  });
}

// ---------- Thokbazaar.store primary storefront API ----------
// The standalone storefront uses bearer-token auth and these normalized fields.
const STORE_CATEGORIES = [
  ['textiles','Textiles & Fabrics'],['apparel','Apparel & Garments'],['packaging','Packaging'],
  ['food','Food & Staples'],['building','Building Materials'],['machinery','Industrial Machinery'],
  ['electronics','Electronics & Electricals'],['chemicals','Chemicals & Plastics'],['sports','Sports & Fitness'],
  ['toys','Toys & Games'],['cosmetics','Cosmetics & Beauty'],['gadgets','Mobile & Gadgets'],
  ['home','Home & Kitchen'],['stationery','Stationery & Office'],['footwear','Footwear & Bags'],
  ['jewellery','Jewellery & Accessories'],['furniture','Furniture'],['auto','Auto Parts'],
  ['health','Health & Medical'],['farm','Agriculture & Farm'],['gifts','Gifts & Handicrafts'],['pets','Pet Supplies']
];
const STORE_CAT_NAMES = Object.fromEntries(STORE_CATEGORIES);
const storeUser = (u) => ({ id: u.id, name: u.name, email: u.email, businessName: u.business_name || '', city: u.city || '' });
const storeProduct = (p) => ({
  id: p.id, name: p.name, cat: p.category, categoryId: p.category, price: p.price,
  unit: p.unit || 'pc', moq: p.moq || p.min_qty || 1,
  supplier: p.supplier || p.business_name || 'Seller', city: p.city || '', tag: p.tag || '',
  desc: p.description || p.keywords || '', by: p.seller_id, ts: p.created_at, sample: false
});

app.post('/api/auth/register', (req, res) => {
  const { name, email, password, businessName, city } = req.body || {};
  if (!name || !email || !password || !businessName || !city) return res.status(400).json({ error: 'Name, business name, city, email and password are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const normalizedEmail = String(email).toLowerCase().trim();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail)) return res.status(400).json({ error: 'This email is already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name,email,password_hash,business_name,city) VALUES (?,?,?,?,?)').run(name.trim(), normalizedEmail, hash, businessName.trim(), city.trim());
  const user = storeUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  setLogin(res, user);
  res.json({ token, user });
});
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase().trim());
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(400).json({ error: 'Wrong email or password' });
  const user = storeUser(u);
  const token = jwt.sign({ id: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  setLogin(res, u);
  res.json({ token, user });
});
app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!u) return res.status(401).json({ error: 'Account not found' });
  res.json({ user: storeUser(u) });
});
app.get('/api/categories', (req, res) => {
  const categories = db.prepare('SELECT id,name,hue FROM custom_categories ORDER BY name').all();
  res.json({ categories });
});
app.post('/api/categories', auth, (req, res) => {
  const name = String((req.body || {}).name || '').trim();
  if (!name || name.length > 40) return res.status(400).json({ error: 'Category name must be 1–40 characters' });
  const existing = db.prepare('SELECT * FROM custom_categories WHERE lower(name)=lower(?)').get(name);
  if (existing) return res.json({ category: existing });
  const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,32);
  db.prepare('INSERT INTO custom_categories (id,name,hue) VALUES (?,?,?)').run(id, name, Number((req.body || {}).hue) || 200);
  res.json({ category: { id, name, hue: Number((req.body || {}).hue) || 200 } });
});
app.get('/api/products', (req, res) => {
  const rows = db.prepare(`SELECT p.*,u.business_name,u.name AS seller_name FROM products p JOIN users u ON u.id=p.seller_id ORDER BY p.id DESC LIMIT ?`).all(Math.min(Number(req.query.limit) || 500, 1000));
  res.json({ products: rows.map(storeProduct) });
});
app.post('/api/products', auth, (req, res, next) => {
  try {
    const b = req.body || {};
    if (!b.name || !(Number(b.price) > 0) || !(Number(b.moq) >= 1) || !b.supplier || !b.city || !b.cat) return res.status(400).json({ error: 'Product, category, price, minimum order, business name and city are required' });
    const info = db.prepare(`INSERT INTO products (seller_id,name,category,keywords,price,min_qty,unit,moq,supplier,city,tag,description) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(req.user.id, String(b.name).trim(), String(b.cat), b.desc || '', Number(b.price), Number(b.moq), b.unit || 'pc', Number(b.moq), String(b.supplier).trim(), String(b.city).trim(), b.tag || '', b.desc || '');
    res.json({ product: storeProduct(db.prepare('SELECT p.*,u.business_name,u.name AS seller_name FROM products p JOIN users u ON u.id=p.seller_id WHERE p.id=?').get(info.lastInsertRowid)) });
  } catch (e) { next(e); }
});
app.patch('/api/products/:id', auth, (req, res) => {
  const b = req.body || {};
  const old = db.prepare('SELECT * FROM products WHERE id=? AND seller_id=?').get(req.params.id, req.user.id);
  if (!old) return res.status(404).json({ error: 'Product not found' });
  db.prepare(`UPDATE products SET name=?,category=?,price=?,min_qty=?,unit=?,moq=?,supplier=?,city=?,tag=?,keywords=?,description=? WHERE id=? AND seller_id=?`)
    .run(b.name || old.name, b.cat || old.category, Number(b.price) || old.price, Number(b.moq) || old.moq || old.min_qty || 1, b.unit || old.unit || 'pc', Number(b.moq) || old.moq || old.min_qty || 1, b.supplier || old.supplier, b.city || old.city, b.tag || '', b.desc || '', b.desc || '', req.params.id, req.user.id);
  res.json({ ok: true });
});
app.delete('/api/products/:id', auth, (req, res) => {
  const result = db.prepare('DELETE FROM products WHERE id=? AND seller_id=?').run(req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Product not found' });
  res.json({ ok: true });
});
app.get('/api/requirements', (req, res) => {
  const rows = db.prepare('SELECT * FROM requirements ORDER BY id DESC LIMIT 500').all();
  res.json({ requirements: rows.map(r => ({ id:r.id, name:r.customer_name, firmName:r.firm_name, prod:r.product_name, qty:r.quantity, unit:r.unit, city:r.city, phone:r.phone, ts:r.created_at })) });
});
app.post('/api/requirements', (req, res) => {
  const b = req.body || {};
  const phone = String(b.phone || '').replace(/\D/g,'');
  if (!b.customerName || !b.firmName || !b.productName || !(Number(b.quantity) >= 1) || phone.length !== 10) return res.status(400).json({ error: 'Please complete all required fields and enter a valid 10-digit phone number' });
  const info = db.prepare('INSERT INTO requirements (customer_name,firm_name,product_name,quantity,unit,city,phone) VALUES (?,?,?,?,?,?,?)').run(b.customerName, b.firmName, b.productName, Number(b.quantity), b.unit || 'pc', b.city || '', phone);
  res.json({ id: info.lastInsertRowid });
});
app.post('/api/enquiries', auth, (req, res) => {
  const b = req.body || {};
  const p = db.prepare('SELECT * FROM products WHERE id=?').get(b.productId);
  const phone = String(b.phone || '').replace(/\D/g,'');
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (p.seller_id === req.user.id) return res.status(400).json({ error: 'You cannot enquire about your own product' });
  if (!(Number(b.quantity) >= 1) || phone.length !== 10) return res.status(400).json({ error: 'Enter a valid quantity and 10-digit phone number' });
  const info = db.prepare('INSERT INTO enquiries (product_id,seller_id,quantity,unit,buyer_name,phone) VALUES (?,?,?,?,?,?)').run(p.id,p.seller_id,Number(b.quantity),p.unit || 'pc',b.name || req.user.name,phone);
  res.json({ id: info.lastInsertRowid });
});
app.get('/api/seller/enquiries', auth, (req, res) => {
  const rows = db.prepare(`SELECT e.*,p.name AS product_name FROM enquiries e JOIN products p ON p.id=e.product_id WHERE e.seller_id=? ORDER BY e.id DESC LIMIT 200`).all(req.user.id);
  res.json({ enquiries: rows.map(e => ({ id:e.id,pid:e.product_id,pname:e.product_name,seller:String(e.seller_id),qty:e.quantity,unit:e.unit,name:e.buyer_name,phone:e.phone,ts:e.created_at })) });
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok:true }); });



// ---------- auth routes ----------
app.post('/api/register', (req, res) => {
  const { name, email, password, phone, city } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (exists) return res.status(400).json({ error: 'This email is already registered' });
  const hash = bcrypt.hashSync(password, 10);
  const info = db
    .prepare('INSERT INTO users (name, email, password_hash, phone, city) VALUES (?,?,?,?,?)')
    .run(name, email.toLowerCase(), hash, phone || '', city || '');
  const user = { id: info.lastInsertRowid, name, email: email.toLowerCase() };
  setLogin(res, user);
  res.json(user);
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(400).json({ error: 'Wrong email or password' });
  }
  setLogin(res, user);
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.json(null);
  try {
    const u = jwt.verify(token, JWT_SECRET);
    res.json({ id: u.id, name: u.name, email: u.email });
  } catch {
    res.json(null);
  }
});

app.get('/api/categories', (req, res) => res.json(CATEGORIES));

// ---------- seller: products ----------
app.get('/api/products/mine', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM products WHERE seller_id = ? ORDER BY id DESC').all(req.user.id));
});

app.post('/api/products', auth, (req, res) => {
  const { name, category, keywords, price, min_qty } = req.body || {};
  if (!name || !category) return res.status(400).json({ error: 'Product name and category are required' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });
  const info = db
    .prepare('INSERT INTO products (seller_id, name, category, keywords, price, min_qty) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, name, category, keywords || '', price || null, min_qty || null);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/products/:id', auth, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ? AND seller_id = ?').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

// ---------- buyer: requests ----------
app.post('/api/requests', auth, async (req, res) => {
  const { title, category, quantity, city, budget, details } = req.body || {};
  if (!title || !category) return res.status(400).json({ error: 'Item name and category are required' });
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });

  const info = db
    .prepare('INSERT INTO requests (buyer_id, title, category, quantity, city, budget, details) VALUES (?,?,?,?,?,?,?)')
    .run(req.user.id, title, category, quantity || null, city || '', budget || null, details || '');
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(info.lastInsertRowid);

  // Find sellers who have this kind of item and notify them
  const sellers = findMatchingSellers(request);
  const insertNote = db.prepare('INSERT OR IGNORE INTO notifications (user_id, request_id) VALUES (?, ?)');
  for (const s of sellers) {
    insertNote.run(s.seller_id, request.id);
    sendMail(
      s.email,
      `New buyer request: ${request.title}`,
      `Hello ${s.seller_name},\n\nA buyer is looking for: ${request.title}\n` +
        `Category: ${request.category}\n` +
        (request.quantity ? `Quantity: ${request.quantity}\n` : '') +
        (request.city ? `City: ${request.city}\n` : '') +
        (request.budget ? `Budget: Rs ${request.budget}\n` : '') +
        (request.details ? `Details: ${request.details}\n` : '') +
        `\nLog in to send your quote: ${SITE_URL}\n`
    );
  }
  res.json({ id: request.id, sellers_notified: sellers.length });
});

app.get('/api/requests/mine', auth, (req, res) => {
  const requests = db.prepare('SELECT * FROM requests WHERE buyer_id = ? ORDER BY id DESC').all(req.user.id);
  const quoteStmt = db.prepare(
    `SELECT q.*, u.name AS seller_name, u.phone AS seller_phone, u.email AS seller_email, u.city AS seller_city
     FROM quotes q JOIN users u ON u.id = q.seller_id WHERE q.request_id = ? ORDER BY q.price ASC`
  );
  for (const r of requests) r.quotes = quoteStmt.all(r.id);
  res.json(requests);
});

// ---------- seller: notifications and quotes ----------
app.get('/api/notifications', auth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT n.id AS notification_id, n.is_read, n.created_at AS notified_at,
              r.id AS request_id, r.title, r.category, r.quantity, r.city, r.budget, r.details, r.status,
              (SELECT price FROM quotes q WHERE q.request_id = r.id AND q.seller_id = n.user_id) AS my_quote
       FROM notifications n JOIN requests r ON r.id = n.request_id
       WHERE n.user_id = ? ORDER BY n.id DESC`
    )
    .all(req.user.id);
  res.json({ unread: rows.filter((r) => !r.is_read).length, items: rows });
});

app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/quotes', auth, (req, res) => {
  const { price, message } = req.body || {};
  if (!price) return res.status(400).json({ error: 'Please enter a price' });
  // Only sellers who were notified about this request can quote on it
  const allowed = db
    .prepare('SELECT id FROM notifications WHERE user_id = ? AND request_id = ?')
    .get(req.user.id, req.params.id);
  if (!allowed) return res.status(403).json({ error: 'You can only quote on requests sent to you' });

  db.prepare(
    `INSERT INTO quotes (request_id, seller_id, price, message) VALUES (?,?,?,?)
     ON CONFLICT(request_id, seller_id) DO UPDATE SET price = excluded.price, message = excluded.message`
  ).run(req.params.id, req.user.id, price, message || '');

  // Tell the buyer a quote has arrived
  const info = db
    .prepare('SELECT u.email, u.name, r.title FROM requests r JOIN users u ON u.id = r.buyer_id WHERE r.id = ?')
    .get(req.params.id);
  if (info) {
    sendMail(
      info.email,
      `New quote for: ${info.title}`,
      `Hello ${info.name},\n\n${req.user.name} sent a quote of Rs ${price} for "${info.title}".\n\nSee all quotes: ${SITE_URL}\n`
    );
  }
  res.json({ ok: true });
});


app.listen(PORT, '0.0.0.0', () => console.log(`Thokbazaar running on port ${PORT}`));
