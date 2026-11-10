import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error("JWT_SECRET must be set to a private value of at least 32 characters.");
  process.exit(1);
}
const DATA_DIR = process.env.DATA_DIR || path.join(root, "data");
const DATA_FILE = path.join(DATA_DIR, "thokbazaar.json");
fs.mkdirSync(DATA_DIR, { recursive: true });

const initial = {
  users: [],
  categories: [
    { id:"textiles", name:"Textiles & Fabrics", hue:168 },
    { id:"apparel", name:"Apparel & Garments", hue:20 },
    { id:"packaging", name:"Packaging", hue:38 },
    { id:"food", name:"Food & Staples", hue:100 },
    { id:"building", name:"Building Materials", hue:14 },
    { id:"machinery", name:"Industrial Machinery", hue:215 },
    { id:"electronics", name:"Electronics & Electricals", hue:262 },
    { id:"chemicals", name:"Chemicals & Plastics", hue:190 },
    { id:"sports", name:"Sports & Fitness", hue:140 },
    { id:"toys", name:"Toys & Games", hue:330 },
    { id:"cosmetics", name:"Cosmetics & Beauty", hue:345 },
    { id:"gadgets", name:"Mobile & Gadgets", hue:225 },
    { id:"home", name:"Home & Kitchen", hue:48 },
    { id:"stationery", name:"Stationery & Office", hue:205 },
    { id:"footwear", name:"Footwear & Bags", hue:28 },
    { id:"jewellery", name:"Jewellery & Accessories", hue:300 },
    { id:"furniture", name:"Furniture", hue:30 },
    { id:"auto", name:"Auto Parts", hue:8 },
    { id:"health", name:"Health & Medical", hue:175 },
    { id:"farm", name:"Agriculture & Farm", hue:90 },
    { id:"gifts", name:"Gifts & Handicrafts", hue:355 },
    { id:"pets", name:"Pet Supplies", hue:160 }
  ],
  products: [],
  enquiries: [],
  requirements: []
};
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
let db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
for (const key of Object.keys(initial)) if (!Array.isArray(db[key])) db[key] = initial[key];
for (const cat of initial.categories) if (!db.categories.some(x => x.id === cat.id)) db.categories.push(cat);
function persist() { fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)); }
function id() { return crypto.randomUUID(); }
function clean(v, max=200) { return String(v ?? "").trim().slice(0,max); }
function fail(res, status, error) { return res.status(status).json({error}); }

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
const allowed = (process.env.CORS_ORIGIN || "").split(",").map(x => x.trim()).filter(Boolean);
app.use(cors({ origin: allowed.length ? allowed : true }));
app.use(express.json({limit:"100kb"}));
app.use("/api", rateLimit({windowMs:15*60*1000, limit:300, standardHeaders:true, legacyHeaders:false}));
// API-only backend. Deploy the frontend separately and set CORS_ORIGIN to its origin.

