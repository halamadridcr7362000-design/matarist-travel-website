// Shared data-access helpers for the accommodation feature.
// Two independent Netlify Blobs stores, separate from the existing
// "orders" store used by aviation — this is the fix that prevents a
// full-array rewrite on one side from ever clobbering the other.
const { getStore } = require("@netlify/blobs");

const LISTINGS_KEY = "all-listings";
const TRANSACTIONS_KEY = "all-transactions";

function listingsStore() {
  return getStore({ name: "accommodation-listings", consistency: "strong" });
}

function transactionsStore() {
  return getStore({ name: "accommodation-transactions", consistency: "strong" });
}

async function getAllListings() {
  const data = await listingsStore().get(LISTINGS_KEY, { type: "json" });
  return data || [];
}

async function saveAllListings(listings) {
  await listingsStore().setJSON(LISTINGS_KEY, listings);
}

// Fields a visitor is ever allowed to see. Deliberately an allow-list
// (not a block-list) so a new private field added later is safe by default.
const PUBLIC_LISTING_FIELDS = [
  "id", "slug", "status", "title", "district", "roomType", "monthlyRent",
  "currency", "deposit", "bills", "furnishing", "genderPolicy", "transport",
  "rules", "description", "photos", "lat", "lng", "updatedAt",
];

function toPublicListing(listing) {
  const out = {};
  for (const f of PUBLIC_LISTING_FIELDS) out[f] = listing[f];
  return out;
}

function isPubliclyVisible(listing) {
  return !!listing && (listing.status === "published" || listing.status === "rented");
}

// --- Transactions store, with ETag-guarded conditional writes ---
// Netlify Blobs documents onlyIfMatch/onlyIfNew as an optimistic-concurrency
// check (not a database transaction). We use it to detect a conflicting
// concurrent write and retry with a fresh read rather than silently
// overwriting another write.
async function getTransactionsWithEtag() {
  const res = await transactionsStore().getWithMetadata(TRANSACTIONS_KEY, { type: "json" });
  if (!res) return { data: [], etag: null };
  return { data: res.data || [], etag: res.etag };
}

async function trySaveTransactions(data, etag) {
  const opts = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
  return transactionsStore().setJSON(TRANSACTIONS_KEY, data, opts);
}

// mutateFn(currentArray) -> newArray. Retries on conflict up to maxAttempts.
async function updateTransactions(mutateFn, maxAttempts = 4) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { data, etag } = await getTransactionsWithEtag();
    const next = mutateFn(data);
    const result = await trySaveTransactions(next, etag);
    if (result.modified) return next;
    // Conflict: someone else wrote in between. Re-read and retry.
  }
  throw new Error("Could not save transaction after several attempts due to concurrent writes. Please retry.");
}

function withDerived(tx) {
  const sum = (arr, field) => (arr || []).reduce((s, p) => s + (parseFloat(p[field]) || 0), 0);
  const commissionCollected = sum(tx.payments, "amount");
  const landlordSharePaid = sum(tx.landlordSharePayments, "amount");
  const expensesPaidTotal = (tx.expenses || []).reduce((s, e) => s + (parseFloat(e.amountPaid) || 0), 0);
  const expensesAgreedTotal = (tx.expenses || []).reduce((s, e) => s + (parseFloat(e.amountAgreed) || 0), 0);
  const commissionAgreed = parseFloat(tx.commissionAgreed) || 0;
  const landlordShareAgreed = parseFloat(tx.landlordShareAgreed) || 0;
  return {
    ...tx,
    commissionCollected,
    commissionOutstanding: Math.max(0, commissionAgreed - commissionCollected),
    landlordSharePaid,
    landlordShareOutstanding: Math.max(0, landlordShareAgreed - landlordSharePaid),
    expensesPaidTotal,
    expensesAgreedTotal,
    realizedProfit: commissionCollected - landlordSharePaid - expensesPaidTotal,
    expectedProfit: commissionAgreed - landlordShareAgreed - expensesAgreedTotal,
    clientPaymentStatus: commissionCollected <= 0 ? "unpaid" : commissionCollected >= commissionAgreed ? "paid" : "partial",
  };
}

module.exports = {
  listingsStore,
  transactionsStore,
  getAllListings,
  saveAllListings,
  toPublicListing,
  isPubliclyVisible,
  getTransactionsWithEtag,
  updateTransactions,
  withDerived,
  LISTINGS_KEY,
  TRANSACTIONS_KEY,
};
