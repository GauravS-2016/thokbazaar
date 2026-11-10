import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Database from "better-sqlite3";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("Set JWT_SECRET to a random string of at least 32 characters in .env");
  process.exit(1);
}
const dbPath = process.env.DB_PATH || path.join(__dirname, "../data/thokbazaar.sqlite");
import fs from "node:fs";
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, business_name TEXT NOT NULL, city TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'seller', created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, hue INTEGER DEFAULT 200,
  created_by TEXT REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, cat TEXT NOT NULL, price REAL NOT NULL CHECK(price > 0),
  unit TEXT NOT NULL, moq INTEGER NOT NULL CHECK(moq > 0), supplier TEXT NOT NULL, city TEXT NOT NULL,
  tag TEXT NOT NULL, description TEXT DEFAULT '', seller_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS enquiries (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL, seller_id TEXT NOT NULL REFERENCES users(id),
  quantity INTEGER NOT NULL CHECK(quantity > 0), unit TEXT NOT NULL, buyer_name TEXT DEFAULT '',
  buyer_phone TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requirements (
  id TEXT PRIMARY KEY, product_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
  unit TEXT NOT NULL, city TEXT DEFAULT '', buyer_phone TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(cat);
CREATE INDEX IF NOT EXISTS idx_products_city ON products(city);
CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id);
CREATE INDEX IF NOT EXISTS idx_enquiries_seller ON enquiries(seller_id);
`);

const builtin = [
  ["textiles","Textiles & Fabrics",168],["apparel","Apparel & Garments",20],["packaging","Packaging",38],
  ["food","Food & Staples",100],["building","Building Materials",14],["machinery","Industrial Machinery",215],
  ["electronics","Electronics & Electricals",262],["chemicals","Chemicals & Plastics",190],
  ["sports","Sports & Fitness",140],["toys","Toys & Games",330],["cosmetics","Cosmetics & Beauty",345],
  ["gadgets","Mobile & Gadgets",225],["home","Home & Kitchen",48],["stationery","Stationery & Office",205],
  ["footwear","Footwear & Bags",28],["jewellery","Jewellery & Accessories",300],["furniture","Furniture",30],
  ["auto","Auto Parts",8],["health","Health & Medical",175],["farm","Agriculture & Farm",90],
  ["gifts","Gifts & Handicrafts",355],["pets","Pet Supplies",160]
];
const insertCat = db.prepare("INSERT OR IGNORE INTO categories(id,name,hue,created_at) VALUES(?,?,?,?)");
for (const [id,name,hue] of builtin) insertCat.run(id,name,hue,new Date().toISOString());

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: (process.env.CORS_ORIGIN || "").split(",").filter(Boolean).length
  ? (process.env.CORS_ORIGIN || "").split(",").map(s=>s.trim()) : true }));
app.use(express.json({ limit: "1mb" }));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
function fail(res, status, message) { return res.status(status).json({ error: message }); }
function auth(req,res,next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i,"");
  if (!token) return fail(res,401,"Sign in as a seller to do this.");
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { return fail(res,401,"Session expired. Please sign in again."); }
}
function validPhone(v) { return /^\d{10}$/.test(String(v || "").replace(/\D/g,"")); }
function publicProduct(row) {
  return { id:row.id, name:row.name, cat:row.cat, price:row.price, unit:row.unit, moq:row.moq,
    supplier:row.supplier, city:row.city, tag:row.tag, desc:row.description, by:row.seller_id, ts:row.created_at };
}

app.get("/api/health", (_req,res)=>res.json({ok:true,service:"Thokbazaar API"}));
app.post("/api/auth/register", (req,res)=>{
  const {name,email,password,businessName,city} = req.body || {};
  if (![name,email,password,businessName,city].every(v=>typeof v==="string" && v.trim())) return fail(res,400,"All fields are required.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res,400,"Enter a valid email address.");
  if (password.length < 8) return fail(res,400,"Password must be at least 8 characters.");
  if (name.length>60 || businessName.length>60 || city.length>40) return fail(res,400,"One or more fields are too long.");
  const user = {id:id(),name:name.trim(),email:email.trim().toLowerCase(),business_name:businessName.trim(),city:city.trim(),role:"seller",created_at:now()};
  try {
    db.prepare("INSERT INTO users(id,name,email,password_hash,business_name,city,role,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(user.id,user.name,user.email,bcrypt.hashSync(password,12),user.business_name,user.city,user.role,user.created_at);
    const token = jwt.sign({sub:user.id, role:user.role},JWT_SECRET,{expiresIn:"7d"});
    res.status(201).json({token,user:{id:user.id,name:user.name,email:user.email,businessName:user.business_name,city:user.city,role:user.role}});
  } catch(e) { if(String(e.message).includes("UNIQUE")) return fail(res,409,"An account with this email already exists."); throw e; }
});
app.post("/api/auth/login",(req,res)=>{
  const {email,password} = req.body || {};
  if (typeof email!=="string" || typeof password!=="string") return fail(res,400,"Email and password are required.");
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email.trim().toLowerCase());
  if (!user || !bcrypt.compareSync(password,user.password_hash)) return fail(res,401,"Incorrect email or password.");
  const token = jwt.sign({sub:user.id,role:user.role},JWT_SECRET,{expiresIn:"7d"});
  res.json({token,user:{id:user.id,name:user.name,email:user.email,businessName:user.business_name,city:user.city,role:user.role}});
});
app.get("/api/auth/me",auth,(req,res)=>{
  const u=db.prepare("SELECT id,name,email,business_name,city,role,created_at FROM users WHERE id=?").get(req.user.sub);
  if(!u) return fail(res,401,"Account not found.");
  res.json({id:u.id,name:u.name,email:u.email,businessName:u.business_name,city:u.city,role:u.role,createdAt:u.created_at});
});

app.get("/api/categories",(_req,res)=>{
  res.json(db.prepare("SELECT id,name,hue,created_by AS by,created_at AS ts FROM categories ORDER BY name").all());
});
app.post("/api/categories",auth,(req,res)=>{
  const name=String(req.body?.name||"").trim();
  if(!name || name.length>40) return fail(res,400,"Category name must be 1–40 characters.");
  const category={id:"c-"+id(),name,hue:Math.floor(Math.random()*360),created_by:req.user.sub,created_at:now()};
  try { db.prepare("INSERT INTO categories(id,name,hue,created_by,created_at) VALUES(?,?,?,?,?)").run(category.id,category.name,category.hue,category.created_by,category.created_at); }
  catch(e){ if(String(e.message).includes("UNIQUE")) return fail(res,409,"That category already exists."); throw e; }
  res.status(201).json({id:category.id,name:category.name,hue:category.hue,by:category.created_by,ts:category.created_at});
});

app.get("/api/products",(req,res)=>{
  const {q="",cat="all",city="all",sort="new",limit="200",offset="0"}=req.query;
  const take=Math.min(500,Math.max(1,Number(limit)||200)), skip=Math.max(0,Number(offset)||0);
  let rows=db.prepare("SELECT * FROM products").all().map(publicProduct);
  const needle=String(q).trim().toLowerCase();
  rows=rows.filter(p=>(cat==="all"||p.cat===cat)&&(city==="all"||p.city.toLowerCase()===String(city).toLowerCase())&&
    (!needle||[p.name,p.supplier,p.city,p.cat,p.desc].join(" ").toLowerCase().includes(needle)));
  if(sort==="low") rows.sort((a,b)=>a.price-b.price);
  else if(sort==="high") rows.sort((a,b)=>b.price-a.price);
  else if(sort==="moq") rows.sort((a,b)=>a.moq-b.moq);
  else rows.sort((a,b)=>b.ts.localeCompare(a.ts));
  res.json({items:rows.slice(skip,skip+take),total:rows.length});
});
app.post("/api/products",auth,(req,res)=>{
  const b=req.body||{};
  const name=String(b.name||"").trim(),cat=String(b.cat||"").trim(),unit=String(b.unit||"").trim();
  const price=Number(b.price),moq=Number(b.moq),supplier=String(b.supplier||"").trim(),city=String(b.city||"").trim();
  const tag=String(b.tag||"Wholesaler"),description=String(b.desc||"").trim();
  if(!name||name.length>90||!cat||!unit||unit.length>20||!(price>0&&Number.isFinite(price))||!(Number.isInteger(moq)&&moq>0)||!supplier||supplier.length>60||!city||city.length>40||description.length>300)
    return fail(res,400,"Please check product name, category, price, minimum order, business name and city.");
  if(!db.prepare("SELECT id FROM categories WHERE id=?").get(cat)) return fail(res,400,"Choose a valid category.");
  const ts=now(), pid=id();
  db.prepare("INSERT INTO products(id,name,cat,price,unit,moq,supplier,city,tag,description,seller_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(pid,name,cat,price,unit,moq,supplier,city,tag,description,req.user.sub,ts,ts);
  res.status(201).json(publicProduct(db.prepare("SELECT * FROM products WHERE id=?").get(pid)));
});
app.patch("/api/products/:id",auth,(req,res)=>{
  const old=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if(!old) return fail(res,404,"Product not found.");
  if(old.seller_id!==req.user.sub && req.user.role!=="admin") return fail(res,403,"You can only edit your own products.");
  const b=req.body||{}, name=String(b.name??old.name).trim(),cat=String(b.cat??old.cat),unit=String(b.unit??old.unit);
  const price=Number(b.price??old.price),moq=Number(b.moq??old.moq),supplier=String(b.supplier??old.supplier).trim(),city=String(b.city??old.city).trim(),tag=String(b.tag??old.tag),description=String(b.desc??old.description).trim();
  if(!name||name.length>90||!(price>0)||!(Number.isInteger(moq)&&moq>0)||!db.prepare("SELECT id FROM categories WHERE id=?").get(cat)||!unit||!supplier||!city||description.length>300) return fail(res,400,"Invalid product details.");
  db.prepare("UPDATE products SET name=?,cat=?,price=?,unit=?,moq=?,supplier=?,city=?,tag=?,description=?,updated_at=? WHERE id=?")
    .run(name,cat,price,unit,moq,supplier,city,tag,description,now(),old.id);
  res.json(publicProduct(db.prepare("SELECT * FROM products WHERE id=?").get(old.id)));
});
app.delete("/api/products/:id",auth,(req,res)=>{
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if(!p) return fail(res,404,"Product not found.");
  if(p.seller_id!==req.user.sub && req.user.role!=="admin") return fail(res,403,"You can only remove your own products.");
  db.prepare("DELETE FROM products WHERE id=?").run(p.id);res.json({ok:true});
});

app.post("/api/enquiries",(req,res)=>{
  const b=req.body||{}, product=db.prepare("SELECT * FROM products WHERE id=?").get(String(b.productId||""));
  const quantity=Number(b.quantity),phone=String(b.phone||"").replace(/\D/g,""),name=String(b.name||"").trim();
  if(!product) return fail(res,404,"Product not found.");
  if(!(Number.isInteger(quantity)&&quantity>=product.moq)) return fail(res,400,`Minimum order is ${product.moq} ${product.unit}.`);
  if(!validPhone(phone)) return fail(res,400,"Enter a valid 10-digit mobile number.");
  if(name.length>60) return fail(res,400,"Name is too long.");
  const eid=id(),ts=now();
  db.prepare("INSERT INTO enquiries(id,product_id,product_name,seller_id,quantity,unit,buyer_name,buyer_phone,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(eid,product.id,product.name,product.seller_id,quantity,product.unit,name,phone,ts);
  res.status(201).json({ok:true,id:eid,message:"Enquiry sent to seller."});
});
app.post("/api/requirements",(req,res)=>{
  const b=req.body||{},productName=String(b.productName||"").trim(),quantity=Number(b.quantity),unit=String(b.unit||"pc"),city=String(b.city||"").trim(),phone=String(b.phone||"").replace(/\D/g,"");
  if(!productName||productName.length>120||!(Number.isInteger(quantity)&&quantity>0)||unit.length>20||city.length>40||!validPhone(phone)) return fail(res,400,"Enter product, quantity and a valid 10-digit mobile number.");
  const rid=id(),ts=now();
  db.prepare("INSERT INTO requirements(id,product_name,quantity,unit,city,buyer_phone,created_at) VALUES(?,?,?,?,?,?,?)").run(rid,productName,quantity,unit,city,phone,ts);
  res.status(201).json({ok:true,id:rid,message:"Requirement posted."});
});
app.get("/api/seller/enquiries",auth,(req,res)=>{
  const rows=db.prepare("SELECT id,product_id AS pid,product_name AS pname,quantity AS qty,unit,buyer_name AS name,buyer_phone AS phone,created_at AS ts FROM enquiries WHERE seller_id=? ORDER BY created_at DESC LIMIT 100").all(req.user.sub);
  res.json(rows);
});
app.get("/api/requirements",(_req,res)=>{
  res.json(db.prepare("SELECT id,product_name AS prod,quantity AS qty,unit,city,buyer_phone AS phone,created_at AS ts FROM requirements ORDER BY created_at DESC LIMIT 100").all());
});

const frontendPath=path.join(__dirname,"../public");
app.use(express.static(frontendPath));
app.get("*",(req,res)=>res.sendFile(path.join(frontendPath,"Thokbazaar.html")));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:"Unexpected server error."});});
app.listen(PORT,()=>console.log(`Thokbazaar running at http://localhost:${PORT}`));