function auth(req,res,next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return fail(res,401,"Please sign in.");
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.users.find(u => u.id === payload.sub);
    if (!user) return fail(res,401,"Session is no longer valid.");
    req.user = user;
    next();
  } catch { return fail(res,401,"Invalid or expired session."); }
}
function publicUser(u) { return {id:u.id,name:u.name,email:u.email,businessName:u.businessName,city:u.city}; }
app.get("/api/health", (_req,res) => res.json({ok:true,service:"thokbazaar.store"}));
app.post("/api/auth/register", async (req,res) => {
  const name=clean(req.body.name,80), email=clean(req.body.email,160).toLowerCase();
  const password=String(req.body.password || ""), businessName=clean(req.body.businessName,100), city=clean(req.body.city,80);
  if (!name || !businessName || !city || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length<8)
    return fail(res,400,"Enter name, firm, city, a valid email and a password of at least 8 characters.");
  if (db.users.some(u=>u.email===email)) return fail(res,409,"An account with this email already exists.");
  const user={id:id(),name,email,passwordHash:await bcrypt.hash(password,12),businessName,city,createdAt:new Date().toISOString()};
  db.users.push(user); persist();
  const token=jwt.sign({},JWT_SECRET,{subject:user.id,expiresIn:"7d"});
  res.status(201).json({token,user:publicUser(user)});
});
app.post("/api/auth/login", async (req,res) => {
  const email=clean(req.body.email,160).toLowerCase(), password=String(req.body.password||"");
  const user=db.users.find(u=>u.email===email);
  if (!user || !(await bcrypt.compare(password,user.passwordHash))) return fail(res,401,"Email or password is incorrect.");
  const token=jwt.sign({},JWT_SECRET,{subject:user.id,expiresIn:"7d"});
  res.json({token,user:publicUser(user)});
});
app.get("/api/auth/me",auth,(req,res)=>res.json({user:publicUser(req.user)}));
app.get("/api/categories",(_req,res)=>res.json({categories:db.categories}));
app.post("/api/categories",auth,(req,res)=>{
  const name=clean(req.body.name,40);
  if (!name) return fail(res,400,"Category name is required.");
  let category=db.categories.find(c=>c.name.toLowerCase()===name.toLowerCase());
  if (!category) {
    category={id:"c-"+crypto.createHash("sha1").update(name.toLowerCase()).digest("hex").slice(0,12),name,hue:Number(req.body.hue)||200};
    db.categories.push(category); persist();
  }
  res.status(201).json({category});
});
app.get("/api/products",(req,res)=>{
  let products=[...db.products];
  const q=clean(req.query.q,120).toLowerCase(), cat=clean(req.query.cat,80), city=clean(req.query.city,80), sort=clean(req.query.sort,20);
  if (q) products=products.filter(p=>(p.name+" "+p.supplier+" "+p.city+" "+p.desc).toLowerCase().includes(q));
  if (cat && cat!=="all") products=products.filter(p=>p.cat===cat);
  if (city && city!=="all") products=products.filter(p=>p.city.toLowerCase()===city.toLowerCase());
  if (sort==="low") products.sort((a,b)=>a.price-b.price);
  else if (sort==="high") products.sort((a,b)=>b.price-a.price);
  else if (sort==="moq") products.sort((a,b)=>a.moq-b.moq);
  else products.sort((a,b)=>String(b.ts).localeCompare(String(a.ts)));
  const offset=Math.max(0,Number(req.query.offset)||0), limit=Math.min(500,Math.max(1,Number(req.query.limit)||200));
  res.json({products:products.slice(offset,offset+limit),total:products.length});
});
app.post("/api/products",auth,(req,res)=>{
  const b=req.body||{}, name=clean(b.name,90), supplier=clean(b.supplier||req.user.businessName,100), city=clean(b.city||req.user.city,80);
  const price=Number(b.price), moq=Number(b.moq), unit=clean(b.unit||"pc",20), cat=clean(b.cat,80);
  if (!name || !(price>0) || !(moq>=1) || !supplier || !city || !cat) return fail(res,400,"Product name, category, positive price, minimum order, firm and city are required.");
  if (!db.categories.some(c=>c.id===cat)) return fail(res,400,"Choose a valid category.");
  const product={id:id(),name,cat,price,unit,moq,supplier,city,tag:clean(b.tag,40),desc:clean(b.desc,300),by:req.user.id,ts:new Date().toISOString()};
  db.products.push(product); persist(); res.status(201).json({product});
});
app.patch("/api/products/:id",auth,(req,res)=>{
  const p=db.products.find(x=>x.id===req.params.id);
  if (!p) return fail(res,404,"Product not found.");
  if (p.by!==req.user.id) return fail(res,403,"You can only edit your own products.");
  const b=req.body||{};
  for (const k of ["name","cat","unit","supplier","city","tag","desc"]) if (b[k]!==undefined) p[k]=clean(b[k],k==="desc"?300:100);
  if (b.price!==undefined) p.price=Number(b.price);
  if (b.moq!==undefined) p.moq=Number(b.moq);
  if (!p.name || !(p.price>0) || !(p.moq>=1) || !db.categories.some(c=>c.id===p.cat)) return fail(res,400,"Product data is invalid.");
  p.ts=new Date().toISOString(); persist(); res.json({product:p});
});
app.delete("/api/products/:id",auth,(req,res)=>{
  const i=db.products.findIndex(x=>x.id===req.params.id);
  if (i<0) return fail(res,404,"Product not found.");
  if (db.products[i].by!==req.user.id) return fail(res,403,"You can only delete your own products.");
  db.products.splice(i,1); persist(); res.json({ok:true});
});
app.post("/api/enquiries",(req,res)=>{
  const b=req.body||{}, p=db.products.find(x=>x.id===String(b.productId||""));
  const quantity=Number(b.quantity), name=clean(b.name,80), phone=clean(b.phone,20).replace(/\D/g,"");
  if (!p) return fail(res,404,"Product not found.");
  if (!(quantity>=p.moq) || phone.length!==10) return fail(res,400,"Quantity must meet the minimum order and phone must be 10 digits.");
  const e={id:id(),pid:p.id,pname:p.name,seller:p.by,qty:quantity,unit:p.unit,name,phone,ts:new Date().toISOString()};
  db.enquiries.push(e); persist(); res.status(201).json({enquiry:{id:e.id}});
});
app.get("/api/seller/enquiries",auth,(req,res)=>res.json({enquiries:db.enquiries.filter(e=>e.seller===req.user.id)}));
app.post("/api/requirements",(req,res)=>{
  const b=req.body||{}, name=clean(b.customerName||b.name,80), firmName=clean(b.firmName||b.businessName,100);
  const prod=clean(b.productName||b.prod,120), qty=Number(b.quantity||b.qty), unit=clean(b.unit||"pc",20);
  const city=clean(b.city,80), phone=clean(b.phone,20).replace(/\D/g,"");
  if (!name || !firmName || !prod || !(qty>=1) || phone.length!==10) return fail(res,400,"Customer name, firm name, product, quantity and a 10-digit phone number are required.");
  const r={id:id(),name,firmName,prod,qty,unit,city,phone,ts:new Date().toISOString()};
  db.requirements.push(r); persist(); res.status(201).json({requirement:r});
});
app.get("/api/requirements",(_req,res)=>res.json({requirements:[...db.requirements].sort((a,b)=>String(b.ts).localeCompare(String(a.ts)))}));

app.get("*",(req,res,next)=>{
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(root,"public","index.html"));
});
app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:"Internal server error."}); });
app.listen(PORT,()=>console.log(`Thokbazaar running at http://localhost:${PORT}`));
