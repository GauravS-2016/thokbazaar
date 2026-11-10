const db = require('./db');

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'or', 'in', 'to', 'with', 'need', 'want', 'buy', 'pcs', 'piece', 'pieces']);

function words(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

// Finds the sellers who should be told about a new buyer request.
//
// Step 1: sellers who have at least one product in the same category
//         (the buyer themselves is never notified).
// Step 2: among those, prefer sellers whose product name or keywords share
//         a word with the request title. If at least one seller matches on
//         words, only those are notified. If none do, every seller in the
//         category is notified so the buyer still gets responses.
function findMatchingSellers(request) {
  const rows = db
    .prepare(
      `SELECT p.seller_id, p.name, p.keywords, u.email, u.name AS seller_name
       FROM products p JOIN users u ON u.id = p.seller_id
       WHERE p.category = ? AND p.seller_id != ?`
    )
    .all(request.category, request.buyer_id);

  const reqWords = new Set(words(request.title + ' ' + (request.details || '')));
  const bySeller = new Map();

  for (const r of rows) {
    const entry = bySeller.get(r.seller_id) || {
      seller_id: r.seller_id,
      email: r.email,
      seller_name: r.seller_name,
      wordMatch: false,
    };
    const prodWords = words(r.name + ' ' + r.keywords);
    if (prodWords.some((w) => reqWords.has(w))) entry.wordMatch = true;
    bySeller.set(r.seller_id, entry);
  }

  const all = [...bySeller.values()];
  const strong = all.filter((s) => s.wordMatch);
  return strong.length ? strong : all;
}

module.exports = { findMatchingSellers };
