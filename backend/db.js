const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const databasePath = process.env.DB_PATH || path.join(__dirname, 'thokbazaar.db');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  phone TEXT,
  city TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- A user can be both buyer and seller. Anyone who lists a product is a seller.
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  keywords TEXT DEFAULT '',
  price REAL,
  min_qty INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);

CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  buyer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  quantity INTEGER,
  city TEXT,
  budget REAL,
  details TEXT,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, request_id)
);

CREATE TABLE IF NOT EXISTS quotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  message TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(request_id, seller_id)
);
`);


// Thokbazaar.store marketplace fields used by the primary storefront.
function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
ensureColumn('users', 'business_name', 'TEXT DEFAULT \'\'');
ensureColumn('products', 'unit', "TEXT DEFAULT 'pc'");
ensureColumn('products', 'moq', 'INTEGER DEFAULT 1');
ensureColumn('products', 'supplier', "TEXT DEFAULT ''");
ensureColumn('products', 'city', "TEXT DEFAULT ''");
ensureColumn('products', 'tag', "TEXT DEFAULT ''");
ensureColumn('products', 'description', "TEXT DEFAULT ''");

db.exec(`
CREATE TABLE IF NOT EXISTS custom_categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, hue INTEGER DEFAULT 200
);
CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL, firm_name TEXT NOT NULL, product_name TEXT NOT NULL,
  quantity REAL NOT NULL, unit TEXT DEFAULT 'pc', city TEXT DEFAULT '', phone TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  seller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quantity REAL NOT NULL, unit TEXT DEFAULT 'pc', buyer_name TEXT DEFAULT '',
  phone TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_enquiries_seller ON enquiries(seller_id, id DESC);
`);

module.exports = db;
