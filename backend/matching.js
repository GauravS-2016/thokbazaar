const db = require('./db');

const STOP = new Set([
  'the', 'a', 'an', 'of', 'for', 'and', 'or', 'in', 'to', 'with',
  'need', 'want', 'buy', 'pcs', 'piece', 'pieces'
]);

function words(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 1 && !STOP.has(word));
}

async function findMatchingSellers(request) {
  const { data: products, error: productError } = await db
    .from('products')
    .select('seller_id,name,keywords')
    .eq('category', request.category)
    .neq('seller_id', request.buyer_id);

  if (productError) throw productError;
  if (!products || products.length === 0) return [];

  const sellerIds = [...new Set(products.map(p => p.seller_id))];
  const { data: users, error: userError } = await db
    .from('users')
    .select('id,email,name')
    .in('id', sellerIds);

  if (userError) throw userError;

  const userById = new Map((users || []).map(user => [user.id, user]));
  const requestWords = new Set(words(`${request.title} ${request.details || ''}`));
  const bySeller = new Map();

  for (const product of products) {
    const user = userById.get(product.seller_id);
    if (!user) continue;

    const entry = bySeller.get(product.seller_id) || {
      seller_id: product.seller_id,
      email: user.email,
      seller_name: user.name,
      wordMatch: false
    };

    if (words(`${product.name} ${product.keywords || ''}`).some(w => requestWords.has(w))) {
      entry.wordMatch = true;
    }
    bySeller.set(product.seller_id, entry);
  }

  const sellers = [...bySeller.values()];
  const exactMatches = sellers.filter(seller => seller.wordMatch);
  return exactMatches.length ? exactMatches : sellers;
}

module.exports = { findMatchingSellers };
